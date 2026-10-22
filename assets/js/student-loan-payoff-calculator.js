/* ==========================================================================
   ToolAdda — Student Loan Payoff Calculator (UI layer)

   Dynamic loan rows, the three-way plan comparison and the refinance
   verdict. Every number comes from student-loan-payoff-engine.js, which is
   tested on its own — including the case this page most needs to get right,
   where a refinance offers a lower rate and still costs more because the
   term was stretched.

   The refinance verdict deliberately reports two things separately: what it
   does to the money, and what it costs in federal protections. Those are not
   commensurable, and a calculator that collapses them into a single
   recommendation is lying by omission.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.StudentLoanPayoffEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-student-loan';

  var loans = [];
  var settings = { extraMonthly: 150, refiRatePct: 6.0, refiTermYears: 10 };
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
        loans: loans, settings: settings
      }));
    } catch (error) { /* private browsing — the tool still works */ }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return seed();

      var saved = JSON.parse(raw);
      loans = E.normalizeLoans(saved.loans);
      if (!loans.length) return seed();

      if (saved.settings) {
        settings.extraMonthly = Number(saved.settings.extraMonthly) || 0;
        settings.refiRatePct = Number(saved.settings.refiRatePct) || settings.refiRatePct;
        settings.refiTermYears = Number(saved.settings.refiTermYears) || settings.refiTermYears;
      }
    } catch (error) { seed(); }
  }

  function seed() {
    var d = E.defaultState();
    loans = E.normalizeLoans(d.loans);
    settings.extraMonthly = d.extraMonthly;
    settings.refiRatePct = d.refiRatePct;
    settings.refiTermYears = d.refiTermYears;
  }

  /* ------------------------------------------------------------ rows */

  function renderRows() {
    var host = dom.loanList;
    if (!host) return;

    host.innerHTML = '';

    for (var i = 0; i < loans.length; i++) {
      var l = loans[i];
      var row = document.createElement('div');
      row.className = 'usc-card-row';
      row.innerHTML =
        '<div class="usc-field usc-field--name">' +
          '<label class="usc-label" for="name-' + l.id + '">Loan</label>' +
          '<input class="usc-input" id="name-' + l.id + '" type="text" maxlength="60" ' +
            'value="' + escapeHtml(l.name) + '" data-field="name" data-id="' + l.id + '" />' +
        '</div>' +
        '<div class="usc-field">' +
          '<label class="usc-label" for="bal-' + l.id + '">Balance</label>' +
          '<span class="usc-affix" data-prefix="$">' +
            '<input class="usc-input" id="bal-' + l.id + '" type="number" min="0" step="500" ' +
              'inputmode="decimal" value="' + l.balance + '" data-field="balance" data-id="' + l.id + '" />' +
          '</span>' +
        '</div>' +
        '<div class="usc-field">' +
          '<label class="usc-label" for="apr-' + l.id + '">Rate</label>' +
          '<span class="usc-affix usc-affix--pct" data-suffix="%">' +
            '<input class="usc-input" id="apr-' + l.id + '" type="number" min="0" max="40" step="0.01" ' +
              'inputmode="decimal" value="' + l.aprPct + '" data-field="aprPct" data-id="' + l.id + '" />' +
          '</span>' +
        '</div>' +
        '<div class="usc-field">' +
          '<label class="usc-label" for="term-' + l.id + '">Years</label>' +
          '<input class="usc-input" id="term-' + l.id + '" type="number" min="1" max="40" step="1" ' +
            'inputmode="numeric" value="' + l.termYears + '" data-field="termYears" data-id="' + l.id + '" />' +
        '</div>' +
        '<button type="button" class="usc-remove" data-remove="' + l.id + '" ' +
          'aria-label="Remove ' + escapeHtml(l.name) + '"' +
          (loans.length <= 1 ? ' disabled' : '') + '>✕</button>' +
        '<div class="usc-field usc-field--wide" style="grid-column:1/-1">' +
          '<label class="usc-check">' +
            '<input type="checkbox" data-field="isFederal" data-id="' + l.id + '"' +
              (l.isFederal ? ' checked' : '') + ' />' +
            '<span>This is a <strong>federal</strong> loan — refinancing it privately would give up ' +
            'income-driven repayment, forgiveness eligibility and federal forbearance.</span>' +
          '</label>' +
        '</div>';
      host.appendChild(row);
    }
  }

  /* ------------------------------------------------------------ render */

  function render() {
    result = E.computeAll({
      loans: loans,
      extraMonthly: settings.extraMonthly,
      refiRatePct: settings.refiRatePct,
      refiTermYears: settings.refiTermYears
    });

    var t = result.totals;
    var c = result.comparison;

    setText('totalBalance', usd(t.balance));
    setText('blendedRate', t.blendedRate.toFixed(2) + '%');
    setText('standardPayment', usdc(t.standardPayment));
    setText('monthlyInterest', usdc(t.monthlyInterest));
    setText('federalSplit', usd(t.federalBalance) + ' federal · ' + usd(t.privateBalance) + ' private');

    var chosen = c.withExtra && c.withExtra.ok ? c.withExtra : c.standard;

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

    renderExtraNote(c);
    renderPlans(c);
    renderPlansChart(c);
    renderRefi(c);
    renderOrder(chosen);
    announce(chosen);
    if (sticky) sticky.update();
  }

  function debtFreeDate(months) {
    var d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function renderExtraNote(c) {
    var box = dom.extraNote;
    if (!box) return;

    if (!(settings.extraMonthly > 0) || !c.standard.ok || !c.withExtra || !c.withExtra.ok) {
      box.hidden = true;
      return;
    }

    box.hidden = false;
    box.className = 'usc-note usc-note--good';
    box.innerHTML = '<strong>Paying ' + usd(settings.extraMonthly) + ' extra each month</strong> clears ' +
      'the loans ' + duration(c.extraMonthsSaved) + ' sooner and saves ' +
      usd(c.extraInterestSaved) + ' in interest. The extra goes to your highest-rate loan first, and ' +
      'when a loan clears, its whole payment rolls onto the next one.';
  }

  function renderPlans(c) {
    var body = dom.plansBody;
    if (!body) return;

    body.innerHTML = '';

    var rows = [
      { label: 'Standard repayment', run: c.standard },
      { label: 'Standard + extra payment', run: c.withExtra },
      { label: 'Refinance at ' + settings.refiRatePct.toFixed(2) + '% / ' + settings.refiTermYears + ' yr',
        run: c.refinance && c.refinance.ok ? c.refinance.result : null }
    ];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tr = document.createElement('tr');

      if (r.run && r.run.ok) {
        tr.innerHTML =
          '<td>' + r.label + '</td>' +
          '<td>' + duration(r.run.months) + '</td>' +
          '<td>' + usd(r.run.totalInterest) + '</td>' +
          '<td>' + usd(r.run.totalPaid) + '</td>';
      } else {
        tr.innerHTML = '<td>' + r.label + '</td><td colspan="3">Does not pay off</td>';
      }
      body.appendChild(tr);
    }
  }

  function renderRefi(c) {
    var box = dom.refiNote;
    var fed = dom.refiFederalNote;

    if (box) {
      var refi = c.refinance;

      if (!refi || !refi.ok || !refi.result.ok || !c.standard.ok) {
        box.hidden = true;
      } else {
        box.hidden = false;

        if (c.refiLongerDespiteLowerRate) {
          box.className = 'usc-note usc-note--bad';
          box.innerHTML = '<strong>This refinance has a lower rate and still costs more.</strong> ' +
            'The rate falls by ' + refi.rateDrop.toFixed(2) + ' points, but stretching repayment to ' +
            refi.newTermYears + ' years adds ' + usd(Math.abs(c.refiInterestSaved)) +
            ' in total interest. The monthly payment is smaller; the debt is more expensive. ' +
            'This is the most common way a refinance offer misleads.';
        } else if (c.refiWorthItOnMoney) {
          box.className = 'usc-note usc-note--good';
          box.innerHTML = '<strong>On money alone, this refinance saves ' +
            usd(c.refiInterestSaved) + '</strong>' +
            (c.refiMonthsSaved > 0 ? ' and finishes ' + duration(c.refiMonthsSaved) + ' sooner' : '') +
            '. Your blended rate today is ' + refi.currentBlendedRate.toFixed(2) +
            '%; the offer is ' + refi.newRatePct.toFixed(2) + '%.';
        } else {
          box.className = 'usc-note usc-note--warn';
          box.innerHTML = '<strong>This refinance does not save money.</strong> ' +
            'Your blended rate today is ' + refi.currentBlendedRate.toFixed(2) +
            '% and the offer is ' + refi.newRatePct.toFixed(2) + '%, which over ' +
            refi.newTermYears + ' years costs ' + usd(Math.abs(c.refiInterestSaved)) + ' more.';
        }
      }
    }

    if (!fed) return;

    var r = c.refinance;
    if (!r || !r.ok || !r.losesFederalProtections) {
      fed.hidden = true;
      return;
    }

    fed.hidden = false;
    fed.className = 'usc-note usc-note--warn';
    fed.innerHTML = '<strong>' + usd(r.federalBalanceSurrendered) + ' of this is federal debt.</strong> ' +
      'Refinancing federal loans with a private lender is permanent and gives up income-driven ' +
      'repayment plans, any forgiveness you might qualify for including PSLF, federal deferment and ' +
      'forbearance, and the death and disability discharge. Whether that is worth a lower rate ' +
      'depends on your job security and career plans, not on arithmetic — which is why this page ' +
      'shows it separately rather than folding it into the recommendation.';
  }

  /* Three plans at most, which is the documented all-pairs safe limit for
     this palette — past three these would have to become small multiples. */
  function renderPlansChart(c) {
    var C = window.USCCharts;
    if (!C || !dom.plansChart) return;

    if (!c.standard || !c.standard.ok) {
      C.lineChart(dom.plansChart, { series: [] });
      return;
    }

    function line(run, name, slot) {
      if (!run || !run.ok) return null;
      return {
        name: name,
        color: C.seriesColor(slot),
        /* All three plans end at zero; the month each one lands is the
           comparison, so that is what rides the line end. */
        endLabel: duration(run.months),
        points: [{ x: 0, y: run.startBalance }].concat(
          C.sample(run.timeline, 60, function (row) {
            return { x: row.month, y: row.balance };
          })
        )
      };
    }

    var series = [line(c.standard, 'Standard', 1)];

    if (settings.extraMonthly > 0) series.push(line(c.withExtra, 'With extra', 2));
    if (c.refinance && c.refinance.ok) series.push(line(c.refinance.result, 'Refinanced', 3));

    C.lineChart(dom.plansChart, {
      caption: 'Balance remaining under each repayment plan.',
      formatY: C.shortMoney,
      formatX: function (m) { return m % 12 === 0 ? 'Yr ' + (m / 12) : 'Mo ' + m; },
      series: series.filter(Boolean)
    });
  }

  function renderOrder(run) {
    var body = dom.orderBody;
    if (!body) return;

    body.innerHTML = '';
    if (!run || !run.ok) return;

    var ordered = run.loans.slice().sort(function (a, b) {
      return a.paidOffMonth - b.paidOffMonth;
    });

    for (var i = 0; i < ordered.length; i++) {
      var l = ordered[i];
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '. ' + escapeHtml(l.name) + (l.isFederal ? ' <small>(federal)</small>' : '') + '</td>' +
        '<td>' + l.aprPct.toFixed(2) + '%</td>' +
        '<td>' + usd(l.startBalance) + '</td>' +
        '<td>' + usd(l.interestPaid) + '</td>' +
        '<td>' + duration(l.paidOffMonth) + '</td>';
      body.appendChild(tr);
    }
  }

  function announce(run) {
    var live = dom.live;
    if (!live) return;
    live.textContent = run && run.ok
      ? 'Debt free in ' + duration(run.months) + ', total interest ' + usd(run.totalInterest)
      : 'These figures do not produce a payoff.';
  }

  /* ------------------------------------------------------------ export */

  function exportCSV() {
    var c = result && result.comparison;
    var run = c && c.withExtra && c.withExtra.ok ? c.withExtra : (c && c.standard);
    if (!run || !run.ok) return;

    var csv = E.timelineToCSV(run.timeline);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = 'student-loan-payoff.csv';
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

  function addLoan() {
    seq++;
    loans.push(E.normalizeLoan({
      id: 'loan-' + Date.now() + '-' + seq,
      name: 'Loan ' + (loans.length + 1),
      balance: 10000,
      aprPct: 6.53,
      termYears: 10,
      isFederal: true
    }, loans.length));

    renderRows();
    render();
    save();
  }

  function removeLoan(id) {
    if (loans.length <= 1) return;
    loans = loans.filter(function (l) { return l.id !== id; });
    renderRows();
    render();
    save();
  }

  var PRESETS = [
    { label: 'Typical bachelor\'s debt', hint: 'Mixed federal loans',
      state: { loans: E.defaultState().loans, extraMonthly: 150 } },
    { label: 'Grad school debt', hint: 'Larger balances, higher rates',
      state: { loans: [
        { name: 'Grad PLUS', balance: 68000, aprPct: 8.08, termYears: 10, isFederal: true },
        { name: 'Federal unsubsidized', balance: 34000, aprPct: 7.05, termYears: 10, isFederal: true }
      ], extraMonthly: 250 } },
    { label: 'All private', hint: 'Nothing federal to surrender',
      state: { loans: [
        { name: 'Private loan A', balance: 28000, aprPct: 10.5, termYears: 10, isFederal: false },
        { name: 'Private loan B', balance: 14000, aprPct: 12.25, termYears: 10, isFederal: false }
      ], extraMonthly: 200, refiRatePct: 7.5, refiTermYears: 10 } },
    { label: 'The refinance trap', hint: 'Lower rate, longer term, more money',
      state: { loans: E.defaultState().loans, extraMonthly: 0, refiRatePct: 5.5, refiTermYears: 20 } },
    { label: 'No extra payment', hint: 'The standard plan alone',
      state: { loans: E.defaultState().loans, extraMonthly: 0 } }
  ];

  function applyPreset(patch) {
    loans = E.normalizeLoans(patch.loans);
    if (!loans.length) seed();

    if (typeof patch.extraMonthly === 'number') settings.extraMonthly = patch.extraMonthly;
    if (patch.refiRatePct) settings.refiRatePct = patch.refiRatePct;
    if (patch.refiTermYears) settings.refiTermYears = patch.refiTermYears;

    renderRows();
    if (dom.extraMonthly) dom.extraMonthly.value = settings.extraMonthly;
    if (dom.refiRate) dom.refiRate.value = settings.refiRatePct;
    if (dom.refiTerm) dom.refiTerm.value = settings.refiTermYears;
    render();
    save();
  }

  function initialize() {
    dom.loanList = $('loanList');
    dom.extraNote = $('extraNote');
    dom.plansBody = $('plansBody');
    dom.plansChart = $('plansChart');
    dom.refiNote = $('refiNote');
    dom.refiFederalNote = $('refiFederalNote');
    dom.orderBody = $('orderBody');
    dom.live = $('liveRegion');

    var outputs = ['totalBalance', 'blendedRate', 'standardPayment', 'monthlyInterest',
      'federalSplit', 'payoffTime', 'totalInterest', 'totalPaid', 'debtFreeDate'];
    for (var i = 0; i < outputs.length; i++) dom[outputs[i]] = $(outputs[i]);

    dom.extraMonthly = $('extraMonthly');
    dom.refiRate = $('refiRate');
    dom.refiTerm = $('refiTerm');

    load();
    renderRows();

    if (dom.extraMonthly) dom.extraMonthly.value = settings.extraMonthly;
    if (dom.refiRate) dom.refiRate.value = settings.refiRatePct;
    if (dom.refiTerm) dom.refiTerm.value = settings.refiTermYears;

    render();

    /* Rows are rebuilt on add and remove, so per-row inputs are delegated
       rather than bound individually. */
    document.addEventListener('input', function (event) {
      var el = event.target;
      var id = el.getAttribute && el.getAttribute('data-id');

      if (id) {
        applyLoanField(el, id);
        schedule();
        return;
      }

      if (el === dom.extraMonthly) {
        settings.extraMonthly = Math.max(0, parseFloat(el.value) || 0);
        schedule();
      } else if (el === dom.refiRate) {
        settings.refiRatePct = Math.max(0, parseFloat(el.value) || 0);
        schedule();
      } else if (el === dom.refiTerm) {
        settings.refiTermYears = Math.max(1, parseFloat(el.value) || 1);
        schedule();
      }
    });

    document.addEventListener('change', function (event) {
      var el = event.target;
      var id = el.getAttribute && el.getAttribute('data-id');
      if (id && el.type === 'checkbox') {
        applyLoanField(el, id);
        schedule();
      }
    });

    document.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-remove]') : null;
      if (btn) removeLoan(btn.getAttribute('data-remove'));
    });

    if (window.USCUI) {
      window.USCUI.presets($('presetRow'), PRESETS, applyPreset);

      sticky = window.USCUI.stickyBar({
        watch: dom.payoffTime,
        label: 'Debt free in',
        jumpTo: document.getElementById('uscApp')
      });
    }

    var addBtn = $('addLoan');
    if (addBtn) addBtn.addEventListener('click', addLoan);

    var csvBtn = $('exportCsv');
    if (csvBtn) csvBtn.addEventListener('click', exportCSV);

    var resetBtn = $('resetAll');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        seed();
        renderRows();
        if (dom.extraMonthly) dom.extraMonthly.value = settings.extraMonthly;
        if (dom.refiRate) dom.refiRate.value = settings.refiRatePct;
        if (dom.refiTerm) dom.refiTerm.value = settings.refiTermYears;
        render();
        save();
      });
    }
  }

  function applyLoanField(el, id) {
    var field = el.getAttribute('data-field');

    for (var i = 0; i < loans.length; i++) {
      if (loans[i].id !== id) continue;

      if (field === 'name') {
        loans[i].name = el.value.slice(0, 60);
      } else if (field === 'isFederal') {
        loans[i].isFederal = !!el.checked;
      } else {
        var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
        if (isFinite(v)) loans[i][field] = Math.max(field === 'termYears' ? 1 : 0, v);
      }
      break;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  window.StudentLoanUI = {
    getLoans: function () { return loans; },
    getSettings: function () { return settings; },
    getResult: function () { return result; },
    render: render,
    exportCSV: exportCSV,
    STORAGE_KEY: STORAGE_KEY
  };
})();
