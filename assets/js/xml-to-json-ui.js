/* ToolAdda — XML to JSON Converter UI wiring.
   Depends on window.XMLJSONEngine (assets/js/xml-to-json-pro.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-xtj-pro')) return;
  const Engine = window.XMLJSONEngine;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const AUTO_CONVERT_LIMIT = 200 * 1024; // live-convert while typing below this size
  const PROGRESS_THRESHOLD = 50 * 1024; // show a defer+progress step above this size
  const MAX_HISTORY = 20;
  const MAX_TREE_ITEMS = 200; // per array/object level, before "show more"

  const els = {
    xmlInput: $('xtjXmlInput'),
    dropZone: $('xtjDropZone'),
    fileInput: $('xtjFileInput'),
    autoEncoding: $('xtjAutoEncoding'),
    urlInput: $('xtjUrlInput'),
    urlImportBtn: $('xtjUrlImportBtn'),
    sampleBtn: $('xtjSampleBtn'),
    clearBtn: $('xtjClearAllBtn'),
    undoBtn: $('xtjUndoBtn'),
    redoBtn: $('xtjRedoBtn'),

    attrMode: $('xtjAttrMode'),
    nsMode: $('xtjNsMode'),
    arrayMode: $('xtjArrayMode'),
    preserveOrder: $('xtjPreserveOrder'),
    removeEmpty: $('xtjRemoveEmpty'),
    unwrapRoot: $('xtjUnwrapRoot'),
    coerceTypes: $('xtjCoerceTypes'),
    indentSize: $('xtjIndentSize'),
    minify: $('xtjMinify'),

    convertBtn: $('xtjConvertBtn'),
    stickyConvertBtn: $('xtjStickyConvertBtn'),
    outputCol: $('xtjOutputCol'),
    progressBar: $('xtjProgressBar'),

    validationStatus: $('xtjValidationStatus'),
    validationMessage: $('xtjValidationMessage'),
    statChars: $('xtjStatChars'),
    statElements: $('xtjStatElements'),
    statAttributes: $('xtjStatAttributes'),
    statDepth: $('xtjStatDepth'),
    statOutSize: $('xtjStatOutSize'),
    statRatio: $('xtjStatRatio'),
    statTime: $('xtjStatTime'),

    tabTree: $('xtjTabTree'),
    tabRaw: $('xtjTabRaw'),
    treePanel: $('xtjTreePanel'),
    rawPanel: $('xtjRawPanel'),
    treeRoot: $('xtjTreeRoot'),
    rawOutput: $('xtjRawOutput'),

    copyBtn: $('xtjCopyBtn'),
    downloadPrettyBtn: $('xtjDownloadPrettyBtn'),
    downloadMinBtn: $('xtjDownloadMinBtn'),
    downloadSchemaBtn: $('xtjDownloadSchemaBtn'),
    convertAgainBtn: $('xtjConvertAgainBtn'),

    historyList: $('xtjHistoryList'),
    historyClearBtn: $('xtjHistoryClearBtn'),

    batchInput: $('xtjBatchFileInput'),
    batchResults: $('xtjBatchResults'),
    batchZipBtn: $('xtjBatchZipBtn'),

    srStatus: $('xtjSrStatus'),
  };

  const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<library name="City Library">
  <book id="1" available="true">
    <title>Dune</title>
    <author>Frank Herbert</author>
    <year>1965</year>
    <tags><tag>sci-fi</tag><tag>classic</tag></tags>
  </book>
  <book id="2" available="false">
    <title>Neuromancer</title>
    <author>William Gibson</author>
    <year>1984</year>
  </book>
</library>`;

  let lastResult = null; // { data, jsonText, stats, timing }
  let batchZipFiles = []; // [{ name, jsonText }]

  const history = { stack: [], index: -1 };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function announce(msg) {
    if (els.srStatus) els.srStatus.textContent = msg;
  }

  function getOptions() {
    return {
      attrMode: els.attrMode ? els.attrMode.value : 'prefix',
      nsMode: els.nsMode ? els.nsMode.value : 'keep',
      arrayMode: els.arrayMode ? els.arrayMode.value : 'smart',
      preserveOrder: !!(els.preserveOrder && els.preserveOrder.checked),
      removeEmpty: !!(els.removeEmpty && els.removeEmpty.checked),
      unwrapRoot: !!(els.unwrapRoot && els.unwrapRoot.checked),
      coerceTypes: !!(els.coerceTypes && els.coerceTypes.checked),
      indent: els.indentSize ? els.indentSize.value : 2,
      minify: !!(els.minify && els.minify.checked),
    };
  }

  // ---------- validation panel ----------

  function setValidation(status, message, extra) {
    if (els.validationStatus) {
      els.validationStatus.textContent = status;
      els.validationStatus.className = 'xtj-badge xtj-badge-' + (status === 'Valid' ? 'ok' : status === 'Empty' ? 'idle' : 'error');
    }
    if (els.validationMessage) {
      let text = message || '';
      if (extra && extra.line) text += ` (line ${extra.line}${extra.column ? ', column ' + extra.column : ''})`;
      els.validationMessage.textContent = text;
    }
  }

  function updateCharCount() {
    const val = els.xmlInput ? els.xmlInput.value : '';
    if (els.statChars) els.statChars.textContent = String(val.length);
  }

  function resetStats() {
    ['statElements', 'statAttributes', 'statDepth', 'statOutSize', 'statRatio', 'statTime'].forEach((k) => {
      if (els[k]) els[k].textContent = '—';
    });
  }

  // ---------- syntax-highlighted raw view ----------

  function highlightJson(jsonText) {
    // Only escape &, < and > here — the tokenizer regex below matches literal
    // quote characters, so escaping " to &quot; first (as escapeHtml() does for
    // attribute contexts) would hide every string/key from the regex entirely.
    // Quotes are safe to leave as-is inside HTML text content.
    const escaped = String(jsonText).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'tok-number';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'tok-key' : 'tok-string';
        else if (/true|false/.test(match)) cls = 'tok-boolean';
        else if (/null/.test(match)) cls = 'tok-null';
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  function renderRaw(jsonText) {
    if (!els.rawOutput) return;
    els.rawOutput.innerHTML = jsonText ? highlightJson(jsonText) : '';
  }

  // ---------- tree view ----------

  function typeLabel(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  // Only ever called with primitive leaf values — buildTreeNode() branches
  // into <details>/<summary> for objects/arrays before reaching this.
  function primitiveSpan(value) {
    const t = typeLabel(value);
    const text = t === 'string' ? `"${escapeHtml(value)}"` : escapeHtml(String(value));
    return `<span class="xtj-node-value tok-${t}">${text}</span>`;
  }

  function buildTreeNode(key, value) {
    const li = document.createElement('li');
    li.className = 'xtj-tree-node';
    const t = typeLabel(value);

    if (t === 'object' || t === 'array') {
      const entries = t === 'array' ? value.map((v, i) => [String(i), v]) : Object.entries(value);
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      const count = entries.length;
      summary.innerHTML = `${key !== null ? `<span class="xtj-node-key">${escapeHtml(key)}</span>: ` : ''}<span class="xtj-node-meta">${t === 'array' ? `[ ${count} item${count === 1 ? '' : 's'} ]` : `{ ${count} key${count === 1 ? '' : 's'} }`}</span>`;
      details.appendChild(summary);

      const ul = document.createElement('ul');
      ul.className = 'xtj-tree-children';
      const visible = entries.slice(0, MAX_TREE_ITEMS);
      visible.forEach(([k, v]) => ul.appendChild(buildTreeNode(k, v)));
      if (entries.length > MAX_TREE_ITEMS) {
        const more = document.createElement('li');
        more.className = 'xtj-tree-more';
        const remaining = entries.length - MAX_TREE_ITEMS;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'xtj-tree-more-btn';
        btn.textContent = `Show ${remaining} more…`;
        btn.addEventListener('click', () => {
          entries.slice(MAX_TREE_ITEMS).forEach(([k, v]) => ul.insertBefore(buildTreeNode(k, v), more));
          more.remove();
        });
        more.appendChild(btn);
        ul.appendChild(more);
      }
      details.appendChild(ul);
      li.appendChild(details);
    } else {
      li.innerHTML = `${key !== null ? `<span class="xtj-node-key">${escapeHtml(key)}</span>: ` : ''}${primitiveSpan(value)}`;
    }
    return li;
  }

  function renderTree(data) {
    if (!els.treeRoot) return;
    els.treeRoot.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'xtj-tree-root-list';
    ul.appendChild(buildTreeNode(null, data));
    els.treeRoot.appendChild(ul);
  }

  function setActiveTab(tab) {
    const isTree = tab === 'tree';
    if (els.tabTree) { els.tabTree.classList.toggle('is-active', isTree); els.tabTree.setAttribute('aria-selected', String(isTree)); }
    if (els.tabRaw) { els.tabRaw.classList.toggle('is-active', !isTree); els.tabRaw.setAttribute('aria-selected', String(!isTree)); }
    if (els.treePanel) els.treePanel.hidden = !isTree;
    if (els.rawPanel) els.rawPanel.hidden = isTree;
  }

  // ---------- history (also powers undo/redo) ----------

  function pushHistory(entry) {
    if (history.index < history.stack.length - 1) history.stack.length = history.index + 1;
    history.stack.push(entry);
    if (history.stack.length > MAX_HISTORY) history.stack.shift();
    history.index = history.stack.length - 1;
    renderHistoryList();
    updateUndoRedoState();
  }

  function updateUndoRedoState() {
    if (els.undoBtn) els.undoBtn.disabled = history.index <= 0;
    if (els.redoBtn) els.redoBtn.disabled = history.index >= history.stack.length - 1;
  }

  function renderHistoryList() {
    if (!els.historyList) return;
    if (!history.stack.length) {
      els.historyList.innerHTML = '<li class="xtj-history-empty">No conversions yet.</li>';
      return;
    }
    els.historyList.innerHTML = '';
    history.stack.forEach((entry, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xtj-history-item' + (i === history.index ? ' is-active' : '');
      const time = new Date(entry.timestamp).toLocaleTimeString();
      btn.innerHTML = `<span>${escapeHtml(entry.label)}</span><span class="xtj-history-meta">${time} · ${entry.stats.elements} el</span>`;
      btn.addEventListener('click', () => restoreHistory(i));
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  function restoreHistory(index) {
    const entry = history.stack[index];
    if (!entry) return;
    history.index = index;
    if (els.xmlInput) els.xmlInput.value = entry.xml;
    lastResult = { data: entry.data, jsonText: entry.jsonText, stats: entry.stats };
    applyResult(lastResult, entry.timing || 0, false);
    renderHistoryList();
    updateUndoRedoState();
    updateCharCount();
  }

  function undo() { if (history.index > 0) restoreHistory(history.index - 1); }
  function redo() { if (history.index < history.stack.length - 1) restoreHistory(history.index + 1); }

  // ---------- core convert flow ----------

  function applyResult(result, timeMs, addToHistory) {
    const { stats, jsonText, data } = result;
    setValidation('Valid', 'Well-formed XML — converted successfully.');
    if (els.statElements) els.statElements.textContent = String(stats.elements);
    if (els.statAttributes) els.statAttributes.textContent = String(stats.attributes);
    if (els.statDepth) els.statDepth.textContent = String(stats.depth);
    if (els.statOutSize) els.statOutSize.textContent = Engine.formatBytes(new Blob([jsonText]).size);
    if (els.statRatio) els.statRatio.textContent = stats.inputChars > 0 ? (stats.outputChars / stats.inputChars).toFixed(2) + '×' : '—';
    if (els.statTime) els.statTime.textContent = timeMs.toFixed(1) + ' ms';

    renderRaw(jsonText);
    renderTree(data);

    if (addToHistory) {
      pushHistory({
        xml: els.xmlInput ? els.xmlInput.value : '',
        data,
        jsonText,
        stats,
        label: `<${stats.rootName}>`,
        timestamp: Date.now(),
        timing: timeMs,
      });
    }
  }

  function runConversion(addToHistory) {
    const xml = els.xmlInput ? els.xmlInput.value : '';
    updateCharCount();

    if (!xml.trim()) {
      setValidation('Empty', 'Paste, upload, or import XML to begin.');
      renderRaw('');
      if (els.treeRoot) els.treeRoot.innerHTML = '';
      resetStats();
      lastResult = null;
      return;
    }

    const start = performance.now();
    try {
      const result = Engine.convert(xml, getOptions(), window.DOMParser);
      const timeMs = performance.now() - start;
      lastResult = result;
      applyResult(result, timeMs, addToHistory !== false);
    } catch (err) {
      setValidation('Invalid', (err && err.message) || 'This XML is not well-formed.', err);
      renderRaw('');
      if (els.treeRoot) els.treeRoot.innerHTML = '';
      resetStats();
      lastResult = null;
    }
  }

  function runConversionWithProgress(addToHistory) {
    const xml = els.xmlInput ? els.xmlInput.value : '';
    if (xml.length < PROGRESS_THRESHOLD) {
      runConversion(addToHistory);
      return;
    }
    if (els.progressBar) els.progressBar.hidden = false;
    if (els.convertBtn) els.convertBtn.disabled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          runConversion(addToHistory);
          if (els.progressBar) els.progressBar.hidden = true;
          if (els.convertBtn) els.convertBtn.disabled = false;
        }, 0);
      });
    });
  }

  // ---------- file / drag&drop / URL import ----------

  async function readFileWithEncoding(file, autoDetect) {
    if (!autoDetect) return file.text();
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const { encoding, bomLength } = Engine.sniffEncoding(bytes);
    try {
      const decoder = new TextDecoder(encoding);
      return decoder.decode(bytes.slice(bomLength));
    } catch (e) {
      return new TextDecoder('utf-8').decode(bytes.slice(bomLength));
    }
  }

  async function handleFile(file) {
    if (!file) return;
    try {
      const text = await readFileWithEncoding(file, !els.autoEncoding || els.autoEncoding.checked);
      if (els.xmlInput) els.xmlInput.value = text;
      announce(`Loaded ${file.name}`);
      runConversionWithProgress(true);
    } catch (e) {
      setValidation('Invalid', 'Could not read that file.');
    }
  }

  async function importFromUrl() {
    const url = els.urlInput ? els.urlInput.value.trim() : '';
    if (!url) return;
    setValidation('Empty', 'Fetching XML…');
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const text = await res.text();
      if (els.xmlInput) els.xmlInput.value = text;
      announce('Imported XML from URL');
      runConversionWithProgress(true);
    } catch (e) {
      setValidation('Invalid', 'Could not fetch this URL — it may not be public, may not allow cross-origin (CORS) requests, or the network request failed.');
    }
  }

  // ---------- batch conversion ----------

  async function handleBatchFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    batchZipFiles = [];
    if (els.batchResults) els.batchResults.innerHTML = '';
    const opts = getOptions();

    for (const file of files) {
      const row = document.createElement('li');
      row.className = 'xtj-batch-row';
      try {
        const text = await readFileWithEncoding(file, true);
        const result = Engine.convert(text, opts, window.DOMParser);
        batchZipFiles.push({ name: file.name.replace(/\.xml$/i, '') + '.json', jsonText: result.jsonText });
        row.innerHTML = `<span class="xtj-batch-ok">✅ ${escapeHtml(file.name)}</span><span>${result.stats.elements} elements</span>`;
      } catch (e) {
        row.innerHTML = `<span class="xtj-batch-fail">❌ ${escapeHtml(file.name)}</span><span>${escapeHtml((e && e.message) || 'Invalid XML')}</span>`;
      }
      if (els.batchResults) els.batchResults.appendChild(row);
    }
    if (els.batchZipBtn) els.batchZipBtn.disabled = batchZipFiles.length === 0;
  }

  function loadJSZip() {
    return new Promise((resolve, reject) => {
      if (window.JSZip) { resolve(window.JSZip); return; }
      const s = document.createElement('script');
      s.src = 'assets/js/jszip.min.js';
      s.onload = () => resolve(window.JSZip);
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  async function downloadBatchZip() {
    if (!batchZipFiles.length) return;
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      batchZipFiles.forEach((f) => zip.file(f.name, f.jsonText));
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(blob, 'xml-to-json-batch.zip');
    } catch (e) {
      announce('Could not build the ZIP file.');
    }
  }

  // ---------- copy / download ----------

  function triggerDownload(blobOrText, filename, mime) {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyJson() {
    if (!lastResult) { announce('Nothing to copy yet — convert XML first.'); return; }
    try {
      await navigator.clipboard.writeText(lastResult.jsonText);
      announce('JSON copied to clipboard.');
    } catch (e) {
      announce('Copy failed — your browser may block clipboard access.');
    }
  }

  function downloadPretty() {
    if (!lastResult) { announce('Nothing to download yet — convert XML first.'); return; }
    const text = JSON.stringify(lastResult.data, null, getOptions().indent === 'tab' ? '\t' : Number(getOptions().indent) || 2);
    triggerDownload(text, 'converted.json');
  }

  function downloadMinified() {
    if (!lastResult) { announce('Nothing to download yet — convert XML first.'); return; }
    triggerDownload(JSON.stringify(lastResult.data), 'converted.min.json');
  }

  function downloadSchema() {
    if (!lastResult) { announce('Nothing to download yet — convert XML first.'); return; }
    const schema = Engine.generateSchema(lastResult.data, 'Generated from XML');
    triggerDownload(JSON.stringify(schema, null, 2), 'schema.json');
  }

  function clearAll() {
    if (els.xmlInput) els.xmlInput.value = '';
    if (els.fileInput) els.fileInput.value = '';
    if (els.urlInput) els.urlInput.value = '';
    setValidation('Empty', 'Paste, upload, or import XML to begin.');
    renderRaw('');
    if (els.treeRoot) els.treeRoot.innerHTML = '';
    resetStats();
    updateCharCount();
    lastResult = null;
    announce('Cleared.');
  }

  // ---------- wiring ----------

  function init() {
    let debounceTimer;
    if (els.xmlInput) {
      els.xmlInput.addEventListener('input', () => {
        updateCharCount();
        clearTimeout(debounceTimer);
        const len = els.xmlInput.value.length;
        if (len === 0) { runConversion(false); return; }
        if (len > AUTO_CONVERT_LIMIT) return; // large input: wait for explicit Convert click
        debounceTimer = setTimeout(() => runConversion(true), 450);
      });
    }

    function handleConvertClick() {
      if (!els.xmlInput || !els.xmlInput.value.trim()) {
        els.xmlInput?.focus();
        els.xmlInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      runConversionWithProgress(true);
      // On narrow screens the editors stack vertically, so the JSON output
      // panel sits below the fold — bring it into view after converting.
      // Desktop shows both columns side by side already, so leave it alone there.
      if (window.matchMedia('(max-width: 980px)').matches) {
        els.outputCol?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    els.convertBtn?.addEventListener('click', handleConvertClick);
    els.stickyConvertBtn?.addEventListener('click', handleConvertClick);
    els.convertAgainBtn?.addEventListener('click', () => {
      els.xmlInput?.focus();
      els.xmlInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    els.clearBtn?.addEventListener('click', clearAll);
    els.undoBtn?.addEventListener('click', undo);
    els.redoBtn?.addEventListener('click', redo);

    [els.attrMode, els.nsMode, els.arrayMode, els.preserveOrder, els.removeEmpty, els.unwrapRoot, els.coerceTypes, els.indentSize, els.minify].forEach((ctrl) => {
      ctrl?.addEventListener('change', () => {
        if (els.xmlInput && els.xmlInput.value.trim()) runConversionWithProgress(true);
      });
    });

    els.fileInput?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      handleFile(file);
    });

    els.sampleBtn?.addEventListener('click', () => {
      if (els.xmlInput) els.xmlInput.value = SAMPLE_XML;
      runConversionWithProgress(true);
    });

    els.urlImportBtn?.addEventListener('click', importFromUrl);

    if (els.dropZone) {
      ['dragenter', 'dragover'].forEach((evt) => {
        els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.add('is-dragover'); });
      });
      ['dragleave', 'drop'].forEach((evt) => {
        els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.remove('is-dragover'); });
      });
      els.dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) handleFile(files[0]);
      });
    }

    els.tabTree?.addEventListener('click', () => setActiveTab('tree'));
    els.tabRaw?.addEventListener('click', () => setActiveTab('raw'));

    els.copyBtn?.addEventListener('click', copyJson);
    els.downloadPrettyBtn?.addEventListener('click', downloadPretty);
    els.downloadMinBtn?.addEventListener('click', downloadMinified);
    els.downloadSchemaBtn?.addEventListener('click', downloadSchema);

    els.historyClearBtn?.addEventListener('click', () => {
      history.stack = [];
      history.index = -1;
      renderHistoryList();
      updateUndoRedoState();
    });

    els.batchInput?.addEventListener('change', (e) => handleBatchFiles(e.target.files));
    els.batchZipBtn?.addEventListener('click', downloadBatchZip);

    updateUndoRedoState();
    renderHistoryList();
    setValidation('Empty', 'Paste, upload, or import XML to begin.');
    resetStats();
    updateCharCount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
