/* Merge PDF (pdf-merge.html).
   pdf-lib (assets/js/pdf-lib.min.js) does the merge. pdf.js 3.11.174, self-hosted in
   assets/js/pdfjs/, draws the queue thumbnails and the page preview. Nothing is
   uploaded: files stay in this tab's memory. */
(() => {
  // Read now: document.currentScript is null once DOMContentLoaded fires.
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || document.baseURI;
  const PDFJS_DIR = new URL('pdfjs/', SCRIPT_URL).href;
  const PDFJS_LIB = `${PDFJS_DIR}pdf.min.js`;
  const PDFJS_WORKER = `${PDFJS_DIR}pdf.worker.min.js`;

  const SOFT_FILE_SIZE = 50 * 1024 * 1024;
  const SOFT_TOTAL_SIZE = 150 * 1024 * 1024;
  const THUMB_MAX_BYTES = 60 * 1024 * 1024; // bigger PDFs keep the plain icon
  const TAB_COLOURS = 5;
  const PT_PER_PX = 0.75; // 96 DPI -> PDF points
  const MAX_IMAGE_PAGE_PT = 1600;

  const ICON = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/></svg>',
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error(`Could not load ${src}`)); };
    document.head.appendChild(script);
  });

  /* pdf.js is a classic script, not an ES module, so it also loads when the page
     is opened straight from disk (file://) with no network. One worker is started
     up front and shared by every document; once it is running, previews keep
     working even if the connection drops. */
  let pdfjsPromise = null;
  let pdfWorker = null;
  const loadPdfJs = () => {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = (async () => {
      if (!window.pdfjsLib) await loadScript(PDFJS_LIB);
      const lib = window.pdfjsLib;
      if (!lib || typeof lib.getDocument !== 'function') throw new Error('pdf.js did not load');
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      // A file:// page may not start a Worker. With the worker code loaded as a
      // script, pdf.js runs it on the page instead of trying and failing.
      if (location.protocol === 'file:' && !window.pdfjsWorker) await loadScript(PDFJS_WORKER);
      const worker = new lib.PDFWorker({ name: 'pm-merge' });
      await worker.promise;
      pdfWorker = worker;
      return lib;
    })();
    pdfjsPromise.catch(() => { pdfjsPromise = null; }); // allow a retry later
    return pdfjsPromise;
  };
  // isEvalSupported:false closes CVE-2024-4367 in this pdf.js version.
  const openPdf = async (data) => {
    const lib = await loadPdfJs();
    return lib.getDocument({ data, isEvalSupported: false, worker: pdfWorker });
  };

  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const formatBytes = (bytes) => {
    if (bytes == null || Number.isNaN(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const waitForPdfLib = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const lib = window.PDFLib;
      if (lib && lib.PDFDocument) { resolve(lib); return; }
      if (Date.now() - started > 12000) { reject(new Error('PDF library failed to load. Refresh the page.')); return; }
      setTimeout(tick, 40);
    };
    tick();
  });

  const looksLikePdf = (file) => !!(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')));
  const looksLikeImage = (file) => !!(file && (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name || '')));
  const kindLabel = (file) => {
    if (looksLikePdf(file)) return 'PDF';
    const m = /\.(jpe?g|png|webp)$/i.exec(file.name || '') || /image\/(jpeg|png|webp)/.exec(file.type || '');
    return m ? m[1].toUpperCase().replace('JPEG', 'JPG') : 'IMG';
  };

  const blobToBitmap = (blob) => {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image.')); };
      img.src = url;
    });
  };

  /* Rotate + rasterize an image file to bytes ready for pdf-lib embedding. With no
     rotation and a plain JPEG/PNG source the original bytes go in untouched (no
     recompression) instead of round-tripping through a canvas. */
  const rasterizeImage = async (file, rotationDeg) => {
    const rot = ((Number(rotationDeg) || 0) % 360 + 360) % 360;
    if (rot === 0 && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, mime: file.type, width: null, height: null };
    }
    const bitmap = await blobToBitmap(file);
    const srcW = bitmap.width || bitmap.naturalWidth;
    const srcH = bitmap.height || bitmap.naturalHeight;
    const swap = rot === 90 || rot === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? srcH : srcW;
    canvas.height = swap ? srcW : srcH;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(bitmap, -srcW / 2, -srcH / 2);
    if (typeof bitmap.close === 'function') bitmap.close();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), 'image/png');
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, mime: 'image/png', width: canvas.width, height: canvas.height };
  };

  const imagePageDims = (px, py) => {
    let w = px * PT_PER_PX;
    let h = py * PT_PER_PX;
    const longest = Math.max(w, h);
    if (longest > MAX_IMAGE_PAGE_PT) {
      const scale = MAX_IMAGE_PAGE_PT / longest;
      w *= scale;
      h *= scale;
    }
    return { width: w, height: h };
  };

  const init = () => {
    const page = document.querySelector('[data-pdf-merge-page]');
    if (!page) return;
    const body = document.body;
    const $ = (sel) => page.querySelector(sel);

    const fileInput = $('[data-file-input]');
    const filePickers = Array.from(page.querySelectorAll('[data-file-picker]'));
    const dropZone = $('[data-drop-zone]');
    const editorBlock = $('[data-editor-block]');
    const fileGrid = $('[data-file-grid]');
    const fileCountEl = $('[data-file-count]');
    const fileSizeEl = $('[data-file-size]');
    const pageCountEl = $('[data-page-count]');
    const addMoreBtn = $('[data-add-more-btn]');
    const removeAllBtn = $('[data-remove-all-btn]');
    const sortAlphaBtn = $('[data-sort-alpha]');
    const sortUploadBtn = $('[data-sort-upload]');
    const outputNameInput = $('[data-output-name]');
    const mergeButton = $('[data-merge-btn]');
    const mergeAnotherBtn = $('[data-merge-another]');
    const resultPanel = $('[data-result-panel]');
    const resultFileName = $('[data-result-filename]');
    const resultFileSize = $('[data-result-filesize]');
    const resultPageCount = $('[data-result-pagecount]');
    const downloadBtn = $('[data-download-link]');
    const progressWrap = $('[data-progress-wrap]');
    const progressFill = $('[data-progress-fill]');
    const progressText = $('[data-progress-text]');
    const messageBox = $('[data-message]');
    const loader = $('[data-loader]');
    const statusEl = $('[data-pm-status]');
    const flowSteps = Array.from(page.querySelectorAll('[data-pm-flow]'));
    const previewModal = $('[data-preview-modal]');
    const previewCanvas = $('[data-preview-canvas]');
    const previewTitle = $('[data-preview-title]');
    const previewClose = $('[data-preview-close]');
    const previewNav = $('[data-preview-nav]');
    const previewPrev = $('[data-preview-prev]');
    const previewNext = $('[data-preview-next]');
    const previewPageLabel = $('[data-preview-page-label]');
    const sticky = document.querySelector('.pm-sticky-cta');
    const stickyBtn = document.querySelector('[data-sticky-merge-cta]');
    const phoneQuery = window.matchMedia('(max-width: 768px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const files = [];
    let uploadCounter = 0;
    let mergedBlobUrl = '';
    let busy = false;
    let hasResult = false;
    let dragFromId = null;
    let mergeInView = false;
    let downloadInView = false;
    let stickyShown = false;

    /* ---------------------------------------------------------------- ui state */

    const setMessage = (text, type = 'success') => {
      if (!messageBox) return;
      messageBox.textContent = text;
      messageBox.className = `pm-message ${type}`;
      messageBox.setAttribute('role', type === 'error' ? 'alert' : 'status');
    };
    const clearMessage = () => {
      if (!messageBox) return;
      messageBox.textContent = '';
      messageBox.className = 'pm-message hidden';
    };

    const setProgress = (pct, label) => {
      if (!progressWrap || !progressFill) return;
      progressWrap.classList.remove('hidden');
      progressWrap.setAttribute('aria-valuenow', String(Math.round(pct)));
      progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      if (progressText && label) progressText.textContent = label;
    };
    const hideProgress = () => {
      if (!progressWrap) return;
      progressWrap.classList.add('hidden');
      if (progressFill) progressFill.style.width = '0%';
    };

    const totalPages = () => files.reduce((sum, f) => sum + (Number(f.pageCount) || 0), 0);
    const totalBytes = () => files.reduce((sum, f) => sum + (f.file ? f.file.size : 0), 0);

    const scrollIntoViewSoon = (el, block) => {
      if (!el) return;
      requestAnimationFrame(() => setTimeout(() => {
        el.scrollIntoView({ behavior: reducedMotion.matches || phoneQuery.matches ? 'auto' : 'smooth', block });
      }, 60));
    };

    const updateSticky = () => {
      if (!sticky || !stickyBtn) return;
      const phone = phoneQuery.matches;
      let show = false;
      if (phone && hasResult) {
        stickyBtn.textContent = 'Download merged PDF';
        show = !downloadInView;
      } else {
        stickyBtn.textContent = 'Merge PDFs';
        show = phone && files.length >= 2 && !busy && !mergeInView;
      }
      sticky.classList.toggle('is-visible', show);
      sticky.setAttribute('aria-hidden', show ? 'false' : 'true');
      stickyBtn.tabIndex = show ? 0 : -1;
      body.classList.toggle('pm-sticky-on', show);
      if (show !== stickyShown) {
        stickyShown = show;
        // app.js re-measures the back-to-top button's clearance on scroll.
        window.dispatchEvent(new Event('scroll'));
      }
    };

    const syncUi = () => {
      const count = files.length;
      const pages = totalPages();
      if (fileCountEl) fileCountEl.textContent = plural(count, 'file');
      if (pageCountEl) pageCountEl.textContent = plural(pages, 'page');
      if (fileSizeEl) fileSizeEl.textContent = formatBytes(totalBytes());
      if (dropZone) dropZone.classList.toggle('hidden', count > 0);
      if (editorBlock) editorBlock.classList.toggle('hidden', count === 0);
      if (sortAlphaBtn) sortAlphaBtn.disabled = busy || count < 2;
      if (sortUploadBtn) sortUploadBtn.disabled = busy || count < 2;
      if (addMoreBtn) addMoreBtn.disabled = busy;
      if (removeAllBtn) removeAllBtn.disabled = busy;
      if (mergeButton) mergeButton.disabled = busy || count < 2;
      filePickers.forEach((p) => { p.disabled = busy; });
      if (fileGrid) {
        fileGrid.classList.toggle('is-locked', busy);
        fileGrid.inert = busy;
      }

      const step = hasResult ? 3 : busy ? 2 : count >= 2 ? 1 : 0;
      flowSteps.forEach((li, i) => {
        li.classList.toggle('is-done', i < step);
        li.classList.toggle('is-active', i === step);
        if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });

      if (statusEl) {
        if (hasResult) statusEl.textContent = 'Merged — your PDF is ready to download.';
        else if (busy && count > 0) statusEl.textContent = 'Working on it — your files stay on this device.';
        else if (count >= 2) statusEl.textContent = `${plural(count, 'file')} · ${plural(pages, 'page')} ready — arrange them, then merge.`;
        else if (count === 1) statusEl.textContent = 'Add 1 more file to merge.';
        else statusEl.textContent = 'Add two or more PDFs or images, arrange order, then merge.';
      }

      body.classList.toggle('pm-has-files', count > 0);
      body.classList.toggle('pm-ready-merge', count >= 2);
      body.classList.toggle('pm-has-result', hasResult);
      updateSticky();
    };

    const setBusy = (value, label) => {
      busy = value;
      if (loader) {
        loader.textContent = label || 'Reading files…';
        loader.classList.toggle('hidden', !value || !label);
      }
      syncUi();
    };

    const releaseMergedUrl = () => {
      if (mergedBlobUrl) {
        URL.revokeObjectURL(mergedBlobUrl);
        mergedBlobUrl = '';
      }
    };

    // Any change to the queue makes an earlier merge stale.
    const invalidateResult = () => {
      releaseMergedUrl();
      hideProgress();
      hasResult = false;
      if (resultPanel) resultPanel.classList.add('hidden');
      if (downloadBtn) downloadBtn.classList.add('hidden');
    };

    /* -------------------------------------------------------------- thumbnails */

    const thumbHtml = (entry) => {
      const rot = Number(entry.rotation) || 0;
      const src = entry.kind === 'image' ? entry.previewUrl : entry.thumbUrl;
      if (src) return `<img src="${esc(src)}" alt="" style="transform:rotate(${rot}deg)" />`;
      return ICON.doc;
    };

    const paintThumb = (entry) => {
      if (!fileGrid) return;
      const card = fileGrid.querySelector(`[data-id="${entry.id}"]`);
      const box = card && card.querySelector('[data-thumb]');
      if (!box) return;
      box.innerHTML = thumbHtml(entry);
      box.classList.toggle('is-loading', entry.kind === 'pdf' && !entry.thumbUrl && !entry.thumbFailed);
    };

    const renderThumb = async (entry) => {
      const data = new Uint8Array(await entry.file.arrayBuffer());
      const task = await openPdf(data);
      try {
        const doc = await task.promise;
        const pdfPage = await doc.getPage(1);
        const unit = pdfPage.getViewport({ scale: 1 });
        const scale = 112 / Math.max(unit.width, unit.height); // 2x the 56px box
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        entry.thumbUrl = canvas.toDataURL('image/jpeg', 0.82);
      } finally {
        task.destroy();
      }
    };

    const thumbQueue = [];
    let thumbsRunning = false;
    const pumpThumbs = async () => {
      if (thumbsRunning) return;
      thumbsRunning = true;
      while (thumbQueue.length) {
        const entry = thumbQueue.shift();
        if (!files.includes(entry)) continue;
        try {
          await renderThumb(entry);
        } catch {
          entry.thumbFailed = true;
        }
        paintThumb(entry);
      }
      thumbsRunning = false;
    };
    const queueThumb = (entry) => {
      if (entry.kind !== 'pdf' || entry.file.size > THUMB_MAX_BYTES) {
        entry.thumbFailed = entry.kind === 'pdf';
        return;
      }
      thumbQueue.push(entry);
      pumpThumbs();
    };

    /* -------------------------------------------------------------------- grid */

    const renderGrid = (focus) => {
      if (!fileGrid) return;
      fileGrid.innerHTML = '';
      const last = files.length - 1;
      files.forEach((entry, index) => {
        const name = esc(entry.file.name);
        const card = document.createElement('div');
        card.className = 'pm-file-card';
        card.setAttribute('role', 'listitem');
        card.draggable = true;
        card.dataset.id = entry.id;
        card.style.setProperty('--tab', `var(--pm-tab-${(entry.uploadOrder - 1) % TAB_COLOURS})`);
        const pagesLabel = entry.kind === 'image' ? '1 page' : plural(entry.pageCount, 'page');
        const rotLabel = entry.rotation ? ` · ↻ ${entry.rotation}°` : '';
        const loading = entry.kind === 'pdf' && !entry.thumbUrl && !entry.thumbFailed;
        card.innerHTML = `
          <span class="pm-order-badge" title="Position ${index + 1}">${index + 1}<i aria-hidden="true"></i></span>
          <div class="pm-thumb${loading ? ' is-loading' : ''}" data-thumb aria-hidden="true">${thumbHtml(entry)}</div>
          <div class="pm-file-meta">
            <p class="pm-file-name" title="${name}">${name}</p>
            <p class="pm-file-details"><span class="pm-file-kind">${kindLabel(entry.file)}</span>${formatBytes(entry.file.size)} · ${pagesLabel}${rotLabel}</p>
          </div>
          <div class="pm-file-actions">
            <button type="button" class="pm-icon-btn" data-move-up="${entry.id}" aria-label="Move up ${name}" title="Move up"${index === 0 ? ' disabled' : ''}>${ICON.up}<span class="pm-act-lbl">Up</span></button>
            <button type="button" class="pm-icon-btn" data-move-down="${entry.id}" aria-label="Move down ${name}" title="Move down"${index === last ? ' disabled' : ''}>${ICON.down}<span class="pm-act-lbl">Down</span></button>
            <button type="button" class="pm-icon-btn" data-preview="${entry.id}" aria-label="Preview ${name}" title="Preview">${ICON.view}<span class="pm-act-lbl">View</span></button>
            <button type="button" class="pm-icon-btn" data-rotate="${entry.id}" aria-label="Rotate ${name} 90 degrees" title="Rotate 90°">${ICON.rotate}<span class="pm-act-lbl">Turn</span></button>
            <button type="button" class="pm-icon-btn pm-remove" data-remove="${entry.id}" aria-label="Remove ${name}" title="Remove">${ICON.remove}<span class="pm-act-lbl">Drop</span></button>
          </div>`;
        fileGrid.appendChild(card);
      });

      // Keep the keyboard where it was after a move re-renders the list.
      if (focus) {
        const card = fileGrid.querySelector(`[data-id="${focus.id}"]`);
        const btn = card && (card.querySelector(`[${focus.attr}]:not(:disabled)`) || card.querySelector('[data-move-up]:not(:disabled), [data-move-down]:not(:disabled)'));
        if (btn) btn.focus();
      }
    };

    const findEntry = (id) => files.find((f) => f.id === id);

    /* --------------------------------------------------------------- add files */

    const countPdfPages = async (file) => {
      const PDFLib = await waitForPdfLib();
      const bytes = await file.arrayBuffer();
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      if (doc.isEncrypted) throw new Error(`"${file.name}" is password-protected. Unlock it first.`);
      return Number(doc.getPageCount()) || 0;
    };

    const addFiles = async (incoming) => {
      const list = incoming ? Array.from(incoming) : [];
      if (!list.length) return;
      const wasEmpty = files.length === 0;
      const problems = [];
      let added = 0;

      for (const file of list) {
        const isPdf = looksLikePdf(file);
        const isImage = !isPdf && looksLikeImage(file);
        if (!isPdf && !isImage) {
          problems.push(`"${file.name}" is not a PDF, JPG, PNG or WEBP file.`);
          continue;
        }
        if (files.some((f) => f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified)) {
          problems.push(`"${file.name}" is already in the list.`);
          continue;
        }
        const entry = {
          id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          file,
          kind: isImage ? 'image' : 'pdf',
          pageCount: 1,
          uploadOrder: 0,
          rotation: 0,
        };
        if (isImage) {
          entry.previewUrl = URL.createObjectURL(file);
        } else {
          try {
            entry.pageCount = await countPdfPages(file);
          } catch (err) {
            problems.push(err && /password/.test(err.message) ? err.message : `"${file.name}" could not be read as a PDF.`);
            continue;
          }
          if (entry.pageCount < 1) {
            problems.push(`"${file.name}" has no pages.`);
            continue;
          }
        }
        uploadCounter += 1;
        entry.uploadOrder = uploadCounter;
        files.push(entry);
        queueThumb(entry);
        added += 1;
      }

      if (added) {
        invalidateResult();
        renderGrid();
      }
      if (problems.length) {
        setMessage(problems.length === 1 ? problems[0] : `${problems[0]} (+${problems.length - 1} more skipped)`, 'error');
      } else if (added && (files.some((f) => f.file.size > SOFT_FILE_SIZE) || totalBytes() > SOFT_TOTAL_SIZE)) {
        setMessage('Large files: merging more than about 150 MB can run out of memory on phones and older computers. Close other tabs if it stalls.', 'warn');
      } else if (added) {
        clearMessage();
      }
      syncUi();
      if (added && wasEmpty && phoneQuery.matches) scrollIntoViewSoon(editorBlock, 'start');
    };

    const withReading = async (list) => {
      if (busy || !list || !list.length) return;
      setBusy(true, 'Reading files…');
      try {
        await addFiles(list);
      } finally {
        setBusy(false);
      }
    };

    /* ------------------------------------------------------------ edit queue */

    const removeFile = (id) => {
      const idx = files.findIndex((f) => f.id === id);
      if (idx === -1) return;
      const [removed] = files.splice(idx, 1);
      if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      if (previewState.fileId === id) closePreview();
      invalidateResult();
      clearMessage();
      renderGrid();
      syncUi();
      if (!files.length && dropZone) dropZone.focus({ preventScroll: true });
    };

    const moveFile = (id, direction) => {
      const idx = files.findIndex((f) => f.id === id);
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (idx === -1 || target < 0 || target >= files.length) return;
      [files[idx], files[target]] = [files[target], files[idx]];
      invalidateResult();
      renderGrid({ id, attr: direction === 'up' ? 'data-move-up' : 'data-move-down' });
      syncUi();
    };

    const rotateFile = (id) => {
      const entry = findEntry(id);
      if (!entry) return;
      entry.rotation = ((Number(entry.rotation) || 0) + 90) % 360;
      invalidateResult();
      renderGrid({ id, attr: 'data-rotate' });
      syncUi();
      if (previewModal && !previewModal.classList.contains('hidden') && previewState.fileId === id) renderPreviewPage();
    };

    const sortAlpha = () => {
      files.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { sensitivity: 'base', numeric: true }));
      invalidateResult();
      renderGrid();
      syncUi();
    };

    const sortUpload = () => {
      files.sort((a, b) => a.uploadOrder - b.uploadOrder);
      invalidateResult();
      renderGrid();
      syncUi();
    };

    const clearQueue = () => {
      files.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
      files.length = 0;
      thumbQueue.length = 0;
      closePreview();
      invalidateResult();
      clearMessage();
      renderGrid();
    };

    const removeAll = () => {
      clearQueue();
      syncUi();
      if (dropZone) dropZone.focus({ preventScroll: true });
    };

    const resetAll = () => {
      clearQueue();
      uploadCounter = 0;
      if (fileInput) fileInput.value = '';
      if (outputNameInput) outputNameInput.value = '';
      syncUi();
      scrollIntoViewSoon(page, 'start');
    };

    /* ----------------------------------------------------- drag to reorder */

    const clearDropMarks = () => {
      if (!fileGrid) return;
      fileGrid.querySelectorAll('.is-drop-before, .is-drop-after').forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after'));
    };

    if (fileGrid) {
      fileGrid.addEventListener('dragstart', (e) => {
        const card = e.target.closest && e.target.closest('.pm-file-card');
        if (!card || busy) return;
        dragFromId = card.dataset.id;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox will not start a drag without data.
        try { e.dataTransfer.setData('text/plain', findEntry(dragFromId)?.file.name || ''); } catch { /* ignore */ }
      });
      fileGrid.addEventListener('dragend', () => {
        fileGrid.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
        clearDropMarks();
        dragFromId = null;
      });
      fileGrid.addEventListener('dragover', (e) => {
        if (!dragFromId) return;
        const card = e.target.closest('.pm-file-card');
        if (!card) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearDropMarks();
        if (card.dataset.id === dragFromId) return;
        const r = card.getBoundingClientRect();
        card.classList.add(e.clientY > r.top + r.height / 2 ? 'is-drop-after' : 'is-drop-before');
      });
      fileGrid.addEventListener('drop', (e) => {
        if (!dragFromId) return;
        e.preventDefault();
        e.stopPropagation();
        const card = e.target.closest('.pm-file-card');
        const after = card && card.classList.contains('is-drop-after');
        const movedId = dragFromId;
        // renderGrid() below replaces the dragged card, so its dragend fires on a
        // detached node and never reaches the grid; reset the drag here instead.
        dragFromId = null;
        clearDropMarks();
        if (!card || card.dataset.id === movedId) return;
        const from = files.findIndex((f) => f.id === movedId);
        let to = files.findIndex((f) => f.id === card.dataset.id) + (after ? 1 : 0);
        if (from === -1 || to < 0) return;
        const [moved] = files.splice(from, 1);
        if (from < to) to -= 1;
        files.splice(to, 0, moved);
        invalidateResult();
        renderGrid();
        syncUi();
      });
    }

    /* ----------------------------------------------------------------- preview */

    const previewState = { fileId: null, pageNum: 1, totalPages: 1, gen: 0, docId: null, docPromise: null, task: null, renderTask: null, returnFocus: null };

    const dropPreviewDoc = () => {
      if (previewState.renderTask) { try { previewState.renderTask.cancel(); } catch { /* ignore */ } }
      if (previewState.task) previewState.task.destroy();
      previewState.renderTask = null;
      previewState.task = null;
      previewState.docPromise = null;
      previewState.docId = null;
    };

    // One parsed document per previewed file, reused while paging through it.
    const previewDoc = (entry) => {
      if (previewState.docId === entry.id && previewState.docPromise) return previewState.docPromise;
      dropPreviewDoc();
      previewState.docId = entry.id;
      const promise = (async () => {
        const data = new Uint8Array(await entry.file.arrayBuffer());
        await loadPdfJs();
        if (previewState.docPromise !== promise) {
          const stale = new Error('Preview closed');
          stale.name = 'RenderingCancelledException';
          throw stale;
        }
        const task = await openPdf(data);
        previewState.task = task;
        return task.promise;
      })();
      previewState.docPromise = promise;
      return promise;
    };

    const updatePreviewNav = () => {
      const total = previewState.totalPages || 1;
      const num = previewState.pageNum || 1;
      if (previewPageLabel) previewPageLabel.textContent = `Page ${num} of ${total}`;
      if (previewNav) previewNav.classList.toggle('hidden', total <= 1);
      if (previewPrev) previewPrev.disabled = num <= 1;
      if (previewNext) previewNext.disabled = num >= total;
    };

    const drawUnavailable = (ctx, err) => {
      const text = err && /Could not load/.test(err.message || '')
        ? 'Preview needs one online page load - reload and try again'
        : 'Preview unavailable for this file';
      previewCanvas.width = 480;
      previewCanvas.height = 60;
      previewCanvas.style.width = '';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 480, 60);
      ctx.fillStyle = '#5f6b7d';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(text, 16, 36);
    };

    const renderPreviewPage = async () => {
      const entry = findEntry(previewState.fileId);
      if (!entry || !previewCanvas) return;
      const gen = ++previewState.gen;
      const rot = Number(entry.rotation) || 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = 480;
      if (previewTitle) previewTitle.textContent = rot ? `${entry.file.name} (rotated ${rot}°)` : entry.file.name;
      previewCanvas.setAttribute('aria-label', `Page ${previewState.pageNum} of ${previewState.totalPages} of ${entry.file.name}`);
      updatePreviewNav();
      const ctx = previewCanvas.getContext('2d');
      if (!ctx) return;

      if (entry.kind === 'image') {
        try {
          const bitmap = await blobToBitmap(entry.file);
          if (gen !== previewState.gen) return;
          const srcW = bitmap.width || bitmap.naturalWidth;
          const srcH = bitmap.height || bitmap.naturalHeight;
          const swap = rot === 90 || rot === 270;
          const outW = swap ? srcH : srcW;
          const outH = swap ? srcW : srcH;
          const scale = (cssWidth / outW) * dpr;
          previewCanvas.width = Math.round(outW * scale);
          previewCanvas.height = Math.round(outH * scale);
          previewCanvas.style.width = `${cssWidth}px`;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
          ctx.translate(previewCanvas.width / 2, previewCanvas.height / 2);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.scale(scale, scale);
          ctx.drawImage(bitmap, -srcW / 2, -srcH / 2);
          if (typeof bitmap.close === 'function') bitmap.close();
        } catch {
          if (gen === previewState.gen) drawUnavailable(ctx);
        }
        return;
      }

      try {
        const doc = await previewDoc(entry);
        if (gen !== previewState.gen) return;
        const pdfPage = await doc.getPage(previewState.pageNum);
        if (gen !== previewState.gen) return;
        const totalRot = (((Number(pdfPage.rotate) || 0) + rot) % 360 + 360) % 360;
        const unit = pdfPage.getViewport({ scale: 1, rotation: totalRot });
        const viewport = pdfPage.getViewport({ scale: (cssWidth / unit.width) * dpr, rotation: totalRot });
        if (previewState.renderTask) { try { previewState.renderTask.cancel(); } catch { /* ignore */ } }
        previewCanvas.width = Math.round(viewport.width);
        previewCanvas.height = Math.round(viewport.height);
        previewCanvas.style.width = `${cssWidth}px`;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
        const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        previewState.renderTask = renderTask;
        await renderTask.promise;
        if (previewState.renderTask === renderTask) previewState.renderTask = null;
      } catch (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        if (gen === previewState.gen) drawUnavailable(ctx, err);
      }
    };

    const openPreview = (id, trigger) => {
      const entry = findEntry(id);
      if (!entry || !previewModal) return;
      previewState.fileId = id;
      previewState.pageNum = 1;
      previewState.totalPages = Math.max(1, Number(entry.pageCount) || 1);
      previewState.returnFocus = trigger || null;
      previewModal.classList.remove('hidden');
      previewModal.setAttribute('aria-hidden', 'false');
      if (previewClose) previewClose.focus();
      renderPreviewPage();
    };

    const goPreviewPage = (delta) => {
      const next = previewState.pageNum + delta;
      if (next < 1 || next > previewState.totalPages) return;
      previewState.pageNum = next;
      renderPreviewPage();
    };

    function closePreview() {
      if (!previewModal || previewModal.classList.contains('hidden')) return;
      previewState.gen += 1;
      previewState.fileId = null;
      dropPreviewDoc();
      previewModal.classList.add('hidden');
      previewModal.setAttribute('aria-hidden', 'true');
      const back = previewState.returnFocus;
      previewState.returnFocus = null;
      if (back && back.isConnected) back.focus();
    }

    /* ------------------------------------------------------------------- merge */

    const getOutputName = () => {
      const raw = (outputNameInput ? outputNameInput.value : '').trim().replace(/\.pdf$/i, '');
      const clean = raw
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
        .replace(/\s+/g, '-')
        .replace(/^[.\-]+/, '')
        .slice(0, 120);
      return `${clean || 'merged-document'}.pdf`;
    };

    const mergePdfs = async () => {
      if (busy) return;
      if (files.length < 2) {
        setMessage('Add at least two files (PDF, JPG, PNG, or WEBP) to combine.', 'error');
        return;
      }
      /* Snapshot so nothing that happens during the async merge can shift indices mid-loop. */
      const queue = files.slice();
      const pagesTotal = queue.reduce((sum, f) => sum + (Number(f.pageCount) || 0), 0);

      invalidateResult();
      clearMessage();
      setBusy(true);
      setProgress(0, 'Starting merge…');
      if (phoneQuery.matches) scrollIntoViewSoon(progressWrap, 'center');

      try {
        const PDFLib = await waitForPdfLib();
        const merged = await PDFLib.PDFDocument.create();
        let done = 0;

        for (let i = 0; i < queue.length; i += 1) {
          const entry = queue[i];
          setProgress((i / queue.length) * 85, `Merging file ${i + 1} of ${queue.length}…`);

          if (entry.kind === 'image') {
            let raster;
            try {
              raster = await rasterizeImage(entry.file, entry.rotation);
            } catch {
              throw new Error(`"${entry.file.name}" could not be read as an image.`);
            }
            const embedded = raster.mime === 'image/png' ? await merged.embedPng(raster.bytes) : await merged.embedJpg(raster.bytes);
            const dims = imagePageDims(raster.width || embedded.width, raster.height || embedded.height);
            const imgPage = merged.addPage([dims.width, dims.height]);
            imgPage.drawImage(embedded, { x: 0, y: 0, width: dims.width, height: dims.height });
            done += 1;
            setProgress(85 + (done / pagesTotal) * 10, `Adding page ${done} of ${pagesTotal}…`);
            continue;
          }

          const bytes = await entry.file.arrayBuffer();
          if (!bytes || !bytes.byteLength) throw new Error(`"${entry.file.name}" could not be read.`);
          let src;
          try {
            src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
          } catch {
            throw new Error(`"${entry.file.name}" is not a valid PDF or is password-protected.`);
          }
          if (src.isEncrypted) throw new Error(`"${entry.file.name}" is password-protected. Unlock it first.`);
          const indices = src.getPageIndices();
          if (!indices.length) throw new Error(`"${entry.file.name}" has no pages.`);
          const copied = await merged.copyPages(src, indices);
          for (const pg of copied) {
            if (entry.rotation && PDFLib.degrees) {
              try {
                const current = pg.getRotation();
                const angle = current && typeof current.angle === 'number' ? current.angle : 0;
                pg.setRotation(PDFLib.degrees((angle + entry.rotation) % 360));
              } catch { /* leave this page as it is */ }
            }
            merged.addPage(pg);
            done += 1;
            setProgress(85 + (done / pagesTotal) * 10, `Adding page ${done} of ${pagesTotal}…`);
          }
        }

        setProgress(96, 'Saving merged PDF…');
        const saved = await merged.save();
        if (!saved || !saved.byteLength) throw new Error('Merge produced an empty file.');

        releaseMergedUrl();
        mergedBlobUrl = URL.createObjectURL(new Blob([saved], { type: 'application/pdf' }));
        const outName = getOutputName();
        if (downloadBtn) {
          downloadBtn.href = mergedBlobUrl;
          downloadBtn.download = outName;
          downloadBtn.classList.remove('hidden');
        }
        if (resultFileName) resultFileName.textContent = outName;
        if (resultFileSize) resultFileSize.textContent = formatBytes(saved.byteLength);
        if (resultPageCount) resultPageCount.textContent = String(done);
        if (resultPanel) resultPanel.classList.remove('hidden');
        hasResult = true;
        setProgress(100, 'Done!');
        setMessage(`Merged ${plural(queue.length, 'file')} into one PDF (${plural(done, 'page')}).`, 'success');
        scrollIntoViewSoon(resultPanel, phoneQuery.matches ? 'start' : 'nearest');
      } catch (err) {
        console.error(err);
        hideProgress();
        const msg = err && err.message ? err.message : 'Unable to merge PDFs.';
        setMessage(/null|undefined/.test(msg) ? 'Unable to merge the files. Check they are valid, unlocked PDFs or supported images.' : msg, 'error');
      } finally {
        setBusy(false);
      }
    };

    const triggerDownload = () => {
      if (!mergedBlobUrl) return;
      const a = document.createElement('a');
      a.href = mergedBlobUrl;
      a.download = (downloadBtn && downloadBtn.download) || getOutputName();
      document.body.appendChild(a);
      a.click();
      a.remove();
    };

    /* ------------------------------------------------------------------ events */

    const openFilePicker = () => { if (fileInput && !busy) fileInput.click(); };

    filePickers.forEach((picker) => picker.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFilePicker();
    }));
    addMoreBtn?.addEventListener('click', openFilePicker);
    removeAllBtn?.addEventListener('click', removeAll);
    sortAlphaBtn?.addEventListener('click', sortAlpha);
    sortUploadBtn?.addEventListener('click', sortUpload);
    mergeButton?.addEventListener('click', mergePdfs);
    mergeAnotherBtn?.addEventListener('click', resetAll);
    downloadBtn?.addEventListener('click', (e) => { e.preventDefault(); triggerDownload(); });
    // Renaming after a merge only changes the download name; the file is the same.
    outputNameInput?.addEventListener('input', () => {
      if (!hasResult) return;
      const name = getOutputName();
      if (downloadBtn) downloadBtn.download = name;
      if (resultFileName) resultFileName.textContent = name;
    });
    outputNameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mergePdfs(); } });

    fileInput?.addEventListener('change', async () => {
      const picked = Array.from(fileInput.files || []);
      fileInput.value = '';
      await withReading(picked);
    });

    dropZone?.addEventListener('click', (e) => { if (!e.target.closest('button')) openFilePicker(); });
    dropZone?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
    });

    // Files can be dropped anywhere on the tool, not only on the empty-state zone.
    const carriesFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    page.addEventListener('dragover', (e) => {
      if (!carriesFiles(e) || dragFromId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      page.classList.add('is-file-over');
      if (dropZone) dropZone.classList.add('active');
    });
    page.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && page.contains(e.relatedTarget)) return;
      page.classList.remove('is-file-over');
      if (dropZone) dropZone.classList.remove('active');
    });
    page.addEventListener('drop', (e) => {
      if (!carriesFiles(e) || dragFromId) return;
      e.preventDefault();
      page.classList.remove('is-file-over');
      if (dropZone) dropZone.classList.remove('active');
      withReading(Array.from(e.dataTransfer.files || []));
    });
    // A file dropped just outside the tool should not make the browser leave the page.
    ['dragover', 'drop'].forEach((type) => document.addEventListener(type, (e) => {
      if (carriesFiles(e) && !page.contains(e.target)) e.preventDefault();
    }));

    fileGrid?.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || busy) return;
      if (btn.hasAttribute('data-remove')) removeFile(btn.getAttribute('data-remove'));
      else if (btn.hasAttribute('data-move-up')) moveFile(btn.getAttribute('data-move-up'), 'up');
      else if (btn.hasAttribute('data-move-down')) moveFile(btn.getAttribute('data-move-down'), 'down');
      else if (btn.hasAttribute('data-rotate')) rotateFile(btn.getAttribute('data-rotate'));
      else if (btn.hasAttribute('data-preview')) openPreview(btn.getAttribute('data-preview'), btn);
    });

    previewClose?.addEventListener('click', closePreview);
    previewPrev?.addEventListener('click', () => goPreviewPage(-1));
    previewNext?.addEventListener('click', () => goPreviewPage(1));
    previewModal?.addEventListener('click', (e) => { if (e.target === previewModal) closePreview(); });
    document.addEventListener('keydown', (e) => {
      if (!previewModal || previewModal.classList.contains('hidden')) return;
      if (e.key === 'Escape') { closePreview(); return; }
      if (e.key === 'ArrowLeft') { goPreviewPage(-1); return; }
      if (e.key === 'ArrowRight') { goPreviewPage(1); return; }
      if (e.key === 'Tab') {
        const focusable = Array.from(previewModal.querySelectorAll('button:not(:disabled)')).filter((b) => b.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const lastBtn = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastBtn.focus(); }
        else if (!e.shiftKey && document.activeElement === lastBtn) { e.preventDefault(); first.focus(); }
      }
    });

    stickyBtn?.addEventListener('click', () => {
      if (hasResult) { triggerDownload(); return; }
      if (files.length < 2) openFilePicker();
      else mergePdfs();
    });

    // "Add PDF files" / "Merge PDF files" links: bring the tool up, and with an
    // empty queue open the file picker straight away.
    document.querySelectorAll('a[href="#pm-tool"]').forEach((link) => link.addEventListener('click', (e) => {
      e.preventDefault();
      page.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      if (!files.length) openFilePicker();
    }));

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target === mergeButton) mergeInView = entry.isIntersecting;
          if (entry.target === downloadBtn) downloadInView = entry.isIntersecting;
        });
        updateSticky();
      });
      if (mergeButton) io.observe(mergeButton);
      if (downloadBtn) io.observe(downloadBtn);
    }
    const onPhoneChange = () => updateSticky();
    if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', onPhoneChange);
    else if (phoneQuery.addListener) phoneQuery.addListener(onPhoneChange);

    // Get pdf.js ready before it is needed: once the page has finished loading and
    // gone idle, so a visitor who goes offline afterwards can still preview, and
    // at the first sign of use. Save-Data visitors only get it on use.
    const warmPdfJs = () => { loadPdfJs().catch(() => {}); };
    ['pointerenter', 'focusin', 'touchstart', 'dragenter'].forEach((type) => {
      page.addEventListener(type, warmPdfJs, { once: true, passive: true });
    });
    if (!(navigator.connection && navigator.connection.saveData)) {
      const whenIdle = () => {
        if (window.requestIdleCallback) window.requestIdleCallback(warmPdfJs, { timeout: 4000 });
        else setTimeout(warmPdfJs, 1500);
      };
      if (document.readyState === 'complete') whenIdle();
      else window.addEventListener('load', whenIdle, { once: true });
    }

    renderGrid();
    syncUi();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
