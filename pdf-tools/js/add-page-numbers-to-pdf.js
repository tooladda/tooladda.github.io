/* Add Page Numbers to PDF — stamps a running number onto every page.
   The preview is an HTML overlay sitting on top of a pdf.js render rather
   than a re-stamped PDF, so dragging a slider is instant; the same anchor
   maths (margin from the visual edge, baseline placed by the font's own
   ascent/descent) is then reused when the file is written with pdf-lib, so
   what you see really is where the number lands. */
(function () {
  'use strict';

  var PS = window.PdfSuite;
  var root = document.querySelector('[data-pagenum]');
  if (!root || !PS) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var els = {
    dropZone: $('[data-drop-zone]'),
    editor: $('[data-editor]'),
    stage: $('[data-stage]'),
    stageInner: $('[data-stage-inner]'),
    overlay: $('[data-overlay]'),
    prev: $('[data-prev]'),
    next: $('[data-next]'),
    pageNum: $('[data-page-num]'),
    fileName: $('[data-file-name]'),
    pageCount: $('[data-page-count]'),
    fileSize: $('[data-file-size]'),
    message: $('[data-message]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    format: $('[data-format]'),
    customWrap: $('[data-custom-wrap]'),
    custom: $('[data-custom]'),
    start: $('[data-start]'),
    range: $('[data-range]'),
    font: $('[data-font]'),
    size: $('[data-size]'),
    sizeVal: $('[data-size-val]'),
    color: $('[data-color]'),
    opacity: $('[data-opacity]'),
    opacityVal: $('[data-opacity-val]'),
    marginX: $('[data-margin-x]'),
    marginY: $('[data-margin-y]'),
    mirror: $('[data-mirror]'),
    applyBtn: $('[data-apply]'),
    download: $('[data-download-link]'),
    startOver: $('[data-start-over]'),
    summary: $('[data-summary]')
  };

  var STANDARD_FONTS = {
    helvetica: { pdf: 'Helvetica', css: 'Helvetica, Arial, sans-serif', weight: '400', style: 'normal' },
    'helvetica-bold': { pdf: 'Helvetica-Bold', css: 'Helvetica, Arial, sans-serif', weight: '700', style: 'normal' },
    times: { pdf: 'Times-Roman', css: 'Times New Roman, Times, serif', weight: '400', style: 'normal' },
    'times-bold': { pdf: 'Times-Bold', css: 'Times New Roman, Times, serif', weight: '700', style: 'normal' },
    'times-italic': { pdf: 'Times-Italic', css: 'Times New Roman, Times, serif', weight: '400', style: 'italic' },
    courier: { pdf: 'Courier', css: 'Courier New, Courier, monospace', weight: '400', style: 'normal' },
    'courier-bold': { pdf: 'Courier-Bold', css: 'Courier New, Courier, monospace', weight: '700', style: 'normal' }
  };

  var doc = null;          // { bytes, pdfjsDoc, pageCount, name, size }
  var current = 1;
  var position = 'bottom-center';
  var canvas = null;
  var renderToken = 0;

  /* ------------------------------------------------------- number formats */
  function roman(n) {
    var map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
      [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    var out = '';
    var left = Math.max(1, n);
    map.forEach(function (pair) {
      while (left >= pair[0]) { out += pair[1]; left -= pair[0]; }
    });
    return out;
  }

  function alpha(n) {
    var out = '';
    var left = Math.max(1, n);
    while (left > 0) {
      var rem = (left - 1) % 26;
      out = String.fromCharCode(97 + rem) + out;
      left = Math.floor((left - 1) / 26);
    }
    return out;
  }

  function label(n, total) {
    var format = els.format.value;
    if (format === 'custom') {
      return String(els.custom.value || '{n}').replace(/\{n\}/g, n).replace(/\{total\}/g, total);
    }
    if (format === 'page-n') return 'Page ' + n;
    if (format === 'n-of-total') return n + ' of ' + total;
    if (format === 'page-n-of-total') return 'Page ' + n + ' of ' + total;
    if (format === 'dash') return '- ' + n + ' -';
    if (format === 'roman') return roman(n);
    if (format === 'roman-upper') return roman(n).toUpperCase();
    if (format === 'alpha') return alpha(n);
    if (format === 'alpha-upper') return alpha(n).toUpperCase();
    return String(n);
  }

  /* Which pages get a stamp, and what number each one shows. */
  function plan() {
    if (!doc) return { pages: {}, total: 0, list: [] };
    var list = PS.parseRange(els.range.value, doc.pageCount);
    var start = parseInt(els.start.value, 10);
    if (!Number.isFinite(start)) start = 1;
    var map = {};
    list.forEach(function (pageNumber, i) { map[pageNumber] = start + i; });
    return { pages: map, total: start + Math.max(0, list.length - 1), list: list };
  }

  /* ------------------------------------------------------------- preview */
  function showPage(n) {
    if (!doc || !doc.pdfjsDoc) return;
    current = Math.max(1, Math.min(doc.pageCount, n));
    els.pageNum.textContent = 'Page ' + current + ' of ' + doc.pageCount;
    els.prev.disabled = current <= 1;
    els.next.disabled = current >= doc.pageCount;

    var token = (renderToken += 1);
    /* Render to the width that is actually available: the overlay is
       positioned in CSS pixels, so a canvas later squeezed by max-width
       would put the preview number in the wrong place. */
    PS.renderPage(doc.pdfjsDoc, current, previewSide()).then(function (result) {
      if (token !== renderToken || !result) return;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = result;
      els.stageInner.insertBefore(canvas, els.overlay);
      paintOverlay();
    }).catch(function () { /* preview is optional; export still works */ });
  }

  function previewSide() {
    var room = els.stage ? els.stage.clientWidth - 34 : 620;
    return Math.max(220, Math.min(620, room));
  }

  function paintOverlay() {
    if (!canvas || !doc) return;
    var info = plan();
    var n = info.pages[current];
    if (!n) { els.overlay.hidden = true; syncSummary(info); return; }

    var scale = canvas.renderScale;
    var size = parseFloat(els.size.value) || 11;
    var mx = PS.mmToPt(parseFloat(els.marginX.value) || 0);
    var my = PS.mmToPt(parseFloat(els.marginY.value) || 0);
    var place = effectivePosition(current);
    var font = STANDARD_FONTS[els.font.value] || STANDARD_FONTS.helvetica;

    var style = els.overlay.style;
    els.overlay.hidden = false;
    els.overlay.textContent = label(n, info.total);
    style.position = 'absolute';
    style.whiteSpace = 'pre';
    style.lineHeight = '1';
    style.pointerEvents = 'none';
    style.fontFamily = font.css;
    style.fontWeight = font.weight;
    style.fontStyle = font.style;
    style.fontSize = (size * scale) + 'px';
    style.color = els.color.value;
    style.opacity = String((parseFloat(els.opacity.value) || 100) / 100);
    style.left = style.right = style.top = style.bottom = 'auto';
    style.transform = 'none';

    if (place.indexOf('top') === 0) style.top = (my * scale) + 'px';
    else style.bottom = (my * scale) + 'px';

    if (place.indexOf('left') > -1) style.left = (mx * scale) + 'px';
    else if (place.indexOf('right') > -1) style.right = (mx * scale) + 'px';
    else { style.left = '50%'; style.transform = 'translateX(-50%)'; }

    syncSummary(info);
  }

  function effectivePosition(pageNumber) {
    if (!els.mirror.checked || pageNumber % 2 === 0) return position;
    // Mirrored (booklet) margins: the outer edge swaps sides on facing pages.
    if (position.indexOf('left') > -1) return position.replace('left', 'right');
    if (position.indexOf('right') > -1) return position.replace('right', 'left');
    return position;
  }

  function syncSummary(info) {
    if (!els.summary) return;
    var count = info.list.length;
    els.summary.textContent = count
      ? count + ' of ' + doc.pageCount + ' page' + (doc.pageCount === 1 ? '' : 's') + ' will be numbered, starting at ' + label(info.pages[info.list[0]], info.total) + '.'
      : 'No pages match that range, so nothing would be stamped.';
  }

  /* --------------------------------------------------------------- input */
  function handleFiles(files) {
    PS.clearMsg(els.message);
    PS.progress(els.progress, els.progressBar, 12, true);
    PS.openPdf(files[0]).then(function (opened) {
      doc = opened;
      els.fileName.textContent = doc.name;
      els.pageCount.textContent = doc.pageCount + (doc.pageCount === 1 ? ' page' : ' pages');
      els.fileSize.textContent = PS.fmtSize(doc.size);
      els.editor.hidden = false;
      els.dropZone.classList.add('is-compact');
      els.download.classList.add('hidden');
      PS.progress(els.progress, els.progressBar, 100, true);
      setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 300);
      showPage(1);
      PS.msg(els.message, 'PDF loaded. Pick a position and style, then add the numbers.', 'success');
      els.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      PS.progress(els.progress, els.progressBar, 0, false);
      PS.msg(els.message, err.message || 'Could not open that PDF.', 'error');
    });
  }

  Array.prototype.forEach.call(root.querySelectorAll('[data-pos]'), function (btn) {
    btn.addEventListener('click', function () {
      position = btn.dataset.pos;
      Array.prototype.forEach.call(root.querySelectorAll('[data-pos]'), function (other) {
        other.classList.toggle('is-active', other === btn);
        other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
      });
      paintOverlay();
    });
  });

  ['format', 'custom', 'start', 'range', 'font', 'size', 'color', 'opacity', 'marginX', 'marginY', 'mirror'].forEach(function (key) {
    var el = els[key];
    if (!el) return;
    var event = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color') ? 'change' : 'input';
    el.addEventListener(event, function () {
      if (key === 'format') els.customWrap.hidden = els.format.value !== 'custom';
      if (key === 'size') els.sizeVal.textContent = els.size.value + ' pt';
      if (key === 'opacity') els.opacityVal.textContent = els.opacity.value + '%';
      paintOverlay();
    });
    if (event === 'input') el.addEventListener('change', paintOverlay);
  });

  if (els.prev) els.prev.addEventListener('click', function () { showPage(current - 1); });
  if (els.next) els.next.addEventListener('click', function () { showPage(current + 1); });

  /* --------------------------------------------------------------- apply */
  if (els.applyBtn) {
    els.applyBtn.addEventListener('click', function () {
      if (!doc) return;
      var info = plan();
      if (!info.list.length) {
        PS.msg(els.message, 'No pages match that range — check the "Pages to number" box.', 'warn');
        return;
      }
      els.applyBtn.disabled = true;
      PS.progress(els.progress, els.progressBar, 20, true);

      var PDFLib = window.PDFLib;
      var fontKey = STANDARD_FONTS[els.font.value] || STANDARD_FONTS.helvetica;
      var size = parseFloat(els.size.value) || 11;
      var mx = PS.mmToPt(parseFloat(els.marginX.value) || 0);
      var my = PS.mmToPt(parseFloat(els.marginY.value) || 0);
      var rgbColor = PS.hexToRgb(els.color.value);
      var opacity = Math.max(0.05, Math.min(1, (parseFloat(els.opacity.value) || 100) / 100));

      PDFLib.PDFDocument.load(doc.bytes, { ignoreEncryption: true }).then(function (pdf) {
        /* The values of PDFLib.StandardFonts are exactly these names
           ("Helvetica-Bold", "Times-Roman", ...), so they can be passed
           straight through. */
        return pdf.embedFont(fontKey.pdf).then(function (font) {
          var pages = pdf.getPages();
          var ascent = font.heightAtSize(size, { descender: false });
          var descent = Math.max(0, font.heightAtSize(size) - ascent);

          pages.forEach(function (page, i) {
            var pageNumber = i + 1;
            var n = info.pages[pageNumber];
            if (!n) return;

            var text = label(n, info.total);
            var box = page.getCropBox();
            var rot = PS.normalizeRotation(page.getRotation().angle);
            var vis = PS.visualSize(box.width, box.height, rot);
            var place = effectivePosition(pageNumber);
            var textWidth = font.widthOfTextAtSize(text, size);

            var vx;
            if (place.indexOf('left') > -1) vx = mx;
            else if (place.indexOf('right') > -1) vx = vis.width - mx - textWidth;
            else vx = (vis.width - textWidth) / 2;

            var vy = place.indexOf('top') === 0 ? vis.height - my - ascent : my + descent;
            var point = PS.visualToUser(vx, vy, box, rot);

            page.drawText(text, {
              x: point.x,
              y: point.y,
              size: size,
              font: font,
              color: PDFLib.rgb(rgbColor.r, rgbColor.g, rgbColor.b),
              opacity: opacity,
              rotate: PS.drawAngle(rot)
            });
          });

          PS.progress(els.progress, els.progressBar, 80, true);
          return pdf.save();
        });
      }).then(function (bytes) {
        els.download.href = PS.toBlobUrl(bytes);
        els.download.download = PS.baseName(doc.name) + '-numbered.pdf';
        els.download.classList.remove('hidden');
        els.download.click();
        PS.progress(els.progress, els.progressBar, 100, true);
        setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 400);
        PS.msg(els.message, 'Done! ' + info.list.length + ' page' + (info.list.length === 1 ? '' : 's') + ' numbered and downloaded.', 'success');
      }).catch(function () {
        PS.progress(els.progress, els.progressBar, 0, false);
        PS.msg(els.message, 'Could not add page numbers to this PDF. Please try again.', 'error');
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
      els.dropZone.classList.remove('is-compact');
      els.download.classList.add('hidden');
      els.overlay.hidden = true;
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
  if (els.sizeVal) els.sizeVal.textContent = els.size.value + ' pt';
  if (els.opacityVal) els.opacityVal.textContent = els.opacity.value + '%';
}());
