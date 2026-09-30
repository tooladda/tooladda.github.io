/* ToolAdda — JPG to PNG Converter.
   Pure image/byte-manipulation helpers (testable without a browser) are
   exposed on window.JpgToPngEngine; DOM wiring runs only when the page's
   [data-jpg-to-png-page] root is present. Everything is 100% client-side. */
(function (global) {
  'use strict';

  // ---------- PNG DPI metadata (pure byte manipulation, ported from the
  // Image Resizer's proven pHYs-chunk writer, no dependency between pages) ----------

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint32BE(target, offset, value) {
    target[offset] = (value >>> 24) & 0xff;
    target[offset + 1] = (value >>> 16) & 0xff;
    target[offset + 2] = (value >>> 8) & 0xff;
    target[offset + 3] = value & 0xff;
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  function isPng(bytes) { return PNG_SIGNATURE.every((b, i) => bytes[i] === b); }

  function stripPngChunk(bytes, typeName) {
    let offset = 8;
    const parts = [bytes.subarray(0, 8)];
    while (offset + 8 <= bytes.length) {
      const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      const chunkEnd = offset + 8 + length + 4;
      if (type !== typeName) parts.push(bytes.subarray(offset, chunkEnd));
      offset = chunkEnd;
    }
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    parts.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  /** Inserts (or replaces) a pHYs chunk right after IHDR, expressing DPI as pixels-per-meter. */
  function setPngDpi(bytes, dpi) {
    if (!isPng(bytes) || !dpi) return bytes;
    const pixelsPerMeter = Math.round(dpi / 0.0254);
    const ihdrLength = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];

    const body = new Uint8Array(9);
    writeUint32BE(body, 0, pixelsPerMeter);
    writeUint32BE(body, 4, pixelsPerMeter);
    body[8] = 1;

    const type = [0x70, 0x48, 0x59, 0x73]; // "pHYs"
    const crcInput = new Uint8Array(4 + 9);
    crcInput.set(type, 0);
    crcInput.set(body, 4);
    const crc = crc32(crcInput);

    const chunk = new Uint8Array(4 + 4 + 9 + 4);
    writeUint32BE(chunk, 0, 9);
    chunk.set(type, 4);
    chunk.set(body, 8);
    writeUint32BE(chunk, 17, crc);

    const withoutOldPhys = stripPngChunk(bytes, 'pHYs');
    const ihdrEnd = 8 + 4 + 4 + ihdrLength + 4;
    const insertAt = ihdrEnd <= withoutOldPhys.length ? ihdrEnd : withoutOldPhys.length;
    const out = new Uint8Array(withoutOldPhys.length + chunk.length);
    out.set(withoutOldPhys.subarray(0, insertAt), 0);
    out.set(chunk, insertAt);
    out.set(withoutOldPhys.subarray(insertAt), insertAt + chunk.length);
    return out;
  }

  function isJpeg(bytes) { return bytes[0] === 0xff && bytes[1] === 0xd8; }

  /** Reads the JFIF APP0 density fields, if present, returning DPI (or null). */
  function getJpegDpi(bytes) {
    if (!isJpeg(bytes)) return null;
    if (!(bytes[2] === 0xff && bytes[3] === 0xe0)) return null;
    const segmentLength = (bytes[4] << 8) | bytes[5];
    const isJfif = bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00;
    if (!isJfif || segmentLength < 14) return null;
    const units = bytes[13];
    const xDensity = (bytes[14] << 8) | bytes[15];
    if (!xDensity) return null;
    if (units === 1) return xDensity; // dots per inch
    if (units === 2) return Math.round(xDensity * 2.54); // dots per cm -> dpi
    return null;
  }

  // ---------- Chroma-key transparency (pure pixel manipulation) ----------

  const MAX_RGB_DISTANCE = Math.sqrt(255 * 255 * 3);

  /**
   * Marks pixels close to `targetRgb` as transparent, or replaces them with
   * `replaceRgb`, within `tolerancePercent` (0-100) Euclidean RGB distance.
   * Operates on a plain {data, width, height} object so it's unit-testable
   * without a browser Canvas/ImageData implementation.
   */
  function applyChromaKey(imageData, targetRgb, tolerancePercent, mode, replaceRgb) {
    const tolerance = (Math.max(0, Math.min(100, tolerancePercent)) / 100) * MAX_RGB_DISTANCE;
    const [tr, tg, tb] = targetRgb;
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - tr;
      const dg = data[i + 1] - tg;
      const db = data[i + 2] - tb;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      if (distance <= tolerance) {
        if (mode === 'replace' && replaceRgb) {
          data[i] = replaceRgb[0];
          data[i + 1] = replaceRgb[1];
          data[i + 2] = replaceRgb[2];
        } else {
          data[i + 3] = 0;
        }
      }
    }
    return imageData;
  }

  function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return [255, 255, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  const Engine = {
    crc32, setPngDpi, getJpegDpi, isPng, isJpeg, stripPngChunk,
    applyChromaKey, hexToRgb, formatBytes,
  };
  global.JpgToPngEngine = Engine;

  // ================= UI wiring (only runs when the page markup exists) =================

  const root = document.querySelector('[data-jpg-to-png-page]');
  if (!root) return;

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));

  const fileInput = $('[data-file-input]');
  const cameraInput = $('[data-camera-input]');
  const filePickers = $$('[data-file-picker]');
  const cameraBtn = $('[data-camera-btn]');
  const dropZone = $('[data-drop-zone]');
  const thumbGrid = $('[data-thumb-grid]');
  const previewPanel = $('[data-file-preview]');
  const fileCountText = $('[data-file-count]');

  const transparencyEnable = $('[data-transparency-enable]');
  const transparencyTarget = $('[data-transparency-target]');
  const transparencyTolerance = $('[data-transparency-tolerance]');
  const transparencyToleranceLabel = $('[data-transparency-tolerance-label]');
  const transparencyMode = $('[data-transparency-mode]');
  const transparencyReplaceWrap = $('[data-transparency-replace-wrap]');
  const transparencyReplaceColor = $('[data-transparency-replace-color]');

  const rotateSelect = $('[data-rotate]');
  const flipH = $('[data-flip-h]');
  const flipV = $('[data-flip-v]');

  const resizeEnable = $('[data-resize-enable]');
  const resizeWidth = $('[data-resize-width]');
  const resizeHeight = $('[data-resize-height]');
  const resizeAspect = $('[data-resize-aspect]');

  const dpiMode = $('[data-dpi-mode]');
  const dpiCustomWrap = $('[data-dpi-custom-wrap]');
  const dpiValue = $('[data-dpi-value]');
  const filenamePrefixInput = $('[data-filename-prefix]');

  const beforeAfterWrap = $('[data-before-after]');
  const beforeAfterOriginal = $('[data-ba-original]');
  const beforeAfterPreview = $('[data-ba-preview]');
  const beforeAfterSlider = $('[data-ba-slider]');
  const beforeAfterHandle = $('[data-ba-handle]');

  const convertButton = $('[data-convert-btn]');
  const downloadAllBtn = $('[data-download-all-btn]');
  const resetAllBtn = $('[data-reset-all-btn]');
  const resetButton = $('[data-reset-btn]');
  const messageBox = $('[data-message]');
  const loader = $('[data-loader]');
  const resultsContainer = $('[data-results-container]');
  const resultsList = $('[data-results-list]');
  const progressWrap = $('[data-progress-wrap]');
  const progressBar = $('[data-progress-bar]');
  const progressLabel = $('[data-progress-label]');
  const stickyBar = document.querySelector('[data-sticky-bar]');
  const stickyConvertBtn = document.querySelector('[data-sticky-convert]');
  const scrollToToolBtns = Array.from(document.querySelectorAll('[data-scroll-to-tool]'));

  let selectedFiles = [];
  let convertedImages = [];
  let activeUrls = [];
  let previewBitmap = null;

  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.classList.add('hidden');
    messageBox.classList.remove('success', 'error');
  };

  const showMessage = (text, type = 'success') => {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  };

  const setProgress = (current, total) => {
    if (!progressWrap) return;
    if (total <= 0) {
      progressWrap.classList.add('hidden');
      return;
    }
    progressWrap.classList.remove('hidden');
    const pct = Math.round((current / total) * 100);
    const done = current >= total;
    progressBar.style.width = `${pct}%`;
    progressBar.classList.toggle('is-complete', done);
    progressLabel.textContent = done ? 'Conversion complete' : `Converting ${current} of ${total}…`;
  };

  const syncConvertState = () => {
    const disabled = selectedFiles.length === 0;
    convertButton.disabled = disabled;
    if (stickyConvertBtn) stickyConvertBtn.disabled = disabled;
  };

  const toggleLoader = (visible) => {
    loader.classList.toggle('hidden', !visible);
    convertButton.disabled = visible;
    if (stickyConvertBtn) stickyConvertBtn.disabled = visible;
    filePickers.forEach((p) => { p.disabled = visible; });
    resetButton.disabled = visible;
    downloadAllBtn.disabled = visible;
  };

  function revokeAll() {
    activeUrls.forEach((u) => URL.revokeObjectURL(u));
    activeUrls = [];
  }

  const resetTool = () => {
    selectedFiles = [];
    convertedImages = [];
    previewBitmap = null;
    fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
    previewPanel.hidden = true;
    if (thumbGrid) { thumbGrid.hidden = true; thumbGrid.innerHTML = ''; }
    if (beforeAfterWrap) beforeAfterWrap.hidden = true;
    resultsContainer.classList.add('hidden');
    resultsList.innerHTML = '';
    downloadAllBtn.classList.add('hidden');
    if (resetAllBtn) resetAllBtn.classList.add('hidden');
    setProgress(0, 0);
    clearMessage();
    syncConvertState();
    revokeAll();
  };

  const bytesLabel = (n) => Engine.formatBytes(n);

  function isJpegFile(file) {
    return file.type === 'image/jpeg' || file.type === 'image/jpg' || /\.jpe?g$/i.test(file.name);
  }

  const renderThumbs = () => {
    if (!thumbGrid) return;
    if (!selectedFiles.length) { thumbGrid.hidden = true; thumbGrid.innerHTML = ''; return; }
    thumbGrid.hidden = false;
    thumbGrid.innerHTML = '';
    selectedFiles.forEach((file, index) => {
      const card = document.createElement('div');
      card.className = 'j2p-thumb';
      card.innerHTML = `
        <button type="button" class="j2p-thumb-remove" data-thumb-remove="${index}" aria-label="Remove ${file.name}">✕</button>
        <div class="j2p-thumb-icon">🖼️</div>
        <div class="j2p-thumb-name" title="${file.name}">${file.name}</div>
        <div class="j2p-thumb-meta">${bytesLabel(file.size)}</div>
      `;
      thumbGrid.appendChild(card);
    });
    thumbGrid.querySelectorAll('[data-thumb-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-thumb-remove'), 10);
        selectedFiles.splice(idx, 1);
        renderThumbs();
        renderPreview();
        syncConvertState();
        if (!selectedFiles.length) resetTool();
        else updateLivePreview();
      });
    });
  };

  const renderPreview = () => {
    if (!selectedFiles.length) { previewPanel.hidden = true; return; }
    previewPanel.hidden = false;
    fileCountText.textContent = `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`;
  };

  // ---------- settings readers ----------

  function getRotateDeg() { return rotateSelect ? parseInt(rotateSelect.value, 10) || 0 : 0; }
  function getFlip() { return { h: !!(flipH && flipH.checked), v: !!(flipV && flipV.checked) }; }

  function getResizedDims(naturalWidth, naturalHeight) {
    if (!resizeEnable || !resizeEnable.checked) return { width: naturalWidth, height: naturalHeight };
    const targetW = parseInt(resizeWidth.value, 10);
    const targetH = parseInt(resizeHeight.value, 10);
    const lockAspect = resizeAspect ? resizeAspect.checked : true;
    const ratio = naturalWidth / naturalHeight;
    if (lockAspect) {
      if (targetW > 0) return { width: targetW, height: Math.round(targetW / ratio) };
      if (targetH > 0) return { width: Math.round(targetH * ratio), height: targetH };
      return { width: naturalWidth, height: naturalHeight };
    }
    return { width: targetW > 0 ? targetW : naturalWidth, height: targetH > 0 ? targetH : naturalHeight };
  }

  function toggleTransparencyFields() {
    const on = transparencyEnable && transparencyEnable.checked;
    [transparencyTarget, transparencyTolerance, transparencyMode].forEach((el) => { if (el) el.disabled = !on; });
    if (transparencyReplaceWrap) transparencyReplaceWrap.hidden = !on || (transparencyMode && transparencyMode.value !== 'replace');
  }

  function toggleResizeFields() {
    const on = resizeEnable && resizeEnable.checked;
    [resizeWidth, resizeHeight, resizeAspect].forEach((el) => { if (el) el.disabled = !on; });
  }

  function toggleDpiField() {
    if (dpiCustomWrap) dpiCustomWrap.hidden = !dpiMode || dpiMode.value !== 'custom';
  }

  // ---------- core rendering pipeline: bitmap -> transformed canvas ----------

  async function loadBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      return createImageBitmap(file);
    }
  }

  function drawTransformed(bitmap) {
    const rotateDeg = getRotateDeg();
    const { h, v } = getFlip();
    const rotated90 = rotateDeg === 90 || rotateDeg === 270;
    const naturalW = rotated90 ? bitmap.height : bitmap.width;
    const naturalH = rotated90 ? bitmap.width : bitmap.height;
    const dims = getResizedDims(naturalW, naturalH);

    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    ctx.translate(dims.width / 2, dims.height / 2);
    ctx.rotate((rotateDeg * Math.PI) / 180);
    ctx.scale(h ? -1 : 1, v ? -1 : 1);
    const drawW = rotated90 ? dims.height : dims.width;
    const drawH = rotated90 ? dims.width : dims.height;
    ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    if (transparencyEnable && transparencyEnable.checked) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const target = Engine.hexToRgb(transparencyTarget.value);
      const tolerance = Number(transparencyTolerance.value || 20);
      const mode = transparencyMode.value;
      const replace = mode === 'replace' ? Engine.hexToRgb(transparencyReplaceColor.value) : null;
      Engine.applyChromaKey(imgData, target, tolerance, mode, replace);
      ctx.putImageData(imgData, 0, 0);
    }

    return canvas;
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Failed to encode PNG.')); return; }
        resolve(blob);
      }, 'image/png');
    });
  }

  async function applyDpi(blob, originalFile) {
    const mode = dpiMode ? dpiMode.value : 'keep';
    let dpi = null;
    if (mode === 'custom') dpi = parseInt(dpiValue.value, 10) || null;
    else if (mode === 'keep') {
      const buf = new Uint8Array(await originalFile.arrayBuffer());
      dpi = Engine.getJpegDpi(buf);
    }
    if (!dpi) return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const patched = Engine.setPngDpi(bytes, dpi);
    return new Blob([patched], { type: 'image/png' });
  }

  function applyFilenamePrefix(baseName) {
    const prefix = filenamePrefixInput ? filenamePrefixInput.value.trim().replace(/[\\/:*?"<>|]/g, '') : '';
    return prefix ? `${prefix}${baseName}` : baseName;
  }

  // ---------- live before/after preview (first selected file) ----------

  let previewDebounce;
  async function updateLivePreview() {
    if (!beforeAfterWrap) return;
    if (!selectedFiles.length) { beforeAfterWrap.hidden = true; return; }
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(async () => {
      try {
        const file = selectedFiles[0];
        if (!previewBitmap || previewBitmap.__file !== file) {
          if (previewBitmap) previewBitmap.close?.();
          previewBitmap = await loadBitmap(file);
          previewBitmap.__file = file;
          beforeAfterOriginal.src = URL.createObjectURL(file);
        }
        const canvas = drawTransformed(previewBitmap);
        beforeAfterPreview.src = canvas.toDataURL('image/png');
        beforeAfterWrap.hidden = false;
      } catch (e) { /* preview is best-effort */ }
    }, 150);
  }

  // ---------- results rendering ----------

  const scrollToResults = () => {
    requestAnimationFrame(() => {
      const target = document.getElementById('j2p-results-heading') || resultsContainer;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  };

  const displayResults = () => {
    resultsContainer.classList.remove('hidden');
    resultsList.innerHTML = '';
    convertedImages.forEach((result) => {
      const item = document.createElement('div');
      item.className = 'j2p-result-item';
      item.innerHTML = `
        <img class="j2p-result-thumb" src="${result.url}" alt="Converted PNG preview of ${result.originalName}" loading="lazy" />
        <div class="j2p-result-info">
          <p class="j2p-result-name">${result.convertedName}</p>
          <p class="j2p-result-meta">${bytesLabel(result.originalSize)} → ${bytesLabel(result.blob.size)} · ${result.width}×${result.height}px</p>
        </div>
        <a href="${result.url}" download="${result.convertedName}" class="secondary-btn" style="margin:0;padding:8px 16px;font-size:13px;">⬇️ Download</a>
      `;
      resultsList.appendChild(item);
    });
    if (convertedImages.length > 1) downloadAllBtn.classList.remove('hidden');
    if (resetAllBtn) resetAllBtn.classList.remove('hidden');
    scrollToResults();
  };

  async function convertOne(file) {
    const bitmap = await loadBitmap(file);
    const canvas = drawTransformed(bitmap);
    bitmap.close?.();
    let blob = await canvasToPngBlob(canvas);
    blob = await applyDpi(blob, file);
    const url = URL.createObjectURL(blob);
    activeUrls.push(url);
    const baseName = file.name.replace(/\.(jpe?g)$/i, '');
    return {
      blob, url,
      originalName: file.name,
      originalSize: file.size,
      convertedName: `${applyFilenamePrefix(baseName)}.png`,
      width: canvas.width,
      height: canvas.height,
    };
  }

  async function handleConvert() {
    if (!selectedFiles.length) { showMessage('Please select at least one JPG image.', 'error'); return; }
    try {
      clearMessage();
      toggleLoader(true);
      convertedImages = [];
      for (let i = 0; i < selectedFiles.length; i += 1) {
        setProgress(i, selectedFiles.length);
        showMessage(`Converting image ${i + 1} of ${selectedFiles.length}…`, 'success');
        try {
          convertedImages.push(await convertOne(selectedFiles[i]));
        } catch (err) {
          showMessage(`Failed to convert ${selectedFiles[i].name}: ${err.message}`, 'error');
        }
      }
      setProgress(selectedFiles.length, selectedFiles.length);
      if (!convertedImages.length) {
        showMessage('Failed to convert any images.', 'error');
        setProgress(0, 0);
        return;
      }
      displayResults();
      showMessage(`✅ Successfully converted ${convertedImages.length} image${convertedImages.length > 1 ? 's' : ''} to PNG!`, 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      toggleLoader(false);
    }
  }

  async function downloadAllImages() {
    if (!convertedImages.length) { showMessage('No images to download.', 'error'); return; }
    try {
      toggleLoader(true);
      showMessage('Creating ZIP file…', 'success');
      if (typeof JSZip === 'undefined') await loadJSZip();
      const zip = new JSZip();
      convertedImages.forEach((img) => zip.file(img.convertedName, img.blob));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob);
      activeUrls.push(url);
      const a = document.createElement('a');
      a.href = url; a.download = 'converted-png-images.zip'; a.click();
      showMessage('✅ ZIP file downloaded successfully!', 'success');
    } catch (err) {
      showMessage(`Failed to create ZIP: ${err.message}`, 'error');
    } finally {
      toggleLoader(false);
    }
  }

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

  function handleFileSelect(files) {
    if (!files || !files.length) return;
    const list = Array.from(files);
    for (const file of list) {
      if (!isJpegFile(file)) {
        showMessage(`⚠️ ${file.name} is not a JPG/JPEG file. Please select valid JPG images.`, 'error');
        return;
      }
    }
    selectedFiles = selectedFiles.concat(list);
    clearMessage();
    renderPreview();
    renderThumbs();
    syncConvertState();
    updateLivePreview();
    showMessage(`${selectedFiles.length} image${selectedFiles.length > 1 ? 's' : ''} selected. Click "Convert to PNG" to start.`, 'success');
  }

  // ---------- wiring ----------

  filePickers.forEach((picker) => picker.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); }));
  if (cameraBtn && cameraInput) cameraBtn.addEventListener('click', () => cameraInput.click());

  fileInput.addEventListener('change', (e) => { handleFileSelect(e.target.files); e.target.value = ''; });
  if (cameraInput) cameraInput.addEventListener('change', (e) => { handleFileSelect(e.target.files); e.target.value = ''; });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imageFiles = Array.from(items).filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile());
    if (imageFiles.length) handleFileSelect(imageFiles);
  });

  if (dropZone) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('active'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('active'); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('active');
      if (e.dataTransfer && e.dataTransfer.files) handleFileSelect(e.dataTransfer.files);
    });
  }

  convertButton.addEventListener('click', handleConvert);
  if (stickyConvertBtn) {
    stickyConvertBtn.addEventListener('click', () => {
      handleConvert();
    });
  }
  downloadAllBtn.addEventListener('click', downloadAllImages);
  resetButton.addEventListener('click', resetTool);
  if (resetAllBtn) resetAllBtn.addEventListener('click', resetTool);

  if (transparencyEnable) { transparencyEnable.addEventListener('change', () => { toggleTransparencyFields(); updateLivePreview(); }); toggleTransparencyFields(); }
  [transparencyTarget, transparencyMode, transparencyReplaceColor].forEach((el) => el && el.addEventListener('input', () => { toggleTransparencyFields(); updateLivePreview(); }));
  if (transparencyTolerance) transparencyTolerance.addEventListener('input', () => {
    if (transparencyToleranceLabel) transparencyToleranceLabel.textContent = `${transparencyTolerance.value}%`;
    updateLivePreview();
  });

  if (rotateSelect) rotateSelect.addEventListener('change', updateLivePreview);
  [flipH, flipV].forEach((el) => el && el.addEventListener('change', updateLivePreview));

  if (resizeEnable) resizeEnable.addEventListener('change', () => { toggleResizeFields(); updateLivePreview(); });
  [resizeWidth, resizeHeight, resizeAspect].forEach((el) => el && el.addEventListener('input', updateLivePreview));
  toggleResizeFields();

  if (dpiMode) dpiMode.addEventListener('change', toggleDpiField);
  toggleDpiField();

  if (beforeAfterSlider && beforeAfterPreview) {
    const setSplit = (pct) => {
      beforeAfterPreview.style.clipPath = `inset(0 0 0 ${pct}%)`;
      if (beforeAfterHandle) beforeAfterHandle.style.left = `${pct}%`;
    };
    beforeAfterSlider.addEventListener('input', () => setSplit(Number(beforeAfterSlider.value)));
    setSplit(50);
  }

  scrollToToolBtns.forEach((btn) => btn.addEventListener('click', (e) => {
    e.preventDefault();
    (document.getElementById('j2p-tool') || dropZone).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  if (stickyBar) stickyBar.classList.add('is-visible');
  syncConvertState();
  resetTool();
})(typeof window !== 'undefined' ? window : this);
