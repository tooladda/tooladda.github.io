document.addEventListener('DOMContentLoaded', () => {
  const page = document.querySelector('[data-split-page]');
  if (!page) return;

  const fileInput = page.querySelector('[data-file-input]');
  const filePickers = Array.from(page.querySelectorAll('[data-file-picker]'));
  const dropZone = page.querySelector('[data-drop-zone]');
  const editorPanel = page.querySelector('[data-editor]');
  const previewPanel = page.querySelector('[data-file-preview]');
  const fileNameText = page.querySelector('[data-file-name]');
  const pageCountText = page.querySelector('[data-page-count]');
  const fileSizeText = page.querySelector('[data-file-size]');
  const modeCards = Array.from(page.querySelectorAll('[data-split-mode]'));
  const rangeField = page.querySelector('[data-range-field]');
  const extractField = page.querySelector('[data-extract-field]');
  const everyNField = page.querySelector('[data-every-n-field]');
  const pageRangeInput = page.querySelector('[data-page-range]');
  const customPagesInput = page.querySelector('[data-custom-pages]');
  const everyNInput = page.querySelector('[data-every-n]');
  const planBox = page.querySelector('[data-split-plan]');
  const planText = page.querySelector('[data-split-plan-text]');
  const thumbsGrid = page.querySelector('[data-thumbs-grid]');
  const selectAllBtn = page.querySelector('[data-select-all]');
  const clearSelectionBtn = page.querySelector('[data-clear-selection]');
  const zoomInBtn = page.querySelector('[data-zoom-in]');
  const zoomOutBtn = page.querySelector('[data-zoom-out]');
  const selectionNote = page.querySelector('[data-selection-note]');
  const splitButton = page.querySelector('[data-split-btn]');
  const downloadZipBtn = page.querySelector('[data-download-zip-btn]');
  const downloadSingleBtn = page.querySelector('[data-download-single]');
  const downloadSingleLabel = page.querySelector('[data-download-single-label]');
  const splitAnotherBtn = page.querySelector('[data-split-another]');
  const resultPanel = page.querySelector('[data-result-panel]');
  const resultSummary = page.querySelector('[data-result-summary]');
  const progressWrap = page.querySelector('[data-progress-wrap]');
  const progressFill = page.querySelector('[data-progress-fill]');
  const progressText = page.querySelector('[data-progress-text]');
  const outputList = page.querySelector('[data-output-list]');
  const messageBox = page.querySelector('[data-message]');
  const loader = page.querySelector('[data-loader]');
  const resetButton = page.querySelector('[data-reset-btn]');
  const flowSteps = Array.from(page.querySelectorAll('[data-ps-flow]'));
  const stickyCta = document.querySelector('[data-sticky-split-cta]');
  const stickyBar = stickyCta ? stickyCta.closest('.ps-sticky-cta') : null;
  const phoneQuery = window.matchMedia('(max-width: 768px)');

  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const PDFJS_VERSION = '4.2.67';
  const THUMB_WIDTHS = [100, 130, 165, 200];

  let sourceFile = null;
  let sourceDoc = null;
  let pdfjsDoc = null;
  let pageCount = 0;
  let splitMode = 'every-page';
  let pageStates = [];
  let splitOutputs = [];
  let activeUrls = [];
  let thumbWidthIndex = 1;
  let thumbObserver = null;
  let pdfjsPromise = null;
  let jsZipPromise = null;
  let singleBlobUrl = '';
  let busy = false;
  let currentStep = 'upload';
  // The phone bar stands in for a control that has scrolled off screen;
  // this tracks which of those controls are visible.
  const inView = { tool: true, split: false, download: false };

  const getPdfLib = () => window.PDFLib || window.pdfLib;

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* "1–3 · 4–6 · 7" — how a page list reads in the plan and the result. */
  const describePages = (pages) => {
    const parts = [];
    let start = pages[0];
    let prev = pages[0];
    for (let i = 1; i <= pages.length; i += 1) {
      const p = pages[i];
      if (p === prev + 1) { prev = p; continue; }
      parts.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = p;
      prev = p;
    }
    return parts.join(', ');
  };

  const loadPdfJs = async () => {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`).then((mod) => {
      const lib = mod.default || mod;
      if (lib.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
      }
      return lib;
    }).catch((err) => {
      // A failed import used to be cached for the life of the tab.
      pdfjsPromise = null;
      throw err;
    });
    return pdfjsPromise;
  };

  const loadJSZip = async () => {
    if (window.JSZip) return window.JSZip;
    if (!jsZipPromise) {
      jsZipPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'assets/js/jszip.min.js';
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => { jsZipPromise = null; reject(new Error('Could not load ZIP library.')); };
        document.head.appendChild(s);
      });
    }
    return jsZipPromise;
  };

  const setMessage = (text, type = 'success') => {
    if (!messageBox) return;
    messageBox.textContent = text;
    messageBox.className = `ps-message ${type}`;
    messageBox.classList.remove('hidden');
    messageBox.setAttribute('role', type === 'error' ? 'alert' : 'status');
  };

  const clearMessage = () => {
    if (!messageBox) return;
    messageBox.textContent = '';
    messageBox.className = 'ps-message hidden';
  };

  const setProgress = (pct, label) => {
    if (!progressWrap || !progressFill) return;
    progressWrap.classList.remove('hidden');
    progressWrap.setAttribute('aria-hidden', 'false');
    progressWrap.setAttribute('aria-valuenow', String(Math.round(pct)));
    progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (progressText && label) progressText.textContent = label;
  };

  const hideProgress = () => {
    if (!progressWrap) return;
    progressWrap.classList.add('hidden');
    progressWrap.setAttribute('aria-hidden', 'true');
    if (progressFill) progressFill.style.width = '0%';
  };

  /* Step chips and the phone bar follow the job. */
  const setStep = (step) => {
    currentStep = step;
    const index = step === 'result' ? 2 : step === 'config' ? 1 : 0;
    flowSteps.forEach((li, i) => {
      li.classList.toggle('is-done', i < index || (step === 'result' && i === 2));
      li.classList.toggle('is-active', i === index);
      if (i === index) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    updateSticky();
  };

  /* Phone bottom bar: upload while the drop zone is off screen, split while
     the Split button is, then download once the result's own button is. It
     used to sit there permanently, and a tap after a finished split ran the
     whole split again. */
  function updateSticky() {
    if (!stickyBar || !stickyCta) return;
    let label = 'Upload PDF';
    let show = !inView.tool;
    if (currentStep === 'result') {
      label = splitOutputs.length > 1 ? 'Download all as ZIP' : 'Download PDF';
      show = !inView.download;
    } else if (currentStep === 'config') {
      label = 'Split PDF';
      show = !inView.split;
    }
    show = show && phoneQuery.matches && !busy;
    if (stickyCta.textContent !== label) stickyCta.textContent = label;
    stickyBar.classList.toggle('is-visible', show);
    stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    stickyCta.tabIndex = show ? 0 : -1;
    const was = document.body.classList.contains('ps-sticky-on');
    document.body.classList.toggle('ps-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }

  const toggleLoader = (visible) => {
    busy = visible;
    page.classList.toggle('is-busy', visible);
    if (loader) loader.classList.toggle('hidden', !visible);
    if (splitButton) splitButton.disabled = visible;
    filePickers.forEach((p) => { p.disabled = visible; });
    if (resetButton) resetButton.disabled = visible;
    modeCards.forEach((c) => { c.disabled = visible; });
    [pageRangeInput, customPagesInput, everyNInput, downloadZipBtn, splitAnotherBtn].forEach((c) => { if (c) c.disabled = visible; });
    updateSticky();
  };

  const cleanupUrls = () => {
    activeUrls.forEach((url) => URL.revokeObjectURL(url));
    activeUrls = [];
    if (singleBlobUrl) {
      URL.revokeObjectURL(singleBlobUrl);
      singleBlobUrl = '';
    }
  };

  const looksLikePdf = (file) => {
    if (!file) return false;
    if (file.type === 'application/pdf') return true;
    return /\.pdf$/i.test(file.name || '');
  };

  const getSelectedPages = () => pageStates.filter((p) => p.selected).map((p) => p.number).sort((a, b) => a - b);

  const parsePageList = (raw, label = 'pages') => {
    const trimmed = (raw || '').trim();
    if (!trimmed) throw new Error(`Enter ${label} like 1,3,5-7.`);
    const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    const set = new Set();
    parts.forEach((segment) => {
      if (/^\d+$/.test(segment)) {
        set.add(Number(segment));
        return;
      }
      const m = segment.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (!m) throw new Error('Use numbers or ranges like 1,3,5-7.');
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (start > end) throw new Error('Range start must be less than or equal to end.');
      for (let i = start; i <= end; i += 1) set.add(i);
    });
    const pages = Array.from(set).sort((a, b) => a - b);
    pages.forEach((n) => {
      if (n < 1 || n > pageCount) throw new Error(`Page ${n} is outside 1–${pageCount}.`);
    });
    if (!pages.length) throw new Error('Select at least one valid page.');
    return pages;
  };

  /* A range, or a single page — "3" used to be rejected as "not a valid range". */
  const parseRange = (raw) => {
    const text = (raw || '').trim();
    const single = text.match(/^(\d+)$/);
    const m = single ? [text, single[1], single[1]] : text.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (!m) throw new Error('Enter a valid range like 2-5.');
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Range must be within 1–${pageCount}.`);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  const parseEveryN = () => {
    const n = parseInt(everyNInput?.value, 10);
    if (!Number.isFinite(n) || n < 1) throw new Error('Enter a valid number of pages per file (e.g. 3).');
    if (n >= pageCount) throw new Error(`Split size must be less than total pages (${pageCount}).`);
    return n;
  };

  /* The whole split, worked out before anything is built: one entry per
     output file, each with its pages and its file name. The plan line, the
     thumbnail markings and the split itself all come from here, so what the
     page promises is exactly what gets produced. */
  const computePlan = () => {
    const baseName = (sourceFile?.name || 'document').replace(/\.pdf$/i, '');
    const all = Array.from({ length: pageCount }, (_, i) => i + 1);
    const one = (pages, label) => [{ pages, label }];
    switch (splitMode) {
      case 'every-page':
        return all.map((p) => ({ pages: [p], label: `${baseName}-page-${p}` }));
      case 'range': {
        const pages = parseRange(pageRangeInput?.value);
        return one(pages, pages.length === 1 ? `${baseName}-page-${pages[0]}` : `${baseName}-pages-${pages[0]}-${pages[pages.length - 1]}`);
      }
      case 'extract': {
        const typed = (customPagesInput?.value || '').trim();
        const pages = typed ? parsePageList(typed) : getSelectedPages();
        if (!pages.length) throw new Error('Select pages in the grid or enter page numbers.');
        const label = pages.length === 1
          ? `${baseName}-page-${pages[0]}`
          : pages.length <= 6 ? `${baseName}-pages-${pages.join('-')}` : `${baseName}-selected-${pages.length}-pages`;
        return one(pages, label);
      }
      case 'every-n': {
        const n = parseEveryN();
        const groups = [];
        for (let start = 1; start <= pageCount; start += n) {
          const end = Math.min(start + n - 1, pageCount);
          const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
          groups.push({ pages, label: `${baseName}-${pages.length === 1 ? `page-${start}` : `pages-${start}-${end}`}` });
        }
        return groups;
      }
      case 'odd':
        return one(all.filter((p) => p % 2 === 1), `${baseName}-odd-pages`);
      case 'even': {
        const pages = all.filter((p) => p % 2 === 0);
        if (!pages.length) throw new Error('This PDF has only one page, so it has no even pages.');
        return one(pages, `${baseName}-even-pages`);
      }
      default:
        return [];
    }
  };

  /* Draw the plan: the summary line above the grid, and on the thumbnails a
     dashed cut after the last page of each file, alternating tints per file,
     and faded tiles for pages that will not be in any file. */
  const renderPlan = () => {
    if (!planBox || !pageCount) return;
    let plan = null;
    let error = '';
    try { plan = computePlan(); } catch (err) { error = err.message; }

    planBox.classList.toggle('is-error', !!error);
    if (error) {
      planText.textContent = error;
    } else if (plan.length === 1) {
      planText.textContent = `Creates 1 PDF with ${plural(plan[0].pages.length, 'page')}: ${describePages(plan[0].pages)}.`;
    } else {
      const shown = plan.slice(0, 8).map((g) => describePages(g.pages)).join(' · ');
      planText.textContent = `Creates ${plan.length} PDFs: ${shown}${plan.length > 8 ? ` · … and ${plan.length - 8} more` : ''}.`;
    }

    const fileOf = new Map();
    const cutAfter = new Set();
    if (plan) {
      plan.forEach((g, i) => {
        g.pages.forEach((p) => fileOf.set(p, i));
        // A cut only reads as one between consecutive pages; a scattered
        // selection is one file, not a series of cuts.
        if (plan.length > 1) cutAfter.add(g.pages[g.pages.length - 1]);
      });
    }
    const showFile = plan && plan.length > 1 && splitMode !== 'every-page';
    thumbsGrid?.querySelectorAll('.ps-thumb').forEach((tile) => {
      const n = Number(tile.dataset.page);
      const file = fileOf.has(n) ? fileOf.get(n) : -1;
      tile.classList.toggle('is-out', !!plan && file === -1);
      tile.classList.toggle('is-cut', cutAfter.has(n) && n !== pageCount);
      tile.classList.toggle('g1', file >= 0 && file % 2 === 0 && plan.length > 1);
      tile.classList.toggle('g2', file >= 0 && file % 2 === 1);
      const badge = tile.querySelector('.ps-thumb-file');
      if (badge) {
        badge.hidden = !showFile || file === -1;
        badge.textContent = showFile && file >= 0 ? `File ${file + 1}` : '';
      }
    });
  };

  const buildPdfFromPages = async (pages) => {
    const pdfLib = getPdfLib();
    const out = await pdfLib.PDFDocument.create();
    const copied = await out.copyPages(sourceDoc, pages.map((p) => p - 1));
    copied.forEach((pg) => out.addPage(pg));
    return out.save();
  };

  const buildSplitOutputs = async (onProgress) => {
    const plan = computePlan();
    const outputs = [];
    for (let i = 0; i < plan.length; i += 1) {
      if (onProgress) {
        onProgress((i + 0.5) / plan.length, plan.length === 1
          ? 'Building PDF…'
          : splitMode === 'every-page' ? `Page ${plan[i].pages[0]}…` : `Part ${i + 1} of ${plan.length}…`);
      }
      const bytes = await buildPdfFromPages(plan[i].pages);
      outputs.push({ label: plan[i].label, data: bytes, pages: plan[i].pages });
    }
    return outputs;
  };

  const renderThumb = async (holder, pageNum) => {
    if (!pdfjsDoc || !holder || holder.dataset.rendered === '1') return;
    const doc = pdfjsDoc;
    try {
      const pdfPage = await doc.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: 1 });
      // Drawn at the screen's pixel density so thumbnails stay sharp on phones.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = THUMB_WIDTHS[thumbWidthIndex] * dpr;
      const scaled = pdfPage.getViewport({ scale: targetW / viewport.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(scaled.width);
      canvas.height = Math.round(scaled.height);
      canvas.className = 'ps-thumb-canvas';
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
      if (doc !== pdfjsDoc) return; // a new file was loaded meanwhile
      holder.innerHTML = '';
      holder.appendChild(canvas);
      holder.dataset.rendered = '1';
    } catch {
      holder.innerHTML = `<span class="ps-thumb-fallback">Page ${pageNum}</span>`;
    }
  };

  const onThumbVisible = (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const holder = entry.target.querySelector('[data-canvas-holder]');
      const num = Number(entry.target.dataset.page);
      if (holder && num) renderThumb(holder, num);
      if (thumbObserver) thumbObserver.unobserve(entry.target);
    });
  };

  const updateSelectionNote = () => {
    if (!selectionNote) return;
    const count = getSelectedPages().length;
    if (splitMode !== 'extract') {
      selectionNote.textContent = '';
      selectionNote.classList.add('hidden');
      return;
    }
    selectionNote.classList.remove('hidden');
    selectionNote.textContent = count
      ? `${count} page${count === 1 ? '' : 's'} selected — click thumbnails or type ranges below.`
      : 'Click thumbnails to select pages, or type ranges like 1,3,5-7.';
  };

  /* Selection changes update the existing tiles in place. Re-rendering the
     whole grid for Select all or Clear re-drew every page thumbnail, which on
     a long document meant hundreds of canvas renders for a click. */
  const syncThumbSelection = () => {
    thumbsGrid?.querySelectorAll('.ps-thumb').forEach((tile) => {
      const pg = pageStates[Number(tile.dataset.page) - 1];
      if (!pg) return;
      tile.classList.toggle('is-selected', pg.selected);
      tile.setAttribute('aria-pressed', pg.selected ? 'true' : 'false');
      tile.setAttribute('aria-label', `Page ${pg.number}${pg.selected ? ', selected' : ''}`);
    });
    updateSelectionNote();
    renderPlan();
  };

  const renderThumbs = () => {
    if (!thumbsGrid) return;
    thumbsGrid.innerHTML = '';
    thumbsGrid.style.setProperty('--ps-thumb-w', `${THUMB_WIDTHS[thumbWidthIndex]}px`);
    if (thumbObserver) thumbObserver.disconnect();
    thumbObserver = ('IntersectionObserver' in window)
      ? new IntersectionObserver(onThumbVisible, { root: thumbsGrid, rootMargin: '200px' })
      : null;

    pageStates.forEach((pg) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `ps-thumb${pg.selected ? ' is-selected' : ''}`;
      tile.dataset.page = String(pg.number);
      tile.setAttribute('role', 'listitem');
      tile.setAttribute('aria-label', `Page ${pg.number}${pg.selected ? ', selected' : ''}`);
      tile.setAttribute('aria-pressed', pg.selected ? 'true' : 'false');
      tile.innerHTML = `
        <div class="ps-thumb-frame" data-canvas-holder><div class="ps-thumb-skeleton" aria-hidden="true"></div></div>
        <span class="ps-thumb-num">${pg.number}<span class="ps-thumb-file" aria-hidden="true" hidden></span></span>
      `;
      tile.addEventListener('click', () => {
        if (busy) return;
        if (splitMode !== 'extract') setMode('extract');
        pg.selected = !pg.selected;
        if (customPagesInput) {
          const pages = getSelectedPages();
          customPagesInput.value = pages.length ? pages.join(',') : '';
        }
        invalidateResult();
        syncThumbSelection();
      });
      thumbsGrid.appendChild(tile);
      if (thumbObserver) thumbObserver.observe(tile);
      else renderThumb(tile.querySelector('[data-canvas-holder]'), pg.number);
    });
    if (zoomInBtn) zoomInBtn.disabled = thumbWidthIndex >= THUMB_WIDTHS.length - 1;
    if (zoomOutBtn) zoomOutBtn.disabled = thumbWidthIndex <= 0;
    updateSelectionNote();
    renderPlan();
  };

  const updateModeFields = () => {
    if (rangeField) rangeField.classList.toggle('hidden', splitMode !== 'range');
    if (extractField) extractField.classList.toggle('hidden', splitMode !== 'extract');
    if (everyNField) everyNField.classList.toggle('hidden', splitMode !== 'every-n');
    if (thumbsGrid) thumbsGrid.classList.toggle('ps-thumbs-selectable', splitMode === 'extract');
    updateSelectionNote();
    renderPlan();
  };

  /* One place that switches mode, so the cards' pressed state can never
     disagree with the mode actually in use (a thumbnail click used to move to
     Selected pages without updating aria-pressed). */
  function setMode(mode) {
    splitMode = mode;
    modeCards.forEach((c) => {
      const on = c.dataset.splitMode === mode;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updateModeFields();
  }

  /* A result belongs to the settings that made it. Changing the mode, the
     pages or the selection afterwards used to leave the old files on offer
     under the new settings. */
  const invalidateResult = () => {
    if (currentStep !== 'result') return;
    cleanupUrls();
    splitOutputs = [];
    if (resultPanel) resultPanel.classList.add('hidden');
    if (outputList) outputList.innerHTML = '';
    if (downloadZipBtn) downloadZipBtn.classList.add('hidden');
    if (downloadSingleBtn) downloadSingleBtn.classList.add('hidden');
    clearMessage();
    setStep('config');
  };

  const showEditor = () => {
    if (dropZone) dropZone.classList.add('hidden');
    if (editorPanel) editorPanel.classList.remove('hidden');
    if (previewPanel) previewPanel.classList.remove('hidden');
  };

  const hideEditor = () => {
    if (dropZone) dropZone.classList.remove('hidden');
    if (editorPanel) editorPanel.classList.add('hidden');
    if (previewPanel) previewPanel.classList.add('hidden');
    if (resultPanel) resultPanel.classList.add('hidden');
    if (outputList) outputList.innerHTML = '';
    if (downloadZipBtn) downloadZipBtn.classList.add('hidden');
    if (downloadSingleBtn) downloadSingleBtn.classList.add('hidden');
  };

  // pdf.js keeps a parsed copy of the document in its worker until told not to.
  const releasePdfjs = () => {
    if (pdfjsDoc) { try { pdfjsDoc.destroy(); } catch { /* already gone */ } }
    pdfjsDoc = null;
  };

  const resetTool = () => {
    sourceFile = null;
    sourceDoc = null;
    releasePdfjs();
    pageCount = 0;
    pageStates = [];
    splitOutputs = [];
    if (fileInput) fileInput.value = '';
    if (pageRangeInput) pageRangeInput.value = '';
    if (customPagesInput) customPagesInput.value = '';
    if (everyNInput) everyNInput.value = '3';
    setMode('every-page');
    hideEditor();
    hideProgress();
    clearMessage();
    cleanupUrls();
    if (thumbObserver) thumbObserver.disconnect();
    if (thumbsGrid) thumbsGrid.innerHTML = '';
    setStep('upload');
  };

  const loadFile = async (file) => {
    if (!looksLikePdf(file)) throw new Error('Please select a valid PDF file (.pdf).');
    if (file.size > MAX_FILE_SIZE) throw new Error('File exceeds 100 MB. Use a smaller PDF.');

    const bytes = await file.arrayBuffer();
    const pdfLib = getPdfLib();
    if (!pdfLib?.PDFDocument) throw new Error('PDF library failed to load. Refresh the page.');

    let doc;
    try {
      doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch {
      throw new Error('Could not open PDF. It may be corrupted.');
    }
    if (doc.isEncrypted) throw new Error('PDF is password-protected. Unlock it first with our Unlock PDF tool.');

    const count = doc.getPageCount();
    if (!count) throw new Error('This PDF has no pages.');

    // Everything above can fail; only now does the new file replace the old.
    releasePdfjs();
    cleanupUrls();
    splitOutputs = [];
    sourceFile = file;
    sourceDoc = doc;
    pageCount = count;
    pageStates = Array.from({ length: count }, (_, i) => ({ number: i + 1, selected: false }));
    if (pageRangeInput) pageRangeInput.value = '';
    if (customPagesInput) customPagesInput.value = '';
    if (everyNInput && Number(everyNInput.value) >= count) everyNInput.value = String(Math.max(1, Math.ceil(count / 2)));

    try {
      const pdfjs = await loadPdfJs();
      pdfjsDoc = await pdfjs.getDocument({ data: bytes.slice(0), useWorkerFetch: false, isEvalSupported: false }).promise;
    } catch {
      pdfjsDoc = null; // thumbnails fall back to page numbers; splitting still works
    }

    if (fileNameText) fileNameText.textContent = file.name;
    if (pageCountText) pageCountText.textContent = `${count} page${count === 1 ? '' : 's'}`;
    if (fileSizeText) fileSizeText.textContent = formatBytes(file.size);
    if (pageRangeInput) pageRangeInput.placeholder = count >= 2 ? `1-${count}` : '1';
    if (customPagesInput) customPagesInput.placeholder = count >= 3 ? '1,3,5-7' : '1';

    if (resultPanel) resultPanel.classList.add('hidden');
    if (outputList) outputList.innerHTML = '';
    showEditor();
    renderThumbs();
    updateModeFields();
    setStep('config');
  };

  const makeDownloadLink = (url, name) => {
    const a = document.createElement('a');
    a.className = 'ps-btn ps-btn--ghost ps-btn--sm';
    a.href = url;
    a.download = name;
    a.textContent = 'Download';
    a.setAttribute('aria-label', `Download ${name}`);
    return a;
  };

  const renderOutputs = (outputs) => {
    splitOutputs = outputs;
    cleanupUrls();
    if (outputList) outputList.innerHTML = '';

    const isSingle = outputs.length === 1;

    if (isSingle && downloadSingleBtn) {
      const count = outputs[0].pages.length;
      const blob = new Blob([outputs[0].data], { type: 'application/pdf' });
      singleBlobUrl = URL.createObjectURL(blob);
      downloadSingleBtn.href = singleBlobUrl;
      downloadSingleBtn.download = `${outputs[0].label}.pdf`;
      downloadSingleBtn.classList.remove('hidden');
      // "(1 pages)" used to slip through for a single-page file.
      const text = `Download PDF (${plural(count, 'page')})`;
      if (downloadSingleLabel) downloadSingleLabel.textContent = text; else downloadSingleBtn.textContent = text;
    } else if (downloadSingleBtn) {
      downloadSingleBtn.classList.add('hidden');
    }

    if (!isSingle) {
      /* Built as nodes, not an HTML string: the names come from the uploaded
         file's name, and a crafted name used to be injected as markup. */
      outputs.forEach((entry) => {
        const url = URL.createObjectURL(new Blob([entry.data], { type: 'application/pdf' }));
        activeUrls.push(url);
        const li = document.createElement('li');
        li.className = 'ps-output-item';
        const name = document.createElement('span');
        name.className = 'ps-output-name';
        name.textContent = `${entry.label}.pdf`;
        const meta = document.createElement('span');
        meta.className = 'ps-output-meta';
        meta.textContent = `${entry.pages.length === 1 ? 'Page' : 'Pages'} ${describePages(entry.pages)} · ${formatBytes(entry.data.byteLength || entry.data.length)}`;
        name.appendChild(meta);
        li.appendChild(name);
        li.appendChild(makeDownloadLink(url, `${entry.label}.pdf`));
        outputList?.appendChild(li);
      });
    }
    if (downloadZipBtn) downloadZipBtn.classList.toggle('hidden', outputs.length < 2);

    if (resultPanel) resultPanel.classList.remove('hidden');
    if (resultSummary) {
      resultSummary.textContent = isSingle
        ? `Your PDF with ${plural(outputs[0].pages.length, 'page')} is ready.`
        : `${outputs.length} PDF files ready — download individually or as ZIP.`;
    }
    setStep('result');
    if (resultPanel) {
      requestAnimationFrame(() => resultPanel.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'nearest',
      }));
    }
  };

  const generateZip = async () => {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    splitOutputs.forEach((entry) => zip.file(`${entry.label}.pdf`, entry.data));
    setProgress(90, 'Building ZIP…');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    activeUrls.push(zipUrl);
    const base = (sourceFile?.name || 'split').replace(/\.pdf$/i, '');
    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = `${base}-split.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    hideProgress();
  };

  const downloadSingle = () => {
    if (!singleBlobUrl || !downloadSingleBtn?.download) return;
    const a = document.createElement('a');
    a.href = singleBlobUrl;
    a.download = downloadSingleBtn.download;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadZip = async () => {
    if (busy) return;
    try {
      toggleLoader(true);
      await generateZip();
      setMessage('ZIP download started.', 'success');
    } catch {
      hideProgress();
      setMessage('Could not create ZIP file.', 'error');
    } finally {
      toggleLoader(false);
    }
  };

  const handleSplit = async () => {
    if (busy) return;
    if (!sourceFile || !sourceDoc) {
      setMessage('Upload a PDF before splitting.', 'error');
      return;
    }
    toggleLoader(true);
    clearMessage();
    cleanupUrls();
    if (resultPanel) resultPanel.classList.add('hidden');
    setProgress(0, 'Starting…');

    try {
      const outputs = await buildSplitOutputs((pct, label) => setProgress(pct * 100, label));
      hideProgress();
      renderOutputs(outputs);
      setMessage(`Split complete — ${outputs.length} file${outputs.length === 1 ? '' : 's'} ready.`, 'success');
    } catch (err) {
      hideProgress();
      setStep('config');
      setMessage(err.message || 'Could not split PDF.', 'error');
    } finally {
      toggleLoader(false);
    }
  };

  const handleFileLoad = async (file) => {
    if (busy) return;
    toggleLoader(true);
    clearMessage();
    try {
      await loadFile(file);
      setMessage('PDF loaded. Choose a split mode and click Split PDF.', 'success');
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      // The PDF that was already loaded (if any) stays exactly as it was.
      setMessage(err.message, 'error');
    } finally {
      toggleLoader(false);
    }
  };

  const openFilePicker = () => fileInput?.click();

  filePickers.forEach((picker) => {
    picker.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFilePicker();
    });
  });

  dropZone?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    openFilePicker();
  });

  /* A PDF can be dropped anywhere on the tool — the drop zone is hidden once
     a file is loaded — and a PDF dropped anywhere else on the page is
     swallowed, where the browser would otherwise navigate away to show it. */
  const carriesFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  let dragDepth = 0;
  page.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    page.classList.add('is-file-over');
    dropZone?.classList.add('active');
  });
  page.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  page.addEventListener('dragleave', (e) => {
    if (!carriesFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      page.classList.remove('is-file-over');
      dropZone?.classList.remove('active');
    }
  });
  page.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    page.classList.remove('is-file-over');
    dropZone?.classList.remove('active');
    if (e.dataTransfer.files?.[0]) handleFileLoad(e.dataTransfer.files[0]);
  });
  ['dragover', 'drop'].forEach((type) => {
    window.addEventListener(type, (e) => {
      if (carriesFiles(e) && !page.contains(e.target)) e.preventDefault();
    });
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleFileLoad(e.target.files[0]);
    e.target.value = '';
  });

  modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      if (busy) return;
      invalidateResult();
      setMode(card.dataset.splitMode || 'every-page');
      clearMessage();
    });
  });

  // The plan line follows every keystroke; the thumbnails follow once the
  // typed list is complete (on change), as before.
  [pageRangeInput, everyNInput].forEach((input) => {
    input?.addEventListener('input', () => { invalidateResult(); renderPlan(); });
  });
  customPagesInput?.addEventListener('input', () => { invalidateResult(); renderPlan(); });
  customPagesInput?.addEventListener('change', () => {
    if (!customPagesInput.value.trim()) {
      pageStates.forEach((p) => { p.selected = false; });
      syncThumbSelection();
      return;
    }
    try {
      const pages = parsePageList(customPagesInput.value);
      pageStates.forEach((p) => { p.selected = pages.includes(p.number); });
      syncThumbSelection();
    } catch (err) {
      setMessage(err.message, 'error');
    }
  });
  [pageRangeInput, customPagesInput, everyNInput].forEach((input) => {
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !busy) { e.preventDefault(); input.dispatchEvent(new Event('change')); handleSplit(); }
    });
  });

  selectAllBtn?.addEventListener('click', () => {
    if (busy) return;
    pageStates.forEach((p) => { p.selected = true; });
    setMode('extract');
    if (customPagesInput) customPagesInput.value = pageStates.map((p) => p.number).join(',');
    invalidateResult();
    syncThumbSelection();
  });

  clearSelectionBtn?.addEventListener('click', () => {
    if (busy) return;
    pageStates.forEach((p) => { p.selected = false; });
    if (customPagesInput) customPagesInput.value = '';
    invalidateResult();
    syncThumbSelection();
  });

  zoomInBtn?.addEventListener('click', () => {
    if (thumbWidthIndex < THUMB_WIDTHS.length - 1) {
      thumbWidthIndex += 1;
      renderThumbs();
    }
  });

  zoomOutBtn?.addEventListener('click', () => {
    if (thumbWidthIndex > 0) {
      thumbWidthIndex -= 1;
      renderThumbs();
    }
  });

  splitButton?.addEventListener('click', handleSplit);
  downloadZipBtn?.addEventListener('click', downloadZip);

  downloadSingleBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadSingle();
  });

  const startOver = () => {
    if (busy) return;
    resetTool();
    page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    filePickers[filePickers.length - 1]?.focus({ preventScroll: true });
  };
  splitAnotherBtn?.addEventListener('click', startOver);
  resetButton?.addEventListener('click', startOver);

  if (stickyCta) {
    stickyCta.addEventListener('click', () => {
      if (busy) return;
      if (currentStep === 'result') {
        if (splitOutputs.length > 1) downloadZip(); else downloadSingle();
        return;
      }
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!sourceFile) openFilePicker();
      else handleSplit();
    });
  }

  // "Upload PDF" / "Split PDF now" links: bring the tool up, and with no file yet open the picker.
  document.querySelectorAll('a[href="#ps-tool"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!sourceFile && !busy) openFilePicker();
    });
  });

  if ('IntersectionObserver' in window) {
    const resultDownloads = [downloadSingleBtn, downloadZipBtn].filter(Boolean);
    const visible = new Set();
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === page) inView.tool = entry.isIntersecting;
        else if (entry.target === splitButton) inView.split = entry.isIntersecting;
        else if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
      });
      inView.download = visible.size > 0;
      updateSticky();
    });
    watch.observe(page);
    if (splitButton) watch.observe(splitButton);
    resultDownloads.forEach((b) => watch.observe(b));
  } else {
    inView.tool = false;
  }
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);

  resetTool();
});
