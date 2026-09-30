/* ============================================================
   ToolAdda — URL Encoder / Decoder

   Every transformation is done with the browser's own encodeURI,
   encodeURIComponent, decodeURI, decodeURIComponent, URL and
   URLSearchParams — never reimplemented. Nothing typed here is
   sent anywhere.

     1.  Encoding engine (native APIs, wrapped for safe errors)
     2.  Character statistics
     3.  Diff segmentation for the "show changes" view
     4.  Double-encoding detection
     5.  URL structure analysis
     6.  Query string builder / parser
     7.  Engine export
     8.  Application state
     9.  DOM cache
     10. Rendering
     11. Mode switching
     12. Process pipeline (encode / decode)
     13. Query parameter mode
     14. URL structure panel
     15. Query string builder panel
     16. Query string parser panel
     17. Clipboard, download, share
     18. Keyboard and init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ---------------------------------------------------------
     1. ENCODING ENGINE
     --------------------------------------------------------- */

  var MODES = {
    uri: {
      id: 'uri',
      label: 'URL / URI',
      encode: encodeURI,
      decode: decodeURI,
      blurb: 'For a complete URL, where slashes, ? and # must stay intact so the address still works.'
    },
    component: {
      id: 'component',
      label: 'URI Component',
      encode: encodeURIComponent,
      decode: decodeURIComponent,
      blurb: 'For one value that will sit inside a URL — a query value, a path segment, a form field.'
    },
    query: {
      id: 'query',
      label: 'Query Parameter',
      encode: encodeURIComponent,
      decode: decodeURIComponent,
      blurb: 'For a single name=value pair. Encodes the name and value separately, exactly like a component.'
    }
  };

  function cleanErrorMessage(message) {
    var text = String(message || 'Operation failed');
    text = text.replace(/^URIError:\s*/i, '');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /**
   * Runs the native encode function for a mode. encodeURI/encodeURIComponent
   * only throw on a lone unpaired surrogate, which is reported as a plain
   * message rather than a raw URIError.
   */
  function encodeText(text, modeId) {
    var mode = MODES[modeId];
    try {
      return { ok: true, value: mode.encode(text) };
    } catch (err) {
      return {
        ok: false,
        error: 'This text contains a character your browser could not encode ('
          + cleanErrorMessage(err && err.message) + ').'
      };
    }
  }

  function decodeText(text, modeId) {
    var mode = MODES[modeId];
    try {
      return { ok: true, value: mode.decode(text) };
    } catch (err) {
      return {
        ok: false,
        error: 'Unable to decode this input. It contains an invalid percent-encoded sequence.'
      };
    }
  }

  /* ---------------------------------------------------------
     2. CHARACTER STATISTICS
     --------------------------------------------------------- */

  function charStats(text) {
    return {
      length: Array.from(text).length,
      utf8Bytes: new TextEncoder().encode(text).length
    };
  }

  /* ---------------------------------------------------------
     3. DIFF SEGMENTATION
     Both encode and decode are stateless and process the string
     left to right with no reordering, so a per-token walk lines
     up cleanly against the original text.
     --------------------------------------------------------- */

  /**
   * Segments for an encode operation: one entry per input code point,
   * grouped into runs of unchanged / changed. Working per code point
   * (not per UTF-16 code unit) keeps surrogate pairs intact — encoding
   * half of one throws.
   */
  function encodeDiffSegments(input, modeId) {
    var mode = MODES[modeId];
    var codePoints = Array.from(input);
    var pieces = codePoints.map(function (ch) {
      var encoded;
      try {
        encoded = mode.encode(ch);
      } catch (err) {
        encoded = ch;
      }
      return { source: ch, output: encoded, changed: encoded !== ch };
    });
    return groupPieces(pieces);
  }

  var PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+|[^%]+|%/g;

  /**
   * Segments for a decode operation. The already-validated input is
   * tokenized into maximal runs of percent-encoding versus literal
   * text; a multi-byte UTF-8 sequence is always a contiguous run of
   * %XX triplets, so decoding each run on its own reproduces exactly
   * what decoding the whole string produced.
   */
  function decodeDiffSegments(input, modeId) {
    var mode = MODES[modeId];
    var tokens = input.match(PERCENT_RUN) || [];
    var pieces = tokens.map(function (token) {
      var decoded;
      try {
        decoded = mode.decode(token);
      } catch (err) {
        decoded = token;
      }
      return { source: token, output: decoded, changed: decoded !== token };
    });
    return groupPieces(pieces);
  }

  function groupPieces(pieces) {
    var groups = [];
    pieces.forEach(function (piece) {
      var last = groups[groups.length - 1];
      if (last && last.changed === piece.changed) {
        last.source += piece.source;
        last.output += piece.output;
      } else {
        groups.push({ source: piece.source, output: piece.output, changed: piece.changed });
      }
    });
    return groups;
  }

  /* ---------------------------------------------------------
     4. DOUBLE-ENCODING DETECTION
     A plain pattern match, not a guess about intent — the tool
     never blocks or silently changes what the user asked for.
     --------------------------------------------------------- */

  var PERCENT_ENCODED = /%[0-9A-Fa-f]{2}/;
  var DOUBLE_ENCODED_HINT = /%25[0-9A-Fa-f]{2}/;

  function looksPercentEncoded(text) {
    return PERCENT_ENCODED.test(text);
  }

  function looksDoubleEncoded(text) {
    return DOUBLE_ENCODED_HINT.test(text);
  }

  /* ---------------------------------------------------------
     5. URL STRUCTURE ANALYSIS
     --------------------------------------------------------- */

  function analyzeUrl(text) {
    var trimmed = text.trim();
    if (!trimmed) return { ok: false, error: 'Enter a URL to analyze.' };

    var parsed;
    try {
      parsed = new URL(trimmed);
    } catch (err) {
      return {
        ok: false,
        error: 'This input is not a valid absolute URL. It can still be encoded as text or a URI component.'
      };
    }

    var params = [];
    parsed.searchParams.forEach(function (value, name) {
      params.push({ name: name, value: value });
    });

    return {
      ok: true,
      href: parsed.href,
      protocol: parsed.protocol.replace(/:$/, ''),
      host: parsed.host,
      hostname: parsed.hostname,
      port: parsed.port || null,
      username: parsed.username || null,
      password: parsed.password ? '••••••' : null,
      pathname: parsed.pathname || '/',
      search: parsed.search ? parsed.search.slice(1) : null,
      hash: parsed.hash ? parsed.hash.slice(1) : null,
      params: params
    };
  }

  /* ---------------------------------------------------------
     6. QUERY STRING BUILDER / PARSER
     Both go through URLSearchParams, so the tool's output matches
     what a browser or fetch() would actually send — including the
     form-encoding quirk of turning a space into "+".
     --------------------------------------------------------- */

  function buildQueryString(pairs) {
    var params = new URLSearchParams();
    var used = 0;
    pairs.forEach(function (pair) {
      if (!pair.name) return;
      params.append(pair.name, pair.value || '');
      used += 1;
    });
    return { ok: used > 0, count: used, query: params.toString() };
  }

  function parseQueryString(text) {
    var trimmed = text.trim();
    var withoutPrefix = trimmed.replace(/^[?#]/, '');
    if (!withoutPrefix) return { ok: false, error: 'Enter a query string to parse.' };

    var params;
    try {
      params = new URLSearchParams(withoutPrefix);
    } catch (err) {
      return { ok: false, error: 'Unable to parse this as a query string.' };
    }

    var pairs = [];
    params.forEach(function (value, name) {
      pairs.push({ name: name, value: value });
    });

    var seen = {};
    var duplicates = [];
    pairs.forEach(function (pair) {
      seen[pair.name] = (seen[pair.name] || 0) + 1;
    });
    Object.keys(seen).forEach(function (name) {
      if (seen[name] > 1) duplicates.push(name);
    });

    return { ok: true, pairs: pairs, duplicates: duplicates };
  }

  /* ---------------------------------------------------------
     7. ENGINE EXPORT
     --------------------------------------------------------- */

  var engine = {
    MODES: MODES,
    encodeText: encodeText,
    decodeText: decodeText,
    charStats: charStats,
    encodeDiffSegments: encodeDiffSegments,
    decodeDiffSegments: decodeDiffSegments,
    looksPercentEncoded: looksPercentEncoded,
    looksDoubleEncoded: looksDoubleEncoded,
    analyzeUrl: analyzeUrl,
    buildQueryString: buildQueryString,
    parseQueryString: parseQueryString,
    cleanErrorMessage: cleanErrorMessage
  };

  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (globalScope) globalScope.ToolAddaUrl = engine;

  if (typeof document === 'undefined') return;

  /* ==========================================================
     8. APPLICATION STATE
     ========================================================== */

  var STORE_KEY = 'tooladda-url-prefs-v1';
  var DEBOUNCE_MS = 150;
  var LARGE_INPUT_CHARS = 20000;

  var state = {
    mode: 'uri',
    operation: 'encode',
    input: '',
    output: null,
    live: true,
    showChanges: false,
    paramName: '',
    decodedName: null
  };

  var el = {};
  var debounceTimer = null;

  function pick(selector, scope) { return (scope || document).querySelector(selector); }
  function pickAll(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  /* ==========================================================
     9. DOM CACHE
     ========================================================== */

  function cacheDom() {
    el.app = pick('[data-ux-app]');
    if (!el.app) return false;

    el.tabs = pickAll('[data-ux-mode]');
    el.modeBlurb = pick('[data-ux-mode-blurb]');
    el.paramRow = pick('[data-ux-param-row]');
    el.paramName = pick('#uxParamName');

    el.input = pick('#uxInput');
    el.inputStats = pick('[data-ux-input-stats]');
    el.alreadyEncoded = pick('[data-ux-already-encoded]');
    el.liveToggle = pick('[data-ux-live-toggle]');

    el.encodeBtn = pick('[data-ux-encode]');
    el.decodeBtn = pick('[data-ux-decode]');

    el.outputWrap = pick('[data-ux-output-wrap]');
    el.output = pick('[data-ux-output]');
    el.outputEmpty = pick('[data-ux-output-empty]');
    el.outputStats = pick('[data-ux-output-stats]');
    el.errorBox = pick('[data-ux-error]');
    el.doubleHint = pick('[data-ux-double-hint]');
    el.live_ = pick('[data-ux-live]');

    el.changesToggle = pick('[data-ux-changes-toggle]');

    el.copyOutput = pick('[data-ux-copy-output]');
    el.copyInput = pick('[data-ux-copy-input]');
    el.swap = pick('[data-ux-swap]');
    el.downloadTxt = pick('[data-ux-download-txt]');
    el.downloadJson = pick('[data-ux-download-json]');
    el.clear = pick('[data-ux-clear]');
    el.loadExample = pick('[data-ux-load-example]');

    el.urlInput = pick('#uxUrlInput');
    el.urlAnalyze = pick('[data-ux-url-analyze]');
    el.urlResult = pick('[data-ux-url-result]');

    el.builderRows = pick('[data-ux-builder-rows]');
    el.builderAdd = pick('[data-ux-builder-add]');
    el.builderRun = pick('[data-ux-builder-run]');
    el.builderOut = pick('[data-ux-builder-out]');
    el.builderCopy = pick('[data-ux-builder-copy]');

    el.parserInput = pick('#uxParserInput');
    el.parserRun = pick('[data-ux-parser-run]');
    el.parserOut = pick('[data-ux-parser-out]');

    return true;
  }

  function announce(message) {
    if (el.live_) el.live_.textContent = message;
  }

  /* ==========================================================
     10. RENDERING
     ========================================================== */

  function showError(message) {
    if (!el.errorBox) return;
    if (!message) {
      el.errorBox.hidden = true;
      el.errorBox.textContent = '';
      return;
    }
    el.errorBox.hidden = false;
    el.errorBox.textContent = message;
    announce(message);
  }

  function renderInputStats() {
    var stats = charStats(state.input);
    el.inputStats.textContent = stats.length.toLocaleString() + ' characters · '
      + stats.utf8Bytes.toLocaleString() + ' bytes (UTF-8)';

    /* This is a caution about what pressing Encode would do next, so it is
       shown whenever the input looks pre-encoded — not gated on whichever
       button was clicked last. */
    el.alreadyEncoded.hidden = !looksPercentEncoded(state.input);
  }

  function paintDiff(container, segments) {
    container.textContent = '';
    var fragment = document.createDocumentFragment();
    segments.forEach(function (segment) {
      if (!segment.changed) {
        fragment.appendChild(document.createTextNode(segment.output));
        return;
      }
      var mark = document.createElement('mark');
      mark.className = 'ux-hit';
      mark.title = segment.source + ' → ' + segment.output;
      mark.appendChild(document.createTextNode(segment.output));
      fragment.appendChild(mark);
    });
    container.appendChild(fragment);
  }

  function renderOutput() {
    if (state.output === null) {
      el.outputWrap.hidden = true;
      el.outputEmpty.hidden = false;
      el.outputEmpty.textContent = state.input
        ? 'Fix the error above to see a result.'
        : 'Paste a URL or text above, then Encode or Decode it.';
      el.outputStats.textContent = '';
      el.copyOutput.disabled = true;
      el.swap.disabled = true;
      el.downloadTxt.disabled = true;
      el.downloadJson.disabled = true;
      return;
    }

    el.outputWrap.hidden = false;
    el.outputEmpty.hidden = true;
    el.copyOutput.disabled = false;
    el.swap.disabled = state.output.length === 0 && state.input.length === 0;
    el.downloadTxt.disabled = false;
    el.downloadJson.disabled = false;

    if (state.showChanges) {
      var segments = state.operation === 'encode'
        ? encodeDiffSegments(state.input, state.mode)
        : decodeDiffSegments(state.input, state.mode);
      paintDiff(el.output, segments);
    } else {
      el.output.textContent = state.output;
    }

    var stats = charStats(state.output);
    var inStats = charStats(state.input);
    var arrow = stats.length >= inStats.length ? '→' : '→';
    el.outputStats.textContent = inStats.length.toLocaleString() + ' chars '
      + arrow + ' ' + stats.length.toLocaleString() + ' chars · '
      + stats.utf8Bytes.toLocaleString() + ' bytes (UTF-8)';

    el.doubleHint.hidden = true;
    if (state.operation === 'decode' && looksPercentEncoded(state.output)) {
      el.doubleHint.hidden = false;
      el.doubleHint.textContent = 'The result still contains percent-encoded characters ('
        + '%xx). If this was double-encoded, press Decode again on the result.';
    }
  }

  function renderModeUi() {
    var mode = MODES[state.mode];
    el.tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-ux-mode') === state.mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });
    el.modeBlurb.textContent = mode.blurb;
    el.paramRow.hidden = state.mode !== 'query';

    el.input.placeholder = state.mode === 'query'
      ? 'Parameter value — e.g. hello world'
      : state.mode === 'uri'
        ? 'Paste a complete URL to encode/decode...'
        : 'Paste a URL or text to encode/decode...';
  }

  /* ==========================================================
     11. MODE SWITCHING
     ========================================================== */

  function setMode(modeId) {
    if (!MODES[modeId]) return;
    state.mode = modeId;
    renderModeUi();
    savePrefs();
    process(state.operation, { silent: !state.input });
  }

  /* ==========================================================
     12. PROCESS PIPELINE
     ========================================================== */

  function currentInputForMode() {
    if (state.mode !== 'query') return state.input;
    if (state.operation === 'encode') return state.input;
    /* Decoding: the whole box may be "name=value" or just a value. */
    return state.input;
  }

  function process(operation, options) {
    var opts = options || {};
    state.operation = operation;
    showError(null);

    var raw = currentInputForMode();

    if (!raw) {
      state.output = null;
      state.decodedName = null;
      renderOutput();
      renderInputStats();
      if (!opts.silent) showError('Enter some text to ' + operation + '.');
      return;
    }

    if (state.mode === 'query' && operation === 'encode') {
      var nameResult = state.paramName ? encodeText(state.paramName, 'component') : { ok: true, value: '' };
      var valueResult = encodeText(raw, 'component');
      if (!nameResult.ok) {
        state.output = null;
        showError(nameResult.error);
      } else if (!valueResult.ok) {
        state.output = null;
        showError(valueResult.error);
      } else {
        state.output = state.paramName ? nameResult.value + '=' + valueResult.value : valueResult.value;
        announce('Encoded successfully');
      }
      renderOutput();
      renderInputStats();
      return;
    }

    if (state.mode === 'query' && operation === 'decode') {
      var eq = raw.indexOf('=');
      if (eq === -1) {
        var wholeResult = decodeText(raw, 'component');
        if (!wholeResult.ok) {
          state.output = null;
          showError(wholeResult.error);
        } else {
          state.output = wholeResult.value;
          state.decodedName = null;
          announce('Decoded successfully');
        }
      } else {
        var namePart = raw.slice(0, eq);
        var valuePart = raw.slice(eq + 1);
        var decodedNameResult = decodeText(namePart, 'component');
        var decodedValueResult = decodeText(valuePart, 'component');
        if (!decodedNameResult.ok) {
          state.output = null;
          showError(decodedNameResult.error);
        } else if (!decodedValueResult.ok) {
          state.output = null;
          showError(decodedValueResult.error);
        } else {
          state.decodedName = decodedNameResult.value;
          state.output = decodedNameResult.value + ': ' + decodedValueResult.value;
          if (el.paramName) el.paramName.value = decodedNameResult.value;
          state.paramName = decodedNameResult.value;
          announce('Decoded successfully');
        }
      }
      renderOutput();
      renderInputStats();
      return;
    }

    var result = operation === 'encode' ? encodeText(raw, state.mode) : decodeText(raw, state.mode);
    if (!result.ok) {
      state.output = null;
      showError(result.error);
    } else {
      state.output = result.value;
      announce(operation === 'encode' ? 'Encoded successfully' : 'Decoded successfully');
    }

    renderOutput();
    renderInputStats();
  }

  function scheduleLiveProcess() {
    if (!state.live) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(function () {
      process(state.operation, { silent: true });
    }, DEBOUNCE_MS);
  }

  /* ==========================================================
     13. CLIPBOARD, DOWNLOAD, SWAP
     ========================================================== */

  function legacyCopy(value) {
    try {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var done = document.execCommand('copy');
      document.body.removeChild(area);
      return done;
    } catch (err) {
      return false;
    }
  }

  function flash(button, label) {
    if (!button) return;
    var original = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', original);
    button.textContent = label;
    button.classList.add('is-copied');
    window.clearTimeout(button._uxTimer);
    button._uxTimer = window.setTimeout(function () {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 1600);
  }

  function copyValue(value, button, message) {
    function done() { flash(button, 'Copied'); announce(message || 'Copied to clipboard'); }
    function failed() {
      flash(button, 'Press Ctrl+C');
      announce('Clipboard access was blocked. Select the text and copy it manually.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () {
        if (legacyCopy(value)) done(); else failed();
      });
      return;
    }
    if (legacyCopy(value)) done(); else failed();
  }

  function saveBlob(text, filename, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ==========================================================
     14. URL STRUCTURE PANEL
     ========================================================== */

  function renderUrlResult() {
    var result = analyzeUrl(el.urlInput.value);
    el.urlResult.textContent = '';

    if (!result.ok) {
      var msg = document.createElement('p');
      msg.className = 'ux-detail__empty';
      msg.textContent = result.error;
      el.urlResult.appendChild(msg);
      return;
    }

    var rows = [
      ['Protocol', result.protocol],
      ['Host', result.host],
      ['Hostname', result.hostname],
      ['Port', result.port || '(default)'],
      ['Path', result.pathname],
      ['Query', result.search || '(none)'],
      ['Fragment', result.hash || '(none)']
    ];
    if (result.username) rows.splice(2, 0, ['Username', result.username]);
    if (result.password) rows.splice(3, 0, ['Password', result.password]);

    var dl = document.createElement('dl');
    dl.className = 'ux-urlparts';
    rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    el.urlResult.appendChild(dl);

    if (result.params.length) {
      var title = document.createElement('h4');
      title.className = 'ux-detail__subtitle';
      title.textContent = 'Query parameters (decoded)';
      el.urlResult.appendChild(title);

      var table = buildParamTable(result.params, []);
      el.urlResult.appendChild(table);
    }
  }

  /* ==========================================================
     15. QUERY STRING BUILDER
     ========================================================== */

  function addBuilderRow(name, value) {
    var row = document.createElement('div');
    row.className = 'ux-builder-row';

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ux-input ux-input--mono';
    nameInput.placeholder = 'name';
    nameInput.setAttribute('aria-label', 'Query parameter name');
    nameInput.value = name || '';

    var valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'ux-input ux-input--mono';
    valueInput.placeholder = 'value';
    valueInput.setAttribute('aria-label', 'Query parameter value');
    valueInput.value = value || '';

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ux-btn ux-btn--ghost ux-btn--xs';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', 'Remove this row');
    removeBtn.addEventListener('click', function () {
      row.remove();
    });

    row.appendChild(nameInput);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);
    el.builderRows.appendChild(row);
  }

  function runBuilder() {
    var rows = pickAll('.ux-builder-row', el.builderRows);
    var pairs = rows.map(function (row) {
      var inputs = row.querySelectorAll('input');
      return { name: inputs[0].value, value: inputs[1].value };
    });

    var result = buildQueryString(pairs);
    if (!result.ok) {
      el.builderOut.textContent = '';
      el.builderCopy.disabled = true;
      announce('Add at least one parameter name to build a query string.');
      return;
    }

    el.builderOut.textContent = '?' + result.query;
    el.builderCopy.disabled = false;
    announce(result.count + ' parameter' + (result.count === 1 ? '' : 's') + ' built into a query string.');
  }

  /* ==========================================================
     16. QUERY STRING PARSER
     ========================================================== */

  function buildParamTable(pairs, duplicates) {
    var table = document.createElement('table');
    table.className = 'ux-table';
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th scope="col">Parameter</th><th scope="col">Decoded value</th></tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    pairs.forEach(function (pair) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = pair.name;
      if (duplicates.indexOf(pair.name) !== -1) {
        var badge = document.createElement('span');
        badge.className = 'ux-dupe-badge';
        badge.textContent = 'duplicate key';
        th.appendChild(document.createTextNode(' '));
        th.appendChild(badge);
      }
      var td = document.createElement('td');
      td.textContent = pair.value === '' ? '(empty)' : pair.value;
      if (pair.value === '') td.classList.add('is-meta');
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function runParser() {
    var result = parseQueryString(el.parserInput.value);
    el.parserOut.textContent = '';

    if (!result.ok) {
      var msg = document.createElement('p');
      msg.className = 'ux-detail__empty';
      msg.textContent = result.error;
      el.parserOut.appendChild(msg);
      return;
    }

    if (!result.pairs.length) {
      var empty = document.createElement('p');
      empty.className = 'ux-detail__empty';
      empty.textContent = 'No parameters found in that string.';
      el.parserOut.appendChild(empty);
      return;
    }

    el.parserOut.appendChild(buildParamTable(result.pairs, result.duplicates));
    announce(result.pairs.length + ' parameter' + (result.pairs.length === 1 ? '' : 's') + ' parsed.');
  }

  /* ==========================================================
     17. PREFERENCES
     ========================================================== */

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (MODES[saved.mode]) state.mode = saved.mode;
      if (typeof saved.live === 'boolean') state.live = saved.live;
    } catch (err) {
      /* corrupted preferences are ignored */
    }
  }

  function savePrefs() {
    try {
      /* Only the chosen mode and the live toggle — never input or output,
         which may contain tokens, ids or other sensitive query data. */
      localStorage.setItem(STORE_KEY, JSON.stringify({ mode: state.mode, live: state.live }));
    } catch (err) {
      /* storage blocked — preferences simply will not persist */
    }
  }

  /* ==========================================================
     18. EVENT WIRING AND INIT
     ========================================================== */

  function loadExample() {
    state.mode = 'uri';
    renderModeUi();
    el.input.value = 'https://example.com/search?q=hello world&category=web tools#top';
    state.input = el.input.value;
    renderInputStats();
    process('encode');
    savePrefs();
    announce('Loaded an example URL.');
  }

  function bindTabs() {
    el.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { setMode(tab.getAttribute('data-ux-mode')); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        var index = el.tabs.indexOf(tab);
        var next = el.tabs[(index + (event.key === 'ArrowRight' ? 1 : el.tabs.length - 1)) % el.tabs.length];
        next.focus();
        setMode(next.getAttribute('data-ux-mode'));
      });
    });
  }

  function bindWorkspace() {
    el.input.addEventListener('input', function () {
      state.input = el.input.value;
      renderInputStats();
      scheduleLiveProcess();
    });

    if (el.paramName) {
      el.paramName.addEventListener('input', function () {
        state.paramName = el.paramName.value;
        scheduleLiveProcess();
      });
    }

    el.encodeBtn.addEventListener('click', function () { process('encode'); });
    el.decodeBtn.addEventListener('click', function () { process('decode'); });

    if (el.liveToggle) {
      el.liveToggle.checked = state.live;
      el.liveToggle.addEventListener('change', function () {
        state.live = el.liveToggle.checked;
        savePrefs();
        if (state.live && state.input) process(state.operation, { silent: true });
      });
    }

    if (el.changesToggle) {
      el.changesToggle.addEventListener('click', function () {
        state.showChanges = !state.showChanges;
        el.changesToggle.classList.toggle('is-on', state.showChanges);
        el.changesToggle.setAttribute('aria-pressed', String(state.showChanges));
        renderOutput();
      });
    }

    el.copyOutput.addEventListener('click', function () {
      if (state.output === null) return;
      copyValue(state.output, el.copyOutput, 'Result copied');
    });
    el.copyInput.addEventListener('click', function () {
      if (!state.input) return;
      copyValue(state.input, el.copyInput, 'Input copied');
    });

    el.swap.addEventListener('click', function () {
      if (state.output === null) return;
      var newInput = state.output;
      el.input.value = newInput;
      state.input = newInput;
      state.output = null;
      renderInputStats();
      process(state.operation === 'encode' ? 'decode' : 'encode', { silent: true });
      el.input.focus();
      announce('Swapped input and output');
    });

    el.clear.addEventListener('click', function () {
      el.input.value = '';
      state.input = '';
      state.output = null;
      state.decodedName = null;
      showError(null);
      if (el.paramName) el.paramName.value = '';
      state.paramName = '';
      renderInputStats();
      renderOutput();
      el.input.focus();
      announce('Workspace cleared');
    });

    el.loadExample.addEventListener('click', loadExample);

    el.downloadTxt.addEventListener('click', function () {
      if (state.output === null) return;
      saveBlob(state.output, 'url-' + state.operation + 'd.txt', 'text/plain;charset=utf-8');
      announce('Result downloaded as a text file');
    });

    el.downloadJson.addEventListener('click', function () {
      if (state.output === null) return;
      var payload = {
        mode: state.mode,
        operation: state.operation,
        output: state.output
      };
      saveBlob(JSON.stringify(payload, null, 2), 'url-' + state.operation + 'd.json', 'application/json');
      announce('Result downloaded as a JSON file');
    });
  }

  function bindUrlPanel() {
    if (!el.urlAnalyze) return;
    el.urlAnalyze.addEventListener('click', renderUrlResult);
    el.urlInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); renderUrlResult(); }
    });
  }

  function bindBuilder() {
    if (!el.builderAdd) return;
    el.builderAdd.addEventListener('click', function () { addBuilderRow('', ''); });
    el.builderRun.addEventListener('click', runBuilder);
    el.builderCopy.addEventListener('click', function () {
      copyValue(el.builderOut.textContent, el.builderCopy, 'Query string copied');
    });
    addBuilderRow('search', 'hello world');
    addBuilderRow('page', '2');
  }

  function bindParser() {
    if (!el.parserRun) return;
    el.parserRun.addEventListener('click', runParser);
    el.parserInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); runParser(); }
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      var meta = event.ctrlKey || event.metaKey;
      if (!meta) return;
      var inside = el.app.contains(document.activeElement);

      if (event.shiftKey && (event.key === 'E' || event.key === 'e')) {
        event.preventDefault();
        process('encode');
        return;
      }
      if (event.shiftKey && (event.key === 'D' || event.key === 'd')) {
        event.preventDefault();
        process('decode');
        return;
      }
      if (event.key === 'Enter' && inside) {
        event.preventDefault();
        process(state.operation);
      }
    });

    el.input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && el.input.value) {
        el.input.value = '';
        state.input = '';
        renderInputStats();
      }
    });
  }

  function init() {
    if (!cacheDom()) return;
    loadPrefs();

    renderModeUi();
    renderInputStats();
    renderOutput();

    bindTabs();
    bindWorkspace();
    bindUrlPanel();
    bindBuilder();
    bindParser();
    bindKeyboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
