/* ==========================================================================
   ToolAdda — US Mortgage Calculator (UI layer)

   Event wiring, formatting, the payment split bar and the amortization
   table. Every number shown here comes from us-mortgage-engine.js, which is
   tested on its own.

   The schedule runs to 360 rows, so the table renders one year per row and
   expands the twelve months of a year only when the reader opens it.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.USMortgageEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-us-mortgage';

  var state = E.defaultState();
  var result = null;
  var dom = {};
  var frame = 0;
  var openYears = {};
  var sticky = null;

  /* ======================================================================
     Helpers
     ====================================================================== */

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
  function pct(n) { return (isFinite(n) ? n : 0).toFixed(2) + '%'; }

  /* "7 yrs 4 mo" reads better than "88 months" for anything over a year. */
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

  /* The page's chrome accent, read from CSS so it swaps with the theme. */
  function accentColor() {
    try {
      /* --usc-accent lives on body.usc-page-shell, so it has to be read from
         an element inside that scope rather than from <html>. */
      var host = document.querySelector('.usc-page') || document.body;
      var v = getComputedStyle(host).getPropertyValue('--usc-accent');
      if ((v || '').trim()) return v.trim();
    } catch (error) { /* fall through */ }

    return window.USCCharts ? window.USCCharts.seriesColor(1) : '#2a78d6';
  }

  function setNum(id, value) {
    var el = dom[id];
    if (el && document.activeElement !== el) el.value = value;
  }

  /* ======================================================================
     Persistence
     ====================================================================== */

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* Private browsing or a blocked origin — the calculator still works. */
    }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) state = E.normalize(JSON.parse(raw));
    } catch (error) {
      state = E.defaultState();
    }
  }

  /* ======================================================================
     Reading the form
     ====================================================================== */

  function num(id, fallback) {
    var el = dom[id];
    if (!el) return fallback;
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
    return isFinite(v) ? v : fallback;
  }

  function readControls() {
    var next = {
      homeValue: num('homeValue', state.homeValue),
      downMode: state.downMode,
      downPayment: num('downPayment', state.downPayment),
      downPercent: num('downPercent', state.downPercent),
      annualRatePct: num('rate', state.annualRatePct),
      years: num('years', state.years),

      taxMode: state.taxMode,
      taxPct: num('taxPct', state.taxPct),
      taxAnnual: num('taxAnnual', state.taxAnnual),

      insuranceMode: state.insuranceMode,
      insurancePct: num('insurancePct', state.insurancePct),
      insuranceAnnual: num('insuranceAnnual', state.insuranceAnnual),

      hoaMonthly: num('hoa', state.hoaMonthly),
      pmiAnnualPct: num('pmiRate', state.pmiAnnualPct),

      extraMonthly: num('extraMonthly', state.extraMonthly),
      extraOneTime: num('extraOneTime', state.extraOneTime),
      extraOneTimeMonth: num('extraOneTimeMonth', state.extraOneTimeMonth),

      grossMonthlyIncome: num('income', state.grossMonthlyIncome),
      otherMonthlyDebt: num('otherDebt', state.otherMonthlyDebt)
    };

    state = E.normalize(next);
  }

  /* Push engine-normalized values back, so a clamp is visible rather than
     silently disagreeing with what the reader typed. */
  function writeControls() {
    setNum('homeValue', state.homeValue);
    setNum('downPayment', Math.round(state.downPayment));
    setNum('downPercent', state.downPercent);
    setNum('rate', state.annualRatePct);
    setNum('years', state.years);
    setNum('taxPct', state.taxPct);
    setNum('taxAnnual', Math.round(state.taxAnnual));
    setNum('insurancePct', state.insurancePct);
    setNum('insuranceAnnual', Math.round(state.insuranceAnnual));
    setNum('hoa', state.hoaMonthly);
    setNum('pmiRate', state.pmiAnnualPct);
    setNum('extraMonthly', state.extraMonthly);
    setNum('extraOneTime', state.extraOneTime);
    setNum('extraOneTimeMonth', state.extraOneTimeMonth);
    setNum('income', state.grossMonthlyIncome);
    setNum('otherDebt', state.otherMonthlyDebt);

    syncMode('down', state.downMode, ['amount', 'percent']);
    syncMode('tax', state.taxMode, ['percent', 'amount']);
    syncMode('insurance', state.insuranceMode, ['percent', 'amount']);
  }

  function syncMode(group, value, options) {
    for (var i = 0; i < options.length; i++) {
      var btn = $('mode-' + group + '-' + options[i]);
      if (btn) btn.setAttribute('aria-pressed', String(options[i] === value));
    }
    var amountField = $('field-' + group + '-amount');
    var percentField = $('field-' + group + '-percent');
    if (amountField) amountField.hidden = value !== 'amount';
    if (percentField) percentField.hidden = value !== 'percent';
  }

  /* ======================================================================
     Rendering
     ====================================================================== */

  function render() {
    result = E.computeAll(state);
    var r = result;

    /* --- headline --- */
    setText('pitiValue', usd(r.pitiNow));
    setText('loanAmount', usd(r.principal));
    setText('ltv', pct(r.ltv));
    setText('downPctActual', pct(r.downPercentActual));

    /* --- payment breakdown --- */
    setText('piValue', usdc(r.principalInterest));
    setText('taxValue', usdc(r.escrow.taxMonthly));
    setText('insValue', usdc(r.escrow.insuranceMonthly));
    setText('hoaValue', usdc(r.escrow.hoaMonthly));
    setText('pmiValue', r.pmiApplies ? usdc(r.pmiMonthly) : '—');

    renderSplit(r);

    /* --- the loan over its life --- */
    var active = r.active;
    if (active.ok) {
      setText('totalInterest', usd(active.totalInterest));
      setText('payoffTime', duration(active.months));
      setText('totalPaid', usd(r.principal + active.totalInterest + active.totalPMI));
      setText('totalPMI', active.totalPMI > 0 ? usd(active.totalPMI) : '—');
    } else {
      setText('totalInterest', '—');
      setText('payoffTime', '—');
      setText('totalPaid', '—');
      setText('totalPMI', '—');
    }

    renderBalanceChart(r);
    renderPMI(r);
    renderExtra(r);
    renderAffordability(r);
    renderSchedule(r);
    announce(r);
    if (sticky) sticky.update();
  }

  function renderSplit(r) {
    var C = window.USCCharts;
    var hue = function (n) { return C ? C.seriesColor(n) : 'var(--primary)'; };

    /* Slot order matches the legend in the page, and the legend is what
       direct-labels each value — the segments themselves are far too thin to
       carry text. */
    var parts = [
      { key: 'pi', value: r.principalInterest, color: hue(1) },
      { key: 'tax', value: r.escrow.taxMonthly, color: hue(2) },
      { key: 'ins', value: r.escrow.insuranceMonthly, color: hue(3) },
      { key: 'hoa', value: r.escrow.hoaMonthly, color: hue(4) },
      { key: 'pmi', value: r.pmiApplies ? r.pmiMonthly : 0, color: hue(5) }
    ];

    var total = parts.reduce(function (a, p) { return a + p.value; }, 0);
    var bar = dom.splitBar;
    if (!bar) return;

    bar.innerHTML = '';
    if (total <= 0) return;

    for (var i = 0; i < parts.length; i++) {
      if (parts[i].value <= 0) continue;
      var span = document.createElement('span');
      span.className = 'usc-stack-seg';
      span.style.flexBasis = ((parts[i].value / total) * 100).toFixed(3) + '%';
      span.style.background = parts[i].color;
      bar.appendChild(span);
    }
  }

  /* The balance curve. One series, so no legend box — the chart's own title
     says what is plotted — and an area wash is safe with nothing to muddy. */
  function renderBalanceChart(r) {
    var C = window.USCCharts;
    if (!C || !dom.balanceChart) return;

    if (!r.active.ok) {
      C.lineChart(dom.balanceChart, { series: [] });
      return;
    }

    C.lineChart(dom.balanceChart, {
      areaFill: true,
      caption: 'Loan balance falling from ' + usd(r.principal) + ' to zero over ' +
        duration(r.active.months) + '.',
      formatY: C.shortMoney,
      formatX: function (m) { return m % 12 === 0 ? 'Yr ' + (m / 12) : 'Mo ' + m; },
      series: [{
        name: 'Balance',
        /* The end value is zero on every one of these charts, so the useful
           label is WHEN it gets there, not that it does. */
        endLabel: 'Paid off',
        /* A single series carries no categorical identity — there is no
           second colour for it to be confused with — so the validated
           categorical order does not apply and the line can take the page's
           own accent instead. Multi-series charts on the other pages still
           use the validated slots, where separation actually matters. */
        color: accentColor(),
        points: [{ x: 0, y: r.principal }].concat(
          C.sample(r.active.rows, 60, function (row) {
            return { x: row.month, y: row.balance };
          })
        )
      }]
    });
  }

  function renderPMI(r) {
    var box = dom.pmiNote;
    if (!box) return;

    if (!r.pmiApplies) {
      box.className = 'usc-note usc-note--good';
      box.innerHTML = '<strong>No mortgage insurance.</strong> At ' + pct(r.ltv) +
        ' loan-to-value you are at or below the 80% line, so a conventional loan carries no PMI.';
      return;
    }

    var base = r.base;
    if (!base.ok) { box.hidden = true; return; }

    box.hidden = false;
    box.className = 'usc-note usc-note--warn';
    box.innerHTML = '<strong>PMI applies at ' + pct(r.ltv) + ' LTV.</strong> ' +
      'You would pay ' + usdc(r.pmiMonthly) + ' a month. You can <em>request</em> cancellation once the ' +
      'balance reaches 80% of the original value — around month ' + base.pmiRequestMonth +
      ' (' + duration(base.pmiRequestMonth) + ') — and the servicer must drop it automatically at 78%, ' +
      'around month ' + base.pmiAutoMonth + '. Total PMI if you never ask: ' + usd(base.totalPMI) + '.';
  }

  function renderExtra(r) {
    var box = dom.extraNote;
    if (!box) return;

    var c = r.comparison;
    if (!c || !c.ok || (!state.extraMonthly && !state.extraOneTime)) {
      box.hidden = true;
      return;
    }

    box.hidden = false;
    box.className = 'usc-note usc-note--good';

    var bits = [];
    if (c.monthsSaved > 0) bits.push('pays the loan off ' + duration(c.monthsSaved) + ' early');
    if (c.interestSaved > 0) bits.push('saves ' + usd(c.interestSaved) + ' in interest');
    if (c.pmiSaved > 0) bits.push('cuts ' + usd(c.pmiSaved) + ' of PMI by reaching 78% sooner');

    box.innerHTML = '<strong>Paying extra ' + bits.join(', ') + '.</strong> ' +
      'Total saved: ' + usd(c.totalSaved) + '.';
  }

  function renderAffordability(r) {
    var a = r.affordability;
    var box = dom.affordNote;

    setText('frontEnd', a.ok ? pct(a.frontEnd) : '—');
    setText('backEnd', a.ok ? pct(a.backEnd) : '—');

    var front = dom.frontEnd;
    var back = dom.backEnd;
    if (front) front.className = a.ok && !a.passesFront ? 'usc-bad' : 'usc-good';
    if (back) back.className = a.ok && !a.passesBack ? 'usc-bad' : 'usc-good';

    if (!box) return;

    if (!a.ok) {
      box.hidden = true;
      return;
    }

    box.hidden = false;

    if (a.passesFront && a.passesBack) {
      box.className = 'usc-note usc-note--good';
      box.innerHTML = '<strong>Both guideline ratios clear.</strong> This payment sits inside the ' +
        'conventional 28/36 rule. Lenders weigh credit score, reserves and down payment too, so this ' +
        'is an indicator rather than an approval.';
    } else {
      box.className = 'usc-note usc-note--warn';
      var which = !a.passesFront && !a.passesBack ? 'Both ratios are'
        : !a.passesFront ? 'The housing ratio is' : 'The total-debt ratio is';
      box.innerHTML = '<strong>' + which + ' above the 28/36 guideline.</strong> ' +
        'To clear both you would need a PITI at or under ' +
        usd(Math.min(a.maxPitiFront, a.maxPitiBack)) + ' a month. Plenty of lenders approve above ' +
        'these lines with strong credit or reserves — but it is the point at which the payment starts ' +
        'crowding everything else out.';
    }
  }

  function renderSchedule(r) {
    var body = dom.scheduleBody;
    if (!body) return;

    body.innerHTML = '';
    if (!r.active.ok || !r.years.length) return;

    for (var i = 0; i < r.years.length; i++) {
      var y = r.years[i];
      var isOpen = !!openYears[y.year];

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><button type="button" class="usc-year-toggle" data-year="' + y.year + '" ' +
        'aria-expanded="' + isOpen + '">' + (isOpen ? '▾' : '▸') + ' Year ' + y.year + '</button></td>' +
        '<td>' + usd(y.principal) + '</td>' +
        '<td>' + usd(y.interest) + '</td>' +
        '<td>' + (y.pmi > 0 ? usd(y.pmi) : '—') + '</td>' +
        '<td>' + usd(y.balance) + '</td>';
      body.appendChild(tr);

      if (!isOpen) continue;

      for (var m = 0; m < y.months.length; m++) {
        var row = y.months[m];
        var mr = document.createElement('tr');
        mr.className = 'usc-month-row';
        mr.innerHTML =
          '<td>Month ' + row.month + '</td>' +
          '<td>' + usdc(row.principal) + '</td>' +
          '<td>' + usdc(row.interest) + '</td>' +
          '<td>' + (row.pmi > 0 ? usdc(row.pmi) : '—') + '</td>' +
          '<td>' + usdc(row.balance) + '</td>';
        body.appendChild(mr);
      }
    }
  }

  function announce(r) {
    var live = dom.live;
    if (!live) return;
    live.textContent = 'Monthly payment ' + usd(r.pitiNow) +
      ', loan amount ' + usd(r.principal) +
      (r.active.ok ? ', total interest ' + usd(r.active.totalInterest) : '');
  }

  /* ======================================================================
     Export
     ====================================================================== */

  function exportCSV() {
    if (!result || !result.active.ok) return;

    var csv = E.scheduleToCSV(result.active.rows);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = 'mortgage-amortization-schedule.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      readControls();
      render();
      save();
    });
  }

  var INPUT_IDS = [
    'homeValue', 'downPayment', 'downPercent', 'rate', 'years',
    'taxPct', 'taxAnnual', 'insurancePct', 'insuranceAnnual',
    'hoa', 'pmiRate', 'extraMonthly', 'extraOneTime', 'extraOneTimeMonth',
    'income', 'otherDebt'
  ];

  var OUTPUT_IDS = [
    'pitiValue', 'loanAmount', 'ltv', 'downPctActual',
    'piValue', 'taxValue', 'insValue', 'hoaValue', 'pmiValue',
    'totalInterest', 'payoffTime', 'totalPaid', 'totalPMI',
    'frontEnd', 'backEnd'
  ];

  /* Starting points that cover the cases people actually arrive with. The
     PMI ones matter most: the difference between 5% and 20% down is the whole
     reason this page reports a PMI drop-off date. */
  var PRESETS = [
    { label: '5% down (FHA-style)', hint: 'Low deposit, PMI applies',
      state: { homeValue: 380000, downMode: 'percent', downPercent: 5, annualRatePct: 6.5, years: 30, pmiAnnualPct: 0.8 } },
    { label: '20% down, no PMI', hint: 'The 80% LTV line',
      state: { homeValue: 420000, downMode: 'percent', downPercent: 20, annualRatePct: 6.5, years: 30, pmiAnnualPct: 0.6 } },
    { label: '15-year term', hint: 'Higher payment, far less interest',
      state: { homeValue: 420000, downMode: 'percent', downPercent: 20, annualRatePct: 5.9, years: 15, pmiAnnualPct: 0 } },
    { label: 'High property tax', hint: 'A 2.1% tax state',
      state: { homeValue: 380000, downMode: 'percent', downPercent: 10, annualRatePct: 6.5, years: 30, taxMode: 'percent', taxPct: 2.1, pmiAnnualPct: 0.6 } },
    { label: '$200 extra a month', hint: 'See what prepaying buys',
      state: { homeValue: 420000, downMode: 'percent', downPercent: 10, annualRatePct: 6.5, years: 30, pmiAnnualPct: 0.6, extraMonthly: 200 } }
  ];

  function applyPreset(patch) {
    var next = E.defaultState();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];

    state = E.normalize(next);
    openYears = {};
    writeControls();
    render();
    save();
  }

  function initialize() {
    for (var i = 0; i < INPUT_IDS.length; i++) dom[INPUT_IDS[i]] = $(INPUT_IDS[i]);
    for (var j = 0; j < OUTPUT_IDS.length; j++) dom[OUTPUT_IDS[j]] = $(OUTPUT_IDS[j]);

    dom.splitBar = $('splitBar');
    dom.balanceChart = $('balanceChart');
    dom.pmiNote = $('pmiNote');
    dom.extraNote = $('extraNote');
    dom.affordNote = $('affordNote');
    dom.scheduleBody = $('scheduleBody');
    dom.live = $('liveRegion');

    load();
    writeControls();
    render();

    for (var k = 0; k < INPUT_IDS.length; k++) {
      var el = dom[INPUT_IDS[k]];
      if (el) el.addEventListener('input', schedule);
    }

    /* Mode switches: amount versus percentage for down payment, tax and
       insurance. Each rewrites the paired field so the two never drift. */
    document.addEventListener('click', function (event) {
      var modeBtn = event.target.closest ? event.target.closest('[data-mode]') : null;

      if (modeBtn) {
        var group = modeBtn.getAttribute('data-mode-group');
        var value = modeBtn.getAttribute('data-mode');

        if (group === 'down') state.downMode = value;
        if (group === 'tax') state.taxMode = value;
        if (group === 'insurance') state.insuranceMode = value;

        state = E.normalize(state);
        writeControls();
        render();
        save();
        return;
      }

      var yearBtn = event.target.closest ? event.target.closest('[data-year]') : null;
      if (yearBtn) {
        var year = yearBtn.getAttribute('data-year');
        openYears[year] = !openYears[year];
        renderSchedule(result);
      }
    });

    var csvBtn = $('exportCsv');
    if (csvBtn) csvBtn.addEventListener('click', exportCSV);

    var resetBtn = $('resetAll');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state = E.defaultState();
        openYears = {};
        writeControls();
        render();
        save();
      });
    }

    var printBtn = $('printPage');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

    if (window.USCUI) {
      window.USCUI.presets($('presetRow'), PRESETS, applyPreset);

      sticky = window.USCUI.stickyBar({
        watch: dom.pitiValue,
        label: 'Monthly payment (PITI)',
        jumpTo: document.getElementById('uscApp')
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  window.USMortgageUI = {
    getState: function () { return state; },
    getResult: function () { return result; },
    setState: function (next) { state = E.normalize(next); writeControls(); render(); },
    render: render,
    exportCSV: exportCSV,
    STORAGE_KEY: STORAGE_KEY
  };
})();
