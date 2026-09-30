/* ToolAdda — JSON to TypeScript Generator UI wiring.
   Depends on window.JSONToTSEngine (assets/js/json-to-typescript.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-jts-page')) return;
  const Engine = window.JSONToTSEngine;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const AUTO_CONVERT_LIMIT = 400 * 1024;
  const STORAGE_KEY = 'tooladda:jts:options';

  const SAMPLE_JSON = {
    id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    isActive: true,
    balance: 1024.5,
    role: 'admin',
    tags: ['engineering', 'founder'],
    address: {
      street: '12 Analytical Engine Way',
      city: 'London',
      zip: 'EC1A 1BB',
      country: null,
    },
    createdAt: '2026-01-15T09:30:00Z',
    website: 'https://example.com/ada',
    orders: [
      { orderId: 1001, total: 59.99, status: 'shipped', items: ['book', 'pen'] },
      { orderId: 1002, total: 12.0, status: 'pending', items: [] },
    ],
    metadata: {},
  };

  const els = {
    input: $('jtsJsonInput'),
    dropZone: $('jtsDropZone'),
    fileInput: $('jtsFileInput'),
    sampleBtn: $('jtsSampleBtn'),
    formatBtn: $('jtsFormatBtn'),
    minifyBtn: $('jtsMinifyBtn'),
    clearBtn: $('jtsClearBtn'),

    validationStatus: $('jtsValidationStatus'),
    validationMessage: $('jtsValidationMessage'),

    statChars: $('jtsStatChars'),
    statObjects: $('jtsStatObjects'),
    statArrays: $('jtsStatArrays'),
    statDepth: $('jtsStatDepth'),
    statInterfaces: $('jtsStatInterfaces'),
    statOutSize: $('jtsStatOutSize'),
    statTime: $('jtsStatTime'),

    preset: $('jtsPreset'),
    declKind: $('jtsDeclKind'),
    rootName: $('jtsRootName'),
    prefix: $('jtsPrefix'),
    suffix: $('jtsSuffix'),
    exportStyle: $('jtsExportStyle'),
    semicolons: $('jtsSemicolons'),
    quoteProps: $('jtsQuoteProps'),
    arrayStyle: $('jtsArrayStyle'),
    optionalMode: $('jtsOptionalMode'),
    nullMode: $('jtsNullMode'),
    readonly: $('jtsReadonly'),
    detectRecord: $('jtsDetectRecord'),
    enumMode: $('jtsEnumMode'),
    jsdoc: $('jtsJsdoc'),
    dedupe: $('jtsDedupe'),
    indent: $('jtsIndent'),
    sortProps: $('jtsSortProps'),

    convertBtn: $('jtsConvertBtn'),
    stickyConvertBtn: $('jtsStickyConvertBtn'),
    copyBtn: $('jtsCopyBtn'),
    downloadBtn: $('jtsDownloadBtn'),
    fullscreenBtn: $('jtsFullscreenBtn'),
    outputPanel: $('jtsOutputPanel'),
    outputPre: $('jtsOutputPre'),
    outputEmpty: $('jtsOutputEmpty'),
    warnings: $('jtsWarnings'),
  };

  if (!els.input || !els.outputPre) return;

  let lastGoodCode = '';
  let debounceTimer = null;

  const PRESETS = {
    default: {},
    react: { declKind: 'interface', readonly: true, optionalMode: 'auto', exportStyle: 'export', nullMode: 'union' },
    angular: { declKind: 'interface', readonly: false, exportStyle: 'export', jsdoc: true },
    vue: { declKind: 'interface', readonly: false, exportStyle: 'export', optionalMode: 'auto' },
    node: { declKind: 'interface', exportStyle: 'export', jsdoc: true },
    nestjs: { declKind: 'class', readonly: false, exportStyle: 'export', jsdoc: true, suffix: 'Dto' },
  };

  function readOptions() {
    return {
      declKind: els.declKind.value,
      rootName: els.rootName.value.trim() || 'Root',
      prefix: els.prefix.value.trim(),
      suffix: els.suffix.value.trim(),
      exportStyle: els.exportStyle.value,
      semicolons: els.semicolons.checked,
      quoteProps: els.quoteProps.value,
      arrayStyle: els.arrayStyle.value,
      optionalMode: els.optionalMode.value,
      nullMode: els.nullMode.value,
      readonly: els.readonly.checked,
      detectRecord: els.detectRecord.checked,
      enumMode: els.enumMode.value,
      jsdoc: els.jsdoc.checked,
      dedupe: els.dedupe.checked,
      indent: els.indent.value,
      sortProps: els.sortProps.checked,
      header: true,
    };
  }

  function persistOptions() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readOptions()));
    } catch (e) { /* storage unavailable — non-fatal */ }
  }

  function restoreOptions() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) { saved = null; }
    if (!saved) return;
    Object.keys(saved).forEach((key) => {
      const el = els[key];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!saved[key];
      else el.value = saved[key];
    });
  }

  function applyPreset(name) {
    const preset = PRESETS[name] || {};
    const merged = Object.assign({ declKind: 'interface', readonly: false, exportStyle: 'export', optionalMode: 'auto', nullMode: 'union', jsdoc: false, suffix: '' }, preset);
    Object.keys(merged).forEach((key) => {
      const el = els[key];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!merged[key];
      else el.value = merged[key];
    });
  }

  function setValidation(state, message) {
    els.validationStatus.textContent = state === 'ok' ? 'Valid' : state === 'error' ? 'Invalid' : 'Empty';
    els.validationStatus.className = 'jts-badge-status ' + (state === 'ok' ? 'jts-badge-ok' : state === 'error' ? 'jts-badge-error' : 'jts-badge-idle');
    els.validationMessage.textContent = message;
  }

  function updateStats(rawStats, result, chars, elapsedMs) {
    els.statChars.textContent = chars.toLocaleString();
    els.statObjects.textContent = rawStats ? String(rawStats.objects) : '—';
    els.statArrays.textContent = rawStats ? String(rawStats.arrays) : '—';
    els.statDepth.textContent = rawStats ? String(rawStats.maxDepth) : '—';
    els.statInterfaces.textContent = result ? String(result.interfaceCount) : '—';
    els.statOutSize.textContent = result ? `${result.code.length.toLocaleString()} chars` : '—';
    els.statTime.textContent = typeof elapsedMs === 'number' ? `${elapsedMs.toFixed(1)} ms` : '—';
  }

  function renderWarnings(warnings) {
    if (!els.warnings) return;
    if (!warnings || !warnings.length) {
      els.warnings.hidden = true;
      els.warnings.innerHTML = '';
      return;
    }
    els.warnings.hidden = false;
    els.warnings.innerHTML = warnings.map((w) => `<li>${Engine.escapeHtml(w)}</li>`).join('');
  }

  function convert() {
    const text = els.input.value;
    const started = performance.now();

    if (!text.trim()) {
      setValidation('idle', 'Paste, upload, or drop JSON to begin.');
      els.outputPre.innerHTML = '';
      els.outputEmpty.hidden = false;
      lastGoodCode = '';
      updateStats(null, null, 0, null);
      renderWarnings(null);
      return;
    }

    let parsed;
    try {
      parsed = Engine.parseJsonText(text);
    } catch (e) {
      setValidation('error', e.message);
      updateStats(null, null, text.length, null);
      renderWarnings(null);
      return;
    }

    const rawStats = Engine.computeRawStats(parsed);
    let result;
    try {
      result = Engine.generate(parsed, readOptions());
    } catch (e) {
      setValidation('error', 'Could not generate TypeScript: ' + e.message);
      return;
    }
    const elapsed = performance.now() - started;

    setValidation('ok', `Valid JSON — generated ${result.interfaceCount} type declaration${result.interfaceCount === 1 ? '' : 's'}.`);
    els.outputEmpty.hidden = true;
    els.outputPre.innerHTML = Engine.highlightTs(result.code);
    lastGoodCode = result.code;
    updateStats(rawStats, result, text.length, elapsed);
    renderWarnings(result.warnings);
    persistOptions();
  }

  function scheduleConvert() {
    clearTimeout(debounceTimer);
    if (els.input.value.length > AUTO_CONVERT_LIMIT) return; // large input: require explicit Convert click
    debounceTimer = setTimeout(convert, 220);
  }

  // ---------- input events ----------
  els.input.addEventListener('input', scheduleConvert);
  [els.declKind, els.exportStyle, els.quoteProps, els.arrayStyle, els.optionalMode, els.nullMode, els.enumMode, els.indent].forEach((el) => {
    el && el.addEventListener('change', convert);
  });
  [els.rootName, els.prefix, els.suffix].forEach((el) => {
    el && el.addEventListener('input', scheduleConvert);
  });
  [els.semicolons, els.readonly, els.detectRecord, els.jsdoc, els.dedupe, els.sortProps].forEach((el) => {
    el && el.addEventListener('change', convert);
  });

  els.preset && els.preset.addEventListener('change', () => {
    applyPreset(els.preset.value);
    convert();
  });

  els.convertBtn && els.convertBtn.addEventListener('click', convert);
  els.stickyConvertBtn && els.stickyConvertBtn.addEventListener('click', () => {
    convert();
    els.outputPanel && els.outputPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  els.sampleBtn && els.sampleBtn.addEventListener('click', () => {
    els.input.value = JSON.stringify(SAMPLE_JSON, null, 2);
    convert();
  });

  els.clearBtn && els.clearBtn.addEventListener('click', () => {
    els.input.value = '';
    els.input.focus();
    convert();
  });

  els.formatBtn && els.formatBtn.addEventListener('click', () => {
    try {
      const parsed = Engine.parseJsonText(els.input.value);
      els.input.value = JSON.stringify(parsed, null, 2);
      convert();
    } catch (e) {
      setValidation('error', e.message);
    }
  });

  els.minifyBtn && els.minifyBtn.addEventListener('click', () => {
    try {
      const parsed = Engine.parseJsonText(els.input.value);
      els.input.value = JSON.stringify(parsed);
      convert();
    } catch (e) {
      setValidation('error', e.message);
    }
  });

  // ---------- file upload + drag & drop ----------
  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.input.value = String(reader.result || '');
      convert();
    };
    reader.readAsText(file);
  }

  els.fileInput && els.fileInput.addEventListener('change', (e) => {
    loadFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  if (els.dropZone) {
    ['dragenter', 'dragover'].forEach((evt) => {
      els.dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropZone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      els.dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropZone.classList.remove('is-dragover');
      });
    });
    els.dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
  }

  // ---------- copy / download / fullscreen ----------
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

  els.copyBtn && els.copyBtn.addEventListener('click', async () => {
    if (!lastGoodCode) return;
    const ok = await copyToClipboard(lastGoodCode);
    const original = els.copyBtn.textContent;
    els.copyBtn.textContent = ok ? '✅ Copied!' : '❌ Copy failed';
    setTimeout(() => { els.copyBtn.textContent = original; }, 1600);
  });

  els.downloadBtn && els.downloadBtn.addEventListener('click', () => {
    if (!lastGoodCode) return;
    const blob = new Blob([lastGoodCode], { type: 'text/typescript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = (els.rootName.value.trim() || 'types').replace(/[^A-Za-z0-9_-]/g, '') || 'types';
    a.href = url;
    a.download = `${name}.ts`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  els.fullscreenBtn && els.fullscreenBtn.addEventListener('click', () => {
    const isFs = document.body.classList.toggle('jts-output-fullscreen');
    els.fullscreenBtn.setAttribute('aria-pressed', String(isFs));
    els.fullscreenBtn.textContent = isFs ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
    if (isFs) els.outputPre.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('jts-output-fullscreen')) {
      document.body.classList.remove('jts-output-fullscreen');
      if (els.fullscreenBtn) {
        els.fullscreenBtn.setAttribute('aria-pressed', 'false');
        els.fullscreenBtn.textContent = '⛶ Fullscreen';
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      convert();
    }
  });

  // ---------- init ----------
  restoreOptions();
  if (!els.input.value.trim()) {
    els.input.value = JSON.stringify(SAMPLE_JSON, null, 2);
  }
  convert();
})();
