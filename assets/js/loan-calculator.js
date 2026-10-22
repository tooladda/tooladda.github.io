/* ============================================================
   ToolAdda — Loan Calculator

   The previous version had a structurally broken amortization loop:
   it always ran for the full scheduled term, so an extra monthly
   payment drove the balance to zero early and then kept "paying"
   into a zero balance for the remaining months, inflating the total
   paid and never reporting a shorter payoff. The whole extra-payment
   feature therefore reported the opposite of the truth.

   This rewrite fixes that by making the schedule the source of
   truth: every headline figure is summed out of the actual month-by-
   month run rather than derived from a closed-form shortcut. That
   also makes the numbers reconcile by construction —

       total paid = principal + total interest

   holds exactly, in integer paise, for every input including
   prepayments, zero interest and rounding-adjusted final payments.

   No third-party libraries. Charts are hand-rolled SVG.

   Layout:
     1.  Money primitives (paise integers)
     2.  Validation
     3.  EMI formula
     4.  Amortization engine
     5.  Yearly aggregation
     6.  Prepayment comparison
     7.  Affordability
     8.  Formatting
     9.  CSV + copy text
     10. Engine export
     11. UI state + DOM
     12. Chart rendering (SVG)
     13. Result rendering
     14. Schedule rendering
     15. Actions
     16. Events + init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. Money primitives

     Balances and payments are integer paise. Only the interest rate
     stays a float, because it is a ratio rather than an amount.
     ============================================================ */

  var MAX_PRINCIPAL = 1e11;   /* ₹10,000 crore */
  var MAX_RATE = 100;         /* annual percent */
  var MAX_MONTHS = 720;       /* 60 years */
  var HARD_ITERATION_CAP = 1500;

  function toPaise(rupees) {
    return Math.round(rupees * 100);
  }

  function toRupees(paise) {
    return paise / 100;
  }

  /* Reading paise out of the decimal string avoids the classic
     parseFloat('1.005') * 100 === 100.49999999999999 problem. */
  function decimalToPaise(text) {
    var match = /^(\d*)(?:\.(\d*))?$/.exec(String(text));
    if (!match) return null;
    var whole = match[1] || '0';
    var frac = match[2] || '';
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

  function parseMoney(raw, field, label, options) {
    var opts = options || {};
    if (raw === null || raw === undefined) return invalid(field, 'Enter ' + label + '.');
    var text = String(raw).replace(/[\s,₹]/g, '');
    if (!text) {
      if (opts.allowEmpty) return { ok: true, paise: 0 };
      return invalid(field, 'Enter ' + label + '.');
    }
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid(field, 'Enter ' + label + ' using digits only.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid(field, 'Enter ' + label + ' using digits only.');
    if (value < 0) return invalid(field, capitalise(label) + ' cannot be negative.');
    if (value > MAX_PRINCIPAL) {
      return invalid(field, capitalise(label) + ' is too large. Enter a value up to ₹10,000 crore.');
    }
    if (!opts.allowZero && value === 0) {
      return invalid(field, 'Enter ' + label + ' greater than zero.');
    }
    var paise = decimalToPaise(text);
    return { ok: true, paise: paise === null ? toPaise(value) : paise };
  }

  function capitalise(s) {
    return String(s).charAt(0).toUpperCase() + String(s).slice(1);
  }

  function parseRate(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return invalid('rate', 'Enter an interest rate.');
    }
    var text = String(raw).replace(/[\s%]/g, '');
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid('rate', 'Enter a valid interest rate, for example 8.5.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid('rate', 'Enter a valid interest rate, for example 8.5.');
    if (value < 0) return invalid('rate', 'Interest rate cannot be negative.');
    if (value > MAX_RATE) return invalid('rate', 'Enter an interest rate between 0% and 100%.');
    return { ok: true, value: value };
  }

  /* Tenure is accepted in years or months. Fractional years are
     converted and rounded to whole months, because a loan cannot
     have a fractional instalment. */
  function parseTenure(raw, unit) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return invalid('tenure', 'Enter a loan tenure.');
    }
    var text = String(raw).replace(/\s/g, '');
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid('tenure', 'Enter a valid loan tenure.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid('tenure', 'Enter a valid loan tenure.');
    if (value <= 0) return invalid('tenure', 'Enter a loan tenure greater than zero.');

    var months = unit === 'months' ? Math.round(value) : Math.round(value * 12);
    if (months < 1) return invalid('tenure', 'Enter a loan tenure of at least one month.');
    if (months > MAX_MONTHS) {
      return invalid('tenure', 'Enter a loan tenure up to ' + (MAX_MONTHS / 12) + ' years (' + MAX_MONTHS + ' months).');
    }
    return { ok: true, months: months };
  }

  /* ============================================================
     3. EMI formula

         EMI = P x r x (1+r)^n / ((1+r)^n - 1)

     with r the monthly rate and n the number of instalments. At a
     zero rate the formula degenerates (0/0), so the straight-line
     case is handled separately rather than left to produce NaN.
     ============================================================ */

  function monthlyRate(annualRate) {
    return annualRate / 12 / 100;
  }

  function emiPaise(principalPaise, annualRate, months) {
    if (months <= 0) return 0;
    var r = monthlyRate(annualRate);
    if (r === 0) return Math.round(principalPaise / months);
    var factor = Math.pow(1 + r, months);
    return Math.round(principalPaise * r * factor / (factor - 1));
  }

  /* The inverse: what principal does a given instalment support? */
  function principalForEmi(emiPaiseValue, annualRate, months) {
    if (months <= 0 || emiPaiseValue <= 0) return 0;
    var r = monthlyRate(annualRate);
    if (r === 0) return Math.round(emiPaiseValue * months);
    var factor = Math.pow(1 + r, months);
    return Math.round(emiPaiseValue * (factor - 1) / (r * factor));
  }

  /* ============================================================
     4. Amortization engine

     Runs the loan month by month. The schedule is authoritative:
     totals are accumulated from it, never computed separately, so
     they cannot disagree with the rows shown to the user.

     Two rules keep the arithmetic exact:

       - interest each month is rounded to whole paise before the
         principal portion is derived from it, so every row is a
         real payable amount rather than a fraction of a paisa;
       - the final instalment is set to whatever settles the balance,
         which is what lenders actually do and which absorbs all the
         accumulated rounding in one visible place.
     ============================================================ */

  function amortize(options) {
    var principalPaise = options.principalPaise;
    var annualRate = options.annualRate;
    var months = options.months;
    var extraMonthlyPaise = options.extraMonthlyPaise || 0;
    var lumpSumPaise = options.lumpSumPaise || 0;
    var lumpSumMonth = options.lumpSumMonth || 0;
    var prepayMode = options.prepayMode === 'emi' ? 'emi' : 'tenure';

    var r = monthlyRate(annualRate);
    var emi = emiPaise(principalPaise, annualRate, months);

    var balance = principalPaise;
    var schedule = [];
    var totalInterest = 0;
    var totalPaid = 0;
    var totalExtra = 0;
    var month = 0;
    var scheduledMonths = months;
    var didNotAmortize = false;

    while (balance > 0 && month < HARD_ITERATION_CAP) {
      month += 1;

      var interest = Math.round(balance * r);
      var payment = emi + extraMonthlyPaise;
      var extraThisMonth = extraMonthlyPaise;
      var lumpThisMonth = 0;

      /* A one-time prepayment lands on top of that month's instalment. */
      if (lumpSumPaise > 0 && month === lumpSumMonth) {
        lumpThisMonth = lumpSumPaise;
        payment += lumpSumPaise;
      }

      var principalPortion = payment - interest;

      /* If the instalment cannot even cover the interest the balance
         would grow forever. Report it rather than spinning. */
      if (principalPortion <= 0 && balance > 0) {
        didNotAmortize = true;
        break;
      }

      /* Settle whenever the payment would overshoot, or on the final
         scheduled month. This is the one place rounding lands.

         The scheduled-month clause has to apply even when there are
         prepayments: a prepayment that shortens the loan exits
         through the overshoot branch long before this, so the only
         time this fires is when the loan really has reached its last
         instalment and a few paise of accumulated rounding remain. */
      if (principalPortion >= balance || month >= scheduledMonths) {
        principalPortion = balance;
        payment = principalPortion + interest;
        if (lumpThisMonth > payment) lumpThisMonth = payment;
        extraThisMonth = Math.max(0, Math.min(extraThisMonth, payment - interest));
        balance = 0;
      } else {
        balance -= principalPortion;
      }

      totalInterest += interest;
      totalPaid += payment;
      totalExtra += extraThisMonth + lumpThisMonth;

      schedule.push({
        month: month,
        payment: payment,
        principal: principalPortion,
        interest: interest,
        extra: extraThisMonth + lumpThisMonth,
        balance: balance
      });

      /* After a lump sum in "reduce EMI" mode, re-amortize the
         remaining balance over the months that were left. */
      if (lumpThisMonth > 0 && prepayMode === 'emi' && balance > 0) {
        var remaining = scheduledMonths - month;
        if (remaining > 0) emi = emiPaise(balance, annualRate, remaining);
      }
    }

    return {
      ok: !didNotAmortize,
      didNotAmortize: didNotAmortize,
      emiPaise: emiPaise(principalPaise, annualRate, months),
      finalEmiPaise: schedule.length ? schedule[schedule.length - 1].payment : 0,
      months: schedule.length,
      scheduledMonths: scheduledMonths,
      principalPaise: principalPaise,
      totalInterestPaise: totalInterest,
      totalPaidPaise: totalPaid,
      totalExtraPaise: totalExtra,
      schedule: schedule
    };
  }

  /* ============================================================
     5. Yearly aggregation

     360 monthly rows is not something anyone reads. The yearly roll-
     up is the default view and is summed from the same schedule.
     ============================================================ */

  function toYearly(schedule) {
    var years = [];
    var current = null;
    for (var i = 0; i < schedule.length; i++) {
      var row = schedule[i];
      var yearIndex = Math.floor((row.month - 1) / 12);
      if (!current || current.year !== yearIndex + 1) {
        current = {
          year: yearIndex + 1,
          principal: 0, interest: 0, payment: 0, extra: 0,
          balance: row.balance, fromMonth: row.month, toMonth: row.month
        };
        years.push(current);
      }
      current.principal += row.principal;
      current.interest += row.interest;
      current.payment += row.payment;
      current.extra += row.extra;
      current.balance = row.balance;
      current.toMonth = row.month;
    }
    return years;
  }

  /* ============================================================
     6. Prepayment comparison
     ============================================================ */

  function comparePrepayment(input) {
    var base = amortize({
      principalPaise: input.principalPaise,
      annualRate: input.annualRate,
      months: input.months
    });
    var withPrepay = amortize(input);

    return {
      base: base,
      withPrepay: withPrepay,
      interestSavedPaise: base.totalInterestPaise - withPrepay.totalInterestPaise,
      monthsSaved: base.months - withPrepay.months,
      totalSavedPaise: base.totalPaidPaise - withPrepay.totalPaidPaise
    };
  }

  /* ============================================================
     7. Affordability

     An arithmetic estimate, not an approval criterion. The ratio is
     supplied by the user rather than asserted by the tool.
     ============================================================ */

  function affordability(input) {
    var incomePaise = input.incomePaise || 0;
    var obligationsPaise = input.obligationsPaise || 0;
    var ratio = input.ratio;
    var annualRate = input.annualRate;
    var months = input.months;

    var capacity = Math.round(incomePaise * ratio / 100) - obligationsPaise;
    if (capacity <= 0) {
      return {
        ok: true, affordableEmiPaise: 0, affordablePrincipalPaise: 0,
        note: 'Existing obligations already exceed the share of income you selected.'
      };
    }
    return {
      ok: true,
      affordableEmiPaise: capacity,
      affordablePrincipalPaise: principalForEmi(capacity, annualRate, months),
      note: ''
    };
  }

  /* ============================================================
     8. Formatting
     ============================================================ */

  var groupFmt = null;
  var decimalFmt = null;

  function formatINR(value, options) {
    var opts = options || {};
    var n = Number(value);
    if (!isFinite(n)) return '₹0';

    var hasPaise = Math.round(Math.abs(n) * 100) % 100 !== 0;
    var showDecimals = opts.forceDecimals || (hasPaise && !opts.round);
    var sign = n < 0 ? '-' : '';
    var mag = Math.abs(n);

    try {
      if (showDecimals) {
        if (!decimalFmt) {
          decimalFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return sign + '₹' + decimalFmt.format(mag);
      }
      if (!groupFmt) groupFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
      return sign + '₹' + groupFmt.format(Math.round(mag));
    } catch (e) {
      return sign + '₹' + (showDecimals ? mag.toFixed(2) : String(Math.round(mag)));
    }
  }

  function formatPaise(paise, options) {
    return formatINR(toRupees(paise), options);
  }

  function formatRate(rate) {
    var n = Number(rate);
    if (!isFinite(n)) return '0%';
    return (Math.round(n * 10000) / 10000) + '%';
  }

  /* "62 months" is hard to picture; "5 years 2 months" is not. */
  function formatMonths(months) {
    var n = Math.max(0, Math.round(Number(months) || 0));
    var y = Math.floor(n / 12);
    var m = n % 12;
    if (n === 0) return '0 months';
    if (y === 0) return m + (m === 1 ? ' month' : ' months');
    if (m === 0) return y + (y === 1 ? ' year' : ' years');
    return y + (y === 1 ? ' year ' : ' years ') + m + (m === 1 ? ' month' : ' months');
  }

  function percentOf(part, whole) {
    if (!whole) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  /* ============================================================
     9. CSV + copy text

     The old CSV was built by scraping formatted currency out of the
     DOM, so every "₹5,00,000.00" injected commas into the row and
     broke the column alignment. This emits raw numbers and quotes
     every field.
     ============================================================ */

  function csvCell(value) {
    var s = String(value === null || value === undefined ? '' : value);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function scheduleToCsv(result, meta) {
    var lines = [];
    lines.push(['Month', 'Payment', 'Principal', 'Interest', 'Extra', 'Balance'].map(csvCell).join(','));
    for (var i = 0; i < result.schedule.length; i++) {
      var row = result.schedule[i];
      lines.push([
        row.month,
        toRupees(row.payment).toFixed(2),
        toRupees(row.principal).toFixed(2),
        toRupees(row.interest).toFixed(2),
        toRupees(row.extra).toFixed(2),
        toRupees(row.balance).toFixed(2)
      ].map(csvCell).join(','));
    }
    lines.push('');
    lines.push([csvCell('Loan amount'), csvCell(toRupees(result.principalPaise).toFixed(2))].join(','));
    if (meta) {
      lines.push([csvCell('Interest rate (% p.a.)'), csvCell(meta.annualRate)].join(','));
      lines.push([csvCell('Tenure (months)'), csvCell(result.scheduledMonths)].join(','));
    }
    lines.push([csvCell('Total interest'), csvCell(toRupees(result.totalInterestPaise).toFixed(2))].join(','));
    lines.push([csvCell('Total paid'), csvCell(toRupees(result.totalPaidPaise).toFixed(2))].join(','));
    return lines.join('\r\n');
  }

  function resultToText(ctx) {
    var r = ctx.result;
    /* Rounded to the rupee so the pasted summary matches the screen. */
    var m = { round: true };
    var lines = [
      'Loan Calculation',
      '',
      'Loan amount:     ' + formatPaise(r.principalPaise, m),
      'Interest rate:   ' + formatRate(ctx.annualRate) + ' per year',
      'Tenure:          ' + formatMonths(r.scheduledMonths) + ' (' + r.scheduledMonths + ' payments)',
      'Monthly EMI:     ' + formatPaise(r.emiPaise, m),
      'Total interest:  ' + formatPaise(r.totalInterestPaise, m),
      'Total payment:   ' + formatPaise(r.totalPaidPaise, m)
    ];
    if (ctx.feePaise) {
      lines.push('Processing fee:  ' + formatPaise(ctx.feePaise, m));
      lines.push('Total cost:      ' + formatPaise(r.totalPaidPaise + ctx.feePaise, m));
    }
    if (ctx.comparison && (ctx.comparison.interestSavedPaise > 0 || ctx.comparison.monthsSaved > 0)) {
      lines.push('');
      lines.push('With prepayment');
      lines.push('Interest saved:  ' + formatPaise(ctx.comparison.interestSavedPaise, m));
      lines.push('Tenure reduced:  ' + formatMonths(ctx.comparison.monthsSaved));
      lines.push('Payoff in:       ' + formatMonths(r.months));
    }
    lines.push('');
    lines.push('Estimate only — actual lender terms, fees and charges may differ.');
    lines.push('Calculated with tooladda.online/calculators/loan-calculator.html');
    return lines.join('\n');
  }

  /* ============================================================
     10. Engine export
     ============================================================ */

  var engine = {
    MAX_PRINCIPAL: MAX_PRINCIPAL,
    MAX_RATE: MAX_RATE,
    MAX_MONTHS: MAX_MONTHS,
    toPaise: toPaise,
    toRupees: toRupees,
    decimalToPaise: decimalToPaise,
    parseMoney: parseMoney,
    parseRate: parseRate,
    parseTenure: parseTenure,
    monthlyRate: monthlyRate,
    emiPaise: emiPaise,
    principalForEmi: principalForEmi,
    amortize: amortize,
    toYearly: toYearly,
    comparePrepayment: comparePrepayment,
    affordability: affordability,
    formatINR: formatINR,
    formatPaise: formatPaise,
    formatRate: formatRate,
    formatMonths: formatMonths,
    percentOf: percentOf,
    scheduleToCsv: scheduleToCsv,
    resultToText: resultToText
  };

  globalScope.ToolAddaLoan = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     11. UI state + DOM
     ============================================================ */

  var PREFS_KEY = 'tooladda-loan-prefs';

  /* Illustrative starting points, not market rates. */
  var PRESETS = {
    personal: { label: 'Personal loan', amount: 500000, rate: 12, tenure: 5, unit: 'years' },
    home: { label: 'Home loan', amount: 5000000, rate: 8.5, tenure: 20, unit: 'years' },
    car: { label: 'Car loan', amount: 1000000, rate: 9, tenure: 5, unit: 'years' },
    education: { label: 'Education loan', amount: 1500000, rate: 10, tenure: 7, unit: 'years' },
    business: { label: 'Business loan', amount: 2500000, rate: 14, tenure: 4, unit: 'years' }
  };

  var state = {
    amount: '1000000',
    rate: '8.5',
    tenure: '5',
    unit: 'years',
    fee: '0',
    extraMonthly: '0',
    lumpSum: '0',
    lumpSumMonth: '12',
    prepayMode: 'tenure',
    scheduleView: 'yearly',
    expandedYear: 0,
    income: '',
    obligations: '0',
    ratio: '40',
    result: null,
    comparison: null,
    annualRate: 8.5,
    feePaise: 0
  };

  var dom = {};
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function cacheDom() {
    dom.root = q('[data-loan-app]');
    if (!dom.root) return false;

    dom.amount = q('[data-loan-amount]', dom.root);
    dom.amountRange = q('[data-loan-amount-range]', dom.root);
    dom.rate = q('[data-loan-rate]', dom.root);
    dom.rateRange = q('[data-loan-rate-range]', dom.root);
    dom.tenure = q('[data-loan-tenure]', dom.root);
    dom.tenureRange = q('[data-loan-tenure-range]', dom.root);
    dom.unit = qa('[data-loan-unit]', dom.root);
    dom.tenureUnitLabel = q('[data-loan-tenure-unit-label]', dom.root);

    dom.presets = q('[data-loan-presets]', dom.root);
    dom.quickAmounts = q('[data-loan-quick-amounts]', dom.root);
    dom.quickRates = q('[data-loan-quick-rates]', dom.root);
    dom.quickTenures = q('[data-loan-quick-tenures]', dom.root);

    dom.errors = q('[data-loan-errors]', dom.root);
    dom.calculate = q('[data-loan-calculate]', dom.root);
    dom.reset = q('[data-loan-reset]', dom.root);

    dom.emi = q('[data-loan-emi]', dom.root);
    dom.emiNote = q('[data-loan-emi-note]', dom.root);
    dom.stats = q('[data-loan-stats]', dom.root);
    dom.split = q('[data-loan-split]', dom.root);
    dom.donut = q('[data-loan-donut]', dom.root);
    dom.balanceChart = q('[data-loan-balance-chart]', dom.root);
    dom.balanceSummary = q('[data-loan-balance-summary]', dom.root);
    dom.yearChart = q('[data-loan-year-chart]', dom.root);
    dom.yearSummary = q('[data-loan-year-summary]', dom.root);
    dom.status = q('[data-loan-status]', dom.root);

    dom.fee = q('[data-loan-fee]', dom.root);
    dom.extraMonthly = q('[data-loan-extra]', dom.root);
    dom.lumpSum = q('[data-loan-lump]', dom.root);
    dom.lumpMonth = q('[data-loan-lump-month]', dom.root);
    dom.prepayModes = qa('[data-loan-prepay-mode]', dom.root);
    dom.prepayResult = q('[data-loan-prepay-result]', dom.root);

    dom.scheduleViews = qa('[data-loan-schedule-view]', dom.root);
    dom.scheduleWrap = q('[data-loan-schedule-wrap]', dom.root);
    dom.scheduleBody = q('[data-loan-schedule-body]', dom.root);
    dom.scheduleHead = q('[data-loan-schedule-head]', dom.root);
    dom.scheduleCaption = q('[data-loan-schedule-caption]', dom.root);

    dom.copy = q('[data-loan-copy]', dom.root);
    dom.share = q('[data-loan-share]', dom.root);
    dom.print = q('[data-loan-print]', dom.root);
    dom.csv = q('[data-loan-csv]', dom.root);
    dom.printStamp = q('[data-loan-print-stamp]', dom.root);

    dom.income = q('[data-loan-income]', dom.root);
    dom.obligations = q('[data-loan-obligations]', dom.root);
    dom.ratio = q('[data-loan-ratio]', dom.root);
    dom.ratioOut = q('[data-loan-ratio-out]', dom.root);
    dom.affordResult = q('[data-loan-afford-result]', dom.root);
    dom.emiRatio = q('[data-loan-emi-ratio]', dom.root);

    return true;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ============================================================
     12. Chart rendering — plain SVG, no library

     Every chart is paired with a real text or table equivalent, so
     nothing is conveyed by colour or shape alone.
     ============================================================ */

  function renderDonut(principalPaise, interestPaise, feePaise) {
    var total = principalPaise + interestPaise + feePaise;
    if (!total) { dom.donut.innerHTML = ''; return; }

    var R = 54;
    var C = 2 * Math.PI * R;
    var segments = [
      { value: principalPaise, cls: 'principal', label: 'Principal' },
      { value: interestPaise, cls: 'interest', label: 'Interest' }
    ];
    if (feePaise > 0) segments.push({ value: feePaise, cls: 'fee', label: 'Fees' });

    var offset = 0;
    var circles = segments.map(function (seg) {
      var len = C * (seg.value / total);
      var el = '<circle class="loan-donut__seg loan-donut__seg--' + seg.cls + '" cx="70" cy="70" r="' + R +
        '" fill="none" stroke-width="20" stroke-dasharray="' + len.toFixed(3) + ' ' + (C - len).toFixed(3) +
        '" stroke-dashoffset="' + (-offset).toFixed(3) + '" />';
      offset += len;
      return el;
    }).join('');

    dom.donut.innerHTML =
      '<svg viewBox="0 0 140 140" class="loan-donut" role="img" aria-label="' +
      esc('Total repayment split: principal ' + percentOf(principalPaise, total) + ' percent, interest ' +
        percentOf(interestPaise, total) + ' percent' + (feePaise > 0 ? ', fees ' + percentOf(feePaise, total) + ' percent' : '')) +
      '"><g transform="rotate(-90 70 70)">' + circles + '</g>' +
      '<text x="70" y="66" class="loan-donut__big" text-anchor="middle">' +
      percentOf(interestPaise, total) + '%</text>' +
      '<text x="70" y="82" class="loan-donut__small" text-anchor="middle">interest</text></svg>';
  }

  /* Balance over time. Long schedules are sampled down to keep the
     path short — the shape is identical and the DOM stays small. */
  function renderBalanceChart(schedule, principalPaise) {
    if (!schedule.length) { dom.balanceChart.innerHTML = ''; dom.balanceSummary.textContent = ''; return; }

    var W = 640, H = 180, PAD = 4;
    var maxPoints = 160;
    var step = Math.max(1, Math.ceil(schedule.length / maxPoints));

    var pts = [[PAD, PAD]];
    for (var i = 0; i < schedule.length; i += step) {
      var row = schedule[i];
      var x = PAD + (row.month / schedule.length) * (W - PAD * 2);
      var y = PAD + (1 - row.balance / principalPaise) * (H - PAD * 2);
      pts.push([x, y]);
    }
    var last = schedule[schedule.length - 1];
    pts.push([W - PAD, PAD + (1 - last.balance / principalPaise) * (H - PAD * 2)]);

    var line = pts.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ');
    var area = line + ' L' + (W - PAD) + ' ' + (H - PAD) + ' L' + PAD + ' ' + (H - PAD) + ' Z';

    dom.balanceChart.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="loan-linechart" role="img" aria-label="' +
      esc('Outstanding balance falling from ' + formatPaise(principalPaise) + ' to zero over ' +
        formatMonths(schedule.length) + '.') + '">' +
      '<path class="loan-linechart__area" d="' + area + '" />' +
      '<path class="loan-linechart__line" d="' + line + '" fill="none" />' +
      '</svg>';

    /* Where the balance crosses the halfway mark tells you far more
       about a loan than the shape of the curve does. */
    var halfway = 0;
    for (var j = 0; j < schedule.length; j++) {
      if (schedule[j].balance <= principalPaise / 2) { halfway = schedule[j].month; break; }
    }
    dom.balanceSummary.textContent = halfway
      ? 'The outstanding balance falls below half the loan amount at month ' + halfway +
        ' of ' + schedule.length + ' — ' + percentOf(halfway, schedule.length) +
        '% of the way through the term.'
      : 'The outstanding balance falls steadily to zero over ' + formatMonths(schedule.length) + '.';
  }

  /* Yearly stacked bars: how the principal/interest mix shifts. */
  function renderYearChart(years) {
    if (!years.length) { dom.yearChart.innerHTML = ''; dom.yearSummary.textContent = ''; return; }

    var maxPay = 0;
    years.forEach(function (y) { if (y.payment > maxPay) maxPay = y.payment; });
    if (!maxPay) { dom.yearChart.innerHTML = ''; return; }

    var W = 640, H = 160, PAD = 4;
    var gap = years.length > 30 ? 0.5 : 2;
    var bw = (W - PAD * 2 - gap * (years.length - 1)) / years.length;

    var bars = years.map(function (y, i) {
      var x = PAD + i * (bw + gap);
      var hInt = (y.interest / maxPay) * (H - PAD * 2);
      var hPri = (y.principal / maxPay) * (H - PAD * 2);
      return '<rect class="loan-bar loan-bar--interest" x="' + x.toFixed(2) + '" y="' +
        (H - PAD - hInt - hPri).toFixed(2) + '" width="' + bw.toFixed(2) + '" height="' + hInt.toFixed(2) + '" />' +
        '<rect class="loan-bar loan-bar--principal" x="' + x.toFixed(2) + '" y="' +
        (H - PAD - hPri).toFixed(2) + '" width="' + bw.toFixed(2) + '" height="' + hPri.toFixed(2) + '" />';
    }).join('');

    var first = years[0];
    var lastYear = years[years.length - 1];
    dom.yearChart.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="loan-barchart" role="img" aria-label="' +
      esc('Yearly split of payments. In year 1, ' + percentOf(first.interest, first.payment) +
        ' percent of what you pay is interest. By year ' + lastYear.year + ' that falls to ' +
        percentOf(lastYear.interest, lastYear.payment) + ' percent.') + '">' + bars + '</svg>';

    dom.yearSummary.textContent = years.length > 1
      ? 'In year 1, ' + percentOf(first.interest, first.payment) + '% of what you pay goes to interest and ' +
        percentOf(first.principal, first.payment) + '% reduces the loan. By year ' + lastYear.year +
        ' that has flipped to ' + percentOf(lastYear.interest, lastYear.payment) + '% interest and ' +
        percentOf(lastYear.principal, lastYear.payment) + '% principal.'
      : 'The loan is repaid within a single year, so the mix barely shifts.';
  }

  /* ============================================================
     13. Result rendering
     ============================================================ */

  function announce(message) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.status.textContent = message; }, 500);
  }

  function showErrors(list) {
    if (!list.length) {
      dom.errors.hidden = true;
      dom.errors.innerHTML = '';
      [dom.amount, dom.rate, dom.tenure].forEach(function (el) { el.removeAttribute('aria-invalid'); });
      return;
    }
    dom.errors.hidden = false;
    dom.errors.innerHTML = '<ul>' + list.map(function (e) {
      return '<li>' + esc(e.message) + '</li>';
    }).join('') + '</ul>';

    var fieldMap = { amount: dom.amount, rate: dom.rate, tenure: dom.tenure };
    [dom.amount, dom.rate, dom.tenure].forEach(function (el) { el.removeAttribute('aria-invalid'); });
    list.forEach(function (e) {
      if (fieldMap[e.field]) fieldMap[e.field].setAttribute('aria-invalid', 'true');
    });
    announce(list[0].message);
  }

  function statCell(label, value, variant, hint) {
    return '<div class="loan-stat' + (variant ? ' loan-stat--' + variant : '') + '">' +
      '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>' +
      (hint ? '<p class="loan-stat__hint">' + esc(hint) + '</p>' : '') + '</div>';
  }

  function renderResult() {
    var r = state.result;
    var feePaise = state.feePaise;
    var totalCost = r.totalPaidPaise + feePaise;

    /* Headline figures are shown to the rupee, the way lenders quote
       them. Full paise are kept internally and in the CSV export, and
       the schedule closes on exact paise regardless of display. */
    var money = { round: true };

    dom.emi.textContent = formatPaise(r.emiPaise, money);

    var notes = [];
    if (Math.round(r.finalEmiPaise / 100) !== Math.round(r.emiPaise / 100) && r.months > 0) {
      notes.push('Final instalment ' + formatPaise(r.finalEmiPaise, money) + ' (adjusted for rounding)');
    }
    if (r.months !== r.scheduledMonths) {
      notes.push('Paid off in ' + formatMonths(r.months) + ' instead of ' + formatMonths(r.scheduledMonths));
    }
    dom.emiNote.textContent = notes.join(' · ');

    dom.stats.innerHTML =
      statCell('Total interest', formatPaise(r.totalInterestPaise, money), 'interest') +
      statCell('Total payment', formatPaise(r.totalPaidPaise, money), 'total') +
      statCell('Principal', formatPaise(r.principalPaise, money), 'principal') +
      (feePaise > 0 ? statCell('Total cost of borrowing', formatPaise(r.totalInterestPaise + feePaise, money), 'fee',
        'Interest plus ' + formatPaise(feePaise, money) + ' in fees') : '') +
      statCell('Number of payments', String(r.months)) +
      statCell('Interest rate', formatRate(state.annualRate) + ' p.a.') +
      statCell('Tenure', formatMonths(r.scheduledMonths));

    /* Proportion bar plus explicit numbers — the split never depends
       on being able to distinguish two colours. */
    var totalSplit = r.principalPaise + r.totalInterestPaise + feePaise;
    var pPct = percentOf(r.principalPaise, totalSplit);
    var iPct = percentOf(r.totalInterestPaise, totalSplit);
    var fPct = percentOf(feePaise, totalSplit);

    dom.split.innerHTML =
      '<div class="loan-splitbar" role="img" aria-label="' +
      esc('Principal ' + pPct + ' percent, interest ' + iPct + ' percent' +
        (feePaise > 0 ? ', fees ' + fPct + ' percent' : '')) + '">' +
      '<span class="loan-splitbar__seg loan-splitbar__seg--principal" style="width:' + pPct + '%"></span>' +
      '<span class="loan-splitbar__seg loan-splitbar__seg--interest" style="width:' + iPct + '%"></span>' +
      (feePaise > 0 ? '<span class="loan-splitbar__seg loan-splitbar__seg--fee" style="width:' + fPct + '%"></span>' : '') +
      '</div>' +
      '<dl class="loan-legend">' +
      '<div class="loan-legend__item loan-legend__item--principal"><dt>Principal</dt><dd>' +
        formatPaise(r.principalPaise, money) + '<span>' + pPct + '%</span></dd></div>' +
      '<div class="loan-legend__item loan-legend__item--interest"><dt>Interest</dt><dd>' +
        formatPaise(r.totalInterestPaise, money) + '<span>' + iPct + '%</span></dd></div>' +
      (feePaise > 0 ? '<div class="loan-legend__item loan-legend__item--fee"><dt>Fees</dt><dd>' +
        formatPaise(feePaise, money) + '<span>' + fPct + '%</span></dd></div>' : '') +
      '<div class="loan-legend__item loan-legend__item--total"><dt>Total cost</dt><dd>' +
        formatPaise(totalCost, money) + '<span>100%</span></dd></div>' +
      '</dl>' +
      '<p class="loan-hint">For every ₹100 borrowed you repay ' +
        formatINR(Math.round((totalCost / r.principalPaise) * 10000) / 100) + '.</p>';

    renderDonut(r.principalPaise, r.totalInterestPaise, feePaise);
    renderBalanceChart(r.schedule, r.principalPaise);
    renderYearChart(toYearly(r.schedule));
    renderPrepayment();
    renderSchedule();
    renderEmiRatio();

    announce('EMI calculated. Monthly payment ' + formatPaise(r.emiPaise, money) +
      '. Total interest ' + formatPaise(r.totalInterestPaise, money) +
      '. Total payment ' + formatPaise(r.totalPaidPaise, money) + '.');
  }

  function renderPrepayment() {
    var c = state.comparison;
    if (!c || (c.interestSavedPaise <= 0 && c.monthsSaved <= 0)) {
      dom.prepayResult.innerHTML =
        '<p class="loan-hint">Add an extra monthly amount or a one-time prepayment above to see what it saves.</p>';
      return;
    }
    dom.prepayResult.innerHTML =
      '<dl class="loan-compare">' +
      '<div><dt>Interest without prepayment</dt><dd>' + formatPaise(c.base.totalInterestPaise, { round: true }) + '</dd></div>' +
      '<div><dt>Interest with prepayment</dt><dd>' + formatPaise(c.withPrepay.totalInterestPaise, { round: true }) + '</dd></div>' +
      '<div class="loan-compare__win"><dt>Interest saved</dt><dd>' + formatPaise(c.interestSavedPaise, { round: true }) + '</dd></div>' +
      '<div><dt>Original tenure</dt><dd>' + formatMonths(c.base.months) + '</dd></div>' +
      '<div><dt>New payoff</dt><dd>' + formatMonths(c.withPrepay.months) + '</dd></div>' +
      '<div class="loan-compare__win"><dt>Tenure reduced by</dt><dd>' + formatMonths(c.monthsSaved) + '</dd></div>' +
      '</dl>' +
      '<p class="loan-hint">Actual savings may vary based on lender rules, prepayment charges, ' +
      'the interest calculation method and the timing of each payment.</p>';
  }

  function renderEmiRatio() {
    if (!dom.emiRatio) return;
    var income = parseMoney(dom.income.value, 'income', 'monthly income', { allowEmpty: true, allowZero: true });
    if (!income.ok || !income.paise || !state.result) {
      dom.emiRatio.hidden = true;
      return;
    }
    var pct = percentOf(state.result.emiPaise, income.paise);
    dom.emiRatio.hidden = false;
    dom.emiRatio.innerHTML = 'This EMI is <strong>' + pct + '%</strong> of the monthly income entered (' +
      formatPaise(state.result.emiPaise) + ' of ' + formatPaise(income.paise) + '). ' +
      'This is an informational ratio, not a lender approval criterion.';
  }

  /* ============================================================
     14. Schedule rendering

     Yearly by default. A 30-year loan is 360 monthly rows, which is
     both unreadable and a pointless amount of DOM to build before
     anyone has asked for it.
     ============================================================ */

  function renderSchedule() {
    var r = state.result;
    if (!r || !r.schedule.length) {
      dom.scheduleBody.innerHTML = '';
      return;
    }

    if (state.scheduleView === 'yearly') {
      var years = toYearly(r.schedule);
      dom.scheduleHead.innerHTML =
        '<tr><th scope="col">Year</th><th scope="col">Principal paid</th><th scope="col">Interest paid</th>' +
        '<th scope="col">Total paid</th><th scope="col">Closing balance</th></tr>';
      dom.scheduleCaption.textContent =
        'Yearly repayment summary — ' + years.length + (years.length === 1 ? ' year' : ' years') +
        '. Select a year to see its monthly instalments.';

      dom.scheduleBody.innerHTML = years.map(function (y) {
        var open = state.expandedYear === y.year;
        var head = '<tr class="loan-yearrow' + (open ? ' is-open' : '') + '">' +
          '<th scope="row"><button type="button" class="loan-yeartoggle" data-loan-year="' + y.year +
          '" aria-expanded="' + (open ? 'true' : 'false') + '">Year ' + y.year +
          '<span class="loan-yeartoggle__months">months ' + y.fromMonth + '–' + y.toMonth + '</span></button></th>' +
          '<td>' + formatPaise(y.principal, { round: true }) + '</td>' +
          '<td>' + formatPaise(y.interest, { round: true }) + '</td>' +
          '<td>' + formatPaise(y.payment, { round: true }) + '</td>' +
          '<td>' + formatPaise(y.balance, { round: true }) + '</td></tr>';

        if (!open) return head;

        var months = r.schedule.filter(function (m) {
          return m.month >= y.fromMonth && m.month <= y.toMonth;
        }).map(function (m) {
          return '<tr class="loan-monthrow"><th scope="row">Month ' + m.month + '</th>' +
            '<td>' + formatPaise(m.principal, { round: true }) + '</td>' +
            '<td>' + formatPaise(m.interest, { round: true }) + '</td>' +
            '<td>' + formatPaise(m.payment, { round: true }) + '</td>' +
            '<td>' + formatPaise(m.balance, { round: true }) + '</td></tr>';
        }).join('');
        return head + months;
      }).join('');
      return;
    }

    /* Full monthly view, explicitly requested. */
    dom.scheduleHead.innerHTML =
      '<tr><th scope="col">Month</th><th scope="col">EMI</th><th scope="col">Principal</th>' +
      '<th scope="col">Interest</th><th scope="col">Balance</th></tr>';
    dom.scheduleCaption.textContent =
      'Full monthly amortization schedule — ' + r.schedule.length + ' instalments.';
    dom.scheduleBody.innerHTML = r.schedule.map(function (m) {
      return '<tr><th scope="row">' + m.month + '</th>' +
        '<td>' + formatPaise(m.payment, { round: true }) + '</td>' +
        '<td>' + formatPaise(m.principal, { round: true }) + '</td>' +
        '<td>' + formatPaise(m.interest, { round: true }) + '</td>' +
        '<td>' + formatPaise(m.balance, { round: true }) + '</td></tr>';
    }).join('');
  }

  /* ============================================================
     15. Actions
     ============================================================ */

  function readInputs() {
    var errors = [];

    var amount = parseMoney(dom.amount.value, 'amount', 'a loan amount');
    if (!amount.ok) errors.push(amount);

    var rate = parseRate(dom.rate.value);
    if (!rate.ok) errors.push(rate);

    var tenure = parseTenure(dom.tenure.value, state.unit);
    if (!tenure.ok) errors.push(tenure);

    var fee = parseMoney(dom.fee.value, 'fee', 'a processing fee', { allowEmpty: true, allowZero: true });
    if (!fee.ok) errors.push(fee);

    var extra = parseMoney(dom.extraMonthly.value, 'extra', 'an extra monthly payment', { allowEmpty: true, allowZero: true });
    if (!extra.ok) errors.push(extra);

    var lump = parseMoney(dom.lumpSum.value, 'lump', 'a one-time prepayment', { allowEmpty: true, allowZero: true });
    if (!lump.ok) errors.push(lump);

    if (errors.length) return { ok: false, errors: errors };

    var lumpMonth = Math.max(1, Math.min(tenure.months, Math.round(Number(dom.lumpMonth.value) || 1)));

    return {
      ok: true,
      principalPaise: amount.paise,
      annualRate: rate.value,
      months: tenure.months,
      feePaise: fee.paise,
      extraMonthlyPaise: extra.paise,
      lumpSumPaise: lump.paise,
      lumpSumMonth: lumpMonth
    };
  }

  function run() {
    var input = readInputs();
    if (!input.ok) {
      showErrors(input.errors);
      state.result = null;
      setActionsEnabled(false);
      return;
    }
    showErrors([]);

    var opts = {
      principalPaise: input.principalPaise,
      annualRate: input.annualRate,
      months: input.months,
      extraMonthlyPaise: input.extraMonthlyPaise,
      lumpSumPaise: input.lumpSumPaise,
      lumpSumMonth: input.lumpSumMonth,
      prepayMode: state.prepayMode
    };

    var result = amortize(opts);
    if (!result.ok) {
      showErrors([{
        field: 'rate',
        message: 'At ' + formatRate(input.annualRate) + ' over ' + formatMonths(input.months) +
          ', the instalment does not cover the monthly interest, so the loan would never be repaid. ' +
          'Lower the rate or shorten the tenure.'
      }]);
      state.result = null;
      setActionsEnabled(false);
      return;
    }

    state.result = result;
    state.annualRate = input.annualRate;
    state.feePaise = input.feePaise;
    state.comparison = (input.extraMonthlyPaise > 0 || input.lumpSumPaise > 0)
      ? comparePrepayment(opts)
      : null;

    setActionsEnabled(true);
    renderResult();
  }

  function setActionsEnabled(on) {
    [dom.copy, dom.share, dom.print, dom.csv].forEach(function (b) { if (b) b.disabled = !on; });
  }

  function flash(button, text) {
    if (!button) return;
    var original = button.getAttribute('data-loan-label') || button.textContent;
    button.setAttribute('data-loan-label', original);
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1600);
  }

  function copyResult() {
    if (!state.result) return;
    var text = resultToText({
      result: state.result, annualRate: state.annualRate,
      feePaise: state.feePaise, comparison: state.comparison
    });
    if (!navigator.clipboard || !navigator.clipboard.writeText) { flash(dom.copy, 'Unavailable'); return; }
    navigator.clipboard.writeText(text).then(function () {
      flash(dom.copy, 'Copied ✓');
      dom.status.textContent = 'Loan calculation copied to the clipboard.';
    }, function () { flash(dom.copy, 'Copy failed'); });
  }

  function shareResult() {
    if (!state.result) return;
    var text = resultToText({
      result: state.result, annualRate: state.annualRate,
      feePaise: state.feePaise, comparison: state.comparison
    });
    if (navigator.share) {
      navigator.share({ title: 'Loan Calculation', text: text }).catch(function () { /* dismissed */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flash(dom.share, 'Copied ✓');
        dom.status.textContent = 'Sharing is not available in this browser, so the summary was copied instead.';
      });
      return;
    }
    flash(dom.share, 'Unavailable');
  }

  function exportCsv() {
    if (!state.result) return;
    var csv = scheduleToCsv(state.result, { annualRate: state.annualRate });
    /* The BOM makes Excel open the rupee sign and UTF-8 correctly. */
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'loan-amortization-schedule.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    dom.status.textContent = 'Amortization schedule downloaded as CSV.';
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

  function runAffordability() {
    if (!dom.affordResult) return;
    var income = parseMoney(dom.income.value, 'income', 'a monthly income', { allowEmpty: true, allowZero: true });
    if (!income.ok || !income.paise) {
      dom.affordResult.innerHTML = '<p class="loan-hint">Enter your monthly income to see an estimate.</p>';
      return;
    }
    var obligations = parseMoney(dom.obligations.value, 'obligations', 'existing obligations', { allowEmpty: true, allowZero: true });
    var rate = parseRate(dom.rate.value);
    var tenure = parseTenure(dom.tenure.value, state.unit);
    if (!obligations.ok || !rate.ok || !tenure.ok) {
      dom.affordResult.innerHTML = '<p class="loan-hint">Fix the loan details above to see an affordability estimate.</p>';
      return;
    }

    var out = affordability({
      incomePaise: income.paise,
      obligationsPaise: obligations.paise,
      ratio: Number(dom.ratio.value) || 40,
      annualRate: rate.value,
      months: tenure.months
    });

    if (!out.affordableEmiPaise) {
      dom.affordResult.innerHTML = '<p class="loan-note">' + esc(out.note) + '</p>';
      return;
    }
    dom.affordResult.innerHTML =
      '<dl class="loan-compare">' +
      '<div><dt>Estimated affordable EMI</dt><dd>' + formatPaise(out.affordableEmiPaise, { round: true }) + '</dd></div>' +
      '<div class="loan-compare__win"><dt>Estimated loan amount</dt><dd>' +
        formatPaise(out.affordablePrincipalPaise, { round: true }) + '</dd></div>' +
      '</dl>' +
      '<p class="loan-hint">At ' + formatRate(rate.value) + ' over ' + formatMonths(tenure.months) +
      ', using ' + (Number(dom.ratio.value) || 40) + '% of income minus existing obligations. ' +
      'This is an arithmetic estimate, not a lending decision — lenders assess income stability, ' +
      'credit history, and their own policies.</p>' +
      '<button type="button" class="loan-btn loan-btn--ghost loan-btn--sm" data-loan-apply-afford>' +
      'Use ' + formatPaise(out.affordablePrincipalPaise, { round: true }) + ' as the loan amount</button>';
  }

  /* ============================================================
     16. Preferences, events, init

     Only view preferences are stored. The previous version wrote the
     entire result — including every schedule row — into localStorage
     on each calculation and never read it back, which stored
     someone's loan details for no benefit at all.
     ============================================================ */

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        unit: state.unit,
        scheduleView: state.scheduleView,
        prepayMode: state.prepayMode
      }));
    } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.unit === 'years' || saved.unit === 'months') state.unit = saved.unit;
      if (saved.scheduleView === 'yearly' || saved.scheduleView === 'monthly') state.scheduleView = saved.scheduleView;
      if (saved.prepayMode === 'tenure' || saved.prepayMode === 'emi') state.prepayMode = saved.prepayMode;
    } catch (e) { /* corrupt prefs fall back to defaults */ }
  }

  /* Sliders and number fields are two views of one value. */
  function syncPair(field, rangeEl, inputEl) {
    rangeEl.addEventListener('input', function () {
      inputEl.value = rangeEl.value;
      run();
    });
    inputEl.addEventListener('input', function () {
      var v = parseFloat(inputEl.value);
      if (isFinite(v)) {
        var min = parseFloat(rangeEl.min);
        var max = parseFloat(rangeEl.max);
        rangeEl.value = Math.max(min, Math.min(max, v));
      }
      run();
    });
  }

  function setUnit(unit) {
    if (state.unit === unit) return;
    var previous = state.unit;
    var value = parseFloat(dom.tenure.value);

    /* Convert the number so the loan itself does not change when the
       user is only changing how it is expressed. */
    if (isFinite(value)) {
      if (previous === 'years' && unit === 'months') value = Math.round(value * 12);
      else if (previous === 'months' && unit === 'years') value = Math.round((value / 12) * 100) / 100;
      dom.tenure.value = value;
    }

    state.unit = unit;
    dom.unit.forEach(function (b) {
      var on = b.getAttribute('data-loan-unit') === unit;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (unit === 'months') {
      dom.tenureRange.min = 1; dom.tenureRange.max = 360; dom.tenureRange.step = 1;
    } else {
      dom.tenureRange.min = 1; dom.tenureRange.max = 30; dom.tenureRange.step = 1;
    }
    if (isFinite(value)) {
      dom.tenureRange.value = Math.max(Number(dom.tenureRange.min), Math.min(Number(dom.tenureRange.max), value));
    }
    dom.tenureUnitLabel.textContent = unit === 'months' ? 'months' : 'years';
    savePrefs();
    run();
  }

  function applyPreset(key) {
    var p = PRESETS[key];
    if (!p) return;
    dom.amount.value = p.amount;
    dom.amountRange.value = Math.min(Number(dom.amountRange.max), p.amount);
    dom.rate.value = p.rate;
    dom.rateRange.value = p.rate;
    state.unit = p.unit === 'months' ? 'months' : 'years';
    dom.unit.forEach(function (b) {
      var on = b.getAttribute('data-loan-unit') === state.unit;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.tenureRange.min = 1;
    dom.tenureRange.max = state.unit === 'months' ? 360 : 30;
    dom.tenure.value = p.tenure;
    dom.tenureRange.value = Math.min(Number(dom.tenureRange.max), p.tenure);
    dom.tenureUnitLabel.textContent = state.unit === 'months' ? 'months' : 'years';
    run();
  }

  function bindEvents() {
    syncPair('amount', dom.amountRange, dom.amount);
    syncPair('rate', dom.rateRange, dom.rate);
    syncPair('tenure', dom.tenureRange, dom.tenure);

    dom.unit.forEach(function (b) {
      b.addEventListener('click', function () { setUnit(b.getAttribute('data-loan-unit')); });
    });

    dom.presets.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-loan-preset]');
      if (btn) applyPreset(btn.getAttribute('data-loan-preset'));
    });

    dom.quickAmounts.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-loan-quick-amount]');
      if (!btn) return;
      dom.amount.value = btn.getAttribute('data-loan-quick-amount');
      dom.amountRange.value = Math.min(Number(dom.amountRange.max), Number(dom.amount.value));
      run();
    });

    dom.quickRates.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-loan-quick-rate]');
      if (!btn) return;
      dom.rate.value = btn.getAttribute('data-loan-quick-rate');
      dom.rateRange.value = dom.rate.value;
      run();
    });

    dom.quickTenures.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-loan-quick-tenure]');
      if (!btn) return;
      if (state.unit !== 'years') setUnit('years');
      dom.tenure.value = btn.getAttribute('data-loan-quick-tenure');
      dom.tenureRange.value = Math.min(Number(dom.tenureRange.max), Number(dom.tenure.value));
      run();
    });

    [dom.fee, dom.extraMonthly, dom.lumpSum, dom.lumpMonth].forEach(function (el) {
      el.addEventListener('input', run);
    });

    dom.prepayModes.forEach(function (b) {
      b.addEventListener('click', function () {
        state.prepayMode = b.getAttribute('data-loan-prepay-mode');
        dom.prepayModes.forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        savePrefs();
        run();
      });
    });

    dom.scheduleViews.forEach(function (b) {
      b.addEventListener('click', function () {
        state.scheduleView = b.getAttribute('data-loan-schedule-view');
        state.expandedYear = 0;
        dom.scheduleViews.forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        savePrefs();
        renderSchedule();
      });
    });

    dom.scheduleBody.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-loan-year]');
      if (!btn) return;
      var year = Number(btn.getAttribute('data-loan-year'));
      state.expandedYear = state.expandedYear === year ? 0 : year;
      renderSchedule();
    });

    dom.calculate.addEventListener('click', run);
    dom.reset.addEventListener('click', function () {
      dom.amount.value = '1000000';
      dom.amountRange.value = 1000000;
      dom.rate.value = '8.5';
      dom.rateRange.value = 8.5;
      state.unit = 'years';
      dom.unit.forEach(function (b) {
        var on = b.getAttribute('data-loan-unit') === 'years';
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      dom.tenureRange.min = 1; dom.tenureRange.max = 30;
      dom.tenure.value = '5';
      dom.tenureRange.value = 5;
      dom.tenureUnitLabel.textContent = 'years';
      dom.fee.value = '0';
      dom.extraMonthly.value = '0';
      dom.lumpSum.value = '0';
      dom.lumpMonth.value = '12';
      dom.income.value = '';
      dom.obligations.value = '0';
      dom.ratio.value = '40';
      dom.ratioOut.textContent = '40%';
      state.prepayMode = 'tenure';
      state.expandedYear = 0;
      dom.prepayModes.forEach(function (x) {
        var on = x.getAttribute('data-loan-prepay-mode') === 'tenure';
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (dom.affordResult) dom.affordResult.innerHTML = '';
      run();
      dom.status.textContent = 'Calculator reset to defaults.';
    });

    dom.copy.addEventListener('click', copyResult);
    dom.share.addEventListener('click', shareResult);
    dom.print.addEventListener('click', printResult);
    dom.csv.addEventListener('click', exportCsv);

    if (dom.income) {
      [dom.income, dom.obligations].forEach(function (el) {
        el.addEventListener('input', function () { runAffordability(); renderEmiRatio(); });
      });
      dom.ratio.addEventListener('input', function () {
        dom.ratioOut.textContent = dom.ratio.value + '%';
        runAffordability();
      });
      dom.affordResult.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-loan-apply-afford]');
        if (!btn) return;
        var income = parseMoney(dom.income.value, 'income', 'income', { allowEmpty: true, allowZero: true });
        var obligations = parseMoney(dom.obligations.value, 'obligations', 'obligations', { allowEmpty: true, allowZero: true });
        var rate = parseRate(dom.rate.value);
        var tenure = parseTenure(dom.tenure.value, state.unit);
        if (!income.ok || !obligations.ok || !rate.ok || !tenure.ok) return;
        var out = affordability({
          incomePaise: income.paise, obligationsPaise: obligations.paise,
          ratio: Number(dom.ratio.value) || 40, annualRate: rate.value, months: tenure.months
        });
        if (!out.affordablePrincipalPaise) return;
        dom.amount.value = Math.round(toRupees(out.affordablePrincipalPaise));
        dom.amountRange.value = Math.min(Number(dom.amountRange.max), Number(dom.amount.value));
        run();
        dom.amount.focus();
      });
    }
  }

  function init() {
    if (!cacheDom()) return;

    loadPrefs();

    dom.amount.value = state.amount;
    dom.amountRange.value = state.amount;
    dom.rate.value = state.rate;
    dom.rateRange.value = state.rate;
    dom.tenure.value = state.tenure;
    dom.tenureRange.value = state.tenure;

    dom.unit.forEach(function (b) {
      var on = b.getAttribute('data-loan-unit') === state.unit;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (state.unit === 'months') {
      dom.tenureRange.max = 360;
      dom.tenure.value = 60;
      dom.tenureRange.value = 60;
      dom.tenureUnitLabel.textContent = 'months';
    }
    dom.scheduleViews.forEach(function (b) {
      var on = b.getAttribute('data-loan-schedule-view') === state.scheduleView;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.prepayModes.forEach(function (b) {
      var on = b.getAttribute('data-loan-prepay-mode') === state.prepayMode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    bindEvents();

    /* Calculate immediately. The old page reset every result to an
       em dash on load, so the first thing anyone saw was an empty
       calculator despite the inputs being pre-filled. */
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
