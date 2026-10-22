/* ============================================================
   ToolAdda — RD (Recurring Deposit) Calculator

   WHAT WAS WRONG BEFORE
   ---------------------
   The previous engine looped month by month and credited a full
   period's interest to the whole balance whenever the month index
   divided evenly into the period:

       balance += monthlyDeposit;
       if (month % monthsPerPeriod === 0) balance += balance * periodRate;

   That gives the instalment paid *in* the closing month a full
   quarter of interest it never earned, so every quarterly figure came
   out high. It also silently dropped the final stub period whenever
   the tenure was not a whole number of compounding periods, which
   pulled the answer back down again by a different amount. Two
   errors in opposite directions is worse than one, because the sign
   of the mistake changes with the inputs.

   CONVENTION — read this before touching any arithmetic.
   ------------------------------------------------------
   Indian recurring deposits are quarterly compounded and the
   instalment is debited at the START of each month, so an instalment
   paid in month m earns interest for (N - m + 1) months. With i the
   periodic rate (annual / f) and f compounding periods per year, the
   growth factor for one month is

       k = (1 + i)^(f/12)

   and the maturity value of N monthly instalments of R is

       M = R x SUM(j = 1..N) k^j
         = R x k x (k^N - 1) / (k - 1)

   For the standard case f = 4 this is algebraically identical to the
   RD formula Indian banks publish,

       M = R x [(1 + i)^n - 1] / [1 - (1 + i)^(-1/3)]      n = N/3

   (substitute k = (1+i)^(1/3) and the two collapse to the same
   expression). The series form is used here because it is defined for
   every tenure, not only whole quarters, and because it falls out of
   a running balance that also produces the month-by-month table.

   The running balance obeys

       balance(m) = (balance(m-1) + R) x k

   which is the same series expanded, so the table and the headline
   can never disagree.

   When i = 0 the factor k is exactly 1 and the sum degenerates to
   R x N. That is handled by a real branch rather than by hoping the
   floating point works out, so a 0% rate returns the deposits back
   and never NaN.

   NOTHING HERE IS A QUOTED BANK RATE. The rate is whatever the user
   types. Every label the engine produces says "estimated".
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. Constants
     ============================================================ */

  var MIN_DEPOSIT = 100;
  var MAX_DEPOSIT = 10000000;      /* 1 crore per month */
  var MIN_RATE = 0;
  var MAX_RATE = 20;
  var MIN_MONTHS = 1;
  var MAX_MONTHS = 360;            /* 30 years */
  var MIN_TARGET = 1000;
  var MAX_TARGET = 1000000000;     /* 100 crore */

  var COMPOUNDING = {
    monthly: 12,
    quarterly: 4,
    'half-yearly': 2,
    annually: 1
  };

  var COMPOUNDING_LABEL = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    'half-yearly': 'Half-yearly',
    annually: 'Annually'
  };

  var DEFAULT_FREQUENCY = 'quarterly';

  /* ============================================================
     2. Numeric helpers
     ============================================================ */

  function clean(n) {
    return (typeof n === 'number' && isFinite(n)) ? n : 0;
  }

  function roundTo(n, dp) {
    if (!isFinite(n)) return 0;
    var f = Math.pow(10, dp || 0);
    /* Nudge off the binary representation before rounding so that
       values like 2.675 do not round down. */
    return Math.round((n + Number.EPSILON * Math.abs(n)) * f) / f;
  }

  function isBlank(raw) {
    return raw === null || raw === undefined || String(raw).trim() === '';
  }

  /* ============================================================
     3. Validation

     Every parser returns either { ok: true, value } or
     { ok: false, field, message }. The UI shows the message and
     marks the field; nothing downstream ever sees a bad number.
     ============================================================ */

  function invalid(field, message) {
    return { ok: false, field: field, message: message };
  }

  function parseNumber(raw) {
    /* A real number arrives from presets and from the test suite.
       Take it as-is: String(1e-7) is "1e-7", which the text pattern
       below would reject as garbage. */
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    if (isBlank(raw)) return NaN;
    /* Accept "5,000", "₹5,000", "5 000" and "5000.50". */
    var text = String(raw).replace(/[₹,\s]/g, '');
    if (!/^-?\d*\.?\d+$/.test(text)) return NaN;
    return parseFloat(text);
  }

  function parseDeposit(raw, field, label, min, max) {
    var n = parseNumber(raw);
    if (isNaN(n)) return invalid(field, label + ' must be a number.');
    if (n < 0) return invalid(field, label + ' cannot be negative.');
    if (n === 0) return invalid(field, label + ' must be more than zero.');
    if (n < min) return invalid(field, label + ' must be at least ' + formatINR(min) + '.');
    if (n > max) return invalid(field, label + ' cannot exceed ' + formatINR(max) + '.');
    return { ok: true, value: roundTo(n, 2) };
  }

  function parseRate(raw, field) {
    var n = parseNumber(raw);
    if (isNaN(n)) return invalid(field, 'Interest rate must be a number.');
    if (n < MIN_RATE) return invalid(field, 'Interest rate cannot be negative.');
    if (n > MAX_RATE) return invalid(field, 'Interest rate cannot exceed ' + MAX_RATE + '%.');
    return { ok: true, value: roundTo(n, 4) };
  }

  /* Tenure arrives as years + months and is normalised to months, so
     "1 year 6 months", "18 months" and "1.5 years" all land on 18. */
  function parseTenure(rawYears, rawMonths) {
    var years = isBlank(rawYears) ? 0 : parseNumber(rawYears);
    var months = isBlank(rawMonths) ? 0 : parseNumber(rawMonths);

    if (isNaN(years)) return invalid('years', 'Tenure years must be a number.');
    if (isNaN(months)) return invalid('months', 'Tenure months must be a number.');
    if (years < 0 || months < 0) return invalid('years', 'Tenure cannot be negative.');

    var total = Math.round(years * 12 + months);

    if (total < MIN_MONTHS) return invalid('years', 'Tenure must be at least 1 month.');
    if (total > MAX_MONTHS) {
      return invalid('years', 'Tenure cannot exceed ' + (MAX_MONTHS / 12) + ' years.');
    }
    return { ok: true, value: total };
  }

  function normaliseFrequency(freq) {
    return Object.prototype.hasOwnProperty.call(COMPOUNDING, freq) ? freq : DEFAULT_FREQUENCY;
  }

  /* ============================================================
     4. The RD core

     monthlyFactor  -> k, the one-month growth factor
     unitMaturity   -> maturity of a SINGLE rupee deposited monthly,
                       i.e. SUM k^j. Both the forward calculation and
                       the target solve are built on it, which is what
                       keeps the two modes consistent by construction.
     ============================================================ */

  function monthlyFactor(annualRatePercent, frequency) {
    var f = COMPOUNDING[normaliseFrequency(frequency)];
    var i = clean(annualRatePercent) / 100 / f;
    if (i === 0) return 1;
    return Math.pow(1 + i, f / 12);
  }

  function unitMaturity(annualRatePercent, months, frequency) {
    var n = Math.max(0, Math.round(clean(months)));
    if (n === 0) return 0;
    var k = monthlyFactor(annualRatePercent, frequency);
    /* k === 1 exactly when the rate is 0. Guard on a tolerance too,
       because a microscopic rate would otherwise divide by ~0. */
    if (Math.abs(k - 1) < 1e-12) return n;
    return k * (Math.pow(k, n) - 1) / (k - 1);
  }

  /* Closed form for the published bank formula, kept so the test
     suite can prove the series and the textbook expression agree. */
  function maturityClosedForm(deposit, annualRatePercent, months, frequency) {
    return clean(deposit) * unitMaturity(annualRatePercent, months, frequency);
  }

  /* Month-by-month walk. Returns one row per month plus yearly
     aggregates. This is the single source of every table and chart. */
  function simulate(deposit, annualRatePercent, months, frequency) {
    var k = monthlyFactor(annualRatePercent, frequency);
    var n = Math.max(0, Math.round(clean(months)));
    var R = clean(deposit);

    var monthly = [];
    var yearly = [];
    var balance = 0;
    var deposited = 0;
    var yearOpeningValue = 0;
    var yearOpeningDeposits = 0;

    for (var m = 1; m <= n; m += 1) {
      var opening = balance;
      balance = (balance + R) * k;
      deposited += R;

      var monthInterest = balance - opening - R;

      monthly.push({
        month: m,
        year: Math.ceil(m / 12),
        deposit: roundTo(R, 2),
        totalDeposited: roundTo(deposited, 2),
        interest: roundTo(monthInterest, 2),
        balance: roundTo(balance, 2)
      });

      if (m % 12 === 0 || m === n) {
        yearly.push({
          year: Math.ceil(m / 12),
          months: m - (yearly.length * 12),
          depositedInYear: roundTo(deposited - yearOpeningDeposits, 2),
          totalDeposited: roundTo(deposited, 2),
          interestInYear: roundTo((balance - deposited) - (yearOpeningValue - yearOpeningDeposits), 2),
          totalInterest: roundTo(balance - deposited, 2),
          value: roundTo(balance, 2)
        });
        yearOpeningValue = balance;
        yearOpeningDeposits = deposited;
      }
    }

    return {
      maturity: balance,
      totalDeposits: deposited,
      interest: balance - deposited,
      monthly: monthly,
      yearly: yearly
    };
  }

  /* Reverse mode. Same series, solved for R instead of M, so a target
     result fed back into the forward calculator reproduces the
     target. The test suite asserts exactly that round trip. */
  function requiredDeposit(target, annualRatePercent, months, frequency) {
    var unit = unitMaturity(annualRatePercent, months, frequency);
    if (!isFinite(unit) || unit <= 0) return 0;
    return clean(target) / unit;
  }

  /* ============================================================
     5. calculate() — the one entry point

     Everything the page renders comes out of this object. No panel
     re-derives a number for itself.
     ============================================================ */

  function calculate(input) {
    input = input || {};
    var mode = input.mode === 'target' ? 'target' : 'standard';
    var frequency = normaliseFrequency(input.frequency);

    var tenure = parseTenure(input.years, input.months);
    if (!tenure.ok) return tenure;

    var rate = parseRate(input.annualRate, 'rate');
    if (!rate.ok) return rate;

    var totalMonths = tenure.value;
    var deposit;

    if (mode === 'target') {
      var target = parseDeposit(input.target, 'target', 'Target amount', MIN_TARGET, MAX_TARGET);
      if (!target.ok) return target;

      var raw = requiredDeposit(target.value, rate.value, totalMonths, frequency);
      /* Banks accept whole-rupee instalments, so round UP: rounding
         down would land just short of the goal. */
      deposit = Math.ceil(raw);

      if (deposit < MIN_DEPOSIT) deposit = MIN_DEPOSIT;
      if (deposit > MAX_DEPOSIT) {
        return invalid('target', 'That target needs more than ' + formatINR(MAX_DEPOSIT) +
          ' a month. Try a longer tenure or a smaller target.');
      }
    } else {
      var dep = parseDeposit(input.deposit, 'deposit', 'Monthly deposit', MIN_DEPOSIT, MAX_DEPOSIT);
      if (!dep.ok) return dep;
      deposit = dep.value;
    }

    var sim = simulate(deposit, rate.value, totalMonths, frequency);

    var maturity = roundTo(sim.maturity, 2);
    var totalDeposits = roundTo(sim.totalDeposits, 2);
    /* Derive interest from the two rounded figures so the three
       headline numbers always add up on screen. */
    var interest = roundTo(maturity - totalDeposits, 2);

    var years = Math.floor(totalMonths / 12);
    var residualMonths = totalMonths % 12;

    return {
      ok: true,
      mode: mode,

      deposit: deposit,
      annualRate: rate.value,
      frequency: frequency,
      frequencyLabel: COMPOUNDING_LABEL[frequency],
      compoundsPerYear: COMPOUNDING[frequency],

      totalMonths: totalMonths,
      years: years,
      residualMonths: residualMonths,
      tenureLabel: formatTenure(totalMonths),
      installments: totalMonths,

      maturity: maturity,
      totalDeposits: totalDeposits,
      interest: interest,

      /* Share of the maturity value that is interest rather than
         money the saver put in. Guarded against a zero maturity. */
      interestShare: maturity > 0 ? roundTo((interest / maturity) * 100, 2) : 0,
      depositShare: maturity > 0 ? roundTo((totalDeposits / maturity) * 100, 2) : 0,

      target: mode === 'target' ? roundTo(clean(parseNumber(input.target)), 2) : null,

      monthly: sim.monthly,
      yearly: sim.yearly
    };
  }

  /* ============================================================
     6. Formatting
     ============================================================ */

  function formatINR(value, options) {
    options = options || {};
    var n = clean(value);
    var dp = options.decimals === undefined ? 0 : options.decimals;
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: dp,
        maximumFractionDigits: dp
      }).format(n);
    } catch (e) {
      return '₹' + n.toFixed(dp);
    }
  }

  /* Indian short scale — what a saver actually reads on a chart axis. */
  function formatCompact(value) {
    var n = clean(value);
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 10000000) return sign + '₹' + roundTo(a / 10000000, 2) + ' Cr';
    if (a >= 100000) return sign + '₹' + roundTo(a / 100000, 2) + ' L';
    if (a >= 1000) return sign + '₹' + roundTo(a / 1000, 1) + 'K';
    return sign + '₹' + roundTo(a, 0);
  }

  function formatPercent(value, dp) {
    return roundTo(clean(value), dp === undefined ? 2 : dp) + '%';
  }

  function formatTenure(totalMonths) {
    var n = Math.max(0, Math.round(clean(totalMonths)));
    var y = Math.floor(n / 12);
    var m = n % 12;
    var parts = [];
    if (y) parts.push(y + (y === 1 ? ' year' : ' years'));
    if (m) parts.push(m + (m === 1 ? ' month' : ' months'));
    return parts.length ? parts.join(' ') : '0 months';
  }

  /* Plain-text summary used by Copy, Share and the print header.
     Built from the result object, never from the DOM. */
  function resultToText(r) {
    if (!r || !r.ok) return '';
    var lines = [
      'RD Calculation — ToolAdda',
      '',
      'Monthly deposit: ' + formatINR(r.deposit),
      'Tenure: ' + r.tenureLabel + ' (' + r.installments + ' deposits)',
      'Interest rate: ' + formatPercent(r.annualRate) + ' p.a.',
      'Compounding: ' + r.frequencyLabel,
      '',
      'Total deposits: ' + formatINR(r.totalDeposits),
      'Estimated interest: ' + formatINR(r.interest),
      'Estimated maturity: ' + formatINR(r.maturity),
      '',
      'Estimate only. Actual RD maturity depends on your bank\'s rate and rounding convention.'
    ];
    if (r.mode === 'target') {
      lines.splice(2, 0, 'Target amount: ' + formatINR(r.target));
    }
    return lines.join('\n');
  }

  /* ============================================================
     7. Export
     ============================================================ */

  var engine = {
    MIN_DEPOSIT: MIN_DEPOSIT,
    MAX_DEPOSIT: MAX_DEPOSIT,
    MIN_RATE: MIN_RATE,
    MAX_RATE: MAX_RATE,
    MIN_MONTHS: MIN_MONTHS,
    MAX_MONTHS: MAX_MONTHS,
    MIN_TARGET: MIN_TARGET,
    MAX_TARGET: MAX_TARGET,
    COMPOUNDING: COMPOUNDING,
    COMPOUNDING_LABEL: COMPOUNDING_LABEL,
    DEFAULT_FREQUENCY: DEFAULT_FREQUENCY,

    clean: clean,
    roundTo: roundTo,
    parseNumber: parseNumber,
    parseDeposit: parseDeposit,
    parseRate: parseRate,
    parseTenure: parseTenure,

    monthlyFactor: monthlyFactor,
    unitMaturity: unitMaturity,
    maturityClosedForm: maturityClosedForm,
    simulate: simulate,
    requiredDeposit: requiredDeposit,
    calculate: calculate,

    formatINR: formatINR,
    formatCompact: formatCompact,
    formatPercent: formatPercent,
    formatTenure: formatTenure,
    resultToText: resultToText
  };

  globalScope.ToolAddaRd = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     8. UI state
     ============================================================ */

  var PREFS_KEY = 'tooladda-rd-prefs';
  var HISTORY_KEY = 'tooladda-rd-history';
  var HISTORY_LIMIT = 6;

  var PRESET_DEPOSITS = [1000, 2000, 5000, 10000, 20000, 50000];
  var PRESET_TENURES = [12, 24, 36, 60, 84, 120];
  var PRESET_RATES = [6, 6.5, 7, 7.5, 8];
  var PRESET_TARGETS = [100000, 500000, 1000000, 2500000];

  var EXAMPLE_DEPOSITS = [5000, 10000, 20000];
  var EXAMPLE_RATE = 7;
  var EXAMPLE_MONTHS = 60;

  var YEAR_ROWS_COLLAPSED = 5;

  var state = {
    mode: 'standard',
    deposit: '5000',
    years: '5',
    months: '0',
    annualRate: '7',
    frequency: DEFAULT_FREQUENCY,
    target: '500000',
    showAllYears: false,
    historyEnabled: false,
    result: null
  };

  var dom = {};
  var announceTimer = null;
  var recalcTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ============================================================
     9. DOM cache
     ============================================================ */

  function cacheDom() {
    dom.root = q('[data-rd-root]');
    if (!dom.root) return false;

    dom.modeButtons = qa('[data-rd-mode]', dom.root);
    dom.standardFields = q('[data-rd-standard-fields]', dom.root);
    dom.targetFields = q('[data-rd-target-fields]', dom.root);

    dom.deposit = q('#rdDeposit', dom.root);
    dom.depositRange = q('#rdDepositRange', dom.root);
    dom.years = q('#rdYears', dom.root);
    dom.months = q('#rdMonths', dom.root);
    dom.tenureHint = q('[data-rd-tenure-hint]', dom.root);
    dom.rate = q('#rdRate', dom.root);
    dom.rateRange = q('#rdRateRange', dom.root);
    dom.frequency = q('#rdFrequency', dom.root);
    dom.target = q('#rdTarget', dom.root);

    dom.presets = {
      deposit: q('[data-rd-preset="deposit"]', dom.root),
      tenure: q('[data-rd-preset="tenure"]', dom.root),
      rate: q('[data-rd-preset="rate"]', dom.root),
      target: q('[data-rd-preset="target"]', dom.root)
    };

    dom.calculate = q('#rdCalculate', dom.root);
    dom.reset = q('#rdReset', dom.root);
    dom.copy = q('#rdCopy', dom.root);
    dom.print = q('#rdPrint', dom.root);
    dom.share = q('#rdShare', dom.root);

    dom.error = q('[data-rd-error]', dom.root);
    dom.announce = q('[data-rd-announce]', dom.root);
    dom.results = q('[data-rd-results]', dom.root);

    dom.headlineBox = q('[data-rd-headline-box]', dom.root);
    dom.headlineLabel = q('[data-rd-headline-label]', dom.root);
    dom.maturity = q('[data-rd-maturity]', dom.root);
    dom.maturityCompact = q('[data-rd-maturity-compact]', dom.root);
    dom.maturityNote = q('[data-rd-maturity-note]', dom.root);

    dom.split = q('[data-rd-split]', dom.root);
    dom.stats = q('[data-rd-stats]', dom.root);
    dom.chart = q('[data-rd-chart]', dom.root);
    dom.chartKey = q('[data-rd-chart-key]', dom.root);
    dom.chartCaption = q('[data-rd-chart-caption]', dom.root);
    dom.printStamp = q('[data-rd-print-stamp]', dom.root);

    dom.timeline = q('[data-rd-timeline]', dom.root);
    dom.yearBody = q('[data-rd-year-body]', dom.root);
    dom.yearCaption = q('[data-rd-year-caption]', dom.root);
    dom.yearToggle = q('[data-rd-year-toggle]', dom.root);
    dom.monthDetails = q('[data-rd-month-details]', dom.root);
    dom.monthToggle = q('[data-rd-month-toggle]', dom.root);
    dom.monthBody = q('[data-rd-month-body]', dom.root);
    dom.breakdown = q('[data-rd-breakdown]', dom.root);

    dom.historyToggle = q('#rdHistoryToggle', dom.root);
    dom.historyPanel = q('[data-rd-history-panel]', dom.root);
    dom.historyList = q('[data-rd-history-list]', dom.root);
    dom.historyClear = q('[data-rd-history-clear]', dom.root);

    dom.examples = q('[data-rd-examples]');

    return true;
  }

  /* ============================================================
     10. Preferences + history (localStorage only, never a server)
     ============================================================ */

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      ['mode', 'deposit', 'years', 'months', 'annualRate', 'frequency', 'target'].forEach(function (key) {
        if (saved[key] !== undefined && saved[key] !== null) state[key] = String(saved[key]);
      });
      state.mode = state.mode === 'target' ? 'target' : 'standard';
      state.frequency = normaliseFrequency(state.frequency);
      state.historyEnabled = saved.historyEnabled === true;
    } catch (e) { /* corrupt or unavailable storage is not fatal */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        mode: state.mode,
        deposit: state.deposit,
        years: state.years,
        months: state.months,
        annualRate: state.annualRate,
        frequency: state.frequency,
        target: state.target,
        historyEnabled: state.historyEnabled
      }));
    } catch (e) { /* private mode */ }
  }

  function readHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function pushHistory(r) {
    if (!state.historyEnabled || !r || !r.ok) return;
    var entry = {
      deposit: r.deposit,
      tenure: r.tenureLabel,
      rate: r.annualRate,
      maturity: r.maturity,
      at: Date.now()
    };
    var signature = entry.deposit + '|' + entry.tenure + '|' + entry.rate;
    var list = readHistory().filter(function (e) {
      return (e.deposit + '|' + e.tenure + '|' + e.rate) !== signature;
    });
    list.unshift(entry);
    list = list.slice(0, HISTORY_LIMIT);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    renderHistory();
  }

  function renderHistory() {
    if (!dom.historyList) return;
    var list = readHistory();
    if (!list.length) {
      dom.historyList.innerHTML = '<li class="rd-history__item">Nothing saved yet.</li>';
      return;
    }
    dom.historyList.innerHTML = list.map(function (e) {
      return '<li class="rd-history__item">' +
        '<span>' + esc(formatINR(e.deposit)) + '/month • ' + esc(e.tenure) + ' • ' + esc(formatPercent(e.rate)) + '</span>' +
        '<span class="rd-history__value">' + esc(formatINR(e.maturity)) + '</span>' +
        '</li>';
    }).join('');
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* ignore */ }
    renderHistory();
    announce('Calculation history cleared.');
  }

  /* ============================================================
     11. Small UI utilities
     ============================================================ */

  function announce(message) {
    if (!dom.announce) return;
    /* Clearing first makes a repeated message re-announce. */
    dom.announce.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      dom.announce.textContent = message;
    }, 60);
  }

  function showError(message, field) {
    if (dom.error) {
      dom.error.textContent = message || '';
      dom.error.hidden = !message;
    }
    qa('[data-rd-field]', dom.root).forEach(function (el) {
      var bad = !!message && el.getAttribute('data-rd-field') === field;
      var input = el.matches('input, select') ? el : q('input, select', el);
      if (!input) return;
      if (bad) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
    setActionsEnabled(!message);
  }

  function setActionsEnabled(on) {
    [dom.copy, dom.print, dom.share].forEach(function (btn) {
      if (btn) btn.disabled = !on;
    });
  }

  /* ============================================================
     12. Rendering
     ============================================================ */

  function syncModeButtons() {
    dom.modeButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-rd-mode') === state.mode;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (dom.standardFields) dom.standardFields.hidden = state.mode !== 'standard';
    if (dom.targetFields) dom.targetFields.hidden = state.mode !== 'target';
    if (dom.calculate) {
      dom.calculate.textContent = state.mode === 'target' ? 'Calculate monthly deposit' : 'Calculate RD';
    }
  }

  function syncInputsFromState() {
    if (dom.deposit) dom.deposit.value = state.deposit;
    if (dom.depositRange) dom.depositRange.value = clampRange(dom.depositRange, state.deposit);
    if (dom.years) dom.years.value = state.years;
    if (dom.months) dom.months.value = state.months;
    if (dom.rate) dom.rate.value = state.annualRate;
    if (dom.rateRange) dom.rateRange.value = clampRange(dom.rateRange, state.annualRate);
    if (dom.frequency) dom.frequency.value = state.frequency;
    if (dom.target) dom.target.value = state.target;
  }

  function clampRange(rangeEl, value) {
    var n = parseNumber(value);
    var min = parseFloat(rangeEl.min);
    var max = parseFloat(rangeEl.max);
    if (isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function renderPresets() {
    function fill(container, values, formatter, attr) {
      if (!container) return;
      container.innerHTML = values.map(function (v) {
        return '<button type="button" class="rd-chip" ' + attr + '="' + v + '" aria-pressed="false">' +
          esc(formatter(v)) + '</button>';
      }).join('');
    }
    fill(dom.presets.deposit, PRESET_DEPOSITS, function (v) { return formatINR(v); }, 'data-rd-set-deposit');
    fill(dom.presets.tenure, PRESET_TENURES, function (v) { return formatTenure(v); }, 'data-rd-set-tenure');
    fill(dom.presets.rate, PRESET_RATES, function (v) { return v + '%'; }, 'data-rd-set-rate');
    fill(dom.presets.target, PRESET_TARGETS, function (v) { return formatCompact(v); }, 'data-rd-set-target');
    syncPresetPressed();
  }

  function syncPresetPressed() {
    function mark(container, attr, current) {
      if (!container) return;
      qa('[' + attr + ']', container).forEach(function (btn) {
        var on = parseFloat(btn.getAttribute(attr)) === parseFloat(current);
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    mark(dom.presets.deposit, 'data-rd-set-deposit', parseNumber(state.deposit));
    mark(dom.presets.rate, 'data-rd-set-rate', parseNumber(state.annualRate));
    mark(dom.presets.target, 'data-rd-set-target', parseNumber(state.target));
    var totalMonths = (parseNumber(state.years) || 0) * 12 + (parseNumber(state.months) || 0);
    mark(dom.presets.tenure, 'data-rd-set-tenure', totalMonths);
  }

  /* The headline carries the answer to the question the current mode
     actually asks: how much will it mature to, or how much must I put
     in. Everything else demotes to the stat row. */
  function renderHeadline(r) {
    var isTarget = r.mode === 'target';

    if (dom.headlineBox) dom.headlineBox.classList.toggle('rd-headline--target', isTarget);
    if (dom.headlineLabel) {
      dom.headlineLabel.textContent = isTarget ? 'Monthly deposit needed' : 'Estimated maturity amount';
    }

    var headlineValue = isTarget ? r.deposit : r.maturity;
    if (dom.maturity) dom.maturity.textContent = formatINR(headlineValue);
    if (dom.maturityCompact) {
      dom.maturityCompact.textContent = headlineValue >= 100000 ? formatCompact(headlineValue) : '';
    }

    if (dom.maturityNote) {
      dom.maturityNote.textContent = isTarget
        ? 'Deposit ' + formatINR(r.deposit) + ' a month for ' + r.tenureLabel + ' at ' +
          formatPercent(r.annualRate) + ' p.a. to reach ' + formatINR(r.target) +
          '. Rounded up to the nearest rupee so the estimate reaches the goal.'
        : r.installments + ' deposits over ' + r.tenureLabel + ' at an assumed ' +
          formatPercent(r.annualRate) + ' p.a., compounded ' + r.frequencyLabel.toLowerCase() +
          '. Estimate only — not a quoted or guaranteed rate.';
    }
  }

  /* Width carries the proportion; the legend restates both figures in
     text so the meaning never depends on telling two colours apart. */
  function renderSplit(r) {
    if (!dom.split) return;
    var depositPct = r.maturity > 0 ? (r.totalDeposits / r.maturity) * 100 : 100;
    var interestPct = Math.max(0, 100 - depositPct);

    dom.split.innerHTML =
      '<div class="rd-splitbar" role="img" aria-label="' +
        esc('Deposits ' + formatINR(r.totalDeposits) + ', ' + roundTo(depositPct, 1) +
            ' per cent. Estimated interest ' + formatINR(r.interest) + ', ' +
            roundTo(interestPct, 1) + ' per cent.') + '">' +
        '<span class="rd-splitbar__seg rd-splitbar__seg--deposit" style="width:' + roundTo(depositPct, 2) + '%"></span>' +
        '<span class="rd-splitbar__seg rd-splitbar__seg--interest" style="width:' + roundTo(interestPct, 2) + '%"></span>' +
      '</div>' +
      '<dl class="rd-legend">' +
        '<div class="rd-legend__item rd-legend__item--deposit">' +
          '<dt>Your deposits</dt>' +
          '<dd>' + esc(formatINR(r.totalDeposits)) + ' <span>' + roundTo(depositPct, 1) + '%</span></dd>' +
        '</div>' +
        '<div class="rd-legend__item rd-legend__item--interest">' +
          '<dt>Estimated interest</dt>' +
          '<dd>' + esc(formatINR(r.interest)) + ' <span>' + roundTo(interestPct, 1) + '%</span></dd>' +
        '</div>' +
      '</dl>';
  }

  function statCell(label, value, variant, hint) {
    return '<div class="rd-stat' + (variant ? ' rd-stat--' + variant : '') + '">' +
      '<dt>' + esc(label) + '</dt>' +
      '<dd>' + esc(value) + '</dd>' +
      (hint ? '<p class="rd-stat__hint">' + esc(hint) + '</p>' : '') +
      '</div>';
  }

  function renderStats(r) {
    if (!dom.stats) return;
    var cells;

    if (r.mode === 'target') {
      cells = [
        statCell('Target amount', formatINR(r.target)),
        statCell('Estimated maturity', formatINR(r.maturity), null, 'Slightly above the target because the instalment is rounded up.'),
        statCell('Total deposits', formatINR(r.totalDeposits), 'deposit'),
        statCell('Estimated interest', formatINR(r.interest), 'interest')
      ];
    } else {
      cells = [
        statCell('Total deposits', formatINR(r.totalDeposits), 'deposit', r.installments + ' × ' + formatINR(r.deposit)),
        statCell('Estimated interest', formatINR(r.interest), 'interest', formatPercent(r.interestShare, 1) + ' of the maturity value'),
        statCell('Number of deposits', String(r.installments)),
        statCell('Compounding', r.frequencyLabel)
      ];
    }
    dom.stats.innerHTML = cells.join('');
  }

  /* Growth chart. Hand-drawn SVG rather than a chart library: two
     series and at most thirty points, and it has to inherit the
     page's dark mode. A library would be tens of kilobytes for this. */
  function renderChart(r) {
    if (!dom.chart) return;

    var points = r.yearly.slice();
    if (!points.length) { dom.chart.innerHTML = ''; return; }

    /* Anchor the curve at the origin so year 1 does not float. */
    var series = [{ year: 0, totalDeposited: 0, value: 0 }].concat(points);

    var W = 720, H = 210;
    var padL = 58, padR = 12, padT = 12, padB = 26;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    var maxValue = Math.max.apply(null, series.map(function (p) { return p.value; }));
    if (!isFinite(maxValue) || maxValue <= 0) maxValue = 1;

    var lastYear = series[series.length - 1].year || 1;

    function x(i) { return padL + (series.length === 1 ? 0 : (i / (series.length - 1)) * innerW); }
    function y(v) { return padT + innerH - (v / maxValue) * innerH; }

    function path(key) {
      return series.map(function (p, i) {
        return (i ? 'L' : 'M') + roundTo(x(i), 2) + ' ' + roundTo(y(p[key]), 2);
      }).join(' ');
    }

    var valueArea = path('value') +
      ' L' + roundTo(x(series.length - 1), 2) + ' ' + roundTo(y(0), 2) +
      ' L' + roundTo(x(0), 2) + ' ' + roundTo(y(0), 2) + ' Z';

    var grid = [0, 0.5, 1].map(function (frac) {
      var value = maxValue * frac;
      var yy = roundTo(y(value), 2);
      return '<line class="rd-chart__grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '" />' +
        '<text class="rd-chart__label" x="' + (padL - 7) + '" y="' + (yy + 3.5) + '" text-anchor="end">' +
        esc(formatCompact(value)) + '</text>';
    }).join('');

    /* Label at most eight year ticks so they never collide. */
    var tickStep = Math.max(1, Math.ceil(lastYear / 8));
    var xLabels = series.map(function (p, i) {
      if (p.year === 0) return '';
      if (p.year % tickStep !== 0 && i !== series.length - 1) return '';
      return '<text class="rd-chart__label" x="' + roundTo(x(i), 2) + '" y="' + (H - 8) + '" text-anchor="middle">Y' +
        p.year + '</text>';
    }).join('');

    var dots = series.map(function (p, i) {
      if (i === 0) return '';
      return '<circle class="rd-chart__dot" cx="' + roundTo(x(i), 2) + '" cy="' + roundTo(y(p.value), 2) + '" r="2.6">' +
        '<title>' + esc('Year ' + p.year + ' — deposited ' + formatINR(p.totalDeposited) +
          ', estimated value ' + formatINR(p.value)) + '</title></circle>';
    }).join('');

    dom.chart.innerHTML =
      '<svg class="rd-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' +
        esc('RD growth over ' + r.tenureLabel + '. Estimated value rises to ' + formatINR(r.maturity) +
            ' at maturity against total deposits of ' + formatINR(r.totalDeposits) +
            '. The year-wise table below lists the same figures.') + '">' +
        grid +
        '<path class="rd-chart__area--value" d="' + valueArea + '" />' +
        '<path class="rd-chart__line rd-chart__line--value" d="' + path('value') + '" />' +
        '<path class="rd-chart__line rd-chart__line--deposit" d="' + path('totalDeposited') + '" />' +
        dots + xLabels +
      '</svg>';

    if (dom.chartKey) {
      dom.chartKey.innerHTML =
        '<span><i class="rd-swatch rd-swatch--interest" aria-hidden="true"></i>Estimated value</span>' +
        '<span><i class="rd-swatch rd-swatch--deposit" aria-hidden="true"></i>Money deposited</span>';
    }

    if (dom.chartCaption) {
      var crossover = r.yearly.filter(function (row) { return row.totalInterest > 0; })[0];
      dom.chartCaption.textContent =
        'By year ' + r.yearly[r.yearly.length - 1].year + ' the deposit is estimated to hold ' +
        formatINR(r.maturity) + ', of which ' + formatINR(r.interest) + ' is interest' +
        (crossover ? '' : '') + '. The chart is a picture of the table below, so nothing is lost if it does not render.';
    }
  }

  function renderTimeline(r) {
    if (!dom.timeline) return;
    var first = r.monthly[0];
    var mid = r.monthly[Math.floor(r.monthly.length / 2)];
    var last = r.monthly[r.monthly.length - 1];
    if (!first || !last) { dom.timeline.innerHTML = ''; return; }

    var steps = [
      { when: 'Month 1', value: first.balance, note: 'First deposit of ' + formatINR(r.deposit) + ' goes in.', final: false },
      { when: 'Month ' + mid.month, value: mid.balance, note: formatINR(mid.totalDeposited) + ' deposited so far.', final: false },
      { when: 'Month ' + last.month, value: last.balance, note: 'Final deposit — the RD matures.', final: true }
    ];

    dom.timeline.innerHTML = steps.map(function (s) {
      return '<li class="rd-step' + (s.final ? ' rd-step--final' : '') + '">' +
        '<span class="rd-step__when">' + esc(s.when) + '</span>' +
        '<span class="rd-step__value">' + esc(formatINR(s.value)) + '</span>' +
        '<span class="rd-step__note">' + esc(s.note) + '</span>' +
        '</li>';
    }).join('');
  }

  function renderYearTable(r) {
    if (!dom.yearBody) return;
    var rows = r.yearly;
    var limit = state.showAllYears ? rows.length : Math.min(rows.length, YEAR_ROWS_COLLAPSED);

    dom.yearBody.innerHTML = rows.slice(0, limit).map(function (row, i) {
      var isFinal = (i === rows.length - 1);
      return '<tr' + (isFinal ? ' class="rd-table__final"' : '') + '>' +
        '<th scope="row">' + row.year + '</th>' +
        '<td>' + esc(formatINR(row.totalDeposited)) + '</td>' +
        '<td>' + esc(formatINR(row.totalInterest)) + '</td>' +
        '<td>' + esc(formatINR(row.value)) + '</td>' +
        '</tr>';
    }).join('');

    if (dom.yearCaption) {
      dom.yearCaption.textContent = 'Running totals at the end of each year. ' +
        (limit < rows.length ? 'Showing the first ' + limit + ' of ' + rows.length + ' years.' : 'All ' + rows.length + ' years shown.');
    }

    if (dom.yearToggle) {
      var hidden = rows.length - limit;
      dom.yearToggle.hidden = rows.length <= YEAR_ROWS_COLLAPSED;
      dom.yearToggle.textContent = state.showAllYears
        ? 'Show fewer years'
        : 'Show full breakdown (' + hidden + ' more ' + (hidden === 1 ? 'year' : 'years') + ')';
      dom.yearToggle.setAttribute('aria-expanded', state.showAllYears ? 'true' : 'false');
    }
  }

  /* Only build the monthly rows when the panel is actually open — 360
     rows of DOM for a schedule nobody expanded is wasted work. */
  function renderMonthTable(r) {
    if (!dom.monthBody || !dom.monthDetails) return;
    if (dom.monthToggle) {
      dom.monthToggle.textContent = 'Monthly deposit schedule (' + r.installments + ' deposits)';
    }
    if (!dom.monthDetails.open) { dom.monthBody.innerHTML = ''; return; }

    dom.monthBody.innerHTML = r.monthly.map(function (row, i) {
      var isFinal = (i === r.monthly.length - 1);
      return '<tr' + (isFinal ? ' class="rd-table__final"' : '') + '>' +
        '<th scope="row">' + row.month + '</th>' +
        '<td>' + esc(formatINR(row.deposit)) + '</td>' +
        '<td>' + esc(formatINR(row.interest, { decimals: 2 })) + '</td>' +
        '<td>' + esc(formatINR(row.totalDeposited)) + '</td>' +
        '<td>' + esc(formatINR(row.balance)) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderBreakdown(r) {
    if (!dom.breakdown) return;
    var rows = [
      ['Monthly deposit', formatINR(r.deposit)],
      ['Number of deposits', String(r.installments)],
      ['Tenure', r.tenureLabel],
      ['Annual interest rate', formatPercent(r.annualRate) + ' p.a.'],
      ['Compounding', r.frequencyLabel + ' (' + r.compoundsPerYear + ' × a year)'],
      ['Total deposits', formatINR(r.totalDeposits)],
      ['Estimated interest', formatINR(r.interest)],
      ['Estimated maturity', formatINR(r.maturity)]
    ];
    dom.breakdown.innerHTML = rows.map(function (pair, i) {
      var total = i === rows.length - 1;
      return '<div class="rd-breakdown__row' + (total ? ' rd-breakdown__row--total' : '') + '">' +
        '<dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd></div>';
    }).join('');
  }

  function renderPrintStamp(r) {
    if (!dom.printStamp) return;
    dom.printStamp.textContent = 'RD estimate — ' + formatINR(r.deposit) + ' a month for ' + r.tenureLabel +
      ' at ' + formatPercent(r.annualRate) + ' p.a., compounded ' + r.frequencyLabel.toLowerCase() +
      '. ' + r.installments + ' deposits totalling ' + formatINR(r.totalDeposits) +
      '; estimated interest ' + formatINR(r.interest) + '; estimated maturity ' + formatINR(r.maturity) + '.';
  }

  function renderTenureHint() {
    if (!dom.tenureHint) return;
    var total = (parseNumber(state.years) || 0) * 12 + (parseNumber(state.months) || 0);
    dom.tenureHint.textContent = total > 0 ? total + (total === 1 ? ' monthly deposit' : ' monthly deposits') : '';
  }

  /* The worked examples in the article are rendered from the engine,
     so the prose can never drift away from the calculator. */
  function renderExamples() {
    if (!dom.examples) return;
    dom.examples.innerHTML = EXAMPLE_DEPOSITS.map(function (amount) {
      var r = calculate({
        mode: 'standard', deposit: amount, years: EXAMPLE_MONTHS / 12, months: 0,
        annualRate: EXAMPLE_RATE, frequency: DEFAULT_FREQUENCY
      });
      if (!r.ok) return '';
      return '<article class="rd-eg">' +
        '<h3>' + esc(formatINR(amount)) + ' a month for ' + esc(formatTenure(EXAMPLE_MONTHS)) + '</h3>' +
        '<dl>' +
          '<div><dt>Total deposits</dt><dd>' + esc(formatINR(r.totalDeposits)) + '</dd></div>' +
          '<div><dt>Estimated interest</dt><dd>' + esc(formatINR(r.interest)) + '</dd></div>' +
          '<div class="is-total"><dt>Estimated maturity</dt><dd>' + esc(formatINR(r.maturity)) + '</dd></div>' +
        '</dl>' +
        '<p class="rd-eg__note">At ' + EXAMPLE_RATE + '% p.a., compounded quarterly.</p>' +
        '</article>';
    }).join('');
  }

  function renderResult(r) {
    state.result = r;
    renderHeadline(r);
    renderSplit(r);
    renderStats(r);
    renderChart(r);
    renderTimeline(r);
    renderYearTable(r);
    renderMonthTable(r);
    renderBreakdown(r);
    renderPrintStamp(r);
  }

  /* ============================================================
     13. The run loop
     ============================================================ */

  function readState() {
    if (dom.deposit) state.deposit = dom.deposit.value;
    if (dom.years) state.years = dom.years.value;
    if (dom.months) state.months = dom.months.value;
    if (dom.rate) state.annualRate = dom.rate.value;
    if (dom.frequency) state.frequency = dom.frequency.value;
    if (dom.target) state.target = dom.target.value;
  }

  function run(options) {
    options = options || {};
    readState();
    renderTenureHint();

    var r = calculate({
      mode: state.mode,
      deposit: state.deposit,
      years: state.years,
      months: state.months,
      annualRate: state.annualRate,
      frequency: state.frequency,
      target: state.target
    });

    if (!r.ok) {
      showError(r.message, r.field);
      if (options.announceError) announce(r.message);
      return null;
    }

    showError('');
    renderResult(r);
    syncPresetPressed();
    savePrefs();

    if (options.announce) {
      announce(state.mode === 'target'
        ? 'To reach ' + formatINR(r.target) + ' in ' + r.tenureLabel + ', deposit ' +
          formatINR(r.deposit) + ' a month. Estimated maturity ' + formatINR(r.maturity) + '.'
        : 'Estimated maturity ' + formatINR(r.maturity) + ' on total deposits of ' +
          formatINR(r.totalDeposits) + '. Estimated interest ' + formatINR(r.interest) + '.');
    }
    if (options.remember) pushHistory(r);

    return r;
  }

  function scheduleRun() {
    if (recalcTimer) clearTimeout(recalcTimer);
    recalcTimer = setTimeout(function () { run(); }, 160);
  }

  /* ============================================================
     14. Actions
     ============================================================ */

  function flash(btn, label) {
    if (!btn) return;
    var original = btn.getAttribute('data-rd-label') || btn.textContent;
    btn.setAttribute('data-rd-label', original);
    btn.textContent = label;
    setTimeout(function () { btn.textContent = original; }, 1600);
  }

  function copySummary() {
    var r = state.result;
    if (!r) return;
    var text = resultToText(r);

    function done() { announce('Summary copied to clipboard.'); flash(dom.copy, 'Copied'); }
    function failed() { announce('Could not copy. Select the summary and copy manually.'); }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, failed);
    } else {
      failed();
    }
  }

  function shareSummary() {
    var r = state.result;
    if (!r) return;
    /* The numbers travel in the shared text, never as query parameters
       that a referrer log could pick up. */
    if (navigator.share) {
      navigator.share({ title: 'RD Calculation — ToolAdda', text: resultToText(r) })
        .catch(function () { /* dismissed */ });
    } else {
      copySummary();
    }
  }

  function resetCalculator() {
    state.mode = 'standard';
    state.deposit = '5000';
    state.years = '5';
    state.months = '0';
    state.annualRate = '7';
    state.frequency = DEFAULT_FREQUENCY;
    state.target = '500000';
    state.showAllYears = false;
    if (dom.monthDetails) dom.monthDetails.open = false;

    syncModeButtons();
    syncInputsFromState();
    run({ announce: true });
    announce('Calculator reset to the default example.');
  }

  /* ============================================================
     15. Events
     ============================================================ */

  function bindEvents() {
    dom.modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.getAttribute('data-rd-mode') === 'target' ? 'target' : 'standard';
        syncModeButtons();
        run({ announce: true });
      });
    });

    [dom.deposit, dom.years, dom.months, dom.rate, dom.target].forEach(function (input) {
      if (!input) return;
      input.addEventListener('input', function () {
        if (input === dom.deposit && dom.depositRange) dom.depositRange.value = clampRange(dom.depositRange, input.value);
        if (input === dom.rate && dom.rateRange) dom.rateRange.value = clampRange(dom.rateRange, input.value);
        scheduleRun();
      });
    });

    if (dom.depositRange) {
      dom.depositRange.addEventListener('input', function () {
        state.deposit = dom.depositRange.value;
        if (dom.deposit) dom.deposit.value = state.deposit;
        scheduleRun();
      });
    }

    if (dom.rateRange) {
      dom.rateRange.addEventListener('input', function () {
        state.annualRate = dom.rateRange.value;
        if (dom.rate) dom.rate.value = state.annualRate;
        scheduleRun();
      });
    }

    if (dom.frequency) {
      dom.frequency.addEventListener('change', function () { run({ announce: true }); });
    }

    if (dom.calculate) {
      dom.calculate.addEventListener('click', function () {
        run({ announce: true, announceError: true, remember: true });
      });
    }

    if (dom.reset) dom.reset.addEventListener('click', resetCalculator);
    if (dom.copy) dom.copy.addEventListener('click', copySummary);
    if (dom.print) dom.print.addEventListener('click', function () { window.print(); });
    if (dom.share) dom.share.addEventListener('click', shareSummary);

    if (dom.yearToggle) {
      dom.yearToggle.addEventListener('click', function () {
        state.showAllYears = !state.showAllYears;
        if (state.result) renderYearTable(state.result);
      });
    }

    /* <details> owns its own open state, so react to it rather than
       trying to drive it from a click handler. */
    if (dom.monthDetails) {
      dom.monthDetails.addEventListener('toggle', function () {
        if (state.result) renderMonthTable(state.result);
      });
    }

    if (dom.historyToggle) {
      dom.historyToggle.addEventListener('change', function () {
        state.historyEnabled = dom.historyToggle.checked;
        if (dom.historyPanel) dom.historyPanel.hidden = !state.historyEnabled;
        savePrefs();
      });
    }

    if (dom.historyClear) dom.historyClear.addEventListener('click', clearHistory);

    /* Preset chips are delegated because renderPresets() replaces them. */
    dom.root.addEventListener('click', function (e) {
      var el = e.target.closest
        ? e.target.closest('[data-rd-set-deposit],[data-rd-set-tenure],[data-rd-set-rate],[data-rd-set-target]')
        : null;
      if (!el) return;

      if (el.hasAttribute('data-rd-set-deposit')) {
        state.deposit = el.getAttribute('data-rd-set-deposit');
      } else if (el.hasAttribute('data-rd-set-rate')) {
        state.annualRate = el.getAttribute('data-rd-set-rate');
      } else if (el.hasAttribute('data-rd-set-target')) {
        state.target = el.getAttribute('data-rd-set-target');
      } else if (el.hasAttribute('data-rd-set-tenure')) {
        var total = parseInt(el.getAttribute('data-rd-set-tenure'), 10) || 12;
        state.years = String(Math.floor(total / 12));
        state.months = String(total % 12);
      }
      syncInputsFromState();
      run({ announce: true });
    });
  }

  /* ============================================================
     16. Init
     ============================================================ */

  function init() {
    if (!cacheDom()) return;
    renderExamples();

    loadPrefs();
    renderPresets();
    syncModeButtons();
    syncInputsFromState();

    if (dom.historyToggle) {
      dom.historyToggle.checked = state.historyEnabled;
      if (dom.historyPanel) dom.historyPanel.hidden = !state.historyEnabled;
    }
    renderHistory();

    bindEvents();
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
