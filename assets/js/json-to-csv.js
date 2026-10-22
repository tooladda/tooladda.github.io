/* ToolAdda — JSON to CSV Converter engine.
   Pure parsing/conversion logic (no DOM) lives in JSONCSVEngine so it can be
   unit-tested independently of the UI. Runs entirely client-side. */
(function (global) {
  'use strict';

  // ---------- JSON parsing with line/column error reporting ----------

  function extractLineCol(text, message) {
    const m = /position\s+(\d+)/i.exec(message || '');
    if (!m) return { line: null, column: null };
    const pos = Number(m[1]);
    const upTo = text.slice(0, pos);
    const line = (upTo.match(/\n/g) || []).length + 1;
    const lastNewline = upTo.lastIndexOf('\n');
    const column = pos - lastNewline;
    return { line, column };
  }

  function parseJsonText(text) {
    const src = String(text == null ? '' : text);
    if (!src.trim()) {
      const err = new Error('Paste, upload, or import JSON data first.');
      err.code = 'EMPTY';
      throw err;
    }
    try {
      return JSON.parse(src);
    } catch (e) {
      const { line, column } = extractLineCol(src, e.message);
      const err = new Error(e.message + (line ? ` (around line ${line}, column ${column})` : ''));
      err.code = 'PARSE_ERROR';
      err.line = line;
      err.column = column;
      throw err;
    }
  }

  // ---------- JSON shape stats (objects, arrays, depth) ----------

  function computeJsonStats(value, depth) {
    const stats = { objects: 0, arrays: 0, depth: 0 };
    const walk = (v, d) => {
      if (d > stats.depth) stats.depth = d;
      if (Array.isArray(v)) {
        stats.arrays += 1;
        v.forEach((item) => walk(item, d + 1));
      } else if (v && typeof v === 'object') {
        stats.objects += 1;
        Object.keys(v).forEach((k) => walk(v[k], d + 1));
      }
    };
    walk(value, depth || 1);
    return stats;
  }

  // ---------- flattening nested objects/arrays into dot-notation keys ----------

  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function flattenObject(obj, prefix, out) {
    Object.keys(obj).forEach((key) => {
      const path = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      if (isPlainObject(value)) {
        flattenObject(value, path, out);
      } else if (Array.isArray(value)) {
        if (value.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
          out[path] = value.join('; ');
        } else {
          value.forEach((item, idx) => {
            const arrPath = `${path}.${idx}`;
            if (isPlainObject(item)) flattenObject(item, arrPath, out);
            else out[arrPath] = item;
          });
        }
      } else {
        out[path] = value;
      }
    });
    return out;
  }

  function normalizeRecord(item, flatten) {
    if (!isPlainObject(item)) return { value: item };
    if (!flatten) return Object.assign({}, item);
    return flattenObject(item, '', {});
  }

  // ---------- rows/columns from arbitrary JSON ----------

  // Returns { records: [plainObjectPerRow], isArrayOfArrays, arrayColumnCount }
  function toRecords(data, flatten) {
    if (Array.isArray(data)) {
      if (!data.length) return { records: [] };
      if (data.every((v) => Array.isArray(v))) {
        const maxCols = Math.max(...data.map((r) => r.length));
        const records = data.map((r) => {
          const obj = {};
          for (let i = 0; i < maxCols; i += 1) obj[`column_${i + 1}`] = r[i];
          return obj;
        });
        return { records };
      }
      return { records: data.map((item) => normalizeRecord(item, flatten)) };
    }
    if (isPlainObject(data)) return { records: [normalizeRecord(data, flatten)] };
    return { records: [{ value: data }] };
  }

  function collectColumns(records, order) {
    const seen = new Set();
    const columns = [];
    records.forEach((rec) => {
      Object.keys(rec).forEach((k) => {
        if (!seen.has(k)) { seen.add(k); columns.push(k); }
      });
    });
    if (order === 'alpha') return columns.slice().sort((a, b) => a.localeCompare(b));
    return columns;
  }

  function dropEmptyColumns(columns, records) {
    return columns.filter((col) => records.some((rec) => {
      const v = rec[col];
      return v !== undefined && v !== null && String(v).trim() !== '';
    }));
  }

  // ---------- value formatting ----------

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

  function formatDateValue(value, mode) {
    if (mode === 'none' || typeof value !== 'string' || !ISO_DATE_RE.test(value)) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    if (mode === 'date-only') return d.toISOString().slice(0, 10);
    if (mode === 'locale') return d.toLocaleString();
    return value; // 'iso' — leave as-is
  }

  function stringifyCell(value, opts) {
    if (value === undefined) return '';
    if (value === null) return opts.nullReplacement != null ? opts.nullReplacement : '';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    const formatted = formatDateValue(value, opts.dateFormat || 'none');
    return String(formatted);
  }

  // ---------- CSV escaping ----------

  function escapeCsvCell(raw, delimiter, quoteChar, alwaysQuote, escapeMode) {
    const s = raw == null ? '' : String(raw);
    const needsQuotes = alwaysQuote || s.includes(quoteChar) || s.includes(delimiter) || s.includes('\n') || s.includes('\r');
    if (!needsQuotes) return s;
    const escaped = escapeMode === 'backslash'
      ? s.replace(/\\/g, '\\\\').replace(new RegExp(quoteChar, 'g'), `\\${quoteChar}`)
      : s.replace(new RegExp(quoteChar, 'g'), quoteChar + quoteChar);
    return `${quoteChar}${escaped}${quoteChar}`;
  }

  function detectDuplicateRows(rows) {
    const seen = new Map();
    const duplicates = [];
    rows.forEach((row, idx) => {
      const sig = row.join('');
      if (seen.has(sig)) duplicates.push({ index: idx, firstIndex: seen.get(sig) });
      else seen.set(sig, idx);
    });
    return duplicates;
  }

  // ---------- public entry point ----------

  function defaultOptions(overrides) {
    return Object.assign(
      {
        delimiter: ',', // ',' | ';' | '\t' | '|' | custom single char
        customDelimiter: ',',
        quoteChar: '"',
        alwaysQuote: false,
        escapeMode: 'double', // 'double' | 'backslash'
        includeHeader: true,
        flattenNested: true,
        columnOrder: 'first-seen', // 'first-seen' | 'alpha'
        ignoreEmptyFields: false,
        nullReplacement: '',
        dateFormat: 'none', // 'none' | 'iso' | 'date-only' | 'locale'
        renameMap: {},
        ignoreSet: new Set(),
      },
      overrides || {}
    );
  }

  function resolveDelimiter(opts) {
    if (opts.delimiter === 'custom') return opts.customDelimiter || ',';
    if (opts.delimiter === 'tab' || opts.delimiter === '\t') return '\t';
    return opts.delimiter;
  }

  function convert(jsonText, rawOptions) {
    const opts = defaultOptions(rawOptions);
    const data = parseJsonText(jsonText);
    const jsonStats = computeJsonStats(data, 1);

    const { records } = toRecords(data, opts.flattenNested);
    let columns = collectColumns(records, opts.columnOrder);
    if (opts.ignoreEmptyFields) columns = dropEmptyColumns(columns, records);

    const renameMap = opts.renameMap || {};
    const ignoreSet = opts.ignoreSet || new Set();
    const finalColumns = columns.filter((c) => !ignoreSet.has(c));
    const displayColumns = finalColumns.map((c) => renameMap[c] || c);

    const rows = records.map((rec) => finalColumns.map((c) => stringifyCell(rec[c], opts)));
    const duplicates = detectDuplicateRows(rows);

    const delimiter = resolveDelimiter(opts);
    const lines = [];
    if (opts.includeHeader && displayColumns.length) {
      lines.push(displayColumns.map((c) => escapeCsvCell(c, delimiter, opts.quoteChar, opts.alwaysQuote, opts.escapeMode)).join(delimiter));
    }
    rows.forEach((row) => {
      lines.push(row.map((cell) => escapeCsvCell(cell, delimiter, opts.quoteChar, opts.alwaysQuote, opts.escapeMode)).join(delimiter));
    });
    const csvText = lines.join('\r\n');

    return {
      data,
      csvText,
      delimiter,
      columns: finalColumns,
      displayColumns,
      rows,
      records,
      duplicates,
      stats: {
        rows: rows.length,
        columns: finalColumns.length,
        objects: jsonStats.objects,
        arrays: jsonStats.arrays,
        depth: jsonStats.depth,
        inputChars: jsonText.length,
        outputChars: csvText.length,
      },
    };
  }

  // ---------- encoding sniffing / formatting helpers ----------

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

  global.JSONCSVEngine = {
    parseJsonText,
    computeJsonStats,
    flattenObject,
    toRecords,
    collectColumns,
    dropEmptyColumns,
    stringifyCell,
    escapeCsvCell,
    detectDuplicateRows,
    defaultOptions,
    resolveDelimiter,
    convert,
    sniffEncoding,
    formatBytes,
  };
})(typeof self !== 'undefined' ? self : this);
