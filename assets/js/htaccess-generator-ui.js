/* ToolAdda — .htaccess Generator UI wiring.
   Depends on window.HtaccessGen (assets/js/htaccess-generator.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-hta-page')) return;
  const Engine = window.HtaccessGen;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'tooladda:htaccess:options';

  const els = {
    preset: $('htaPreset'),
    httpsRedirect: $('htaHttpsRedirect'),
    wwwRedirect: $('htaWwwRedirect'),
    trailingSlash: $('htaTrailingSlash'),
    removeIndexPhp: $('htaRemoveIndexPhp'),
    removeHtmlExt: $('htaRemoveHtmlExt'),
    redirectRows: $('htaRedirectRows'),
    addRedirectBtn: $('htaAddRedirectBtn'),
    rewritePreset: $('htaRewritePreset'),

    disableDirectoryListing: $('htaDisableDirListing'),
    protectSensitiveFiles: $('htaProtectSensitive'),
    protectBackupFiles: $('htaProtectBackup'),
    disableTrace: $('htaDisableTrace'),
    hideServerSignature: $('htaHideServerSig'),
    blockHotlinking: $('htaBlockHotlink'),
    hotlinkDomains: $('htaHotlinkDomains'),
    blockBadBots: $('htaBlockBadBots'),
    blockIps: $('htaBlockIps'),
    allowOnlyIps: $('htaAllowOnlyIps'),

    headerXContentTypeOptions: $('htaHeaderXCTO'),
    headerXFrameOptions: $('htaHeaderXFO'),
    headerXssProtection: $('htaHeaderXSS'),
    headerReferrerPolicy: $('htaHeaderReferrer'),
    headerPermissionsPolicy: $('htaHeaderPermissions'),
    headerHsts: $('htaHeaderHsts'),
    headerCsp: $('htaHeaderCsp'),

    browserCaching: $('htaBrowserCaching'),
    gzipCompression: $('htaGzip'),
    removeETags: $('htaRemoveETags'),

    custom404: $('htaCustom404'),
    custom500: $('htaCustom500'),

    enableCors: $('htaEnableCors'),
    corsOrigin: $('htaCorsOrigin'),
    corsMethods: $('htaCorsMethods'),
    corsHeaders: $('htaCorsHeaders'),

    phpMemoryLimit: $('htaPhpMemory'),
    phpUploadMaxFilesize: $('htaPhpUpload'),
    phpMaxExecutionTime: $('htaPhpExecTime'),
    phpTimezone: $('htaPhpTimezone'),
    phpDisplayErrors: $('htaPhpDisplayErrors'),

    outputPre: $('htaOutputPre'),
    copyBtn: $('htaCopyBtn'),
    downloadBtn: $('htaDownloadBtn'),
    printBtn: $('htaPrintBtn'),
    resetBtn: $('htaResetBtn'),
    generateBtn: $('htaGenerateBtn'),
    stickyGenerateBtn: $('htaStickyGenerateBtn'),
    warnings: $('htaWarnings'),
    statRules: $('htaStatRules'),
    statWarnings: $('htaStatWarnings'),
    statSize: $('htaStatSize'),
  };

  if (!els.outputPre || !els.generateBtn) return;

  const BOOLEAN_FIELDS = [
    'removeIndexPhp', 'removeHtmlExt',
    'disableDirectoryListing', 'protectSensitiveFiles', 'protectBackupFiles', 'disableTrace', 'hideServerSignature',
    'blockHotlinking', 'blockBadBots',
    'headerXContentTypeOptions', 'headerXFrameOptions', 'headerXssProtection', 'headerReferrerPolicy', 'headerPermissionsPolicy', 'headerHsts',
    'browserCaching', 'gzipCompression', 'removeETags', 'enableCors',
  ];
  const TEXT_FIELDS = [
    'hotlinkDomains', 'blockIps', 'allowOnlyIps', 'headerCsp', 'custom404', 'custom500',
    'corsOrigin', 'corsMethods', 'corsHeaders', 'phpMemoryLimit', 'phpUploadMaxFilesize', 'phpMaxExecutionTime', 'phpTimezone',
  ];
  const SELECT_FIELDS = ['httpsRedirect', 'wwwRedirect', 'trailingSlash', 'rewritePreset', 'phpDisplayErrors'];

  function readRedirectRows() {
    return Array.from(els.redirectRows.querySelectorAll('.hta-redirect-row')).map((row) => ({
      code: Number(row.querySelector('.hta-redirect-code').value),
      from: row.querySelector('.hta-redirect-from').value.trim(),
      to: row.querySelector('.hta-redirect-to').value.trim(),
      wildcard: row.querySelector('.hta-redirect-wildcard').checked,
    }));
  }

  function readOptions() {
    const opts = {};
    BOOLEAN_FIELDS.forEach((f) => { opts[f] = !!els[f].checked; });
    TEXT_FIELDS.forEach((f) => { opts[f] = els[f].value; });
    SELECT_FIELDS.forEach((f) => { opts[f] = els[f].value; });
    opts.customRedirects = readRedirectRows();
    return opts;
  }

  function applyOptionsToForm(opts) {
    BOOLEAN_FIELDS.forEach((f) => { if (f in opts) els[f].checked = !!opts[f]; });
    TEXT_FIELDS.forEach((f) => { if (f in opts) els[f].value = opts[f] || ''; });
    SELECT_FIELDS.forEach((f) => { if (f in opts) els[f].value = opts[f]; });
  }

  function addRedirectRow(data) {
    const row = document.createElement('div');
    row.className = 'hta-redirect-row';
    row.innerHTML = `
      <select class="hta-redirect-code" aria-label="Redirect status code">
        <option value="301">301 Permanent</option>
        <option value="302">302 Temporary</option>
        <option value="307">307 Temporary (method preserved)</option>
        <option value="308">308 Permanent (method preserved)</option>
      </select>
      <input type="text" class="hta-redirect-from" placeholder="/old-path or ^/blog/(.*)$" />
      <input type="text" class="hta-redirect-to" placeholder="/new-path or /articles/$1" />
      <label class="hta-redirect-wc-label"><input type="checkbox" class="hta-redirect-wildcard" /> Regex</label>
      <button type="button" class="hta-mini-btn hta-remove-row" aria-label="Remove this redirect">✕</button>
    `;
    if (data) {
      row.querySelector('.hta-redirect-code').value = String(data.code || 301);
      row.querySelector('.hta-redirect-from').value = data.from || '';
      row.querySelector('.hta-redirect-to').value = data.to || '';
      row.querySelector('.hta-redirect-wildcard').checked = !!data.wildcard;
    }
    row.querySelector('.hta-remove-row').addEventListener('click', () => {
      row.remove();
      generate();
    });
    row.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', scheduleGenerate));
    els.redirectRows.appendChild(row);
  }

  function persist() {
    try {
      const opts = readOptions();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
    } catch (e) { /* storage unavailable — non-fatal */ }
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return;
    applyOptionsToForm(saved);
    (saved.customRedirects || []).forEach((r) => addRedirectRow(r));
  }

  function renderWarnings(warnings) {
    if (!warnings || !warnings.length) {
      els.warnings.hidden = true;
      els.warnings.innerHTML = '';
      return;
    }
    els.warnings.hidden = false;
    els.warnings.innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let lastCode = '';
  function generate() {
    const opts = readOptions();
    const { code, warnings, ruleCount } = Engine.generateHtaccess(opts);
    els.outputPre.textContent = code;
    lastCode = code;
    renderWarnings(warnings);
    els.statRules.textContent = String(ruleCount);
    els.statWarnings.textContent = String(warnings.length);
    els.statSize.textContent = `${code.length.toLocaleString()} chars`;
    persist();
  }

  let debounceTimer = null;
  function scheduleGenerate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(generate, 150);
  }

  // ---------- bind live inputs ----------
  [...BOOLEAN_FIELDS, ...SELECT_FIELDS].forEach((f) => els[f].addEventListener('change', generate));
  TEXT_FIELDS.forEach((f) => els[f].addEventListener('input', scheduleGenerate));

  els.preset.addEventListener('change', () => {
    if (!els.preset.value) return;
    const opts = Engine.applyPreset(els.preset.value, {});
    applyOptionsToForm(opts);
    els.redirectRows.innerHTML = '';
    generate();
  });

  els.addRedirectBtn.addEventListener('click', () => { addRedirectRow(); });

  els.generateBtn.addEventListener('click', generate);
  els.stickyGenerateBtn && els.stickyGenerateBtn.addEventListener('click', () => {
    generate();
    els.outputPre.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  els.resetBtn.addEventListener('click', () => {
    applyOptionsToForm(Engine.DEFAULT_OPTIONS);
    els.redirectRows.innerHTML = '';
    els.preset.value = '';
    generate();
  });

  // ---------- copy / download / print ----------
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

  els.copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(lastCode);
    const original = els.copyBtn.textContent;
    els.copyBtn.textContent = ok ? '✅ Copied!' : '❌ Copy failed';
    setTimeout(() => { els.copyBtn.textContent = original; }, 1600);
  });

  els.downloadBtn.addEventListener('click', () => {
    const blob = new Blob([lastCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.htaccess';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  els.printBtn.addEventListener('click', () => window.print());

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      generate();
    }
  });

  // ---------- init ----------
  restore();
  if (!els.redirectRows.children.length) addRedirectRow();
  generate();
})();
