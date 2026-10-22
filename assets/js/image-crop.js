/* ToolAdda — Image Crop Tool.
   Cropper.js (assets/js/cropper.min.js) drives the interactive crop box for
   the "active" image in the queue; batch companions are cropped headlessly
   on <canvas> using the same aspect ratio + rotate/flip/shape/output
   settings, centered (Smart Center Crop). 100% client-side. */
(function () {
  'use strict';

  const root = document.querySelector('[data-crop-page]');
  if (!root) return;

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));

  const ASPECT_GROUPS = [
    { label: 'Common', items: [
      { key: 'free', label: 'Free', ratio: null },
      { key: 'square', label: '1:1 Square', ratio: 1 },
      { key: '4-3', label: '4:3', ratio: 4 / 3 },
      { key: '3-2', label: '3:2', ratio: 3 / 2 },
      { key: '16-9', label: '16:9 Widescreen', ratio: 16 / 9 },
      { key: '9-16', label: '9:16 Portrait', ratio: 9 / 16 },
      { key: '5-4', label: '5:4', ratio: 5 / 4 },
    ] },
    { label: 'Social Media', items: [
      { key: 'ig-post', label: 'Instagram Post', ratio: 1 },
      { key: 'ig-story', label: 'Instagram Story', ratio: 9 / 16 },
      { key: 'ig-reel', label: 'Reel / TikTok', ratio: 9 / 16 },
      { key: 'yt-thumb', label: 'YouTube Thumbnail', ratio: 16 / 9 },
      { key: 'fb-cover', label: 'Facebook Cover', ratio: 820 / 312 },
      { key: 'li-banner', label: 'LinkedIn Banner', ratio: 1584 / 396 },
      { key: 'x-header', label: 'X (Twitter) Header', ratio: 1500 / 500 },
      { key: 'pin-pin', label: 'Pinterest Pin', ratio: 1000 / 1500 },
    ] },
    { label: 'Print & Documents', items: [
      { key: 'a4', label: 'A4', ratio: 210 / 297 },
      { key: 'letter', label: 'US Letter', ratio: 8.5 / 11 },
    ] },
    { label: 'ID Photo', items: [
      { key: 'passport', label: 'Passport Photo', ratio: 35 / 45 },
    ] },
  ];

  const GRID_FRACTIONS = { thirds: [1 / 3, 2 / 3], golden: [0.382, 0.618] };

  // ---------- elements ----------

  const fileInput = $('[data-file-input]');
  const filePickers = $$('[data-file-picker]');
  const dropZone = $('[data-drop-zone]');
  const thumbGridEl = $('[data-thumb-grid]');
  const countLabel = $('[data-file-count]');
  const fileMetaEl = $('[data-file-meta]');

  const workspaceSection = $('[data-workspace]');
  const stageWrap = $('[data-stage-wrap]');
  const cropImageEl = $('[data-crop-image]');
  const gridOverlayEl = $('[data-grid-overlay]');
  const lineV1 = $('[data-grid-v1]');
  const lineV2 = $('[data-grid-v2]');
  const lineH1 = $('[data-grid-h1]');
  const lineH2 = $('[data-grid-h2]');

  const zoomSlider = $('[data-zoom-slider]');
  const zoomInBtn = $('[data-zoom-in]');
  const zoomOutBtn = $('[data-zoom-out]');
  const rotateLeftBtn = $('[data-rotate-left]');
  const rotateRightBtn = $('[data-rotate-right]');
  const flipHBtn = $('[data-flip-h]');
  const flipVBtn = $('[data-flip-v]');
  const undoBtn = $('[data-undo]');
  const redoBtn = $('[data-redo]');
  const gridModeSelect = $('[data-grid-mode]');
  const shapeButtons = $$('[data-shape-value]');

  const presetGridEl = $('[data-preset-grid]');
  const customWidthInput = $('[data-custom-width]');
  const customHeightInput = $('[data-custom-height]');
  const customUnitSelect = $('[data-custom-unit]');
  const customLockCheckbox = $('[data-lock-aspect]');
  const applyCustomBtn = $('[data-apply-custom]');

  const outputFormatSelect = $('[data-output-format]');
  const formatLockNote = $('[data-format-lock-note]');
  const qualityRow = $('[data-quality-row]');
  const outputQualityRange = $('[data-output-quality]');
  const qualityLabel = $('[data-output-quality-label]');
  const resizeEnableCheckbox = $('[data-resize-enable]');
  const resizeWidthInput = $('[data-resize-width]');
  const resizeHeightInput = $('[data-resize-height]');
  const resizeLockCheckbox = $('[data-resize-lock]');

  const cropBtn = $('[data-crop-btn]');
  const cropAllBtn = $('[data-crop-all-btn]');
  const downloadAllBtn = $('[data-download-all-btn]');
  const resetBtn = $('[data-reset-btn]');
  const resetAllBtn = $('[data-reset-all-btn]');
  const progressWrap = $('[data-progress-wrap]');
  const progressBar = $('[data-progress-bar]');
  const progressLabel = $('[data-progress-label]');
  const messageBox = $('[data-message]');
  const loader = $('[data-loader]');

  const resultsContainer = $('[data-results-container]');
  const resultsListEl = $('[data-results-list]');
  const beforeAfterWrap = $('[data-before-after]');
  const baOriginal = $('[data-ba-original]');
  const baPreview = $('[data-ba-preview]');
  const baPreviewImg = $('[data-ba-preview-img]');
  const baSlider = $('[data-ba-slider]');
  const baHandle = $('[data-ba-handle]');

  const stickyBar = document.querySelector('[data-sticky-bar]');
  const scrollToToolBtns = Array.from(document.querySelectorAll('[data-scroll-to-tool]'));

  // ---------- state ----------

  let queue = [];
  let objectUrls = [];
  let activeIndex = -1;
  let cropper = null;
  let currentAspectRatio = null;
  let currentGridMode = 'thirds';
  let currentShape = 'rect';
  let history = [];
  let historyIndex = -1;

  // ---------- helpers ----------

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function sanitizeName(name) {
    return (name || 'image').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'image';
  }

  function clearMessage() {
    messageBox.textContent = '';
    messageBox.classList.add('hidden');
    messageBox.classList.remove('success', 'error');
  }

  function showMessage(text, type = 'success') {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  }

  function setProgress(current, total) {
    if (total <= 0) { progressWrap.hidden = true; return; }
    progressWrap.hidden = false;
    const pct = Math.round((current / total) * 100);
    const done = current >= total;
    progressBar.style.width = `${pct}%`;
    progressBar.classList.toggle('is-complete', done);
    progressLabel.textContent = done ? 'Crop complete' : `Cropping ${current} of ${total}…`;
  }

  function toggleBusy(visible) {
    loader.hidden = !visible;
    [cropBtn, cropAllBtn, resetBtn, ...filePickers].forEach((btn) => { if (btn) btn.disabled = visible; });
  }

  function syncActionState() {
    const hasActive = !!cropper;
    cropBtn.disabled = !hasActive;
    cropAllBtn.hidden = queue.length < 2;
    cropAllBtn.disabled = !hasActive;
  }

  async function loadBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      return createImageBitmap(file);
    }
  }

  async function readDpi(file) {
    if (!/jpe?g$/i.test(file.type || '') && !/\.(jpe?g)$/i.test(file.name || '')) return null;
    try {
      const buf = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
      if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[3] === 0xe0)) return null;
      const isJfif = buf[6] === 0x4a && buf[7] === 0x46 && buf[8] === 0x49 && buf[9] === 0x46 && buf[10] === 0x00;
      if (!isJfif) return null;
      const units = buf[13];
      const xDensity = (buf[14] << 8) | buf[15];
      if (!xDensity) return null;
      return units === 2 ? Math.round(xDensity * 2.54) : xDensity;
    } catch (e) {
      return null;
    }
  }

  // ---------- output pipeline ----------

  function applyShapeMask(sourceCanvas, shape) {
    if (shape === 'rect') return sourceCanvas;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();
    return out;
  }

  function resizeCanvas(source, targetW, targetH, lockAspect) {
    const ratio = source.width / source.height;
    let w = targetW || source.width;
    let h = targetH || source.height;
    if (lockAspect) {
      if (targetW && !targetH) h = Math.round(targetW / ratio);
      else if (targetH && !targetW) w = Math.round(targetH * ratio);
      else if (targetW && targetH) h = Math.round(targetW / ratio);
    }
    const out = document.createElement('canvas');
    out.width = Math.max(1, w);
    out.height = Math.max(1, h);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out;
  }

  function readSettings() {
    let format = outputFormatSelect.value;
    if (currentShape !== 'rect') format = 'png';
    return {
      shape: currentShape,
      format,
      quality: Number(outputQualityRange.value) / 100,
      resizeEnabled: resizeEnableCheckbox.checked,
      resizeWidth: parseInt(resizeWidthInput.value, 10) || 0,
      resizeHeight: parseInt(resizeHeightInput.value, 10) || 0,
      resizeLock: resizeLockCheckbox.checked,
    };
  }

  function finalizeCanvas(croppedCanvas, settings) {
    let canvas = applyShapeMask(croppedCanvas, settings.shape);
    if (settings.resizeEnabled && (settings.resizeWidth || settings.resizeHeight)) {
      canvas = resizeCanvas(canvas, settings.resizeWidth, settings.resizeHeight, settings.resizeLock);
    }
    return canvas;
  }

  function canvasToBlob(canvas, format, quality) {
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not encode the cropped image.')); return; }
        resolve(blob);
      }, mime, mime === 'image/png' ? undefined : quality);
    });
  }

  async function cropActiveImage() {
    if (!cropper) throw new Error('No image loaded.');
    const settings = readSettings();
    const rawCanvas = cropper.getCroppedCanvas({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    if (!rawCanvas) throw new Error('Could not read the crop area.');
    const finalCanvas = finalizeCanvas(rawCanvas, settings);
    const blob = await canvasToBlob(finalCanvas, settings.format, settings.quality);
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return { blob, url, width: finalCanvas.width, height: finalCanvas.height, format: settings.format };
  }

  function computeCoverRect(naturalW, naturalH, ratio) {
    if (!ratio) return { sx: 0, sy: 0, sw: naturalW, sh: naturalH };
    let sw;
    let sh;
    if (naturalW / naturalH > ratio) { sh = naturalH; sw = Math.round(sh * ratio); } else { sw = naturalW; sh = Math.round(sw / ratio); }
    return { sx: Math.round((naturalW - sw) / 2), sy: Math.round((naturalH - sh) / 2), sw, sh };
  }

  async function cropCompanionImage(item, shared) {
    const bitmap = await loadBitmap(item.file);
    const rotated90 = Math.abs(Math.round(shared.rotate / 90) % 2) === 1;
    const natW = rotated90 ? bitmap.height : bitmap.width;
    const natH = rotated90 ? bitmap.width : bitmap.height;
    const rect = computeCoverRect(natW, natH, shared.ratio);

    const full = document.createElement('canvas');
    full.width = natW;
    full.height = natH;
    const fctx = full.getContext('2d');
    fctx.save();
    fctx.translate(natW / 2, natH / 2);
    fctx.rotate((shared.rotate * Math.PI) / 180);
    fctx.scale(shared.scaleX, shared.scaleY);
    fctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    fctx.restore();
    bitmap.close?.();

    const cropped = document.createElement('canvas');
    cropped.width = Math.max(1, rect.sw);
    cropped.height = Math.max(1, rect.sh);
    cropped.getContext('2d').drawImage(full, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, cropped.width, cropped.height);

    const finalCanvas = finalizeCanvas(cropped, shared);
    const blob = await canvasToBlob(finalCanvas, shared.format, shared.quality);
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return { blob, url, width: finalCanvas.width, height: finalCanvas.height, format: shared.format };
  }

  async function handleCropAll() {
    if (!queue.length || !cropper) return;
    toggleBusy(true);
    const activeData = cropper.getData(true);
    const settings = readSettings();
    const shared = {
      ratio: currentAspectRatio,
      rotate: activeData.rotate || 0,
      scaleX: activeData.scaleX || 1,
      scaleY: activeData.scaleY || 1,
      ...settings,
    };
    let ok = 0;
    for (let i = 0; i < queue.length; i += 1) {
      setProgress(i, queue.length);
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = i === activeIndex ? await cropActiveImage() : await cropCompanionImage(queue[i], shared);
        queue[i].cropped = result;
        ok += 1;
      } catch (e) {
        showMessage(`Failed to crop ${queue[i].file.name}: ${e.message}`, 'error');
      }
    }
    setProgress(queue.length, queue.length);
    renderThumbs();
    renderResults();
    toggleBusy(false);
    if (ok) showMessage(`✅ Cropped ${ok} of ${queue.length} images.`, 'success');
  }

  // ---------- Cropper.js orchestration ----------

  function destroyCropper() {
    if (cropper) { cropper.destroy(); cropper = null; }
  }

  function pushHistory() {
    if (!cropper) return;
    const snapshot = JSON.stringify(cropper.getData(true));
    if (history[historyIndex] === snapshot) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > 20) history.shift();
    historyIndex = history.length - 1;
    syncHistoryButtons();
  }

  function undo() {
    if (historyIndex <= 0 || !cropper) return;
    historyIndex -= 1;
    cropper.setData(JSON.parse(history[historyIndex]));
    syncHistoryButtons();
  }

  function redo() {
    if (historyIndex >= history.length - 1 || !cropper) return;
    historyIndex += 1;
    cropper.setData(JSON.parse(history[historyIndex]));
    syncHistoryButtons();
  }

  function syncHistoryButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= history.length - 1;
  }

  function applyShapeClass() {
    stageWrap.classList.toggle('icrop-shape-round', currentShape !== 'rect');
  }

  function updateGridOverlay() {
    if (!cropper || !gridOverlayEl) return;
    if (currentGridMode === 'none') { gridOverlayEl.hidden = true; return; }
    const box = cropper.getCropBoxData();
    gridOverlayEl.hidden = false;
    gridOverlayEl.style.left = `${box.left}px`;
    gridOverlayEl.style.top = `${box.top}px`;
    gridOverlayEl.style.width = `${box.width}px`;
    gridOverlayEl.style.height = `${box.height}px`;
    const [a, b] = GRID_FRACTIONS[currentGridMode];
    lineV1.style.left = `${a * 100}%`;
    lineV2.style.left = `${b * 100}%`;
    lineH1.style.top = `${a * 100}%`;
    lineH2.style.top = `${b * 100}%`;
  }

  function initCropper() {
    history = [];
    historyIndex = -1;
    cropper = new Cropper(cropImageEl, {
      viewMode: 1,
      dragMode: 'crop',
      autoCropArea: 1,
      background: false,
      responsive: true,
      checkOrientation: true,
      modal: true,
      guides: false,
      center: false,
      highlight: true,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      minContainerWidth: 280,
      minContainerHeight: 320,
      ready() {
        cropper.setAspectRatio(currentAspectRatio || NaN);
        applyShapeClass();
        updateGridOverlay();
        pushHistory();
        syncActionState();
      },
      cropmove() { updateGridOverlay(); },
      cropend() { updateGridOverlay(); pushHistory(); },
      zoom(e) {
        updateGridOverlay();
        if (e && e.detail) zoomSlider.value = Math.round(e.detail.ratio * 100);
      },
    });
  }

  async function loadActive(index) {
    if (index < 0 || index >= queue.length) return;
    const item = queue[index];
    if (activeIndex === index && cropper && cropImageEl.src === item.url) return;
    destroyCropper();
    activeIndex = index;
    workspaceSection.hidden = false;

    await new Promise((resolve) => {
      cropImageEl.onload = resolve;
      cropImageEl.onerror = resolve;
      cropImageEl.src = item.url;
    });

    item.naturalWidth = cropImageEl.naturalWidth;
    item.naturalHeight = cropImageEl.naturalHeight;
    if (!item.naturalWidth) { showMessage(`Could not load ${item.file.name}. Please try another file.`, 'error'); return; }
    if (item.dpi === undefined) item.dpi = await readDpi(item.file);

    renderMeta(item);
    initCropper();
    renderThumbs();
  }

  // ---------- meta / thumbs / results rendering ----------

  function renderMeta(item) {
    const mp = ((item.naturalWidth * item.naturalHeight) / 1e6).toFixed(1);
    fileMetaEl.hidden = false;
    fileMetaEl.innerHTML = `
      <div class="icrop-meta-row"><span>File name</span><strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong></div>
      <div class="icrop-meta-row"><span>Size</span><strong>${formatBytes(item.file.size)}</strong></div>
      <div class="icrop-meta-row"><span>Dimensions</span><strong>${item.naturalWidth}×${item.naturalHeight}px</strong></div>
      <div class="icrop-meta-row"><span>Resolution</span><strong>${mp} MP</strong></div>
      <div class="icrop-meta-row"><span>Format</span><strong>${(item.file.type || 'image').replace('image/', '').toUpperCase()}</strong></div>
      <div class="icrop-meta-row"><span>DPI</span><strong>${item.dpi ? `${item.dpi} dpi` : '—'}</strong></div>
    `;
  }

  function renderThumbs() {
    if (!queue.length) { thumbGridEl.hidden = true; thumbGridEl.innerHTML = ''; countLabel.textContent = ''; return; }
    thumbGridEl.hidden = false;
    thumbGridEl.innerHTML = queue.map((item, i) => `
      <div class="icrop-thumb ${i === activeIndex ? 'is-active' : ''}" data-thumb-index="${i}" role="button" tabindex="0" aria-pressed="${i === activeIndex}" aria-label="Edit ${escapeHtml(item.file.name)}">
        <img src="${item.url}" alt="" loading="lazy" />
        <span class="icrop-thumb-name">${escapeHtml(item.file.name)}</span>
        ${item.cropped ? '<span class="icrop-thumb-badge" aria-hidden="true">✓</span>' : ''}
        <span class="icrop-thumb-remove" data-thumb-remove="${i}" role="button" tabindex="0" aria-label="Remove ${escapeHtml(item.file.name)}">✕</span>
      </div>
    `).join('');
    $$('[data-thumb-index]').forEach((el) => {
      const go = () => loadActive(Number(el.dataset.thumbIndex));
      el.addEventListener('click', (e) => { if (e.target.closest('[data-thumb-remove]')) return; go(); });
      el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-thumb-remove]')) { e.preventDefault(); go(); } });
    });
    $$('[data-thumb-remove]').forEach((el) => {
      const remove = (e) => { e.stopPropagation(); e.preventDefault(); removeFromQueue(Number(el.dataset.thumbRemove)); };
      el.addEventListener('click', remove);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') remove(e); });
    });
    countLabel.textContent = `${queue.length} image${queue.length > 1 ? 's' : ''} in queue`;
    syncActionState();
  }

  function removeFromQueue(index) {
    const [removed] = queue.splice(index, 1);
    if (removed) {
      URL.revokeObjectURL(removed.url);
      if (removed.cropped) URL.revokeObjectURL(removed.cropped.url);
    }
    if (!queue.length) { resetAll(); return; }
    if (index === activeIndex) {
      destroyCropper();
      activeIndex = -1;
      loadActive(Math.min(index, queue.length - 1));
    } else if (index < activeIndex) {
      activeIndex -= 1;
      renderThumbs();
    } else {
      renderThumbs();
    }
    renderResults();
  }

  function scrollToResults() {
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      resultsContainer.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }

  function renderResults() {
    const cropped = queue.filter((q) => q.cropped);
    if (!cropped.length) { resultsContainer.hidden = true; beforeAfterWrap.hidden = true; return; }
    resultsContainer.hidden = false;
    resultsListEl.innerHTML = cropped.map((item) => {
      const ext = item.cropped.format === 'jpeg' ? 'jpg' : item.cropped.format;
      return `
        <div class="icrop-result-item">
          <img class="icrop-result-thumb" src="${item.cropped.url}" alt="Cropped preview of ${escapeHtml(item.file.name)}" loading="lazy" />
          <div class="icrop-result-info">
            <p class="icrop-result-name">${escapeHtml(item.file.name)}</p>
            <p class="icrop-result-meta">${item.cropped.width}×${item.cropped.height}px · ${formatBytes(item.cropped.blob.size)}</p>
          </div>
          <a class="secondary-btn" href="${item.cropped.url}" download="cropped-${sanitizeName(item.file.name)}.${ext}">⬇️ Download</a>
        </div>
      `;
    }).join('');
    downloadAllBtn.hidden = cropped.length < 2;

    const primary = (activeIndex >= 0 && queue[activeIndex] && queue[activeIndex].cropped) ? queue[activeIndex] : cropped[cropped.length - 1];
    if (primary) {
      baOriginal.src = primary.url;
      baPreviewImg.src = primary.cropped.url;
      beforeAfterWrap.hidden = false;
    }
    scrollToResults();
  }

  // ---------- aspect presets & custom size ----------

  function renderPresetGrid() {
    presetGridEl.innerHTML = ASPECT_GROUPS.map((group) => `
      <div class="icrop-preset-group">
        <p class="icrop-preset-group-label">${group.label}</p>
        <div class="icrop-preset-row" role="group" aria-label="${group.label} aspect ratios">
          ${group.items.map((item) => `<button type="button" class="icrop-preset-pill" data-ratio="${item.ratio ?? ''}" aria-pressed="${item.key === 'free' ? 'true' : 'false'}">${item.label}</button>`).join('')}
        </div>
      </div>
    `).join('');
    $$('.icrop-preset-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ratio = btn.dataset.ratio ? Number(btn.dataset.ratio) : null;
        applyAspectRatio(ratio);
        $$('.icrop-preset-pill').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
      });
    });
  }

  function applyAspectRatio(ratio) {
    currentAspectRatio = ratio;
    if (cropper) cropper.setAspectRatio(ratio || NaN);
    pushHistory();
  }

  applyCustomBtn.addEventListener('click', () => {
    if (!cropper) { showMessage('Upload an image first.', 'error'); return; }
    const unit = customUnitSelect.value;
    let w = parseFloat(customWidthInput.value);
    let h = parseFloat(customHeightInput.value);
    if (!w || !h || w <= 0 || h <= 0) { showMessage('Enter a valid width and height.', 'error'); return; }
    if (unit === 'percent') {
      const imgData = cropper.getImageData();
      w = Math.round((imgData.naturalWidth * w) / 100);
      h = Math.round((imgData.naturalHeight * h) / 100);
    }
    cropper.setAspectRatio(NaN);
    cropper.setData({ width: w, height: h });
    currentAspectRatio = null;
    $$('.icrop-preset-pill').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    pushHistory();
    clearMessage();
  });

  customWidthInput.addEventListener('input', () => {
    if (customLockCheckbox.checked && currentAspectRatio) {
      customHeightInput.value = Math.round(Number(customWidthInput.value) / currentAspectRatio) || '';
    }
  });

  // ---------- toolbar wiring ----------

  zoomSlider.addEventListener('input', () => { if (cropper) cropper.zoomTo(Number(zoomSlider.value) / 100); });
  zoomInBtn.addEventListener('click', () => cropper?.zoom(0.1));
  zoomOutBtn.addEventListener('click', () => cropper?.zoom(-0.1));

  rotateLeftBtn.addEventListener('click', () => { cropper?.rotate(-90); pushHistory(); updateGridOverlay(); });
  rotateRightBtn.addEventListener('click', () => { cropper?.rotate(90); pushHistory(); updateGridOverlay(); });
  flipHBtn.addEventListener('click', () => { if (!cropper) return; cropper.scaleX((cropper.getData().scaleX || 1) * -1); pushHistory(); });
  flipVBtn.addEventListener('click', () => { if (!cropper) return; cropper.scaleY((cropper.getData().scaleY || 1) * -1); pushHistory(); });

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  gridModeSelect.addEventListener('change', () => { currentGridMode = gridModeSelect.value; updateGridOverlay(); });

  function syncFormatLock() {
    const locked = currentShape !== 'rect';
    outputFormatSelect.disabled = locked;
    if (locked) outputFormatSelect.value = 'png';
    formatLockNote.hidden = !locked;
    toggleQualityVisibility();
  }

  shapeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentShape = btn.dataset.shapeValue;
      shapeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applyShapeClass();
      if (currentShape === 'circle') applyAspectRatio(1);
      syncFormatLock();
    });
  });

  function toggleQualityVisibility() {
    qualityRow.hidden = outputFormatSelect.value === 'png';
  }
  outputFormatSelect.addEventListener('change', toggleQualityVisibility);
  outputQualityRange.addEventListener('input', () => { qualityLabel.textContent = `${outputQualityRange.value}%`; });

  resizeEnableCheckbox.addEventListener('change', toggleResizeFields);
  function toggleResizeFields() {
    const on = resizeEnableCheckbox.checked;
    [resizeWidthInput, resizeHeightInput, resizeLockCheckbox].forEach((el) => { el.disabled = !on; });
  }

  // ---------- upload wiring ----------

  function isImageFile(file) {
    return file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name));
  }

  function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(isImageFile);
    if (!files.length) { showMessage('Please choose valid image files (JPG, PNG, WebP…).', 'error'); return; }
    const startAt = queue.length;
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      queue.push({ file, url, cropped: null, naturalWidth: 0, naturalHeight: 0, dpi: undefined });
    });
    clearMessage();
    renderThumbs();
    loadActive(activeIndex === -1 ? startAt : activeIndex);
    showMessage(`${files.length} image${files.length > 1 ? 's' : ''} added. ${queue.length > 1 ? 'Click a thumbnail to switch the active image.' : ''}`, 'success');
  }

  filePickers.forEach((btn) => btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fileInput.click(); }));
  fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = Array.from(items).filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile());
    if (files.length) handleFiles(files);
  });

  if (dropZone) {
    dropZone.addEventListener('click', (e) => { if (!e.target.closest('button')) fileInput.click(); });
    dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('active'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('active'); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('active');
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
  }

  // ---------- crop actions ----------

  cropBtn.addEventListener('click', async () => {
    if (!cropper) { showMessage('Upload an image first.', 'error'); return; }
    try {
      toggleBusy(true);
      clearMessage();
      const result = await cropActiveImage();
      queue[activeIndex].cropped = result;
      renderThumbs();
      renderResults();
      showMessage('✅ Crop complete — download below.', 'success');
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      toggleBusy(false);
    }
  });

  cropAllBtn.addEventListener('click', async () => {
    clearMessage();
    try { await handleCropAll(); } catch (e) { showMessage(e.message, 'error'); toggleBusy(false); }
  });

  function loadJSZip() {
    return new Promise((resolve, reject) => {
      if (window.JSZip) { resolve(window.JSZip); return; }
      const s = document.createElement('script');
      s.src = 'assets/js/jszip.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  downloadAllBtn.addEventListener('click', async () => {
    const cropped = queue.filter((q) => q.cropped);
    if (!cropped.length) { showMessage('No cropped images to download yet.', 'error'); return; }
    try {
      toggleBusy(true);
      showMessage('Creating ZIP file…', 'success');
      if (typeof JSZip === 'undefined') await loadJSZip();
      const zip = new JSZip();
      cropped.forEach((item) => {
        const ext = item.cropped.format === 'jpeg' ? 'jpg' : item.cropped.format;
        zip.file(`cropped-${sanitizeName(item.file.name)}.${ext}`, item.cropped.blob);
      });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cropped-images.zip';
      a.click();
      showMessage('✅ ZIP file downloaded successfully!', 'success');
    } catch (e) {
      showMessage(`Failed to create ZIP: ${e.message}`, 'error');
    } finally {
      toggleBusy(false);
    }
  });

  function resetAll() {
    destroyCropper();
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
    queue = [];
    activeIndex = -1;
    history = [];
    historyIndex = -1;
    workspaceSection.hidden = true;
    fileMetaEl.hidden = true;
    thumbGridEl.hidden = true;
    thumbGridEl.innerHTML = '';
    resultsContainer.hidden = true;
    resultsListEl.innerHTML = '';
    beforeAfterWrap.hidden = true;
    countLabel.textContent = '';
    setProgress(0, 0);
    clearMessage();
    syncActionState();
  }

  resetBtn.addEventListener('click', resetAll);
  if (resetAllBtn) resetAllBtn.addEventListener('click', resetAll);

  if (baSlider && baPreview) {
    const setSplit = (pct) => {
      baPreview.style.clipPath = `inset(0 0 0 ${pct}%)`;
      if (baHandle) baHandle.style.left = `${pct}%`;
    };
    baSlider.addEventListener('input', () => setSplit(Number(baSlider.value)));
    setSplit(50);
  }

  scrollToToolBtns.forEach((btn) => btn.addEventListener('click', (e) => {
    e.preventDefault();
    (document.getElementById('icrop-tool') || dropZone).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  if (stickyBar) stickyBar.classList.add('is-visible');

  // ---------- init ----------

  renderPresetGrid();
  toggleQualityVisibility();
  toggleResizeFields();
  syncActionState();
})();
