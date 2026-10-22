const resizerPage = document.querySelector('[data-resizer-page]');
if (resizerPage) {
  const fileInput = resizerPage.querySelector('[data-file-input]');
  const filePicker = resizerPage.querySelector('[data-file-picker]');
  const dropZone = resizerPage.querySelector('[data-drop-zone]');
  const previewPanel = resizerPage.querySelector('[data-file-preview]');
  const fileNameText = resizerPage.querySelector('[data-file-name]');
  const originalSizeText = resizerPage.querySelector('[data-original-size]');
  const originalDimensionsText = resizerPage.querySelector('[data-original-dimensions]');
  const widthInput = resizerPage.querySelector('[data-width-input]');
  const heightInput = resizerPage.querySelector('[data-height-input]');
  const outputFormatSelect = resizerPage.querySelector('[data-output-format]');
  const lockAspectCheckbox = resizerPage.querySelector('[data-lock-aspect]');
  const resizeButton = resizerPage.querySelector('[data-resize-btn]');
  const downloadLink = resizerPage.querySelector('[data-download-link]');
  const messageBox = resizerPage.querySelector('[data-message]');
  const loader = resizerPage.querySelector('[data-loader]');
  const resetButton = resizerPage.querySelector('[data-reset-btn]');

  let originalFile = null;
  let originalImage = null;
  let aspectRatio = 1;
  let activeUrl = null;

  const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

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
    resizeButton.disabled = visible;
    filePicker.disabled = visible;
    resetButton.disabled = visible;
  };

  const resetTool = () => {
    originalFile = null;
    originalImage = null;
    aspectRatio = 1;
    activeUrl && URL.revokeObjectURL(activeUrl);
    activeUrl = null;
    fileInput.value = '';
    previewPanel.hidden = true;
    fileNameText.textContent = '';
    originalSizeText.textContent = '—';
    originalDimensionsText.textContent = '—';
    widthInput.value = '';
    heightInput.value = '';
    outputFormatSelect.value = 'image/jpeg';
    lockAspectCheckbox.checked = true;
    downloadLink.classList.add('hidden');
    downloadLink.href = '';
    clearMessage();
  };

  const renderPreview = (file, image) => {
    originalFile = file;
    originalImage = image;
    aspectRatio = image.naturalWidth / image.naturalHeight;
    previewPanel.hidden = false;
    fileNameText.textContent = file.name;
    originalSizeText.textContent = formatBytes(file.size);
    originalDimensionsText.textContent = `${image.naturalWidth} x ${image.naturalHeight}`;
    widthInput.value = image.naturalWidth;
    heightInput.value = image.naturalHeight;
  };

  const syncAspect = (source, target) => {
    if (!lockAspectCheckbox.checked || !originalImage) return;
    const value = Number(source.value);
    if (!value || value <= 0) return;
    if (target === heightInput) {
      widthInput.value = Math.round(value * aspectRatio);
    } else {
      heightInput.value = Math.round(value / aspectRatio);
    }
  };

  const resizeImage = async () => {
    if (!originalImage || !originalFile) {
      throw new Error('Upload an image first.');
    }
    const targetWidth = Number(widthInput.value);
    const targetHeight = Number(heightInput.value);
    if (!targetWidth || !targetHeight) {
      throw new Error('Enter valid width and height values.');
    }
    if (targetWidth < 1 || targetHeight < 1) {
      throw new Error('Width and height must be greater than zero.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(originalImage, 0, 0, targetWidth, targetHeight);

    const outputType = outputFormatSelect.value;
    const mimeType = outputType;
    const quality = outputType === 'image/jpeg' || outputType === 'image/webp' ? 0.92 : 1;
    const dataUrl = canvas.toDataURL(mimeType, quality);

    const byteString = atob(dataUrl.split(',')[1]);
    const arrayBuffer = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i += 1) {
      arrayBuffer[i] = byteString.charCodeAt(i);
    }

    const resizedBlob = new Blob([arrayBuffer], { type: mimeType });
    activeUrl && URL.revokeObjectURL(activeUrl);
    activeUrl = URL.createObjectURL(resizedBlob);
    downloadLink.href = activeUrl;
    downloadLink.download = `resized-${originalFile.name}`;
    downloadLink.classList.remove('hidden');
  };

  const handleFileLoad = async (file) => {
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are supported.');
    }
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = imageUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Unable to load image.'));
    });
    renderPreview(file, image);
  };

  filePicker.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (event) => {
    if (!event.target.files.length) return;
    try {
      toggleLoader(true);
      clearMessage();
      await handleFileLoad(event.target.files[0]);
      showMessage('Image loaded. Adjust dimensions and resize.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  });

  dropZone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dropZone.classList.add('active');
  });
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('active');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('active');
  });
  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('active');
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      toggleLoader(true);
      clearMessage();
      await handleFileLoad(file);
      showMessage('Image loaded. Adjust dimensions and resize.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  });

  widthInput.addEventListener('input', () => syncAspect(widthInput, heightInput));
  heightInput.addEventListener('input', () => syncAspect(heightInput, widthInput));

  resizeButton.addEventListener('click', async () => {
    try {
      toggleLoader(true);
      clearMessage();
      await resizeImage();
      showMessage('Image resized successfully.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      toggleLoader(false);
    }
  });

  resetButton.addEventListener('click', resetTool);
  resetTool();
}
