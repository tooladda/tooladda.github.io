/* ==========================================================================
   ToolAdda — Credit Card Payoff Calculator (UI layer)

   Dynamic card rows, the strategy comparison and the payoff order. Every
   number comes from credit-card-payoff-engine.js, which is tested on its
   own — including the invariant this page is built on, that avalanche can
   never cost more interest than snowball.

   The minimum-payment rule is set once for the whole deck rather than per
   card. Issuers do vary, but asking someone to find three separate minimum
   formulas before they can see an answer is a good way to lose them, and
   the rule matters far more than the per-card variation within it.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.CreditCardPayoffEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-card-payoff';

  var cards = [];
  var settings = { monthlyBudget: 600, minPct: 1, minFloor: 25, minMode: 'interest_plus_percent' };
  var strategy = 'avalanche';
  var result = null;
  var dom = {};
  var frame = 0;
  var seq = 0;
  var sticky = null;

  function $(id) { return document.getElementById(id); }

  var money = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  var moneyCents = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  function usd(n) { return money.format(isFinite(n) ? n : 0); }
  function usdc(n) { return moneyCents.format(isFinite(n) ? n : 0); }

  function duration(months) {
    if (!months) return '—';
    var y = Math.floor(months / 12);
    var m = months % 12;
    if (!y) return m + (m === 1 ? ' month' : ' months');
    if (!m) return y + (y === 1 ? ' year' : ' years');
    return y + ' yr ' + m + ' mo';
  }

  function setText(id, value) {
    var el = dom[id];
    if (el) el.textContent = value;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------ storage */

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        cards: cards, settings: settings, strategy: strategy
      }));
    } catch (error) { /* private browsing — the tool still works */ }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return seed();

      var saved = JSON.parse(raw);
      cards = E.normalizeCards(saved.cards);
      if (!cards.length) return seed();

      if (saved.settings) {
        settings.monthlyBudget = Number(saved.settings.monthlyBudget) || settings.monthlyBudget;
        settings.minPct = Number(saved.settings.minPct) || settings.minPct;
        settings.minFloor = Number(saved.settings.minFloor) || settings.minFloor;
        settings.minMode = saved.settings.minMode === 'percent_of_balance'
          ? 'percent_of_balance' : 'interest_plus_percent';
      }
      if (saved.strategy === 'snowball' || saved.strategy === 'avalanche') {
        strategy = saved.strategy;
      }
    } catch (error) { seed(); }
  }

  function seed() {
    var d = E.defaultState();
    cards = E.normalizeCards(d.cards);
    settings.monthlyBudget = d.monthlyBudget;
  }

  /* The minimum rule is global, so it is stamped onto every card before the
     engine sees them. */
  function deck() {
    return cards.map(function (c) {
      return {
        id: c.id, name: c.name, balance: c.balance, aprPct: c.aprPct,
        minPct: settings.minPct, minFloor: settings.minFloor, minMode: settings.minMode
      };
    });
  }

  /* ------------------------------------------------------------ rows */

  function renderRows() {
    var host = dom.cardList;
    if (!host) return;

    host.innerHTML = '';

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var row = document.createElement('div');
      row.className = 'usc-card-row';
      row.innerHTML =
        '<div class="usc-field usc-field--name">' +
          '<label class="usc-label" for="name-' + c.id + '">Card</label>' +
          '<input class="usc-input" id="name-' + c.id + '" type="text" maxlength="60" ' +
            'value="' + escapeHtml(c.name) + '" data-field="name" data-id="' + c.id + '" />' +
        '</div>' +
        '<div class="usc-field">' +
          '<label class="usc-label" for="bal-' + c.id + '">Balance</label>' +
          '<span class="usc-affix" data-prefix="$">' +
            '<input class="usc-input" id="bal-' + c.id + '" type="number" min="0" step="50" ' +
              'inputmode="decimal" value="' + c.balance + '" data-field="balance" data-id="' + c.id + '" />' +
          '</span>' +
        '</div>' +
        '<div class="usc-field">' +
          '<label class="usc-label" for="apr-' + c.id + '">APR</label>' +
          '<span class="usc-affix usc-affix--pct" data-suffix="%">' +
            '<input class="usc-input" id="apr-' + c.id + '" type="number" min="0" max="100" step="0.01" ' +
              'inputmode="decimal" value="' + c.aprPct + '" data-field="aprPct" data-id="' + c.id + '" />' +
          '</span>' +
        '</div>' +
        '<div class="usc-field">' +
          '<span class="usc-label">Min payment</span>' +
          '<span class="usc-hint" data-min-for="' + c.id + '">—</span>' +
        '</div>' +
        '<button type="button" class="usc-remove" data-remove="' + c.id + '" ' +
          'aria-label="Remove ' + escapeHtml(c.name) + '"' +
          (cards.length <= 1 ? ' disabled' : '') + '>✕</button>';
      host.appendChild(row);
    }
  }

  function renderMinimums() {
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var el = document.querySelector('[data-min-for="' + c.id + '"]');
      if (!el) continue;

      var min = E.minimumPayment(c.balance, c.aprPct, settings.minPct, settings.minFloor, settings.minMode);
      var interest = c.balance * ((c.aprPct / 100) / 12);

      el.textContent = usdc(min);
      /* Flag the treadmill case per card — this is the whole trap. */
      el.className = min <= interest ? 'usc-hint usc-bad' : 'usc-hint';
      if (min <= interest) el.textContent = usdc(min) + ' — below interest';
    }
  }

  /* ------------------------------------------------------------ render */

  function render() {
    result = E.computeAll({ cards: deck(), monthlyBudget: settings.monthlyBudget });
    var t = result.totals;
    var c = result.comparison;

    setText('totalBalance', usd(t.balance));
    setText('avgApr', t.averageApr.toFixed(2) + '%');
    setText('totalMinimums', usdc(t.minimums));
    setText('monthlyInterest', usdc(t.monthlyInterest));

    renderMinimums();
    renderBudgetNote(t);

    var chosen = strategy === 'snowball' ? c.snowball : c.avalanche;

    if (chosen && chosen.ok) {
      setText('payoffTime', duration(chosen.months));
      setText('totalInterest', usd(chosen.totalInterest));
      setText('totalPaid', usd(chosen.totalPaid));
      setText('debtFreeDate', debtFreeDate(chosen.months));
    } else {
      setText('payoffTime', '—');
      setText('totalInterest', '—');
      setText('totalPaid', '—');
      setText('debtFreeDate', '—');
    }

    renderComparison(c);
    renderStrategyChart(c);
    renderOrder(chosen);
    announce(chosen);
    if (sticky) sticky.update();
  }

  function debtFreeDate(months) {
    var d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function renderBudgetNote(t) {
    var box = dom.budgetNote;
    if (!box) return;

    if (settings.monthlyBudget + 0.005 < t.minimums) {
      box.hidden = false;
      box.className = 'usc-note usc-note--bad';
      box.innerHTML = '<strong>Your budget is below the minimum payments.</strong> ' +
        'These cards bill ' + usdc(t.minimums) + ' a month between them. Paying less than that ' +
        'means late fees and, after 30 days, a mark on your credit file. If you genuinely cannot ' +
        'cover the minimums, contact the issuers before you miss a payment — hardship plans exist ' +
        'and are far easier to arrange before a default than after one.';
      return;
    }

    var spare = settings.monthlyBudget - t.minimums;
    box.hidden = false;
    box.className = 'usc-note';
    box.innerHTML = '<strong>' + usdc(spare) + ' a month above the minimums.</strong> ' +
      'That surplus is what actually clears the debt — the minimums barely hold it still. ' +
      'Every extra dollar goes to one card at a time, and when a card clears, its minimum joins ' +
      'the attack on the next one.';
  }

  function renderComparison(c) {
    var box = dom.compareNote;
    var body = dom.compareBody;

    if (body) {
      body.innerHTML = '';

      var rows = [
        { key: 'avalanche', label: 'Avalanche — highest APR first', run: c.avalanche },
        { key: 'snowball', label: 'Snowball — smallest balance first', run: c.snowball },
        { key: 'minimum', label: 'Minimums only', run: c.minimumOnly }
      ];

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var tr = document.createElement('tr');
        if (r.key === strategy) tr.className = 'is-highlight';

        if (r.run && r.run.ok) {
          tr.innerHTML =
            '<td>' + r.label + '</td>' +
            '<td>' + duration(r.run.months) + '</td>' +
            '<td>' + usd(r.run.totalInterest) + '</td>' +
            '<td>' + usd(r.run.totalPaid) + '</td>';
        } else {
          tr.innerHTML = '<td>' + r.label + '</td><td colspan="3">Never pays off</td>';
        }
        body.appendChild(tr);
      }
    }

    if (!box) return;

    if (!c.ok) { box.hidden = true; return; }

    box.hidden = false;

    if (c.snowballPremium <= 0.01) {
      box.className = 'usc-note usc-note--good';
      box.innerHTML = '<strong>On this deck the two strategies cost the same.</strong> ' +
        'That happens when the highest-rate card is also the smallest, so both orderings attack it ' +
        'first. Pick whichever you will actually stick to.';
      return;
    }

    box.className = 'usc-note usc-note--warn';
    box.innerHTML = '<strong>Snowball costs ' + usd(c.snowballPremium) + ' more than avalanche</strong>' +
      (c.snowballExtraMonths > 0 ? ' and takes ' + duration(c.snowballExtraMonths) + ' longer' : '') +
      '. In exchange it clears your first card in month ' + c.firstCardClearedSnowball +
      ' instead of month ' + c.firstCardClearedAvalanche + '. ' +
      'Avalanche is always the cheaper arithmetic; snowball is the one more people finish. ' +
      'If the early win is what keeps you going, it is a defensible price to pay.';
  }

  /* Both strategies on one plot: the gap between the lines is exactly what
     the ordering choice is worth, which no table row conveys as directly. */
  function renderStrategyChart(c) {
    var C = window.USCCharts;
    if (!C || !dom.strategyChart) return;

    if (!c.ok) {
      C.lineChart(dom.strategyChart, { series: [] });
      return;
    }

    function line(run, name, slot) {
      var head = [{ x: 0, y: run.startBalance }];
      return {
        name: name,
        color: C.seriesColor(slot),
        /* Every strategy ends at zero, so labelling the value would print
           "$0" twice in the same place. The month it lands is the difference
           the chart exists to show. */
        endLabel: duration(run.months),
        points: head.concat(C.sample(run.timeline, 60, function (row) {
          return { x: row.month, y: row.balance };
        }))
      };
    }

    C.lineChart(dom.strategyChart, {
      caption: 'Balance remaining under avalanche and snowball, month by month.',
      formatY: C.shortMoney,
      formatX: function (m) { return m % 12 === 0 ? 'Yr ' + (m / 12) : 'Mo ' + m; },
      series: [
        line(c.avalanche, 'Avalanche', 1),
        line(c.snowball, 'Snowball', 2)
      ]
    });
  }

  function renderOrder(run) {
    var body = dom.orderBody;
    if (!body) return;

    body.innerHTML = '';
    if (!run || !run.ok) return;

    var ordered = run.cards.slice().sort(function (a, b) {
      return a.paidOffMonth - b.paidOffMonth;
    });

    for (var i = 0; i < ordered.length; i++) {
      var c = ordered[i];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '. ' + escapeHtml(c.name) + '</td>' +
        '<td>' + c.aprPct.toFixed(2) + '%</td>' +
        '<td>' + usd(c.startBalance) + '</td>' +
        '<td>' + usd(c.interestPaid) + '</td>' +
        '<td>' + duration(c.paidOffMonth) + '</td>';
      body.appendChild(tr);
    }
  }

  function announce(run) {
    var live = dom.live;
    if (!live) return;
    live.textContent = run && run.ok
      ? 'Debt free in ' + duration(run.months) + ', total interest ' + usd(run.totalInterest)
      : 'This budget does not clear the debt.';
  }

  /* ------------------------------------------------------------ export */

  function exportCSV() {
    var run = strategy === 'snowball' ? result.comparison.snowball : result.comparison.avalanche;
    if (!run || !run.ok) return;

    var csv = E.timelineToCSV(run.timeline);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = 'credit-card-payoff-' + strategy + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------------------------------------------------ wiring */

  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      render();
      save();
    });
  }

  function addCard() {
    seq++;
    cards.push(E.normalizeCard({
      id: 'card-' + Date.now() + '-' + seq,
      name: 'Card ' + (cards.length + 1),
      balance: 1000,
      aprPct: 22.99
    }, cards.length));

    renderRows();
    render();
    save();
  }

  function removeCard(id) {
    if (cards.length <= 1) return;
    cards = cards.filter(function (c) { return c.id !== id; });
    renderRows();
    render();
    save();
  }

  var PRESETS = [
    { label: 'Three typical cards', hint: 'A store card and two majors',
      state: { cards: E.defaultState().cards, budget: 600 } },
    { label: 'One large balance', hint: 'Nothing to order, so both strategies agree',
      state: { cards: [{ name: 'Main card', balance: 9500, aprPct: 23.99 }], budget: 500 } },
    /* The small balance carries the lowest rate, so the snowball (smallest
       first) and the avalanche (highest rate first) start on different cards.
       With the small balance at the highest rate both orders were identical
       and the preset showed no difference at all. */
    { label: 'Small balance, low rate', hint: 'Where snowball and avalanche disagree most',
      state: { cards: [
        { name: 'Store card', balance: 700, aprPct: 12.99 },
        { name: 'Rewards Visa', balance: 7800, aprPct: 29.99 },
        { name: 'Airline card', balance: 2400, aprPct: 17.49 }
      ], budget: 550 } },
    { label: 'Barely above minimums', hint: 'How long the slow road really takes',
      state: { cards: E.defaultState().cards, budget: 340 } },
    { label: 'Aggressive payoff', hint: 'Double the budget',
      state: { cards: E.defaultState().cards, budget: 1200 } }
  ];

  function applyPreset(patch) {
    cards = E.normalizeCards(patch.cards);
    if (!cards.length) seed();
    if (patch.budget) settings.monthlyBudget = patch.budget;

    renderRows();
    if (dom.budget) dom.budget.value = settings.monthlyBudget;
    render();
    save();
  }

  function initialize() {
    dom.cardList = $('cardList');
    dom.budgetNote = $('budgetNote');
    dom.compareNote = $('compareNote');
    dom.compareBody = $('compareBody');
    dom.strategyChart = $('strategyChart');
    dom.orderBody = $('orderBody');
    dom.live = $('liveRegion');

    var outputs = ['totalBalance', 'avgApr', 'totalMinimums', 'monthlyInterest',
      'payoffTime', 'totalInterest', 'totalPaid', 'debtFreeDate'];
    for (var i = 0; i < outputs.length; i++) dom[outputs[i]] = $(outputs[i]);

    dom.budget = $('budget');
    dom.minPct = $('minPct');
    dom.minFloor = $('minFloor');

    load();
    renderRows();

    if (dom.budget) dom.budget.value = settings.monthlyBudget;
    if (dom.minPct) dom.minPct.value = settings.minPct;
    if (dom.minFloor) dom.minFloor.value = settings.minFloor;
    syncMinMode();
    syncStrategy();

    render();

    /* Per-card edits are delegated: rows are rebuilt on add and remove, so
       binding to each input directly would leak listeners. */
    document.addEventListener('input', function (event) {
      var el = event.target;
      var id = el.getAttribute && el.getAttribute('data-id');

      if (id) {
        var field = el.getAttribute('data-field');
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].id !== id) continue;

          if (field === 'name') {
            cards[i].name = el.value.slice(0, 60);
          } else {
            var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
            if (isFinite(v)) cards[i][field] = Math.max(0, v);
          }
          break;
        }
        schedule();
        return;
      }

      if (el === dom.budget) {
        settings.monthlyBudget = Math.max(0, parseFloat(el.value) || 0);
        schedule();
      } else if (el === dom.minPct) {
        settings.minPct = Math.max(0, parseFloat(el.value) || 0);
        schedule();
      } else if (el === dom.minFloor) {
        settings.minFloor = Math.max(0, parseFloat(el.value) || 0);
        schedule();
      }
    });

    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target : null;
      if (!target) return;

      var removeBtn = target.closest('[data-remove]');
      if (removeBtn) { removeCard(removeBtn.getAttribute('data-remove')); return; }

      var stratBtn = target.closest('[data-strategy]');
      if (stratBtn) {
        strategy = stratBtn.getAttribute('data-strategy');
        syncStrategy();
        render();
        save();
        return;
      }

      var modeBtn = target.closest('[data-min-mode]');
      if (modeBtn) {
        settings.minMode = modeBtn.getAttribute('data-min-mode');
        syncMinMode();
        render();
        save();
      }
    });

    if (window.USCUI) {
      window.USCUI.presets($('presetRow'), PRESETS, applyPreset);

      sticky = window.USCUI.stickyBar({
        watch: dom.payoffTime,
        label: 'Debt free in',
        jumpTo: document.getElementById('uscApp')
      });
    }

    var addBtn = $('addCard');
    if (addBtn) addBtn.addEventListener('click', addCard);

    var csvBtn = $('exportCsv');
    if (csvBtn) csvBtn.addEventListener('click', exportCSV);

    var resetBtn = $('resetAll');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        seed();
        settings.minPct = 1;
        settings.minFloor = 25;
        settings.minMode = 'interest_plus_percent';
        strategy = 'avalanche';

        renderRows();
        if (dom.budget) dom.budget.value = settings.monthlyBudget;
        if (dom.minPct) dom.minPct.value = settings.minPct;
        if (dom.minFloor) dom.minFloor.value = settings.minFloor;
        syncMinMode();
        syncStrategy();
        render();
        save();
      });
    }
  }

  function syncStrategy() {
    var options = ['avalanche', 'snowball'];
    for (var i = 0; i < options.length; i++) {
      var btn = $('strategy-' + options[i]);
      if (btn) btn.setAttribute('aria-pressed', String(options[i] === strategy));
    }
  }

  function syncMinMode() {
    var options = ['interest_plus_percent', 'percent_of_balance'];
    for (var i = 0; i < options.length; i++) {
      var btn = $('minmode-' + options[i]);
      if (btn) btn.setAttribute('aria-pressed', String(options[i] === settings.minMode));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  window.CardPayoffUI = {
    getCards: function () { return cards; },
    getSettings: function () { return settings; },
    getResult: function () { return result; },
    render: render,
    exportCSV: exportCSV,
    STORAGE_KEY: STORAGE_KEY
  };
})();
