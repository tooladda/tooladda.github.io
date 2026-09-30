/* Sign PDF — draw, type or upload a signature and place it on the page.
   Every stamp ends up as a transparent PNG, whichever tab produced it, so
   placing and exporting is one code path. Positions are kept in points in the
   page's *visual* space (what you see, rotation already applied) and mapped
   back into PDF user space only at export time. */
(function () {
  'use strict';

  var PS = window.PdfSuite;
  var root = document.querySelector('[data-sign]');
  if (!root || !PS) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var els = {
    dropZone: $('[data-drop-zone]'),
    editor: $('[data-editor]'),
    stage: $('[data-stage]'),
    stageInner: $('[data-stage-inner]'),
    layer: $('[data-layer]'),
    prev: $('[data-prev]'),
    next: $('[data-next]'),
    pageNum: $('[data-page-num]'),
    fileName: $('[data-file-name]'),
    pageCount: $('[data-page-count]'),
    fileSize: $('[data-file-size]'),
    message: $('[data-message]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    pad: $('[data-pad]'),
    penSize: $('[data-pen-size]'),
    penColor: $('[data-pen-color]'),
    clearPad: $('[data-clear-pad]'),
    typeText: $('[data-type-text]'),
    typeFont: $('[data-type-font]'),
    typeColor: $('[data-type-color]'),
    sigInput: $('[data-sig-input]'),
    removeBg: $('[data-remove-bg]'),
    uploadPreview: $('[data-upload-preview]'),
    addStamp: $('[data-add-stamp]'),
    addDate: $('[data-add-date]'),
    stamps: $('[data-stamps]'),
    placedNote: $('[data-placed-note]'),
    rotWrap: $('[data-rot-wrap]'),
    rotRange: $('[data-rot-range]'),
    rotNumber: $('[data-rot-number]'),
    rotReset: $('[data-rot-reset]'),
    applyBtn: $('[data-apply]'),
    download: $('[data-download-link]'),
    startOver: $('[data-start-over]')
  };

  var FONTS = {
    'script-1': { css: "'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', cursive", italic: false },
    'script-2': { css: "'Ink Free', 'Bradley Hand', 'Segoe Print', cursive", italic: false },
    'serif': { css: "Georgia, 'Times New Roman', serif", italic: true },
    'sans': { css: "'Segoe UI', Arial, Helvetica, sans-serif", italic: false }
  };

  var doc = null;
  var current = 1;
  var canvas = null;          // page preview canvas
  var renderToken = 0;
  var visualW = 0;
  var visualH = 0;
  var items = [];             // { id, page, url, ratio, x, y, w, h, rot }  (points, top-left origin; rot is clockwise degrees)
  var activeId = null;        // the placement the rotation field edits
  var stamps = [];            // reusable signatures: { id, url, ratio }
  var activeTab = 'draw';
  var idSeq = 0;
  var uploaded = null;        // { url, ratio } from the upload tab

  /* ------------------------------------------------------------- drawing */
  var pad = els.pad;
  var padCtx = pad ? pad.getContext('2d') : null;
  var drawing = false;
  var lastPoint = null;
  var padDirty = false;

  function sizePad() {
    if (!pad) return;
    var rect = pad.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var width = Math.max(200, rect.width);
    var height = Math.max(120, rect.height);
    if (pad.width === Math.round(width * dpr) && pad.height === Math.round(height * dpr)) return;
    var previous = padDirty ? pad.toDataURL('image/png') : null;
    pad.width = Math.round(width * dpr);
    pad.height = Math.round(height * dpr);
    padCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    padCtx.lineCap = 'round';
    padCtx.lineJoin = 'round';
    if (previous) {
      var img = new Image();
      img.onload = function () { padCtx.drawImage(img, 0, 0, width, height); };
      img.src = previous;
    }
  }

  function padPoint(e) {
    var rect = pad.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  if (pad) {
    pad.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      drawing = true;
      padDirty = true;
      lastPoint = padPoint(e);
      padCtx.strokeStyle = els.penColor.value;
      padCtx.lineWidth = parseFloat(els.penSize.value) || 3;
      padCtx.beginPath();
      padCtx.moveTo(lastPoint.x, lastPoint.y);
      padCtx.lineTo(lastPoint.x + 0.1, lastPoint.y + 0.1);
      padCtx.stroke();
    });
    pad.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      e.preventDefault();
      var point = padPoint(e);
      /* Quadratic smoothing through the midpoint keeps a fast stroke from
         looking like a series of straight segments. */
      var mid = { x: (lastPoint.x + point.x) / 2, y: (lastPoint.y + point.y) / 2 };
      padCtx.strokeStyle = els.penColor.value;
      padCtx.lineWidth = parseFloat(els.penSize.value) || 3;
      padCtx.beginPath();
      padCtx.moveTo(lastPoint.x, lastPoint.y);
      padCtx.quadraticCurveTo(lastPoint.x, lastPoint.y, mid.x, mid.y);
      padCtx.stroke();
      lastPoint = point;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      pad.addEventListener(type, function () { drawing = false; });
    });
  }

  if (els.clearPad) {
    els.clearPad.addEventListener('click', function () {
      if (!padCtx) return;
      padCtx.save();
      padCtx.setTransform(1, 0, 0, 1, 0, 0);
      padCtx.clearRect(0, 0, pad.width, pad.height);
      padCtx.restore();
      padDirty = false;
    });
  }

  /* Crops a canvas down to the ink and returns a data URL, so a small
     signature drawn in the corner of the pad does not arrive as a mostly
     empty rectangle. */
  function trimToDataUrl(source, padPx) {
    var w = source.width;
    var h = source.height;
    var ctx = source.getContext('2d');
    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }

    var minX = w;
    var minY = h;
    var maxX = -1;
    var maxY = -1;
    for (var y = 0; y < h; y += 1) {
      for (var x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] < 12) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;

    var gap = padPx || 6;
    minX = Math.max(0, minX - gap);
    minY = Math.max(0, minY - gap);
    maxX = Math.min(w - 1, maxX + gap);
    maxY = Math.min(h - 1, maxY + gap);

    var out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(source, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return { url: out.toDataURL('image/png'), ratio: out.width / out.height };
  }

  /* ---------------------------------------------------------- typed text */
  function renderTyped(text, fontKey, color) {
    var font = FONTS[fontKey] || FONTS['script-1'];
    var size = 140;
    var measure = document.createElement('canvas').getContext('2d');
    var spec = (font.italic ? 'italic ' : '') + size + 'px ' + font.css;
    measure.font = spec;
    var width = Math.ceil(measure.measureText(text).width) + 60;
    var out = document.createElement('canvas');
    out.width = Math.max(80, width);
    out.height = Math.round(size * 1.8);
    var ctx = out.getContext('2d');
    ctx.font = spec;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, out.width / 2, out.height / 2);
    return trimToDataUrl(out, 8);
  }

  /* ------------------------------------------------------------- uploads */
  function loadSignatureImage(file) {
    if (!file || !/^image\//.test(file.type)) {
      PS.msg(els.message, 'Please choose an image file (PNG or JPG) of your signature.', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var out = document.createElement('canvas');
        var scale = Math.min(1, 1400 / Math.max(img.width, img.height));
        out.width = Math.max(1, Math.round(img.width * scale));
        out.height = Math.max(1, Math.round(img.height * scale));
        var ctx = out.getContext('2d');
        ctx.drawImage(img, 0, 0, out.width, out.height);

        if (els.removeBg.checked) {
          /* A photographed or scanned signature comes on white paper. Pixels
             close to white become transparent, and the darker the pixel the
             more opaque it stays, which keeps the stroke edges soft instead of
             jagged. */
          var image = ctx.getImageData(0, 0, out.width, out.height);
          var d = image.data;
          for (var i = 0; i < d.length; i += 4) {
            var lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
            if (lum > 235) { d[i + 3] = 0; }
            else if (lum > 160) { d[i + 3] = Math.round(d[i + 3] * (235 - lum) / 75); }
          }
          ctx.putImageData(image, 0, 0);
        }

        var trimmed = els.removeBg.checked ? trimToDataUrl(out, 4) : { url: out.toDataURL('image/png'), ratio: out.width / out.height };
        if (!trimmed) { PS.msg(els.message, 'That image looks empty after background removal — try unticking it.', 'warn'); return; }
        uploaded = trimmed;
        els.uploadPreview.innerHTML = '<img src="' + trimmed.url + '" alt="Signature preview" />';
        els.uploadPreview.hidden = false;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  if (els.sigInput) {
    els.sigInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadSignatureImage(e.target.files[0]);
      e.target.value = '';
    });
  }
  Array.prototype.forEach.call(root.querySelectorAll('[data-sig-picker]'), function (btn) {
    btn.addEventListener('click', function () { els.sigInput.click(); });
  });
  if (els.removeBg) {
    els.removeBg.addEventListener('change', function () {
      if (uploaded) PS.msg(els.message, 'Choose the image again to apply the new background setting.', 'info');
    });
  }

  /* ---------------------------------------------------------------- tabs */
  Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (btn) {
    btn.addEventListener('click', function () {
      activeTab = btn.dataset.tab;
      Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (other) {
        other.classList.toggle('is-active', other === btn);
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-panel]'), function (panel) {
        panel.hidden = panel.dataset.panel !== activeTab;
      });
      if (activeTab === 'draw') sizePad();
    });
  });

  /* -------------------------------------------------------------- stamps */
  function currentStamp() {
    if (activeTab === 'draw') {
      if (!padDirty) return null;
      return trimToDataUrl(pad, 10);
    }
    if (activeTab === 'type') {
      var text = String(els.typeText.value || '').trim();
      if (!text) return null;
      return renderTyped(text, els.typeFont.value, els.typeColor.value);
    }
    return uploaded;
  }

  function addStamp(stamp) {
    stamp.id = 's' + (idSeq += 1);
    stamps.push(stamp);
    renderStamps();
    place(stamp);
  }

  function renderStamps() {
    if (!els.stamps) return;
    els.stamps.innerHTML = '';
    stamps.forEach(function (stamp) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sig-stamp';
      btn.title = 'Place this signature on the current page';
      btn.innerHTML = '<img src="' + stamp.url + '" alt="Saved signature" />';
      btn.addEventListener('click', function () { place(stamp); });
      els.stamps.appendChild(btn);
    });
    els.stamps.hidden = !stamps.length;
  }

  /* ------------------------------------------------------------ placing */
  function place(stamp) {
    if (!doc) { PS.msg(els.message, 'Load a PDF first, then add your signature.', 'warn'); return; }
    if (!visualW || !visualH) { PS.msg(els.message, 'The page is still loading — try again in a moment.', 'warn'); return; }
    var width = Math.min(180, visualW * 0.4);
    var item = {
      id: 'i' + (idSeq += 1),
      page: current,
      url: stamp.url,
      ratio: stamp.ratio,
      w: width,
      h: width / stamp.ratio,
      rot: 0
    };
    item.x = (visualW - item.w) / 2;
    item.y = visualH - item.h - PS.mmToPt(30);
    if (item.y < 0) item.y = Math.max(0, visualH - item.h);
    items.push(item);
    activeId = item.id;
    renderItems();
    PS.msg(els.message, 'Signature placed. Drag it into position, the corner resizes it, and the top handle rotates it to any angle.', 'success');
  }

  function ptPerPx() {
    if (!canvas) return 1;
    var rect = canvas.getBoundingClientRect();
    return rect.width ? visualW / rect.width : 1;
  }

  function renderItems() {
    if (!els.layer) return;
    els.layer.innerHTML = '';
    var perPx = ptPerPx();
    items.filter(function (item) { return item.page === current; }).forEach(function (item) {
      var node = document.createElement('div');
      node.className = 'sig-item' + (item.id === activeId ? ' is-active' : '');
      node.dataset.id = item.id;
      layout(node, item, perPx);
      node.innerHTML =
        '<img src="' + item.url + '" alt="Placed signature" draggable="false" />' +
        '<button type="button" class="sig-del" data-del title="Remove">✕</button>' +
        '<button type="button" class="sig-all" data-all title="Copy to every page">⧉</button>' +
        '<span class="sig-rotate" data-rotate title="Rotate to any angle"></span>' +
        '<span class="sig-angle" data-angle hidden></span>' +
        '<span class="sig-resize" data-resize title="Resize"></span>';

      node.addEventListener('pointerdown', function (e) {
        if (e.target.dataset.del !== undefined || e.target.dataset.all !== undefined) return;
        activeId = item.id;
        Array.prototype.forEach.call(els.layer.children, function (other) {
          other.classList.toggle('is-active', other === node);
        });
        syncRotationPanel();
        var mode = e.target.dataset.resize !== undefined ? 'resize'
          : e.target.dataset.rotate !== undefined ? 'rotate' : 'move';
        startDrag(e, item, node, mode);
      });
      node.querySelector('[data-del]').addEventListener('click', function () {
        items = items.filter(function (other) { return other !== item; });
        if (activeId === item.id) activeId = items.length ? items[items.length - 1].id : null;
        renderItems();
      });
      node.querySelector('[data-all]').addEventListener('click', function () {
        for (var p = 1; p <= doc.pageCount; p += 1) {
          if (p === item.page) continue;
          items.push({ id: 'i' + (idSeq += 1), page: p, url: item.url, ratio: item.ratio,
            x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot });
        }
        renderItems();
        PS.msg(els.message, 'Copied to all ' + doc.pageCount + ' pages at the same spot.', 'info');
      });

      els.layer.appendChild(node);
    });
    syncPlacedNote();
    syncRotationPanel();
  }

  /* One place that writes a placement's geometry onto its node, so the drag
     handlers and the initial render can never drift apart. */
  function layout(node, item, perPx) {
    node.style.left = (item.x / perPx) + 'px';
    node.style.top = (item.y / perPx) + 'px';
    node.style.width = (item.w / perPx) + 'px';
    node.style.height = (item.h / perPx) + 'px';
    node.style.transform = item.rot ? 'rotate(' + item.rot + 'deg)' : '';
  }

  function activeItem() {
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === activeId) return items[i];
    }
    return null;
  }

  function syncRotationPanel() {
    if (!els.rotWrap) return;
    var item = activeItem();
    var usable = !!item && item.page === current;
    els.rotWrap.hidden = !usable;
    if (!usable) return;
    els.rotRange.value = Math.round(item.rot);
    els.rotNumber.value = Math.round(item.rot);
  }

  /* Degrees the visitor typed or dragged, normalised to 0-359. */
  function setRotation(item, degrees, node) {
    var value = ((Math.round(degrees * 10) / 10) % 360 + 360) % 360;
    item.rot = value;
    if (node) node.style.transform = value ? 'rotate(' + value + 'deg)' : '';
    if (els.rotRange) els.rotRange.value = Math.round(value);
    if (els.rotNumber) els.rotNumber.value = Math.round(value);
  }

  var drag = null;

  function startDrag(e, item, node, mode) {
    e.preventDefault();
    var perPx = ptPerPx();
    var box = node.getBoundingClientRect();
    drag = {
      item: item,
      node: node,
      mode: mode,
      x: e.clientX,
      y: e.clientY,
      perPx: perPx,
      /* getBoundingClientRect gives the axis-aligned box of a rotated node,
         but its centre is still the point the node rotates about. */
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      startAngle: item.rot,
      grabAngle: Math.atan2(e.clientY - (box.top + box.height / 2),
                            e.clientX - (box.left + box.width / 2)) * 180 / Math.PI,
      start: { x: item.x, y: item.y, w: item.w, h: item.h }
    };
    if (mode === 'rotate') {
      var badge = node.querySelector('[data-angle]');
      if (badge) { badge.hidden = false; badge.textContent = Math.round(item.rot) + '°'; }
    }
    if (node.setPointerCapture) node.setPointerCapture(e.pointerId);
  }

  root.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = (e.clientX - drag.x) * drag.perPx;
    var dy = (e.clientY - drag.y) * drag.perPx;
    var item = drag.item;

    if (drag.mode === 'rotate') {
      var pointer = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180 / Math.PI;
      var angle = drag.startAngle + (pointer - drag.grabAngle);
      /* Shift steps in 15°; otherwise the angle sticks lightly to the
         quarter turns, which is where most signatures actually want to be. */
      if (e.shiftKey) {
        angle = Math.round(angle / 15) * 15;
      } else {
        var quarter = Math.round(angle / 90) * 90;
        if (Math.abs(angle - quarter) < 2.5) angle = quarter;
      }
      setRotation(item, angle, drag.node);
      var badge = drag.node.querySelector('[data-angle]');
      if (badge) {
        badge.textContent = Math.round(item.rot) + '°';
        // the badge rides on the rotating node, so spin it back upright
        badge.style.transform = 'translateX(-50%) rotate(' + (-item.rot) + 'deg)';
      }
      return;
    }

    if (drag.mode === 'resize') {
      /* The corner handle travels along the item's own x axis, which is
         turned by its rotation — project the screen delta onto it, or a
         rotated signature would grow in the wrong direction. */
      var theta = item.rot * Math.PI / 180;
      var along = dx * Math.cos(theta) + dy * Math.sin(theta);
      var width = Math.max(24, drag.start.w + along);
      width = Math.min(width, visualW);
      item.w = width;
      item.h = width / item.ratio;
    } else {
      item.x = Math.min(Math.max(0, drag.start.x + dx), Math.max(0, visualW - item.w));
      item.y = Math.min(Math.max(0, drag.start.y + dy), Math.max(0, visualH - item.h));
    }

    layout(drag.node, item, drag.perPx);
  });

  ['pointerup', 'pointercancel'].forEach(function (type) {
    root.addEventListener(type, function () {
      if (drag) {
        var badge = drag.node.querySelector('[data-angle]');
        if (badge) badge.hidden = true;
      }
      drag = null;
    });
  });

  /* The panel field is the precise way in: type 37, or drag the slider. */
  function bindRotationField(el, event) {
    if (!el) return;
    el.addEventListener(event, function () {
      var item = activeItem();
      if (!item) return;
      var value = parseFloat(el.value);
      if (!Number.isFinite(value)) return;
      var node = els.layer.querySelector('[data-id="' + item.id + '"]');
      setRotation(item, value, node);
    });
  }
  bindRotationField(els.rotRange, 'input');
  bindRotationField(els.rotNumber, 'input');
  bindRotationField(els.rotNumber, 'change');

  if (els.rotReset) {
    els.rotReset.addEventListener('click', function () {
      var item = activeItem();
      if (!item) return;
      setRotation(item, 0, els.layer.querySelector('[data-id="' + item.id + '"]'));
    });
  }

  function syncPlacedNote() {
    if (!els.placedNote) return;
    var onPage = items.filter(function (item) { return item.page === current; }).length;
    els.placedNote.textContent = items.length
      ? items.length + ' signature' + (items.length === 1 ? '' : 's') + ' placed in this document (' + onPage + ' on this page).'
      : 'Nothing placed yet — create a signature on the right, then drag it into position.';
    if (els.applyBtn) els.applyBtn.disabled = !items.length;
  }

  if (els.addStamp) {
    els.addStamp.addEventListener('click', function () {
      var stamp = currentStamp();
      if (!stamp) {
        PS.msg(els.message, activeTab === 'draw' ? 'Draw your signature in the box first.'
          : activeTab === 'type' ? 'Type your name first.'
            : 'Choose a signature image first.', 'warn');
        return;
      }
      addStamp(stamp);
    });
  }

  if (els.addDate) {
    els.addDate.addEventListener('click', function () {
      var today = new Date();
      var text = String(today.getDate()).padStart(2, '0') + '/' +
        String(today.getMonth() + 1).padStart(2, '0') + '/' + today.getFullYear();
      var stamp = renderTyped(text, 'sans', '#111827');
      if (stamp) addStamp(stamp);
    });
  }

  /* -------------------------------------------------------------- preview */
  function previewSide() {
    var room = els.stage ? els.stage.clientWidth - 34 : 620;
    return Math.max(220, Math.min(620, room));
  }

  function showPage(n) {
    if (!doc || !doc.pdfjsDoc) return;
    current = Math.max(1, Math.min(doc.pageCount, n));
    els.pageNum.textContent = 'Page ' + current + ' of ' + doc.pageCount;
    els.prev.disabled = current <= 1;
    els.next.disabled = current >= doc.pageCount;

    var token = (renderToken += 1);
    PS.renderPage(doc.pdfjsDoc, current, previewSide()).then(function (result) {
      if (token !== renderToken || !result) return;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = result;
      visualW = result.cssWidth / result.renderScale;
      visualH = result.cssHeight / result.renderScale;
      els.stageInner.insertBefore(canvas, els.layer);
      els.layer.style.width = result.cssWidth + 'px';
      els.layer.style.height = result.cssHeight + 'px';
      renderItems();
    }).catch(function () { /* preview only */ });
  }

  function handleFiles(files) {
    PS.clearMsg(els.message);
    PS.progress(els.progress, els.progressBar, 12, true);
    PS.openPdf(files[0]).then(function (opened) {
      doc = opened;
      items = [];
      els.fileName.textContent = doc.name;
      els.pageCount.textContent = doc.pageCount + (doc.pageCount === 1 ? ' page' : ' pages');
      els.fileSize.textContent = PS.fmtSize(doc.size);
      els.editor.hidden = false;
      els.dropZone.classList.add('is-compact');
      els.download.classList.add('hidden');
      PS.progress(els.progress, els.progressBar, 100, true);
      setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 300);
      showPage(1);
      sizePad();
      PS.msg(els.message, 'PDF loaded. Draw, type or upload your signature, then place it on the page.', 'success');
      els.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      PS.progress(els.progress, els.progressBar, 0, false);
      PS.msg(els.message, err.message || 'Could not open that PDF.', 'error');
    });
  }

  if (els.prev) els.prev.addEventListener('click', function () { showPage(current - 1); });
  if (els.next) els.next.addEventListener('click', function () { showPage(current + 1); });

  /* --------------------------------------------------------------- export */
  if (els.applyBtn) {
    els.applyBtn.addEventListener('click', function () {
      if (!doc || !items.length) return;
      els.applyBtn.disabled = true;
      PS.progress(els.progress, els.progressBar, 20, true);

      window.PDFLib.PDFDocument.load(doc.bytes, { ignoreEncryption: true }).then(function (pdf) {
        var pages = pdf.getPages();
        var cache = {};
        var urls = items.map(function (item) { return item.url; })
          .filter(function (url, i, arr) { return arr.indexOf(url) === i; });

        /* Each distinct signature image is embedded once and reused by every
           placement, so stamping 40 pages does not bloat the file. */
        return urls.reduce(function (chain, url) {
          return chain.then(function () {
            return pdf.embedPng(url).then(function (png) { cache[url] = png; });
          });
        }, Promise.resolve()).then(function () {
          items.forEach(function (item) {
            var page = pages[item.page - 1];
            var png = cache[item.url];
            if (!page || !png) return;
            var box = page.getCropBox();
            var rot = PS.normalizeRotation(page.getRotation().angle);
            var vis = PS.visualSize(box.width, box.height, rot);
            /* pdf-lib rotates an image about the anchor it is drawn at, but
               the preview rotates it about its centre. Walk back from the
               centre along the rotated half-diagonal to find the anchor that
               puts the centre where the visitor left it. Screen rotation is
               clockwise, PDF rotation is counter-clockwise, hence the sign. */
            var spin = ((item.rot || 0) % 360 + 360) % 360;
            var theta = spin * Math.PI / 180;
            var cxv = item.x + item.w / 2;
            var cyv = vis.height - item.y - item.h / 2;
            var hx = item.w / 2;
            var hy = item.h / 2;
            var anchorX = cxv - (hx * Math.cos(theta) + hy * Math.sin(theta));
            var anchorY = cyv - (-hx * Math.sin(theta) + hy * Math.cos(theta));
            var point = PS.visualToUser(anchorX, anchorY, box, rot);
            page.drawImage(png, {
              x: point.x,
              y: point.y,
              width: item.w,
              height: item.h,
              rotate: window.PDFLib.degrees(((rot - spin) % 360 + 360) % 360)
            });
          });
          PS.progress(els.progress, els.progressBar, 85, true);
          return pdf.save();
        });
      }).then(function (bytes) {
        els.download.href = PS.toBlobUrl(bytes);
        els.download.download = PS.baseName(doc.name) + '-signed.pdf';
        els.download.classList.remove('hidden');
        els.download.click();
        PS.progress(els.progress, els.progressBar, 100, true);
        setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 400);
        PS.msg(els.message, 'Done! Your signed PDF downloaded.', 'success');
      }).catch(function () {
        PS.progress(els.progress, els.progressBar, 0, false);
        PS.msg(els.message, 'Could not sign this PDF. Please try again.', 'error');
      }).then(function () {
        els.applyBtn.disabled = false;
      });
    });
  }

  if (els.startOver) {
    els.startOver.addEventListener('click', function () {
      doc = null;
      items = [];
      activeId = null;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null;
      els.layer.innerHTML = '';
      els.editor.hidden = true;
      els.dropZone.classList.remove('is-compact');
      els.download.classList.add('hidden');
      PS.clearMsg(els.message);
      PS.progress(els.progress, els.progressBar, 0, false);
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    sizePad();
    if (!doc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { showPage(current); }, 200);
  });

  PS.bindDrop(root, handleFiles);
  sizePad();
  syncPlacedNote();
}());
