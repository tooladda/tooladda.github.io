(function () {
  'use strict';

  const tool = document.querySelector('[data-rotate-page]');
  if (!tool) return;

  const $ = (s) => tool.querySelector(s);
  const els = {
    topGrid: document.querySelector('.rt-top'),
    dropZone: $('[data-drop-zone]'),
    fileInput: $('[data-file-input]'),
    pickers: Array.from(tool.querySelectorAll('[data-file-picker]')),
    editor: $('[data-editor]'),
    thumbs: $('[data-thumbs]'),
    fileName: $('[data-file-name]'),
    pageCount: $('[data-page-count]'),
    fileSize: $('[data-file-size]'),
    allLeft: $('[data-rotate-all-left]'),
    allRight: $('[data-rotate-all-right]'),
    all180: $('[data-rotate-all-180]'),
    selectAll: $('[data-select-all]'),
    selectBtns: Array.from(tool.querySelectorAll('[data-select]')),
    zoomIn: $('[data-zoom-in]'),
    zoomOut: $('[data-zoom-out]'),
    processBtn: $('[data-process-btn]'),
    download: $('[data-download-link]'),
    reset: $('[data-reset-btn]'),
    remove: $('[data-remove-file]'),
    another: $('[data-rotate-another]'),
    message: $('[data-message]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    progressText: $('[data-progress-text]'),
    selNote: $('[data-selection-note]'),
    scope: $('[data-scope]'),
    summary: $('[data-summary]'),
    summaryText: $('[data-summary-text]'),
    result: $('[data-result]'),
    resultSummary: $('[data-result-summary]'),
    steps: Array.from(tool.querySelectorAll('[data-rt-step]')),
    stickyBar: document.querySelector('.rt-sticky-cta'),
    stickyBtn: document.querySelector('[data-sticky-cta]'),
  };

  const MAX_SIZE = 100 * 1024 * 1024;
  const ZOOMS = [120, 150, 185, 230];
  const PAGE_DRAG = 'application/x-tooladda-page';
  const phoneQuery = window.matchMedia('(max-width: 768px)');

  const ICON = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>',
  };

  let sourceBytes = null; // the file as read; never modified, every export starts from it
  let sourceName = 'document.pdf';
  let pdfjsDoc = null;
  let docToken = 0; // bumped whenever the open file changes, so late renders for an old file are dropped
  let pages = []; // display order: { index, base, rotation, visual, selected, w, h, tile, renderedAt, rendering }
  let zoomIndex = 1;
  let resultUrl = null;
  let busy = false;
  let phase = 'upload';
  let thumbObserver = null;
  let dragPage = null;
  let dropMark = null;
  let lastClicked = null;
  const inView = { tool: true, process: false, download: false };

  const pdfjs = window.pdfjsLib || null;
  if (pdfjs && pdfjs.GlobalWorkerOptions) {
    try { pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch (e) { /* previews fall back to page labels */ }
  }

  /* ---------- small helpers ---------- */
  const norm = (deg) => ((Math.round((Number(deg) || 0) / 90) * 90) % 360 + 360) % 360;
  const fmt = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const looksPdf = (f) => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
  const baseName = (n) => String(n || '').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').trim() || 'document';
  const angleLabel = (r) => (r === 90 ? '+90°' : r === 180 ? '180°' : r === 270 ? '−90°' : '');
  const make = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  const iconButton = (cls, svg) => { const b = make('button', cls); b.type = 'button'; b.innerHTML = svg; return b; };

  function showMsg(text, tone, link) {
    els.message.textContent = text;
    if (link) {
      els.message.append(' ');
      const a = make('a');
      a.href = link.href;
      a.textContent = link.text;
      els.message.appendChild(a);
    }
    els.message.dataset.tone = tone || 'info';
    els.message.hidden = false;
  }
  function clearMsg() { els.message.hidden = true; els.message.textContent = ''; }

  function setProgress(pct, text) {
    if (pct == null) { els.progress.hidden = true; return; }
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    els.progress.hidden = false;
    els.progressBar.style.width = v + '%';
    els.progress.setAttribute('aria-valuenow', String(v));
    if (text) els.progressText.textContent = text;
  }

  function setPhase(next) {
    phase = next;
    const at = ['upload', 'edit', 'result'].indexOf(next);
    els.steps.forEach((li, i) => {
      li.classList.toggle('is-active', i === at);
      li.classList.toggle('is-done', i < at);
      if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (els.topGrid) els.topGrid.classList.toggle('is-editing', next !== 'upload');
    updateSticky();
  }

  function setBusy(on) {
    busy = on;
    tool.classList.toggle('is-busy', on);
    [els.processBtn, els.allLeft, els.allRight, els.all180, els.selectAll, els.reset, els.remove, els.another]
      .concat(els.pickers, els.selectBtns)
      .forEach((b) => { if (b) b.disabled = on; });
    if (!on) updateZoomButtons(); else { els.zoomIn.disabled = true; els.zoomOut.disabled = true; }
    updateSticky();
  }

  /* Phone bottom bar: the picker while the tool is off screen, then Rotate &
     download while that button is, then Download again for the result. */
  function updateSticky() {
    if (!els.stickyBar || !els.stickyBtn) return;
    let label = 'Select PDF file';
    let show = !inView.tool;
    if (phase === 'edit') { label = 'Rotate & download PDF'; show = !inView.process; }
    else if (phase === 'result') { label = 'Download again'; show = !inView.download; }
    show = show && phoneQuery.matches && !busy;
    if (els.stickyBtn.textContent !== label) els.stickyBtn.textContent = label;
    els.stickyBar.classList.toggle('is-visible', show);
    els.stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    els.stickyBtn.tabIndex = show ? 0 : -1;
    const was = document.body.classList.contains('rt-sticky-on');
    document.body.classList.toggle('rt-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }

  /* ---------- choosing a file ---------- */
  function openPicker() { if (!busy) els.fileInput.click(); }
  els.pickers.forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPicker(); }));
  els.dropZone.addEventListener('click', (e) => { if (!e.target.closest('button, a')) openPicker(); });
  els.fileInput.addEventListener('change', () => {
    const f = els.fileInput.files && els.fileInput.files[0];
    els.fileInput.value = '';
    if (f) loadFile(f);
  });

  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
  let fileDragDepth = 0;
  const clearFileOver = () => { fileDragDepth = 0; tool.classList.remove('is-file-over'); els.dropZone.classList.remove('is-drag'); };
  // A PDF can be dropped anywhere on the tool, not only on the drop zone.
  tool.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); fileDragDepth++; tool.classList.add('is-file-over'); els.dropZone.classList.add('is-drag'); });
  tool.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; });
  tool.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; fileDragDepth = Math.max(0, fileDragDepth - 1); if (!fileDragDepth) clearFileOver(); });
  tool.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    clearFileOver();
    if (busy) return;
    const f = Array.from(e.dataTransfer.files || []).find(looksPdf);
    if (f) loadFile(f); else showMsg('Please drop a PDF (.pdf) file.', 'error');
  });
  // A file dropped anywhere else would make the browser open it and throw the work away.
  window.addEventListener('dragover', (e) => { if (hasFiles(e) && !tool.contains(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
  window.addEventListener('drop', (e) => { if (hasFiles(e) && !tool.contains(e.target)) e.preventDefault(); });

  document.addEventListener('paste', (e) => {
    if (busy) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const f = Array.from((e.clipboardData && e.clipboardData.files) || []).find(looksPdf);
    if (!f) return;
    e.preventDefault();
    loadFile(f);
  });

  async function loadFile(file) {
    if (busy) return;
    clearMsg();
    if (!looksPdf(file)) { showMsg('Please choose a valid PDF (.pdf) file.', 'error'); return; }
    if (file.size > MAX_SIZE) { showMsg('That file is over 100 MB. Please use a smaller PDF.', 'error'); return; }
    if (!window.PDFLib) { showMsg('The PDF engine did not load. Check your connection and reload the page.', 'error'); return; }

    setBusy(true);
    setProgress(10, 'Reading ' + file.name + '…');
    const fail = (text, link) => { setBusy(false); setProgress(null); showMsg(text, 'error', link); };

    let bytes;
    try { bytes = await file.arrayBuffer(); } catch (e) { fail('Could not read that file.'); return; }

    let info;
    try {
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      if (doc.isEncrypted) {
        fail('This PDF is password-protected. Remove the password first.', { href: 'pdf-password-remover.html', text: 'Open PDF Password Remover' });
        return;
      }
      info = doc.getPages().map((pg) => {
        const box = pg.getCropBox ? pg.getCropBox() : pg.getSize();
        return { w: Math.abs(box.width) || 1, h: Math.abs(box.height) || 1, base: norm(pg.getRotation().angle) };
      });
    } catch (e) {
      fail('This PDF could not be opened. It may be corrupted or protected.');
      return;
    }
    if (!info.length) { fail('This PDF has no pages.'); return; }

    setProgress(55, 'Preparing page previews…');
    let jsDoc = null;
    if (pdfjs) {
      try { jsDoc = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise; } catch (e) { jsDoc = null; }
    }

    // Only now replace the open file, so a failed load leaves the previous one intact.
    releasePdfjs();
    clearResult();
    docToken++;
    pdfjsDoc = jsDoc;
    sourceBytes = bytes;
    sourceName = file.name || 'document.pdf';
    pages = info.map((p, i) => ({ index: i, base: p.base, rotation: 0, visual: 0, selected: false, w: p.w, h: p.h, tile: null, renderedAt: 0, rendering: false }));
    zoomIndex = window.innerWidth < 560 ? 0 : 1;
    lastClicked = null;

    els.fileName.textContent = sourceName;
    els.fileName.title = sourceName;
    els.pageCount.textContent = plural(pages.length, 'page', 'pages');
    els.fileSize.textContent = fmt(file.size);
    els.dropZone.hidden = true;
    els.editor.hidden = false;
    buildTiles();
    refreshSelection();
    updateSummary();
    setBusy(false);
    setProgress(null);
    setPhase('edit');
    tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function releasePdfjs() {
    if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
    if (pdfjsDoc) { try { pdfjsDoc.destroy(); } catch (e) { /* already gone */ } }
    pdfjsDoc = null;
  }

  /* ---------- page tiles ----------
     Tiles are built once per file. Turning, selecting and reordering only
     update or move the existing tiles, so no page is ever drawn twice. */
  function buildTiles() {
    thumbObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver(onThumbVisible, { root: els.thumbs, rootMargin: '240px 0px' })
      : null;
    els.thumbs.textContent = '';
    els.thumbs.style.setProperty('--thumb', ZOOMS[zoomIndex] + 'px');
    const frag = document.createDocumentFragment();
    pages.forEach((pg) => { pg.tile = makeTile(pg); frag.appendChild(pg.tile); });
    els.thumbs.appendChild(frag);
    pages.forEach((pg) => { if (thumbObserver) thumbObserver.observe(pg.tile); else renderThumb(pg); });
    relabel();
    updateZoomButtons();
  }

  function makeTile(pg) {
    const tile = make('div', 'rt-tile');
    tile.setAttribute('role', 'listitem');
    tile.draggable = true;
    tile._page = pg;
    // the page's shape as viewers show it (its own /Rotate applied), known before it is drawn
    const swap = pg.base % 180 === 90;
    setShape(tile, swap ? pg.h : pg.w, swap ? pg.w : pg.h);

    const frame = make('div', 'rt-frame');
    const sheet = make('div', 'rt-sheet');
    sheet.appendChild(make('div', 'rt-skel'));
    const angle = make('span', 'rt-angle');
    const was = make('span', 'rt-was');
    const prev = iconButton('rt-move rt-move--prev', ICON.prev);
    prev.dataset.move = '-1';
    const next = iconButton('rt-move rt-move--next', ICON.next);
    next.dataset.move = '1';
    frame.append(sheet, angle, was, prev, next);

    const bar = make('div', 'rt-tile-bar');
    const label = make('label', 'rt-check');
    const cb = make('input');
    cb.type = 'checkbox';
    cb.setAttribute('data-tile-select', '');
    const num = make('span');
    label.append(cb, num);
    const btns = make('div', 'rt-tile-btns');
    const left = iconButton('rt-tile-btn', ICON.left);
    left.setAttribute('data-tile-left', '');
    left.title = 'Rotate 90° left';
    const right = iconButton('rt-tile-btn', ICON.right);
    right.setAttribute('data-tile-rotate', '');
    right.title = 'Rotate 90° right';
    btns.append(left, right);
    bar.append(label, btns);
    tile.append(frame, bar);
    tile._els = { sheet, angle, was, prev, next, cb, num, left, right };
    paintTile(pg);
    return tile;
  }

  function setShape(tile, w, h) {
    const m = Math.max(w, h) || 1;
    tile.style.setProperty('--aw', (w / m).toFixed(4));
    tile.style.setProperty('--ah', (h / m).toFixed(4));
  }

  function paintTile(pg) {
    const t = pg.tile;
    if (!t) return;
    const x = t._els;
    x.sheet.style.setProperty('--rot', pg.visual + 'deg');
    x.angle.textContent = angleLabel(pg.rotation);
    t.classList.toggle('is-selected', pg.selected);
    x.cb.checked = pg.selected;
  }

  // Position numbers, "was" badges and every label that mentions a page number.
  function relabel() {
    const last = pages.length - 1;
    pages.forEach((pg, pos) => {
      const x = pg.tile._els;
      const n = pos + 1;
      const moved = pg.index !== pos;
      x.num.textContent = String(n);
      x.was.textContent = moved ? 'was ' + (pg.index + 1) : '';
      x.cb.setAttribute('aria-label', 'Select page ' + n + (moved ? ' (originally page ' + (pg.index + 1) + ')' : ''));
      x.left.setAttribute('aria-label', 'Rotate page ' + n + ' left');
      x.right.setAttribute('aria-label', 'Rotate page ' + n + ' right');
      x.prev.setAttribute('aria-label', 'Move page ' + n + ' earlier');
      x.next.setAttribute('aria-label', 'Move page ' + n + ' later');
      x.prev.disabled = pos === 0;
      x.next.disabled = pos === last;
    });
  }

  const targetPx = () => Math.round((ZOOMS[zoomIndex] - 22) * Math.min(window.devicePixelRatio || 1, 2));

  function onThumbVisible(entries) {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      if (thumbObserver) thumbObserver.unobserve(en.target);
      if (en.target._page) renderThumb(en.target._page);
    });
  }

  async function renderThumb(pg) {
    const need = targetPx();
    if (!pg.tile || pg.rendering || pg.renderedAt >= need) return;
    const token = docToken;
    const sheet = pg.tile._els.sheet;
    if (!pdfjsDoc) {
      const fb = make('div', 'rt-fallback');
      fb.textContent = 'Page ' + (pg.index + 1);
      sheet.replaceChildren(fb);
      pg.renderedAt = Infinity;
      return;
    }
    pg.rendering = true;
    try {
      const page = await pdfjsDoc.getPage(pg.index + 1);
      if (token !== docToken) return;
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: need / Math.max(vp1.width, vp1.height) });
      const canvas = make('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (token !== docToken || !pg.tile) return;
      setShape(pg.tile, vp1.width, vp1.height);
      const old = sheet.querySelector('canvas');
      sheet.replaceChildren(canvas);
      if (old) { old.width = 0; old.height = 0; }
      pg.renderedAt = need;
      page.cleanup();
    } catch (e) {
      if (token === docToken && !sheet.querySelector('canvas')) {
        const fb = make('div', 'rt-fallback');
        fb.textContent = 'Page ' + (pg.index + 1);
        sheet.replaceChildren(fb);
        pg.renderedAt = Infinity;
      }
    } finally {
      pg.rendering = false;
      // zoomed in while this was drawing: draw it again at the new size
      if (token === docToken && pg.tile && pg.renderedAt < targetPx() && thumbObserver) thumbObserver.observe(pg.tile);
    }
  }

  function updateZoomButtons() {
    els.zoomOut.disabled = busy || zoomIndex === 0;
    els.zoomIn.disabled = busy || zoomIndex === ZOOMS.length - 1;
  }

  function setZoom(d) {
    const z = Math.max(0, Math.min(ZOOMS.length - 1, zoomIndex + d));
    if (z === zoomIndex) return;
    zoomIndex = z;
    els.thumbs.style.setProperty('--thumb', ZOOMS[zoomIndex] + 'px');
    updateZoomButtons();
    // Smaller tiles just scale down; bigger ones redraw once they are on screen.
    const need = targetPx();
    pages.forEach((pg) => {
      if (pg.renderedAt && pg.renderedAt < need && pg.tile) {
        if (thumbObserver) thumbObserver.observe(pg.tile); else renderThumb(pg);
      }
    });
  }
  els.zoomIn.addEventListener('click', () => setZoom(1));
  els.zoomOut.addEventListener('click', () => setZoom(-1));

  /* ---------- turning, selecting, reordering ---------- */
  function turn(list, delta) {
    list.forEach((pg) => {
      pg.rotation = norm(pg.rotation + delta);
      pg.visual += delta; // keeps the animation turning the way the button says
      paintTile(pg);
    });
    changed();
  }
  const targets = () => { const sel = pages.filter((p) => p.selected); return sel.length ? sel : pages; };
  els.allLeft.addEventListener('click', () => turn(targets(), -90));
  els.allRight.addEventListener('click', () => turn(targets(), 90));
  els.all180.addEventListener('click', () => turn(targets(), 180));

  function setSelected(pg, on) { pg.selected = on; paintTile(pg); }

  function isLandscape(pg) {
    const swap = norm(pg.base + pg.rotation) % 180 === 90;
    const w = swap ? pg.h : pg.w;
    const h = swap ? pg.w : pg.h;
    return w > h * 1.02;
  }
  function isPortrait(pg) {
    const swap = norm(pg.base + pg.rotation) % 180 === 90;
    const w = swap ? pg.h : pg.w;
    const h = swap ? pg.w : pg.h;
    return h > w * 1.02;
  }

  els.selectAll.addEventListener('click', () => {
    const anyUnset = pages.some((p) => !p.selected);
    pages.forEach((p) => setSelected(p, anyUnset));
    refreshSelection();
  });
  els.selectBtns.forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.select;
    const test = {
      odd: (p, pos) => pos % 2 === 0,
      even: (p, pos) => pos % 2 === 1,
      landscape: (p) => isLandscape(p),
      portrait: (p) => isPortrait(p),
    }[kind];
    if (!test) return;
    pages.forEach((p, pos) => setSelected(p, test(p, pos)));
    refreshSelection();
    const n = pages.filter((p) => p.selected).length;
    if (!n) showMsg(kind === 'even' ? 'This PDF has only one page, so there are no even pages.' : 'No ' + kind + ' pages in this PDF right now.', 'info');
    else clearMsg();
  }));

  function refreshSelection() {
    const n = pages.filter((p) => p.selected).length;
    els.selNote.textContent = n
      ? plural(n, 'page', 'pages') + ' selected — rotation applies to selected pages.'
      : 'No pages selected — rotation applies to all pages.';
    els.scope.textContent = n ? plural(n, 'selected page', 'selected pages') : (pages.length === 1 ? 'the page' : 'all ' + pages.length + ' pages');
    els.selectAll.textContent = n && n === pages.length ? 'Deselect all' : 'Select all';
  }

  function placeTile(pg, to) {
    const after = pages[to + 1];
    els.thumbs.insertBefore(pg.tile, after ? after.tile : null);
  }

  function move(pg, dir, btn) {
    const from = pages.indexOf(pg);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= pages.length) return;
    pages.splice(from, 1);
    pages.splice(to, 0, pg);
    placeTile(pg, to);
    relabel();
    changed();
    // Moving the tile drops focus; put it back so repeated presses keep moving the page.
    const x = pg.tile._els;
    const keep = btn.disabled ? (dir < 0 ? x.next : x.prev) : btn;
    keep.focus({ preventScroll: true });
    pg.tile.scrollIntoView({ block: 'nearest' });
  }

  els.thumbs.addEventListener('click', (e) => {
    if (busy) return;
    const tile = e.target.closest('.rt-tile');
    if (!tile || !tile._page) return;
    const pg = tile._page;
    const btn = e.target.closest('button');
    if (btn) {
      if (btn.hasAttribute('data-tile-left')) turn([pg], -90);
      else if (btn.hasAttribute('data-tile-rotate')) turn([pg], 90);
      else if (btn.dataset.move) move(pg, Number(btn.dataset.move), btn);
      return;
    }
    if (!e.target.closest('.rt-frame')) return;
    const pos = pages.indexOf(pg);
    if (e.shiftKey && lastClicked && pages.indexOf(lastClicked) !== -1) {
      const a = pages.indexOf(lastClicked);
      const on = !pg.selected;
      for (let i = Math.min(a, pos); i <= Math.max(a, pos); i++) setSelected(pages[i], on);
    } else {
      setSelected(pg, !pg.selected);
    }
    lastClicked = pg;
    refreshSelection();
  });
  els.thumbs.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-tile-select]');
    if (!cb) return;
    const pg = cb.closest('.rt-tile')._page;
    setSelected(pg, cb.checked);
    lastClicked = pg;
    refreshSelection();
  });

  // Drag a tile to reorder. Files dragged over the grid are left to the tool's drop handler.
  const isPageDrag = (e) => !!dragPage && !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf(PAGE_DRAG) !== -1;
  const clearDropMark = () => { if (dropMark) dropMark.tile.classList.remove('drop-before', 'drop-after'); dropMark = null; };
  els.thumbs.addEventListener('dragstart', (e) => {
    const tile = e.target.closest && e.target.closest('.rt-tile');
    if (!tile || busy) { e.preventDefault(); return; }
    dragPage = tile._page;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PAGE_DRAG, String(pages.indexOf(dragPage)));
    tile.classList.add('is-dragging');
  });
  els.thumbs.addEventListener('dragover', (e) => {
    if (!isPageDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tile = e.target.closest('.rt-tile');
    if (!tile || tile === dragPage.tile) { clearDropMark(); return; }
    const r = tile.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    if (dropMark && dropMark.tile === tile && dropMark.after === after) return;
    clearDropMark();
    tile.classList.add(after ? 'drop-after' : 'drop-before');
    dropMark = { tile, after };
  });
  els.thumbs.addEventListener('dragleave', (e) => { if (!els.thumbs.contains(e.relatedTarget)) clearDropMark(); });
  els.thumbs.addEventListener('drop', (e) => {
    if (!isPageDrag(e)) return;
    e.preventDefault();
    const mark = dropMark;
    clearDropMark();
    if (!mark || !dragPage) return;
    const moving = dragPage;
    pages.splice(pages.indexOf(moving), 1);
    const to = pages.indexOf(mark.tile._page) + (mark.after ? 1 : 0);
    pages.splice(to, 0, moving);
    placeTile(moving, to);
    relabel();
    changed();
  });
  els.thumbs.addEventListener('dragend', () => {
    if (dragPage && dragPage.tile) dragPage.tile.classList.remove('is-dragging');
    dragPage = null;
    clearDropMark();
  });

  els.reset.addEventListener('click', () => {
    pages.sort((a, b) => a.index - b.index);
    const frag = document.createDocumentFragment();
    pages.forEach((p) => { p.rotation = 0; p.visual = 0; p.selected = false; paintTile(p); frag.appendChild(p.tile); });
    els.thumbs.appendChild(frag);
    lastClicked = null;
    relabel();
    refreshSelection();
    clearMsg();
    changed();
  });

  /* ---------- what the download will contain ---------- */
  const orderChanged = () => pages.some((p, i) => p.index !== i);

  function updateSummary() {
    const turned = pages.filter((p) => p.rotation).length;
    const moved = orderChanged();
    els.summary.classList.toggle('is-idle', !turned && !moved);
    if (!turned && !moved) {
      els.summaryText.textContent = 'No changes yet — turn pages with the buttons above or on each page, or drag pages into a new order.';
      return;
    }
    const parts = [];
    if (turned) parts.push(turned === pages.length ? (pages.length === 1 ? 'The page will be rotated' : 'All ' + pages.length + ' pages will be rotated') : turned + ' of ' + pages.length + ' pages will be rotated');
    if (moved) parts.push(turned ? 'the page order has changed' : 'The page order has changed');
    els.summaryText.textContent = parts.join(', and ') + '.';
  }

  function clearResult() {
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    els.result.hidden = true;
    els.download.removeAttribute('href');
    els.download.removeAttribute('download');
  }

  // Any edit after a download makes that file out of date.
  function changed() {
    updateSummary();
    if (phase === 'result') { clearResult(); setPhase('edit'); }
  }

  /* ---------- export ----------
     The original document is edited rather than its pages copied into a new
     one, so bookmarks, links, form fields and metadata all survive. */
  function reorder(doc, originals, order) {
    const { PDFName, PDFNumber } = PDFLib;
    // Anything a page inherits from an intermediate Pages node moves onto the
    // page itself first, so hanging every page straight off the root keeps it.
    ['Resources', 'MediaBox', 'CropBox', 'Rotate'].forEach((key) => {
      const name = PDFName.of(key);
      originals.forEach((pg) => {
        if (pg.node.get(name) !== undefined) return;
        const v = pg.node.getInheritableAttribute(name);
        if (v !== undefined) pg.node.set(name, v);
      });
    });
    const rootRef = doc.catalog.get(PDFName.of('Pages'));
    const root = doc.catalog.Pages();
    root.set(PDFName.of('Kids'), doc.context.obj(order.map((i) => originals[i].ref)));
    root.set(PDFName.of('Count'), PDFNumber.of(order.length));
    order.forEach((i) => originals[i].node.set(PDFName.of('Parent'), rootRef));
  }

  async function exportPdf() {
    if (!sourceBytes || busy) return;
    clearMsg();
    setBusy(true);
    setProgress(15, 'Opening your PDF…');
    try {
      const doc = await PDFLib.PDFDocument.load(sourceBytes, { updateMetadata: false });
      const originals = doc.getPages();
      if (originals.length !== pages.length) throw new Error('page count mismatch');
      setProgress(45, 'Turning pages…');
      pages.forEach((p) => { if (p.rotation) originals[p.index].setRotation(PDFLib.degrees(norm(p.base + p.rotation))); });
      if (orderChanged()) reorder(doc, originals, pages.map((p) => p.index));
      setProgress(70, 'Saving…');
      const bytes = await doc.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      clearResult();
      resultUrl = URL.createObjectURL(blob);
      const outName = baseName(sourceName) + '-rotated.pdf';
      els.download.href = resultUrl;
      els.download.download = outName;
      els.resultSummary.textContent = outName + ' · ' + plural(pages.length, 'page', 'pages') + ' · ' + fmt(blob.size);
      els.result.hidden = false;
      setProgress(100, 'Done');
      setBusy(false);
      setPhase('result');
      els.download.click();
      setTimeout(() => { if (!busy) setProgress(null); }, 500);
    } catch (e) {
      setBusy(false);
      setProgress(null);
      showMsg('Could not rotate this PDF. Please try again.', 'error');
    }
  }
  els.processBtn.addEventListener('click', exportPdf);

  /* ---------- starting over ---------- */
  function clearFile() {
    docToken++;
    releasePdfjs();
    clearResult();
    sourceBytes = null;
    pages = [];
    lastClicked = null;
    els.thumbs.textContent = '';
    els.editor.hidden = true;
    els.dropZone.hidden = false;
    clearMsg();
    setProgress(null);
    setPhase('upload');
  }
  els.remove.addEventListener('click', () => {
    clearFile();
    const b = els.dropZone.querySelector('[data-file-picker]');
    if (b) b.focus();
  });
  els.another.addEventListener('click', () => { clearFile(); openPicker(); });

  /* ---------- phone bottom bar ---------- */
  if (els.stickyBtn) {
    els.stickyBtn.addEventListener('click', () => {
      if (phase === 'upload') { tool.scrollIntoView({ behavior: 'smooth', block: 'start' }); openPicker(); }
      else if (phase === 'edit') exportPdf();
      else if (phase === 'result' && els.download.href) els.download.click();
    });
  }
  if ('IntersectionObserver' in window) {
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.target === tool) inView.tool = en.isIntersecting;
        else if (en.target === els.processBtn) inView.process = en.isIntersecting;
        else if (en.target === els.download) inView.download = en.isIntersecting;
      });
      updateSticky();
    });
    watch.observe(tool);
    watch.observe(els.processBtn);
    watch.observe(els.download);
  }
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);
  // A page kept in the back/forward cache comes back as it was, so only a real unload frees things.
  window.addEventListener('pagehide', (e) => { if (e.persisted) return; releasePdfjs(); if (resultUrl) URL.revokeObjectURL(resultUrl); });

  setPhase('upload');
})();
