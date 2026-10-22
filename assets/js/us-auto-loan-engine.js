/* ==========================================================================
   ToolAdda — US Auto Loan Calculator (engine)

   Vehicle-purchase arithmetic with no DOM, so it can be tested on its own.

   An auto loan is not a mortgage with a shorter term. Four things make the
   US car deal its own problem, and each of them is where a generic loan
   calculator gives the wrong answer:

   1. THE TRADE-IN TAX CREDIT. In most states sales tax is charged on the
      price MINUS the trade-in allowance, so a $10,000 trade-in on a 7% tax
      saves $700 in tax on top of its $10,000 of value. A minority of states
      — California, Virginia, Maryland, Michigan (capped), Hawaii, Kentucky
      and a few others — tax the full price regardless. The difference is
      real money, so it is a flag rather than an assumption.

   2. NEGATIVE EQUITY ROLLS FORWARD. If the trade-in is worth less than the
      loan still owed on it, the shortfall does not disappear — it is added
      to the new loan. That is how a buyer ends up financing more than the
      car costs, and it must show as an increase in the amount financed, not
      be silently clamped away.

   3. FEES ARE NOT ALL TAXABLE. Dealer documentation fees are generally part
      of the taxable sale price; title, registration and licence fees paid to
      the state generally are not. Taxing all of them, or none of them,
      misstates the tax line.

   4. THE TERM IS THE TRAP. A longer term always lowers the payment and
      always raises the total interest, and on a depreciating asset it keeps
      the borrower underwater for longer. compareTerms exists so the page can
      show that trade-off directly rather than describing it.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_MONTHS = 12 * 12;   /* no consumer auto loan runs beyond 12 years */
  var CENT = 0.005;

  var TERMS = [36, 48, 60, 72, 84];

  /* ======================================================================
     1. Helpers
     ====================================================================== */

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function bool(v, fallback) {
    return typeof v === 'boolean' ? v : fallback;
  }

  /* ======================================================================
     2. The deal — what actually gets financed
     ====================================================================== */

  /* Works the purchase from sticker price to amount financed, keeping every
     intermediate figure so the page can show the buyer where the money went.

     Trade equity is deliberately allowed to be negative. A buyer with a
     $12,000 payoff on a car worth $9,000 is $3,000 underwater, and that
     $3,000 has to be financed or paid in cash — hiding it would produce a
     payment the dealer would never quote. */
  function dealBreakdown(input) {
    var price = clampNum(input.vehiclePrice, 0, 1e7, 0);
    var down = clampNum(input.downPayment, 0, 1e7, 0);
    var tradeValue = clampNum(input.tradeInValue, 0, 1e7, 0);
    var tradePayoff = clampNum(input.tradeInPayoff, 0, 1e7, 0);
    var taxPct = clampNum(input.salesTaxPct, 0, 25, 0);
    var docFee = clampNum(input.docFee, 0, 1e5, 0);
    var titleRegFee = clampNum(input.titleRegFee, 0, 1e5, 0);

    var tradeTaxCredit = bool(input.tradeTaxCredit, true);
    var docFeeTaxable = bool(input.docFeeTaxable, true);

    /* The taxable base. The trade-in allowance is deducted only where the
       state allows it, and the deduction cannot take the base below zero. */
    var taxableBase = price + (docFeeTaxable ? docFee : 0);
    if (tradeTaxCredit) taxableBase -= tradeValue;
    if (taxableBase < 0) taxableBase = 0;

    var salesTax = taxableBase * (taxPct / 100);

    /* What the trade-in is actually worth to this deal. */
    var tradeEquity = tradeValue - tradePayoff;
    var negativeEquity = tradeEquity < 0 ? -tradeEquity : 0;

    /* Total cost of the transaction before anything is paid toward it. */
    var totalCost = price + salesTax + docFee + titleRegFee;

    /* Amount financed. Subtracting a negative equity figure correctly adds
       the shortfall to the loan. */
    var financed = totalCost - down - tradeEquity;

    /* A buyer can cover the whole deal in cash. That is not a loan. */
    var overpaid = 0;
    if (financed < 0) {
      overpaid = -financed;
      financed = 0;
    }

    /* The tax the trade-in credit saved, worth showing on its own because
       buyers routinely compare a dealer trade against a private sale. */
    var tradeTaxSaving = tradeTaxCredit
      ? Math.min(tradeValue, price + (docFeeTaxable ? docFee : 0)) * (taxPct / 100)
      : 0;

    return {
      price: round2(price),
      salesTax: round2(salesTax),
      taxableBase: round2(taxableBase),
      docFee: round2(docFee),
      titleRegFee: round2(titleRegFee),
      totalCost: round2(totalCost),

      downPayment: round2(down),
      tradeInValue: round2(tradeValue),
      tradeInPayoff: round2(tradePayoff),
      tradeEquity: round2(tradeEquity),
      negativeEquity: round2(negativeEquity),
      tradeTaxSaving: round2(tradeTaxSaving),

      amountFinanced: round2(financed),
      cashOverpaid: round2(overpaid),
      isUnderwaterTrade: tradeEquity < 0,
      /* Financing more than the car is worth, before it has depreciated a mile. */
      financesMoreThanCar: financed > price + CENT
    };
  }

  /* ======================================================================
     3. Amortization
     ====================================================================== */

  function monthlyPayment(principal, aprPct, months) {
    if (!(principal > 0) || !(months > 0)) return 0;

    var r = (aprPct / 100) / 12;
    if (r <= 0) return principal / months;

    var factor = Math.pow(1 + r, months);
    return (principal * r * factor) / (factor - 1);
  }

  function buildSchedule(principal, aprPct, months, extraMonthly) {
    principal = clampNum(principal, 0, 1e7, 0);
    aprPct = clampNum(aprPct, 0, 60, 0);
    months = Math.round(clampNum(months, 1, MAX_MONTHS, 60));
    extraMonthly = clampNum(extraMonthly, 0, 1e6, 0);

    if (!(principal > 0)) return { ok: false, reason: 'no-loan', rows: [] };

    var base = monthlyPayment(principal, aprPct, months);
    var r = (aprPct / 100) / 12;

    if (r > 0 && extraMonthly <= 0 && base <= principal * r + CENT) {
      return { ok: false, reason: 'payment-too-small', rows: [] };
    }

    var rows = [];
    var balance = principal;
    var totalInterest = 0;

    for (var m = 1; m <= MAX_MONTHS && balance > CENT; m++) {
      var interest = balance * r;
      var scheduled = Math.min(base, balance + interest);
      var principalPart = scheduled - interest;

      var extra = extraMonthly;
      if (principalPart + extra > balance) extra = Math.max(0, balance - principalPart);

      var closing = balance - principalPart - extra;
      if (closing < CENT) {
        principalPart = balance - extra;
        closing = 0;
      }

      totalInterest += interest;

      rows.push({
        month: m,
        payment: round2(principalPart + extra + interest),
        principal: round2(principalPart + extra),
        interest: round2(interest),
        balance: round2(closing)
      });

      balance = closing;
    }

    if (balance > CENT) return { ok: false, reason: 'payment-too-small', rows: [] };

    /* Settle display rounding into the final row so the principal column
       sums to the amount financed exactly. */
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
      monthlyPayment: round2(base),
      totalInterest: round2(totalInterest),
      totalPaid: round2(principal + totalInterest)
    };
  }

  /* ======================================================================
     4. Term comparison — the point of the page
     ====================================================================== */

  /* The same amount financed across the standard US terms. A longer term
     always lowers the payment and always costs more in total; showing both
     columns side by side is the only honest way to present it. */
  function compareTerms(principal, aprPct, terms) {
    var list = terms && terms.length ? terms : TERMS;
    var out = [];

    for (var i = 0; i < list.length; i++) {
      var months = list[i];
      var payment = monthlyPayment(principal, aprPct, months);
      var total = payment * months;

      out.push({
        months: months,
        years: round2(months / 12),
        monthlyPayment: round2(payment),
        totalInterest: round2(total - principal),
        totalPaid: round2(total)
      });
    }
    return out;
  }

  /* ======================================================================
     5. Underwater analysis
     ====================================================================== */

  /* A car loses value faster than the loan retires principal, so for part of
     the term the borrower owes more than the car is worth. That gap is what
     gap insurance covers, and knowing when it closes is the single most
     useful thing this page can tell a buyer.

     The depreciation model is deliberately simple and stated on the page: a
     larger first-year drop, then a flat annual rate. Real depreciation
     varies by make, mileage and market, so the rates are inputs, not
     constants baked into the answer. */
  function underwaterAnalysis(rows, vehicleValue, firstYearDropPct, annualDropPct) {
    if (!rows || !rows.length || !(vehicleValue > 0)) {
      return { ok: false, months: 0 };
    }

    var firstYear = clampNum(firstYearDropPct, 0, 90, 20) / 100;
    var annual = clampNum(annualDropPct, 0, 90, 15) / 100;

    var worstGap = 0;
    var worstMonth = 0;
    var firstUnderMonth = 0;
    var lastUnderIndex = -1;
    var series = [];

    for (var i = 0; i < rows.length; i++) {
      var month = rows[i].month;
      var yearsElapsed = month / 12;

      /* First year uses the steeper drop; later years compound the flat rate
         on top of the post-first-year value. */
      var value;
      if (yearsElapsed <= 1) {
        value = vehicleValue * (1 - firstYear * yearsElapsed);
      } else {
        value = vehicleValue * (1 - firstYear) * Math.pow(1 - annual, yearsElapsed - 1);
      }

      var gap = rows[i].balance - value;

      series.push({
        month: month,
        value: round2(Math.max(0, value)),
        balance: rows[i].balance,
        gap: round2(gap)
      });

      if (gap > worstGap) { worstGap = gap; worstMonth = month; }
      if (gap > 0) {
        if (!firstUnderMonth) firstUnderMonth = month;
        lastUnderIndex = i;
      }
    }

    /* A loan with some cash down usually starts above water, dips under as the
       car loses its first-year value, then climbs back out. The crossover is
       the month after the LAST underwater month - not the first month the
       balance sits below the value, which would be month 1 in that case. */
    var crossoverMonth = 0;
    if (lastUnderIndex >= 0 && lastUnderIndex < rows.length - 1) {
      crossoverMonth = rows[lastUnderIndex + 1].month;
    }

    return {
      ok: true,
      series: series,
      worstGap: round2(worstGap),
      worstMonth: worstMonth,
      /* First month the balance is above the car's value (0 = never). */
      firstUnderwaterMonth: firstUnderMonth,
      /* Month the loan balance falls below the car's value for good. Zero
         means it never does within the term — underwater to the end - or
         that the loan is never underwater at all (see everUnderwater). */
      crossoverMonth: crossoverMonth,
      everUnderwater: worstGap > 0,
      underwaterToEnd: crossoverMonth === 0 && worstGap > 0
    };
  }

  /* ======================================================================
     6. CSV
     ====================================================================== */

  function scheduleToCSV(rows) {
    var lines = ['Month,Payment,Principal,Interest,Balance'];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push([r.month, r.payment, r.principal, r.interest, r.balance].join(','));
    }
    return lines.join('\n');
  }

  /* ======================================================================
     7. State
     ====================================================================== */

  function defaultState() {
    return {
      vehiclePrice: 32000,
      downPayment: 4000,
      tradeInValue: 0,
      tradeInPayoff: 0,
      salesTaxPct: 6.5,
      tradeTaxCredit: true,
      docFee: 400,
      docFeeTaxable: true,
      titleRegFee: 350,
      aprPct: 7.5,
      months: 60,
      extraMonthly: 0,
      firstYearDropPct: 20,
      annualDropPct: 15
    };
  }

  function normalize(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var d = defaultState();

    return {
      vehiclePrice: clampNum(s.vehiclePrice, 0, 1e7, d.vehiclePrice),
      downPayment: clampNum(s.downPayment, 0, 1e7, d.downPayment),
      tradeInValue: clampNum(s.tradeInValue, 0, 1e7, d.tradeInValue),
      tradeInPayoff: clampNum(s.tradeInPayoff, 0, 1e7, d.tradeInPayoff),
      salesTaxPct: clampNum(s.salesTaxPct, 0, 25, d.salesTaxPct),
      tradeTaxCredit: bool(s.tradeTaxCredit, d.tradeTaxCredit),
      docFee: clampNum(s.docFee, 0, 1e5, d.docFee),
      docFeeTaxable: bool(s.docFeeTaxable, d.docFeeTaxable),
      titleRegFee: clampNum(s.titleRegFee, 0, 1e5, d.titleRegFee),
      aprPct: clampNum(s.aprPct, 0, 60, d.aprPct),
      months: Math.round(clampNum(s.months, 1, MAX_MONTHS, d.months)),
      extraMonthly: clampNum(s.extraMonthly, 0, 1e6, d.extraMonthly),
      firstYearDropPct: clampNum(s.firstYearDropPct, 0, 90, d.firstYearDropPct),
      annualDropPct: clampNum(s.annualDropPct, 0, 90, d.annualDropPct)
    };
  }

  function computeAll(raw) {
    var s = normalize(raw);
    var deal = dealBreakdown(s);

    var schedule = buildSchedule(deal.amountFinanced, s.aprPct, s.months, s.extraMonthly);
    var baseline = s.extraMonthly > 0
      ? buildSchedule(deal.amountFinanced, s.aprPct, s.months, 0)
      : schedule;

    var terms = compareTerms(deal.amountFinanced, s.aprPct, TERMS);

    var underwater = schedule.ok
      ? underwaterAnalysis(schedule.rows, s.vehiclePrice, s.firstYearDropPct, s.annualDropPct)
      : { ok: false };

    /* Total cost of ownership of the financing decision, not of the car. */
    var outOfPocket = schedule.ok
      ? round2(s.downPayment + schedule.totalPaid)
      : 0;

    return {
      state: s,
      deal: deal,
      schedule: schedule,
      baseline: baseline,
      terms: terms,
      underwater: underwater,
      outOfPocket: outOfPocket,
      interestSaved: (s.extraMonthly > 0 && schedule.ok && baseline.ok)
        ? round2(baseline.totalInterest - schedule.totalInterest)
        : 0,
      monthsSaved: (s.extraMonthly > 0 && schedule.ok && baseline.ok)
        ? baseline.months - schedule.months
        : 0
    };
  }

  global.USAutoLoanEngine = {
    TERMS: TERMS,

    dealBreakdown: dealBreakdown,
    monthlyPayment: monthlyPayment,
    buildSchedule: buildSchedule,
    compareTerms: compareTerms,
    underwaterAnalysis: underwaterAnalysis,

    scheduleToCSV: scheduleToCSV,
    defaultState: defaultState,
    normalize: normalize,
    computeAll: computeAll
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.USAutoLoanEngine;

})(typeof window !== 'undefined' ? window : this);
