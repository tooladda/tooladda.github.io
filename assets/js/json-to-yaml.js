/* ============================================================
   ToolAdda — JSON ⇄ YAML Converter

   WHAT WAS WRONG BEFORE
   ---------------------
   The old emitter inlined every array after its key and indented
   nested items relative to the document root rather than to the
   sequence they belonged to:

       return value.map(item =>
         `${pad}- ${convertToYaml(item, indentLevel + 2).trimStart()}`
       ).join('\n');

   ...combined with a branch that only gave plain objects their own
   line, never arrays. The result was invalid YAML for every input
   containing a list:

       items: - "one"          <- sequence inlined after the key
       - "two"

       users: - id: 1          <- and its members left at column 0
         name: "John"
       - id: 2

       emptyObject:            <- empty collections broke the line
       {}

   Object keys were also written raw, so a key containing a colon
   silently produced a different document:

       {"a: b": 1}   ->   a: b: 1

   In short, the tool only worked for a flat object of scalars.

   THE MODEL
   ---------
   One pipeline, used by every button:

       text -> parseJson() -> plain JS data -> toYaml() -> text

   and in reverse mode:

       text -> parseYaml() -> plain JS data -> JSON.stringify() -> text

   The YAML parser is not written here. It is the block parser that
   already ships with the YAML to XML tool (assets/js/yaml-to-xml.js),
   which handles anchors, block scalars and flow collections. Reusing
   it keeps one parser in the repo instead of two, and keeps this page
   free of any third-party dependency.

   QUOTING — the part that makes YAML output correct rather than
   merely plausible. A plain YAML scalar is only safe when it cannot
   be re-read as something else. `123`, `true`, `null`, `~`, `on`,
   `2024-01-01` and anything beginning with an indicator character all
   have to be quoted, or a JSON string round-trips back as a number,
   a boolean or a date. Every scalar goes through needsQuoting()
   before it is written, keys included.
   ============================================================ */

(function (globalScope) {
  'use strict';

  var MAX_INPUT_BYTES = 5 * 1024 * 1024;   /* 5 MB — a browser tab limit, not a rule */

  /* ============================================================
     1. JSON parsing with a usable error position
     ============================================================ */

  /* V8, SpiderMonkey and JavaScriptCore all word their SyntaxError
     differently and only some include a line/column. Pull the byte
     offset out — every engine reports that — and derive the position
     ourselves so the message is identical everywhere. */
  function positionFromError(message, text) {
    var m = /position (\d+)/i.exec(message || '');
    if (!m) return null;
    var pos = Math.min(Number(m[1]), text.length);
    var before = text.slice(0, pos);
    var line = before.split('\n').length;
    var column = pos - (before.lastIndexOf('\n') + 1) + 1;
    return { position: pos, line: line, column: column };
  }

  /* V8 only includes a position in one of its two message shapes.
     `{"broken": }` yields `Unexpected token '}', "..." is not valid
     JSON` with no offset at all, and Safari words things differently
     again. So when the engine does not say where the problem is, find
     it here: a minimal scanner that walks the grammar and reports the
     first index it cannot accept. Correctness still comes from
     JSON.parse — this only locates the failure. */
  function findErrorIndex(text) {
    var i = 0;
    var n = text.length;

    function ws() { while (i < n && ' \t\n\r'.indexOf(text.charAt(i)) !== -1) i += 1; }
    function fail() { throw i; }
    function lit(word) { return text.substr(i, word.length) === word; }

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

    try {
      value(); ws();
      return i < n ? i : -1;
    } catch (idx) {
      return typeof idx === 'number' ? Math.min(idx, n) : -1;
    }
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

  function cleanErrorMessage(message) {
    return String(message || 'Invalid JSON')
      .replace(/^JSON\.parse:\s*/, '')
      .replace(/\s*in JSON at position \d+.*$/i, '')
      .replace(/\s*\(line \d+ column \d+\)\s*$/i, '')
      .trim();
  }

  function parseJson(text) {
    var raw = String(text === undefined || text === null ? '' : text);

    if (!raw.trim()) {
      return { ok: false, empty: true, message: 'Nothing to convert — paste some JSON first.' };
    }

    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      /* Prefer what the engine says; fall back to the scanner when it
         did not say anything, so the line and column are reported on
         every browser rather than only on some errors in V8. */
      var where = positionFromError(err.message, raw);
      if (!where) {
        var found = findErrorIndex(raw);
        if (found >= 0) where = locate(raw, found);
      }
      var reason = cleanErrorMessage(err.message);
      var result = { ok: false, reason: reason };

      if (where) {
        result.line = where.line;
        result.column = where.column;
        result.position = where.position;
        result.excerpt = raw.split('\n')[where.line - 1] || '';
        result.message = 'Invalid JSON: ' + reason +
          ' at line ' + where.line + ', column ' + where.column + '.';
      } else {
        result.message = 'Invalid JSON: ' + reason + '.';
      }
      return result;
    }
  }

  /* ============================================================
     2. YAML scalar safety
     ============================================================ */

  /* Anything YAML 1.1 would resolve to a non-string. A JSON string of
     "true" or "123" that is written plain comes back as a boolean or
     a number, which silently changes the data. */
  var RESERVED_WORDS = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;
  var NUMERIC = /^[-+]?(\d[\d_]*(\.[\d_]*)?|\.\d[\d_]*)([eE][-+]?\d+)?$/;
  var OCTAL_HEX = /^[-+]?0(x[0-9a-fA-F_]+|o?[0-7_]+|b[01_]+)$/;
  var SPECIAL_FLOAT = /^[-+]?(\.inf|\.Inf|\.INF|\.nan|\.NaN|\.NAN)$/;
  /* YAML 1.1 timestamps: 2024-01-01 and friends. */
  var DATE_LIKE = /^\d{4}-\d{1,2}(-\d{1,2}([Tt ].*)?)?$/;
  /* Sexagesimal, e.g. 1:30 — reads as 90 in YAML 1.1. */
  var SEXAGESIMAL = /^[-+]?\d[\d_]*(:[0-5]?\d)+(\.[\d_]*)?$/;
  var INDICATORS = '-?:,[]{}#&*!|>\'"%@`';

  function needsQuoting(str) {
    if (str === '') return true;
    if (RESERVED_WORDS.test(str)) return true;
    if (NUMERIC.test(str) || OCTAL_HEX.test(str) || SPECIAL_FLOAT.test(str)) return true;
    if (DATE_LIKE.test(str) || SEXAGESIMAL.test(str)) return true;

    /* Leading or trailing whitespace is invisible once written plain. */
    if (/^\s|\s$/.test(str)) return true;
    /* Newlines and control characters cannot appear in a plain scalar. */
    if (/[\n\r\t\u0000-\u001f\u007f]/.test(str)) return true;
    /* An indicator in first position changes what the line means. */
    if (INDICATORS.indexOf(str.charAt(0)) !== -1) return true;
    /* ": " starts a mapping and " #" starts a comment, anywhere. */
    if (str.indexOf(': ') !== -1 || str.indexOf(' #') !== -1) return true;
    /* A trailing colon would also read as a key. */
    if (/:$/.test(str)) return true;

    return false;
  }

  /* JSON's escape set is a strict subset of YAML's double-quoted
     escape set, so JSON.stringify produces a valid — and lossless —
     YAML double-quoted scalar. */
  function quote(str) {
    return JSON.stringify(str);
  }

  function formatScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';

    if (typeof value === 'number') {
      /* JSON.parse cannot produce NaN or Infinity, but a caller could
         hand us one; YAML has spellings for both. */
      if (!isFinite(value)) return value > 0 ? '.inf' : (value < 0 ? '-.inf' : '.nan');
      if (isNaN(value)) return '.nan';
      return String(value);
    }

    var str = String(value);
    return needsQuoting(str) ? quote(str) : str;
  }

  function formatKey(key) {
    var str = String(key);
    return needsQuoting(str) ? quote(str) : str;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }
  function isEmptyCollection(v) {
    if (Array.isArray(v)) return v.length === 0;
    if (isPlainObject(v)) return Object.keys(v).length === 0;
    return false;
  }
  function isCollection(v) {
    return Array.isArray(v) || isPlainObject(v);
  }

  /* ============================================================
     3. The emitter

     Every branch returns lines that are already indented to `level`.
     A sequence item borrows the first line of its child block: the
     child is rendered one step deeper, then its leading pad is
     swapped for "- ", which lands on exactly the same column. That is
     what the old version got wrong.
     ============================================================ */

  function toYaml(data, options) {
    options = options || {};
    var step = options.indent === 4 ? 4 : 2;

    /* A bare scalar or an empty document is a legal YAML document. */
    if (!isCollection(data)) return formatScalar(data) + '\n';
    if (isEmptyCollection(data)) return (Array.isArray(data) ? '[]' : '{}') + '\n';

    return emit(data, 0) + '\n';

    function pad(level) { return new Array(level + 1).join(' '); }

    function emit(value, level) {
      return Array.isArray(value) ? emitSeq(value, level) : emitMap(value, level);
    }

    function emitMap(obj, level) {
      var p = pad(level);
      var keys = Object.keys(obj);
      var out = [];

      for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        var v = obj[k];
        var head = p + formatKey(k) + ':';

        if (isCollection(v) && !isEmptyCollection(v)) {
          out.push(head);
          out.push(emit(v, level + step));
        } else if (isEmptyCollection(v)) {
          out.push(head + ' ' + (Array.isArray(v) ? '[]' : '{}'));
        } else {
          out.push(head + ' ' + formatScalar(v));
        }
      }
      return out.join('\n');
    }

    function emitSeq(arr, level) {
      var p = pad(level);
      var out = [];

      for (var i = 0; i < arr.length; i += 1) {
        var v = arr[i];

        if (isCollection(v) && !isEmptyCollection(v)) {
          /* The child is offset by the width of "- ", which is always
             two characters — NOT by the indent step. Using the step
             here put the first member at level+2 (behind the dash)
             while its siblings sat at level+4, which js-yaml rejects
             as "bad indentation of a mapping entry" at indent 4. */
          var DASH = 2;
          var block = emit(v, level + DASH);
          out.push(p + '- ' + block.slice(level + DASH));
        } else if (isEmptyCollection(v)) {
          out.push(p + '- ' + (Array.isArray(v) ? '[]' : '{}'));
        } else {
          out.push(p + '- ' + formatScalar(v));
        }
      }
      return out.join('\n');
    }
  }

  /* ============================================================
     4. Reverse direction — a real parser, never a regex
     ============================================================ */

  function yamlEngine() {
    return globalScope.YamlToXmlEngine ||
      (typeof module !== 'undefined' && module.exports ? tryRequireYaml() : null);
  }
  function tryRequireYaml() {
    try { return require('./yaml-to-xml.js'); } catch (e) { return null; }
  }

  function parseYaml(text) {
    var raw = String(text === undefined || text === null ? '' : text);
    if (!raw.trim()) {
      return { ok: false, empty: true, message: 'Nothing to convert — paste some YAML first.' };
    }

    var engine = yamlEngine();
    if (!engine) {
      return { ok: false, message: 'The YAML parser could not be loaded. Reload the page and try again.' };
    }

    try {
      var parsed = engine.parseYaml(raw);
      var resolved = engine.resolveAst(parsed.ast, parsed.anchors || {}, []);
      return { ok: true, value: engine.astToPlain(resolved) };
    } catch (err) {
      var line = err && err.line;
      return {
        ok: false,
        reason: String((err && err.message) || 'could not be parsed'),
        line: line,
        message: 'Invalid YAML: ' + String((err && err.message) || 'could not be parsed') +
          (line ? ' (line ' + line + ')' : '') + '.'
      };
    }
  }

  function toJson(data, options) {
    options = options || {};
    var step = options.indent === 4 ? 4 : 2;
    return JSON.stringify(data, null, options.minify ? 0 : step) + '\n';
  }

  /* ============================================================
     5. Convenience wrappers — every button routes through these
     ============================================================ */

  function jsonToYaml(text, options) {
    var parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    return { ok: true, output: toYaml(parsed.value, options), data: parsed.value };
  }

  function yamlToJson(text, options) {
    var parsed = parseYaml(text);
    if (!parsed.ok) return parsed;
    return { ok: true, output: toJson(parsed.value, options), data: parsed.value };
  }

  function formatJson(text, options) {
    var parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    return { ok: true, output: toJson(parsed.value, options) };
  }

  function minifyJson(text) {
    var parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    return { ok: true, output: JSON.stringify(parsed.value) };
  }

  function stats(text) {
    var raw = String(text || '');
    return {
      chars: raw.length,
      lines: raw ? raw.split('\n').length : 0,
      bytes: (function () {
        try { return new Blob([raw]).size; } catch (e) { return raw.length; }
      }())
    };
  }

  /* ============================================================
     6. Export
     ============================================================ */

  var engine = {
    MAX_INPUT_BYTES: MAX_INPUT_BYTES,
    parseJson: parseJson,
    parseYaml: parseYaml,
    needsQuoting: needsQuoting,
    formatScalar: formatScalar,
    formatKey: formatKey,
    toYaml: toYaml,
    toJson: toJson,
    jsonToYaml: jsonToYaml,
    yamlToJson: yamlToJson,
    formatJson: formatJson,
    minifyJson: minifyJson,
    stats: stats
  };

  globalScope.ToolAddaJsonYaml = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     7. UI
     ============================================================ */

  var SAMPLE = {
    name: 'ToolAdda',
    version: '1.0.0',
    description: 'Online developer tools',
    features: ['JSON Converter', 'YAML Converter', 'Formatters'],
    settings: { theme: 'dark', enabled: true }
  };

  var EXAMPLES = [
    { id: 'basic', name: 'Basic object', data: { name: 'John', age: 30, active: true } },
    { id: 'nested', name: 'Nested object', data: { server: { database: { connection: { host: 'localhost', port: 5432 } } } } },
    { id: 'arrays', name: 'Arrays', data: { languages: ['JavaScript', 'Python', 'PHP'], scores: [10, 20, 30] } },
    {
      id: 'api', name: 'API response',
      data: { status: 200, ok: true, data: { users: [{ id: 1, name: 'John', roles: ['admin'] }, { id: 2, name: 'Jane', roles: ['editor', 'reviewer'] }] }, nextPage: null }
    },
    {
      id: 'profile', name: 'User profile',
      data: { id: 'u_1024', displayName: 'Aarav Sharma', email: 'aarav@example.com', verified: true, tags: ['beta', 'india'], meta: { joined: '2024-03-11', locale: 'en-IN' } }
    },
    {
      id: 'config', name: 'App configuration',
      data: { app: { name: 'checkout', port: 8080, debug: false }, cache: { driver: 'redis', ttlSeconds: 300 }, featureFlags: { newCart: true, legacyCheckout: false } }
    },
    {
      id: 'compose', name: 'Container config',
      data: { version: '3.9', services: { web: { image: 'nginx:1.25', ports: ['80:80', '443:443'], environment: { NODE_ENV: 'production' } }, db: { image: 'postgres:16', volumes: ['pgdata:/var/lib/postgresql/data'] } } }
    },
    {
      id: 'package', name: 'Package metadata',
      data: { name: '@tooladda/utils', version: '2.4.1', private: false, scripts: { build: 'node build.js', test: 'node test.js' }, keywords: ['json', 'yaml', 'converter'] }
    },
    {
      id: 'env', name: 'Environment values',
      data: { NODE_ENV: 'production', PORT: '8080', DEBUG: 'false', API_URL: 'https://api.example.com?v=2&full=1', WELCOME: 'नमस्ते दुनिया 🌍', NOTE: 'key: value # not a comment' }
    }
  ];

  var state = {
    mode: 'json-to-yaml',
    input: '',
    output: '',
    liveConvert: true,
    indent: 2,
    status: 'ready'
  };

  var dom = {};
  var convertTimer = null;
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isJsonSource() { return state.mode === 'json-to-yaml'; }
  function sourceLang() { return isJsonSource() ? 'JSON' : 'YAML'; }
  function targetLang() { return isJsonSource() ? 'YAML' : 'JSON'; }

  function cacheDom() {
    dom.root = q('[data-jy-root]');
    if (!dom.root) return false;

    dom.modeButtons = qa('[data-jy-mode]', dom.root);
    dom.input = q('#jyInput', dom.root);
    dom.output = q('[data-jy-output]', dom.root);
    dom.inputLang = q('[data-jy-input-lang]', dom.root);
    dom.outputLang = q('[data-jy-output-lang]', dom.root);
    dom.inputLabel = q('[data-jy-input-label]', dom.root);
    dom.outputLabel = q('[data-jy-output-label]', dom.root);
    dom.inputStats = q('[data-jy-input-stats]', dom.root);
    dom.outputStats = q('[data-jy-output-stats]', dom.root);
    dom.gutter = q('[data-jy-gutter]', dom.root);

    dom.convert = q('[data-jy-convert]', dom.root);
    dom.validate = q('[data-jy-validate]', dom.root);
    dom.format = q('[data-jy-format]', dom.root);
    dom.minify = q('[data-jy-minify]', dom.root);
    dom.paste = q('[data-jy-paste]', dom.root);
    dom.clearIn = q('[data-jy-clear-input]', dom.root);
    dom.copyIn = q('[data-jy-copy-input]', dom.root);
    dom.copyOut = q('[data-jy-copy-output]', dom.root);
    dom.downloadOut = q('[data-jy-download-output]', dom.root);
    dom.clearOut = q('[data-jy-clear-output]', dom.root);

    dom.live = q('#jyLive', dom.root);
    dom.indent = q('#jyIndent', dom.root);
    dom.examples = q('[data-jy-examples]', dom.root);
    dom.status = q('[data-jy-status]', dom.root);
    dom.error = q('[data-jy-error]', dom.root);
    dom.announce = q('[data-jy-announce]', dom.root);
    dom.drop = q('[data-jy-drop]', dom.root);

    return true;
  }

  function announce(message) {
    if (!dom.announce) return;
    dom.announce.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.announce.textContent = message; }, 60);
  }

  function setStatus(kind, message) {
    state.status = kind;
    if (!dom.status) return;
    dom.status.setAttribute('data-state', kind);
    dom.status.textContent = message;
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

    var html = '<strong>' + esc(result.message) + '</strong>';
    if (result.excerpt) {
      /* Show the offending line with a caret under the column. User
         content is escaped — this panel must never render markup. */
      var caret = new Array(Math.max(1, result.column)).join(' ') + '^';
      html += '<pre class="jy-error__excerpt">' + esc(result.excerpt) + '\n' + esc(caret) + '</pre>';
    }
    dom.error.innerHTML = html;
  }

  /* Tokenise for colour. Single pass over the source with one regex,
     each slice escaped as it is consumed, so no user content can ever
     reach the DOM as markup. */
  var JSON_TOKENS = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
  var YAML_TOKENS = /(^\s*#.*$)|(^\s*-\s)|(^\s*(?:"(?:\\.|[^"\\])*"|[^\s:#][^:#]*?):)|("(?:\\.|[^"\\])*")|\b(true|false|null|~)\b|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/gm;

  function highlight(text, lang) {
    var re = lang === 'JSON' ? JSON_TOKENS : YAML_TOKENS;
    var out = '';
    var last = 0;
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index < last) { re.lastIndex = last; continue; }
      out += esc(text.slice(last, m.index));
      var cls = 'tok-plain';
      if (lang === 'JSON') {
        cls = m[1] ? 'tok-key' : m[2] ? 'tok-str' : m[3] ? 'tok-lit' : 'tok-num';
      } else {
        cls = m[1] ? 'tok-comment' : m[2] ? 'tok-dash' : m[3] ? 'tok-key'
          : m[4] ? 'tok-str' : m[5] ? 'tok-lit' : 'tok-num';
      }
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  function renderStats() {
    var inS = stats(dom.input.value);
    var outS = stats(state.output);
    if (dom.inputStats) dom.inputStats.textContent = inS.lines + ' lines · ' + inS.chars + ' chars';
    if (dom.outputStats) dom.outputStats.textContent = outS.lines + ' lines · ' + outS.chars + ' chars';
    if (dom.gutter) {
      var n = Math.max(1, inS.lines);
      var lines = [];
      for (var i = 1; i <= n; i += 1) lines.push(i);
      dom.gutter.textContent = lines.join('\n');
    }
  }

  function renderOutput() {
    if (!dom.output) return;
    if (!state.output) {
      dom.output.innerHTML = '<span class="jy-placeholder">' +
        esc(targetLang() + ' output will appear here.') + '</span>';
      return;
    }
    dom.output.innerHTML = highlight(state.output, targetLang());
  }

  function syncLabels() {
    if (dom.inputLang) dom.inputLang.textContent = sourceLang();
    if (dom.outputLang) dom.outputLang.textContent = targetLang();
    if (dom.inputLabel) dom.inputLabel.textContent = sourceLang() + ' input';
    if (dom.outputLabel) dom.outputLabel.textContent = targetLang() + ' output';
    if (dom.convert) dom.convert.textContent = 'Convert to ' + targetLang();
    if (dom.validate) dom.validate.textContent = 'Validate ' + sourceLang();
    if (dom.downloadOut) dom.downloadOut.textContent = 'Download .' + targetLang().toLowerCase();
    if (dom.input) dom.input.setAttribute('aria-label', sourceLang() + ' input');

    /* Format and minify only mean something for JSON. */
    var jsonSide = isJsonSource();
    if (dom.format) dom.format.hidden = !jsonSide;
    if (dom.minify) dom.minify.hidden = !jsonSide;

    dom.modeButtons.forEach(function (b) {
      var on = b.getAttribute('data-jy-mode') === state.mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* The single conversion path. Buttons, live typing, examples, drops
     and mode switches all land here — nothing re-implements it. */
  function run(options) {
    options = options || {};
    state.input = dom.input.value;

    if (!state.input.trim()) {
      state.output = '';
      showError(null);
      setStatus('ready', 'Ready');
      renderOutput();
      renderStats();
      return null;
    }

    var opts = { indent: state.indent };
    var result = isJsonSource() ? jsonToYaml(state.input, opts) : yamlToJson(state.input, opts);

    if (!result.ok) {
      /* Keep the previous output on screen rather than replacing it
         with an error string the user could copy or download. */
      showError(result);
      setStatus('error', 'Invalid ' + sourceLang());
      if (options.announce) announce(result.message);
      renderStats();
      return null;
    }

    state.output = result.output;
    showError(null);
    setStatus('ok', 'Converted successfully');
    renderOutput();
    renderStats();
    if (options.announce) {
      announce('Converted to ' + targetLang() + '. ' + stats(state.output).lines + ' lines.');
    }
    return result;
  }

  function scheduleRun() {
    if (!state.liveConvert) { renderStats(); setStatus('idle', 'Press Convert'); return; }
    if (convertTimer) clearTimeout(convertTimer);
    /* Large documents get a longer pause so typing never blocks. */
    var delay = dom.input.value.length > 200000 ? 600 : 220;
    setStatus('working', 'Converting…');
    renderStats();
    convertTimer = setTimeout(function () { run(); }, delay);
  }

  function setInput(text, options) {
    dom.input.value = text;
    state.input = text;
    run(options || {});
  }

  function flash(btn, label) {
    if (!btn) return;
    var original = btn.getAttribute('data-jy-label') || btn.textContent;
    btn.setAttribute('data-jy-label', original);
    btn.textContent = label;
    setTimeout(function () { btn.textContent = original; }, 1500);
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

  function download(text, filename, mime) {
    if (!text) { announce('Nothing to download yet.'); return; }
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    announce(filename + ' downloaded.');
  }

  function renderExamples() {
    if (!dom.examples) return;
    dom.examples.innerHTML = EXAMPLES.map(function (ex) {
      return '<button type="button" class="jy-chip" data-jy-example="' + esc(ex.id) + '">' +
        esc(ex.name) + '</button>';
    }).join('');
  }

  function loadExample(id) {
    var ex = EXAMPLES.filter(function (e) { return e.id === id; })[0];
    if (!ex) return;
    /* Examples are authored as JSON data. In reverse mode, feed the
       YAML rendering of the same object so the input matches the mode. */
    var text = isJsonSource()
      ? JSON.stringify(ex.data, null, state.indent)
      : toYaml(ex.data, { indent: state.indent }).replace(/\n$/, '');
    setInput(text, { announce: true });
    announce(ex.name + ' example loaded.');
  }

  function switchMode(mode) {
    var next = mode === 'yaml-to-json' ? 'yaml-to-json' : 'json-to-yaml';
    if (next === state.mode) return;

    /* Carry the current output across as the new input — that is what
       "swap" means to someone mid-task. */
    var carried = state.output;
    state.mode = next;
    state.output = '';
    syncLabels();

    if (carried) {
      setInput(carried.replace(/\n$/, ''), { announce: true });
    } else {
      run();
      renderOutput();
    }
    announce('Switched to ' + sourceLang() + ' to ' + targetLang() + '.');
  }

  function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      showError({ message: 'File is too large to process in the browser (limit ' +
        Math.round(MAX_INPUT_BYTES / 1048576) + ' MB).' });
      setStatus('error', 'File too large');
      announce('File is too large to process in the browser.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { setInput(String(reader.result || ''), { announce: true }); };
    reader.onerror = function () {
      showError({ message: 'That file could not be read.' });
      setStatus('error', 'Could not read file');
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    dom.modeButtons.forEach(function (b) {
      b.addEventListener('click', function () { switchMode(b.getAttribute('data-jy-mode')); });
    });

    dom.input.addEventListener('input', function () { scheduleRun(); });

    /* Tab should indent, not leave the editor — but Escape first
       restores tab-to-move so the field is never a keyboard trap. */
    var tabTraps = true;
    dom.input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { tabTraps = false; announce('Tab will now move focus out of the editor.'); return; }
      if (e.key === 'Tab' && tabTraps && !e.shiftKey) {
        e.preventDefault();
        var s = dom.input.selectionStart, en = dom.input.selectionEnd;
        var unit = new Array(state.indent + 1).join(' ');
        dom.input.value = dom.input.value.slice(0, s) + unit + dom.input.value.slice(en);
        dom.input.selectionStart = dom.input.selectionEnd = s + unit.length;
        scheduleRun();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run({ announce: true }); }
    });
    dom.input.addEventListener('focus', function () { tabTraps = true; });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        if (!state.output) return;
        e.preventDefault();
        copy(state.output, dom.copyOut, targetLang());
      }
    });

    if (dom.convert) dom.convert.addEventListener('click', function () { run({ announce: true }); });

    if (dom.validate) {
      dom.validate.addEventListener('click', function () {
        var parsed = isJsonSource() ? parseJson(dom.input.value) : parseYaml(dom.input.value);
        if (parsed.ok) {
          showError(null);
          setStatus('ok', 'Valid ' + sourceLang());
          announce('Valid ' + sourceLang() + '.');
        } else {
          showError(parsed);
          setStatus('error', 'Invalid ' + sourceLang());
          announce(parsed.message);
        }
      });
    }

    if (dom.format) {
      dom.format.addEventListener('click', function () {
        var r = formatJson(dom.input.value, { indent: state.indent });
        if (!r.ok) { showError(r); setStatus('error', 'Invalid JSON'); announce(r.message); return; }
        setInput(r.output.replace(/\n$/, ''), { announce: true });
        announce('JSON formatted with ' + state.indent + '-space indentation.');
      });
    }

    if (dom.minify) {
      dom.minify.addEventListener('click', function () {
        var r = minifyJson(dom.input.value);
        if (!r.ok) { showError(r); setStatus('error', 'Invalid JSON'); announce(r.message); return; }
        setInput(r.output, { announce: true });
        announce('JSON minified.');
      });
    }

    if (dom.paste) {
      dom.paste.addEventListener('click', function () {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          announce('Your browser will not allow reading the clipboard. Use Ctrl+V in the editor.');
          return;
        }
        navigator.clipboard.readText().then(function (t) {
          setInput(t, { announce: true });
        }, function () {
          announce('Clipboard access was declined. Use Ctrl+V in the editor.');
        });
      });
    }

    if (dom.clearIn) {
      dom.clearIn.addEventListener('click', function () {
        setInput('', {});
        dom.input.focus();
        announce('Input cleared.');
      });
    }
    if (dom.clearOut) {
      dom.clearOut.addEventListener('click', function () {
        state.output = '';
        renderOutput(); renderStats();
        setStatus('ready', 'Ready');
        announce('Output cleared.');
      });
    }

    if (dom.copyIn) dom.copyIn.addEventListener('click', function () { copy(dom.input.value, dom.copyIn, sourceLang()); });
    if (dom.copyOut) dom.copyOut.addEventListener('click', function () { copy(state.output, dom.copyOut, targetLang()); });
    if (dom.downloadOut) {
      dom.downloadOut.addEventListener('click', function () {
        var yaml = targetLang() === 'YAML';
        download(state.output, yaml ? 'converted.yaml' : 'converted.json',
          yaml ? 'text/yaml;charset=utf-8' : 'application/json;charset=utf-8');
      });
    }

    if (dom.live) {
      dom.live.addEventListener('change', function () {
        state.liveConvert = dom.live.checked;
        if (state.liveConvert) run();
        else setStatus('idle', 'Press Convert');
        announce(state.liveConvert ? 'Live conversion on.' : 'Live conversion off.');
      });
    }

    if (dom.indent) {
      dom.indent.addEventListener('change', function () {
        state.indent = dom.indent.value === '4' ? 4 : 2;
        run({ announce: true });
      });
    }

    if (dom.examples) {
      dom.examples.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-jy-example]');
        if (b) loadExample(b.getAttribute('data-jy-example'));
      });
    }

    if (dom.drop) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        dom.drop.addEventListener(ev, function (e) {
          e.preventDefault(); dom.drop.classList.add('is-dragging');
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dom.drop.addEventListener(ev, function (e) {
          e.preventDefault(); dom.drop.classList.remove('is-dragging');
        });
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
    syncLabels();
    if (dom.live) dom.live.checked = state.liveConvert;
    setInput(JSON.stringify(SAMPLE, null, 2), {});
  }

  function boot() {
    init();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
