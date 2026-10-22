document.addEventListener('DOMContentLoaded', () => {
  const page = document.querySelector('[data-images-to-pdf-page]');
  if (!page) return;

  const fileInput = page.querySelector('[data-file-input]');
  const filePickers = Array.from(page.querySelectorAll('[data-file-picker]'));
  const cameraInput = page.querySelector('[data-camera-input]');
  const cameraPickers = Array.from(page.querySelectorAll('[data-camera-picker]'));
  const urlToggle = page.querySelector('[data-url-toggle]');
  const urlRow = page.querySelector('[data-url-row]');
  const urlInput = page.querySelector('[data-url-input]');
  const urlAddBtn = page.querySelector('[data-url-add]');
  const urlControls = [urlToggle, urlAddBtn, urlInput].filter(Boolean);
  const dropZone = page.querySelector('[data-drop-zone]');
  const imageGrid = page.querySelector('[data-image-grid]');
  const emptyState = page.querySelector('[data-empty-state]');
  const imageCount = page.querySelector('[data-image-count]');
  const imageSize = page.querySelector('[data-image-size]');
  const convertButton = page.querySelector('[data-convert-btn]');
  const downloadLinks = Array.from(page.querySelectorAll('[data-download-link]'));
  const convertAnotherBtn = page.querySelector('[data-convert-another]');
  const resultPanel = page.querySelector('[data-result-panel]');
  const resultTitle = page.querySelector('[data-result-title]');
  const resultMeta = page.querySelector('[data-result-meta]');
  const previewWrap = page.querySelector('[data-preview]');
  const previewRail = page.querySelector('[data-preview-rail]');
  const previewNote = page.querySelector('[data-preview-note]');
  const shareBtn = page.querySelector('[data-share-btn]');
  const progressWrap = page.querySelector('[data-progress-wrap]');
  const progressFill = page.querySelector('[data-progress-fill]');
  const progressText = page.querySelector('[data-progress-text]');
  const messageBox = page.querySelector('[data-message]');
  const loader = page.querySelector('[data-loader]');
  const pageSizeSelect = page.querySelector('[data-page-size]');
  const orientationSelect = page.querySelector('[data-orientation]');
  const fitModeSelect = page.querySelector('[data-fit-mode]');
  const marginSelect = page.querySelector('[data-margin]');
  const qualitySelect = page.querySelector('[data-quality]');
  const outputModeSelect = page.querySelector('[data-output-mode]');
  const fileNameInput = page.querySelector('[data-file-name]');
  const clearAllBtn = page.querySelector('[data-clear-all]');
  const flowSteps = Array.from(page.querySelectorAll('[data-itp-flow]'));
  const stickyCta = document.querySelector('[data-sticky-convert-cta]');
  const stickyBar = stickyCta ? stickyCta.closest('.itp-sticky-cta') : null;
  const phoneQuery = window.matchMedia('(max-width: 768px)');
  const settingControls = [pageSizeSelect, orientationSelect, fitModeSelect, marginSelect, qualitySelect, outputModeSelect, fileNameInput].filter(Boolean);

  const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  const ICONS = {
    add: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
    convert: ICON('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M12 11l3 3-3 3"/>'),
    download: ICON('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  };

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const images = [];
  let pdfBlobUrl = '';
  // Kept alongside the blob URL so the sticky bar can label itself without
  // reading the download anchor back out of the DOM.
  let pdfDownloadName = '';
  let heic2anyPromise = null;
  let jsZipPromise = null;
  let dragFromIndex = null;
  let shareFile = null;
  let busy = false;
  // What the phone bar stands in for is only worth showing while that control
  // is off screen; these track it.
  const inView = { tool: true, convert: false, download: false };

  /* Preview thumbnails are generated during the conversion pass, so they cost
     one extra downscale per page. Capped because the cost is real on a fifty
     photo batch and nobody scrolls a rail that long — beyond the cap the rail
     says how many pages it is not showing. */
  const PREVIEW_MAX_PAGES = 24;
  const PREVIEW_THUMB_PX = 260;

  const PAGE_SIZES = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 },
    legal: { width: 612, height: 1008 },
  };

  const MM_TO_PT = 72 / 25.4;

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const loadHeic2any = async () => {
    if (window.heic2any) return window.heic2any;
    if (!heic2anyPromise) {
      heic2anyPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
        s.onload = () => resolve(window.heic2any);
        s.onerror = () => reject(new Error('Could not load HEIC converter.'));
        document.head.appendChild(s);
      });
    }
    return heic2anyPromise;
  };

  const loadJSZip = async () => {
    if (window.JSZip) return window.JSZip;
    if (!jsZipPromise) {
      jsZipPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'assets/js/jszip.min.js';
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => reject(new Error('Could not load ZIP library.'));
        document.head.appendChild(s);
      });
    }
    return jsZipPromise;
  };

  const setMessage = (text, type = 'success') => {
    messageBox.textContent = text;
    messageBox.className = `itp-message ${type}`;
    messageBox.classList.remove('hidden');
    messageBox.setAttribute('role', type === 'error' ? 'alert' : 'status');
  };

  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.className = 'itp-message hidden';
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

  /* The sticky bar is the only control most phone visitors ever see — it floats
     over four thousand words of copy, so its label has to name what the tap will
     actually do. A permanent "Convert to PDF" was wrong in two of the three
     states: on an empty grid it opened the file picker, and after a successful
     conversion it re-ran a conversion whose result was already sitting on the
     page. */
  const syncStickyCta = () => {
    if (!stickyCta) return;
    let action = 'add';
    let label = `${ICONS.add}Add images`;
    let show = !inView.tool;
    if (pdfBlobUrl) {
      action = 'download';
      label = `${ICONS.download}${pdfDownloadName.endsWith('.zip') ? 'Download ZIP' : 'Download PDF'}`;
      show = !inView.download;
    } else if (images.length) {
      action = 'convert';
      label = `${ICONS.convert}Convert ${images.length} image${images.length === 1 ? '' : 's'} to PDF`;
      show = !inView.convert;
    }
    // Hidden while a job runs: the progress lives in the tool, and a second
    // tap on a bar that has nothing to do yet would only look broken.
    show = show && phoneQuery.matches && !busy;
    stickyCta.dataset.action = action;
    if (stickyCta.innerHTML !== label) stickyCta.innerHTML = label;
    if (!stickyBar) return;
    stickyBar.classList.toggle('is-visible', show);
    stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    stickyCta.tabIndex = show ? 0 : -1;
    const was = document.body.classList.contains('itp-sticky-on');
    document.body.classList.toggle('itp-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  };

  const toggleLoader = (visible) => {
    busy = visible;
    page.classList.toggle('is-busy', visible);
    loader.classList.toggle('hidden', !visible);
    convertButton.disabled = visible;
    filePickers.forEach((p) => { p.disabled = visible; });
    cameraPickers.forEach((p) => { p.disabled = visible; });
    urlControls.forEach((c) => { c.disabled = visible; });
    // Settings are read once when a conversion starts; changing them halfway
    // through would leave a result that no longer matches what they say.
    settingControls.forEach((c) => { c.disabled = visible; });
    if (clearAllBtn) clearAllBtn.disabled = visible;
    syncStickyCta();
  };

  /* The four step chips follow the job: add, then arrange and set options
     (one phase, both at once), then preview and download. */
  const updateFlow = () => {
    const phase = pdfBlobUrl ? 3 : images.length ? 1 : 0;
    flowSteps.forEach((li, i) => {
      const active = phase === 1 ? (i === 1 || i === 2) : i === phase;
      li.classList.toggle('is-active', active);
      li.classList.toggle('is-done', i < phase || (phase === 3 && i === 3));
      if (i === (phase === 1 ? 1 : phase)) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
  };

  const hideDownload = () => {
    downloadLinks.forEach((link) => {
      link.classList.add('hidden');
      link.removeAttribute('href');
    });
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      pdfBlobUrl = '';
    }
    pdfDownloadName = '';
    if (resultPanel) resultPanel.classList.add('hidden');
    if (resultMeta) resultMeta.textContent = '';
    if (previewWrap) previewWrap.classList.add('hidden');
    if (previewRail) previewRail.innerHTML = '';
    if (shareBtn) shareBtn.classList.add('hidden');
    shareFile = null;
    updateFlow();
    syncStickyCta();
  };

  /* Editing the image set or the page settings makes an already-generated PDF
     stale, so the result is withdrawn rather than left offering a download that
     no longer matches the grid — and the sticky bar drops back to "Convert". */
  const invalidateResult = () => {
    if (!pdfBlobUrl) return;
    hideDownload();
    hideProgress();
    clearMessage();
  };

  const updateSummary = () => {
    const totalBytes = images.reduce((sum, img) => sum + (img.displaySize ?? img.file.size), 0);
    if (imageCount) imageCount.textContent = `${images.length} ${images.length === 1 ? 'image' : 'images'}`;
    if (imageSize) imageSize.textContent = formatSize(totalBytes);
    // The drop zone stays mounted for the whole session and only collapses to
    // a strip. Hiding it outright made drag-and-drop a one-shot affordance:
    // after the first batch there was nothing left to drop onto.
    if (dropZone) {
      const compact = images.length > 0;
      dropZone.classList.toggle('is-compact', compact);
      // The visible headline swaps in CSS; the accessible name has to be swapped
      // here or screen readers keep announcing the empty-zone invitation.
      dropZone.setAttribute('aria-label', compact
        ? 'Drag and drop more images, or click to browse'
        : 'Drag and drop images or click to browse');
    }
    if (emptyState) emptyState.classList.toggle('hidden', images.length > 0);
    // The toolbar, settings and Convert stay out of the way until there is
    // something to convert (see .has-images in the page CSS).
    page.classList.toggle('has-images', images.length > 0);
    updateFlow();
    syncStickyCta();
  };

  const isHeic = (file) => {
    const n = file.name.toLowerCase();
    return file.type === 'image/heic' || file.type === 'image/heif' || n.endsWith('.heic') || n.endsWith('.heif');
  };

  const isSupportedImage = (file) => {
    if (!file) return false;
    if (file.type.startsWith('image/')) return true;
    return /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name);
  };

  const createImageEntry = async (file) => {
    let displayFile = file;
    let previewUrl;

    if (isHeic(file)) {
      const heic2any = await loadHeic2any();
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      displayFile = new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
      previewUrl = URL.createObjectURL(blob);
    } else {
      previewUrl = URL.createObjectURL(file);
    }

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: displayFile,
      displayName: file.name,
      displaySize: file.size,
      previewUrl,
      rotation: 0,
    };
  };

  const addFiles = async (files) => {
    const all = Array.from(files || []);
    const list = all.filter(isSupportedImage);
    if (!list.length) {
      setMessage('Please choose JPG, PNG, WebP, or HEIC images.', 'error');
      return;
    }
    const skipped = all.length - list.length;
    // Only a real addition invalidates — a stray .txt on the drop zone should
    // not throw away a PDF the visitor has already generated.
    invalidateResult();

    const hasHeic = list.some(isHeic);
    if (hasHeic) {
      if (loader) loader.textContent = 'Loading HEIC preview…';
      toggleLoader(true);
    }

    let heicFailed = 0;
    for (const file of list) {
      try {
        images.push(await createImageEntry(file));
        updateSummary();
        renderGrid();
      } catch (err) {
        console.error(err);
        if (isHeic(file)) heicFailed += 1;
      }
    }

    if (hasHeic) {
      toggleLoader(false);
      if (loader) loader.textContent = 'Building PDF…';
    }

    if (heicFailed) {
      setMessage(`Could not load ${heicFailed} HEIC file(s) for preview. Try again or use the HEIC Converter first.`, 'error');
    } else if (skipped) {
      // A mixed drop used to lose its non-images without a word.
      setMessage(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'is not an image' : 'are not images'} — only JPG, PNG, WebP and HEIC are added.`, 'error');
    } else {
      clearMessage();
    }
  };

  /* Import by link.

     The request goes straight from the browser to whatever host the visitor
     named. No ToolAdda server sits anywhere in that path, so the promise this
     page makes about nothing being uploaded still holds exactly as written.

     The price of keeping that promise is CORS. A host that does not send
     Access-Control-Allow-Origin will refuse the read, and no code here can
     change that: the only workaround is relaying the image through a
     third-party proxy, which would mean the picture passing through someone
     else's server - the precise thing this tool exists to avoid. So a blocked
     fetch is reported plainly, and points at the route that does work.

     Cookies are omitted and the referrer suppressed. This is a fetch made on
     behalf of the visitor, and the host it lands on has no business learning
     who they are or which page they came from. */
  const URL_FETCH_TIMEOUT_MS = 20000;

  const fileNameFromUrl = (parsed, mime) => {
    const ext = (mime.split('/')[1] || 'jpg').split('+')[0].replace(/^jpeg$/, 'jpg');
    if (parsed.protocol === 'data:') return `image-from-url.${ext}`;
    const last = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    // A real filename is worth keeping: it labels the card, and in separate-PDF
    // mode it names a file inside the ZIP.
    if (/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(last)) return last;
    return `${last.replace(/[^a-zA-Z0-9-_]/g, '_') || 'image-from-url'}.${ext}`;
  };

  const addFromUrl = async () => {
    const raw = urlInput?.value.trim();
    if (!raw) {
      setMessage('Paste an image link first.', 'error');
      urlInput?.focus();
      return;
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      setMessage('That does not look like a link — include https:// at the start.', 'error');
      return;
    }
    if (!['http:', 'https:', 'data:'].includes(parsed.protocol)) {
      setMessage('Only http, https and data links can be imported.', 'error');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
    if (loader) loader.textContent = 'Fetching image…';
    toggleLoader(true);
    clearMessage();

    let fetched = null;
    try {
      const res = await fetch(raw, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!res.ok) throw new Error(`That link returned ${res.status}. Check that it still opens in a browser tab.`);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) {
        throw new Error('That link is not an image file. It has to point straight at the picture — a .jpg, .png, .webp or .heic — not at the page showing it.');
      }
      fetched = new File([blob], fileNameFromUrl(parsed, blob.type), { type: blob.type });
    } catch (err) {
      console.error(err);
      if (err.name === 'AbortError') {
        setMessage('That link took too long to answer. Save the image to your device and use Browse Images instead.', 'error');
      } else if (err instanceof TypeError) {
        // fetch() rejects with a bare TypeError for a network failure and for a
        // CORS refusal alike, and the spec deliberately hides which one it was,
        // so the message has to cover both honestly.
        setMessage('Could not load that image. Most sites block other pages from reading their images (CORS), and that block cannot be worked around here. Save the picture to your device and use Browse Images.', 'error');
      } else {
        setMessage(err.message || 'Could not load that image.', 'error');
      }
    } finally {
      clearTimeout(timer);
      toggleLoader(false);
      if (loader) loader.textContent = 'Building PDF…';
    }

    if (fetched) {
      await addFiles([fetched]);
      if (urlInput) urlInput.value = '';
    }
  };

  /* Every grid edit re-renders the cards, which throws away the button that
     had focus. A keyboard user pressing ↓ three times would be dropped back at
     the top of the page after the first press, so focus is put back on the
     same control of the same card (or the nearest sensible one). */
  const refocus = (selector) => {
    const el = imageGrid?.querySelector(selector);
    if (el && !el.disabled) { el.focus({ preventScroll: false }); return true; }
    return false;
  };

  const removeImage = (id) => {
    const idx = images.findIndex((img) => img.id === id);
    if (idx === -1) return;
    invalidateResult();
    const [removed] = images.splice(idx, 1);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    updateSummary();
    renderGrid();
    const next = images[idx] || images[idx - 1];
    if (!(next && refocus(`[data-remove="${next.id}"]`))) filePickers[filePickers.length - 1]?.focus();
  };

  const rotateImage = (id) => {
    const item = images.find((img) => img.id === id);
    if (!item) return;
    invalidateResult();
    item.rotation = (item.rotation + 90) % 360;
    renderGrid();
    refocus(`[data-rotate="${id}"]`);
  };

  const moveImage = (id, direction) => {
    const idx = images.findIndex((img) => img.id === id);
    if (idx === -1) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= images.length) return;
    invalidateResult();
    [images[idx], images[target]] = [images[target], images[idx]];
    renderGrid();
    // At either end the pressed arrow is now disabled; hand focus to the other.
    if (!refocus(`[data-move-${direction}="${id}"]`)) refocus(`[data-move-${direction === 'up' ? 'down' : 'up'}="${id}"]`);
  };

  const renderGrid = () => {
    if (!imageGrid) return;
    imageGrid.innerHTML = '';
    const last = images.length - 1;

    images.forEach((image, index) => {
      const card = document.createElement('article');
      card.className = 'itp-image-card';
      card.setAttribute('role', 'listitem');
      card.draggable = true;
      card.dataset.index = String(index);
      card.dataset.id = image.id;
      // File names reach this markup from the visitor's disk and, via From URL,
      // from any link pasted in — so they are escaped, never trusted as HTML.
      const name = escapeHtml(image.displayName || image.file.name);
      const size = image.displaySize ?? image.file.size;

      card.innerHTML = `
        <button type="button" class="itp-drag-handle" aria-label="Drag to reorder ${name}" title="Drag to reorder">⠿</button>
        <button type="button" class="itp-card-x itp-remove" data-remove="${image.id}" aria-label="Remove ${name}" title="Remove">✕</button>
        <div class="itp-thumb-wrap">
          <img src="${image.previewUrl}" alt="Preview of ${name}" class="itp-thumb" style="transform:rotate(${image.rotation}deg)" loading="lazy" />
          <span class="itp-page-num" aria-label="Page ${index + 1}">${index + 1}</span>
        </div>
        <div class="itp-card-meta">
          <p class="itp-card-name" title="${name}">${name}</p>
          <p class="itp-card-size">${formatSize(size)}</p>
        </div>
        <div class="itp-card-actions">
          <button type="button" class="itp-icon-btn" data-move-up="${image.id}" aria-label="Move ${name} earlier" title="Move earlier"${index === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="itp-icon-btn" data-move-down="${image.id}" aria-label="Move ${name} later" title="Move later"${index === last ? ' disabled' : ''}>↓</button>
          <button type="button" class="itp-icon-btn" data-rotate="${image.id}" aria-label="Rotate ${name} 90 degrees" title="Rotate">↻</button>
        </div>
      `;

      imageGrid.appendChild(card);
    });

    setupDragReorder();
  };

  const setupDragReorder = () => {
    if (!imageGrid) return;

    imageGrid.querySelectorAll('.itp-image-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        dragFromIndex = Number(card.dataset.index);
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        imageGrid.querySelectorAll('.is-drag-over').forEach((el) => el.classList.remove('is-drag-over'));
        dragFromIndex = null;
      });
      // Files dragged in from the desktop are the tool card's business (see the
      // page-level drop handler); these handlers only deal with reordering.
      card.addEventListener('dragover', (e) => {
        if (isFileDrag(e) || dragFromIndex === null) return;
        e.preventDefault();
        if (Number(card.dataset.index) !== dragFromIndex) card.classList.add('is-drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('is-drag-over'));
      card.addEventListener('drop', (e) => {
        if (isFileDrag(e)) return;
        e.preventDefault();
        card.classList.remove('is-drag-over');
        const toIndex = Number(card.dataset.index);
        const fromIndex = dragFromIndex;
        // Cleared here and not only in dragend: the re-render below detaches
        // the dragged card, and a detached node may never get its dragend. A
        // stale index would then turn the next file drop onto a card into a
        // phantom reorder.
        dragFromIndex = null;
        if (fromIndex === null || fromIndex === toIndex || busy) return;
        invalidateResult();
        // The dropped card takes the target's place: dragging page 1 onto
        // page 2 swaps them. (Inserting at toIndex - 1 when moving down used to
        // put a card straight back where it came from on a drop onto its
        // neighbour, which looked like the drag had failed.)
        const [moved] = images.splice(fromIndex, 1);
        images.splice(toIndex, 0, moved);
        updateSummary();
        renderGrid();
      });
    });
  };

  const blobToBitmap = (blob) => {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image.'));
      };
      img.src = url;
    });
  };

  const fileToBitmap = async (file) => {
    if (file.type === 'image/webp' || /\.webp$/i.test(file.name)) {
      const blob = file.type === 'image/webp' ? file : new Blob([await file.arrayBuffer()], { type: 'image/webp' });
      return blobToBitmap(blob);
    }
    return blobToBitmap(file);
  };

  const rasterizeImageItem = async (imageItem, jpegQuality, wantThumb) => {
    const bitmap = await fileToBitmap(imageItem.file);
    const rot = imageItem.rotation % 360;
    const swap = rot === 90 || rot === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? bitmap.height : bitmap.width;
    canvas.height = swap ? bitmap.width : bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    if (typeof bitmap.close === 'function') bitmap.close();

    const mime = jpegQuality >= 0.99 ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), mime, jpegQuality);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    /* Taken off the same canvas that was just embedded, so the thumbnail is the
       page content rather than the source file — rotation is already baked in
       and the preview needs no CSS transform of its own. */
    let thumb = '';
    if (wantThumb) {
      const scale = Math.min(1, PREVIEW_THUMB_PX / Math.max(canvas.width, canvas.height));
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = Math.max(1, Math.round(canvas.width * scale));
      thumbCanvas.height = Math.max(1, Math.round(canvas.height * scale));
      const thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx.fillStyle = '#ffffff';
      thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
      thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      thumb = thumbCanvas.toDataURL('image/jpeg', 0.7);
    }

    return { bytes, mime, width: canvas.width, height: canvas.height, thumb };
  };

  const getMarginPt = () => {
    const mm = parseFloat(marginSelect?.value, 10);
    return Number.isFinite(mm) ? mm * MM_TO_PT : 10 * MM_TO_PT;
  };

  const getPageDimensions = (pageSizeKey, orientation, imgW, imgH, marginPt) => {
    if (pageSizeKey === 'fit') {
      return { width: imgW + marginPt * 2, height: imgH + marginPt * 2 };
    }
    const base = PAGE_SIZES[pageSizeKey] || PAGE_SIZES.a4;
    if (orientation === 'landscape') {
      return { width: base.height, height: base.width };
    }
    return { width: base.width, height: base.height };
  };

  const calcDrawRect = (pageW, pageH, imgW, imgH, marginPt, fitMode) => {
    const innerW = pageW - marginPt * 2;
    const innerH = pageH - marginPt * 2;
    let drawW = imgW;
    let drawH = imgH;
    const scale = fitMode === 'fill'
      ? Math.max(innerW / imgW, innerH / imgH)
      : Math.min(innerW / imgW, innerH / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
    return {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    };
  };

  const buildPdfFromImages = async (pdfDoc, subset, onProgress, pages) => {
    const pageSizeKey = pageSizeSelect?.value || 'a4';
    const orientation = orientationSelect?.value === 'landscape' ? 'landscape' : 'portrait';
    const fitMode = fitModeSelect?.value || 'contain';
    const marginPt = getMarginPt();
    const qualityMap = { high: 0.92, medium: 0.82, low: 0.65 };
    const jpegQuality = qualityMap[qualitySelect?.value] ?? 0.92;

    for (let i = 0; i < subset.length; i += 1) {
      if (onProgress) onProgress(i + 1, subset.length);
      const wantThumb = !!pages && pages.length < PREVIEW_MAX_PAGES;
      let raster;
      try {
        raster = await rasterizeImageItem(subset[i], jpegQuality, wantThumb);
      } catch (err) {
        console.error(err);
        // "Could not decode image" on its own left the visitor guessing which
        // of forty photos was the problem.
        const name = subset[i].displayName || subset[i].file.name;
        throw new Error(`Could not read “${name}” — this browser cannot decode it. Remove it, or save it as JPG or PNG and add it again.`);
      }
      const { bytes, mime, width, height, thumb } = raster;
      const embedded = mime === 'image/png'
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

      const dims = getPageDimensions(pageSizeKey, orientation, width, height, marginPt);
      const page = pdfDoc.addPage([dims.width, dims.height]);
      const rect = calcDrawRect(dims.width, dims.height, embedded.width, embedded.height, marginPt, fitMode);
      page.drawImage(embedded, rect);
      // Recorded rather than recomputed: the preview then cannot drift from the
      // geometry the page was actually drawn with.
      if (pages) pages.push({ pageW: dims.width, pageH: dims.height, rect, thumb });
    }
  };

  /* Only the characters no file system accepts are replaced. The old rule kept
     ASCII letters and digits alone, so "My scans.pdf" came out as
     "My_scans_pdf.pdf" and a Hindi name as a row of underscores. */
  const getOutputFileName = () => {
    const raw = (fileNameInput?.value || '')
      .trim()
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 120);
    return `${raw || 'images-to-pdf'}.pdf`;
  };

  const triggerDownload = (url, name) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /* The rail is built from the geometry pdf-lib was handed, so it shows the
     page rather than the photo: A4 or fit-to-image proportions, the margin
     band, and letterboxing vs cropping under the two fit modes.

     pdf-lib measures from the bottom-left corner and CSS from the top, hence
     the flip on the vertical offset. */
  const renderPreview = (pages) => {
    if (!previewWrap || !previewRail) return;
    previewRail.innerHTML = '';
    const shown = pages.filter((info) => info.thumb);
    if (!shown.length) {
      previewWrap.classList.add('hidden');
      return;
    }

    const frag = document.createDocumentFragment();
    shown.forEach((info, index) => {
      const left = (info.rect.x / info.pageW) * 100;
      const width = (info.rect.width / info.pageW) * 100;
      const top = ((info.pageH - info.rect.y - info.rect.height) / info.pageH) * 100;
      const height = (info.rect.height / info.pageH) * 100;

      const item = document.createElement('div');
      item.className = 'itp-pv-item';
      item.setAttribute('role', 'listitem');
      item.innerHTML = `
        <div class="itp-pv-page" style="aspect-ratio:${info.pageW} / ${info.pageH}">
          <img src="${info.thumb}" alt="" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%" />
        </div>
        <span class="itp-pv-num">${index + 1}</span>
      `;
      frag.appendChild(item);
    });
    previewRail.appendChild(frag);

    if (previewNote) {
      const omitted = pages.length - shown.length;
      previewNote.textContent = omitted > 0 ? `— first ${shown.length} of ${pages.length} pages` : '';
    }
    previewWrap.classList.remove('hidden');
  };

  const setResultMeta = (count, bytes, isZip) => {
    if (resultTitle) resultTitle.textContent = isZip ? 'ZIP ready' : 'PDF ready';
    if (!resultMeta) return;
    const unit = isZip
      ? `${count} PDF${count === 1 ? '' : 's'}`
      : `${count} page${count === 1 ? '' : 's'}`;
    resultMeta.textContent = `${unit} · ${formatSize(bytes)}`;
  };

  /* Web Share Level 2, offered only when the browser will actually take a file.
     On a phone that is the WhatsApp / Gmail / AirDrop sheet, which is where a
     lot of this traffic is headed anyway; most desktop browsers report no
     support and the button simply never appears. */
  const setupShare = (blob, name) => {
    if (!shareBtn) return;
    shareFile = null;
    shareBtn.classList.add('hidden');
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return;
    const file = new File([blob], name, { type: blob.type });
    if (!navigator.canShare({ files: [file] })) return;
    shareFile = file;
    shareBtn.classList.remove('hidden');
  };

  const setDownloadLabel = (text) => {
    downloadLinks.forEach((link) => {
      const label = link.querySelector('[data-download-label]');
      if (label) label.textContent = text; else link.textContent = text;
    });
  };

  const showResultPanel = () => {
    if (!resultPanel) return;
    resultPanel.classList.remove('hidden');
    requestAnimationFrame(() => {
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const convertToPdf = async () => {
    if (!images.length) {
      setMessage('Add at least one image to convert.', 'error');
      return;
    }

    toggleLoader(true);
    clearMessage();
    hideDownload();
    setProgress(0, 'Starting…');
    // A fixed copy of the order: the grid is locked while this runs, but the
    // PDF must never be built from an array that can change underneath it.
    const batch = images.slice();

    try {
      const pdfLib = window.PDFLib || window.pdfLib;
      if (!pdfLib?.PDFDocument) throw new Error('PDF library failed to load. Refresh the page.');

      const outputMode = outputModeSelect?.value || 'single';
      // Filled by buildPdfFromImages as each page is drawn; drives the preview.
      const pageInfo = [];

      if (outputMode === 'separate') {
        const JSZip = await loadJSZip();
        const zip = new JSZip();
        const pad = String(batch.length).length;
        for (let i = 0; i < batch.length; i += 1) {
          setProgress(((i + 0.5) / batch.length) * 100, `PDF ${i + 1} of ${batch.length}…`);
          const pdfDoc = await pdfLib.PDFDocument.create();
          await buildPdfFromImages(pdfDoc, [batch[i]], null, pageInfo);
          const pdfBytes = await pdfDoc.save();
          const baseName = batch[i].file.name.replace(/\.[^.]+$/, '') || 'page';
          // Numbered: two photos called IMG_0001.jpg (or two links imported as
          // image-from-url.jpg) used to share one name, and the second silently
          // replaced the first inside the ZIP. The prefix also keeps the files
          // in the order they were arranged in.
          zip.file(`${String(i + 1).padStart(pad, '0')}-${baseName}.pdf`, pdfBytes);
        }
        setProgress(95, 'Creating ZIP…');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        pdfBlobUrl = URL.createObjectURL(zipBlob);
        const zipName = getOutputFileName().replace(/\.pdf$/i, '-separate.zip');
        pdfDownloadName = zipName;
        downloadLinks.forEach((link) => {
          link.href = pdfBlobUrl;
          link.download = zipName;
          link.classList.remove('hidden');
        });
        setDownloadLabel('Download ZIP of PDFs');
        setResultMeta(batch.length, zipBlob.size, true);
        setupShare(zipBlob, zipName);
        renderPreview(pageInfo);
        hideProgress();
        showResultPanel();
        setMessage(`${batch.length} PDFs packaged in a ZIP — ${formatSize(zipBlob.size)}.`, 'success');
      } else {
        const pdfDoc = await pdfLib.PDFDocument.create();
        await buildPdfFromImages(pdfDoc, batch, (cur, total) => {
          setProgress((cur / total) * 90, `Processing image ${cur} of ${total}…`);
        }, pageInfo);
        setProgress(95, 'Saving PDF…');
        const pdfBytes = await pdfDoc.save();
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        pdfBlobUrl = URL.createObjectURL(blob);
        pdfDownloadName = getOutputFileName();
        downloadLinks.forEach((link) => {
          link.href = pdfBlobUrl;
          link.download = pdfDownloadName;
          link.classList.remove('hidden');
        });
        setDownloadLabel('Download PDF');
        setResultMeta(batch.length, blob.size, false);
        setupShare(blob, pdfDownloadName);
        renderPreview(pageInfo);
        hideProgress();
        showResultPanel();
        setMessage(`PDF created — ${batch.length} page${batch.length > 1 ? 's' : ''}, ${formatSize(blob.size)}.`, 'success');
      }
      updateFlow();
    } catch (err) {
      console.error(err);
      // A throw after the blob URL was minted would otherwise leave the sticky
      // bar offering a download for a result that was never presented.
      hideDownload();
      hideProgress();
      setMessage(err.message || 'Unable to create PDF. Try JPG/PNG or convert HEIC first.', 'error');
    } finally {
      toggleLoader(false);
    }
  };

  const resetAll = () => {
    images.forEach((img) => {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    });
    images.length = 0;
    hideDownload();
    hideProgress();
    clearMessage();
    updateSummary();
    renderGrid();
    if (fileInput) fileInput.value = '';
  };

  // After a reset the result the visitor was looking at is gone, and so is most
  // of the page under their thumb; take them back to the empty drop zone.
  const startOver = () => {
    resetAll();
    page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    filePickers[filePickers.length - 1]?.focus({ preventScroll: true });
  };

  const openFilePicker = () => fileInput.click();

  filePickers.forEach((picker) => {
    picker.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFilePicker();
    });
  });

  /* "Take Photo" is only offered where `capture` actually opens a camera.
     Desktop browsers accept the attribute and then quietly fall back to the
     ordinary file dialog, which would leave two buttons side by side doing the
     identical thing — so it stays hidden unless the pointer is coarse. */
  if (cameraInput && 'capture' in cameraInput && window.matchMedia('(pointer: coarse)').matches) {
    cameraPickers.forEach((btn) => {
      btn.classList.remove('hidden');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cameraInput.click();
      });
    });
  }

  cameraInput?.addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    // Cleared so photographing the same scene twice still fires `change`.
    e.target.value = '';
  });

  urlToggle?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!urlRow) return;
    const nowHidden = urlRow.classList.toggle('hidden');
    urlToggle.setAttribute('aria-expanded', String(!nowHidden));
    if (!nowHidden) urlInput?.focus();
  });

  urlAddBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    addFromUrl();
  });

  urlInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // The field is not inside a form, so Enter has to be wired by hand.
    e.preventDefault();
    addFromUrl();
  });

  /* A click on any empty part of the zone opens the picker. Clicks on its own
     buttons and on the URL field are theirs, not the zone's. The zone is a
     plain group rather than a focusable role="button" (it holds real buttons
     and a text field), so keyboard users reach the picker through Browse
     Images. */
  dropZone?.addEventListener('click', (e) => {
    if (e.target.closest('button, input, .itp-url-row')) return;
    openFilePicker();
  });

  /* Files can be dropped anywhere on the tool card, not only on the strip.
     Once the grid has content the drop zone is a thin bar, and aiming a fistful
     of files at it is fiddly — so the whole card is the target, with the strip
     lighting up to say where the files will land.

     Listening on the card rather than on the strip also avoids double-adding:
     the strip is a descendant, so one handler covers both. Reorder drags carry
     no files, so they fall through the `Files` guard untouched and the per-card
     handlers in setupDragReorder still see them. dragenter/dragleave fire once
     per element as the pointer crosses children, hence a depth counter rather
     than a plain flag — a flag would clear the highlight the moment the pointer
     moved from the card onto a thumbnail inside it. */
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const setDropActive = (on) => dropZone?.classList.toggle('active', on);
  let fileDragDepth = 0;

  page.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepth += 1;
    setDropActive(true);
  });
  page.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  page.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth) setDropActive(false);
  });
  page.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    setDropActive(false);
    if (busy) {
      setMessage('Still working on the last step — drop the images again once it finishes.', 'error');
      return;
    }
    await addFiles(e.dataTransfer.files);
  });

  /* Paste. A screenshot on the clipboard is the most common "image" people
     have to hand, and on desktop Ctrl+V is quicker than saving it first. Text
     pasted into the URL or file-name fields is left alone. */
  document.addEventListener('paste', async (e) => {
    const target = e.target;
    if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]')) return;
    const files = Array.from(e.clipboardData?.files || []).filter(isSupportedImage);
    if (!files.length || busy) return;
    e.preventDefault();
    // Clipboard images all arrive as "image.png"; number them so the cards and
    // ZIP entries can be told apart.
    const named = files.map((file, i) => {
      if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file;
      const ext = file.name.split('.').pop();
      return new File([file], `pasted-${images.length + i + 1}.${ext}`, { type: file.type });
    });
    await addFiles(named);
    if (images.length) page.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  fileInput?.addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });

  imageGrid?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) { removeImage(removeBtn.getAttribute('data-remove')); return; }
    const rotateBtn = e.target.closest('[data-rotate]');
    if (rotateBtn) { rotateImage(rotateBtn.getAttribute('data-rotate')); return; }
    const upBtn = e.target.closest('[data-move-up]');
    if (upBtn) { moveImage(upBtn.getAttribute('data-move-up'), 'up'); return; }
    const downBtn = e.target.closest('[data-move-down]');
    if (downBtn) moveImage(downBtn.getAttribute('data-move-down'), 'down');
  });

  convertButton?.addEventListener('click', convertToPdf);

  shareBtn?.addEventListener('click', async () => {
    if (!shareFile) return;
    try {
      await navigator.share({ files: [shareFile], title: shareFile.name });
    } catch (err) {
      // Dismissing the share sheet reports AbortError. That is a choice, not a
      // failure, and surfacing it as an error would be noise.
      if (err?.name !== 'AbortError') {
        console.error(err);
        setMessage('Sharing is not available here — use Download instead.', 'error');
      }
    }
  });
  convertAnotherBtn?.addEventListener('click', startOver);
  clearAllBtn?.addEventListener('click', () => {
    if (busy) return;
    resetAll();
    filePickers[filePickers.length - 1]?.focus();
  });
  downloadLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (pdfBlobUrl) triggerDownload(pdfBlobUrl, link.download || getOutputFileName());
    });
  });

  /* Page settings change what the PDF would contain, so a result generated
     under the old ones is withdrawn the same way an image edit withdraws it.
     The file name is deliberately not in this list — it is applied when the
     conversion runs and retyping it should not throw away a finished PDF. */
  [pageSizeSelect, orientationSelect, fitModeSelect, marginSelect, qualitySelect, outputModeSelect]
    .forEach((control) => control?.addEventListener('change', invalidateResult));

  if (stickyCta) {
    stickyCta.addEventListener('click', () => {
      if (busy) return;
      // Downloading needs no scroll — the file is the destination, not the page.
      if (stickyCta.dataset.action === 'download') {
        if (pdfBlobUrl) triggerDownload(pdfBlobUrl, pdfDownloadName || getOutputFileName());
        return;
      }
      // The other two actions both send the visitor back to the tool: the file
      // picker and the progress bar both live up there, and a tap from deep in
      // the FAQ would otherwise look like it did nothing.
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (stickyCta.dataset.action === 'convert') convertToPdf();
      else openFilePicker();
    });
  }

  // "Add images" links: bring the tool up, and with an empty grid open the picker.
  document.querySelectorAll('a[href="#itp-tool"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!images.length && !busy) openFilePicker();
    });
  });

  if ('IntersectionObserver' in window) {
    const resultDownload = resultPanel?.querySelector('[data-download-link]');
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === page) inView.tool = entry.isIntersecting;
        else if (entry.target === convertButton) inView.convert = entry.isIntersecting;
        else if (entry.target === resultDownload) inView.download = entry.isIntersecting;
      });
      syncStickyCta();
    });
    watch.observe(page);
    if (convertButton) watch.observe(convertButton);
    if (resultDownload) watch.observe(resultDownload);
  } else {
    // No way to tell what is on screen: keep the old always-on bar.
    inView.tool = false;
  }
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', syncStickyCta);

  updateSummary();
  renderGrid();
});
