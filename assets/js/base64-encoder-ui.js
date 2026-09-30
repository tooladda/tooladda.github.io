/*
 * ToolAdda Base64 Studio — encode/decode engine + UI binding.
 * 100% client-side: text, JSON/HTML/XML/SVG, images, and arbitrary files.
 */
const Base64Studio = (() => {
  const MAX_HISTORY = 15;
  const MAX_UNDO = 50;
  const HISTORY_KEY = 'tooladda_base64_history_v1';
  const CHUNK = 0x8000;

  /* ---------------------------------------------------------------- */
  /* Pure helpers                                                      */
  /* ---------------------------------------------------------------- */

  const textEncoder = new TextEncoder();

  const bytesToBase64 = (bytes, urlSafe) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    let b64 = btoa(binary);
    if (urlSafe) {
      b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return b64;
  };

  const normalizeBase64 = (value) => {
    let cleaned = value.replace(/\s+/g, '');
    cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    const remainder = cleaned.length % 4;
    if (remainder === 2) cleaned += '==';
    else if (remainder === 3) cleaned += '=';
    else if (remainder === 1) throw new Error('Invalid Base64 length.');
    return cleaned;
  };

  const base64ToBytes = (value) => {
    const normalized = normalizeBase64(value);
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const bytesToUtf8Strict = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

  const BASE64_CHARSET_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

  const isBase64Shaped = (raw) => {
    const stripped = raw.replace(/\s+/g, '');
    if (!stripped) return false;
    if (!BASE64_CHARSET_RE.test(stripped)) return false;
    const withoutPad = stripped.replace(/=+$/, '');
    if (/[-_]/.test(withoutPad) && /[+/]/.test(withoutPad)) return false; // mixed charset = not valid either flavor
    return true;
  };

  const looksLikeAutoBase64 = (raw) => {
    const stripped = raw.replace(/\s+/g, '');
    if (stripped.length < 8) return false;
    if (!isBase64Shaped(stripped)) return false;
    try {
      normalizeBase64(stripped);
    } catch (e) {
      return false;
    }
    return true;
  };

  const MAGIC = [
    { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png' },
    { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], ext: 'jpg' },
    { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38], ext: 'gif' },
    { mime: 'image/bmp', bytes: [0x42, 0x4d], ext: 'bmp' },
    { mime: 'image/x-icon', bytes: [0x00, 0x00, 0x01, 0x00], ext: 'ico' },
    { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46], ext: 'pdf' },
    { mime: 'application/gzip', bytes: [0x1f, 0x8b], ext: 'gz' },
    { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04], ext: 'zip' },
    { mime: 'audio/mpeg', bytes: [0x49, 0x44, 0x33], ext: 'mp3' },
    { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', offsetCheck: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
  ];

  const sniffBinaryMime = (bytes) => {
    for (const sig of MAGIC) {
      if (bytes.length < sig.bytes.length) continue;
      let match = sig.bytes.every((b, i) => bytes[i] === b);
      if (match && sig.offsetCheck) {
        const { offset, bytes: checkBytes } = sig.offsetCheck;
        match = checkBytes.every((b, i) => bytes[offset + i] === b);
      }
      if (match) return { mime: sig.mime, ext: sig.ext };
    }
    return { mime: 'application/octet-stream', ext: 'bin' };
  };

  const sniffTextMime = (text) => {
    const trimmed = text.trim();
    if (!trimmed) return { mime: 'text/plain', ext: 'txt', kind: 'plain' };
    if (/^<\?xml/i.test(trimmed) && /<svg[\s>]/i.test(trimmed.slice(0, 400))) return { mime: 'image/svg+xml', ext: 'svg', kind: 'svg' };
    if (/^<svg[\s>]/i.test(trimmed)) return { mime: 'image/svg+xml', ext: 'svg', kind: 'svg' };
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) ) {
      try { JSON.parse(trimmed); return { mime: 'application/json', ext: 'json', kind: 'json' }; } catch (e) { /* not json */ }
    }
    if (/^<\?xml/i.test(trimmed)) return { mime: 'application/xml', ext: 'xml', kind: 'xml' };
    if (/^<!doctype html|^<html[\s>]/i.test(trimmed)) return { mime: 'text/html', ext: 'html', kind: 'html' };
    if (/^</.test(trimmed) && /<\/[a-zA-Z][\w:-]*>\s*$/.test(trimmed)) return { mime: 'application/xml', ext: 'xml', kind: 'xml' };
    return { mime: 'text/plain', ext: 'txt', kind: 'plain' };
  };

  const formatBytes = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const prettyJson = (str) => JSON.stringify(JSON.parse(str), null, 2);
  const minifyJson = (str) => JSON.stringify(JSON.parse(str));

  const prettyMarkup = (str) => {
    const collapsed = str.replace(/>\s*</g, '><').trim();
    let depth = 0;
    const lines = [];
    collapsed.split(/(?=<)/).forEach((raw) => {
      const chunk = raw.trim();
      if (!chunk) return;
      const isClosing = /^<\//.test(chunk);
      const isSelfClosing = /\/>\s*$/.test(chunk) || /^<(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)\b/i.test(chunk);
      const isDecl = /^<[!?]/.test(chunk);
      if (isClosing) depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + chunk);
      if (!isClosing && !isSelfClosing && !isDecl) depth += 1;
    });
    return lines.join('\n');
  };

  const minifyMarkup = (str) => str.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();

  const isLikelyJson = (str) => {
    const t = str.trim();
    if (!t || (t[0] !== '{' && t[0] !== '[')) return false;
    try { JSON.parse(t); return true; } catch (e) { return false; }
  };
  const isLikelyMarkup = (str) => /^\s*</.test(str);

  /* ---------------------------------------------------------------- */
  /* Module state + DOM binding                                        */
  /* ---------------------------------------------------------------- */

  const bind = () => {
    const page = document.querySelector('[data-bx-page]');
    if (!page) return;

    const el = (sel) => page.querySelector(sel);
    const els = (sel) => Array.from(page.querySelectorAll(sel));

    const dom = {
      modeTabs: els('[data-bx-mode]'),
      sourceTabs: els('[data-bx-source]'),
      sourcePanels: els('[data-bx-source-panel]'),
      input: el('[data-bx-input]'),
      output: el('[data-bx-output]'),
      format: el('[data-bx-format]'),
      urlSafe: el('[data-bx-urlsafe]'),
      live: el('[data-bx-live]'),
      dropzone: el('[data-bx-dropzone]'),
      fileInput: el('[data-bx-file-input]'),
      urlInput: el('[data-bx-url-input]'),
      urlImport: el('[data-bx-url-import]'),
      fileQueue: el('[data-bx-file-queue]'),
      zipAllBtn: el('[data-bx-download-zip]'),
      imagePreviewWrap: el('[data-bx-image-preview]'),
      imagePreviewImg: el('[data-bx-image-preview-img]'),
      filePreviewWrap: el('[data-bx-file-preview]'),
      filePreviewName: el('[data-bx-file-preview-name]'),
      filePreviewMeta: el('[data-bx-file-preview-meta]'),
      message: el('[data-bx-message]'),
      validation: el('[data-bx-validation]'),
      statInputChars: el('[data-bx-stat-input-chars]'),
      statInputBytes: el('[data-bx-stat-input-bytes]'),
      statOutputChars: el('[data-bx-stat-output-chars]'),
      statOutputBytes: els('[data-bx-stat-output-bytes]'),
      statDelta: el('[data-bx-stat-delta]'),
      statTime: el('[data-bx-stat-time]'),
      statMime: el('[data-bx-stat-mime]'),
      runEncode: el('[data-bx-run-encode]'),
      runDecode: el('[data-bx-run-decode]'),
      pretty: el('[data-bx-pretty]'),
      minify: el('[data-bx-minify]'),
      validate: el('[data-bx-validate]'),
      copy: el('[data-bx-copy]'),
      copyImage: el('[data-bx-copy-image]'),
      paste: el('[data-bx-paste]'),
      clear: el('[data-bx-clear]'),
      swap: el('[data-bx-swap]'),
      download: el('[data-bx-download]'),
      downloadFile: els('[data-bx-download-file]'),
      downloadImage: el('[data-bx-download-image]'),
      share: el('[data-bx-share]'),
      undo: el('[data-bx-undo]'),
      redo: el('[data-bx-redo]'),
      historyList: el('[data-bx-history-list]'),
      historyClear: el('[data-bx-history-clear]'),
      stickyEncode: document.querySelector('[data-bx-sticky-encode]'),
      stickyDecode: document.querySelector('[data-bx-sticky-decode]'),
    };

    if (!dom.input || !dom.output) return;

    const state = {
      mode: 'auto',
      source: 'text',
      urlSafe: false,
      live: true,
      formatHint: 'plain',
      outputBytes: null,
      outputMime: 'text/plain',
      outputExt: 'txt',
      outputIsBinary: false,
      queue: [],
    };

    if (dom.urlSafe) state.urlSafe = dom.urlSafe.checked;
    if (dom.live) state.live = dom.live.checked;
    if (dom.format) state.formatHint = dom.format.value;

    const FORMAT_HINTS = {
      json: { mime: 'application/json', ext: 'json' },
      html: { mime: 'text/html', ext: 'html' },
      xml: { mime: 'application/xml', ext: 'xml' },
      svg: { mime: 'image/svg+xml', ext: 'svg' },
      css: { mime: 'text/css', ext: 'css' },
      js: { mime: 'application/javascript', ext: 'js' },
    };

    const undoStack = [];
    let undoIndex = -1;
    let suppressSnapshot = false;

    /* ---------------- messages / validation ---------------- */

    const showMessage = (text, type = 'success') => {
      if (!dom.message) return;
      dom.message.textContent = text;
      dom.message.classList.remove('hidden', 'success', 'error');
      dom.message.classList.add(type);
    };
    const clearMessage = () => {
      if (!dom.message) return;
      dom.message.textContent = '';
      dom.message.classList.add('hidden');
    };

    const setValidation = (state2, text) => {
      if (!dom.validation) return;
      dom.validation.textContent = text;
      dom.validation.classList.remove('is-valid', 'is-invalid', 'is-neutral');
      dom.validation.classList.add(`is-${state2}`);
    };

    /* ---------------- undo/redo ---------------- */

    const snapshotInput = () => {
      if (suppressSnapshot) return;
      const value = dom.input.value;
      if (undoStack[undoIndex] === value) return;
      undoStack.splice(undoIndex + 1);
      undoStack.push(value);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      undoIndex = undoStack.length - 1;
    };
    const debouncedSnapshot = debounce(snapshotInput, 600);

    const applyUndo = () => {
      if (undoIndex <= 0) return;
      undoIndex -= 1;
      suppressSnapshot = true;
      dom.input.value = undoStack[undoIndex];
      suppressSnapshot = false;
      handleInputChange({ skipSnapshot: true });
    };
    const applyRedo = () => {
      if (undoIndex >= undoStack.length - 1) return;
      undoIndex += 1;
      suppressSnapshot = true;
      dom.input.value = undoStack[undoIndex];
      suppressSnapshot = false;
      handleInputChange({ skipSnapshot: true });
    };

    /* ---------------- history ---------------- */

    const loadHistory = () => {
      try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      } catch (e) {
        return [];
      }
    };
    const saveHistory = (list) => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
      } catch (e) { /* storage full or unavailable */ }
    };
    const pushHistory = (entry) => {
      if (!dom.historyList) return;
      const list = loadHistory();
      list.unshift(entry);
      saveHistory(list);
      renderHistory();
    };
    const renderHistory = () => {
      if (!dom.historyList) return;
      const list = loadHistory();
      dom.historyList.innerHTML = '';
      if (!list.length) {
        dom.historyList.innerHTML = '<li class="bx-history-empty">No conversions yet. Your recent encode/decode runs will show up here.</li>';
        return;
      }
      list.forEach((entry) => {
        const li = document.createElement('li');
        li.className = 'bx-history-item';
        li.innerHTML = `<button type="button" class="bx-history-btn"><span class="bx-history-dir">${entry.dir === 'encode' ? '→ Encoded' : '← Decoded'}</span><span class="bx-history-preview">${escapeHtml(entry.inputPreview)}</span></button>`;
        li.querySelector('button').addEventListener('click', () => {
          suppressSnapshot = true;
          dom.input.value = entry.inputFull;
          suppressSnapshot = false;
          snapshotInput();
          handleInputChange();
          showMessage('Restored from history.');
        });
        dom.historyList.appendChild(li);
      });
    };
    if (dom.historyClear) {
      dom.historyClear.addEventListener('click', () => {
        saveHistory([]);
        renderHistory();
        showMessage('History cleared.');
      });
    }

    const escapeHtml = (str) => str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /* ---------------- stats ---------------- */

    const updateStats = (outputByteLen, elapsedMs) => {
      const inputChars = dom.input.value.length;
      const inputBytes = textEncoder.encode(dom.input.value).length;
      const outputChars = dom.output.value.length;
      if (dom.statInputChars) dom.statInputChars.textContent = inputChars.toLocaleString();
      if (dom.statInputBytes) dom.statInputBytes.textContent = formatBytes(inputBytes);
      if (dom.statOutputChars) dom.statOutputChars.textContent = outputChars.toLocaleString();
      const outputBytesText = typeof outputByteLen === 'number' ? formatBytes(outputByteLen) : '—';
      dom.statOutputBytes.forEach((elx) => { elx.textContent = outputBytesText; });
      if (dom.statDelta && typeof outputByteLen === 'number' && inputBytes > 0) {
        const pct = (((outputByteLen - inputBytes) / inputBytes) * 100);
        dom.statDelta.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      } else if (dom.statDelta) {
        dom.statDelta.textContent = '—';
      }
      if (dom.statTime) dom.statTime.textContent = typeof elapsedMs === 'number' ? `${elapsedMs.toFixed(1)} ms` : '—';
      if (dom.statMime) dom.statMime.textContent = state.outputMime || '—';
    };

    /* ---------------- preview panels ---------------- */

    const hidePreviews = () => {
      if (dom.imagePreviewWrap) dom.imagePreviewWrap.hidden = true;
      if (dom.filePreviewWrap) dom.filePreviewWrap.hidden = true;
    };

    const showImagePreview = (base64, mime) => {
      hidePreviews();
      if (!dom.imagePreviewWrap || !dom.imagePreviewImg) return;
      dom.imagePreviewImg.src = `data:${mime};base64,${base64}`;
      dom.imagePreviewWrap.hidden = false;
    };

    const showFilePreview = (name, mime, size) => {
      hidePreviews();
      if (!dom.filePreviewWrap) return;
      if (dom.filePreviewName) dom.filePreviewName.textContent = name;
      if (dom.filePreviewMeta) dom.filePreviewMeta.textContent = `${mime} · ${formatBytes(size)}`;
      dom.filePreviewWrap.hidden = false;
    };

    /* ---------------- core processing ---------------- */

    const setOutputBinaryNote = (mime, byteLen, isImage) => {
      state.outputIsBinary = true;
      state.outputMime = mime;
      dom.output.value = `[Binary output detected — ${mime}, ${formatBytes(byteLen)}]\nUse ${isImage ? 'the image preview' : 'Download File'} below to save it. The Base64 string itself is still in the input box on the left if you need to copy it.`;
      dom.output.classList.add('is-note');
    };

    const clearOutputNote = () => {
      dom.output.classList.remove('is-note');
    };

    const runEncodeFromText = () => {
      const started = performance.now();
      const raw = dom.input.value;
      if (!raw) {
        dom.output.value = '';
        state.outputBytes = null;
        clearOutputNote();
        hidePreviews();
        updateStats(undefined, undefined);
        return;
      }
      const bytes = textEncoder.encode(raw);
      const b64 = bytesToBase64(bytes, state.urlSafe);
      dom.output.value = b64;
      clearOutputNote();
      state.outputBytes = bytes;
      state.outputIsBinary = false;
      const hint = FORMAT_HINTS[state.formatHint];
      const sniff = hint || sniffTextMime(raw);
      state.outputMime = sniff.mime;
      state.outputExt = sniff.ext;
      hidePreviews();
      updateStats(bytes.length, performance.now() - started);
      setValidation('neutral', 'Encoded — this is a fresh Base64 string, not something to validate.');
      return { dir: 'encode', bytes };
    };

    const runDecodeFromText = (opts = {}) => {
      const started = performance.now();
      const raw = dom.input.value.trim();
      if (!raw) {
        dom.output.value = '';
        state.outputBytes = null;
        clearOutputNote();
        hidePreviews();
        updateStats(undefined, undefined);
        setValidation('neutral', 'Paste a Base64 string to validate it.');
        return;
      }
      if (!isBase64Shaped(raw)) {
        if (!opts.silent) showMessage('This does not look like valid Base64 (unexpected characters).', 'error');
        setValidation('invalid', '✕ Not valid Base64 — contains characters outside A–Z, a–z, 0–9, +, /, -, _ or has bad padding.');
        return;
      }
      let bytes;
      try {
        bytes = base64ToBytes(raw);
      } catch (e) {
        if (!opts.silent) showMessage('Invalid Base64 string — check length and padding.', 'error');
        setValidation('invalid', `✕ Invalid Base64 — ${e.message}`);
        return;
      }
      clearOutputNote();
      state.outputBytes = bytes;
      const sniff = sniffBinaryMime(bytes);
      let asText = null;
      try {
        asText = bytesToUtf8Strict(bytes);
      } catch (e) {
        asText = null;
      }
      const looksTextual = asText !== null && sniff.mime === 'application/octet-stream';
      if (looksTextual) {
        state.outputIsBinary = false;
        dom.output.value = asText;
        const textSniff = sniffTextMime(asText);
        state.outputMime = textSniff.mime;
        state.outputExt = textSniff.ext;
        hidePreviews();
        if (textSniff.kind === 'svg') showImagePreview(raw.replace(/\s+/g, ''), 'image/svg+xml');
      } else {
        state.outputIsBinary = true;
        state.outputMime = sniff.mime;
        state.outputExt = sniff.ext;
        const isImage = sniff.mime.startsWith('image/');
        setOutputBinaryNote(sniff.mime, bytes.length, isImage);
        if (isImage) {
          showImagePreview(raw.replace(/\s+/g, ''), sniff.mime);
        } else {
          showFilePreview(`decoded-file.${sniff.ext}`, sniff.mime, bytes.length);
        }
      }
      updateStats(bytes.length, performance.now() - started);
      setValidation('valid', `✓ Valid Base64 — decodes to ${formatBytes(bytes.length)}${looksTextual ? ' of UTF-8 text' : ` of ${sniff.mime}`}.`);
      return { dir: 'decode', bytes };
    };

    const runAuto = (opts = {}) => {
      const raw = dom.input.value;
      if (!raw.trim()) {
        dom.output.value = '';
        state.outputBytes = null;
        clearOutputNote();
        hidePreviews();
        updateStats(undefined, undefined);
        return;
      }
      if (looksLikeAutoBase64(raw)) {
        const result = runDecodeFromText({ silent: true });
        if (result) return result;
      }
      return runEncodeFromText();
    };

    const runByMode = (opts = {}) => {
      if (state.source === 'file') return; // file mode drives its own output
      let result;
      if (state.mode === 'encode') result = runEncodeFromText();
      else if (state.mode === 'decode') result = runDecodeFromText(opts);
      else result = runAuto(opts);
      const shouldRecord = result && opts.force;
      if (shouldRecord) {
        pushHistory({
          dir: result.dir,
          inputPreview: dom.input.value.slice(0, 90),
          inputFull: dom.input.value,
        });
      }
      return result;
    };

    /* ---------------- input change handling ---------------- */

    function handleInputChange(opts = {}) {
      clearMessage();
      if (!opts.skipSnapshot) debouncedSnapshot();
      if (state.mode === 'decode' || state.mode === 'auto') {
        // live validation feedback even without live-processing toggle
      }
      if (state.live) {
        runByMode({ silent: true });
      }
    }

    dom.input.addEventListener('input', () => handleInputChange());

    /* ---------------- mode / source tabs ---------------- */

    dom.modeTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.modeTabs.forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
        state.mode = btn.getAttribute('data-bx-mode');
        runByMode({ silent: true });
      });
    });

    dom.sourceTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.sourceTabs.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const src = btn.getAttribute('data-bx-source');
        state.source = src;
        dom.sourcePanels.forEach((panel) => {
          panel.hidden = panel.getAttribute('data-bx-source-panel') !== src;
        });
      });
    });

    if (dom.urlSafe) {
      dom.urlSafe.addEventListener('change', () => {
        state.urlSafe = dom.urlSafe.checked;
        if (state.source === 'text') runByMode({ silent: true });
      });
    }
    if (dom.format) {
      dom.format.addEventListener('change', () => {
        state.formatHint = dom.format.value;
        if (state.source === 'text') runByMode({ silent: true });
      });
    }
    if (dom.live) {
      dom.live.addEventListener('change', () => {
        state.live = dom.live.checked;
      });
    }

    /* ---------------- toolbar buttons ---------------- */

    if (dom.runEncode) dom.runEncode.addEventListener('click', () => { state.mode = 'encode'; syncModeTabUI(); runByMode({ force: true }); });
    if (dom.runDecode) dom.runDecode.addEventListener('click', () => { state.mode = 'decode'; syncModeTabUI(); runByMode({ force: true }); });

    function syncModeTabUI() {
      dom.modeTabs.forEach((b) => {
        const active = b.getAttribute('data-bx-mode') === state.mode;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
    }

    if (dom.pretty) {
      dom.pretty.addEventListener('click', () => {
        try {
          if (isLikelyJson(dom.output.value)) { dom.output.value = prettyJson(dom.output.value); showMessage('Output formatted as pretty JSON.'); }
          else if (isLikelyMarkup(dom.output.value)) { dom.output.value = prettyMarkup(dom.output.value); showMessage('Output formatted (basic markup indenter).'); }
          else if (isLikelyJson(dom.input.value)) { dom.input.value = prettyJson(dom.input.value); handleInputChange(); showMessage('Input formatted as pretty JSON.'); }
          else if (isLikelyMarkup(dom.input.value)) { dom.input.value = prettyMarkup(dom.input.value); handleInputChange(); showMessage('Input formatted (basic markup indenter).'); }
          else showMessage('Nothing recognizable to format — this works on JSON, HTML, XML, or SVG.', 'error');
        } catch (e) { showMessage('Could not format — the content is not valid JSON/markup.', 'error'); }
      });
    }
    if (dom.minify) {
      dom.minify.addEventListener('click', () => {
        try {
          if (isLikelyJson(dom.output.value)) { dom.output.value = minifyJson(dom.output.value); showMessage('Output minified.'); }
          else if (isLikelyMarkup(dom.output.value)) { dom.output.value = minifyMarkup(dom.output.value); showMessage('Output minified.'); }
          else if (isLikelyJson(dom.input.value)) { dom.input.value = minifyJson(dom.input.value); handleInputChange(); showMessage('Input minified.'); }
          else if (isLikelyMarkup(dom.input.value)) { dom.input.value = minifyMarkup(dom.input.value); handleInputChange(); showMessage('Input minified.'); }
          else showMessage('Nothing recognizable to minify — this works on JSON, HTML, XML, or SVG.', 'error');
        } catch (e) { showMessage('Could not minify — the content is not valid JSON/markup.', 'error'); }
      });
    }
    if (dom.validate) {
      dom.validate.addEventListener('click', () => {
        const prevMode = state.mode;
        state.mode = 'decode';
        const result = runDecodeFromText();
        state.mode = prevMode;
        if (result) showMessage('Base64 string is valid.');
        else if (dom.input.value.trim()) showMessage('Validation failed — see the status message below.', 'error');
        else showMessage('Paste a Base64 string to validate first.', 'error');
      });
    }

    if (dom.swap) {
      dom.swap.addEventListener('click', () => {
        if (state.outputIsBinary || dom.output.classList.contains('is-note')) {
          showMessage('Cannot swap binary output — copy or download it instead.', 'error');
          return;
        }
        const inV = dom.input.value;
        const outV = dom.output.value;
        dom.input.value = outV;
        snapshotInput();
        dom.output.value = inV;
        state.outputIsBinary = false;
        state.outputBytes = null;
        clearOutputNote();
        hidePreviews();
        if (state.live) handleInputChange({ skipSnapshot: true });
        else updateStats(textEncoder.encode(dom.input.value).length, undefined);
        showMessage('Swapped input and output.');
      });
    }
    if (dom.clear) {
      dom.clear.addEventListener('click', () => {
        dom.input.value = '';
        dom.output.value = '';
        clearOutputNote();
        hidePreviews();
        state.outputBytes = null;
        snapshotInput();
        updateStats(undefined, undefined);
        setValidation('neutral', 'Paste a Base64 string to validate it.');
        clearMessage();
        showMessage('Cleared.');
      });
    }
    if (dom.copy) {
      dom.copy.addEventListener('click', async () => {
        if (!dom.output.value) { showMessage('Nothing to copy yet.', 'error'); return; }
        if (state.outputIsBinary) { showMessage('This is binary output — use Download File, Download Image, or Copy Image instead.', 'error'); return; }
        try { await navigator.clipboard.writeText(dom.output.value); showMessage('Output copied to clipboard.'); }
        catch (e) { showMessage('Clipboard access failed.', 'error'); }
      });
    }
    if (dom.copyImage) {
      dom.copyImage.addEventListener('click', async () => {
        try {
          if (!state.outputBytes) throw new Error('no bytes');
          const blob = new Blob([state.outputBytes], { type: state.outputMime });
          await navigator.clipboard.write([new ClipboardItem({ [state.outputMime]: blob })]);
          showMessage('Image copied to clipboard.');
        } catch (e) { showMessage('Your browser blocked copying the image — try Download instead.', 'error'); }
      });
    }
    if (dom.paste) {
      dom.paste.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          dom.input.value = text;
          snapshotInput();
          handleInputChange();
          showMessage('Pasted from clipboard.');
        } catch (e) { showMessage('Unable to read the clipboard — check browser permissions.', 'error'); }
      });
    }

    if (dom.download) {
      dom.download.addEventListener('click', () => {
        if (!dom.output.value || state.outputIsBinary) { showMessage('Generate text output before downloading as TXT.', 'error'); return; }
        downloadBlob(new Blob([dom.output.value], { type: 'text/plain;charset=utf-8' }), 'tooladda-base64-output.txt');
        showMessage('Downloaded as TXT.');
      });
    }
    dom.downloadFile.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state.outputBytes) { showMessage('Nothing decoded/encoded yet to download as a file.', 'error'); return; }
        downloadBlob(new Blob([state.outputBytes], { type: state.outputMime }), `tooladda-output.${state.outputExt}`);
        showMessage('File downloaded.');
      });
    });
    if (dom.downloadImage) {
      dom.downloadImage.addEventListener('click', () => {
        if (!state.outputBytes) { showMessage('No image to download yet.', 'error'); return; }
        downloadBlob(new Blob([state.outputBytes], { type: state.outputMime }), `tooladda-image.${state.outputExt}`);
        showMessage('Image downloaded.');
      });
    }
    if (dom.share) {
      dom.share.addEventListener('click', async () => {
        if (!dom.output.value) { showMessage('Nothing to share yet.', 'error'); return; }
        if (navigator.share) {
          try { await navigator.share({ text: dom.output.value.slice(0, 5000), title: 'Base64 output from ToolAdda' }); }
          catch (e) { /* user cancelled */ }
        } else {
          try { await navigator.clipboard.writeText(dom.output.value); showMessage('Sharing is not supported here — copied to clipboard instead.'); }
          catch (e) { showMessage('Sharing is not supported in this browser.', 'error'); }
        }
      });
    }
    if (dom.undo) dom.undo.addEventListener('click', applyUndo);
    if (dom.redo) dom.redo.addEventListener('click', applyRedo);

    const downloadBlob = (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    };

    /* ---------------- file / drag & drop ---------------- */

    const extFromName = (name) => (name.split('.').pop() || '').toLowerCase();

    const processFile = (file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        const b64 = bytesToBase64(bytes, state.urlSafe);
        resolve({ name: file.name, size: file.size, mime: file.type || sniffBinaryMime(bytes).mime, ext: extFromName(file.name) || sniffBinaryMime(bytes).ext, bytes, base64: b64 });
      };
      reader.readAsArrayBuffer(file);
    });

    const loadFileResultIntoOutput = (result) => {
      dom.output.value = result.base64;
      clearOutputNote();
      state.outputBytes = result.bytes;
      state.outputIsBinary = false;
      state.outputMime = result.mime;
      state.outputExt = result.ext;
      updateStats(result.bytes.length, 0);
      hidePreviews();
      if (result.mime.startsWith('image/')) showImagePreview(result.base64, result.mime);
      else showFilePreview(result.name, result.mime, result.size);
      setValidation('valid', `✓ ${result.name} encoded — ${formatBytes(result.size)} → ${formatBytes(result.base64.length)} of Base64 text (~33% larger, as expected).`);
    };

    const renderQueue = () => {
      if (!dom.fileQueue) return;
      dom.fileQueue.innerHTML = '';
      dom.fileQueue.hidden = state.queue.length === 0;
      if (dom.zipAllBtn) dom.zipAllBtn.hidden = state.queue.length < 2;
      state.queue.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'bx-queue-item';
        li.innerHTML = `<button type="button" class="bx-queue-open"><strong>${escapeHtml(item.name)}</strong><span>${formatBytes(item.size)} · ${escapeHtml(item.mime)}</span></button><button type="button" class="bx-queue-copy" title="Copy Base64">Copy</button>`;
        li.querySelector('.bx-queue-open').addEventListener('click', () => { loadFileResultIntoOutput(item); showMessage(`Loaded ${item.name}.`); });
        li.querySelector('.bx-queue-copy').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(item.base64); showMessage(`Copied Base64 for ${item.name}.`); }
          catch (e) { showMessage('Clipboard access failed.', 'error'); }
        });
        dom.fileQueue.appendChild(li);
      });
    };

    const handleFiles = async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      showMessage(`Processing ${files.length} file${files.length > 1 ? 's' : ''}…`);
      const results = await Promise.all(files.map(processFile));
      state.queue = results.concat(state.queue).slice(0, 30);
      renderQueue();
      loadFileResultIntoOutput(results[0]);
      showMessage(results.length > 1 ? `Encoded ${results.length} files.` : `Encoded ${results[0].name}.`);
    };

    if (dom.fileInput) {
      dom.fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    }
    if (dom.urlImport && dom.urlInput) {
      dom.urlImport.addEventListener('click', async () => {
        const url = dom.urlInput.value.trim();
        if (!url) { showMessage('Enter a URL to import first.', 'error'); return; }
        showMessage('Fetching…');
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const name = url.split('/').pop()?.split('?')[0] || 'imported-file';
          const file = new File([blob], name, { type: blob.type });
          await handleFiles([file]);
        } catch (e) {
          showMessage('Import failed — the URL may block cross-origin requests (CORS). Try downloading and dragging the file in instead.', 'error');
        }
      });
    }
    if (dom.dropzone) {
      ['dragenter', 'dragover'].forEach((evt) => dom.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dom.dropzone.classList.add('is-dragover');
      }));
      ['dragleave', 'drop'].forEach((evt) => dom.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dom.dropzone.classList.remove('is-dragover');
      }));
      dom.dropzone.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });
      dom.dropzone.addEventListener('click', () => dom.fileInput?.click());
      dom.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.fileInput?.click(); } });
    }

    document.addEventListener('paste', (e) => {
      if (!page.contains(document.activeElement) && document.activeElement !== document.body) return;
      const items = Array.from(e.clipboardData?.items || []);
      const fileItem = items.find((it) => it.kind === 'file');
      if (fileItem) {
        const file = fileItem.getAsFile();
        if (file) { handleFiles([file]); }
      }
    });

    if (dom.zipAllBtn) {
      dom.zipAllBtn.addEventListener('click', async () => {
        if (typeof JSZip === 'undefined') { showMessage('ZIP support failed to load.', 'error'); return; }
        const zip = new JSZip();
        state.queue.forEach((item) => zip.file(item.name, item.bytes));
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, 'tooladda-base64-batch.zip');
        showMessage('Downloaded all files as a ZIP.');
      });
    }

    /* ---------------- keyboard shortcuts ---------------- */

    document.addEventListener('keydown', (e) => {
      if (!page.contains(document.activeElement) && document.activeElement !== document.body) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const inInput = document.activeElement === dom.input;
      if (e.key === 'Enter') { e.preventDefault(); runByMode({ force: true }); }
      else if (e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); dom.copy?.click(); }
      else if (e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); dom.clear?.click(); }
      else if (e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); dom.swap?.click(); }
      // Ctrl+Z / Ctrl+Shift+Z only drive our history stack outside the input,
      // so the browser's native character-level undo still works while typing.
      else if (!inInput && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); applyRedo(); }
      else if (!inInput && e.key.toLowerCase() === 'z') { e.preventDefault(); applyUndo(); }
    });

    /* ---------------- sticky bar ---------------- */

    if (dom.stickyEncode) dom.stickyEncode.addEventListener('click', () => dom.runEncode?.click());
    if (dom.stickyDecode) dom.stickyDecode.addEventListener('click', () => dom.runDecode?.click());

    /* ---------------- init ---------------- */

    snapshotInput();
    updateStats(undefined, undefined);
    setValidation('neutral', 'Paste a Base64 string to validate it.');
    renderHistory();
    if (dom.input.value) handleInputChange({ skipSnapshot: true });
  };

  return { bind };
})();

document.addEventListener('DOMContentLoaded', () => Base64Studio.bind());
