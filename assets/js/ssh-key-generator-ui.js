/* ToolAdda — SSH Key Generator UI wiring.
   Depends on window.SSHKeyGen (assets/js/ssh-key-generator.js).
   Key generation runs entirely client-side via the Web Crypto API; nothing
   is ever uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-ssh-page')) return;
  const Engine = window.SSHKeyGen;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);

  const els = {
    unsupported: $('sshUnsupported'),
    workspace: $('sshWorkspace'),

    algorithm: $('sshAlgorithm'),
    curveWrap: $('sshCurveWrap'),
    curve: $('sshCurve'),
    bitsWrap: $('sshBitsWrap'),
    bits: $('sshBits'),
    comment: $('sshComment'),
    ed25519Note: $('sshEd25519Note'),

    generateBtn: $('sshGenerateBtn'),
    stickyGenerateBtn: $('sshStickyGenerateBtn'),

    emptyState: $('sshEmptyState'),
    results: $('sshResults'),

    algoLabel: $('sshAlgoLabel'),
    sizeLabel: $('sshSizeLabel'),
    genTime: $('sshGenTime'),
    sha256Fp: $('sshSha256Fp'),
    md5Fp: $('sshMd5Fp'),
    randomart: $('sshRandomart'),

    publicKeyOut: $('sshPublicKeyOut'),
    privateKeyOut: $('sshPrivateKeyOut'),
    pkcs8Out: $('sshPkcs8Out'),

    copyPublicBtn: $('sshCopyPublicBtn'),
    downloadPublicBtn: $('sshDownloadPublicBtn'),
    copyPrivateBtn: $('sshCopyPrivateBtn'),
    downloadPrivateBtn: $('sshDownloadPrivateBtn'),
    copyPkcs8Btn: $('sshCopyPkcs8Btn'),
    downloadPkcs8Btn: $('sshDownloadPkcs8Btn'),

    revealPrivateBtn: $('sshRevealPrivateBtn'),
    privateWrap: $('sshPrivateWrap'),
  };

  if (!els.generateBtn || !els.results) return;

  let lastResult = null;

  function updateAlgorithmVisibility() {
    const algo = els.algorithm.value;
    els.curveWrap.hidden = algo !== 'ecdsa';
    els.bitsWrap.hidden = algo !== 'rsa';
    els.ed25519Note.hidden = algo !== 'ed25519';
  }

  function resolveEngineAlgoId() {
    const algo = els.algorithm.value;
    if (algo === 'ecdsa') return 'ecdsa-' + els.curve.value; // ecdsa-p256 | ecdsa-p384 | ecdsa-p521
    return algo; // ed25519 | rsa
  }

  async function checkEd25519Support() {
    const opt = els.algorithm.querySelector('option[value="ed25519"]');
    const supported = await Engine.isEd25519Supported();
    if (!supported && opt) {
      opt.disabled = true;
      opt.textContent = 'Ed25519 (not supported by this browser)';
      if (els.algorithm.value === 'ed25519') els.algorithm.value = 'ecdsa';
      updateAlgorithmVisibility();
    }
  }

  function setBusy(isBusy) {
    els.generateBtn.disabled = isBusy;
    els.generateBtn.textContent = isBusy ? '⏳ Generating…' : (lastResult ? '🔁 Regenerate Keys' : '🔐 Generate SSH Keys');
    if (els.stickyGenerateBtn) els.stickyGenerateBtn.disabled = isBusy;
  }

  async function generate() {
    setBusy(true);
    try {
      const algorithm = resolveEngineAlgoId();
      const bits = Number(els.bits.value) || 2048;
      const comment = els.comment.value.trim();
      const result = await Engine.generateSSHKeyPair({ algorithm, bits, comment });
      lastResult = result;
      renderResult(result);
    } catch (e) {
      renderError(e);
    } finally {
      setBusy(false);
    }
  }

  function renderError(e) {
    els.emptyState.hidden = false;
    els.results.hidden = true;
    els.emptyState.innerHTML = `<strong>⚠️</strong> Key generation failed: ${Engine ? String(e.message || e) : 'Web Crypto unavailable'}. Try a different algorithm or browser.`;
  }

  function renderResult(result) {
    els.emptyState.hidden = true;
    els.results.hidden = false;

    els.algoLabel.textContent = result.algorithmLabel;
    els.sizeLabel.textContent = result.sizeLabel;
    els.genTime.textContent = `${result.generationTimeMs.toFixed(1)} ms`;
    els.sha256Fp.textContent = result.sha256Fingerprint;
    els.md5Fp.textContent = result.md5Fingerprint;
    els.randomart.textContent = result.randomart;

    els.publicKeyOut.textContent = result.publicKeyLine.trim();
    els.privateKeyOut.textContent = result.privateKeyPem.trim();
    els.pkcs8Out.textContent = result.pkcs8Pem.trim();

    // Re-hide the private key behind a reveal step on every fresh generation
    // (shoulder-surfing / screen-share protection).
    if (els.privateWrap) {
      els.privateWrap.classList.add('is-hidden');
      if (els.revealPrivateBtn) els.revealPrivateBtn.textContent = '👁 Reveal Private Key';
    }

    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  els.algorithm.addEventListener('change', updateAlgorithmVisibility);
  els.generateBtn.addEventListener('click', generate);
  els.stickyGenerateBtn && els.stickyGenerateBtn.addEventListener('click', generate);

  els.revealPrivateBtn && els.revealPrivateBtn.addEventListener('click', () => {
    const hidden = els.privateWrap.classList.toggle('is-hidden');
    els.revealPrivateBtn.textContent = hidden ? '👁 Reveal Private Key' : '🙈 Hide Private Key';
  });

  // ---------- copy / download ----------
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  function flash(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1600);
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function fileBaseName() {
    const algo = els.algorithm.value;
    const suffix = algo === 'ecdsa' ? '_' + els.curve.value : algo === 'rsa' ? '_' + els.bits.value : '';
    return `id_${algo}${suffix}`;
  }

  els.copyPublicBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    const ok = await copyToClipboard(lastResult.publicKeyLine.trim());
    flash(els.copyPublicBtn, ok ? '✅ Copied!' : '❌ Failed');
  });
  els.downloadPublicBtn.addEventListener('click', () => {
    if (!lastResult) return;
    downloadFile(lastResult.publicKeyLine, fileBaseName() + '.pub');
  });
  els.copyPrivateBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    const ok = await copyToClipboard(lastResult.privateKeyPem.trim());
    flash(els.copyPrivateBtn, ok ? '✅ Copied!' : '❌ Failed');
  });
  els.downloadPrivateBtn.addEventListener('click', () => {
    if (!lastResult) return;
    downloadFile(lastResult.privateKeyPem, fileBaseName());
  });
  els.copyPkcs8Btn.addEventListener('click', async () => {
    if (!lastResult) return;
    const ok = await copyToClipboard(lastResult.pkcs8Pem.trim());
    flash(els.copyPkcs8Btn, ok ? '✅ Copied!' : '❌ Failed');
  });
  els.downloadPkcs8Btn.addEventListener('click', () => {
    if (!lastResult) return;
    downloadFile(lastResult.pkcs8Pem, fileBaseName() + '.pkcs8.pem');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      generate();
    }
  });

  // ---------- init ----------
  if (!Engine.isWebCryptoAvailable()) {
    if (els.unsupported) els.unsupported.hidden = false;
    if (els.workspace) els.workspace.hidden = true;
    return;
  }
  updateAlgorithmVisibility();
  checkEd25519Support();
})();
