/* ==========================================================================
   ToolAdda — US Mortgage Calculator (engine)

   All the mortgage arithmetic, with no DOM, so it can be tested on its own.

   A US mortgage is not one number. The payment a lender quotes is P&I, but
   the money that actually leaves the account every month is PITI: principal,
   interest, property tax, homeowners insurance — plus HOA dues and, until it
   falls away, mortgage insurance. Calculators that show only P&I understate
   the real cost by 25-40% on a typical loan, which is why this engine treats
   PITI as the headline figure and P&I as a component of it.

   Five things this file is careful about, because they are where mortgage
   calculators quietly go wrong:

   1. A LOAN THAT NEVER ENDS. If the payment is smaller than the first
      month's interest, the balance grows every month and a naive
      `while (balance > 0)` loop hangs the tab. buildSchedule detects this
      before looping and reports it instead.

   2. THE LAST PAYMENT. Floating point means the balance after the final
      scheduled payment is never exactly zero. The last payment is adjusted
      to settle the balance precisely, so the principal components sum to
      the amount borrowed to the cent.

   3. PMI TERMINATION IS A DATE, NOT A RATE. Under the Homeowners Protection
      Act, PMI on a borrower-paid conventional loan must terminate
      automatically once the balance reaches 78% of the ORIGINAL value, and
      the borrower may request cancellation at 80%. Both thresholds run off
      the original value and the amortization schedule — not off today's
      market value — so extra payments genuinely pull the drop-off date
      forward. Charging PMI for the whole term, as many calculators do,
      overstates the cost of every low-down-payment loan.

   4. EXTRA PAYMENTS THAT OVERSHOOT. A payment larger than the outstanding
      balance must close the loan, not drive the balance negative.

   5. THE 28/36 RULE IS TWO RATIOS. The front-end ratio tests PITI alone
      against gross income; the back-end ratio adds every other monthly debt.
      A borrower can pass one and fail the other, so both are reported.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_MONTHS = 40 * 12;   /* upper bound on any schedule we will build */
  var CENT = 0.005;           /* anything under half a cent is settled     */

  /* PMI thresholds are fractions of the ORIGINAL property value, per HPA. */
  var PMI_REQUEST_LTV = 0.80; /* borrower may ask for cancellation here    */
  var PMI_AUTO_LTV = 0.78;    /* servicer must terminate automatically     */

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

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /* ======================================================================
     2. Core amortization
     ====================================================================== */

  /* The standard annuity payment. Guarded for the 0% case, which the
     closed form cannot express (it divides by zero). */
  function monthlyPI(principal, annualRatePct, years) {
    var n = Math.round(years * 12);
    if (!(principal > 0) || n <= 0) return 0;

    var r = (annualRatePct / 100) / 12;
    if (r <= 0) return principal / n;

    var factor = Math.pow(1 + r, n);
    return (principal * r * factor) / (factor - 1);
  }

  /* The inverse: how much can be borrowed for a given monthly P&I. */
  function principalForPayment(payment, annualRatePct, years) {
    var n = Math.round(years * 12);
    if (!(payment > 0) || n <= 0) return 0;

    var r = (annualRatePct / 100) / 12;
    if (r <= 0) return payment * n;

    var factor = Math.pow(1 + r, n);
    return payment * (factor - 1) / (r * factor);
  }

  /* Build the month-by-month schedule.

     `extraMonthly` is applied to principal on every payment. `extraOneTime`
     is applied once, in `extraOneTimeMonth`. Both can pull the payoff date
     forward and, on a low-down-payment loan, pull the PMI drop-off with it.

     Returns { ok:false, reason } rather than throwing, because a payment
     below the monthly interest is a legitimate thing for a user to type
     while dragging a slider — it is not an exceptional condition. */
  function buildSchedule(input) {
    var principal = clampNum(input.principal, 0, 1e9, 0);
    var annualRatePct = clampNum(input.annualRatePct, 0, 100, 0);
    var years = clampNum(input.years, 0, 40, 30);
    var extraMonthly = clampNum(input.extraMonthly, 0, 1e7, 0);
    var extraOneTime = clampNum(input.extraOneTime, 0, 1e9, 0);
    var extraOneTimeMonth = Math.round(clampNum(input.extraOneTimeMonth, 1, MAX_MONTHS, 1));

    /* PMI inputs. originalValue is the figure both HPA thresholds run off. */
    var originalValue = clampNum(input.originalValue, 0, 1e9, 0);
    var pmiAnnualPct = clampNum(input.pmiAnnualPct, 0, 5, 0);

    var n = Math.round(years * 12);
    if (!(principal > 0) || n <= 0) {
      return { ok: false, reason: 'no-loan', rows: [] };
    }

    var basePayment = monthlyPI(principal, annualRatePct, years);
    var r = (annualRatePct / 100) / 12;

    /* Non-termination guard: with no extra payment, a scheduled payment at
       or below the first month's interest can never retire the balance. */
    if (r > 0 && extraMonthly <= 0 && extraOneTime <= 0) {
      if (basePayment <= principal * r + CENT) {
        return { ok: false, reason: 'payment-too-small', rows: [] };
      }
    }

    /* Monthly PMI is charged on the ORIGINAL loan amount, not the current
       balance — that is how servicers actually bill it. */
    var pmiMonthly = pmiAnnualPct > 0 ? (principal * (pmiAnnualPct / 100)) / 12 : 0;
    var pmiRequestBalance = originalValue > 0 ? originalValue * PMI_REQUEST_LTV : 0;
    var pmiAutoBalance = originalValue > 0 ? originalValue * PMI_AUTO_LTV : 0;

    var rows = [];
    var balance = principal;
    var totalInterest = 0;
    var totalPMI = 0;
    var totalExtra = 0;
    var pmiRequestMonth = 0;   /* first month balance <= 80% of value */
    var pmiAutoMonth = 0;      /* first month balance <= 78% of value */

    for (var month = 1; month <= MAX_MONTHS && balance > CENT; month++) {
      var interest = balance * r;

      /* PMI is charged only while the balance is above the auto-termination
         threshold. Charged before this month's principal is applied, which
         matches how a servicer bills the month. */
      var pmiThisMonth = 0;
      if (pmiMonthly > 0 && originalValue > 0 && balance > pmiAutoBalance + CENT) {
        pmiThisMonth = pmiMonthly;
      }

      var scheduled = Math.min(basePayment, balance + interest);
      var principalPart = scheduled - interest;

      var extra = extraMonthly;
      if (month === extraOneTimeMonth) extra += extraOneTime;
      /* Never pay more principal than is outstanding. */
      if (principalPart + extra > balance) extra = Math.max(0, balance - principalPart);

      var closing = balance - principalPart - extra;
      /* Settle a trailing sub-cent balance into this row rather than
         emitting a final row for a fraction of a cent. */
      if (closing < CENT) {
        principalPart = balance - extra;
        closing = 0;
      }

      totalInterest += interest;
      totalPMI += pmiThisMonth;
      totalExtra += extra;

      rows.push({
        month: month,
        payment: round2(principalPart + extra + interest),
        principal: round2(principalPart + extra),
        interest: round2(interest),
        extra: round2(extra),
        pmi: round2(pmiThisMonth),
        balance: round2(closing)
      });

      if (!pmiRequestMonth && pmiRequestBalance > 0 && closing <= pmiRequestBalance + CENT) {
        pmiRequestMonth = month;
      }
      if (!pmiAutoMonth && pmiAutoBalance > 0 && closing <= pmiAutoBalance + CENT) {
        pmiAutoMonth = month;
      }

      balance = closing;
    }

    if (balance > CENT) {
      return { ok: false, reason: 'payment-too-small', rows: [] };
    }

    /* Each row is rounded to cents for display, and 360 roundings drift by a
       few cents against the amount borrowed. The internal balance is exact,
       but a reader who sums the principal column expects it to equal the
       loan — so the residue is settled into the final row. */
    if (rows.length) {
      var shown = 0;
      for (var q = 0; q < rows.length; q++) shown += rows[q].principal;

      var residue = round2(principal - shown);
      if (residue !== 0) {
        var last = rows[rows.length - 1];
        last.principal = round2(last.principal + residue);
        last.payment = round2(last.payment + residue);
      }
    }

    return {
      ok: true,
      rows: rows,
      months: rows.length,
      basePayment: round2(basePayment),
      totalInterest: round2(totalInterest),
      totalPMI: round2(totalPMI),
      totalExtra: round2(totalExtra),
      totalPaid: round2(principal + totalInterest + totalPMI),
      pmiMonthly: round2(pmiMonthly),
      pmiRequestMonth: pmiRequestMonth,
      pmiAutoMonth: pmiAutoMonth
    };
  }

  /* Collapse a schedule into calendar-year style buckets of 12 months, for
     a table that opens a year at a time rather than listing 360 rows. */
  function yearlySummary(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i += 12) {
      var slice = rows.slice(i, i + 12);
      var principal = 0, interest = 0, pmi = 0;

      for (var j = 0; j < slice.length; j++) {
        principal += slice[j].principal;
        interest += slice[j].interest;
        pmi += slice[j].pmi;
      }

      out.push({
        year: (i / 12) + 1,
        months: slice,
        principal: round2(principal),
        interest: round2(interest),
        pmi: round2(pmi),
        balance: slice[slice.length - 1].balance
      });
    }
    return out;
  }

  /* ======================================================================
     3. PITI — what actually leaves the account
     ====================================================================== */

  /* Property tax and insurance are entered as annual dollars OR as a
     percentage of home value; whichever the caller supplies. Escrow is the
     sum of the monthly twelfths. */
  function monthlyEscrow(input) {
    var homeValue = clampNum(input.homeValue, 0, 1e9, 0);

    var taxAnnual = input.taxMode === 'percent'
      ? homeValue * (clampNum(input.taxPct, 0, 20, 0) / 100)
      : clampNum(input.taxAnnual, 0, 1e7, 0);

    var insAnnual = input.insuranceMode === 'percent'
      ? homeValue * (clampNum(input.insurancePct, 0, 20, 0) / 100)
      : clampNum(input.insuranceAnnual, 0, 1e7, 0);

    return {
      taxAnnual: round2(taxAnnual),
      taxMonthly: round2(taxAnnual / 12),
      insuranceAnnual: round2(insAnnual),
      insuranceMonthly: round2(insAnnual / 12),
      hoaMonthly: round2(clampNum(input.hoaMonthly, 0, 1e5, 0))
    };
  }

  /* ======================================================================
     4. Affordability — the 28/36 rule
     ====================================================================== */

  /* Front-end: PITI against gross monthly income, conventionally 28%.
     Back-end: PITI plus all other monthly debt, conventionally 36%.
     Both are guidelines, not law — lenders routinely approve above them
     with compensating factors, which is why this reports the ratios rather
     than a yes/no verdict. */
  function affordability(pitiMonthly, grossMonthlyIncome, otherMonthlyDebt) {
    var income = clampNum(grossMonthlyIncome, 0, 1e7, 0);
    var debts = clampNum(otherMonthlyDebt, 0, 1e7, 0);
    var piti = clampNum(pitiMonthly, 0, 1e7, 0);

    if (!(income > 0)) {
      return { ok: false, frontEnd: 0, backEnd: 0, passesFront: false, passesBack: false };
    }

    var frontEnd = (piti / income) * 100;
    var backEnd = ((piti + debts) / income) * 100;

    return {
      ok: true,
      frontEnd: round2(frontEnd),
      backEnd: round2(backEnd),
      passesFront: frontEnd <= 28,
      passesBack: backEnd <= 36,
      /* The largest PITI that would still clear both rules. */
      maxPitiFront: round2(income * 0.28),
      maxPitiBack: round2(Math.max(0, income * 0.36 - debts))
    };
  }

  /* ======================================================================
     5. Extra-payment comparison
     ====================================================================== */

  /* Same loan, with and without the extra payment, so the page can state
     the saving as a single sentence. */
  function compareExtra(base, withExtra) {
    if (!base.ok || !withExtra.ok) return { ok: false };

    return {
      ok: true,
      monthsSaved: base.months - withExtra.months,
      interestSaved: round2(base.totalInterest - withExtra.totalInterest),
      pmiSaved: round2(base.totalPMI - withExtra.totalPMI),
      totalSaved: round2(
        (base.totalInterest + base.totalPMI) - (withExtra.totalInterest + withExtra.totalPMI)
      )
    };
  }

  /* ======================================================================
     6. CSV export
     ====================================================================== */

  function scheduleToCSV(rows) {
    var lines = ['Month,Payment,Principal,Interest,Extra,PMI,Balance'];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push([r.month, r.payment, r.principal, r.interest, r.extra, r.pmi, r.balance].join(','));
    }
    return lines.join('\n');
  }

  /* ======================================================================
     7. State
     ====================================================================== */

  function defaultState() {
    return {
      homeValue: 420000,
      downPayment: 42000,
      downMode: 'amount',        /* 'amount' | 'percent' */
      downPercent: 10,
      annualRatePct: 6.5,
      years: 30,

      taxMode: 'percent',        /* 'percent' | 'amount' */
      taxPct: 1.1,
      taxAnnual: 4620,

      insuranceMode: 'amount',
      insurancePct: 0.35,
      insuranceAnnual: 1800,

      hoaMonthly: 0,
      pmiAnnualPct: 0.6,

      extraMonthly: 0,
      extraOneTime: 0,
      extraOneTimeMonth: 12,

      grossMonthlyIncome: 9000,
      otherMonthlyDebt: 650
    };
  }

  function normalize(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var d = defaultState();

    var homeValue = clampNum(s.homeValue, 0, 1e9, d.homeValue);
    var downMode = oneOf(s.downMode, ['amount', 'percent'], d.downMode);
    var downPercent = clampNum(s.downPercent, 0, 100, d.downPercent);
    var downPayment = downMode === 'percent'
      ? homeValue * (downPercent / 100)
      : clampNum(s.downPayment, 0, 1e9, d.downPayment);

    /* A down payment larger than the home is not a loan. */
    if (downPayment > homeValue) downPayment = homeValue;

    return {
      homeValue: homeValue,
      downPayment: round2(downPayment),
      downMode: downMode,
      downPercent: downPercent,
      annualRatePct: clampNum(s.annualRatePct, 0, 30, d.annualRatePct),
      years: clampNum(s.years, 1, 40, d.years),

      taxMode: oneOf(s.taxMode, ['percent', 'amount'], d.taxMode),
      taxPct: clampNum(s.taxPct, 0, 20, d.taxPct),
      taxAnnual: clampNum(s.taxAnnual, 0, 1e7, d.taxAnnual),

      insuranceMode: oneOf(s.insuranceMode, ['percent', 'amount'], d.insuranceMode),
      insurancePct: clampNum(s.insurancePct, 0, 20, d.insurancePct),
      insuranceAnnual: clampNum(s.insuranceAnnual, 0, 1e7, d.insuranceAnnual),

      hoaMonthly: clampNum(s.hoaMonthly, 0, 1e5, d.hoaMonthly),
      pmiAnnualPct: clampNum(s.pmiAnnualPct, 0, 5, d.pmiAnnualPct),

      extraMonthly: clampNum(s.extraMonthly, 0, 1e7, d.extraMonthly),
      extraOneTime: clampNum(s.extraOneTime, 0, 1e9, d.extraOneTime),
      extraOneTimeMonth: Math.round(clampNum(s.extraOneTimeMonth, 1, MAX_MONTHS, d.extraOneTimeMonth)),

      grossMonthlyIncome: clampNum(s.grossMonthlyIncome, 0, 1e7, d.grossMonthlyIncome),
      otherMonthlyDebt: clampNum(s.otherMonthlyDebt, 0, 1e7, d.otherMonthlyDebt)
    };
  }

  /* ======================================================================
     8. Everything, once
     ====================================================================== */

  function computeAll(raw) {
    var s = normalize(raw);

    var principal = round2(s.homeValue - s.downPayment);
    var ltv = s.homeValue > 0 ? (principal / s.homeValue) * 100 : 0;
    var downPercentActual = s.homeValue > 0 ? (s.downPayment / s.homeValue) * 100 : 0;

    /* PMI applies only above 80% LTV on a conventional loan. Below that,
       whatever rate the user typed is irrelevant. */
    var pmiApplies = ltv > PMI_REQUEST_LTV * 100 + 1e-9;
    var pmiRate = pmiApplies ? s.pmiAnnualPct : 0;

    var loanInput = {
      principal: principal,
      annualRatePct: s.annualRatePct,
      years: s.years,
      originalValue: s.homeValue,
      pmiAnnualPct: pmiRate
    };

    var base = buildSchedule(loanInput);

    var extraInput = {};
    for (var k in loanInput) if (Object.prototype.hasOwnProperty.call(loanInput, k)) extraInput[k] = loanInput[k];
    extraInput.extraMonthly = s.extraMonthly;
    extraInput.extraOneTime = s.extraOneTime;
    extraInput.extraOneTimeMonth = s.extraOneTimeMonth;

    var hasExtra = s.extraMonthly > 0 || s.extraOneTime > 0;
    var withExtra = hasExtra ? buildSchedule(extraInput) : base;

    var escrow = monthlyEscrow(s);
    var active = withExtra.ok ? withExtra : base;

    var principalInterest = base.ok ? base.basePayment : 0;
    var pmiMonthly = base.ok ? base.pmiMonthly : 0;

    var pitiNow = round2(
      principalInterest + escrow.taxMonthly + escrow.insuranceMonthly + escrow.hoaMonthly + pmiMonthly
    );
    /* What the payment settles to once PMI falls away. */
    var pitiAfterPMI = round2(
      principalInterest + escrow.taxMonthly + escrow.insuranceMonthly + escrow.hoaMonthly
    );

    return {
      state: s,
      principal: principal,
      ltv: round2(ltv),
      downPercentActual: round2(downPercentActual),
      pmiApplies: pmiApplies,

      base: base,
      withExtra: withExtra,
      active: active,
      comparison: hasExtra ? compareExtra(base, withExtra) : { ok: false },

      escrow: escrow,
      principalInterest: round2(principalInterest),
      pmiMonthly: round2(pmiMonthly),
      pitiNow: pitiNow,
      pitiAfterPMI: pitiAfterPMI,

      affordability: affordability(pitiNow, s.grossMonthlyIncome, s.otherMonthlyDebt),
      years: yearlySummary(active.ok ? active.rows : [])
    };
  }

  global.USMortgageEngine = {
    PMI_REQUEST_LTV: PMI_REQUEST_LTV,
    PMI_AUTO_LTV: PMI_AUTO_LTV,

    monthlyPI: monthlyPI,
    principalForPayment: principalForPayment,

    buildSchedule: buildSchedule,
    yearlySummary: yearlySummary,
    monthlyEscrow: monthlyEscrow,
    affordability: affordability,
    compareExtra: compareExtra,

    scheduleToCSV: scheduleToCSV,
    defaultState: defaultState,
    normalize: normalize,
    computeAll: computeAll
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.USMortgageEngine;

})(typeof window !== 'undefined' ? window : this);
