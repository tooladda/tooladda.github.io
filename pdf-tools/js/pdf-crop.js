/* Crop PDF / trim margins.
   Two ways to choose the box: drag it on the page, or type the four margins
   in millimetres — both edit the same numbers. The auto-trim reads the
   rendered page back out of a canvas and finds the bounding box of everything
   that is not white, which is what makes "remove the scanner border" a one
   click job. Cropping writes a CropBox (and optionally a MediaBox); no page
   content is re-encoded, so nothing loses quality. */
(function () {
  'use strict';

  var PS = window.PdfSuite;
  var root = document.querySelector('[data-crop]');
  if (!root || !PS) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var els = {
    dropZone: $('[data-drop-zone]'),
    editor: $('[data-editor]'),
    stage: $('[data-stage]'),
    stageInner: $('[data-stage-inner]'),
    box: $('[data-cropbox]'),
    prev: $('[data-prev]'),
    next: $('[data-next]'),
    pageNum: $('[data-page-num]'),
    fileName: $('[data-file-name]'),
    pageCount: $('[data-page-count]'),
    fileSize: $('[data-file-size]'),
    message: $('[data-message]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    mTop: $('[data-m-top]'),
    mRight: $('[data-m-right]'),
    mBottom: $('[data-m-bottom]'),
    mLeft: $('[data-m-left]'),
    lock: $('[data-lock]'),
    autoPage: $('[data-auto-page]'),
    autoAll: $('[data-auto-all]'),
    padding: $('[data-padding]'),
    tolerance: $('[data-tolerance]'),
    applyTo: $('[data-apply-to]'),
    range: $('[data-range]'),
    rangeWrap: $('[data-range-wrap]'),
    hard: $('[data-hard]'),
    resetBox: $('[data-reset-box]'),
    sizeNote: $('[data-size-note]'),
    applyBtn: $('[data-apply]'),
    download: $('[data-download-link]'),
    startOver: $('[data-start-over]')
  };

  var MIN_PT = 20;

  var doc = null;
  var current = 1;
  var canvas = null;
  var renderToken = 0;
  var visualW = 0;         // current page width in points, as displayed
  var visualH = 0;
  var margins = { top: 0, right: 0, bottom: 0, left: 0 };   // points, from the visual edges
  var autoMode = false;

  /* -------------------------------------------------------------- helpers */
  function ptPerPx() {
    if (!canvas) return 1;
    var rect = canvas.getBoundingClientRect();
    return rect.width ? visualW / rect.width : 1;
  }

  function clampMargins() {
    margins.top = Math.max(0, margins.top);
    margins.right = Math.max(0, margins.right);
    margins.bottom = Math.max(0, margins.bottom);
    margins.left = Math.max(0, margins.left);
    if (visualW - margins.left - margins.right < MIN_PT) {
      margins.right = Math.max(0, visualW - margins.left - MIN_PT);
    }
    if (visualH - margins.top - margins.bottom < MIN_PT) {
      margins.bottom = Math.max(0, visualH - margins.top - MIN_PT);
    }
  }

  function syncInputs() {
    els.mTop.value = PS.ptToMm(margins.top).toFixed(1);
    els.mRight.value = PS.ptToMm(margins.right).toFixed(1);
    els.mBottom.value = PS.ptToMm(margins.bottom).toFixed(1);
    els.mLeft.value = PS.ptToMm(margins.left).toFixed(1);
  }

  function paintBox() {
    if (!canvas) return;
    clampMargins();
    var perPx = ptPerPx();
    if (!perPx) return;
    var style = els.box.style;
    style.left = (margins.left / perPx) + 'px';
    style.top = (margins.top / perPx) + 'px';
    style.width = Math.max(4, (visualW - margins.left - margins.right) / perPx) + 'px';
    style.height = Math.max(4, (visualH - margins.top - margins.bottom) / perPx) + 'px';
    els.box.hidden = false;

    var wMm = PS.ptToMm(visualW - margins.left - margins.right);
    var hMm = PS.ptToMm(visualH - margins.top - margins.bottom);
    els.sizeNote.textContent = 'Cropped page: ' + wMm.toFixed(0) + ' × ' + hMm.toFixed(0) + ' mm (was ' +
      PS.ptToMm(visualW).toFixed(0) + ' × ' + PS.ptToMm(visualH).toFixed(0) + ' mm)';
  }

  /* -------------------------------------------------------------- preview */
  function previewSide() {
    var room = els.stage ? els.stage.clientWidth - 34 : 620;
    return Math.max(220, Math.min(600, room));
  }

  function showPage(n) {
    if (!doc || !doc.pdfjsDoc) return;
    current = Math.max(1, Math.min(doc.pageCount, n));
    els.pageNum.textContent = 'Page ' + current + ' of ' + doc.pageCount;
    els.prev.disabled = current <= 1;
    els.next.disabled = current >= doc.pageCount;

    var token = (renderToken += 1);
    return PS.renderPage(doc.pdfjsDoc, current, previewSide()).then(function (result) {
      if (token !== renderToken || !result) return;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = result;
      visualW = result.cssWidth / result.renderScale;
      visualH = result.cssHeight / result.renderScale;
      els.stageInner.insertBefore(canvas, els.box);
      if (autoMode) {
        margins = detectMargins(canvas) || margins;
        syncInputs();
      }
      paintBox();
    }).catch(function () { /* preview only */ });
  }

  /* --------------------------------------------------------- auto detect */
  /* Finds the bounding box of everything darker than the tolerance and turns
     the white border around it into margins. Reads the canvas that is already
     on screen, so it costs nothing extra for the visible page. */
  function detectMargins(sourceCanvas) {
    if (!sourceCanvas) return null;
    var w = sourceCanvas.width;
    var h = sourceCanvas.height;
    var ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }

    var tolerance = parseInt(els.tolerance.value, 10);
    if (!Number.isFinite(tolerance)) tolerance = 12;
    var limit = 255 - tolerance;
    var minX = w;
    var minY = h;
    var maxX = -1;
    var maxY = -1;

    for (var y = 0; y < h; y += 1) {
      var rowOffset = y * w * 4;
      for (var x = 0; x < w; x += 1) {
        var i = rowOffset + x * 4;
        if (data[i + 3] < 16) continue;                    // transparent counts as blank
        if (data[i] > limit && data[i + 1] > limit && data[i + 2] > limit) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0) return { top: 0, right: 0, bottom: 0, left: 0 };   // a blank page: leave it alone

    var pad = PS.mmToPt(parseFloat(els.padding.value) || 0);
    var pxToPt = visualW / w;
    return {
      left: Math.max(0, minX * pxToPt - pad),
      top: Math.max(0, minY * pxToPt - pad),
      right: Math.max(0, (w - 1 - maxX) * pxToPt - pad),
      bottom: Math.max(0, (h - 1 - maxY) * pxToPt - pad)
    };
  }

  /* Off-screen render used when auto-trimming pages that are not on display. */
  function detectForPage(pageNumber) {
    return PS.renderPage(doc.pdfjsDoc, pageNumber, 420).then(function (offscreen) {
      if (!offscreen) return null;
      var savedW = visualW;
      var savedH = visualH;
      visualW = offscreen.cssWidth / offscreen.renderScale;
      visualH = offscreen.cssHeight / offscreen.renderScale;
      var found = detectMargins(offscreen);
      visualW = savedW;
      visualH = savedH;
      return found;
    }).catch(function () { return null; });
  }

  /* ---------------------------------------------------------- dragging */
  var drag = null;

  els.box.addEventListener('pointerdown', function (e) {
    var handle = e.target.dataset ? e.target.dataset.handle : null;
    if (!handle) return;
    e.preventDefault();
    var perPx = ptPerPx();
    drag = {
      handle: handle,
      x: e.clientX,
      y: e.clientY,
      perPx: perPx,
      start: { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left }
    };
    if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);
  });

  els.box.addEventListener('pointermove', function (e) {
    if (!drag) return;
    e.preventDefault();
    var dx = (e.clientX - drag.x) * drag.perPx;
    var dy = (e.clientY - drag.y) * drag.perPx;
    var h = drag.handle;
    var s = drag.start;

    if (h === 'move') {
      var maxDx = Math.min(s.right, Math.max(-s.left, dx));
      var maxDy = Math.min(s.bottom, Math.max(-s.top, dy));
      margins.left = s.left + maxDx;
      margins.right = s.right - maxDx;
      margins.top = s.top + maxDy;
      margins.bottom = s.bottom - maxDy;
    } else {
      if (h.indexOf('w') > -1) margins.left = s.left + dx;
      if (h.indexOf('e') > -1) margins.right = s.right - dx;
      if (h.indexOf('n') > -1) margins.top = s.top + dy;
      if (h.indexOf('s') > -1) margins.bottom = s.bottom - dy;
    }
    autoMode = false;
    setAutoState();
    paintBox();
    syncInputs();
  });

  ['pointerup', 'pointercancel'].forEach(function (type) {
    els.box.addEventListener(type, function () { drag = null; });
  });

  /* ------------------------------------------------------------- inputs */
  function readInputs(changed) {
    var value = parseFloat(changed.value);
    if (!Number.isFinite(value) || value < 0) value = 0;
    var pt = PS.mmToPt(value);
    if (els.lock.checked) {
      margins.top = margins.right = margins.bottom = margins.left = pt;
    } else if (changed === els.mTop) margins.top = pt;
    else if (changed === els.mRight) margins.right = pt;
    else if (changed === els.mBottom) margins.bottom = pt;
    else margins.left = pt;
    autoMode = false;
    setAutoState();
    paintBox();
    if (els.lock.checked) syncInputs();
  }

  [els.mTop, els.mRight, els.mBottom, els.mLeft].forEach(function (input) {
    input.addEventListener('input', function () { readInputs(input); });
    input.addEventListener('change', function () { readInputs(input); syncInputs(); });
  });

  function setAutoState() {
    if (els.autoAll) els.autoAll.classList.toggle('is-active', autoMode);
  }

  if (els.autoPage) {
    els.autoPage.addEventListener('click', function () {
      var found = detectMargins(canvas);
      if (!found) { PS.msg(els.message, 'Could not read this page for auto-trim. Set the margins by hand instead.', 'warn'); return; }
      autoMode = false;
      setAutoState();
      margins = found;
      paintBox();
      syncInputs();
      PS.msg(els.message, 'Margins detected for this page. The same box will be used for every page you apply it to.', 'info');
    });
  }

  if (els.autoAll) {
    els.autoAll.addEventListener('click', function () {
      autoMode = !autoMode;
      setAutoState();
      if (autoMode) {
        var found = detectMargins(canvas);
        if (found) { margins = found; syncInputs(); paintBox(); }
        PS.msg(els.message, 'Per-page auto-trim is on: every page gets its own detected margins when you crop.', 'info');
      } else {
        PS.msg(els.message, 'Per-page auto-trim is off: the box shown here is used for every page you apply it to.', 'info');
      }
    });
  }

  if (els.resetBox) {
    els.resetBox.addEventListener('click', function () {
      autoMode = false;
      setAutoState();
      margins = { top: 0, right: 0, bottom: 0, left: 0 };
      paintBox();
      syncInputs();
    });
  }

  if (els.applyTo) {
    els.applyTo.addEventListener('change', function () {
      els.rangeWrap.hidden = els.applyTo.value !== 'range';
    });
  }

  if (els.prev) els.prev.addEventListener('click', function () { showPage(current - 1); });
  if (els.next) els.next.addEventListener('click', function () { showPage(current + 1); });

  /* --------------------------------------------------------------- input */
  function handleFiles(files) {
    PS.clearMsg(els.message);
    PS.progress(els.progress, els.progressBar, 12, true);
    PS.openPdf(files[0]).then(function (opened) {
      doc = opened;
      margins = { top: 0, right: 0, bottom: 0, left: 0 };
      autoMode = false;
      setAutoState();
      els.fileName.textContent = doc.name;
      els.pageCount.textContent = doc.pageCount + (doc.pageCount === 1 ? ' page' : ' pages');
      els.fileSize.textContent = PS.fmtSize(doc.size);
      els.editor.hidden = false;
      els.dropZone.classList.add('is-compact');
      els.download.classList.add('hidden');
      PS.progress(els.progress, els.progressBar, 100, true);
      setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 300);
      showPage(1);
      syncInputs();
      PS.msg(els.message, 'PDF loaded. Drag the crop box, type margins, or use auto-trim.', 'success');
      els.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      PS.progress(els.progress, els.progressBar, 0, false);
      PS.msg(els.message, err.message || 'Could not open that PDF.', 'error');
    });
  }

  /* --------------------------------------------------------------- apply */
  function targetPages() {
    var mode = els.applyTo.value;
    var all = [];
    for (var i = 1; i <= doc.pageCount; i += 1) all.push(i);
    if (mode === 'current') return [current];
    if (mode === 'odd') return all.filter(function (n) { return n % 2 === 1; });
    if (mode === 'even') return all.filter(function (n) { return n % 2 === 0; });
    if (mode === 'range') return PS.parseRange(els.range.value, doc.pageCount);
    return all;
  }

  if (els.applyBtn) {
    els.applyBtn.addEventListener('click', function () {
      if (!doc) return;
      var list = targetPages();
      if (!list.length) {
        PS.msg(els.message, 'No pages match that range — check the page range box.', 'warn');
        return;
      }
      els.applyBtn.disabled = true;
      PS.progress(els.progress, els.progressBar, 15, true);

      /* In per-page mode every target page is rendered once to find its own
         box; otherwise one set of margins covers the lot. */
      var prepare = autoMode
        ? list.reduce(function (chain, pageNumber, i) {
          return chain.then(function (map) {
            return detectForPage(pageNumber).then(function (found) {
              map[pageNumber] = found;
              PS.progress(els.progress, els.progressBar, 15 + (i / list.length) * 55, true);
              return map;
            });
          });
        }, Promise.resolve({}))
        : Promise.resolve(null);

      prepare.then(function (perPage) {
        return window.PDFLib.PDFDocument.load(doc.bytes, { ignoreEncryption: true }).then(function (pdf) {
          var pages = pdf.getPages();
          var applied = 0;

          list.forEach(function (pageNumber) {
            var page = pages[pageNumber - 1];
            if (!page) return;
            var m = perPage ? perPage[pageNumber] : margins;
            if (!m) return;

            var box = page.getCropBox();
            var rot = PS.normalizeRotation(page.getRotation().angle);
            var vis = PS.visualSize(box.width, box.height, rot);
            var width = vis.width - m.left - m.right;
            var height = vis.height - m.top - m.bottom;
            if (width < MIN_PT || height < MIN_PT) return;

            var rect = PS.rectVisualToUser({ x: m.left, y: m.bottom, width: width, height: height }, box, rot);
            page.setCropBox(rect.x, rect.y, rect.width, rect.height);
            if (els.hard.checked) page.setMediaBox(rect.x, rect.y, rect.width, rect.height);
            applied += 1;
          });

          PS.progress(els.progress, els.progressBar, 85, true);
          if (!applied) throw new Error('nothing-cropped');
          return pdf.save().then(function (bytes) { return { bytes: bytes, applied: applied }; });
        });
      }).then(function (result) {
        els.download.href = PS.toBlobUrl(result.bytes);
        els.download.download = PS.baseName(doc.name) + '-cropped.pdf';
        els.download.classList.remove('hidden');
        els.download.click();
        PS.progress(els.progress, els.progressBar, 100, true);
        setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 400);
        PS.msg(els.message, 'Done! ' + result.applied + ' page' + (result.applied === 1 ? '' : 's') + ' cropped and downloaded.', 'success');
      }).catch(function (err) {
        PS.progress(els.progress, els.progressBar, 0, false);
        PS.msg(els.message, err && err.message === 'nothing-cropped'
          ? 'That crop would leave nothing on the page. Reduce the margins and try again.'
          : 'Could not crop this PDF. Please try again.', 'error');
      }).then(function () {
        els.applyBtn.disabled = false;
      });
    });
  }

  if (els.startOver) {
    els.startOver.addEventListener('click', function () {
      doc = null;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null;
      els.editor.hidden = true;
      els.box.hidden = true;
      els.dropZone.classList.remove('is-compact');
      els.download.classList.add('hidden');
      PS.clearMsg(els.message);
      PS.progress(els.progress, els.progressBar, 0, false);
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!doc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { showPage(current); }, 200);
  });

  PS.bindDrop(root, handleFiles);
}());
