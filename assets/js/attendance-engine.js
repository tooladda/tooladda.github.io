/* ToolAdda — Attendance Calculator engine.

   Pure arithmetic, no DOM, so every rule below is testable under plain Node.

   Three questions students actually ask, and they are not the same question:

     1. Where am I now?                        attended / held
     2. How many more can I miss?              the bunk budget
     3. How many must I attend to recover?     the catch-up count

   (2) and (3) are asymmetric. Missing a class adds to the denominator only;
   attending one adds to both. That is why a student sitting at 74% often has
   to attend several classes to gain a single point, while one sitting at 90%
   can miss a lot before losing one — and why a tool that reports only the
   current percentage is close to useless for planning. */
(function (global) {
  'use strict';

  var DEFAULT_REQUIRED = 75;

  /* Common thresholds. 75% is the usual UGC-linked rule most Indian
     universities quote; the others exist because plenty of institutions set
     their own, and a hardcoded 75 would make the tool wrong for them. */
  var PRESETS = [60, 65, 70, 75, 80, 85, 90];

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function toCount(value) {
    var n = Number(value);
    if (!isFiniteNumber(n) || n < 0) return 0;
    return Math.floor(n);
  }

  function clampPercent(value) {
    var n = Number(value);
    if (!isFiniteNumber(n)) return DEFAULT_REQUIRED;
    return Math.min(100, Math.max(0, n));
  }

  /** Current attendance as a percentage. No classes held yet is not 0% — it is
   *  simply unknown, and reporting 0 would tell a student on day one that they
   *  are failing. */
  function percentage(attended, held) {
    var a = toCount(attended);
    var h = toCount(held);
    if (h <= 0) return null;
    return (Math.min(a, h) / h) * 100;
  }

  function round(value, dp) {
    var f = Math.pow(10, dp === undefined ? 2 : dp);
    return Math.round(value * f) / f;
  }

  /** How many further classes can be missed while staying at or above the
   *  requirement.
   *
   *  a / (h + b) >= r/100  ->  b <= 100a/r - h
   *
   *  Returns 0 when already below the line — you cannot "afford" a bunk out of
   *  a deficit, and returning a negative number here would render as
   *  "you can skip -4 classes". */
  function canSkip(attended, held, required) {
    var a = toCount(attended);
    var h = toCount(held);
    var r = clampPercent(required);
    if (a > h) a = h;
    if (r <= 0) return Infinity;          // no requirement, skip freely
    var budget = Math.floor((100 * a) / r - h);
    return Math.max(0, budget);
  }

  /** How many classes must be attended, in a row, to climb back to the
   *  requirement.
   *
   *  (a + n) / (h + n) >= r/100  ->  n >= (r*h - 100a) / (100 - r)
   *
   *  At r = 100 the denominator is zero: with a perfect-attendance rule a
   *  student who has already missed one class can never recover, however many
   *  they attend. That is a real answer, not an error, so it is reported as
   *  Infinity rather than a divide-by-zero. */
  function mustAttend(attended, held, required) {
    var a = toCount(attended);
    var h = toCount(held);
    var r = clampPercent(required);
    if (a > h) a = h;
    if (h > 0 && (a / h) * 100 >= r) return 0;
    if (r >= 100) return a === h ? 0 : Infinity;
    var need = (r * h - 100 * a) / (100 - r);
    return Math.max(0, Math.ceil(need - 1e-9));
  }

  /** Best and worst percentage still reachable given the classes left in the
   *  term. This is the part that turns the tool from a readout into a planner:
   *  a student 12% short with 4 classes left needs to know it is already over. */
  function project(attended, held, remaining, required) {
    var a = toCount(attended);
    var h = toCount(held);
    var rem = toCount(remaining);
    var r = clampPercent(required);
    if (a > h) a = h;
    var finalHeld = h + rem;
    if (finalHeld <= 0) {
      return { best: null, worst: null, reachable: true, mustAttendOfRemaining: 0 };
    }
    var best = ((a + rem) / finalHeld) * 100;
    var worst = (a / finalHeld) * 100;
    /* Attend k of the remaining: (a + k) / (h + rem) >= r/100 */
    var k = Math.ceil(((r / 100) * finalHeld) - a - 1e-9);
    return {
      best: best,
      worst: worst,
      reachable: best >= r - 1e-9,
      mustAttendOfRemaining: Math.min(rem, Math.max(0, k))
    };
  }

  /** A single verdict the UI can colour by, rather than re-deriving the same
   *  comparisons in three places. */
  function status(attended, held, required) {
    var pct = percentage(attended, held);
    var r = clampPercent(required);
    if (pct === null) return 'unknown';
    if (pct >= r + 10) return 'safe';
    if (pct >= r) return 'ok';
    if (pct >= r - 10) return 'warning';
    return 'short';
  }

  /** Whole-term summary for one subject, or for a total row. */
  function summarise(input) {
    var opts = input || {};
    var attended = toCount(opts.attended);
    var held = toCount(opts.held);
    if (attended > held) attended = held;
    var required = clampPercent(opts.required === undefined ? DEFAULT_REQUIRED : opts.required);
    var remaining = toCount(opts.remaining);

    return {
      attended: attended,
      held: held,
      missed: held - attended,
      required: required,
      percentage: percentage(attended, held),
      status: status(attended, held, required),
      canSkip: canSkip(attended, held, required),
      mustAttend: mustAttend(attended, held, required),
      projection: project(attended, held, remaining, required)
    };
  }

  /** Roll several subjects into one overall picture. Overall attendance is the
   *  ratio of the TOTALS, never the average of the per-subject percentages —
   *  averaging treats a 4-class lab and a 40-lecture course as equals and can
   *  put a student on the wrong side of the line. */
  function combine(subjects, required) {
    var rows = subjects || [];
    var attended = 0;
    var held = 0;
    var remaining = 0;
    rows.forEach(function (row) {
      var a = toCount(row.attended);
      var h = toCount(row.held);
      if (a > h) a = h;
      attended += a;
      held += h;
      remaining += toCount(row.remaining);
    });
    return summarise({ attended: attended, held: held, remaining: remaining, required: required });
  }

  /** Plain-language line for the result card. Kept here so the wording is
   *  covered by the same tests as the arithmetic it describes. */
  function verdictText(summary) {
    if (!summary || summary.percentage === null) {
      return 'Enter how many classes were held to see where you stand.';
    }
    var pct = round(summary.percentage, 2);
    if (summary.percentage >= summary.required) {
      if (summary.canSkip === 0) {
        return 'You are at ' + pct + '% — exactly on the line. Miss one more and you drop below ' +
          summary.required + '%.';
      }
      return 'You are at ' + pct + '% — safe. You can miss ' + summary.canSkip +
        (summary.canSkip === 1 ? ' more class' : ' more classes') + ' and still hold ' +
        summary.required + '%.';
    }
    if (summary.mustAttend === Infinity) {
      return 'You are at ' + pct + '%. With a ' + summary.required +
        '% rule there is no number of classes that brings you back.';
    }
    return 'You are at ' + pct + '% — below ' + summary.required + '%. Attend the next ' +
      summary.mustAttend + (summary.mustAttend === 1 ? ' class' : ' classes') + ' without missing any to get back.';
  }

  var api = {
    DEFAULT_REQUIRED: DEFAULT_REQUIRED,
    PRESETS: PRESETS,
    toCount: toCount,
    clampPercent: clampPercent,
    round: round,
    percentage: percentage,
    canSkip: canSkip,
    mustAttend: mustAttend,
    project: project,
    status: status,
    summarise: summarise,
    combine: combine,
    verdictText: verdictText
  };

  global.AttendanceEngine = api;

  /* ------------------------------------------------------------------ *
   * Node/test export — everything above this line is pure and DOM-free.
   * ------------------------------------------------------------------ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : this);
