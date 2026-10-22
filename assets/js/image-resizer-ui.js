/* ToolAdda — Image Resizer Pro UI wiring.
   Depends on window.ImageResizerEngine (assets/js/image-resizer-engine.js).
   All decoding/resizing/encoding happens client-side; nothing is uploaded. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-ir-pro')) return;

  const $ = (id) => document.getElementById(id);
  const E = window.ImageResizerEngine;
  const WORKER_PIXEL_THRESHOLD = 180 * 180;
  const PREVIEW_DEBOUNCE_MS = 500;
  const MANUAL_DIM_DEBOUNCE_MS = 750;
  const MAX_PREVIEW_EDGE = 4096;
  const MAX_HISTORY = 12;
  const HISTORY_KEY = 'tooladda-image-resizer-history';

  const els = {
    dropZone: $('irDropZone'),
    fileInput: $('irFileInput'),
    cameraInput: $('irCameraInput'),
    cameraBtn: $('irCameraBtn'),
    pasteBtn: $('irPasteBtn'),
    urlInput: $('irUrlInput'),
    urlImportBtn: $('irUrlImportBtn'),

    queueList: $('irQueueList'),
    originalPreview: $('irOriginalPreview'),
    resizedPreview: $('irResizedPreview'),
    compareWrap: $('irCompareWrap'),
    compareRange: $('irCompareRange'),
    emptyState: $('irEmptyState'),
    workspace: $('irWorkspace'),

    fileName: $('irFileName'),
    fileSize: $('irFileSize'),
    fileDims: $('irFileDims'),
    fileFormat: $('irFileFormat'),
    fileDpi: $('irFileDpi'),

    resizeMode: $('irResizeMode'),
    widthInput: $('irWidthInput'),
    heightInput: $('irHeightInput'),
    percentRange: $('irPercentRange'),
    percentValue: $('irPercentValue'),
    lockRatio: $('irLockRatio'),
    cropAnchor: $('irCropAnchor'),
    cropAnchorWrap: $('irCropAnchorWrap'),
    percentWrap: $('irPercentWrap'),
    dimsWrap: $('irDimsWrap'),
    padToExact: $('irPadToExact'),
    padToExactWrap: $('irPadToExactWrap'),

    presetGrid: $('irPresetGrid'),
    presetTabs: document.querySelectorAll('[data-preset-tab]'),

    algorithm: $('irAlgorithm'),
    outputFormat: $('irOutputFormat'),
    qualityRange: $('irQualityRange'),
    qualityValue: $('irQualityValue'),
    qualityWrap: $('irQualityWrap'),
    dpiInput: $('irDpiInput'),
    backgroundColor: $('irBackgroundColor'),
    transparentBg: $('irTransparentBg'),
    bgColorWrap: $('irBgColorWrap'),

    resizeBtn: $('irResizeBtn'),
    stickyResizeBtn: $('irStickyResizeBtn'),
    stickyStatus: $('irStickyStatus'),
    downloadBtn: $('irDownloadBtn'),
    downloadZipBtn: $('irDownloadZipBtn'),
    resetBtn: $('irResetBtn'),

    resultDims: $('irResultDims'),
    resultSize: $('irResultSize'),
    resultSavings: $('irResultSavings'),
    progressBar: $('irProgressBar'),

    historyList: $('irHistoryList'),
    srStatus: $('irSrStatus'),
    statusMsg: $('irStatusMsg'),
  };

  const state = {
    items: [], // { file, bitmap, width, height, mime, dpi, resultBlob, resultUrl, resultWidth, resultHeight }
    activeIndex: -1,
    worker: null,
    workerReady: false,
    activePresetId: null,
  };

  let suppressManualModeSwitch = false;

  function announce(msg, tone) {
    if (els.srStatus) els.srStatus.textContent = msg;
    if (!els.statusMsg) return;
    if (!msg) {
      els.statusMsg.hidden = true;
      els.statusMsg.textContent = '';
      return;
    }
    els.statusMsg.hidden = false;
    els.statusMsg.textContent = msg;
    els.statusMsg.classList.toggle('is-info', tone === 'info');
  }

  function refreshElements() {
    els.dropZone = $('irDropZone');
    els.fileInput = $('irFileInput');
    els.cameraInput = $('irCameraInput');
    els.cameraBtn = $('irCameraBtn');
    els.pasteBtn = $('irPasteBtn');
    els.urlInput = $('irUrlInput');
    els.urlImportBtn = $('irUrlImportBtn');
    els.queueList = $('irQueueList');
    els.originalPreview = $('irOriginalPreview');
    els.resizedPreview = $('irResizedPreview');
    els.compareWrap = $('irCompareWrap');
    els.compareRange = $('irCompareRange');
    els.emptyState = $('irEmptyState');
    els.workspace = $('irWorkspace');
    els.fileName = $('irFileName');
    els.fileSize = $('irFileSize');
    els.fileDims = $('irFileDims');
    els.fileFormat = $('irFileFormat');
    els.fileDpi = $('irFileDpi');
    els.resizeMode = $('irResizeMode');
    els.widthInput = $('irWidthInput');
    els.heightInput = $('irHeightInput');
    els.percentRange = $('irPercentRange');
    els.percentValue = $('irPercentValue');
    els.lockRatio = $('irLockRatio');
    els.cropAnchor = $('irCropAnchor');
    els.cropAnchorWrap = $('irCropAnchorWrap');
    els.percentWrap = $('irPercentWrap');
    els.dimsWrap = $('irDimsWrap');
    els.padToExact = $('irPadToExact');
    els.padToExactWrap = $('irPadToExactWrap');
    els.presetGrid = $('irPresetGrid');
    els.presetTabs = document.querySelectorAll('[data-preset-tab]');
    els.algorithm = $('irAlgorithm');
    els.outputFormat = $('irOutputFormat');
    els.qualityRange = $('irQualityRange');
    els.qualityValue = $('irQualityValue');
    els.qualityWrap = $('irQualityWrap');
    els.dpiInput = $('irDpiInput');
    els.backgroundColor = $('irBackgroundColor');
    els.transparentBg = $('irTransparentBg');
    els.bgColorWrap = $('irBgColorWrap');
    els.resizeBtn = $('irResizeBtn');
    els.stickyResizeBtn = $('irStickyResizeBtn');
    els.stickyStatus = $('irStickyStatus');
    els.downloadBtn = $('irDownloadBtn');
    els.downloadZipBtn = $('irDownloadZipBtn');
    els.resetBtn = $('irResetBtn');
    els.resultDims = $('irResultDims');
    els.resultSize = $('irResultSize');
    els.resultSavings = $('irResultSavings');
    els.progressBar = $('irProgressBar');
    els.historyList = $('irHistoryList');
    els.srStatus = $('irSrStatus');
    els.statusMsg = $('irStatusMsg');
  }

  function syncCompareSlider() {
    refreshElements();
    if (els.compareWrap && els.compareRange) {
      els.compareWrap.style.setProperty('--ir-reveal', els.compareRange.value + '%');
    }
  }

  function previewLive(immediate, debounceMs) {
    scheduleLivePreview(immediate, debounceMs);
  }

  let liveDebounce;
  let previewGeneration = 0;

  function scheduleLivePreview(immediate, debounceMs) {
    if (!state.items.length || !E) return;
    clearTimeout(liveDebounce);
    const delay = typeof debounceMs === 'number' ? debounceMs : PREVIEW_DEBOUNCE_MS;
    const fire = () => {
      const generation = ++previewGeneration;
      runPreviewActive(generation);
    };
    if (immediate) {
      fire();
      return;
    }
    liveDebounce = setTimeout(fire, delay);
  }

  function isValidSettings(settings) {
    if (settings.resizeMode === 'percent') return settings.percent > 0;
    return (settings.width > 0 || settings.height > 0);
  }

  function normalizeEncodeMime(mime) {
    const m = (mime || '').toLowerCase();
    if (m === 'image/jpg') return 'image/jpeg';
    if (m === 'image/jpeg' || m === 'image/png' || m === 'image/webp') return m;
    return 'image/png';
  }

  function canvasToBlob(canvas, mime, quality) {
    const encodeMime = normalizeEncodeMime(mime);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview encoding timed out.')), 15000);
      canvas.toBlob(
        (blob) => {
          clearTimeout(timer);
          if (!blob) {
            reject(new Error('Could not encode preview.'));
            return;
          }
          resolve(blob);
        },
        encodeMime,
        quality
      );
    });
  }

  function formatBytes(n) {
    return E ? E.formatBytes(n) : String(n);
  }

  // ---------- worker (safe fallback if unavailable) ----------

  function initWorker() {
    if (typeof Worker === 'undefined') return;
    try {
      state.worker = new Worker('assets/js/image-resizer-worker.js');
      state.workerReady = true;
    } catch (e) {
      state.worker = null;
      state.workerReady = false;
    }
  }

  let workerCallId = 0;
  function resampleViaWorker(src, destW, destH, algorithm) {
    return new Promise((resolve) => {
      if (!state.workerReady || !state.worker) {
        resolve(E.resample(algorithm, src, destW, destH));
        return;
      }
      const id = ++workerCallId;
      const timeout = setTimeout(() => {
        cleanup();
        resolve(E.resample(algorithm, src, destW, destH)); // fall back if the worker stalls
      }, 15000);
      function handler(event) {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.ok) {
          resolve({ data: new Uint8ClampedArray(event.data.data), width: event.data.width, height: event.data.height });
        } else {
          resolve(E.resample(algorithm, src, destW, destH));
        }
      }
      function cleanup() {
        clearTimeout(timeout);
        state.worker.removeEventListener('message', handler);
      }
      state.worker.addEventListener('message', handler);
      try {
        const copy = new Uint8ClampedArray(src.data);
        state.worker.postMessage(
          { id, algorithm, data: copy.buffer, width: src.width, height: src.height, destWidth: destW, destHeight: destH },
          [copy.buffer]
        );
      } catch (e) {
        cleanup();
        resolve(E.resample(algorithm, src, destW, destH));
      }
    });
  }

  async function resampleSmart(src, destW, destH, algorithm) {
    const destPixels = destW * destH;
    const srcPixels = src.width * src.height;
    const isHeavy = algorithm === 'lanczos' || algorithm === 'bicubic';
    const useWorker = isHeavy || destPixels >= WORKER_PIXEL_THRESHOLD || srcPixels >= WORKER_PIXEL_THRESHOLD;
    if (!useWorker) return E.resample(algorithm, src, destW, destH);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return resampleViaWorker(src, destW, destH, algorithm);
  }

  // ---------- settings ----------

  function parseDimValue(input) {
    if (!input) return 0;
    const raw = String(input.value ?? '').trim();
    if (!raw) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n);
  }

  function getSettings() {
    return {
      resizeMode: els.resizeMode ? els.resizeMode.value : 'fit',
      width: parseDimValue(els.widthInput),
      height: parseDimValue(els.heightInput),
      percent: Number(els.percentRange?.value) || 100,
      lockRatio: !!(els.lockRatio && els.lockRatio.checked),
      cropAnchor: els.cropAnchor ? els.cropAnchor.value : 'center',
      padToExact: !!(els.padToExact && els.padToExact.checked),
      algorithm: els.algorithm ? els.algorithm.value : 'bicubic',
      outputFormat: els.outputFormat ? els.outputFormat.value : 'auto',
      quality: Number(els.qualityRange?.value) / 100 || 0.9,
      dpi: Number(els.dpiInput?.value) || 0,
      backgroundColor: els.backgroundColor ? els.backgroundColor.value : '#ffffff',
      transparentBg: !!(els.transparentBg && els.transparentBg.checked),
    };
  }

  function syncModeVisibility() {
    const mode = els.resizeMode ? els.resizeMode.value : 'fit';
    if (els.percentWrap) els.percentWrap.hidden = mode !== 'percent';
    if (els.dimsWrap) els.dimsWrap.hidden = mode === 'percent';
    if (els.cropAnchorWrap) els.cropAnchorWrap.hidden = mode !== 'crop';
    if (els.padToExactWrap) els.padToExactWrap.hidden = mode !== 'fit';
  }

  function syncFormatVisibility() {
    const format = getSelectedOutputMime();
    const supportsAlpha = format === 'image/png' || format === 'image/webp';
    if (els.transparentBg) els.transparentBg.disabled = !supportsAlpha;
    const showQuality = format === 'image/jpeg' || format === 'image/webp';
    if (els.qualityWrap) els.qualityWrap.hidden = !showQuality;
    const transparentOn = !!(els.transparentBg && els.transparentBg.checked && supportsAlpha);
    if (els.bgColorWrap) els.bgColorWrap.hidden = transparentOn;
  }

  /* Named apart from getOutputMime(item, settings) below: both were called
     getOutputMime, both were hoisted, and the two-argument one won - so this
     no-argument call threw during init() and silently skipped every handler
     binding that followed it. */
  function getSelectedOutputMime() {
    const val = els.outputFormat ? els.outputFormat.value : 'auto';
    if (val === 'auto') return state.items[state.activeIndex]?.mime || 'image/jpeg';
    return val;
  }

  // ---------- image loading ----------

  function isImageFile(file) {
    if (!file) return false;
    const type = (file.type || '').toLowerCase();
    if (type.startsWith('image/')) return true;
    if (file._irFromUrl || file._irFromCamera) return true;
    if (type === 'application/octet-stream' || !type) {
      return /\.(heic|heif|jpe?g|png|gif|webp|bmp|svg|avif|tiff?)$/i.test(file.name || '');
    }
    return /\.(heic|heif|jpe?g|png|gif|webp|bmp|svg|avif|tiff?)$/i.test(file.name || '');
  }

  function normalizeUploadFile(file, options = {}) {
    if (!file) return file;
    const rawType = (file.type || '').toLowerCase();
    const mime = rawType.startsWith('image/') ? rawType : 'image/jpeg';
    let name = file.name || (options.camera ? `camera-${Date.now()}.jpg` : `photo-${Date.now()}.jpg`);
    if (!/\.(heic|heif|jpe?g|png|gif|webp|bmp|svg|avif|tiff?)$/i.test(name)) {
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
      name = `${name.replace(/\.+$/, '')}.${ext}`;
    }
    const normalized = (rawType === mime && name === file.name)
      ? file
      : new File([file], name, { type: mime, lastModified: file.lastModified || Date.now() });
    if (options.camera) normalized._irFromCamera = true;
    return normalized;
  }

  function syncItemDimensions(item) {
    if (item.bitmap) {
      item.width = item.bitmap.width;
      item.height = item.bitmap.height;
    }
    return item;
  }

  function urlImportFileName(url, mime) {
    let name = url.split('/').pop()?.split('?')[0]?.split('#')[0] || 'imported-image';
    if (!/\.(heic|heif|jpe?g|png|gif|webp|bmp|svg|avif|tiff?)$/i.test(name)) {
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
      name = `${name}.${ext}`;
    }
    return name;
  }

  async function fileFromBitmap(bitmap, name, type) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const mime = type || 'image/png';
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode imported image.'))), mime);
    });
    const file = new File([blob], name, { type: mime });
    file._irFromUrl = true;
    return file;
  }

  function buildItemFromBitmap(file, bitmap) {
    return syncItemDimensions({
      file,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      mime: file.type || 'image/jpeg',
      dpi: null,
      resultBlob: null,
      resultUrl: null,
      previewResultBlob: null,
      previewResultUrl: null,
      resultWidth: 0,
      resultHeight: 0,
    });
  }

  async function decodeUploadFile(file) {
    const isHeic = /image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    const decodableFile = isHeic ? await convertHeicToJpeg(file) : file;
    return syncItemDimensions(await decodeFile(decodableFile));
  }

  async function appendLoadedItem(item) {
    state.items.push(syncItemDimensions(item));
    state.activeIndex = state.items.length - 1;
    renderQueue();
    if (els.emptyState) els.emptyState.hidden = true;
    if (els.workspace) els.workspace.hidden = false;
    bindWorkspaceHandlers();
    bindStickyBar();
    bindCompareSlider();
    syncCompareSlider();
    try {
      await selectActive(state.activeIndex);
    } catch (err) {
      announce((err && err.message) || 'Could not display the image.');
    }
  }

  async function addCameraFiles(fileList) {
    if (!E) {
      announce('Resize engine failed to load. Hard-refresh the page (Ctrl+Shift+R).');
      return;
    }
    const files = Array.from(fileList || []).map((f) => normalizeUploadFile(f, { camera: true }));
    if (!files.length) {
      announce('No camera photo received.');
      return;
    }
    announce('Loading camera photo…', 'info');
    for (const file of files) {
      try {
        await appendLoadedItem(await decodeUploadFile(file));
      } catch (err) {
        announce((err && err.message) || 'Could not load the camera photo.');
      }
    }
    if (els.cameraInput) els.cameraInput.value = '';
    if (state.items.length) announce('', 'info');
  }

  async function addCapturedBitmap(bitmap) {
    if (!E) {
      announce('Resize engine failed to load. Hard-refresh the page (Ctrl+Shift+R).');
      return;
    }
    const file = await fileFromBitmap(bitmap, `camera-${Date.now()}.jpg`, 'image/jpeg');
    file._irFromCamera = true;
    await appendLoadedItem(buildItemFromBitmap(file, bitmap));
    announce('', 'info');
  }

  async function bitmapFromImageUrl(url, useCors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          resolve(await createImageBitmap(img));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Could not load image from that URL.'));
      img.src = url;
    });
  }

  async function bitmapFromBlob(blob) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (e) {
      return createImageBitmap(blob);
    }
  }

  async function decodeFile(file) {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      try {
        bitmap = await createImageBitmap(file);
      } catch (e2) {
        bitmap = await decodeViaImageElement(file);
      }
    }
    if (!bitmap) throw new Error(`Could not decode "${file.name}" — the file may be corrupted or an unsupported format.`);
    let dpi = null;
    if (E && (file.type === 'image/png' || file.type === 'image/jpeg' || /\.(jpe?g|png)$/i.test(file.name || ''))) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
        dpi = E.getImageDpi(bytes, mime);
      } catch (e) {
        dpi = null;
      }
    }
    return {
      file,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      mime: file.type || 'image/jpeg',
      dpi,
      resultBlob: null,
      resultUrl: null,
      previewResultBlob: null,
      previewResultUrl: null,
      resultWidth: 0,
      resultHeight: 0,
    };
  }

  function decodeViaImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          createImageBitmap(canvas).then(resolve).catch(reject);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image.'));
      };
      img.src = url;
    });
  }

  async function addFiles(fileList) {
    if (!E) {
      announce('Resize engine failed to load. Hard-refresh the page (Ctrl+Shift+R).');
      return;
    }
    const files = Array.from(fileList || []).map((f) => normalizeUploadFile(f)).filter(isImageFile);
    if (!files.length) {
      announce('No supported image files found. Try JPG, PNG, or WebP.');
      return;
    }
    announce(`Loading ${files.length > 1 ? files.length + ' images' : 'image'}…`, 'info');
    const startCount = state.items.length;
    for (const file of files) {
      try {
        state.items.push(await decodeUploadFile(file));
      } catch (err) {
        announce((err && err.message) || `Could not load ${file.name}`);
      }
    }
    if (state.items.length > startCount) {
      state.activeIndex = state.items.length - 1;
    } else if (state.activeIndex === -1 && state.items.length) {
      state.activeIndex = 0;
    }
    renderQueue();
    try {
      if (state.activeIndex >= 0) await selectActive(state.activeIndex);
    } catch (err) {
      announce((err && err.message) || 'Could not display the image.');
    }
    if (els.emptyState) els.emptyState.hidden = state.items.length > 0;
    if (els.workspace) els.workspace.hidden = state.items.length === 0;
    if (els.fileInput) els.fileInput.value = '';
    if (els.cameraInput) els.cameraInput.value = '';
    if (state.items.length) {
      bindWorkspaceHandlers();
      bindStickyBar();
      bindCompareSlider();
      syncCompareSlider();
      announce('', 'info');
    }
  }

  function loadHeic2Any() {
    return new Promise((resolve, reject) => {
      if (window.heic2any) { resolve(window.heic2any); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      s.onload = () => resolve(window.heic2any);
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  async function convertHeicToJpeg(file) {
    const heic2any = await loadHeic2Any();
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
  }

  // ---------- queue UI ----------

  function renderQueue() {
    if (!els.queueList) return;
    els.queueList.innerHTML = '';
    if (state.items.length < 2) {
      els.queueList.hidden = true;
      return;
    }
    els.queueList.hidden = false;
    state.items.forEach((item, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ir-queue-item' + (i === state.activeIndex ? ' is-active' : '');
      btn.innerHTML = `<span>${escapeHtml(item.file.name)}</span><span class="ir-queue-meta">${item.width}×${item.height}</span>`;
      btn.addEventListener('click', () => selectActive(i));
      li.appendChild(btn);
      els.queueList.appendChild(li);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function selectActive(index) {
    state.activeIndex = index;
    const item = state.items[index];
    if (!item) return;
    syncItemDimensions(item);
    if (els.fileName) els.fileName.textContent = item.file.name;
    if (els.fileSize) els.fileSize.textContent = formatBytes(item.file.size);
    if (els.fileDims) els.fileDims.textContent = `${item.width} × ${item.height}px`;
    if (els.fileFormat) els.fileFormat.textContent = (item.mime || '').replace('image/', '').toUpperCase() || '—';
    if (els.fileDpi) els.fileDpi.textContent = item.dpi ? `${item.dpi} DPI` : 'Not specified';

    // Each queued image can have different native dimensions, so reset the
    // width/height fields to this item's own size whenever it becomes active.
    suppressManualModeSwitch = true;
    if (els.widthInput) els.widthInput.value = item.width;
    if (els.heightInput) els.heightInput.value = item.height;
    suppressManualModeSwitch = false;

    if (els.originalPreview) els.originalPreview.src = item.previewUrl || (item.previewUrl = URL.createObjectURL(item.file));
    if (els.resizedPreview) {
      els.resizedPreview.src = item.resultUrl || item.previewResultUrl || item.previewUrl;
    }
    renderQueue();

    // Each queued item has its own result (or none yet) — reflect THIS item's
    // state rather than leaving stale numbers/an enabled Download button from
    // whichever item was active before, which could otherwise download the
    // wrong file.
    if (item.resultBlob) {
      if (els.resultDims) els.resultDims.textContent = `${item.resultWidth} × ${item.resultHeight}px`;
      if (els.resultSize) els.resultSize.textContent = formatBytes(item.resultBlob.size);
    } else {
      if (els.resultDims) els.resultDims.textContent = '—';
      if (els.resultSize) els.resultSize.textContent = '—';
      if (els.resultSavings) els.resultSavings.textContent = '—';
    }
    syncDownloadButtons();
    syncStickyBar();
    syncCompareSlider();
    scheduleLivePreview(true);
  }

  function clearActivePreset() {
    if (!state.activePresetId) return;
    state.activePresetId = null;
    els.presetGrid?.querySelectorAll('.ir-preset-chip.is-active').forEach((c) => c.classList.remove('is-active'));
  }

  function applyLockRatio(changedId) {
    if (!els.lockRatio?.checked) return;
    const item = state.items[state.activeIndex];
    if (!item) return;
    if (changedId === 'irWidthInput' && els.widthInput && els.heightInput) {
      const h = E.deriveLockedDimension(item.width, item.height, 'width', parseDimValue(els.widthInput));
      if (h) els.heightInput.value = h;
    } else if (changedId === 'irHeightInput' && els.widthInput && els.heightInput) {
      const w = E.deriveLockedDimension(item.width, item.height, 'height', parseDimValue(els.heightInput));
      if (w) els.widthInput.value = w;
    }
  }

  function maybeSwitchToStretchForManual() {
    if (suppressManualModeSwitch || !els.resizeMode) return;
    const mode = els.resizeMode.value;
    if (mode === 'fit' || mode === 'fill') {
      els.resizeMode.value = 'stretch';
      syncModeVisibility();
    }
  }

  function resolveManualBox(item, settings) {
    const srcW = item.width;
    const srcH = item.height;
    let w = settings.width > 0 ? settings.width : 0;
    let h = settings.height > 0 ? settings.height : 0;

    if (settings.lockRatio) {
      if (w > 0 && h <= 0) {
        h = E.deriveLockedDimension(srcW, srcH, 'width', w);
      } else if (h > 0 && w <= 0) {
        w = E.deriveLockedDimension(srcW, srcH, 'height', h);
      }
    } else if (w > 0 && h <= 0) {
      h = Math.max(1, Math.round((w / srcW) * srcH));
    } else if (h > 0 && w <= 0) {
      w = Math.max(1, Math.round((h / srcH) * srcW));
    }

    if (w <= 0) w = srcW;
    if (h <= 0) h = srcH;
    return { width: w, height: h };
  }

  function handleManualDimensionInput(changedId, immediate) {
    if (!state.items.length) return;
    refreshElements();
    clearActivePreset();
    applyLockRatio(changedId);
    maybeSwitchToStretchForManual();
    previewLive(immediate, immediate ? undefined : MANUAL_DIM_DEBOUNCE_MS);
  }

  function syncDownloadButtons() {
    refreshElements();
    const item = state.items[state.activeIndex];
    const hasPreview = !!(item && (item.resultBlob || item.previewResultBlob));
    const batchReady = state.items.some((i) => i.resultBlob || i.previewResultBlob);
    [els.downloadBtn, els.downloadZipBtn].forEach((btn, i) => {
      if (!btn) return;
      const ready = i === 0 ? hasPreview : batchReady;
      btn.disabled = false;
      btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
      btn.classList.toggle('is-disabled', !ready);
    });
  }

  function applyPresetById(presetId) {
    const preset = E.ALL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    refreshElements();
    suppressManualModeSwitch = true;
    if (els.resizeMode) els.resizeMode.value = 'fill';
    if (els.widthInput) els.widthInput.value = preset.width;
    if (els.heightInput) els.heightInput.value = preset.height;
    if (els.lockRatio) els.lockRatio.checked = false;
    if (els.dpiInput && (preset.category === 'Print' || preset.category === 'ID Photo')) {
      els.dpiInput.value = 300;
    }
    suppressManualModeSwitch = false;
    state.activePresetId = preset.id;
    els.presetGrid?.querySelectorAll('.ir-preset-chip').forEach((c) => {
      c.classList.toggle('is-active', c.dataset.presetId === preset.id);
    });
    syncModeVisibility();
    announce(`Applied preset: ${preset.label}`, 'info');
    scheduleLivePreview(true);
  }

  function onWorkspaceClick(e) {
    refreshElements();
    const tab = e.target.closest('[data-preset-tab]');
    if (tab) {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('[data-preset-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
      renderPresets(tab.dataset.presetTab || 'Instagram');
      return;
    }
    const chip = e.target.closest('.ir-preset-chip');
    if (chip?.dataset.presetId) {
      e.preventDefault();
      applyPresetById(chip.dataset.presetId);
      return;
    }
    if (e.target.closest('#irResizeBtn')) {
      e.preventDefault();
      state.items.length > 1 ? runResizeAll() : runResizeActive();
      return;
    }
    if (e.target.closest('#irDownloadBtn')) {
      e.preventDefault();
      downloadActive();
      return;
    }
    if (e.target.closest('#irDownloadZipBtn')) {
      e.preventDefault();
      downloadZip();
      return;
    }
    if (e.target.closest('#irResetBtn')) {
      e.preventDefault();
      resetAll();
    }
  }

  function onWorkspaceInput(e) {
    const t = e.target;
    if (t.id === 'irCompareRange') {
      syncCompareSlider();
      return;
    }
    if (t.id === 'irWidthInput' || t.id === 'irHeightInput') {
      handleManualDimensionInput(t.id, false);
      return;
    }
    if (t.id === 'irPercentRange') {
      refreshElements();
      if (els.percentValue) els.percentValue.textContent = t.value + '%';
      previewLive(false, MANUAL_DIM_DEBOUNCE_MS);
      return;
    }
    if (t.id === 'irQualityRange') {
      refreshElements();
      if (els.qualityValue) els.qualityValue.textContent = t.value + '%';
      previewLive();
    }
  }

  function onWorkspaceChange(e) {
    refreshElements();
    const t = e.target;
    if (t.id === 'irWidthInput' || t.id === 'irHeightInput') {
      handleManualDimensionInput(t.id, true);
      return;
    }
    if (t.id === 'irCompareRange') {
      syncCompareSlider();
      return;
    }
    if (t.id === 'irResizeMode') {
      clearActivePreset();
      syncModeVisibility();
      previewLive(true);
      return;
    }
    if (t.id === 'irOutputFormat') {
      syncFormatVisibility();
      previewLive(true);
      return;
    }
    if (t.id === 'irTransparentBg') {
      syncFormatVisibility();
      previewLive(true);
      return;
    }
    if (t.id === 'irPercentRange') {
      if (els.percentValue) els.percentValue.textContent = t.value + '%';
      previewLive(true);
      return;
    }
    if (t.id === 'irLockRatio') {
      applyLockRatio('irWidthInput');
      previewLive(true);
      return;
    }
    if (t.id === 'irCropAnchor' || t.id === 'irPadToExact') {
      previewLive(true);
      return;
    }
    if (t.id === 'irAlgorithm' || t.id === 'irDpiInput' || t.id === 'irBackgroundColor') {
      previewLive(true);
    }
  }

  function onWorkspaceKeydown(e) {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'irWidthInput' || e.target.id === 'irHeightInput') {
      e.preventDefault();
      handleManualDimensionInput(e.target.id, true);
    }
  }

  function bindCompareSlider() {
    refreshElements();
    if (!els.compareRange || els.compareRange.dataset.irBound === '1') return;
    els.compareRange.dataset.irBound = '1';
    els.compareRange.addEventListener('input', syncCompareSlider);
    els.compareRange.addEventListener('change', syncCompareSlider);
  }

  function bindWorkspaceHandlers() {
    refreshElements();
    const workspace = els.workspace || document.getElementById('irWorkspace');
    if (!workspace || workspace.dataset.irBound === '1') return;
    workspace.dataset.irBound = '1';
    workspace.addEventListener('click', onWorkspaceClick);
    workspace.addEventListener('input', onWorkspaceInput);
    workspace.addEventListener('change', onWorkspaceChange);
    workspace.addEventListener('keydown', onWorkspaceKeydown);
    bindCompareSlider();
  }

  function bindStickyBar() {
    const btn = document.getElementById('irStickyResizeBtn');
    if (!btn || btn.dataset.irBound === '1') return;
    btn.dataset.irBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      refreshElements();
      const item = state.items[state.activeIndex];
      if (item?.resultBlob || item?.previewResultBlob) {
        downloadActive();
        return;
      }
      state.items.length > 1 ? runResizeAll() : runResizeActive();
    });
  }

  // ---------- resize pipeline ----------

  function computeDimensions(item, settings, preview) {
    const { width: srcW, height: srcH } = item;
    const box = resolveManualBox(item, settings);
    let targetW;
    let targetH;
    let cropRect = null;

    if (settings.resizeMode === 'percent') {
      const d = E.computeByPercent(srcW, srcH, settings.percent);
      targetW = d.width; targetH = d.height;
    } else if (settings.resizeMode === 'fit') {
      const d = E.computeContain(srcW, srcH, box.width, box.height);
      targetW = d.width; targetH = d.height;
    } else if (settings.resizeMode === 'fill') {
      const d = E.computeCover(srcW, srcH, box.width, box.height);
      targetW = d.width; targetH = d.height; cropRect = d.crop;
    } else if (settings.resizeMode === 'crop') {
      const d = E.computeCrop(srcW, srcH, box.width, box.height, settings.cropAnchor);
      targetW = d.width; targetH = d.height; cropRect = d.crop;
    } else {
      const d = E.computeStretch(box.width, box.height);
      targetW = d.width; targetH = d.height;
    }

    if (preview) {
      const maxEdge = Math.max(targetW, targetH);
      if (maxEdge > MAX_PREVIEW_EDGE) {
        const scale = MAX_PREVIEW_EDGE / maxEdge;
        targetW = Math.max(1, Math.round(targetW * scale));
        targetH = Math.max(1, Math.round(targetH * scale));
      }
    }

    const shouldPad = settings.resizeMode === 'fit' && settings.padToExact && settings.width > 0 && settings.height > 0;
    const boxW = shouldPad ? box.width : targetW;
    const boxH = shouldPad ? box.height : targetH;
    return { targetW, targetH, boxW, boxH, cropRect, shouldPad };
  }

  function getOutputMime(item, settings) {
    const raw = settings.outputFormat === 'auto' ? (item.mime || 'image/jpeg') : settings.outputFormat;
    if (!raw || raw === 'application/octet-stream') return 'image/jpeg';
    return raw;
  }

  function prepareOutputCanvas(boxW, boxH, mime, settings, shouldPad) {
    const outCanvas = document.createElement('canvas');
    outCanvas.width = boxW;
    outCanvas.height = boxH;
    const outCtx = outCanvas.getContext('2d');
    const encodeMime = normalizeEncodeMime(mime);
    const needsOpaqueBackground = shouldPad ? !settings.transparentBg || encodeMime === 'image/jpeg' : encodeMime === 'image/jpeg';
    if (needsOpaqueBackground) {
      outCtx.fillStyle = settings.backgroundColor || '#ffffff';
      outCtx.fillRect(0, 0, boxW, boxH);
    }
    return { outCanvas, outCtx };
  }

  function drawScaledBitmap(outCtx, item, cropRect, targetW, targetH, boxW, boxH, algorithm) {
    const srcW = item.bitmap?.width || item.width;
    const srcH = item.bitmap?.height || item.height;
    const sx = cropRect ? Math.max(0, Math.round(cropRect.x)) : 0;
    const sy = cropRect ? Math.max(0, Math.round(cropRect.y)) : 0;
    const sw = cropRect ? Math.max(1, Math.round(cropRect.width)) : srcW;
    const sh = cropRect ? Math.max(1, Math.round(cropRect.height)) : srcH;
    const offsetX = Math.round((boxW - targetW) / 2);
    const offsetY = Math.round((boxH - targetH) / 2);
    outCtx.imageSmoothingEnabled = algorithm !== 'nearest';
    if (outCtx.imageSmoothingEnabled) {
      outCtx.imageSmoothingQuality = algorithm === 'lanczos' || algorithm === 'bicubic' ? 'high' : 'medium';
    }
    outCtx.drawImage(item.bitmap, sx, sy, sw, sh, offsetX, offsetY, targetW, targetH);
  }

  function getSourceRegion(item, cropRect) {
    const srcW = item.bitmap?.width || item.width;
    const srcH = item.bitmap?.height || item.height;
    const w = cropRect ? Math.max(1, Math.round(cropRect.width)) : srcW;
    const h = cropRect ? Math.max(1, Math.round(cropRect.height)) : srcH;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (cropRect) {
      ctx.drawImage(
        item.bitmap,
        Math.max(0, Math.round(cropRect.x)),
        Math.max(0, Math.round(cropRect.y)),
        w,
        h,
        0,
        0,
        w,
        h
      );
    } else {
      ctx.drawImage(item.bitmap, 0, 0);
    }
    return ctx.getImageData(0, 0, w, h);
  }

  async function encodeCanvas(outCanvas, mime, settings, preview) {
    const encodeMime = normalizeEncodeMime(mime);
    const quality = encodeMime === 'image/png' ? undefined : (preview ? Math.min(settings.quality, 0.82) : settings.quality);
    return canvasToBlob(outCanvas, encodeMime, quality);
  }

  async function applyDpi(blob, mime, settings, preview) {
    const normalized = normalizeEncodeMime(mime);
    if (preview || !settings.dpi || (normalized !== 'image/png' && normalized !== 'image/jpeg')) return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const patched = E.setImageDpi(bytes, normalized, settings.dpi);
    return new Blob([patched], { type: normalized });
  }

  async function computePipelineCanvas(item, settings, preview) {
    const dims = computeDimensions(item, settings, preview);
    const mime = getOutputMime(item, settings);
    const { outCanvas, outCtx } = prepareOutputCanvas(dims.boxW, dims.boxH, mime, settings, dims.shouldPad);
    drawScaledBitmap(outCtx, item, dims.cropRect, dims.targetW, dims.targetH, dims.boxW, dims.boxH, settings.algorithm);
    const blob = await encodeCanvas(outCanvas, mime, settings, preview);
    const finalBlob = await applyDpi(blob, mime, settings, preview);
    return { blob: finalBlob, width: dims.boxW, height: dims.boxH, mime: normalizeEncodeMime(mime) };
  }

  async function computePipelineResample(item, settings) {
    const dims = computeDimensions(item, settings, false);
    const mime = getOutputMime(item, settings);
    const region = getSourceRegion(item, dims.cropRect);
    const needsResample = !(region.width === dims.targetW && region.height === dims.targetH);
    const resampled = needsResample
      ? await resampleSmart(region, dims.targetW, dims.targetH, settings.algorithm)
      : region;
    const { outCanvas, outCtx } = prepareOutputCanvas(dims.boxW, dims.boxH, mime, settings, dims.shouldPad);
    const offsetX = Math.round((dims.boxW - dims.targetW) / 2);
    const offsetY = Math.round((dims.boxH - dims.targetH) / 2);
    const resampledCanvas = document.createElement('canvas');
    resampledCanvas.width = resampled.width;
    resampledCanvas.height = resampled.height;
    resampledCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(resampled.data), resampled.width, resampled.height), 0, 0);
    outCtx.drawImage(resampledCanvas, offsetX, offsetY);
    const blob = await encodeCanvas(outCanvas, mime, settings, false);
    const finalBlob = await applyDpi(blob, mime, settings, false);
    return { blob: finalBlob, width: dims.boxW, height: dims.boxH, mime: normalizeEncodeMime(mime) };
  }

  async function computePipeline(item, settings, options = {}) {
    const { preview = false } = options;
    if (preview) return computePipelineCanvas(item, settings, true);
    try {
      return await computePipelineResample(item, settings);
    } catch (err) {
      return computePipelineCanvas(item, settings, false);
    }
  }

  function updatePreviewStats(item, result) {
    if (els.resultDims) els.resultDims.textContent = `${result.width} × ${result.height}px`;
    if (els.resultSize) els.resultSize.textContent = formatBytes(result.blob.size);
    if (els.resultSavings && item.file?.size) {
      const diff = item.file.size - result.blob.size;
      const pct = ((diff / item.file.size) * 100).toFixed(0);
      els.resultSavings.textContent = diff > 0 ? `${pct}% smaller` : diff < 0 ? `${Math.abs(pct)}% larger` : 'Same size';
      els.resultSavings.classList.toggle('is-larger', diff < 0);
      els.resultSavings.classList.toggle('is-same', diff === 0);
    }
  }

  function updateResultStats(item, result) {
    if (els.resizedPreview) els.resizedPreview.src = item.resultUrl;
    updatePreviewStats(item, result);
  }

  async function runPreviewActive(generation) {
    const item = state.items[state.activeIndex];
    if (!item) return;
    const settings = getSettings();
    if (!isValidSettings(settings)) return;
    if (generation !== previewGeneration) return;

    toggleBusy(true, true);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (generation !== previewGeneration) return;

      const result = await computePipeline(item, settings, { preview: true });
      if (generation !== previewGeneration) return;

      if (item.previewResultUrl) URL.revokeObjectURL(item.previewResultUrl);
      item.previewResultUrl = URL.createObjectURL(result.blob);
      item.previewResultBlob = result.blob;
      if (els.resizedPreview) els.resizedPreview.src = item.previewResultUrl;
      updatePreviewStats(item, result);
      syncDownloadButtons();
      syncStickyBar();
    } catch (err) {
      if (generation === previewGeneration) {
        if (els.resizedPreview && item.previewUrl) els.resizedPreview.src = item.previewUrl;
        announce((err && err.message) || 'Live preview failed.');
      }
    } finally {
      toggleBusy(false, true);
    }
  }

  async function runResizeActive() {
    const item = state.items[state.activeIndex];
    if (!item) { announce('Upload an image first.'); return; }
    const settings = getSettings();
    if (!isValidSettings(settings)) {
      announce('Enter a width or height first.');
      return;
    }
    previewGeneration += 1;
    toggleBusy(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = await computePipeline(item, settings, { preview: false });
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      item.resultBlob = result.blob;
      item.resultUrl = URL.createObjectURL(result.blob);
      item.resultWidth = result.width;
      item.resultHeight = result.height;
      updateResultStats(item, result);
      if (els.resizedPreview && item.resultUrl) els.resizedPreview.src = item.resultUrl;
      syncDownloadButtons();
      pushHistory(settings);
      announce('Image resized.', 'info');
      syncStickyBar();
    } catch (err) {
      announce((err && err.message) || 'Resize failed.');
    } finally {
      toggleBusy(false);
    }
  }

  async function runResizeAll() {
    if (!state.items.length) { announce('Upload images first.'); return; }
    const settings = getSettings();
    previewGeneration += 1;
    toggleBusy(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const item of state.items) {
        const result = await computePipeline(item, settings, { preview: false });
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        item.resultBlob = result.blob;
        item.resultUrl = URL.createObjectURL(result.blob);
        item.resultWidth = result.width;
        item.resultHeight = result.height;
      }
      selectActive(state.activeIndex);
      syncDownloadButtons();
      pushHistory(settings);
      announce(`Resized ${state.items.length} image${state.items.length === 1 ? '' : 's'}.`, 'info');
      syncStickyBar();
    } catch (err) {
      announce((err && err.message) || 'Batch resize failed.');
    } finally {
      toggleBusy(false);
    }
  }

  function toggleBusy(busy, isPreview) {
    if (els.progressBar) els.progressBar.hidden = !busy || isPreview;
    if (els.compareWrap) els.compareWrap.classList.toggle('is-updating', busy && isPreview);
    if (!isPreview) {
      [els.resizeBtn, els.stickyResizeBtn].forEach((b) => { if (b) b.disabled = busy; });
    }
  }

  // Once a result exists, the mobile sticky bar's job shifts from "trigger a
  // resize" to "grab the result" — live preview already keeps it up to date,
  // so re-clicking Resize there would rarely be what someone actually wants.
  function syncStickyBar() {
    const item = state.items[state.activeIndex];
    const hasResult = !!(item?.resultBlob || item?.previewResultBlob);
    if (els.stickyResizeBtn) els.stickyResizeBtn.textContent = hasResult ? '⬇️ Download' : '⚡ Resize';
    if (els.stickyStatus) {
      els.stickyStatus.textContent = item
        ? hasResult
          ? item.resultBlob
            ? `${item.resultWidth} × ${item.resultHeight}px`
            : 'Preview ready'
          : 'Ready to resize'
        : 'Image Resizer';
    }
  }

  // ---------- download ----------

  function downloadActive() {
    const item = state.items[state.activeIndex];
    const blob = item?.resultBlob || item?.previewResultBlob;
    if (!item || !blob) {
      announce('Wait for preview or click Resize first.');
      return;
    }
    const ext = E.extensionForMime(blob.type);
    const suffix = item.resultBlob ? 'resized' : 'preview';
    const name = `${E.sanitizeFileBaseName(item.file.name)}-${suffix}.${ext}`;
    triggerDownload(blob, name);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
    announce(`Downloaded ${filename}`, 'info');
  }

  function loadJSZip() {
    return new Promise((resolve, reject) => {
      if (window.JSZip) { resolve(window.JSZip); return; }
      const s = document.createElement('script');
      s.src = 'assets/js/jszip.min.js';
      s.onload = () => resolve(window.JSZip);
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  async function downloadZip() {
    const ready = state.items.filter((i) => i.resultBlob || i.previewResultBlob);
    if (!ready.length) { announce('Resize or preview your images first.'); return; }
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      ready.forEach((item) => {
        const blob = item.resultBlob || item.previewResultBlob;
        const ext = E.extensionForMime(blob.type);
        const suffix = item.resultBlob ? 'resized' : 'preview';
        zip.file(`${E.sanitizeFileBaseName(item.file.name)}-${suffix}.${ext}`, blob);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(blob, 'resized-images.zip');
    } catch (e) {
      announce('Could not build the ZIP file.');
    }
  }

  // ---------- presets ----------

  function renderPresets(category) {
    refreshElements();
    if (!els.presetGrid || !E?.ALL_PRESETS) return;
    const list = category === 'all' ? E.ALL_PRESETS : E.ALL_PRESETS.filter((p) => p.category === category);
    els.presetGrid.innerHTML = '';
    list.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ir-preset-chip' + (state.activePresetId === preset.id ? ' is-active' : '');
      btn.dataset.presetId = preset.id;
      btn.innerHTML = `<strong>${escapeHtml(preset.label)}</strong><span>${preset.width}×${preset.height}px</span>`;
      els.presetGrid.appendChild(btn);
    });
  }

  // ---------- history ----------

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function pushHistory(settings) {
    try {
      const list = loadHistory();
      list.unshift({ ...settings, timestamp: Date.now() });
      const trimmed = list.slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      renderHistory(trimmed);
    } catch (e) {
      /* localStorage may be unavailable — ignore */
    }
  }

  function renderHistory(list) {
    if (!els.historyList) return;
    const items = list || loadHistory();
    if (!items.length) {
      els.historyList.innerHTML = '<li class="ir-history-empty">No resize history yet.</li>';
      return;
    }
    els.historyList.innerHTML = '';
    items.forEach((entry) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ir-history-item';
      const dims = entry.resizeMode === 'percent' ? `${entry.percent}%` : `${entry.width}×${entry.height}`;
      btn.innerHTML = `<span>${dims} · ${entry.resizeMode}</span><span class="ir-history-meta">${new Date(entry.timestamp).toLocaleTimeString()}</span>`;
      btn.addEventListener('click', () => applySettings(entry));
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  function applySettings(entry) {
    if (els.resizeMode) els.resizeMode.value = entry.resizeMode;
    if (els.widthInput) els.widthInput.value = entry.width;
    if (els.heightInput) els.heightInput.value = entry.height;
    if (els.percentRange) els.percentRange.value = entry.percent;
    if (els.percentValue) els.percentValue.textContent = entry.percent + '%';
    if (els.algorithm) els.algorithm.value = entry.algorithm;
    if (els.outputFormat) els.outputFormat.value = entry.outputFormat;
    if (els.qualityRange) els.qualityRange.value = Math.round(entry.quality * 100);
    syncModeVisibility();
    syncFormatVisibility();
    announce('History settings applied.', 'info');
    scheduleLivePreview(true);
  }

  // ---------- reset ----------

  function resetAll() {
    state.items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.previewResultUrl) URL.revokeObjectURL(item.previewResultUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    state.items = [];
    state.activeIndex = -1;
    if (els.fileInput) els.fileInput.value = '';
    if (els.emptyState) els.emptyState.hidden = false;
    if (els.workspace) els.workspace.hidden = true;
    if (els.downloadBtn) {
      els.downloadBtn.disabled = false;
      els.downloadBtn.setAttribute('aria-disabled', 'true');
      els.downloadBtn.classList.add('is-disabled');
    }
    if (els.downloadZipBtn) {
      els.downloadZipBtn.disabled = false;
      els.downloadZipBtn.setAttribute('aria-disabled', 'true');
      els.downloadZipBtn.classList.add('is-disabled');
    }
    state.activePresetId = null;
    announce('Cleared.', 'info');
    syncStickyBar();
  }

  // ---------- camera + URL import ----------

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
  }

  function normalizeImportUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return 'https://' + url;
  }

  function guessImageMime(url, blobType) {
    if (blobType && blobType.startsWith('image/')) return blobType;
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    const map = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
    };
    return map[ext] || 'image/jpeg';
  }

  function blobFromImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          reject(new Error('Image has no dimensions.'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Could not read image data — the server may block cross-origin access (CORS).'));
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Could not load image from that URL.'));
      img.src = url;
    });
  }

  async function fetchImageFromUrl(rawUrl) {
    const url = normalizeImportUrl(rawUrl);
    if (!url) throw new Error('Enter a valid image URL.');

    const attempts = [
      () => fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' }),
      () => fetch(url, { mode: 'no-cors', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' }),
    ];

    for (const attempt of attempts) {
      try {
        const res = await attempt();
        const blob = await res.blob();
        if (!blob || blob.size === 0) continue;
        const type = guessImageMime(url, blob.type);
        const bitmap = await bitmapFromBlob(blob);
        const name = urlImportFileName(url, type);
        const file = new File([blob], name, { type });
        file._irFromUrl = true;
        return buildItemFromBitmap(file, bitmap);
      } catch (e) {
        /* try next strategy */
      }
    }

    const imgStrategies = [
      () => bitmapFromImageUrl(url, true),
      () => bitmapFromImageUrl(url, false),
    ];

    for (const attempt of imgStrategies) {
      try {
        const bitmap = await attempt();
        const type = guessImageMime(url, '');
        const name = urlImportFileName(url, type);
        const file = await fileFromBitmap(bitmap, name, type);
        return buildItemFromBitmap(file, bitmap);
      } catch (e) {
        /* try next strategy */
      }
    }

    try {
      const blob = await blobFromImageElement(url);
      const type = guessImageMime(url, blob.type);
      const bitmap = await bitmapFromBlob(blob);
      const name = urlImportFileName(url, type);
      const file = new File([blob], name, { type });
      file._irFromUrl = true;
      return buildItemFromBitmap(file, bitmap);
    } catch (e) {
      throw new Error('Could not import that URL — the site may block cross-origin access. Download the image and use Browse instead.');
    }
  }

  async function importFromUrl() {
    refreshElements();
    const raw = els.urlInput?.value.trim();
    if (!raw) {
      announce('Paste an image URL first.');
      return;
    }
    if (!E) {
      announce('Resize engine failed to load. Hard-refresh the page (Ctrl+Shift+R).');
      return;
    }
    announce('Fetching image…', 'info');
    try {
      const item = await fetchImageFromUrl(raw);
      state.items.push(item);
      if (state.activeIndex === -1) state.activeIndex = state.items.length - 1;
      else state.activeIndex = state.items.length - 1;
      renderQueue();
      if (els.emptyState) els.emptyState.hidden = true;
      if (els.workspace) els.workspace.hidden = false;
      if (els.urlInput) els.urlInput.value = '';
      bindWorkspaceHandlers();
      bindStickyBar();
      bindCompareSlider();
      await selectActive(state.activeIndex);
      announce('Image imported from URL.', 'info');
    } catch (e) {
      announce((e && e.message) || 'Could not import that URL — try downloading the image and using Browse instead.');
    }
  }

  async function openCameraCapture() {
    refreshElements();
    if (isMobileDevice()) {
      els.cameraInput?.click();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      els.cameraInput?.click();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ir-camera-overlay';
    overlay.innerHTML = `
      <div class="ir-camera-dialog" role="dialog" aria-modal="true" aria-label="Camera capture">
        <video class="ir-camera-video" autoplay playsinline muted></video>
        <div class="ir-camera-actions">
          <button type="button" class="secondary-btn" data-ir-camera-cancel>Cancel</button>
          <button type="button" class="primary-btn" data-ir-camera-capture>📷 Capture photo</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const video = overlay.querySelector('video');
    let stream = null;

    const cleanup = () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      cleanup();
      if (err?.name === 'NotAllowedError') {
        announce('Camera permission denied — allow camera access in your browser settings.');
      } else if (err?.name === 'NotFoundError') {
        announce('No camera found — use Browse files instead.');
      } else if (window.isSecureContext === false) {
        announce('Camera needs HTTPS — use Browse files on this connection.');
      } else {
        announce('Could not open camera — use Browse files instead.');
      }
      return;
    }

    overlay.querySelector('[data-ir-camera-cancel]')?.addEventListener('click', cleanup);
    overlay.querySelector('[data-ir-camera-capture]')?.addEventListener('click', async () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        announce('Camera is not ready yet — wait a moment and try again.');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0);
      cleanup();
      try {
        const bitmap = await createImageBitmap(canvas);
        await addCapturedBitmap(bitmap);
      } catch (err) {
        announce((err && err.message) || 'Capture failed.');
      }
    });
  }

  // ---------- wiring ----------

  let uploadWired = false;
  let globalWired = false;

  function wireUploadHandlers() {
    if (uploadWired) return;
    uploadWired = true;

    els.fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.length) addFiles(e.target.files);
      e.target.value = '';
    });

    const uploadRow = document.querySelector('.ir-upload-row');
    uploadRow?.addEventListener('change', (e) => {
      if (e.target.id === 'irCameraInput' && e.target.files?.length) {
        addCameraFiles(e.target.files);
      }
    });

    uploadRow?.addEventListener('click', (e) => {
      if (e.target.closest('#irUrlImportBtn')) {
        e.preventDefault();
        importFromUrl();
      }
    });

    document.getElementById('irUrlInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        importFromUrl();
      }
    });

    document.getElementById('irCameraBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      openCameraCapture();
    });

    if (els.dropZone) {
      ['dragenter', 'dragover'].forEach((evt) => {
        els.dropZone.addEventListener(evt, (e) => {
          e.preventDefault();
          els.dropZone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'drop'].forEach((evt) => {
        els.dropZone.addEventListener(evt, (e) => {
          e.preventDefault();
          els.dropZone.classList.remove('is-dragover');
        });
      });
      els.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      });
    }
  }

  function wireGlobalHandlers() {
    if (globalWired) return;
    globalWired = true;

    els.pasteBtn?.addEventListener('click', async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            await addFiles([new File([blob], 'pasted-image.png', { type })]);
            return;
          }
        }
        announce('No image found on the clipboard.');
      } catch (e) {
        announce('Clipboard access was blocked or unavailable — try Ctrl+V while focused on the drop zone instead.');
      }
    });
    document.addEventListener('paste', (e) => {
      const fileItem = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      if (fileItem) addFiles([fileItem.getAsFile()]);
    });
  }

  function init() {
    refreshElements();
    wireUploadHandlers();

    if (!E) {
      announce('Resize engine failed to load. Hard-refresh the page (Ctrl+Shift+R).');
      return;
    }

    try { initWorker(); } catch (e) { /* worker optional */ }
    try { renderPresets('Instagram'); } catch (e) { /* presets optional */ }
    try { renderHistory(); } catch (e) { /* history optional */ }
    syncModeVisibility();
    syncFormatVisibility();
    syncCompareSlider();
    syncStickyBar();
    wireGlobalHandlers();
    bindWorkspaceHandlers();
    bindStickyBar();
  }

  function boot() {
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
