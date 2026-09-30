/* ToolAdda — CSV to JSON Converter engine.
   Pure parsing/conversion logic (no DOM) lives in CSVJSONEngine so it can be
   unit-tested independently of the UI. Runs entirely client-side. */
(function (global) {
  'use strict';

  // ---------- RFC-4180-ish CSV parsing (quote/escape aware, custom delimiter) ----------

  // Parses CSV text into records (array of { cells: string[], line: number }).
  // `line` is the 1-based source line where the record started, used for
  // validation messages (inconsistent column counts, etc).
  function parseRecords(text, delimiter, quoteChar) {
    const src = String(text == null ? '' : text);
    const len = src.length;
    const q = quoteChar || '"';

    const records = [];
    let record = [];
    let cur = '';
    let inQuotes = false;
    let startLine = 1;
    let line = 1;

    const pushCell = () => { record.push(cur); cur = ''; };
    const pushRecord = () => { records.push({ cells: record, line: startLine }); record = []; startLine = line; };

    let i = 0;
    while (i < len) {
      const ch = src[i];

      if (inQuotes) {
        if (ch === q) {
          if (src[i + 1] === q) { cur += q; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        if (ch === '\n') line += 1;
        cur += ch; i += 1; continue;
      }

      if (ch === q) { inQuotes = true; i += 1; continue; }

      if (ch === delimiter) { pushCell(); i += 1; continue; }

      if (ch === '\r') {
        if (src[i + 1] === '\n') { pushCell(); pushRecord(); i += 2; line += 1; continue; }
        pushCell(); pushRecord(); i += 1; line += 1; continue;
      }

      if (ch === '\n') { pushCell(); pushRecord(); i += 1; line += 1; continue; }

      cur += ch; i += 1;
    }

    if (inQuotes) {
      const err = new Error('Malformed CSV: an unclosed quote was found. Check for a stray " character.');
      err.code = 'UNCLOSED_QUOTE';
      err.line = startLine;
      throw err;
    }

    pushCell();
    pushRecord();

    // Drop trailing/leading fully-empty records (blank lines at file edges).
    const isBlank = (rec) => rec.cells.every((c) => String(c).trim() === '');
    while (records.length && isBlank(records[records.length - 1])) records.pop();
    while (records.length && isBlank(records[0])) records.shift();

    return records;
  }

  function detectDelimiter(text, quoteChar) {
    const candidates = [',', ';', '\t', '|'];
    const sample = String(text == null ? '' : text).slice(0, 50000);
    let best = ','; let bestScore = -Infinity;

    for (const delim of candidates) {
      try {
        const records = parseRecords(sample, delim, quoteChar);
        if (!records.length) continue;
        const counts = records.slice(0, 20).map((r) => r.cells.length);
        const nonZero = counts.filter((c) => c > 1);
        if (!nonZero.length) continue;
        const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
        const variance = nonZero.reduce((acc, c) => acc + (c - avg) ** 2, 0) / nonZero.length;
        const score = avg - variance * 0.3;
        if (score > bestScore) { bestScore = score; best = delim; }
      } catch { /* try next candidate */ }
    }
    return best;
  }

  // ---------- value coercion ----------

  function coerce(raw, enabled) {
    const t = String(raw == null ? '' : raw);
    if (!enabled) return t;
    const trimmed = t.trim();
    if (trimmed === '') return t === '' ? '' : t;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^(null|NULL|N\/A|n\/a|NA)$/.test(trimmed)) return null;
    // Only coerce to number when the WHOLE trimmed string is numeric and it
    // doesn't look like an identifier with a leading zero (e.g. "007", "0123"),
    // a phone number, or a zip code — those must stay strings.
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
    return t;
  }

  // ---------- header + object building ----------

  function normalizeHeader(h, idx) {
    const name = String(h == null ? '' : h).trim();
    return name || `column_${idx + 1}`;
  }

  function setNestedValue(obj, path, value) {
    const parts = path.split('.').filter(Boolean);
    let node = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      if (typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) node[key] = {};
      node = node[key];
    }
    node[parts[parts.length - 1]] = value;
  }

  function sortObjectKeys(value) {
    if (Array.isArray(value)) return value.map(sortObjectKeys);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort((a, b) => a.localeCompare(b)).forEach((k) => { out[k] = sortObjectKeys(value[k]); });
      return out;
    }
    return value;
  }

  // options: { hasHeaderRow, skipEmptyRows, trimValues, coerceTypes, nestedMapping,
  //            sortKeys, renameMap: {origHeader: newName}, ignoreSet: Set(origHeader) }
  function buildObjects(records, options) {
    const opts = options || {};
    if (!records.length) return { keys: [], objects: [], warnings: [] };

    const headerRow = opts.hasHeaderRow === false ? null : records[0];
    const dataRecords = opts.hasHeaderRow === false ? records : records.slice(1);

    const columnCount = headerRow ? headerRow.cells.length : (dataRecords[0] ? dataRecords[0].cells.length : 0);
    const rawHeaders = headerRow
      ? headerRow.cells.map(normalizeHeader)
      : Array.from({ length: columnCount }, (_, i) => `column_${i + 1}`);

    const warnings = [];
    const keys = rawHeaders.map((h) => (opts.renameMap && opts.renameMap[h]) || h);
    const ignoreSet = opts.ignoreSet || new Set();

    const objects = [];
    dataRecords.forEach((rec) => {
      const cells = rec.cells;
      if (opts.skipEmptyRows && cells.every((c) => String(c).trim() === '')) return;
      if (cells.length !== rawHeaders.length) {
        warnings.push({ line: rec.line, message: `Row has ${cells.length} column${cells.length === 1 ? '' : 's'}, expected ${rawHeaders.length}.` });
      }

      const obj = {};
      for (let c = 0; c < rawHeaders.length; c += 1) {
        const origHeader = rawHeaders[c];
        if (ignoreSet.has(origHeader)) continue;
        let value = cells[c] == null ? '' : cells[c];
        if (opts.trimValues !== false) value = String(value).trim();
        value = coerce(value, !!opts.coerceTypes);
        const outKey = (opts.renameMap && opts.renameMap[origHeader]) || origHeader;
        if (opts.nestedMapping && outKey.includes('.')) setNestedValue(obj, outKey, value);
        else obj[outKey] = value;
      }
      objects.push(opts.sortKeys ? sortObjectKeys(obj) : obj);
    });

    return { keys: keys.filter((k) => !ignoreSet.has(k)), objects, warnings, rawHeaders };
  }

  function wrapOutput(objects, options) {
    const opts = options || {};
    if (opts.outputShape === 'root') {
      const rootKey = (opts.rootKey || 'data').trim() || 'data';
      return { [rootKey]: objects };
    }
    return objects;
  }

  function detectDuplicateRows(objects) {
    const seen = new Map();
    const duplicates = [];
    objects.forEach((obj, idx) => {
      const sig = JSON.stringify(obj);
      if (seen.has(sig)) duplicates.push({ index: idx, firstIndex: seen.get(sig) });
      else seen.set(sig, idx);
    });
    return duplicates;
  }

  // ---------- public parse entry point ----------

  function defaultOptions(overrides) {
    return Object.assign(
      {
        delimiter: 'auto', // ',' | ';' | '\t' | '|' | 'custom' | 'auto'
        customDelimiter: ',',
        quoteChar: '"',
        hasHeaderRow: true,
        skipEmptyRows: true,
        trimValues: true,
        coerceTypes: true,
        nestedMapping: false,
        sortKeys: false,
        outputShape: 'array', // 'array' | 'root'
        rootKey: 'data',
        renameMap: {},
        ignoreSet: new Set(),
        indent: 2,
        minify: false,
      },
      overrides || {}
    );
  }

  function resolveDelimiter(text, opts) {
    if (opts.delimiter === 'auto') return detectDelimiter(text, opts.quoteChar);
    if (opts.delimiter === 'custom') return opts.customDelimiter || ',';
    if (opts.delimiter === 'tab') return '\t';
    return opts.delimiter;
  }

  function parse(text, rawOptions) {
    const opts = defaultOptions(rawOptions);
    const src = String(text == null ? '' : text);
    if (!src.trim()) {
      const err = new Error('Paste, upload, or import CSV data first.');
      err.code = 'EMPTY';
      throw err;
    }

    const delimiter = resolveDelimiter(src, opts);
    const records = parseRecords(src, delimiter, opts.quoteChar);
    if (!records.length) {
      const err = new Error('No CSV rows were found in this input.');
      err.code = 'EMPTY';
      throw err;
    }

    const { keys, objects, warnings, rawHeaders } = buildObjects(records, opts);
    const duplicates = detectDuplicateRows(objects);
    const data = wrapOutput(objects, opts);

    const indent = opts.minify ? 0 : (opts.indent === 'tab' ? '\t' : Number(opts.indent) || 2);
    const jsonText = opts.minify ? JSON.stringify(data) : JSON.stringify(data, null, indent);

    return {
      data,
      jsonText,
      delimiter,
      keys,
      rawHeaders: rawHeaders || [],
      objects,
      warnings,
      duplicates,
      stats: {
        rows: objects.length,
        columns: keys.length,
        inputChars: src.length,
        outputChars: jsonText.length,
        recordCount: records.length,
      },
    };
  }

  // ---------- JSON Schema (draft-07) inference — data-shape generic ----------

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return typeof v;
  }

  function mergeTypeSets(a, b) {
    const set = new Set([].concat(a, b));
    if (set.has('integer') && set.has('number')) set.delete('integer');
    return Array.from(set);
  }

  function inferSchema(value) {
    const t = typeOf(value);
    if (t === 'array') {
      if (!value.length) return { type: 'array', items: {} };
      const merged = value.map(inferSchema).reduce((acc, s) => mergeSchemaPair(acc, s));
      return { type: 'array', items: merged };
    }
    if (t === 'object') {
      const properties = {};
      const required = [];
      Object.keys(value).forEach((key) => { properties[key] = inferSchema(value[key]); required.push(key); });
      return { type: 'object', properties, required };
    }
    return { type: t };
  }

  function mergeSchemaPair(a, b) {
    const aType = Array.isArray(a.type) ? a.type : [a.type];
    const bType = Array.isArray(b.type) ? b.type : [b.type];
    const types = mergeTypeSets(aType, bType);
    if (types.length === 1 && types[0] === 'object') {
      const properties = Object.assign({}, a.properties, b.properties);
      const required = (a.required || []).filter((k) => (b.required || []).includes(k));
      return { type: 'object', properties, required };
    }
    if (types.length === 1 && types[0] === 'array') {
      const items = a.items && b.items ? mergeSchemaPair(a.items, b.items) : (a.items || b.items || {});
      return { type: 'array', items };
    }
    return { type: types.length === 1 ? types[0] : types };
  }

  function generateSchema(data, title) {
    return Object.assign(
      { $schema: 'http://json-schema.org/draft-07/schema#', title: title || 'Generated from CSV' },
      inferSchema(data)
    );
  }

  // ---------- encoding sniffing (for file uploads) ----------

  function sniffEncoding(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', bomLength: 3 };
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bomLength: 2 };
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bomLength: 2 };
    return { encoding: 'utf-8', bomLength: 0 };
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  global.CSVJSONEngine = {
    parseRecords,
    detectDelimiter,
    coerce,
    normalizeHeader,
    buildObjects,
    wrapOutput,
    detectDuplicateRows,
    defaultOptions,
    resolveDelimiter,
    parse,
    generateSchema,
    inferSchema,
    sniffEncoding,
    formatBytes,
  };
})(typeof self !== 'undefined' ? self : this);
