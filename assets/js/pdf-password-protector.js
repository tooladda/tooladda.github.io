const passwordProtectorSection = document.querySelector('[data-pdf-password-protector]');

if (passwordProtectorSection) {
  const PDFJS_VERSION = '4.2.67';

  const fileInput = passwordProtectorSection.querySelector('[data-file-input]');
  const filePickers = Array.from(passwordProtectorSection.querySelectorAll('[data-file-picker]'));
  const dropZone = passwordProtectorSection.querySelector('[data-drop-zone]');
  const previewPanel = passwordProtectorSection.querySelector('[data-file-preview]');
  const fileNameText = passwordProtectorSection.querySelector('[data-file-name]');
  const fileSizeText = passwordProtectorSection.querySelector('[data-file-size]');
  const pageCountText = passwordProtectorSection.querySelector('[data-page-count]');
  const passwordInput = passwordProtectorSection.querySelector('[data-password-input]');
  const confirmPasswordInput = passwordProtectorSection.querySelector('[data-confirm-password-input]');
  const togglePasswordBtns = Array.from(passwordProtectorSection.querySelectorAll('[data-toggle-password]'));
  const strengthBar = passwordProtectorSection.querySelector('[data-strength-bar]');
  const strengthLabel = passwordProtectorSection.querySelector('[data-strength-label]');
  const strengthHint = passwordProtectorSection.querySelector('[data-strength-hint]');
  const mismatchAlert = passwordProtectorSection.querySelector('[data-mismatch-alert]');
  const configPanel = passwordProtectorSection.querySelector('[data-config-panel]');
  const resultPanel = passwordProtectorSection.querySelector('[data-result-panel]');
  const progressWrap = passwordProtectorSection.querySelector('[data-progress-wrap]');
  const progressFill = passwordProtectorSection.querySelector('[data-progress-fill]');
  const progressText = passwordProtectorSection.querySelector('[data-progress-text]');
  const protectButton = passwordProtectorSection.querySelector('[data-protect-btn]');
  const downloadLinks = Array.from(passwordProtectorSection.querySelectorAll('[data-download-link]'));
  const protectAnotherBtn = passwordProtectorSection.querySelector('[data-protect-another]');
  const messageBox = passwordProtectorSection.querySelector('[data-message]');
  const loader = passwordProtectorSection.querySelector('[data-loader]');
  const resetButton = passwordProtectorSection.querySelector('[data-reset-btn]');
  const stepIndicators = Array.from(passwordProtectorSection.querySelectorAll('[data-step-indicator]'));
  const permPrinting = passwordProtectorSection.querySelector('[data-perm-printing]');
  const permCopying = passwordProtectorSection.querySelector('[data-perm-copying]');
  const permEditing = passwordProtectorSection.querySelector('[data-perm-editing]');
  const stickyCta = document.querySelector('[data-sticky-protect-cta]');

  let sourceFile = null;
  let sourceBytes = null;
  let pageCount = 0;
  let activeUrl = null;
  let pdfjsLibPromise = null;

  const STRENGTH_LEVELS = [
    { label: 'Weak', className: 'is-weak', hint: 'Add length, numbers, and symbols — avoid common words.' },
    { label: 'Medium', className: 'is-medium', hint: 'Better, but longer passphrases are safer for PDFs.' },
    { label: 'Strong', className: 'is-strong', hint: 'Good choice for contracts, tax files, and HR docs.' },
    { label: 'Very Strong', className: 'is-very-strong', hint: 'Excellent — store it in a password manager.' },
  ];

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
      });
    }
    return pdfjsLibPromise;
  };

  const setStep = (step) => {
    stepIndicators.forEach((el) => {
      const n = el.getAttribute('data-step-indicator');
      el.classList.toggle('is-active', n === step);
      el.classList.toggle('is-done', (step === 'config' && n === 'upload') || (step === 'result' && (n === 'upload' || n === 'config')));
    });
    if (dropZone) dropZone.classList.toggle('hidden', step !== 'upload' && sourceFile);
    if (configPanel) configPanel.classList.toggle('hidden', !sourceFile || step === 'result');
    if (resultPanel) resultPanel.classList.toggle('hidden', step !== 'result');
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

  const toggleLoader = (visible) => {
    loader.classList.toggle('hidden', !visible);
    protectButton.disabled = visible;
    filePickers.forEach((picker) => { picker.disabled = visible; });
    if (resetButton) resetButton.disabled = visible;
    passwordInput.disabled = visible;
    confirmPasswordInput.disabled = visible;
    [permPrinting, permCopying, permEditing].forEach((el) => { if (el) el.disabled = visible; });
  };

  const updateStrengthMeter = () => {
    const password = passwordInput.value;
    if (!strengthBar || !strengthLabel) return;

    strengthBar.className = 'pp-strength-bar';
    if (!password) {
      strengthBar.style.width = '0%';
      strengthLabel.textContent = 'Enter a password';
      strengthLabel.className = 'pp-strength-label';
      if (strengthHint) strengthHint.textContent = 'Use at least 8 characters. Mix letters, numbers, and symbols for sensitive PDFs.';
      return;
    }

    let score = 0;
    if (window.zxcvbn) {
      score = window.zxcvbn(password).score;
    } else {
      score = password.length >= 12 ? 3 : password.length >= 8 ? 2 : password.length >= 6 ? 1 : 0;
    }

    const level = STRENGTH_LEVELS[Math.min(score, 3)];
    const width = [25, 50, 75, 100][Math.min(score, 3)];
    strengthBar.style.width = `${width}%`;
    strengthBar.classList.add(level.className);
    strengthLabel.textContent = level.label;
    strengthLabel.className = `pp-strength-label ${level.className}`;
    if (strengthHint) strengthHint.textContent = level.hint;
  };

  const updateMismatchAlert = () => {
    if (!mismatchAlert) return;
    const password = passwordInput.value;
    const confirm = confirmPasswordInput.value;
    const show = confirm.length > 0 && password !== confirm;
    mismatchAlert.classList.toggle('hidden', !show);
    mismatchAlert.setAttribute('aria-hidden', show ? 'false' : 'true');
  };

  const bindTogglePassword = (btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-target');
      const input = targetId ? passwordProtectorSection.querySelector(`#${targetId}`) : passwordInput;
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      btn.textContent = isPassword ? '🙈' : '👁️';
    });
  };

  togglePasswordBtns.forEach(bindTogglePassword);

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

  const resetTool = () => {
    sourceFile = null;
    sourceBytes = null;
    pageCount = 0;
    fileInput.value = '';
    passwordInput.value = '';
    confirmPasswordInput.value = '';
    if (previewPanel) previewPanel.hidden = true;
    hideDownload();
    hideProgress();
    clearMessage();
    updateStrengthMeter();
    updateMismatchAlert();
    if (permPrinting) permPrinting.checked = true;
    if (permCopying) permCopying.checked = false;
    if (permEditing) permEditing.checked = false;
    setStep('upload');
    if (dropZone) dropZone.classList.remove('hidden');
  };

  const renderPreview = () => {
    if (!sourceFile || !previewPanel) return;
    previewPanel.hidden = false;
    fileNameText.textContent = sourceFile.name;
    fileSizeText.textContent = formatBytes(sourceFile.size);
    if (pageCountText) pageCountText.textContent = String(pageCount);
    setStep('config');
  };

  const openFilePicker = () => fileInput.click();

  const handleFileLoad = async (file) => {
    const isPdfType = file && file.type === 'application/pdf';
    const isPdfExtension = file && file.name && file.name.toLowerCase().endsWith('.pdf');
    if (!file || (!isPdfType && !isPdfExtension)) {
      throw new Error('Please select a valid PDF file.');
    }

    sourceFile = file;
    sourceBytes = new Uint8Array(await file.arrayBuffer());

    const pdfjsLib = await loadPdfJs();
    const doc = await pdfjsLib.getDocument({ data: sourceBytes.slice(), useWorkerFetch: false, isEvalSupported: false }).promise;
    pageCount = doc.numPages;
    doc.destroy();

    renderPreview();
  };

  const validatePasswords = () => {
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!password || !confirmPassword) {
      throw new Error('Please enter and confirm your PDF password.');
    }
    if (password.length < 4) {
      throw new Error('Password must be at least 4 characters (8+ recommended for sensitive files).');
    }
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match. Check both fields and try again.');
    }
    if (window.zxcvbn && window.zxcvbn(password).score < 1 && password.length < 10) {
      throw new Error('Password is too weak for a protected PDF. Use a longer passphrase or enable a password manager suggestion.');
    }
  };

  const getPermissionOptions = () => {
    const allowPrint = permPrinting ? permPrinting.checked : true;
    const allowCopy = permCopying ? permCopying.checked : false;
    const allowEdit = permEditing ? permEditing.checked : false;
    return {
      allowPrinting: allowPrint,
      allowModifying: allowEdit,
      allowCopying: allowCopy,
      allowAnnotating: allowEdit,
      allowFillingForms: allowEdit,
      allowExtraction: allowCopy,
      allowAssembly: false,
      allowHighQualityPrint: allowPrint,
    };
  };

  const protectPdf = async () => {
    if (!sourceFile || !sourceBytes) {
      throw new Error('Upload a PDF file before protecting it.');
    }

    validatePasswords();
    const password = passwordInput.value;
    const permissions = getPermissionOptions();

    setProgress(15, 'Loading encryption module…');
    const { encryptPDF } = await import('https://cdn.jsdelivr.net/npm/@pdfsmaller/pdf-encrypt@1.0.2/+esm');

    setProgress(45, 'Encrypting PDF in your browser…');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const encryptedBytes = await encryptPDF(sourceBytes, password, permissions);

    setProgress(90, 'Preparing download…');

    hideDownload();
    const blob = new Blob([encryptedBytes], { type: 'application/pdf' });
    activeUrl = URL.createObjectURL(blob);
    const downloadName = `${sourceFile.name.replace(/\.pdf$/i, '')}-protected.pdf`;

    downloadLinks.forEach((link) => {
      link.href = activeUrl;
      link.download = downloadName;
      link.classList.remove('hidden');
    });

    setProgress(100, 'PDF secured!');
    setStep('result');
  };

  const triggerDownload = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!activeUrl) return;
    const link = document.createElement('a');
    link.href = activeUrl;
    link.download = downloadLinks[0]?.download || `${sourceFile?.name?.replace(/\.pdf$/i, '') || 'document'}-protected.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        await handleFileLoad(event.target.files[0]);
        showMessage('PDF loaded. Set a strong password and click Protect PDF.', 'success');
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
        await handleFileLoad(file);
        showMessage('PDF loaded. Set a strong password and click Protect PDF.', 'success');
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
            await handleFileLoad(file);
            showMessage('PDF pasted. Set a strong password and click Protect PDF.', 'success');
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

  passwordInput.addEventListener('input', () => {
    updateStrengthMeter();
    updateMismatchAlert();
  });

  confirmPasswordInput.addEventListener('input', updateMismatchAlert);

  protectButton.addEventListener('click', async () => {
    try {
      toggleLoader(true);
      clearMessage();
      await protectPdf();
      showMessage('Your PDF is password protected. Download the secured copy below.', 'success');
    } catch (error) {
      hideProgress();
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  });

  downloadLinks.forEach((link) => link.addEventListener('click', triggerDownload));
  if (resetButton) resetButton.addEventListener('click', resetTool);
  if (protectAnotherBtn) protectAnotherBtn.addEventListener('click', resetTool);

  if (stickyCta) {
    stickyCta.addEventListener('click', () => {
      passwordProtectorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!sourceFile) openFilePicker();
      else if (resultPanel && !resultPanel.classList.contains('hidden')) resetTool();
      else passwordInput.focus();
    });
  }

  resetTool();
}
