/* ToolAdda — CSV to JSON Converter UI wiring.
   Depends on window.CSVJSONEngine (assets/js/csv-to-json.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-ctj-pro')) return;
  const Engine = window.CSVJSONEngine;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const PROGRESS_THRESHOLD = 50 * 1024;
  const AUTO_CONVERT_LIMIT = 200 * 1024;
  const MAX_HISTORY = 20;
  const MAX_TREE_ITEMS = 200;
  const MAX_PREVIEW_ROWS = 50;
  const MAX_WARNINGS_SHOWN = 30;

  const els = {
    csvInput: $('ctjCsvInput'),
    dropZone: $('ctjDropZone'),
    fileInput: $('ctjFileInput'),
    autoEncoding: $('ctjAutoEncoding'),
    urlInput: $('ctjUrlInput'),
    urlImportBtn: $('ctjUrlImportBtn'),
    sampleBtn: $('ctjSampleBtn'),
    clearBtn: $('ctjClearAllBtn'),
    undoBtn: $('ctjUndoBtn'),
    redoBtn: $('ctjRedoBtn'),

    delimiterMode: $('ctjDelimiterMode'),
    customDelimiterWrap: $('ctjCustomDelimiterWrap'),
    customDelimiter: $('ctjCustomDelimiter'),
    quoteChar: $('ctjQuoteChar'),
    headerRow: $('ctjHeaderRowToggle'),
    skipEmptyRows: $('ctjSkipEmptyRows'),
    trimValues: $('ctjTrimValues'),
    coerceTypes: $('ctjCoerceTypes'),
    nestedMapping: $('ctjNestedMapping'),
    sortKeys: $('ctjSortKeys'),
    outputShape: $('ctjOutputShape'),
    rootKeyWrap: $('ctjRootKeyWrap'),
    rootKey: $('ctjRootKey'),
    indentSize: $('ctjIndentSize'),
    minify: $('ctjMinify'),

    convertBtn: $('ctjConvertBtn'),
    stickyConvertBtn: $('ctjStickyConvertBtn'),
    outputCol: $('ctjOutputCol'),
    progressBar: $('ctjProgressBar'),

    validationStatus: $('ctjValidationStatus'),
    validationMessage: $('ctjValidationMessage'),
    warningsBox: $('ctjWarningsBox'),
    warningsList: $('ctjWarningsList'),

    statChars: $('ctjStatChars'),
    statRows: $('ctjStatRows'),
    statCols: $('ctjStatCols'),
    statFileSize: $('ctjStatFileSize'),
    statOutSize: $('ctjStatOutSize'),
    statDuplicates: $('ctjStatDuplicates'),
    statTime: $('ctjStatTime'),
    delimiterHint: $('ctjDelimiterHint'),

    columnsPanel: $('ctjColumnsPanel'),
    columnsList: $('ctjColumnsList'),

    previewWrap: $('ctjPreviewWrap'),
    previewTable: $('ctjPreviewTable'),
    previewMore: $('ctjPreviewMore'),

    tabTree: $('ctjTabTree'),
    tabRaw: $('ctjTabRaw'),
    treePanel: $('ctjTreePanel'),
    rawPanel: $('ctjRawPanel'),
    treeRoot: $('ctjTreeRoot'),
    rawOutput: $('ctjRawOutput'),

    copyBtn: $('ctjCopyBtn'),
    copyApiBtn: $('ctjCopyApiBtn'),
    downloadPrettyBtn: $('ctjDownloadPrettyBtn'),
    downloadMinBtn: $('ctjDownloadMinBtn'),
    downloadSchemaBtn: $('ctjDownloadSchemaBtn'),
    convertAgainBtn: $('ctjConvertAgainBtn'),

    historyList: $('ctjHistoryList'),
    historyClearBtn: $('ctjHistoryClearBtn'),

    batchInput: $('ctjBatchFileInput'),
    batchResults: $('ctjBatchResults'),
    batchZipBtn: $('ctjBatchZipBtn'),

    srStatus: $('ctjSrStatus'),
  };

  const SAMPLE_CSV = `name,age,city,active,notes\n` +
    `Alice Johnson,30,New York,true,"Loves coffee, hiking"\n` +
    `Bob Smith,25,Los Angeles,false,\n` +
    `Carol Diaz,,Chicago,true,"Speaks English, Spanish"\n` +
    `David Lee,41,Austin,true,VIP customer`;

  let lastResult = null; // full Engine.parse() result
  let lastFileSizeBytes = 0;
  let columnState = {}; // { originalHeader: { ignore: bool, rename: string } }
  const history = { stack: [], index: -1 };
  let batchZipFiles = [];

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function announce(msg) { if (els.srStatus) els.srStatus.textContent = msg; }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- options from UI ----------

  function getRenameAndIgnore() {
    const renameMap = {};
    const ignoreSet = new Set();
    Object.keys(columnState).forEach((orig) => {
      const st = columnState[orig];
      if (st.ignore) ignoreSet.add(orig);
      if (st.rename && st.rename.trim() && st.rename.trim() !== orig) renameMap[orig] = st.rename.trim();
    });
    return { renameMap, ignoreSet };
  }

  function getOptions() {
    const { renameMap, ignoreSet } = getRenameAndIgnore();
    return {
      delimiter: els.delimiterMode ? els.delimiterMode.value : 'auto',
      customDelimiter: els.customDelimiter ? (els.customDelimiter.value || ',') : ',',
      quoteChar: els.quoteChar ? els.quoteChar.value : '"',
      hasHeaderRow: !els.headerRow || els.headerRow.checked,
      skipEmptyRows: !!(els.skipEmptyRows && els.skipEmptyRows.checked),
      trimValues: !!(els.trimValues && els.trimValues.checked),
      coerceTypes: !!(els.coerceTypes && els.coerceTypes.checked),
      nestedMapping: !!(els.nestedMapping && els.nestedMapping.checked),
      sortKeys: !!(els.sortKeys && els.sortKeys.checked),
      outputShape: els.outputShape ? els.outputShape.value : 'array',
      rootKey: els.rootKey ? els.rootKey.value : 'data',
      indent: els.indentSize ? els.indentSize.value : 2,
      minify: !!(els.minify && els.minify.checked),
      renameMap,
      ignoreSet,
    };
  }

  function toggleConditionalFields() {
    if (els.customDelimiterWrap) els.customDelimiterWrap.hidden = !(els.delimiterMode && els.delimiterMode.value === 'custom');
    if (els.rootKeyWrap) els.rootKeyWrap.hidden = !(els.outputShape && els.outputShape.value === 'root');
  }

  // ---------- validation panel ----------

  function setValidation(status, message) {
    if (els.validationStatus) {
      els.validationStatus.textContent = status;
      els.validationStatus.className = 'ctj-badge-status ctj-badge-' + (status === 'Valid' ? 'ok' : status === 'Empty' ? 'idle' : 'error');
    }
    if (els.validationMessage) els.validationMessage.textContent = message || '';
  }

  function renderWarnings(warnings, duplicates) {
    if (!els.warningsBox || !els.warningsList) return;
    const items = [];
    (warnings || []).slice(0, MAX_WARNINGS_SHOWN).forEach((w) => items.push(`Line ${w.line}: ${escapeHtml(w.message)}`));
    if (duplicates && duplicates.length) {
      items.push(`${duplicates.length} duplicate row${duplicates.length === 1 ? '' : 's'} detected (identical to an earlier row).`);
    }
    if (!items.length) { els.warningsBox.hidden = true; els.warningsList.innerHTML = ''; return; }
    els.warningsBox.hidden = false;
    els.warningsList.innerHTML = items.map((i) => `<li>${i}</li>`).join('');
  }

  function updateCharCount() {
    const val = els.csvInput ? els.csvInput.value : '';
    if (els.statChars) els.statChars.textContent = String(val.length);
  }

  function resetStats() {
    ['statRows', 'statCols', 'statOutSize', 'statDuplicates', 'statTime'].forEach((k) => { if (els[k]) els[k].textContent = '—'; });
    if (els.delimiterHint) els.delimiterHint.textContent = 'Delimiter: —';
  }

  // ---------- syntax-highlighted raw view ----------

  function highlightJson(jsonText) {
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

  function renderRaw(jsonText) { if (els.rawOutput) els.rawOutput.innerHTML = jsonText ? highlightJson(jsonText) : ''; }

  // ---------- tree view ----------

  function typeLabel(value) { if (value === null) return 'null'; if (Array.isArray(value)) return 'array'; return typeof value; }

  function primitiveSpan(value) {
    const t = typeLabel(value);
    const text = t === 'string' ? `"${escapeHtml(value)}"` : escapeHtml(String(value));
    return `<span class="ctj-node-value tok-${t}">${text}</span>`;
  }

  function buildTreeNode(key, value) {
    const li = document.createElement('li');
    li.className = 'ctj-tree-node';
    const t = typeLabel(value);

    if (t === 'object' || t === 'array') {
      const entries = t === 'array' ? value.map((v, i) => [String(i), v]) : Object.entries(value);
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      const count = entries.length;
      summary.innerHTML = `${key !== null ? `<span class="ctj-node-key">${escapeHtml(key)}</span>: ` : ''}<span class="ctj-node-meta">${t === 'array' ? `[ ${count} item${count === 1 ? '' : 's'} ]` : `{ ${count} key${count === 1 ? '' : 's'} }`}</span>`;
      details.appendChild(summary);
      const ul = document.createElement('ul');
      ul.className = 'ctj-tree-children';
      const visible = entries.slice(0, MAX_TREE_ITEMS);
      visible.forEach(([k, v]) => ul.appendChild(buildTreeNode(k, v)));
      if (entries.length > MAX_TREE_ITEMS) {
        const more = document.createElement('li');
        more.className = 'ctj-tree-more';
        const remaining = entries.length - MAX_TREE_ITEMS;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'ctj-tree-more-btn'; btn.textContent = `Show ${remaining} more…`;
        btn.addEventListener('click', () => { entries.slice(MAX_TREE_ITEMS).forEach(([k, v]) => ul.insertBefore(buildTreeNode(k, v), more)); more.remove(); });
        more.appendChild(btn); ul.appendChild(more);
      }
      details.appendChild(ul);
      li.appendChild(details);
    } else {
      li.innerHTML = `${key !== null ? `<span class="ctj-node-key">${escapeHtml(key)}</span>: ` : ''}${primitiveSpan(value)}`;
    }
    return li;
  }

  function renderTree(data) {
    if (!els.treeRoot) return;
    els.treeRoot.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'ctj-tree-root-list';
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

  // ---------- spreadsheet preview ----------

  function renderPreview(result) {
    if (!els.previewTable) return;
    if (!result || !result.rawHeaders || !result.rawHeaders.length) {
      els.previewTable.innerHTML = '';
      if (els.previewMore) els.previewMore.textContent = '';
      return;
    }
    const headers = result.rawHeaders;
    const rows = result.objects.slice(0, MAX_PREVIEW_ROWS);
    let html = '<thead><tr>' + headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
    rows.forEach((obj) => {
      html += '<tr>' + headers.map((h) => {
        const key = (columnState[h] && columnState[h].rename) || h;
        const val = obj[key];
        const display = val === undefined ? '' : (val === null ? 'null' : String(val));
        return `<td>${escapeHtml(display)}</td>`;
      }).join('') + '</tr>';
    });
    html += '</tbody>';
    els.previewTable.innerHTML = html;
    const remaining = result.objects.length - rows.length;
    if (els.previewMore) els.previewMore.textContent = remaining > 0 ? `Showing first ${rows.length} of ${result.objects.length} rows.` : `Showing all ${result.objects.length} row${result.objects.length === 1 ? '' : 's'}.`;
  }

  // ---------- column mapping panel ----------

  function renderColumnsPanel(rawHeaders) {
    if (!els.columnsList || !els.columnsPanel) return;
    if (!rawHeaders || !rawHeaders.length) { els.columnsPanel.hidden = true; els.columnsList.innerHTML = ''; return; }

    // Preserve existing state for headers that still exist; drop stale ones.
    const next = {};
    rawHeaders.forEach((h) => { next[h] = columnState[h] || { ignore: false, rename: '' }; });
    columnState = next;

    els.columnsPanel.hidden = false;
    els.columnsList.innerHTML = rawHeaders.map((h, i) => `
      <div class="ctj-column-row" data-header="${escapeHtml(h)}">
        <label class="ctj-toggle"><input type="checkbox" data-col-ignore data-header-ref="${i}" ${columnState[h].ignore ? 'checked' : ''} /> Ignore</label>
        <span class="ctj-column-orig">${escapeHtml(h)}</span>
        <span aria-hidden="true">→</span>
        <input type="text" data-col-rename data-header-ref="${i}" placeholder="${escapeHtml(h)}" value="${escapeHtml(columnState[h].rename)}" aria-label="Rename column ${escapeHtml(h)}" />
      </div>`).join('');

    els.columnsList.querySelectorAll('[data-col-ignore]').forEach((input, i) => {
      input.addEventListener('change', () => { columnState[rawHeaders[i]].ignore = input.checked; runConversionWithProgress(true); });
    });
    els.columnsList.querySelectorAll('[data-col-rename]').forEach((input, i) => {
      input.addEventListener('input', debounce(() => { columnState[rawHeaders[i]].rename = input.value; runConversionWithProgress(true); }, 400));
    });
  }

  // ---------- history (undo/redo) ----------

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
    if (!history.stack.length) { els.historyList.innerHTML = '<li class="ctj-history-empty">No conversions yet.</li>'; return; }
    els.historyList.innerHTML = '';
    history.stack.forEach((entry, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctj-history-item' + (i === history.index ? ' is-active' : '');
      const time = new Date(entry.timestamp).toLocaleTimeString();
      btn.innerHTML = `<span>${entry.result.stats.rows} row${entry.result.stats.rows === 1 ? '' : 's'} × ${entry.result.stats.columns} col${entry.result.stats.columns === 1 ? '' : 's'}</span><span class="ctj-history-meta">${time}</span>`;
      btn.addEventListener('click', () => restoreHistory(i));
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  function restoreHistory(index) {
    const entry = history.stack[index];
    if (!entry) return;
    history.index = index;
    if (els.csvInput) els.csvInput.value = entry.csv;
    lastResult = entry.result;
    applyResult(entry.result, entry.timing || 0, false);
    renderHistoryList();
    updateUndoRedoState();
    updateCharCount();
  }

  function undo() { if (history.index > 0) restoreHistory(history.index - 1); }
  function redo() { if (history.index < history.stack.length - 1) restoreHistory(history.index + 1); }

  // ---------- core convert flow ----------

  function applyResult(result, timeMs, addToHistory) {
    setValidation('Valid', `Converted successfully using "${result.delimiter === '\t' ? 'Tab' : result.delimiter}" as the delimiter.`);
    renderWarnings(result.warnings, result.duplicates);

    if (els.statRows) els.statRows.textContent = String(result.stats.rows);
    if (els.statCols) els.statCols.textContent = String(result.stats.columns);
    if (els.statOutSize) els.statOutSize.textContent = Engine.formatBytes(new Blob([result.jsonText]).size);
    if (els.statDuplicates) els.statDuplicates.textContent = String(result.duplicates.length);
    if (els.statTime) els.statTime.textContent = timeMs.toFixed(1) + ' ms';
    if (els.delimiterHint) els.delimiterHint.textContent = `Delimiter: ${result.delimiter === '\t' ? 'Tab' : result.delimiter}`;

    renderRaw(result.jsonText);
    renderTree(result.data);
    renderColumnsPanel(result.rawHeaders);
    renderPreview(result);

    if (addToHistory) {
      pushHistory({
        csv: els.csvInput ? els.csvInput.value : '',
        result,
        timestamp: Date.now(),
        timing: timeMs,
      });
    }
  }

  function runConversion(addToHistory) {
    const csv = els.csvInput ? els.csvInput.value : '';
    updateCharCount();

    if (!csv.trim()) {
      setValidation('Empty', 'Paste, upload, or import CSV to begin.');
      renderRaw(''); if (els.treeRoot) els.treeRoot.innerHTML = '';
      renderWarnings([], []); resetStats();
      if (els.columnsPanel) els.columnsPanel.hidden = true;
      if (els.previewTable) els.previewTable.innerHTML = '';
      lastResult = null;
      return;
    }

    const start = performance.now();
    try {
      const result = Engine.parse(csv, getOptions());
      const timeMs = performance.now() - start;
      lastResult = result;
      applyResult(result, timeMs, addToHistory !== false);
    } catch (err) {
      setValidation('Invalid', (err && err.message) || 'This CSV could not be parsed.');
      renderRaw(''); if (els.treeRoot) els.treeRoot.innerHTML = '';
      renderWarnings([], []); resetStats();
      lastResult = null;
    }
  }

  function runConversionWithProgress(addToHistory) {
    const csv = els.csvInput ? els.csvInput.value : '';
    if (csv.length < PROGRESS_THRESHOLD) { runConversion(addToHistory); return; }
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
    try { return new TextDecoder(encoding).decode(bytes.slice(bomLength)); }
    catch (e) { return new TextDecoder('utf-8').decode(bytes.slice(bomLength)); }
  }

  async function handleFile(file) {
    if (!file) return;
    try {
      const text = await readFileWithEncoding(file, !els.autoEncoding || els.autoEncoding.checked);
      if (els.csvInput) els.csvInput.value = text;
      lastFileSizeBytes = file.size || 0;
      if (els.statFileSize) els.statFileSize.textContent = Engine.formatBytes(lastFileSizeBytes);
      announce(`Loaded ${file.name}`);
      runConversionWithProgress(true);
    } catch (e) {
      setValidation('Invalid', 'Could not read that file.');
    }
  }

  async function importFromUrl() {
    const url = els.urlInput ? els.urlInput.value.trim() : '';
    if (!url) return;
    setValidation('Empty', 'Fetching CSV…');
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const text = await res.text();
      if (els.csvInput) els.csvInput.value = text;
      lastFileSizeBytes = new Blob([text]).size;
      if (els.statFileSize) els.statFileSize.textContent = Engine.formatBytes(lastFileSizeBytes);
      announce('Imported CSV from URL');
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
      row.className = 'ctj-batch-row';
      try {
        const text = await readFileWithEncoding(file, true);
        const result = Engine.parse(text, opts);
        batchZipFiles.push({ name: file.name.replace(/\.csv$/i, '') + '.json', jsonText: result.jsonText });
        row.innerHTML = `<span class="ctj-batch-ok">✅ ${escapeHtml(file.name)}</span><span>${result.stats.rows} rows</span>`;
      } catch (e) {
        row.innerHTML = `<span class="ctj-batch-fail">❌ ${escapeHtml(file.name)}</span><span>${escapeHtml((e && e.message) || 'Invalid CSV')}</span>`;
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
      triggerDownload(blob, 'csv-to-json-batch.zip');
    } catch (e) {
      announce('Could not build the ZIP file.');
    }
  }

  // ---------- copy / download ----------

  function triggerDownload(blobOrText, filename, mime) {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyJson() {
    if (!lastResult) { announce('Nothing to copy yet — convert CSV first.'); return; }
    try { await navigator.clipboard.writeText(lastResult.jsonText); announce('JSON copied to clipboard.'); }
    catch (e) { announce('Copy failed — your browser may block clipboard access.'); }
  }

  async function copyApiReady() {
    if (!lastResult) { announce('Nothing to copy yet — convert CSV first.'); return; }
    try { await navigator.clipboard.writeText(JSON.stringify(lastResult.data)); announce('Minified, API-ready JSON copied to clipboard.'); }
    catch (e) { announce('Copy failed — your browser may block clipboard access.'); }
  }

  function downloadPretty() {
    if (!lastResult) { announce('Nothing to download yet — convert CSV first.'); return; }
    const opts = getOptions();
    const text = JSON.stringify(lastResult.data, null, opts.indent === 'tab' ? '\t' : Number(opts.indent) || 2);
    triggerDownload(text, 'converted.json');
  }

  function downloadMinified() {
    if (!lastResult) { announce('Nothing to download yet — convert CSV first.'); return; }
    triggerDownload(JSON.stringify(lastResult.data), 'converted.min.json');
  }

  function downloadSchema() {
    if (!lastResult) { announce('Nothing to download yet — convert CSV first.'); return; }
    const schema = Engine.generateSchema(lastResult.data, 'Generated from CSV');
    triggerDownload(JSON.stringify(schema, null, 2), 'schema.json');
  }

  function clearAll() {
    if (els.csvInput) els.csvInput.value = '';
    if (els.fileInput) els.fileInput.value = '';
    if (els.urlInput) els.urlInput.value = '';
    columnState = {};
    setValidation('Empty', 'Paste, upload, or import CSV to begin.');
    renderRaw(''); if (els.treeRoot) els.treeRoot.innerHTML = '';
    renderWarnings([], []); resetStats(); updateCharCount();
    if (els.columnsPanel) els.columnsPanel.hidden = true;
    if (els.previewTable) els.previewTable.innerHTML = '';
    if (els.previewMore) els.previewMore.textContent = '';
    lastFileSizeBytes = 0;
    if (els.statFileSize) els.statFileSize.textContent = '—';
    lastResult = null;
    announce('Cleared.');
  }

  // ---------- wiring ----------

  function init() {
    let debounceTimer;
    if (els.csvInput) {
      els.csvInput.addEventListener('input', () => {
        updateCharCount();
        clearTimeout(debounceTimer);
        const len = els.csvInput.value.length;
        if (len === 0) { runConversion(false); return; }
        if (len > AUTO_CONVERT_LIMIT) return;
        debounceTimer = setTimeout(() => runConversion(true), 450);
      });
    }

    function handleConvertClick() {
      if (!els.csvInput || !els.csvInput.value.trim()) {
        els.csvInput?.focus();
        els.csvInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      runConversionWithProgress(true);
      if (window.matchMedia('(max-width: 980px)').matches) {
        els.outputCol?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    els.convertBtn?.addEventListener('click', handleConvertClick);
    els.stickyConvertBtn?.addEventListener('click', handleConvertClick);
    els.convertAgainBtn?.addEventListener('click', () => { els.csvInput?.focus(); els.csvInput?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    els.clearBtn?.addEventListener('click', clearAll);
    els.undoBtn?.addEventListener('click', undo);
    els.redoBtn?.addEventListener('click', redo);

    [els.delimiterMode, els.customDelimiter, els.quoteChar, els.headerRow, els.skipEmptyRows, els.trimValues, els.coerceTypes, els.nestedMapping, els.sortKeys, els.outputShape, els.rootKey, els.indentSize, els.minify].forEach((ctrl) => {
      ctrl?.addEventListener('change', () => { toggleConditionalFields(); if (els.csvInput && els.csvInput.value.trim()) runConversionWithProgress(true); });
      if (ctrl && (ctrl.tagName === 'INPUT') && ctrl.type === 'text') {
        ctrl.addEventListener('input', debounce(() => { if (els.csvInput && els.csvInput.value.trim()) runConversionWithProgress(true); }, 400));
      }
    });
    toggleConditionalFields();

    els.fileInput?.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; handleFile(f); });

    els.sampleBtn?.addEventListener('click', () => {
      if (els.csvInput) els.csvInput.value = SAMPLE_CSV;
      runConversionWithProgress(true);
    });

    els.urlImportBtn?.addEventListener('click', importFromUrl);

    if (els.dropZone) {
      ['dragenter', 'dragover'].forEach((evt) => els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.add('is-dragover'); }));
      ['dragleave', 'drop'].forEach((evt) => els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.remove('is-dragover'); }));
      els.dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) handleFile(files[0]);
      });
    }

    els.tabTree?.addEventListener('click', () => setActiveTab('tree'));
    els.tabRaw?.addEventListener('click', () => setActiveTab('raw'));

    els.copyBtn?.addEventListener('click', copyJson);
    els.copyApiBtn?.addEventListener('click', copyApiReady);
    els.downloadPrettyBtn?.addEventListener('click', downloadPretty);
    els.downloadMinBtn?.addEventListener('click', downloadMinified);
    els.downloadSchemaBtn?.addEventListener('click', downloadSchema);

    els.historyClearBtn?.addEventListener('click', () => { history.stack = []; history.index = -1; renderHistoryList(); updateUndoRedoState(); });

    els.batchInput?.addEventListener('change', (e) => handleBatchFiles(e.target.files));
    els.batchZipBtn?.addEventListener('click', downloadBatchZip);

    updateUndoRedoState();
    renderHistoryList();
    setValidation('Empty', 'Paste, upload, or import CSV to begin.');
    resetStats();
    updateCharCount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
