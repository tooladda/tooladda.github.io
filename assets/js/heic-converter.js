const heicConverterSection = document.querySelector('[data-heic-converter-page]');
if (heicConverterSection) {
  const fileInput = heicConverterSection.querySelector('[data-file-input]');
  const filePickers = Array.from(heicConverterSection.querySelectorAll('[data-file-picker]'));
  const dropZone = heicConverterSection.querySelector('[data-drop-zone]');
  const thumbGrid = heicConverterSection.querySelector('[data-thumb-grid]');
  const previewPanel = heicConverterSection.querySelector('[data-file-preview]');
  const fileCountText = heicConverterSection.querySelector('[data-file-count]');
  const outputFormatSelect = heicConverterSection.querySelector('[data-output-format]');
  const qualitySelect = heicConverterSection.querySelector('[data-quality]');
  const resizeEnable = heicConverterSection.querySelector('[data-resize-enable]');
  const resizeWidth = heicConverterSection.querySelector('[data-resize-width]');
  const resizeHeight = heicConverterSection.querySelector('[data-resize-height]');
  const resizeAspect = heicConverterSection.querySelector('[data-resize-aspect]');
  const filenamePrefixInput = heicConverterSection.querySelector('[data-filename-prefix]');
  const convertButton = heicConverterSection.querySelector('[data-convert-btn]');
  const downloadAllBtn = heicConverterSection.querySelector('[data-download-all-btn]');
  const resetAllBtn = heicConverterSection.querySelector('[data-reset-all-btn]');
  const messageBox = heicConverterSection.querySelector('[data-message]');
  const loader = heicConverterSection.querySelector('[data-loader]');
  const resetButton = heicConverterSection.querySelector('[data-reset-btn]');
  const resultsContainer = heicConverterSection.querySelector('[data-results-container]');
  const resultsList = heicConverterSection.querySelector('[data-results-list]');
  const progressWrap = heicConverterSection.querySelector('[data-progress-wrap]');
  const progressBar = heicConverterSection.querySelector('[data-progress-bar]');
  const progressLabel = heicConverterSection.querySelector('[data-progress-label]');
  const stickyBar = document.querySelector('[data-sticky-bar]');
  const stickyConvertBtn = document.querySelector('[data-sticky-convert]');
  const scrollToToolBtns = Array.from(document.querySelectorAll('[data-scroll-to-tool]'));
  const formatPickers = Array.from(heicConverterSection.querySelectorAll('[data-format-pick]'));

  let selectedFiles = [];
  let convertedImages = [];
  let activeUrls = [];

  const syncFormatChips = (value) => {
    if (!formatPickers.length) return;
    const activeValue = value || (outputFormatSelect ? outputFormatSelect.value : 'jpeg');
    formatPickers.forEach((chip) => {
      const isActive = chip.getAttribute('data-format-pick') === activeValue;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const formatMeta = {
    jpeg: { mime: 'image/jpeg', ext: '.jpg' },
    png: { mime: 'image/png', ext: '.png' },
    webp: { mime: 'image/webp', ext: '.webp' },
    avif: { mime: 'image/avif', ext: '.avif' },
    bmp: { mime: 'image/bmp', ext: '.bmp' },
  };

  const bytesToLabel = (bytes) => {
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

  const setProgress = (current, total) => {
    if (!progressWrap) return;
    if (total <= 0) {
      progressWrap.classList.add('hidden');
      progressBar.classList.remove('is-complete');
      if (progressLabel) progressLabel.classList.remove('is-complete');
      return;
    }
    progressWrap.classList.remove('hidden');
    const pct = Math.round((current / total) * 100);
    const done = current >= total;
    progressBar.style.width = `${pct}%`;
    progressBar.classList.toggle('is-complete', done);
    progressLabel.textContent = done ? 'Conversion complete' : `Converting ${current} of ${total}…`;
    progressLabel.classList.toggle('is-complete', done);
  };

  const syncConvertState = () => {
    const disabled = selectedFiles.length === 0;
    convertButton.disabled = disabled;
    if (stickyConvertBtn) stickyConvertBtn.disabled = disabled;
  };

  const toggleLoader = (visible) => {
    loader.classList.toggle('hidden', !visible);
    convertButton.disabled = visible;
    if (stickyConvertBtn) stickyConvertBtn.disabled = visible;
    filePickers.forEach((picker) => {
      picker.disabled = visible;
    });
    resetButton.disabled = visible;
    downloadAllBtn.disabled = visible;
  };

  const resetTool = () => {
    selectedFiles = [];
    convertedImages = [];
    fileInput.value = '';
    previewPanel.hidden = true;
    if (thumbGrid) {
      thumbGrid.hidden = true;
      thumbGrid.innerHTML = '';
    }
    resultsContainer.classList.add('hidden');
    resultsList.innerHTML = '';
    downloadAllBtn.classList.add('hidden');
    if (resetAllBtn) resetAllBtn.classList.add('hidden');
    setProgress(0, 0);
    clearMessage();
    syncConvertState();

    activeUrls.forEach((url) => URL.revokeObjectURL(url));
    activeUrls = [];
  };

  const renderThumbs = () => {
    if (!thumbGrid) return;
    if (selectedFiles.length === 0) {
      thumbGrid.hidden = true;
      thumbGrid.innerHTML = '';
      return;
    }
    thumbGrid.hidden = false;
    thumbGrid.innerHTML = '';
    selectedFiles.forEach((file, index) => {
      const card = document.createElement('div');
      card.className = 'hc-thumb';
      card.innerHTML = `
        <button type="button" class="hc-thumb-remove" data-thumb-remove="${index}" aria-label="Remove ${file.name}">✕</button>
        <div class="hc-thumb-icon">🖼️</div>
        <div class="hc-thumb-name" title="${file.name}">${file.name}</div>
        <div class="hc-thumb-meta">${bytesToLabel(file.size)}</div>
      `;
      thumbGrid.appendChild(card);
    });
    thumbGrid.querySelectorAll('[data-thumb-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-thumb-remove'), 10);
        selectedFiles.splice(idx, 1);
        renderThumbs();
        renderPreview();
        syncConvertState();
        if (selectedFiles.length === 0) resetTool();
      });
    });
  };

  const renderPreview = () => {
    if (selectedFiles.length === 0) {
      previewPanel.hidden = true;
      return;
    }
    previewPanel.hidden = false;
    fileCountText.textContent = `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`;
  };

  const computeResizedDims = (naturalWidth, naturalHeight) => {
    if (!resizeEnable || !resizeEnable.checked) return { width: naturalWidth, height: naturalHeight };
    const targetW = parseInt(resizeWidth.value, 10);
    const targetH = parseInt(resizeHeight.value, 10);
    const lockAspect = resizeAspect ? resizeAspect.checked : true;
    const ratio = naturalWidth / naturalHeight;

    if (lockAspect) {
      if (targetW > 0) return { width: targetW, height: Math.round(targetW / ratio) };
      if (targetH > 0) return { width: Math.round(targetH * ratio), height: targetH };
      return { width: naturalWidth, height: naturalHeight };
    }
    return {
      width: targetW > 0 ? targetW : naturalWidth,
      height: targetH > 0 ? targetH : naturalHeight,
    };
  };

  const heicFileToJpegBlob = async (file) => {
    if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      if (typeof heic2any === 'undefined') throw new Error('HEIC converter library not available');
      return heic2any({ blob: file, toType: 'image/jpeg' });
    }
    return file;
  };

  const blobToImage = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(blob);
    });

  const drawToCanvas = (img) => {
    const dims = computeResizedDims(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, dims.width, dims.height);
    return canvas;
  };

  const canvasToBlobAsync = (canvas, mimeType, quality) =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to encode image'));
            return;
          }
          resolve(blob);
        },
        mimeType,
        quality
      );
    });

  const convertHeicToFormat = async (file, format, quality) => {
    const heicBlob = await heicFileToJpegBlob(file);
    const img = await blobToImage(heicBlob);
    const canvas = drawToCanvas(img);
    const meta = formatMeta[format] || formatMeta.jpeg;
    const outputBlob = await canvasToBlobAsync(canvas, meta.mime, parseFloat(quality));
    const actualIsAvif = format !== 'avif' || outputBlob.type === 'image/avif';
    return {
      blob: outputBlob,
      extension: meta.ext,
      mimeType: meta.mime,
      originalName: file.name,
      originalSize: file.size,
      width: canvas.width,
      height: canvas.height,
      avifUnsupported: format === 'avif' && !actualIsAvif,
    };
  };

  const applyFilenamePrefix = (baseName) => {
    const prefix = filenamePrefixInput ? filenamePrefixInput.value.trim().replace(/[\\/:*?"<>|]/g, '') : '';
    return prefix ? `${prefix}${baseName}` : baseName;
  };

  const displayResults = () => {
    resultsContainer.classList.remove('hidden');
    resultsList.innerHTML = '';

    convertedImages.forEach((result) => {
      const sizeDelta = result.originalSize ? Math.round((1 - result.blob.size / result.originalSize) * 100) : null;
      const deltaLabel =
        sizeDelta === null
          ? ''
          : sizeDelta >= 0
          ? `<span class="hc-save">▼ ${sizeDelta}% smaller</span>`
          : `<span>▲ ${Math.abs(sizeDelta)}% larger</span>`;
      const resultItem = document.createElement('div');
      resultItem.className = 'hc-result-item';
      resultItem.innerHTML = `
        <img class="hc-result-thumb" src="${result.url}" alt="Converted preview of ${result.originalName}" loading="lazy" />
        <div class="hc-result-info">
          <p class="hc-result-name">${result.convertedName}</p>
          <p class="hc-result-meta">${result.originalSize ? bytesToLabel(result.originalSize) + ' → ' : ''}${bytesToLabel(result.blob.size)} ${deltaLabel}</p>
        </div>
        <a href="${result.url}" download="${result.convertedName}" class="secondary-btn" style="margin: 0; padding: 8px 16px; font-size: 13px;">⬇️ Download</a>
      `;
      resultsList.appendChild(resultItem);
    });

    if (convertedImages.length > 1) {
      downloadAllBtn.classList.remove('hidden');
    }
    if (resetAllBtn) resetAllBtn.classList.remove('hidden');
  };

  const handleConvertToImages = async (format, quality) => {
    let avifFellBack = false;
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      setProgress(i, selectedFiles.length);
      showMessage(`Converting image ${i + 1} of ${selectedFiles.length}...`, 'success');

      try {
        const result = await convertHeicToFormat(file, format, quality);
        if (result.avifUnsupported) avifFellBack = true;

        const url = URL.createObjectURL(result.blob);
        activeUrls.push(url);

        const baseName = file.name.replace(/\.(heic|heif)$/i, '');
        convertedImages.push({
          blob: result.blob,
          url: url,
          originalName: file.name,
          originalSize: result.originalSize,
          convertedName: `${applyFilenamePrefix(baseName)}${result.extension}`,
        });
      } catch (error) {
        showMessage(`Failed to convert ${file.name}: ${error.message}`, 'error');
      }
    }
    setProgress(selectedFiles.length, selectedFiles.length);
    return avifFellBack;
  };

  const handleConvertToPdf = async (quality) => {
    if (typeof window.jspdf === 'undefined') throw new Error('PDF library not available');
    const { jsPDF } = window.jspdf;
    let doc = null;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      setProgress(i, selectedFiles.length);
      showMessage(`Adding image ${i + 1} of ${selectedFiles.length} to PDF...`, 'success');

      try {
        const heicBlob = await heicFileToJpegBlob(file);
        const img = await blobToImage(heicBlob);
        const canvas = drawToCanvas(img);
        const dataUrl = canvas.toDataURL('image/jpeg', parseFloat(quality));
        const orientation = canvas.width >= canvas.height ? 'l' : 'p';

        if (!doc) {
          doc = new jsPDF({ orientation, unit: 'px', format: [canvas.width, canvas.height] });
          doc.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
        } else {
          doc.addPage([canvas.width, canvas.height], orientation);
          doc.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
        }
      } catch (error) {
        showMessage(`Failed to add ${file.name} to PDF: ${error.message}`, 'error');
      }
    }
    setProgress(selectedFiles.length, selectedFiles.length);
    if (!doc) return;

    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    activeUrls.push(url);
    convertedImages.push({
      blob: pdfBlob,
      url: url,
      originalName: `${selectedFiles.length} image(s)`,
      originalSize: selectedFiles.reduce((sum, f) => sum + f.size, 0),
      convertedName: `${applyFilenamePrefix('converted-images')}.pdf`,
    });
  };

  const handleConvert = async () => {
    if (selectedFiles.length === 0) {
      showMessage('Please select at least one image.', 'error');
      return;
    }

    try {
      clearMessage();
      toggleLoader(true);
      convertedImages = [];

      const format = outputFormatSelect.value;
      const quality = qualitySelect.value;
      let avifFellBack = false;

      if (format === 'pdf') {
        await handleConvertToPdf(quality);
      } else {
        avifFellBack = await handleConvertToImages(format, quality);
      }

      if (convertedImages.length === 0) {
        showMessage('Failed to convert any images.', 'error');
        toggleLoader(false);
        setProgress(0, 0);
        return;
      }

      displayResults();
      const suffix = avifFellBack ? ' Note: your browser does not support AVIF encoding, so PNG was used instead.' : '';
      showMessage(`✅ Successfully converted ${convertedImages.length} image${convertedImages.length > 1 ? 's' : ''}!${suffix}`, avifFellBack ? 'error' : 'success');
    } catch (error) {
      showMessage(error.message, 'error');
      console.error('Conversion error:', error);
    } finally {
      toggleLoader(false);
    }
  };

  const downloadAllImages = async () => {
    try {
      if (convertedImages.length === 0) {
        showMessage('No images to download.', 'error');
        return;
      }

      toggleLoader(true);
      showMessage('Creating ZIP file...', 'success');

      const zip = new JSZip();
      convertedImages.forEach((img) => {
        zip.file(img.convertedName, img.blob);
      });

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob);
      activeUrls.push(url);

      const link = document.createElement('a');
      link.href = url;
      link.download = 'converted-images.zip';
      link.click();

      showMessage('✅ ZIP file downloaded successfully!', 'success');
    } catch (error) {
      showMessage(`Failed to create ZIP: ${error.message}`, 'error');
    } finally {
      toggleLoader(false);
    }
  };

  const handleFileSelect = (files) => {
    if (!files || files.length === 0) return;

    for (const file of files) {
      if (!file.type.includes('heic') && !file.type.includes('heif') && !file.name.toLowerCase().endsWith('.heic') && !file.name.toLowerCase().endsWith('.heif')) {
        showMessage(`⚠️ ${file.name} is not a HEIC/HEIF file. Please select valid HEIC images.`, 'error');
        return;
      }
    }

    selectedFiles = selectedFiles.concat(Array.from(files));
    clearMessage();
    renderPreview();
    renderThumbs();
    syncConvertState();
    showMessage(`${selectedFiles.length} image${selectedFiles.length > 1 ? 's' : ''} selected. Click "Convert Images" to start.`, 'success');
  };

  // Event listeners
  filePickers.forEach((picker) => {
    picker.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  });

  fileInput.addEventListener('change', (e) => {
    handleFileSelect(e.target.files);
    fileInput.value = '';
  });

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('active');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('active');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('active');

    const files = e.dataTransfer?.files;
    if (files) handleFileSelect(files);
  });

  convertButton.addEventListener('click', handleConvert);
  if (stickyConvertBtn) stickyConvertBtn.addEventListener('click', handleConvert);
  downloadAllBtn.addEventListener('click', downloadAllImages);
  resetButton.addEventListener('click', resetTool);
  if (resetAllBtn) resetAllBtn.addEventListener('click', resetTool);

  if (resizeEnable) {
    resizeEnable.addEventListener('change', () => {
      const enabled = resizeEnable.checked;
      resizeWidth.disabled = !enabled;
      resizeHeight.disabled = !enabled;
      resizeAspect.disabled = !enabled;
    });
  }

  scrollToToolBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tool = document.getElementById('hc-tool');
      (tool || dropZone).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (formatPickers.length && outputFormatSelect) {
    formatPickers.forEach((chip) => {
      chip.addEventListener('click', () => {
        const value = chip.getAttribute('data-format-pick');
        if (!value) return;
        outputFormatSelect.value = value;
        syncFormatChips(value);
        outputFormatSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    outputFormatSelect.addEventListener('change', () => {
      syncFormatChips(outputFormatSelect.value);
    });
    syncFormatChips(outputFormatSelect.value);
  }

  if (stickyBar) stickyBar.classList.add('is-visible');

  syncConvertState();
}
