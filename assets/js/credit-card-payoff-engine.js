/* ==========================================================================
   ToolAdda — Credit Card Payoff Calculator (engine)

   Multi-card payoff simulation with no DOM, so it can be tested on its own.

   The question this answers is not "what is my payment" — the card issuer
   sets that. It is "if I can put $X a month against these cards, which order
   should I pay them in, and what does that choice cost me". Two orderings
   are in common use and they genuinely differ:

     AVALANCHE  — every spare dollar goes to the highest APR first.
                  Mathematically optimal: always the least total interest.
     SNOWBALL   — every spare dollar goes to the smallest balance first.
                  Costs more, but closes accounts sooner, and the evidence
                  on people actually finishing is why it persists.

   Four things this file is careful about:

   1. THE ROLLOVER IS THE WHOLE POINT. When a card is cleared, the minimum
      that card was absorbing does not vanish — it joins the pot attacking
      the next card. A simulation that keeps paying a fixed amount per card
      misses the compounding that gives both strategies their name.

   2. A BUDGET THAT NEVER WINS. If the monthly budget is below the total
      minimums, or below the total interest accruing, the balances grow
      forever. A `while (balance > 0)` loop would hang. Both cases are
      detected before looping and reported.

   3. NEVER OVERPAY A CARD. A payment larger than the balance plus this
      month's interest must settle the card and cascade the remainder to the
      next target, not drive the balance negative.

   4. THE MINIMUM IS A FLOOR AND A PERCENTAGE. US issuers bill the greater of
      a flat floor (commonly $25-$35) and a percentage of the balance. As the
      balance falls the percentage shrinks below the floor, which is why a
      minimum-only payoff drags on for decades.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_MONTHS = 60 * 12;   /* 60 years — far past any real payoff */
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

  /* The billed minimum.

     Two formulas are in real use, and the difference decides whether the
     card can ever be paid off at all:

       'interest_plus_percent'  max(floor, interest + pct% of balance)
                                The modern US standard. Because interest is
                                covered before any percentage is added, the
                                balance always falls. Typical pct is 1%.

       'percent_of_balance'     max(floor, pct% of balance)
                                The older flat rule, still used by some
                                issuers and store cards. Typical pct is 2%.
                                At a high APR this can be LESS than the
                                interest — a 2% minimum against a 27.99% APR
                                bills 2% while 2.33% accrues — and the
                                balance grows every month no matter how long
                                the cardholder pays. That is not a bug in
                                this function; it is the trap the page exists
                                to show, so it is reproduced faithfully and
                                detected by the caller.

     Never more than what would clear the card this month. */
  function minimumPayment(balance, aprPct, minPct, minFloor, minMode) {
    if (!(balance > CENT)) return 0;

    var interest = balance * ((aprPct / 100) / 12);
    var pct = balance * (minPct / 100);

    var min = minMode === 'percent_of_balance'
      ? Math.max(minFloor, pct)
      : Math.max(minFloor, interest + pct);

    return Math.min(min, balance + interest);
  }

  /* ======================================================================
     2. Card normalization
     ====================================================================== */

  function normalizeCard(raw, index) {
    var c = raw && typeof raw === 'object' ? raw : {};

    return {
      id: typeof c.id === 'string' && c.id ? c.id : 'card-' + (index + 1),
      name: typeof c.name === 'string' && c.name.trim()
        ? c.name.trim().slice(0, 60)
        : 'Card ' + (index + 1),
      balance: clampNum(c.balance, 0, 1e7, 0),
      aprPct: clampNum(c.aprPct, 0, 100, 0),
      minPct: clampNum(c.minPct, 0, 100, 1),
      minFloor: clampNum(c.minFloor, 0, 1e5, 25),
      minMode: c.minMode === 'percent_of_balance' ? 'percent_of_balance' : 'interest_plus_percent'
    };
  }

  function normalizeCards(list) {
    var arr = Array.isArray(list) ? list : [];
    var out = [];

    for (var i = 0; i < arr.length && i < 20; i++) {
      var card = normalizeCard(arr[i], i);
      if (card.balance > CENT) out.push(card);
    }
    return out;
  }

  /* ======================================================================
     3. Ordering
     ====================================================================== */

  /* Both orderings break ties the same way — by the other strategy's key —
     so the result is deterministic rather than dependent on input order. */
  function orderCards(cards, strategy) {
    var copy = cards.slice();

    if (strategy === 'snowball') {
      copy.sort(function (a, b) {
        return (a.balance - b.balance) || (b.aprPct - a.aprPct);
      });
    } else if (strategy === 'avalanche') {
      copy.sort(function (a, b) {
        return (b.aprPct - a.aprPct) || (a.balance - b.balance);
      });
    }
    /* 'minimum' keeps the user's own order — nothing is prioritised. */
    return copy;
  }

  /* ======================================================================
     4. Simulation
     ====================================================================== */

  /* Runs the payoff month by month.

     Every month: interest accrues on each card, the billed minimum is paid
     on each, and whatever is left of the budget is thrown at the priority
     card. As cards clear, their minimums stop being spent and the whole
     budget concentrates on what remains. */
  function simulate(cards, monthlyBudget, strategy) {
    var live = orderCards(cards, strategy).map(function (c) {
      return {
        id: c.id, name: c.name, aprPct: c.aprPct,
        minPct: c.minPct, minFloor: c.minFloor, minMode: c.minMode,
        balance: c.balance, startBalance: c.balance,
        statementBalance: c.balance,
        interestPaid: 0, paidOffMonth: 0
      };
    });

    if (!live.length) {
      return { ok: false, reason: 'no-cards', months: 0, totalInterest: 0, cards: [], timeline: [] };
    }

    var budget = clampNum(monthlyBudget, 0, 1e7, 0);

    /* Guard 1: the budget cannot even cover the billed minimums. */
    var minsNow = 0;
    for (var a = 0; a < live.length; a++) {
      minsNow += minimumPayment(live[a].balance, live[a].aprPct, live[a].minPct, live[a].minFloor, live[a].minMode);
    }
    if (budget + CENT < minsNow) {
      return {
        ok: false, reason: 'below-minimums',
        requiredMinimum: round2(minsNow), months: 0,
        totalInterest: 0, cards: [], timeline: []
      };
    }

    /* Guard 2: the budget does not even cover the interest, so the debt
       grows every month no matter how it is ordered. */
    var interestNow = 0;
    for (var b = 0; b < live.length; b++) {
      interestNow += live[b].balance * ((live[b].aprPct / 100) / 12);
    }
    if (budget <= interestNow + CENT) {
      return {
        ok: false, reason: 'below-interest',
        monthlyInterest: round2(interestNow), months: 0,
        totalInterest: 0, cards: [], timeline: []
      };
    }

    var timeline = [];
    var totalInterest = 0;
    var month = 0;

    while (month < MAX_MONTHS) {
      var remaining = live.filter(function (c) { return c.balance > CENT; });
      if (!remaining.length) break;

      month++;
      var pot = budget;
      var monthInterest = 0;
      var monthPaid = 0;

      /* Interest first, then the billed minimum on every live card. The
         statement balance the minimum is computed from is the one BEFORE
         this month's interest is added, so it is captured here rather than
         reconstructed by dividing it back out afterwards. */
      for (var i = 0; i < remaining.length; i++) {
        var card = remaining[i];
        var interest = card.balance * ((card.aprPct / 100) / 12);

        card.statementBalance = card.balance;
        card.balance += interest;
        card.interestPaid += interest;
        monthInterest += interest;
        totalInterest += interest;
      }

      for (var j = 0; j < remaining.length; j++) {
        var c2 = remaining[j];
        if (c2.balance <= CENT) continue;

        var due = minimumPayment(
          c2.statementBalance, c2.aprPct, c2.minPct, c2.minFloor, c2.minMode
        );

        var pay = Math.min(due, c2.balance, pot);
        c2.balance -= pay;
        pot -= pay;
        monthPaid += pay;

        if (c2.balance <= CENT) { c2.balance = 0; if (!c2.paidOffMonth) c2.paidOffMonth = month; }
      }

      /* Everything left attacks the priority card, cascading as cards clear. */
      for (var k = 0; k < live.length && pot > CENT; k++) {
        var target = live[k];
        if (target.balance <= CENT) continue;

        var extra = Math.min(pot, target.balance);
        target.balance -= extra;
        pot -= extra;
        monthPaid += extra;

        if (target.balance <= CENT) { target.balance = 0; if (!target.paidOffMonth) target.paidOffMonth = month; }
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

    var unpaid = live.some(function (c) { return c.balance > CENT; });
    if (unpaid) {
      return { ok: false, reason: 'too-slow', months: month, totalInterest: round2(totalInterest), cards: [], timeline: [] };
    }

    var totalPaid = 0;
    for (var p = 0; p < live.length; p++) totalPaid += live[p].startBalance;

    return {
      ok: true,
      strategy: strategy,
      months: month,
      years: round2(month / 12),
      totalInterest: round2(totalInterest),
      totalPaid: round2(totalPaid + totalInterest),
      startBalance: round2(totalPaid),
      timeline: timeline,
      cards: live.map(function (c) {
        return {
          id: c.id, name: c.name, aprPct: c.aprPct,
          startBalance: round2(c.startBalance),
          interestPaid: round2(c.interestPaid),
          paidOffMonth: c.paidOffMonth
        };
      })
    };
  }

  /* ======================================================================
     5. Strategy comparison
     ====================================================================== */

  /* The three runs the page shows side by side. Avalanche is the benchmark
     because it is provably the cheapest ordering; the others are quoted
     against it. */
  function compareStrategies(cards, monthlyBudget) {
    var avalanche = simulate(cards, monthlyBudget, 'avalanche');
    var snowball = simulate(cards, monthlyBudget, 'snowball');
    var minimumOnly = simulateMinimumOnly(cards);

    var out = {
      avalanche: avalanche,
      snowball: snowball,
      minimumOnly: minimumOnly,
      ok: avalanche.ok && snowball.ok
    };

    if (out.ok) {
      /* What choosing snowball over avalanche costs. Never negative:
         avalanche is optimal, so this is the premium paid for the
         psychological benefit of closing small accounts first. */
      out.snowballPremium = round2(snowball.totalInterest - avalanche.totalInterest);
      out.snowballExtraMonths = snowball.months - avalanche.months;
      out.firstCardClearedSnowball = snowball.cards.reduce(function (best, c) {
        return (!best || c.paidOffMonth < best) ? c.paidOffMonth : best;
      }, 0);
      out.firstCardClearedAvalanche = avalanche.cards.reduce(function (best, c) {
        return (!best || c.paidOffMonth < best) ? c.paidOffMonth : best;
      }, 0);
    }

    if (out.ok && minimumOnly.ok) {
      out.interestSavedVsMinimum = round2(minimumOnly.totalInterest - avalanche.totalInterest);
      out.monthsSavedVsMinimum = minimumOnly.months - avalanche.months;
    }

    return out;
  }

  /* Paying only what the statement demands, every month, forever. The budget
     is not fixed here — it falls as the balances fall, which is exactly why
     it takes so long. */
  function simulateMinimumOnly(cards) {
    var live = normalizeCards(cards).map(function (c) {
      return {
        id: c.id, name: c.name, aprPct: c.aprPct,
        minPct: c.minPct, minFloor: c.minFloor, minMode: c.minMode,
        balance: c.balance, startBalance: c.balance,
        interestPaid: 0, paidOffMonth: 0
      };
    });

    if (!live.length) return { ok: false, reason: 'no-cards' };

    /* If the billed minimum never exceeds the interest, the card is a
       treadmill and the loop would not terminate. */
    for (var g = 0; g < live.length; g++) {
      var card = live[g];
      var interest = card.balance * ((card.aprPct / 100) / 12);
      var due = minimumPayment(card.balance, card.aprPct, card.minPct, card.minFloor, card.minMode);

      if (due <= interest + CENT) {
        return { ok: false, reason: 'minimum-below-interest', card: card.name };
      }
    }

    var totalInterest = 0;
    var month = 0;

    while (month < MAX_MONTHS) {
      var remaining = live.filter(function (c) { return c.balance > CENT; });
      if (!remaining.length) break;

      month++;

      for (var i = 0; i < remaining.length; i++) {
        var c2 = remaining[i];
        var mInterest = c2.balance * ((c2.aprPct / 100) / 12);
        var due2 = minimumPayment(c2.balance, c2.aprPct, c2.minPct, c2.minFloor, c2.minMode);

        c2.balance = c2.balance + mInterest - due2;
        c2.interestPaid += mInterest;
        totalInterest += mInterest;

        if (c2.balance <= CENT) { c2.balance = 0; if (!c2.paidOffMonth) c2.paidOffMonth = month; }
      }
    }

    var unpaid = live.some(function (c) { return c.balance > CENT; });
    if (unpaid) return { ok: false, reason: 'too-slow', months: month };

    var start = 0;
    for (var p = 0; p < live.length; p++) start += live[p].startBalance;

    return {
      ok: true,
      strategy: 'minimum',
      months: month,
      years: round2(month / 12),
      totalInterest: round2(totalInterest),
      startBalance: round2(start),
      totalPaid: round2(start + totalInterest),
      cards: live.map(function (c) {
        return {
          id: c.id, name: c.name, aprPct: c.aprPct,
          startBalance: round2(c.startBalance),
          interestPaid: round2(c.interestPaid),
          paidOffMonth: c.paidOffMonth
        };
      })
    };
  }

  /* ======================================================================
     6. Totals and CSV
     ====================================================================== */

  function totals(cards) {
    var list = normalizeCards(cards);
    var balance = 0, minimums = 0, weighted = 0;

    for (var i = 0; i < list.length; i++) {
      balance += list[i].balance;
      minimums += minimumPayment(list[i].balance, list[i].aprPct, list[i].minPct, list[i].minFloor, list[i].minMode);
      weighted += list[i].balance * list[i].aprPct;
    }

    return {
      count: list.length,
      balance: round2(balance),
      minimums: round2(minimums),
      averageApr: balance > 0 ? round2(weighted / balance) : 0,
      monthlyInterest: round2(list.reduce(function (a, c) {
        return a + c.balance * ((c.aprPct / 100) / 12);
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
     7. State
     ====================================================================== */

  function defaultState() {
    return {
      cards: [
        { id: 'card-1', name: 'Store card', balance: 1800, aprPct: 26.99, minPct: 1, minFloor: 25, minMode: 'interest_plus_percent' },
        { id: 'card-2', name: 'Rewards Visa', balance: 6400, aprPct: 21.49, minPct: 1, minFloor: 25, minMode: 'interest_plus_percent' },
        { id: 'card-3', name: 'Travel card', balance: 3200, aprPct: 18.99, minPct: 1, minFloor: 25, minMode: 'interest_plus_percent' }
      ],
      monthlyBudget: 600
    };
  }

  function normalize(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var d = defaultState();

    var cards = normalizeCards(s.cards);
    if (!cards.length) cards = normalizeCards(d.cards);

    return {
      cards: cards,
      monthlyBudget: clampNum(s.monthlyBudget, 0, 1e7, d.monthlyBudget)
    };
  }

  function computeAll(raw) {
    var s = normalize(raw);

    return {
      state: s,
      totals: totals(s.cards),
      comparison: compareStrategies(s.cards, s.monthlyBudget)
    };
  }

  global.CreditCardPayoffEngine = {
    minimumPayment: minimumPayment,
    normalizeCard: normalizeCard,
    normalizeCards: normalizeCards,
    orderCards: orderCards,

    simulate: simulate,
    simulateMinimumOnly: simulateMinimumOnly,
    compareStrategies: compareStrategies,

    totals: totals,
    timelineToCSV: timelineToCSV,
    defaultState: defaultState,
    normalize: normalize,
    computeAll: computeAll
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.CreditCardPayoffEngine;

})(typeof window !== 'undefined' ? window : this);
