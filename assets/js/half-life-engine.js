/* Half-life / radioactive decay engine.
 *
 * Pure maths, no DOM. Everything is exported on window.HalfLifeEngine so the
 * page can use it and the test suite can require it in Node.
 *
 * Model: ideal exponential decay of a large population,
 *
 *     N(t) = N0 * (1/2)^(t / T)          T = half-life
 *          = N0 * e^(-lambda * t)        lambda = ln(2) / T
 *
 * The two forms are algebraically identical because
 * e^(-ln2 * t/T) = 2^(-t/T); the code evaluates the power-of-two form because
 * it is the better-conditioned of the two, and exposes lambda separately for
 * users who want it. agreementError() below measures the residual difference
 * so the equivalence is a tested property rather than a claim in a comment.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HalfLifeEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LN2 = Math.LN2;

  /* ---------------------------------------------------------------- units */

  /* Seconds per unit. The year is the Julian year (365.25 d), which is the
     convention used for published half-lives. The month is a labelled
     approximation — calendar months are not a fixed duration, so the UI must
     show it as "30 days" rather than implying a real calendar month. */
  var SECONDS = {
    seconds: 1,
    minutes: 60,
    hours: 3600,
    days: 86400,
    weeks: 604800,
    months: 2592000,        // exactly 30 days, an approximation
    years: 31557600          // 365.25 days
  };

  var UNIT_LABEL = {
    seconds: 's',
    minutes: 'min',
    hours: 'h',
    days: 'day',
    weeks: 'week',
    months: 'month',
    years: 'year'
  };

  var UNITS = Object.keys(SECONDS);

  function isUnit(u) {
    return Object.prototype.hasOwnProperty.call(SECONDS, u);
  }

  /* Convert a duration between two time units. */
  function convertTime(value, from, to) {
    if (!isUnit(from) || !isUnit(to)) throw new Error('Unknown time unit.');
    if (from === to) return value;
    return (value * SECONDS[from]) / SECONDS[to];
  }

  /* ----------------------------------------------------------- validation */

  function parseNumber(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (!s) return NaN;
    // tolerate 1e5, 1E-5, 1 000, 1,000 and unicode minus
    s = s.replace(/−/g, '-').replace(/[\s,](?=\d)/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  /* Each validator returns null when fine, or a message written for a user
     rather than a developer. */
  function validateInitial(n) {
    if (isNaN(n)) return 'Please enter a valid initial quantity.';
    if (n < 0) return 'Initial quantity cannot be negative.';
    if (n === 0) return 'Initial quantity must be greater than zero.';
    return null;
  }

  function validateHalfLife(n) {
    if (isNaN(n)) return 'Please enter a valid half-life.';
    if (n <= 0) return 'Half-life must be greater than zero.';
    return null;
  }

  function validateElapsed(n) {
    if (isNaN(n)) return 'Please enter a valid elapsed time.';
    if (n < 0) return 'Elapsed time cannot be negative.';
    return null;
  }

  function validateRemaining(n, initial) {
    if (isNaN(n)) return 'Please enter a valid remaining quantity.';
    if (n <= 0) return 'Remaining quantity must be greater than zero.';
    if (initial != null && !isNaN(initial) && n > initial) {
      return 'Remaining quantity cannot exceed the initial quantity.';
    }
    return null;
  }

  /* --------------------------------------------------------------- core */

  /* lambda in reciprocal units of whatever unit the half-life is given in. */
  function decayConstant(halfLife) {
    if (!(halfLife > 0)) throw new Error('Half-life must be greater than zero.');
    return LN2 / halfLife;
  }

  function meanLifetime(halfLife) {
    return halfLife / LN2;
  }

  /* Fractional number of half-lives elapsed. */
  function halfLives(elapsed, halfLife) {
    if (!(halfLife > 0)) throw new Error('Half-life must be greater than zero.');
    return elapsed / halfLife;
  }

  /* Remaining fraction after n half-lives — the quantity-independent core. */
  function remainingFraction(n) {
    return Math.pow(2, -n);
  }

  /* N(t) from the power-of-two form. */
  function remaining(initial, elapsed, halfLife) {
    return initial * remainingFraction(halfLives(elapsed, halfLife));
  }

  /* N(t) from the exponential form, kept so the equivalence is testable. */
  function remainingViaLambda(initial, elapsed, halfLife) {
    return initial * Math.exp(-decayConstant(halfLife) * elapsed);
  }

  /* Relative difference between the two formulations. Should sit at the
     floating-point noise floor (~1e-16) for every realistic input. */
  function agreementError(initial, elapsed, halfLife) {
    var a = remaining(initial, elapsed, halfLife);
    var b = remainingViaLambda(initial, elapsed, halfLife);
    if (a === b) return 0;
    var scale = Math.max(Math.abs(a), Math.abs(b));
    return scale === 0 ? 0 : Math.abs(a - b) / scale;
  }

  /* ------------------------------------------------------- solve modes */

  /* t = T * log2(N0 / N) */
  function timeToReach(initial, target, halfLife) {
    if (!(initial > 0)) throw new Error('Initial quantity must be greater than zero.');
    if (!(target > 0)) throw new Error('Remaining quantity must be greater than zero.');
    if (!(halfLife > 0)) throw new Error('Half-life must be greater than zero.');
    return halfLife * (Math.log(initial / target) / LN2);
  }

  /* T = t / log2(N0 / N) */
  function halfLifeFrom(initial, target, elapsed) {
    if (!(initial > 0)) throw new Error('Initial quantity must be greater than zero.');
    if (!(target > 0)) throw new Error('Remaining quantity must be greater than zero.');
    if (!(elapsed > 0)) throw new Error('Elapsed time must be greater than zero.');
    var n = Math.log(initial / target) / LN2;
    if (n === 0) throw new Error('Remaining quantity must differ from the initial quantity.');
    return elapsed / n;
  }

  /* N0 = N * 2^(t / T) */
  function initialFrom(target, elapsed, halfLife) {
    if (!(halfLife > 0)) throw new Error('Half-life must be greater than zero.');
    return target * Math.pow(2, elapsed / halfLife);
  }

  /* ------------------------------------------------------------ results */

  /* One complete answer for the forward calculation. All time values are in
     `unit`; the caller converts for display. */
  function solve(opts) {
    var initial = opts.initial;
    var elapsed = opts.elapsed;
    var halfLife = opts.halfLife;

    var n = halfLives(elapsed, halfLife);
    var frac = remainingFraction(n);
    var left = initial * frac;
    var gone = initial - left;

    return {
      initial: initial,
      elapsed: elapsed,
      halfLife: halfLife,
      halfLives: n,
      remaining: left,
      decayed: gone,
      remainingFraction: frac,
      percentRemaining: frac * 100,
      percentDecayed: (1 - frac) * 100,
      decayConstant: decayConstant(halfLife),
      meanLifetime: meanLifetime(halfLife)
    };
  }

  /* ------------------------------------------------------------- table */

  var DEFAULT_STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10];

  function decayTable(initial, halfLife, steps) {
    var list = steps || DEFAULT_STEPS;
    return list.map(function (n) {
      var frac = remainingFraction(n);
      return {
        halfLives: n,
        time: n * halfLife,
        remaining: initial * frac,
        decayed: initial * (1 - frac),
        percentRemaining: frac * 100,
        percentDecayed: (1 - frac) * 100
      };
    });
  }

  /* --------------------------------------------------------- graph data */

  /* Evenly spaced samples across [0, maxHalfLives] in half-life units. The
     curve is smooth, so sampling in half-lives keeps the shape identical no
     matter which time unit the user picked. */
  function curve(initial, halfLife, maxHalfLives, samples) {
    var count = Math.max(2, samples || 160);
    var span = maxHalfLives > 0 ? maxHalfLives : 1;
    var pts = new Array(count);
    for (var i = 0; i < count; i++) {
      var n = (i / (count - 1)) * span;
      var frac = remainingFraction(n);
      pts[i] = {
        halfLives: n,
        time: n * halfLife,
        value: initial * frac,
        fraction: frac,
        percentRemaining: frac * 100,
        percentDecayed: (1 - frac) * 100
      };
    }
    return pts;
  }

  /* How much of the curve to draw: enough to show the user's marker with room
     to spare, but always at least a few half-lives so the shape reads. */
  function suggestedSpan(halfLivesElapsed) {
    var n = halfLivesElapsed;
    if (!isFinite(n) || n <= 0) return 5;
    return Math.max(5, Math.ceil(n * 1.35));
  }

  /* ---------------------------------------------------- number display */

  function superscript(digits) {
    var map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return String(digits).split('').map(function (c) { return map[c] || c; }).join('');
  }

  /* Scientific notation as "1.25 × 10⁻⁸". */
  function toScientific(value, sig) {
    var digits = sig == null ? 4 : sig;
    if (value === 0) return '0';
    if (!isFinite(value)) return String(value);
    var exp = Math.floor(Math.log10(Math.abs(value)));
    var mant = value / Math.pow(10, exp);
    // guard the edge where rounding pushes the mantissa to 10
    var m = Number(mant.toFixed(Math.max(0, digits - 1)));
    if (Math.abs(m) >= 10) { m /= 10; exp += 1; }
    return trimZeros(m.toFixed(Math.max(0, digits - 1))) + ' × 10' + superscript(exp);
  }

  function trimZeros(s) {
    return s.indexOf('.') === -1 ? s : s.replace(/\.?0+$/, '');
  }

  /* Plain decimal with a sensible number of significant figures. */
  function toDecimal(value, sig) {
    var digits = sig == null ? 4 : sig;
    if (value === 0) return '0';
    if (!isFinite(value)) return String(value);
    var abs = Math.abs(value);
    if (abs >= 1e15 || abs < 1e-6) return toScientific(value, digits);
    var exp = Math.floor(Math.log10(abs));
    var places = Math.max(0, digits - 1 - exp);
    var out = value.toFixed(Math.min(20, places));
    out = trimZeros(out);
    // keep group separators out of copyable output; the UI adds them
    return out;
  }

  /* The display rule: switch to scientific when a decimal would be unreadable,
     unless the caller forces one mode. */
  function formatNumber(value, opts) {
    var o = opts || {};
    var sig = o.significantDigits == null ? 4 : o.significantDigits;
    if (value === 0) return '0';
    if (!isFinite(value)) return '—';
    if (o.notation === 'scientific') return toScientific(value, sig);
    if (o.notation === 'decimal') return toDecimal(value, sig);
    var abs = Math.abs(value);
    return (abs >= 1e6 || abs < 1e-4) ? toScientific(value, sig) : toDecimal(value, sig);
  }

  /* Percentages read better with fixed places, but a value that has decayed to
     a millionth of a percent still must not print as "0.00%". */
  function formatPercent(value, opts) {
    var o = opts || {};
    if (!isFinite(value)) return '—';
    if (value === 0) return '0%';
    if (value >= 0.01 || o.notation === 'decimal') {
      // Significant figures rather than fixed decimals, because the half-life
      // series lands on exact values students recognise — 12.5, 6.25, 3.125 —
      // and rounding those to 2 dp ("3.13%") reads as an error in a teaching
      // tool. Trailing zeros are trimmed so 50.00 still shows as 50.
      return toDecimal(value, o.significantDigits == null ? 4 : o.significantDigits) + '%';
    }
    return toScientific(value, 3) + '%';
  }

  return {
    SECONDS: SECONDS,
    UNITS: UNITS,
    UNIT_LABEL: UNIT_LABEL,
    isUnit: isUnit,
    convertTime: convertTime,

    parseNumber: parseNumber,
    validateInitial: validateInitial,
    validateHalfLife: validateHalfLife,
    validateElapsed: validateElapsed,
    validateRemaining: validateRemaining,

    decayConstant: decayConstant,
    meanLifetime: meanLifetime,
    halfLives: halfLives,
    remainingFraction: remainingFraction,
    remaining: remaining,
    remainingViaLambda: remainingViaLambda,
    agreementError: agreementError,

    timeToReach: timeToReach,
    halfLifeFrom: halfLifeFrom,
    initialFrom: initialFrom,

    solve: solve,
    decayTable: decayTable,
    DEFAULT_STEPS: DEFAULT_STEPS,
    curve: curve,
    suggestedSpan: suggestedSpan,

    superscript: superscript,
    toScientific: toScientific,
    toDecimal: toDecimal,
    formatNumber: formatNumber,
    formatPercent: formatPercent
  };
});
