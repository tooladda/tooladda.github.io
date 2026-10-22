/*
 * PEM -> PPK converter (PuTTY Private Key, format v2)
 *
 * Requires node-forge to be loaded on the page BEFORE this script, e.g.:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/forge/1.3.1/forge.min.js"></script>
 *
 * Supports UNENCRYPTED RSA keys in PKCS#1 ("BEGIN RSA PRIVATE KEY")
 * or PKCS#8 ("BEGIN PRIVATE KEY") form. Produces a real PPK-v2 file whose
 * MAC and key blobs match what PuTTYgen would generate, so PuTTY/WinSCP
 * accept it directly.
 */
const pemToPpkSection = document.querySelector('[data-pem-to-ppk-page]');
if (pemToPpkSection) {
  const pemInput = pemToPpkSection.querySelector('[data-pem-input]');
  const browsePemBtn = pemToPpkSection.querySelector('[data-browse-pem-btn]');
  const pemFileInput = pemToPpkSection.querySelector('[data-pem-file-input]');
  const convertBtn = pemToPpkSection.querySelector('[data-convert-btn]');
  const clearBtn = pemToPpkSection.querySelector('[data-clear-btn]');
  const downloadBtn = pemToPpkSection.querySelector('[data-download-btn]');
  const copyBtn = pemToPpkSection.querySelector('[data-copy-btn]');
  const messageBox = pemToPpkSection.querySelector('[data-message]');
  const loader = pemToPpkSection.querySelector('[data-loader]');
  const outputPanel = pemToPpkSection.querySelector('[data-output-panel]');
  const downloadPanel = pemToPpkSection.querySelector('[data-download-panel]');
  const ppkOutput = pemToPpkSection.querySelector('[data-ppk-output]');

  let lastPpkContent = '';

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
    convertBtn.disabled = visible;
    clearBtn.disabled = visible;
  };

  // ---- SSH wire-format helpers (operate on forge binary strings) ----

  // 4-byte big-endian length prefix.
  const u32 = (n) =>
    String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

  // SSH "string": length-prefixed raw bytes.
  const sshString = (bytes) => u32(bytes.length) + bytes;

  // SSH "mpint" from a forge BigInteger: big-endian, minimal, with a
  // leading 0x00 when the top bit is set so it stays positive.
  const mpint = (bigInt) => {
    let hex = bigInt.toString(16);
    if (hex.length % 2) hex = '0' + hex;              // whole bytes
    let bytes = '';
    for (let i = 0; i < hex.length; i += 2) {
      bytes += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    // strip leading zero bytes (keep at least one)
    let i = 0;
    while (i < bytes.length - 1 && bytes.charCodeAt(i) === 0) i++;
    bytes = bytes.slice(i);
    if (bytes.length && (bytes.charCodeAt(0) & 0x80)) bytes = '\x00' + bytes; // keep positive
    return sshString(bytes);
  };

  // Wrap a base64 blob to 64-char lines.
  const wrap64 = (b64) => {
    const lines = [];
    for (let i = 0; i < b64.length; i += 64) lines.push(b64.substr(i, 64));
    return lines;
  };

  // ---- core conversion ----
  const convertToPPK = (pemText) => {
    if (typeof forge === 'undefined') {
      throw new Error('node-forge library not loaded. Add the forge <script> tag to the page.');
    }

    const text = pemText.trim();

    if (text.includes('BEGIN OPENSSH PRIVATE KEY')) {
      throw new Error(
        'This is a new OpenSSH-format key, which this tool cannot parse. ' +
        'Convert it to classic PEM first:  ssh-keygen -p -m PEM -f yourkey'
      );
    }
    if (/ENCRYPTED/i.test(text) || /Proc-Type:.*ENCRYPTED/i.test(text)) {
      throw new Error('Passphrase-encrypted PEM keys are not supported. Remove the passphrase first.');
    }

    let key;
    try {
      key = forge.pki.privateKeyFromPem(text); // handles PKCS#1 and PKCS#8 RSA
    } catch (e) {
      throw new Error('Could not parse this as an RSA private key. Only unencrypted RSA PEM keys are supported.');
    }
    if (!key || !key.n || !key.e || !key.d || !key.p || !key.q || !key.qInv) {
      throw new Error('Parsed key is missing RSA components — is this really an RSA private key?');
    }

    // Public blob: string "ssh-rsa", mpint e, mpint n
    const pubBlob = sshString('ssh-rsa') + mpint(key.e) + mpint(key.n);
    // Private blob: mpint d, mpint p, mpint q, mpint iqmp (= q^-1 mod p)
    const privBlob = mpint(key.d) + mpint(key.p) + mpint(key.q) + mpint(key.qInv);

    const algorithm = 'ssh-rsa';
    const encryption = 'none';
    const comment = 'imported-openssh-key';

    const pubB64 = forge.util.encode64(pubBlob);
    const privB64 = forge.util.encode64(privBlob);
    const pubLines = wrap64(pubB64);
    const privLines = wrap64(privB64);

    // PPK v2 MAC: HMAC-SHA-1 over the concatenated SSH-strings,
    // keyed by SHA1("putty-private-key-file-mac-key" + passphrase).
    // Unencrypted => passphrase is empty.
    const macData =
      sshString(algorithm) +
      sshString(encryption) +
      sshString(comment) +
      sshString(pubBlob) +
      sshString(privBlob);

    const md = forge.md.sha1.create();
    md.update('putty-private-key-file-mac-key', 'raw');
    const macKey = md.digest().bytes();

    const hmac = forge.hmac.create();
    hmac.start('sha1', macKey);
    hmac.update(macData);
    const mac = hmac.digest().toHex();

    let ppk = '';
    ppk += 'PuTTY-User-Key-File-2: ' + algorithm + '\n';
    ppk += 'Encryption: ' + encryption + '\n';
    ppk += 'Comment: ' + comment + '\n';
    ppk += 'Public-Lines: ' + pubLines.length + '\n';
    ppk += pubLines.join('\n') + '\n';
    ppk += 'Private-Lines: ' + privLines.length + '\n';
    ppk += privLines.join('\n') + '\n';
    ppk += 'Private-MAC: ' + mac + '\n';
    return ppk;
  };

  const handleConvert = () => {
    const pem = pemInput.value.trim();

    if (!pem) {
      showMessage('Please paste a PEM private key.', 'error');
      return;
    }
    if (!pem.includes('PRIVATE KEY')) {
      showMessage('Invalid PEM format. It should start with "-----BEGIN ... PRIVATE KEY-----".', 'error');
      return;
    }

    try {
      clearMessage();
      toggleLoader(true);

      const ppkContent = convertToPPK(pem);
      lastPpkContent = ppkContent;

      ppkOutput.value = ppkContent;
      outputPanel.classList.remove('hidden');
      downloadPanel.classList.remove('hidden');

      showMessage('✅ Converted to a valid PPK (v2). Use with PuTTY, WinSCP, or plink.', 'success');
    } catch (error) {
      showMessage('Error: ' + error.message, 'error');
      console.error('Conversion error:', error);
      outputPanel.classList.add('hidden');
      downloadPanel.classList.add('hidden');
    } finally {
      toggleLoader(false);
    }
  };

  const handleDownload = () => {
    if (!lastPpkContent) {
      showMessage('No PPK content to download.', 'error');
      return;
    }
    try {
      const blob = new Blob([lastPpkContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'id_rsa.ppk';
      link.click();
      URL.revokeObjectURL(url);
      showMessage('✅ PPK file downloaded successfully!', 'success');
    } catch (error) {
      showMessage('Download failed: ' + error.message, 'error');
    }
  };

  const handleCopy = async () => {
    if (!lastPpkContent) {
      showMessage('No PPK content to copy.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(lastPpkContent);
      showMessage('✅ PPK content copied to clipboard!', 'success');
    } catch (error) {
      showMessage('Copy failed: ' + error.message, 'error');
    }
  };

  const handleClear = () => {
    pemInput.value = '';
    ppkOutput.value = '';
    lastPpkContent = '';
    outputPanel.classList.add('hidden');
    downloadPanel.classList.add('hidden');
    clearMessage();
  };

  const loadPemFileText = (text) => {
    pemInput.value = text;
    showMessage('✅ File loaded. Click "Convert to PPK" to proceed.', 'success');
  };

  // Browse file support
  if (browsePemBtn && pemFileInput) {
    browsePemBtn.addEventListener('click', () => {
      // Reset to ensure selecting the same file again triggers change.
      pemFileInput.value = '';
      pemFileInput.click();
    });

    pemFileInput.addEventListener('change', () => {
      const file = pemFileInput.files && pemFileInput.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        loadPemFileText(event.target.result);
      };
      reader.onerror = () => showMessage('Failed to read file.', 'error');
      reader.readAsText(file);
    });
  }

  // Drag and drop file support
  pemInput.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pemInput.style.backgroundColor = 'rgba(79, 70, 229, 0.05)';
    pemInput.style.borderColor = '#4f46e5';
  });
  pemInput.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pemInput.style.backgroundColor = '';
    pemInput.style.borderColor = '';
  });
  pemInput.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pemInput.style.backgroundColor = '';
    pemInput.style.borderColor = '';
    const files = e.dataTransfer?.files;
    if (files && files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        loadPemFileText(event.target.result);
      };
      reader.onerror = () => showMessage('Failed to read file.', 'error');
      reader.readAsText(files[0]);
    }
  });

  // Event listeners
  convertBtn.addEventListener('click', handleConvert);
  downloadBtn.addEventListener('click', handleDownload);
  copyBtn.addEventListener('click', handleCopy);
  clearBtn.addEventListener('click', handleClear);
  pemInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') handleConvert();
  });
}