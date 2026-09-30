/* ToolAdda — JSON to CSV Converter UI wiring.
   Depends on window.JSONCSVEngine (assets/js/json-to-csv.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-jtc-pro')) return;
  const Engine = window.JSONCSVEngine;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const PROGRESS_THRESHOLD = 50 * 1024;
  const AUTO_CONVERT_LIMIT = 200 * 1024;
  const MAX_HISTORY = 20;
  const MAX_TREE_ITEMS = 200;
  const MAX_PREVIEW_ROWS = 50;

  const els = {
    jsonInput: $('jtcJsonInput'),
    dropZone: $('jtcDropZone'),
    fileInput: $('jtcFileInput'),
    autoEncoding: $('jtcAutoEncoding'),
    urlInput: $('jtcUrlInput'),
    urlImportBtn: $('jtcUrlImportBtn'),
    sampleBtn: $('jtcSampleBtn'),
    clearBtn: $('jtcClearAllBtn'),
    undoBtn: $('jtcUndoBtn'),
    redoBtn: $('jtcRedoBtn'),

    delimiterMode: $('jtcDelimiterMode'),
    customDelimiterWrap: $('jtcCustomDelimiterWrap'),
    customDelimiter: $('jtcCustomDelimiter'),
    quoteChar: $('jtcQuoteChar'),
    alwaysQuote: $('jtcAlwaysQuote'),
    escapeMode: $('jtcEscapeMode'),
    includeHeader: $('jtcIncludeHeader'),
    flattenNested: $('jtcFlattenNested'),
    columnOrder: $('jtcColumnOrder'),
    ignoreEmptyFields: $('jtcIgnoreEmptyFields'),
    nullReplacement: $('jtcNullReplacement'),
    dateFormat: $('jtcDateFormat'),

    convertBtn: $('jtcConvertBtn'),
    stickyConvertBtn: $('jtcStickyConvertBtn'),
    outputCol: $('jtcOutputCol'),
    progressBar: $('jtcProgressBar'),

    validationStatus: $('jtcValidationStatus'),
    validationMessage: $('jtcValidationMessage'),

    statChars: $('jtcStatChars'),
    statObjects: $('jtcStatObjects'),
    statArrays: $('jtcStatArrays'),
    statDepth: $('jtcStatDepth'),
    statRows: $('jtcStatRows'),
    statCols: $('jtcStatCols'),
    statFileSize: $('jtcStatFileSize'),
    statOutSize: $('jtcStatOutSize'),
    statDuplicates: $('jtcStatDuplicates'),
    statTime: $('jtcStatTime'),

    columnsPanel: $('jtcColumnsPanel'),
    columnsList: $('jtcColumnsList'),

    treeRoot: $('jtcTreeRoot'),

    previewTable: $('jtcPreviewTable'),
    previewMore: $('jtcPreviewMore'),

    csvOutput: $('jtcCsvOutput'),

    copyBtn: $('jtcCopyBtn'),
    downloadCsvBtn: $('jtcDownloadCsvBtn'),
    downloadTsvBtn: $('jtcDownloadTsvBtn'),
    downloadExcelBtn: $('jtcDownloadExcelBtn'),
    convertAgainBtn: $('jtcConvertAgainBtn'),

    historyList: $('jtcHistoryList'),
    historyClearBtn: $('jtcHistoryClearBtn'),

    batchInput: $('jtcBatchFileInput'),
    batchResults: $('jtcBatchResults'),
    batchZipBtn: $('jtcBatchZipBtn'),

    srStatus: $('jtcSrStatus'),
  };

  const SAMPLE_JSON = JSON.stringify([
    { id: '007', name: 'Alice Johnson', address: { city: 'New York', zip: '10001' }, tags: ['vip', 'newsletter'], joined: '2024-01-15', active: true, notes: null },
    { id: '010', name: 'Bob Smith', address: { city: 'Los Angeles', zip: '90001' }, tags: ['newsletter'], joined: '2023-05-20', active: false, notes: 'Prefers email' },
  ], null, 2);

  let lastResult = null;
  let lastFileSizeBytes = 0;
  let columnState = {}; // { originalColumn: { ignore: bool, rename: string } }
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
      delimiter: els.delimiterMode ? els.delimiterMode.value : ',',
      customDelimiter: els.customDelimiter ? (els.customDelimiter.value || ',') : ',',
      quoteChar: els.quoteChar ? els.quoteChar.value : '"',
      alwaysQuote: !!(els.alwaysQuote && els.alwaysQuote.checked),
      escapeMode: els.escapeMode ? els.escapeMode.value : 'double',
      includeHeader: !els.includeHeader || els.includeHeader.checked,
      flattenNested: !els.flattenNested || els.flattenNested.checked,
      columnOrder: els.columnOrder ? els.columnOrder.value : 'first-seen',
      ignoreEmptyFields: !!(els.ignoreEmptyFields && els.ignoreEmptyFields.checked),
      nullReplacement: els.nullReplacement ? els.nullReplacement.value : '',
      dateFormat: els.dateFormat ? els.dateFormat.value : 'none',
      renameMap,
      ignoreSet,
    };
  }

  function toggleConditionalFields() {
    if (els.customDelimiterWrap) els.customDelimiterWrap.hidden = !(els.delimiterMode && els.delimiterMode.value === 'custom');
  }

  // ---------- validation panel ----------

  function setValidation(status, message) {
    if (els.validationStatus) {
      els.validationStatus.textContent = status;
      els.validationStatus.className = 'jtc-badge-status jtc-badge-' + (status === 'Valid' ? 'ok' : status === 'Empty' ? 'idle' : 'error');
    }
    if (els.validationMessage) els.validationMessage.textContent = message || '';
  }

  function updateCharCount() {
    const val = els.jsonInput ? els.jsonInput.value : '';
    if (els.statChars) els.statChars.textContent = String(val.length);
  }

  function resetStats() {
    ['statObjects', 'statArrays', 'statDepth', 'statRows', 'statCols', 'statOutSize', 'statDuplicates', 'statTime'].forEach((k) => { if (els[k]) els[k].textContent = '—'; });
  }

  // ---------- JSON tree view (of the input) ----------

  function typeLabel(value) { if (value === null) return 'null'; if (Array.isArray(value)) return 'array'; return typeof value; }

  function primitiveSpan(value) {
    const t = typeLabel(value);
    const text = t === 'string' ? `"${escapeHtml(value)}"` : escapeHtml(String(value));
    return `<span class="jtc-node-value tok-${t}">${text}</span>`;
  }

  function buildTreeNode(key, value) {
    const li = document.createElement('li');
    li.className = 'jtc-tree-node';
    const t = typeLabel(value);

    if (t === 'object' || t === 'array') {
      const entries = t === 'array' ? value.map((v, i) => [String(i), v]) : Object.entries(value);
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      const count = entries.length;
      summary.innerHTML = `${key !== null ? `<span class="jtc-node-key">${escapeHtml(key)}</span>: ` : ''}<span class="jtc-node-meta">${t === 'array' ? `[ ${count} item${count === 1 ? '' : 's'} ]` : `{ ${count} key${count === 1 ? '' : 's'} }`}</span>`;
      details.appendChild(summary);
      const ul = document.createElement('ul');
      ul.className = 'jtc-tree-children';
      const visible = entries.slice(0, MAX_TREE_ITEMS);
      visible.forEach(([k, v]) => ul.appendChild(buildTreeNode(k, v)));
      if (entries.length > MAX_TREE_ITEMS) {
        const more = document.createElement('li');
        more.className = 'jtc-tree-more';
        const remaining = entries.length - MAX_TREE_ITEMS;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'jtc-tree-more-btn'; btn.textContent = `Show ${remaining} more…`;
        btn.addEventListener('click', () => { entries.slice(MAX_TREE_ITEMS).forEach(([k, v]) => ul.insertBefore(buildTreeNode(k, v), more)); more.remove(); });
        more.appendChild(btn); ul.appendChild(more);
      }
      details.appendChild(ul);
      li.appendChild(details);
    } else {
      li.innerHTML = `${key !== null ? `<span class="jtc-node-key">${escapeHtml(key)}</span>: ` : ''}${primitiveSpan(value)}`;
    }
    return li;
  }

  function renderTree(data) {
    if (!els.treeRoot) return;
    els.treeRoot.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'jtc-tree-root-list';
    ul.appendChild(buildTreeNode(null, data));
    els.treeRoot.appendChild(ul);
  }

  // ---------- CSV table preview ----------

  function renderPreview(result) {
    if (!els.previewTable) return;
    if (!result || !result.displayColumns.length) { els.previewTable.innerHTML = ''; if (els.previewMore) els.previewMore.textContent = ''; return; }
    const headers = result.displayColumns;
    const rows = result.rows.slice(0, MAX_PREVIEW_ROWS);
    let html = '<thead><tr>' + headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr>' + row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('') + '</tr>';
    });
    html += '</tbody>';
    els.previewTable.innerHTML = html;
    const remaining = result.rows.length - rows.length;
    if (els.previewMore) els.previewMore.textContent = remaining > 0 ? `Showing first ${rows.length} of ${result.rows.length} rows.` : `Showing all ${result.rows.length} row${result.rows.length === 1 ? '' : 's'}.`;
  }

  // ---------- column mapping panel ----------

  function renderColumnsPanel(columns) {
    if (!els.columnsList || !els.columnsPanel) return;
    if (!columns || !columns.length) { els.columnsPanel.hidden = true; els.columnsList.innerHTML = ''; return; }

    const next = {};
    columns.forEach((c) => { next[c] = columnState[c] || { ignore: false, rename: '' }; });
    columnState = next;

    els.columnsPanel.hidden = false;
    els.columnsList.innerHTML = columns.map((c, i) => `
      <div class="jtc-column-row" data-column="${escapeHtml(c)}">
        <label class="jtc-toggle"><input type="checkbox" data-col-ignore data-col-ref="${i}" ${columnState[c].ignore ? 'checked' : ''} /> Ignore</label>
        <span class="jtc-column-orig">${escapeHtml(c)}</span>
        <span aria-hidden="true">→</span>
        <input type="text" data-col-rename data-col-ref="${i}" placeholder="${escapeHtml(c)}" value="${escapeHtml(columnState[c].rename)}" aria-label="Rename column ${escapeHtml(c)}" />
      </div>`).join('');

    els.columnsList.querySelectorAll('[data-col-ignore]').forEach((input, i) => {
      input.addEventListener('change', () => { columnState[columns[i]].ignore = input.checked; runConversionWithProgress(true); });
    });
    els.columnsList.querySelectorAll('[data-col-rename]').forEach((input, i) => {
      input.addEventListener('input', debounce(() => { columnState[columns[i]].rename = input.value; runConversionWithProgress(true); }, 400));
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
    if (!history.stack.length) { els.historyList.innerHTML = '<li class="jtc-history-empty">No conversions yet.</li>'; return; }
    els.historyList.innerHTML = '';
    history.stack.forEach((entry, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jtc-history-item' + (i === history.index ? ' is-active' : '');
      const time = new Date(entry.timestamp).toLocaleTimeString();
      btn.innerHTML = `<span>${entry.result.stats.rows} row${entry.result.stats.rows === 1 ? '' : 's'} × ${entry.result.stats.columns} col${entry.result.stats.columns === 1 ? '' : 's'}</span><span class="jtc-history-meta">${time}</span>`;
      btn.addEventListener('click', () => restoreHistory(i));
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  function restoreHistory(index) {
    const entry = history.stack[index];
    if (!entry) return;
    history.index = index;
    if (els.jsonInput) els.jsonInput.value = entry.json;
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
    setValidation('Valid', 'Converted successfully.');

    if (els.statObjects) els.statObjects.textContent = String(result.stats.objects);
    if (els.statArrays) els.statArrays.textContent = String(result.stats.arrays);
    if (els.statDepth) els.statDepth.textContent = String(result.stats.depth);
    if (els.statRows) els.statRows.textContent = String(result.stats.rows);
    if (els.statCols) els.statCols.textContent = String(result.stats.columns);
    if (els.statOutSize) els.statOutSize.textContent = Engine.formatBytes(new Blob([result.csvText]).size);
    if (els.statDuplicates) els.statDuplicates.textContent = String(result.duplicates.length);
    if (els.statTime) els.statTime.textContent = timeMs.toFixed(1) + ' ms';

    if (els.csvOutput) els.csvOutput.textContent = result.csvText;
    renderTree(result.data);
    renderColumnsPanel(result.columns);
    renderPreview(result);

    if (addToHistory) {
      pushHistory({
        json: els.jsonInput ? els.jsonInput.value : '',
        result,
        timestamp: Date.now(),
        timing: timeMs,
      });
    }
  }

  function runConversion(addToHistory) {
    const json = els.jsonInput ? els.jsonInput.value : '';
    updateCharCount();

    if (!json.trim()) {
      setValidation('Empty', 'Paste, upload, or import JSON to begin.');
      if (els.csvOutput) els.csvOutput.textContent = '';
      if (els.treeRoot) els.treeRoot.innerHTML = '';
      resetStats();
      if (els.columnsPanel) els.columnsPanel.hidden = true;
      if (els.previewTable) els.previewTable.innerHTML = '';
      lastResult = null;
      return;
    }

    const start = performance.now();
    try {
      const result = Engine.convert(json, getOptions());
      const timeMs = performance.now() - start;
      lastResult = result;
      applyResult(result, timeMs, addToHistory !== false);
    } catch (err) {
      setValidation('Invalid', (err && err.message) || 'This JSON could not be parsed.');
      if (els.csvOutput) els.csvOutput.textContent = '';
      if (els.treeRoot) els.treeRoot.innerHTML = '';
      resetStats();
      lastResult = null;
    }
  }

  function runConversionWithProgress(addToHistory) {
    const json = els.jsonInput ? els.jsonInput.value : '';
    if (json.length < PROGRESS_THRESHOLD) { runConversion(addToHistory); return; }
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
      if (els.jsonInput) els.jsonInput.value = text;
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
    setValidation('Empty', 'Fetching JSON…');
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const text = await res.text();
      if (els.jsonInput) els.jsonInput.value = text;
      lastFileSizeBytes = new Blob([text]).size;
      if (els.statFileSize) els.statFileSize.textContent = Engine.formatBytes(lastFileSizeBytes);
      announce('Imported JSON from URL');
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
      row.className = 'jtc-batch-row';
      try {
        const text = await readFileWithEncoding(file, true);
        const result = Engine.convert(text, opts);
        batchZipFiles.push({ name: file.name.replace(/\.json$/i, '') + '.csv', csvText: result.csvText });
        row.innerHTML = `<span class="jtc-batch-ok">✅ ${escapeHtml(file.name)}</span><span>${result.stats.rows} rows</span>`;
      } catch (e) {
        row.innerHTML = `<span class="jtc-batch-fail">❌ ${escapeHtml(file.name)}</span><span>${escapeHtml((e && e.message) || 'Invalid JSON')}</span>`;
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
      batchZipFiles.forEach((f) => zip.file(f.name, f.csvText));
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(blob, 'json-to-csv-batch.zip');
    } catch (e) {
      announce('Could not build the ZIP file.');
    }
  }

  // ---------- copy / download ----------

  function triggerDownload(blobOrText, filename, mime) {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyCsv() {
    if (!lastResult) { announce('Nothing to copy yet — convert JSON first.'); return; }
    try { await navigator.clipboard.writeText(lastResult.csvText); announce('CSV copied to clipboard.'); }
    catch (e) { announce('Copy failed — your browser may block clipboard access.'); }
  }

  function downloadCsv() {
    if (!lastResult) { announce('Nothing to download yet — convert JSON first.'); return; }
    triggerDownload(lastResult.csvText, 'converted.csv');
  }

  function downloadTsv() {
    if (!els.jsonInput || !els.jsonInput.value.trim()) { announce('Nothing to download yet — convert JSON first.'); return; }
    const opts = getOptions();
    opts.delimiter = 'tab';
    try {
      const result = Engine.convert(els.jsonInput.value, opts);
      triggerDownload(result.csvText, 'converted.tsv', 'text/tab-separated-values;charset=utf-8');
    } catch (e) { announce('Could not generate TSV.'); }
  }

  function downloadExcel() {
    if (!lastResult) { announce('Nothing to download yet — convert JSON first.'); return; }
    // Prepend a UTF-8 BOM so Excel correctly detects UTF-8 encoding instead of
    // misreading accented/non-ASCII characters as another codepage.
    const blob = new Blob(['﻿' + lastResult.csvText], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, 'converted-excel.csv');
  }

  function clearAll() {
    if (els.jsonInput) els.jsonInput.value = '';
    if (els.fileInput) els.fileInput.value = '';
    if (els.urlInput) els.urlInput.value = '';
    columnState = {};
    setValidation('Empty', 'Paste, upload, or import JSON to begin.');
    if (els.csvOutput) els.csvOutput.textContent = '';
    if (els.treeRoot) els.treeRoot.innerHTML = '';
    resetStats(); updateCharCount();
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
    if (els.jsonInput) {
      els.jsonInput.addEventListener('input', () => {
        updateCharCount();
        clearTimeout(debounceTimer);
        const len = els.jsonInput.value.length;
        if (len === 0) { runConversion(false); return; }
        if (len > AUTO_CONVERT_LIMIT) return;
        debounceTimer = setTimeout(() => runConversion(true), 450);
      });
    }

    function handleConvertClick() {
      if (!els.jsonInput || !els.jsonInput.value.trim()) {
        els.jsonInput?.focus();
        els.jsonInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      runConversionWithProgress(true);
      if (window.matchMedia('(max-width: 980px)').matches) {
        els.outputCol?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    els.convertBtn?.addEventListener('click', handleConvertClick);
    els.stickyConvertBtn?.addEventListener('click', handleConvertClick);
    els.convertAgainBtn?.addEventListener('click', () => { els.jsonInput?.focus(); els.jsonInput?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    els.clearBtn?.addEventListener('click', clearAll);
    els.undoBtn?.addEventListener('click', undo);
    els.redoBtn?.addEventListener('click', redo);

    [els.delimiterMode, els.customDelimiter, els.quoteChar, els.alwaysQuote, els.escapeMode, els.includeHeader, els.flattenNested, els.columnOrder, els.ignoreEmptyFields, els.nullReplacement, els.dateFormat].forEach((ctrl) => {
      ctrl?.addEventListener('change', () => { toggleConditionalFields(); if (els.jsonInput && els.jsonInput.value.trim()) runConversionWithProgress(true); });
      if (ctrl && ctrl.tagName === 'INPUT' && ctrl.type === 'text') {
        ctrl.addEventListener('input', debounce(() => { if (els.jsonInput && els.jsonInput.value.trim()) runConversionWithProgress(true); }, 400));
      }
    });
    toggleConditionalFields();

    els.fileInput?.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; handleFile(f); });

    els.sampleBtn?.addEventListener('click', () => {
      if (els.jsonInput) els.jsonInput.value = SAMPLE_JSON;
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

    els.copyBtn?.addEventListener('click', copyCsv);
    els.downloadCsvBtn?.addEventListener('click', downloadCsv);
    els.downloadTsvBtn?.addEventListener('click', downloadTsv);
    els.downloadExcelBtn?.addEventListener('click', downloadExcel);

    els.historyClearBtn?.addEventListener('click', () => { history.stack = []; history.index = -1; renderHistoryList(); updateUndoRedoState(); });

    els.batchInput?.addEventListener('change', (e) => handleBatchFiles(e.target.files));
    els.batchZipBtn?.addEventListener('click', downloadBatchZip);

    updateUndoRedoState();
    renderHistoryList();
    setValidation('Empty', 'Paste, upload, or import JSON to begin.');
    resetStats();
    updateCharCount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
