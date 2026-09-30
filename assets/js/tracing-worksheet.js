/* ToolAdda — Handwriting Tracing Worksheet, UI layer.

   Layout maths lives in tracing-worksheet-engine.js. This file renders the
   sheet in real millimetres and lets the browser's own print engine produce
   the PDF.

   Three decisions worth knowing about.

   The letters are SVG <text>, not HTML spans. An SVG text node takes its
   baseline as a coordinate, so "sit on the writing line" is one attribute.
   Positioning HTML text on a baseline means undoing CSS half-leading with the
   font's own ascent and descent, which differ per face — an earlier version
   used `line-height: 0` and a `top` offset and left every letter floating
   below the line. SVG also makes a genuinely dotted outline possible via
   stroke-dasharray; in HTML the "dotted" style was indistinguishable from the
   hollow one.

   Each repeat is its own <text> at a computed x, rather than one string of
   repeats, because the start dots have to be placed per repeat and a single
   run gives no way to know where each one begins.

   Widths are measured with a canvas rather than estimated, so a row is filled
   to the margin instead of overflowing it or stopping short. Nothing is
   uploaded — the only external request is the webfont itself. */
(function () {
  'use strict';

  var root = document.querySelector('[data-tracing]');
  if (!root) return;

  var E = window.TracingWorksheetEngine;
  if (!E) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var el = {
    text: $('[data-text]'),
    quick: $$('[data-quick]'),
    splitBy: $('[data-split]'),
    textCase: $('[data-case]'),
    fit: $('[data-fit]'),
    font: $('[data-font]'),
    style: $('[data-style]'),
    mode: $('[data-mode]'),
    trace: $('[data-trace]'),
    ink: $('[data-ink]'),
    startDots: $('[data-start-dots]'),
    showPageNumbers: $('[data-page-numbers]'),
    rowHeight: $('[data-row-height]'), rowHeightVal: $('[data-row-height-val]'),
    linesPerItem: $('[data-lines]'), linesVal: $('[data-lines-val]'),
    pageSize: $('[data-page-size]'),
    orientation: $('[data-orientation]'),
    margin: $('[data-margin]'), marginVal: $('[data-margin-val]'),
    title: $('[data-title]'),
    sheet: $('[data-sheet]'),
    stats: $('[data-stats]'),
    printBtn: $('[data-print]'),
    shareBtn: $('[data-share]'),
    resetBtn: $('[data-reset]')
  };

  var FONTS = {
    'Caveat': 'Caveat:wght@400;600',
    'Patrick Hand': 'Patrick+Hand',
    'Schoolbell': 'Schoolbell',
    'Kalam': 'Kalam:wght@300;400',
    'Comic Neue': 'Comic+Neue:wght@300;400;700'
  };

  var loadedFonts = {};

  /* Google Fonts is the one external host this page touches, and only for the
     handwriting faces. Nothing the visitor types is ever sent anywhere. */
  function ensureFont(name) {
    if (!FONTS[name] || loadedFonts[name]) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + FONTS[name] + '&display=swap';
    document.head.appendChild(link);
    loadedFonts[name] = true;

    /* The first render happens against the fallback face, whose widths differ
       from the real one, so the sheet is redrawn once the webfont lands. */
    if (document.fonts && document.fonts.load) {
      document.fonts.load('16px "' + name + '"').then(scheduleRender, scheduleRender);
    }
  }

  /* @page cannot be set from an inline style, so the paper size the visitor
     chose is written into a stylesheet this file owns. Without it the print
     dialog opens on the browser default and an A5 sheet prints scaled onto A4. */
  var pageStyle = document.createElement('style');
  document.head.appendChild(pageStyle);

  function setPaper(geometry) {
    pageStyle.textContent =
      '@page { size: ' + geometry.width + 'mm ' + geometry.height + 'mm; margin: 0; }';
  }

  /* One canvas, reused, purely for measurement. */
  var measureCtx = (function () {
    try { return document.createElement('canvas').getContext('2d'); }
    catch (e) { return null; }
  })();

  /** Width of a string in mm at the given mm font size, or null where
   *  measurement is unavailable (a headless test environment). */
  function measureMm(text, family, sizeMm) {
    if (!measureCtx || !measureCtx.measureText) return null;
    var px = E.mmToPx(sizeMm, 96);
    measureCtx.font = px + 'px "' + family + '", cursive';
    var result = measureCtx.measureText(text);
    if (!result || !result.width) return null;
    return E.pxToMm(result.width, 96);
  }

  function checked(node, fallback) {
    return node ? node.checked : fallback;
  }

  function settings() {
    return {
      text: el.text ? el.text.value : '',
      splitBy: el.splitBy ? el.splitBy.value : 'words',
      textCase: el.textCase ? el.textCase.value : 'as-typed',
      fit: el.fit ? el.fit.value : 'repeat',
      style: el.style ? el.style.value : 'four-line',
      mode: el.mode ? el.mode.value : 'trace-all',
      trace: el.trace ? el.trace.value : 'faded',
      ink: el.ink ? el.ink.value : 'grey',
      startDots: checked(el.startDots, false),
      showPageNumbers: checked(el.showPageNumbers, true),
      rowHeightMm: el.rowHeight ? Number(el.rowHeight.value) : 14,
      linesPerItem: el.linesPerItem ? Number(el.linesPerItem.value) : 2,
      pageSize: el.pageSize ? el.pageSize.value : 'a4',
      orientation: el.orientation ? el.orientation.value : 'portrait',
      marginMm: el.margin ? Number(el.margin.value) : 15,
      title: el.title ? el.title.value.trim() : '',
      font: el.font ? el.font.value : 'Caveat'
    };
  }

  function mm(value) { return value + 'mm'; }

  function svgEl(name) { return document.createElementNS(SVG_NS, name); }

  function renderRow(row, plan, config) {
    var wrap = document.createElement('div');
    wrap.className = 'tw-row tw-row--' + row.kind;
    wrap.style.height = mm(plan.rowHeight);

    plan.lines.forEach(function (line) {
      var rule = document.createElement('span');
      rule.className = 'tw-rule tw-rule--' + line.key + (line.dashed ? ' is-dashed' : '');
      rule.style.top = mm(line.y);
      wrap.appendChild(rule);
    });

    if (config.style === 'grid') {
      wrap.classList.add('tw-row--grid');
      wrap.style.backgroundSize = mm(plan.rowHeight / 3) + ' ' + mm(plan.rowHeight / 3);
    }

    if (row.kind === 'blank') return wrap;

    /* User units are millimetres, so every number the engine produced is used
       directly and the baseline is simply the y coordinate. */
    var svg = svgEl('svg');
    svg.setAttribute('class', 'tw-svg tw-ink--' + config.ink);
    svg.setAttribute('width', mm(plan.geometry.contentWidth));
    svg.setAttribute('height', mm(plan.rowHeight));
    svg.setAttribute('viewBox', '0 0 ' + plan.geometry.contentWidth + ' ' + plan.rowHeight);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    var kindClass = row.kind === 'model' ? 'model' : config.trace;
    var strokeWidth = plan.fontSize * 0.03;
    var measured = measureMm(row.item, config.font, plan.fontSize);
    var gap = plan.fontSize * 0.55;

    var unit;
    var repeats;
    if (config.fit === 'sentence') {
      /* A wrapped line is written once — repeating it would defeat the point. */
      unit = plan.geometry.contentWidth;
      repeats = 1;
    } else if (measured === null || !isFinite(measured) || measured <= 0) {
      repeats = E.repeatsPerRow(row.item, plan.geometry, plan.rowHeight, config.style, gap);
      unit = plan.geometry.contentWidth / repeats;
    } else {
      repeats = Math.max(1, Math.floor((plan.geometry.contentWidth + gap) / (measured + gap)));
      unit = measured + gap;
    }

    for (var i = 0; i < repeats; i += 1) {
      var x = i * unit;
      var text = svgEl('text');
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(plan.baseline));
      text.setAttribute('font-size', String(plan.fontSize));
      text.setAttribute('font-family', '"' + config.font + '", cursive');
      text.setAttribute('class', 'tw-glyphs tw-glyphs--' + kindClass);
      /* Stroke widths are in user units, i.e. mm, so they scale with the chosen
         line height — otherwise a 30mm row gets a hairline outline. */
      text.setAttribute('stroke-width', String(strokeWidth));
      text.textContent = row.item;
      svg.appendChild(text);

      /* A dot marking where each item begins. It is a starting point, not
         stroke-order guidance — that would need per-glyph path data. */
      if (config.startDots) {
        var dot = svgEl('circle');
        dot.setAttribute('class', 'tw-start-dot');
        dot.setAttribute('cx', String(x + plan.fontSize * 0.05));
        dot.setAttribute('cy', String(plan.baseline - plan.fontSize * 0.30));
        dot.setAttribute('r', String(Math.max(0.25, plan.fontSize * 0.055)));
        svg.appendChild(dot);
      }
    }

    wrap.appendChild(svg);
    return wrap;
  }

  /* The sheet is laid out in real millimetres, so an A4 page is ~794px wide and
     overflowed the preview on phones (and on narrow desktop columns): only half
     a page was visible. Scale the on-screen preview down to fit; print keeps
     zoom 1 (see @media print), so the paper size is unchanged. */
  var lastPageWidthMm = 0;
  function fitPreview() {
    if (!el.sheet || !lastPageWidthMm) return;
    var cs = window.getComputedStyle(el.sheet);
    var avail = el.sheet.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var pagePx = lastPageWidthMm * 96 / 25.4;
    var fit = avail > 0 ? Math.min(1, avail / pagePx) : 1;
    el.sheet.style.setProperty('--tw-fit', fit < 0.999 ? fit.toFixed(4) : '1');
  }
  var fitQueued = false;
  window.addEventListener('resize', function () {
    if (fitQueued) return;
    fitQueued = true;
    window.requestAnimationFrame(function () { fitQueued = false; fitPreview(); });
  });

  function render() {
    if (!el.sheet) return;
    var config = settings();
    ensureFont(config.font);

    /* Sentence mode needs to know how wide a word is; the engine will not
       measure, so the measurement goes in with the options. */
    config.measure = function (word) {
      var size = E.fontSizeForRow(config.rowHeightMm, config.style);
      var width = measureMm(word, config.font, size);
      return width === null ? word.length * size * 0.5 : width;
    };

    var plan = E.plan(config);
    setPaper(plan.geometry);
    el.sheet.innerHTML = '';

    plan.pages.forEach(function (rows, index) {
      var page = document.createElement('div');
      page.className = 'tw-page';
      page.style.width = mm(plan.geometry.width);
      page.style.minHeight = mm(plan.geometry.height);
      page.style.padding = mm(plan.geometry.margin);

      if (config.title) {
        var head = document.createElement('div');
        head.className = 'tw-page-head';
        head.style.height = mm(plan.headerMm);
        head.innerHTML = '<span class="tw-page-title"></span>' +
          '<span class="tw-page-meta">Name: ______________  Date: __________</span>';
        head.querySelector('.tw-page-title').textContent = config.title;
        page.appendChild(head);
      }

      rows.forEach(function (row) { page.appendChild(renderRow(row, plan, config)); });

      if (config.showPageNumbers && plan.pages.length > 1) {
        var foot = document.createElement('div');
        foot.className = 'tw-page-foot';
        foot.textContent = 'Page ' + (index + 1) + ' of ' + plan.pages.length;
        page.appendChild(foot);
      }

      el.sheet.appendChild(page);
    });

    lastPageWidthMm = plan.geometry.width;
    fitPreview();

    if (el.stats) {
      var count = plan.items.length;
      el.stats.textContent = count === 0
        ? 'Type something above to build the sheet.'
        : count + (count === 1 ? ' item' : ' items') + ' · ' + plan.rows.length + ' rows · ' +
          plan.pages.length + (plan.pages.length === 1 ? ' page' : ' pages') + ' · ' +
          plan.geometry.label + ' ' + config.orientation;
    }
  }

  /* Dragging a slider fires input on every pixel; one render per frame keeps a
     26-page sheet from stuttering. */
  var queued = false;
  function scheduleRender() {
    if (queued) return;
    queued = true;
    var run = function () { queued = false; render(); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else window.setTimeout(run, 16);
  }

  // ------------------------------------------------------------ share link

  function shareUrl() {
    var config = settings();
    delete config.measure;
    return window.location.origin + window.location.pathname + '#' + E.encodeSettings(config);
  }

  function applyShared(values) {
    var map = {
      text: el.text, splitBy: el.splitBy, textCase: el.textCase, fit: el.fit,
      style: el.style, mode: el.mode, trace: el.trace, ink: el.ink,
      font: el.font, pageSize: el.pageSize, orientation: el.orientation,
      title: el.title, rowHeightMm: el.rowHeight, linesPerItem: el.linesPerItem,
      marginMm: el.margin
    };
    Object.keys(map).forEach(function (key) {
      if (map[key] && values[key] !== undefined) map[key].value = values[key];
    });
    if (el.startDots && values.startDots !== undefined) el.startDots.checked = values.startDots === '1';
    if (el.showPageNumbers && values.showPageNumbers !== undefined) {
      el.showPageNumbers.checked = values.showPageNumbers === '1';
    }
    syncRangeLabels();
  }

  function syncRangeLabels() {
    if (el.rowHeight && el.rowHeightVal) el.rowHeightVal.textContent = el.rowHeight.value + 'mm';
    if (el.linesPerItem && el.linesVal) el.linesVal.textContent = el.linesPerItem.value;
    if (el.margin && el.marginVal) el.marginVal.textContent = el.margin.value + 'mm';
  }

  // ---------------------------------------------------------------- wiring

  function bindRange(input, label, suffix) {
    if (!input) return;
    input.addEventListener('input', function () {
      if (label) label.textContent = input.value + (suffix || '');
      scheduleRender();
    });
  }

  [el.text, el.splitBy, el.textCase, el.fit, el.font, el.style, el.mode, el.trace,
   el.ink, el.startDots, el.showPageNumbers, el.pageSize, el.orientation, el.title]
    .forEach(function (input) {
      if (!input) return;
      input.addEventListener('input', function () { clearQuickSelection(); scheduleRender(); });
      if (input.tagName === 'SELECT' || input.type === 'checkbox') {
        input.addEventListener('change', function () { clearQuickSelection(); scheduleRender(); });
      }
    });

  bindRange(el.rowHeight, el.rowHeightVal, 'mm');
  bindRange(el.linesPerItem, el.linesVal, '');
  bindRange(el.margin, el.marginVal, 'mm');

  /* A ready sheet is a whole configuration, not just a block of text. "A-Z for
     nursery" implies big rows, a model line to copy from and capitals — asking
     the user to set those separately is what made the panel feel like a form. */
  var QUICK = {
    caps: {
      label: 'A–Z capitals', text: E.PRESETS.uppercase, textCase: 'upper',
      style: 'four-line', rowHeightMm: 20, mode: 'model-then-trace',
      linesPerItem: 2, trace: 'faded', fit: 'repeat', splitBy: 'words'
    },
    small: {
      label: 'a–z small', text: E.PRESETS.lowercase, textCase: 'lower',
      style: 'four-line', rowHeightMm: 16, mode: 'model-then-trace',
      linesPerItem: 2, trace: 'faded', fit: 'repeat', splitBy: 'words'
    },
    numbers: {
      label: 'Numbers', text: E.PRESETS.numbers, textCase: 'as-typed',
      style: 'four-line', rowHeightMm: 20, mode: 'model-then-trace',
      linesPerItem: 2, trace: 'faded', fit: 'repeat', splitBy: 'words'
    },
    name: {
      /* Deliberately left for the user to overwrite — the point of the sheet is
         the child's own name. */
      label: 'Name practice', text: 'Aarav', textCase: 'capitalise',
      style: 'four-line', rowHeightMm: 22, mode: 'model-then-trace',
      linesPerItem: 5, trace: 'dotted', fit: 'repeat', splitBy: 'words'
    },
    words: {
      label: 'Sight words', text: E.PRESETS['sight-words'], textCase: 'lower',
      style: 'four-line', rowHeightMm: 14, mode: 'trace-then-blank',
      linesPerItem: 1, trace: 'faded', fit: 'repeat', splitBy: 'words'
    },
    sentence: {
      label: 'Sentence copy', text: 'The quick brown fox jumps over the lazy dog.',
      textCase: 'as-typed', style: 'four-line', rowHeightMm: 12,
      mode: 'trace-then-blank', linesPerItem: 1, trace: 'faded',
      fit: 'sentence', splitBy: 'words'
    },
    hindi: {
      /* Devanagari hangs from a headline; four-line is Latin paper. */
      label: 'हिंदी स्वर', text: E.PRESETS['hindi-vowels'], textCase: 'as-typed',
      style: 'devanagari', rowHeightMm: 20, mode: 'model-then-trace',
      linesPerItem: 2, trace: 'faded', fit: 'repeat', splitBy: 'words'
    }
  };

  function applyQuick(key) {
    var sheet = QUICK[key];
    if (!sheet) return;
    var map = {
      text: el.text, textCase: el.textCase, style: el.style, mode: el.mode,
      trace: el.trace, fit: el.fit, splitBy: el.splitBy,
      rowHeightMm: el.rowHeight, linesPerItem: el.linesPerItem
    };
    Object.keys(map).forEach(function (field) {
      if (map[field] && sheet[field] !== undefined) map[field].value = sheet[field];
    });
    el.quick.forEach(function (b) {
      var on = b.getAttribute('data-quick') === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    syncRangeLabels();
    render();
  }

  el.quick.forEach(function (button) {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', function () {
      applyQuick(button.getAttribute('data-quick'));
    });
  });

  /* Editing anything by hand means the sheet is no longer that preset. */
  function clearQuickSelection() {
    el.quick.forEach(function (b) {
      b.classList.remove('is-active');
      b.setAttribute('aria-pressed', 'false');
    });
  }

  /* The letter families in the article are buttons, not a list to copy from —
     the content is only useful if it loads into the sheet. They set the text
     alone, unlike the ready sheets, because the size and layout already chosen
     are usually the ones wanted. */
  document.querySelectorAll('[data-family]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!el.text) return;
      el.text.value = button.getAttribute('data-family');
      clearQuickSelection();
      render();
      var tool = document.getElementById('tw-tool');
      if (tool && tool.scrollIntoView) tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (el.printBtn) el.printBtn.addEventListener('click', function () { window.print(); });

  if (el.shareBtn) {
    el.shareBtn.addEventListener('click', function () {
      var url = shareUrl();
      try { window.history.replaceState(null, '', url); } catch (e) { /* file:// */ }
      var done = function () {
        var original = el.shareBtn.getAttribute('data-label') || el.shareBtn.textContent;
        el.shareBtn.setAttribute('data-label', original);
        el.shareBtn.textContent = '✓ Link copied';
        window.setTimeout(function () { el.shareBtn.textContent = original; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, done);
      } else {
        done();
      }
    });
  }

  if (el.resetBtn) {
    el.resetBtn.addEventListener('click', function () {
      if (el.text) el.text.value = '';
      if (el.title) el.title.value = '';
      render();
    });
  }

  // ------------------------------------------------------------ first paint

  /* A shared link carries the whole sheet, so it is applied before the first
     render rather than causing a second one. */
  if (window.location.hash.length > 1) {
    applyShared(E.decodeSettings(window.location.hash));
  }
  syncRangeLabels();
  render();
})();
