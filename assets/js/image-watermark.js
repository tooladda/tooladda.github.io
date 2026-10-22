/* ToolAdda — Image Watermark, UI layer.

   All placement, sizing and naming maths lives in image-watermark-engine.js so
   it can be tested without a browser. This file does the three things that
   genuinely need the DOM: measuring text, painting canvases, and handing the
   result back to the visitor. Nothing is uploaded — every pixel is read with
   the File API and written straight back to the downloads folder. */
(function () {
  'use strict';

  var root = document.querySelector('[data-watermark]');
  if (!root) return;

  var E = window.ImageWatermarkEngine;
  if (!E) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var el = {
    drop: $('[data-drop]'),
    input: $('[data-file-input]'),
    pickers: $$('[data-file-picker]'),
    editor: $('[data-editor]'),
    canvas: $('[data-preview-canvas]'),
    strip: $('[data-strip]'),
    stripWrap: $('[data-strip-wrap]'),
    fname: $('[data-fname]'),
    fdims: $('[data-fdims]'),
    fsize: $('[data-fsize]'),

    modeBtns: $$('[data-mode-btn]'),
    textPanel: $('[data-panel-text]'),
    logoPanel: $('[data-panel-logo]'),

    text: $('[data-text]'),
    font: $('[data-font]'),
    bold: $('[data-bold]'),
    color: $('[data-color]'),
    outline: $('[data-outline]'),

    logoInput: $('[data-logo-input]'),
    logoPicker: $('[data-logo-picker]'),
    logoName: $('[data-logo-name]'),
    logoClear: $('[data-logo-clear]'),

    layout: $('[data-layout]'),
    posGrid: $('[data-pos-grid]'),
    posBtns: $$('[data-pos]'),
    gapWrap: $('[data-gap-wrap]'),
    marginWrap: $('[data-margin-wrap]'),

    size: $('[data-size]'), sizeVal: $('[data-size-val]'),
    opacity: $('[data-opacity]'), opacityVal: $('[data-opacity-val]'),
    rotation: $('[data-rotation]'), rotationVal: $('[data-rotation-val]'),
    margin: $('[data-margin]'), marginVal: $('[data-margin-val]'),
    gap: $('[data-gap]'), gapVal: $('[data-gap-val]'),

    format: $('[data-format]'),
    quality: $('[data-quality]'), qualityVal: $('[data-quality-val]'), qualityWrap: $('[data-quality-wrap]'),

    downloadBtn: $('[data-download-btn]'),
    downloadAll: $('[data-download-all]'),
    reset: $('[data-reset]'),
    remove: $('[data-remove]'),
    message: $('[data-message]'),
    progress: $('[data-progress]'),
    progressFill: $('[data-progress-fill]'),
    progressText: $('[data-progress-text]'),
    count: $('[data-count]')
  };

  var stickyBar = document.querySelector('[data-iw-sticky]');
  var stickyBtn = document.querySelector('[data-iw-sticky-btn]');

  var items = [];
  var selected = 0;
  var logo = null;          // { img, name }
  var mode = 'text';
  var objectUrls = [];

  var state = {
    text: 'ToolAdda',
    font: 'Inter, Segoe UI, Arial, sans-serif',
    bold: true,
    color: '#ffffff',
    outline: true,
    layout: 'single',
    position: 'bottom-right',
    size: 18,
    opacity: 55,
    rotation: 0,
    margin: 4,
    gap: 40,
    format: 'png',
    quality: 92
  };

  // ------------------------------------------------------------- helpers

  function message(text, tone) {
    if (!el.message) return;
    if (!text) { el.message.hidden = true; el.message.textContent = ''; return; }
    el.message.textContent = text;
    el.message.dataset.tone = tone || 'info';
    el.message.hidden = false;
  }

  function makeCanvas(w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  function looksLikeImage(file) {
    return file && ((file.type || '').indexOf('image/') === 0 ||
      /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name || ''));
  }

  function trackUrl(url) {
    objectUrls.push(url);
    return url;
  }

  function releaseUrls() {
    objectUrls.forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
    });
    objectUrls = [];
  }

  // -------------------------------------------------------- drawing core

  /** Measure the text mark at a given font size. Canvas is the only reliable
   *  way to know how wide a string renders, so measurement stays here and the
   *  engine is handed the numbers. */
  function measureText(ctx, text, fontSize) {
    ctx.font = (state.bold ? '800 ' : '400 ') + fontSize + 'px ' + state.font;
    var metrics = ctx.measureText(text);
    var width = Math.max(1, metrics.width);
    /* actualBoundingBox gives a true cap-to-descender height where it exists;
       the 1.18 fallback is a reasonable stand-in for older Safari. */
    var height = (metrics.actualBoundingBoxAscent && metrics.actualBoundingBoxDescent)
      ? metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
      : fontSize * 1.18;
    return { width: width, height: Math.max(1, height) };
  }

  /** Paint one image plus its watermark onto a canvas at full resolution. */
  function render(item, canvas) {
    var ctx = canvas.getContext('2d');
    canvas.width = item.img.naturalWidth;
    canvas.height = item.img.naturalHeight;
    ctx.drawImage(item.img, 0, 0);

    var W = canvas.width;
    var H = canvas.height;
    var alpha = E.opacityFromUi(state.opacity);
    var angle = state.rotation;

    var markW;
    var markH;
    var fontSize = 0;

    if (mode === 'text') {
      if (!state.text.trim()) return canvas;
      fontSize = E.resolveFontSize(W, H, state.size);
      var measured = measureText(ctx, state.text, fontSize);
      markW = measured.width;
      markH = measured.height;
    } else {
      if (!logo) return canvas;
      markW = E.resolveMarkWidth(W, H, state.size);
      markH = markW * (logo.img.naturalHeight / logo.img.naturalWidth);
    }

    var placements = E.buildPlacements({
      imageW: W, imageH: H, markW: markW, markH: markH,
      layout: state.layout, position: state.position, angle: angle,
      marginPercent: state.margin, gapPercent: state.gap
    });

    ctx.save();
    ctx.globalAlpha = alpha;

    placements.forEach(function (point) {
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(E.toRadians(angle));

      if (mode === 'text') {
        ctx.font = (state.bold ? '800 ' : '400 ') + fontSize + 'px ' + state.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (state.outline) {
          /* An outline in the opposite tone is what keeps a white mark visible
             on a bright sky and a dark mark visible on a shadow. */
          ctx.lineWidth = Math.max(1, fontSize * 0.06);
          ctx.strokeStyle = E.rgbaFromHex(E.autoOutlineColor(state.color), alpha * 0.85);
          ctx.lineJoin = 'round';
          ctx.strokeText(state.text, 0, 0);
        }
        ctx.fillStyle = E.rgbaFromHex(state.color, 1);
        ctx.fillText(state.text, 0, 0);
      } else {
        ctx.drawImage(logo.img, -markW / 2, -markH / 2, markW, markH);
      }

      ctx.restore();
    });

    ctx.restore();
    return canvas;
  }

  function drawPreview() {
    var item = items[selected];
    if (!item || !el.canvas) return;

    /* The preview is rendered at full resolution then displayed scaled by CSS,
       so what is on screen is exactly what downloads — no separate preview
       maths that can drift from the export path. */
    render(item, el.canvas);
  }

  // ------------------------------------------------------------- loading

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(looksLikeImage);
    if (!files.length) {
      message('Please choose image files — JPG, PNG, WebP, GIF, BMP or AVIF.', 'error');
      return;
    }

    var pending = files.length;
    files.forEach(function (file) {
      var url = trackUrl(URL.createObjectURL(file));
      var img = new Image();
      img.onload = function () {
        items.push({ file: file, name: file.name || 'image', size: file.size, img: img, url: url });
        pending -= 1;
        if (pending === 0) afterLoad();
      };
      img.onerror = function () {
        pending -= 1;
        message('One file could not be read and was skipped.', 'error');
        if (pending === 0) afterLoad();
      };
      img.src = url;
    });
  }

  function afterLoad() {
    if (!items.length) return;
    message('');
    if (el.editor) el.editor.hidden = false;
    if (el.drop) el.drop.classList.add('is-compact');
    selected = Math.min(selected, items.length - 1);
    renderStrip();
    syncFileMeta();
    drawPreview();
    updateStickyBar();
    scrollToEditor();
  }

  /* After images load, bring the live preview into view (below the sticky header),
     unless its top is already comfortably on screen. */
  function scrollToEditor() {
    if (!el.editor || el.editor.hidden) return;
    var header = document.querySelector('.site-header');
    var offset = (header ? Math.max(0, header.getBoundingClientRect().bottom) : 70) + 16;
    var top = el.editor.getBoundingClientRect().top;
    if (top >= offset && top <= window.innerHeight * 0.4) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top + window.pageYOffset - offset), behavior: reduce ? 'auto' : 'smooth' });
  }

  function renderStrip() {
    if (!el.strip) return;
    if (el.stripWrap) el.stripWrap.hidden = items.length < 2;
    if (el.count) el.count.textContent = items.length === 1 ? '1 image' : items.length + ' images';

    el.strip.innerHTML = '';
    items.forEach(function (item, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'iw-thumb' + (index === selected ? ' is-active' : '');
      button.setAttribute('aria-label', 'Select ' + item.name);
      button.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
      var thumb = document.createElement('img');
      thumb.src = item.url;
      thumb.alt = '';
      button.appendChild(thumb);
      button.addEventListener('click', function () {
        selected = index;
        renderStrip();
        syncFileMeta();
        drawPreview();
      });
      el.strip.appendChild(button);
    });
  }

  function syncFileMeta() {
    var item = items[selected];
    if (!item) return;
    if (el.fname) el.fname.textContent = item.name;
    if (el.fdims) el.fdims.textContent = item.img.naturalWidth + ' x ' + item.img.naturalHeight;
    if (el.fsize) el.fsize.textContent = E.formatBytes(item.size);
  }

  // ------------------------------------------------------------- exports

  function exportBlob(item) {
    return new Promise(function (resolve) {
      var canvas = makeCanvas(1, 1);
      render(item, canvas);
      var mime = E.mimeForFormat(state.format);
      var quality = E.isLossy(state.format) ? state.quality / 100 : undefined;
      canvas.toBlob(function (blob) { resolve(blob); }, mime, quality);
    });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function showProgress(done, total) {
    if (!el.progress) return;
    el.progress.hidden = total <= 1;
    var percent = total ? Math.round((done / total) * 100) : 0;
    if (el.progressFill) el.progressFill.style.width = percent + '%';
    if (el.progressText) el.progressText.textContent = done + ' of ' + total + ' done';
  }

  function downloadCurrent() {
    var item = items[selected];
    if (!item) return;
    exportBlob(item).then(function (blob) {
      if (!blob) { message('This image could not be exported. Try PNG.', 'error'); return; }
      saveBlob(blob, E.outputName(item.name, state.format));
      message('Saved ' + E.outputName(item.name, state.format) + ' — ' + E.formatBytes(blob.size) + '.', 'success');
    });
  }

  function downloadAll() {
    if (items.length < 2) { downloadCurrent(); return; }
    if (typeof JSZip === 'undefined') {
      message('The ZIP library did not load. Download images one at a time instead.', 'error');
      return;
    }

    var zip = new JSZip();
    var names = E.uniqueNames(items.map(function (item) {
      return E.outputName(item.name, state.format);
    }));

    showProgress(0, items.length);
    var chain = Promise.resolve();
    items.forEach(function (item, index) {
      chain = chain.then(function () {
        return exportBlob(item).then(function (blob) {
          if (blob) zip.file(names[index], blob);
          showProgress(index + 1, items.length);
        });
      });
    });

    chain.then(function () {
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      saveBlob(blob, 'watermarked-images.zip');
      message('Saved ' + items.length + ' images as watermarked-images.zip.', 'success');
      if (el.progress) el.progress.hidden = true;
    });
  }

  // ---------------------------------------------------------- UI wiring

  function setMode(next) {
    mode = next;
    el.modeBtns.forEach(function (button) {
      var on = button.getAttribute('data-mode-btn') === next;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (el.textPanel) el.textPanel.hidden = next !== 'text';
    if (el.logoPanel) el.logoPanel.hidden = next !== 'logo';
    drawPreview();
  }

  function setLayout(next) {
    state.layout = next;
    /* Position only means something for a single mark; a tiled or diagonal
       pattern covers the image, so the control is hidden rather than left
       visible and inert. */
    if (el.posGrid) el.posGrid.hidden = next !== 'single';
    if (el.marginWrap) el.marginWrap.hidden = next !== 'single';
    if (el.gapWrap) el.gapWrap.hidden = next === 'single';
    drawPreview();
  }

  function bindRange(input, label, key, suffix) {
    if (!input) return;
    var update = function () {
      state[key] = Number(input.value);
      if (label) label.textContent = input.value + (suffix || '');
      drawPreview();
    };
    input.addEventListener('input', update);
    update();
  }

  /* Phone sticky button walks the user through the job instead of offering a Download
     with nothing loaded: Add images -> set the watermark -> Download. The step pills
     above the drop zone follow the same state. */
  var seenSettings = false;
  var panelEl = document.querySelector('.iw-panel');
  var stepEls = Array.prototype.slice.call(document.querySelectorAll('.iw-steps .iw-step'));

  function stickyStage() {
    if (!items.length) return 'add';
    return seenSettings ? 'download' : 'set';
  }

  function updateStickyBar() {
    var stage = stickyStage();
    stepEls.forEach(function (step, i) {
      var current = stage === 'add' ? 0 : stage === 'set' ? 1 : 3;
      step.classList.toggle('is-current', i === current);
      step.classList.toggle('is-done', i < current);
    });
    var curStep = stepEls.filter(function (x) { return x.classList.contains('is-current'); })[0];
    var row = curStep && curStep.parentElement;
    if (row && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = Math.max(0, curStep.offsetLeft - row.offsetLeft - (row.clientWidth - curStep.offsetWidth) / 2);
    }
    if (!stickyBar || !stickyBtn) return;
    stickyBar.hidden = false;
    stickyBtn.dataset.stage = stage;
    if (stage === 'add') stickyBtn.textContent = '📁 Add images';
    else if (stage === 'set') stickyBtn.textContent = '✍️ Next: set your watermark ↓';
    else stickyBtn.textContent = items.length > 1
      ? '⬇️ Download all ' + items.length + ' as ZIP'
      : '⬇️ Download watermarked image';
  }

  function markSettingsSeen() {
    if (seenSettings || !items.length) return;
    seenSettings = true;
    updateStickyBar();
  }

  function onStickyClick() {
    var stage = stickyStage();
    if (stage === 'add') { if (el.input) el.input.click(); return; }
    if (stage === 'set') {
      if (panelEl) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var header = document.querySelector('.site-header');
        var offset = (header ? Math.max(0, header.getBoundingClientRect().bottom) : 70) + 16;
        window.scrollTo({ top: panelEl.getBoundingClientRect().top + window.pageYOffset - offset, behavior: reduce ? 'auto' : 'smooth' });
      }
      markSettingsSeen();
      return;
    }
    downloadAll();
  }

  /* "Seen" means the visitor acted — pressed Next or touched a setting — not merely that
     the panel scrolled into view (the auto-scroll after loading brings it on screen). */
  if (panelEl) {
    panelEl.addEventListener('input', markSettingsSeen);
    panelEl.addEventListener('click', markSettingsSeen);
  }

  function reset() {
    releaseUrls();
    seenSettings = false;
    items = [];
    selected = 0;
    logo = null;
    if (el.editor) el.editor.hidden = true;
    if (el.drop) el.drop.classList.remove('is-compact');
    if (el.input) el.input.value = '';
    if (el.logoName) el.logoName.textContent = '';
    message('');
    updateStickyBar();
  }

  // file pickers + drop zone
  el.pickers.forEach(function (button) {
    button.addEventListener('click', function () { if (el.input) el.input.click(); });
  });
  if (el.input) {
    el.input.addEventListener('change', function (event) {
      addFiles(event.target.files);
      event.target.value = '';
    });
  }
  if (el.drop) {
    el.drop.addEventListener('click', function (event) {
      if (event.target.closest('button')) return;
      if (el.input) el.input.click();
    });
    el.drop.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (el.input) el.input.click();
      }
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      el.drop.addEventListener(type, function (event) {
        event.preventDefault();
        el.drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      el.drop.addEventListener(type, function (event) {
        event.preventDefault();
        el.drop.classList.remove('is-over');
        if (type === 'drop' && event.dataTransfer) addFiles(event.dataTransfer.files);
      });
    });
  }

  // logo upload
  if (el.logoPicker && el.logoInput) {
    el.logoPicker.addEventListener('click', function () { el.logoInput.click(); });
    el.logoInput.addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file || !looksLikeImage(file)) { message('Choose a PNG, SVG or JPG logo.', 'error'); return; }
      var url = trackUrl(URL.createObjectURL(file));
      var img = new Image();
      img.onload = function () {
        logo = { img: img, name: file.name };
        if (el.logoName) el.logoName.textContent = file.name;
        message('');
        drawPreview();
      };
      img.onerror = function () { message('That logo could not be read.', 'error'); };
      img.src = url;
      event.target.value = '';
    });
  }
  if (el.logoClear) {
    el.logoClear.addEventListener('click', function () {
      logo = null;
      if (el.logoName) el.logoName.textContent = '';
      drawPreview();
    });
  }

  el.modeBtns.forEach(function (button) {
    button.addEventListener('click', function () { setMode(button.getAttribute('data-mode-btn')); });
  });

  el.posBtns.forEach(function (button) {
    button.addEventListener('click', function () {
      state.position = button.getAttribute('data-pos');
      el.posBtns.forEach(function (other) {
        var on = other === button;
        other.classList.toggle('is-active', on);
        other.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      drawPreview();
    });
  });

  if (el.layout) {
    el.layout.addEventListener('change', function () { setLayout(el.layout.value); });
  }
  if (el.text) {
    el.text.addEventListener('input', function () { state.text = el.text.value; drawPreview(); });
  }
  if (el.font) {
    el.font.addEventListener('change', function () { state.font = el.font.value; drawPreview(); });
  }
  if (el.bold) {
    el.bold.addEventListener('change', function () { state.bold = el.bold.checked; drawPreview(); });
  }
  if (el.color) {
    el.color.addEventListener('input', function () { state.color = el.color.value; drawPreview(); });
  }
  if (el.outline) {
    el.outline.addEventListener('change', function () { state.outline = el.outline.checked; drawPreview(); });
  }
  if (el.format) {
    el.format.addEventListener('change', function () {
      state.format = el.format.value;
      if (el.qualityWrap) el.qualityWrap.hidden = !E.isLossy(state.format);
      drawPreview();
    });
  }

  bindRange(el.size, el.sizeVal, 'size', '%');
  bindRange(el.opacity, el.opacityVal, 'opacity', '%');
  bindRange(el.rotation, el.rotationVal, 'rotation', '°');
  bindRange(el.margin, el.marginVal, 'margin', '%');
  bindRange(el.gap, el.gapVal, 'gap', '%');
  bindRange(el.quality, el.qualityVal, 'quality', '');

  if (el.downloadBtn) el.downloadBtn.addEventListener('click', downloadCurrent);
  if (el.downloadAll) el.downloadAll.addEventListener('click', downloadAll);
  if (stickyBtn) stickyBtn.addEventListener('click', onStickyClick);
  if (el.reset) el.reset.addEventListener('click', reset);
  if (el.remove) {
    el.remove.addEventListener('click', function () {
      if (!items.length) return;
      items.splice(selected, 1);
      if (!items.length) { reset(); return; }
      selected = Math.max(0, selected - 1);
      renderStrip();
      syncFileMeta();
      drawPreview();
    });
  }

  window.addEventListener('beforeunload', releaseUrls);

  // initial UI state
  setMode('text');
  setLayout(state.layout);
  if (el.qualityWrap) el.qualityWrap.hidden = !E.isLossy(state.format);
  if (el.editor) el.editor.hidden = true;
  updateStickyBar();
})();
