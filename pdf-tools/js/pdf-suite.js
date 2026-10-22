/* Shared plumbing for the four tools in /pdf-tools/.
   Loading, validating and previewing a PDF is identical on all four pages,
   and the coordinate maths for a rotated page is the kind of thing that is
   worth writing once: page numbers, crop boxes and signature stamps all have
   to convert a position the visitor picked on screen into PDF user space.
   Everything hangs off window.PdfSuite; each tool script owns its own UI. */
(function (global) {
  'use strict';

  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var MAX_SIZE = 100 * 1024 * 1024;
  var workerReady = false;

  /* pdf.js is loaded with `defer`, so a tool script that runs on DOMContentLoaded
     cannot assume it is there yet. Resolve it lazily instead of at load time. */
  function pdfjs() {
    var lib = global.pdfjsLib || null;
    if (lib && !workerReady && lib.GlobalWorkerOptions) {
      try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; workerReady = true; } catch (e) { /* keep the fake worker */ }
    }
    return lib;
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function isPdf(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
  }

  function baseName(name) {
    return String(name || 'document.pdf').replace(/\.pdf$/i, '');
  }

  /* ---------------------------------------------------------------- messages */
  function msg(el, text, tone) {
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone || 'info';
    el.hidden = false;
  }

  function clearMsg(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  function progress(wrap, bar, pct, show) {
    if (!wrap) return;
    wrap.hidden = !show;
    if (bar) bar.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
  }

  /* ------------------------------------------------------------- file input */
  /* Wires the drop zone, the hidden <input type=file> and every [data-file-picker]
     button inside `root` to one handler. `multiple` lets the organizer take a
     whole batch in a single drop. */
  function bindDrop(root, onFiles, options) {
    var opts = options || {};
    var zone = root.querySelector(opts.zone || '[data-drop-zone]');
    var input = root.querySelector(opts.input || '[data-file-input]');
    var pickers = Array.prototype.slice.call(root.querySelectorAll(opts.picker || '[data-file-picker]'));
    if (!zone || !input) return;

    var open = function () { input.click(); };

    pickers.forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); open(); });
    });
    zone.addEventListener('click', function (e) { if (!e.target.closest('button')) open(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      zone.addEventListener(t, function () { zone.classList.remove('is-drag'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) onFiles(Array.prototype.slice.call(files));
    });
    input.addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      if (files.length) onFiles(files);
      e.target.value = '';
    });
  }

  /* --------------------------------------------------------------- opening */
  /* Returns { bytes, pdfjsDoc, pageCount, name, size }. Throws an Error whose
     message is already written for a human, so callers can pipe it straight
     into the status line. The pdf.js copy gets its own slice of the buffer:
     pdf.js transfers (and detaches) the ArrayBuffer it is handed, which would
     leave pdf-lib with nothing to save later. */
  function openPdf(file) {
    if (!isPdf(file)) throw new Error('Please choose a valid PDF (.pdf) file.');
    if (file.size > MAX_SIZE) throw new Error('That file is over 100 MB. Please use a smaller PDF.');

    return file.arrayBuffer().then(function (bytes) {
      var count = 0;
      return global.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) {
          throw new Error('This PDF is password-protected. Remove the password first with the PDF Password Remover.');
        }
        count = doc.getPageCount();
        if (!count) throw new Error('This PDF has no pages.');
        var lib = pdfjs();
        if (!lib) return null;
        return lib.getDocument({ data: bytes.slice(0) }).promise.catch(function () { return null; });
      }, function () {
        throw new Error('This PDF could not be opened. It may be corrupted or protected.');
      }).then(function (pdfjsDoc) {
        return { bytes: bytes, pdfjsDoc: pdfjsDoc, pageCount: count, name: file.name || 'document.pdf', size: file.size };
      });
    });
  }

  /* ------------------------------------------------------------- rendering */
  /* Renders one page into a fresh canvas whose longest side is `maxSide` CSS
     pixels, at device pixel ratio so it stays sharp on a phone. The returned
     canvas carries .cssWidth / .cssHeight / .scale for hit-testing overlays. */
  function renderPage(pdfjsDoc, pageNumber, maxSide) {
    if (!pdfjsDoc) return Promise.resolve(null);
    return pdfjsDoc.getPage(pageNumber).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = maxSide / Math.max(base.width, base.height);
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var vp = page.getViewport({ scale: scale * dpr });
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      canvas.style.width = (vp.width / dpr) + 'px';
      canvas.style.height = (vp.height / dpr) + 'px';
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
        canvas.cssWidth = vp.width / dpr;
        canvas.cssHeight = vp.height / dpr;
        canvas.renderScale = scale;
        return canvas;
      });
    });
  }

  /* ----------------------------------------------------- rotation geometry */
  /* A page carries a /Rotate flag that viewers apply at display time, so what
     the visitor sees is not the coordinate system pdf-lib draws into. These
     helpers translate between the two.

     "Visual" space = what you see on screen: origin bottom-left, x right,
     y up, already rotated. "User" space = what pdf-lib writes into. */

  function normalizeRotation(deg) {
    return ((Math.round((deg || 0) / 90) * 90) % 360 + 360) % 360;
  }

  /* Visible page size once /Rotate is applied. w/h are the CropBox size. */
  function visualSize(w, h, rot) {
    return normalizeRotation(rot) % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
  }

  /* Map a point given in visual space onto PDF user space. `box` is the page
     CropBox ({ x, y, width, height }) so pages whose box does not start at the
     origin still land in the right place. */
  function visualToUser(vx, vy, box, rot) {
    var w = box.width;
    var h = box.height;
    var r = normalizeRotation(rot);
    var x;
    var y;
    if (r === 90) { x = w - vy; y = vx; }
    else if (r === 180) { x = w - vx; y = h - vy; }
    else if (r === 270) { x = vy; y = h - vx; }
    else { x = vx; y = vy; }
    return { x: x + (box.x || 0), y: y + (box.y || 0) };
  }

  /* Same idea for a rectangle: map both corners, then normalise. Because every
     rotation here is a multiple of 90 the result is still axis-aligned. */
  function rectVisualToUser(rect, box, rot) {
    var a = visualToUser(rect.x, rect.y, box, rot);
    var b = visualToUser(rect.x + rect.width, rect.y + rect.height, box, rot);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y)
    };
  }

  /* pdf-lib rotates text and images counter-clockwise; viewers rotate the page
     clockwise. Drawing at the page's own /Rotate angle cancels the two out, so
     content added to a rotated page still reads upright. */
  function drawAngle(rot) {
    return global.PDFLib.degrees(normalizeRotation(rot));
  }

  /* --------------------------------------------------------------- output */
  var lastUrl = null;

  function toBlobUrl(bytes) {
    if (lastUrl) { try { URL.revokeObjectURL(lastUrl); } catch (e) { /* already gone */ } }
    lastUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    return lastUrl;
  }

  /* Points <-> millimetres, for the crop and page-number margin inputs. */
  function mmToPt(mm) { return mm * 72 / 25.4; }
  function ptToMm(pt) { return pt * 25.4 / 72; }

  function hexToRgb(hex) {
    var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || '').trim());
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
  }

  /* "1-3, 7, 10-" -> [1,2,3,7,10,...,total]. Empty string means every page. */
  function parseRange(text, total) {
    var raw = String(text || '').trim();
    if (!raw) return Array.from({ length: total }, function (_, i) { return i + 1; });
    var out = [];
    raw.split(/[,\s]+/).forEach(function (part) {
      if (!part) return;
      var m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part);
      if (m) {
        var from = m[1] ? parseInt(m[1], 10) : 1;
        var to = m[2] ? parseInt(m[2], 10) : total;
        if (from > to) { var t = from; from = to; to = t; }
        for (var i = Math.max(1, from); i <= Math.min(total, to); i += 1) out.push(i);
        return;
      }
      var n = parseInt(part, 10);
      if (n >= 1 && n <= total) out.push(n);
    });
    return out.filter(function (n, i, arr) { return arr.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
  }

  global.PdfSuite = {
    MAX_SIZE: MAX_SIZE,
    pdfjs: pdfjs,
    fmtSize: fmtSize,
    isPdf: isPdf,
    baseName: baseName,
    msg: msg,
    clearMsg: clearMsg,
    progress: progress,
    bindDrop: bindDrop,
    openPdf: openPdf,
    renderPage: renderPage,
    normalizeRotation: normalizeRotation,
    visualSize: visualSize,
    visualToUser: visualToUser,
    rectVisualToUser: rectVisualToUser,
    drawAngle: drawAngle,
    toBlobUrl: toBlobUrl,
    mmToPt: mmToPt,
    ptToMm: ptToMm,
    hexToRgb: hexToRgb,
    parseRange: parseRange
  };
}(window));
