(function () {
  'use strict';

  const page = document.querySelector('[data-ruler-page]');
  if (!page) {
    return;
  }

  const PALETTE = ['#4f46e5', '#f97316', '#10b981', '#ef4444', '#8b5cf6', '#0ea5e9', '#eab308', '#ec4899'];

  /* ================= Tabs ================= */
  const tabs = Array.from(page.querySelectorAll('.ruler-tab'));
  const panels = Array.from(page.querySelectorAll('.ruler-panel'));
  let activePanel = 'screen';

  const activateTab = (name) => {
    activePanel = name;
    tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

  /* ================= On-screen ruler ================= */
  const stage = page.querySelector('[data-ruler-stage]');
  const ruler = page.querySelector('[data-screen-ruler]');
  const readout = page.querySelector('[data-ruler-readout]');
  const orientationBtn = page.querySelector('[data-orientation]');
  const rulerReset = page.querySelector('[data-ruler-reset]');
  const stageCoords = page.querySelector('[data-stage-coords]');
  const stageBg = page.querySelector('[data-stage-bg]');
  const screenStatus = page.querySelector('[data-screen-status]');
  const captureRulerBtn = page.querySelector('[data-capture-ruler]');
  const clearCaptureBtn = page.querySelector('[data-clear-capture]');

  const DEFAULT_H = { left: 40, top: 140, width: 340, height: 66 };
  const DEFAULT_V = { left: 40, top: 60, width: 66, height: 340 };
  const MIN_SIZE = 24;

  let vertical = false;
  let rulerState = { ...DEFAULT_H };
  let screenScale = null; // displayed-px -> screen-px factor (1 displayed px = 1/scale screen px)

  const toScreenPx = (v) => Math.round(v / screenScale);

  const applyRuler = (s) => {
    ruler.style.left = s.left + 'px';
    ruler.style.top = s.top + 'px';
    ruler.style.width = s.width + 'px';
    ruler.style.height = s.height + 'px';
    let text = Math.round(s.width) + ' × ' + Math.round(s.height) + ' px';
    if (screenScale) {
      text += '  →  screen: ' + toScreenPx(s.width) + ' × ' + toScreenPx(s.height) + ' px';
    }
    readout.textContent = text;
  };
  applyRuler(rulerState);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  let drag = null;

  const startDrag = (event, mode) => {
    event.preventDefault();
    drag = { mode, startX: event.clientX, startY: event.clientY, orig: { ...rulerState } };
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  };

  const onDrag = (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const rect = stage.getBoundingClientRect();
    const next = { ...drag.orig };
    if (drag.mode === 'move') {
      next.left = clamp(drag.orig.left + dx, 0, rect.width - next.width);
      next.top = clamp(drag.orig.top + dy, 0, rect.height - next.height);
    } else {
      if (drag.mode === 'e' || drag.mode === 'se') {
        next.width = clamp(drag.orig.width + dx, MIN_SIZE, rect.width - next.left);
      }
      if (drag.mode === 's' || drag.mode === 'se') {
        next.height = clamp(drag.orig.height + dy, MIN_SIZE, rect.height - next.top);
      }
    }
    rulerState = next;
    applyRuler(rulerState);
  };

  const endDrag = () => {
    drag = null;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
  };

  ruler.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-resize]');
    startDrag(event, handle ? handle.dataset.resize : 'move');
  });

  orientationBtn.addEventListener('click', () => {
    vertical = !vertical;
    ruler.classList.toggle('vertical', vertical);
    orientationBtn.setAttribute('aria-pressed', String(vertical));
    rulerState = vertical ? { ...DEFAULT_V } : { ...DEFAULT_H };
    applyRuler(rulerState);
  });

  rulerReset.addEventListener('click', () => {
    vertical = false;
    ruler.classList.remove('vertical');
    orientationBtn.setAttribute('aria-pressed', 'false');
    rulerState = { ...DEFAULT_H };
    clearCapture();
    applyRuler(rulerState);
    stage.querySelectorAll('.guide').forEach((g) => g.remove());
  });

  stage.addEventListener('pointermove', (event) => {
    const rect = stage.getBoundingClientRect();
    const x = Math.round(event.clientX - rect.left + stage.scrollLeft);
    const y = Math.round(event.clientY - rect.top + stage.scrollTop);
    if (screenScale) {
      stageCoords.textContent = 'screen x: ' + toScreenPx(x) + ' , y: ' + toScreenPx(y);
    } else {
      stageCoords.textContent = 'x: ' + x + ' , y: ' + y;
    }
  });

  /* Capture a screen/window as the ruler backdrop */
  const setScreenStatus = (msg) => {
    screenStatus.hidden = false;
    screenStatus.textContent = msg;
    screenStatus.classList.add('active');
  };

  const clearCapture = () => {
    stageBg.hidden = true;
    stageBg.removeAttribute('src');
    stage.classList.remove('has-bg');
    stage.style.height = '';
    screenScale = null;
    clearCaptureBtn.hidden = true;
    screenStatus.hidden = true;
    screenStatus.classList.remove('active');
    applyRuler(rulerState);
  };

  captureRulerBtn.addEventListener('click', async () => {
    const frame = await grabDisplayFrame((msg) => setScreenStatus('⚠️ ' + msg));
    if (!frame) return;
    const rect = stage.getBoundingClientRect();
    const scale = Math.min(1, (rect.width - 2) / frame.w);
    screenScale = scale;
    stageBg.src = frame.dataUrl;
    stageBg.style.width = (frame.w * scale) + 'px';
    stageBg.style.height = (frame.h * scale) + 'px';
    stageBg.hidden = false;
    stage.classList.add('has-bg');
    stage.style.height = Math.max(460, frame.h * scale) + 'px';
    clearCaptureBtn.hidden = false;
    setScreenStatus('Captured ' + frame.w + '×' + frame.h + ' screen. The ruler readout now also shows real screen pixels — drag it over what you want to measure. Use "Clear capture" to remove.');
    // keep ruler inside the new stage bounds
    rulerState.left = Math.min(rulerState.left, Math.max(0, stage.clientWidth - rulerState.width));
    rulerState.top = Math.min(rulerState.top, Math.max(0, (frame.h * scale) - rulerState.height));
    applyRuler(rulerState);
  });

  clearCaptureBtn.addEventListener('click', clearCapture);

  /* Guides */
  const addGuide = (type) => {
    const rect = stage.getBoundingClientRect();
    const guide = document.createElement('div');
    guide.className = 'guide ' + type;
    const label = document.createElement('span');
    label.className = 'guide-label';
    guide.appendChild(label);

    let pos = type === 'h' ? rect.height / 2 : rect.width / 2;
    const place = () => {
      if (type === 'h') { guide.style.top = pos + 'px'; label.textContent = 'y ' + Math.round(pos); }
      else { guide.style.left = pos + 'px'; label.textContent = 'x ' + Math.round(pos); }
    };
    place();

    guide.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const move = (e) => {
        const r = stage.getBoundingClientRect();
        pos = type === 'h' ? clamp(e.clientY - r.top, 0, r.height) : clamp(e.clientX - r.left, 0, r.width);
        place();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    // double-click to remove
    guide.addEventListener('dblclick', () => guide.remove());
    stage.appendChild(guide);
  };

  page.querySelectorAll('[data-add-guide]').forEach((btn) => {
    btn.addEventListener('click', () => addGuide(btn.dataset.addGuide));
  });
  page.querySelector('[data-clear-guides]').addEventListener('click', () => {
    stage.querySelectorAll('.guide').forEach((g) => g.remove());
  });

  /* ================= Image measurement ================= */
  const fileInput = page.querySelector('[data-file-input]');
  const filePickers = Array.from(page.querySelectorAll('[data-file-picker]'));
  const dropZone = page.querySelector('[data-drop-zone]');
  const measureUi = page.querySelector('[data-measure-ui]');
  const measureLayout = page.querySelector('[data-measure-layout]');
  const measureWrap = page.querySelector('[data-measure-wrap]');
  const canvas = page.querySelector('[data-measure-canvas]');
  const ctx = canvas.getContext('2d');
  const messageBox = page.querySelector('[data-message]');

  const toolButtons = Array.from(page.querySelectorAll('[data-tool]'));
  const zoomInBtn = page.querySelector('[data-zoom-in]');
  const zoomOutBtn = page.querySelector('[data-zoom-out]');
  const zoomFitBtn = page.querySelector('[data-zoom-fit]');
  const zoomResetBtn = page.querySelector('[data-zoom-reset]');
  const zoomLevel = page.querySelector('[data-zoom-level]');
  const exportBtn = page.querySelector('[data-export]');
  const resetBtn = page.querySelector('[data-reset-btn]');

  const livePos = page.querySelector('[data-live-pos]');
  const liveColor = page.querySelector('[data-live-color]');
  const liveSwatch = page.querySelector('[data-live-swatch]');
  const listEl = page.querySelector('[data-measure-list]');
  const countEl = page.querySelector('[data-measure-count]');
  const clearAllBtn = page.querySelector('[data-clear-all]');

  const calValue = page.querySelector('[data-cal-value]');
  const calUnit = page.querySelector('[data-cal-unit]');
  const calSet = page.querySelector('[data-cal-set]');
  const calClear = page.querySelector('[data-cal-clear]');
  const calStatus = page.querySelector('[data-cal-status]');

  let image = null;
  let sampleCanvas = null;
  let sampleCtx = null;
  let zoom = 1;
  let tool = 'distance';
  let current = [];            // in-progress points (image space)
  let measurements = [];       // { type, points:[...], color, id }
  let calibrationRef = null;   // { pxPerUnit, unit }
  let colorIndex = 0;
  let idCounter = 0;

  const pointsNeeded = (t) => (t === 'angle' ? 3 : 2);

  const showMessage = (text, type) => {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  };
  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.classList.add('hidden');
    messageBox.classList.remove('success', 'error');
  };

  /* ---- File loading ---- */
  const openPicker = () => fileInput.click();
  filePickers.forEach((btn) => btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPicker(); }));

  dropZone.addEventListener('click', (e) => { if (!e.target.closest('button')) openPicker(); });
  dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  ['dragenter', 'dragover'].forEach((t) => dropZone.addEventListener(t, (e) => { e.preventDefault(); dropZone.classList.add('active'); }));
  ['dragleave', 'drop'].forEach((t) => dropZone.addEventListener(t, () => dropZone.classList.remove('active')));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) loadFile(e.target.files[0]);
    e.target.value = '';
  });

  // Paste from clipboard
  window.addEventListener('paste', (e) => {
    if (activePanel !== 'image') return;
    const items = (e.clipboardData || {}).items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { loadFile(file); e.preventDefault(); break; }
      }
    }
  });

  const loadImageObject = (img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) { showMessage('Could not read image dimensions.', 'error'); return; }
    image = img;
    current = [];
    measurements = [];
    calibrationRef = null;
    colorIndex = 0;
    // offscreen sampler at native resolution
    sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = w;
    sampleCanvas.height = h;
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    sampleCtx.drawImage(img, 0, 0);

    canvas.width = w;
    canvas.height = h;
    dropZone.hidden = true;
    measureUi.hidden = false;
    fitToView();
    renderList();
    updateCalStatus();
    redraw();
  };

  const loadSrc = (src) => {
    const img = new Image();
    img.onload = () => loadImageObject(img);
    img.onerror = () => showMessage('Could not load that image.', 'error');
    img.src = src;
  };

  const loadFile = (file) => {
    if (!file.type.startsWith('image/')) { showMessage('Please choose a valid image file.', 'error'); return; }
    clearMessage();
    const reader = new FileReader();
    reader.onload = (ev) => loadSrc(ev.target.result);
    reader.readAsDataURL(file);
  };

  /* ---- Shared screen / window capture ---- */
  const grabDisplayFrame = async (notify) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      notify('Screen capture is not supported in this browser. Try pasting a screenshot instead (Ctrl+V).', 'error');
      return null;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never' }, audio: false });
    } catch (err) {
      notify(err && err.name === 'NotAllowedError'
        ? 'Screen capture was cancelled or blocked.'
        : 'Could not start screen capture: ' + (err && err.message ? err.message : 'unknown error') + '.', 'error');
      return null;
    }
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 250)); // let a frame paint
      const w = video.videoWidth;
      const h = video.videoHeight;
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      tmp.getContext('2d').drawImage(video, 0, 0, w, h);
      return { dataUrl: tmp.toDataURL('image/png'), w: w, h: h };
    } catch (err) {
      notify('Could not grab a frame from the capture.', 'error');
      return null;
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  };

  // Image-mode capture buttons
  const captureButtons = Array.from(page.querySelectorAll('[data-capture-screen]'));
  captureButtons.forEach((btn) => btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const frame = await grabDisplayFrame(showMessage);
    if (!frame) return;
    clearMessage();
    loadSrc(frame.dataUrl);
    showMessage('Captured a ' + frame.w + '×' + frame.h + ' frame. Note it is in CSS pixels — calibrate for exact real-world sizes.', 'success');
  }));

  /* ---- Zoom ---- */
  const applyZoom = () => {
    if (!image) return;
    canvas.style.width = (image.naturalWidth * zoom) + 'px';
    canvas.style.height = (image.naturalHeight * zoom) + 'px';
    zoomLevel.textContent = Math.round(zoom * 100) + '%';
  };
  const setZoom = (z) => { zoom = clamp(z, 0.05, 8); applyZoom(); };
  const fitToView = () => {
    if (!image) return;
    const avail = measureWrap.clientWidth - 2;
    zoom = clamp(avail / image.naturalWidth, 0.05, 1);
    applyZoom();
  };

  zoomInBtn.addEventListener('click', () => setZoom(zoom * 1.25));
  zoomOutBtn.addEventListener('click', () => setZoom(zoom / 1.25));
  zoomFitBtn.addEventListener('click', fitToView);
  zoomResetBtn.addEventListener('click', () => setZoom(1));
  measureWrap.addEventListener('wheel', (e) => {
    if (!image || !e.ctrlKey) return; // ctrl+wheel to zoom, plain wheel scrolls
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });

  /* ---- Tool selection ---- */
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool;
      toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      current = [];
      redraw();
    });
  });

  /* ---- Coordinate mapping ---- */
  const toImage = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  };

  /* ---- Geometry ---- */
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const angleAt = (a, v, b) => {
    const a1 = Math.atan2(a.y - v.y, a.x - v.x);
    const a2 = Math.atan2(b.y - v.y, b.x - v.x);
    let deg = Math.abs((a1 - a2) * 180 / Math.PI);
    if (deg > 180) deg = 360 - deg;
    return deg;
  };
  const fmtLen = (px) => {
    if (calibrationRef) {
      const real = px / calibrationRef.pxPerUnit;
      return real.toFixed(2) + ' ' + calibrationRef.unit + ' (' + px.toFixed(1) + ' px)';
    }
    return px.toFixed(1) + ' px';
  };

  const describe = (m) => {
    if (m.type === 'distance') {
      return 'Distance: ' + fmtLen(dist(m.points[0], m.points[1]));
    }
    if (m.type === 'angle') {
      return 'Angle: ' + angleAt(m.points[0], m.points[1], m.points[2]).toFixed(1) + '°';
    }
    if (m.type === 'area') {
      const w = Math.abs(m.points[1].x - m.points[0].x);
      const h = Math.abs(m.points[1].y - m.points[0].y);
      if (calibrationRef) {
        const rw = w / calibrationRef.pxPerUnit, rh = h / calibrationRef.pxPerUnit, u = calibrationRef.unit;
        return 'Area: ' + rw.toFixed(2) + '×' + rh.toFixed(2) + ' ' + u + ' = ' + (rw * rh).toFixed(2) + ' ' + u + '²';
      }
      return 'Area: ' + Math.round(w) + '×' + Math.round(h) + ' = ' + Math.round(w * h) + ' px²';
    }
    return '';
  };

  /* ---- Drawing ---- */
  const drawDot = (p, color) => {
    const r = Math.max(3, 4 / zoom);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.5 / zoom);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  };

  const drawMeasurement = (m, isCurrent) => {
    const color = m.color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 2 / zoom);
    const pts = m.points;
    if (m.type === 'distance' || m.type === 'angle') {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    } else if (m.type === 'area' && pts.length === 2) {
      const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
      const w = Math.abs(pts[1].x - pts[0].x), h = Math.abs(pts[1].y - pts[0].y);
      ctx.fillStyle = color + '22';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    pts.forEach((p) => drawDot(p, color));

    if (!isCurrent && pts.length >= pointsNeeded(m.type)) {
      // label near first point
      const label = describe(m).replace(/\s*\(.*px\)$/, '');
      ctx.font = (Math.max(11, 13 / zoom)) + 'px sans-serif';
      const lx = pts[0].x + 6, ly = pts[0].y - 6;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(lx - 2, ly - (13 / zoom), tw + 6, 16 / zoom);
      ctx.fillStyle = color;
      ctx.fillText(label, lx, ly);
    }
  };

  const redraw = () => {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    measurements.forEach((m) => drawMeasurement(m, false));
    if (current.length) {
      drawMeasurement({ type: tool, points: current, color: PALETTE[colorIndex % PALETTE.length] }, true);
    }
  };

  /* ---- Clicking to place points ---- */
  canvas.addEventListener('click', (event) => {
    if (!image) return;
    current.push(toImage(event));
    if (current.length === pointsNeeded(tool)) {
      const m = { id: ++idCounter, type: tool, points: current.slice(), color: PALETTE[colorIndex % PALETTE.length] };
      measurements.push(m);
      colorIndex++;
      current = [];
      renderList();
    }
    redraw();
  });

  /* ---- Live cursor readout ---- */
  canvas.addEventListener('mousemove', (event) => {
    if (!image || !sampleCtx) return;
    const p = toImage(event);
    const ix = clamp(Math.floor(p.x), 0, canvas.width - 1);
    const iy = clamp(Math.floor(p.y), 0, canvas.height - 1);
    livePos.textContent = ix + ', ' + iy + ' px';
    try {
      const d = sampleCtx.getImageData(ix, iy, 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      liveColor.textContent = hex.toUpperCase() + ' · rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
      liveSwatch.style.background = hex;
    } catch (err) { /* cross-origin safety */ }
  });

  /* ---- Measurement list ---- */
  const renderList = () => {
    countEl.textContent = '(' + measurements.length + ')';
    listEl.innerHTML = '';
    if (!measurements.length) {
      const li = document.createElement('li');
      li.style.color = 'var(--text-muted)';
      li.style.border = 'none';
      li.style.background = 'transparent';
      li.textContent = 'No measurements yet.';
      listEl.appendChild(li);
      return;
    }
    measurements.forEach((m) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = m.color;
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = describe(m);
      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete measurement');
      del.textContent = '✕';
      del.addEventListener('click', () => {
        measurements = measurements.filter((x) => x.id !== m.id);
        renderList();
        redraw();
      });
      li.append(dot, txt, del);
      listEl.appendChild(li);
    });
  };

  clearAllBtn.addEventListener('click', () => {
    measurements = [];
    current = [];
    colorIndex = 0;
    renderList();
    redraw();
  });

  /* ---- Calibration ---- */
  const updateCalStatus = () => {
    if (calibrationRef) {
      calStatus.textContent = 'Calibrated: ' + calibrationRef.pxPerUnit.toFixed(2) + ' px = 1 ' + calibrationRef.unit + '. Measurements show real units.';
      calStatus.classList.add('active');
    } else {
      calStatus.textContent = 'No calibration — results shown in pixels. Measure a known length with the Distance tool, then set it as reference.';
      calStatus.classList.remove('active');
    }
  };

  calSet.addEventListener('click', () => {
    const lastDistance = [...measurements].reverse().find((m) => m.type === 'distance');
    if (!lastDistance) { showMessage('Measure a known length with the Distance tool first.', 'error'); return; }
    const value = parseFloat(calValue.value);
    if (!value || value <= 0) { showMessage('Enter a positive known distance to calibrate.', 'error'); return; }
    const px = dist(lastDistance.points[0], lastDistance.points[1]);
    calibrationRef = { pxPerUnit: px / value, unit: calUnit.value };
    clearMessage();
    updateCalStatus();
    renderList();
    redraw();
  });

  calClear.addEventListener('click', () => {
    calibrationRef = null;
    calValue.value = '';
    updateCalStatus();
    renderList();
    redraw();
  });

  /* ---- Export ---- */
  exportBtn.addEventListener('click', () => {
    if (!measurements.length) { showMessage('Nothing to export yet.', 'error'); return; }
    const rows = [['#', 'type', 'value', 'points(px)']];
    measurements.forEach((m, i) => {
      const pts = m.points.map((p) => Math.round(p.x) + ':' + Math.round(p.y)).join(' | ');
      rows.push([i + 1, m.type, '"' + describe(m).replace(/^[^:]+:\s*/, '') + '"', '"' + pts + '"']);
    });
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'measurements-tooladda.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  /* ---- Reset ---- */
  resetBtn.addEventListener('click', () => {
    image = null;
    sampleCanvas = null;
    sampleCtx = null;
    current = [];
    measurements = [];
    calibrationRef = null;
    colorIndex = 0;
    zoom = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    measureUi.hidden = true;
    dropZone.hidden = false;
    calValue.value = '';
    livePos.textContent = '–';
    liveColor.textContent = '–';
    liveSwatch.style.background = 'transparent';
    clearMessage();
    renderList();
    updateCalStatus();
  });

  window.addEventListener('resize', () => { if (image && zoom < 1) fitToView(); });

  renderList();
  updateCalStatus();
})();
