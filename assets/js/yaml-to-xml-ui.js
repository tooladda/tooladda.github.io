/* ToolAdda — YAML to XML Converter UI wiring.
   Depends on window.YamlToXmlEngine (assets/js/yaml-to-xml.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-y2x-page')) return;
  const Engine = window.YamlToXmlEngine;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const AUTO_CONVERT_LIMIT = 350 * 1024;
  const STORAGE_KEY = 'tooladda:y2x:options';

  const SAMPLE_YAML = `# ToolAdda sample — company + product catalog
company:
  name: ToolAdda Labs
  founded: 2023
  active: true
  website: "https://tooladda.online"
  hq:
    city: Pune
    country: India
tags:
  - developer-tools
  - privacy-first
  - browser-based
products:
  - "@id": "P-100"
    name: DevKit Pro
    price: 29.99
    inStock: true
    features:
      - offline mode
      - fast sync
  - "@id": "P-200"
    name: DevKit Lite
    price: 0
    inStock: false
    features: []
description: |
  Multi-line text (a YAML literal block scalar)
  is preserved as element text content in the
  generated XML, line breaks and all.
support: null
`;

  const els = {
    input: $('y2xYamlInput'),
    dropZone: $('y2xDropZone'),
    fileInput: $('y2xFileInput'),
    sampleBtn: $('y2xSampleBtn'),
    clearBtn: $('y2xClearBtn'),
    wrapBtn: $('y2xWrapBtn'),

    validationStatus: $('y2xValidationStatus'),
    validationMessage: $('y2xValidationMessage'),
    warningsList: $('y2xWarningsList'),
    autoDetectHint: $('y2xAutoDetectHint'),

    statChars: $('y2xStatChars'),
    statKeys: $('y2xStatKeys'),
    statMaps: $('y2xStatMaps'),
    statSeqs: $('y2xStatSeqs'),
    statDepth: $('y2xStatDepth'),
    statOutSize: $('y2xStatOutSize'),
    statTime: $('y2xStatTime'),

    rootName: $('y2xRootName'),
    arrayItemMode: $('y2xArrayItemMode'),
    arrayItemName: $('y2xArrayItemName'),
    indent: $('y2xIndent'),
    includeDecl: $('y2xIncludeDecl'),
    xmlVersion: $('y2xXmlVersion'),
    attrPrefix: $('y2xAttrPrefix'),
    textKey: $('y2xTextKey'),
    selfClose: $('y2xSelfClose'),
    preserveComments: $('y2xPreserveComments'),
    addTypeHints: $('y2xAddTypeHints'),
    sanitizeNames: $('y2xSanitizeNames'),
    cdata: $('y2xCdata'),
    minify: $('y2xMinify'),

    convertBtn: $('y2xConvertBtn'),
    stickyConvertBtn: $('y2xStickyConvertBtn'),
    copyBtn: $('y2xCopyBtn'),
    downloadXmlBtn: $('y2xDownloadXmlBtn'),
    downloadTxtBtn: $('y2xDownloadTxtBtn'),
    printBtn: $('y2xPrintBtn'),
    fullscreenBtn: $('y2xFullscreenBtn'),
    viewCodeBtn: $('y2xViewCodeBtn'),
    viewTreeBtn: $('y2xViewTreeBtn'),
    expandAllBtn: $('y2xExpandAllBtn'),
    collapseAllBtn: $('y2xCollapseAllBtn'),

    outputPanel: $('y2xOutputPanel'),
    outputPre: $('y2xOutputPre'),
    outputTree: $('y2xOutputTree'),
    outputEmpty: $('y2xOutputEmpty'),
    wellFormedBadge: $('y2xWellFormedBadge'),
    renamedNotice: $('y2xRenamedNotice'),
  };

  if (!els.input || !els.outputPre) return;

  let lastGoodXml = '';
  let debounceTimer = null;
  let currentView = 'code';

  // ---------------------------------------------------------------------
  // Options
  // ---------------------------------------------------------------------

  function readOptions() {
    const indentValue = els.indent.value;
    return {
      rootName: (els.rootName.value || '').trim() || 'root',
      arrayItemMode: els.arrayItemMode.value,
      arrayItemName: (els.arrayItemName.value || '').trim() || 'item',
      indentSize: indentValue === 'tab' ? 1 : Number(indentValue),
      indentChar: indentValue === 'tab' ? '\t' : ' ',
      includeDeclaration: els.includeDecl.checked,
      xmlVersion: els.xmlVersion.value,
      encoding: 'UTF-8',
      attributePrefix: els.attrPrefix.value || '@',
      textKey: els.textKey.value || '#text',
      selfCloseEmpty: els.selfClose.checked,
      preserveComments: els.preserveComments.checked,
      addTypeHints: els.addTypeHints.checked,
      sanitizeNames: els.sanitizeNames.checked,
      cdataForUnsafeText: els.cdata.checked,
      pretty: !els.minify.checked,
    };
  }

  function persistOptions() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readOptions())); } catch (e) { /* storage unavailable */ }
  }

  function restoreOptions() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return;
    if (saved.rootName) els.rootName.value = saved.rootName;
    if (saved.arrayItemMode) els.arrayItemMode.value = saved.arrayItemMode;
    if (saved.arrayItemName) els.arrayItemName.value = saved.arrayItemName;
    if (saved.indentChar === '\t') els.indent.value = 'tab'; else if (saved.indentSize) els.indent.value = String(saved.indentSize);
    if (typeof saved.includeDeclaration === 'boolean') els.includeDecl.checked = saved.includeDeclaration;
    if (saved.xmlVersion) els.xmlVersion.value = saved.xmlVersion;
    if (saved.attributePrefix) els.attrPrefix.value = saved.attributePrefix;
    if (saved.textKey) els.textKey.value = saved.textKey;
    if (typeof saved.selfCloseEmpty === 'boolean') els.selfClose.checked = saved.selfCloseEmpty;
    if (typeof saved.preserveComments === 'boolean') els.preserveComments.checked = saved.preserveComments;
    if (typeof saved.addTypeHints === 'boolean') els.addTypeHints.checked = saved.addTypeHints;
    if (typeof saved.sanitizeNames === 'boolean') els.sanitizeNames.checked = saved.sanitizeNames;
    if (typeof saved.cdataForUnsafeText === 'boolean') els.cdata.checked = saved.cdataForUnsafeText;
    if (typeof saved.pretty === 'boolean') els.minify.checked = !saved.pretty;
  }

  function syncArrayNameDisabled() {
    els.arrayItemName.disabled = els.arrayItemMode.value === 'auto';
  }

  // ---------------------------------------------------------------------
  // XML syntax highlighting (operates on our own well-formed generated XML)
  // ---------------------------------------------------------------------

  function htmlEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightXml(xml) {
    let out = htmlEscape(xml);
    out = out.replace(/&lt;\?xml[\s\S]*?\?&gt;/, (m) => `<span class="tok-decl">${m}</span>`);
    out = out.replace(/&lt;!--[\s\S]*?--&gt;/g, (m) => `<span class="tok-comment">${m}</span>`);
    out = out.replace(/&lt;!\[CDATA\[[\s\S]*?\]\]&gt;/g, (m) => `<span class="tok-cdata">${m}</span>`);
    out = out.replace(/&lt;(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)&gt;/g, (m, close, tag, attrs, selfClose) => {
      let attrHtml = '';
      if (attrs) {
        attrHtml = attrs.replace(/([\w:.-]+)(=)("[^"]*")/g, (am, an, eq, av) =>
          `<span class="tok-attrname">${an}</span>${eq}<span class="tok-attrvalue">${av}</span>`);
      }
      return `<span class="tok-punct">&lt;${close}</span><span class="tok-tagname">${tag}</span>${attrHtml}<span class="tok-punct">${selfClose}&gt;</span>`;
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // Tree view (built from the generated XML via DOMParser — single source
  // of truth so the tree always matches the code view exactly)
  // ---------------------------------------------------------------------

  function buildTree(xmlString) {
    els.outputTree.innerHTML = '';
    let doc;
    try {
      doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    } catch (e) {
      els.outputTree.textContent = 'Could not build tree view.';
      return;
    }
    const perr = doc.querySelector('parsererror');
    if (perr) {
      els.outputTree.textContent = 'Generated XML is not well-formed — cannot render tree view.';
      return;
    }
    const root = doc.documentElement;
    if (!root) { els.outputTree.textContent = 'Nothing to display yet.'; return; }
    els.outputTree.appendChild(renderTreeNode(root));
  }

  function renderTreeNode(el) {
    const childElements = Array.from(el.childNodes).filter((n) => n.nodeType === 1);
    const attrs = Array.from(el.attributes || []);
    const openTag = document.createElement('span');
    openTag.className = 'y2x-tree-tag';
    openTag.innerHTML = `&lt;${el.tagName}${attrs.map((a) => ` <span class="y2x-tree-attr">${a.name}=&quot;${htmlEscape(a.value)}&quot;</span>`).join('')}&gt;`;

    if (!childElements.length) {
      const li = document.createElement('div');
      li.className = 'y2x-tree-leaf';
      const text = (el.textContent || '').trim();
      li.appendChild(openTag);
      if (text) {
        const span = document.createElement('span');
        span.className = 'y2x-tree-text';
        span.textContent = text;
        li.appendChild(span);
      }
      const close = document.createElement('span');
      close.className = 'y2x-tree-tag';
      close.textContent = `</${el.tagName}>`;
      li.appendChild(close);
      return li;
    }

    const details = document.createElement('details');
    details.open = true;
    details.className = 'y2x-tree-node';
    const summary = document.createElement('summary');
    summary.appendChild(openTag);
    details.appendChild(summary);
    const list = document.createElement('div');
    list.className = 'y2x-tree-children';
    childElements.forEach((child) => list.appendChild(renderTreeNode(child)));
    details.appendChild(list);
    return details;
  }

  // ---------------------------------------------------------------------
  // Validation / status rendering
  // ---------------------------------------------------------------------

  function setStatus(kind, message) {
    els.validationStatus.className = 'y2x-badge-status y2x-badge-' + kind;
    els.validationStatus.textContent = kind === 'ok' ? 'Valid' : kind === 'error' ? 'Error' : kind === 'warn' ? 'Warnings' : 'Empty';
    els.validationMessage.textContent = message;
  }

  function renderWarnings(list) {
    els.warningsList.innerHTML = '';
    if (!list || !list.length) { els.warningsList.hidden = true; return; }
    els.warningsList.hidden = false;
    list.forEach((w) => {
      const li = document.createElement('li');
      li.textContent = w.line ? `Line ${w.line}: ${w.message}` : w.message;
      els.warningsList.appendChild(li);
    });
  }

  function renderRenamed(renamed) {
    if (!renamed || !renamed.length) { els.renamedNotice.hidden = true; return; }
    els.renamedNotice.hidden = false;
    const unique = renamed.slice(0, 6).map((r) => `"${r.from}" → "${r.to}"`).join(', ');
    els.renamedNotice.textContent = `${renamed.length} element/attribute name${renamed.length > 1 ? 's' : ''} adjusted to be valid XML: ${unique}${renamed.length > 6 ? '…' : ''}`;
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    return `${(n / 1024).toFixed(1)} KB`;
  }

  // ---------------------------------------------------------------------
  // Auto-detect: gently flag JSON pasted by mistake
  // ---------------------------------------------------------------------

  function checkAutoDetect(text) {
    const t = text.trim();
    if (!t) { els.autoDetectHint.hidden = true; return; }
    if ((t.charAt(0) === '{' || t.charAt(0) === '[') ) {
      try {
        JSON.parse(t);
        els.autoDetectHint.hidden = false;
        els.autoDetectHint.innerHTML = 'This looks like JSON, not YAML — try the <a href="json-to-yaml.html">JSON to YAML</a> or <a href="../json-to-xml-converter.html">JSON to XML</a> converter instead.';
        return;
      } catch (e) { /* not valid JSON either, fall through */ }
    }
    els.autoDetectHint.hidden = true;
  }

  // ---------------------------------------------------------------------
  // Core conversion pipeline
  // ---------------------------------------------------------------------

  function showEmptyState() {
    els.outputEmpty.hidden = false;
    els.outputPre.hidden = true;
    els.outputTree.hidden = true;
    els.wellFormedBadge.hidden = true;
    setStatus('idle', 'Paste, upload, or drop YAML to begin.');
    renderWarnings([]);
    renderRenamed([]);
    ['statKeys', 'statMaps', 'statSeqs', 'statDepth', 'statOutSize', 'statTime'].forEach((k) => { els[k].textContent = '—'; });
    els.statChars.textContent = '0';
    lastGoodXml = '';
  }

  function applyView() {
    if (currentView === 'code') {
      els.outputPre.hidden = false;
      els.outputTree.hidden = true;
      els.viewCodeBtn.classList.add('is-active');
      els.viewTreeBtn.classList.remove('is-active');
    } else {
      els.outputPre.hidden = true;
      els.outputTree.hidden = false;
      els.viewCodeBtn.classList.remove('is-active');
      els.viewTreeBtn.classList.add('is-active');
      if (lastGoodXml) buildTree(lastGoodXml);
    }
  }

  function runConvert() {
    const text = els.input.value;
    els.statChars.textContent = String(text.length);
    checkAutoDetect(text);

    if (!text.trim()) { showEmptyState(); return; }

    const t0 = performance.now();
    let parsed;
    try {
      parsed = Engine.parseYaml(text);
    } catch (e) {
      setStatus('error', e.line ? `Line ${e.line}: ${e.message}` : e.message);
      renderWarnings([]);
      return;
    }

    let resolved;
    try {
      resolved = Engine.resolveAst(parsed.ast, parsed.anchors, parsed.warnings);
    } catch (e) {
      setStatus('error', e.line ? `Line ${e.line}: ${e.message}` : e.message);
      renderWarnings(parsed.warnings);
      return;
    }

    const stats = Engine.computeStats(resolved);
    const options = readOptions();
    let result;
    try {
      result = Engine.toXml(resolved, options);
    } catch (e) {
      setStatus('error', e.message);
      return;
    }
    const elapsed = performance.now() - t0;

    els.outputEmpty.hidden = true;
    els.outputPre.innerHTML = highlightXml(result.xml);
    lastGoodXml = result.xml;

    const doc = new DOMParser().parseFromString(result.xml, 'application/xml');
    const wellFormed = !doc.querySelector('parsererror');
    els.wellFormedBadge.hidden = false;
    els.wellFormedBadge.textContent = wellFormed ? '✓ Well-formed XML' : '✕ Not well-formed';
    els.wellFormedBadge.className = 'y2x-wf-badge ' + (wellFormed ? 'is-ok' : 'is-bad');

    applyView();

    els.statKeys.textContent = String(stats.keys);
    els.statMaps.textContent = String(stats.maps);
    els.statSeqs.textContent = String(stats.seqs);
    els.statDepth.textContent = String(stats.maxDepth);
    els.statOutSize.textContent = formatBytes(result.xml.length);
    els.statTime.textContent = `${elapsed.toFixed(1)} ms`;

    renderWarnings(parsed.warnings);
    renderRenamed(result.renamed);

    if (parsed.warnings.length) setStatus('warn', `Converted with ${parsed.warnings.length} warning${parsed.warnings.length > 1 ? 's' : ''}.`);
    else setStatus('ok', 'YAML converted to XML successfully.');
  }

  function scheduleConvert() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (els.input.value.length > AUTO_CONVERT_LIMIT) {
      setStatus('idle', 'Large input detected — click Convert to generate XML.');
      return;
    }
    debounceTimer = setTimeout(runConvert, 180);
  }

  // ---------------------------------------------------------------------
  // File upload / drag & drop
  // ---------------------------------------------------------------------

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.input.value = String(reader.result || '');
      scheduleConvert();
      if (els.input.value.length <= AUTO_CONVERT_LIMIT) setTimeout(revealOutput, 320);
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Mobile layout: output ko input ke paas lao
  // ---------------------------------------------------------------------
  // < 1040px par dono editor column ek ke neeche ek aate hain. Input column me stats
  // aur options panel bhi hain, to output ~2000px neeche chala jata tha aur Convert
  // dabane par screen par kuch badalta nahi dikhta tha. Mobile par stats + options
  // output ke baad chale jate hain (options band), aur convert/paste/sample/upload ke
  // baad output tak scroll hota hai. Desktop par sab apni jagah wapas.

  const mobileMq = window.matchMedia('(max-width: 1039px)');
  const statsGrid = document.querySelector('.y2x-stats-grid');
  const optionsPanel = document.querySelector('.y2x-options');
  const statsHome = statsGrid && { parent: statsGrid.parentElement, next: statsGrid.nextElementSibling };
  const optionsHome = optionsPanel && { parent: optionsPanel.parentElement, next: optionsPanel.nextElementSibling };
  let optionsClosedForMobile = false;

  function placeForViewport() {
    if (!statsGrid || !optionsPanel || !els.outputPanel) return;
    if (mobileMq.matches) {
      els.outputPanel.after(statsGrid, optionsPanel);
      if (!optionsClosedForMobile) { optionsPanel.open = false; optionsClosedForMobile = true; }
    } else {
      statsHome.parent.insertBefore(statsGrid, statsHome.next);
      optionsHome.parent.insertBefore(optionsPanel, optionsHome.next);
    }
  }

  function revealOutput() {
    if (!mobileMq.matches || !els.outputPanel) return;
    const top = els.outputPanel.getBoundingClientRect().top;
    if (top > 0 && top < window.innerHeight * 0.5) return; // pehle se dikh raha hai
    els.outputPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function init() {
    restoreOptions();
    syncArrayNameDisabled();
    showEmptyState();
    placeForViewport();
    if (mobileMq.addEventListener) mobileMq.addEventListener('change', placeForViewport);
    else if (mobileMq.addListener) mobileMq.addListener(placeForViewport);

    els.input.addEventListener('input', scheduleConvert);
    els.input.addEventListener('paste', () => {
      setTimeout(() => { if (els.input.value.trim() && els.input.value.length <= AUTO_CONVERT_LIMIT) revealOutput(); }, 320);
    });

    els.sampleBtn.addEventListener('click', () => { els.input.value = SAMPLE_YAML; runConvert(); revealOutput(); });
    els.clearBtn.addEventListener('click', () => { els.input.value = ''; els.input.focus(); showEmptyState(); });
    els.wrapBtn.addEventListener('click', () => {
      const wrapped = els.input.classList.toggle('is-nowrap');
      els.wrapBtn.setAttribute('aria-pressed', String(wrapped));
      els.wrapBtn.textContent = wrapped ? '↔️ Wrap: Off' : '↔️ Wrap: On';
    });

    els.fileInput.addEventListener('change', (e) => loadFile(e.target.files && e.target.files[0]));
    ['dragover', 'dragenter'].forEach((ev) => els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.add('is-dragover'); }));
    ['dragleave', 'dragend'].forEach((ev) => els.dropZone.addEventListener(ev, () => els.dropZone.classList.remove('is-dragover')));
    els.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropZone.classList.remove('is-dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    [els.rootName, els.arrayItemName, els.attrPrefix, els.textKey].forEach((el) => el.addEventListener('input', () => { persistOptions(); scheduleConvert(); }));
    [els.arrayItemMode, els.indent, els.xmlVersion].forEach((el) => el.addEventListener('change', () => { syncArrayNameDisabled(); persistOptions(); scheduleConvert(); }));
    [els.includeDecl, els.selfClose, els.preserveComments, els.addTypeHints, els.sanitizeNames, els.cdata, els.minify].forEach((el) => el.addEventListener('change', () => { persistOptions(); scheduleConvert(); }));

    const doConvertNow = () => { if (debounceTimer) clearTimeout(debounceTimer); runConvert(); };
    // Button se convert: mobile par result dikhao; input khali ho to input par le jao.
    const convertAndShow = () => {
      if (!els.input.value.trim()) {
        if (mobileMq.matches) els.input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        els.input.focus({ preventScroll: true });
        return;
      }
      doConvertNow();
      revealOutput();
    };
    els.convertBtn.addEventListener('click', convertAndShow);
    if (els.stickyConvertBtn) els.stickyConvertBtn.addEventListener('click', convertAndShow);

    els.copyBtn.addEventListener('click', async () => {
      if (!lastGoodXml) return;
      try {
        await navigator.clipboard.writeText(lastGoodXml);
        const original = els.copyBtn.textContent;
        els.copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { els.copyBtn.textContent = original; }, 1500);
      } catch (e) { /* clipboard unavailable */ }
    });

    function download(filename, content, mime) {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    els.downloadXmlBtn.addEventListener('click', () => { if (lastGoodXml) download('converted.xml', lastGoodXml, 'application/xml'); });
    els.downloadTxtBtn.addEventListener('click', () => { if (lastGoodXml) download('converted.txt', lastGoodXml, 'text/plain'); });
    els.printBtn.addEventListener('click', () => { if (lastGoodXml) window.print(); });

    els.fullscreenBtn.addEventListener('click', () => {
      const isFs = document.body.classList.toggle('y2x-output-fullscreen');
      els.fullscreenBtn.setAttribute('aria-pressed', String(isFs));
      els.fullscreenBtn.textContent = isFs ? '⤢ Exit Fullscreen' : '⛶ Fullscreen';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('y2x-output-fullscreen')) {
        document.body.classList.remove('y2x-output-fullscreen');
        els.fullscreenBtn.setAttribute('aria-pressed', 'false');
        els.fullscreenBtn.textContent = '⛶ Fullscreen';
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doConvertNow(); }
    });

    els.viewCodeBtn.addEventListener('click', () => { currentView = 'code'; applyView(); });
    els.viewTreeBtn.addEventListener('click', () => { currentView = 'tree'; applyView(); });
    els.expandAllBtn.addEventListener('click', () => els.outputTree.querySelectorAll('details').forEach((d) => { d.open = true; }));
    els.collapseAllBtn.addEventListener('click', () => els.outputTree.querySelectorAll('details').forEach((d) => { d.open = false; }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
