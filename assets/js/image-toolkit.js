const ImageToolKit = (() => {
  const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  const createMessageHandlers = (messageBox) => {
    const clear = () => {
      messageBox.textContent = '';
      messageBox.classList.add('hidden');
      messageBox.classList.remove('success', 'error');
    };

    const show = (text, type = 'success') => {
      messageBox.textContent = text;
      messageBox.classList.remove('hidden', 'success', 'error');
      messageBox.classList.add(type === 'error' ? 'error' : 'success');
    };

    return { clear, show };
  };

  const bindFileUpload = ({ fileInput, filePicker, dropZone, onFile }) => {
    if (filePicker) {
      filePicker.addEventListener('click', () => fileInput.click());
    }

    fileInput.addEventListener('change', (event) => {
      if (!event.target.files.length) return;
      onFile(event.target.files[0]);
      event.target.value = '';
    });

    const toggleActive = (active) => {
      if (!dropZone) return;
      dropZone.classList.toggle('active', active);
    };

    if (dropZone) {
      ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          toggleActive(true);
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          toggleActive(false);
        });
      });

      dropZone.addEventListener('drop', (event) => {
        const file = event.dataTransfer.files[0];
        if (!file) return;
        onFile(file);
      });

      dropZone.addEventListener('click', () => {
        fileInput.click();
      });

      dropZone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fileInput.click();
        }
      });
    }
  };

  const loadImageFile = (file) => new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.src = url;
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to load the selected image.'));
    };
  });

  const revokeUrl = (url) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  };

  return {
    formatBytes,
    createMessageHandlers,
    bindFileUpload,
    loadImageFile,
    revokeUrl,
  };
})();

window.ImageToolKit = ImageToolKit;
