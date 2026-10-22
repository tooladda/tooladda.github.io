/* ==========================================================================
   ToolAdda — Luxembourg Gross-to-Net Salary Calculator (UI layer)

   Event wiring, formatting, the payslip table and the two charts. Every
   number shown here comes from lu-salary-engine.js, which has no DOM and is
   testable on its own.

   Two interface decisions worth stating, because they are not obvious:

   * REVERSE MODE IS THE SAME FORM. "What gross do I need to take home
     EUR 4,000?" is the question people actually arrive with when they are
     negotiating, and it is the one no employer's offer letter answers. It is
     the same model solved backwards, so it is the same form with one input
     relabelled rather than a second page.

   * THE CLASS COMPARISON IS ALWAYS ON. Most readers do not know which class
     they are in, and the difference between them on the same salary runs to
     four figures a year. Showing all three side by side answers the question
     before it is asked, and makes the currently selected one meaningful.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.LUSalaryEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-lu-salary';

  var state = E.defaultState();
  var mode = 'gross';        /* 'gross' | 'net' */
  var targetNet = 4000;
  var result = null;
  var solved = null;         /* reverse-mode solution, when mode === 'net' */
  var dom = {};
  var frame = 0;
  var sticky = null;

  /* ======================================================================
     Formatting
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }

  /* en-IE — the euro-zone English locale, so the page reads consistently
     with its own prose and percentages (EUR 1,234.56) instead of mixing
     German grouping into an English page. It is also the locale
     invoice-engine.js already picked for EUR. */
  var money0 = new Intl.NumberFormat('en-IE', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  var money2 = new Intl.NumberFormat('en-IE', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  function eur(n) { return money0.format(isFinite(n) ? n : 0); }
  function eur2(n) { return money2.format(isFinite(n) ? n : 0); }
  function pct(n, dp) { return (isFinite(n) ? n * 100 : 0).toFixed(dp === undefined ? 1 : dp) + '%'; }

  function setText(id, value) {
    var el = dom[id];
    if (el) el.textContent = value;
  }

  function classLabel(taxClass) {
    if (taxClass === '1a') return 'Class 1a';
    if (taxClass === '2') return 'Class 2';
    return 'Class 1';
  }

  function classHint(taxClass) {
    if (taxClass === '1a') return 'Single with a dependent child, widowed, or 65+';
    if (taxClass === '2') return 'Married or in a civil partnership, taxed jointly';
    return 'Single, no dependent children';
  }

  /* The page's accent, read from CSS so the charts follow the theme. */
  function accentColor() {
    try {
      var host = document.querySelector('.usc-page') || document.body;
      var v = getComputedStyle(host).getPropertyValue('--usc-accent');
      if ((v || '').trim()) return v.trim();
    } catch (error) { /* fall through */ }
    return '#0e7490';
  }

  /* ======================================================================
     Storage
     ====================================================================== */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        state: state, mode: mode, targetNet: targetNet
      }));
    } catch (error) { /* private mode, quota — the page still works */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.state) state = E.normalize(parsed.state);
      if (parsed && (parsed.mode === 'net' || parsed.mode === 'gross')) mode = parsed.mode;
      if (parsed && isFinite(parsed.targetNet)) targetNet = parsed.targetNet;
    } catch (error) { /* corrupt entry — fall back to defaults */ }
  }

  /* ======================================================================
     Form <-> state
     ====================================================================== */

  function num(id, fallback) {
    var el = dom[id];
    if (!el) return fallback;
    var n = parseFloat(el.value);
    return isFinite(n) ? n : fallback;
  }

  function readForm() {
    if (mode === 'net') {
      targetNet = Math.max(0, num('amount', targetNet));
    } else {
      state.grossMonthly = Math.max(0, num('amount', state.grossMonthly));
    }

    state.payments = dom.payments && dom.payments.value === '13' ? 13 : 12;
    state.bonus = Math.max(0, num('bonus', 0));
    state.spouseGrossMonthly = Math.max(0, num('spouse', 0));
    state.deductions = Math.max(0, num('deductions', 0));
    state.singleParent = !!(dom.singleParent && dom.singleParent.checked);
    state.resident = !(dom.resident && dom.resident.value === 'non-resident');
    state.showEmployerCost = !!(dom.employerToggle && dom.employerToggle.checked);
    state.accidentRate = num('accidentRate', 0.75);
    state.mutualityRate = num('mutualityRate', 1.35);

    state = E.normalize(state);
  }

  function writeForm() {
    if (dom.amount) dom.amount.value = mode === 'net' ? targetNet : state.grossMonthly;
    if (dom.payments) dom.payments.value = String(state.payments);
    if (dom.bonus) dom.bonus.value = state.bonus;
    if (dom.spouse) dom.spouse.value = state.spouseGrossMonthly;
    if (dom.deductions) dom.deductions.value = state.deductions;
    if (dom.singleParent) dom.singleParent.checked = state.singleParent;
    if (dom.resident) dom.resident.value = state.resident ? 'resident' : 'non-resident';
    if (dom.employerToggle) dom.employerToggle.checked = state.showEmployerCost;
    if (dom.accidentRate) dom.accidentRate.value = state.accidentRate;
    if (dom.mutualityRate) dom.mutualityRate.value = state.mutualityRate;

    syncClassButtons();
    syncModeButtons();
    syncConditionalFields();
  }

  function syncClassButtons() {
    (dom.classButtons || []).forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.taxClass === state.taxClass ? 'true' : 'false');
    });
  }

  function syncModeButtons() {
    (dom.modeButtons || []).forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.mode === mode ? 'true' : 'false');
    });

    if (dom.amountLabel) {
      dom.amountLabel.textContent = mode === 'net'
        ? 'Net you want per month'
        : 'Gross salary per month';
    }
    if (dom.amountHint) {
      dom.amountHint.textContent = mode === 'net'
        ? 'The amount that should land in your account. We solve for the gross that produces it.'
        : 'Before any deduction — the figure on your contract.';
    }
    if (dom.amount) {
      dom.amount.setAttribute('aria-label', mode === 'net' ? 'Target net salary per month' : 'Gross salary per month');
    }
  }

  /* Spouse income only exists in class 2; the single-parent credit only in
     class 1a. Hiding rather than disabling keeps the form short — these are
     the two fields most readers will never touch. */
  function syncConditionalFields() {
    if (dom.spouseField) dom.spouseField.hidden = state.taxClass !== '2';
    if (dom.singleParentField) dom.singleParentField.hidden = state.taxClass !== '1a';
    if (dom.employerRates) dom.employerRates.hidden = !state.showEmployerCost;
    if (dom.employerPanel) dom.employerPanel.hidden = !state.showEmployerCost;
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      render();
    });
  }

  function recompute() {
    if (mode === 'net') {
      solved = E.grossForNet(targetNet, state);
      state.grossMonthly = E.cents(solved.grossMonthly);
    } else {
      solved = null;
    }
    result = E.compute(state);
  }

  function render() {
    recompute();

    var r = result;
    var n = r.state.payments;

    /* --- headline --- */
    setText('netHeadline', eur2(r.netMonthly));
    setText('netHeadlineLabel', r.joint
      ? 'household net per month (' + n + ' payments)'
      : 'net per month (' + n + ' payments)');

    /* --- reverse-mode answer --- */
    if (dom.solveNote) {
      if (mode === 'net' && solved) {
        dom.solveNote.hidden = false;
        var sentence = 'To take home ' + eur2(targetNet) + ' a month in ' +
          classLabel(state.taxClass) + ', you need to earn ' + eur2(state.grossMonthly) +
          ' gross a month — ' + eur(state.grossMonthly * n + state.bonus) + ' a year.';

        /* The solver returns the lowest gross that reaches the target, and
           every plausible target is reachable. `exact` is false only when the
           ask is beyond the range it will search — say so rather than
           presenting the ceiling as if it were the answer. */
        if (!solved.exact) {
          sentence = 'Even at ' + eur2(state.grossMonthly) + ' gross a month the net only reaches ' +
            eur2(solved.netMonthly) + '. A target that high is outside what this calculator will solve for.';
        }
        dom.solveNote.textContent = sentence;
        dom.solveNote.className = 'usc-note ' + (solved.exact ? 'usc-note--good' : 'usc-note--warn');
      } else {
        dom.solveNote.hidden = true;
      }
    }

    /* --- the split bar --- */
    var socialTotal = r.householdSocial;
    /* A negative tax is a payment to the employee, not a slice of the bar, so
       the segment is clamped at zero and the note below explains the refund. */
    var taxPaid = Math.max(0, r.netTax);

    if (window.USCCharts && dom.splitBar) {
      window.USCCharts.stackedBar(dom.splitBar, [
        { name: 'Take-home', value: r.netAnnual / n, color: window.USCCharts.seriesColor(2) },
        { name: 'Social contributions', value: socialTotal / n, color: window.USCCharts.seriesColor(0) },
        { name: 'Tax withheld', value: taxPaid / n, color: window.USCCharts.seriesColor(1) }
      ], { format: eur2, caption: 'Where each month of gross salary goes' });
    }

    /* --- headline stats --- */
    setText('grossMonthlyOut', eur2(r.grossMonthly));
    setText('grossAnnualOut', eur(r.householdGross));
    setText('netAnnualOut', eur(r.netAnnual));
    setText('socialOut', eur2(socialTotal / n));
    setText('taxOut', eur2(r.netTax / n));
    setText('takeHomeOut', pct(r.takeHomeRate));
    setText('effectiveOut', pct(r.effectiveTaxRate));
    setText('marginalOut', pct(r.marginalRate));

    /* --- the payslip --- */
    renderBreakdown(r);

    /* --- class comparison --- */
    renderComparison();

    /* --- employer cost --- */
    renderEmployer(r);

    /* --- notes --- */
    renderNotes(r);

    /* --- the curve --- */
    renderCurve();

    if (sticky) sticky.update();
    save();

    if (dom.liveRegion) {
      dom.liveRegion.textContent = 'Net ' + eur2(r.netMonthly) + ' per month, ' +
        pct(r.takeHomeRate) + ' of gross.';
    }
  }

  function row(label, annual, months, opts) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    if (opts && opts.sub) {
      var small = document.createElement('small');
      small.textContent = ' ' + opts.sub;
      th.appendChild(small);
    }
    tr.appendChild(th);

    [annual, annual / months].forEach(function (value) {
      var td = document.createElement('td');
      td.textContent = (opts && opts.negative ? '−' : '') + eur2(Math.abs(value));
      tr.appendChild(td);
    });

    if (opts && opts.strong) tr.className = 'is-highlight';
    return tr;
  }

  function renderBreakdown(r) {
    var body = dom.breakdownBody;
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var n = r.state.payments;
    var s = r.social;
    var sp = r.spouseSocial;
    var p = E.PARAMS;

    body.appendChild(row('Gross salary', r.annualGross, n));
    if (r.joint) body.appendChild(row('Spouse gross salary', r.spouseAnnualGross, n));

    body.appendChild(row('Health insurance', -(s.health + (sp ? sp.health : 0)), n,
      { negative: true, sub: '(' + pct(p.social.health, 2) + ')' }));
    body.appendChild(row('Pension', -(s.pension + (sp ? sp.pension : 0)), n,
      { negative: true, sub: '(' + pct(p.social.pension, 2) + ')' }));
    body.appendChild(row('Dependency contribution', -(s.dependency + (sp ? sp.dependency : 0)), n,
      { negative: true, sub: '(' + pct(p.social.dependency, 2) + ', after allowance)' }));

    body.appendChild(row('Taxable income', r.taxableIncome, n,
      { sub: 'after contributions and flat-rate allowances' }));

    body.appendChild(row('Income tax (' + classLabel(r.state.taxClass) + ' scale)', -r.baseTax, n, { negative: true }));
    body.appendChild(row('Employment fund surcharge', -r.surcharge, n,
      { negative: true, sub: '(' + pct(r.surchargeRate, 0) + ' of the tax)' }));

    if (r.credits.cis > 0) body.appendChild(row('Employee tax credit (CIS)', r.credits.cis, n));
    if (r.credits.co2 > 0) body.appendChild(row('CO₂ tax credit', r.credits.co2, n));
    if (r.credits.cim > 0) body.appendChild(row('Single-parent credit (CIM)', r.credits.cim, n));

    body.appendChild(row(r.netTax < 0 ? 'Tax refunded to you' : 'Tax withheld', -r.netTax, n,
      { negative: r.netTax >= 0 }));
    body.appendChild(row('Net salary', r.netAnnual, n, { strong: true }));
  }

  function renderComparison() {
    var body = dom.compareBody;
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var rows = E.compareClasses(state);
    var best = rows.reduce(function (a, b) { return b.netAnnual > a.netAnnual ? b : a; });

    rows.forEach(function (item) {
      var tr = document.createElement('tr');
      if (item.taxClass === state.taxClass) tr.className = 'is-highlight';

      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = classLabel(item.taxClass);
      var small = document.createElement('small');
      small.textContent = ' ' + classHint(item.taxClass);
      th.appendChild(small);
      tr.appendChild(th);

      [eur2(item.netMonthly), eur(item.netAnnual), pct(item.takeHomeRate)].forEach(function (value) {
        var td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      var diff = document.createElement('td');
      var delta = item.netAnnual - best.netAnnual;
      diff.textContent = delta === 0 ? '—' : '−' + eur(Math.abs(delta));
      diff.className = delta === 0 ? 'usc-good' : '';
      tr.appendChild(diff);

      body.appendChild(tr);
    });

    if (dom.compareNote) {
      dom.compareNote.textContent = 'Compared on your own salary only, ignoring any spouse income — ' +
        'so this is what the class itself is worth, not what a second earner changes.';
    }
  }

  function renderEmployer(r) {
    if (!dom.employerPanel || !r.employer) return;

    var n = r.state.payments;
    var e = r.employer;

    setText('employerTotalOut', eur(e.total));
    setText('employerMonthlyOut', eur2(e.total / n));
    setText('employerOnTopOut', eur(e.contributions));
    setText('employerLoadOut', r.annualGross > 0 ? pct(e.contributions / r.annualGross) : '—');

    var body = dom.employerBody;
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    body.appendChild(row('Gross salary', r.annualGross, n));
    body.appendChild(row('Employer health insurance', e.health, n));
    body.appendChild(row('Employer pension', e.pension, n));
    body.appendChild(row('Accident insurance', e.accident, n, { sub: '(' + r.state.accidentRate + '%)' }));
    body.appendChild(row('Employers’ mutual insurance', e.mutuality, n, { sub: '(' + r.state.mutualityRate + '%)' }));
    body.appendChild(row('Occupational health', e.occupationalHealth, n));
    body.appendChild(row('Total cost of employment', e.total, n, { strong: true }));
  }

  function note(text, tone) {
    var div = document.createElement('div');
    div.className = 'usc-note' + (tone ? ' usc-note--' + tone : '');
    div.textContent = text;
    return div;
  }

  function renderNotes(r) {
    var host = dom.notes;
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    var p = E.PARAMS;
    var monthly = r.state.grossMonthly;

    if (monthly > 0 && monthly < p.minimumWage.unqualified) {
      host.appendChild(note('That is below the Luxembourg social minimum wage of ' +
        eur2(p.minimumWage.unqualified) + ' a month for an unqualified worker aged 18 or over ' +
        '(' + eur2(p.minimumWage.qualified) + ' for a qualified one). A full-time contract cannot legally pay less.', 'warn'));
    }

    if (r.social.overCeiling) {
      host.appendChild(note('Above ' + eur2(p.social.ceilingMonthly) + ' a month, health and pension contributions stop — ' +
        'they are capped at five times the minimum wage. Only the dependency contribution keeps rising, ' +
        'which is why your marginal rate falls above the ceiling rather than climbing.', 'good'));
    }

    if (r.surchargeRate > p.surcharge.normal) {
      host.appendChild(note('The employment fund surcharge is at its higher ' + pct(p.surcharge.high, 0) +
        ' rate: taxable income has passed ' +
        eur(r.state.taxClass === '2' ? p.surcharge.thresholdJoint : p.surcharge.thresholdSingle) + '.'));
    }

    if (r.netTax < 0) {
      host.appendChild(note('Your tax credits exceed the tax due, so ' + eur2(-r.netTax) +
        ' a year is paid out to you by your employer rather than withheld. CIS and CI-CO₂ are refundable.', 'good'));
    }

    if (!r.state.resident) {
      host.appendChild(note('As a non-resident you are placed in tax class 1 by default. You can request to be ' +
        'treated as a resident — and so reach class 2 — if at least 90% of your worldwide income is taxable ' +
        'in Luxembourg (50% of household income for Belgian residents). Cross-border workers should also ' +
        'watch the 34 teleworking days a year allowed before income becomes taxable at home.'));
    }

    if (r.state.bonus > 0) {
      host.appendChild(note('The bonus is added to the year and taxed with it. Month to month your employer ' +
        'may withhold more in the month it is paid and settle the difference at the annual reckoning.'));
    }
  }

  function renderCurve() {
    if (!window.USCCharts || !dom.curve) return;

    var maxMonthly = Math.max(9000, Math.ceil((state.grossMonthly * 1.8) / 1000) * 1000);
    var curve = E.netCurve(state, { maxMonthly: maxMonthly, points: 60 });
    var accent = accentColor();

    window.USCCharts.lineChart(dom.curve, {
      series: [
        {
          name: 'Net',
          color: accent,
          points: curve.map(function (p) { return { x: p.grossMonthly, y: p.netMonthly }; })
        },
        {
          name: 'Gross',
          color: window.USCCharts.seriesColor(1),
          points: curve.map(function (p) { return { x: p.grossMonthly, y: p.grossMonthly }; })
        }
      ],
      formatY: function (v) { return window.USCCharts.shortMoney(v); },
      formatX: function (v) { return window.USCCharts.shortMoney(v); },
      areaFill: false,
      caption: 'Net monthly salary against gross monthly salary in tax ' + classLabel(state.taxClass)
    });
  }

  /* ======================================================================
     Actions
     ====================================================================== */

  function exportCsv() {
    if (!result) return;
    var blob = new Blob([E.toCSV(result)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'luxembourg-salary-' + Math.round(state.grossMonthly) + '-' + classLabel(state.taxClass).toLowerCase().replace(/\s+/g, '') + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function resetAll() {
    state = E.defaultState();
    mode = 'gross';
    targetNet = 4000;
    writeForm();
    schedule();
  }

  /* ======================================================================
     Presets
     ====================================================================== */

  var PRESETS = [
    { label: 'Minimum wage, single', hint: 'Unqualified social minimum wage, tax class 1',
      state: { grossMonthly: 2703.74, taxClass: '1', payments: 12, bonus: 0, spouseGrossMonthly: 0 } },
    { label: 'Qualified minimum', hint: 'Qualified social minimum wage, tax class 1',
      state: { grossMonthly: 3244.48, taxClass: '1', payments: 12, bonus: 0, spouseGrossMonthly: 0 } },
    { label: 'Typical office job', hint: 'EUR 5,500 a month, single, tax class 1',
      state: { grossMonthly: 5500, taxClass: '1', payments: 12, bonus: 0, spouseGrossMonthly: 0 } },
    { label: 'Couple, one earner', hint: 'EUR 6,500 a month, tax class 2, no second income',
      state: { grossMonthly: 6500, taxClass: '2', payments: 12, bonus: 0, spouseGrossMonthly: 0 } },
    { label: 'Couple, two earners', hint: 'EUR 6,000 and EUR 4,000 a month, tax class 2',
      state: { grossMonthly: 6000, taxClass: '2', payments: 12, bonus: 0, spouseGrossMonthly: 4000 } },
    { label: 'Single parent', hint: 'EUR 4,800 a month, tax class 1a with the CIM',
      state: { grossMonthly: 4800, taxClass: '1a', payments: 12, bonus: 0, singleParent: true } },
    { label: 'Finance, with bonus', hint: 'EUR 9,000 a month plus a EUR 20,000 bonus',
      state: { grossMonthly: 9000, taxClass: '1', payments: 13, bonus: 20000, spouseGrossMonthly: 0 } }
  ];

  function applyPreset(patch) {
    var key;
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) state[key] = patch[key];
    }
    /* A preset that does not mention these should clear them, or the reader
       carries a spouse income into a single-person scenario. */
    if (!Object.prototype.hasOwnProperty.call(patch, 'singleParent')) state.singleParent = false;
    if (!Object.prototype.hasOwnProperty.call(patch, 'spouseGrossMonthly')) state.spouseGrossMonthly = 0;

    state = E.normalize(state);
    mode = 'gross';
    writeForm();
    schedule();
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function cache() {
    ['amount', 'amountLabel', 'amountHint', 'payments', 'bonus', 'spouse', 'spouseField',
     'deductions', 'singleParent', 'singleParentField', 'resident',
     'employerToggle', 'employerRates', 'employerPanel', 'employerBody',
     'accidentRate', 'mutualityRate',
     'netHeadline', 'netHeadlineLabel', 'solveNote', 'splitBar',
     'grossMonthlyOut', 'grossAnnualOut', 'netAnnualOut', 'socialOut', 'taxOut',
     'takeHomeOut', 'effectiveOut', 'marginalOut',
     'breakdownBody', 'compareBody', 'compareNote', 'employerTotalOut', 'employerMonthlyOut',
     'employerOnTopOut', 'employerLoadOut', 'notes', 'curve', 'liveRegion',
     'presetRow', 'exportCsv', 'printPage', 'resetAll'
    ].forEach(function (id) { dom[id] = $(id); });

    dom.classButtons = Array.prototype.slice.call(document.querySelectorAll('[data-tax-class]'));
    dom.modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mode]'));
  }

  function wire() {
    ['amount', 'bonus', 'spouse', 'deductions', 'accidentRate', 'mutualityRate'].forEach(function (id) {
      on(dom[id], 'input', function () { readForm(); schedule(); });
    });

    ['payments', 'resident'].forEach(function (id) {
      on(dom[id], 'change', function () { readForm(); schedule(); });
    });

    on(dom.singleParent, 'change', function () { readForm(); schedule(); });

    on(dom.employerToggle, 'change', function () {
      readForm();
      syncConditionalFields();
      schedule();
    });

    dom.classButtons.forEach(function (btn) {
      on(btn, 'click', function () {
        state.taxClass = btn.dataset.taxClass;
        state = E.normalize(state);
        syncClassButtons();
        syncConditionalFields();
        schedule();
      });
    });

    dom.modeButtons.forEach(function (btn) {
      on(btn, 'click', function () {
        if (mode === btn.dataset.mode) return;
        /* Carry the current answer across the switch: flipping to "net" with
           the gross figure still in the box would solve for a salary nobody
           asked about. */
        if (btn.dataset.mode === 'net') targetNet = result ? E.cents(result.netMonthly) : targetNet;
        mode = btn.dataset.mode;
        writeForm();
        schedule();
      });
    });

    on(dom.exportCsv, 'click', exportCsv);
    on(dom.printPage, 'click', function () { window.print(); });
    on(dom.resetAll, 'click', resetAll);
  }

  function init() {
    cache();
    if (!dom.amount) return;

    load();
    writeForm();
    wire();

    if (window.USCUI) {
      window.USCUI.presets(dom.presetRow, PRESETS, function (patch) { applyPreset(patch); });

      if (dom.netHeadline) {
        sticky = window.USCUI.stickyBar({
          watch: dom.netHeadline,
          label: 'Net per month',
          jumpTo: document.getElementById('luxApp')
        });
      }
    }

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
