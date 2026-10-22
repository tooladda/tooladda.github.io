(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var engine = window.CTW_ENGINE;
  if (!engine) return;

  var els = {
    sampleBtn: $('ctw-sample-btn'), fileInput: $('ctw-file'), clearBtn: $('ctw-clear-btn'),
    v3Btn: $('ctw-v3-btn'), v4Btn: $('ctw-v4-btn'), sortToggle: $('ctw-sort-toggle'),
    inputStats: $('ctw-input-stats'), searchToggle: $('ctw-search-toggle'), inputFullscreen: $('ctw-input-fullscreen'),
    searchBar: $('ctw-search-bar'), searchTerm: $('ctw-search-term'), searchNext: $('ctw-search-next'),
    replaceTerm: $('ctw-replace-term'), replaceAll: $('ctw-replace-all'),
    inputWrap: $('ctw-input-wrap'), inputLines: $('ctw-input-lines'), inputScroll: $('ctw-input-scroll'),
    inputHighlight: $('ctw-input-highlight'), input: $('ctw-input'),
    copyBtn: $('ctw-copy-btn'), downloadBtn: $('ctw-download-btn'), outputFullscreen: $('ctw-output-fullscreen'),
    exportTabs: $('ctw-export-tabs'), outputWrap: $('ctw-output-wrap'), output: $('ctw-output'),
    statRules: $('ctw-stat-rules'), statClasses: $('ctw-stat-classes'), statArbitrary: $('ctw-stat-arbitrary'), statVars: $('ctw-stat-vars'),
    warnings: $('ctw-warnings'), warnCount: $('ctw-warn-count'), warningsList: $('ctw-warnings-list'),
    varsPanel: $('ctw-vars-panel'), varsList: $('ctw-vars-list'),
    sticky: $('ctw-sticky'), stickyBtn: $('ctw-sticky-btn'),
  };
  if (!els.input || !els.output) return;

  var STORAGE_KEY = 'ctw_last_css';
  var mode = 'plain';
  var version = 'v3';
  var lastResult = { blocks: [], warnings: [], cssVars: [], stats: {} };
  var lastLineCount = 0;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // ---------------- CSS source highlighting (input editor) ----------------
  function highlightCSSSource(text) {
    var out = '', i = 0, n = text.length;
    while (i < n) {
      var c = text[i];
      if (c === '/' && text[i + 1] === '*') {
        var end = text.indexOf('*/', i + 2); end = end === -1 ? n : end + 2;
        out += '<span class="tok-cmt">' + escapeHtml(text.slice(i, end)) + '</span>'; i = end; continue;
      }
      if (c === '"' || c === "'") {
        var q = c, j = i + 1;
        while (j < n && text[j] !== q) { if (text[j] === '\\') j++; j++; }
        j = Math.min(j + 1, n);
        out += '<span class="tok-str">' + escapeHtml(text.slice(i, j)) + '</span>'; i = j; continue;
      }
      if (c === '@') {
        var j2 = i + 1; while (j2 < n && /[a-zA-Z-]/.test(text[j2])) j2++;
        out += '<span class="tok-atrule">' + escapeHtml(text.slice(i, j2)) + '</span>'; i = j2; continue;
      }
      if (/[{};:,]/.test(c)) { out += '<span class="tok-punc">' + escapeHtml(c) + '</span>'; i++; continue; }
      var j3 = i;
      while (j3 < n && !/[{};:,"'@]/.test(text[j3]) && !(text[j3] === '/' && text[j3 + 1] === '*')) j3++;
      if (j3 === i) { out += escapeHtml(c); i++; continue; }
      var word = text.slice(i, j3);
      var k = j3; while (k < n && /\s/.test(text[k])) k++;
      var nextChar = text[k];
      if (nextChar === '{') out += '<span class="tok-sel">' + escapeHtml(word) + '</span>';
      else if (nextChar === ':') out += '<span class="tok-prop">' + escapeHtml(word) + '</span>';
      else out += escapeHtml(word);
      i = j3;
    }
    return out || '​';
  }

  function updateLineNumbers() {
    var count = (els.input.value.match(/\n/g) || []).length + 1;
    if (count !== lastLineCount) {
      var html = '';
      for (var i = 1; i <= count; i++) html += '<div>' + i + '</div>';
      els.inputLines.innerHTML = html;
      lastLineCount = count;
    }
  }
  function autosizeInput() {
    els.input.style.height = 'auto';
    var h = els.input.scrollHeight;
    els.input.style.height = h + 'px';
  }
  function syncHighlight() {
    els.inputHighlight.innerHTML = highlightCSSSource(els.input.value);
  }
  els.inputScroll.addEventListener('scroll', function () {
    els.inputLines.style.transform = 'translateY(-' + els.inputScroll.scrollTop + 'px)';
  });

  // ---------------- Output class highlighting ----------------
  var BUCKETS = [
    ['layout', ['flex', 'grid', 'hidden', 'block', 'inline', 'table', 'contents', 'absolute', 'relative', 'fixed', 'sticky', 'static', 'container', 'overflow', 'visible', 'invisible', 'z-', 'order-', 'col-', 'row-', 'inset-', 'top-', 'right-', 'bottom-', 'left-', 'float-', 'clear-', 'box-']],
    ['flexgrid', ['justify-', 'items-', 'content-', 'self-', 'place-', 'gap-', 'basis-', 'grow', 'shrink', 'auto-cols-', 'auto-rows-']],
    ['spacing', ['m-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-', '-m', 'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-', 'space-', 'w-', 'min-w-', 'max-w-', 'h-', 'min-h-', 'max-h-']],
    ['typography', ['font-', 'text-', 'leading-', 'tracking-', 'whitespace-', 'break-', 'uppercase', 'lowercase', 'capitalize', 'normal-case', 'italic', 'not-italic', 'list-', 'align-', 'indent-', 'underline', 'overline', 'line-through', 'no-underline']],
    ['color', ['bg-', 'from-', 'via-', 'to-', 'border', 'ring', 'fill-', 'stroke-', 'accent-', 'caret-', 'outline', 'shadow', 'decoration-', 'divide-']],
    ['effects', ['opacity-', 'transition', 'duration-', 'ease-', 'delay-', 'animate-', 'transform', 'translate-', 'rotate-', 'scale-', 'skew-', 'origin-', 'filter', 'blur-', 'brightness-', 'contrast-', 'grayscale', 'sepia', 'saturate-', 'invert', 'hue-rotate-', 'drop-shadow', 'backdrop-']],
    ['misc', ['cursor-', 'pointer-events-', 'select-', 'resize-', 'object-', 'aspect-', 'sr-only', 'visible']],
  ];
  function bucketFor(base) {
    for (var i = 0; i < BUCKETS.length; i++) {
      var arr = BUCKETS[i][1];
      for (var j = 0; j < arr.length; j++) { var p = arr[j]; if (base === p || base.indexOf(p) === 0) return BUCKETS[i][0]; }
    }
    if (base.indexOf('[') !== -1) return 'arbitrary';
    return 'misc';
  }
  function tokenizeClass(cls) {
    var neg = cls.charAt(0) === '-';
    var body = neg ? cls.slice(1) : cls;
    var parts = body.split(':');
    var base = parts.pop();
    var html = neg ? '<span class="tok-punc">-</span>' : '';
    parts.forEach(function (v) { html += '<span class="tok-variant">' + escapeHtml(v) + ':</span>'; });
    var bucket = base.indexOf('[') !== -1 ? 'arbitrary' : bucketFor(base);
    html += '<span class="tok-' + bucket + '">' + escapeHtml(base) + '</span>';
    return html;
  }
  function highlightClassList(classes) {
    if (!classes.length) return '<span class="ctw-output-empty">(no utilities generated)</span>';
    return classes.map(tokenizeClass).join(' ');
  }
  function buildOutputHTML(blocks, currentMode) {
    if (!blocks.length) return '<span class="ctw-output-empty">Paste CSS on the left, or load the sample, to see Tailwind classes here.</span>';
    if (currentMode === 'plain') {
      return blocks.map(function (b) {
        return '<span class="tok-cmt">/* ' + escapeHtml(b.selector) + ' */</span>\n' + highlightClassList(b.classes);
      }).join('\n\n');
    }
    var attr = (currentMode === 'jsx' || currentMode === 'tsx') ? 'className' : 'class';
    function cmt(text) {
      if (currentMode === 'jsx' || currentMode === 'tsx') return '<span class="tok-cmt">{/* ' + escapeHtml(text) + ' */}</span>';
      if (currentMode === 'blade') return '<span class="tok-cmt">{{-- ' + escapeHtml(text) + ' --}}</span>';
      return '<span class="tok-cmt">&lt;!-- ' + escapeHtml(text) + ' --&gt;</span>';
    }
    return blocks.map(function (b) {
      var tag = '<span class="tok-punc">&lt;</span><span class="tok-atrule">div</span> <span class="tok-prop">' + attr + '</span><span class="tok-punc">=</span><span class="tok-str">"</span>' +
        highlightClassList(b.classes) + '<span class="tok-str">"</span><span class="tok-punc">&gt;&lt;/</span><span class="tok-atrule">div</span><span class="tok-punc">&gt;</span>';
      return cmt(b.selector) + '\n' + tag;
    }).join('\n\n');
  }

  // ---------------- Export tabs ----------------
  engine.EXPORT_MODES.forEach(function (m, idx) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = m.label; btn.dataset.mode = m.id;
    btn.className = idx === 0 ? 'is-active' : '';
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', function () {
      mode = m.id;
      Array.from(els.exportTabs.children).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      renderOutput();
    });
    els.exportTabs.appendChild(btn);
  });

  // ---------------- Conversion pipeline ----------------
  var debounceTimer = null;
  function scheduleConvert() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(convert, 180);
  }
  function convert() {
    var css = els.input.value;
    lastResult = engine.convertStylesheet(css, { sort: els.sortToggle.checked, version: version });
    renderOutput();
    renderStats();
    renderWarnings();
    renderVars();
    try { localStorage.setItem(STORAGE_KEY, css); } catch (e) { /* storage unavailable */ }
  }
  function renderOutput() {
    els.output.innerHTML = buildOutputHTML(lastResult.blocks, mode);
  }
  function renderStats() {
    var s = lastResult.stats || {};
    els.statRules.textContent = s.rules || 0;
    els.statClasses.textContent = s.classes || 0;
    els.statArbitrary.textContent = s.arbitrary || 0;
    els.statVars.textContent = (lastResult.cssVars || []).length;
  }
  function renderWarnings() {
    var w = lastResult.warnings || [];
    els.warnCount.textContent = String(w.length);
    els.warnCount.classList.toggle('is-zero', w.length === 0);
    if (!w.length) { els.warningsList.innerHTML = '<li>No warnings — everything mapped cleanly.</li>'; return; }
    var seen = {};
    els.warningsList.innerHTML = w.filter(function (item) {
      var key = item.type + '|' + item.message;
      if (seen[key]) return false;
      seen[key] = true; return true;
    }).slice(0, 60).map(function (item) { return '<li>' + escapeHtml(item.message) + '</li>'; }).join('');
  }
  function renderVars() {
    var vars = lastResult.cssVars || [];
    if (!vars.length) { els.varsPanel.classList.remove('is-visible'); els.varsList.innerHTML = ''; return; }
    els.varsPanel.classList.add('is-visible');
    var seen = {};
    els.varsList.innerHTML = vars.filter(function (v) { if (seen[v.name]) return false; seen[v.name] = true; return true; })
      .map(function (v) { return '<li><b>' + escapeHtml(v.name) + '</b><span>: ' + escapeHtml(v.value) + '</span></li>'; }).join('');
  }

  function onInputChanged() {
    updateLineNumbers();
    autosizeInput();
    syncHighlight();
    var chars = els.input.value.length, lines = lastLineCount;
    els.inputStats.textContent = lines + ' line' + (lines === 1 ? '' : 's') + ' · ' + chars + ' char' + (chars === 1 ? '' : 's');
    scheduleConvert();
  }
  els.input.addEventListener('input', onInputChanged);
  els.input.addEventListener('scroll', function () {
    els.inputHighlight.scrollLeft = els.input.scrollLeft;
  });
  window.addEventListener('resize', function () { autosizeInput(); });

  // ---------------- Toolbar actions ----------------
  var SAMPLE_CSS = '.card {\n' +
    '  display: flex;\n' +
    '  flex-direction: column;\n' +
    '  gap: 16px;\n' +
    '  width: 320px;\n' +
    '  padding: 24px;\n' +
    '  margin: 0 auto;\n' +
    '  background-color: #ffffff;\n' +
    '  border: 1px solid #e5e7eb;\n' +
    '  border-radius: 12px;\n' +
    '  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);\n' +
    '}\n\n' +
    '.card-title {\n' +
    '  font-size: 20px;\n' +
    '  font-weight: 700;\n' +
    '  color: #111827;\n' +
    '  line-height: 1.25;\n' +
    '}\n\n' +
    '.card-button {\n' +
    '  display: inline-flex;\n' +
    '  align-items: center;\n' +
    '  justify-content: center;\n' +
    '  padding: 8px 16px;\n' +
    '  border-radius: 8px;\n' +
    '  background-color: #3b82f6;\n' +
    '  color: #ffffff;\n' +
    '  font-weight: 600;\n' +
    '  transition: background-color 0.2s ease;\n' +
    '}\n\n' +
    '.card-button:hover {\n' +
    '  background-color: #2563eb;\n' +
    '}\n\n' +
    '@media (min-width: 768px) {\n' +
    '  .card {\n' +
    '    width: 480px;\n' +
    '    flex-direction: row;\n' +
    '  }\n' +
    '}\n\n' +
    '@media (prefers-color-scheme: dark) {\n' +
    '  .card {\n' +
    '    background-color: #1f2937;\n' +
    '  }\n' +
    '}\n';

  function setInputValue(text) {
    els.input.value = text;
    onInputChanged();
  }
  els.sampleBtn.addEventListener('click', function () { setInputValue(SAMPLE_CSS); });
  els.clearBtn.addEventListener('click', function () { setInputValue(''); });
  els.fileInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { setInputValue(String(reader.result || '')); };
    reader.readAsText(file);
    e.target.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (evt) { els.inputWrap.addEventListener(evt, function (e) { e.preventDefault(); }); });
  els.inputWrap.addEventListener('drop', function (e) {
    e.preventDefault();
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { setInputValue(String(reader.result || '')); };
    reader.readAsText(file);
  });

  els.v3Btn.addEventListener('click', function () { version = 'v3'; els.v3Btn.classList.add('is-active'); els.v4Btn.classList.remove('is-active'); convert(); });
  els.v4Btn.addEventListener('click', function () { version = 'v4'; els.v4Btn.classList.add('is-active'); els.v3Btn.classList.remove('is-active'); convert(); });
  els.sortToggle.addEventListener('change', convert);

  // ---------------- Copy / download ----------------
  els.copyBtn.addEventListener('click', function () {
    var text = engine.renderExport(lastResult.blocks, mode);
    if (!text) return;
    navigator.clipboard.writeText(text).catch(function () {});
  });
  els.downloadBtn.addEventListener('click', function () {
    var text = engine.renderExport(lastResult.blocks, mode);
    if (!text) return;
    var ext = { plain: 'txt', html: 'html', jsx: 'jsx', tsx: 'tsx', vue: 'vue', svelte: 'svelte', angular: 'html', blade: 'blade.php', astro: 'astro' }[mode] || 'txt';
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'tailwind-output.' + ext;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // ---------------- Search / replace ----------------
  els.searchToggle.addEventListener('click', function () {
    els.searchBar.classList.toggle('is-visible');
    if (els.searchBar.classList.contains('is-visible')) els.searchTerm.focus();
  });
  var lastSearchIndex = -1;
  els.searchNext.addEventListener('click', function () {
    var term = els.searchTerm.value;
    if (!term) return;
    var val = els.input.value;
    var from = lastSearchIndex >= 0 ? lastSearchIndex + term.length : (els.input.selectionEnd || 0);
    var idx = val.indexOf(term, from);
    if (idx === -1) idx = val.indexOf(term, 0);
    if (idx === -1) return;
    lastSearchIndex = idx;
    els.input.focus();
    els.input.setSelectionRange(idx, idx + term.length);
    var before = val.slice(0, idx);
    var lineNum = (before.match(/\n/g) || []).length;
    var approxTop = lineNum * 20.2 - els.inputScroll.clientHeight / 2;
    els.inputScroll.scrollTop = Math.max(0, approxTop);
  });
  els.replaceAll.addEventListener('click', function () {
    var term = els.searchTerm.value;
    if (!term) return;
    var repl = els.replaceTerm.value;
    var esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    setInputValue(els.input.value.split(new RegExp(esc, 'g')).join(repl));
  });

  // ---------------- Fullscreen ----------------
  function toggleFullscreen(wrapEl) {
    wrapEl.classList.toggle('is-fullscreen');
    autosizeInput();
  }
  els.inputFullscreen.addEventListener('click', function () { toggleFullscreen(els.inputWrap); });
  els.outputFullscreen.addEventListener('click', function () { toggleFullscreen(els.outputWrap); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      els.inputWrap.classList.remove('is-fullscreen');
      els.outputWrap.classList.remove('is-fullscreen');
    }
  });

  // ---------------- Sticky bar / CTA ----------------
  function scrollToInput() {
    els.input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    els.input.focus();
  }
  els.stickyBtn.addEventListener('click', scrollToInput);
  document.querySelectorAll('[data-ctw-scroll-input]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); scrollToInput(); }); });
  els.sticky.classList.add('is-visible');

  // ---------------- Init ----------------
  var saved = '';
  try { saved = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { /* no-op */ }
  setInputValue(saved || SAMPLE_CSS);
})();
