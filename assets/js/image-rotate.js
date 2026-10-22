(function () {
  'use strict';
  var root = document.querySelector('[data-image-rotate-page]');
  if (!root) return;

  /* ============================================================
     Utilities
     ============================================================ */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function yieldToUI() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function baseName(name) { return name.replace(/\.[a-z0-9]+$/i, ''); }
  function extFor(format) { return format === 'image/jpeg' ? '.jpg' : format === 'image/webp' ? '.webp' : '.png'; }

  /* ============================================================
     Minimal EXIF orientation reader (JPEG only) — best-effort,
     fails safe (returns null) on any parse error or non-JPEG file.
     ============================================================ */
  var EXIF_LABELS = {
    1: 'Normal — no correction needed',
    2: 'Flipped horizontally',
    3: 'Rotated 180°',
    4: 'Flipped vertically',
    5: 'Rotated 90° CW + flipped',
    6: 'Rotated 90° CW',
    7: 'Rotated 270° CW + flipped',
    8: 'Rotated 270° CW'
  };
  function readExifOrientation(arrayBuffer) {
    try {
      var view = new DataView(arrayBuffer);
      if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;
      var offset = 2, length = view.byteLength;
      while (offset + 4 <= length) {
        var marker = view.getUint16(offset, false);
        if ((marker & 0xff00) !== 0xff00) break;
        if (marker === 0xffe1) {
          var segLength = view.getUint16(offset + 2, false);
          if (view.getUint32(offset + 4, false) !== 0x45786966) return null; // "Exif"
          var tiffOffset = offset + 10;
          if (tiffOffset + 8 > length) return null;
          var little = view.getUint16(tiffOffset, false) === 0x4949;
          var firstIFD = view.getUint32(tiffOffset + 4, little);
          var dirStart = tiffOffset + firstIFD;
          if (dirStart + 2 > length) return null;
          var entries = view.getUint16(dirStart, little);
          for (var i = 0; i < entries; i++) {
            var entryOffset = dirStart + 2 + i * 12;
            if (entryOffset + 12 > length) break;
            var tag = view.getUint16(entryOffset, little);
            if (tag === 0x0112) return view.getUint16(entryOffset + 8, little);
          }
          return null;
        } else if (marker === 0xffd8) {
          offset += 2;
        } else {
          offset += 2 + view.getUint16(offset + 2, false);
        }
      }
    } catch (e) { /* malformed file — fail safe */ }
    return null;
  }

  /* ============================================================
     State
     ============================================================ */
  function freshTransform() { return { angleStep: 0, fineAngle: 0, flipH: false, flipV: false }; }
  var state = {
    files: [],       // {file,name,image,naturalW,naturalH,exif,transform,history,future,originalUrl}
    activeFile: 0,
    bgMode: 'transparent', // 'transparent' | 'color'
    bgColor: '#4f46e5',
    cropMode: false,
    cropRatio: 'free',
    cropRect: null,   // {x,y,w,h} in preview-canvas pixel space
    compareOn: false
  };
  function activeEntry() { return state.files[state.activeFile] || null; }

  /* ============================================================
     DOM refs
     ============================================================ */
  var fileInput = $('[data-file-input]', root);
  var filePicker = $('[data-file-picker]', root);
  var dropZone = $('[data-drop-zone]', root);
  var preUpload = $('[data-pre-upload]', root);
  var editorRoot = $('[data-editor-root]', root);
  var messageBox = $('[data-message]', root);
  var stepList = $('[data-step-list]', root);
  var queueRow = $('[data-queue-row]', root);
  var canvasWrap = $('[data-canvas-wrap]', root);
  var loadingNote = $('[data-loading-note]', root);
  var canvasStack = $('[data-canvas-stack]', root);
  var previewCanvas = $('[data-preview-canvas]', root);
  var cropOverlay = $('[data-crop-overlay]', root);
  var compareWrap = $('[data-compare-wrap]', root);
  var compareRange = $('[data-compare-range]', root);
  var hintBar = $('[data-hint-bar]', root);
  var exifBox = $('[data-exif-box]', root);
  var progressWrap = $('[data-progress-wrap]', root);
  var progressFill = $('[data-progress-fill]', root);
  var progressText = $('[data-progress-text]', root);
  var resultPanel = $('[data-result-panel]', root);
  var undoBtn = $('[data-undo-btn]', root);
  var redoBtn = $('[data-redo-btn]', root);

  var previewCtx = previewCanvas.getContext('2d');
  var overlayCtx = cropOverlay.getContext('2d');

  var { clear: clearMessage, show: showMessage } = window.ImageToolKit.createMessageHandlers(messageBox);

  function setStep(n) {
    $all('li', stepList).forEach(function (li) {
      var s = parseInt(li.getAttribute('data-step'), 10);
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
    });
  }

  /* ============================================================
     Core paint routine — shared by live preview and export
     ============================================================ */
  function paintRotated(canvas, image, w, h, transform, fillStyle) {
    var rad = ((transform.angleStep + transform.fineAngle) * Math.PI) / 180;
    var absCos = Math.abs(Math.cos(rad)), absSin = Math.abs(Math.sin(rad));
    var rw = Math.max(1, Math.round(w * absCos + h * absSin));
    var rh = Math.max(1, Math.round(w * absSin + h * absCos));
    canvas.width = rw; canvas.height = rh;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, rw, rh);
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fillRect(0, 0, rw, rh); }
    ctx.save();
    ctx.translate(rw / 2, rh / 2);
    ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
    ctx.rotate(rad);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    ctx.restore();
    return { rw: rw, rh: rh };
  }

  /* ============================================================
     Upload
     ============================================================ */
  window.ImageToolKit.bindFileUpload({
    fileInput: fileInput, filePicker: filePicker, dropZone: dropZone,
    onFile: function (file) { handleFiles([file]); }
  });

  document.addEventListener('paste', function (e) {
    if (editorRoot && !editorRoot.classList.contains('hidden') && document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var file = items[i].getAsFile();
        if (file) { handleFiles([file]); e.preventDefault(); }
        break;
      }
    }
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) handleFiles(Array.prototype.slice.call(fileInput.files));
    fileInput.value = '';
  });

  async function handleFiles(fileList) {
    var files = fileList.filter(function (f) { return f && f.type && f.type.indexOf('image/') === 0; });
    if (!files.length) { showMessage('Please choose valid image file(s).', 'error'); return; }
    showMessage('Loading ' + (files.length > 1 ? files.length + ' images' : 'image') + '…', 'success');

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var bytes = await file.arrayBuffer();
        var loaded = await window.ImageToolKit.loadImageFile(file);
        state.files.push({
          file: file, name: file.name, image: loaded.image,
          naturalW: loaded.image.naturalWidth, naturalH: loaded.image.naturalHeight,
          exif: readExifOrientation(bytes),
          transform: freshTransform(), history: [], future: [], originalUrl: loaded.url
        });
      } catch (err) {
        console.error(err);
        showMessage(file.name + ' could not be loaded — it may not be a valid image.', 'error');
      }
      await yieldToUI();
    }
    if (!state.files.length) return;

    preUpload.classList.add('hidden');
    editorRoot.classList.remove('hidden');
    state.activeFile = state.files.length - 1;
    setStep(2);
    renderQueue();
    openActiveFile();
    clearMessage();
    showMessage('Image' + (state.files.length > 1 ? 's' : '') + ' loaded — rotate, flip, or straighten using the controls.', 'success');
  }

  /* ============================================================
     Batch queue
     ============================================================ */
  var applyToAllBtn = $('[data-apply-to-all]', root);
  function renderQueue() {
    if (state.files.length < 2) { queueRow.classList.add('hidden'); queueRow.innerHTML = ''; applyToAllBtn.classList.add('hidden'); return; }
    queueRow.classList.remove('hidden');
    applyToAllBtn.classList.remove('hidden');
    queueRow.innerHTML = '';
    state.files.forEach(function (entry, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ro-queue-chip' + (idx === state.activeFile ? ' is-active' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', idx === state.activeFile ? 'true' : 'false');
      b.textContent = '🖼️ ' + escapeHtml(entry.name);
      b.addEventListener('click', function () {
        state.activeFile = idx;
        renderQueue();
        openActiveFile();
      });
      queueRow.appendChild(b);
    });
  }

  applyToAllBtn.addEventListener('click', function () {
    var source = activeEntry();
    if (!source || state.files.length < 2) return;
    var copy = Object.assign({}, source.transform);
    state.files.forEach(function (entry) {
      if (entry === source) return;
      entry.history.push(snapshot(entry));
      if (entry.history.length > 40) entry.history.shift();
      entry.future = [];
      entry.transform = Object.assign({}, copy);
    });
    updateUndoRedoButtons();
    showMessage('Rotation applied to all ' + state.files.length + ' images in this batch.', 'success');
  });

  function openActiveFile() {
    var entry = activeEntry();
    if (!entry) return;
    $('[data-file-summary]', root).innerHTML = '<strong>' + escapeHtml(entry.name) + '</strong> · ' + entry.naturalW + '×' + entry.naturalH + 'px' + (state.files.length > 1 ? ' · file ' + (state.activeFile + 1) + ' of ' + state.files.length : '');
    exitCropMode();
    setCompare(false);
    updateAngleUI();
    updateFlipUI();
    updateUndoRedoButtons();
    renderExifBox();
    renderPreview();
  }

  /* ============================================================
     History
     ============================================================ */
  function snapshot(entry) { return { image: entry.image, naturalW: entry.naturalW, naturalH: entry.naturalH, transform: Object.assign({}, entry.transform) }; }
  function applySnapshot(entry, snap) { entry.image = snap.image; entry.naturalW = snap.naturalW; entry.naturalH = snap.naturalH; entry.transform = Object.assign({}, snap.transform); }
  function pushHistory() {
    var entry = activeEntry(); if (!entry) return;
    entry.history.push(snapshot(entry));
    if (entry.history.length > 40) entry.history.shift();
    entry.future = [];
    updateUndoRedoButtons();
  }
  function undo() {
    var entry = activeEntry(); if (!entry || !entry.history.length) return;
    entry.future.push(snapshot(entry));
    applySnapshot(entry, entry.history.pop());
    afterTransformChanged();
  }
  function redo() {
    var entry = activeEntry(); if (!entry || !entry.future.length) return;
    entry.history.push(snapshot(entry));
    applySnapshot(entry, entry.future.pop());
    afterTransformChanged();
  }
  function updateUndoRedoButtons() {
    var entry = activeEntry();
    undoBtn.disabled = !entry || !entry.history.length;
    redoBtn.disabled = !entry || !entry.future.length;
  }
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  document.addEventListener('keydown', function (e) {
    if (!editorRoot || editorRoot.classList.contains('hidden')) return;
    if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });

  function afterTransformChanged() {
    updateAngleUI();
    updateFlipUI();
    updateUndoRedoButtons();
    exitCropMode();
    renderPreview();
  }

  /* ============================================================
     Rotate / flip controls
     ============================================================ */
  function normalizeStep(n) { return ((n % 360) + 360) % 360; }
  $('[data-rotate-left]', root).addEventListener('click', function () {
    var e = activeEntry(); if (!e) return;
    pushHistory(); e.transform.angleStep = normalizeStep(e.transform.angleStep - 90); afterTransformChanged();
  });
  $('[data-rotate-right]', root).addEventListener('click', function () {
    var e = activeEntry(); if (!e) return;
    pushHistory(); e.transform.angleStep = normalizeStep(e.transform.angleStep + 90); afterTransformChanged();
  });
  $('[data-rotate-180]', root).addEventListener('click', function () {
    var e = activeEntry(); if (!e) return;
    pushHistory(); e.transform.angleStep = normalizeStep(e.transform.angleStep + 180); afterTransformChanged();
  });
  $('[data-flip-h]', root).addEventListener('click', function () {
    var e = activeEntry(); if (!e) return;
    pushHistory(); e.transform.flipH = !e.transform.flipH; afterTransformChanged();
  });
  $('[data-flip-v]', root).addEventListener('click', function () {
    var e = activeEntry(); if (!e) return;
    pushHistory(); e.transform.flipV = !e.transform.flipV; afterTransformChanged();
  });

  var angleSlider = $('[data-angle-slider]', root), angleLabel = $('[data-angle-label]', root);
  var angleHistoryPushed = false;
  angleSlider.addEventListener('input', function () {
    var e = activeEntry(); if (!e) return;
    if (!angleHistoryPushed) { pushHistory(); angleHistoryPushed = true; }
    if (state.cropMode) exitCropMode();
    e.transform.fineAngle = parseFloat(angleSlider.value) || 0;
    updateAngleUI();
    renderPreview();
  });
  angleSlider.addEventListener('change', function () { angleHistoryPushed = false; });
  $('[data-reset-angle]', root).addEventListener('click', function () {
    var e = activeEntry(); if (!e) return;
    pushHistory(); e.transform.fineAngle = 0; afterTransformChanged();
  });
  $('[data-reset-all]', root).addEventListener('click', function () {
    var e = activeEntry(); if (!e) return;
    pushHistory(); e.transform = freshTransform(); afterTransformChanged();
  });

  function updateAngleUI() {
    var e = activeEntry(); if (!e) return;
    angleSlider.value = e.transform.fineAngle;
    angleLabel.textContent = (e.transform.fineAngle > 0 ? '+' : '') + e.transform.fineAngle.toFixed(1) + '° (base ' + e.transform.angleStep + '°)';
  }
  function updateFlipUI() {
    var e = activeEntry(); if (!e) return;
    $('[data-flip-h]', root).setAttribute('aria-pressed', e.transform.flipH ? 'true' : 'false');
    $('[data-flip-v]', root).setAttribute('aria-pressed', e.transform.flipV ? 'true' : 'false');
  }

  /* ============================================================
     Background fill
     ============================================================ */
  $('[data-bg-transparent]', root).addEventListener('click', function () {
    state.bgMode = 'transparent';
    $all('.ro-color-swatch', root).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    this.setAttribute('aria-pressed', 'true');
    renderPreview();
  });
  $all('[data-bg-color]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.bgMode = 'color'; state.bgColor = btn.getAttribute('data-bg-color');
      $all('.ro-color-swatch', root).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      btn.setAttribute('aria-pressed', 'true');
      renderPreview();
    });
  });
  $('[data-bg-custom]', root).addEventListener('input', function () {
    state.bgMode = 'color'; state.bgColor = this.value;
    $all('.ro-color-swatch', root).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    renderPreview();
  });

  /* ============================================================
     Live preview render
     ============================================================ */
  function renderPreview() {
    var entry = activeEntry();
    if (!entry) return;
    loadingNote.classList.add('hidden');
    canvasStack.classList.remove('hidden');
    var fill = state.bgMode === 'color' ? state.bgColor : null;
    var dims = paintRotated(previewCanvas, entry.image, entry.naturalW, entry.naturalH, entry.transform, fill);
    cropOverlay.width = dims.rw; cropOverlay.height = dims.rh;
    renderCropOverlay();
    if (state.compareOn) refreshCompareAfter();
  }

  /* ============================================================
     EXIF display
     ============================================================ */
  function renderExifBox() {
    var entry = activeEntry();
    if (!entry || !entry.exif) { exifBox.classList.add('hidden'); return; }
    exifBox.classList.remove('hidden');
    exifBox.innerHTML = '📷 Detected EXIF orientation: <b>' + entry.exif + '</b> — ' + (EXIF_LABELS[entry.exif] || 'Unknown') +
      '. Your browser already displays and exports this correctly — no manual correction needed.';
  }

  /* ============================================================
     Crop after rotation
     ============================================================ */
  var cropToggleBtn = $('[data-toggle-crop]', root);
  var applyCropBtn = $('[data-apply-crop]', root);
  var cropDrag = null;

  cropToggleBtn.addEventListener('click', function () {
    if (state.cropMode) exitCropMode(); else enterCropMode();
  });
  function enterCropMode() {
    if (!activeEntry()) { showMessage('Upload an image first.', 'error'); return; }
    setCompare(false);
    state.cropMode = true;
    state.cropRect = null;
    cropToggleBtn.setAttribute('aria-pressed', 'true');
    canvasWrap.classList.add('crop-mode');
    applyCropBtn.disabled = true;
    hintBar.textContent = 'Drag on the image to draw a crop rectangle, then click Apply crop.';
    renderCropOverlay();
  }
  function exitCropMode() {
    state.cropMode = false;
    state.cropRect = null;
    cropToggleBtn.setAttribute('aria-pressed', 'false');
    canvasWrap.classList.remove('crop-mode');
    applyCropBtn.disabled = true;
    hintBar.textContent = 'Use the controls on the right to rotate, flip, and straighten your image.';
    renderCropOverlay();
  }

  $all('[data-crop-ratio]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.cropRatio = btn.getAttribute('data-crop-ratio');
      $all('[data-crop-ratio]', root).forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    });
  });

  function ratioValue() {
    if (state.cropRatio === '1:1') return 1;
    if (state.cropRatio === '4:3') return 4 / 3;
    if (state.cropRatio === '16:9') return 16 / 9;
    return null;
  }

  function overlayPointFromEvent(e) {
    var rect = cropOverlay.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (cropOverlay.width / rect.width);
    var y = (e.clientY - rect.top) * (cropOverlay.height / rect.height);
    return { x: clamp(x, 0, cropOverlay.width), y: clamp(y, 0, cropOverlay.height) };
  }

  cropOverlay.addEventListener('pointerdown', function (e) {
    if (!state.cropMode) return;
    var p = overlayPointFromEvent(e);
    cropDrag = { x0: p.x, y0: p.y };
    cropOverlay.setPointerCapture(e.pointerId);
  });
  cropOverlay.addEventListener('pointermove', function (e) {
    if (!state.cropMode || !cropDrag) return;
    var p = overlayPointFromEvent(e);
    var w = p.x - cropDrag.x0, h = p.y - cropDrag.y0;
    var ratio = ratioValue();
    if (ratio) {
      if (Math.abs(w) / ratio > Math.abs(h)) h = (h < 0 ? -1 : 1) * Math.abs(w) / ratio;
      else w = (w < 0 ? -1 : 1) * Math.abs(h) * ratio;
    }
    var x = w < 0 ? cropDrag.x0 + w : cropDrag.x0;
    var y = h < 0 ? cropDrag.y0 + h : cropDrag.y0;
    state.cropRect = { x: clamp(x, 0, cropOverlay.width), y: clamp(y, 0, cropOverlay.height), w: Math.abs(w), h: Math.abs(h) };
    renderCropOverlay();
  });
  function endCropDrag() {
    cropDrag = null;
    applyCropBtn.disabled = !state.cropRect || state.cropRect.w < 8 || state.cropRect.h < 8;
  }
  cropOverlay.addEventListener('pointerup', endCropDrag);
  cropOverlay.addEventListener('pointercancel', endCropDrag);

  function renderCropOverlay() {
    overlayCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    if (!state.cropMode || !state.cropRect) return;
    var r = state.cropRect;
    overlayCtx.fillStyle = 'rgba(15,23,42,0.5)';
    overlayCtx.fillRect(0, 0, cropOverlay.width, cropOverlay.height);
    overlayCtx.clearRect(r.x, r.y, r.w, r.h);
    overlayCtx.strokeStyle = '#4f46e5';
    overlayCtx.lineWidth = 2;
    overlayCtx.strokeRect(r.x, r.y, r.w, r.h);
  }

  applyCropBtn.addEventListener('click', function () {
    var entry = activeEntry();
    if (!entry || !state.cropRect || state.cropRect.w < 8 || state.cropRect.h < 8) return;
    var r = state.cropRect;
    var cropped = document.createElement('canvas');
    cropped.width = Math.round(r.w); cropped.height = Math.round(r.h);
    cropped.getContext('2d').drawImage(previewCanvas, r.x, r.y, r.w, r.h, 0, 0, cropped.width, cropped.height);
    pushHistory();
    entry.image = cropped;
    entry.naturalW = cropped.width;
    entry.naturalH = cropped.height;
    entry.transform = freshTransform();
    exitCropMode();
    afterTransformChanged();
    setStep(3);
    showMessage('Crop applied — further rotations start from the cropped result.', 'success');
  });

  /* ============================================================
     Before / after compare
     ============================================================ */
  var compareToggleBtn = $('[data-toggle-compare]', root);
  compareToggleBtn.addEventListener('click', function () { setCompare(!state.compareOn); });
  function setCompare(on) {
    if (on && !activeEntry()) { showMessage('Upload an image first.', 'error'); return; }
    state.compareOn = on;
    compareToggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    compareWrap.classList.toggle('hidden', !on);
    canvasStack.classList.toggle('hidden', on);
    compareRange.classList.toggle('hidden', !on);
    if (on) {
      if (state.cropMode) exitCropMode();
      $('[data-compare-before]', root).src = activeEntry().originalUrl;
      refreshCompareAfter();
    }
  }
  function refreshCompareAfter() {
    if (!state.compareOn) return;
    try { $('[data-compare-after]', root).src = previewCanvas.toDataURL('image/png'); } catch (e) { /* huge canvas — ignore */ }
  }
  compareRange.addEventListener('input', function () {
    compareWrap.style.setProperty('--ro-reveal', compareRange.value + '%');
  });

  /* ============================================================
     Export format / quality
     ============================================================ */
  var formatSelect = $('[data-export-format]', root);
  var qualityField = $('[data-quality-field]', root);
  var qualitySlider = $('[data-quality-slider]', root);
  var qualityLabel = $('[data-quality-label]', root);
  function updateQualityVisibility() { qualityField.style.display = formatSelect.value === 'image/png' ? 'none' : ''; }
  formatSelect.addEventListener('change', updateQualityVisibility);
  qualitySlider.addEventListener('input', function () { qualityLabel.textContent = qualitySlider.value + '%'; });
  updateQualityVisibility();

  /* ============================================================
     Download / batch export
     ============================================================ */
  function setProgress(pct, text) { progressFill.style.width = pct + '%'; if (text) progressText.textContent = text; }

  function exportEntryBlob(entry, format, quality) {
    return new Promise(function (resolve) {
      var c = document.createElement('canvas');
      var needsFill = state.bgMode === 'color' || format === 'image/jpeg';
      var fill = needsFill ? (state.bgMode === 'color' ? state.bgColor : '#ffffff') : null;
      paintRotated(c, entry.image, entry.naturalW, entry.naturalH, entry.transform, fill);
      c.toBlob(function (blob) { resolve({ blob: blob, w: c.width, h: c.height }); }, format, format === 'image/png' ? undefined : quality);
    });
  }

  $('[data-download-btn]', root).addEventListener('click', async function () {
    if (!state.files.length) return;
    var btn = this;
    var format = formatSelect.value;
    var quality = clamp(parseInt(qualitySlider.value, 10) || 90, 10, 100) / 100;
    btn.disabled = true;
    progressWrap.classList.add('is-active');
    resultPanel.classList.add('hidden');
    setProgress(4, 'Preparing…');
    try {
      var outputs = [];
      for (var i = 0; i < state.files.length; i++) {
        var entry = state.files[i];
        setProgress(8 + Math.round((i / state.files.length) * 85), 'Rendering ' + entry.name + '…');
        var result = await exportEntryBlob(entry, format, quality);
        if (!result.blob) throw new Error('Could not export ' + entry.name + '.');
        outputs.push({ name: baseName(entry.name) + '-rotated' + extFor(format), blob: result.blob, w: result.w, h: result.h });
        await yieldToUI();
      }
      setProgress(96, 'Finalizing…');

      var downloadLink = $('[data-download-link]', root);
      if (outputs.length === 1) {
        var url = URL.createObjectURL(outputs[0].blob);
        downloadLink.href = url; downloadLink.download = outputs[0].name; downloadLink.classList.remove('hidden');
        $('[data-result-filename]', root).textContent = outputs[0].name;
        $('[data-stat-size]', root).textContent = window.ImageToolKit.formatBytes(outputs[0].blob.size);
        $('[data-stat-dims]', root).textContent = outputs[0].w + '×' + outputs[0].h + 'px';
        var a = document.createElement('a'); a.href = url; a.download = outputs[0].name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } else {
        var zip = new JSZip();
        outputs.forEach(function (o) { zip.file(o.name, o.blob); });
        var zipBlob = await zip.generateAsync({ type: 'blob' });
        var zurl = URL.createObjectURL(zipBlob);
        downloadLink.href = zurl; downloadLink.download = 'rotated-images.zip'; downloadLink.classList.remove('hidden');
        $('[data-result-filename]', root).textContent = 'rotated-images.zip (' + outputs.length + ' files)';
        $('[data-stat-size]', root).textContent = window.ImageToolKit.formatBytes(zipBlob.size);
        $('[data-stat-dims]', root).textContent = outputs.length + ' images';
        var za = document.createElement('a'); za.href = zurl; za.download = 'rotated-images.zip';
        document.body.appendChild(za); za.click(); document.body.removeChild(za);
      }

      resultPanel.classList.remove('hidden');
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setStep(4);
      setProgress(100, 'Done!');
      showMessage('Rotated image ready to download.', 'success');
    } catch (err) {
      console.error(err);
      showMessage('Something went wrong: ' + (err.message || 'unknown error') + '.', 'error');
    } finally {
      btn.disabled = false;
      window.setTimeout(function () { progressWrap.classList.remove('is-active'); }, 900);
    }
  });

  /* ============================================================
     Reset / misc
     ============================================================ */
  $('[data-add-more]', root).addEventListener('click', function () { filePicker.click(); });
  $('[data-reset-btn]', root).addEventListener('click', function () { window.location.reload(); });
  $('[data-rotate-another]', root).addEventListener('click', function () { window.location.reload(); });

  var stickyCta = $('[data-sticky-rotate-cta]');
  if (stickyCta) {
    stickyCta.addEventListener('click', function () {
      var tool = document.getElementById('rotate-tool');
      if (tool) tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!state.files.length) filePicker.click();
    });
  }
})();
