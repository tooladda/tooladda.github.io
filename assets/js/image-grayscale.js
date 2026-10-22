(function () {
  'use strict';

  const root = document.querySelector('[data-grayscale]');
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));

  const el = {
    drop: $('[data-drop]'), input: $('[data-file-input]'), pickers: $$('[data-file-picker]'), sample: $('[data-sample-btn]'),
    editor: $('[data-editor]'),
    compare: $('[data-compare]'), orig: $('[data-orig]'), after: $('[data-after]'), gray: $('[data-gray]'), handle: $('[data-handle]'), slider: $('[data-slider]'),
    strip: $('[data-strip]'), stripWrap: $('[data-strip-wrap]'),
    fname: $('[data-fname]'), fdims: $('[data-fdims]'), fsize: $('[data-fsize]'), ftype: $('[data-ftype]'),
    intensity: $('[data-intensity]'), intensityVal: $('[data-intensity-val]'),
    format: $('[data-format]'), quality: $('[data-quality]'), qualityVal: $('[data-quality-val]'), qualityWrap: $('[data-quality-wrap]'),
    downloadBtn: $('[data-download-btn]'), downloadAll: $('[data-download-all]'), downloadLink: $('[data-download-link]'),
    remove: $('[data-remove]'), reset: $('[data-reset]'),
    message: $('[data-message]'), success: $('[data-success]'),
    sticky: document.querySelector('[data-gs-sticky]'), stickyBtn: document.querySelector('[data-gs-sticky-btn]'),
  };

  const EXPORT_CAP = 3000;
  let items = [];
  let sel = 0;
  let intensity = 100;
  let pct = 50;
  let dlUrl = null;

  const fmt = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB');
  const msg = (t, tone) => { if (!el.message) return; el.message.textContent = t; el.message.hidden = false; el.message.dataset.tone = tone || 'info'; };
  const clearMsg = () => { if (el.message) { el.message.hidden = true; el.message.textContent = ''; } };
  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const looksImage = (f) => f && (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || ''));

  /* ---------- load ---------- */
  function addFiles(fileList) {
    const files = Array.from(fileList).filter(looksImage);
    if (!files.length) { msg('Please choose valid image files (JPG, PNG, WebP, GIF, BMP).', 'error'); return; }
    let pending = files.length;
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        items.push({ file, name: file.name || 'image', size: file.size, type: (file.type || '').replace('image/', '').toUpperCase() || 'IMAGE', img, url });
        if (--pending === 0) afterLoad();
      };
      img.onerror = () => { URL.revokeObjectURL(url); if (--pending === 0) afterLoad(); };
      img.src = url;
    });
  }
  function afterLoad() {
    if (!items.length) { msg('Could not load those images.', 'error'); return; }
    clearMsg();
    if (el.success) el.success.hidden = true;
    el.editor.hidden = false;
    el.drop.classList.add('is-compact');
    if (el.sticky) el.sticky.hidden = false;
    sel = Math.min(sel, items.length - 1);
    if (el.stripWrap) el.stripWrap.hidden = items.length < 2;
    if (el.downloadAll) el.downloadAll.hidden = items.length < 2;
    renderStrip();
    selectItem(items.length === 1 ? 0 : sel);
    el.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- sample ---------- */
  function makeSample() {
    const c = makeCanvas(900, 600);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 900, 600);
    g.addColorStop(0, '#ff6b6b'); g.addColorStop(0.5, '#4ecdc4'); g.addColorStop(1, '#5b5bff');
    x.fillStyle = g; x.fillRect(0, 0, 900, 600);
    for (let i = 0; i < 6; i++) { x.fillStyle = ['#f9c74f', '#90be6d', '#f94144', '#577590', '#f3722c', '#ffffff'][i]; x.beginPath(); x.arc(150 + i * 120, 200 + (i % 2) * 200, 60, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = 'rgba(255,255,255,0.9)'; x.font = 'bold 40px system-ui,sans-serif'; x.fillText('Colour → Grayscale', 250, 320);
    c.toBlob((blob) => { const f = new File([blob], 'sample.png', { type: 'image/png' }); addFiles([f]); }, 'image/png');
  }

  /* ---------- strip ---------- */
  function renderStrip() {
    if (!el.strip) return;
    el.strip.innerHTML = '';
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gs-thumb' + (i === sel ? ' is-active' : '');
      b.title = it.name;
      b.innerHTML = `<img src="${it.url}" alt="${it.name}" style="filter:grayscale(${intensity}%)"><span class="gs-thumb-x" data-x aria-label="Remove">✕</span>`;
      b.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) { removeItem(i); } else selectItem(i); });
      el.strip.appendChild(b);
    });
  }

  /* ---------- select / preview ---------- */
  function selectItem(i) {
    if (!items[i]) return;
    sel = i;
    const it = items[i];
    el.orig.src = it.url;
    el.gray.src = it.url;
    el.fname.textContent = it.name;
    el.fdims.textContent = it.img.naturalWidth + ' × ' + it.img.naturalHeight + ' px';
    el.fsize.textContent = fmt(it.size);
    el.ftype.textContent = it.type;
    applyIntensity();
    setPct(pct);
    sizeGray();
    renderStrip();
  }
  const applyIntensity = () => {
    el.gray.style.filter = 'grayscale(' + intensity + '%)';
    if (el.strip) Array.from(el.strip.querySelectorAll('img')).forEach((im) => im.style.filter = 'grayscale(' + intensity + '%)');
  };
  const sizeGray = () => { if (el.orig.clientWidth) el.gray.style.width = el.orig.clientWidth + 'px'; };
  const setPct = (p) => { pct = Math.max(0, Math.min(100, p)); el.after.style.width = pct + '%'; if (el.handle) el.handle.style.left = pct + '%'; if (el.slider) el.slider.value = String(Math.round(pct)); };

  el.orig.addEventListener('load', sizeGray);
  window.addEventListener('resize', sizeGray);

  /* ---------- compare drag ---------- */
  const dragPct = (e) => { const r = el.compare.getBoundingClientRect(); const cx = (e.touches ? e.touches[0].clientX : e.clientX); setPct(((cx - r.left) / r.width) * 100); };
  let dragging = false;
  el.compare.addEventListener('pointerdown', (e) => { dragging = true; dragPct(e); });
  window.addEventListener('pointermove', (e) => { if (dragging) dragPct(e); });
  window.addEventListener('pointerup', () => { dragging = false; });
  if (el.slider) el.slider.addEventListener('input', () => setPct(Number(el.slider.value)));

  /* ---------- export ---------- */
  const mimeFor = (f) => f === 'jpeg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : 'image/png';

  /* Canvas filter support is not universal — Safari only shipped
     CanvasRenderingContext2D.filter in 15.4. Where it is missing the
     assignment is silently ignored and drawImage writes full colour,
     so the preview (a CSS filter) showed grayscale while the file the
     visitor downloaded was still in colour. Detect it once. */
  const CANVAS_FILTER_OK = (function () {
    try {
      const x = makeCanvas(1, 1).getContext('2d');
      if (!x || !('filter' in x)) return false;
      x.filter = 'grayscale(100%)';
      return x.filter === 'grayscale(100%)';
    } catch (e) { return false; }
  }());

  /* Same maths the CSS grayscale() filter is defined with: BT.709
     luma, then a linear blend back toward the original by (1 - amount).
     Matching the spec means the fallback and the fast path produce
     identical pixels, so a download never depends on the browser. */
  function grayscalePixels(x, w, h, amount) {
    const data = x.getImageData(0, 0, w, h);
    const p = data.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      p[i] += (lum - p[i]) * amount;
      p[i + 1] += (lum - p[i + 1]) * amount;
      p[i + 2] += (lum - p[i + 2]) * amount;
    }
    x.putImageData(data, 0, 0);
  }

  const renderGray = (it) => {
    const s = Math.min(1, EXPORT_CAP / Math.max(it.img.naturalWidth, it.img.naturalHeight));
    const w = Math.max(1, Math.round(it.img.naturalWidth * s)), h = Math.max(1, Math.round(it.img.naturalHeight * s));
    const c = makeCanvas(w, h); const x = c.getContext('2d');
    if (mimeFor(el.format.value) === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }

    if (CANVAS_FILTER_OK) {
      x.filter = 'grayscale(' + intensity + '%)';
      x.drawImage(it.img, 0, 0, w, h);
      x.filter = 'none';
    } else {
      x.drawImage(it.img, 0, 0, w, h);
      if (intensity > 0) grayscalePixels(x, w, h, intensity / 100);
    }
    return c;
  };
  const extOf = () => (el.format.value === 'jpeg' ? 'jpg' : el.format.value);
  function downloadCurrent() {
    const it = items[sel]; if (!it) return;
    const q = el.format.value === 'png' ? undefined : Number(el.quality.value) / 100;
    renderGray(it).toBlob((blob) => {
      if (!blob) { msg('This format is not supported by your browser. Try PNG.', 'error'); return; }
      if (dlUrl) URL.revokeObjectURL(dlUrl);
      dlUrl = URL.createObjectURL(blob);
      el.downloadLink.href = dlUrl;
      el.downloadLink.download = it.name.replace(/\.[^.]+$/, '') + '-grayscale.' + extOf();
      el.downloadLink.classList.remove('hidden');
      if (el.success) el.success.hidden = false;
      el.downloadLink.click();
      msg('Grayscale image downloaded.', 'success');
    }, mimeFor(el.format.value), q);
  }
  async function downloadAllZip() {
    if (items.length < 2 || typeof JSZip === 'undefined') { downloadCurrent(); return; }
    msg('Preparing ZIP of ' + items.length + ' grayscale images…', 'info');
    const zip = new JSZip();
    const q = el.format.value === 'png' ? undefined : Number(el.quality.value) / 100;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const blob = await new Promise((res) => renderGray(it).toBlob(res, mimeFor(el.format.value), q));
      if (blob) zip.file(it.name.replace(/\.[^.]+$/, '') + '-grayscale.' + extOf(), blob);
    }
    const out = await zip.generateAsync({ type: 'blob' });
    if (dlUrl) URL.revokeObjectURL(dlUrl);
    dlUrl = URL.createObjectURL(out);
    const a = document.createElement('a'); a.href = dlUrl; a.download = 'grayscale-images.zip'; a.click();
    if (el.success) el.success.hidden = false;
    msg('ZIP with ' + items.length + ' grayscale images downloaded.', 'success');
  }

  /* ---------- remove / reset ---------- */
  function removeItem(i) {
    if (items[i]) { URL.revokeObjectURL(items[i].url); items.splice(i, 1); }
    if (!items.length) { resetAll(); return; }
    sel = Math.min(sel, items.length - 1);
    if (el.stripWrap) el.stripWrap.hidden = items.length < 2;
    if (el.downloadAll) el.downloadAll.hidden = items.length < 2;
    selectItem(sel);
  }
  function resetAll() {
    items.forEach((it) => URL.revokeObjectURL(it.url));
    items = []; sel = 0;
    if (dlUrl) { URL.revokeObjectURL(dlUrl); dlUrl = null; }
    el.editor.hidden = true; el.drop.classList.remove('is-compact');
    if (el.sticky) el.sticky.hidden = true;
    if (el.downloadLink) el.downloadLink.classList.add('hidden');
    if (el.success) el.success.hidden = true;
    clearMsg();
  }

  /* ---------- bindings ---------- */
  const openPicker = () => el.input.click();
  el.pickers.forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPicker(); }));
  el.drop.addEventListener('click', (e) => { if (!e.target.closest('button')) openPicker(); });
  el.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  ['dragenter', 'dragover'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((t) => el.drop.addEventListener(t, () => el.drop.classList.remove('is-drag')));
  el.drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  el.input.addEventListener('change', (e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; });
  if (el.sample) el.sample.addEventListener('click', makeSample);
  window.addEventListener('paste', (e) => {
    const its = (e.clipboardData || {}).items || []; const files = [];
    for (const it of its) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); } }
    if (files.length) { addFiles(files); e.preventDefault(); }
  });

  /* One place sets the intensity, so the slider, the quick-picks, the
     readout and the preview can never show different numbers. */
  function setIntensity(v) {
    intensity = Math.max(0, Math.min(100, Number(v) || 0));
    el.intensity.value = String(intensity);
    el.intensityVal.textContent = intensity + '%';
    applyIntensity();
    syncIntensityChips();
  }
  function syncIntensityChips() {
    const chips = root.querySelectorAll('[data-set-intensity]');
    Array.prototype.forEach.call(chips, (b) => {
      const on = Number(b.getAttribute('data-set-intensity')) === intensity;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  el.intensity.addEventListener('input', () => setIntensity(el.intensity.value));
  root.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-set-intensity]');
    if (b) setIntensity(b.getAttribute('data-set-intensity'));
  });
  syncIntensityChips();
  if (el.format) el.format.addEventListener('change', () => { if (el.qualityWrap) el.qualityWrap.hidden = el.format.value === 'png'; });
  if (el.quality) el.quality.addEventListener('input', () => { el.qualityVal.textContent = el.quality.value + '%'; });
  el.downloadBtn.addEventListener('click', downloadCurrent);
  if (el.downloadAll) el.downloadAll.addEventListener('click', downloadAllZip);
  if (el.stickyBtn) el.stickyBtn.addEventListener('click', () => (items.length > 1 ? downloadAllZip() : downloadCurrent()));
  if (el.remove) el.remove.addEventListener('click', () => removeItem(sel));
  if (el.reset) el.reset.addEventListener('click', resetAll);
})();
