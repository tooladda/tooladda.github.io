/* ============================================================
   ToolAdda — JSON Formatter, Validator & Minifier

   WHAT WAS WRONG BEFORE
   ---------------------
   1. "Tree View" and "Raw" were labels the script never bound. The
      buttons were in the markup, looked clickable, and did nothing.

   2. "Remove Nulls" mutated the document inconsistently. Objects lost
      their null members; arrays kept theirs, because the array branch
      filtered on `undefined` rather than `null`:

          {a: null, b: 1}  ->  {b: 1}
          [1, null, 2]     ->  [1, null, 2]

      Silently rewriting a user's data is bad; doing it in only half
      the structure is worse, because the result looks intentional.

   3. "→ YAML" carried its own broken emitter. `typeof null` is
      'object', so a null value took the nested branch:

          {a: null}   ->   a:
                           null

      and an array of objects came out with mangled indentation:

          users:
            -     id: 1
              name: J

   4. Every failure path wrote "Error: ..." into the output textarea,
      which the Copy and Download buttons then treated as data.
      Download even fell back to the *input* when the output was
      empty, so a failed format saved the unformatted input as
      data.json.

   5. "Validate" overwrote the formatted output with the sentence
      "Valid JSON — type: Object", destroying the result you had just
      produced.

   6. Changing the indentation select did nothing until Format was
      pressed again.

   THE MODEL
   ---------
   One pipeline, one parse, one source of truth:

       text -> parse() -> data -> render(format | minify | tree)

   Everything the page shows — output, statistics, tree, sizes — is
   derived from that single parsed value. Failure states never write
   into the output, so nothing copyable is ever a lie.

   The YAML button is gone. A correct YAML emitter already exists on
   the dedicated JSON to YAML page; shipping a second, broken one here
   helped nobody.
   ============================================================ */

(function (globalScope) {
  'use strict';

  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  /* Beyond this, the tree renders collapsed and highlighting is
     skipped so a huge paste cannot lock the tab. */
  var LARGE_INPUT = 200000;

  /* ============================================================
     1. Locating a syntax error

     V8 puts the offset in some messages and not others; Safari words
     them differently again. This scanner walks the grammar and reports
     the first index it cannot accept, so line and column are available
     on every engine. Correctness still comes from JSON.parse.
     ============================================================ */

  function findErrorIndex(text) {
    var i = 0;
    var n = text.length;

    function ws() { while (i < n && ' \t\n\r'.indexOf(text.charAt(i)) !== -1) i += 1; }
    function fail() { throw i; }
    function lit(w) { return text.substr(i, w.length) === w; }

    function str() {
      i += 1;
      while (i < n) {
        var c = text.charAt(i);
        if (c === '\\') {
          i += 1;
          if (i >= n) fail();
          var e = text.charAt(i);
          if ('"\\/bfnrt'.indexOf(e) !== -1) { i += 1; continue; }
          if (e === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(text.substr(i + 1, 4))) fail();
            i += 5; continue;
          }
          fail();
        }
        if (c === '"') { i += 1; return; }
        if (c < ' ') fail();
        i += 1;
      }
      fail();
    }
    function num() {
      var m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/.exec(text.slice(i));
      if (!m || !m[0]) fail();
      i += m[0].length;
    }
    function obj() {
      i += 1; ws();
      if (text.charAt(i) === '}') { i += 1; return; }
      for (;;) {
        ws();
        if (text.charAt(i) !== '"') fail();
        str(); ws();
        if (text.charAt(i) !== ':') fail();
        i += 1; value(); ws();
        if (text.charAt(i) === ',') { i += 1; continue; }
        if (text.charAt(i) === '}') { i += 1; return; }
        fail();
      }
    }
    function arr() {
      i += 1; ws();
      if (text.charAt(i) === ']') { i += 1; return; }
      for (;;) {
        value(); ws();
        if (text.charAt(i) === ',') { i += 1; continue; }
        if (text.charAt(i) === ']') { i += 1; return; }
        fail();
      }
    }
    function value() {
      ws();
      if (i >= n) fail();
      var c = text.charAt(i);
      if (c === '{') return obj();
      if (c === '[') return arr();
      if (c === '"') return str();
      if (c === '-' || (c >= '0' && c <= '9')) return num();
      if (lit('true')) { i += 4; return; }
      if (lit('false')) { i += 5; return; }
      if (lit('null')) { i += 4; return; }
      fail();
    }

    try { value(); ws(); return i < n ? i : -1; }
    catch (idx) { return typeof idx === 'number' ? Math.min(idx, n) : -1; }
  }

  function locate(text, index) {
    var pos = Math.max(0, Math.min(index, text.length));
    var before = text.slice(0, pos);
    return {
      position: pos,
      line: before.split('\n').length,
      column: pos - (before.lastIndexOf('\n') + 1) + 1
    };
  }

  function positionFromError(message, text) {
    var m = /position (\d+)/i.exec(message || '');
    if (!m) return null;
    return locate(text, Number(m[1]));
  }

  function cleanReason(message) {
    return String(message || 'Invalid JSON')
      .replace(/^JSON\.parse:\s*/, '')
      .replace(/\s*in JSON at position \d+.*$/i, '')
      .replace(/\s*\(line \d+ column \d+\)\s*$/i, '')
      .replace(/,?\s*"[\s\S]*?"\s*is not valid JSON\s*$/i, '')
      .trim();
  }

  /* A corrective hint, but only where the cause is unambiguous from
     the text around the failure. Guessing would be worse than silence. */
  function hintFor(text, where) {
    if (!where) return '';
    var before = text.slice(0, where.position).replace(/\s+$/, '');
    var at = text.charAt(where.position);
    var last = before.charAt(before.length - 1);

    if ((at === '}' || at === ']') && last === ',') {
      return 'Standard JSON does not allow a trailing comma before ' + at + '.';
    }
    if (at === "'") return 'JSON strings must use double quotes, not single quotes.';
    if (at === '/' ) return 'JSON has no comments — remove the // or /* */ block.';
    if (/[A-Za-z_$]/.test(at) && last === '{') return 'Object keys must be wrapped in double quotes.';
    if (/[A-Za-z_$]/.test(at) && last === ',') return 'Object keys must be wrapped in double quotes.';
    if (at === '' ) return 'The document ends before every object or array was closed.';
    if (last === '"' && /["\d]/.test(at)) return 'A comma is probably missing between two values.';
    return '';
  }

  function parse(text) {
    var raw = String(text === undefined || text === null ? '' : text);
    if (!raw.trim()) return { ok: false, empty: true, message: 'Paste or type JSON to get started.' };

    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      var where = positionFromError(err.message, raw);
      if (!where) {
        var idx = findErrorIndex(raw);
        if (idx >= 0) where = locate(raw, idx);
      }
      var reason = cleanReason(err.message);
      var out = { ok: false, reason: reason };
      if (where) {
        out.line = where.line;
        out.column = where.column;
        out.position = where.position;
        out.excerpt = raw.split('\n')[where.line - 1] || '';
        out.hint = hintFor(raw, where);
        out.message = 'Invalid JSON: ' + reason + ' at line ' + where.line + ', column ' + where.column + '.';
      } else {
        out.message = 'Invalid JSON: ' + reason + '.';
      }
      return out;
    }
  }

  /* ============================================================
     2. Duplicate keys

     JSON.parse keeps the last occurrence and discards the rest, so by
     the time we have a value the earlier ones are gone. Detecting them
     needs a separate pass over the text. Nothing is removed — the
     duplicates are reported and the decision is left to the author.
     ============================================================ */

  function findDuplicateKeys(text) {
    var raw = String(text || '');
    var dupes = [];
    var i = 0;
    var n = raw.length;
    var stack = [];

    function readString() {
      var start = i;
      i += 1;
      var buf = '';
      while (i < n) {
        var c = raw.charAt(i);
        if (c === '\\') { buf += raw.charAt(i + 1); i += 2; continue; }
        if (c === '"') { i += 1; return buf; }
        buf += c; i += 1;
      }
      i = start + 1;
      return null;
    }

    while (i < n) {
      var c = raw.charAt(i);
      if (c === '"') {
        var startIdx = i;
        var s = readString();
        if (s === null) break;
        /* A string is a key only when the next non-space character is
           a colon and we are inside an object. */
        var j = i;
        while (j < n && ' \t\n\r'.indexOf(raw.charAt(j)) !== -1) j += 1;
        if (raw.charAt(j) === ':' && stack.length && stack[stack.length - 1].type === 'object') {
          var frame = stack[stack.length - 1];
          if (frame.keys[s]) {
            var loc = locate(raw, startIdx);
            dupes.push({ key: s, line: loc.line, column: loc.column });
          } else {
            frame.keys[s] = true;
          }
        }
        continue;
      }
      if (c === '{') { stack.push({ type: 'object', keys: {} }); i += 1; continue; }
      if (c === '[') { stack.push({ type: 'array' }); i += 1; continue; }
      if (c === '}' || c === ']') { stack.pop(); i += 1; continue; }
      i += 1;
    }
    return dupes;
  }

  /* ============================================================
     3. Rendering the data back out
     ============================================================ */

  function indentUnit(setting) {
    if (setting === 'tab' || setting === '\t') return '\t';
    var n = parseInt(setting, 10);
    return new Array((n === 4 ? 4 : 2) + 1).join(' ');
  }

  /* JSON.stringify already escapes everything it must. This only adds
     the optional \uXXXX form for non-ASCII, which changes the
     representation and not the text. */
  function escapeNonAscii(json) {
    return json.replace(/[\u0080-\uffff]/g, function (ch) {
      return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function format(data, options) {
    options = options || {};
    var value = options.sortKeys ? sortKeysDeep(data) : data;
    var out = JSON.stringify(value, null, indentUnit(options.indent));
    return options.escapeUnicode ? escapeNonAscii(out) : out;
  }

  function minify(data, options) {
    options = options || {};
    var value = options.sortKeys ? sortKeysDeep(data) : data;
    var out = JSON.stringify(value);
    return options.escapeUnicode ? escapeNonAscii(out) : out;
  }

  /* Sorting changes property order, which is why it is opt-in. */
  function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).sort().forEach(function (k) { out[k] = sortKeysDeep(value[k]); });
      return out;
    }
    return value;
  }

  /* ============================================================
     4. Statistics — counted from the parsed value, never estimated
     ============================================================ */

  function analyse(data) {
    var stats = { objects: 0, arrays: 0, keys: 0, values: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, depth: 0 };

    (function walk(v, depth) {
      if (depth > stats.depth) stats.depth = depth;
      if (Array.isArray(v)) {
        stats.arrays += 1;
        for (var i = 0; i < v.length; i += 1) walk(v[i], depth + 1);
        return;
      }
      if (v !== null && typeof v === 'object') {
        stats.objects += 1;
        var ks = Object.keys(v);
        stats.keys += ks.length;
        for (var j = 0; j < ks.length; j += 1) walk(v[ks[j]], depth + 1);
        return;
      }
      stats.values += 1;
      if (v === null) stats.nulls += 1;
      else if (typeof v === 'string') stats.strings += 1;
      else if (typeof v === 'number') stats.numbers += 1;
      else if (typeof v === 'boolean') stats.booleans += 1;
    }(data, 1));

    return stats;
  }

  function byteLength(text) {
    var s = String(text || '');
    try { return new Blob([s]).size; }
    catch (e) {
      /* Node and very old browsers: count UTF-8 bytes directly. */
      return unescape(encodeURIComponent(s)).length;
    }
  }

  function formatBytes(bytes) {
    var b = Number(bytes) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /* Minifying removes insignificant whitespace. It is not compression,
     and the wording used everywhere reflects that. */
  function sizeReport(inputText, formattedText, minifiedText) {
    var input = byteLength(inputText);
    var formatted = byteLength(formattedText);
    var minified = byteLength(minifiedText);
    var saved = Math.max(0, formatted - minified);
    return {
      input: input,
      formatted: formatted,
      minified: minified,
      saved: saved,
      savedPercent: formatted > 0 ? Math.round((saved / formatted) * 100) : 0
    };
  }

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  /* JSONPath-ish, and only the subset that is actually produced:
     $ for root, .key for identifier-safe keys, ["key"] otherwise,
     [n] for array indexes. */
  function joinPath(parentPath, key, isIndex) {
    if (isIndex) return parentPath + '[' + key + ']';
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return parentPath + '.' + key;
    return parentPath + '[' + JSON.stringify(key) + ']';
  }

  /* ============================================================
     5. Export
     ============================================================ */

  var engine = {
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    LARGE_INPUT: LARGE_INPUT,
    parse: parse,
    findErrorIndex: findErrorIndex,
    findDuplicateKeys: findDuplicateKeys,
    indentUnit: indentUnit,
    escapeNonAscii: escapeNonAscii,
    format: format,
    minify: minify,
    sortKeysDeep: sortKeysDeep,
    analyse: analyse,
    byteLength: byteLength,
    formatBytes: formatBytes,
    sizeReport: sizeReport,
    typeOf: typeOf,
    joinPath: joinPath
  };

  globalScope.ToolAddaJsonFormatter = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     6. UI
     ============================================================ */

  var SAMPLE = {
    name: 'ToolAdda',
    version: '1.0.0',
    description: 'Online developer tools',
    features: ['JSON Formatter', 'JSON Validator', 'JSON Minifier'],
    settings: { theme: 'dark', language: 'en', enabled: true }
  };

  var EXAMPLES = [
    { id: 'basic', name: 'Basic object', data: { name: 'John', age: 30, active: true } },
    { id: 'nested', name: 'Nested object', data: { user: { profile: { name: 'John', contact: { email: 'john@example.com' } } } } },
    { id: 'array', name: 'Array of objects', data: { users: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }] } },
    { id: 'api', name: 'API response', data: { status: 200, ok: true, data: { items: [{ id: 'a1', price: 19.99, tags: ['new'] }], total: 1 }, nextPage: null } },
    { id: 'product', name: 'Product data', data: { sku: 'TA-1024', title: 'Mechanical Keyboard', price: 7499.5, inStock: true, specs: { switches: 'brown', layout: '75%' }, images: [] } },
    { id: 'config', name: 'Configuration', data: { app: { name: 'checkout', port: 8080, debug: false }, cache: { driver: 'redis', ttlSeconds: 300 } } },
    { id: 'types', name: 'All data types', data: { integer: 42, decimal: 3.14, negative: -10, zero: 0, scientific: 1.5e10, string: 'text', boolean: true, nothing: null, object: {}, array: [] } },
    { id: 'unicode', name: 'Unicode & escapes', data: { hindi: 'नमस्ते दुनिया 🌍', chinese: '你好', arabic: 'مرحبا', url: 'https://example.com?a=1&b=2', quote: 'He said "Hello"', path: 'C:\\Users\\dev', multiline: 'line one\nline two' } }
  ];

  var state = {
    input: '',
    data: null,
    valid: false,
    output: '',
    view: 'code',
    indent: '2',
    sortKeys: false,
    escapeUnicode: false,
    liveValidate: true,
    lastAction: 'format',
    stats: null,
    duplicates: []
  };

  var dom = {};
  var runTimer = null;
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cacheDom() {
    dom.root = q('[data-jf-root]');
    if (!dom.root) return false;

    dom.input = q('#jfInput', dom.root);
    dom.gutter = q('[data-jf-gutter]', dom.root);
    dom.output = q('[data-jf-output]', dom.root);
    dom.tree = q('[data-jf-tree]', dom.root);
    dom.outputWrap = q('[data-jf-output-wrap]', dom.root);
    dom.treeWrap = q('[data-jf-tree-wrap]', dom.root);

    dom.viewButtons = qa('[data-jf-view]', dom.root);
    dom.format = q('[data-jf-format]', dom.root);
    dom.minifyBtn = q('[data-jf-minify]', dom.root);
    dom.validate = q('[data-jf-validate]', dom.root);
    dom.paste = q('[data-jf-paste]', dom.root);
    dom.clear = q('[data-jf-clear]', dom.root);
    dom.loadExample = q('[data-jf-load-example]', dom.root);
    dom.copy = q('[data-jf-copy]', dom.root);
    dom.copyMin = q('[data-jf-copy-min]', dom.root);
    dom.download = q('[data-jf-download]', dom.root);
    dom.expandAll = q('[data-jf-expand-all]', dom.root);
    dom.collapseAll = q('[data-jf-collapse-all]', dom.root);
    dom.filter = q('#jfFilter', dom.root);

    dom.indent = q('#jfIndent', dom.root);
    dom.sortKeys = q('#jfSortKeys', dom.root);
    dom.escapeUnicode = q('#jfEscapeUnicode', dom.root);
    dom.liveValidate = q('#jfLive', dom.root);

    dom.status = q('[data-jf-status]', dom.root);
    dom.error = q('[data-jf-error]', dom.root);
    dom.dupes = q('[data-jf-duplicates]', dom.root);
    dom.stats = q('[data-jf-stats]', dom.root);
    dom.inputMeta = q('[data-jf-input-meta]', dom.root);
    dom.outputMeta = q('[data-jf-output-meta]', dom.root);
    dom.pathOut = q('[data-jf-path]', dom.root);
    dom.examples = q('[data-jf-examples]', dom.root);
    dom.announce = q('[data-jf-announce]', dom.root);
    dom.drop = q('[data-jf-drop]', dom.root);
    dom.fileInput = q('#jfFile', dom.root);

    return true;
  }

  function announce(msg) {
    if (!dom.announce) return;
    dom.announce.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.announce.textContent = msg; }, 60);
  }

  function setStatus(kind, text) {
    if (!dom.status) return;
    dom.status.setAttribute('data-state', kind);
    dom.status.textContent = text;
  }

  function flash(btn, label) {
    if (!btn) return;
    var original = btn.getAttribute('data-jf-label') || btn.textContent;
    btn.setAttribute('data-jf-label', original);
    btn.textContent = label;
    setTimeout(function () { btn.textContent = original; }, 1500);
  }

  /* Single-pass tokeniser. Each slice is escaped as it is consumed, so
     no part of the document can ever reach the DOM as markup. */
  var TOKENS = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;

  function highlight(text) {
    var out = '';
    var last = 0;
    var m;
    TOKENS.lastIndex = 0;
    while ((m = TOKENS.exec(text)) !== null) {
      out += esc(text.slice(last, m.index));
      if (m[1] !== undefined) {
        var cls = m[2] ? 'tok-key' : 'tok-str';
        out += '<span class="' + cls + '">' + esc(m[1]) + '</span>' + (m[2] ? esc(m[2]) : '');
      } else if (m[3] !== undefined) {
        out += '<span class="' + (m[3] === 'null' ? 'tok-null' : 'tok-bool') + '">' + esc(m[3]) + '</span>';
      } else {
        out += '<span class="tok-num">' + esc(m[4]) + '</span>';
      }
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  function renderOutput() {
    if (!dom.output) return;
    if (!state.output) {
      dom.output.innerHTML = '<span class="jf-placeholder">Formatted JSON will appear here.</span>';
      return;
    }
    /* Skip highlighting for very large documents — the colours are not
       worth a multi-second paint. */
    if (state.output.length > LARGE_INPUT) {
      dom.output.textContent = state.output;
      return;
    }
    dom.output.innerHTML = highlight(state.output);
  }

  /* ---------- tree ---------- */

  function makeEl(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  /* Built with createElement and textContent throughout. A tree made
     by string concatenation is the easiest place on a page like this
     to introduce an injection. */
  function buildNode(key, value, path, isIndex, depth, autoCollapse) {
    var li = makeEl('li', 'jf-node');
    var type = typeOf(value);
    var isBranch = type === 'object' || type === 'array';

    var row = makeEl('div', 'jf-row');
    row.setAttribute('data-path', path);

    if (isBranch) {
      var count = type === 'array' ? value.length : Object.keys(value).length;
      var btn = makeEl('button', 'jf-twisty');
      btn.type = 'button';
      var open = depth < 2 && !autoCollapse && count > 0;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '▾' : '▸';

      var label = makeEl('span', 'jf-key', key === null ? '$' : String(key));
      var badge = makeEl('span', 'jf-type', type === 'array' ? 'array[' + count + ']' : 'object{' + count + '}');

      btn.appendChild(label);
      btn.appendChild(badge);
      row.appendChild(btn);
      li.appendChild(row);

      var ul = makeEl('ul', 'jf-children');
      ul.hidden = !open;
      if (count === 0) {
        ul.appendChild(makeEl('li', 'jf-empty', type === 'array' ? '(empty array)' : '(empty object)'));
      } else if (type === 'array') {
        for (var i = 0; i < value.length; i += 1) {
          ul.appendChild(buildNode(i, value[i], joinPath(path, i, true), true, depth + 1, autoCollapse));
        }
      } else {
        Object.keys(value).forEach(function (k) {
          ul.appendChild(buildNode(k, value[k], joinPath(path, k, false), false, depth + 1, autoCollapse));
        });
      }
      li.appendChild(ul);

      btn.addEventListener('click', function () {
        var nowOpen = ul.hidden;
        ul.hidden = !nowOpen;
        btn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        /* Setting textContent clears the button, so the label and the
           type badge are put back after the glyph is swapped. */
        btn.textContent = nowOpen ? '▾' : '▸';
        btn.appendChild(label);
        btn.appendChild(badge);
      });
      return li;
    }

    var leaf = makeEl('button', 'jf-leaf');
    leaf.type = 'button';
    leaf.appendChild(makeEl('span', 'jf-key', isIndex ? '[' + key + ']' : String(key)));
    leaf.appendChild(makeEl('span', 'jf-type', type));
    leaf.appendChild(makeEl('span', 'jf-val jf-val--' + type,
      type === 'string' ? JSON.stringify(value) : String(value)));
    leaf.addEventListener('click', function () { showPath(path, value, type); });
    row.appendChild(leaf);
    li.appendChild(row);
    return li;
  }

  function showPath(path, value, type) {
    if (!dom.pathOut) return;
    dom.pathOut.hidden = false;
    dom.pathOut.textContent = path + '  —  ' + type + '  —  ' +
      (type === 'string' ? JSON.stringify(value) : String(value));
    announce('Path ' + path);
  }

  function renderTree() {
    if (!dom.tree) return;
    dom.tree.textContent = '';
    if (!state.valid) {
      dom.tree.appendChild(makeEl('p', 'jf-placeholder', 'A tree appears once the JSON is valid.'));
      return;
    }
    /* Very large documents open collapsed so the first paint is cheap. */
    var autoCollapse = state.input.length > LARGE_INPUT;
    var ul = makeEl('ul', 'jf-tree-root');
    ul.appendChild(buildNode(null, state.data, '$', false, 0, autoCollapse));
    dom.tree.appendChild(ul);
    if (autoCollapse) {
      dom.tree.insertBefore(
        makeEl('p', 'jf-tree-note', 'Large document — branches start collapsed for speed.'),
        dom.tree.firstChild);
    }
  }

  function setAllExpanded(open) {
    if (!dom.tree) return;
    qa('.jf-children', dom.tree).forEach(function (ul) { ul.hidden = !open; });
    qa('.jf-twisty', dom.tree).forEach(function (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      var kids = Array.prototype.slice.call(btn.childNodes).filter(function (n) { return n.nodeType === 1; });
      btn.textContent = open ? '▾' : '▸';
      kids.forEach(function (k) { btn.appendChild(k); });
    });
    announce(open ? 'All branches expanded.' : 'All branches collapsed.');
  }

  function filterTree(term) {
    if (!dom.tree) return;
    var needle = String(term || '').trim().toLowerCase();
    var rows = qa('.jf-row', dom.tree);
    if (!needle) {
      rows.forEach(function (r) { r.classList.remove('is-dim', 'is-hit'); });
      return;
    }
    rows.forEach(function (r) {
      var hit = r.textContent.toLowerCase().indexOf(needle) !== -1;
      r.classList.toggle('is-hit', hit);
      r.classList.toggle('is-dim', !hit);
      if (hit) {
        /* Open every ancestor so the match is actually visible. */
        var p = r.parentNode;
        while (p && p !== dom.tree) {
          if (p.classList && p.classList.contains('jf-children')) p.hidden = false;
          p = p.parentNode;
        }
      }
    });
  }

  /* ---------- statistics ---------- */

  function statCell(label, value) {
    return '<div class="jf-stat"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function renderStats() {
    if (!dom.stats) return;
    if (!state.valid || !state.stats) { dom.stats.innerHTML = ''; dom.stats.hidden = true; return; }
    dom.stats.hidden = false;

    var s = state.stats;
    var sizes = sizeReport(state.input, format(state.data, { indent: state.indent }), minify(state.data, {}));

    dom.stats.innerHTML =
      statCell('Objects', s.objects) +
      statCell('Arrays', s.arrays) +
      statCell('Keys', s.keys) +
      statCell('Values', s.values) +
      statCell('Max depth', s.depth) +
      statCell('Input size', formatBytes(sizes.input)) +
      statCell('Formatted', formatBytes(sizes.formatted)) +
      statCell('Minified', formatBytes(sizes.minified)) +
      statCell('Size reduction after minification',
        formatBytes(sizes.saved) + ' (' + sizes.savedPercent + '%)');
  }

  function renderDuplicates() {
    if (!dom.dupes) return;
    if (!state.duplicates.length) { dom.dupes.hidden = true; dom.dupes.textContent = ''; return; }
    dom.dupes.hidden = false;
    var list = state.duplicates.slice(0, 10).map(function (d) {
      return '"' + esc(d.key) + '" (line ' + d.line + ')';
    }).join(', ');
    var more = state.duplicates.length > 10 ? ' and ' + (state.duplicates.length - 10) + ' more' : '';
    dom.dupes.innerHTML = '<strong>Duplicate key' + (state.duplicates.length > 1 ? 's' : '') +
      ' detected:</strong> ' + list + more +
      '. JSON parsers keep the last occurrence — nothing has been removed for you.';
  }

  function renderMeta() {
    if (dom.inputMeta) {
      var text = dom.input.value;
      dom.inputMeta.textContent = (text ? text.split('\n').length : 0) + ' lines · ' +
        text.length + ' chars · ' + formatBytes(byteLength(text));
    }
    if (dom.outputMeta) {
      dom.outputMeta.textContent = state.output
        ? (state.output.split('\n').length + ' lines · ' + formatBytes(byteLength(state.output)))
        : '—';
    }
    if (dom.gutter) {
      var n = Math.max(1, dom.input.value ? dom.input.value.split('\n').length : 1);
      var lines = [];
      for (var i = 1; i <= n; i += 1) lines.push(i);
      dom.gutter.textContent = lines.join('\n');
    }
  }

  function showError(result) {
    if (!dom.error) return;
    if (!result) {
      dom.error.hidden = true;
      dom.error.textContent = '';
      dom.input.removeAttribute('aria-invalid');
      return;
    }
    dom.input.setAttribute('aria-invalid', 'true');
    dom.error.hidden = false;

    var html = '<strong>⚠ ' + esc(result.message) + '</strong>';
    if (result.line) {
      html += '<span class="jf-error__where">Line ' + result.line + ', column ' + result.column + '</span>';
    }
    if (result.hint) html += '<span class="jf-error__hint">' + esc(result.hint) + '</span>';
    if (result.excerpt) {
      var caret = new Array(Math.max(1, result.column)).join(' ') + '^';
      html += '<pre class="jf-error__excerpt">' + esc(result.excerpt) + '\n' + esc(caret) + '</pre>';
    }
    dom.error.innerHTML = html;
  }

  function options() {
    return { indent: state.indent, sortKeys: state.sortKeys, escapeUnicode: state.escapeUnicode };
  }

  /* ---------- the single run ---------- */

  function run(opts) {
    opts = opts || {};
    state.input = dom.input.value;
    renderMeta();

    if (!state.input.trim()) {
      state.valid = false; state.data = null; state.output = '';
      state.stats = null; state.duplicates = [];
      showError(null); renderOutput(); renderTree(); renderStats(); renderDuplicates();
      setStatus('empty', 'Paste or type JSON to get started');
      return null;
    }

    var parsed = parse(state.input);

    if (!parsed.ok) {
      state.valid = false;
      /* The previous output stays. Replacing it with an error string
         is how the old build let people copy an error as data. */
      showError(parsed);
      setStatus('invalid', 'Invalid JSON');
      renderStats();
      if (opts.announce) announce(parsed.message);
      return null;
    }

    state.valid = true;
    state.data = parsed.value;
    state.stats = analyse(parsed.value);
    state.duplicates = findDuplicateKeys(state.input);

    state.output = state.lastAction === 'minify'
      ? minify(state.data, options())
      : format(state.data, options());

    showError(null);
    renderOutput();
    renderTree();
    renderStats();
    renderDuplicates();
    renderMeta();
    setStatus('valid', state.lastAction === 'minify' ? 'Minified successfully' : 'Valid JSON — formatted');

    if (opts.announce) {
      announce((state.lastAction === 'minify' ? 'Minified. ' : 'Formatted. ') +
        state.stats.keys + ' keys, max depth ' + state.stats.depth + '.');
    }
    return parsed;
  }

  function scheduleRun() {
    if (runTimer) clearTimeout(runTimer);
    if (!state.liveValidate) { renderMeta(); return; }
    var delay = dom.input.value.length > LARGE_INPUT ? 600 : 250;
    setStatus('working', 'Processing…');
    runTimer = setTimeout(function () { run(); }, delay);
  }

  function setInput(text, opts) {
    dom.input.value = text;
    run(opts || {});
  }

  function copy(text, btn, what) {
    if (!text) { announce('Nothing to copy yet.'); return; }
    function ok() { announce(what + ' copied to clipboard.'); flash(btn, 'Copied!'); }
    function bad() { announce('Could not copy. Select the text and copy manually.'); flash(btn, 'Copy failed'); }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, bad);
      return;
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var worked = document.execCommand('copy');
      document.body.removeChild(ta);
      if (worked) ok(); else bad();
    } catch (e) { bad(); }
  }

  function download(text, filename) {
    if (!text) { announce('Nothing to download yet.'); return; }
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    announce(filename + ' downloaded.');
  }

  function setView(view) {
    state.view = view === 'tree' ? 'tree' : 'code';
    dom.viewButtons.forEach(function (b) {
      var on = b.getAttribute('data-jf-view') === state.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (dom.outputWrap) dom.outputWrap.hidden = state.view !== 'code';
    if (dom.treeWrap) dom.treeWrap.hidden = state.view !== 'tree';
  }

  function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showError({ message: 'This file is too large to process efficiently in the browser (limit ' +
        Math.round(MAX_FILE_BYTES / 1048576) + ' MB).' });
      setStatus('invalid', 'File too large');
      announce('This file is too large to process efficiently in the browser.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { setInput(String(reader.result || ''), { announce: true }); };
    reader.onerror = function () {
      showError({ message: 'That file could not be read.' });
      setStatus('invalid', 'Could not read file');
    };
    reader.readAsText(file);
  }

  function renderExamples() {
    if (!dom.examples) return;
    dom.examples.innerHTML = EXAMPLES.map(function (e) {
      return '<button type="button" class="jf-chip" data-jf-example="' + esc(e.id) + '">' + esc(e.name) + '</button>';
    }).join('');
  }

  function bindEvents() {
    dom.input.addEventListener('input', scheduleRun);

    var tabTraps = true;
    dom.input.addEventListener('focus', function () { tabTraps = true; });
    dom.input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { tabTraps = false; announce('Tab will now move focus out of the editor.'); return; }
      if (e.key === 'Tab' && tabTraps && !e.shiftKey) {
        e.preventDefault();
        var s = dom.input.selectionStart, en = dom.input.selectionEnd;
        var unit = indentUnit(state.indent);
        dom.input.value = dom.input.value.slice(0, s) + unit + dom.input.value.slice(en);
        dom.input.selectionStart = dom.input.selectionEnd = s + unit.length;
        scheduleRun();
      }
    });

    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'Enter') { e.preventDefault(); state.lastAction = 'format'; run({ announce: true }); }
      else if (e.shiftKey && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); state.lastAction = 'minify'; run({ announce: true }); }
      else if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        if (!state.output) return;
        e.preventDefault(); copy(state.output, dom.copy, 'Output');
      }
    });

    if (dom.format) dom.format.addEventListener('click', function () { state.lastAction = 'format'; run({ announce: true }); });
    if (dom.minifyBtn) dom.minifyBtn.addEventListener('click', function () { state.lastAction = 'minify'; run({ announce: true }); });

    /* Validate reports; it must not overwrite the output the way the
       old build did. */
    if (dom.validate) {
      dom.validate.addEventListener('click', function () {
        var parsed = parse(dom.input.value);
        if (parsed.ok) {
          showError(null);
          setStatus('valid', 'Valid JSON');
          announce('Valid JSON. ' + (state.stats ? state.stats.keys + ' keys.' : ''));
        } else {
          showError(parsed);
          setStatus('invalid', 'Invalid JSON');
          announce(parsed.message);
        }
      });
    }

    if (dom.paste) {
      dom.paste.addEventListener('click', function () {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          announce('Your browser will not allow reading the clipboard. Use Ctrl+V in the editor.');
          return;
        }
        navigator.clipboard.readText().then(function (t) { setInput(t, { announce: true }); },
          function () { announce('Clipboard access was declined. Use Ctrl+V in the editor.'); });
      });
    }

    if (dom.clear) {
      dom.clear.addEventListener('click', function () {
        state.lastAction = 'format';
        setInput('', {});
        dom.input.focus();
        announce('Cleared.');
      });
    }
    if (dom.loadExample) {
      dom.loadExample.addEventListener('click', function () {
        state.lastAction = 'format';
        setInput(JSON.stringify(SAMPLE, null, 2), { announce: true });
      });
    }

    if (dom.copy) dom.copy.addEventListener('click', function () { copy(state.output, dom.copy, 'Output'); });
    if (dom.copyMin) {
      dom.copyMin.addEventListener('click', function () {
        if (!state.valid) { announce('Fix the JSON before copying a minified version.'); return; }
        copy(minify(state.data, options()), dom.copyMin, 'Minified JSON');
      });
    }
    if (dom.download) {
      dom.download.addEventListener('click', function () {
        /* Only ever the generated output — never a fallback to the
           raw input, which the old build downloaded as data.json. */
        download(state.output, state.lastAction === 'minify' ? 'minified.json' : 'formatted.json');
      });
    }

    dom.viewButtons.forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-jf-view')); });
    });
    if (dom.expandAll) dom.expandAll.addEventListener('click', function () { setAllExpanded(true); });
    if (dom.collapseAll) dom.collapseAll.addEventListener('click', function () { setAllExpanded(false); });
    if (dom.filter) {
      dom.filter.addEventListener('input', function () { filterTree(dom.filter.value); });
    }

    if (dom.indent) {
      dom.indent.addEventListener('change', function () {
        state.indent = dom.indent.value;
        run({ announce: true });
      });
    }
    if (dom.sortKeys) {
      dom.sortKeys.addEventListener('change', function () {
        state.sortKeys = dom.sortKeys.checked;
        run({ announce: true });
        announce(state.sortKeys ? 'Keys sorted alphabetically — this changes property order.' : 'Original key order restored.');
      });
    }
    if (dom.escapeUnicode) {
      dom.escapeUnicode.addEventListener('change', function () {
        state.escapeUnicode = dom.escapeUnicode.checked;
        run({ announce: true });
      });
    }
    if (dom.liveValidate) {
      dom.liveValidate.addEventListener('change', function () {
        state.liveValidate = dom.liveValidate.checked;
        if (state.liveValidate) run();
      });
    }

    if (dom.examples) {
      dom.examples.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-jf-example]');
        if (!b) return;
        var ex = EXAMPLES.filter(function (x) { return x.id === b.getAttribute('data-jf-example'); })[0];
        if (!ex) return;
        state.lastAction = 'format';
        setInput(JSON.stringify(ex.data, null, 2), { announce: true });
        announce(ex.name + ' example loaded.');
      });
    }

    if (dom.fileInput) {
      dom.fileInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
      });
    }
    if (dom.drop) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        dom.drop.addEventListener(ev, function (e) { e.preventDefault(); dom.drop.classList.add('is-dragging'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dom.drop.addEventListener(ev, function (e) { e.preventDefault(); dom.drop.classList.remove('is-dragging'); });
      });
      dom.drop.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
      });
    }
  }

  function init() {
    if (!cacheDom()) return;
    renderExamples();
    setView('code');
    if (dom.liveValidate) dom.liveValidate.checked = state.liveValidate;
    setInput(JSON.stringify(SAMPLE, null, 2), {});
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
