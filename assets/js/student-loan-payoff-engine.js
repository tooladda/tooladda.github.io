/* ==========================================================================
   ToolAdda — Student Loan Payoff Calculator (engine)

   Multi-loan payoff and refinance comparison, with no DOM.

   Scope, stated up front because it decides what this file does NOT do:
   this engine models the STANDARD repayment plan, extra payments against it,
   and a private refinance. It deliberately does not model income-driven
   plans, forgiveness timelines or interest subsidies. Those depend on
   statute and regulation that have changed repeatedly and are litigated
   while this is being written; a calculator that hardcodes them is wrong
   within a year and wrong in a way the reader cannot see. The page says so
   in the same words.

   Four things this file is careful about:

   1. THE ROLLOVER. Extra money goes to the highest-rate loan first, and when
      a loan clears, its whole payment joins the attack on the next one. This
      is the same avalanche logic that makes the difference on credit cards,
      and it matters more here because the balances are larger.

   2. REFINANCING IS NOT FREE. Rolling federal loans into a private refinance
      buys a lower rate and gives up income-driven repayment, forgiveness
      eligibility and federal forbearance. The engine quantifies the money
      and flags the loss; it never presents refinancing as strictly better.

   3. A LONGER TERM AT A LOWER RATE CAN COST MORE. The headline of a
      refinance offer is the rate, but stretching 8 remaining years back out
      to 15 can raise total interest even as the rate falls. The comparison
      reports total interest, not just the payment, so that shows.

   4. NON-TERMINATION. A payment at or below the accruing interest never
      retires the balance. Detected before looping, never looped on.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_MONTHS = 40 * 12;
  var CENT = 0.005;

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

  /* The standard annuity payment. */
  function standardPayment(balance, aprPct, years) {
    var n = Math.round(years * 12);
    if (!(balance > 0) || n <= 0) return 0;

    var r = (aprPct / 100) / 12;
    if (r <= 0) return balance / n;

    var factor = Math.pow(1 + r, n);
    return (balance * r * factor) / (factor - 1);
  }

  /* ======================================================================
     2. Loan normalization
     ====================================================================== */

  function normalizeLoan(raw, index) {
    var l = raw && typeof raw === 'object' ? raw : {};

    return {
      id: typeof l.id === 'string' && l.id ? l.id : 'loan-' + (index + 1),
      name: typeof l.name === 'string' && l.name.trim()
        ? l.name.trim().slice(0, 60)
        : 'Loan ' + (index + 1),
      balance: clampNum(l.balance, 0, 1e7, 0),
      aprPct: clampNum(l.aprPct, 0, 40, 0),
      termYears: clampNum(l.termYears, 1, 40, 10),
      /* Federal loans carry protections a refinance would forfeit. Tracking
         which loans are federal is what lets the comparison warn honestly. */
      isFederal: bool(l.isFederal, true)
    };
  }

  function normalizeLoans(list) {
    var arr = Array.isArray(list) ? list : [];
    var out = [];

    for (var i = 0; i < arr.length && i < 20; i++) {
      var loan = normalizeLoan(arr[i], i);
      if (loan.balance > CENT) out.push(loan);
    }
    return out;
  }

  /* ======================================================================
     3. Simulation
     ====================================================================== */

  /* Runs every loan together, month by month.

     Each loan is billed its own standard payment. `extraMonthly` on top is
     directed at the highest-APR loan still outstanding, and a cleared loan's
     payment is added to the attack rather than pocketed. */
  function simulate(loans, extraMonthly, rollPayments) {
    var live = normalizeLoans(loans).map(function (l) {
      return {
        id: l.id, name: l.name, aprPct: l.aprPct, isFederal: l.isFederal,
        balance: l.balance, startBalance: l.balance,
        payment: standardPayment(l.balance, l.aprPct, l.termYears),
        interestPaid: 0, paidOffMonth: 0
      };
    });

    if (!live.length) {
      return { ok: false, reason: 'no-loans', months: 0, totalInterest: 0, loans: [], timeline: [] };
    }

    var extra = clampNum(extraMonthly, 0, 1e6, 0);
    var roll = bool(rollPayments, true);

    /* Guard: with no extra payment, a standard payment at or below the
       accruing interest can never retire the loan. */
    if (extra <= 0) {
      for (var g = 0; g < live.length; g++) {
        var interestNow = live[g].balance * ((live[g].aprPct / 100) / 12);
        if (live[g].payment <= interestNow + CENT) {
          return {
            ok: false, reason: 'payment-too-small', loan: live[g].name,
            months: 0, totalInterest: 0, loans: [], timeline: []
          };
        }
      }
    }

    /* Avalanche order: highest rate first, largest balance breaking ties. */
    var order = live.slice().sort(function (a, b) {
      return (b.aprPct - a.aprPct) || (b.balance - a.balance);
    });

    var timeline = [];
    var totalInterest = 0;
    var month = 0;
    var freed = 0;   /* payments from cleared loans, available to reinvest */

    while (month < MAX_MONTHS) {
      var remaining = live.filter(function (l) { return l.balance > CENT; });
      if (!remaining.length) break;

      month++;
      var pot = extra + (roll ? freed : 0);
      var monthInterest = 0;
      var monthPaid = 0;

      /* Interest, then each loan's own scheduled payment. */
      for (var i = 0; i < remaining.length; i++) {
        var loan = remaining[i];
        var interest = loan.balance * ((loan.aprPct / 100) / 12);

        loan.balance += interest;
        loan.interestPaid += interest;
        monthInterest += interest;
        totalInterest += interest;
      }

      for (var j = 0; j < remaining.length; j++) {
        var l2 = remaining[j];
        if (l2.balance <= CENT) continue;

        var pay = Math.min(l2.payment, l2.balance);
        l2.balance -= pay;
        monthPaid += pay;

        if (l2.balance <= CENT) {
          l2.balance = 0;
          if (!l2.paidOffMonth) { l2.paidOffMonth = month; freed += l2.payment; }
        }
      }

      /* Everything spare attacks the highest rate still standing. */
      for (var k = 0; k < order.length && pot > CENT; k++) {
        var target = order[k];
        if (target.balance <= CENT) continue;

        var hit = Math.min(pot, target.balance);
        target.balance -= hit;
        pot -= hit;
        monthPaid += hit;

        if (target.balance <= CENT) {
          target.balance = 0;
          if (!target.paidOffMonth) { target.paidOffMonth = month; freed += target.payment; }
        }
      }

      var closing = 0;
      for (var m = 0; m < live.length; m++) closing += live[m].balance;

      timeline.push({
        month: month,
        interest: round2(monthInterest),
        paid: round2(monthPaid),
        balance: round2(closing)
      });

      if (closing <= CENT) break;
    }

    if (live.some(function (l) { return l.balance > CENT; })) {
      return { ok: false, reason: 'too-slow', months: month, totalInterest: round2(totalInterest), loans: [], timeline: [] };
    }

    var start = 0;
    for (var p = 0; p < live.length; p++) start += live[p].startBalance;

    return {
      ok: true,
      months: month,
      years: round2(month / 12),
      startBalance: round2(start),
      totalInterest: round2(totalInterest),
      totalPaid: round2(start + totalInterest),
      timeline: timeline,
      loans: live.map(function (l) {
        return {
          id: l.id, name: l.name, aprPct: l.aprPct, isFederal: l.isFederal,
          startBalance: round2(l.startBalance),
          payment: round2(l.payment),
          interestPaid: round2(l.interestPaid),
          paidOffMonth: l.paidOffMonth
        };
      })
    };
  }

  /* ======================================================================
     4. Refinance comparison
     ====================================================================== */

  /* Rolls every loan into one at a new rate and term, and compares the two
     outcomes on money alone — then reports separately what protections the
     borrower would be giving up, because that part is not a number. */
  function refinance(loans, newRatePct, newTermYears, extraMonthly) {
    var list = normalizeLoans(loans);
    if (!list.length) return { ok: false, reason: 'no-loans' };

    var total = 0;
    var federalBalance = 0;
    var weighted = 0;

    for (var i = 0; i < list.length; i++) {
      total += list[i].balance;
      weighted += list[i].balance * list[i].aprPct;
      if (list[i].isFederal) federalBalance += list[i].balance;
    }

    var currentBlendedRate = total > 0 ? weighted / total : 0;
    var rate = clampNum(newRatePct, 0, 40, 0);
    var term = clampNum(newTermYears, 1, 30, 10);

    var refinanced = simulate(
      [{ id: 'refi', name: 'Refinanced loan', balance: total, aprPct: rate, termYears: term, isFederal: false }],
      extraMonthly, true
    );

    return {
      ok: refinanced.ok,
      reason: refinanced.reason,
      consolidatedBalance: round2(total),
      currentBlendedRate: round2(currentBlendedRate),
      newRatePct: round2(rate),
      newTermYears: term,
      rateDrop: round2(currentBlendedRate - rate),
      result: refinanced,
      /* The part that is not money. */
      federalBalanceSurrendered: round2(federalBalance),
      losesFederalProtections: federalBalance > CENT
    };
  }

  /* Puts the three routes side by side. `worthIt` is deliberately about
     total interest, not the monthly payment — a refinance that lowers the
     payment by stretching the term can still cost more overall, and that is
     the trap this comparison exists to expose. */
  function comparePlans(loans, extraMonthly, refiRatePct, refiTermYears) {
    var standard = simulate(loans, 0, true);
    var withExtra = simulate(loans, extraMonthly, true);
    var refi = refinance(loans, refiRatePct, refiTermYears, extraMonthly);

    var out = {
      standard: standard,
      withExtra: withExtra,
      refinance: refi,
      ok: standard.ok
    };

    if (standard.ok && withExtra.ok) {
      out.extraInterestSaved = round2(standard.totalInterest - withExtra.totalInterest);
      out.extraMonthsSaved = standard.months - withExtra.months;
    }

    if (standard.ok && refi.ok && refi.result.ok) {
      out.refiInterestSaved = round2(standard.totalInterest - refi.result.totalInterest);
      out.refiMonthsSaved = standard.months - refi.result.months;
      out.refiWorthItOnMoney = refi.result.totalInterest < standard.totalInterest;
      /* A lower rate that still costs more, because the term got longer. */
      out.refiLongerDespiteLowerRate =
        refi.rateDrop > 0 && refi.result.totalInterest > standard.totalInterest;
    }

    return out;
  }

  /* ======================================================================
     5. Totals and CSV
     ====================================================================== */

  function totals(loans) {
    var list = normalizeLoans(loans);
    var balance = 0, payment = 0, weighted = 0, federal = 0;

    for (var i = 0; i < list.length; i++) {
      balance += list[i].balance;
      payment += standardPayment(list[i].balance, list[i].aprPct, list[i].termYears);
      weighted += list[i].balance * list[i].aprPct;
      if (list[i].isFederal) federal += list[i].balance;
    }

    return {
      count: list.length,
      balance: round2(balance),
      standardPayment: round2(payment),
      blendedRate: balance > 0 ? round2(weighted / balance) : 0,
      federalBalance: round2(federal),
      privateBalance: round2(balance - federal),
      monthlyInterest: round2(list.reduce(function (a, l) {
        return a + l.balance * ((l.aprPct / 100) / 12);
      }, 0))
    };
  }

  function timelineToCSV(timeline) {
    var lines = ['Month,Interest,Paid,Balance'];
    for (var i = 0; i < timeline.length; i++) {
      var t = timeline[i];
      lines.push([t.month, t.interest, t.paid, t.balance].join(','));
    }
    return lines.join('\n');
  }

  /* ======================================================================
     6. State
     ====================================================================== */

  function defaultState() {
    return {
      loans: [
        { id: 'loan-1', name: 'Federal unsubsidized', balance: 21000, aprPct: 6.53, termYears: 10, isFederal: true },
        { id: 'loan-2', name: 'Federal subsidized', balance: 12000, aprPct: 5.5, termYears: 10, isFederal: true },
        { id: 'loan-3', name: 'Private loan', balance: 9000, aprPct: 9.75, termYears: 10, isFederal: false }
      ],
      extraMonthly: 150,
      refiRatePct: 6.0,
      refiTermYears: 10
    };
  }

  function normalize(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var d = defaultState();

    var loans = normalizeLoans(s.loans);
    if (!loans.length) loans = normalizeLoans(d.loans);

    return {
      loans: loans,
      extraMonthly: clampNum(s.extraMonthly, 0, 1e6, d.extraMonthly),
      refiRatePct: clampNum(s.refiRatePct, 0, 40, d.refiRatePct),
      refiTermYears: clampNum(s.refiTermYears, 1, 30, d.refiTermYears)
    };
  }

  function computeAll(raw) {
    var s = normalize(raw);

    return {
      state: s,
      totals: totals(s.loans),
      comparison: comparePlans(s.loans, s.extraMonthly, s.refiRatePct, s.refiTermYears)
    };
  }

  global.StudentLoanPayoffEngine = {
    standardPayment: standardPayment,
    normalizeLoan: normalizeLoan,
    normalizeLoans: normalizeLoans,

    simulate: simulate,
    refinance: refinance,
    comparePlans: comparePlans,

    totals: totals,
    timelineToCSV: timelineToCSV,
    defaultState: defaultState,
    normalize: normalize,
    computeAll: computeAll
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.StudentLoanPayoffEngine;

})(typeof window !== 'undefined' ? window : this);
