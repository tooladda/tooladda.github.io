const compressSection = document.querySelector('[data-pdf-compress-page]');

if (compressSection) {
  const fileInput = compressSection.querySelector('[data-file-input]');
  const filePickers = Array.from(compressSection.querySelectorAll('[data-file-picker]'));
  const dropZone = compressSection.querySelector('[data-drop-zone]');
  const previewPanel = compressSection.querySelector('[data-file-preview]');
  const fileNameText = compressSection.querySelector('[data-file-name]');
  const pageCountText = compressSection.querySelector('[data-page-count]');
  const fileSizeText = compressSection.querySelector('[data-file-preview] [data-original-size]');
  const compressedSizeText = compressSection.querySelector('[data-file-preview] [data-compressed-size]');
  const reductionText = compressSection.querySelector('[data-file-preview] [data-reduction]');
  const compressButton = compressSection.querySelector('[data-compress-btn]');
  const downloadLinks = Array.from(compressSection.querySelectorAll('[data-download-link]'));
  const compressionLevelSelect = compressSection.querySelector('[data-compression-level]');
  const compressionValueText = compressSection.querySelector('[data-compression-value]');
  const messageBox = compressSection.querySelector('[data-message]');
  const loader = compressSection.querySelector('[data-loader]');
  const resetButton = compressSection.querySelector('[data-reset-btn]');
  const progressWrap = compressSection.querySelector('[data-progress-wrap]');
  const progressFill = compressSection.querySelector('[data-progress-fill]');
  const progressText = compressSection.querySelector('[data-progress-text]');
  const estimateText = compressSection.querySelector('[data-estimate-text]');
  const resultPanel = compressSection.querySelector('[data-result-panel]');
  const resultOriginal = compressSection.querySelector('[data-result-original]');
  const resultCompressed = compressSection.querySelector('[data-result-compressed]');
  const resultSaved = compressSection.querySelector('[data-result-saved]');
  const uploadStep = compressSection.querySelector('[data-step-upload]');
  const configStep = compressSection.querySelector('[data-step-config]');
  const compressAnotherBtn = compressSection.querySelector('[data-compress-another]');
  const levelCards = Array.from(compressSection.querySelectorAll('[data-compression-card]'));
  const customPanel = compressSection.querySelector('[data-custom-panel]');
  const customPercentInput = compressSection.querySelector('[data-custom-percent]');
  const customPreview = compressSection.querySelector('[data-custom-preview]');
  const reducePresets = Array.from(compressSection.querySelectorAll('[data-reduce-percent]'));
  const targetPresets = Array.from(compressSection.querySelectorAll('[data-target-kb]'));
  const targetCustomInput = compressSection.querySelector('[data-target-kb-input]');
  const targetPanel = compressSection.querySelector('[data-target-panel]');
  const targetHint = compressSection.querySelector('[data-target-hint]');
  const stickyCta = document.querySelector('[data-sticky-compress-cta]');
  const stickyBar = document.querySelector('.pc-sticky-cta');
  const flowSteps = Array.from(compressSection.querySelectorAll('[data-pc-flow]'));
  const barAfter = compressSection.querySelector('[data-bar-after]');
  const phoneQuery = window.matchMedia('(max-width: 768px)');
  const STICKY_ICON = stickyCta ? stickyCta.querySelector('svg')?.outerHTML || '' : '';

  let sourceFile = null;
  let sourcePdfDocument = null;
  let activeUrl = null;
  let pdfJsModule = null;
  let selectedReducePercent = 30;
  let selectedTargetBytes = 100 * 1024;
  let busy = false;
  let currentStep = 'upload';
  const inView = { tool: true, compress: false, download: false };

  const compressionProfiles = {
    low: {
      label: 'Low Compression — Best Quality',
      short: 'Best quality',
      quality: 0.92,
      maxDimension: 2800,
      estimateMin: 5,
      estimateMax: 20,
    },
    medium: {
      label: 'Recommended — Balanced',
      short: 'Balanced',
      quality: 0.78,
      maxDimension: 2000,
      estimateMin: 15,
      estimateMax: 40,
    },
    high: {
      label: 'High Compression — Smallest Size',
      short: 'Smallest file',
      quality: 0.58,
      maxDimension: 1400,
      estimateMin: 30,
      estimateMax: 55,
    },
    custom: {
      label: 'Custom % Reduce',
      short: 'Custom %',
      quality: 0.78,
      maxDimension: 2000,
      estimateMin: 0,
      estimateMax: 0,
    },
  };

  /* Gentle → aggressive ladder for custom target (stops at first hit) */
  const targetProfileLadder = [
    { quality: 0.92, maxDimension: 2800, label: 'best quality' },
    { quality: 0.86, maxDimension: 2400, label: 'high quality' },
    { quality: 0.78, maxDimension: 2000, label: 'balanced' },
    { quality: 0.70, maxDimension: 1800, label: 'moderate' },
    { quality: 0.62, maxDimension: 1600, label: 'strong' },
    { quality: 0.52, maxDimension: 1400, label: 'heavy' },
    { quality: 0.42, maxDimension: 1200, label: 'maximum' },
  ];

  /* Extended ladder for absolute target sizes (e.g. 100 KB / 300 KB / 500 KB) — adds a heavier tail. */
  const sizeLadder = targetProfileLadder.concat([
    { quality: 0.34, maxDimension: 1100, label: 'very heavy' },
    { quality: 0.27, maxDimension: 950, label: 'extreme' },
    { quality: 0.20, maxDimension: 820, label: 'tiny' },
    { quality: 0.15, maxDimension: 700, label: 'minimum' },
  ]);

  const IMAGE_OP_NAMES = ['paintImageXObject', 'paintJpegXObject', 'paintInlineImageXObject', 'paintImageMaskXObject'];

  const setStatText = (selector, value) => {
    compressSection.querySelectorAll(selector).forEach((el) => {
      el.textContent = value;
    });
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const calcSavedPercent = (originalBytes, compressedBytes) => {
    if (!originalBytes || originalBytes <= 0) return 0;
    return Math.max(0, ((originalBytes - compressedBytes) / originalBytes) * 100);
  };

  const updateResultStats = (originalBytes, compressedBytes) => {
    if (resultOriginal) resultOriginal.textContent = formatBytes(originalBytes);
    if (resultCompressed) resultCompressed.textContent = formatBytes(compressedBytes);
    if (resultSaved) resultSaved.textContent = `${calcSavedPercent(originalBytes, compressedBytes).toFixed(1)}%`;
  };

  const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.classList.add('hidden');
    messageBox.classList.remove('success', 'error');
  };

  const showMessage = (text, type = 'success') => {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
    messageBox.setAttribute('role', type === 'error' ? 'alert' : 'status');
  };

  const setProgress = (pct, label) => {
    if (!progressWrap || !progressFill) return;
    progressWrap.classList.remove('hidden');
    progressWrap.setAttribute('aria-hidden', 'false');
    progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (progressText && label) progressText.textContent = label;
  };

  const hideProgress = () => {
    if (!progressWrap) return;
    progressWrap.classList.add('hidden');
    progressWrap.setAttribute('aria-hidden', 'true');
    if (progressFill) progressFill.style.width = '0%';
  };

  const toggleLoader = (visible) => {
    busy = visible;
    targetPresets.forEach((btn) => { btn.disabled = visible; });
    if (targetCustomInput) targetCustomInput.disabled = visible;
    loader.classList.toggle('hidden', !visible);
    loader.setAttribute('aria-hidden', visible ? 'false' : 'true');
    compressButton.disabled = visible;
    filePickers.forEach((picker) => { picker.disabled = visible; });
    if (resetButton) resetButton.disabled = visible;
    levelCards.forEach((card) => { card.disabled = visible; });
    reducePresets.forEach((btn) => { btn.disabled = visible; });
    if (customPercentInput) customPercentInput.disabled = visible;
    updateSticky();
  };

  const isCustomMode = () => compressionLevelSelect?.value === 'custom';

  const getReducePercent = () => {
    const customVal = parseFloat(customPercentInput?.value, 10);
    if (Number.isFinite(customVal) && customVal >= 5 && customVal <= 90) return customVal;
    return selectedReducePercent;
  };

  const isTargetMode = () => compressionLevelSelect?.value === 'target';

  const getTargetBytes = () => {
    const kb = parseFloat(targetCustomInput?.value);
    if (Number.isFinite(kb) && kb >= 10) return Math.round(kb * 1024);
    return selectedTargetBytes;
  };

  const targetBytesFromPercent = (originalBytes, percent) => {
    const p = Math.min(90, Math.max(5, percent));
    return Math.max(1024, Math.round(originalBytes * (1 - p / 100)));
  };

  /** Acceptable size band so we don't over-compress (e.g. 20% asked → ~15–25% range). */
  const reductionBandFromPercent = (originalBytes, percent) => {
    const targetBytes = targetBytesFromPercent(originalBytes, percent);
    const slack = Math.max(5, Math.round(percent * 0.25));
    const minBytes = Math.max(1024, Math.round(originalBytes * (1 - (percent + slack) / 100)));
    const maxBytes = Math.min(originalBytes - 1, Math.round(originalBytes * (1 - Math.max(0, percent - 5) / 100)));
    return { targetBytes, minBytes, maxBytes: Math.max(minBytes, maxBytes) };
  };

  const pickClosestToTarget = (candidates, band) => {
    if (!candidates.length) return null;
    const inBand = candidates.filter((c) => c.result.size >= band.minBytes && c.result.size <= band.maxBytes);
    if (inBand.length) {
      return inBand.reduce((best, c) => (
        Math.abs(c.result.size - band.targetBytes) < Math.abs(best.result.size - band.targetBytes) ? c : best
      ));
    }
    /* Nothing landed in the band. A result that shrank at least as much as asked
       beats one that barely shrank: "~50% smaller" answered with 0% was the old
       outcome whenever even the lightest re-encode overshot. Among those, take the
       largest (the least degraded). */
    const enough = candidates.filter((c) => c.result.size <= band.maxBytes);
    if (enough.length) {
      return enough.reduce((best, c) => (c.result.size > best.result.size ? c : best));
    }
    /* Everything is still too big — the smallest is the closest to the target. */
    return candidates.reduce((best, c) => (c.result.size < best.result.size ? c : best));
  };

  const getProfile = () => {
    const key = compressionLevelSelect?.value || 'medium';
    if (key === 'custom') return { ...compressionProfiles.custom };
    return compressionProfiles[key] || compressionProfiles.medium;
  };

  const updateCompressionLabel = () => {
    const mode = compressionLevelSelect?.value || 'medium';
    const profile = compressionProfiles[mode] || compressionProfiles.medium;
    if (compressionValueText) compressionValueText.textContent = profile.label;
    levelCards.forEach((card) => {
      const active = card.getAttribute('data-compression-card') === mode;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (customPanel) customPanel.classList.toggle('hidden', mode !== 'custom');
    if (targetPanel) targetPanel.classList.toggle('hidden', mode !== 'target');
    updateCustomPreview();
    updateEstimate();
  };

  const updateTargetHint = () => {
    if (!targetHint) return;
    const tb = getTargetBytes();
    if (sourceFile) {
      targetHint.textContent = `Aiming for ${formatBytes(tb)} or smaller (from ${formatBytes(sourceFile.size)}). The tool uses the best quality that still fits your target.`;
    } else {
      targetHint.textContent = `Aiming for ${formatBytes(tb)} or smaller. The tool uses the best quality that still fits your target.`;
    }
  };

  const updateCustomPreview = () => {
    if (!customPreview || !isCustomMode() || !sourceFile) return;
    const pct = getReducePercent();
    const targetBytes = targetBytesFromPercent(sourceFile.size, pct);
    customPreview.textContent = `Goal: ~${pct}% smaller → about ${formatBytes(targetBytes)} (from ${formatBytes(sourceFile.size)}). Uses the lightest settings that land near your target — won't shrink more than needed.`;
  };

  const updateEstimate = () => {
    if (!estimateText || !sourceFile) {
      if (estimateText) estimateText.textContent = '';
      return;
    }
    if (isTargetMode()) {
      updateTargetHint();
      if (estimateText) estimateText.textContent = targetHint?.textContent || '';
      return;
    }
    if (isCustomMode()) {
      updateCustomPreview();
      if (estimateText) estimateText.textContent = customPreview?.textContent || '';
      return;
    }
    const profile = getProfile();
    const pages = parseInt(pageCountText.textContent, 10) || 1;
    const sizeMb = sourceFile.size / (1024 * 1024);
    let note = `Typical savings for image-heavy PDFs: ${profile.estimateMin}–${profile.estimateMax}%. Text-only pages stay sharp — only photo/scan pages are re-encoded.`;
    if (sizeMb > 10) note += ' Large files may take a minute.';
    if (pages > 50) note += ` Processing ${pages} pages locally.`;
    estimateText.textContent = note;
  };

  const showStep = (step) => {
    currentStep = step;
    const index = step === 'result' ? 2 : step === 'config' ? 1 : 0;
    flowSteps.forEach((li, i) => {
      li.classList.toggle('is-done', i < index || (step === 'result' && i === 2));
      li.classList.toggle('is-active', i === index);
      if (i === index) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (uploadStep) uploadStep.classList.toggle('hidden', step !== 'upload' && step !== 'config' && step !== 'result');
    if (configStep) configStep.classList.toggle('hidden', step === 'upload');
    if (resultPanel) resultPanel.classList.toggle('hidden', step !== 'result');
    if (previewPanel) previewPanel.hidden = step === 'upload';
    updateSticky();
  };

  /* Phone bottom bar: open the picker while the tool is out of view and empty,
     compress once a file is in and the real button has scrolled away, then
     download once the result's own button is off screen. */
  function updateSticky() {
    if (!stickyBar || !stickyCta) return;
    let label = 'Compress PDF — Free';
    let show = false;
    if (phoneQuery.matches && !busy) {
      if (currentStep === 'result') {
        label = 'Download compressed PDF';
        show = !inView.download;
      } else if (currentStep === 'config') {
        show = !inView.compress;
      } else {
        show = !inView.tool;
      }
    }
    stickyCta.innerHTML = STICKY_ICON + label;
    stickyBar.classList.toggle('is-visible', show);
    stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    stickyCta.tabIndex = show ? 0 : -1;
    const was = document.body.classList.contains('pc-sticky-on');
    document.body.classList.toggle('pc-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }

  /* A result belongs to the settings that made it: changing them drops it. */
  const invalidateResult = () => {
    if (currentStep !== 'result') return;
    if (activeUrl) { URL.revokeObjectURL(activeUrl); activeUrl = null; }
    downloadLinks.forEach((link) => link.classList.add('hidden'));
    setStatText('[data-compressed-size]', '—');
    setStatText('[data-reduction]', '—');
    clearMessage();
    showStep('config');
  };

  const triggerDownload = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!activeUrl) return;
    const link = document.createElement('a');
    link.href = activeUrl;
    link.download = downloadLinks[0]?.dataset.downloadName || `${sourceFile?.name?.replace(/\.pdf$/i, '') || 'compressed'}-compressed.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetTool = () => {
    sourceFile = null;
    sourcePdfDocument = null;
    fileInput.value = '';
    previewPanel.hidden = true;
    fileNameText.textContent = '';
    pageCountText.textContent = '0';
    fileSizeText.textContent = '';
    compressedSizeText.textContent = '—';
    reductionText.textContent = '—';
    setStatText('[data-compressed-size]', '—');
    setStatText('[data-reduction]', '—');
    downloadLinks.forEach((link) => link.classList.add('hidden'));
    if (resultOriginal) resultOriginal.textContent = '—';
    if (resultCompressed) resultCompressed.textContent = '—';
    if (resultSaved) resultSaved.textContent = '—';
    if (compressionLevelSelect) compressionLevelSelect.value = 'medium';
    if (customPercentInput) customPercentInput.value = '';
    selectedReducePercent = 30;
    reducePresets.forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-reduce-percent') === '30'));
    selectedTargetBytes = 100 * 1024;
    if (targetCustomInput) targetCustomInput.value = '';
    targetPresets.forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute('data-target-kb') === '100'));
    clearMessage();
    hideProgress();
    updateCompressionLabel();
    showStep('upload');
    if (activeUrl) {
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }
    dropZone.classList.remove('hidden');
  };

  const loadPdfJs = async () => {
    if (pdfJsModule) return pdfJsModule;
    try {
      const module = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs');
      pdfJsModule = module.default || module;
      if (pdfJsModule.GlobalWorkerOptions) {
        pdfJsModule.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';
      }
    } catch (error) {
      console.error('PDF.js failed to load', error);
      throw new Error('The PDF renderer could not be loaded. Please refresh the page and try again.');
    }
    return pdfJsModule;
  };

  const renderPreview = () => {
    if (!sourceFile) return;
    previewPanel.hidden = false;
    fileNameText.textContent = sourceFile.name;
    const sizeLabel = formatBytes(sourceFile.size);
    fileSizeText.textContent = sizeLabel;
    setStatText('[data-original-size]', sizeLabel);
    dropZone.classList.add('hidden');
    showStep('config');
    updateEstimate();
  };

  const openFilePicker = () => fileInput.click();

  const validateFile = (file) => {
    const isPdfType = file && file.type === 'application/pdf';
    const isPdfExtension = file && file.name && file.name.toLowerCase().endsWith('.pdf');
    if (!file || (!isPdfType && !isPdfExtension)) {
      throw new Error('Please select a valid PDF file.');
    }
    sourceFile = file;
  };

  const loadFile = async (file) => {
    const previous = { sourceFile, sourcePdfDocument };
    validateFile(file);
    try {
      const bytes = await sourceFile.arrayBuffer();
      let doc;
      try {
        doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      } catch (err) {
        throw new Error('This file could not be read as a PDF. It may be damaged or not really a PDF.');
      }
      if (doc.isEncrypted) {
        throw new Error('This PDF is password-protected. Unlock it first with Unlock PDF (pdf-password-remover.html), then compress it.');
      }
      if (activeUrl) { URL.revokeObjectURL(activeUrl); activeUrl = null; }
      downloadLinks.forEach((link) => link.classList.add('hidden'));
      setStatText('[data-compressed-size]', '—');
      setStatText('[data-reduction]', '—');
      sourcePdfDocument = doc;
      pageCountText.textContent = String(sourcePdfDocument.getPageCount());
      renderPreview();
    } catch (err) {
      // keep whatever was loaded before this attempt
      sourceFile = previous.sourceFile;
      sourcePdfDocument = previous.sourcePdfDocument;
      throw err;
    }
  };

  const pageHasHeavyImages = (operatorList, pdfjsLib) => (operatorList.fnArray || []).some((fn) => {
    if (typeof fn === 'string') return IMAGE_OP_NAMES.some((name) => fn.includes(name));
    if (pdfjsLib.OPS) return IMAGE_OP_NAMES.some((name) => pdfjsLib.OPS[name] === fn);
    return false;
  });

  const createCompressedPage = async (outputPdf, sourcePdf, pdfjsDoc, pdfjsLib, pageIndex, profile) => {
    const page = await pdfjsDoc.getPage(pageIndex);
    const operatorList = await page.getOperatorList();

    if (!pageHasHeavyImages(operatorList, pdfjsLib)) {
      const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageIndex - 1]);
      outputPdf.addPage(copiedPage);
      page.cleanup();
      return false;
    }

    const viewport = page.getViewport({ scale: 1 });
    const maxDimension = Math.max(viewport.width, viewport.height);
    const scale = maxDimension > profile.maxDimension ? profile.maxDimension / maxDimension : 1;
    const scaledViewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(scaledViewport.width);
    canvas.height = Math.ceil(scaledViewport.height);

    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
    page.cleanup();

    const imageBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode a page image.'));
      }, 'image/jpeg', profile.quality);
    });

    const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
    const image = await outputPdf.embedJpg(imageBytes);
    const outputPage = outputPdf.addPage([scaledViewport.width, scaledViewport.height]);
    outputPage.drawImage(image, {
      x: 0,
      y: 0,
      width: scaledViewport.width,
      height: scaledViewport.height,
    });
    return true;
  };

  const buildStructureOnlyPdf = async (sourcePdf, onPageProgress) => {
    const outputPdf = await PDFLib.PDFDocument.create();
    const totalPages = sourcePdf.getPageCount();
    const pageIndices = Array.from({ length: totalPages }, (_, index) => index);
    if (onPageProgress) onPageProgress(0, totalPages);
    const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndices);
    copiedPages.forEach((page) => outputPdf.addPage(page));
    if (onPageProgress) onPageProgress(totalPages, totalPages);
    const outputBytes = await outputPdf.save({ useObjectStreams: true });
    const blob = new Blob([outputBytes], { type: 'application/pdf' });
    return { outputBytes, blob, size: blob.size };
  };

  const buildCompressedPdf = async (fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, profile, onPageProgress) => {
    const outputPdf = await PDFLib.PDFDocument.create();
    const totalPages = sourcePdf.getPageCount();

    for (let index = 1; index <= totalPages; index += 1) {
      if (onPageProgress) onPageProgress(index, totalPages);
      await createCompressedPage(outputPdf, sourcePdf, pdfjsDoc, pdfjsLib, index, profile);
      if (index % 3 === 0) await yieldToUI();
    }

    const outputBytes = await outputPdf.save({ useObjectStreams: true });
    const blob = new Blob([outputBytes], { type: 'application/pdf' });
    return { outputBytes, blob, size: blob.size };
  };

  const finishCompression = (originalSize, blob, successMessage) => {
    if (activeUrl) URL.revokeObjectURL(activeUrl);

    const compressedSize = blob.size;
    const savedPct = calcSavedPercent(originalSize, compressedSize);

    activeUrl = URL.createObjectURL(blob);
    if (downloadLinks[0]) downloadLinks[0].dataset.downloadName = `${sourceFile.name.replace(/\.pdf$/i, '')}-compressed.pdf`;
    downloadLinks.forEach((link) => link.classList.remove('hidden'));

    const compressedLabel = formatBytes(compressedSize);
    const savedLabel = `${savedPct.toFixed(1)}%`;
    compressedSizeText.textContent = compressedLabel;
    reductionText.textContent = savedLabel;
    setStatText('[data-compressed-size]', compressedLabel);
    setStatText('[data-reduction]', savedLabel);
    updateResultStats(originalSize, compressedSize);
    if (barAfter) barAfter.style.width = `${Math.max(2, Math.min(100, (compressedSize / originalSize) * 100)).toFixed(1)}%`;

    setProgress(100, 'Done!');
    hideProgress();
    showStep('result');
    showMessage(successMessage, 'success');
    if (resultPanel) {
      requestAnimationFrame(() => resultPanel.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: phoneQuery.matches ? 'start' : 'nearest',
      }));
    }
  };

  const compressWithProfile = async (fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, profile) => {
    const totalPages = sourcePdf.getPageCount();
    return buildCompressedPdf(fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, profile, (index, total) => {
      setProgress(Math.round(((index - 1) / total) * 90), `Compressing page ${index} of ${total}…`);
    });
  };

  const compressToPercent = async (fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, reducePercent, originalSize) => {
    const band = reductionBandFromPercent(originalSize, reducePercent);
    const candidates = [];

    setProgress(5, 'Trying light structure optimization…');
    const structureOnly = await buildStructureOnlyPdf(sourcePdf, (index, total) => {
      if (total) setProgress(Math.round((index / total) * 15), 'Light optimization…');
    });
    candidates.push({ result: structureOnly, profileUsed: { label: 'structure-only' } });

    if (structureOnly.size > band.maxBytes) {
      for (let i = 0; i < targetProfileLadder.length; i += 1) {
        const step = targetProfileLadder[i];
        setProgress(
          Math.round(15 + (i / targetProfileLadder.length) * 75),
          `Trying ${step.label} for ~${reducePercent}% reduction…`
        );
        const result = await buildCompressedPdf(fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, step, (index, total) => {
          setProgress(
            Math.round(15 + (i / targetProfileLadder.length) * 75 + ((index / total) * (75 / targetProfileLadder.length))),
            `${step.label} — page ${index}/${total}…`
          );
        });
        candidates.push({ result, profileUsed: step });

        if (result.size <= band.minBytes) break;
        await yieldToUI();
      }
    }

    const chosen = pickClosestToTarget(candidates, band);
    const actualPct = calcSavedPercent(originalSize, chosen.result.size);
    const inBand = chosen.result.size >= band.minBytes && chosen.result.size <= band.maxBytes;
    const overCompressed = chosen.result.size < band.minBytes;

    return {
      result: chosen.result,
      hitTarget: inBand,
      overCompressed,
      targetBytes: band.targetBytes,
      reducePercent,
      actualPct,
      profileUsed: chosen.profileUsed,
    };
  };

  /* Compress toward an absolute file size (e.g. 100 KB). Uses the best quality that still fits. */
  const compressToSize = async (fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, targetBytes, originalSize) => {
    setProgress(6, 'Optimizing structure…');
    const structureOnly = await buildStructureOnlyPdf(sourcePdf, (i, t) => { if (t) setProgress(Math.round((i / t) * 12), 'Optimizing…'); });
    if (structureOnly.size <= targetBytes) {
      return { result: structureOnly, hitTarget: true, targetBytes, profileUsed: { label: 'structure-only' } };
    }
    let best = structureOnly;
    let bestProfile = { label: 'structure-only' };
    let met = null;
    for (let i = 0; i < sizeLadder.length; i += 1) {
      const step = sizeLadder[i];
      const baseP = Math.round(12 + (i / sizeLadder.length) * 82);
      setProgress(baseP, `Targeting ${formatBytes(targetBytes)} — ${step.label}…`);
      const result = await buildCompressedPdf(fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, step, (idx, total) => {
        setProgress(Math.round(baseP + (idx / total) * (82 / sizeLadder.length)), `${step.label} — page ${idx}/${total}…`);
      });
      if (result.size < best.size) { best = result; bestProfile = step; }
      if (result.size <= targetBytes) { met = { result, profileUsed: step }; break; }
      await yieldToUI();
    }
    if (met) return { result: met.result, hitTarget: true, targetBytes, profileUsed: met.profileUsed };
    return { result: best, hitTarget: false, targetBytes, profileUsed: bestProfile };
  };

  const compressPdf = async () => {
    if (!sourceFile) throw new Error('Upload a PDF file before compressing it.');

    const fileBytes = await sourceFile.arrayBuffer();
    const pdfjsLib = await loadPdfJs();
    const sourcePdf = sourcePdfDocument || await PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true });
    const pdfjsDoc = await pdfjsLib.getDocument({ data: fileBytes, useWorkerFetch: false, isEvalSupported: false }).promise;
    try {
      await runCompression(fileBytes, sourcePdf, pdfjsDoc, pdfjsLib);
    } finally {
      pdfjsDoc.destroy();
    }
  };

  const runCompression = async (fileBytes, sourcePdf, pdfjsDoc, pdfjsLib) => {
    const originalSize = sourceFile.size || fileBytes.byteLength;

    let blob;
    let successMessage;

    if (isTargetMode()) {
      const targetBytes = getTargetBytes();
      if (originalSize <= targetBytes) {
        showMessage(`This PDF is already ${formatBytes(originalSize)} — under your ${formatBytes(targetBytes)} target. No compression needed.`, 'success');
        return;
      }
      const { result, hitTarget, profileUsed } = await compressToSize(fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, targetBytes, originalSize);
      blob = result.blob;
      if (hitTarget) {
        successMessage = `Done — compressed to ${formatBytes(blob.size)}, under your ${formatBytes(targetBytes)} target (${profileUsed?.label || 'optimized'} settings).`;
      } else {
        successMessage = `Best effort — reduced to ${formatBytes(blob.size)}. This PDF can't reach ${formatBytes(targetBytes)} without becoming unreadable; try a slightly larger target.`;
      }
      finishCompression(originalSize, blob, successMessage);
      return;
    }

    if (isCustomMode()) {
      const reducePercent = getReducePercent();
      const { result, hitTarget, overCompressed, actualPct, profileUsed } = await compressToPercent(
        fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, reducePercent, originalSize
      );
      blob = result.blob;
      const achieved = actualPct != null ? actualPct.toFixed(1) : calcSavedPercent(originalSize, blob.size).toFixed(1);

      if (hitTarget) {
        successMessage = `~${reducePercent}% reduction — saved ${achieved}% (${profileUsed?.label || 'balanced'} settings).`;
      } else if (overCompressed) {
        successMessage = `Saved ${achieved}% — even the lightest re-encoding shrinks this PDF more than ~${reducePercent}%, so the best-quality setting (${profileUsed?.label || 'best quality'}) was used.`;
      } else {
        successMessage = `Best effort — saved ${achieved}% (asked for ~${reducePercent}%). This PDF may not reach that size without heavy quality loss.`;
      }
    } else {
      const profile = getProfile();
      setProgress(5, 'Starting compression…');
      const result = await compressWithProfile(fileBytes, sourcePdf, pdfjsDoc, pdfjsLib, profile);
      blob = result.blob;
      const savedPct = calcSavedPercent(originalSize, blob.size);

      if (blob.size >= originalSize) {
        successMessage = 'The PDF was rebuilt but is not smaller than the original — it may already be optimized. Quality was preserved on text pages.';
      } else {
        successMessage = `Compression complete — reduced size by ${savedPct.toFixed(1)}%.`;
      }
    }

    finishCompression(originalSize, blob, successMessage);
  };

  filePickers.forEach((picker) => {
    picker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFilePicker();
    });
  });

  dropZone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    openFilePicker();
  });

  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  });

  fileInput.addEventListener('change', async (event) => {
    if (event.target.files.length > 0) {
      try {
        toggleLoader(true);
        clearMessage();
        await loadFile(event.target.files[0]);
        showMessage('PDF loaded. Choose a compression level and click Compress PDF.', 'success');
      } catch (error) {
        showMessage(error.message, 'error');
      } finally {
        toggleLoader(false);
      }
    }
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dropZone.addEventListener(ev, (event) => {
      event.preventDefault();
      dropZone.classList.add('active');
    });
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));

  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('active');
    const file = event.dataTransfer.files[0];
    if (file) {
      try {
        toggleLoader(true);
        clearMessage();
        await loadFile(file);
        showMessage('PDF loaded. Choose a compression level and click Compress PDF.', 'success');
      } catch (error) {
        showMessage(error.message, 'error');
      } finally {
        toggleLoader(false);
      }
    }
  });

  document.addEventListener('paste', async (event) => {
    const items = (event.clipboardData || {}).items || [];
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].type === 'application/pdf') {
        const file = items[i].getAsFile();
        if (file) {
          try {
            toggleLoader(true);
            clearMessage();
            await loadFile(file);
            showMessage('PDF pasted. Choose a compression level and click Compress PDF.', 'success');
          } catch (error) {
            showMessage(error.message, 'error');
          } finally {
            toggleLoader(false);
          }
        }
        break;
      }
    }
  });

  compressButton.addEventListener('click', async () => {
    try {
      toggleLoader(true);
      clearMessage();
      await compressPdf();
    } catch (error) {
      hideProgress();
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  });

  downloadLinks.forEach((link) => link.addEventListener('click', triggerDownload));

  if (compressionLevelSelect) {
    compressionLevelSelect.addEventListener('change', updateCompressionLabel);
  }

  levelCards.forEach((card) => {
    card.addEventListener('click', () => {
      invalidateResult();
      if (compressionLevelSelect) {
        compressionLevelSelect.value = card.getAttribute('data-compression-card');
        updateCompressionLabel();
      }
    });
  });

  reducePresets.forEach((btn) => {
    btn.addEventListener('click', () => {
      invalidateResult();
      selectedReducePercent = parseFloat(btn.getAttribute('data-reduce-percent'), 10);
      reducePresets.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (customPercentInput) customPercentInput.value = '';
      if (compressionLevelSelect) compressionLevelSelect.value = 'custom';
      updateCompressionLabel();
    });
  });

  if (customPercentInput) {
    customPercentInput.addEventListener('input', () => {
      invalidateResult();
      if (customPercentInput.value) {
        reducePresets.forEach((b) => b.classList.remove('is-active'));
        if (compressionLevelSelect) compressionLevelSelect.value = 'custom';
        levelCards.forEach((card) => {
          card.classList.toggle('is-active', card.getAttribute('data-compression-card') === 'custom');
        });
        if (customPanel) customPanel.classList.remove('hidden');
        updateCustomPreview();
        if (estimateText && customPreview) estimateText.textContent = customPreview.textContent;
      }
    });
  }

  targetPresets.forEach((btn) => {
    btn.addEventListener('click', () => {
      invalidateResult();
      selectedTargetBytes = parseInt(btn.getAttribute('data-target-kb'), 10) * 1024;
      targetPresets.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (targetCustomInput) targetCustomInput.value = '';
      if (compressionLevelSelect) compressionLevelSelect.value = 'target';
      updateCompressionLabel();
    });
  });

  if (targetCustomInput) {
    targetCustomInput.addEventListener('input', () => {
      invalidateResult();
      if (targetCustomInput.value) {
        targetPresets.forEach((b) => b.classList.remove('is-active'));
        if (compressionLevelSelect) compressionLevelSelect.value = 'target';
        updateCompressionLabel();
      }
    });
  }

  if (resetButton) resetButton.addEventListener('click', resetTool);
  if (compressAnotherBtn) compressAnotherBtn.addEventListener('click', resetTool);

  if (stickyCta) {
    stickyCta.addEventListener('click', () => {
      if (currentStep === 'result') { triggerDownload(); return; }
      if (sourceFile) { compressButton.click(); return; }
      compressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      openFilePicker();
    });
  }

  // "Compress PDF Now" links: bring the tool up, and with no file yet open the picker.
  document.querySelectorAll('a[href="#compress-tool"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      compressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!sourceFile) openFilePicker();
    });
  });

  // A PDF dropped anywhere on the tool loads (and replaces the current one).
  const carriesFiles = (event) => !!(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files'));
  compressSection.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    compressSection.classList.add('is-file-over');
  });
  compressSection.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && compressSection.contains(event.relatedTarget)) return;
    compressSection.classList.remove('is-file-over');
  });
  compressSection.addEventListener('drop', async (event) => {
    compressSection.classList.remove('is-file-over');
    if (!carriesFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file || busy) return;
    try {
      toggleLoader(true);
      clearMessage();
      await loadFile(file);
      showMessage('PDF loaded. Choose a compression level and click Compress PDF.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  });

  if ('IntersectionObserver' in window) {
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === compressSection) inView.tool = entry.isIntersecting;
        else if (entry.target === compressButton) inView.compress = entry.isIntersecting;
        else inView.download = entry.isIntersecting;
      });
      updateSticky();
    });
    watch.observe(compressSection);
    watch.observe(compressButton);
    const resultDownload = resultPanel && resultPanel.querySelector('[data-download-link]');
    if (resultDownload) watch.observe(resultDownload);
  }
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);

  resetTool();
}
