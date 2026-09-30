(function () {
  'use strict';

  const page = document.querySelector('[data-jwt-enc]');
  if (!page) {
    return;
  }

  const algSelect = page.querySelector('[data-alg]');
  const headerArea = page.querySelector('[data-header]');
  const payloadArea = page.querySelector('[data-payload]');
  const secretInput = page.querySelector('[data-secret]');
  const keyArea = page.querySelector('[data-key]');
  const secretB64 = page.querySelector('[data-secret-b64]');
  const b64Wrap = page.querySelector('[data-b64-wrap]');
  const keyLabel = page.querySelector('[data-key-label]');
  const keyHint = page.querySelector('[data-key-hint]');
  const tokenOut = page.querySelector('[data-token]');
  const copyBtn = page.querySelector('[data-copy]');
  const clearBtn = page.querySelector('[data-clear]');
  const messageBox = page.querySelector('[data-message]');
  const claimBtns = Array.from(page.querySelectorAll('[data-claim]'));
  const formatBtn = page.querySelector('[data-format]');

  const HASH = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' };
  const DEFAULT_PAYLOAD = { sub: '1234567890', name: 'John Doe', iat: 1516239022 };

  let currentToken = '';

  /* ---------- helpers ---------- */
  const showMessage = (text, type) => {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  };
  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.classList.add('hidden');
    messageBox.classList.remove('success', 'error');
  };

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const bytesToB64url = (bytes) => {
    let bin = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const strToB64url = (str) => bytesToB64url(new TextEncoder().encode(str));
  const b64urlToBytes = (str) => {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };
  const pemToBytes = (pem) => {
    const b64 = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const renderToken = (token) => {
    if (!token) {
      tokenOut.classList.add('placeholder');
      tokenOut.textContent = 'Your signed token will appear here…';
      return;
    }
    const parts = token.split('.');
    const cls = ['c-h', 'c-p', 'c-s'];
    tokenOut.classList.remove('placeholder');
    tokenOut.innerHTML = parts.map((p, i) => '<span class="' + cls[i] + '">' + esc(p) + '</span>').join('<span class="c-dot">.</span>');
  };

  const setOutputDisabled = (disabled) => { copyBtn.disabled = disabled; };

  /* ---------- signing ---------- */
  const sign = async (alg, signingInput, secret, key, b64Secret) => {
    const data = new TextEncoder().encode(signingInput);
    const bits = alg.replace(/^\D+/, '') || '256';
    const hash = HASH[bits] || 'SHA-256';

    if (/^HS/.test(alg)) {
      const raw = b64Secret ? b64urlToBytes(secret) : new TextEncoder().encode(secret);
      const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: hash }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
    }
    if (/^RS/.test(alg)) {
      const k = await crypto.subtle.importKey('pkcs8', pemToBytes(key), { name: 'RSASSA-PKCS1-v1_5', hash: hash }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, data));
    }
    if (/^PS/.test(alg)) {
      const saltLength = bits === '256' ? 32 : bits === '384' ? 48 : 64;
      const k = await crypto.subtle.importKey('pkcs8', pemToBytes(key), { name: 'RSA-PSS', hash: hash }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: saltLength }, k, data));
    }
    if (/^ES/.test(alg)) {
      const namedCurve = bits === '256' ? 'P-256' : bits === '384' ? 'P-384' : 'P-521';
      const k = await crypto.subtle.importKey('pkcs8', pemToBytes(key), { name: 'ECDSA', namedCurve: namedCurve }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: hash }, k, data));
    }
    throw new Error('Unsupported algorithm.');
  };

  let genToken = 0;
  const generate = async () => {
    const alg = algSelect.value;
    const isHmac = /^HS/.test(alg);

    // parse header
    let headerObj;
    try {
      headerObj = JSON.parse(headerArea.value);
      headerArea.classList.remove('invalid');
    } catch (e) {
      headerArea.classList.add('invalid');
      showMessage('Header is not valid JSON.', 'error');
      currentToken = ''; renderToken(''); setOutputDisabled(true);
      return;
    }
    // parse payload
    let payloadObj;
    try {
      payloadObj = JSON.parse(payloadArea.value);
      payloadArea.classList.remove('invalid');
    } catch (e) {
      payloadArea.classList.add('invalid');
      showMessage('Payload is not valid JSON.', 'error');
      currentToken = ''; renderToken(''); setOutputDisabled(true);
      return;
    }

    const material = isHmac ? secretInput.value : keyArea.value.trim();
    if (!material) {
      clearMessage();
      showMessage(isHmac ? 'Enter a secret to sign the token.' : 'Paste a PEM private key to sign the token.', 'error');
      currentToken = ''; renderToken(''); setOutputDisabled(true);
      return;
    }

    const signingInput = strToB64url(JSON.stringify(headerObj)) + '.' + strToB64url(JSON.stringify(payloadObj));
    const myToken = ++genToken;
    try {
      const sigBytes = await sign(alg, signingInput, secretInput.value, keyArea.value.trim(), secretB64.checked);
      if (myToken !== genToken) return;
      currentToken = signingInput + '.' + bytesToB64url(sigBytes);
      renderToken(currentToken);
      setOutputDisabled(false);
      clearMessage();
    } catch (err) {
      if (myToken !== genToken) return;
      currentToken = ''; renderToken(''); setOutputDisabled(true);
      showMessage('Could not sign: ' + (err && err.message ? err.message : 'check your key/secret and algorithm.'), 'error');
    }
  };

  /* ---------- header/alg sync ---------- */
  const syncHeaderAlg = () => {
    const alg = algSelect.value;
    let headerObj;
    try { headerObj = JSON.parse(headerArea.value); } catch (e) { headerObj = { typ: 'JWT' }; }
    headerObj.alg = alg;
    if (!headerObj.typ) headerObj.typ = 'JWT';
    headerArea.value = JSON.stringify(headerObj, null, 2);
  };

  const updateKeyUi = () => {
    const alg = algSelect.value;
    const isHmac = /^HS/.test(alg);
    if (isHmac) {
      keyLabel.textContent = 'Secret';
      secretInput.hidden = false;
      keyArea.hidden = true;
      b64Wrap.style.display = '';
      keyHint.textContent = 'HMAC uses a shared secret. Switch algorithm to RS/PS/ES to sign with a PEM private key.';
    } else {
      keyLabel.textContent = 'PEM private key (PKCS#8)';
      secretInput.hidden = true;
      keyArea.hidden = false;
      b64Wrap.style.display = 'none';
      keyHint.textContent = 'Paste a PKCS#8 private key beginning with -----BEGIN PRIVATE KEY-----.';
    }
  };

  /* ---------- quick claims ---------- */
  const addClaim = (type) => {
    let payloadObj;
    try { payloadObj = JSON.parse(payloadArea.value); } catch (e) { payloadObj = {}; }
    const now = Math.floor(Date.now() / 1000);
    if (type === 'iat') payloadObj.iat = now;
    else if (type === 'nbf') payloadObj.nbf = now;
    else if (type === 'exp') payloadObj.exp = now + 3600;
    payloadArea.value = JSON.stringify(payloadObj, null, 2);
    generate();
  };

  /* ---------- events ---------- */
  algSelect.addEventListener('change', () => { syncHeaderAlg(); updateKeyUi(); generate(); });
  headerArea.addEventListener('input', generate);
  payloadArea.addEventListener('input', generate);
  secretInput.addEventListener('input', generate);
  keyArea.addEventListener('input', generate);
  secretB64.addEventListener('change', generate);
  claimBtns.forEach((btn) => btn.addEventListener('click', () => addClaim(btn.dataset.claim)));

  formatBtn.addEventListener('click', () => {
    try {
      payloadArea.value = JSON.stringify(JSON.parse(payloadArea.value), null, 2);
      payloadArea.classList.remove('invalid');
      generate();
    } catch (e) {
      payloadArea.classList.add('invalid');
      showMessage('Payload is not valid JSON.', 'error');
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (copyBtn.disabled || !currentToken) return;
    try {
      await navigator.clipboard.writeText(currentToken);
      copyBtn.classList.add('copied');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = '📋 Copy token'; }, 1600);
    } catch (e) {
      showMessage('Copy failed — select and copy the token manually.', 'error');
    }
  });

  clearBtn.addEventListener('click', () => {
    algSelect.value = 'HS256';
    headerArea.value = JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2);
    payloadArea.value = JSON.stringify(DEFAULT_PAYLOAD, null, 2);
    secretInput.value = 'your-256-bit-secret';
    keyArea.value = '';
    secretB64.checked = false;
    updateKeyUi();
    generate();
  });

  /* ---------- init ---------- */
  headerArea.value = JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2);
  payloadArea.value = JSON.stringify(DEFAULT_PAYLOAD, null, 2);
  secretInput.value = 'your-256-bit-secret';
  updateKeyUi();
  generate();
})();
