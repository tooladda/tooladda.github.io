/* ==========================================================================
   ToolAdda — CSV Chart Engine
   Pure, dependency-free logic for the CSV to Interactive Chart studio:

     • RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, unicode)
     • delimiter sniffing, header sniffing
     • column type inference (number / date / boolean / string / empty)
     • filtering, searching, type-aware sorting, grouped aggregation
     • an SVG chart renderer (line, area, bar, hbar, stacked, pie, doughnut,
       scatter, radar) with tooltips, legend, zoom & pan, PNG/SVG export

   No network access. No third-party libraries. Everything runs in-page.
   ========================================================================== */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';

  /* ======================================================================
     0. Tiny helpers
     ====================================================================== */

  function el(tag, attrs, parent) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined) continue;
        node.setAttribute(k, String(v));
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function text(node, value) {
    node.textContent = value === null || value === undefined ? '' : String(value);
    return node;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ======================================================================
     1. CSV parsing
     ====================================================================== */

  /**
   * Parse CSV text into a matrix of raw string cells.
   * Handles quoted fields, "" escapes, embedded delimiters/newlines, BOM,
   * CRLF/CR/LF line endings and ragged rows.
   */
  function parseCSVText(input, delimiter) {
    var src = typeof input === 'string' ? input : String(input == null ? '' : input);
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

    var delim = delimiter || detectDelimiter(src) || ',';
    var rows = [];
    var row = [];
    var field = '';
    var i = 0;
    var len = src.length;
    var inQuotes = false;
    var fieldStart = true;
    var unterminated = false;

    while (i < len) {
      var ch = src.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += ch; i += 1; continue;
      }

      if (ch === '"' && fieldStart) { inQuotes = true; fieldStart = false; i += 1; continue; }

      if (ch === delim) {
        row.push(field); field = ''; fieldStart = true; i += 1; continue;
      }

      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && src.charAt(i + 1) === '\n') i += 1;
        row.push(field); rows.push(row);
        row = []; field = ''; fieldStart = true; i += 1; continue;
      }

      field += ch; fieldStart = false; i += 1;
    }

    if (inQuotes) unterminated = true;
    row.push(field);
    rows.push(row);

    // Drop trailing blank rows produced by a final newline.
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();

    return { rows: rows, delimiter: delim, unterminated: unterminated };
  }

  var DELIMITER_CANDIDATES = [',', ';', '\t', '|'];

  /** Sniff the most likely delimiter by parsing a sample with each candidate. */
  function detectDelimiter(src) {
    var sample = String(src || '').slice(0, 96 * 1024);
    if (!sample.trim()) return ',';
    var best = null;

    for (var c = 0; c < DELIMITER_CANDIDATES.length; c++) {
      var d = DELIMITER_CANDIDATES[c];
      var parsed = parseCSVText(sample, d);
      var rows = parsed.rows.slice(0, 30).filter(function (r) { return r.length && !(r.length === 1 && r[0] === ''); });
      if (rows.length < 1) continue;

      var first = rows[0].length;
      if (first < 2) continue;

      var same = 0;
      for (var r = 0; r < rows.length; r++) if (rows[r].length === first) same += 1;
      var consistency = same / rows.length;

      // Prefer consistent row widths first, then a healthy (but not silly) column count.
      var score = consistency * 1000 + Math.min(first, 40);
      if (!best || score > best.score) best = { delimiter: d, score: score };
    }

    return best ? best.delimiter : ',';
  }

  var DELIMITER_LABELS = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' };
  function delimiterLabel(d) { return DELIMITER_LABELS[d] || 'Custom'; }

  /* ======================================================================
     2. Value coercion — numbers, dates, booleans
     ====================================================================== */

  var CURRENCY_RE = /[$€£¥₹₽₩¢₪₴₺฿]/g;

  /**
   * Coerce a raw cell into a number, understanding thousands separators,
   * currency prefixes, percentages and accounting negatives.
   * Returns { value, unit, percent } or null when the cell is not numeric.
   */
  function parseNumeric(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).replace(/ /g, ' ').trim();
    if (!s) return null;

    var negative = false;
    var unit = '';
    var percent = false;

    if (/^\(.+\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }

    var currency = s.match(CURRENCY_RE);
    if (currency) { unit = currency[0]; s = s.replace(CURRENCY_RE, '').trim(); }

    if (/%$/.test(s)) { percent = true; s = s.slice(0, -1).trim(); }

    if (s.charAt(0) === '+') s = s.slice(1).trim();
    else if (s.charAt(0) === '-') { negative = !negative; s = s.slice(1).trim(); }

    if (!s) return null;

    // Thousands grouping always ends in a group of exactly three digits, which is
    // what keeps "3,14" (a European decimal) out of this branch.
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) || /^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(s)) {
      // 1,250  ·  1,234,567.89  ·  12,34,567 (Indian grouping)
      s = s.replace(/,/g, '');
    } else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
      // European grouping: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d+,\d+$/.test(s) && !/^\d{1,3},\d{3}$/.test(s)) {
      // 3,14 — comma decimal separator
      s = s.replace(',', '.');
    } else if (!/^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
      return null;
    }

    var n = Number(s);
    if (!isFinite(n)) return null;
    return { value: negative ? -n : n, unit: percent ? '%' : unit, percent: percent };
  }

  function numericValue(raw) {
    var parsed = parseNumeric(raw);
    return parsed ? parsed.value : null;
  }

  var MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
    september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  var RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
  var RE_YMD_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
  var RE_YM = /^(\d{4})-(\d{1,2})$/;
  var RE_AMBIG = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/;
  var RE_MON_D_Y = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/;
  var RE_D_MON_Y = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/;
  var RE_MON_Y = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/;

  function mkDate(y, m, d, hh, mm, ss) {
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
    var t = Date.UTC(y, m, d, hh || 0, mm || 0, ss || 0);
    var probe = new Date(t);
    if (probe.getUTCMonth() !== m || probe.getUTCDate() !== d) return null;
    return t;
  }

  /**
   * Parse a date-ish cell into epoch milliseconds (UTC), or null.
   * `order` disambiguates dd/mm/yyyy vs mm/dd/yyyy ('DMY' | 'MDY').
   */
  function parseDateValue(raw, order) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (!s || s.length > 40) return null;
    if (/^\d+$/.test(s)) return null; // bare integers stay numbers, not years

    var m = RE_ISO.exec(s);
    if (m) return mkDate(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));

    m = RE_YMD_SLASH.exec(s);
    if (m) return mkDate(+m[1], +m[2] - 1, +m[3]);

    m = RE_YM.exec(s);
    if (m) return mkDate(+m[1], +m[2] - 1, 1);

    m = RE_AMBIG.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      var dayFirst = order === 'DMY';
      if (a > 12) dayFirst = true;
      else if (b > 12) dayFirst = false;
      return dayFirst ? mkDate(y, b - 1, a) : mkDate(y, a - 1, b);
    }

    m = RE_MON_D_Y.exec(s);
    if (m) {
      var mo = MONTHS[m[1].toLowerCase()];
      if (mo === undefined) return null;
      return mkDate(+m[3], mo, +m[2]);
    }

    m = RE_D_MON_Y.exec(s);
    if (m) {
      var mo2 = MONTHS[m[2].toLowerCase()];
      if (mo2 === undefined) return null;
      return mkDate(+m[3], mo2, +m[1]);
    }

    m = RE_MON_Y.exec(s);
    if (m) {
      var mo3 = MONTHS[m[1].toLowerCase()];
      if (mo3 === undefined) return null;
      return mkDate(+m[2], mo3, 1);
    }

    return null;
  }

  /** Look at a whole column to decide whether ambiguous slash dates are D/M or M/D. */
  function detectDateOrder(values) {
    var dayFirst = 0, monthFirst = 0;
    for (var i = 0; i < values.length; i++) {
      var m = RE_AMBIG.exec(String(values[i] == null ? '' : values[i]).trim());
      if (!m) continue;
      var a = +m[1], b = +m[2];
      if (a > 12) dayFirst += 1;
      else if (b > 12) monthFirst += 1;
    }
    if (dayFirst > monthFirst) return 'DMY';
    if (monthFirst > dayFirst) return 'MDY';
    return 'MDY';
  }

  var TRUE_WORDS = /^(true|yes|y|on)$/i;
  var FALSE_WORDS = /^(false|no|n|off)$/i;

  function parseBoolean(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (TRUE_WORDS.test(s)) return true;
    if (FALSE_WORDS.test(s)) return false;
    return null;
  }

  /* ======================================================================
     3. Dataset construction & column typing
     ====================================================================== */

  /** Heuristic: does the first row look like a header rather than data? */
  function looksLikeHeader(rows) {
    if (!rows || rows.length < 2) return rows && rows.length === 1;
    var head = rows[0];
    var body = rows.slice(1, Math.min(rows.length, 26));
    var headNumeric = 0, headFilled = 0;

    for (var i = 0; i < head.length; i++) {
      var cell = String(head[i] == null ? '' : head[i]).trim();
      if (!cell) continue;
      headFilled += 1;
      if (parseNumeric(cell) !== null) headNumeric += 1;
    }
    if (!headFilled) return false;
    if (headNumeric / headFilled > 0.5) return false;

    // If a column is numeric in the body but text in the header, that header is a label.
    var evidence = 0;
    for (var c = 0; c < head.length; c++) {
      var bodyNumeric = 0, bodyFilled = 0;
      for (var r = 0; r < body.length; r++) {
        var v = String(body[r][c] == null ? '' : body[r][c]).trim();
        if (!v) continue;
        bodyFilled += 1;
        if (parseNumeric(v) !== null) bodyNumeric += 1;
      }
      var headCell = String(head[c] == null ? '' : head[c]).trim();
      if (bodyFilled && bodyNumeric / bodyFilled > 0.8 && headCell && parseNumeric(headCell) === null) evidence += 1;
    }
    return evidence > 0 || headNumeric === 0;
  }

  function uniqueNames(names) {
    var seen = Object.create(null);
    return names.map(function (raw, index) {
      var base = String(raw == null ? '' : raw).trim() || ('Column ' + (index + 1));
      var name = base;
      var n = 2;
      while (Object.prototype.hasOwnProperty.call(seen, name.toLowerCase())) { name = base + ' (' + n + ')'; n += 1; }
      seen[name.toLowerCase()] = true;
      return name;
    });
  }

  /**
   * Turn a raw cell matrix into a typed dataset.
   * Rows are normalised to the same width; every column gets an inferred type
   * plus cached numeric / time projections so sorting and charting stay fast.
   */
  function buildDataset(matrix, hasHeader) {
    var rows = (matrix || []).filter(function (r) {
      if (!r || !r.length) return false;
      for (var i = 0; i < r.length; i++) if (String(r[i]).trim() !== '') return true;
      return false;
    });

    if (!rows.length) return { columns: [], rows: [], missing: 0, truncatedRows: 0 };

    var headerRow = hasHeader ? rows[0] : null;
    var body = hasHeader ? rows.slice(1) : rows.slice();

    var width = 0;
    for (var i = 0; i < rows.length; i++) width = Math.max(width, rows[i].length);

    var names = [];
    for (var c = 0; c < width; c++) {
      names.push(headerRow && headerRow[c] !== undefined && String(headerRow[c]).trim() !== ''
        ? String(headerRow[c]).trim()
        : 'Column ' + (c + 1));
    }
    names = uniqueNames(names);

    var normalised = body.map(function (r) {
      var out = new Array(width);
      for (var k = 0; k < width; k++) out[k] = r[k] === undefined || r[k] === null ? '' : String(r[k]);
      return out;
    });

    var missing = 0;
    var columns = [];

    for (var col = 0; col < width; col++) {
      var raw = new Array(normalised.length);
      for (var r2 = 0; r2 < normalised.length; r2++) raw[r2] = normalised[r2][col];

      var info = inferColumn(raw, names[col]);
      info.index = col;
      missing += info.emptyCount;
      columns.push(info);
    }

    return { columns: columns, rows: normalised, missing: missing };
  }

  function inferColumn(values, name) {
    var filled = 0, numeric = 0, dated = 0, boolish = 0, empty = 0;
    var unit = '';
    var order = detectDateOrder(values);
    var distinct = Object.create(null);
    var distinctCount = 0;

    for (var i = 0; i < values.length; i++) {
      var v = String(values[i] == null ? '' : values[i]).trim();
      if (!v) { empty += 1; continue; }
      filled += 1;

      if (distinctCount <= 60 && !Object.prototype.hasOwnProperty.call(distinct, v)) {
        distinct[v] = true; distinctCount += 1;
      }

      var n = parseNumeric(v);
      if (n) { numeric += 1; if (!unit && n.unit) unit = n.unit; continue; }
      if (parseDateValue(v, order) !== null) { dated += 1; continue; }
      if (parseBoolean(v) !== null) boolish += 1;
    }

    var type = 'string';
    if (!filled) type = 'empty';
    else if (numeric / filled >= 0.8) type = 'number';
    else if (dated / filled >= 0.8) type = 'date';
    else if (boolish / filled >= 0.95) type = 'boolean';

    var numbers = null, times = null;
    if (type === 'number') {
      numbers = new Array(values.length);
      for (var a = 0; a < values.length; a++) numbers[a] = numericValue(values[a]);
    } else if (type === 'date') {
      times = new Array(values.length);
      for (var b = 0; b < values.length; b++) times[b] = parseDateValue(values[b], order);
    }

    return {
      name: name,
      type: type,
      unit: unit,
      dateOrder: order,
      emptyCount: empty,
      filledCount: filled,
      distinctCount: distinctCount,
      numbers: numbers,
      times: times
    };
  }

  /* ======================================================================
     4. Filtering, searching, sorting, aggregation
     ====================================================================== */

  var OPERATORS = [
    { id: 'eq', label: 'equals' },
    { id: 'ne', label: 'not equals' },
    { id: 'gt', label: 'greater than' },
    { id: 'gte', label: 'greater or equal' },
    { id: 'lt', label: 'less than' },
    { id: 'lte', label: 'less or equal' },
    { id: 'contains', label: 'contains' },
    { id: 'ncontains', label: 'does not contain' },
    { id: 'starts', label: 'starts with' },
    { id: 'ends', label: 'ends with' },
    { id: 'empty', label: 'is empty' },
    { id: 'nempty', label: 'is not empty' }
  ];

  function cellFor(dataset, rowIndex, colIndex) {
    var row = dataset.rows[rowIndex];
    return row ? (row[colIndex] === undefined ? '' : row[colIndex]) : '';
  }

  function compareOne(dataset, rowIndex, filter) {
    var column = dataset.columns[filter.column];
    if (!column) return true;
    var raw = String(cellFor(dataset, rowIndex, filter.column)).trim();
    var op = filter.operator;

    if (op === 'empty') return raw === '';
    if (op === 'nempty') return raw !== '';

    var target = String(filter.value == null ? '' : filter.value).trim();

    if (op === 'contains' || op === 'ncontains' || op === 'starts' || op === 'ends') {
      var hay = raw.toLowerCase();
      var needle = target.toLowerCase();
      if (op === 'contains') return hay.indexOf(needle) !== -1;
      if (op === 'ncontains') return hay.indexOf(needle) === -1;
      if (op === 'starts') return hay.lastIndexOf(needle, 0) === 0;
      return needle === '' ? true : hay.indexOf(needle, hay.length - needle.length) !== -1;
    }

    var a = null, b = null;
    if (column.type === 'number') { a = numericValue(raw); b = numericValue(target); }
    else if (column.type === 'date') { a = parseDateValue(raw, column.dateOrder); b = parseDateValue(target, column.dateOrder); }

    if (a === null || b === null) {
      var la = raw.toLowerCase(), lb = target.toLowerCase();
      if (op === 'eq') return la === lb;
      if (op === 'ne') return la !== lb;
      var cmp = la < lb ? -1 : (la > lb ? 1 : 0);
      if (op === 'gt') return cmp > 0;
      if (op === 'gte') return cmp >= 0;
      if (op === 'lt') return cmp < 0;
      return cmp <= 0;
    }

    if (op === 'eq') return a === b;
    if (op === 'ne') return a !== b;
    if (op === 'gt') return a > b;
    if (op === 'gte') return a >= b;
    if (op === 'lt') return a < b;
    return a <= b;
  }

  /** Returns an array of row indices that survive the filters + search. */
  function filterRows(dataset, filters, search, searchColumns) {
    var out = [];
    var active = (filters || []).filter(function (f) {
      if (!f || f.column === null || f.column === undefined) return false;
      if (f.operator === 'empty' || f.operator === 'nempty') return true;
      return String(f.value == null ? '' : f.value) !== '';
    });
    var needle = String(search || '').trim().toLowerCase();
    var cols = searchColumns && searchColumns.length ? searchColumns : null;

    for (var i = 0; i < dataset.rows.length; i++) {
      var keep = true;
      for (var f = 0; f < active.length; f++) {
        if (!compareOne(dataset, i, active[f])) { keep = false; break; }
      }
      if (keep && needle) {
        keep = false;
        var row = dataset.rows[i];
        if (cols) {
          for (var c = 0; c < cols.length; c++) {
            if (String(row[cols[c]] || '').toLowerCase().indexOf(needle) !== -1) { keep = true; break; }
          }
        } else {
          for (var c2 = 0; c2 < row.length; c2++) {
            if (String(row[c2] || '').toLowerCase().indexOf(needle) !== -1) { keep = true; break; }
          }
        }
      }
      if (keep) out.push(i);
    }
    return out;
  }

  /** Type-aware sort of row indices — numbers sort numerically, dates chronologically. */
  function sortRowIndices(dataset, indices, colIndex, direction) {
    if (colIndex === null || colIndex === undefined || !dataset.columns[colIndex]) return indices.slice();
    var column = dataset.columns[colIndex];
    var sign = direction === 'desc' ? -1 : 1;
    var collator = typeof Intl !== 'undefined' && Intl.Collator
      ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
      : null;

    var decorated = indices.map(function (rowIndex) {
      var raw = String(cellFor(dataset, rowIndex, colIndex)).trim();
      var key = null;
      if (column.type === 'number') key = column.numbers ? column.numbers[rowIndex] : numericValue(raw);
      else if (column.type === 'date') key = column.times ? column.times[rowIndex] : parseDateValue(raw, column.dateOrder);
      return { rowIndex: rowIndex, raw: raw, key: key };
    });

    decorated.sort(function (a, b) {
      var aEmpty = a.raw === '';
      var bEmpty = b.raw === '';
      if (aEmpty && bEmpty) return a.rowIndex - b.rowIndex;
      if (aEmpty) return 1;   // blanks always sink, in both directions
      if (bEmpty) return -1;

      if (a.key !== null && a.key !== undefined && b.key !== null && b.key !== undefined) {
        if (a.key < b.key) return -1 * sign;
        if (a.key > b.key) return 1 * sign;
        return a.rowIndex - b.rowIndex;
      }
      var cmp = collator ? collator.compare(a.raw, b.raw) : (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0);
      if (cmp) return cmp * sign;
      return a.rowIndex - b.rowIndex;
    });

    return decorated.map(function (d) { return d.rowIndex; });
  }

  var AGGREGATIONS = [
    { id: 'none', label: 'None (row order)' },
    { id: 'sum', label: 'Sum' },
    { id: 'avg', label: 'Average' },
    { id: 'min', label: 'Minimum' },
    { id: 'max', label: 'Maximum' },
    { id: 'count', label: 'Count' }
  ];

  function aggregateValues(list, mode) {
    if (mode === 'count') return list.length;
    var nums = list.filter(function (v) { return v !== null && v !== undefined && isFinite(v); });
    if (!nums.length) return null;
    if (mode === 'sum') { var s = 0; for (var i = 0; i < nums.length; i++) s += nums[i]; return s; }
    if (mode === 'avg') { var t = 0; for (var j = 0; j < nums.length; j++) t += nums[j]; return t / nums.length; }
    if (mode === 'min') return Math.min.apply(null, nums);
    if (mode === 'max') return Math.max.apply(null, nums);
    return null;
  }

  /* ======================================================================
     5. Formatting
     ====================================================================== */

  function formatDate(t, granularity) {
    var d = new Date(t);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var day = d.getUTCDate();
    var mon = months[d.getUTCMonth()];
    var year = d.getUTCFullYear();
    if (granularity === 'year') return String(year);
    if (granularity === 'month') return mon + ' ' + year;
    return day + ' ' + mon + ' ' + year;
  }

  function formatNumber(value, unit) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    var abs = Math.abs(value);
    var decimals = abs >= 1000 ? 0 : (abs >= 1 ? 2 : 4);
    var body;
    try {
      body = value.toLocaleString(undefined, { maximumFractionDigits: decimals });
    } catch (err) {
      body = String(Math.round(value * 10000) / 10000);
    }
    if (unit === '%') return body + '%';
    if (unit) return unit + body;
    return body;
  }

  function formatCompact(value) {
    if (value === null || value === undefined || !isFinite(value)) return '';
    var abs = Math.abs(value);
    if (abs === 0) return '0';
    var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i++) {
      if (abs >= units[i][0]) {
        var scaled = value / units[i][0];
        var s = Math.abs(scaled) >= 100 ? scaled.toFixed(0) : scaled.toFixed(Math.abs(scaled) >= 10 ? 1 : 2);
        return s.replace(/\.?0+$/, '') + units[i][1];
      }
    }
    if (abs < 0.001) return value.toExponential(1);
    var fixed = abs >= 100 ? value.toFixed(0) : (abs >= 1 ? value.toFixed(2) : value.toFixed(3));
    return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  /* ======================================================================
     6. Palettes
     ====================================================================== */

  var PALETTES = {
    default: ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0284c7', '#65a30d', '#db2777', '#0f766e'],
    ocean: ['#0e7490', '#0284c7', '#06b6d4', '#3b82f6', '#14b8a6', '#1d4ed8', '#22d3ee', '#155e75', '#60a5fa', '#5eead4'],
    sunset: ['#c2410c', '#ea580c', '#f59e0b', '#dc2626', '#be123c', '#f97316', '#9f1239', '#fbbf24', '#7c2d12', '#fb7185'],
    forest: ['#166534', '#15803d', '#4d7c0f', '#0f766e', '#65a30d', '#047857', '#84cc16', '#14532d', '#10b981', '#3f6212'],
    monochrome: ['#111827', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#1f2937', '#d1d5db', '#52525b', '#a1a1aa', '#e5e7eb'],
    professional: ['#1f4e79', '#2e75b6', '#548235', '#bf8f00', '#7030a0', '#833c00', '#c00000', '#404040', '#2f5597', '#375623'],
    neon: ['#c026d3', '#0ea5e9', '#84cc16', '#f59e0b', '#f43f5e', '#6366f1', '#10b981', '#ec4899', '#22d3ee', '#a3e635']
  };

  var PALETTE_LABELS = {
    default: 'Default', ocean: 'Ocean', sunset: 'Sunset', forest: 'Forest',
    monochrome: 'Monochrome', professional: 'Professional', neon: 'Neon'
  };

  function paletteColors(name, isDark) {
    var list = PALETTES[name] || PALETTES.default;
    if (name === 'monochrome' && isDark) return list.slice().reverse();
    return list;
  }

  /* Dash patterns give every series a second, non-colour cue on line charts. */
  var DASHES = ['', '6 4', '2 3', '10 4 2 4', '4 3 1 3', '12 5'];
  var MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'star'];

  /* ======================================================================
     7. Chart types metadata
     ====================================================================== */

  var CHART_TYPES = [
    { id: 'line', label: 'Line', family: 'cartesian' },
    { id: 'area', label: 'Area', family: 'cartesian' },
    { id: 'bar', label: 'Bar', family: 'cartesian' },
    { id: 'hbar', label: 'Horizontal Bar', family: 'cartesian' },
    { id: 'stackedBar', label: 'Stacked Bar', family: 'cartesian' },
    { id: 'stackedArea', label: 'Stacked Area', family: 'cartesian' },
    { id: 'pie', label: 'Pie', family: 'radial' },
    { id: 'doughnut', label: 'Doughnut', family: 'radial' },
    { id: 'scatter', label: 'Scatter', family: 'scatter' },
    { id: 'radar', label: 'Radar', family: 'radar' }
  ];

  function chartTypeInfo(id) {
    for (var i = 0; i < CHART_TYPES.length; i++) if (CHART_TYPES[i].id === id) return CHART_TYPES[i];
    return CHART_TYPES[0];
  }

  /* ======================================================================
     8. Scales & geometry helpers
     ====================================================================== */

  function niceScale(min, max, targetTicks) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) {
      if (min === 0) { min = 0; max = 1; }
      else { var pad = Math.abs(min) * 0.15; min -= pad; max += pad; }
    }
    var span = max - min;
    var rough = span / Math.max(2, targetTicks || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    var step;
    if (norm <= 1) step = 1;
    else if (norm <= 2) step = 2;
    else if (norm <= 2.5) step = 2.5;
    else if (norm <= 5) step = 5;
    else step = 10;
    step *= mag;

    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    var guard = 0;
    for (var v = lo; v <= hi + step * 1e-9 && guard < 200; v += step, guard++) {
      ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toFixed(12)));
    }
    return { min: lo, max: hi, step: step, ticks: ticks };
  }

  function measureText(str, fontSize) {
    return String(str == null ? '' : str).length * fontSize * 0.56;
  }

  function markerPath(kind, cx, cy, r) {
    switch (kind) {
      case 'square': return 'M' + (cx - r) + ' ' + (cy - r) + 'h' + (r * 2) + 'v' + (r * 2) + 'h' + (-r * 2) + 'Z';
      case 'triangle': return 'M' + cx + ' ' + (cy - r * 1.15) + 'L' + (cx + r) + ' ' + (cy + r * 0.85) + 'L' + (cx - r) + ' ' + (cy + r * 0.85) + 'Z';
      case 'diamond': return 'M' + cx + ' ' + (cy - r * 1.2) + 'L' + (cx + r * 1.2) + ' ' + cy + 'L' + cx + ' ' + (cy + r * 1.2) + 'L' + (cx - r * 1.2) + ' ' + cy + 'Z';
      case 'cross': return 'M' + (cx - r) + ' ' + (cy - r) + 'L' + (cx + r) + ' ' + (cy + r) + 'M' + (cx + r) + ' ' + (cy - r) + 'L' + (cx - r) + ' ' + (cy + r);
      case 'star': {
        var pts = [];
        for (var i = 0; i < 10; i++) {
          var ang = -Math.PI / 2 + (Math.PI / 5) * i;
          var rad = i % 2 === 0 ? r * 1.25 : r * 0.55;
          pts.push((cx + Math.cos(ang) * rad).toFixed(2) + ' ' + (cy + Math.sin(ang) * rad).toFixed(2));
        }
        return 'M' + pts.join('L') + 'Z';
      }
      default: return 'M' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + (r * 2) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-r * 2) + ' 0Z';
    }
  }

  /** Smoothed path through points using a clamped cardinal spline. */
  function smoothPath(points) {
    if (points.length < 2) return points.length ? 'M' + points[0][0] + ' ' + points[0][1] : '';
    var d = 'M' + points[0][0] + ' ' + points[0][1];
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[i - 1] || points[i];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6;
      var c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6;
      var c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ',' + c2x.toFixed(2) + ' ' + c2y.toFixed(2) + ',' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
    }
    return d;
  }

  function hexToRgba(hex, alpha) {
    var h = String(hex || '').trim();
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return 'rgba(99,102,241,' + alpha + ')';
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* ======================================================================
     9. The chart renderer
     ====================================================================== */

  var DEFAULT_OPTIONS = {
    legend: true,
    legendPosition: 'bottom',
    gridX: true,
    gridY: true,
    tooltips: true,
    zoom: true,
    lineWidth: 2.5,
    pointSize: 3.5,
    fillOpacity: 0.18,
    barRadius: 6,
    curve: 'smooth',
    showLabels: true,
    showPercent: true,
    sliceGap: 2,
    innerRatio: 0.58,
    height: 460,
    markers: true
  };

  var DEFAULT_THEME = {
    background: '#ffffff',
    text: '#111827',
    muted: '#6b7280',
    grid: 'rgba(17,24,39,.10)',
    axis: 'rgba(17,24,39,.28)',
    font: '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif'
  };

  function CSVChartRenderer(container) {
    this.container = container;
    this.spec = null;
    this.svg = null;
    this.view = null;
    this.hoverIndex = null;
    this.onLegendToggle = null;
    this._raf = 0;
    this._pointer = null;
    this._destroyed = false;

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'cvz-tip';
    this.tooltip.setAttribute('role', 'presentation');
    this.tooltip.hidden = true;
    this.container.appendChild(this.tooltip);

    this._onResize = this._onResize.bind(this);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.container);
    } else {
      global.addEventListener('resize', this._onResize);
    }
  }

  CSVChartRenderer.prototype._onResize = function () {
    if (this._destroyed || !this.spec) return;
    var self = this;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(function () { self._raf = 0; self.draw(); });
  };

  CSVChartRenderer.prototype.update = function (spec) {
    var typeChanged = !this.spec || this.spec.type !== spec.type;
    var shapeChanged = !this.spec ||
      this.spec.categories.length !== spec.categories.length ||
      this.spec.series.length !== spec.series.length;
    this.spec = spec;
    if (typeChanged || shapeChanged) this.view = null;
    this.draw();
  };

  CSVChartRenderer.prototype.destroy = function () {
    this._destroyed = true;
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    else global.removeEventListener('resize', this._onResize);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._detachPointer();
    if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
    if (this.tooltip && this.tooltip.parentNode) this.tooltip.parentNode.removeChild(this.tooltip);
    this.svg = null;
    this.spec = null;
  };

  CSVChartRenderer.prototype.resetZoom = function () {
    this.view = null;
    this.draw();
  };

  CSVChartRenderer.prototype.hasZoom = function () {
    return !!this.view;
  };

  CSVChartRenderer.prototype.zoomBy = function (factor) {
    var spec = this.spec;
    if (!spec) return;
    var info = chartTypeInfo(spec.type);
    if (info.family === 'radial' || info.family === 'radar') return;

    if (info.family === 'scatter') {
      var b = this.view || this._scatterBounds();
      if (!b) return;
      var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      var hw = (b.x1 - b.x0) / 2 / factor, hh = (b.y1 - b.y0) / 2 / factor;
      this.view = { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
    } else {
      var n = spec.categories.length;
      if (!n) return;
      var v = this.view || { i0: 0, i1: n - 1 };
      var mid = (v.i0 + v.i1) / 2;
      var half = (v.i1 - v.i0) / 2 / factor;
      if (half < 0.5) half = 0.5;
      var i0 = clamp(mid - half, 0, n - 1);
      var i1 = clamp(mid + half, 0, n - 1);
      if (i1 - i0 >= n - 1.0001) this.view = null;
      else this.view = { i0: i0, i1: i1 };
    }
    this.draw();
  };

  CSVChartRenderer.prototype._scatterBounds = function () {
    var spec = this.spec;
    var xs = [], ys = [];
    for (var s = 0; s < spec.series.length; s++) {
      if (spec.series[s].hidden) continue;
      var pts = spec.series[s].points || [];
      for (var p = 0; p < pts.length; p++) { xs.push(pts[p].x); ys.push(pts[p].y); }
    }
    if (!xs.length) return null;
    return { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
  };

  CSVChartRenderer.prototype.getSVGString = function () {
    if (!this.svg) return '';
    var clone = this.svg.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('xmlns:xlink', XLINK_NS);
    // Interaction-only layers never belong in an exported file.
    var strip = clone.querySelectorAll('[data-export="skip"]');
    for (var i = 0; i < strip.length; i++) strip[i].parentNode.removeChild(strip[i]);
    var serialized = new XMLSerializer().serializeToString(clone);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + serialized;
  };

  CSVChartRenderer.prototype.toPNGBlob = function (scale) {
    var svgString = this.getSVGString();
    var width = this._width || 900;
    var height = this._height || 460;
    var ratio = Math.max(1, Math.min(4, scale || 2));
    var background = (this.spec && this.spec.theme && this.spec.theme.background) || '#ffffff';

    return new Promise(function (resolve, reject) {
      var blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          if (canvas.toBlob) canvas.toBlob(function (out) { out ? resolve(out) : reject(new Error('Canvas export failed.')); }, 'image/png');
          else reject(new Error('Canvas export is not supported in this browser.'));
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not rasterise the chart.')); };
      img.src = url;
    });
  };

  /* ---------------------------------------------------------------- draw */

  CSVChartRenderer.prototype.draw = function () {
    if (this._destroyed || !this.spec) return;

    // Wheel and drag change the view without going through the toolbar, so the
    // host is told about every view change rather than only the button ones.
    if (this.onViewChange) this.onViewChange(!!this.view);

    var spec = this.spec;
    var opts = spec.options;
    var theme = spec.theme;

    var width = Math.max(280, Math.floor(this.container.clientWidth || 640));
    var height = Math.max(240, Math.floor(opts.height || 460));
    this._width = width;
    this._height = height;

    this._detachPointer();
    if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);

    var svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: width,
      height: height,
      role: 'img',
      'aria-label': spec.ariaLabel || spec.title || 'Chart',
      preserveAspectRatio: 'xMidYMid meet',
      style: 'display:block;width:100%;height:' + height + 'px;touch-action:pan-y;'
    });
    this.svg = svg;

    text(el('title', null, svg), spec.title || 'Chart');
    text(el('desc', null, svg), spec.ariaLabel || '');
    el('rect', { x: 0, y: 0, width: width, height: height, fill: theme.background }, svg);

    var layout = { x: 14, y: 12, w: width - 28, h: height - 24, width: width, height: height };

    if (spec.title) {
      var titleNode = el('text', {
        x: width / 2, y: layout.y + 18, 'text-anchor': 'middle',
        'font-family': theme.font, 'font-size': 16, 'font-weight': 700, fill: theme.text
      }, svg);
      text(titleNode, spec.title);
      layout.y += 32;
      layout.h -= 32;
    }

    var visible = spec.series.filter(function (s) { return !s.hidden; });

    if (opts.legend && spec.series.length) {
      layout = this._drawLegend(svg, layout, spec, theme);
    }

    if (!visible.length || !spec.categories.length && chartTypeInfo(spec.type).family !== 'scatter') {
      this._drawEmpty(svg, layout, theme, spec.emptyMessage || 'Nothing to plot with the current selection.');
      this.container.insertBefore(svg, this.tooltip);
      return;
    }

    var family = chartTypeInfo(spec.type).family;
    if (family === 'radial') this._drawRadial(svg, layout, spec, theme);
    else if (family === 'radar') this._drawRadar(svg, layout, spec, theme);
    else if (family === 'scatter') this._drawScatter(svg, layout, spec, theme);
    else this._drawCartesian(svg, layout, spec, theme);

    this.container.insertBefore(svg, this.tooltip);
    this._attachPointer();
  };

  CSVChartRenderer.prototype._drawEmpty = function (svg, layout, theme, message) {
    var g = el('g', null, svg);
    var node = el('text', {
      x: layout.x + layout.w / 2, y: layout.y + layout.h / 2,
      'text-anchor': 'middle', 'font-family': theme.font, 'font-size': 14, fill: theme.muted
    }, g);
    text(node, message);
  };

  /* ------------------------------------------------------------- legend */

  CSVChartRenderer.prototype._drawLegend = function (svg, layout, spec, theme) {
    var opts = spec.options;
    var pos = opts.legendPosition || 'bottom';
    var fontSize = 12;
    var swatch = 11;
    var gap = 8;
    var rowH = 22;
    var self = this;

    var items = spec.series.map(function (s, i) {
      return { label: s.name, color: s.color, hidden: !!s.hidden, index: i, width: swatch + 6 + measureText(s.name, fontSize) + 18 };
    });

    var group = el('g', { 'data-layer': 'legend' }, svg);

    function drawItem(item, x, y) {
      var itemGroup = el('g', {
        transform: 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')',
        cursor: 'pointer',
        tabindex: '0',
        role: 'button',
        'aria-pressed': item.hidden ? 'false' : 'true',
        'aria-label': item.label + (item.hidden ? ' (hidden)' : ' (shown)') + ' — toggle series'
      }, group);

      el('rect', { x: -4, y: -rowH / 2, width: item.width, height: rowH, fill: 'transparent', rx: 5 }, itemGroup);
      el('rect', {
        x: 0, y: -swatch / 2, width: swatch, height: swatch, rx: 3,
        fill: item.hidden ? 'none' : item.color,
        stroke: item.color, 'stroke-width': 1.5, opacity: item.hidden ? 0.45 : 1
      }, itemGroup);

      var label = el('text', {
        x: swatch + 6, y: 4, 'font-family': theme.font, 'font-size': fontSize,
        'font-weight': 600, fill: item.hidden ? theme.muted : theme.text,
        'text-decoration': item.hidden ? 'line-through' : 'none'
      }, itemGroup);
      text(label, item.label);

      function toggle(ev) {
        ev.preventDefault();
        if (self.onLegendToggle) self.onLegendToggle(item.index);
      }
      itemGroup.addEventListener('click', toggle);
      itemGroup.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') toggle(ev);
      });
    }

    if (pos === 'left' || pos === 'right') {
      var colWidth = Math.min(190, Math.max.apply(null, items.map(function (i) { return i.width; })) + 8);
      var startY = layout.y + 14;
      var x = pos === 'left' ? layout.x + 4 : layout.x + layout.w - colWidth + 4;
      for (var i = 0; i < items.length; i++) {
        var y = startY + i * rowH;
        if (y > layout.y + layout.h - 6) break;
        drawItem(items[i], x, y);
      }
      if (pos === 'left') { layout.x += colWidth + 8; layout.w -= colWidth + 8; }
      else { layout.w -= colWidth + 8; }
      return layout;
    }

    // Horizontal legend — wrap into rows.
    var maxWidth = layout.w;
    var rows = [[]];
    var rowWidth = 0;
    for (var k = 0; k < items.length; k++) {
      var w = Math.min(items[k].width, maxWidth);
      if (rowWidth + w > maxWidth && rows[rows.length - 1].length) { rows.push([]); rowWidth = 0; }
      rows[rows.length - 1].push(items[k]);
      rowWidth += w;
    }
    var totalHeight = rows.length * rowH;
    var baseY = pos === 'top' ? layout.y + rowH / 2 : layout.y + layout.h - totalHeight + rowH / 2;

    for (var r = 0; r < rows.length; r++) {
      var rowItems = rows[r];
      var used = 0;
      for (var a = 0; a < rowItems.length; a++) used += Math.min(rowItems[a].width, maxWidth);
      var cursor = layout.x + (layout.w - used) / 2;
      for (var b = 0; b < rowItems.length; b++) {
        drawItem(rowItems[b], cursor, baseY + r * rowH);
        cursor += Math.min(rowItems[b].width, maxWidth);
      }
    }

    if (pos === 'top') { layout.y += totalHeight + 8; layout.h -= totalHeight + 8; }
    else { layout.h -= totalHeight + 8; }
    return layout;
  };

  /* ---------------------------------------------------------- cartesian */

  CSVChartRenderer.prototype._drawCartesian = function (svg, layout, spec, theme) {
    var opts = spec.options;
    var type = spec.type;
    var horizontal = type === 'hbar';
    var stacked = type === 'stackedBar' || type === 'stackedArea';
    var isBar = type === 'bar' || type === 'hbar' || type === 'stackedBar';
    var isArea = type === 'area' || type === 'stackedArea';
    var visible = spec.series.filter(function (s) { return !s.hidden; });
    var categories = spec.categories;
    var n = categories.length;

    var view = this.view;
    var i0 = view ? view.i0 : 0;
    var i1 = view ? view.i1 : n - 1;
    if (i1 <= i0) i1 = i0 + 0.001;

    /* value domain over the visible window */
    var lo = Infinity, hi = -Infinity;
    var from = Math.max(0, Math.floor(i0));
    var to = Math.min(n - 1, Math.ceil(i1));

    if (stacked) {
      for (var c = from; c <= to; c++) {
        var posSum = 0, negSum = 0;
        for (var s = 0; s < visible.length; s++) {
          var v = visible[s].values[c];
          if (v === null || v === undefined || !isFinite(v)) continue;
          if (v >= 0) posSum += v; else negSum += v;
        }
        if (posSum > hi) hi = posSum;
        if (negSum < lo) lo = negSum;
        if (posSum < lo) lo = Math.min(lo, 0);
      }
      if (lo === Infinity) lo = 0;
      if (hi === -Infinity) hi = 1;
      lo = Math.min(lo, 0);
    } else {
      for (var c2 = from; c2 <= to; c2++) {
        for (var s2 = 0; s2 < visible.length; s2++) {
          var v2 = visible[s2].values[c2];
          if (v2 === null || v2 === undefined || !isFinite(v2)) continue;
          if (v2 < lo) lo = v2;
          if (v2 > hi) hi = v2;
        }
      }
      if (lo === Infinity) { lo = 0; hi = 1; }
      if (isBar) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; }
      else if (lo === hi) { lo -= 1; hi += 1; }
    }

    var valueAxisLength = horizontal ? layout.w : layout.h;
    var scale = niceScale(lo, hi, Math.max(3, Math.round(valueAxisLength / 55)));

    /* margins */
    var fontSize = 11;
    var maxValueLabel = 0;
    for (var t = 0; t < scale.ticks.length; t++) {
      maxValueLabel = Math.max(maxValueLabel, measureText(formatCompact(scale.ticks[t]), fontSize));
    }

    var padLeft = horizontal ? 0 : maxValueLabel + 12;
    var padBottom = horizontal ? 26 : 0;

    // category labels
    var catLabels = categories.slice(from, to + 1);
    var longest = 0;
    for (var cl = 0; cl < catLabels.length; cl++) longest = Math.max(longest, measureText(catLabels[cl], fontSize));

    var rotate = false;
    if (horizontal) {
      padLeft = Math.min(160, longest + 14);
    } else {
      var bandGuess = (layout.w - padLeft - 12) / Math.max(1, (i1 - i0 + 1));
      rotate = longest > bandGuess * 0.92 && catLabels.length > 1;
      padBottom = rotate ? Math.min(96, longest * 0.72 + 20) : 26;
    }

    if (spec.yTitle) { if (horizontal) padBottom += 20; else padLeft += 18; }
    if (spec.xTitle) { if (horizontal) padLeft += 18; else padBottom += 20; }

    var plot = {
      x: layout.x + padLeft + 4,
      y: layout.y + 8,
      w: Math.max(40, layout.w - padLeft - 16),
      h: Math.max(40, layout.h - padBottom - 14)
    };
    this._plot = plot;

    var valueMin = scale.min, valueMax = scale.max;
    function valuePos(v) {
      var ratio = (v - valueMin) / (valueMax - valueMin || 1);
      return horizontal ? plot.x + ratio * plot.w : plot.y + plot.h - ratio * plot.h;
    }
    var band = (horizontal ? plot.h : plot.w) / Math.max(0.001, (i1 - i0 + 1));
    function catPos(i) {
      var offset = (i - i0 + 0.5) * band;
      return horizontal ? plot.y + offset : plot.x + offset;
    }
    this._geom = { plot: plot, i0: i0, i1: i1, band: band, horizontal: horizontal, catPos: catPos, valuePos: valuePos, n: n };

    /* grid + axes */
    var gridGroup = el('g', { 'data-layer': 'grid' }, svg);
    var valueGridOn = horizontal ? opts.gridX : opts.gridY;
    var catGridOn = horizontal ? opts.gridY : opts.gridX;

    for (var g = 0; g < scale.ticks.length; g++) {
      var pos = valuePos(scale.ticks[g]);
      if (valueGridOn) {
        el('line', horizontal
          ? { x1: pos, y1: plot.y, x2: pos, y2: plot.y + plot.h, stroke: theme.grid, 'stroke-width': 1 }
          : { x1: plot.x, y1: pos, x2: plot.x + plot.w, y2: pos, stroke: theme.grid, 'stroke-width': 1 }, gridGroup);
      }
      var label = el('text', horizontal
        ? { x: pos, y: plot.y + plot.h + 16, 'text-anchor': 'middle', 'font-family': theme.font, 'font-size': fontSize, fill: theme.muted }
        : { x: plot.x - 8, y: pos + 4, 'text-anchor': 'end', 'font-family': theme.font, 'font-size': fontSize, fill: theme.muted }, gridGroup);
      text(label, formatCompact(scale.ticks[g]));
    }

    /* zero line */
    if (valueMin < 0 && valueMax > 0) {
      var zp = valuePos(0);
      el('line', horizontal
        ? { x1: zp, y1: plot.y, x2: zp, y2: plot.y + plot.h, stroke: theme.axis, 'stroke-width': 1.25 }
        : { x1: plot.x, y1: zp, x2: plot.x + plot.w, y2: zp, stroke: theme.axis, 'stroke-width': 1.25 }, gridGroup);
    }

    /* category ticks */
    var stride = 1;
    if (!horizontal) {
      var perLabel = rotate ? 16 : longest + 14;
      stride = Math.max(1, Math.ceil((catLabels.length * perLabel) / Math.max(1, plot.w)));
    } else {
      stride = Math.max(1, Math.ceil((catLabels.length * 18) / Math.max(1, plot.h)));
    }

    for (var ci = from; ci <= to; ci++) {
      if ((ci - from) % stride !== 0) continue;
      var cp = catPos(ci);
      if (catGridOn) {
        el('line', horizontal
          ? { x1: plot.x, y1: cp, x2: plot.x + plot.w, y2: cp, stroke: theme.grid, 'stroke-width': 1, 'stroke-dasharray': '2 4' }
          : { x1: cp, y1: plot.y, x2: cp, y2: plot.y + plot.h, stroke: theme.grid, 'stroke-width': 1, 'stroke-dasharray': '2 4' }, gridGroup);
      }
      var raw = categories[ci];
      var shown = raw.length > 26 ? raw.slice(0, 24) + '…' : raw;
      var tickLabel;
      if (horizontal) {
        tickLabel = el('text', { x: plot.x - 8, y: cp + 4, 'text-anchor': 'end', 'font-family': theme.font, 'font-size': fontSize, fill: theme.muted }, gridGroup);
      } else if (rotate) {
        tickLabel = el('text', {
          x: cp, y: plot.y + plot.h + 14, 'text-anchor': 'end', 'font-family': theme.font,
          'font-size': fontSize, fill: theme.muted, transform: 'rotate(-42 ' + cp.toFixed(1) + ' ' + (plot.y + plot.h + 14).toFixed(1) + ')'
        }, gridGroup);
      } else {
        tickLabel = el('text', { x: cp, y: plot.y + plot.h + 17, 'text-anchor': 'middle', 'font-family': theme.font, 'font-size': fontSize, fill: theme.muted }, gridGroup);
      }
      text(tickLabel, shown);
    }

    /* axis lines */
    el('line', { x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: theme.axis, 'stroke-width': 1 }, gridGroup);
    el('line', { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, stroke: theme.axis, 'stroke-width': 1 }, gridGroup);

    /* axis titles */
    if (spec.xTitle) {
      var xt = el('text', {
        x: plot.x + plot.w / 2, y: layout.y + layout.h - 2, 'text-anchor': 'middle',
        'font-family': theme.font, 'font-size': 12, 'font-weight': 600, fill: theme.muted
      }, svg);
      text(xt, spec.xTitle);
    }
    if (spec.yTitle) {
      var yx = layout.x + 12;
      var yy = plot.y + plot.h / 2;
      var yt = el('text', {
        x: yx, y: yy, 'text-anchor': 'middle', 'font-family': theme.font, 'font-size': 12,
        'font-weight': 600, fill: theme.muted, transform: 'rotate(-90 ' + yx.toFixed(1) + ' ' + yy.toFixed(1) + ')'
      }, svg);
      text(yt, spec.yTitle);
    }

    /* clip the plotting surface so zoomed data never bleeds over the axes */
    var clipId = 'cvz-clip-' + Math.random().toString(36).slice(2, 9);
    var defs = el('defs', null, svg);
    var clip = el('clipPath', { id: clipId }, defs);
    el('rect', { x: plot.x, y: plot.y, width: plot.w, height: plot.h }, clip);

    var dataGroup = el('g', { 'clip-path': 'url(#' + clipId + ')' }, svg);

    /* ---- series ---- */
    if (isBar) {
      var groupCount = stacked ? 1 : visible.length;
      var innerPad = Math.min(0.28, 6 / Math.max(6, band));
      var slotWidth = (band * (1 - innerPad)) / Math.max(1, groupCount);
      var barSize = Math.max(1, slotWidth * (stacked ? 1 : 0.9));
      var stackPos = new Array(n), stackNeg = new Array(n);
      for (var z = 0; z < n; z++) { stackPos[z] = 0; stackNeg[z] = 0; }

      for (var si = 0; si < visible.length; si++) {
        var series = visible[si];
        var sg = el('g', { 'data-series': series.name }, dataGroup);
        for (var bi = from; bi <= to; bi++) {
          var val = series.values[bi];
          if (val === null || val === undefined || !isFinite(val)) continue;

          var base = 0, top = val;
          if (stacked) {
            if (val >= 0) { base = stackPos[bi]; top = base + val; stackPos[bi] = top; }
            else { base = stackNeg[bi]; top = base + val; stackNeg[bi] = top; }
          }

          var p1 = valuePos(base), p2 = valuePos(top);
          var center = catPos(bi);
          var offset = stacked ? 0 : (si - (groupCount - 1) / 2) * slotWidth;
          var r = Math.min(opts.barRadius, barSize / 2, Math.abs(p2 - p1) / 2);

          var attrs;
          if (horizontal) {
            attrs = {
              x: Math.min(p1, p2), y: center + offset - barSize / 2,
              width: Math.max(0.6, Math.abs(p2 - p1)), height: barSize, rx: r, ry: r
            };
          } else {
            attrs = {
              x: center + offset - barSize / 2, y: Math.min(p1, p2),
              width: barSize, height: Math.max(0.6, Math.abs(p2 - p1)), rx: r, ry: r
            };
          }
          attrs.fill = series.color;
          attrs.opacity = 0.94;
          el('rect', attrs, sg);
        }
      }
    } else {
      var stackAcc = new Array(n);
      for (var q = 0; q < n; q++) stackAcc[q] = 0;

      for (var li = 0; li < visible.length; li++) {
        var ls = visible[li];
        var lg = el('g', { 'data-series': ls.name }, dataGroup);
        var segments = [];
        var current = [];
        var baseline = [];

        for (var pi = from; pi <= to; pi++) {
          var pv = ls.values[pi];
          if (pv === null || pv === undefined || !isFinite(pv)) {
            if (current.length) { segments.push({ pts: current, base: baseline }); current = []; baseline = []; }
            continue;
          }
          var yValue = pv;
          var baseValue = 0;
          if (stacked) { baseValue = stackAcc[pi]; yValue = baseValue + pv; stackAcc[pi] = yValue; }
          current.push([catPos(pi), valuePos(yValue), pi, pv]);
          baseline.push([catPos(pi), valuePos(stacked ? baseValue : Math.max(valueMin, Math.min(0, valueMax)))]);
        }
        if (current.length) segments.push({ pts: current, base: baseline });

        for (var sgi = 0; sgi < segments.length; sgi++) {
          var seg = segments[sgi];
          var coords = seg.pts.map(function (p) { return [p[0], p[1]]; });
          var linePath = opts.curve === 'smooth' && coords.length > 2 ? smoothPath(coords)
            : 'M' + coords.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join('L');

          if (isArea && coords.length) {
            var backwards = seg.base.slice().reverse();
            var areaPath = linePath + 'L' + backwards.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join('L') + 'Z';
            el('path', { d: areaPath, fill: hexToRgba(ls.color, opts.fillOpacity), stroke: 'none' }, lg);
          }

          el('path', {
            d: linePath, fill: 'none', stroke: ls.color, 'stroke-width': opts.lineWidth,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            'stroke-dasharray': DASHES[li % DASHES.length] || null
          }, lg);

          if (opts.markers && opts.pointSize > 0 && coords.length <= 240) {
            var kind = MARKERS[li % MARKERS.length];
            for (var mi = 0; mi < coords.length; mi++) {
              el('path', {
                d: markerPath(kind, coords[mi][0], coords[mi][1], opts.pointSize),
                fill: kind === 'cross' ? 'none' : ls.color,
                stroke: kind === 'cross' ? ls.color : theme.background,
                'stroke-width': kind === 'cross' ? opts.lineWidth : 1.25
              }, lg);
            }
          }
        }
      }
    }

    /* hover guide */
    this._hoverLayer = el('g', { 'data-export': 'skip', 'data-layer': 'hover' }, svg);
  };

  /* ------------------------------------------------------------ scatter */

  CSVChartRenderer.prototype._drawScatter = function (svg, layout, spec, theme) {
    var opts = spec.options;
    var theme_ = theme;
    var visible = spec.series.filter(function (s) { return !s.hidden; });
    var bounds = this.view || this._scatterBounds();
    if (!bounds) { this._drawEmpty(svg, layout, theme, 'No numeric point pairs to plot.'); return; }

    var fontSize = 11;
    var xScale = niceScale(bounds.x0, bounds.x1, 6);
    var yScale = niceScale(bounds.y0, bounds.y1, 5);

    var maxYLabel = 0;
    for (var t = 0; t < yScale.ticks.length; t++) maxYLabel = Math.max(maxYLabel, measureText(formatCompact(yScale.ticks[t]), fontSize));

    var padLeft = maxYLabel + 14 + (spec.yTitle ? 18 : 0);
    var padBottom = 28 + (spec.xTitle ? 20 : 0);

    var plot = {
      x: layout.x + padLeft, y: layout.y + 8,
      w: Math.max(40, layout.w - padLeft - 16), h: Math.max(40, layout.h - padBottom - 14)
    };
    this._plot = plot;

    function px(v) { return plot.x + ((v - xScale.min) / (xScale.max - xScale.min || 1)) * plot.w; }
    function py(v) { return plot.y + plot.h - ((v - yScale.min) / (yScale.max - yScale.min || 1)) * plot.h; }
    this._geom = { plot: plot, scatter: true, px: px, py: py, xScale: xScale, yScale: yScale };

    var gridGroup = el('g', { 'data-layer': 'grid' }, svg);
    for (var yi = 0; yi < yScale.ticks.length; yi++) {
      var yp = py(yScale.ticks[yi]);
      if (opts.gridY) el('line', { x1: plot.x, y1: yp, x2: plot.x + plot.w, y2: yp, stroke: theme_.grid, 'stroke-width': 1 }, gridGroup);
      text(el('text', { x: plot.x - 8, y: yp + 4, 'text-anchor': 'end', 'font-family': theme_.font, 'font-size': fontSize, fill: theme_.muted }, gridGroup), formatCompact(yScale.ticks[yi]));
    }
    for (var xi = 0; xi < xScale.ticks.length; xi++) {
      var xp = px(xScale.ticks[xi]);
      if (opts.gridX) el('line', { x1: xp, y1: plot.y, x2: xp, y2: plot.y + plot.h, stroke: theme_.grid, 'stroke-width': 1 }, gridGroup);
      text(el('text', { x: xp, y: plot.y + plot.h + 17, 'text-anchor': 'middle', 'font-family': theme_.font, 'font-size': fontSize, fill: theme_.muted }, gridGroup), formatCompact(xScale.ticks[xi]));
    }

    el('line', { x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: theme_.axis, 'stroke-width': 1 }, gridGroup);
    el('line', { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, stroke: theme_.axis, 'stroke-width': 1 }, gridGroup);

    if (spec.xTitle) {
      text(el('text', { x: plot.x + plot.w / 2, y: layout.y + layout.h - 2, 'text-anchor': 'middle', 'font-family': theme_.font, 'font-size': 12, 'font-weight': 600, fill: theme_.muted }, svg), spec.xTitle);
    }
    if (spec.yTitle) {
      var yx = layout.x + 12, yy = plot.y + plot.h / 2;
      text(el('text', { x: yx, y: yy, 'text-anchor': 'middle', 'font-family': theme_.font, 'font-size': 12, 'font-weight': 600, fill: theme_.muted, transform: 'rotate(-90 ' + yx.toFixed(1) + ' ' + yy.toFixed(1) + ')' }, svg), spec.yTitle);
    }

    var clipId = 'cvz-clip-' + Math.random().toString(36).slice(2, 9);
    var defs = el('defs', null, svg);
    el('rect', { x: plot.x, y: plot.y, width: plot.w, height: plot.h }, el('clipPath', { id: clipId }, defs));
    var dataGroup = el('g', { 'clip-path': 'url(#' + clipId + ')' }, svg);

    for (var si = 0; si < visible.length; si++) {
      var series = visible[si];
      var g = el('g', { 'data-series': series.name }, dataGroup);
      var kind = MARKERS[spec.series.indexOf(series) % MARKERS.length];
      var pts = series.points || [];
      var radius = Math.max(2, opts.pointSize + 1);
      for (var p = 0; p < pts.length; p++) {
        el('path', {
          d: markerPath(kind, px(pts[p].x), py(pts[p].y), radius),
          fill: kind === 'cross' ? 'none' : hexToRgba(series.color, 0.82),
          stroke: series.color, 'stroke-width': 1.2
        }, g);
      }
    }

    this._hoverLayer = el('g', { 'data-export': 'skip', 'data-layer': 'hover' }, svg);
  };

  /* ------------------------------------------------------------- radial */

  CSVChartRenderer.prototype._drawRadial = function (svg, layout, spec, theme) {
    var opts = spec.options;
    var series = spec.series.filter(function (s) { return !s.hidden; })[0];
    if (!series) { this._drawEmpty(svg, layout, theme, 'Select one numeric series for this chart.'); return; }

    var slices = [];
    var total = 0;
    for (var i = 0; i < spec.categories.length; i++) {
      var v = series.values[i];
      if (v === null || v === undefined || !isFinite(v) || v <= 0) continue;
      slices.push({ label: spec.categories[i], value: v, color: spec.sliceColors[i % spec.sliceColors.length], index: i });
      total += v;
    }
    if (!slices.length || total <= 0) {
      this._drawEmpty(svg, layout, theme, 'Pie and doughnut charts need positive numeric values.');
      return;
    }

    var cx = layout.x + layout.w / 2;
    var cy = layout.y + layout.h / 2;
    var radius = Math.max(30, Math.min(layout.w, layout.h) / 2 - (opts.showLabels ? 34 : 12));
    var inner = spec.type === 'doughnut' ? radius * clamp(opts.innerRatio, 0.2, 0.85) : 0;
    var gapRad = (clamp(opts.sliceGap, 0, 12) / 100);

    this._geom = { radial: true, cx: cx, cy: cy, radius: radius, inner: inner, slices: slices, total: total };
    this._plot = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };

    var group = el('g', { 'data-layer': 'slices' }, svg);
    var angle = -Math.PI / 2;

    for (var s = 0; s < slices.length; s++) {
      var portion = slices[s].value / total;
      var sweep = portion * Math.PI * 2;
      var a0 = angle + (slices.length > 1 ? gapRad / 2 : 0);
      var a1 = angle + sweep - (slices.length > 1 ? gapRad / 2 : 0);
      if (a1 < a0) a1 = a0;
      slices[s].a0 = angle; slices[s].a1 = angle + sweep; slices[s].portion = portion;
      angle += sweep;

      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var x0 = cx + Math.cos(a0) * radius, y0 = cy + Math.sin(a0) * radius;
      var x1 = cx + Math.cos(a1) * radius, y1 = cy + Math.sin(a1) * radius;
      var d;
      if (inner > 0) {
        var ix1 = cx + Math.cos(a1) * inner, iy1 = cy + Math.sin(a1) * inner;
        var ix0 = cx + Math.cos(a0) * inner, iy0 = cy + Math.sin(a0) * inner;
        d = 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
          'A' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
          'L' + ix1.toFixed(2) + ' ' + iy1.toFixed(2) +
          'A' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + ix0.toFixed(2) + ' ' + iy0.toFixed(2) + 'Z';
      } else {
        d = 'M' + cx.toFixed(2) + ' ' + cy.toFixed(2) +
          'L' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
          'A' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + 'Z';
      }

      el('path', { d: d, fill: slices[s].color, stroke: theme.background, 'stroke-width': 1 }, group);

      if (opts.showLabels && portion > 0.035) {
        var mid = (slices[s].a0 + slices[s].a1) / 2;
        var lr = inner > 0 ? (inner + radius) / 2 : radius * 0.66;
        var lx = cx + Math.cos(mid) * lr;
        var ly = cy + Math.sin(mid) * lr;
        var labelText = opts.showPercent ? (portion * 100).toFixed(portion < 0.1 ? 1 : 0) + '%' : formatCompact(slices[s].value);
        var node = el('text', {
          x: lx, y: ly + 4, 'text-anchor': 'middle', 'font-family': theme.font,
          'font-size': 12, 'font-weight': 700, fill: '#ffffff',
          stroke: 'rgba(0,0,0,.32)', 'stroke-width': 2.6, 'paint-order': 'stroke'
        }, group);
        text(node, labelText);
      }
    }

    if (spec.type === 'doughnut' && inner > 26) {
      var centerTop = el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', 'font-family': theme.font, 'font-size': 18, 'font-weight': 700, fill: theme.text }, group);
      text(centerTop, formatCompact(total));
      var centerBottom = el('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', 'font-family': theme.font, 'font-size': 11, 'font-weight': 600, fill: theme.muted }, group);
      text(centerBottom, 'Total');
    }

    this._hoverLayer = el('g', { 'data-export': 'skip', 'data-layer': 'hover' }, svg);
  };

  /* -------------------------------------------------------------- radar */

  CSVChartRenderer.prototype._drawRadar = function (svg, layout, spec, theme) {
    var opts = spec.options;
    var visible = spec.series.filter(function (s) { return !s.hidden; });
    var categories = spec.categories;
    var n = categories.length;
    if (n < 3) { this._drawEmpty(svg, layout, theme, 'Radar charts need at least three categories.'); return; }

    var hi = -Infinity, lo = 0;
    for (var s = 0; s < visible.length; s++) {
      for (var i = 0; i < n; i++) {
        var v = visible[s].values[i];
        if (v === null || v === undefined || !isFinite(v)) continue;
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
    }
    if (hi === -Infinity) { this._drawEmpty(svg, layout, theme, 'No numeric values to plot.'); return; }
    var scale = niceScale(Math.min(0, lo), hi, 4);

    var cx = layout.x + layout.w / 2;
    var cy = layout.y + layout.h / 2;
    var radius = Math.max(30, Math.min(layout.w, layout.h) / 2 - 34);

    function point(i, value) {
      var ang = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      var r = ((value - scale.min) / (scale.max - scale.min || 1)) * radius;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    }

    var gridGroup = el('g', { 'data-layer': 'grid' }, svg);
    for (var ring = 1; ring <= 4; ring++) {
      var rr = (radius * ring) / 4;
      var pts = [];
      for (var k = 0; k < n; k++) {
        var a = -Math.PI / 2 + (Math.PI * 2 * k) / n;
        pts.push((cx + Math.cos(a) * rr).toFixed(2) + ',' + (cy + Math.sin(a) * rr).toFixed(2));
      }
      el('polygon', { points: pts.join(' '), fill: 'none', stroke: theme.grid, 'stroke-width': 1 }, gridGroup);
    }
    for (var ax = 0; ax < n; ax++) {
      var angle = -Math.PI / 2 + (Math.PI * 2 * ax) / n;
      el('line', { x1: cx, y1: cy, x2: cx + Math.cos(angle) * radius, y2: cy + Math.sin(angle) * radius, stroke: theme.grid, 'stroke-width': 1 }, gridGroup);
      var lx = cx + Math.cos(angle) * (radius + 16);
      var ly = cy + Math.sin(angle) * (radius + 16);
      var anchor = Math.abs(Math.cos(angle)) < 0.25 ? 'middle' : (Math.cos(angle) > 0 ? 'start' : 'end');
      var label = categories[ax].length > 14 ? categories[ax].slice(0, 13) + '…' : categories[ax];
      text(el('text', { x: lx, y: ly + 4, 'text-anchor': anchor, 'font-family': theme.font, 'font-size': 11, fill: theme.muted }, gridGroup), label);
    }

    var dataGroup = el('g', { 'data-layer': 'series' }, svg);
    for (var si = 0; si < visible.length; si++) {
      var series = visible[si];
      var poly = [];
      for (var pi = 0; pi < n; pi++) {
        var value = series.values[pi];
        if (value === null || value === undefined || !isFinite(value)) value = scale.min;
        var p = point(pi, value);
        poly.push(p[0].toFixed(2) + ',' + p[1].toFixed(2));
      }
      el('polygon', {
        points: poly.join(' '), fill: hexToRgba(series.color, Math.max(0.08, opts.fillOpacity)),
        stroke: series.color, 'stroke-width': opts.lineWidth, 'stroke-linejoin': 'round',
        'stroke-dasharray': DASHES[spec.series.indexOf(series) % DASHES.length] || null
      }, dataGroup);
    }

    this._geom = { radar: true, cx: cx, cy: cy, radius: radius, n: n };
    this._plot = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
    this._hoverLayer = el('g', { 'data-export': 'skip', 'data-layer': 'hover' }, svg);
  };

  /* --------------------------------------------------- pointer handling */

  CSVChartRenderer.prototype._detachPointer = function () {
    if (!this._pointer) return;
    var p = this._pointer;
    p.target.removeEventListener('pointermove', p.move);
    p.target.removeEventListener('pointerleave', p.leave);
    p.target.removeEventListener('pointerdown', p.down);
    p.target.removeEventListener('wheel', p.wheel);
    global.removeEventListener('pointermove', p.drag);
    global.removeEventListener('pointerup', p.up);
    this._pointer = null;
  };

  CSVChartRenderer.prototype._attachPointer = function () {
    var self = this;
    var svg = this.svg;
    if (!svg) return;
    var spec = this.spec;
    var family = chartTypeInfo(spec.type).family;
    var canZoom = spec.options.zoom && (family === 'cartesian' || family === 'scatter');

    function localPoint(ev) {
      var rect = svg.getBoundingClientRect();
      var scaleX = self._width / (rect.width || self._width);
      var scaleY = self._height / (rect.height || self._height);
      return { x: (ev.clientX - rect.left) * scaleX, y: (ev.clientY - rect.top) * scaleY };
    }

    var handlers = {
      target: svg,
      move: function (ev) {
        if (!spec.options.tooltips) return;
        self._showTooltip(localPoint(ev), ev);
      },
      leave: function () { self._hideTooltip(); },
      down: function (ev) {
        if (!canZoom || ev.button !== 0) return;
        if (ev.pointerType === 'touch') return; // leave touch scrolling alone
        var start = localPoint(ev);
        var plot = self._plot;
        if (!plot || start.x < plot.x || start.x > plot.x + plot.w || start.y < plot.y || start.y > plot.y + plot.h) return;
        handlers.dragState = { start: start, view: self.view ? JSON.parse(JSON.stringify(self.view)) : null, moved: false };
        svg.style.cursor = 'grabbing';
        ev.preventDefault();
      },
      drag: function (ev) {
        var st = handlers.dragState;
        if (!st) return;
        var now = localPoint(ev);
        var dx = now.x - st.start.x;
        var dy = now.y - st.start.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        st.moved = true;
        self._pan(dx, dy, st.view);
      },
      up: function () {
        if (!handlers.dragState) return;
        handlers.dragState = null;
        svg.style.cursor = '';
      },
      wheel: function (ev) {
        if (!canZoom) return;
        var plot = self._plot;
        var pt = localPoint(ev);
        if (!plot || pt.x < plot.x || pt.x > plot.x + plot.w || pt.y < plot.y || pt.y > plot.y + plot.h) return;
        ev.preventDefault();
        self._zoomAt(pt, ev.deltaY < 0 ? 1.22 : 1 / 1.22);
      },
      dragState: null
    };

    svg.addEventListener('pointermove', handlers.move);
    svg.addEventListener('pointerleave', handlers.leave);
    svg.addEventListener('pointerdown', handlers.down);
    svg.addEventListener('wheel', handlers.wheel, { passive: false });
    global.addEventListener('pointermove', handlers.drag);
    global.addEventListener('pointerup', handlers.up);
    this._pointer = handlers;
  };

  CSVChartRenderer.prototype._zoomAt = function (pt, factor) {
    var geom = this._geom;
    if (!geom) return;

    if (geom.scatter) {
      var b = this.view || this._scatterBounds();
      if (!b) return;
      var fx = (pt.x - geom.plot.x) / geom.plot.w;
      var fy = 1 - (pt.y - geom.plot.y) / geom.plot.h;
      var ax = b.x0 + (b.x1 - b.x0) * fx;
      var ay = b.y0 + (b.y1 - b.y0) * fy;
      this.view = {
        x0: ax - (ax - b.x0) / factor, x1: ax + (b.x1 - ax) / factor,
        y0: ay - (ay - b.y0) / factor, y1: ay + (b.y1 - ay) / factor
      };
      this.draw();
      return;
    }

    var n = geom.n;
    if (!n) return;
    var i0 = geom.i0, i1 = geom.i1;
    var frac = geom.horizontal
      ? (pt.y - geom.plot.y) / geom.plot.h
      : (pt.x - geom.plot.x) / geom.plot.w;
    var anchor = i0 + (i1 - i0) * clamp(frac, 0, 1);
    var newI0 = anchor - (anchor - i0) / factor;
    var newI1 = anchor + (i1 - anchor) / factor;
    if (newI1 - newI0 < 0.9) {
      var mid = (newI0 + newI1) / 2;
      newI0 = mid - 0.45; newI1 = mid + 0.45;
    }
    newI0 = clamp(newI0, 0, n - 1);
    newI1 = clamp(newI1, 0, n - 1);
    if (newI1 - newI0 >= n - 1.0001) this.view = null;
    else this.view = { i0: newI0, i1: newI1 };
    this.draw();
  };

  CSVChartRenderer.prototype._pan = function (dx, dy, baseView) {
    var geom = this._geom;
    if (!geom) return;

    if (geom.scatter) {
      var b = baseView || this._scatterBounds();
      if (!b) return;
      var spanX = b.x1 - b.x0, spanY = b.y1 - b.y0;
      var shiftX = -(dx / geom.plot.w) * spanX;
      var shiftY = (dy / geom.plot.h) * spanY;
      this.view = { x0: b.x0 + shiftX, x1: b.x1 + shiftX, y0: b.y0 + shiftY, y1: b.y1 + shiftY };
      this.draw();
      return;
    }

    var n = geom.n;
    var base = baseView || { i0: 0, i1: n - 1 };
    var span = base.i1 - base.i0;
    if (span >= n - 1.0001) return;
    var axisPixels = geom.horizontal ? geom.plot.h : geom.plot.w;
    var delta = geom.horizontal ? dy : dx;
    var shift = -(delta / axisPixels) * span;
    var i0 = base.i0 + shift;
    var i1 = base.i1 + shift;
    if (i0 < 0) { i1 -= i0; i0 = 0; }
    if (i1 > n - 1) { i0 -= (i1 - (n - 1)); i1 = n - 1; }
    this.view = { i0: Math.max(0, i0), i1: Math.min(n - 1, i1) };
    this.draw();
  };

  /* ------------------------------------------------------------ tooltip */

  CSVChartRenderer.prototype._hideTooltip = function () {
    this.tooltip.hidden = true;
    if (this._hoverLayer) while (this._hoverLayer.firstChild) this._hoverLayer.removeChild(this._hoverLayer.firstChild);
  };

  CSVChartRenderer.prototype._showTooltip = function (pt, ev) {
    var spec = this.spec;
    var geom = this._geom;
    if (!spec || !geom) return;
    var plot = this._plot;
    var theme = spec.theme;
    var rows = [];
    var heading = '';

    if (this._hoverLayer) while (this._hoverLayer.firstChild) this._hoverLayer.removeChild(this._hoverLayer.firstChild);

    if (geom.radial) {
      var dx = pt.x - geom.cx, dy = pt.y - geom.cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > geom.radius || dist < geom.inner) { this._hideTooltip(); return; }
      var ang = Math.atan2(dy, dx);
      if (ang < -Math.PI / 2) ang += Math.PI * 2;
      var hit = null;
      for (var i = 0; i < geom.slices.length; i++) {
        if (ang >= geom.slices[i].a0 && ang < geom.slices[i].a1) { hit = geom.slices[i]; break; }
      }
      if (!hit) { this._hideTooltip(); return; }
      heading = hit.label;
      rows.push({ color: hit.color, name: spec.series.filter(function (s) { return !s.hidden; })[0].name, value: formatNumber(hit.value, spec.valueUnit) + '  ·  ' + (hit.portion * 100).toFixed(1) + '%' });
    } else if (geom.scatter) {
      if (pt.x < plot.x || pt.x > plot.x + plot.w || pt.y < plot.y || pt.y > plot.y + plot.h) { this._hideTooltip(); return; }
      var best = null, bestDist = 24 * 24;
      var vis = spec.series.filter(function (s) { return !s.hidden; });
      for (var s = 0; s < vis.length; s++) {
        var pts = vis[s].points || [];
        for (var p = 0; p < pts.length; p++) {
          var sx = geom.px(pts[p].x), sy = geom.py(pts[p].y);
          var d2 = (sx - pt.x) * (sx - pt.x) + (sy - pt.y) * (sy - pt.y);
          if (d2 < bestDist) { bestDist = d2; best = { series: vis[s], point: pts[p], sx: sx, sy: sy }; }
        }
      }
      if (!best) { this._hideTooltip(); return; }
      heading = spec.xTitle ? spec.xTitle + ': ' + formatNumber(best.point.x, spec.xUnit) : formatNumber(best.point.x, spec.xUnit);
      rows.push({ color: best.series.color, name: best.series.name, value: formatNumber(best.point.y, spec.valueUnit) });
      if (best.point.label) heading = best.point.label + ' · ' + heading;
      el('circle', { cx: best.sx, cy: best.sy, r: 9, fill: 'none', stroke: best.series.color, 'stroke-width': 2 }, this._hoverLayer);
    } else if (geom.radar) {
      var rdx = pt.x - geom.cx, rdy = pt.y - geom.cy;
      if (Math.sqrt(rdx * rdx + rdy * rdy) > geom.radius + 12) { this._hideTooltip(); return; }
      var a = Math.atan2(rdy, rdx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      var idx = Math.round((a / (Math.PI * 2)) * geom.n) % geom.n;
      heading = spec.categories[idx];
      spec.series.forEach(function (series) {
        if (series.hidden) return;
        rows.push({ color: series.color, name: series.name, value: formatNumber(series.values[idx], spec.valueUnit) });
      });
    } else {
      if (pt.x < plot.x || pt.x > plot.x + plot.w || pt.y < plot.y || pt.y > plot.y + plot.h) { this._hideTooltip(); return; }
      var along = geom.horizontal ? (pt.y - plot.y) : (pt.x - plot.x);
      var index = Math.round(geom.i0 + along / geom.band - 0.5);
      index = clamp(index, Math.max(0, Math.floor(geom.i0)), Math.min(geom.n - 1, Math.ceil(geom.i1)));
      if (index < 0 || index >= spec.categories.length) { this._hideTooltip(); return; }
      heading = spec.categories[index];

      var guide = geom.catPos(index);
      el('line', geom.horizontal
        ? { x1: plot.x, y1: guide, x2: plot.x + plot.w, y2: guide, stroke: theme.axis, 'stroke-width': 1, 'stroke-dasharray': '3 3' }
        : { x1: guide, y1: plot.y, x2: guide, y2: plot.y + plot.h, stroke: theme.axis, 'stroke-width': 1, 'stroke-dasharray': '3 3' }, this._hoverLayer);

      for (var si = 0; si < spec.series.length; si++) {
        var series = spec.series[si];
        if (series.hidden) continue;
        var value = series.values[index];
        rows.push({ color: series.color, name: series.name, value: value === null || value === undefined ? 'No value' : formatNumber(value, spec.valueUnit) });
        if (value !== null && value !== undefined && isFinite(value) && spec.type !== 'stackedBar' && spec.type !== 'stackedArea') {
          var vp = geom.valuePos(value);
          el('circle', geom.horizontal
            ? { cx: vp, cy: guide, r: 4.5, fill: series.color, stroke: theme.background, 'stroke-width': 1.5 }
            : { cx: guide, cy: vp, r: 4.5, fill: series.color, stroke: theme.background, 'stroke-width': 1.5 }, this._hoverLayer);
        }
      }
    }

    if (!rows.length) { this._hideTooltip(); return; }

    /* Build the tooltip with DOM nodes — CSV content is never parsed as HTML. */
    var tip = this.tooltip;
    while (tip.firstChild) tip.removeChild(tip.firstChild);

    var head = document.createElement('div');
    head.className = 'cvz-tip__head';
    head.textContent = heading;
    tip.appendChild(head);

    for (var r = 0; r < rows.length; r++) {
      var line = document.createElement('div');
      line.className = 'cvz-tip__row';
      var dot = document.createElement('span');
      dot.className = 'cvz-tip__dot';
      dot.style.background = rows[r].color;
      var name = document.createElement('span');
      name.className = 'cvz-tip__name';
      name.textContent = rows[r].name;
      var val = document.createElement('span');
      val.className = 'cvz-tip__val';
      val.textContent = rows[r].value;
      line.appendChild(dot); line.appendChild(name); line.appendChild(val);
      tip.appendChild(line);
    }

    tip.hidden = false;
    var containerRect = this.container.getBoundingClientRect();
    var clientX = ev.clientX - containerRect.left;
    var clientY = ev.clientY - containerRect.top;
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var left = clientX + 16;
    if (left + tw > containerRect.width - 6) left = clientX - tw - 16;
    if (left < 6) left = 6;
    var top = clientY - th - 12;
    if (top < 4) top = clientY + 20;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };

  /* ======================================================================
     10. CSV writing (with spreadsheet formula-injection guard)
     ====================================================================== */

  function sanitizeForSpreadsheet(value) {
    var s = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  function csvEscape(value, delimiter, guard) {
    var s = guard ? sanitizeForSpreadsheet(value) : String(value === null || value === undefined ? '' : value);
    if (s.indexOf('"') !== -1 || s.indexOf(delimiter) !== -1 || /[\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function rowsToCSV(header, rows, delimiter, guard) {
    var d = delimiter || ',';
    var lines = [];
    if (header && header.length) {
      lines.push(header.map(function (h) { return csvEscape(h, d, guard); }).join(d));
    }
    for (var i = 0; i < rows.length; i++) {
      lines.push(rows[i].map(function (cell) { return csvEscape(cell, d, guard); }).join(d));
    }
    return lines.join('\r\n');
  }

  /* ======================================================================
     11. Export
     ====================================================================== */

  global.CSVChartEngine = {
    parseCSVText: parseCSVText,
    detectDelimiter: detectDelimiter,
    delimiterLabel: delimiterLabel,
    looksLikeHeader: looksLikeHeader,
    buildDataset: buildDataset,
    inferColumn: inferColumn,
    parseNumeric: parseNumeric,
    numericValue: numericValue,
    parseDateValue: parseDateValue,
    parseBoolean: parseBoolean,
    detectDateOrder: detectDateOrder,
    filterRows: filterRows,
    sortRowIndices: sortRowIndices,
    aggregateValues: aggregateValues,
    formatDate: formatDate,
    formatNumber: formatNumber,
    formatCompact: formatCompact,
    rowsToCSV: rowsToCSV,
    sanitizeForSpreadsheet: sanitizeForSpreadsheet,
    escapeHtml: escapeHtml,
    niceScale: niceScale,
    OPERATORS: OPERATORS,
    AGGREGATIONS: AGGREGATIONS,
    CHART_TYPES: CHART_TYPES,
    chartTypeInfo: chartTypeInfo,
    PALETTES: PALETTES,
    PALETTE_LABELS: PALETTE_LABELS,
    paletteColors: paletteColors,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    DEFAULT_THEME: DEFAULT_THEME,
    createRenderer: function (container) { return new CSVChartRenderer(container); }
  };

})(typeof window !== 'undefined' ? window : this);
