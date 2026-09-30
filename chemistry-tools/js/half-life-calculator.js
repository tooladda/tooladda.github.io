/* Half-Life Calculator & Radioactive Decay Simulator — UI layer.
 *
 * All maths lives in assets/js/half-life-engine.js. This file only reads
 * inputs, asks the engine, and paints the result: result cards, an SVG decay
 * curve, the half-life ladder, a timeline slider, the simulation loop, the
 * decay table and the export actions.
 *
 * The graph is hand-drawn SVG rather than a charting library — the curve is a
 * single monotone path, so a dependency would cost far more than it saves.
 *
 * Nothing is ever written with innerHTML from user input; values go in through
 * textContent or through numbers the engine produced.
 */
(function () {
  'use strict';

  var E = window.HalfLifeEngine;
  if (!E) return;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    mode: document.querySelectorAll('[data-hld-mode]'),
    initial: $('hldInitial'),
    initialUnit: $('hldInitialUnit'),
    customUnit: $('hldCustomUnit'),
    halfLife: $('hldHalfLife'),
    halfLifeUnit: $('hldHalfLifeUnit'),
    elapsed: $('hldElapsed'),
    elapsedUnit: $('hldElapsedUnit'),
    target: $('hldTarget'),

    fieldInitial: $('hldFieldInitial'),
    fieldHalfLife: $('hldFieldHalfLife'),
    fieldElapsed: $('hldFieldElapsed'),
    fieldTarget: $('hldFieldTarget'),

    err: $('hldError'),
    notation: $('hldNotation'),

    headLabel: $('hldHeadLabel'),
    headValue: $('hldHeadValue'),
    statPctRemaining: $('hldPctRemaining'),
    statPctDecayed: $('hldPctDecayed'),
    statHalfLives: $('hldHalfLivesPassed'),
    statDecayed: $('hldDecayedQty'),
    statLambda: $('hldLambda'),
    statMeanLife: $('hldMeanLife'),

    svg: $('hldGraph'),
    tip: $('hldTip'),
    gmodes: document.querySelectorAll('[data-hld-gmode]'),
    graphDesc: $('hldGraphDesc'),

    slider: $('hldSlider'),
    sliderVal: $('hldSliderVal'),
    play: $('hldPlay'),
    restart: $('hldRestart'),
    speed: $('hldSpeed'),

    ladder: $('hldLadder'),
    steps: $('hldSteps'),
    tableBody: $('hldTableBody'),
    showMore: $('hldShowMore'),

    copy: $('hldCopy'),
    csv: $('hldCsv'),
    png: $('hldPng'),
    print: $('hldPrint'),
    formula: $('hldFormula'),
    reset: $('hldReset'),
    toast: $('hldToast')
  };

  if (!el.initial || !el.svg) return;

  /* --------------------------------------------------------------- state */

  var state = {
    mode: 'remaining',      // remaining | time | halflife | initial
    graphMode: 'quantity',  // quantity | percent | decayed
    notation: 'auto',
    tableRows: 14,
    result: null,           // last good solve()
    ctx: null,              // { initial, halfLifeUnitValue, unit, elapsedInUnit, unitLabel }
    playing: false,
    rafId: 0,
    lastFrame: 0
  };

  var MAX_HALF_LIVES = 10;   // slider range

  function fmt(v) { return E.formatNumber(v, { notation: state.notation }); }
  function pct(v) { return E.formatPercent(v, { notation: state.notation === 'decimal' ? 'decimal' : undefined }); }

  function quantityUnit() {
    var u = el.initialUnit ? el.initialUnit.value : 'g';
    if (u === 'custom') {
      var c = el.customUnit && el.customUnit.value.trim();
      return c || 'units';
    }
    return u;
  }

  function timeUnitLabel(unit) { return E.UNIT_LABEL[unit] || unit; }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function showError(msg) {
    if (!el.err) return;
    el.err.textContent = msg || '';
    el.err.hidden = !msg;
  }

  function markInvalid(field, bad) {
    if (!field) return;
    var input = field.querySelector('input');
    if (input) input.setAttribute('aria-invalid', bad ? 'true' : 'false');
  }

  /* ---------------------------------------------------------------- read */

  /* Everything is normalised into the half-life's own unit, so the decay
     constant and the table come out in a unit the user chose rather than in
     seconds. */
  function read() {
    var initial = E.parseNumber(el.initial.value);
    var halfLife = E.parseNumber(el.halfLife.value);
    var elapsed = E.parseNumber(el.elapsed.value);
    var target = el.target ? E.parseNumber(el.target.value) : NaN;

    var hlUnit = el.halfLifeUnit.value;
    var elUnit = el.elapsedUnit.value;

    return {
      initial: initial,
      halfLife: halfLife,
      halfLifeUnit: hlUnit,
      elapsedRaw: elapsed,
      elapsedUnit: elUnit,
      // elapsed expressed in the half-life's unit
      elapsed: isNaN(elapsed) ? NaN : E.convertTime(elapsed, elUnit, hlUnit),
      target: target
    };
  }

  /* -------------------------------------------------------------- solve */

  function recalc(opts) {
    var o = opts || {};
    var v = read();
    var err = null;

    markInvalid(el.fieldInitial, false);
    markInvalid(el.fieldHalfLife, false);
    markInvalid(el.fieldElapsed, false);
    markInvalid(el.fieldTarget, false);

    try {
      if (state.mode === 'remaining') {
        err = E.validateInitial(v.initial) || E.validateHalfLife(v.halfLife) || E.validateElapsed(v.elapsedRaw);
        if (err) {
          markInvalid(el.fieldInitial, !!E.validateInitial(v.initial));
          markInvalid(el.fieldHalfLife, !!E.validateHalfLife(v.halfLife));
          markInvalid(el.fieldElapsed, !!E.validateElapsed(v.elapsedRaw));
          throw new Error(err);
        }
      } else if (state.mode === 'time') {
        err = E.validateInitial(v.initial) || E.validateHalfLife(v.halfLife) || E.validateRemaining(v.target, v.initial);
        if (err) {
          markInvalid(el.fieldInitial, !!E.validateInitial(v.initial));
          markInvalid(el.fieldHalfLife, !!E.validateHalfLife(v.halfLife));
          markInvalid(el.fieldTarget, !!E.validateRemaining(v.target, v.initial));
          throw new Error(err);
        }
        var t = E.timeToReach(v.initial, v.target, v.halfLife);
        el.elapsed.value = trimNum(E.convertTime(t, v.halfLifeUnit, v.elapsedUnit));
        v = read();
      } else if (state.mode === 'halflife') {
        err = E.validateInitial(v.initial) || E.validateElapsed(v.elapsedRaw) || E.validateRemaining(v.target, v.initial);
        if (!err && !(v.elapsedRaw > 0)) err = 'Elapsed time must be greater than zero to find a half-life.';
        if (!err && v.target === v.initial) err = 'Remaining quantity must differ from the initial quantity.';
        if (err) {
          markInvalid(el.fieldInitial, !!E.validateInitial(v.initial));
          markInvalid(el.fieldElapsed, !(v.elapsedRaw > 0));
          markInvalid(el.fieldTarget, !!E.validateRemaining(v.target, v.initial));
          throw new Error(err);
        }
        var elapsedInHl = E.convertTime(v.elapsedRaw, v.elapsedUnit, v.halfLifeUnit);
        var T = E.halfLifeFrom(v.initial, v.target, elapsedInHl);
        el.halfLife.value = trimNum(T);
        v = read();
      } else if (state.mode === 'initial') {
        err = E.validateHalfLife(v.halfLife) || E.validateElapsed(v.elapsedRaw) || E.validateRemaining(v.target, null);
        if (err) {
          markInvalid(el.fieldHalfLife, !!E.validateHalfLife(v.halfLife));
          markInvalid(el.fieldElapsed, !!E.validateElapsed(v.elapsedRaw));
          markInvalid(el.fieldTarget, !!E.validateRemaining(v.target, null));
          throw new Error(err);
        }
        var N0 = E.initialFrom(v.target, v.elapsed, v.halfLife);
        el.initial.value = trimNum(N0);
        v = read();
      }

      var res = E.solve({ initial: v.initial, elapsed: v.elapsed, halfLife: v.halfLife });
      state.result = res;
      state.ctx = {
        unit: v.halfLifeUnit,
        elapsedUnit: v.elapsedUnit,
        elapsedRaw: v.elapsedRaw,
        qtyUnit: quantityUnit()
      };
      showError('');
      render(o);
    } catch (e) {
      // Only ever surface our own prose, never a raw JS message.
      var msg = e && e.message ? String(e.message) : 'Please check your inputs.';
      if (!/[a-z] [a-z]/i.test(msg)) msg = 'Please check your inputs.';
      showError(msg);
      state.result = null;
      clearResults();
    }
  }

  function trimNum(n) {
    if (!isFinite(n)) return '';
    // keep enough digits to round-trip, without exponent soup in the input box
    var abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return n.toExponential(6);
    return String(Number(n.toPrecision(12)));
  }

  function clearResults() {
    if (el.headValue) el.headValue.textContent = '—';
    [el.statPctRemaining, el.statPctDecayed, el.statHalfLives, el.statDecayed, el.statLambda, el.statMeanLife]
      .forEach(function (n) { if (n) n.textContent = '—'; });
    if (el.tableBody) el.tableBody.textContent = '';
    if (el.steps) el.steps.textContent = '';
    if (el.ladder) el.ladder.textContent = '';
    drawGraph(null);
  }

  /* -------------------------------------------------------------- render */

  function render(opts) {
    var r = state.result;
    if (!r) return;
    var o = opts || {};
    var q = state.ctx.qtyUnit;
    var u = timeUnitLabel(state.ctx.unit);

    if (el.headLabel) el.headLabel.textContent = 'Remaining quantity';
    if (el.headValue) el.headValue.textContent = fmt(r.remaining) + ' ' + q;

    if (el.statPctRemaining) el.statPctRemaining.textContent = pct(r.percentRemaining);
    if (el.statPctDecayed) el.statPctDecayed.textContent = pct(r.percentDecayed);
    if (el.statHalfLives) el.statHalfLives.textContent = E.formatNumber(r.halfLives, { significantDigits: 4 });
    if (el.statDecayed) el.statDecayed.textContent = fmt(r.decayed) + ' ' + q;
    if (el.statLambda) el.statLambda.textContent = fmt(r.decayConstant) + ' ' + u + '⁻¹';
    if (el.statMeanLife) el.statMeanLife.textContent = fmt(r.meanLifetime) + ' ' + u;

    if (!o.skipSlider) syncSlider(r.halfLives);
    drawGraph(r);
    drawLadder(r);
    drawSteps(r);
    drawTable(r);
  }

  /* ---------------------------------------------------------------- graph */

  var PAD = { l: 56, r: 14, t: 14, b: 38 };
  var VB = { w: 720, h: 380 };

  function graphSeries(r) {
    var span = E.suggestedSpan(r.halfLives);
    var pts = E.curve(r.initial, r.halfLife, span, 180);
    var yOf, yMax, yLabel;
    if (state.graphMode === 'percent') {
      yOf = function (p) { return p.percentRemaining; };
      yMax = 100; yLabel = '% remaining';
    } else if (state.graphMode === 'decayed') {
      yOf = function (p) { return p.percentDecayed; };
      yMax = 100; yLabel = '% decayed';
    } else {
      yOf = function (p) { return p.value; };
      yMax = r.initial; yLabel = 'Quantity (' + state.ctx.qtyUnit + ')';
    }
    return { pts: pts, span: span, yOf: yOf, yMax: yMax || 1, yLabel: yLabel };
  }

  function svgEl(name, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  function drawGraph(r) {
    var svg = el.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!r) return;

    var s = graphSeries(r);
    var W = VB.w, H = VB.h;
    var pw = W - PAD.l - PAD.r;
    var ph = H - PAD.t - PAD.b;

    var X = function (n) { return PAD.l + (n / s.span) * pw; };
    var Y = function (val) { return PAD.t + ph - (val / s.yMax) * ph; };

    // horizontal grid + y ticks
    for (var i = 0; i <= 4; i++) {
      var frac = i / 4;
      var yv = s.yMax * frac;
      var y = Y(yv);
      svg.appendChild(svgEl('line', { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, class: 'hld-grid-line' }));
      var lab = svgEl('text', { x: PAD.l - 8, y: y + 3.5, class: 'hld-tick', 'text-anchor': 'end' });
      lab.textContent = state.graphMode === 'quantity'
        ? E.formatNumber(yv, { significantDigits: 3 })
        : Math.round(yv) + '%';
      svg.appendChild(lab);
    }

    // vertical grid at whole half-lives
    var maxTick = Math.floor(s.span);
    var stepTick = maxTick > 12 ? Math.ceil(maxTick / 10) : 1;
    for (var n = 0; n <= maxTick; n += stepTick) {
      var x = X(n);
      svg.appendChild(svgEl('line', { x1: x, y1: PAD.t, x2: x, y2: PAD.t + ph, class: 'hld-grid-line' }));
      var t = svgEl('text', { x: x, y: H - PAD.b + 15, class: 'hld-tick', 'text-anchor': 'middle' });
      t.textContent = String(n);
      svg.appendChild(t);
    }

    // axes
    svg.appendChild(svgEl('line', { x1: PAD.l, y1: PAD.t + ph, x2: W - PAD.r, y2: PAD.t + ph, class: 'hld-axis' }));
    svg.appendChild(svgEl('line', { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: PAD.t + ph, class: 'hld-axis' }));

    var xl = svgEl('text', { x: PAD.l + pw / 2, y: H - 4, class: 'hld-axis-label', 'text-anchor': 'middle' });
    xl.textContent = 'Half-lives elapsed  (1 = ' + E.formatNumber(r.halfLife, { significantDigits: 4 }) + ' ' + timeUnitLabel(state.ctx.unit) + ')';
    svg.appendChild(xl);

    var yl = svgEl('text', { x: 12, y: PAD.t + ph / 2, class: 'hld-axis-label', 'text-anchor': 'middle',
      transform: 'rotate(-90 12 ' + (PAD.t + ph / 2) + ')' });
    yl.textContent = s.yLabel;
    svg.appendChild(yl);

    // curve + filled area
    var d = '', area = '';
    s.pts.forEach(function (p, i) {
      var x = X(p.halfLives), y = Y(s.yOf(p));
      d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
    });
    area = d + 'L' + X(s.span).toFixed(2) + ' ' + Y(0).toFixed(2) + ' L' + X(0).toFixed(2) + ' ' + Y(0).toFixed(2) + ' Z';
    svg.appendChild(svgEl('path', { d: area, class: 'hld-area' }));
    svg.appendChild(svgEl('path', { d: d.trim(), class: 'hld-line' }));

    // the user's marker
    if (r.halfLives <= s.span) {
      var mx = X(r.halfLives);
      var mv = state.graphMode === 'percent' ? r.percentRemaining
        : state.graphMode === 'decayed' ? r.percentDecayed : r.remaining;
      var my = Y(mv);
      svg.appendChild(svgEl('line', { x1: mx, y1: PAD.t, x2: mx, y2: PAD.t + ph, class: 'hld-marker-line' }));
      svg.appendChild(svgEl('circle', { cx: mx, cy: my, r: 5.5, class: 'hld-marker-dot' }));
    }

    svg.appendChild(svgEl('rect', {
      x: PAD.l, y: PAD.t, width: pw, height: ph, fill: 'transparent',
      'data-hld-hit': '1'
    }));

    // the accessible alternative to the picture
    if (el.graphDesc) {
      el.graphDesc.textContent =
        'Exponential decay curve. Starting from ' + fmt(r.initial) + ' ' + state.ctx.qtyUnit +
        ', after ' + E.formatNumber(r.halfLives, { significantDigits: 4 }) + ' half-lives (' +
        E.formatNumber(state.ctx.elapsedRaw, { significantDigits: 4 }) + ' ' + timeUnitLabel(state.ctx.elapsedUnit) +
        ') the calculated remaining quantity is ' + fmt(r.remaining) + ' ' + state.ctx.qtyUnit +
        ', which is ' + pct(r.percentRemaining) + ' of the original. The full figures are in the decay table below.';
    }
  }

  /* hover / tap readout */
  function graphPointerAt(clientX) {
    var r = state.result;
    if (!r) return null;
    var box = el.svg.getBoundingClientRect();
    if (!box.width) return null;
    var s = graphSeries(r);
    var pw = VB.w - PAD.l - PAD.r;
    var vx = ((clientX - box.left) / box.width) * VB.w;
    var n = ((vx - PAD.l) / pw) * s.span;
    if (n < 0) n = 0;
    if (n > s.span) n = s.span;
    var frac = E.remainingFraction(n);
    return {
      halfLives: n,
      value: r.initial * frac,
      percentRemaining: frac * 100,
      percentDecayed: (1 - frac) * 100,
      time: n * r.halfLife,
      span: s.span,
      yMax: s.yMax,
      yVal: state.graphMode === 'percent' ? frac * 100 : state.graphMode === 'decayed' ? (1 - frac) * 100 : r.initial * frac
    };
  }

  function showTip(p, clientX) {
    if (!p || !el.tip) return;
    var box = el.svg.getBoundingClientRect();
    var wrap = el.svg.parentElement.getBoundingClientRect();
    var pw = VB.w - PAD.l - PAD.r;
    var ph = VB.h - PAD.t - PAD.b;
    var px = ((PAD.l + (p.halfLives / p.span) * pw) / VB.w) * box.width + (box.left - wrap.left);
    var py = ((PAD.t + ph - (p.yVal / p.yMax) * ph) / VB.h) * box.height + (box.top - wrap.top);

    el.tip.hidden = false;
    el.tip.style.left = px + 'px';
    el.tip.style.top = py + 'px';
    el.tip.textContent = '';

    var b = document.createElement('b');
    b.textContent = E.formatNumber(p.time, { significantDigits: 4 }) + ' ' + timeUnitLabel(state.ctx.unit);
    el.tip.appendChild(b);

    var dl = document.createElement('dl');
    [['Half-lives', E.formatNumber(p.halfLives, { significantDigits: 3 })],
     ['Remaining', fmt(p.value) + ' ' + state.ctx.qtyUnit],
     ['% remaining', pct(p.percentRemaining)],
     ['% decayed', pct(p.percentDecayed)]].forEach(function (row) {
      var dt = document.createElement('dt'); dt.textContent = row[0];
      var dd = document.createElement('dd'); dd.textContent = row[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    el.tip.appendChild(dl);

    var old = el.svg.querySelector('.hld-hover-dot');
    if (old) old.parentNode.removeChild(old);
    el.svg.appendChild(svgEl('circle', {
      cx: PAD.l + (p.halfLives / p.span) * pw,
      cy: PAD.t + ph - (p.yVal / p.yMax) * ph,
      r: 4.5, class: 'hld-hover-dot'
    }));
  }

  function hideTip() {
    if (el.tip) el.tip.hidden = true;
    var old = el.svg.querySelector('.hld-hover-dot');
    if (old) old.parentNode.removeChild(old);
  }

  el.svg.addEventListener('pointermove', function (ev) {
    var p = graphPointerAt(ev.clientX);
    if (p) showTip(p, ev.clientX);
  });
  el.svg.addEventListener('pointerleave', hideTip);
  el.svg.addEventListener('pointerdown', function (ev) {
    var p = graphPointerAt(ev.clientX);
    if (p) showTip(p, ev.clientX);
  });

  /* --------------------------------------------------------------- ladder */

  function drawLadder(r) {
    if (!el.ladder) return;
    el.ladder.textContent = '';
    var rows = [0, 1, 2, 3, 4, 5];
    var current = Math.round(r.halfLives);
    rows.forEach(function (n) {
      var frac = E.remainingFraction(n);
      var row = document.createElement('div');
      row.className = 'hld-rung' + (n === current && Math.abs(r.halfLives - n) < 0.5 ? ' is-current' : '');

      var lab = document.createElement('span');
      lab.className = 'hld-rung-label';
      lab.textContent = n === 0 ? 'Start' : n + ' half-life' + (n > 1 ? 's' : '');

      var bar = document.createElement('div');
      bar.className = 'hld-bar';
      var fill = document.createElement('i');
      fill.style.width = (frac * 100) + '%';
      bar.appendChild(fill);

      var val = document.createElement('span');
      val.className = 'hld-rung-val';
      val.textContent = E.formatPercent(frac * 100);

      row.appendChild(lab); row.appendChild(bar); row.appendChild(val);
      el.ladder.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------- steps */

  function drawSteps(r) {
    if (!el.steps) return;
    el.steps.textContent = '';
    var u = timeUnitLabel(state.ctx.unit);
    var eu = timeUnitLabel(state.ctx.elapsedUnit);
    var q = state.ctx.qtyUnit;
    var n4 = E.formatNumber(r.halfLives, { significantDigits: 4 });

    var lines = [];
    if (state.ctx.elapsedUnit !== state.ctx.unit) {
      lines.push(['Convert the time units',
        E.formatNumber(state.ctx.elapsedRaw, { significantDigits: 4 }) + ' ' + eu + ' = ' +
        E.formatNumber(r.elapsed, { significantDigits: 4 }) + ' ' + u + ', so the elapsed time and the half-life are in the same unit.']);
    } else {
      lines.push(['Check the units', 'The elapsed time and the half-life are both in ' + u + ', so no conversion is needed.']);
    }
    lines.push(['Count the half-lives',
      'n = t ÷ T½ = ' + E.formatNumber(r.elapsed, { significantDigits: 4 }) + ' ÷ ' +
      E.formatNumber(r.halfLife, { significantDigits: 4 }) + ' = ' + n4]);
    lines.push(['Apply the decay equation',
      'N = N₀ × (1/2)ⁿ = ' + fmt(r.initial) + ' × (1/2)^' + n4 + ' = ' + fmt(r.remaining) + ' ' + q]);
    lines.push(['Work out the percentage',
      'Remaining % = 100 × (1/2)ⁿ = ' + pct(r.percentRemaining) + ', so ' + pct(r.percentDecayed) + ' has decayed.']);
    lines.push(['Find the decayed amount',
      'Decayed = N₀ − N = ' + fmt(r.initial) + ' − ' + fmt(r.remaining) + ' = ' + fmt(r.decayed) + ' ' + q]);

    lines.forEach(function (pair) {
      var li = document.createElement('li');
      var b = document.createElement('b');
      b.textContent = pair[0] + ' — ';
      li.appendChild(b);
      li.appendChild(document.createTextNode(pair[1]));
      el.steps.appendChild(li);
    });
  }

  /* ---------------------------------------------------------------- table */

  function tableSteps(count) {
    var base = E.DEFAULT_STEPS.slice(0, count);
    while (base.length < count) base.push(base[base.length - 1] + 1);
    return base;
  }

  function drawTable(r) {
    if (!el.tableBody) return;
    el.tableBody.textContent = '';
    var rows = E.decayTable(r.initial, r.halfLife, tableSteps(state.tableRows));
    var u = timeUnitLabel(state.ctx.unit);
    var q = state.ctx.qtyUnit;

    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      if (Math.abs(row.halfLives - r.halfLives) < 1e-9) tr.className = 'is-current';
      [
        E.formatNumber(row.time, { significantDigits: 4 }) + ' ' + u,
        E.formatNumber(row.halfLives, { significantDigits: 3 }),
        E.formatNumber(row.remaining, { notation: state.notation }) + ' ' + q,
        E.formatPercent(row.percentRemaining),
        E.formatPercent(row.percentDecayed)
      ].forEach(function (text, i) {
        var cell = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) cell.setAttribute('scope', 'row');
        cell.textContent = text;
        tr.appendChild(cell);
      });
      el.tableBody.appendChild(tr);
    });
  }

  /* ------------------------------------------------------------- slider */

  function syncSlider(halfLives) {
    if (!el.slider) return;
    var v = Math.min(MAX_HALF_LIVES, Math.max(0, halfLives));
    el.slider.value = String(v);
    updateSliderLabel(v);
  }

  function updateSliderLabel(v) {
    if (!el.sliderVal) return;
    var frac = E.remainingFraction(v);
    el.sliderVal.textContent = Number(v).toFixed(2) + ' × T½ · ' + E.formatPercent(frac * 100);
  }

  if (el.slider) {
    el.slider.addEventListener('input', function () {
      var n = Number(el.slider.value);
      updateSliderLabel(n);
      // drive the elapsed-time box from the slider, then recalculate
      var v = read();
      if (!(v.halfLife > 0)) return;
      var tInHl = n * v.halfLife;
      el.elapsed.value = trimNum(E.convertTime(tInHl, v.halfLifeUnit, v.elapsedUnit));
      recalc({ skipSlider: true });
    });
  }

  /* --------------------------------------------------------- simulation */

  function setPlaying(on) {
    state.playing = on;
    if (el.play) {
      el.play.textContent = on ? '⏸ Pause' : '▶ Start simulation';
      el.play.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (on) {
      state.lastFrame = 0;
      state.rafId = requestAnimationFrame(tick);
    } else if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  /* Advances the timeline at `speed` half-lives per second of wall clock.
     This is a teaching animation over the maths, not a claim that decay can be
     watched happening — the page says so next to the controls. */
  function tick(ts) {
    if (!state.playing) return;
    if (!state.lastFrame) state.lastFrame = ts;
    var dt = (ts - state.lastFrame) / 1000;
    state.lastFrame = ts;

    var speed = el.speed ? Number(el.speed.value) || 1 : 1;
    var next = Number(el.slider.value) + dt * speed * 0.5;
    if (next >= MAX_HALF_LIVES) {
      next = MAX_HALF_LIVES;
      el.slider.value = String(next);
      el.slider.dispatchEvent(new Event('input'));
      setPlaying(false);
      return;
    }
    el.slider.value = String(next);
    el.slider.dispatchEvent(new Event('input'));
    state.rafId = requestAnimationFrame(tick);
  }

  if (el.play) el.play.addEventListener('click', function () { setPlaying(!state.playing); });
  if (el.restart) el.restart.addEventListener('click', function () {
    setPlaying(false);
    el.slider.value = '0';
    el.slider.dispatchEvent(new Event('input'));
  });

  /* ---------------------------------------------------------------- modes */

  Array.prototype.forEach.call(el.mode, function (btn) {
    btn.addEventListener('click', function () {
      state.mode = btn.getAttribute('data-hld-mode');
      Array.prototype.forEach.call(el.mode, function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      applyModeFields();
      recalc();
    });
  });

  /* Which boxes are inputs and which are outputs depends on what we solve for. */
  function applyModeFields() {
    var m = state.mode;
    show(el.fieldTarget, m !== 'remaining');
    setReadOnly(el.elapsed, m === 'time');
    setReadOnly(el.halfLife, m === 'halflife');
    setReadOnly(el.initial, m === 'initial');
  }

  function show(node, on) { if (node) node.hidden = !on; }
  function setReadOnly(input, on) {
    if (!input) return;
    input.readOnly = !!on;
    input.setAttribute('aria-readonly', on ? 'true' : 'false');
  }

  Array.prototype.forEach.call(el.gmodes, function (btn) {
    btn.addEventListener('click', function () {
      state.graphMode = btn.getAttribute('data-hld-gmode');
      Array.prototype.forEach.call(el.gmodes, function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      if (state.result) drawGraph(state.result);
    });
  });

  if (el.notation) {
    el.notation.addEventListener('change', function () {
      state.notation = el.notation.value;
      if (state.result) render({ skipSlider: true });
    });
  }

  if (el.showMore) {
    el.showMore.addEventListener('click', function () {
      state.tableRows += 6;
      if (state.result) drawTable(state.result);
      el.showMore.textContent = 'Show ' + 6 + ' more rows';
    });
  }

  /* -------------------------------------------------------------- presets */

  document.querySelectorAll('[data-hld-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = btn.getAttribute('data-hld-preset').split('|');
      // initial | qtyUnit | halfLife | hlUnit | elapsed | elapsedUnit
      el.initial.value = p[0];
      if (el.initialUnit) el.initialUnit.value = p[1];
      el.halfLife.value = p[2];
      el.halfLifeUnit.value = p[3];
      el.elapsed.value = p[4];
      el.elapsedUnit.value = p[5];
      if (el.customUnit) el.customUnit.hidden = p[1] !== 'custom';
      setPlaying(false);
      setMode('remaining');
      recalc();
      var card = document.getElementById('hldResults');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  function setMode(m) {
    state.mode = m;
    Array.prototype.forEach.call(el.mode, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-hld-mode') === m ? 'true' : 'false');
    });
    applyModeFields();
  }

  /* --------------------------------------------------------------- export */

  function resultText() {
    var r = state.result;
    if (!r) return '';
    var q = state.ctx.qtyUnit;
    var u = timeUnitLabel(state.ctx.unit);
    return [
      'Initial quantity: ' + fmt(r.initial) + ' ' + q,
      'Half-life: ' + fmt(r.halfLife) + ' ' + u,
      'Elapsed time: ' + E.formatNumber(state.ctx.elapsedRaw, { notation: state.notation }) + ' ' + timeUnitLabel(state.ctx.elapsedUnit),
      'Half-lives elapsed: ' + E.formatNumber(r.halfLives, { significantDigits: 4 }),
      'Remaining quantity: ' + fmt(r.remaining) + ' ' + q,
      'Remaining percentage: ' + pct(r.percentRemaining),
      'Decayed quantity: ' + fmt(r.decayed) + ' ' + q,
      'Decayed percentage: ' + pct(r.percentDecayed),
      'Decay constant: ' + fmt(r.decayConstant) + ' ' + u + '⁻¹',
      '',
      'Calculated with ToolAdda Half-Life Calculator (educational use).'
    ].join('\n');
  }

  function copyText(text, label) {
    if (!text) { toast('Calculate something first.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(label); },
        function () { fallbackCopy(text, label); });
    } else fallbackCopy(text, label);
  }

  function fallbackCopy(text, label) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(label); }
    catch (e) { toast('Copy failed — select the text manually.'); }
    document.body.removeChild(ta);
  }

  if (el.copy) el.copy.addEventListener('click', function () { copyText(resultText(), 'Result copied.'); });

  if (el.formula) el.formula.addEventListener('click', function () {
    var r = state.result;
    if (!r) { toast('Calculate something first.'); return; }
    copyText('N(t) = N0 * (1/2)^(t / T)   with N0 = ' + r.initial + ', T = ' + r.halfLife +
      ', t = ' + r.elapsed + '\nlambda = ln(2) / T = ' + r.decayConstant, 'Formula copied.');
  });

  /* CSV: quote every field and prefix anything that could be read as a formula,
     so a cell can never execute when the file is opened in a spreadsheet. */
  function csvCell(v) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  if (el.csv) el.csv.addEventListener('click', function () {
    var r = state.result;
    if (!r) { toast('Calculate something first.'); return; }
    var u = timeUnitLabel(state.ctx.unit);
    var q = state.ctx.qtyUnit;
    var rows = E.decayTable(r.initial, r.halfLife, tableSteps(state.tableRows));
    var out = [['Time (' + u + ')', 'Half-lives', 'Remaining (' + q + ')', 'Percent remaining', 'Percent decayed']
      .map(csvCell).join(',')];
    rows.forEach(function (row) {
      out.push([row.time, row.halfLives, row.remaining, row.percentRemaining, row.percentDecayed]
        .map(csvCell).join(','));
    });
    download(new Blob([out.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'half-life-decay-table.csv');
    toast('CSV downloaded.');
  });

  /* PNG: rasterise the SVG through a canvas. Fonts and CSS variables are
     resolved into the clone first, because an SVG loaded as an image cannot
     see the page's stylesheet. */
  if (el.png) el.png.addEventListener('click', function () {
    if (!state.result) { toast('Calculate something first.'); return; }
    try {
      var clone = el.svg.cloneNode(true);
      var cs = getComputedStyle(document.querySelector('.hld-page') || document.body);
      var map = {
        'hld-grid-line': ['stroke', cs.getPropertyValue('--hld-grid') || '#ddd'],
        'hld-axis': ['stroke', cs.getPropertyValue('--hld-border-strong') || '#999'],
        'hld-tick': ['fill', cs.getPropertyValue('--hld-text-3') || '#777'],
        'hld-axis-label': ['fill', cs.getPropertyValue('--hld-text-2') || '#555'],
        'hld-line': ['stroke', cs.getPropertyValue('--hld-curve') || '#831843'],
        'hld-marker-line': ['stroke', cs.getPropertyValue('--hld-accent') || '#831843'],
        'hld-marker-dot': ['fill', cs.getPropertyValue('--hld-accent') || '#831843']
      };
      clone.querySelectorAll('*').forEach(function (node) {
        var c = node.getAttribute('class');
        if (!c) return;
        if (c === 'hld-area') { node.setAttribute('fill', (cs.getPropertyValue('--hld-accent') || '#831843').trim()); node.setAttribute('opacity', '0.12'); return; }
        if (c === 'hld-line') node.setAttribute('fill', 'none');
        var rule = map[c];
        if (rule) node.setAttribute(rule[0], rule[1].trim());
        if (c === 'hld-tick' || c === 'hld-axis-label') node.setAttribute('font-family', 'sans-serif');
      });
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', VB.w);
      clone.setAttribute('height', VB.h);

      var svgText = new XMLSerializer().serializeToString(clone);
      var img = new Image();
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
      img.onload = function () {
        var scale = 2;
        var canvas = document.createElement('canvas');
        canvas.width = VB.w * scale;
        canvas.height = VB.h * scale;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = (cs.getPropertyValue('--hld-surface') || '#fff').trim();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) { toast('Could not export the graph.'); return; }
          download(blob, 'radioactive-decay-graph.png');
          toast('Graph downloaded.');
        }, 'image/png');
      };
      img.onerror = function () { toast('Could not export the graph.'); };
      img.src = url;
    } catch (e) {
      toast('Could not export the graph.');
    }
  });

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  if (el.print) el.print.addEventListener('click', function () { window.print(); });

  if (el.reset) el.reset.addEventListener('click', function () {
    setPlaying(false);
    el.initial.value = '1000';
    if (el.initialUnit) el.initialUnit.value = 'g';
    if (el.customUnit) el.customUnit.hidden = true;
    el.halfLife.value = '10';
    el.halfLifeUnit.value = 'years';
    el.elapsed.value = '30';
    el.elapsedUnit.value = 'years';
    if (el.target) el.target.value = '125';
    if (el.notation) { el.notation.value = 'auto'; state.notation = 'auto'; }
    state.tableRows = 14;
    setMode('remaining');
    recalc();
    toast('Reset to the worked example.');
  });

  if (el.initialUnit) {
    el.initialUnit.addEventListener('change', function () {
      if (el.customUnit) el.customUnit.hidden = el.initialUnit.value !== 'custom';
      if (state.result) render({ skipSlider: true });
    });
  }
  if (el.customUnit) {
    el.customUnit.addEventListener('input', function () { if (state.result) render({ skipSlider: true }); });
  }

  /* Live recalculation as the user types — the maths is trivial, so there is
     no reason to make them press a button. The button stays for keyboard and
     screen-reader users who expect an explicit action. */
  [el.initial, el.halfLife, el.elapsed, el.target].forEach(function (input) {
    if (!input) return;
    input.addEventListener('input', function () { setPlaying(false); recalc(); });
  });
  [el.halfLifeUnit, el.elapsedUnit].forEach(function (sel) {
    if (!sel) return;
    sel.addEventListener('change', function () { recalc(); });
  });

  var calcBtn = $('hldCalculate');
  if (calcBtn) calcBtn.addEventListener('click', function () {
    recalc();
    var card = document.getElementById('hldResults');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  window.addEventListener('resize', function () {
    hideTip();
    if (state.result) drawGraph(state.result);
  });

  applyModeFields();
  recalc();
})();
