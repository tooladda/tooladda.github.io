const passwordRemoverSection = document.querySelector('[data-pdf-password-remover]');

if (passwordRemoverSection) {
  const PDFJS_VERSION = '4.2.67';
  let pdfjsLibPromise = null;

  const fileInput = passwordRemoverSection.querySelector('[data-file-input]');
  const filePickers = Array.from(passwordRemoverSection.querySelectorAll('[data-file-picker]'));
  const dropZone = passwordRemoverSection.querySelector('[data-drop-zone]');
  const previewPanel = passwordRemoverSection.querySelector('[data-file-preview]');
  const fileNameText = passwordRemoverSection.querySelector('[data-file-name]');
  const fileSizeText = passwordRemoverSection.querySelector('[data-file-size]');
  const pageCountText = passwordRemoverSection.querySelector('[data-page-count]');
  const lockStatusText = passwordRemoverSection.querySelector('[data-lock-status]');
  const passwordPanel = passwordRemoverSection.querySelector('[data-password-panel]');
  const passwordInput = passwordRemoverSection.querySelector('[data-password-input]');
  const togglePasswordBtn = passwordRemoverSection.querySelector('[data-toggle-password]');
  const capsWarning = passwordRemoverSection.querySelector('[data-caps-warning]');
  const unlockButton = passwordRemoverSection.querySelector('[data-unlock-btn]');
  const downloadLinks = Array.from(passwordRemoverSection.querySelectorAll('[data-download-link]'));
  const unlockAnotherBtn = passwordRemoverSection.querySelector('[data-unlock-another]');
  const resultPanel = passwordRemoverSection.querySelector('[data-result-panel]');
  const resultMeta = passwordRemoverSection.querySelector('[data-result-meta]');
  const progressWrap = passwordRemoverSection.querySelector('[data-progress-wrap]');
  const progressFill = passwordRemoverSection.querySelector('[data-progress-fill]');
  const progressText = passwordRemoverSection.querySelector('[data-progress-text]');
  const messageBox = passwordRemoverSection.querySelector('[data-message]');
  const loader = passwordRemoverSection.querySelector('[data-loader]');
  const resetButton = passwordRemoverSection.querySelector('[data-reset-btn]');
  const stepIndicators = Array.from(passwordRemoverSection.querySelectorAll('[data-step-indicator]'));
  const stickyCta = document.querySelector('[data-sticky-unlock-cta]');
  const stickyBar = stickyCta ? stickyCta.closest('.pu-sticky-cta') : null;
  const phoneQuery = window.matchMedia('(max-width: 768px)');

  let sourceFile = null;
  let sourceBytes = null;
  let isEncrypted = false;
  let pageCount = null;
  let activeUrl = null;
  let busy = false;
  let currentStep = 'upload';
  // The phone bar stands in for a control that has scrolled away; these track
  // whether each of those controls is on screen.
  const inView = { tool: true, unlock: false, download: false };

  // Raised when a library cannot be fetched at all, so the visitor is told to
  // check the connection instead of being told their password is wrong.
  const networkError = (what) => {
    const err = new Error(`Could not load the ${what}. Check your internet connection and try again — your file has not been sent anywhere.`);
    err.isNetwork = true;
    return err;
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const loadPdfJs = () => {
    if (!pdfjsLibPromise) {
      pdfjsLibPromise = import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`).then((module) => {
        const lib = module.default || module;
        if (lib.GlobalWorkerOptions) {
          lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
        }
        return lib;
      }).catch(() => {
        // A failed import used to be cached for the life of the tab, so every
        // later file failed too until the page was reloaded.
        pdfjsLibPromise = null;
        throw networkError('PDF reader');
      });
    }
    return pdfjsLibPromise;
  };

  const isPasswordError = (lib, err) => {
    if (lib.PasswordException && err instanceof lib.PasswordException) return true;
    return /password/i.test(err.message || '');
  };

  const inspectPdf = async (bytes) => {
    const lib = await loadPdfJs();
    try {
      const doc = await lib.getDocument({ data: bytes.slice(0), useWorkerFetch: false, isEvalSupported: false }).promise;
      const count = doc.numPages;
      await doc.destroy();
      return { encrypted: false, pageCount: count };
    } catch (err) {
      if (isPasswordError(lib, err)) {
        return { encrypted: true, pageCount: null };
      }
      // pdf.js says "Invalid PDF structure." — true, but not something a
      // visitor can act on.
      throw new Error('This file could not be read as a PDF. It may be damaged, or not really a PDF.');
    }
  };

  const setStep = (step) => {
    currentStep = step;
    const order = ['upload', 'password', 'result'];
    const index = order.indexOf(step);
    stepIndicators.forEach((el) => {
      const i = order.indexOf(el.getAttribute('data-step-indicator'));
      el.classList.toggle('is-active', i === index);
      el.classList.toggle('is-done', i < index || (step === 'result' && i === index));
      if (i === index) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    if (dropZone) dropZone.classList.toggle('hidden', step !== 'upload' && !!sourceFile);
    if (passwordPanel) passwordPanel.classList.toggle('hidden', !sourceFile || step === 'result');
    if (resultPanel) resultPanel.classList.toggle('hidden', step !== 'result');
    updateSticky();
  };

  /* Phone bottom bar: open the picker while the tool is off screen and empty,
     unlock once a file is in and the real button has scrolled away, then
     download once the result's own button is off screen. It used to sit there
     permanently, and a tap after a successful unlock reset the tool and threw
     the unlocked file away. */
  function updateSticky() {
    if (!stickyBar || !stickyCta) return;
    let label = 'Unlock PDF';
    let show = false;
    if (phoneQuery.matches && !busy) {
      if (currentStep === 'result') {
        label = 'Download unlocked PDF';
        show = !inView.download;
      } else if (sourceFile) {
        show = !inView.unlock;
      } else {
        show = !inView.tool;
      }
    }
    if (stickyCta.textContent !== label) stickyCta.textContent = label;
    stickyBar.classList.toggle('is-visible', show);
    stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    stickyCta.tabIndex = show ? 0 : -1;
    const was = document.body.classList.contains('pu-sticky-on');
    document.body.classList.toggle('pu-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }

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

  const hideDownload = () => {
    downloadLinks.forEach((link) => {
      link.classList.add('hidden');
      link.removeAttribute('href');
    });
    if (activeUrl) {
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }
  };

  const toggleLoader = (visible) => {
    busy = visible;
    loader.classList.toggle('hidden', !visible);
    unlockButton.disabled = visible;
    filePickers.forEach((picker) => { picker.disabled = visible; });
    if (resetButton) resetButton.disabled = visible;
    passwordInput.disabled = visible;
    updateSticky();
  };

  const clearPassword = () => {
    passwordInput.value = '';
    passwordInput.removeAttribute('aria-invalid');
    if (capsWarning) capsWarning.classList.add('hidden');
  };

  const resetTool = () => {
    sourceFile = null;
    sourceBytes = null;
    isEncrypted = false;
    pageCount = null;
    fileInput.value = '';
    clearPassword();
    if (previewPanel) previewPanel.hidden = true;
    if (resultMeta) resultMeta.textContent = '';
    hideDownload();
    hideProgress();
    clearMessage();
    setStep('upload');
    if (dropZone) dropZone.classList.remove('hidden');
  };

  const renderPreview = () => {
    if (!sourceFile || !previewPanel) return;
    previewPanel.hidden = false;
    fileNameText.textContent = sourceFile.name;
    fileSizeText.textContent = formatBytes(sourceFile.size);
    if (pageCountText) {
      pageCountText.textContent = pageCount != null ? String(pageCount) : '—';
    }
    if (lockStatusText) {
      lockStatusText.textContent = isEncrypted ? '🔒 Password protected' : '🔓 Not encrypted';
      lockStatusText.className = `pu-lock-status${isEncrypted ? ' is-locked' : ' is-open'}`;
    }
    setStep('password');
  };

  const openFilePicker = () => fileInput.click();

  const handleFileLoad = async (file) => {
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
      throw new Error('Please select a valid PDF file.');
    }

    // Only commit to the new file once it has been read successfully: a
    // damaged file (or a dropped connection) used to leave the tool holding
    // a half-loaded file and the previous one gone.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = await inspectPdf(bytes);

    sourceFile = file;
    sourceBytes = bytes;
    isEncrypted = info.encrypted;
    pageCount = info.pageCount;
    hideDownload();
    hideProgress();
    clearPassword();
    if (resultMeta) resultMeta.textContent = '';

    renderPreview();

    if (!isEncrypted) {
      showMessage('This PDF does not appear to require a password. You can still try unlocking if it has permission restrictions.', 'success');
    }
  };

  const verifyPasswordWithPdfJs = async (bytes, password) => {
    const lib = await loadPdfJs();
    try {
      const doc = await lib.getDocument({ data: bytes.slice(0), password, useWorkerFetch: false, isEvalSupported: false }).promise;
      const numPages = doc.numPages;
      await doc.destroy();
      if (!numPages) throw new Error('This PDF appears to have no pages.');
      pageCount = numPages;
      if (pageCountText) pageCountText.textContent = String(numPages);
      return numPages;
    } catch (err) {
      if (isPasswordError(lib, err)) {
        const wrong = new Error('Incorrect password. Enter the correct PDF password — this tool cannot crack unknown passwords.');
        wrong.isWrongPassword = true;
        throw wrong;
      }
      throw new Error(err.message || 'Could not open this PDF.');
    }
  };

  const validateUnlockedPdf = async (unlockedPdf, expectedPages) => {
    if (!unlockedPdf || unlockedPdf.length < 128) {
      throw new Error('Incorrect password — the unlocked file is empty or invalid.');
    }

    if (!window.PDFLib || !PDFLib.PDFDocument) return;

    try {
      const doc = await PDFLib.PDFDocument.load(unlockedPdf);
      const count = doc.getPageCount();
      if (!count) throw new Error('Incorrect password — no pages could be decrypted.');
      if (expectedPages && count !== expectedPages) {
        throw new Error('Incorrect password — decrypted content does not match the original PDF.');
      }
    } catch (err) {
      if (/Incorrect password/i.test(err.message || '')) throw err;
      throw new Error('Incorrect password. The PDF could not be unlocked with that password.');
    }
  };

  const DECRYPT_SOURCES = [
    'https://esm.sh/@pdfsmaller/pdf-decrypt@1.0.1/es2022/pdf-decrypt.mjs',
    'https://cdn.jsdelivr.net/npm/@pdfsmaller/pdf-decrypt@1.0.2/+esm',
  ];

  const decryptWithCdnLibrary = async (bytes, password) => {
    let lastError = null;
    let loadedAny = false;
    for (const src of DECRYPT_SOURCES) {
      let mod;
      try {
        mod = await import(src);
        loadedAny = true;
      } catch (err) {
        lastError = err;
        continue;
      }
      try {
        return await mod.decryptPDF(bytes, password);
      } catch (err) {
        lastError = err;
      }
    }
    if (!loadedAny) throw networkError('unlock engine');
    throw lastError;
  };

  const decryptWithPdfLib = async (bytes, password) => {
    if (!window.PDFLib || !PDFLib.PDFDocument) {
      throw new Error('PDF library failed to load. Refresh the page and try again.');
    }

    const { PDFDocument } = PDFLib;
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(bytes, { password });
    } catch (loadErr) {
      if (/password/i.test(loadErr.message || '')) {
        throw new Error('Incorrect password. Enter the correct PDF password and try again.');
      }
      throw new Error('Could not decrypt this PDF with the password provided.');
    }

    const newPdf = await PDFDocument.create();
    const count = pdfDoc.getPageCount();
    if (!count) throw new Error('Incorrect password — no pages could be decrypted.');
    const indices = Array.from({ length: count }, (_, i) => i);
    const copiedPages = await newPdf.copyPages(pdfDoc, indices);
    copiedPages.forEach((page) => newPdf.addPage(page));
    return newPdf.save();
  };

  const unlockPdf = async () => {
    if (!sourceFile || !sourceBytes) {
      throw new Error('Upload a PDF file before unlocking it.');
    }

    const password = passwordInput.value;
    if (!password) {
      const empty = new Error('Enter the PDF password to unlock the document.');
      empty.isWrongPassword = true;
      throw empty;
    }

    hideDownload();
    setProgress(20, 'Verifying password…');

    const expectedPages = await verifyPasswordWithPdfJs(sourceBytes, password);

    setProgress(50, 'Removing password protection…');
    let unlockedPdf;
    let engineError = null;
    try {
      unlockedPdf = await decryptWithCdnLibrary(sourceBytes, password);
    } catch (err) {
      engineError = err;
    }
    if (!unlockedPdf) {
      try {
        unlockedPdf = await decryptWithPdfLib(sourceBytes, password);
      } catch (err) {
        // pdf-lib cannot decrypt, so for a locked file it only ever fails —
        // and its message would blame the password. When the real problem is
        // that the unlock engine never loaded, say that instead.
        if (engineError && engineError.isNetwork) throw engineError;
        throw err;
      }
    }

    setProgress(80, 'Validating unlocked PDF…');
    await validateUnlockedPdf(unlockedPdf, expectedPages);

    const blob = new Blob([unlockedPdf], { type: 'application/pdf' });
    activeUrl = URL.createObjectURL(blob);
    const downloadName = `${sourceFile.name.replace(/\.pdf$/i, '')}-unlocked.pdf`;

    downloadLinks.forEach((link) => {
      link.href = activeUrl;
      link.download = downloadName;
      link.classList.remove('hidden');
    });
    if (resultMeta) resultMeta.textContent = `${expectedPages} page${expectedPages === 1 ? '' : 's'} · ${formatBytes(blob.size)}`;
    // The strip above describes the file on screen; it should not go on saying
    // "Password protected" next to a result that says it is not.
    if (lockStatusText) {
      lockStatusText.textContent = '🔓 Unlocked copy ready';
      lockStatusText.className = 'pu-lock-status is-open';
    }

    setProgress(100, 'Done!');
    hideProgress();
    // The password has done its job; it should not sit in the page any longer
    // than that.
    clearPassword();
    setStep('result');
    if (resultPanel) {
      requestAnimationFrame(() => resultPanel.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'nearest',
      }));
    }
  };

  const triggerDownload = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!activeUrl) return;
    const link = document.createElement('a');
    link.href = activeUrl;
    link.download = downloadLinks[0]?.download || `${sourceFile?.name?.replace(/\.pdf$/i, '') || 'document'}-unlocked.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadWithFeedback = async (file, lockedMessage) => {
    if (busy) return;
    let loaded = false;
    try {
      toggleLoader(true);
      clearMessage();
      await handleFileLoad(file);
      loaded = true;
      if (isEncrypted) showMessage(lockedMessage, 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
    // The field is disabled while loading, so focus waits until now. Not on a
    // phone, where it would throw the keyboard up over the page.
    if (loaded && isEncrypted && !phoneQuery.matches) passwordInput.focus({ preventScroll: true });
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

  fileInput.addEventListener('change', async (event) => {
    if (event.target.files.length > 0) {
      await loadWithFeedback(event.target.files[0], 'Locked PDF loaded. Enter the password you are authorized to use.');
    }
    // cleared so choosing the same file again still fires `change`
    event.target.value = '';
  });

  /* Files can be dropped anywhere on the tool, not only on the drop zone —
     which is hidden once a file is loaded. A PDF dropped anywhere else on the
     page is swallowed rather than left to the browser, which would navigate
     away to show it and lose everything here. */
  const carriesFiles = (event) => !!(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files'));
  let dragDepth = 0;
  passwordRemoverSection.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    passwordRemoverSection.classList.add('is-file-over');
    if (dropZone) dropZone.classList.add('active');
  });
  passwordRemoverSection.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  passwordRemoverSection.addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      passwordRemoverSection.classList.remove('is-file-over');
      if (dropZone) dropZone.classList.remove('active');
    }
  });
  passwordRemoverSection.addEventListener('drop', async (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    passwordRemoverSection.classList.remove('is-file-over');
    if (dropZone) dropZone.classList.remove('active');
    const file = event.dataTransfer.files[0];
    if (file) await loadWithFeedback(file, 'Locked PDF loaded. Enter the password you are authorized to use.');
  });
  ['dragover', 'drop'].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (carriesFiles(event) && !passwordRemoverSection.contains(event.target)) event.preventDefault();
    });
  });

  document.addEventListener('paste', async (event) => {
    const items = (event.clipboardData || {}).items || [];
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].type === 'application/pdf') {
        const file = items[i].getAsFile();
        if (file) {
          event.preventDefault();
          await loadWithFeedback(file, 'Locked PDF pasted. Enter your authorized password.');
        }
        break;
      }
    }
  });

  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      togglePasswordBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      togglePasswordBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  }

  // PDF passwords are case-sensitive, and Caps Lock is the most common reason a
  // password that is "definitely right" gets rejected.
  const checkCaps = (event) => {
    if (!capsWarning || typeof event.getModifierState !== 'function') return;
    capsWarning.classList.toggle('hidden', !event.getModifierState('CapsLock'));
  };
  passwordInput.addEventListener('keydown', checkCaps);
  passwordInput.addEventListener('keyup', checkCaps);
  passwordInput.addEventListener('blur', () => { if (capsWarning) capsWarning.classList.add('hidden'); });
  passwordInput.addEventListener('input', () => passwordInput.removeAttribute('aria-invalid'));

  unlockButton.addEventListener('click', async () => {
    if (busy) return;
    try {
      toggleLoader(true);
      clearMessage();
      hideDownload();
      await unlockPdf();
      showMessage('PDF unlocked successfully. Download the copy below — reset the tool to clear it from memory.', 'success');
    } catch (error) {
      hideProgress();
      hideDownload();
      showMessage(error.message, 'error');
      if (error.isWrongPassword || /Incorrect password/i.test(error.message || '')) {
        passwordInput.setAttribute('aria-invalid', 'true');
        // Straight back to the field with the attempt selected, ready to retype.
        requestAnimationFrame(() => { passwordInput.focus(); passwordInput.select(); });
      }
    } finally {
      toggleLoader(false);
    }
  });

  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !unlockButton.disabled) unlockButton.click();
  });

  downloadLinks.forEach((link) => link.addEventListener('click', triggerDownload));
  if (resetButton) resetButton.addEventListener('click', () => { resetTool(); filePickers[filePickers.length - 1]?.focus(); });
  if (unlockAnotherBtn) {
    unlockAnotherBtn.addEventListener('click', () => {
      resetTool();
      passwordRemoverSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      filePickers[filePickers.length - 1]?.focus({ preventScroll: true });
    });
  }

  if (stickyCta) {
    stickyCta.addEventListener('click', () => {
      if (busy) return;
      if (currentStep === 'result') { triggerDownload(); return; }
      passwordRemoverSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!sourceFile) { openFilePicker(); return; }
      if (passwordInput.value) unlockButton.click();
      else passwordInput.focus({ preventScroll: true });
    });
  }

  // "Unlock PDF now" links: bring the tool up, and with no file yet open the picker.
  document.querySelectorAll('a[href="#pu-tool"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      passwordRemoverSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!sourceFile && !busy) openFilePicker();
    });
  });

  if ('IntersectionObserver' in window) {
    const resultDownload = resultPanel && resultPanel.querySelector('[data-download-link]');
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === passwordRemoverSection) inView.tool = entry.isIntersecting;
        else if (entry.target === unlockButton) inView.unlock = entry.isIntersecting;
        else if (entry.target === resultDownload) inView.download = entry.isIntersecting;
      });
      updateSticky();
    });
    watch.observe(passwordRemoverSection);
    watch.observe(unlockButton);
    if (resultDownload) watch.observe(resultDownload);
  } else {
    inView.tool = false;
  }
  if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);

  resetTool();
}
