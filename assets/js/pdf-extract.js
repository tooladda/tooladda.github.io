const extractSection = document.querySelector('[data-extract-page]');
if (extractSection) {
  const fileInput = extractSection.querySelector('[data-file-input]');
  const filePickers = Array.from(extractSection.querySelectorAll('[data-file-picker]'));
  const dropZone = extractSection.querySelector('[data-drop-zone]');
  const previewPanel = extractSection.querySelector('[data-file-preview]');
  const fileNameText = extractSection.querySelector('[data-file-name]');
  const pageCountText = extractSection.querySelector('[data-page-count]');
  const fileSizeText = extractSection.querySelector('[data-file-size]');
  const extractMode = extractSection.querySelector('[data-extract-mode]');
  const singleField = extractSection.querySelector('[data-single-field]');
  const multipleField = extractSection.querySelector('[data-multiple-field]');
  const rangeField = extractSection.querySelector('[data-range-field]');
  const singlePageInput = extractSection.querySelector('[data-single-page]');
  const multiplePagesInput = extractSection.querySelector('[data-multiple-pages]');
  const pageRangeInput = extractSection.querySelector('[data-page-range]');
  const extractButton = extractSection.querySelector('[data-extract-btn]');
  const downloadLink = extractSection.querySelector('[data-download-link]');
  const messageBox = extractSection.querySelector('[data-message]');
  const loader = extractSection.querySelector('[data-loader]');
  const resetButton = extractSection.querySelector('[data-reset-btn]');
  const pageHint = extractSection.querySelector('[data-page-hint]');

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

  let sourceFile = null;
  let sourceDoc = null; // cached parsed PDFDocument
  let pageCount = 0;
  let activeUrl = null;

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.classList.add('hidden');
    messageBox.classList.remove('success', 'error');
  };

  const showMessage = (text, type = 'success') => {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  };

  const toggleLoader = (visible) => {
    loader.classList.toggle('hidden', !visible);
    extractButton.disabled = visible ? true : !sourceFile;
    filePickers.forEach((picker) => { picker.disabled = visible; });
    resetButton.disabled = visible;
  };

  const resetTool = () => {
    sourceFile = null;
    sourceDoc = null;
    pageCount = 0;
    fileInput.value = '';
    previewPanel.hidden = true;
    downloadLink.classList.add('hidden');
    downloadLink.href = '';
    singlePageInput.value = '';
    singlePageInput.removeAttribute('max');
    multiplePagesInput.value = '';
    pageRangeInput.value = '';
    extractMode.value = 'single';
    singleField.hidden = false;
    multipleField.hidden = true;
    rangeField.hidden = true;
    extractButton.disabled = true;
    if (pageHint) pageHint.hidden = true;
    clearMessage();
    if (activeUrl) {
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }
  };

  const renderPreview = () => {
    if (!sourceFile) return;
    previewPanel.hidden = false;
    fileNameText.textContent = sourceFile.name;
    pageCountText.textContent = String(pageCount);
    fileSizeText.textContent = formatBytes(sourceFile.size);
    singlePageInput.max = String(pageCount);
    singlePageInput.placeholder = `1 – ${pageCount}`;
    multiplePagesInput.placeholder = pageCount >= 5 ? '1,3,5' : '1,2';
    pageRangeInput.placeholder = pageCount >= 5 ? '2-5' : `1-${pageCount}`;
    if (pageHint) {
      pageHint.hidden = false;
      pageHint.textContent = `This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'} (1–${pageCount}).`;
    }
  };

  const parsePages = () => {
    const mode = extractMode.value;
    if (mode === 'single') {
      const page = Number(singlePageInput.value);
      if (!page || page < 1 || page > pageCount) {
        throw new Error(`Enter a page number between 1 and ${pageCount}.`);
      }
      return [page];
    }

    if (mode === 'multiple') {
      const raw = multiplePagesInput.value.trim();
      if (!raw) throw new Error('Enter page numbers or ranges like 1,3,5-7.');
      const parts = raw.split(',').map((item) => item.trim()).filter(Boolean);
      const pages = new Set();
      parts.forEach((part) => {
        if (/^\d+$/.test(part)) {
          pages.add(Number(part));
          return;
        }
        const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (!rangeMatch) {
          throw new Error('Use valid page numbers or ranges like 1,3,5-7.');
        }
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (start > end) throw new Error('In a range, the start must be lower than the end.');
        for (let p = start; p <= end; p += 1) pages.add(p);
      });
      const pageArray = Array.from(pages).sort((a, b) => a - b);
      if (!pageArray.length) throw new Error('Enter at least one valid page.');
      pageArray.forEach((page) => {
        if (page < 1 || page > pageCount) {
          throw new Error(`Page ${page} is outside the range 1–${pageCount}.`);
        }
      });
      return pageArray;
    }

    if (mode === 'range') {
      const raw = pageRangeInput.value.trim();
      const match = raw.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!match) {
        throw new Error('Enter a valid page range like 2-5.');
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (start < 1 || end > pageCount || start > end) {
        throw new Error(`Range must be within 1–${pageCount}, with start before end.`);
      }
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    }

    return [];
  };

  const createExtractedPdf = async (selectedPages) => {
    const extractedPdf = await PDFLib.PDFDocument.create();
    const copiedPages = await extractedPdf.copyPages(sourceDoc, selectedPages.map((page) => page - 1));
    copiedPages.forEach((page) => extractedPdf.addPage(page));
    return extractedPdf.save();
  };

  const buildFileName = (pages) => {
    const base = (sourceFile.name || 'document').replace(/\.pdf$/i, '');
    const label = pages.length > 6
      ? `${pages.length}-pages`
      : pages.join('-');
    return `${base}-pages-${label}.pdf`;
  };

  const handleExtract = async () => {
    if (!sourceFile || !sourceDoc) {
      throw new Error('Upload a PDF file before extracting pages.');
    }
    const selectedPages = parsePages();
    const pdfBytes = await createExtractedPdf(selectedPages);
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    activeUrl = URL.createObjectURL(blob);
    downloadLink.href = activeUrl;
    downloadLink.download = buildFileName(selectedPages);
    downloadLink.textContent = `⬇️ Download (${selectedPages.length} page${selectedPages.length === 1 ? '' : 's'})`;
    downloadLink.classList.remove('hidden');
    // auto-start the download for convenience
    downloadLink.click();
  };

  const looksLikePdf = (file) => {
    if (!file) return false;
    if (file.type === 'application/pdf') return true;
    return /\.pdf$/i.test(file.name || '');
  };

  const handleFileLoad = async (file) => {
    if (!looksLikePdf(file)) {
      throw new Error('Please select a valid PDF file (.pdf).');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('This file is larger than 100 MB. Please use a smaller PDF.');
    }
    let pdf;
    try {
      const bytes = await file.arrayBuffer();
      pdf = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (err) {
      throw new Error('This PDF could not be opened. It may be corrupted or password-protected.');
    }
    if (pdf.isEncrypted) {
      throw new Error('This PDF is password-protected. Remove the password first, then try again.');
    }
    if (pdf.getPageCount() === 0) {
      throw new Error('This PDF has no pages to extract.');
    }
    sourceFile = file;
    sourceDoc = pdf;
    pageCount = pdf.getPageCount();
    renderPreview();
  };

  const openFilePicker = () => fileInput.click();

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

  const loadWithFeedback = async (file) => {
    try {
      toggleLoader(true);
      clearMessage();
      await handleFileLoad(file);
      showMessage(`PDF loaded — ${pageCount} page${pageCount === 1 ? '' : 's'}. Choose pages to extract.`, 'success');
    } catch (error) {
      resetTool();
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  };

  fileInput.addEventListener('change', (event) => {
    if (event.target.files.length > 0) loadWithFeedback(event.target.files[0]);
  });

  dropZone.addEventListener('dragenter', (event) => { event.preventDefault(); dropZone.classList.add('active'); });
  dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('active'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('active');
    const file = event.dataTransfer.files[0];
    if (file) loadWithFeedback(file);
  });

  extractMode.addEventListener('change', () => {
    clearMessage();
    singleField.hidden = extractMode.value !== 'single';
    multipleField.hidden = extractMode.value !== 'multiple';
    rangeField.hidden = extractMode.value !== 'range';
  });

  extractButton.addEventListener('click', async () => {
    try {
      toggleLoader(true);
      clearMessage();
      await handleExtract();
      showMessage('Extracted PDF is ready — your download should start automatically.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  });

  resetButton.addEventListener('click', resetTool);

  resetTool();
}
