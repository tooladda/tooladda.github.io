/* ==========================================================================
   ToolAdda — US Auto Loan Calculator (UI layer)

   Event wiring, the deal breakdown, the term comparison table and the
   underwater chart. Every number comes from us-auto-loan-engine.js, which
   is tested on its own.

   The term comparison is the part of this page that earns its keep, so it
   highlights the term the user has actually selected rather than leaving
   them to find their own row.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.USAutoLoanEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-us-auto-loan';

  var state = E.defaultState();
  var result = null;
  var dom = {};
  var frame = 0;
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

  function setNum(id, value) {
    var el = dom[id];
    if (el && document.activeElement !== el) el.value = value;
  }

  /* ------------------------------------------------------------ storage */

  function save() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { /* private browsing — the tool still works */ }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) state = E.normalize(JSON.parse(raw));
    } catch (error) { state = E.defaultState(); }
  }

  /* ------------------------------------------------------------ reading */

  function num(id, fallback) {
    var el = dom[id];
    if (!el) return fallback;
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
    return isFinite(v) ? v : fallback;
  }

  function checked(id, fallback) {
    var el = dom[id];
    return el ? !!el.checked : fallback;
  }

  function readControls() {
    state = E.normalize({
      vehiclePrice: num('vehiclePrice', state.vehiclePrice),
      downPayment: num('downPayment', state.downPayment),
      tradeInValue: num('tradeInValue', state.tradeInValue),
      tradeInPayoff: num('tradeInPayoff', state.tradeInPayoff),
      salesTaxPct: num('salesTax', state.salesTaxPct),
      tradeTaxCredit: checked('tradeTaxCredit', state.tradeTaxCredit),
      docFee: num('docFee', state.docFee),
      docFeeTaxable: checked('docFeeTaxable', state.docFeeTaxable),
      titleRegFee: num('titleRegFee', state.titleRegFee),
      aprPct: num('apr', state.aprPct),
      months: state.months,
      extraMonthly: num('extraMonthly', state.extraMonthly),
      firstYearDropPct: num('firstYearDrop', state.firstYearDropPct),
      annualDropPct: num('annualDrop', state.annualDropPct)
    });
  }

  function writeControls() {
    setNum('vehiclePrice', state.vehiclePrice);
    setNum('downPayment', state.downPayment);
    setNum('tradeInValue', state.tradeInValue);
    setNum('tradeInPayoff', state.tradeInPayoff);
    setNum('salesTax', state.salesTaxPct);
    setNum('docFee', state.docFee);
    setNum('titleRegFee', state.titleRegFee);
    setNum('apr', state.aprPct);
    setNum('extraMonthly', state.extraMonthly);
    setNum('firstYearDrop', state.firstYearDropPct);
    setNum('annualDrop', state.annualDropPct);

    if (dom.tradeTaxCredit) dom.tradeTaxCredit.checked = state.tradeTaxCredit;
    if (dom.docFeeTaxable) dom.docFeeTaxable.checked = state.docFeeTaxable;

    var terms = E.TERMS;
    for (var i = 0; i < terms.length; i++) {
      var btn = $('term-' + terms[i]);
      if (btn) btn.setAttribute('aria-pressed', String(terms[i] === state.months));
    }
  }

  /* ------------------------------------------------------------ render */

  function render() {
    result = E.computeAll(state);
    var r = result;
    var d = r.deal;

    setText('paymentValue', r.schedule.ok ? usd(r.schedule.monthlyPayment) : '—');
    setText('termLabel', state.months + ' months at ' + state.aprPct.toFixed(2) + '% APR');

    /* --- the deal --- */
    setText('dealPrice', usd(d.price));
    setText('dealTax', usd(d.salesTax));
    setText('dealFees', usd(d.docFee + d.titleRegFee));
    setText('dealDown', '−' + usd(d.downPayment));
    setText('dealTrade', (d.tradeEquity >= 0 ? '−' : '+') + usd(Math.abs(d.tradeEquity)));
    setText('dealFinanced', usd(d.amountFinanced));

    var tradeEl = dom.dealTrade;
    if (tradeEl) tradeEl.className = d.tradeEquity >= 0 ? 'usc-good' : 'usc-bad';

    /* --- life of loan --- */
    if (r.schedule.ok) {
      setText('totalInterest', usd(r.schedule.totalInterest));
      setText('totalPaid', usd(r.schedule.totalPaid));
      setText('outOfPocket', usd(r.outOfPocket));
      setText('payoffTime', duration(r.schedule.months));
    } else {
      setText('totalInterest', '—');
      setText('totalPaid', '—');
      setText('outOfPocket', '—');
      setText('payoffTime', '—');
    }

    renderTaxNote(r);
    renderEquityNote(r);
    renderExtraNote(r);
    renderTerms(r);
    renderUnderwater(r);
    announce(r);
    if (sticky) sticky.update();
  }

  function renderTaxNote(r) {
    var box = dom.taxNote;
    if (!box) return;

    var d = r.deal;
    if (!(d.tradeInValue > 0)) { box.hidden = true; return; }

    box.hidden = false;

    if (state.tradeTaxCredit) {
      box.className = 'usc-note usc-note--good';
      box.innerHTML = '<strong>Your trade-in saved ' + usd(d.tradeTaxSaving) + ' in sales tax.</strong> ' +
        'Tax is being charged on ' + usd(d.taxableBase) + ' — the price less the trade-in allowance — ' +
        'rather than on the full price. That saving disappears if you sell the old car privately instead.';
    } else {
      box.className = 'usc-note usc-note--warn';
      box.innerHTML = '<strong>No trade-in tax credit in this state.</strong> ' +
        'Sales tax is being charged on the full ' + usd(d.taxableBase) + '. In a credit state the same ' +
        'trade-in would have cut the tax bill by about ' +
        usd(Math.min(d.tradeInValue, d.price) * (state.salesTaxPct / 100)) + '. ' +
        'Since the trade-in earns you nothing back in tax here, compare the dealer offer against a private sale.';
    }
  }

  function renderEquityNote(r) {
    var box = dom.equityNote;
    if (!box) return;

    var d = r.deal;
    if (!d.isUnderwaterTrade && !d.financesMoreThanCar) { box.hidden = true; return; }

    box.hidden = false;
    box.className = 'usc-note usc-note--bad';

    var parts = [];
    if (d.isUnderwaterTrade) {
      parts.push('You owe ' + usd(d.negativeEquity) + ' more on your trade-in than it is worth, and that ' +
        'shortfall is being rolled into the new loan.');
    }
    if (d.financesMoreThanCar) {
      parts.push('You are financing ' + usd(d.amountFinanced) + ' against a ' + usd(d.price) +
        ' car — you start this loan already underwater, before it has depreciated a single mile.');
    }

    box.innerHTML = '<strong>Negative equity warning.</strong> ' + parts.join(' ');
  }

  function renderExtraNote(r) {
    var box = dom.extraNote;
    if (!box) return;

    if (!(state.extraMonthly > 0) || !r.schedule.ok) { box.hidden = true; return; }

    box.hidden = false;
    box.className = 'usc-note usc-note--good';
    box.innerHTML = '<strong>Paying ' + usd(state.extraMonthly) + ' extra each month</strong> clears the ' +
      'loan ' + duration(r.monthsSaved) + ' early and saves ' + usd(r.interestSaved) + ' in interest.';
  }

  function renderTerms(r) {
    var body = dom.termsBody;
    if (!body) return;

    body.innerHTML = '';

    for (var i = 0; i < r.terms.length; i++) {
      var t = r.terms[i];
      var tr = document.createElement('tr');
      if (t.months === state.months) tr.className = 'is-highlight';

      tr.innerHTML =
        '<td>' + t.months + ' months</td>' +
        '<td>' + usdc(t.monthlyPayment) + '</td>' +
        '<td>' + usd(t.totalInterest) + '</td>' +
        '<td>' + usd(t.totalPaid) + '</td>';
      body.appendChild(tr);
    }

    /* Name the trade-off in words rather than leaving it to the columns. */
    var note = dom.termNote;
    if (!note || r.terms.length < 2) return;

    var shortest = r.terms[0];
    var longest = r.terms[r.terms.length - 1];

    note.className = 'usc-note usc-note--warn';
    note.innerHTML = '<strong>The longer term is not cheaper — it is smaller.</strong> ' +
      'Going from ' + shortest.months + ' to ' + longest.months + ' months drops the payment by ' +
      usdc(shortest.monthlyPayment - longest.monthlyPayment) + ' a month, and raises the interest you pay by ' +
      usd(longest.totalInterest - shortest.totalInterest) + ' over the life of the loan.';
  }

  /* Two series that cross — the whole story of the page is where they
     cross — so both are direct-labelled at their ends and the legend names
     them. Colour alone never has to carry it. */
  function renderUnderwaterChart(r) {
    var C = window.USCCharts;
    if (!C || !dom.underwaterChart) return;

    var u = r.underwater;
    if (!u || !u.ok || !u.series.length) {
      C.lineChart(dom.underwaterChart, { series: [] });
      return;
    }

    var pts = C.sample(u.series, 60, function (row) { return row; });

    C.lineChart(dom.underwaterChart, {
      caption: u.everUnderwater
        ? 'Loan balance sits above the car value until month ' + (u.crossoverMonth || r.schedule.months) + '.'
        : 'Loan balance stays below the car value for the whole term.',
      formatY: C.shortMoney,
      formatX: function (m) { return m % 12 === 0 ? 'Yr ' + (m / 12) : 'Mo ' + m; },
      series: [
        {
          name: 'You owe',
          color: C.seriesColor(1),
          points: pts.map(function (p) { return { x: p.month, y: p.balance }; })
        },
        {
          name: 'Car is worth',
          color: C.seriesColor(2),
          points: pts.map(function (p) { return { x: p.month, y: p.value }; })
        }
      ]
    });
  }

  function renderUnderwater(r) {
    renderUnderwaterChart(r);

    var box = dom.underwaterNote;
    if (!box) return;

    var u = r.underwater;
    if (!u || !u.ok) { box.hidden = true; return; }

    box.hidden = false;

    if (!u.everUnderwater) {
      box.className = 'usc-note usc-note--good';
      box.innerHTML = '<strong>You never owe more than the car is worth.</strong> ' +
        'On these depreciation assumptions the loan balance stays below the vehicle value for the whole ' +
        'term, so gap insurance would buy you nothing.';
      return;
    }

    if (u.underwaterToEnd) {
      box.className = 'usc-note usc-note--bad';
      box.innerHTML = '<strong>You are underwater for the entire loan.</strong> ' +
        'At the worst point, around month ' + u.worstMonth + ', you would owe ' + usd(u.worstGap) +
        ' more than the car is worth — and the balance never catches up before the final payment. ' +
        'If the car were written off, that gap is what you would still owe. This is precisely the ' +
        'situation gap insurance exists for.';
      return;
    }

    box.className = 'usc-note usc-note--warn';
    /* With cash down the loan often starts above water and dips under later,
       so say when the window opens as well as when it closes. */
    var from = u.firstUnderwaterMonth > 1 ? 'from month ' + u.firstUnderwaterMonth + ' ' : '';
    box.innerHTML = '<strong>Underwater ' + from + 'until month ' + u.crossoverMonth +
      ' (' + duration(u.crossoverMonth) + ').</strong> ' +
      'The gap peaks around month ' + u.worstMonth + ' at ' + usd(u.worstGap) +
      '. Until the crossover, an insurance write-off would leave you owing money on a car you no ' +
      'longer have — which is the window gap insurance covers.';
  }

  function announce(r) {
    var live = dom.live;
    if (!live) return;
    live.textContent = r.schedule.ok
      ? 'Monthly payment ' + usd(r.schedule.monthlyPayment) +
        ', amount financed ' + usd(r.deal.amountFinanced) +
        ', total interest ' + usd(r.schedule.totalInterest)
      : 'Enter a vehicle price to see a payment.';
  }

  /* ------------------------------------------------------------ export */

  function exportCSV() {
    if (!result || !result.schedule.ok) return;

    var csv = E.scheduleToCSV(result.schedule.rows);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = 'auto-loan-schedule.csv';
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
      readControls();
      render();
      save();
    });
  }

  var INPUT_IDS = [
    'vehiclePrice', 'downPayment', 'tradeInValue', 'tradeInPayoff', 'salesTax',
    'docFee', 'titleRegFee', 'apr', 'extraMonthly', 'firstYearDrop', 'annualDrop'
  ];
  var CHECK_IDS = ['tradeTaxCredit', 'docFeeTaxable'];
  var OUTPUT_IDS = [
    'paymentValue', 'termLabel', 'dealPrice', 'dealTax', 'dealFees', 'dealDown',
    'dealTrade', 'dealFinanced', 'totalInterest', 'totalPaid', 'outOfPocket', 'payoffTime'
  ];

  var PRESETS = [
    { label: 'New car, 60 months', hint: 'The common case',
      state: { vehiclePrice: 32000, downPayment: 4000, aprPct: 7.5, months: 60 } },
    { label: 'Used car, 48 months', hint: 'Shorter term, higher rate',
      state: { vehiclePrice: 18000, downPayment: 2500, aprPct: 9.5, months: 48 } },
    { label: 'Zero down, 84 months', hint: 'Where underwater gets ugly',
      state: { vehiclePrice: 32000, downPayment: 0, aprPct: 8.5, months: 84 } },
    { label: 'Underwater trade-in', hint: 'Owing more than the trade is worth',
      state: { vehiclePrice: 30000, downPayment: 0, tradeInValue: 9000, tradeInPayoff: 12000, aprPct: 8, months: 72 } },
    { label: 'No trade-in tax credit', hint: 'California, Virginia, Maryland…',
      state: { vehiclePrice: 30000, downPayment: 2000, tradeInValue: 10000, tradeTaxCredit: false, aprPct: 7.5, months: 60 } }
  ];

  function applyPreset(patch) {
    var next = E.defaultState();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];

    state = E.normalize(next);
    writeControls();
    render();
    save();
  }

  function initialize() {
    var i;
    for (i = 0; i < INPUT_IDS.length; i++) dom[INPUT_IDS[i]] = $(INPUT_IDS[i]);
    for (i = 0; i < CHECK_IDS.length; i++) dom[CHECK_IDS[i]] = $(CHECK_IDS[i]);
    for (i = 0; i < OUTPUT_IDS.length; i++) dom[OUTPUT_IDS[i]] = $(OUTPUT_IDS[i]);

    dom.taxNote = $('taxNote');
    dom.equityNote = $('equityNote');
    dom.extraNote = $('extraNote');
    dom.termsBody = $('termsBody');
    dom.termNote = $('termNote');
    dom.underwaterNote = $('underwaterNote');
    dom.underwaterChart = $('underwaterChart');
    dom.live = $('liveRegion');

    load();
    writeControls();
    render();

    for (i = 0; i < INPUT_IDS.length; i++) {
      if (dom[INPUT_IDS[i]]) dom[INPUT_IDS[i]].addEventListener('input', schedule);
    }
    for (i = 0; i < CHECK_IDS.length; i++) {
      if (dom[CHECK_IDS[i]]) dom[CHECK_IDS[i]].addEventListener('change', schedule);
    }

    document.addEventListener('click', function (event) {
      var termBtn = event.target.closest ? event.target.closest('[data-term]') : null;
      if (!termBtn) return;

      state.months = parseInt(termBtn.getAttribute('data-term'), 10) || state.months;
      state = E.normalize(state);
      writeControls();
      render();
      save();
    });

    var csvBtn = $('exportCsv');
    if (csvBtn) csvBtn.addEventListener('click', exportCSV);

    var resetBtn = $('resetAll');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state = E.defaultState();
        writeControls();
        render();
        save();
      });
    }

    if (window.USCUI) {
      window.USCUI.presets($('presetRow'), PRESETS, applyPreset);

      sticky = window.USCUI.stickyBar({
        watch: dom.paymentValue,
        label: 'Monthly payment',
        jumpTo: document.getElementById('uscApp')
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  window.USAutoLoanUI = {
    getState: function () { return state; },
    getResult: function () { return result; },
    setState: function (next) { state = E.normalize(next); writeControls(); render(); },
    render: render,
    exportCSV: exportCSV,
    STORAGE_KEY: STORAGE_KEY
  };
})();
