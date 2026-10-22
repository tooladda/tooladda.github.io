/* JSON to XML converter — UI layer.
 *
 * Presentation only. All conversion still lives in json-to-xml.js; this file
 * never parses or transforms anything itself, it only reflects the state of
 * the two panes back to the user:
 *   - live line/character counts in each pane header
 *   - the greyed placeholder styling while there is no real output yet
 *   - a sample document for people who want to see the shape of the result
 *   - re-running the conversion when an option that changes the output flips
 *
 * Text is only ever written with textContent / value, never innerHTML, so
 * nothing pasted into the input can execute as markup.
 */
(function () {
  'use strict';

  var input = document.getElementById('jsonPasteArea');
  var output = document.getElementById('xmlOutputPre');
  var convertBtn = document.getElementById('convertBtn');
  var prettyToggle = document.getElementById('prettyToggle');
  var sampleBtn = document.getElementById('jxSampleBtn');
  var inMeta = document.querySelector('[data-jx-in-meta]');
  var outMeta = document.querySelector('[data-jx-out-meta]');

  if (!input || !output) return;

  /* Kept in sync with the string json-to-xml.js writes back on Clear All. */
  var PLACEHOLDER = 'Paste JSON and click Convert to see XML.';

  var SAMPLE = [
    '{',
    '  "library": {',
    '    "name": "City Central",',
    '    "open": true,',
    '    "book": [',
    '      { "title": "Dune", "author": "Frank Herbert", "year": 1965 },',
    '      { "title": "Solaris", "author": "Stanislaw Lem", "year": 1961 }',
    '    ]',
    '  }',
    '}'
  ].join('\n');

  var countLines = function (text) {
    return text ? text.split('\n').length : 0;
  };

  var describe = function (text) {
    if (!text) return 'empty';
    var lines = countLines(text);
    var chars = text.length;
    return lines + (lines === 1 ? ' line' : ' lines') + ' · ' + chars.toLocaleString() + ' chars';
  };

  var refreshInput = function () {
    if (inMeta) inMeta.textContent = describe(input.value);
  };

  var refreshOutput = function () {
    var text = output.textContent || '';
    var isPlaceholder = text === PLACEHOLDER || text === '';
    output.classList.toggle('is-placeholder', isPlaceholder);
    if (outMeta) outMeta.textContent = isPlaceholder ? '—' : describe(text);
  };

  input.addEventListener('input', refreshInput);

  /* One observer covers every path that writes to the output pane — a
     successful convert, a failed one, and Clear All — so the header and the
     placeholder styling cannot drift out of step with what is displayed. */
  if (typeof MutationObserver === 'function') {
    new MutationObserver(refreshOutput).observe(output, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  /* Pretty print changes the output, so re-run it rather than leaving stale
     XML on screen. Only when there is already a real result to update. */
  if (prettyToggle && convertBtn) {
    prettyToggle.addEventListener('change', function () {
      var text = output.textContent || '';
      if (text && text !== PLACEHOLDER) convertBtn.click();
    });
  }

  if (sampleBtn && convertBtn) {
    sampleBtn.addEventListener('click', function () {
      input.value = SAMPLE;
      refreshInput();
      convertBtn.click();
      input.focus();
    });
  }

  refreshInput();
  refreshOutput();
})();
