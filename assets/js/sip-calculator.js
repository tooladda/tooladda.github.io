/* ============================================================
   ToolAdda — SIP Calculator

   The previous version had the right core formula and a working
   zero-return branch that could never execute: the guard read

       if (!monthlyInvestment || !annualReturn || !years || ...)

   and `!annualReturn` is true when the return is 0, so entering 0%
   zeroed every field instead of reaching the straight-line branch
   sitting a few lines below. It also called the projection a
   "Maturity Amount" and the tool a "reliable SIP estimator", with no
   disclaimer anywhere that mutual fund returns are market-linked.

   This rewrite keeps the formula and fixes everything around it.

   CONVENTION — read this before changing any arithmetic.
   Contributions are treated as BEGINNING-of-period (an annuity due),
   which is how Indian SIPs actually work: the mandate debits on the
   SIP date and that money is invested for the whole period. So

       FV = P x [((1+r)^n - 1) / r] x (1+r)

   with r the periodic rate and n the number of instalments. The
   engine runs this as a period-by-period simulation rather than the
   closed form, because step-up SIPs have no clean closed form and
   the simulation also produces the year-by-year table. The test
   suite asserts the simulation reproduces the closed form exactly
   when there is no step-up.

   Nothing here is investment advice, and no projection is a
   prediction. Every figure is an estimate from assumptions the user
   supplied.

   Layout:
     1.  Number helpers
     2.  Validation
     3.  The simulation — one engine for every mode
     4.  Closed forms (verification + reverse solving)
     5.  Target SIP
     6.  Inflation and real return
     7.  Lump sum comparison
     8.  calculate() — the single authoritative result
     9.  Formatting
     10. Copy text
     11. Engine export
     12. UI state + DOM
     13. Rendering
     14. Actions
     15. Events + init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. Number helpers
     ============================================================ */

  var MAX_AMOUNT = 1e11;      /* ₹10,000 crore */
  var MAX_YEARS = 60;
  var MIN_RETURN = -50;       /* negative returns are arithmetically valid */
  var MAX_RETURN = 50;
  var MAX_STEPUP = 100;
  var MAX_INFLATION = 30;

  /* Strips float noise without touching genuinely distinct values. */
  function clean(n) {
    if (!isFinite(n)) return n;
    var r = Math.round(n * 1e6) / 1e6;
    return Object.is(r, -0) ? 0 : r;
  }

  function roundTo(n, dp) {
    if (!isFinite(n)) return n;
    var f = Math.pow(10, dp);
    var r = Math.round((n + Number.EPSILON * Math.abs(n)) * f) / f;
    return Object.is(r, -0) ? 0 : r;
  }

  function decimalToPaise(text) {
    var m = /^(\d*)(?:\.(\d*))?$/.exec(String(text));
    if (!m) return null;
    var whole = m[1] || '0';
    var frac = m[2] || '';
    if (whole === '' && frac === '') return null;
    var paise = parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    var next = frac.charAt(2);
    if (next && parseInt(next, 10) >= 5) paise += 1;
    return paise;
  }

  /* ============================================================
     2. Validation
     ============================================================ */

  function invalid(field, message) {
    return { ok: false, field: field, message: message };
  }

  function parseAmount(raw, field, label, options) {
    var opts = options || {};
    if (raw === null || raw === undefined) return invalid(field, 'Enter ' + label + '.');
    var text = String(raw).replace(/[\s,₹]/g, '');
    if (!text) return invalid(field, 'Enter ' + label + '.');
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid(field, 'Enter ' + label + ' using digits only.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid(field, 'Enter ' + label + ' using digits only.');
    if (value < 0) return invalid(field, cap(label) + ' cannot be negative.');
    if (!opts.allowZero && value === 0) {
      return invalid(field, 'Enter ' + label + ' greater than zero.');
    }
    if (value > MAX_AMOUNT) {
      return invalid(field, cap(label) + ' is too large. Enter a value up to ₹10,000 crore.');
    }
    var paise = decimalToPaise(text);
    return { ok: true, value: paise === null ? value : paise / 100 };
  }

  function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

  function parseRate(raw, field, label, min, max) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return invalid(field, 'Enter ' + label + '.');
    }
    var text = String(raw).replace(/[\s%]/g, '');
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid(field, 'Enter ' + label + ' as a number, for example 12.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid(field, 'Enter ' + label + ' as a number, for example 12.');
    if (value < min || value > max) {
      return invalid(field, cap(label) + ' must be between ' + min + '% and ' + max + '%.');
    }
    return { ok: true, value: value };
  }

  function parseYears(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return invalid('years', 'Enter an investment period.');
    }
    var text = String(raw).replace(/\s/g, '');
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid('years', 'Enter an investment period as a number of years.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid('years', 'Enter an investment period as a number of years.');
    if (value <= 0) return invalid('years', 'Enter an investment period greater than zero.');
    if (value > MAX_YEARS) {
      return invalid('years', 'Enter an investment period up to ' + MAX_YEARS + ' years.');
    }
    return { ok: true, value: value };
  }

  /* ============================================================
     3. The simulation

     One loop serves the regular SIP, the step-up SIP and the
     year-by-year table, so those three can never disagree.

     Each period: the instalment goes in first, then the whole
     balance grows for one period. That ordering is what makes it an
     annuity due.
     ============================================================ */

  function simulate(input) {
    var frequency = input.frequency === 'yearly' ? 'yearly' : 'monthly';
    var perYear = frequency === 'yearly' ? 1 : 12;
    var periods = Math.round(input.years * perYear);
    var rate = input.annualReturn / 100 / perYear;
    var stepUp = input.stepUpPercent || 0;

    var balance = 0;
    var invested = 0;
    var contribution = input.amount;
    var yearly = [];

    for (var p = 1; p <= periods; p++) {
      /* The step-up lands at the start of each new year, not on the
         first instalment. */
      if (p > 1 && (p - 1) % perYear === 0 && stepUp !== 0) {
        contribution = contribution * (1 + stepUp / 100);
      }

      invested += contribution;
      balance = (balance + contribution) * (1 + rate);

      if (p % perYear === 0 || p === periods) {
        yearly.push({
          year: Math.ceil(p / perYear),
          periodicAmount: clean(contribution),
          invested: clean(invested),
          value: clean(balance),
          returns: clean(balance - invested)
        });
      }
    }

    return {
      periods: periods,
      periodRate: rate,
      invested: clean(invested),
      futureValue: clean(balance),
      returns: clean(balance - invested),
      finalContribution: clean(contribution),
      yearly: yearly
    };
  }

  /* ============================================================
     4. Closed forms

     Kept because the reverse solve needs them and because the test
     suite checks the simulation against them.
     ============================================================ */

  /* FV of an annuity due. At a zero rate this degenerates to 0/0, so
     the straight-line case is handled explicitly rather than left to
     produce NaN — which is the bug the old page could not reach. */
  function futureValueClosed(amount, rate, periods) {
    if (periods <= 0) return 0;
    if (rate === 0) return amount * periods;
    return amount * (((Math.pow(1 + rate, periods) - 1) / rate) * (1 + rate));
  }

  /* The instalment needed to reach a target, inverted from the same
     formula. */
  function amountForTargetClosed(target, rate, periods) {
    if (periods <= 0) return 0;
    if (rate === 0) return target / periods;
    var factor = ((Math.pow(1 + rate, periods) - 1) / rate) * (1 + rate);
    if (factor === 0) return 0;
    return target / factor;
  }

  /* ============================================================
     5. Target SIP

     Without a step-up the inversion is closed-form. With one there
     is no clean inverse, so the starting instalment is found by
     bisection on the simulation — which guarantees the answer is
     consistent with the projection it will be shown alongside.
     ============================================================ */

  function requiredAmount(input) {
    var perYear = input.frequency === 'yearly' ? 1 : 12;
    var periods = Math.round(input.years * perYear);
    var rate = input.annualReturn / 100 / perYear;
    var stepUp = input.stepUpPercent || 0;

    if (periods <= 0) return 0;

    if (!stepUp) {
      return Math.max(0, amountForTargetClosed(input.target, rate, periods));
    }

    /* Bisection. The future value rises monotonically with the
       starting instalment, so this converges quickly and cannot get
       stuck. */
    var low = 0;
    var high = Math.max(1, input.target / periods);
    var guard = 0;
    while (simulate({
      amount: high, years: input.years, annualReturn: input.annualReturn,
      stepUpPercent: stepUp, frequency: input.frequency
    }).futureValue < input.target && guard < 100) {
      high *= 2;
      guard++;
    }

    for (var i = 0; i < 200; i++) {
      var mid = (low + high) / 2;
      var fv = simulate({
        amount: mid, years: input.years, annualReturn: input.annualReturn,
        stepUpPercent: stepUp, frequency: input.frequency
      }).futureValue;
      if (fv < input.target) low = mid; else high = mid;
      if (high - low < 0.0001) break;
    }
    return Math.max(0, high);
  }

  /* ============================================================
     6. Inflation and real return

     Purchasing power, not a second projection. Dividing by
     (1+i)^years converts a nominal future figure into today's money.
     ============================================================ */

  function inflationAdjust(futureValue, inflationRate, years) {
    if (!inflationRate) {
      return { realValue: clean(futureValue), realReturnPercent: null, erosion: 0 };
    }
    var divisor = Math.pow(1 + inflationRate / 100, years);
    var real = divisor === 0 ? 0 : futureValue / divisor;
    return {
      realValue: clean(real),
      erosion: clean(futureValue - real)
    };
  }

  /* The Fisher relation, not a subtraction. At 12% nominal and 6%
     inflation the real return is 5.66%, not 6%. */
  function realReturn(nominalPercent, inflationPercent) {
    var denom = 1 + inflationPercent / 100;
    if (denom === 0) return null;
    return clean((((1 + nominalPercent / 100) / denom) - 1) * 100);
  }

  /* ============================================================
     7. Lump sum comparison

     Compares the same total outlay deployed two ways. Under a
     constant positive return a lump sum invested on day one will
     always come out ahead, simply because the money is invested for
     longer — so this is a demonstration of timing, not a claim that
     one approach beats the other in practice.
     ============================================================ */

  function lumpSumComparison(totalInvested, annualReturn, years, sipFutureValue) {
    var lumpFuture = totalInvested * Math.pow(1 + annualReturn / 100, years);
    return {
      amount: clean(totalInvested),
      lumpSumFutureValue: clean(lumpFuture),
      sipFutureValue: clean(sipFutureValue),
      differencePaise: clean(lumpFuture - sipFutureValue)
    };
  }

  /* ============================================================
     8. calculate() — the single authoritative result

     Every card, chart, table and copy string renders from this.
     ============================================================ */

  var MODES = {
    sip: { id: 'sip', label: 'Regular SIP', question: 'How much could my SIP grow to?' },
    stepup: { id: 'stepup', label: 'Step-Up SIP', question: 'What if I increase my SIP every year?' },
    target: { id: 'target', label: 'Target SIP', question: 'How much do I need to invest each month?' },
    lumpsum: { id: 'lumpsum', label: 'SIP vs Lump Sum', question: 'How does spreading it out compare?' }
  };
  var MODE_ORDER = ['sip', 'stepup', 'target', 'lumpsum'];

  function calculate(input) {
    var mode = MODES[input.mode] ? input.mode : 'sip';
    var frequency = input.frequency === 'yearly' ? 'yearly' : 'monthly';

    var years = parseYears(input.years);
    if (!years.ok) return years;

    var annualReturn = parseRate(input.annualReturn, 'annualReturn',
      'an expected annual return', MIN_RETURN, MAX_RETURN);
    if (!annualReturn.ok) return annualReturn;

    var stepUpPercent = 0;
    if (mode === 'stepup' || input.stepUpPercent) {
      var su = parseRate(input.stepUpPercent === undefined || input.stepUpPercent === ''
        ? 0 : input.stepUpPercent, 'stepUpPercent', 'an annual step-up', 0, MAX_STEPUP);
      if (!su.ok) return su;
      stepUpPercent = su.value;
    }

    var inflationPercent = 0;
    if (input.inflationPercent !== undefined && input.inflationPercent !== '' && input.inflationPercent !== null) {
      var inf = parseRate(input.inflationPercent, 'inflationPercent',
        'an expected inflation rate', 0, MAX_INFLATION);
      if (!inf.ok) return inf;
      inflationPercent = inf.value;
    }

    var perYear = frequency === 'yearly' ? 1 : 12;
    var periods = Math.round(years.value * perYear);
    if (periods < 1) {
      return invalid('years', 'That period is shorter than a single instalment. Increase the investment period.');
    }

    var amount;
    var required = null;

    if (mode === 'target') {
      var target = parseAmount(input.target, 'target', 'a target amount');
      if (!target.ok) return target;
      amount = requiredAmount({
        target: target.value, years: years.value, annualReturn: annualReturn.value,
        stepUpPercent: stepUpPercent, frequency: frequency
      });
      required = { target: clean(target.value), amount: clean(amount) };
    } else {
      var amt = parseAmount(input.amount, 'amount',
        frequency === 'yearly' ? 'a yearly investment' : 'a monthly investment');
      if (!amt.ok) return amt;
      amount = amt.value;
    }

    var run = simulate({
      amount: amount, years: years.value, annualReturn: annualReturn.value,
      stepUpPercent: stepUpPercent, frequency: frequency
    });

    /* Step-up mode always shows what the same starting instalment
       would have done without the increases, so the comparison is
       like-for-like. */
    var comparison = null;
    if (mode === 'stepup') {
      var flat = simulate({
        amount: amount, years: years.value, annualReturn: annualReturn.value,
        stepUpPercent: 0, frequency: frequency
      });
      comparison = {
        type: 'stepup',
        regular: {
          invested: flat.invested, futureValue: flat.futureValue,
          returns: flat.returns, periodicAmount: clean(amount)
        },
        stepUp: {
          invested: run.invested, futureValue: run.futureValue,
          returns: run.returns, periodicAmount: clean(amount),
          finalContribution: run.finalContribution
        },
        extraInvested: clean(run.invested - flat.invested),
        extraCorpus: clean(run.futureValue - flat.futureValue)
      };
    }

    if (mode === 'lumpsum') {
      comparison = Object.assign(
        { type: 'lumpsum' },
        lumpSumComparison(run.invested, annualReturn.value, years.value, run.futureValue)
      );
    }

    var inflation = null;
    if (inflationPercent > 0) {
      var adj = inflationAdjust(run.futureValue, inflationPercent, years.value);
      inflation = {
        rate: inflationPercent,
        realValue: adj.realValue,
        erosion: adj.erosion,
        realReturnPercent: realReturn(annualReturn.value, inflationPercent)
      };
    }

    var wealthGainPercent = run.invested > 0
      ? clean((run.returns / run.invested) * 100)
      : 0;

    return {
      ok: true,
      mode: mode,
      modeLabel: MODES[mode].label,
      frequency: frequency,
      periodLabel: frequency === 'yearly' ? 'year' : 'month',
      amount: clean(amount),
      years: years.value,
      periods: periods,
      annualReturn: annualReturn.value,
      periodRate: clean(run.periodRate * 100),
      stepUpPercent: stepUpPercent,

      invested: run.invested,
      futureValue: run.futureValue,
      returns: run.returns,
      wealthGainPercent: wealthGainPercent,
      returnsShare: run.futureValue > 0 ? clean((run.returns / run.futureValue) * 100) : 0,
      finalContribution: run.finalContribution,

      yearly: run.yearly,
      inflation: inflation,
      comparison: comparison,
      required: required
    };
  }

  /* ============================================================
     9. Formatting
     ============================================================ */

  var fmtCache = {};

  function formatINR(value, options) {
    var opts = options || {};
    var n = Number(value);
    if (!isFinite(n)) return '₹0';
    var dp = opts.decimals === undefined ? 0 : opts.decimals;
    var sign = n < 0 ? '-' : '';
    var mag = Math.abs(n);
    var key = 'i' + dp;
    try {
      if (!fmtCache[key]) {
        fmtCache[key] = new Intl.NumberFormat('en-IN', {
          minimumFractionDigits: dp, maximumFractionDigits: dp
        });
      }
      return sign + '₹' + fmtCache[key].format(mag);
    } catch (e) {
      return sign + '₹' + mag.toFixed(dp);
    }
  }

  /* ₹23,23,391 is precise; "₹23.2 lakh" is graspable. Long-horizon
     projections need both. */
  function formatCompact(value) {
    var n = Number(value);
    if (!isFinite(n)) return '₹0';
    var sign = n < 0 ? '-' : '';
    var mag = Math.abs(n);
    if (mag >= 10000000) return sign + '₹' + (Math.round(mag / 100000) / 100) + ' crore';
    if (mag >= 100000) return sign + '₹' + (Math.round(mag / 1000) / 100) + ' lakh';
    if (mag >= 1000) return sign + '₹' + (Math.round(mag / 100) / 10) + 'K';
    return formatINR(mag);
  }

  function formatPercent(value, dp) {
    var n = Number(value);
    if (!isFinite(n)) return '0%';
    return roundTo(n, dp === undefined ? 2 : dp) + '%';
  }

  function formatYears(years) {
    var y = Number(years);
    if (!isFinite(y) || y <= 0) return '0 years';
    var whole = Math.floor(y);
    var months = Math.round((y - whole) * 12);
    if (months === 12) { whole += 1; months = 0; }
    var parts = [];
    if (whole) parts.push(whole + (whole === 1 ? ' year' : ' years'));
    if (months) parts.push(months + (months === 1 ? ' month' : ' months'));
    return parts.length ? parts.join(' ') : '0 years';
  }

  /* ============================================================
     10. Copy text
     ============================================================ */

  function resultToText(r) {
    if (!r.ok) return r.message;
    var per = r.frequency === 'yearly' ? 'Yearly' : 'Monthly';
    var lines = ['SIP Calculation — ' + r.modeLabel, ''];

    if (r.mode === 'target' && r.required) {
      lines.push('Target amount:        ' + formatINR(r.required.target));
      lines.push('Required ' + per.toLowerCase() + ' SIP:  ' + formatINR(r.required.amount));
    } else {
      lines.push(per + ' investment:   ' + formatINR(r.amount));
    }
    lines.push('Investment period:    ' + formatYears(r.years) + ' (' + r.periods + ' instalments)');
    lines.push('Expected return:      ' + formatPercent(r.annualReturn) + ' per year');
    if (r.stepUpPercent) {
      lines.push('Annual step-up:       ' + formatPercent(r.stepUpPercent));
      lines.push('Final instalment:     ' + formatINR(r.finalContribution));
    }
    lines.push('');
    lines.push('Total invested:       ' + formatINR(r.invested));
    lines.push('Estimated returns:    ' + formatINR(r.returns));
    lines.push('Estimated value:      ' + formatINR(r.futureValue));
    lines.push('Wealth gain:          ' + formatPercent(r.wealthGainPercent) + ' of the amount invested');

    if (r.inflation) {
      lines.push('');
      lines.push('At ' + formatPercent(r.inflation.rate) + ' inflation');
      lines.push("In today's money:     " + formatINR(r.inflation.realValue));
      lines.push('Estimated real return: ' + formatPercent(r.inflation.realReturnPercent) + ' per year');
    }

    if (r.comparison && r.comparison.type === 'stepup') {
      lines.push('');
      lines.push('Without the step-up:  ' + formatINR(r.comparison.regular.futureValue));
      lines.push('With the step-up:     ' + formatINR(r.comparison.stepUp.futureValue));
      lines.push('Estimated difference: ' + formatINR(r.comparison.extraCorpus));
      lines.push('  (from ' + formatINR(r.comparison.extraInvested) + ' more invested)');
    }

    if (r.comparison && r.comparison.type === 'lumpsum') {
      lines.push('');
      lines.push('Same total as a lump sum on day one: ' + formatINR(r.comparison.lumpSumFutureValue));
      lines.push('Spread as a SIP:                     ' + formatINR(r.comparison.sipFutureValue));
      lines.push('  (a lump sum is invested for longer, so under a constant');
      lines.push('   assumed return it will always project higher)');
    }

    lines.push('');
    lines.push('Estimate only. Mutual fund returns are market-linked and not guaranteed.');
    lines.push('Expense ratios, exit loads and taxes are not included.');
    lines.push('Calculated with tooladda.online/calculators/sip-calculator.html');
    return lines.join('\n');
  }

  /* ============================================================
     11. Engine export
     ============================================================ */

  var engine = {
    MODES: MODES,
    MODE_ORDER: MODE_ORDER,
    MAX_AMOUNT: MAX_AMOUNT,
    MAX_YEARS: MAX_YEARS,
    MIN_RETURN: MIN_RETURN,
    MAX_RETURN: MAX_RETURN,
    clean: clean,
    roundTo: roundTo,
    parseAmount: parseAmount,
    parseRate: parseRate,
    parseYears: parseYears,
    simulate: simulate,
    futureValueClosed: futureValueClosed,
    amountForTargetClosed: amountForTargetClosed,
    requiredAmount: requiredAmount,
    inflationAdjust: inflationAdjust,
    realReturn: realReturn,
    lumpSumComparison: lumpSumComparison,
    calculate: calculate,
    formatINR: formatINR,
    formatCompact: formatCompact,
    formatPercent: formatPercent,
    formatYears: formatYears,
    resultToText: resultToText
  };

  globalScope.ToolAddaSip = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     12. UI state + DOM
     ============================================================ */

  var PREFS_KEY = 'tooladda-sip-prefs';
  var HISTORY_KEY = 'tooladda-sip-history';

  var PRESET_AMOUNTS = [1000, 5000, 10000, 20000, 50000];
  var PRESET_YEARS = [5, 10, 15, 20, 25];
  var PRESET_RETURNS = [8, 10, 12, 15];
  var PRESET_STEPUPS = [5, 10, 15, 20];
  var PRESET_TARGETS = [2500000, 5000000, 10000000];

  var state = {
    mode: 'sip',
    frequency: 'monthly',
    amount: '10000',
    years: '10',
    annualReturn: '12',
    stepUpPercent: '10',
    inflationPercent: '',
    target: '10000000',
    showAllYears: false,
    historyEnabled: false,
    result: null
  };

  var dom = {};
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cacheDom() {
    dom.root = q('[data-sip-app]');
    if (!dom.root) return false;

    dom.modes = qa('[data-sip-mode]', dom.root);
    dom.freq = qa('[data-sip-freq]', dom.root);

    dom.amountRow = q('[data-sip-amount-row]', dom.root);
    dom.amountLabel = q('[data-sip-amount-label]', dom.root);
    dom.amount = q('[data-sip-amount]', dom.root);
    dom.amountRange = q('[data-sip-amount-range]', dom.root);
    dom.amountPresets = q('[data-sip-amount-presets]', dom.root);

    dom.targetRow = q('[data-sip-target-row]', dom.root);
    dom.target = q('[data-sip-target]', dom.root);
    dom.targetPresets = q('[data-sip-target-presets]', dom.root);

    dom.years = q('[data-sip-years]', dom.root);
    dom.yearsRange = q('[data-sip-years-range]', dom.root);
    dom.yearsPresets = q('[data-sip-years-presets]', dom.root);
    dom.months = q('[data-sip-months]', dom.root);

    dom.return = q('[data-sip-return]', dom.root);
    dom.returnRange = q('[data-sip-return-range]', dom.root);
    dom.returnPresets = q('[data-sip-return-presets]', dom.root);

    dom.stepUpRow = q('[data-sip-stepup-row]', dom.root);
    dom.stepUp = q('[data-sip-stepup]', dom.root);
    dom.stepUpPresets = q('[data-sip-stepup-presets]', dom.root);

    dom.inflation = q('[data-sip-inflation]', dom.root);

    dom.error = q('[data-sip-error]', dom.root);
    dom.results = q('[data-sip-results]', dom.root);
    dom.calculate = q('[data-sip-calculate]', dom.root);
    dom.reset = q('[data-sip-reset]', dom.root);

    dom.headlineLabel = q('[data-sip-headline-label]', dom.root);
    dom.headline = q('[data-sip-headline]', dom.root);
    dom.headlineCompact = q('[data-sip-headline-compact]', dom.root);
    dom.assumption = q('[data-sip-assumption]', dom.root);
    dom.split = q('[data-sip-split]', dom.root);
    dom.stats = q('[data-sip-stats]', dom.root);
    dom.chart = q('[data-sip-chart]', dom.root);
    dom.chartSummary = q('[data-sip-chart-summary]', dom.root);
    dom.comparison = q('[data-sip-comparison]', dom.root);
    dom.inflationOut = q('[data-sip-inflation-out]', dom.root);
    dom.breakdown = q('[data-sip-breakdown]', dom.root);
    dom.tableBody = q('[data-sip-table-body]', dom.root);
    dom.tableCaption = q('[data-sip-table-caption]', dom.root);
    dom.tableToggle = q('[data-sip-table-toggle]', dom.root);
    dom.status = q('[data-sip-status]', dom.root);

    dom.copy = q('[data-sip-copy]', dom.root);
    dom.share = q('[data-sip-share]', dom.root);
    dom.print = q('[data-sip-print]', dom.root);
    dom.printStamp = q('[data-sip-print-stamp]', dom.root);

    dom.historyToggle = q('[data-sip-history-toggle]', dom.root);
    dom.historyPanel = q('[data-sip-history-panel]', dom.root);
    dom.historyList = q('[data-sip-history-list]', dom.root);
    dom.historyEmpty = q('[data-sip-history-empty]', dom.root);
    dom.historyClear = q('[data-sip-history-clear]', dom.root);

    return true;
  }

  /* ============================================================
     13. Rendering
     ============================================================ */

  function announce(message) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.status.textContent = message; }, 500);
  }

  function syncModeButtons() {
    dom.modes.forEach(function (b) {
      var on = b.getAttribute('data-sip-mode') === state.mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.targetRow.hidden = state.mode !== 'target';
    dom.amountRow.hidden = state.mode === 'target';
    dom.stepUpRow.hidden = state.mode !== 'stepup';
  }

  function syncFreqButtons() {
    dom.freq.forEach(function (b) {
      var on = b.getAttribute('data-sip-freq') === state.frequency;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.amountLabel.textContent = state.frequency === 'yearly'
      ? 'Yearly investment' : 'Monthly investment';
  }

  function renderPresets() {
    dom.amountPresets.innerHTML = PRESET_AMOUNTS.map(function (v) {
      return '<button type="button" class="sip-chip" data-sip-preset-amount="' + v + '">' +
        formatCompact(v) + '</button>';
    }).join('');
    dom.yearsPresets.innerHTML = PRESET_YEARS.map(function (v) {
      return '<button type="button" class="sip-chip" data-sip-preset-years="' + v + '">' + v + ' yrs</button>';
    }).join('');
    dom.returnPresets.innerHTML = PRESET_RETURNS.map(function (v) {
      return '<button type="button" class="sip-chip" data-sip-preset-return="' + v + '">' + v + '%</button>';
    }).join('');
    dom.stepUpPresets.innerHTML = PRESET_STEPUPS.map(function (v) {
      return '<button type="button" class="sip-chip" data-sip-preset-stepup="' + v + '">' + v + '%</button>';
    }).join('');
    dom.targetPresets.innerHTML = PRESET_TARGETS.map(function (v) {
      return '<button type="button" class="sip-chip" data-sip-preset-target="' + v + '">' +
        formatCompact(v) + '</button>';
    }).join('');
  }

  function showError(message, field) {
    state.result = null;
    dom.error.hidden = false;
    dom.error.textContent = message;
    dom.results.hidden = true;
    qa('[data-sip-field]', dom.root).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    if (field) {
      var el = q('[data-sip-field="' + field + '"]', dom.root);
      if (el) el.setAttribute('aria-invalid', 'true');
    }
    setActionsEnabled(false);
    announce(message);
  }

  function setActionsEnabled(on) {
    [dom.copy, dom.share, dom.print].forEach(function (b) { if (b) b.disabled = !on; });
  }

  /* A stacked proportion bar plus the numbers. The split never
     depends on distinguishing two colours. */
  function renderSplit(r) {
    var investedPct = r.futureValue > 0 ? (r.invested / r.futureValue) * 100 : 100;
    var returnsPct = Math.max(0, 100 - investedPct);
    dom.split.innerHTML =
      '<div class="sip-splitbar" role="img" aria-label="' +
      esc('Of the estimated ' + formatINR(r.futureValue) + ', ' + formatINR(r.invested) +
        ' is what you invested and ' + formatINR(r.returns) + ' is estimated returns') + '">' +
      '<span class="sip-splitbar__seg sip-splitbar__seg--invested" style="width:' +
      Math.max(0, Math.min(100, investedPct)).toFixed(2) + '%"></span>' +
      '<span class="sip-splitbar__seg sip-splitbar__seg--returns" style="width:' +
      returnsPct.toFixed(2) + '%"></span></div>' +
      '<dl class="sip-legend">' +
      '<div class="sip-legend__item sip-legend__item--invested"><dt>You invest</dt><dd>' +
        formatINR(r.invested) + '<span>' + roundTo(investedPct, 1) + '%</span></dd></div>' +
      '<div class="sip-legend__item sip-legend__item--returns"><dt>Estimated returns</dt><dd>' +
        formatINR(r.returns) + '<span>' + roundTo(returnsPct, 1) + '%</span></dd></div>' +
      '</dl>';
  }

  /* Hand-rolled SVG. A single line chart does not justify a charting
     library, and the accompanying table is the real accessible
     version of the same data. */
  function renderChart(r) {
    var points = r.yearly;
    if (!points.length) { dom.chart.innerHTML = ''; dom.chartSummary.textContent = ''; return; }

    var W = 660, H = 220, PAD_L = 8, PAD_R = 8, PAD_T = 10, PAD_B = 22;
    var maxValue = 0;
    points.forEach(function (p) { if (p.value > maxValue) maxValue = p.value; });
    if (maxValue <= 0) maxValue = 1;

    var innerW = W - PAD_L - PAD_R;
    var innerH = H - PAD_T - PAD_B;

    function x(i) {
      return PAD_L + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    }
    function y(v) { return PAD_T + innerH - (v / maxValue) * innerH; }

    function pathFor(key) {
      return points.map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(p[key]).toFixed(1);
      }).join(' ');
    }

    var valueLine = pathFor('value');
    var investedLine = pathFor('invested');
    var valueArea = valueLine + ' L' + x(points.length - 1).toFixed(1) + ' ' + (PAD_T + innerH) +
      ' L' + x(0).toFixed(1) + ' ' + (PAD_T + innerH) + ' Z';
    var investedArea = investedLine + ' L' + x(points.length - 1).toFixed(1) + ' ' + (PAD_T + innerH) +
      ' L' + x(0).toFixed(1) + ' ' + (PAD_T + innerH) + ' Z';

    /* Year labels only where they fit. */
    var step = Math.max(1, Math.ceil(points.length / 8));
    var labels = points.map(function (p, i) {
      if (i !== 0 && i !== points.length - 1 && i % step !== 0) return '';
      return '<text class="sip-chart__label" x="' + x(i).toFixed(1) + '" y="' + (H - 6) +
        '" text-anchor="' + (i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle') +
        '">' + p.year + '</text>';
    }).join('');

    var last = points[points.length - 1];
    dom.chart.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sip-chart" role="img" aria-label="' +
      esc('Projected growth over ' + points.length + ' years. By year ' + last.year +
        ', ' + formatINR(last.invested) + ' invested is projected to be worth ' +
        formatINR(last.value) + '. The full figures are in the year-by-year table below.') + '">' +
      '<path class="sip-chart__area sip-chart__area--value" d="' + valueArea + '" />' +
      '<path class="sip-chart__area sip-chart__area--invested" d="' + investedArea + '" />' +
      '<path class="sip-chart__line sip-chart__line--value" d="' + valueLine + '" fill="none" />' +
      '<path class="sip-chart__line sip-chart__line--invested" d="' + investedLine + '" fill="none" />' +
      labels + '</svg>' +
      '<div class="sip-chart__key"><span><b class="sip-swatch sip-swatch--returns"></b>Estimated value</span>' +
      '<span><b class="sip-swatch sip-swatch--invested"></b>Amount invested</span></div>';

    /* The moment returns overtake contributions is the single most
       useful thing this chart has to say. */
    var crossover = null;
    for (var i = 0; i < points.length; i++) {
      if (points[i].returns >= points[i].invested) { crossover = points[i].year; break; }
    }
    dom.chartSummary.textContent = crossover
      ? 'On these assumptions the estimated returns overtake the amount invested in year ' +
        crossover + ' — that crossover is what compounding over a long horizon looks like.'
      : 'Over ' + formatYears(r.years) + ' the estimated returns do not yet exceed the amount invested. ' +
        'A longer horizon or a higher assumed return moves that crossover earlier.';
  }

  function statCell(label, value, variant, hint) {
    return '<div class="sip-stat' + (variant ? ' sip-stat--' + variant : '') + '">' +
      '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>' +
      (hint ? '<p class="sip-stat__hint">' + esc(hint) + '</p>' : '') + '</div>';
  }

  function renderStats(r) {
    var html = '';
    html += statCell('Total invested', formatINR(r.invested), 'invested');
    html += statCell('Estimated returns', formatINR(r.returns), 'returns');
    html += statCell('Wealth gain', formatPercent(r.wealthGainPercent), null,
      'Estimated returns as a share of what you invested');
    html += statCell('Instalments', String(r.periods), null,
      formatYears(r.years) + ' at one per ' + r.periodLabel);
    html += statCell('Expected return', formatPercent(r.annualReturn) + ' a year', null,
      'Assumed, not guaranteed');
    if (r.stepUpPercent) {
      html += statCell('Final instalment', formatINR(r.finalContribution), null,
        'After ' + formatPercent(r.stepUpPercent) + ' annual step-ups');
    }
    dom.stats.innerHTML = html;
  }

  function renderComparison(r) {
    var c = r.comparison;
    if (!c) { dom.comparison.innerHTML = ''; dom.comparison.hidden = true; return; }
    dom.comparison.hidden = false;

    if (c.type === 'stepup') {
      dom.comparison.innerHTML =
        '<span class="sip-label">Regular SIP vs step-up SIP</span>' +
        '<div class="sip-tablewrap"><table class="sip-table">' +
        '<caption>Both start at ' + formatINR(c.regular.periodicAmount) + ' a ' + r.periodLabel +
        ' over ' + formatYears(r.years) + ' at ' + formatPercent(r.annualReturn) + '</caption>' +
        '<thead><tr><th scope="col">Line</th><th scope="col">Regular</th><th scope="col">Step-up ' +
        formatPercent(r.stepUpPercent) + '</th></tr></thead><tbody>' +
        '<tr><th scope="row">Starting instalment</th><td>' + formatINR(c.regular.periodicAmount) +
          '</td><td>' + formatINR(c.stepUp.periodicAmount) + '</td></tr>' +
        '<tr><th scope="row">Final instalment</th><td>' + formatINR(c.regular.periodicAmount) +
          '</td><td>' + formatINR(c.stepUp.finalContribution) + '</td></tr>' +
        '<tr><th scope="row">Total invested</th><td>' + formatINR(c.regular.invested) +
          '</td><td>' + formatINR(c.stepUp.invested) + '</td></tr>' +
        '<tr><th scope="row">Estimated returns</th><td>' + formatINR(c.regular.returns) +
          '</td><td>' + formatINR(c.stepUp.returns) + '</td></tr>' +
        '<tr class="sip-table__final"><th scope="row">Estimated value</th><td>' +
          formatINR(c.regular.futureValue) + '</td><td>' + formatINR(c.stepUp.futureValue) +
          '</td></tr></tbody></table></div>' +
        '<p class="sip-note">Stepping up adds <strong>' + formatINR(c.extraInvested) +
        '</strong> of your own money over the period and, on these assumptions, projects a corpus <strong>' +
        formatINR(c.extraCorpus) + '</strong> larger. Whether that is worth doing depends on your income ' +
        'and other commitments — the calculator only does the arithmetic.</p>';
      return;
    }

    if (c.type === 'lumpsum') {
      var sipWins = c.differencePaise < 0;
      dom.comparison.innerHTML =
        '<span class="sip-label">SIP vs the same total as a lump sum</span>' +
        '<div class="sip-tablewrap"><table class="sip-table">' +
        '<caption>' + formatINR(c.amount) + ' deployed two ways over ' + formatYears(r.years) +
        ' at ' + formatPercent(r.annualReturn) + '</caption>' +
        '<thead><tr><th scope="col">Approach</th><th scope="col">Estimated value</th></tr></thead><tbody>' +
        '<tr><th scope="row">Spread as a SIP</th><td>' + formatINR(c.sipFutureValue) + '</td></tr>' +
        '<tr><th scope="row">Invested as a lump sum on day one</th><td>' +
          formatINR(c.lumpSumFutureValue) + '</td></tr>' +
        '<tr class="sip-table__final"><th scope="row">Difference</th><td>' +
          formatINR(Math.abs(c.differencePaise)) + (sipWins ? ' in favour of the SIP' : ' in favour of the lump sum') +
          '</td></tr></tbody></table></div>' +
        '<p class="sip-note">This compares the same total outlay under one constant assumed return. ' +
        'A lump sum is invested for the whole period, so under that assumption it will always project higher — ' +
        'that is arithmetic, not evidence that it is the better approach. Real markets do not deliver a ' +
        'constant return, and a SIP spreads entry across many different prices. The comparison also assumes ' +
        'you have the full amount available on day one.</p>';
    }
  }

  function renderInflation(r) {
    if (!r.inflation) {
      dom.inflationOut.hidden = true;
      dom.inflationOut.innerHTML = '';
      return;
    }
    var i = r.inflation;
    dom.inflationOut.hidden = false;
    dom.inflationOut.innerHTML =
      '<dl class="sip-stats">' +
      statCell("Value in today's money", formatINR(i.realValue), 'real',
        'What ' + formatINR(r.futureValue) + ' may buy after ' + formatPercent(i.rate) + ' inflation') +
      statCell('Purchasing power lost', formatINR(i.erosion), null,
        'The gap between the nominal and inflation-adjusted figure') +
      statCell('Estimated real return', formatPercent(i.realReturnPercent) + ' a year', null,
        'Return above inflation, not simply ' + formatPercent(r.annualReturn) + ' minus ' + formatPercent(i.rate)) +
      '</dl>';
  }

  function renderTable(r) {
    var rows = r.yearly;
    var visible = state.showAllYears ? rows : rows.slice(0, 10);

    dom.tableCaption.textContent =
      'Year-by-year projection at ' + formatPercent(r.annualReturn) + ' a year' +
      (r.stepUpPercent ? ' with ' + formatPercent(r.stepUpPercent) + ' annual step-ups' : '') +
      ' — estimates, not guarantees.';

    dom.tableBody.innerHTML = visible.map(function (row) {
      return '<tr><th scope="row">Year ' + row.year + '</th>' +
        '<td>' + formatINR(row.periodicAmount) + '</td>' +
        '<td>' + formatINR(row.invested) + '</td>' +
        '<td>' + formatINR(row.returns) + '</td>' +
        '<td>' + formatINR(row.value) + '</td></tr>';
    }).join('');

    if (rows.length > 10) {
      dom.tableToggle.hidden = false;
      dom.tableToggle.textContent = state.showAllYears
        ? 'Show first 10 years'
        : 'Show all ' + rows.length + ' years';
      dom.tableToggle.setAttribute('aria-expanded', state.showAllYears ? 'true' : 'false');
    } else {
      dom.tableToggle.hidden = true;
    }
  }

  function renderResult(r) {
    dom.error.hidden = true;
    dom.results.hidden = false;
    qa('[data-sip-field]', dom.root).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    setActionsEnabled(true);

    if (r.mode === 'target' && r.required) {
      dom.headlineLabel.textContent = 'Estimated ' + r.periodLabel + 'ly investment required';
      dom.headline.textContent = formatINR(r.required.amount);
      dom.headlineCompact.textContent = 'to reach ' + formatCompact(r.required.target) +
        ' in ' + formatYears(r.years);
    } else {
      dom.headlineLabel.textContent = 'Estimated future value';
      dom.headline.textContent = formatINR(r.futureValue);
      dom.headlineCompact.textContent = 'about ' + formatCompact(r.futureValue);
    }

    var amountLabel = r.mode === 'target'
      ? formatINR(r.required.amount)
      : formatINR(r.amount);
    dom.assumption.textContent =
      amountLabel + ' a ' + r.periodLabel + ' for ' + formatYears(r.years) +
      ' at an assumed ' + formatPercent(r.annualReturn) + ' a year' +
      (r.stepUpPercent ? ', stepped up ' + formatPercent(r.stepUpPercent) + ' each year' : '') +
      '. Market-linked and not guaranteed.';

    renderSplit(r);
    renderStats(r);
    renderChart(r);
    renderComparison(r);
    renderInflation(r);
    renderTable(r);

    var spoken = r.mode === 'target'
      ? 'Estimated ' + formatINR(r.required.amount) + ' a ' + r.periodLabel +
        ' needed to reach ' + formatINR(r.required.target) + ' in ' + formatYears(r.years) + '.'
      : 'Estimated future value ' + formatINR(r.futureValue) + '. ' +
        formatINR(r.invested) + ' invested and ' + formatINR(r.returns) + ' estimated returns.';
    announce(spoken);
  }

  /* ============================================================
     14. Actions
     ============================================================ */

  function run() {
    var result = calculate({
      mode: state.mode,
      frequency: state.frequency,
      amount: state.amount,
      target: state.target,
      years: state.years,
      annualReturn: state.annualReturn,
      stepUpPercent: state.mode === 'stepup' ? state.stepUpPercent : 0,
      inflationPercent: state.inflationPercent
    });

    if (!result.ok) {
      showError(result.message, result.field);
      return;
    }
    state.result = result;
    renderResult(result);
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function pushHistory() {
    if (!state.historyEnabled || !state.result) return;
    var r = state.result;
    var entry = {
      mode: r.mode, frequency: r.frequency,
      amount: r.mode === 'target' ? r.required.target : r.amount,
      years: r.years, annualReturn: r.annualReturn, stepUpPercent: r.stepUpPercent,
      text: (r.mode === 'target'
        ? formatINR(r.required.amount) + ' a ' + r.periodLabel + ' for ' + formatCompact(r.required.target)
        : formatINR(r.amount) + '/' + r.periodLabel + ' · ' + formatYears(r.years) + ' · ' +
          formatPercent(r.annualReturn)) +
        ' → ' + formatCompact(r.mode === 'target' ? r.required.target : r.futureValue)
    };
    var list = loadHistory();
    if (list.length && list[0].text === entry.text) return;
    list.unshift(entry);
    list = list.slice(0, 10);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* quota */ }
    renderHistory();
  }

  function renderHistory() {
    if (!dom.historyList) return;
    var list = state.historyEnabled ? loadHistory() : [];
    dom.historyEmpty.hidden = list.length > 0;
    dom.historyList.innerHTML = list.map(function (e, i) {
      return '<li><button type="button" class="sip-history__item" data-sip-history="' + i + '">' +
        esc(e.text) + '</button></li>';
    }).join('');
  }

  function applyHistory(index) {
    var e = loadHistory()[index];
    if (!e || !MODES[e.mode]) return;
    state.mode = e.mode;
    state.frequency = e.frequency === 'yearly' ? 'yearly' : 'monthly';
    state.years = String(e.years);
    state.annualReturn = String(e.annualReturn);
    state.stepUpPercent = String(e.stepUpPercent || 10);
    if (e.mode === 'target') state.target = String(e.amount);
    else state.amount = String(e.amount);
    syncInputsFromState();
    syncModeButtons();
    syncFreqButtons();
    run();
  }

  function flash(button, text) {
    if (!button) return;
    var original = button.getAttribute('data-sip-label') || button.textContent;
    button.setAttribute('data-sip-label', original);
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1600);
  }

  function copyResult() {
    if (!state.result) return;
    var text = resultToText(state.result);
    if (!navigator.clipboard || !navigator.clipboard.writeText) { flash(dom.copy, 'Unavailable'); return; }
    navigator.clipboard.writeText(text).then(function () {
      flash(dom.copy, 'Copied ✓');
      dom.status.textContent = 'Projection copied to the clipboard.';
    }, function () { flash(dom.copy, 'Copy failed'); });
  }

  function shareResult() {
    if (!state.result) return;
    var text = resultToText(state.result);
    if (navigator.share) {
      navigator.share({ title: 'SIP Projection', text: text }).catch(function () { /* dismissed */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flash(dom.share, 'Copied ✓');
        dom.status.textContent = 'Sharing is not available in this browser, so the projection was copied instead.';
      });
      return;
    }
    flash(dom.share, 'Unavailable');
  }

  function printResult() {
    if (dom.printStamp) {
      try {
        dom.printStamp.textContent = 'Generated ' + new Date().toLocaleString('en-IN', {
          dateStyle: 'medium', timeStyle: 'short'
        });
      } catch (e) {
        dom.printStamp.textContent = 'Generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
      }
    }
    window.print();
  }

  /* ============================================================
     15. Preferences, events, init

     Only interface preferences persist. Amounts and targets are not
     stored unless the user switches history on.
     ============================================================ */

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        mode: state.mode, frequency: state.frequency, historyEnabled: state.historyEnabled
      }));
    } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.mode && MODES[s.mode]) state.mode = s.mode;
      if (s.frequency === 'monthly' || s.frequency === 'yearly') state.frequency = s.frequency;
      if (typeof s.historyEnabled === 'boolean') state.historyEnabled = s.historyEnabled;
    } catch (e) { /* corrupt prefs fall back to defaults */ }
  }

  function syncInputsFromState() {
    dom.amount.value = state.amount;
    dom.target.value = state.target;
    dom.years.value = state.years;
    dom.return.value = state.annualReturn;
    dom.stepUp.value = state.stepUpPercent;
    dom.inflation.value = state.inflationPercent;
    clampRange(dom.amountRange, state.amount);
    clampRange(dom.yearsRange, state.years);
    clampRange(dom.returnRange, state.annualReturn);
    updateMonthsLabel();
  }

  function clampRange(rangeEl, value) {
    var v = parseFloat(value);
    if (!isFinite(v)) return;
    var min = parseFloat(rangeEl.min);
    var max = parseFloat(rangeEl.max);
    rangeEl.value = Math.max(min, Math.min(max, v));
  }

  function updateMonthsLabel() {
    var y = parseFloat(state.years);
    if (!isFinite(y) || y <= 0) { dom.months.textContent = ''; return; }
    var per = state.frequency === 'yearly' ? 1 : 12;
    var n = Math.round(y * per);
    dom.months.textContent = n + (state.frequency === 'yearly'
      ? (n === 1 ? ' yearly instalment' : ' yearly instalments')
      : (n === 1 ? ' monthly instalment' : ' monthly instalments'));
  }

  /* Slider and text field are two views of one value. */
  function pair(rangeEl, inputEl, key) {
    rangeEl.addEventListener('input', function () {
      state[key] = rangeEl.value;
      inputEl.value = rangeEl.value;
      if (key === 'years') updateMonthsLabel();
      run();
    });
    inputEl.addEventListener('input', function () {
      state[key] = inputEl.value;
      clampRange(rangeEl, inputEl.value);
      if (key === 'years') updateMonthsLabel();
      run();
    });
  }

  function bindEvents() {
    dom.modes.forEach(function (b) {
      b.addEventListener('click', function () {
        state.mode = b.getAttribute('data-sip-mode');
        state.showAllYears = false;
        syncModeButtons();
        savePrefs();
        run();
      });
    });

    dom.freq.forEach(function (b) {
      b.addEventListener('click', function () {
        var next = b.getAttribute('data-sip-freq');
        if (next === state.frequency) return;
        /* Convert the instalment so the yearly outlay stays the same
           rather than silently changing what the user meant. */
        var amt = parseFloat(state.amount);
        if (isFinite(amt)) {
          state.amount = String(Math.round(next === 'yearly' ? amt * 12 : amt / 12));
        }
        state.frequency = next;
        syncFreqButtons();
        syncInputsFromState();
        savePrefs();
        run();
      });
    });

    pair(dom.amountRange, dom.amount, 'amount');
    pair(dom.yearsRange, dom.years, 'years');
    pair(dom.returnRange, dom.return, 'annualReturn');

    [[dom.target, 'target'], [dom.stepUp, 'stepUpPercent'], [dom.inflation, 'inflationPercent']]
      .forEach(function (p) {
        p[0].addEventListener('input', function () { state[p[1]] = p[0].value; run(); });
      });

    dom.root.addEventListener('click', function (e) {
      var map = [
        ['data-sip-preset-amount', 'amount', dom.amount, dom.amountRange],
        ['data-sip-preset-years', 'years', dom.years, dom.yearsRange],
        ['data-sip-preset-return', 'annualReturn', dom.return, dom.returnRange],
        ['data-sip-preset-stepup', 'stepUpPercent', dom.stepUp, null],
        ['data-sip-preset-target', 'target', dom.target, null]
      ];
      for (var i = 0; i < map.length; i++) {
        var btn = e.target.closest('[' + map[i][0] + ']');
        if (!btn) continue;
        var value = btn.getAttribute(map[i][0]);
        state[map[i][1]] = value;
        map[i][2].value = value;
        if (map[i][3]) clampRange(map[i][3], value);
        if (map[i][1] === 'years') updateMonthsLabel();
        run();
        return;
      }
    });

    dom.calculate.addEventListener('click', function () { run(); pushHistory(); });

    dom.tableToggle.addEventListener('click', function () {
      state.showAllYears = !state.showAllYears;
      if (state.result) renderTable(state.result);
    });

    dom.reset.addEventListener('click', function () {
      state.mode = 'sip';
      state.frequency = 'monthly';
      state.amount = '10000';
      state.years = '10';
      state.annualReturn = '12';
      state.stepUpPercent = '10';
      state.inflationPercent = '';
      state.target = '10000000';
      state.showAllYears = false;
      syncModeButtons();
      syncFreqButtons();
      syncInputsFromState();
      savePrefs();
      run();
      dom.status.textContent = 'Calculator reset to defaults.';
    });

    dom.copy.addEventListener('click', function () { copyResult(); pushHistory(); });
    dom.share.addEventListener('click', shareResult);
    dom.print.addEventListener('click', printResult);

    dom.historyToggle.addEventListener('change', function () {
      state.historyEnabled = dom.historyToggle.checked;
      dom.historyPanel.hidden = !state.historyEnabled;
      if (!state.historyEnabled) {
        try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
      }
      renderHistory();
      savePrefs();
    });

    dom.historyClear.addEventListener('click', function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
      renderHistory();
      dom.status.textContent = 'History cleared.';
    });

    dom.historyList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sip-history]');
      if (btn) applyHistory(Number(btn.getAttribute('data-sip-history')));
    });
  }

  function init() {
    if (!cacheDom()) return;

    loadPrefs();
    renderPresets();
    syncModeButtons();
    syncFreqButtons();
    syncInputsFromState();

    dom.historyToggle.checked = state.historyEnabled;
    dom.historyPanel.hidden = !state.historyEnabled;
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
