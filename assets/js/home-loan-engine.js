/* ==========================================================================
   ToolAdda — Home Loan Calculator (engine)

   All the loan arithmetic, with no DOM. A home loan is the largest financial
   commitment most people make, so the numbers here are worth being exact
   about — and worth testing independently of the interface.

   Three things this file is careful about, because they are where loan
   calculators quietly go wrong:

   1. A LOAN THAT NEVER ENDS. If the EMI is smaller than the first month's
      interest, the balance grows every month and the schedule never
      terminates. A naive `while (balance > 0)` loop hangs the browser.
      buildSchedule detects this up front and reports it.

   2. THE LAST INSTALMENT. Floating point means the balance after the final
      scheduled EMI is never exactly zero. The last instalment is adjusted to
      settle the balance precisely, so the sum of the principal components
      equals the amount borrowed to the paisa.

   3. PREPAYMENT THAT OVERSHOOTS. A part-payment larger than the outstanding
      balance must close the loan, not drive the balance negative.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_MONTHS = 40 * 12;      /* upper bound on any schedule we will build */
  var PAISA = 0.005;             /* anything under half a paisa is settled     */

  /* ======================================================================
     1. Helpers
     ====================================================================== */

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) === -1 ? fallback : value;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  /** Indian digit grouping: 12,34,567 rather than 1,234,567. */
  function formatINR(value, options) {
    var opts = options || {};
    var n = isFinite(value) ? value : 0;
    var negative = n < 0;
    n = Math.abs(n);
    var whole = opts.decimals ? n.toFixed(2) : String(Math.round(n));
    var parts = whole.split('.');
    var digits = parts[0];
    var out;
    if (digits.length <= 3) {
      out = digits;
    } else {
      var last3 = digits.slice(-3);
      var rest = digits.slice(0, -3);
      out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    }
    if (parts[1]) out += '.' + parts[1];
    return (negative ? '-' : '') + (opts.bare ? '' : '₹') + out;
  }

  /** "1.2 Cr", "45.5 L" — how Indian property prices are actually spoken. */
  function formatShortINR(value) {
    var n = Math.abs(value || 0);
    var sign = value < 0 ? '-' : '';
    if (n >= 1e7) return sign + '₹' + round2(n / 1e7) + ' Cr';
    if (n >= 1e5) return sign + '₹' + round2(n / 1e5) + ' L';
    if (n >= 1e3) return sign + '₹' + round2(n / 1e3) + ' K';
    return sign + '₹' + Math.round(n);
  }

  function monthlyRate(annualRate) {
    return (annualRate || 0) / 100 / 12;
  }

  /* ======================================================================
     2. The EMI itself
     ====================================================================== */

  /**
   * Equated Monthly Instalment.
   *   EMI = P·r·(1+r)^n / ((1+r)^n − 1)
   * At 0% interest the formula divides by zero, so that case is split out —
   * an interest-free loan is simply the principal spread evenly.
   */
  function emiFor(principal, annualRate, months) {
    var p = Number(principal) || 0;
    var n = Math.round(Number(months) || 0);
    if (p <= 0 || n <= 0) return 0;
    var r = monthlyRate(annualRate);
    if (r <= 0) return p / n;
    var factor = Math.pow(1 + r, n);
    return (p * r * factor) / (factor - 1);
  }

  /** The tenure an EMI implies. Returns null when the EMI can never repay. */
  function monthsForEmi(principal, annualRate, emi) {
    var p = Number(principal) || 0;
    var e = Number(emi) || 0;
    if (p <= 0 || e <= 0) return 0;
    var r = monthlyRate(annualRate);
    if (r <= 0) return Math.ceil(p / e);
    /* The EMI must at least cover the first month's interest. */
    if (e <= p * r + PAISA) return null;
    var n = Math.log(e / (e - p * r)) / Math.log(1 + r);
    return Math.ceil(n - 1e-9);
  }

  /** The largest loan a given EMI can service. */
  function principalForEmi(emi, annualRate, months) {
    var e = Number(emi) || 0;
    var n = Math.round(Number(months) || 0);
    if (e <= 0 || n <= 0) return 0;
    var r = monthlyRate(annualRate);
    if (r <= 0) return e * n;
    var factor = Math.pow(1 + r, n);
    return (e * (factor - 1)) / (r * factor);
  }

  /* ======================================================================
     3. The amortisation schedule
     ====================================================================== */

  /**
   * Build the month-by-month schedule.
   *
   * @param {object} o
   *   principal      amount borrowed
   *   annualRate     nominal annual rate, percent
   *   months         original tenure in months
   *   stepUpPercent  raise the EMI by this % every 12 months (0 = level EMI)
   *   extraMonthly   extra paid alongside every EMI
   *   lumpSums       [{ month, amount }] one-off part-payments
   *   strategy       'tenure' — keep the EMI, finish sooner (the default and
   *                             the one that saves the most interest)
   *                  'emi'    — keep the tenure, recompute a lower EMI
   *   startMonthIndex 1-based calendar month for labelling (optional)
   *
   * @returns {{ rows, months, totalInterest, totalPaid, totalPrepaid,
   *             baseEmi, closed, viable, reason }}
   */
  function buildSchedule(o) {
    var opts = o || {};
    var principal = Math.max(0, Number(opts.principal) || 0);
    var annualRate = Math.max(0, Number(opts.annualRate) || 0);
    var months = Math.round(clampNum(opts.months, 1, MAX_MONTHS, 240));
    var stepUp = Math.max(0, Number(opts.stepUpPercent) || 0);
    var extraMonthly = Math.max(0, Number(opts.extraMonthly) || 0);
    var strategy = oneOf(opts.strategy, ['tenure', 'emi'], 'tenure');
    var lumpSums = Array.isArray(opts.lumpSums) ? opts.lumpSums : [];

    var empty = {
      rows: [], months: 0, totalInterest: 0, totalPaid: 0, totalPrepaid: 0,
      baseEmi: 0, closed: true, viable: true, reason: null
    };
    if (principal <= 0) return empty;

    var r = monthlyRate(annualRate);
    var emi = emiFor(principal, annualRate, months);

    /* Guard 1 — a level EMI that cannot cover the interest never repays.
       With the standard formula this cannot happen, but a caller may pass a
       hand-entered EMI, so the check stays. */
    if (r > 0 && emi <= principal * r + PAISA && extraMonthly <= 0) {
      return {
        rows: [], months: 0, totalInterest: 0, totalPaid: 0, totalPrepaid: 0,
        baseEmi: emi, closed: false, viable: false,
        reason: 'The instalment does not cover the first month of interest, so the balance would grow every month. Increase the EMI, lower the rate, or borrow less.'
      };
    }

    /* Index the one-off payments by month for O(1) lookup. */
    var lumpByMonth = {};
    lumpSums.forEach(function (l) {
      var m = Math.round(Number(l && l.month) || 0);
      var amt = Math.max(0, Number(l && l.amount) || 0);
      if (m >= 1 && amt > 0) lumpByMonth[m] = (lumpByMonth[m] || 0) + amt;
    });

    var rows = [];
    var balance = principal;
    var totalInterest = 0;
    var totalPaid = 0;
    var totalPrepaid = 0;
    var currentEmi = emi;
    var month = 0;

    while (balance > PAISA && month < MAX_MONTHS) {
      month++;

      /* Step-up applies at the start of each new year of the loan. */
      if (stepUp > 0 && month > 1 && (month - 1) % 12 === 0) {
        currentEmi = currentEmi * (1 + stepUp / 100);
      }

      var interest = balance * r;
      var due = currentEmi;

      /* The final instalment settles whatever is left, no more. */
      if (due > balance + interest) due = balance + interest;

      var principalPart = due - interest;

      /* Guard 2 — if the instalment cannot cover interest mid-schedule the
         loan is not amortising; stop rather than loop to the bound. */
      if (principalPart <= 0 && balance > PAISA) {
        return {
          rows: rows, months: rows.length, totalInterest: totalInterest,
          totalPaid: totalPaid, totalPrepaid: totalPrepaid, baseEmi: emi,
          closed: false, viable: false,
          reason: 'From month ' + month + ' the instalment no longer covers the interest, so the balance stops falling.'
        };
      }

      balance = balance - principalPart;

      /* Part-payments are applied after the instalment, which is how lenders
         credit them, and are capped at the outstanding balance. */
      var prepay = 0;
      if (extraMonthly > 0 && balance > PAISA) prepay += Math.min(extraMonthly, balance);
      if (lumpByMonth[month] && balance - prepay > PAISA) {
        prepay += Math.min(lumpByMonth[month], balance - prepay);
      }
      if (prepay > 0) {
        balance -= prepay;
        totalPrepaid += prepay;
      }

      if (balance < PAISA) balance = 0;

      totalInterest += interest;
      totalPaid += due + prepay;

      rows.push({
        month: month,
        year: Math.ceil(month / 12),
        emi: round2(due),
        interest: round2(interest),
        principal: round2(principalPart),
        prepayment: round2(prepay),
        balance: round2(balance)
      });

      /* 'emi' strategy: after a part-payment, keep the original end date and
         recompute a smaller instalment over the months that remain. */
      if (strategy === 'emi' && prepay > 0 && balance > PAISA) {
        var remaining = months - month;
        if (remaining > 0) currentEmi = emiFor(balance, annualRate, remaining);
      }
    }

    return {
      rows: rows,
      months: rows.length,
      totalInterest: round2(totalInterest),
      totalPaid: round2(totalPaid),
      totalPrepaid: round2(totalPrepaid),
      baseEmi: round2(emi),
      closed: balance <= PAISA,
      viable: true,
      reason: null
    };
  }

  /** Collapse a monthly schedule into per-year totals for display. */
  function yearlySummary(rows) {
    var years = [];
    var byYear = {};
    (rows || []).forEach(function (row) {
      if (!byYear[row.year]) {
        byYear[row.year] = {
          year: row.year, principal: 0, interest: 0,
          prepayment: 0, paid: 0, balance: row.balance
        };
        years.push(byYear[row.year]);
      }
      var y = byYear[row.year];
      y.principal += row.principal;
      y.interest += row.interest;
      y.prepayment += row.prepayment;
      y.paid += row.emi + row.prepayment;
      y.balance = row.balance;          /* closing balance of the last month */
    });
    years.forEach(function (y) {
      y.principal = round2(y.principal);
      y.interest = round2(y.interest);
      y.prepayment = round2(y.prepayment);
      y.paid = round2(y.paid);
    });
    return years;
  }

  /* ======================================================================
     4. Comparing a plain loan against one with part-payments
     ====================================================================== */

  function comparePrepayment(base, improved) {
    if (!base || !improved || !base.viable || !improved.viable) return null;
    return {
      monthsSaved: Math.max(0, base.months - improved.months),
      interestSaved: round2(Math.max(0, base.totalInterest - improved.totalInterest)),
      baseMonths: base.months,
      newMonths: improved.months,
      baseInterest: base.totalInterest,
      newInterest: improved.totalInterest
    };
  }

  /* ======================================================================
     5. Indian income-tax relief

     Deliberately conservative and clearly bounded. These are the headline
     caps of the OLD regime; the new regime removes most of them, which is
     why the caller must say which regime applies.
     ====================================================================== */

  var TAX = {
    section24Cap: 200000,      /* interest, self-occupied              */
    section80CCap: 150000,     /* principal, shared with EPF/LIC/etc.  */
    section80EEACap: 150000    /* extra interest, conditions apply     */
  };

  /**
   * @param {object} o
   *   interestPaid       interest in the financial year
   *   principalPaid      principal repaid in the financial year
   *   selfOccupied       true = ₹2L interest cap; false (let out) = uncapped
   *   regime             'old' (deductions apply) | 'new' (they mostly do not)
   *   slabPercent        marginal rate, e.g. 30
   *   other80CUsed       80C already consumed by EPF, insurance, etc.
   *   claim80EEA         whether the borrower qualifies for 80EEA
   */
  function taxBenefit(o) {
    var opts = o || {};
    var interestPaid = Math.max(0, Number(opts.interestPaid) || 0);
    var principalPaid = Math.max(0, Number(opts.principalPaid) || 0);
    var slab = clampNum(opts.slabPercent, 0, 42.744, 30);
    var regime = oneOf(opts.regime, ['old', 'new'], 'old');
    var selfOccupied = opts.selfOccupied !== false;
    var other80C = Math.max(0, Number(opts.other80CUsed) || 0);

    if (regime === 'new') {
      return {
        regime: regime,
        section24: 0, section80C: 0, section80EEA: 0,
        totalDeduction: 0, taxSaved: 0,
        note: 'The new tax regime does not allow Section 24(b) or 80C relief on a self-occupied home, so no saving is shown. A let-out property is treated differently — check with your advisor.'
      };
    }

    var section24 = selfOccupied
      ? Math.min(interestPaid, TAX.section24Cap)
      : interestPaid;                              /* let-out: no cap on interest */

    var eea = 0;
    if (opts.claim80EEA && selfOccupied) {
      eea = Math.min(Math.max(0, interestPaid - section24), TAX.section80EEACap);
    }

    var room80C = Math.max(0, TAX.section80CCap - other80C);
    var section80C = Math.min(principalPaid, room80C);

    var totalDeduction = section24 + eea + section80C;
    return {
      regime: regime,
      section24: round2(section24),
      section80C: round2(section80C),
      section80EEA: round2(eea),
      totalDeduction: round2(totalDeduction),
      taxSaved: round2(totalDeduction * (slab / 100)),
      note: selfOccupied
        ? 'Estimate only. Section 24(b) is capped at ₹2,00,000 of interest for a self-occupied home and 80C at ₹1,50,000 of principal, shared with EPF, insurance and other 80C items.'
        : 'For a let-out property the interest deduction is uncapped here, but set-off against other income is restricted to ₹2,00,000 a year, with the balance carried forward.'
    };
  }

  /* ======================================================================
     6. Eligibility and total cost
     ====================================================================== */

  /**
   * How much a lender is likely to advance, from the FOIR (the share of
   * income they will let go to all EMIs combined).
   */
  function eligibility(o) {
    var opts = o || {};
    var income = Math.max(0, Number(opts.monthlyIncome) || 0);
    var obligations = Math.max(0, Number(opts.existingEmis) || 0);
    var foir = clampNum(opts.foirPercent, 10, 80, 50);
    var rate = Math.max(0, Number(opts.annualRate) || 0);
    var months = Math.round(clampNum(opts.months, 1, MAX_MONTHS, 240));

    var affordableEmi = Math.max(0, (income * foir / 100) - obligations);
    var maxLoan = principalForEmi(affordableEmi, rate, months);
    return {
      affordableEmi: round2(affordableEmi),
      maxLoan: round2(maxLoan),
      foirPercent: foir,
      note: 'Indicative only. Lenders also weigh your credit score, job stability, age, the property valuation and their own loan-to-value limits.'
    };
  }

  /**
   * The cash a purchase actually needs on day one. Stamp duty and
   * registration are state-set and are NOT funded by the loan, which is the
   * detail that most often surprises first-time buyers.
   */
  function purchaseCost(o) {
    var opts = o || {};
    var price = Math.max(0, Number(opts.price) || 0);
    var downPayment = Math.min(Math.max(0, Number(opts.downPayment) || 0), price);
    var stampDuty = price * clampNum(opts.stampDutyPercent, 0, 15, 5) / 100;
    var registration = price * clampNum(opts.registrationPercent, 0, 5, 1) / 100;
    var processingFee = Math.max(0, Number(opts.processingFee) || 0);
    var other = Math.max(0, Number(opts.otherCharges) || 0);

    var loanAmount = price - downPayment;
    var upfront = downPayment + stampDuty + registration + processingFee + other;
    return {
      price: round2(price),
      loanAmount: round2(loanAmount),
      downPayment: round2(downPayment),
      downPaymentPercent: price > 0 ? round2((downPayment / price) * 100) : 0,
      stampDuty: round2(stampDuty),
      registration: round2(registration),
      processingFee: round2(processingFee),
      otherCharges: round2(other),
      upfrontCash: round2(upfront),
      ltvPercent: price > 0 ? round2((loanAmount / price) * 100) : 0
    };
  }

  /**
   * Lenders cap loan-to-value by ticket size (RBI guidance). Flag a
   * down payment that is too small for the loan to be sanctioned.
   */
  function ltvCheck(price, loanAmount) {
    var p = Math.max(0, Number(price) || 0);
    var l = Math.max(0, Number(loanAmount) || 0);
    if (p <= 0) return { ok: true, maxLtv: 90, message: null };
    var maxLtv = p <= 3000000 ? 90 : (p <= 7500000 ? 80 : 75);
    var ltv = (l / p) * 100;
    return {
      ok: ltv <= maxLtv + 0.01,
      ltv: round2(ltv),
      maxLtv: maxLtv,
      message: ltv > maxLtv + 0.01
        ? 'Most lenders cap the loan at about ' + maxLtv + '% of value for a property at this price, so you would need a larger down payment.'
        : null
    };
  }

  /* ======================================================================
     7. CSV export
     ====================================================================== */

  function scheduleToCSV(rows) {
    var lines = ['Month,Year,EMI,Principal,Interest,Prepayment,Closing Balance'];
    (rows || []).forEach(function (r) {
      lines.push([r.month, r.year, r.emi, r.principal, r.interest, r.prepayment, r.balance].join(','));
    });
    return lines.join('\n');
  }

  /* ======================================================================
     8. State
     ====================================================================== */

  function defaultState() {
    return {
      version: 1,
      price: 5000000,
      downPayment: 1000000,
      annualRate: 8.5,
      tenureYears: 20,
      processingFee: 15000,
      stampDutyPercent: 5,
      registrationPercent: 1,
      otherCharges: 0,
      stepUpPercent: 0,
      extraMonthly: 0,
      lumpSumAmount: 0,
      lumpSumMonth: 12,
      strategy: 'tenure',
      monthlyIncome: 150000,
      existingEmis: 0,
      foirPercent: 50,
      regime: 'old',
      slabPercent: 30,
      selfOccupied: true,
      other80CUsed: 0,
      claim80EEA: false
    };
  }

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};
    var price = clampNum(s.price, 0, 1e10, d.price);
    return {
      version: 1,
      price: price,
      downPayment: clampNum(s.downPayment, 0, price, Math.min(d.downPayment, price)),
      annualRate: clampNum(s.annualRate, 0, 30, d.annualRate),
      tenureYears: Math.round(clampNum(s.tenureYears, 1, 40, d.tenureYears)),
      processingFee: clampNum(s.processingFee, 0, 1e7, d.processingFee),
      stampDutyPercent: clampNum(s.stampDutyPercent, 0, 15, d.stampDutyPercent),
      registrationPercent: clampNum(s.registrationPercent, 0, 5, d.registrationPercent),
      otherCharges: clampNum(s.otherCharges, 0, 1e8, d.otherCharges),
      stepUpPercent: clampNum(s.stepUpPercent, 0, 25, d.stepUpPercent),
      extraMonthly: clampNum(s.extraMonthly, 0, 1e7, d.extraMonthly),
      lumpSumAmount: clampNum(s.lumpSumAmount, 0, 1e9, d.lumpSumAmount),
      lumpSumMonth: Math.round(clampNum(s.lumpSumMonth, 1, MAX_MONTHS, d.lumpSumMonth)),
      strategy: oneOf(s.strategy, ['tenure', 'emi'], d.strategy),
      monthlyIncome: clampNum(s.monthlyIncome, 0, 1e9, d.monthlyIncome),
      existingEmis: clampNum(s.existingEmis, 0, 1e8, d.existingEmis),
      foirPercent: clampNum(s.foirPercent, 10, 80, d.foirPercent),
      regime: oneOf(s.regime, ['old', 'new'], d.regime),
      slabPercent: clampNum(s.slabPercent, 0, 42.744, d.slabPercent),
      selfOccupied: s.selfOccupied === undefined ? d.selfOccupied : !!s.selfOccupied,
      other80CUsed: clampNum(s.other80CUsed, 0, 150000, d.other80CUsed),
      claim80EEA: s.claim80EEA === undefined ? d.claim80EEA : !!s.claim80EEA
    };
  }

  /** One call that turns a settings object into everything the UI shows. */
  function computeAll(state) {
    var s = normalize(state);
    var months = s.tenureYears * 12;
    var cost = purchaseCost({
      price: s.price, downPayment: s.downPayment,
      stampDutyPercent: s.stampDutyPercent,
      registrationPercent: s.registrationPercent,
      processingFee: s.processingFee, otherCharges: s.otherCharges
    });

    var common = { principal: cost.loanAmount, annualRate: s.annualRate, months: months };

    var base = buildSchedule(common);
    var lumpSums = s.lumpSumAmount > 0 ? [{ month: s.lumpSumMonth, amount: s.lumpSumAmount }] : [];
    var hasExtras = s.extraMonthly > 0 || lumpSums.length > 0 || s.stepUpPercent > 0;

    var plan = hasExtras
      ? buildSchedule({
          principal: cost.loanAmount, annualRate: s.annualRate, months: months,
          stepUpPercent: s.stepUpPercent, extraMonthly: s.extraMonthly,
          lumpSums: lumpSums, strategy: s.strategy
        })
      : base;

    /* Tax relief uses the first twelve months, which is the year a buyer can
       actually plan around. */
    var firstYear = plan.rows.slice(0, 12);
    var y1Interest = firstYear.reduce(function (a, r) { return a + r.interest; }, 0);
    var y1Principal = firstYear.reduce(function (a, r) { return a + r.principal; }, 0);

    return {
      state: s,
      months: months,
      cost: cost,
      ltv: ltvCheck(s.price, cost.loanAmount),
      base: base,
      plan: plan,
      hasExtras: hasExtras,
      comparison: hasExtras ? comparePrepayment(base, plan) : null,
      yearly: yearlySummary(plan.rows),
      tax: taxBenefit({
        interestPaid: y1Interest, principalPaid: y1Principal,
        selfOccupied: s.selfOccupied, regime: s.regime,
        slabPercent: s.slabPercent, other80CUsed: s.other80CUsed,
        claim80EEA: s.claim80EEA
      }),
      eligibility: eligibility({
        monthlyIncome: s.monthlyIncome, existingEmis: s.existingEmis,
        foirPercent: s.foirPercent, annualRate: s.annualRate, months: months
      })
    };
  }

  /* ======================================================================
     Exports
     ====================================================================== */

  global.HomeLoanEngine = {
    MAX_MONTHS: MAX_MONTHS,
    TAX: TAX,
    clampNum: clampNum,
    round2: round2,
    formatINR: formatINR,
    formatShortINR: formatShortINR,
    monthlyRate: monthlyRate,

    emiFor: emiFor,
    monthsForEmi: monthsForEmi,
    principalForEmi: principalForEmi,

    buildSchedule: buildSchedule,
    yearlySummary: yearlySummary,
    comparePrepayment: comparePrepayment,

    taxBenefit: taxBenefit,
    eligibility: eligibility,
    purchaseCost: purchaseCost,
    ltvCheck: ltvCheck,

    scheduleToCSV: scheduleToCSV,
    defaultState: defaultState,
    normalize: normalize,
    computeAll: computeAll
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.HomeLoanEngine;

})(typeof window !== 'undefined' ? window : this);
