(function () {
  'use strict';
  var root = document.querySelector('[data-redact-page]');
  if (!root) return;

  /* ============================================================
     Engine loaders (lazy — nothing fetched until a file is chosen)
     ============================================================ */
  var PDFJS_VERSION = '4.2.67';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.min.mjs';
  var PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.worker.min.mjs';
  var TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

  var pdfjsLibPromise = null;
  function loadPdfJs() {
    if (!pdfjsLibPromise) {
      pdfjsLibPromise = import(PDFJS_URL).then(function (module) {
        var lib = module.default || module;
        if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return lib;
      }).catch(function (err) {
        console.error('PDF.js failed to load', err);
        throw new Error('The PDF renderer could not be loaded. Check your connection and try again.');
      });
    }
    return pdfjsLibPromise;
  }

  var tesseractPromise = null;
  function loadTesseract() {
    if (!tesseractPromise) {
      tesseractPromise = new Promise(function (resolve, reject) {
        if (window.Tesseract) { resolve(window.Tesseract); return; }
        var s = document.createElement('script');
        s.src = TESSERACT_URL;
        s.onload = function () { resolve(window.Tesseract); };
        s.onerror = function () { reject(new Error('The OCR engine could not be loaded. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
    }
    return tesseractPromise;
  }

  var pdfLibPromise = null;
  function loadPdfLib() {
    if (window.PDFLib && window.PDFLib.PDFDocument) return Promise.resolve(window.PDFLib);
    if (!pdfLibPromise) {
      pdfLibPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'assets/js/pdf-lib.min.js';
        s.onload = function () {
          if (window.PDFLib && window.PDFLib.PDFDocument) resolve(window.PDFLib);
          else reject(new Error('The PDF export library failed to initialize.'));
        };
        s.onerror = function () { reject(new Error('The PDF export library could not be loaded. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
    }
    return pdfLibPromise;
  }

  var jsZipPromise = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jsZipPromise) {
      jsZipPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'assets/js/jszip.min.js';
        s.onload = function () {
          if (window.JSZip) resolve(window.JSZip);
          else reject(new Error('The ZIP library failed to initialize.'));
        };
        s.onerror = function () { reject(new Error('The ZIP library could not be loaded. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
    }
    return jsZipPromise;
  }

  function isMobileView() { return window.matchMedia('(max-width: 768px)').matches; }

  function warmCdnConnections() {
    if (warmCdnConnections.done) return;
    warmCdnConnections.done = true;
    ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'].forEach(function (host) {
      var link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = host;
      link.crossOrigin = '';
      document.head.appendChild(link);
    });
  }

  function scheduleIdle(fn, timeout) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: timeout || 1500 });
    } else {
      setTimeout(fn, 32);
    }
  }

  /* ============================================================
     Small utilities
     ============================================================ */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function yieldToUI() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function uid() { return 'm' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function baseName(name) { return name.replace(/\.pdf$/i, ''); }
  function formatBytes(n) { if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'; return (n / (1024 * 1024)).toFixed(2) + ' MB'; }
  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function luhnValid(digits) {
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = parseInt(digits[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  /* ============================================================
     Sensitive-data presets — matching aids, not AI. Users always
     review every match before it becomes a redaction mark.
     ============================================================ */
  var MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December';
  var PRESETS = {
    email: { label: 'Email', re: function () { return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g; } },
    phone: { label: 'Phone', re: function () { return /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,5}[\s-]?\d{3,4}(?:[\s-]?\d{2,4})?\b/g; } },
    card: {
      label: 'Credit Card', re: function () { return /\b(?:\d[ -]?){13,19}\b/g; },
      filter: function (raw) { var d = raw.replace(/[^0-9]/g, ''); return d.length >= 13 && d.length <= 19 && luhnValid(d); }
    },
    aadhaar: { label: 'Aadhaar', re: function () { return /\b\d{4}\s?\d{4}\s?\d{4}\b/g; } },
    pan: { label: 'PAN', re: function () { return /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g; } },
    passport: { label: 'Passport', re: function () { return /\b[A-Z]{1,2}[0-9]{6,9}\b/g; } },
    iban: { label: 'IBAN', re: function () { return /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g; } },
    bank: { label: 'Bank Account', re: function () { return /\b\d{9,18}\b/g; } },
    date: { label: 'Date', re: function () { return new RegExp('\\b\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b(?:' + MONTHS + ')\\.?\\s+\\d{1,2},?\\s+\\d{4}\\b|\\b\\d{1,2}\\s+(?:' + MONTHS + ')\\.?,?\\s+\\d{4}\\b', 'gi'); } },
    name: { label: 'Possible Names', re: function () { return /\b[A-Z][a-z]{1,}\s[A-Z][a-z]{1,}\b/g; } }
  };

  /* ============================================================
     State
     ============================================================ */
  var state = {
    files: [],          // entry: {file,name,jsDoc,pageCount,pages:[{wPts,hPts,removed,thumbCanvas,ocrWords,ocrDone}],marks:[],history:[],future:[]}
    activeFile: 0,
    currentPage: 1,
    zoom: 1,
    mode: 'manual',
    defaultColor: '#000000',
    ocrBusy: false,
    lastMatches: []      // [{fileIndex,page,text,mark}]
  };

  function activeEntry() { return state.files[state.activeFile] || null; }
  function activePage() { var e = activeEntry(); return e ? e.pages[state.currentPage - 1] : null; }

  /* ============================================================
     DOM refs
     ============================================================ */
  var fileInput = $('[data-file-input]', root);
  var dropZone = $('[data-drop-zone]', root);
  var preUpload = $('[data-pre-upload]', root);
  var editorRoot = $('[data-editor-root]', root);
  var messageBox = $('[data-message]', root);
  var stepList = $('[data-step-list]', root);
  var queueRow = $('[data-queue-row]', root);
  var thumbsWrap = $('[data-thumbs]', root);
  var pageCountLabel = $('[data-page-count-label]', root);
  var canvasWrap = $('[data-canvas-wrap]', root);
  var canvasStack = $('[data-canvas-stack]', root);
  var loadingNote = $('[data-loading-note]', root);
  var pageCanvas = $('[data-page-canvas]', root);
  var overlayCanvas = $('[data-overlay-canvas]', root);
  var currentPageOut = $('[data-current-page]', root);
  var totalPagesOut = $('[data-total-pages]', root);
  var zoomLabel = $('[data-zoom-label]', root);
  var modeHint = $('[data-mode-hint]', root);
  var marksPanel = $('[data-marks-panel]', root);
  var markSummary = $('[data-mark-summary]', root);
  var progressWrap = $('[data-progress-wrap]', root);
  var progressFill = $('[data-progress-fill]', root);
  var progressText = $('[data-progress-text]', root);
  var resultPanel = $('[data-result-panel]', root);
  var undoBtn = $('[data-undo-btn]', root);
  var redoBtn = $('[data-redo-btn]', root);

  function showMessage(text, type) {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  }

  /* ============================================================
     Upload handling
     ============================================================ */
  function openPicker() { fileInput.click(); }
  $all('[data-file-picker]', root).forEach(function (b) { b.addEventListener('click', openPicker); });
  $('[data-add-more]', root).addEventListener('click', openPicker);
  fileInput.addEventListener('change', function () { handleFiles(fileInput.files); fileInput.value = ''; });

  dropZone.addEventListener('click', function (e) {
    if (e.target.closest('[data-file-picker]')) return;
    openPicker();
  });
  dropZone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('is-drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.remove('is-drag'); });
  });
  dropZone.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });
  dropZone.addEventListener('mouseenter', warmCdnConnections, { once: true, passive: true });
  dropZone.addEventListener('focus', warmCdnConnections, { once: true });
  dropZone.addEventListener('touchstart', warmCdnConnections, { once: true, passive: true });

  function createPageSlot(wPts, hPts, dimsLoaded) {
    return {
      wPts: wPts, hPts: hPts, dimsLoaded: !!dimsLoaded,
      removed: false, thumbCanvas: null, ocrWords: null, ocrDone: false, textItems: null
    };
  }

  async function buildPagesArray(jsDoc) {
    var pageCount = jsDoc.numPages;
    var pages = new Array(pageCount);
    var page1 = await jsDoc.getPage(1);
    var vp1 = page1.getViewport({ scale: 1 });
    var defaultW = vp1.width;
    var defaultH = vp1.height;
    for (var i = 0; i < pageCount; i++) {
      pages[i] = createPageSlot(defaultW, defaultH, i === 0);
    }
    return pages;
  }

  async function ensurePageDims(entry, pageNum) {
    var pinfo = entry.pages[pageNum - 1];
    if (pinfo.dimsLoaded) return pinfo;
    var page = await entry.jsDoc.getPage(pageNum);
    var vp1 = page.getViewport({ scale: 1 });
    pinfo.wPts = vp1.width;
    pinfo.hPts = vp1.height;
    pinfo.dimsLoaded = true;
    return pinfo;
  }

  async function ensureTextItems(entry, pageNum) {
    var pinfo = entry.pages[pageNum - 1];
    if (pinfo.textItems) return pinfo.textItems;
    await ensurePageDims(entry, pageNum);
    var page = await entry.jsDoc.getPage(pageNum);
    var content = await page.getTextContent();
    var vp1 = page.getViewport({ scale: 1 });
    pinfo.textItems = content.items.map(function (item) { return buildItemBox(item, vp1, pinfo); }).filter(Boolean);
    return pinfo.textItems;
  }

  async function handleFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) { return /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name); });
    if (!files.length) { showMessage('Please choose a valid PDF file.', 'error'); return; }
    showMessage('Loading ' + (files.length > 1 ? files.length + ' PDFs' : files.length + ' PDF') + '…', 'success');
    warmCdnConnections();
    var pdfjsLib;
    try { pdfjsLib = await loadPdfJs(); window.__rdPdfjsLib = pdfjsLib; } catch (err) { showMessage(err.message, 'error'); return; }

    var hadError = false;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var bytes = new Uint8Array(await file.arrayBuffer());
        var jsDoc = await pdfjsLib.getDocument({
          data: bytes,
          disableFontFace: true,
          useSystemFonts: true
        }).promise;
        var pages = await buildPagesArray(jsDoc);
        state.files.push({
          file: file, name: file.name, bytes: bytes, jsDoc: jsDoc, pageCount: jsDoc.numPages,
          pages: pages, marks: [], history: [], future: []
        });
      } catch (err) {
        console.error(err);
        var msg = /password/i.test(String(err && err.name)) || /password/i.test(String(err && err.message))
          ? file.name + ' is password-protected. Remove the password first with Unlock PDF, then redact it.'
          : file.name + ' could not be read — it may not be a valid PDF.';
        showMessage(msg, 'error');
        hadError = true;
      }
      await yieldToUI();
    }

    if (!state.files.length) return;
    // The message box sits above the editor, so a stale "Loading…" would stay on screen.
    if (!hadError) messageBox.classList.add('hidden');
    preUpload.classList.add('hidden');
    editorRoot.classList.remove('hidden');
    root.setAttribute('data-editing', 'true');
    document.body.classList.add('rd-editing');
    // From 980px the tool sits beside the cover until a PDF is open; then it takes the full width.
    var topGrid = root.closest('.rd-top');
    if (topGrid) topGrid.classList.add('is-editing');
    updateSticky();
    state.activeFile = state.files.length - 1;
    state.currentPage = 1;
    setStep(2);
    renderQueue();
    await openActiveFile();
    if (isMobileView()) {
      generateThumbnails(state.activeFile, { onlyCurrent: true });
      scheduleSidebarThumbs(state.activeFile);
    } else {
      generateThumbnails(state.activeFile);
    }
    scheduleIdle(function () { loadPdfLib().catch(function () { /* preload on idle */ }); }, 2500);
    requestAnimationFrame(function () {
      editorRoot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /* ============================================================
     Steps indicator
     ============================================================ */
  function setStep(n) {
    $all('li', stepList).forEach(function (li) {
      var s = parseInt(li.getAttribute('data-step'), 10);
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
    });
  }

  /* ============================================================
     Batch queue UI
     ============================================================ */
  function renderQueue() {
    if (state.files.length < 2) { queueRow.classList.add('hidden'); queueRow.innerHTML = ''; return; }
    queueRow.classList.remove('hidden');
    queueRow.innerHTML = '';
    state.files.forEach(function (entry, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rd-queue-chip' + (idx === state.activeFile ? ' is-active' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', idx === state.activeFile ? 'true' : 'false');
      b.innerHTML = '📄 ' + escapeHtml(entry.name) + ' <span class="cnt">(' + entry.marks.length + ')</span>';
      b.addEventListener('click', async function () {
        state.activeFile = idx; state.currentPage = 1;
        thumbGenToken++;
        renderQueue();
        await openActiveFile();
        generateThumbnails(idx);
      });
      queueRow.appendChild(b);
    });
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /* ============================================================
     File summary bar
     ============================================================ */
  function renderFileSummary() {
    var entry = activeEntry();
    var el = $('[data-file-summary]', root);
    if (!entry) { el.textContent = ''; return; }
    el.innerHTML = '<strong>' + escapeHtml(entry.name) + '</strong>' + entry.pageCount + ' page' + (entry.pageCount === 1 ? '' : 's') + ' · ' + formatBytes(entry.file.size) + (state.files.length > 1 ? ' · file ' + (state.activeFile + 1) + ' of ' + state.files.length : '');
  }

  /* ============================================================
     Thumbnails
     ============================================================ */
  var thumbGenToken = 0;

  async function generateThumbnails(fileIdx, opts) {
    opts = opts || {};
    var onlyCurrent = !!opts.onlyCurrent;
    var token = ++thumbGenToken;
    var entry = state.files[fileIdx];
    if (fileIdx !== state.activeFile) return;
    var mobile = isMobileView();
    var maxW = mobile ? 112 : 160;
    var maxH = mobile ? 160 : 220;
    var maxScale = mobile ? 0.42 : 0.6;
    var pageOrder = [];
    if (onlyCurrent) {
      pageOrder.push(state.currentPage);
    } else {
      for (var n = 1; n <= entry.pageCount; n++) pageOrder.push(n);
      pageOrder.sort(function (a, b) {
        return Math.abs(a - state.currentPage) - Math.abs(b - state.currentPage);
      });
    }
    for (var oi = 0; oi < pageOrder.length; oi++) {
      if (token !== thumbGenToken || fileIdx !== state.activeFile) return;
      while (document.hidden) { await new Promise(function (r) { setTimeout(r, 400); }); }
      var p = pageOrder[oi];
      var pinfo = entry.pages[p - 1];
      if (!pinfo.thumbCanvas) {
        try {
          await ensurePageDims(entry, p);
          var page = await entry.jsDoc.getPage(p);
          var scale = Math.min(maxW / pinfo.wPts, maxH / pinfo.hPts, maxScale);
          var vp = page.getViewport({ scale: Math.max(scale, 0.1) });
          var c = document.createElement('canvas');
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
          pinfo.thumbCanvas = c;
          updateThumbCanvas(p);
        } catch (err) { console.error('thumbnail render failed', err); }
      }
      if (oi > 0 && p !== state.currentPage && Math.abs(p - state.currentPage) > 2) {
        await new Promise(function (resolve) { scheduleIdle(resolve, 1200); });
      } else {
        await yieldToUI();
      }
    }
    renderThumbs(onlyCurrent ? false : true);
  }

  var sidebarThumbObserver = null;
  function scheduleSidebarThumbs(fileIdx) {
    var sidebar = root.querySelector('.rd-sidebar');
    if (!sidebar || typeof IntersectionObserver === 'undefined') {
      generateThumbnails(fileIdx);
      return;
    }
    if (sidebarThumbObserver) sidebarThumbObserver.disconnect();
    sidebarThumbObserver = new IntersectionObserver(function (entries, obs) {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      sidebarThumbObserver = null;
      generateThumbnails(fileIdx);
    }, { rootMargin: '100px 0px' });
    sidebarThumbObserver.observe(sidebar);
  }

  function updateThumbCanvas(pageNum) {
    var wrap = thumbsWrap.querySelector('[data-thumb-page="' + pageNum + '"]');
    if (!wrap) return;
    var entry = activeEntry();
    if (!entry) return;
    var pinfo = entry.pages[pageNum - 1];
    if (!pinfo || !pinfo.thumbCanvas) return;
    var inner = wrap.querySelector('[data-thumb-preview]');
    if (!inner) return;
    inner.innerHTML = '';
    var img = document.createElement('canvas');
    img.width = pinfo.thumbCanvas.width;
    img.height = pinfo.thumbCanvas.height;
    img.getContext('2d').drawImage(pinfo.thumbCanvas, 0, 0);
    inner.appendChild(img);
  }

  function syncThumbStates() {
    var entry = activeEntry();
    if (!entry) return;
    $all('[data-thumb-page]', thumbsWrap).forEach(function (wrap) {
      var pageNum = parseInt(wrap.getAttribute('data-thumb-page'), 10);
      var pinfo = entry.pages[pageNum - 1];
      var hasMarks = entry.marks.some(function (m) { return m.page === pageNum; });
      wrap.className = 'rd-thumb' + (pageNum === state.currentPage ? ' is-active' : '') + (pinfo.removed ? ' is-removed' : '') + (hasMarks ? ' has-marks' : '');
      var removeBtn = wrap.querySelector('[data-thumb-remove]');
      if (removeBtn) {
        removeBtn.textContent = pinfo.removed ? 'Restore' : 'Remove';
        removeBtn.setAttribute('aria-pressed', pinfo.removed ? 'true' : 'false');
      }
      var num = wrap.querySelector('.num');
      if (num) num.textContent = pageNum + (pinfo.removed ? ' ✕' : '');
    });
  }

  function renderThumbs(forceRebuild) {
    var entry = activeEntry();
    if (!entry) return;
    pageCountLabel.textContent = '(' + entry.pageCount + ')';
    if (!forceRebuild && thumbsWrap.children.length === entry.pageCount) {
      syncThumbStates();
      return;
    }
    thumbsWrap.innerHTML = '';
    entry.pages.forEach(function (pinfo, idx) {
      var pageNum = idx + 1;
      var hasMarks = entry.marks.some(function (m) { return m.page === pageNum; });
      var wrap = document.createElement('div');
      wrap.className = 'rd-thumb' + (pageNum === state.currentPage ? ' is-active' : '') + (pinfo.removed ? ' is-removed' : '') + (hasMarks ? ' has-marks' : '');
      wrap.setAttribute('data-thumb-page', pageNum);
      wrap.setAttribute('role', 'option');
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('aria-label', 'Page ' + pageNum + (pinfo.removed ? ' (removed from output)' : hasMarks ? ' (has redactions)' : ''));
      var inner = document.createElement('div');
      inner.setAttribute('data-thumb-preview', '');
      if (pinfo.thumbCanvas) {
        var img = document.createElement('canvas');
        img.width = pinfo.thumbCanvas.width; img.height = pinfo.thumbCanvas.height;
        img.getContext('2d').drawImage(pinfo.thumbCanvas, 0, 0);
        inner.appendChild(img);
      } else {
        inner.textContent = '…';
      }
      wrap.appendChild(inner);
      var num = document.createElement('span'); num.className = 'num'; num.textContent = pageNum + (pinfo.removed ? ' ✕' : ''); wrap.appendChild(num);
      var flag = document.createElement('span'); flag.className = 'flag'; flag.textContent = '⬛'; wrap.appendChild(flag);

      var actions = document.createElement('div'); actions.className = 'rd-thumb-actions';
      var blackoutBtn = document.createElement('button'); blackoutBtn.type = 'button'; blackoutBtn.textContent = 'Blackout';
      blackoutBtn.addEventListener('click', function (e) { e.stopPropagation(); blackoutPage(pageNum); });
      var removeBtn = document.createElement('button'); removeBtn.type = 'button'; removeBtn.setAttribute('data-thumb-remove', '');
      removeBtn.textContent = pinfo.removed ? 'Restore' : 'Remove';
      removeBtn.setAttribute('aria-pressed', pinfo.removed ? 'true' : 'false');
      removeBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePageRemoved(pageNum); });
      actions.appendChild(blackoutBtn); actions.appendChild(removeBtn);
      wrap.appendChild(actions);

      function go() { state.currentPage = pageNum; syncThumbStates(); renderPage(); renderMarksPanel(); }
      wrap.addEventListener('click', go);
      wrap.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      thumbsWrap.appendChild(wrap);
    });
  }

  /* ============================================================
     History (undo/redo) — scoped per active file
     ============================================================ */
  function snapshotMarks() { return JSON.parse(JSON.stringify(activeEntry().marks)); }
  function pushHistory() {
    var entry = activeEntry(); if (!entry) return;
    entry.history.push(snapshotMarks());
    if (entry.history.length > 60) entry.history.shift();
    entry.future = [];
    updateUndoRedoButtons();
  }
  function undo() {
    var entry = activeEntry(); if (!entry || !entry.history.length) return;
    entry.future.push(snapshotMarks());
    entry.marks = entry.history.pop();
    afterMarksChanged();
  }
  function redo() {
    var entry = activeEntry(); if (!entry || !entry.future.length) return;
    entry.history.push(snapshotMarks());
    entry.marks = entry.future.pop();
    afterMarksChanged();
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });

  function afterMarksChanged() {
    updateUndoRedoButtons();
    syncThumbStates();
    renderOverlay();
    renderMarksPanel();
    renderMarkSummary();
    renderQueue();
  }

  function addMark(mark) {
    pushHistory();
    mark.id = uid();
    mark.color = mark.color || state.defaultColor;
    activeEntry().marks.push(mark);
    afterMarksChanged();
  }
  function removeMark(id) {
    pushHistory();
    var entry = activeEntry();
    entry.marks = entry.marks.filter(function (m) { return m.id !== id; });
    afterMarksChanged();
  }

  function blackoutPage(pageNum) {
    addMark({ page: pageNum, xf: 0, yf: 0, wf: 1, hf: 1, color: state.defaultColor, source: 'page', label: 'Whole page blackout' });
  }
  function togglePageRemoved(pageNum) {
    var entry = activeEntry();
    var pinfo = entry.pages[pageNum - 1];
    pinfo.removed = !pinfo.removed;
    syncThumbStates();
    renderMarkSummary(); renderQueue();
  }

  $('[data-blackout-current]', root).addEventListener('click', function () { blackoutPage(state.currentPage); });
  $('[data-remove-current]', root).addEventListener('click', function () { togglePageRemoved(state.currentPage); });

  /* ============================================================
     Marks side panel (current page only)
     ============================================================ */
  var COLOR_NAMES = { '#000000': 'Black', '#ffffff': 'White' };
  function renderMarksPanel() {
    var entry = activeEntry();
    marksPanel.innerHTML = '';
    if (!entry) return;
    var pageMarks = entry.marks.filter(function (m) { return m.page === state.currentPage; });
    if (!pageMarks.length) { marksPanel.innerHTML = '<p class="rd-marks-empty">No redaction marks on this page yet.</p>'; return; }
    pageMarks.forEach(function (m) {
      var row = document.createElement('div'); row.className = 'rd-mark-row';
      var dot = document.createElement('span'); dot.className = 'rd-mark-dot'; dot.style.background = m.color;
      var label = document.createElement('span'); label.className = 'rd-mark-label';
      label.textContent = (m.label || sourceLabel(m.source)) + (COLOR_NAMES[m.color] ? ' · ' + COLOR_NAMES[m.color] : '');
      var del = document.createElement('button'); del.type = 'button'; del.className = 'rd-mark-del'; del.setAttribute('aria-label', 'Delete this redaction mark'); del.textContent = '✕';
      del.addEventListener('click', function () { removeMark(m.id); });
      row.appendChild(dot); row.appendChild(label); row.appendChild(del);
      marksPanel.appendChild(row);
    });
  }
  function sourceLabel(src) {
    return src === 'manual' ? 'Manual box' : src === 'text' ? 'Text match' : src === 'ocr' ? 'OCR match' : src === 'page' ? 'Whole page' : 'Redaction';
  }

  function renderMarkSummary() {
    var totalMarks = 0, pagesTouched = {}, pagesRemoved = 0;
    state.files.forEach(function (entry) {
      entry.marks.forEach(function (m) { totalMarks++; pagesTouched[entry === activeEntry() ? m.page : ('f' + state.files.indexOf(entry) + '-' + m.page)] = true; });
      entry.pages.forEach(function (p) { if (p.removed) pagesRemoved++; });
    });
    var pageCount = Object.keys(pagesTouched).length;
    markSummary.textContent = totalMarks + ' redaction mark' + (totalMarks === 1 ? '' : 's') + ' across ' + pageCount + ' page' + (pageCount === 1 ? '' : 's') + ' queued' + (pagesRemoved ? ', ' + pagesRemoved + ' page' + (pagesRemoved === 1 ? '' : 's') + ' set to remove' : '') + '.';
  }

  /* ============================================================
     Page render + overlay (draw / view text blocks / OCR words)
     ============================================================ */
  var DPR = 1;
  var dragDrawPending = false;
  var renderToken = 0;
  var activeRenderTask = null;
  var suppressCanvasRo = false;
  var lastWrapWidth = 0;
  var pageCtx = null;
  var overlayCtx = null;

  async function openActiveFile() {
    var entry = activeEntry();
    if (!entry) return;
    renderFileSummary();
    totalPagesOut.textContent = entry.pageCount;
    renderThumbs(true);
    renderMarksPanel();
    renderMarkSummary();
    updateUndoRedoButtons();
    await renderPage();
  }

  function getCanvasMaxWidth() {
    if (canvasWrap) {
      var w = canvasWrap.clientWidth;
      if (w > 24) return Math.floor(w);
      var r = canvasWrap.getBoundingClientRect();
      if (r.width > 24) return Math.floor(r.width);
    }
    var stage = canvasWrap && canvasWrap.closest('.rd-stage-col');
    if (stage) {
      var sw = stage.clientWidth;
      if (sw > 24) return Math.floor(sw - 16);
    }
    if (root) {
      var rw = root.clientWidth;
      if (rw > 24) return Math.floor(rw - 24);
    }
    return Math.max(240, Math.floor(window.innerWidth - 32));
  }

  /* Bitmap stays fit-to-width; zoom only scales CSS — no huge re-raster, no crash. */
  function getPageDisplayMetrics(entry, pageNum) {
    var pinfo = entry.pages[pageNum - 1];
    var zoom = clamp(state.zoom, 0.5, 2.5);
    var maxW = getCanvasMaxWidth();
    var fitScale = pinfo.wPts > 0 ? Math.min(1, maxW / pinfo.wPts) : 1;
    if (pinfo.wPts * fitScale > maxW) fitScale = maxW / pinfo.wPts;
    var baseCssW = Math.max(1, Math.round(pinfo.wPts * fitScale));
    var baseCssH = Math.max(1, Math.round(pinfo.hPts * fitScale));
    var maxBitmap = isMobileView() ? 1400 : 2200;
    var renderScale = fitScale * DPR;
    if (pinfo.wPts * renderScale > maxBitmap) renderScale = maxBitmap / pinfo.wPts;
    if (pinfo.hPts * renderScale > maxBitmap) renderScale = Math.min(renderScale, maxBitmap / pinfo.hPts);
    return {
      cssW: Math.max(1, Math.round(baseCssW * zoom)),
      cssH: Math.max(1, Math.round(baseCssH * zoom)),
      renderScale: renderScale,
      zoomed: zoom > 1.001
    };
  }

  function applyCanvasDisplaySize(cssW, cssH, zoomed) {
    suppressCanvasRo = true;
    pageCanvas.style.width = cssW + 'px';
    pageCanvas.style.height = cssH + 'px';
    overlayCanvas.style.width = cssW + 'px';
    overlayCanvas.style.height = cssH + 'px';
    if (canvasWrap) canvasWrap.classList.toggle('is-zoomed', !!zoomed);
    requestAnimationFrame(function () { suppressCanvasRo = false; });
    return { w: cssW, h: cssH };
  }

  function applyZoomDisplay() {
    var entry = activeEntry();
    if (!entry || !pageCanvas.width) {
      zoomLabel.textContent = Math.round(clamp(state.zoom, 0.5, 2.5) * 100) + '%';
      return;
    }
    var pinfo = activePage();
    if (!pinfo || !pinfo.dimsLoaded) {
      zoomLabel.textContent = Math.round(clamp(state.zoom, 0.5, 2.5) * 100) + '%';
      return;
    }
    var metrics = getPageDisplayMetrics(entry, state.currentPage);
    applyCanvasDisplaySize(metrics.cssW, metrics.cssH, metrics.zoomed);
    zoomLabel.textContent = Math.round(clamp(state.zoom, 0.5, 2.5) * 100) + '%';
  }

  function cancelActiveRender() {
    if (!activeRenderTask) return;
    try { activeRenderTask.cancel(); } catch (err) { /* ignore */ }
    activeRenderTask = null;
  }

  async function renderPage() {
    var token = ++renderToken;
    cancelActiveRender();
    var entry = activeEntry();
    if (!entry) return;
    var pinfo = activePage();
    currentPageOut.textContent = state.currentPage;
    totalPagesOut.textContent = entry.pageCount;
    loadingNote.classList.remove('hidden');
    await yieldToUI();
    if (token !== renderToken) return;
    var metrics = null;
    try {
      await ensurePageDims(entry, state.currentPage);
      if (token !== renderToken) return;
      metrics = getPageDisplayMetrics(entry, state.currentPage);
      var page = await entry.jsDoc.getPage(state.currentPage);
      if (token !== renderToken) return;
      var vp = page.getViewport({ scale: metrics.renderScale });
      var bw = Math.max(1, Math.round(vp.width));
      var bh = Math.max(1, Math.round(vp.height));
      if (bw * bh > 6e6) {
        var shrink = Math.sqrt(6e6 / (bw * bh));
        vp = page.getViewport({ scale: metrics.renderScale * shrink });
        bw = Math.max(1, Math.round(vp.width));
        bh = Math.max(1, Math.round(vp.height));
      }
      pageCanvas.width = bw;
      pageCanvas.height = bh;
      overlayCanvas.width = bw;
      overlayCanvas.height = bh;
      pageCtx = pageCanvas.getContext('2d', { alpha: false });
      overlayCtx = overlayCanvas.getContext('2d');
      activeRenderTask = page.render({ canvasContext: pageCtx, viewport: vp });
      await activeRenderTask.promise;
      activeRenderTask = null;
      if (token !== renderToken) return;

      var needText = state.mode === 'text' || $('[data-show-text-blocks]', root).checked;
      if (needText && !pinfo.textItems) {
        await ensureTextItems(entry, state.currentPage);
      }
    } catch (err) {
      activeRenderTask = null;
      if (err && (err.name === 'RenderingCancelledException' || /cancel/i.test(String(err.message || err)))) return;
      console.error(err);
      showMessage('Could not render this page.', 'error');
    }
    if (token !== renderToken) return;
    loadingNote.classList.add('hidden');
    canvasStack.classList.remove('hidden');
    if (!metrics) return;
    lastWrapWidth = getCanvasMaxWidth();
    applyCanvasDisplaySize(metrics.cssW, metrics.cssH, metrics.zoomed);
    zoomLabel.textContent = Math.round(clamp(state.zoom, 0.5, 2.5) * 100) + '%';
    renderOverlay();
  }

  function buildItemBox(item, viewport1, pinfo) {
    if (!item.str || !item.str.trim()) return null;
    var pdfjsLib = window.__rdPdfjsLib;
    var tx = pdfjsLib ? pdfjsLib.Util.transform(viewport1.transform, item.transform) : null;
    if (!tx) return null;
    // item.width/item.height are already expressed in the page's default user-space units
    // (the same units as viewport1, which is always built at scale:1) — they must only be
    // scaled by the viewport's own scale (1 here), NOT by tx[0]/tx[1], which also bake in the
    // glyph transform's font-size scale. Multiplying by that combined scale double-counts the
    // font size and produced wildly wrong (usually oversized, mispositioned) redaction boxes.
    var viewportScale = Math.hypot(viewport1.transform[0], viewport1.transform[1]) || 1;
    var fontH = Math.hypot(tx[2], tx[3]) || 1;
    var w = Math.max((item.width || 0) * viewportScale, 1);
    var h = fontH * 1.25;
    var x = tx[4];
    var y = tx[5] - fontH * 1.05;
    return { str: item.str, x: x, y: y, w: w, h: h, pageW: pinfo.wPts, pageH: pinfo.hPts };
  }

  function fracFromBox(box, startFrac, endFrac) {
    var s = startFrac == null ? 0 : startFrac, e = endFrac == null ? 1 : endFrac;
    var padPts = box.w * 0.02 + 1.2;
    var mx = box.x + box.w * s - padPts;
    var mw = box.w * (e - s) + padPts * 2;
    var xf = clamp(mx / box.pageW, 0, 1);
    var wf = clamp(mw / box.pageW, 0.001, 1 - xf);
    var yf = clamp(box.y / box.pageH, 0, 1);
    var hf = clamp(box.h / box.pageH, 0.001, 1 - yf);
    return { xf: xf, yf: yf, wf: wf, hf: hf };
  }

  function renderOverlay() {
    var entry = activeEntry(); if (!entry) return;
    var pinfo = activePage(); if (!pinfo) return;
    if (!overlayCtx) overlayCtx = overlayCanvas.getContext('2d');
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    var W = overlayCanvas.width, H = overlayCanvas.height;

    // existing redaction marks (opaque preview, as they will render on export)
    entry.marks.filter(function (m) { return m.page === state.currentPage; }).forEach(function (m) {
      overlayCtx.globalAlpha = 0.92;
      overlayCtx.fillStyle = m.color;
      overlayCtx.fillRect(m.xf * W, m.yf * H, m.wf * W, m.hf * H);
      overlayCtx.globalAlpha = 1;
    });

    // optional: show all text blocks (click-to-redact)
    if ($('[data-show-text-blocks]', root).checked && pinfo.textItems) {
      overlayCtx.strokeStyle = 'rgba(225,29,72,.55)'; overlayCtx.fillStyle = 'rgba(13,148,136,.10)'; overlayCtx.lineWidth = 1;
      pinfo.textItems.forEach(function (box) {
        var f = fracFromBox(box);
        overlayCtx.fillRect(f.xf * W, f.yf * H, f.wf * W, f.hf * H);
        overlayCtx.strokeRect(f.xf * W, f.yf * H, f.wf * W, f.hf * H);
      });
    }

    // optional: show OCR words
    if ($('[data-show-ocr-words]', root).checked && pinfo.ocrWords) {
      overlayCtx.strokeStyle = 'rgba(13,148,136,.65)'; overlayCtx.fillStyle = 'rgba(13,148,136,.10)'; overlayCtx.lineWidth = 1;
      pinfo.ocrWords.forEach(function (w) {
        overlayCtx.fillRect(w.xf * W, w.yf * H, w.wf * W, w.hf * H);
        overlayCtx.strokeRect(w.xf * W, w.yf * H, w.wf * W, w.hf * H);
      });
    }
  }

  /* ============================================================
     Pointer interaction on overlay canvas — draw / click-select
     ============================================================ */
  var drag = null;
  overlayCanvas.addEventListener('pointerdown', function (e) {
    if (state.mode === 'page') return;
    var rect = overlayCanvas.getBoundingClientRect();
    var fx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    var fy = clamp((e.clientY - rect.top) / rect.height, 0, 1);

    if (state.mode === 'text' || state.mode === 'ocr') {
      var hit = hitTestClickable(fx, fy);
      if (hit) { addClickableMark(hit); return; }
    }
    if (state.mode !== 'manual') return;
    drag = { x0: fx, y0: fy, x1: fx, y1: fy, pointerId: e.pointerId };
    overlayCanvas.setPointerCapture(e.pointerId);
  });
  overlayCanvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var rect = overlayCanvas.getBoundingClientRect();
    drag.x1 = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    drag.y1 = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    if (dragDrawPending) return;
    dragDrawPending = true;
    requestAnimationFrame(function () {
      dragDrawPending = false;
      if (!drag) return;
      renderOverlay();
      if (!overlayCtx) return;
      var W = overlayCanvas.width, H = overlayCanvas.height;
      var x = Math.min(drag.x0, drag.x1) * W, y = Math.min(drag.y0, drag.y1) * H;
      var w = Math.abs(drag.x1 - drag.x0) * W, h = Math.abs(drag.y1 - drag.y0) * H;
      overlayCtx.fillStyle = hexToRgba(state.defaultColor, 0.55);
      overlayCtx.fillRect(x, y, w, h);
      overlayCtx.strokeStyle = '#e11d48'; overlayCtx.lineWidth = 2; overlayCtx.strokeRect(x, y, w, h);
    });
  });
  function endDrag(e) {
    if (!drag) return;
    var x0 = Math.min(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1);
    var w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    drag = null;
    if (w > 0.006 && h > 0.006) {
      addMark({ page: state.currentPage, xf: x0, yf: y0, wf: w, hf: h, color: state.defaultColor, source: 'manual', label: 'Manual box' });
    } else {
      renderOverlay();
    }
  }
  overlayCanvas.addEventListener('pointerup', endDrag);
  overlayCanvas.addEventListener('pointercancel', endDrag);

  function hexToRgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function hitTestClickable(fx, fy) {
    var pinfo = activePage(); if (!pinfo) return null;
    if (state.mode === 'ocr' && pinfo.ocrWords) {
      for (var i = 0; i < pinfo.ocrWords.length; i++) {
        var w = pinfo.ocrWords[i];
        if (fx >= w.xf && fx <= w.xf + w.wf && fy >= w.yf && fy <= w.yf + w.hf) return { type: 'ocr', box: w };
      }
    }
    if (pinfo.textItems) {
      for (var j = 0; j < pinfo.textItems.length; j++) {
        var box = pinfo.textItems[j];
        var f = fracFromBox(box);
        if (fx >= f.xf && fx <= f.xf + f.wf && fy >= f.yf && fy <= f.yf + f.hf) return { type: 'text', box: box, frac: f };
      }
    }
    return null;
  }
  function addClickableMark(hit) {
    if (hit.type === 'text') {
      addMark({ page: state.currentPage, xf: hit.frac.xf, yf: hit.frac.yf, wf: hit.frac.wf, hf: hit.frac.hf, color: state.defaultColor, source: 'text', label: 'Clicked: "' + hit.box.str.slice(0, 28) + '"' });
    } else {
      addMark({ page: state.currentPage, xf: hit.box.xf, yf: hit.box.yf, wf: hit.box.wf, hf: hit.box.hf, color: state.defaultColor, source: 'ocr', label: 'OCR word: "' + hit.box.text.slice(0, 28) + '"' });
    }
  }

  $('[data-show-text-blocks]', root).addEventListener('change', async function () {
    if (this.checked) {
      var entry = activeEntry();
      if (entry) await ensureTextItems(entry, state.currentPage);
    }
    renderOverlay();
  });
  $('[data-show-ocr-words]', root).addEventListener('change', renderOverlay);

  /* ============================================================
     Manual precise-coordinate form (accessibility)
     ============================================================ */
  $('[data-manual-form]', root).addEventListener('submit', function (e) {
    e.preventDefault();
    var entry = activeEntry(); if (!entry) return;
    var page = clamp(parseInt($('#rdMPage', root).value, 10) || 1, 1, entry.pageCount);
    var x = clamp(parseFloat($('#rdMX', root).value) || 0, 0, 100) / 100;
    var y = clamp(parseFloat($('#rdMY', root).value) || 0, 0, 100) / 100;
    var w = clamp(parseFloat($('#rdMW', root).value) || 1, 0.5, 100) / 100;
    var h = clamp(parseFloat($('#rdMH', root).value) || 1, 0.5, 100) / 100;
    w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
    addMark({ page: page, xf: x, yf: y, wf: w, hf: h, color: state.defaultColor, source: 'manual', label: 'Manual box (precise)' });
    if (page !== state.currentPage) { state.currentPage = page; syncThumbStates(); renderPage(); }
  });

  /* ============================================================
     Mode + color switching
     ============================================================ */
  var MODE_HINTS = {
    manual: 'Drag on the page to draw a redaction box. Nothing is removed until you click Apply & Download.',
    text: 'Scan for sensitive text below, or enable "Show all text blocks" and click any highlighted text to redact it.',
    ocr: 'Run OCR on this page first, then click recognized words, or search using the presets in Text Search mode.',
    page: 'Blackout or remove the currently viewed page, or use the buttons under each thumbnail.'
  };
  $all('[data-rd-mode]', root).forEach(function (btn) {
    btn.addEventListener('click', async function () {
      state.mode = btn.getAttribute('data-rd-mode');
      $all('[data-rd-mode]', root).forEach(function (b) { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      $all('[data-rd-panel]', root).forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-rd-panel') === state.mode); });
      modeHint.textContent = MODE_HINTS[state.mode] || '';
      canvasStack.classList.toggle('mode-view', state.mode === 'text' || state.mode === 'ocr');
      if (state.mode === 'text') {
        var entry = activeEntry();
        if (entry) await ensureTextItems(entry, state.currentPage);
        renderOverlay();
      }
    });
  });

  $all('[data-rd-color]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.defaultColor = btn.getAttribute('data-rd-color');
      $all('[data-rd-color]', root).forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    });
  });
  $('[data-rd-color-custom]', root).addEventListener('input', function () {
    state.defaultColor = this.value;
    $all('[data-rd-color]', root).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
  });

  /* ============================================================
     Toolbar: nav / zoom
     ============================================================ */
  $('[data-prev-page]', root).addEventListener('click', function () { if (state.currentPage > 1) { state.currentPage--; syncThumbStates(); renderPage(); renderMarksPanel(); } });
  $('[data-next-page]', root).addEventListener('click', function () { var e = activeEntry(); if (e && state.currentPage < e.pageCount) { state.currentPage++; syncThumbStates(); renderPage(); renderMarksPanel(); } });
  $('[data-zoom-in]', root).addEventListener('click', function () { state.zoom = clamp(state.zoom + 0.25, 0.5, 2.5); applyZoomDisplay(); });
  $('[data-zoom-out]', root).addEventListener('click', function () { state.zoom = clamp(state.zoom - 0.25, 0.5, 2.5); applyZoomDisplay(); });

  /* ============================================================
     Search & Redact
     ============================================================ */
  var activePresets = {};
  $all('[data-preset]', root).forEach(function (chip) {
    chip.addEventListener('click', function () {
      var key = chip.getAttribute('data-preset');
      var on = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', on ? 'false' : 'true');
      if (on) delete activePresets[key]; else activePresets[key] = true;
    });
  });

  function buildActiveRegexList() {
    var list = [];
    Object.keys(activePresets).forEach(function (key) {
      var preset = PRESETS[key];
      list.push({ source: 'preset:' + key, label: preset.label, re: preset.re(), filter: preset.filter });
    });
    var kw = $('#rdKeywords', root).value.trim();
    if (kw) {
      if ($('[data-regex-toggle]', root).checked) {
        try { list.push({ source: 'custom', label: 'Custom pattern', re: new RegExp(kw, 'gi') }); }
        catch (err) { showMessage('Invalid regular expression: ' + err.message, 'error'); }
      } else {
        var terms = kw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
        if (terms.length) list.push({ source: 'custom', label: 'Custom keyword', re: new RegExp(terms.map(escapeRegExp).join('|'), 'gi') });
      }
    }
    return list;
  }

  $('[data-scan-btn]', root).addEventListener('click', async function () {
    var regexList = buildActiveRegexList();
    if (!regexList.length) { showMessage('Choose at least one preset or enter a keyword/pattern first.', 'error'); return; }
    var scanAll = $('[data-scan-all-files]', root).checked;
    var targets = scanAll ? state.files : [activeEntry()];
    var matches = [];
    for (var t = 0; t < targets.length; t++) {
      var entry = targets[t];
      var fileIdx = state.files.indexOf(entry);
      for (var p = 1; p <= entry.pageCount; p++) {
        var pinfo = entry.pages[p - 1];
        if (!pinfo.textItems) {
          await ensureTextItems(entry, p);
        }
        pinfo.textItems.forEach(function (box) {
          regexList.forEach(function (rx) {
            rx.re.lastIndex = 0;
            var m;
            while ((m = rx.re.exec(box.str))) {
              if (rx.filter && !rx.filter(m[0])) { if (m[0].length === 0) rx.re.lastIndex++; continue; }
              var startFrac = m.index / box.str.length, endFrac = (m.index + m[0].length) / box.str.length;
              matches.push({ fileIndex: fileIdx, page: p, text: m[0], label: rx.label, box: box, startFrac: startFrac, endFrac: endFrac });
              if (m[0].length === 0) rx.re.lastIndex++;
            }
          });
        });
        if (pinfo.ocrWords) {
          pinfo.ocrWords.forEach(function (w) {
            regexList.forEach(function (rx) {
              rx.re.lastIndex = 0;
              var mm = rx.re.exec(w.text);
              if (mm && (!rx.filter || rx.filter(mm[0]))) {
                matches.push({ fileIndex: fileIdx, page: p, text: w.text, label: rx.label + ' (OCR)', ocrWord: w });
              }
            });
          });
        }
        await yieldToUI();
      }
    }
    state.lastMatches = matches;
    renderMatchList();
  });

  function renderMatchList() {
    var list = $('[data-match-list]', root);
    var confirmBtn = $('[data-confirm-matches]', root);
    if (!state.lastMatches.length) {
      list.innerHTML = '<p class="rd-match-empty">No matches found. Try a different pattern or run OCR first for scanned pages.</p>';
      confirmBtn.classList.add('hidden');
      return;
    }
    list.innerHTML = '';
    state.lastMatches.forEach(function (m, idx) {
      var row = document.createElement('label'); row.className = 'rd-match-item';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.setAttribute('data-match-idx', idx);
      var body = document.createElement('div');
      var fileTag = state.files.length > 1 ? escapeHtml(state.files[m.fileIndex].name) + ' · ' : '';
      body.innerHTML = '<div class="rd-match-text">' + escapeHtml(m.text) + '</div><div class="rd-match-meta">' + fileTag + m.label + ' · page ' + m.page + '</div>';
      row.appendChild(cb); row.appendChild(body);
      list.appendChild(row);
    });
    confirmBtn.classList.remove('hidden');
  }

  $('[data-confirm-matches]', root).addEventListener('click', function () {
    var checks = $all('[data-match-idx]', root);
    var byFile = {};
    checks.forEach(function (cb) {
      if (!cb.checked) return;
      var m = state.lastMatches[parseInt(cb.getAttribute('data-match-idx'), 10)];
      byFile[m.fileIndex] = byFile[m.fileIndex] || [];
      byFile[m.fileIndex].push(m);
    });
    Object.keys(byFile).forEach(function (fileIdxStr) {
      var fileIdx = parseInt(fileIdxStr, 10);
      var entry = state.files[fileIdx];
      entry.history.push(JSON.parse(JSON.stringify(entry.marks)));
      entry.future = [];
      byFile[fileIdx].forEach(function (m) {
        var frac;
        if (m.ocrWord) frac = { xf: m.ocrWord.xf, yf: m.ocrWord.yf, wf: m.ocrWord.wf, hf: m.ocrWord.hf };
        else frac = fracFromBox(m.box, m.startFrac, m.endFrac);
        entry.marks.push({ id: uid(), page: m.page, xf: frac.xf, yf: frac.yf, wf: frac.wf, hf: frac.hf, color: state.defaultColor, source: m.ocrWord ? 'ocr' : 'text', label: m.label + ': "' + m.text.slice(0, 24) + '"' });
      });
    });
    state.lastMatches = [];
    renderMatchList();
    showMessage('Matches added as redaction marks. Review the Marks panel, then Apply & Download when ready.', 'success');
    afterMarksChanged();
    if (state.files[state.activeFile]) renderPage();
  });

  /* ============================================================
     OCR
     ============================================================ */
  var ocrStatus = $('[data-ocr-status]', root);
  async function runOcrOnPage(entry, pageNum) {
    var pinfo = entry.pages[pageNum - 1];
    if (pinfo.ocrDone) return;
    var Tesseract = await loadTesseract();
    var page = await entry.jsDoc.getPage(pageNum);
    var ocrScale = isMobileView() ? 1.5 : 2;
    var vp = page.getViewport({ scale: ocrScale });
    var c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    var result = await Tesseract.recognize(c, 'eng', {
      logger: function (info) {
        if (info.status && typeof info.progress === 'number') {
          ocrStatus.textContent = 'Page ' + pageNum + ': ' + info.status + ' (' + Math.round(info.progress * 100) + '%)';
        }
      }
    });
    var words = (result && result.data && result.data.words) || [];
    pinfo.ocrWords = words.filter(function (w) { return w.text && w.text.trim(); }).map(function (w) {
      return {
        text: w.text,
        xf: clamp(w.bbox.x0 / c.width, 0, 1),
        yf: clamp(w.bbox.y0 / c.height, 0, 1),
        wf: clamp((w.bbox.x1 - w.bbox.x0) / c.width, 0.001, 1),
        hf: clamp((w.bbox.y1 - w.bbox.y0) / c.height, 0.001, 1)
      };
    });
    pinfo.ocrDone = true;
  }

  $('[data-ocr-page-btn]', root).addEventListener('click', async function () {
    var entry = activeEntry(); if (!entry || state.ocrBusy) return;
    state.ocrBusy = true;
    this.disabled = true;
    try {
      ocrStatus.textContent = 'Starting OCR engine…';
      await runOcrOnPage(entry, state.currentPage);
      ocrStatus.textContent = 'OCR complete for page ' + state.currentPage + ' — ' + (entry.pages[state.currentPage - 1].ocrWords || []).length + ' words recognized.';
      renderOverlay();
    } catch (err) {
      console.error(err);
      ocrStatus.textContent = '';
      showMessage(err.message || 'OCR failed on this page.', 'error');
    } finally { state.ocrBusy = false; this.disabled = false; }
  });

  $('[data-ocr-all-btn]', root).addEventListener('click', async function () {
    var entry = activeEntry(); if (!entry || state.ocrBusy) return;
    state.ocrBusy = true;
    this.disabled = true;
    try {
      for (var p = 1; p <= entry.pageCount; p++) {
        ocrStatus.textContent = 'OCR page ' + p + ' of ' + entry.pageCount + '…';
        await runOcrOnPage(entry, p);
        await yieldToUI();
      }
      ocrStatus.textContent = 'OCR complete for all ' + entry.pageCount + ' pages.';
      renderOverlay();
    } catch (err) {
      console.error(err);
      showMessage(err.message || 'OCR failed.', 'error');
    } finally { state.ocrBusy = false; this.disabled = false; }
  });

  /* ============================================================
     Apply redaction — the permanence-critical step
     ============================================================ */
  function setProgress(pct, text) { progressFill.style.width = pct + '%'; if (text) progressText.textContent = text; }

  async function canvasToJpegBytes(canvas, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { blob.arrayBuffer().then(resolve); }, 'image/jpeg', quality);
    });
  }

  function drawRedactedStamp(ctx, canvasW, canvasH) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#dc2626';
    var fontSize = Math.max(14, Math.round(canvasW * 0.018));
    ctx.font = '900 ' + fontSize + 'px Helvetica, Arial, sans-serif';
    ctx.translate(canvasW - 14, canvasH - 14);
    ctx.textAlign = 'right';
    ctx.fillText('REDACTED', 0, 0);
    ctx.restore();
  }

  async function buildRedactedPdf(entry, opts, onProgress) {
    var PDFLib = await loadPdfLib();
    var outDoc = await PDFLib.PDFDocument.create();
    outDoc.setProducer('ToolAdda Redact PDF — tooladda.online'); outDoc.setCreator('ToolAdda');
    var stats = { pagesTotal: entry.pageCount, pagesRedacted: 0, pagesRasterized: 0, pagesVector: 0, pagesRemoved: 0, marksApplied: 0, byType: {}, metadataStripped: !!opts.strip };
    var srcLibDoc = null;
    async function ensureSrcLibDoc() { if (!srcLibDoc) srcLibDoc = await PDFLib.PDFDocument.load(entry.bytes.slice()); return srcLibDoc; }

    if (!opts.strip) {
      // Only carry original metadata forward when the user explicitly opts out of stripping —
      // the default (and safest) behavior clears it since PDFDocument.create() starts blank.
      try {
        var metaSrc = await ensureSrcLibDoc();
        var t = metaSrc.getTitle(), a = metaSrc.getAuthor(), s = metaSrc.getSubject();
        if (t) outDoc.setTitle(t);
        if (a) outDoc.setAuthor(a);
        if (s) outDoc.setSubject(s);
      } catch (e) { /* best-effort — malformed metadata should never block redaction */ }
    }

    for (var p = 1; p <= entry.pageCount; p++) {
      var pinfo = entry.pages[p - 1];
      if (pinfo.removed) { stats.pagesRemoved++; onProgress(p, entry.pageCount); await yieldToUI(); continue; }
      await ensurePageDims(entry, p);
      var pageMarks = entry.marks.filter(function (m) { return m.page === p; });
      var needsRaster = opts.forceRaster || pageMarks.length > 0;

      if (needsRaster) {
        var page = await entry.jsDoc.getPage(p);
        var scale = opts.dpi / 72;
        var vp = page.getViewport({ scale: scale });
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(vp.width));
        c.height = Math.max(1, Math.round(vp.height));
        var ctx = c.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        pageMarks.forEach(function (m) {
          ctx.fillStyle = m.color;
          ctx.fillRect(m.xf * c.width, m.yf * c.height, m.wf * c.width, m.hf * c.height);
          stats.marksApplied++;
          stats.byType[m.source] = (stats.byType[m.source] || 0) + 1;
        });
        if (opts.watermark && pageMarks.length) drawRedactedStamp(ctx, c.width, c.height);
        var jpgBytes = await canvasToJpegBytes(c, opts.dpi >= 300 ? 0.94 : 0.88);
        var img = await outDoc.embedJpg(jpgBytes);
        var newPage = outDoc.addPage([pinfo.wPts, pinfo.hPts]);
        newPage.drawImage(img, { x: 0, y: 0, width: pinfo.wPts, height: pinfo.hPts });
        stats.pagesRasterized++;
        if (pageMarks.length) stats.pagesRedacted++;
      } else {
        // embedPage captures content against the page's RAW (unrotated) MediaBox and does not
        // carry over /Rotate, so a landscape page stored as a rotated portrait MediaBox (common
        // for scans/exports) must get its rotation re-applied on the new page explicitly —
        // otherwise the passthrough page renders stretched/sideways relative to the original.
        var libDoc = await ensureSrcLibDoc();
        var srcPage = libDoc.getPage(p - 1);
        var rawW = srcPage.getWidth(), rawH = srcPage.getHeight();
        var rotation = srcPage.getRotation();
        var embedded = await outDoc.embedPage(srcPage);
        var vecPage = outDoc.addPage([rawW, rawH]);
        vecPage.setRotation(rotation);
        vecPage.drawPage(embedded, { x: 0, y: 0, width: rawW, height: rawH });
        stats.pagesVector++;
      }
      onProgress(p, entry.pageCount);
      await yieldToUI();
    }

    var bytes = await outDoc.save();
    return { bytes: bytes, stats: stats };
  }

  function buildReportText(entry, stats) {
    var lines = [];
    lines.push('ToolAdda — PDF Redaction Summary Report');
    lines.push('Generated: ' + new Date().toString());
    lines.push('Source file: ' + entry.name);
    lines.push('');
    lines.push('Total pages: ' + stats.pagesTotal);
    lines.push('Pages with redactions applied: ' + stats.pagesRedacted);
    lines.push('Pages rasterized to guarantee permanence: ' + stats.pagesRasterized);
    lines.push('Pages kept vector (untouched, fully selectable): ' + stats.pagesVector);
    lines.push('Pages removed from output: ' + stats.pagesRemoved);
    lines.push('Total redaction marks applied: ' + stats.marksApplied);
    Object.keys(stats.byType).forEach(function (k) { lines.push('  - ' + sourceLabel(k) + ': ' + stats.byType[k]); });
    lines.push('');
    lines.push('Metadata stripped: ' + (stats.metadataStripped ? 'yes (title, author, subject cleared)' : 'no (original title/author/subject carried over)'));
    lines.push('Comments, form fields, links and bookmarks: not carried over (document rebuilt from scratch)');
    lines.push('');
    lines.push('This report is generated locally in your browser for your own audit records.');
    return lines.join('\n');
  }

  var lastResult = null;
  $('[data-apply-btn]', root).addEventListener('click', async function () {
    if (!state.files.length) return;
    var btn = this;
    var opts = {
      strip: $('[data-opt-strip-meta]', root).checked,
      watermark: $('[data-opt-watermark]', root).checked,
      forceRaster: $('[data-opt-force-raster]', root).checked,
      dpi: parseInt($('#rdQuality', root).value, 10) || 300
    };
    btn.disabled = true;
    updateSticky();
    progressWrap.classList.add('is-active');
    resultPanel.classList.add('hidden');
    setProgress(2, 'Preparing…');
    try {
      var outputs = [];
      for (var i = 0; i < state.files.length; i++) {
        var entry = state.files[i];
        setProgress(5, 'Redacting ' + entry.name + '…');
        var res = await buildRedactedPdf(entry, opts, function (p, total) {
          var pct = 5 + Math.round((p / total) * 90 / state.files.length) + Math.round((i / state.files.length) * 90);
          setProgress(Math.min(pct, 95), 'Redacting ' + entry.name + ' — page ' + p + ' of ' + total + '…');
        });
        outputs.push({ name: baseName(entry.name) + '-redacted.pdf', bytes: res.bytes, stats: res.stats, entry: entry });
      }
      setProgress(97, 'Finalizing…');

      var resultUrl = '';
      var downloadLink = $('[data-download-link]', root);
      if (outputs.length === 1) {
        var blob = new Blob([outputs[0].bytes], { type: 'application/pdf' });
        resultUrl = URL.createObjectURL(blob);
        downloadLink.href = resultUrl; downloadLink.download = outputs[0].name; downloadLink.classList.remove('hidden');
        $('[data-result-filename]', root).textContent = outputs[0].name;
        $('[data-stat-size]', root).textContent = formatBytes(outputs[0].bytes.length);
        $('[data-stat-pages]', root).textContent = outputs[0].stats.pagesTotal - outputs[0].stats.pagesRemoved;
        $('[data-stat-marks]', root).textContent = outputs[0].stats.marksApplied;
        $('[data-stat-removed]', root).textContent = outputs[0].stats.pagesRemoved;
        var a = document.createElement('a'); a.href = resultUrl; a.download = outputs[0].name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } else {
        var JSZip = await loadJSZip();
        var zip = new JSZip();
        var totalMarks = 0, totalRemoved = 0, totalPages = 0;
        outputs.forEach(function (o) {
          zip.file(o.name, o.bytes);
          zip.file(baseName(o.entry.name) + '-redaction-report.txt', buildReportText(o.entry, o.stats));
          totalMarks += o.stats.marksApplied; totalRemoved += o.stats.pagesRemoved; totalPages += (o.stats.pagesTotal - o.stats.pagesRemoved);
        });
        var zipBlob = await zip.generateAsync({ type: 'blob' });
        resultUrl = URL.createObjectURL(zipBlob);
        downloadLink.href = resultUrl; downloadLink.download = 'redacted-pdfs.zip'; downloadLink.classList.remove('hidden');
        $('[data-result-filename]', root).textContent = 'redacted-pdfs.zip (' + outputs.length + ' files)';
        $('[data-stat-size]', root).textContent = formatBytes(zipBlob.size);
        $('[data-stat-pages]', root).textContent = totalPages;
        $('[data-stat-marks]', root).textContent = totalMarks;
        $('[data-stat-removed]', root).textContent = totalRemoved;
        var za = document.createElement('a'); za.href = resultUrl; za.download = 'redacted-pdfs.zip';
        document.body.appendChild(za); za.click(); document.body.removeChild(za);
      }

      lastResult = outputs;
      resultPanel.classList.remove('hidden');
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setStep(6);
      setProgress(100, 'Done!');
      showMessage('Redacted PDF ready — the marked areas have been permanently removed.', 'success');
    } catch (err) {
      console.error(err);
      showMessage('Something went wrong: ' + (err.message || 'unknown error') + '.', 'error');
    } finally {
      btn.disabled = false;
      updateSticky();
      window.setTimeout(function () { progressWrap.classList.remove('is-active'); }, 900);
    }
  });

  $('[data-download-report]', root).addEventListener('click', function () {
    if (!lastResult || !lastResult.length) return;
    var text = lastResult.length === 1
      ? buildReportText(lastResult[0].entry, lastResult[0].stats)
      : lastResult.map(function (o) { return buildReportText(o.entry, o.stats); }).join('\n\n' + new Array(40).join('=') + '\n\n');
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'redaction-summary-report.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });

  $('[data-redact-another]', root).addEventListener('click', function () { window.location.reload(); });
  $('[data-reset-btn]', root).addEventListener('click', function () { window.location.reload(); });

  /* ============================================================
     Phone bottom bar — stands in for whichever control is off screen:
     the picker before a PDF is open, then Apply, then Download.
     ============================================================ */
  var stickyBar = document.querySelector('.rd-sticky-cta');
  var stickyBtn = $('[data-sticky-redact-cta]');
  var applyBtn = $('[data-apply-btn]', root);
  var downloadBtn = $('[data-download-link]', root);
  var phoneQuery = window.matchMedia('(max-width: 768px)');
  var inView = { tool: true, apply: false, download: false };

  function stickyPhase() {
    if (!state.files.length) return 'upload';
    return resultPanel.classList.contains('hidden') ? 'edit' : 'result';
  }
  function updateSticky() {
    if (!stickyBar || !stickyBtn) return;
    var phase = stickyPhase();
    var label = 'Choose PDF to redact';
    var show = !inView.tool;
    if (phase === 'edit') { label = 'Apply redaction & download'; show = !inView.apply && !applyBtn.disabled; }
    else if (phase === 'result') { label = 'Download redacted PDF'; show = !inView.download; }
    show = show && phoneQuery.matches;
    if (stickyBtn.textContent !== label) stickyBtn.textContent = label;
    stickyBar.classList.toggle('is-visible', show);
    stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    stickyBtn.tabIndex = show ? 0 : -1;
    var was = document.body.classList.contains('rd-sticky-on');
    document.body.classList.toggle('rd-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }
  if (stickyBtn) {
    stickyBtn.addEventListener('click', function () {
      var phase = stickyPhase();
      if (phase === 'upload') { root.scrollIntoView({ behavior: 'smooth', block: 'start' }); openPicker(); }
      else if (phase === 'edit') applyBtn.click();
      else downloadBtn.click();
    });
  }
  if ('IntersectionObserver' in window) {
    var stickyWatch = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.target === root) inView.tool = en.isIntersecting;
        else if (en.target === applyBtn) inView.apply = en.isIntersecting;
        else if (en.target === downloadBtn) inView.download = en.isIntersecting;
      });
      updateSticky();
    });
    stickyWatch.observe(root);
    stickyWatch.observe(applyBtn);
    stickyWatch.observe(downloadBtn);
  }
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);
  updateSticky();

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!editorRoot || editorRoot.classList.contains('hidden')) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var w = getCanvasMaxWidth();
      if (Math.abs(w - lastWrapWidth) < 8) {
        applyZoomDisplay();
        return;
      }
      lastWrapWidth = w;
      renderPage();
    }, 200);
  });

  if (canvasWrap && typeof ResizeObserver !== 'undefined') {
    var canvasRoTimer = null;
    var canvasRo = new ResizeObserver(function () {
      if (suppressCanvasRo) return;
      clearTimeout(canvasRoTimer);
      canvasRoTimer = setTimeout(function () {
        if (suppressCanvasRo) return;
        if (!editorRoot || editorRoot.classList.contains('hidden')) return;
        if (!pageCanvas.width || canvasStack.classList.contains('hidden')) return;
        var w = getCanvasMaxWidth();
        if (Math.abs(w - lastWrapWidth) < 8) return;
        lastWrapWidth = w;
        renderPage();
      }, 220);
    });
    canvasRo.observe(canvasWrap);
  }

})();
