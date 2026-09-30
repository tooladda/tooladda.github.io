(function () {
  'use strict';

  const page = document.querySelector('[data-jwt]');
  if (!page) {
    return;
  }

  const tokenInput = page.querySelector('[data-token]');
  const colored = page.querySelector('[data-colored]');
  const headerPre = page.querySelector('[data-header]');
  const payloadPre = page.querySelector('[data-payload]');
  const messageBox = page.querySelector('[data-message]');
  const sampleBtn = page.querySelector('[data-sample]');
  const clearBtn = page.querySelector('[data-clear]');
  const copyHeaderBtn = page.querySelector('[data-copy-header]');
  const copyPayloadBtn = page.querySelector('[data-copy-payload]');

  const claimsWrap = page.querySelector('[data-claims-wrap]');
  const claimsBody = page.querySelector('[data-claims]');

  const algBadge = page.querySelector('[data-alg-badge]');
  const secretLabel = page.querySelector('[data-secret-label]');
  const secretInput = page.querySelector('[data-secret]');
  const secretB64 = page.querySelector('[data-secret-b64]');
  const verifyStatus = page.querySelector('[data-verify-status]');
  const verifyHint = page.querySelector('[data-verify-hint]');

  const tokenStatsEl = page.querySelector('[data-token-stats]');
  const dropZone = page.querySelector('[data-drop-zone]');
  const uploadInput = page.querySelector('[data-upload-input]');
  const downloadHeaderBtn = page.querySelector('[data-download-header]');
  const downloadPayloadBtn = page.querySelector('[data-download-payload]');

  const insightsWrap = page.querySelector('[data-insights]');
  const insightAlg = page.querySelector('[data-insight-alg]');
  const insightSize = page.querySelector('[data-insight-size]');
  const insightSegments = page.querySelector('[data-insight-segments]');
  const insightClaims = page.querySelector('[data-insight-claims]');
  const insightExpiry = page.querySelector('[data-insight-expiry]');
  const insightVerify = page.querySelector('[data-insight-verify]');

  const securityPanel = page.querySelector('[data-security-panel]');
  const securityList = page.querySelector('[data-security-list]');
  const scoreRing = page.querySelector('[data-score-ring]');
  const scoreValue = page.querySelector('[data-score-value]');

  const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const SAMPLE_SECRET = 'your-256-bit-secret';

  const CLAIM_MEANINGS = {
    iss: 'Issuer', sub: 'Subject', aud: 'Audience', exp: 'Expiration time',
    nbf: 'Not valid before', iat: 'Issued at', jti: 'JWT ID',
  };
  const TIME_CLAIMS = ['exp', 'nbf', 'iat'];
  const SENSITIVE_KEY_RE = /password|passwd|ssn|social_security|credit_card|card_number|cvv|pin\b|secret\b|private_key/i;

  let currentHeader = null;
  let currentPayload = null;
  let decodedHeaderText = '';
  let decodedPayloadText = '';
  let lastVerifyState = 'idle';

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

  const b64urlToBytes = (str) => {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };
  const b64urlToString = (str) => new TextDecoder().decode(b64urlToBytes(str));

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // Minimal JSON syntax highlighter
  const highlightJson = (obj) => {
    const json = JSON.stringify(obj, null, 2);
    return esc(json).replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'n';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'k' : 's';
        else if (/true|false|null/.test(match)) cls = 'b';
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  };

  const fmtTime = (secs) => {
    const d = new Date(secs * 1000);
    if (isNaN(d.getTime())) return String(secs);
    return d.toLocaleString();
  };
  const relative = (secs) => {
    const diff = secs * 1000 - Date.now();
    const abs = Math.abs(diff);
    const units = [['year', 31536e6], ['month', 2592e6], ['day', 864e5], ['hour', 36e5], ['minute', 6e4], ['second', 1e3]];
    for (const [name, ms] of units) {
      if (abs >= ms || name === 'second') {
        const n = Math.round(abs / ms);
        return diff >= 0 ? ('in ' + n + ' ' + name + (n !== 1 ? 's' : '')) : (n + ' ' + name + (n !== 1 ? 's' : '') + ' ago');
      }
    }
    return '';
  };

  /* ---------- colored token ---------- */
  const renderColored = (raw) => {
    if (!raw.trim()) {
      colored.innerHTML = '<span class="c-empty">The color-coded token will appear here…</span>';
      return;
    }
    const parts = raw.trim().split('.');
    const cls = ['c-h', 'c-p', 'c-s'];
    const html = parts.map((p, i) => '<span class="' + (cls[i] || 'c-s') + '">' + esc(p) + '</span>').join('<span class="c-dot">.</span>');
    colored.innerHTML = html;
  };

  /* ---------- claims table ---------- */
  const renderClaims = (payload) => {
    const rows = [];
    Object.keys(CLAIM_MEANINGS).forEach((claim) => {
      if (!(claim in payload)) return;
      let valueHtml;
      if (TIME_CLAIMS.indexOf(claim) >= 0 && typeof payload[claim] === 'number') {
        const secs = payload[claim];
        let badge = '';
        if (claim === 'exp') {
          const expired = secs * 1000 < Date.now();
          badge = expired ? ' <span class="jwtx-badge bad">expired</span>' : ' <span class="jwtx-badge ok">valid</span>';
        } else if (claim === 'nbf') {
          const notYet = secs * 1000 > Date.now();
          badge = notYet ? ' <span class="jwtx-badge warn">not active yet</span>' : '';
        }
        valueHtml = esc(fmtTime(secs)) + ' <span style="color:var(--text-muted)">(' + esc(relative(secs)) + ')</span>' + badge;
      } else {
        valueHtml = esc(typeof payload[claim] === 'object' ? JSON.stringify(payload[claim]) : String(payload[claim]));
      }
      rows.push('<tr><td><code>' + claim + '</code></td><td><span class="jwtx-badge registered">Registered</span> ' + CLAIM_MEANINGS[claim] + '</td><td>' + valueHtml + '</td></tr>');
    });
    Object.keys(payload).forEach((claim) => {
      if (CLAIM_MEANINGS[claim]) return; // already rendered above
      const raw = payload[claim];
      const valueHtml = esc(typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw));
      rows.push('<tr><td><code>' + esc(claim) + '</code></td><td><span class="jwtx-badge custom">Custom</span></td><td>' + valueHtml + '</td></tr>');
    });
    if (rows.length) {
      claimsBody.innerHTML = rows.join('');
      claimsWrap.hidden = false;
    } else {
      claimsWrap.hidden = true;
    }
  };

  /* ---------- token stats line ---------- */
  const renderTokenStats = (raw, parts) => {
    if (!tokenStatsEl) return;
    const segCount = raw ? parts.length : 0;
    tokenStatsEl.textContent = raw.length + ' character' + (raw.length === 1 ? '' : 's') + ' · ' + segCount + ' / 3 segments';
  };

  /* ---------- token insights dashboard ---------- */
  const renderInsights = (header, payload, raw, parts) => {
    if (!insightsWrap) return;
    if (!raw) { insightsWrap.hidden = true; return; }
    insightsWrap.hidden = false;

    insightAlg.textContent = (header && header.alg) ? header.alg : '—';
    insightAlg.className = (header && /^none$/i.test(header.alg || '')) ? 'is-bad' : '';

    insightSize.textContent = raw.length + ' chars';

    const segOk = parts.length === 3 && parts[2];
    insightSegments.textContent = parts.length + ' / 3';
    insightSegments.className = segOk ? 'is-good' : (parts.length === 3 ? 'is-warn' : 'is-bad');

    insightClaims.textContent = payload ? String(Object.keys(payload).length) : '—';

    if (payload && typeof payload.exp === 'number') {
      const expired = payload.exp * 1000 < Date.now();
      insightExpiry.textContent = expired ? 'Expired' : 'Valid';
      insightExpiry.className = expired ? 'is-bad' : 'is-good';
    } else {
      insightExpiry.textContent = 'No expiry';
      insightExpiry.className = 'is-warn';
    }

    if (lastVerifyState === 'ok') { insightVerify.textContent = 'Verified ✓'; insightVerify.className = 'is-good'; }
    else if (lastVerifyState === 'bad') { insightVerify.textContent = 'Failed ✗'; insightVerify.className = 'is-bad'; }
    else { insightVerify.textContent = 'Not checked'; insightVerify.className = ''; }
  };

  /* ---------- security analysis ---------- */
  const computeSecurity = (header, payload, raw, parts) => {
    const findings = [];
    let score = 100;
    const add = (level, text, delta) => { findings.push({ level: level, text: text }); if (delta) score += delta; };

    if (!header) {
      return { score: 0, findings: [{ level: 'critical', text: 'Could not parse the header — this does not look like a valid JWT.' }] };
    }

    const alg = header.alg || '';
    if (/^none$/i.test(alg)) {
      add('critical', 'Uses the "none" algorithm — this token is completely unsigned and can be trivially forged. Never accept this in production.', -60);
    } else if (parts.length !== 3 || !parts[2]) {
      add('critical', 'Missing signature segment — this token is not signed at all.', -40);
    } else {
      add('ok', 'Includes a signature segment for algorithm ' + alg + '.', 0);
    }

    if (payload) {
      if (typeof payload.exp !== 'number') {
        add('warn', 'No expiration (exp) claim — this token never expires by design.', -15);
      } else {
        const expired = payload.exp * 1000 < Date.now();
        add(expired ? 'info' : 'ok', expired ? 'Token is expired.' : 'Token has not expired yet.', 0);
        if (typeof payload.iat === 'number') {
          const lifetimeDays = (payload.exp - payload.iat) / 86400;
          if (lifetimeDays > 30) add('warn', 'Very long lifetime (~' + Math.round(lifetimeDays) + ' days) between iat and exp — consider shorter-lived tokens with refresh.', -10);
        }
      }
      if (typeof payload.iat !== 'number') add('info', 'No issued-at (iat) claim — harder to audit token age.', -5);
      if (typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now()) add('info', 'Token is not valid yet (nbf is in the future).', 0);

      const sensitiveKeys = Object.keys(payload).filter((k) => SENSITIVE_KEY_RE.test(k));
      sensitiveKeys.slice(0, 3).forEach((k) => {
        add('warn', 'Payload key "' + k + '" may hold sensitive data — JWTs are only encoded, not encrypted.', -15);
      });
    }

    if (/^HS/i.test(alg) && secretInput.value.trim() && secretInput.value.trim().length < 16) {
      add('warn', 'The HMAC secret entered is under 16 characters — short secrets are practical to brute-force.', -20);
    }

    if (lastVerifyState === 'bad') {
      add('critical', 'Signature verification failed with the provided secret/key — the token may be tampered with, or the wrong key was used.', -30);
    } else if (lastVerifyState === 'ok') {
      add('ok', 'Signature successfully verified with the provided secret/key.', 0);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score: score, findings: findings };
  };

  const renderSecurity = (header, payload, raw, parts) => {
    if (!securityPanel) return;
    if (!raw || !header) { securityPanel.hidden = true; return; }
    securityPanel.hidden = false;

    const result = computeSecurity(header, payload, raw, parts);
    const color = result.score >= 85 ? '#16a34a' : (result.score >= 60 ? '#d97706' : '#dc2626');
    scoreRing.style.setProperty('--score', String(result.score));
    scoreRing.style.setProperty('--score-color', color);
    scoreValue.textContent = String(result.score);

    securityList.innerHTML = result.findings.map((f) => {
      return '<li class="is-' + f.level + '">' + esc(f.text) + '</li>';
    }).join('');
  };

  const updateSecurityAndInsights = () => {
    const raw = tokenInput.value.trim();
    const parts = raw ? raw.split('.') : [];
    renderInsights(currentHeader, currentPayload, raw, parts);
    renderSecurity(currentHeader, currentPayload, raw, parts);
  };

  /* ---------- verification UI adjust ---------- */
  const updateVerifyUiForAlg = (alg) => {
    algBadge.textContent = 'alg: ' + (alg || '—');
    const isHmac = /^HS/i.test(alg || '');
    if (isHmac) {
      secretLabel.textContent = 'Secret (for ' + alg + ')';
      secretInput.placeholder = 'your-256-bit-secret';
      verifyHint.textContent = 'HMAC token: enter the shared secret used to sign it.';
      secretB64.parentElement.style.display = '';
    } else if (alg) {
      secretLabel.textContent = 'PEM public key (for ' + alg + ')';
      secretInput.placeholder = '-----BEGIN PUBLIC KEY-----';
      verifyHint.textContent = 'RSA/ECDSA token: paste the PEM public key to verify.';
      secretB64.parentElement.style.display = 'none';
    } else {
      secretLabel.textContent = 'Secret / public key';
      verifyHint.textContent = 'For RSA/ECDSA tokens (RS/PS/ES), paste a PEM public key instead of a secret.';
      secretB64.parentElement.style.display = '';
    }
    // switch to textarea-like sizing for keys
    if (alg && !isHmac) {
      secretInput.setAttribute('data-multiline', '1');
    } else {
      secretInput.removeAttribute('data-multiline');
    }
  };

  const setVerify = (state, text) => {
    verifyStatus.className = 'jwtx-pill ' + state;
    verifyStatus.textContent = text;
  };

  /* ---------- decode ---------- */
  const decode = () => {
    const raw = tokenInput.value.trim();
    renderColored(raw);
    renderTokenStats(raw, raw ? raw.split('.') : []);
    if (!raw) {
      headerPre.textContent = '—';
      payloadPre.textContent = '—';
      claimsWrap.hidden = true;
      currentHeader = null;
      currentPayload = null;
      lastVerifyState = 'idle';
      updateVerifyUiForAlg('');
      setVerify('idle', 'Enter a secret or public key to verify');
      clearMessage();
      updateSecurityAndInsights();
      return;
    }
    const parts = raw.split('.');
    if (parts.length < 2) {
      headerPre.textContent = '—';
      payloadPre.textContent = '—';
      claimsWrap.hidden = true;
      currentHeader = null;
      currentPayload = null;
      setVerify('idle', 'Paste a complete token to verify');
      showMessage('This does not look like a JWT. A token has the form header.payload.signature', 'error');
      updateSecurityAndInsights();
      return;
    }
    clearMessage();
    // header
    try {
      const headerObj = JSON.parse(b64urlToString(parts[0]));
      currentHeader = headerObj;
      decodedHeaderText = JSON.stringify(headerObj, null, 2);
      headerPre.innerHTML = highlightJson(headerObj);
      updateVerifyUiForAlg(headerObj.alg || '');
    } catch (e) {
      currentHeader = null;
      headerPre.textContent = 'Invalid header — could not decode.';
      updateVerifyUiForAlg('');
    }
    // payload
    try {
      const payloadObj = JSON.parse(b64urlToString(parts[1]));
      currentPayload = payloadObj;
      decodedPayloadText = JSON.stringify(payloadObj, null, 2);
      payloadPre.innerHTML = highlightJson(payloadObj);
      renderClaims(payloadObj);
    } catch (e) {
      currentPayload = null;
      payloadPre.textContent = 'Invalid payload — could not decode.';
      claimsWrap.hidden = true;
    }
    lastVerifyState = 'idle';
    updateSecurityAndInsights();
    runVerify();
  };

  /* ---------- Web Crypto verification ---------- */
  const pemToBytes = (pem) => {
    const b64 = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const HASH = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' };

  const verifySignature = async (token, alg, keyMaterial, b64Secret) => {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Token must have three parts to verify.');
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const sig = b64urlToBytes(parts[2]);
    const bits = (alg || '').replace(/^\D+/, '') || '256';
    const hash = HASH[bits] || 'SHA-256';

    if (/^HS/i.test(alg)) {
      const raw = b64Secret ? b64urlToBytes(keyMaterial) : new TextEncoder().encode(keyMaterial);
      const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: hash }, false, ['verify']);
      return crypto.subtle.verify('HMAC', key, sig, data);
    }
    if (/^RS/i.test(alg)) {
      const key = await crypto.subtle.importKey('spki', pemToBytes(keyMaterial), { name: 'RSASSA-PKCS1-v1_5', hash: hash }, false, ['verify']);
      return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    }
    if (/^PS/i.test(alg)) {
      const key = await crypto.subtle.importKey('spki', pemToBytes(keyMaterial), { name: 'RSA-PSS', hash: hash }, false, ['verify']);
      const saltLength = bits === '256' ? 32 : bits === '384' ? 48 : 64;
      return crypto.subtle.verify({ name: 'RSA-PSS', saltLength: saltLength }, key, sig, data);
    }
    if (/^ES/i.test(alg)) {
      const namedCurve = bits === '256' ? 'P-256' : bits === '384' ? 'P-384' : 'P-521';
      const key = await crypto.subtle.importKey('spki', pemToBytes(keyMaterial), { name: 'ECDSA', namedCurve: namedCurve }, false, ['verify']);
      return crypto.subtle.verify({ name: 'ECDSA', hash: hash }, key, sig, data);
    }
    throw new Error('Algorithm ' + alg + ' is not supported for verification.');
  };

  let verifyToken = 0;
  const runVerify = async () => {
    const alg = currentHeader && currentHeader.alg;
    const raw = tokenInput.value.trim();
    const material = secretInput.value.trim();

    if (!alg || raw.split('.').length !== 3) { setVerify('idle', 'Paste a complete token to verify'); return; }
    if (/^none$/i.test(alg)) { setVerify('bad', '⚠ alg "none" — unsigned token (insecure)'); return; }
    if (!material) { setVerify('idle', /^HS/i.test(alg) ? 'Enter the secret to verify' : 'Paste the PEM public key to verify'); return; }

    const myToken = ++verifyToken;
    setVerify('idle', 'Verifying…');
    try {
      const ok = await verifySignature(raw, alg, material, secretB64.checked);
      if (myToken !== verifyToken) return; // superseded
      lastVerifyState = ok ? 'ok' : 'bad';
      setVerify(lastVerifyState, ok ? '✓ Signature verified' : '✗ Invalid signature');
    } catch (err) {
      if (myToken !== verifyToken) return;
      lastVerifyState = 'bad';
      setVerify('bad', '✗ ' + (err && err.message ? err.message : 'Verification failed (check the key/secret).'));
    }
    updateSecurityAndInsights();
  };

  /* ---------- copy ---------- */
  const copyText = async (text, btn) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1400);
    } catch (e) { /* ignore */ }
  };

  /* ---------- events ---------- */
  tokenInput.addEventListener('input', decode);
  secretInput.addEventListener('input', runVerify);
  secretB64.addEventListener('change', runVerify);

  sampleBtn.addEventListener('click', () => {
    tokenInput.value = SAMPLE;
    secretInput.value = SAMPLE_SECRET;
    secretB64.checked = false;
    decode();
  });

  clearBtn.addEventListener('click', () => {
    tokenInput.value = '';
    secretInput.value = '';
    decode();
    tokenInput.focus();
  });

  copyHeaderBtn.addEventListener('click', () => copyText(decodedHeaderText, copyHeaderBtn));
  copyPayloadBtn.addEventListener('click', () => copyText(decodedPayloadText, copyPayloadBtn));

  /* ---------- download ---------- */
  const downloadText = (text, filename) => {
    if (!text) return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (downloadHeaderBtn) downloadHeaderBtn.addEventListener('click', () => downloadText(decodedHeaderText, 'jwt-header.json'));
  if (downloadPayloadBtn) downloadPayloadBtn.addEventListener('click', () => downloadText(decodedPayloadText, 'jwt-payload.json'));

  /* ---------- upload / drag & drop ---------- */
  const loadTokenFromFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '').trim();
      try {
        const parsed = JSON.parse(text);
        tokenInput.value = parsed.token || parsed.jwt || parsed.access_token || text;
      } catch (e) {
        tokenInput.value = text;
      }
      decode();
    };
    reader.onerror = () => showMessage('Could not read that file.', 'error');
    reader.readAsText(file);
  };
  if (uploadInput) uploadInput.addEventListener('change', (e) => { loadTokenFromFile(e.target.files && e.target.files[0]); e.target.value = ''; });
  if (dropZone) {
    ['dragenter', 'dragover'].forEach((evt) => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach((evt) => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('is-dragover'); }));
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) { e.preventDefault(); loadTokenFromFile(file); }
    });
  }

  /* ---------- sticky mobile bar / final CTA ---------- */
  const scrollToToken = () => {
    tokenInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tokenInput.focus();
  };
  const stickyBtn = document.getElementById('jwtxStickyBtn');
  if (stickyBtn) stickyBtn.addEventListener('click', scrollToToken);
  Array.from(document.querySelectorAll('[data-jwtx-scroll-token]')).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); scrollToToken(); }));
  const stickyBar = document.getElementById('jwtxSticky');
  if (stickyBar) stickyBar.classList.add('is-visible');

  // init
  decode();
})();
