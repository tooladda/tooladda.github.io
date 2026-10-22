/* ==========================================================================
   ToolAdda — CSS Neumorphic Element Designer (studio UI)

   Wires the control panel, live preview, contrast audit and code panel to the
   pure state machine in neumorphism-engine.js.

   The preview surface is painted with the SAME colour as the element, because
   that is the whole premise of the style — a preview on a contrasting
   background would flatter the design and lie about the result.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.NeumorphismEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-neumorphic-design';
  var HISTORY_LIMIT = 60;

  var state = E.defaultState();
  var history = { past: [], future: [] };
  var lastCommitted = null;
  var dom = {};
  var previewStyleEl = null;
  var frame = 0;
  var statusTimer = 0;
  var saveTimer = 0;

  /* ======================================================================
     Helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }

  function status(message, tone) {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.dataset.tone = tone || 'info';
    dom.status.hidden = false;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { dom.status.hidden = true; }, 2600);
  }

  function announce(message) { if (dom.live) dom.live.textContent = message; }

  function copyText(value, label) {
    function good() { status(label + ' ✓', 'good'); }
    function bad() { status('Clipboard blocked — select the code and copy manually.', 'bad'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(good, function () { legacyCopy(value) ? good() : bad(); });
    } else {
      legacyCopy(value) ? good() : bad();
    }
  }

  function legacyCopy(value) {
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) { return false; }
  }

  function download(content, filename, mime) {
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  /* ======================================================================
     History
     ====================================================================== */

  function commit() {
    if (!lastCommitted) { lastCommitted = E.cloneState(state); return; }
    if (JSON.stringify(lastCommitted) === JSON.stringify(state)) return;
    history.past.push(lastCommitted);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future.length = 0;
    lastCommitted = E.cloneState(state);
    syncHistoryButtons();
  }

  function undo() {
    if (!history.past.length) { status('Nothing to undo.', 'info'); return; }
    history.future.push(E.cloneState(state));
    state = E.normalize(history.past.pop());
    lastCommitted = E.cloneState(state);
    syncControls(); render(); syncHistoryButtons();
    announce('Undone.');
  }

  function redo() {
    if (!history.future.length) { status('Nothing to redo.', 'info'); return; }
    history.past.push(E.cloneState(state));
    state = E.normalize(history.future.pop());
    lastCommitted = E.cloneState(state);
    syncControls(); render(); syncHistoryButtons();
    announce('Redone.');
  }

  function syncHistoryButtons() {
    if (dom.undo) dom.undo.disabled = !history.past.length;
    if (dom.redo) dom.redo.disabled = !history.future.length;
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      updateSurface();
      updatePreview();
      renderCode();
      updateInspector();
      updateAudit();
      updateControlVisibility();
      scheduleSave();
    });
  }

  /** The stage must be the element's own colour or the effect is a lie. */
  function updateSurface() {
    if (dom.stage) dom.stage.style.background = state.surface;
    if (dom.surfaceChip) dom.surfaceChip.textContent = state.surface;
  }

  function updatePreview() {
    if (!dom.canvas) return;
    if (!previewStyleEl) {
      previewStyleEl = document.createElement('style');
      previewStyleEl.id = 'neuPreviewStyle';
      document.head.appendChild(previewStyleEl);
    }
    previewStyleEl.textContent = E.generateCSS(state, { scope: '#neuCanvas' });

    while (dom.canvas.firstChild) dom.canvas.removeChild(dom.canvas.firstChild);
    var node = E.renderToDOM(E.buildTree(state), document);
    if (node) dom.canvas.appendChild(node);
  }

  function renderCode() {
    var html = E.generateHTML(state);
    var css = E.generateCSS(state, { includeSurface: dom.includeSurface && dom.includeSurface.checked });
    if (dom.htmlCode) dom.htmlCode.textContent = html;
    if (dom.cssCode) dom.cssCode.textContent = css;
    if (dom.htmlSize) dom.htmlSize.textContent = html.split('\n').length + ' lines';
    if (dom.cssSize) dom.cssSize.textContent = css.split('\n').length + ' lines';
  }

  function updateInspector() {
    if (!dom.inspector) return;
    while (dom.inspector.firstChild) dom.inspector.removeChild(dom.inspector.firstChild);
    E.inspectProperties(state).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'neu-inspect__row';
      var k = document.createElement('span');
      k.className = 'neu-inspect__prop';
      k.textContent = item.prop;
      var v = document.createElement('span');
      v.className = 'neu-inspect__val';
      v.textContent = item.value;
      row.appendChild(k); row.appendChild(v);
      dom.inspector.appendChild(row);
    });
  }

  /** The honest part: report the real contrast rather than hiding it. */
  function updateAudit() {
    if (!dom.auditList) return;
    var result = E.audit(state);

    if (dom.auditRatio) dom.auditRatio.textContent = result.textRatio + ':1';
    if (dom.auditBadge) {
      var label = result.passesAAA ? 'AAA' : (result.passesAA ? 'AA' : (result.passesAALarge ? 'AA large only' : 'Fails AA'));
      dom.auditBadge.textContent = label;
      dom.auditBadge.dataset.level = result.passesAA ? 'pass' : (result.passesAALarge ? 'warn' : 'fail');
    }

    while (dom.auditList.firstChild) dom.auditList.removeChild(dom.auditList.firstChild);
    result.notes.forEach(function (note) {
      var li = document.createElement('li');
      li.className = 'neu-audit__note';
      li.dataset.level = note.level;
      li.textContent = note.text;
      dom.auditList.appendChild(li);
    });
  }

  function updateControlVisibility() {
    all('[data-for-element]').forEach(function (el) {
      el.hidden = el.getAttribute('data-for-element').split(/\s+/).indexOf(state.element) === -1;
    });
    all('[data-advanced]').forEach(function (el) { el.hidden = state.mode !== 'advanced'; });
    all('[data-for-shape]').forEach(function (el) {
      el.hidden = el.getAttribute('data-for-shape').split(/\s+/).indexOf(state.shape) === -1;
    });

    pressGroup(dom.elementButtons, 'element', state.element);
    pressGroup(dom.modeButtons, 'mode', state.mode);
    pressGroup(dom.shapeButtons, 'shape', state.shape);
    pressGroup(dom.lightButtons, 'light', state.lightSource);

    if (dom.autoColorNote) dom.autoColorNote.hidden = !state.typography.autoColor;
    if (dom.textColorField) dom.textColorField.hidden = state.typography.autoColor;
  }

  function pressGroup(list, key, value) {
    (list || []).forEach(function (btn) {
      var active = btn.dataset[key] === value;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
  }

  /* ======================================================================
     Controls
     ====================================================================== */

  function getPath(path) {
    return path.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, state);
  }

  function setPath(path, value) {
    var parts = path.split('.');
    var last = parts.pop();
    parts.reduce(function (o, k) { return o[k]; }, state)[last] = value;
  }

  function outputFor(input) {
    var wrap = input.closest('.neu-field');
    return wrap ? wrap.querySelector('output') : null;
  }

  function controlScale(input) {
    var s = parseFloat(input.dataset.scale);
    return isFinite(s) && s !== 0 ? s : 1;
  }

  function syncOutput(input) {
    var out = outputFor(input);
    if (out) out.textContent = input.value + (input.dataset.suffix || '');
  }

  function bindControls() {
    all('[data-path]').forEach(function (input) {
      var path = input.getAttribute('data-path');
      var isToggle = input.type === 'checkbox';
      var isChoice = isToggle || input.tagName === 'SELECT';

      function read() {
        if (isToggle) return input.checked;
        if (input.type === 'range' || input.type === 'number') {
          return parseFloat(input.value) / controlScale(input);
        }
        return input.value;
      }

      function apply() {
        setPath(path, read());
        if (path === 'surface') state.surfacePreset = 'custom';
        // Blur below the offset distance makes the shadow look like a hard
        // duplicate rather than depth, so keep the pair sensible in basic mode.
        if (path === 'distance' && state.mode === 'basic') {
          state.blur = Math.round(state.distance * 2);
        }
        state = E.normalize(state);
        syncOutput(input);
        render();
      }

      on(input, isChoice ? 'change' : 'input', apply);
      on(input, 'change', commit);
      syncOutput(input);
    });
  }

  function syncControls() {
    all('[data-path]').forEach(function (input) {
      var value = getPath(input.getAttribute('data-path'));
      if (value === undefined) return;
      if (input.type === 'checkbox') input.checked = !!value;
      else if (input.type === 'range' || input.type === 'number') {
        input.value = String(Math.round(value * controlScale(input) * 1000) / 1000);
      } else input.value = String(value);
      syncOutput(input);
    });
  }

  /* ======================================================================
     Presets & actions
     ====================================================================== */

  function loadStylePreset(id) {
    E.applyStylePreset(state, id);
    state = E.normalize(state);
    commit(); syncControls(); render();
    var p = E.STYLE_PRESETS[id];
    status('Applied ' + (p ? p.label : id), 'good');
  }

  function loadSurfacePreset(id) {
    E.applySurfacePreset(state, id);
    state = E.normalize(state);
    commit(); syncControls(); render();
    var p = E.SURFACE_PRESETS[id];
    status('Surface: ' + (p ? p.label : id), 'good');
  }

  function randomizeDesign() {
    E.randomDesign(state);
    state = E.normalize(state);
    commit(); syncControls(); render();
    status('Randomised ✓', 'good');
  }

  function resetDesigner() {
    var element = state.element;
    state = E.defaultState();
    state.element = element;
    commit(); syncControls(); render();
    status('Reset to the default soft card', 'good');
  }

  /* ======================================================================
     Persistence
     ====================================================================== */

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveDesign(false); }, 600);
  }

  function saveDesign(explicit) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (explicit) status('Saved locally ✓', 'good');
      if (dom.saveHint) dom.saveHint.textContent = 'Saved locally';
    } catch (err) {
      if (explicit) status('Could not save — browser storage is unavailable.', 'bad');
    }
  }

  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) { return null; }
  }

  function offerRestore() {
    var stored = readStored();
    if (!stored || !dom.restoreBar) return;
    dom.restoreBar.hidden = false;
    on(dom.restoreYes, 'click', function () {
      state = E.normalize(stored);
      lastCommitted = E.cloneState(state);
      history.past.length = 0; history.future.length = 0;
      syncControls(); render(); syncHistoryButtons();
      dom.restoreBar.hidden = true;
      status('Previous design restored ✓', 'good');
    });
    on(dom.restoreNo, 'click', function () {
      dom.restoreBar.hidden = true;
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
      status('Starting fresh.', 'info');
    });
  }

  /* ======================================================================
     Export
     ====================================================================== */

  function filename(ext) { return 'neumorphic-' + state.element + '.' + ext; }
  function cssOut() {
    return E.generateCSS(state, { includeSurface: dom.includeSurface && dom.includeSurface.checked });
  }

  function toggleFullscreen(force) {
    var next = force === undefined ? !document.body.classList.contains('neu-fullscreen-on') : force;
    document.body.classList.toggle('neu-fullscreen-on', next);
    if (dom.previewPanel) dom.previewPanel.classList.toggle('is-fullscreen', next);
    if (dom.fullscreen) {
      dom.fullscreen.setAttribute('aria-pressed', next ? 'true' : 'false');
      dom.fullscreen.textContent = next ? 'Exit fullscreen' : 'Fullscreen';
    }
    announce(next ? 'Preview expanded. Press Escape to exit.' : 'Preview restored.');
  }

  function setPane(name) {
    if (!dom.studio) return;
    dom.studio.dataset.pane = name;
    (dom.paneButtons || []).forEach(function (btn) {
      var active = btn.dataset.paneBtn === name;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
  }

  function setCodeTab(name) {
    (dom.codeTabs || []).forEach(function (btn) {
      var active = btn.dataset.codeTab === name;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
    if (dom.htmlPane) dom.htmlPane.hidden = name !== 'html';
    if (dom.cssPane) dom.cssPane.hidden = name !== 'css';
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.studio = $('neuStudio');
    dom.status = $('neuStatus');
    dom.live = $('neuLive');

    dom.stage = $('neuStage');
    dom.canvas = $('neuCanvas');
    dom.previewPanel = $('neuPreviewPanel');
    dom.surfaceChip = $('neuSurfaceChip');

    dom.htmlCode = $('neuHtmlCode');
    dom.cssCode = $('neuCssCode');
    dom.htmlPane = $('neuHtmlPane');
    dom.cssPane = $('neuCssPane');
    dom.htmlSize = $('neuHtmlSize');
    dom.cssSize = $('neuCssSize');
    dom.inspector = $('neuInspector');
    dom.includeSurface = $('neuIncludeSurface');

    dom.auditList = $('neuAuditList');
    dom.auditRatio = $('neuAuditRatio');
    dom.auditBadge = $('neuAuditBadge');

    dom.stylePresetList = $('neuStylePresets');
    dom.surfacePresetList = $('neuSurfacePresets');

    dom.undo = $('neuUndo');
    dom.redo = $('neuRedo');
    dom.reset = $('neuReset');
    dom.randomize = $('neuRandomize');
    dom.fullscreen = $('neuFullscreen');
    dom.saveNow = $('neuSaveNow');
    dom.saveHint = $('neuSaveHint');

    dom.restoreBar = $('neuRestoreBar');
    dom.restoreYes = $('neuRestoreYes');
    dom.restoreNo = $('neuRestoreNo');

    dom.copyHtml = $('neuCopyHtml');
    dom.copyCss = $('neuCopyCss');
    dom.copyAll = $('neuCopyAll');
    dom.downloadHtml = $('neuDownloadHtml');
    dom.downloadCss = $('neuDownloadCss');
    dom.downloadPage = $('neuDownloadPage');

    dom.autoColorNote = $('neuAutoColorNote');
    dom.textColorField = $('neuTextColorField');

    dom.elementButtons = all('[data-element]');
    dom.modeButtons = all('[data-mode]');
    dom.shapeButtons = all('[data-shape]');
    dom.lightButtons = all('[data-light]');
    dom.paneButtons = all('[data-pane-btn]');
    dom.codeTabs = all('[data-code-tab]');
  }

  function buildPresetButtons() {
    if (dom.stylePresetList) {
      E.STYLE_PRESET_IDS.forEach(function (id) {
        var p = E.STYLE_PRESETS[id];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'neu-preset';
        btn.dataset.preset = id;

        var chip = document.createElement('span');
        chip.className = 'neu-preset__chip';
        chip.setAttribute('aria-hidden', 'true');
        var demo = E.normalize(Object.assign(E.defaultState(), p));
        chip.style.background = E.backgroundValue(demo);
        chip.style.borderRadius = Math.min(16, p.radius) + 'px';
        chip.style.boxShadow = E.boxShadowValue(demo);

        var label = document.createElement('span');
        label.className = 'neu-preset__label';
        label.textContent = p.label;

        btn.appendChild(chip);
        btn.appendChild(label);
        btn.addEventListener('click', function () { loadStylePreset(id); });
        dom.stylePresetList.appendChild(btn);
      });
    }

    if (dom.surfacePresetList) {
      E.SURFACE_PRESET_IDS.forEach(function (id) {
        var p = E.SURFACE_PRESETS[id];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'neu-swatch';
        btn.dataset.surfacePreset = id;
        btn.title = p.label;
        btn.setAttribute('aria-label', 'Surface: ' + p.label);
        btn.style.background = p.surface;
        btn.addEventListener('click', function () { loadSurfacePreset(id); });
        dom.surfacePresetList.appendChild(btn);
      });
    }
  }

  function wireButtons() {
    (dom.elementButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.element = btn.dataset.element;
        state = E.normalize(state);
        commit(); syncControls(); render();
        announce('Element switched to ' + btn.textContent.trim() + '.');
      });
    });

    (dom.modeButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.dataset.mode;
        updateControlVisibility();
        announce(btn.dataset.mode + ' mode.');
      });
    });

    (dom.shapeButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.shape = btn.dataset.shape;
        state = E.normalize(state);
        commit(); syncControls(); render();
      });
    });

    (dom.lightButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.lightSource = btn.dataset.light;
        state = E.normalize(state);
        commit(); syncControls(); render();
        announce('Light source: ' + btn.dataset.light.replace('-', ' ') + '.');
      });
    });

    (dom.codeTabs || []).forEach(function (btn) {
      btn.addEventListener('click', function () { setCodeTab(btn.dataset.codeTab); });
    });

    (dom.paneButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () { setPane(btn.dataset.paneBtn); });
      btn.addEventListener('keydown', function (e) {
        if (['ArrowLeft', 'ArrowRight'].indexOf(e.key) === -1) return;
        e.preventDefault();
        var i = dom.paneButtons.indexOf(btn);
        var next = e.key === 'ArrowRight'
          ? (i + 1) % dom.paneButtons.length
          : (i - 1 + dom.paneButtons.length) % dom.paneButtons.length;
        dom.paneButtons[next].focus();
        setPane(dom.paneButtons[next].dataset.paneBtn);
      });
    });

    on(dom.undo, 'click', undo);
    on(dom.redo, 'click', redo);
    on(dom.reset, 'click', resetDesigner);
    on(dom.randomize, 'click', randomizeDesign);
    on(dom.fullscreen, 'click', function () { toggleFullscreen(); });
    on(dom.saveNow, 'click', function () { saveDesign(true); });
    on(dom.includeSurface, 'change', render);

    on(dom.copyHtml, 'click', function () { copyText(E.generateHTML(state), 'HTML copied'); });
    on(dom.copyCss, 'click', function () { copyText(cssOut(), 'CSS copied'); });
    on(dom.copyAll, 'click', function () {
      copyText('<!-- HTML -->\n' + E.generateHTML(state) + '\n\n/* CSS */\n' + cssOut(), 'HTML + CSS copied');
    });
    on(dom.downloadHtml, 'click', function () {
      download(E.generateHTML(state), filename('html'), 'text/html');
      status('HTML downloaded ✓', 'good');
    });
    on(dom.downloadCss, 'click', function () {
      download(cssOut(), filename('css'), 'text/css');
      status('CSS downloaded ✓', 'good');
    });
    on(dom.downloadPage, 'click', function () {
      download(E.generateFullDocument(state), 'neumorphic-' + state.element + '-page.html', 'text/html');
      status('Standalone page downloaded ✓', 'good');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('neu-fullscreen-on')) {
        toggleFullscreen(false);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      var t = e.target;
      var editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (editing && /^(text|url|search|email|number)$/.test(t.type || 'text')) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    });

    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].attributeName === 'data-theme') { render(); return; }
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function initializeDesigner() {
    cacheDom();
    if (!dom.studio) return;

    buildPresetButtons();
    bindControls();
    wireButtons();
    syncControls();
    lastCommitted = E.cloneState(state);
    setCodeTab('css');
    setPane('preview');
    syncHistoryButtons();
    render();
    offerRestore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeDesigner);
  else initializeDesigner();

  window.NeuStudio = {
    getState: function () { return state; },
    setState: function (next) { state = E.normalize(next); syncControls(); render(); },
    render: render,
    loadStylePreset: loadStylePreset,
    loadSurfacePreset: loadSurfacePreset,
    randomizeDesign: randomizeDesign,
    resetDesigner: resetDesigner,
    undo: undo,
    redo: redo,
    saveDesign: saveDesign,
    history: history,
    STORAGE_KEY: STORAGE_KEY
  };
})();
