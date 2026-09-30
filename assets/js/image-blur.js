(function () {
  'use strict';

  const root = document.querySelector('[data-blur-page]');
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));

  const el = {
    topGrid: document.querySelector('.fg-top'),
    drop: $('[data-drop-zone]'), input: $('[data-file-input]'), pickers: $$('[data-file-picker]'), sample: $('[data-sample-btn]'),
    editor: $('[data-editor]'), wrap: $('[data-canvas-wrap]'), canvas: $('[data-canvas]'),
    fileName: $('[data-file-name]'), fileDims: $('[data-file-dims]'), fileSize: $('[data-file-size]'), fileType: $('[data-file-type]'), scaleNote: $('[data-scale-note]'),
    modes: $$('[data-mode]'), modeHint: $('[data-mode-hint]'),
    ctrlIntensity: $('[data-ctrl="intensity"]'), ctrlBrush: $('[data-ctrl="brush"]'), ctrlPixel: $('[data-ctrl="pixel"]'), ctrlApply: $('[data-ctrl="apply"]'),
    intensity: $('[data-intensity]'), intensityVal: $('[data-intensity-val]'),
    brush: $('[data-brush]'), brushVal: $('[data-brush-val]'),
    pixel: $('[data-pixel]'), pixelVal: $('[data-pixel-val]'),
    applyBtn: $('[data-apply-btn]'),
    undo: $('[data-undo]'), redo: $('[data-redo]'), resetImg: $('[data-reset-img]'), beforeAfter: $('[data-before-after]'),
    zoomIn: $('[data-zoom-in]'), zoomOut: $('[data-zoom-out]'), zoomFit: $('[data-zoom-fit]'), zoomVal: $('[data-zoom-val]'),
    format: $('[data-format]'), formatNote: $('[data-format-note]'), quality: $('[data-quality]'), qualityVal: $('[data-quality-val]'), qualityWrap: $('[data-quality-wrap]'),
    downloadBtn: $('[data-download-btn]'), downloadLink: $('[data-download-link]'), remove: $('[data-remove]'),
    message: $('[data-message]'), success: $('[data-success]'),
    steps: $$('[data-fg-step]'),
    stickyBar: document.querySelector('.fg-sticky-cta'), stickyBtn: document.querySelector('[data-sticky-cta]'),
  };

  // The editing copy is capped so brushing stays smooth; the download is
  // rebuilt from the original at full size (up to MAX_EXPORT pixels).
  const MAX_DIM = 2000;
  const COARSE = window.matchMedia('(pointer: coarse)').matches;
  const MAX_EXPORT = COARSE ? 16e6 : 40e6; // phones have far less memory for one huge canvas
  const HISTORY = 15;
  const phoneQuery = window.matchMedia('(max-width: 768px)');

  let sourceFile = null;          // the file as picked (null for the sample)
  let sampleCanvas = null;
  let NW = 0, NH = 0, W = 0, H = 0;
  let original = null, committed = null, cctx = null;
  let fullBase = null, fullBaseAt = 0;
  let ops = [], redoOps = [], history = [], redoStack = [];
  let mode = 'area', zoom = 1, fitWidth = 0;
  let selRect = null, dragging = false, dragStart = null, brushTmp = null, stroke = null, lastPt = null;
  let showingOriginal = false, dlUrl = null, busy = false, downloaded = false;
  let previewCache = null;        // { key, canvas } for the full/edge live preview
  let ring = null;
  const inView = { tool: true, download: false };

  /* ---------- helpers ---------- */
  const fmt = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const copyCanvas = (src) => { const c = makeCanvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; };
  const free = (c) => { if (c && c !== committed && c !== original && c !== fullBase) { c.width = 0; c.height = 0; } };
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const looksImage = (f) => !!f && ((f.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(f.name || ''));
  const isHeic = (f) => /heic|heif/i.test(f.type || '') || /\.(heic|heif)$/i.test(f.name || '');

  function msg(text, tone, link) {
    el.message.textContent = text;
    if (link) { el.message.append(' '); const a = document.createElement('a'); a.href = link.href; a.textContent = link.text; el.message.appendChild(a); }
    el.message.dataset.tone = tone || 'info';
    el.message.hidden = false;
  }
  const clearMsg = () => { el.message.hidden = true; el.message.textContent = ''; };

  /* Blur that does not fade at the borders: the canvas filter treats
     everything outside the picture as transparent, so the edge pixels are
     first stretched outwards by the blur's reach, then cropped back. */
  function blurredCopy(src, radius) {
    const w = src.width, h = src.height;
    const out = makeCanvas(w, h);
    const o = out.getContext('2d');
    if (!(radius > 0)) { o.drawImage(src, 0, 0); return out; }
    const pad = Math.ceil(radius * 2.5) + 2;
    const ext = makeCanvas(w + pad * 2, h + pad * 2);
    const e = ext.getContext('2d');
    e.imageSmoothingEnabled = false;
    e.drawImage(src, pad, pad);
    e.drawImage(src, 0, 0, w, 1, pad, 0, w, pad);
    e.drawImage(src, 0, h - 1, w, 1, pad, pad + h, w, pad);
    e.drawImage(src, 0, 0, 1, h, 0, pad, pad, h);
    e.drawImage(src, w - 1, 0, 1, h, pad + w, pad, pad, h);
    e.drawImage(src, 0, 0, 1, 1, 0, 0, pad, pad);
    e.drawImage(src, w - 1, 0, 1, 1, pad + w, 0, pad, pad);
    e.drawImage(src, 0, h - 1, 1, 1, 0, pad + h, pad, pad);
    e.drawImage(src, w - 1, h - 1, 1, 1, pad + w, pad + h, pad, pad);
    o.filter = 'blur(' + radius + 'px)';
    o.drawImage(ext, -pad, -pad);
    o.filter = 'none';
    ext.width = 0; ext.height = 0;
    return out;
  }
  // Sharp centre, blurred edges. `radius` is the slider value (it also sets
  // how big the sharp centre is); `k` scales the blur for a bigger canvas.
  function edgeComposite(src, radius, k) {
    const w = src.width, h = src.height;
    const out = blurredCopy(src, radius * k);
    const mask = copyCanvas(src);
    const mx = mask.getContext('2d');
    mx.globalCompositeOperation = 'destination-in';
    const cx = w / 2, cy = h / 2;
    const inner = Math.min(w, h) * clamp(0.5 - radius / 120, 0.1, 0.48);
    const outer = Math.min(w, h) * 0.62;
    const grad = mx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    mx.fillStyle = grad; mx.fillRect(0, 0, w, h);
    out.getContext('2d').drawImage(mask, 0, 0);
    mask.width = 0; mask.height = 0;
    return out;
  }
  function pixelateOn(ctx, src, x, y, w, h, px) {
    const sw = Math.max(1, Math.round(w / px)), sh = Math.max(1, Math.round(h / px));
    const t = makeCanvas(sw, sh);
    t.getContext('2d').drawImage(src, x, y, w, h, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, 0, 0, sw, sh, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }
  function brushOn(ctx, blurred, pts, rad) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i] + rad, pts[i + 1]); ctx.arc(pts[i], pts[i + 1], rad, 0, Math.PI * 2); }
    ctx.clip();
    ctx.drawImage(blurred, 0, 0);
    ctx.restore();
  }

  /* ---------- phase, busy, phone bar ---------- */
  function setPhase() {
    const at = !committed ? 0 : downloaded ? 2 : 1;
    el.steps.forEach((li, i) => {
      li.classList.toggle('is-active', i === at);
      li.classList.toggle('is-done', i < at);
      if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (el.topGrid) el.topGrid.classList.toggle('is-editing', !!committed);
    updateSticky();
  }
  function setBusy(on) {
    busy = on;
    root.classList.toggle('is-busy', on);
    [el.downloadBtn, el.applyBtn, el.remove, el.resetImg, el.sample].concat(el.pickers, el.modes).forEach((b) => { if (b) b.disabled = on; });
    if (!on) updateHistoryButtons(); else { el.undo.disabled = true; el.redo.disabled = true; }
    updateSticky();
  }
  // Phone bottom bar: the picker while the tool is off screen, then Download
  // while the studio's own Download button is.
  function updateSticky() {
    if (!el.stickyBar || !el.stickyBtn) return;
    let label = 'Select image', show = !inView.tool;
    if (committed) { label = 'Download blurred image'; show = !inView.download; }
    show = show && phoneQuery.matches && !busy;
    if (el.stickyBtn.textContent !== label) el.stickyBtn.textContent = label;
    el.stickyBar.classList.toggle('is-visible', show);
    el.stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    el.stickyBtn.tabIndex = show ? 0 : -1;
    const was = document.body.classList.contains('fg-sticky-on');
    document.body.classList.toggle('fg-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }

  /* ---------- loading ---------- */
  function loadFile(file) {
    if (busy) return;
    clearMsg();
    if (!looksImage(file)) { msg('Please choose a valid image (JPG, PNG, WebP, GIF or BMP).', 'error'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); setupImage(img, file, file.name || 'image.png', file.size, file.type || 'image'); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (isHeic(file)) msg('This browser cannot open HEIC photos. Convert it to JPG first.', 'error', { href: 'heic-converter.html', text: 'Open HEIC Converter' });
      else msg('Could not load that image.', 'error');
    };
    img.src = url;
  }

  function setupImage(img, file, name, sizeBytes, type) {
    NW = img.naturalWidth || img.width; NH = img.naturalHeight || img.height;
    const scale = Math.min(1, MAX_DIM / Math.max(NW, NH));
    W = Math.max(1, Math.round(NW * scale));
    H = Math.max(1, Math.round(NH * scale));
    sourceFile = file;
    sampleCanvas = file ? null : img;
    original = makeCanvas(W, H);
    const octx = original.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(img, 0, 0, W, H);
    committed = copyCanvas(original);
    cctx = committed.getContext('2d');
    el.canvas.width = W; el.canvas.height = H;
    ops = []; redoOps = []; history = []; redoStack = []; selRect = null; stroke = null; previewCache = null; downloaded = false;
    fullBase = copyCanvas(committed); fullBaseAt = 0;
    el.fileName.textContent = name;
    el.fileName.title = name;
    el.fileDims.textContent = NW + ' × ' + NH + ' px';
    el.fileSize.textContent = sizeBytes ? fmt(sizeBytes) : 'sample';
    el.fileType.textContent = (type || '').replace('image/', '').toUpperCase() || 'IMAGE';
    const outScale = Math.min(1, Math.sqrt(MAX_EXPORT / (NW * NH)));
    el.scaleNote.hidden = scale === 1;
    el.scaleNote.textContent = scale === 1 ? '' : 'Editing a ' + W + ' × ' + H + ' preview for speed; the download is rebuilt at ' +
      Math.round(NW * outScale) + ' × ' + Math.round(NH * outScale) + ' px' + (outScale < 1 ? ' (capped at ' + (MAX_EXPORT / 1e6) + ' megapixels on this device).' : ', full size.');
    el.editor.hidden = false;
    el.drop.hidden = true;
    invalidateDownload();
    setMode('area');
    fitWidth = 0;
    requestAnimationFrame(() => { fitZoom(); render(); });
    updateHistoryButtons();
    msg('Image loaded locally in your browser. Choose a blur mode and edit.', 'success');
    setPhase();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function makeSample() {
    const c = makeCanvas(900, 560);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 900, 560);
    g.addColorStop(0, '#e0f2fe'); g.addColorStop(1, '#f0f9ff');
    x.fillStyle = g; x.fillRect(0, 0, 900, 560);
    x.fillStyle = '#ffffff'; x.strokeStyle = '#cbd5e1';
    x.fillRect(60, 60, 780, 440); x.strokeRect(60, 60, 780, 440);
    x.fillStyle = '#0369a1'; x.fillRect(60, 60, 780, 64);
    x.fillStyle = '#fff'; x.font = 'bold 26px system-ui,sans-serif'; x.fillText('Order Confirmation', 90, 102);
    x.fillStyle = '#0f172a'; x.font = '20px system-ui,sans-serif';
    ['Name:  Alex Sample Kumar', 'Email:  alex.sample@example.com', 'Phone:  +91 90000 12345', 'Address:  221B Demo Street, Test City', 'Order ID:  TA-2026-00918273', 'Card:  **** **** **** 4242', 'Amount:  Rs 2,499.00']
      .forEach((t, i) => x.fillText(t, 90, 175 + i * 44));
    x.fillStyle = '#64748b'; x.font = '15px system-ui,sans-serif';
    x.fillText('Try the blur/pixelate tools on the sensitive lines above.', 90, 484);
    return c;
  }

  /* ---------- drawing the preview ---------- */
  const pendingKind = () => (mode === 'full' || mode === 'edge') && Number(el.intensity.value) > 0 ? mode : null;
  function preview() {
    const kind = pendingKind();
    if (!kind) return null;
    const r = Number(el.intensity.value);
    const key = kind + ':' + r + ':' + fullBaseAt + ':' + ops.length;
    if (!previewCache || previewCache.key !== key) {
      if (previewCache) free(previewCache.canvas);
      previewCache = { key, canvas: kind === 'full' ? blurredCopy(fullBase, r) : edgeComposite(fullBase, r, 1) };
    }
    return previewCache.canvas;
  }
  // Full and edge show what Apply would give; the download bakes it in.
  function isPending() {
    const kind = pendingKind();
    if (!kind) return false;
    const last = ops[ops.length - 1];
    return !(last && last.t === kind && last.r === Number(el.intensity.value) && last.base === fullBaseAt);
  }
  let renderQueued = false;
  function render() {
    renderQueued = false;
    if (!committed) return;
    const v = el.canvas.getContext('2d');
    v.clearRect(0, 0, W, H);
    if (showingOriginal) { v.drawImage(original, 0, 0); return; }
    const p = !dragging && isPending() ? preview() : null;
    v.drawImage(p || committed, 0, 0);
    if (selRect) {
      v.save();
      v.strokeStyle = '#0369a1'; v.lineWidth = Math.max(2, W / 400); v.setLineDash([8, 6]);
      v.strokeRect(selRect.x, selRect.y, selRect.w, selRect.h);
      v.fillStyle = 'rgba(56,189,248,0.18)'; v.fillRect(selRect.x, selRect.y, selRect.w, selRect.h);
      v.restore();
    }
  }
  const queueRender = () => { if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); } };

  /* ---------- zoom ---------- */
  function fitZoom() {
    const availW = Math.max(160, (el.wrap.clientWidth || 600) - 30);
    const availH = Math.max(220, window.innerHeight * 0.58 - 30);
    zoom = clamp(Math.min(availW / W, availH / H, 1), 0.05, 1);
    fitWidth = el.wrap.clientWidth;
    applyZoom();
  }
  function applyZoom() {
    el.canvas.style.width = Math.round(W * zoom) + 'px';
    el.zoomVal.textContent = Math.round(zoom * 100) + '%';
    el.zoomOut.disabled = zoom <= 0.05;
    el.zoomIn.disabled = zoom >= 4;
  }
  function zoomBy(f) {
    const s = el.wrap;
    const cx = (s.scrollLeft + s.clientWidth / 2) / Math.max(1, s.scrollWidth), cy = (s.scrollTop + s.clientHeight / 2) / Math.max(1, s.scrollHeight);
    zoom = clamp(zoom * f, 0.05, 4);
    applyZoom();
    // keep the same spot in the middle of the stage
    s.scrollLeft = cx * s.scrollWidth - s.clientWidth / 2;
    s.scrollTop = cy * s.scrollHeight - s.clientHeight / 2;
  }

  /* ---------- history: an ImageData per edit for undo, plus the edit itself
     so the download can be replayed on the full-size original ---------- */
  function record(op) {
    history.push(cctx.getImageData(0, 0, W, H));
    if (history.length > HISTORY) history.shift();
    redoStack = []; redoOps = [];
    ops.push(op);
    invalidateDownload();
    updateHistoryButtons();
  }
  function refreshFullBase() {
    const old = fullBase;
    fullBase = copyCanvas(committed);
    fullBaseAt = ops.length;
    if (old && old !== committed && old !== original) { old.width = 0; old.height = 0; }
  }
  function updateHistoryButtons() { el.undo.disabled = busy || !history.length; el.redo.disabled = busy || !redoStack.length; }
  function undo() {
    if (!history.length || busy) return;
    redoStack.push(cctx.getImageData(0, 0, W, H));
    redoOps.push(ops.pop());
    cctx.putImageData(history.pop(), 0, 0);
    afterHistoryMove();
  }
  function redo() {
    if (!redoStack.length || busy) return;
    history.push(cctx.getImageData(0, 0, W, H));
    ops.push(redoOps.pop());
    cctx.putImageData(redoStack.pop(), 0, 0);
    afterHistoryMove();
  }
  function afterHistoryMove() { refreshFullBase(); invalidateDownload(); render(); updateHistoryButtons(); }

  // An edit after a download makes that file out of date.
  function invalidateDownload() {
    if (dlUrl) { URL.revokeObjectURL(dlUrl); dlUrl = null; }
    el.downloadLink.classList.add('hidden');
    el.downloadLink.removeAttribute('href');
    el.success.hidden = true;
    if (downloaded) { downloaded = false; setPhase(); }
  }

  /* ---------- edits ---------- */
  function applyFullOrEdge(kind) {
    if (!committed) return;
    const r = Number(el.intensity.value);
    const out = kind === 'full' ? blurredCopy(fullBase, r) : edgeComposite(fullBase, r, 1);
    record({ t: kind, r, base: fullBaseAt });
    cctx.clearRect(0, 0, W, H);
    cctx.drawImage(out, 0, 0);
    free(out);
    // fullBase stays put, so pressing Apply again replaces the effect instead of stacking it
    render();
    msg(kind === 'full' ? 'Full blur applied.' : 'Edge blur applied.', 'success');
  }

  const toCanvas = (e) => {
    const r = el.canvas.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width * W, 0, W), y: clamp((e.clientY - r.top) / r.height * H, 0, H) };
  };
  const normRect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

  function pointerDown(e) {
    if (!committed || showingOriginal || busy) return;
    if (mode !== 'area' && mode !== 'pixelate' && mode !== 'brush') return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    try { el.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    dragging = true;
    const p = toCanvas(e);
    if (mode === 'brush') {
      const r = Number(el.intensity.value), size = Number(el.brush.value);
      record({ t: 'brush', r, size, pts: [] });
      stroke = ops[ops.length - 1];
      brushTmp = blurredCopy(committed, r);
      lastPt = null;
      paintTo(p);
    } else {
      dragStart = p; selRect = { x: p.x, y: p.y, w: 0, h: 0 };
    }
  }
  // Fills the gap between pointer events, so a fast stroke is a line, not dots.
  function paintTo(p) {
    const rad = stroke.size / 2;
    const pts = [];
    if (!lastPt) pts.push(p.x, p.y);
    else {
      const dx = p.x - lastPt.x, dy = p.y - lastPt.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, rad * 0.35);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) pts.push(lastPt.x + dx * i / n, lastPt.y + dy * i / n);
    }
    lastPt = p;
    for (let i = 0; i < pts.length; i++) stroke.pts.push(Math.round(pts[i] * 10) / 10);
    brushOn(cctx, brushTmp, pts, rad);
    queueRender();
  }
  function pointerMove(e) {
    moveRing(e);
    if (!dragging) return;
    const p = toCanvas(e);
    if (mode === 'brush') { e.preventDefault(); paintTo(p); }
    else { selRect = normRect(dragStart, p); queueRender(); }
  }
  function pointerUp() {
    if (!dragging) return;
    dragging = false;
    if (mode === 'brush') {
      free(brushTmp); brushTmp = null; stroke = null; lastPt = null;
      refreshFullBase(); render();
      msg('Brush blur applied.', 'success');
      return;
    }
    const r = selRect; selRect = null;
    if (!r || r.w < 4 || r.h < 4) { render(); return; }
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    if (mode === 'pixelate') {
      const px = Number(el.pixel.value);
      record({ t: 'pixel', x, y, w, h, px });
      pixelateOn(cctx, committed, x, y, w, h, px);
    } else {
      const rr = Number(el.intensity.value);
      record({ t: 'blur', x, y, w, h, r: rr });
      const t = blurredCopy(committed, rr);
      cctx.drawImage(t, x, y, w, h, x, y, w, h);
      free(t);
    }
    refreshFullBase();
    render();
    msg(mode === 'pixelate' ? 'Area pixelated.' : 'Area blurred.', 'success');
  }

  // A ring that shows the brush's real size on screen.
  function moveRing(e) {
    if (mode !== 'brush' || !committed || e.pointerType === 'touch') { hideRing(); return; }
    const r = el.canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { hideRing(); return; }
    if (!ring) { ring = document.createElement('div'); ring.className = 'fg-ring'; ring.setAttribute('aria-hidden', 'true'); document.body.appendChild(ring); }
    const d = Number(el.brush.value) * (r.width / W);
    ring.style.width = ring.style.height = Math.max(4, d) + 'px';
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
    ring.hidden = false;
  }
  const hideRing = () => { if (ring) ring.hidden = true; };

  const MODE_INFO = {
    full: 'Full blur: blur the entire image. Adjust intensity, then press Apply.',
    area: 'Area blur: drag a rectangle over the region you want to hide.',
    brush: 'Brush blur: paint over faces, names or numbers to hide them.',
    pixelate: 'Pixelate: drag a rectangle to cover it with mosaic blocks.',
    edge: 'Edge blur: keep the centre sharp and blur the edges. Adjust, then Apply.',
  };
  function setMode(m) {
    mode = m;
    el.modes.forEach((b) => { const on = b.dataset.mode === m; b.setAttribute('aria-pressed', String(on)); });
    el.ctrlIntensity.hidden = m === 'pixelate';
    el.ctrlBrush.hidden = m !== 'brush';
    el.ctrlPixel.hidden = m !== 'pixelate';
    el.ctrlApply.hidden = !(m === 'full' || m === 'edge');
    el.wrap.classList.toggle('is-drawing', m === 'area' || m === 'pixelate' || m === 'brush');
    el.wrap.classList.toggle('is-brush', m === 'brush');
    el.modeHint.textContent = MODE_INFO[m];
    selRect = null;
    if (m !== 'brush') hideRing();
    render();
  }

  /* ---------- download: replay every edit on the original ---------- */
  function bakePending() { if (committed && isPending()) applyFullOrEdge(pendingKind()); }

  function loadSourceImage() {
    return new Promise((resolve, reject) => {
      if (!sourceFile) { resolve(sampleCanvas); return; }
      const url = URL.createObjectURL(sourceFile);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('reload failed')); };
      img.src = url;
    });
  }

  async function renderFull() {
    const outScale = Math.min(1, Math.sqrt(MAX_EXPORT / (NW * NH)));
    const OW = Math.max(1, Math.round(NW * outScale)), OH = Math.max(1, Math.round(NH * outScale));
    if (OW === W && OH === H) return copyCanvas(committed);
    const src = await loadSourceImage();
    const k = OW / W;
    const out = makeCanvas(OW, OH);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, OW, OH);
    const bases = new Set(ops.filter((o) => o.base != null).map((o) => o.base));
    const stash = {};
    for (let i = 0; i < ops.length; i++) {
      if (bases.has(i)) stash[i] = copyCanvas(out);
      const o = ops[i];
      if (o.t === 'blur') {
        const x = Math.round(o.x * k), y = Math.round(o.y * k), w = Math.round(o.w * k), h = Math.round(o.h * k);
        const t = blurredCopy(out, o.r * k);
        ctx.drawImage(t, x, y, w, h, x, y, w, h);
        t.width = 0;
      } else if (o.t === 'pixel') {
        pixelateOn(ctx, out, Math.round(o.x * k), Math.round(o.y * k), Math.round(o.w * k), Math.round(o.h * k), o.px * k);
      } else if (o.t === 'brush') {
        const t = blurredCopy(out, o.r * k);
        brushOn(ctx, t, o.pts.map((v) => v * k), (o.size / 2) * k);
        t.width = 0;
      } else if (o.t === 'full' || o.t === 'edge') {
        const base = stash[o.base] || out;
        const t = o.t === 'full' ? blurredCopy(base, o.r * k) : edgeComposite(base, o.r, k);
        ctx.clearRect(0, 0, OW, OH);
        ctx.drawImage(t, 0, 0);
        t.width = 0;
      }
      await nextFrame();
    }
    Object.keys(stash).forEach((key) => { stash[key].width = 0; });
    return out;
  }

  const mimeFor = (f) => (f === 'jpeg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : 'image/png');
  const toBlobP = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

  async function download() {
    if (!committed || busy) return;
    bakePending();
    const fmtSel = el.format.value;
    const mime = mimeFor(fmtSel);
    const q = fmtSel === 'png' ? undefined : Number(el.quality.value) / 100;
    setBusy(true);
    const big = W !== NW || H !== NH;
    if (big) msg('Building the full-size image…', 'info');
    await nextFrame();
    let out = null, flat = null;
    try {
      out = await renderFull();
      let src = out;
      // JPG has no transparency; without a fill, clear pixels come out black.
      if (fmtSel === 'jpeg') {
        flat = makeCanvas(out.width, out.height);
        const f = flat.getContext('2d');
        f.fillStyle = '#ffffff'; f.fillRect(0, 0, flat.width, flat.height);
        f.drawImage(out, 0, 0);
        src = flat;
      }
      const blob = await toBlobP(src, mime, q);
      if (!blob || blob.type !== mime) {
        msg('This browser cannot save ' + fmtSel.toUpperCase() + ' files. Choose PNG or JPG.', 'error');
        return;
      }
      if (dlUrl) URL.revokeObjectURL(dlUrl);
      dlUrl = URL.createObjectURL(blob);
      const base = (el.fileName.textContent || 'image').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').trim() || 'image';
      const ext = fmtSel === 'jpeg' ? 'jpg' : fmtSel;
      el.downloadLink.href = dlUrl;
      el.downloadLink.download = base + '-blurred.' + ext;
      el.downloadLink.classList.remove('hidden');
      el.success.hidden = false;
      downloaded = true;
      el.downloadLink.click();
      msg('Blurred image downloaded (' + ext.toUpperCase() + ', ' + src.width + ' × ' + src.height + ' px, ' + fmt(blob.size) + ').', 'success');
    } catch (err) {
      msg('Could not build the download. Try PNG, or a smaller image.', 'error');
    } finally {
      if (flat) { flat.width = 0; flat.height = 0; }
      if (out && out !== committed) { out.width = 0; out.height = 0; }
      setBusy(false);
      setPhase();
    }
  }

  function resetImage() {
    if (!original || busy) return;
    committed = copyCanvas(original); cctx = committed.getContext('2d');
    ops = []; redoOps = []; history = []; redoStack = []; selRect = null; showingOriginal = false;
    refreshFullBase(); invalidateDownload(); render(); updateHistoryButtons();
    msg('Image reset to original.', 'success');
  }
  function removeFile() {
    if (busy) return;
    [original, committed, fullBase].forEach((c) => { if (c) { c.width = 0; c.height = 0; } });
    original = committed = cctx = fullBase = null; sourceFile = null; sampleCanvas = null;
    W = H = NW = NH = 0; ops = []; redoOps = []; history = []; redoStack = []; previewCache = null;
    invalidateDownload();
    el.editor.hidden = true;
    el.drop.hidden = false;
    hideRing();
    clearMsg();
    setPhase();
    const b = el.drop.querySelector('[data-file-picker]');
    if (b) b.focus();
  }

  /* ---------- export formats this browser can actually write ---------- */
  (function probeWebp() {
    const c = makeCanvas(2, 2);
    c.toBlob((b) => {
      if (b && b.type === 'image/webp') return;
      const opt = el.format.querySelector('option[value="webp"]');
      if (opt) opt.disabled = true;
      if (el.format.value === 'webp') el.format.value = 'png';
      el.formatNote.hidden = false;
      el.formatNote.textContent = 'This browser cannot create WebP files, so that option is off. PNG and JPG work everywhere.';
    }, 'image/webp', 0.8);
  })();

  /* ---------- bindings ---------- */
  const openPicker = () => { if (!busy) el.input.click(); };
  el.pickers.forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPicker(); }));
  el.drop.addEventListener('click', (e) => { if (!e.target.closest('button, a, input')) openPicker(); });
  el.input.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) loadFile(f); });
  if (el.sample) el.sample.addEventListener('click', () => { if (!busy) setupImage(makeSample(), null, 'sample-receipt.png', 0, 'image/png'); });

  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
  let dragDepth = 0;
  const clearFileOver = () => { dragDepth = 0; root.classList.remove('is-file-over'); el.drop.classList.remove('is-drag'); };
  // An image can be dropped anywhere on the studio, not only on the drop zone.
  root.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; root.classList.add('is-file-over'); el.drop.classList.add('is-drag'); });
  root.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; });
  root.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) clearFileOver(); });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); clearFileOver();
    const f = Array.from(e.dataTransfer.files || []).find(looksImage);
    if (f) loadFile(f); else msg('Please drop an image file.', 'error');
  });
  // A file dropped anywhere else would make the browser open it and lose the edit.
  window.addEventListener('dragover', (e) => { if (hasFiles(e) && !root.contains(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
  window.addEventListener('drop', (e) => { if (hasFiles(e) && !root.contains(e.target)) e.preventDefault(); });

  window.addEventListener('paste', (e) => {
    if (busy) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const items = (e.clipboardData || {}).items || [];
    for (const it of items) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); loadFile(f); break; } } }
  });

  el.modes.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  el.intensity.addEventListener('input', () => { el.intensityVal.textContent = el.intensity.value + 'px'; if (mode === 'full' || mode === 'edge') queueRender(); });
  el.brush.addEventListener('input', () => { el.brushVal.textContent = el.brush.value + 'px'; });
  el.pixel.addEventListener('input', () => { el.pixelVal.textContent = el.pixel.value + 'px'; });
  el.applyBtn.addEventListener('click', () => { if (mode === 'full' || mode === 'edge') applyFullOrEdge(mode); });

  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  el.resetImg.addEventListener('click', resetImage);
  const showOriginal = (on) => { if (!committed || showingOriginal === on) return; showingOriginal = on; el.beforeAfter.setAttribute('aria-pressed', String(on)); render(); };
  el.beforeAfter.addEventListener('pointerdown', (e) => { e.preventDefault(); showOriginal(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.beforeAfter.addEventListener(ev, () => showOriginal(false)));
  el.beforeAfter.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); showOriginal(true); } });
  el.beforeAfter.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') showOriginal(false); });
  el.beforeAfter.addEventListener('blur', () => showOriginal(false));
  el.beforeAfter.addEventListener('contextmenu', (e) => e.preventDefault());

  el.zoomIn.addEventListener('click', () => zoomBy(1.25));
  el.zoomOut.addEventListener('click', () => zoomBy(1 / 1.25));
  el.zoomFit.addEventListener('click', fitZoom);

  el.canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);
  el.canvas.addEventListener('pointerleave', hideRing);

  document.addEventListener('keydown', (e) => {
    if (!committed || busy || !(e.ctrlKey || e.metaKey)) return;
    const t = e.target;
    if (t && t.closest && t.closest('input:not([type="range"]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  el.format.addEventListener('change', () => { el.qualityWrap.hidden = el.format.value === 'png'; invalidateDownload(); });
  el.quality.addEventListener('input', () => { el.qualityVal.textContent = el.quality.value + '%'; invalidateDownload(); });
  el.downloadBtn.addEventListener('click', download);
  el.remove.addEventListener('click', removeFile);
  // Phones fire resize when the address bar slides; only refit when the width changes.
  window.addEventListener('resize', () => { if (committed && el.wrap.clientWidth !== fitWidth) fitZoom(); });

  if (el.stickyBtn) {
    el.stickyBtn.addEventListener('click', () => {
      if (committed) download();
      else { root.scrollIntoView({ behavior: 'smooth', block: 'start' }); openPicker(); }
    });
  }
  if ('IntersectionObserver' in window) {
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.target === root) inView.tool = en.isIntersecting;
        else if (en.target === el.downloadBtn) inView.download = en.isIntersecting;
      });
      updateSticky();
    });
    watch.observe(root);
    watch.observe(el.downloadBtn);
  }
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);
  window.addEventListener('pagehide', (e) => { if (!e.persisted && dlUrl) URL.revokeObjectURL(dlUrl); });

  setPhase();
})();
