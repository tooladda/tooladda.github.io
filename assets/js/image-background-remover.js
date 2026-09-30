/* ToolAdda - Image Background Remover & Changer
 * Chroma-key style background removal using flood fill from user-picked or
 * auto-detected seed pixels, plus manual brush refinement. No ML model, no
 * upload — everything runs on typed-array pixel math in the browser.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Pure engine: color distance, alpha ramp, flood fill, mask ops
   * ------------------------------------------------------------------ */

  const MAX_COLOR_DISTANCE = Math.sqrt(255 * 255 * 3);

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  // Maps a friendly 0-100 UI value onto the 0..MAX_COLOR_DISTANCE scale.
  function uiToDistance(uiValue) {
    const clamped = Math.max(0, Math.min(100, uiValue));
    return (clamped / 100) * MAX_COLOR_DISTANCE;
  }

  // Soft threshold: near the seed color -> 0 (removed), far from it -> 255
  // (kept), with a linear ramp of width `featherDistance` centered on
  // `toleranceDistance` for anti-aliased edges instead of a hard cutout.
  function computeAlphaFromDistance(distance, toleranceDistance, featherDistance) {
    const low = toleranceDistance - featherDistance;
    const high = toleranceDistance + featherDistance;
    if (high <= low) {
      return distance <= toleranceDistance ? 0 : 255;
    }
    if (distance <= low) return 0;
    if (distance >= high) return 255;
    return Math.round(((distance - low) / (high - low)) * 255);
  }

  function getBorderSeeds(width, height) {
    const seeds = [];
    if (width <= 0 || height <= 0) return seeds;
    for (let x = 0; x < width; x += 1) {
      seeds.push([x, 0]);
      if (height > 1) seeds.push([x, height - 1]);
    }
    for (let y = 1; y < height - 1; y += 1) {
      seeds.push([0, y]);
      if (width > 1) seeds.push([width - 1, y]);
    }
    return seeds;
  }

  // Flood fill from every seed pixel, growing into 4-connected neighbors
  // while the running color stays within tolerance+feather of that cluster's
  // seed color. Returns a fresh alpha mask (0 = removed, 255 = kept).
  function floodFillFromSeeds(opts) {
    const width = opts.width;
    const height = opts.height;
    const data = opts.data;
    const seeds = opts.seeds;
    const toleranceDistance = uiToDistance(opts.toleranceUi == null ? 30 : opts.toleranceUi);
    const featherDistance = uiToDistance(opts.featherUi == null ? 10 : opts.featherUi);
    const outerBound = toleranceDistance + featherDistance;

    const total = width * height;
    const alpha = new Uint8ClampedArray(total).fill(255);
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);

    seeds.forEach((seed) => {
      const sx = seed[0];
      const sy = seed[1];
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;
      const seedIdx = sy * width + sx;
      if (visited[seedIdx]) return;

      const seedR = data[seedIdx * 4];
      const seedG = data[seedIdx * 4 + 1];
      const seedB = data[seedIdx * 4 + 2];

      let head = 0;
      let tail = 0;
      queue[tail] = seedIdx; tail += 1;
      visited[seedIdx] = 1;

      while (head < tail) {
        const idx = queue[head]; head += 1;
        const px = idx % width;
        const py = (idx - px) / width;
        const r = data[idx * 4];
        const g = data[idx * 4 + 1];
        const b = data[idx * 4 + 2];
        const dist = colorDistance(r, g, b, seedR, seedG, seedB);
        alpha[idx] = computeAlphaFromDistance(dist, toleranceDistance, featherDistance);

        if (dist <= outerBound) {
          if (px > 0) {
            const n = idx - 1;
            if (!visited[n]) { visited[n] = 1; queue[tail] = n; tail += 1; }
          }
          if (px < width - 1) {
            const n = idx + 1;
            if (!visited[n]) { visited[n] = 1; queue[tail] = n; tail += 1; }
          }
          if (py > 0) {
            const n = idx - width;
            if (!visited[n]) { visited[n] = 1; queue[tail] = n; tail += 1; }
          }
          if (py < height - 1) {
            const n = idx + width;
            if (!visited[n]) { visited[n] = 1; queue[tail] = n; tail += 1; }
          }
        }
      }
    });

    return alpha;
  }

  // Paints a filled circle of `value` onto a copy of `mask` (non-mutating).
  function paintCircleOnMask(mask, width, height, cx, cy, radius, value) {
    const out = Uint8ClampedArray.from(mask);
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) {
          out[y * width + x] = value;
        }
      }
    }
    return out;
  }

  // Combine two masks: 'remove' keeps the more-transparent value (min),
  // 'restore' keeps the more-opaque value (max) — used to union brush
  // strokes and auto-detect results without one operation undoing another.
  function combineMasks(maskA, maskB, mode) {
    const out = new Uint8ClampedArray(maskA.length);
    for (let i = 0; i < maskA.length; i += 1) {
      out[i] = mode === 'restore' ? Math.max(maskA[i], maskB[i]) : Math.min(maskA[i], maskB[i]);
    }
    return out;
  }

  function countMaskStats(mask) {
    let removed = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (mask[i] < 128) removed += 1;
    }
    const total = mask.length;
    return {
      total: total,
      removedPixels: removed,
      removedPercent: total > 0 ? Math.round((removed / total) * 1000) / 10 : 0,
    };
  }

  // Proportional downscale so the working canvas never exceeds maxDimension
  // on its longest side — keeps flood fill fast on very large photos.
  function clampCanvasSize(width, height, maxDimension) {
    const longest = Math.max(width, height);
    if (longest <= maxDimension || longest <= 0) {
      return { width: width, height: height, scale: 1 };
    }
    const scale = maxDimension / longest;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      scale: scale,
    };
  }

  /* ------------------------------------------------------------------ *
   * Node/test export — everything above this line is pure and DOM-free.
   * ------------------------------------------------------------------ */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MAX_COLOR_DISTANCE: MAX_COLOR_DISTANCE,
      colorDistance: colorDistance,
      uiToDistance: uiToDistance,
      computeAlphaFromDistance: computeAlphaFromDistance,
      getBorderSeeds: getBorderSeeds,
      floodFillFromSeeds: floodFillFromSeeds,
      paintCircleOnMask: paintCircleOnMask,
      combineMasks: combineMasks,
      countMaskStats: countMaskStats,
      clampCanvasSize: clampCanvasSize,
    };
  }

  if (typeof document === 'undefined') {
    return;
  }

  /* ------------------------------------------------------------------ *
   * DOM wiring
   * ------------------------------------------------------------------ */

  const page = document.querySelector('[data-bg-remover-page]');
  if (!page) {
    return;
  }

  const $ = (sel) => page.querySelector(sel);
  const $$ = (sel) => Array.prototype.slice.call(page.querySelectorAll(sel));

  const fileInput = $('[data-file-input]');
  const filePicker = $('[data-file-picker]');
  const dropZone = $('[data-drop-zone]');
  const filePreview = $('[data-file-preview]');
  const fileNameText = $('[data-file-name]');
  const originalSizeText = $('[data-original-size]');
  const messageBox = $('[data-message]');
  const loader = $('[data-loader]');

  const canvas = $('[data-preview-canvas]');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const toleranceSlider = $('[data-tolerance-slider]');
  const toleranceValue = $('[data-tolerance-value]');
  const featherSlider = $('[data-feather-slider]');
  const featherValue = $('[data-feather-value]');
  const brushSlider = $('[data-brush-slider]');
  const brushValue = $('[data-brush-value]');

  const autoRemoveBtn = $('[data-auto-remove]');
  const modeButtons = $$('[data-brush-mode]');
  const undoBtn = $('[data-undo-btn]');
  const resetBtn = $('[data-reset-btn]');

  const bgModeButtons = $$('[data-bg-mode]');
  const bgColorInput = $('[data-bg-color]');
  const bgImageInput = $('[data-bg-image-input]');
  const bgImagePicker = $('[data-bg-image-picker]');

  const statsText = $('[data-mask-stats]');
  const downloadBtn = $('[data-download-btn]');
  const downloadLink = $('[data-download-link]');

  const { clear: clearMessage, show: showMessage } = window.ImageToolKit.createMessageHandlers(messageBox);

  const MAX_DIMENSION = 2200;

  let activeFile = null;
  let previewUrl = null;
  let downloadUrl = null;
  let bgImageUrl = null;
  let loadedImage = null;
  let bgImage = null;

  let workW = 0;
  let workH = 0;
  let originalData = null; // Uint8ClampedArray RGBA, immutable per loaded image
  let mask = null; // Uint8ClampedArray, one alpha byte per pixel
  let maskHistory = [];
  let brushMode = 'remove'; // 'remove' | 'restore'
  let bgMode = 'transparent'; // 'transparent' | 'color' | 'image'
  let isPainting = false;

  function toggleLoader(visible) {
    loader.classList.toggle('hidden', !visible);
    [filePicker, autoRemoveBtn, undoBtn, resetBtn, downloadBtn].forEach((el) => { el.disabled = visible; });
  }

  function setControlsEnabled(enabled) {
    [toleranceSlider, featherSlider, brushSlider, autoRemoveBtn, undoBtn, downloadBtn]
      .forEach((el) => { el.disabled = !enabled; });
    modeButtons.forEach((btn) => { btn.disabled = !enabled; });
    bgModeButtons.forEach((btn) => { btn.disabled = !enabled; });
  }

  function pushHistory() {
    maskHistory.push(Uint8ClampedArray.from(mask));
    if (maskHistory.length > 20) maskHistory.shift();
  }

  function render() {
    if (!originalData) return;
    ctx.clearRect(0, 0, workW, workH);

    if (bgMode === 'color') {
      ctx.fillStyle = bgColorInput.value || '#ffffff';
      ctx.fillRect(0, 0, workW, workH);
    } else if (bgMode === 'image' && bgImage) {
      const scale = Math.max(workW / bgImage.naturalWidth, workH / bgImage.naturalHeight);
      const dw = bgImage.naturalWidth * scale;
      const dh = bgImage.naturalHeight * scale;
      ctx.drawImage(bgImage, (workW - dw) / 2, (workH - dh) / 2, dw, dh);
    }

    const frame = ctx.getImageData(0, 0, workW, workH);
    const out = frame.data;
    for (let i = 0; i < workW * workH; i += 1) {
      const o = i * 4;
      const srcA = originalData[o + 3];
      const a = Math.min(srcA, mask[i]) / 255;
      if (a <= 0) continue;
      const dstR = out[o];
      const dstG = out[o + 1];
      const dstB = out[o + 2];
      out[o] = Math.round(originalData[o] * a + dstR * (1 - a));
      out[o + 1] = Math.round(originalData[o + 1] * a + dstG * (1 - a));
      out[o + 2] = Math.round(originalData[o + 2] * a + dstB * (1 - a));
      out[o + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);

    const stats = countMaskStats(mask);
    statsText.textContent = stats.removedPercent > 0
      ? stats.removedPercent + '% of the image marked as background'
      : 'No background removed yet';
  }

  function loadImage(file) {
    if (!file.type.startsWith('image/')) {
      throw new Error('Please upload a valid image file.');
    }
    return window.ImageToolKit.loadImageFile(file).then(({ image, url }) => {
      window.ImageToolKit.revokeUrl(previewUrl);
      previewUrl = url;
      loadedImage = image;
      activeFile = file;
      filePreview.hidden = false;
      fileNameText.textContent = file.name;
      originalSizeText.textContent = window.ImageToolKit.formatBytes(file.size);

      const clamped = clampCanvasSize(
        image.naturalWidth, image.naturalHeight, MAX_DIMENSION
      );
      workW = clamped.width;
      workH = clamped.height;
      canvas.width = workW;
      canvas.height = workH;

      const temp = document.createElement('canvas');
      temp.width = workW;
      temp.height = workH;
      const tctx = temp.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(image, 0, 0, workW, workH);
      originalData = tctx.getImageData(0, 0, workW, workH).data;

      mask = new Uint8ClampedArray(workW * workH).fill(255);
      maskHistory = [];
      setControlsEnabled(true);
      downloadBtn.disabled = false;
      render();
    });
  }

  window.ImageToolKit.bindFileUpload({
    fileInput: fileInput,
    filePicker: filePicker,
    dropZone: dropZone,
    onFile: (file) => {
      toggleLoader(true);
      clearMessage();
      Promise.resolve()
        .then(() => loadImage(file))
        .catch((error) => showMessage(error.message, 'error'))
        .then(() => toggleLoader(false));
    },
  });

  toleranceSlider.addEventListener('input', () => {
    toleranceValue.textContent = toleranceSlider.value;
  });
  featherSlider.addEventListener('input', () => {
    featherValue.textContent = featherSlider.value;
  });
  brushSlider.addEventListener('input', () => {
    brushValue.textContent = brushSlider.value + 'px';
  });

  autoRemoveBtn.addEventListener('click', () => {
    if (!originalData) return;
    pushHistory();
    const seeds = getBorderSeeds(workW, workH);
    const detected = floodFillFromSeeds({
      width: workW,
      height: workH,
      data: originalData,
      seeds: seeds,
      toleranceUi: Number(toleranceSlider.value),
      featherUi: Number(featherSlider.value),
    });
    mask = combineMasks(mask, detected, 'remove');
    render();
    showMessage('Background removed from the edges inward. Refine with the brush if needed.', 'success');
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      brushMode = btn.getAttribute('data-brush-mode');
      modeButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });

  bgModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      bgMode = btn.getAttribute('data-bg-mode');
      bgModeButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      $('[data-bg-color-row]').hidden = bgMode !== 'color';
      $('[data-bg-image-row]').hidden = bgMode !== 'image';
      render();
    });
  });

  bgColorInput.addEventListener('input', render);

  if (bgImagePicker) {
    bgImagePicker.addEventListener('click', () => bgImageInput.click());
  }
  bgImageInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    window.ImageToolKit.loadImageFile(file).then(({ image, url }) => {
      window.ImageToolKit.revokeUrl(bgImageUrl);
      bgImageUrl = url;
      bgImage = image;
      render();
    }).catch(() => showMessage('Could not load that background image.', 'error'));
  });

  function canvasPointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const point = event.touches ? event.touches[0] : event;
    const x = ((point.clientX - rect.left) / rect.width) * workW;
    const y = ((point.clientY - rect.top) / rect.height) * workH;
    return { x: x, y: y };
  }

  function paintAt(x, y) {
    const radius = Number(brushSlider.value);
    const painted = paintCircleOnMask(
      mask, workW, workH, x, y, radius, brushMode === 'restore' ? 255 : 0
    );
    mask = combineMasks(mask, painted, brushMode === 'restore' ? 'restore' : 'remove');
    render();
  }

  function clickRemoveAt(x, y) {
    const px = Math.max(0, Math.min(workW - 1, Math.round(x)));
    const py = Math.max(0, Math.min(workH - 1, Math.round(y)));
    const detected = floodFillFromSeeds({
      width: workW,
      height: workH,
      data: originalData,
      seeds: [[px, py]],
      toleranceUi: Number(toleranceSlider.value),
      featherUi: Number(featherSlider.value),
    });
    mask = combineMasks(mask, detected, 'remove');
    render();
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!originalData) return;
    event.preventDefault();
    isPainting = true;
    pushHistory();
    const { x, y } = canvasPointFromEvent(event);
    if (event.shiftKey) {
      clickRemoveAt(x, y);
    } else {
      paintAt(x, y);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!isPainting || !originalData) return;
    const { x, y } = canvasPointFromEvent(event);
    paintAt(x, y);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => {
    canvas.addEventListener(evt, () => { isPainting = false; });
  });

  undoBtn.addEventListener('click', () => {
    if (!maskHistory.length) {
      showMessage('Nothing to undo.', 'error');
      return;
    }
    mask = maskHistory.pop();
    render();
  });

  resetBtn.addEventListener('click', () => {
    window.ImageToolKit.revokeUrl(previewUrl);
    window.ImageToolKit.revokeUrl(downloadUrl);
    window.ImageToolKit.revokeUrl(bgImageUrl);
    previewUrl = null;
    downloadUrl = null;
    bgImageUrl = null;
    activeFile = null;
    loadedImage = null;
    bgImage = null;
    originalData = null;
    mask = null;
    maskHistory = [];
    fileInput.value = '';
    filePreview.hidden = true;
    fileNameText.textContent = '';
    originalSizeText.textContent = '—';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    toleranceSlider.value = 30;
    featherSlider.value = 10;
    brushSlider.value = 30;
    toleranceValue.textContent = '30';
    featherValue.textContent = '10';
    brushValue.textContent = '30px';
    statsText.textContent = 'No background removed yet';
    setControlsEnabled(false);
    downloadBtn.disabled = true;
    clearMessage();
  });

  downloadBtn.addEventListener('click', () => {
    if (!originalData) {
      showMessage('Upload an image first.', 'error');
      return;
    }
    toggleLoader(true);
    canvas.toBlob((blob) => {
      toggleLoader(false);
      if (!blob) {
        showMessage('Download preparation failed.', 'error');
        return;
      }
      window.ImageToolKit.revokeUrl(downloadUrl);
      downloadUrl = URL.createObjectURL(blob);
      downloadLink.href = downloadUrl;
      const suffix = bgMode === 'transparent' ? '-transparent.png' : '-new-background.png';
      downloadLink.download = activeFile ? activeFile.name.replace(/\.[^.]+$/, suffix) : 'background-removed.png';
      downloadLink.classList.remove('hidden');
      downloadLink.click();
      showMessage('Image downloaded.', 'success');
    }, 'image/png');
  });

  setControlsEnabled(false);
  downloadBtn.disabled = true;
}());
