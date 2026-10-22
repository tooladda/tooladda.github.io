/* ==========================================================================
   ToolAdda — Home Loan Calculator (UI layer)

   Event wiring, the donut and balance charts, the amortisation table and
   the CSV export. Every number shown here comes from home-loan-engine.js,
   which is tested on its own.

   The schedule can run to 480 rows, so the table renders a year at a time
   and only expands the months of a year the reader actually opens.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.HomeLoanEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-home-loan';

  var state = E.defaultState();
  var result = null;
  var dom = {};
  var frame = 0;
  var toastTimer = 0;
  var openYears = {};

  /* ======================================================================
     Helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function money(v) { return E.formatINR(v); }
  function shortMoney(v) { return E.formatShortINR(v); }

  function toast(message, tone) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.dataset.tone = tone || 'info';
    dom.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.hidden = true; }, 3200);
  }

  function announce(m) { if (dom.live) dom.live.textContent = m; }

  function download(text, filename, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function monthsLabel(months) {
    var y = Math.floor(months / 12);
    var m = months % 12;
    if (!y) return m + ' month' + (m === 1 ? '' : 's');
    if (!m) return y + ' year' + (y === 1 ? '' : 's');
    return y + 'y ' + m + 'm';
  }

  /* ======================================================================
     Reading and writing the controls
     ====================================================================== */

  var NUMERIC_FIELDS = [
    'price', 'downPayment', 'annualRate', 'tenureYears', 'processingFee',
    'stampDutyPercent', 'registrationPercent', 'otherCharges',
    'stepUpPercent', 'extraMonthly', 'lumpSumAmount', 'lumpSumMonth',
    'monthlyIncome', 'existingEmis', 'foirPercent', 'slabPercent', 'other80CUsed'
  ];

  function readControls() {
    var next = {};
    NUMERIC_FIELDS.forEach(function (key) {
      var input = dom[key];
      if (input) next[key] = parseFloat(input.value);
    });
    if (dom.strategy) next.strategy = dom.strategy.value;
    if (dom.regime) next.regime = dom.regime.value;
    if (dom.selfOccupied) next.selfOccupied = dom.selfOccupied.value === 'self';
    if (dom.claim80EEA) next.claim80EEA = dom.claim80EEA.checked;
    state = E.normalize(next);
    return state;
  }

  function writeControls() {
    NUMERIC_FIELDS.forEach(function (key) {
      if (dom[key]) dom[key].value = String(state[key]);
    });
    if (dom.strategy) dom.strategy.value = state.strategy;
    if (dom.regime) dom.regime.value = state.regime;
    if (dom.selfOccupied) dom.selfOccupied.value = state.selfOccupied ? 'self' : 'let';
    if (dom.claim80EEA) dom.claim80EEA.checked = state.claim80EEA;
    syncSliders();
  }

  /** Keep each slider and its number box showing the same value. */
  function syncSliders() {
    all('[data-sync-slider]').forEach(function (slider) {
      var target = dom[slider.dataset.syncSlider];
      if (target) slider.value = target.value;
    });
    all('[data-sync-output]').forEach(function (out) {
      var key = out.dataset.syncOutput;
      if (!state.hasOwnProperty(key)) return;
      if (key === 'price' || key === 'downPayment') out.textContent = shortMoney(state[key]);
      else if (key === 'tenureYears') out.textContent = state[key] + ' yr';
      else if (/Percent$/.test(key) || key === 'annualRate') out.textContent = state[key] + '%';
      else out.textContent = money(state[key]);
    });
  }

  /* ======================================================================
     Rendering
     ====================================================================== */

  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      render();
    });
  }

  function render() {
    readControls();
    /* The labels read the state, so they refresh after it has the new values;
       otherwise a slider left them one step behind. */
    syncSliders();
    result = E.computeAll(state);

    renderHeadline();
    renderCost();
    renderPrepayment();
    renderTax();
    renderEligibility();
    renderCharts();
    renderTable();
    persist();
  }

  function renderHeadline() {
    var plan = result.plan;

    if (!plan.viable) {
      if (dom.emi) dom.emi.textContent = '—';
      if (dom.warning) {
        dom.warning.textContent = plan.reason;
        dom.warning.hidden = false;
      }
      return;
    }
    if (dom.warning) dom.warning.hidden = true;

    if (dom.emi) dom.emi.textContent = money(plan.baseEmi);
    if (dom.loanAmount) dom.loanAmount.textContent = money(result.cost.loanAmount);
    if (dom.totalInterest) dom.totalInterest.textContent = money(plan.totalInterest);
    if (dom.totalPayment) dom.totalPayment.textContent = money(plan.totalPaid);
    if (dom.payoff) dom.payoff.textContent = monthsLabel(plan.months);

    /* The ratio people rarely see stated: interest as a share of principal. */
    if (dom.interestRatio && result.cost.loanAmount > 0) {
      var ratio = (plan.totalInterest / result.cost.loanAmount) * 100;
      dom.interestRatio.textContent = 'You repay ' + Math.round(ratio) + '% of the loan again in interest';
    }
  }

  function renderCost() {
    var c = result.cost;
    var set = function (node, v) { if (node) node.textContent = money(v); };
    set(dom.outDownPayment, c.downPayment);
    set(dom.outStampDuty, c.stampDuty);
    set(dom.outRegistration, c.registration);
    set(dom.outProcessingFee, c.processingFee);
    set(dom.outOtherCharges, c.otherCharges);
    set(dom.outUpfront, c.upfrontCash);
    if (dom.outLtv) dom.outLtv.textContent = c.ltvPercent + '%';

    if (dom.ltvNote) {
      dom.ltvNote.textContent = result.ltv.message || '';
      dom.ltvNote.hidden = !result.ltv.message;
    }
  }

  function renderPrepayment() {
    if (!dom.prepayPanel) return;
    var cmp = result.comparison;
    if (!cmp || !result.hasExtras) {
      dom.prepayPanel.hidden = true;
      return;
    }
    dom.prepayPanel.hidden = false;
    if (dom.savedInterest) dom.savedInterest.textContent = money(cmp.interestSaved);
    if (dom.savedMonths) dom.savedMonths.textContent = monthsLabel(cmp.monthsSaved);
    if (dom.newTenure) dom.newTenure.textContent = monthsLabel(cmp.newMonths);
    if (dom.prepaySummary) {
      dom.prepaySummary.textContent = cmp.monthsSaved > 0
        ? 'Paying extra clears the loan ' + monthsLabel(cmp.monthsSaved) + ' sooner and saves ' +
          money(cmp.interestSaved) + ' in interest.'
        : 'This plan lowers the instalment rather than the tenure, saving ' +
          money(cmp.interestSaved) + ' in interest.';
    }
  }

  function renderTax() {
    var t = result.tax;
    var set = function (node, v) { if (node) node.textContent = money(v); };
    set(dom.outSection24, t.section24);
    set(dom.outSection80C, t.section80C);
    set(dom.outSection80EEA, t.section80EEA);
    set(dom.outTaxSaved, t.taxSaved);
    if (dom.taxNote) dom.taxNote.textContent = t.note;
    if (dom.eeaRow) dom.eeaRow.hidden = t.section80EEA <= 0;
  }

  function renderEligibility() {
    var e = result.eligibility;
    if (dom.outAffordableEmi) dom.outAffordableEmi.textContent = money(e.affordableEmi);
    if (dom.outMaxLoan) dom.outMaxLoan.textContent = money(e.maxLoan);
    if (dom.eligibilityNote) dom.eligibilityNote.textContent = e.note;

    /* Compare what they can borrow with what they are trying to borrow. */
    if (dom.eligibilityVerdict) {
      var need = result.cost.loanAmount;
      if (need <= 0 || e.maxLoan <= 0) {
        dom.eligibilityVerdict.hidden = true;
      } else {
        var short = need - e.maxLoan;
        dom.eligibilityVerdict.hidden = false;
        if (short <= 0) {
          dom.eligibilityVerdict.textContent = 'This loan sits inside the estimate — comfortably within a ' +
            e.foirPercent + '% FOIR.';
          dom.eligibilityVerdict.dataset.tone = 'good';
        } else {
          dom.eligibilityVerdict.textContent = 'This loan is about ' + money(short) +
            ' more than the estimate allows. A longer tenure, a larger down payment or a co-applicant would close the gap.';
          dom.eligibilityVerdict.dataset.tone = 'warn';
        }
      }
    }
  }

  /* ======================================================================
     Charts — hand-drawn on canvas, no library
     ====================================================================== */

  function themeColors() {
    var css = getComputedStyle(document.documentElement);
    var read = function (name, fallback) {
      var v = css.getPropertyValue(name);
      return (v && v.trim()) || fallback;
    };
    return {
      principal: read('--hlc-accent', '#0f766e'),
      interest: read('--hlc-warn', '#c2410c'),
      grid: read('--hlc-border', 'rgba(0,0,0,.12)'),
      text: read('--hlc-muted', '#6b7280')
    };
  }

  function setupCanvas(canvas, height) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var width = canvas.parentNode ? canvas.parentNode.clientWidth : 320;
    if (width < 100) width = 320;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx: ctx, width: width, height: height };
  }

  /** Donut: principal versus interest over the life of the loan. */
  function drawDonut() {
    if (!dom.donut) return;
    var setup = setupCanvas(dom.donut, 210);
    if (!setup) return;
    var ctx = setup.ctx;
    var c = themeColors();

    var principal = result.cost.loanAmount;
    var interest = result.plan.totalInterest;
    var total = principal + interest;
    if (total <= 0) return;

    var cx = setup.width / 2;
    var cy = setup.height / 2;
    var radius = Math.min(cx, cy) - 8;
    var inner = radius * 0.62;
    var start = -Math.PI / 2;

    [{ v: principal, color: c.principal }, { v: interest, color: c.interest }].forEach(function (slice) {
      var angle = (slice.v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      start += angle;
    });

    /* Punch the middle out so it reads as a ring. */
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = c.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('Interest', cx, cy - 9);
    ctx.font = '900 17px system-ui, sans-serif';
    ctx.fillText(Math.round((interest / total) * 100) + '%', cx, cy + 10);
  }

  /** Outstanding balance over time, base plan versus prepayment plan. */
  function drawBalanceChart() {
    if (!dom.balanceChart) return;
    var setup = setupCanvas(dom.balanceChart, 230);
    if (!setup) return;
    var ctx = setup.ctx;
    var c = themeColors();
    var pad = { l: 52, r: 12, t: 12, b: 26 };
    var w = setup.width - pad.l - pad.r;
    var h = setup.height - pad.t - pad.b;
    if (w <= 10 || h <= 10) return;

    var base = result.base.rows;
    var plan = result.plan.rows;
    var maxMonths = Math.max(base.length, plan.length);
    var maxBalance = result.cost.loanAmount;
    if (!maxMonths || maxBalance <= 0) return;

    var x = function (m) { return pad.l + (m / maxMonths) * w; };
    var y = function (b) { return pad.t + h - (b / maxBalance) * h; };

    /* Axes */
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + h);
    ctx.lineTo(pad.l + w, pad.t + h);
    ctx.stroke();

    ctx.fillStyle = c.text;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var value = maxBalance * (g / 4);
      var gy = y(value);
      ctx.fillText(shortMoney(value), pad.l - 6, gy);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + w, gy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var t = 0; t <= 4; t++) {
      var m = Math.round((maxMonths * t) / 4);
      ctx.fillText(Math.round(m / 12) + 'y', x(m), pad.t + h + 6);
    }

    var line = function (rows, color, dashed) {
      if (!rows.length) return;
      ctx.beginPath();
      ctx.moveTo(x(0), y(maxBalance));
      rows.forEach(function (row) { ctx.lineTo(x(row.month), y(row.balance)); });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    /* Only draw the base line when it differs, or it just doubles the plan. */
    if (result.hasExtras) line(base, c.interest, true);
    line(plan, c.principal, false);

    if (dom.chartLegend) {
      dom.chartLegend.textContent = result.hasExtras
        ? 'Solid: with your extra payments. Dashed: without them.'
        : 'Outstanding balance over the life of the loan.';
    }
  }

  function renderCharts() {
    drawDonut();
    drawBalanceChart();
  }

  /* ======================================================================
     Amortisation table

     Years render as rows; a year expands into its months only when opened,
     so a 40-year loan does not put 480 rows into the document at once.
     ====================================================================== */

  function renderTable() {
    if (!dom.tableBody) return;
    var body = dom.tableBody;
    while (body.firstChild) body.removeChild(body.firstChild);

    var rows = result.plan.rows;
    if (!rows.length) {
      var empty = el('tr');
      var cell = el('td', null, 'No schedule to show.');
      cell.colSpan = 6;
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }

    result.yearly.forEach(function (year) {
      var tr = el('tr', 'hlc-year-row');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-expanded', openYears[year.year] ? 'true' : 'false');
      tr.setAttribute('aria-label', 'Year ' + year.year + ', select to show each month');

      [
        (openYears[year.year] ? '▾ ' : '▸ ') + 'Year ' + year.year,
        money(year.principal),
        money(year.interest),
        year.prepayment > 0 ? money(year.prepayment) : '—',
        money(year.paid),
        money(year.balance)
      ].forEach(function (text, i) {
        var td = el('td', i === 0 ? 'hlc-year-cell' : null, text);
        tr.appendChild(td);
      });

      var toggle = function () {
        openYears[year.year] = !openYears[year.year];
        renderTable();
      };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      body.appendChild(tr);

      if (!openYears[year.year]) return;
      rows.filter(function (r) { return r.year === year.year; }).forEach(function (r) {
        var mtr = el('tr', 'hlc-month-row');
        [
          'Month ' + r.month,
          money(r.principal),
          money(r.interest),
          r.prepayment > 0 ? money(r.prepayment) : '—',
          money(r.emi + r.prepayment),
          money(r.balance)
        ].forEach(function (text) { mtr.appendChild(el('td', null, text)); });
        body.appendChild(mtr);
      });
    });

    if (dom.tableCaption) {
      dom.tableCaption.textContent = 'Amortisation over ' + monthsLabel(result.plan.months) +
        ' — select a year to see each month.';
    }
  }

  /* ======================================================================
     Actions
     ====================================================================== */

  function exportCSV() {
    if (!result || !result.plan.rows.length) return;
    download(E.scheduleToCSV(result.plan.rows), 'home-loan-schedule.csv', 'text/csv;charset=utf-8');
    toast('Schedule downloaded as CSV', 'good');
  }

  function copySummary() {
    if (!result) return;
    var p = result.plan;
    var lines = [
      'Home loan summary — tooladda.online',
      '',
      'Property price      : ' + money(state.price),
      'Down payment        : ' + money(state.downPayment) + ' (' + result.cost.downPaymentPercent + '%)',
      'Loan amount         : ' + money(result.cost.loanAmount),
      'Interest rate       : ' + state.annualRate + '% p.a.',
      'Tenure              : ' + state.tenureYears + ' years',
      '',
      'Monthly EMI         : ' + money(p.baseEmi),
      'Total interest      : ' + money(p.totalInterest),
      'Total repayment     : ' + money(p.totalPaid),
      'Actual payoff       : ' + monthsLabel(p.months),
      '',
      'Upfront cash needed : ' + money(result.cost.upfrontCash),
      '  down payment      : ' + money(result.cost.downPayment),
      '  stamp duty        : ' + money(result.cost.stampDuty),
      '  registration      : ' + money(result.cost.registration),
      '  processing fee    : ' + money(result.cost.processingFee)
    ];
    if (result.comparison) {
      lines.push('', 'With extra payments : saves ' + money(result.comparison.interestSaved) +
        ' and ' + monthsLabel(result.comparison.monthsSaved));
    }

    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { toast('Summary copied', 'good'); })
        .catch(function () { toast('Could not copy — your browser blocked it.', 'bad'); });
    } else {
      toast('Copying is not available in this browser.', 'bad');
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (err) { /* private mode — settings simply will not persist */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = E.normalize(JSON.parse(raw));
    } catch (err) { state = E.defaultState(); }
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.root = $('hlcApp');
    dom.toast = $('hlcToast');
    dom.live = $('hlcLive');
    dom.warning = $('hlcWarning');

    NUMERIC_FIELDS.forEach(function (key) { dom[key] = $('hlc' + key.charAt(0).toUpperCase() + key.slice(1)); });
    dom.strategy = $('hlcStrategy');
    dom.regime = $('hlcRegime');
    dom.selfOccupied = $('hlcOccupancy');
    dom.claim80EEA = $('hlcClaim80EEA');

    dom.emi = $('hlcEmi');
    dom.loanAmount = $('hlcLoanAmount');
    dom.totalInterest = $('hlcTotalInterest');
    dom.totalPayment = $('hlcTotalPayment');
    dom.payoff = $('hlcPayoff');
    dom.interestRatio = $('hlcInterestRatio');

    dom.outDownPayment = $('hlcOutDownPayment');
    dom.outStampDuty = $('hlcOutStampDuty');
    dom.outRegistration = $('hlcOutRegistration');
    dom.outProcessingFee = $('hlcOutProcessingFee');
    dom.outOtherCharges = $('hlcOutOtherCharges');
    dom.outUpfront = $('hlcOutUpfront');
    dom.outLtv = $('hlcOutLtv');
    dom.ltvNote = $('hlcLtvNote');

    dom.prepayPanel = $('hlcPrepayPanel');
    dom.savedInterest = $('hlcSavedInterest');
    dom.savedMonths = $('hlcSavedMonths');
    dom.newTenure = $('hlcNewTenure');
    dom.prepaySummary = $('hlcPrepaySummary');

    dom.outSection24 = $('hlcOutSection24');
    dom.outSection80C = $('hlcOutSection80C');
    dom.outSection80EEA = $('hlcOutSection80EEA');
    dom.outTaxSaved = $('hlcOutTaxSaved');
    dom.taxNote = $('hlcTaxNote');
    dom.eeaRow = $('hlcEeaRow');

    dom.outAffordableEmi = $('hlcOutAffordableEmi');
    dom.outMaxLoan = $('hlcOutMaxLoan');
    dom.eligibilityNote = $('hlcEligibilityNote');
    dom.eligibilityVerdict = $('hlcEligibilityVerdict');

    dom.donut = $('hlcDonut');
    dom.balanceChart = $('hlcBalanceChart');
    dom.chartLegend = $('hlcChartLegend');

    dom.tableBody = $('hlcTableBody');
    dom.tableCaption = $('hlcTableCaption');

    dom.exportBtn = $('hlcExport');
    dom.copyBtn = $('hlcCopy');
    dom.resetBtn = $('hlcReset');
  }

  function wire() {
    NUMERIC_FIELDS.forEach(function (key) {
      on(dom[key], 'input', function () { schedule(); syncSliders(); });
    });
    [dom.strategy, dom.regime, dom.selfOccupied].forEach(function (s) {
      on(s, 'change', schedule);
    });
    on(dom.claim80EEA, 'change', schedule);

    /* Sliders drive their paired number input, then the usual pipeline. */
    all('[data-sync-slider]').forEach(function (slider) {
      on(slider, 'input', function () {
        var target = dom[slider.dataset.syncSlider];
        if (!target) return;
        target.value = slider.value;
        schedule();
      });
    });

    all('[data-preset-tenure]').forEach(function (btn) {
      on(btn, 'click', function () {
        if (dom.tenureYears) dom.tenureYears.value = btn.dataset.presetTenure;
        schedule();
        announce('Tenure set to ' + btn.dataset.presetTenure + ' years.');
      });
    });

    on(dom.exportBtn, 'click', exportCSV);
    on(dom.copyBtn, 'click', copySummary);
    on(dom.resetBtn, 'click', function () {
      state = E.defaultState();
      openYears = {};
      writeControls();
      render();
      toast('Reset to defaults', 'good');
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderCharts, 150);
    });

    /* Redraw the charts when the site theme flips, or they keep old colours. */
    if (window.MutationObserver) {
      new MutationObserver(function () { renderCharts(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function initializeCalculator() {
    cacheDom();
    if (!dom.root) return;
    restore();
    writeControls();
    wire();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeCalculator);
  else initializeCalculator();

  window.HomeLoanUI = {
    getState: function () { return state; },
    getResult: function () { return result; },
    setState: function (next) { state = E.normalize(next); writeControls(); render(); },
    render: render,
    exportCSV: exportCSV,
    STORAGE_KEY: STORAGE_KEY
  };
})();
