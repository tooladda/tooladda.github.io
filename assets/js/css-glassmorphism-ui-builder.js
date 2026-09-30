/* ==========================================================================
   ToolAdda — CSS Glassmorphism UI Builder (studio UI)

   Wires the control panel, live preview and code panel to the pure state
   machine in glassmorphism-engine.js.

   One rule holds the whole thing together: the preview and the generated
   code are both produced from `state` on every change, through the same
   engine functions. There is no second copy of the design anywhere.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.GlassmorphismEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-glassmorphism-design';
  var HISTORY_LIMIT = 60;

  var state = E.defaultState();
  var history = { past: [], future: [] };
  var dom = {};
  var previewStyleEl = null;
  var frame = 0;
  var statusTimer = 0;
  var saveTimer = 0;

  /* ======================================================================
     Small helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function on(node, event, handler, opts) {
    if (node) node.addEventListener(event, handler, opts);
  }

  function status(message, tone) {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.dataset.tone = tone || 'info';
    dom.status.hidden = false;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { dom.status.hidden = true; }, 2600);
  }

  function announce(message) {
    if (dom.live) dom.live.textContent = message;
  }

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
     History — snapshot based, pushed on committed changes only
     ====================================================================== */

  /* The last state that was committed to history. Undo must restore the design
     as it was BEFORE an edit, so this snapshot — not the current state — is
     what gets pushed when an edit finishes. */
  var lastCommitted = null;

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
    syncControls();
    render();
    syncHistoryButtons();
    announce('Undone.');
  }

  function redo() {
    if (!history.future.length) { status('Nothing to redo.', 'info'); return; }
    history.past.push(E.cloneState(state));
    state = E.normalize(history.future.pop());
    lastCommitted = E.cloneState(state);
    syncControls();
    render();
    syncHistoryButtons();
    announce('Redone.');
  }

  function syncHistoryButtons() {
    if (dom.undo) dom.undo.disabled = !history.past.length;
    if (dom.redo) dom.redo.disabled = !history.future.length;
  }

  /* ======================================================================
     Rendering — preview + code, both from `state`
     ====================================================================== */

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      updateBackground();
      updatePreview();
      renderCode();
      updateInspector();
      updateControlVisibility();
      scheduleSave();
    });
  }

  /** The stage background and its decorative blobs (preview surface only). */
  function updateBackground() {
    if (!dom.stage) return;
    dom.stage.style.background = E.backgroundValue(state);

    var blobs = state.background.blobs;
    var wanted = blobs.enabled ? blobs.count : 0;
    var host = dom.blobLayer;
    if (!host) return;

    while (host.children.length > wanted) host.removeChild(host.lastChild);
    while (host.children.length < wanted) {
      var span = document.createElement('span');
      span.className = 'gls-blob';
      span.setAttribute('aria-hidden', 'true');
      host.appendChild(span);
    }

    var spots = [
      ['-8%', '-6%'], ['48%', '62%'], ['58%', '-10%'],
      ['-14%', '58%'], ['22%', '30%'], ['70%', '34%']
    ];
    var colors = [blobs.c1, blobs.c2, blobs.c3];
    Array.prototype.forEach.call(host.children, function (el, i) {
      el.style.width = blobs.size + 'px';
      el.style.height = blobs.size + 'px';
      el.style.top = spots[i % spots.length][0];
      el.style.left = spots[i % spots.length][1];
      el.style.background = colors[i % colors.length];
      el.style.filter = 'blur(' + blobs.blur + 'px)';
      el.style.opacity = String(blobs.opacity);
    });
  }

  /**
   * Rebuild the component from the engine tree and re-inject the scoped CSS.
   * The tree is turned into real elements with textContent, so no user text
   * is ever parsed as markup.
   */
  function updatePreview() {
    if (!dom.canvas) return;

    if (!previewStyleEl) {
      previewStyleEl = document.createElement('style');
      previewStyleEl.id = 'glsPreviewStyle';
      document.head.appendChild(previewStyleEl);
    }
    // Scoped to the canvas so generated rules never leak into the builder UI.
    previewStyleEl.textContent = E.generateCSS(state, { scope: '#glsCanvas' });

    while (dom.canvas.firstChild) dom.canvas.removeChild(dom.canvas.firstChild);
    var node = E.renderToDOM(E.buildTree(state), document);
    if (node) dom.canvas.appendChild(node);

    if (dom.compareCanvas) {
      while (dom.compareCanvas.firstChild) dom.compareCanvas.removeChild(dom.compareCanvas.firstChild);
      if (state.preview.compare) {
        var plain = E.renderToDOM(E.buildTree(state), document);
        if (plain) dom.compareCanvas.appendChild(plain);
      }
    }
    if (dom.compareWrap) dom.compareWrap.hidden = !state.preview.compare;
    if (dom.stage) dom.stage.dataset.compare = state.preview.compare ? 'on' : 'off';

    applyDevice();
  }

  var DEVICE_WIDTHS = { desktop: 1440, tablet: 768, mobile: 390 };

  /** Simulate a real viewport width by scaling the canvas down to fit. */
  /* Stage horizontal padding, kept in sync with `.gls-stage` in the page CSS. */
  var STAGE_PADDING_X = 24;

  /**
   * Simulate a real viewport width by scaling the canvas down to fit.
   *
   * A transform does not change layout size, so the 1440px desktop viewport
   * would otherwise stretch the stage's grid column and push the component off
   * to one side. The frame is therefore given the post-scale dimensions and is
   * what the grid actually centres; the viewport scales from its top-left
   * corner inside it.
   */
  function applyDevice() {
    if (!dom.viewport || !dom.stage || !dom.frame) return;

    var width = DEVICE_WIDTHS[state.preview.device] || 1440;
    var available = Math.max(200, (dom.stage.clientWidth || 900) - STAGE_PADDING_X);
    var scale = Math.min(1, available / width);

    dom.viewport.style.width = width + 'px';
    dom.viewport.style.transform = scale < 1 ? 'scale(' + scale.toFixed(4) + ')' : 'none';

    // offsetHeight is the untransformed layout height, which is what we scale.
    var naturalHeight = dom.viewport.offsetHeight || dom.viewport.scrollHeight || 360;
    dom.frame.style.width = Math.round(width * scale) + 'px';
    dom.frame.style.height = Math.round(naturalHeight * scale) + 'px';

    if (dom.deviceLabel) dom.deviceLabel.textContent = width + 'px';
  }

  function renderCode() {
    var html = E.generateHTML(state);
    var css = E.generateCSS(state);
    if (dom.htmlCode) dom.htmlCode.textContent = html;
    if (dom.cssCode) dom.cssCode.textContent = css;
    if (dom.htmlSize) dom.htmlSize.textContent = html.length + ' chars';
    if (dom.cssSize) dom.cssSize.textContent = css.split('\n').length + ' lines';
  }

  function updateInspector() {
    if (!dom.inspector) return;
    while (dom.inspector.firstChild) dom.inspector.removeChild(dom.inspector.firstChild);
    E.inspectProperties(state).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'gls-inspect__row';
      var k = document.createElement('span');
      k.className = 'gls-inspect__prop';
      k.textContent = item.prop;
      var v = document.createElement('span');
      v.className = 'gls-inspect__val';
      v.textContent = item.value;
      row.appendChild(k);
      row.appendChild(v);
      dom.inspector.appendChild(row);
    });
  }

  /** Show only the controls that apply to the current component and mode. */
  function updateControlVisibility() {
    all('[data-for-component]').forEach(function (el) {
      var list = el.getAttribute('data-for-component').split(/\s+/);
      el.hidden = list.indexOf(state.component) === -1;
    });
    all('[data-advanced]').forEach(function (el) {
      el.hidden = state.mode !== 'advanced';
    });
    all('[data-bg-type]').forEach(function (el) {
      el.hidden = el.getAttribute('data-bg-type') !== state.background.type;
    });
    if (dom.radiusLinkedWrap) dom.radiusLinkedWrap.hidden = !state.border.radiusLinked;
    if (dom.radiusCornersWrap) dom.radiusCornersWrap.hidden = state.border.radiusLinked;
    if (dom.shadowCustomWrap) dom.shadowCustomWrap.hidden = state.shadow.preset !== 'custom';

    (dom.componentButtons || []).forEach(function (btn) {
      var active = btn.dataset.component === state.component;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
    (dom.modeButtons || []).forEach(function (btn) {
      var active = btn.dataset.mode === state.mode;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
    (dom.intensityButtons || []).forEach(function (btn) {
      var active = btn.dataset.intensity === state.glass.intensity;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
    (dom.deviceButtons || []).forEach(function (btn) {
      var active = btn.dataset.device === state.preview.device;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
  }

  /* ======================================================================
     Control binding
     ====================================================================== */

  function getPath(path) {
    return path.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, state);
  }

  function setPath(path, value) {
    var parts = path.split('.');
    var last = parts.pop();
    var target = parts.reduce(function (o, k) { return o[k]; }, state);
    target[last] = value;
  }

  function outputFor(input) {
    var wrap = input.closest('.gls-field');
    return wrap ? wrap.querySelector('output') : null;
  }

  function syncOutput(input) {
    var out = outputFor(input);
    if (!out) return;
    out.textContent = input.value + (input.dataset.suffix || '');
  }

  /* Sliders that read nicer as 0–100 store a 0–1 value; data-scale bridges the two. */
  function controlScale(input) {
    var scale = parseFloat(input.dataset.scale);
    return isFinite(scale) && scale !== 0 ? scale : 1;
  }

  /**
   * Every control declares its state path with data-path. `input` updates the
   * design live; `change` commits one history entry, so dragging a slider is a
   * single undo step rather than fifty.
   */
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

        // Touching a raw glass value means the design is no longer a named intensity.
        if (path.indexOf('glass.') === 0) state.glass.intensity = 'custom';
        if (['background.c1', 'background.c2', 'background.c3', 'background.solid',
             'background.angle', 'background.gradientType'].indexOf(path) !== -1) {
          state.background.preset = 'custom';
        }
        if (path === 'border.radius') {
          state.border.tl = state.border.tr = state.border.br = state.border.bl = state.border.radius;
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

  /** Push every control's DOM value back from state (after undo, preset, reset…). */
  function syncControls() {
    all('[data-path]').forEach(function (input) {
      var value = getPath(input.getAttribute('data-path'));
      if (value === undefined) return;
      if (input.type === 'checkbox') {
        input.checked = !!value;
      } else if (input.type === 'range' || input.type === 'number') {
        input.value = String(Math.round(value * controlScale(input) * 1000) / 1000);
      } else {
        input.value = String(value);
      }
      syncOutput(input);
    });
  }

  /* ======================================================================
     Presets, randomise, reset
     ====================================================================== */

  function loadPreset(id) {
    E.applyGlassPreset(state, id);
    state = E.normalize(state);
    commit();
    syncControls();
    render();
    var preset = E.GLASS_PRESETS[id];
    status('Applied ' + (preset ? preset.label : id), 'good');
    announce('Preset applied: ' + (preset ? preset.label : id));
  }

  function loadBackgroundPreset(id) {
    E.applyBackgroundPreset(state, id);
    state.background.type = 'gradient';
    state = E.normalize(state);
    commit();
    syncControls();
    render();
    status('Background: ' + (E.BACKGROUND_PRESET_LABELS[id] || id), 'good');
  }

  function setIntensity(level) {
    E.applyIntensity(state, level);
    state = E.normalize(state);
    commit();
    syncControls();
    render();
    announce('Glass intensity set to ' + level + '.');
  }

  function randomizeDesign() {
    E.randomDesign(state);
    state = E.normalize(state);
    commit();
    syncControls();
    render();
    status('Randomised ✓', 'good');
  }

  function resetBuilder() {
    var component = state.component;
    state = E.defaultState();
    state.component = component;
    commit();
    syncControls();
    render();
    status('Reset to the default glass card', 'good');
  }

  /* ======================================================================
     Persistence
     ====================================================================== */

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDesign, 600);
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

  function readStoredDesign() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) { return null; }
  }

  function restoreDesign(stored) {
    state = E.normalize(stored);
    lastCommitted = E.cloneState(state);
    history.past.length = 0;
    history.future.length = 0;
    syncControls();
    render();
    syncHistoryButtons();
    status('Previous design restored ✓', 'good');
  }

  function offerRestore() {
    var stored = readStoredDesign();
    if (!stored || !dom.restoreBar) return;
    dom.restoreBar.hidden = false;
    on(dom.restoreYes, 'click', function () {
      restoreDesign(stored);
      dom.restoreBar.hidden = true;
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

  function currentFilename(ext) {
    return 'glass-' + state.component + '.' + ext;
  }

  function copyHTML() { copyText(E.generateHTML(state), 'HTML copied'); }
  function copyCSS() { copyText(E.generateCSS(state), 'CSS copied'); }

  function copyAll() {
    copyText(
      '<!-- HTML -->\n' + E.generateHTML(state) + '\n\n/* CSS */\n' + E.generateCSS(state),
      'HTML + CSS copied'
    );
  }

  function downloadHTML() {
    download(E.generateHTML(state), currentFilename('html'), 'text/html');
    status('HTML downloaded ✓', 'good');
  }

  function downloadCSS() {
    download(E.generateCSS(state), currentFilename('css'), 'text/css');
    status('CSS downloaded ✓', 'good');
  }

  function downloadComplete() {
    download(E.generateFullDocument(state), 'glass-' + state.component + '-page.html', 'text/html');
    status('Standalone page downloaded ✓', 'good');
  }

  /* ======================================================================
     Fullscreen & tabs
     ====================================================================== */

  function toggleFullscreen(force) {
    var next = force === undefined ? !document.body.classList.contains('gls-fullscreen-on') : force;
    document.body.classList.toggle('gls-fullscreen-on', next);
    if (dom.previewPanel) dom.previewPanel.classList.toggle('is-fullscreen', next);
    if (dom.fullscreen) {
      dom.fullscreen.setAttribute('aria-pressed', next ? 'true' : 'false');
      dom.fullscreen.textContent = next ? 'Exit fullscreen' : 'Fullscreen';
    }
    setTimeout(applyDevice, 60);
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
    if (name === 'preview') setTimeout(applyDevice, 40);
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
    dom.studio = $('glsStudio');
    dom.status = $('glsStatus');
    dom.live = $('glsLive');

    dom.stage = $('glsStage');
    dom.frame = $('glsFrame');
    dom.viewport = $('glsViewport');
    dom.canvas = $('glsCanvas');
    dom.compareWrap = $('glsCompareWrap');
    dom.compareCanvas = $('glsCompareCanvas');
    dom.blobLayer = $('glsBlobs');
    dom.previewPanel = $('glsPreviewPanel');
    dom.deviceLabel = $('glsDeviceLabel');

    dom.htmlCode = $('glsHtmlCode');
    dom.cssCode = $('glsCssCode');
    dom.htmlPane = $('glsHtmlPane');
    dom.cssPane = $('glsCssPane');
    dom.htmlSize = $('glsHtmlSize');
    dom.cssSize = $('glsCssSize');
    dom.inspector = $('glsInspector');

    dom.presetList = $('glsPresetList');
    dom.bgPresetList = $('glsBgPresetList');

    dom.undo = $('glsUndo');
    dom.redo = $('glsRedo');
    dom.reset = $('glsReset');
    dom.randomize = $('glsRandomize');
    dom.fullscreen = $('glsFullscreen');
    dom.saveNow = $('glsSaveNow');
    dom.saveHint = $('glsSaveHint');

    dom.restoreBar = $('glsRestoreBar');
    dom.restoreYes = $('glsRestoreYes');
    dom.restoreNo = $('glsRestoreNo');

    dom.copyHtml = $('glsCopyHtml');
    dom.copyCss = $('glsCopyCss');
    dom.copyAll = $('glsCopyAll');
    dom.downloadHtml = $('glsDownloadHtml');
    dom.downloadCss = $('glsDownloadCss');
    dom.downloadComplete = $('glsDownloadComplete');

    dom.radiusLinkedWrap = $('glsRadiusLinked');
    dom.radiusCornersWrap = $('glsRadiusCorners');
    dom.shadowCustomWrap = $('glsShadowCustom');

    dom.componentButtons = all('[data-component]');
    dom.modeButtons = all('[data-mode]');
    dom.intensityButtons = all('[data-intensity]');
    dom.deviceButtons = all('[data-device]');
    dom.paneButtons = all('[data-pane-btn]');
    dom.codeTabs = all('[data-code-tab]');
  }

  function buildPresetButtons() {
    if (dom.presetList) {
      E.GLASS_PRESET_IDS.forEach(function (id) {
        var preset = E.GLASS_PRESETS[id];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gls-preset';
        btn.dataset.preset = id;

        var chip = document.createElement('span');
        chip.className = 'gls-preset__chip';
        chip.setAttribute('aria-hidden', 'true');
        chip.style.background = E.rgba(preset.glass.bgColor, Math.max(0.25, preset.glass.opacity));
        chip.style.borderColor = E.rgba(preset.border.color, preset.border.opacity);
        chip.style.borderRadius = Math.min(14, preset.border.radius) + 'px';

        var label = document.createElement('span');
        label.className = 'gls-preset__label';
        label.textContent = preset.label;

        btn.appendChild(chip);
        btn.appendChild(label);
        btn.addEventListener('click', function () { loadPreset(id); });
        dom.presetList.appendChild(btn);
      });
    }

    if (dom.bgPresetList) {
      Object.keys(E.BACKGROUND_PRESETS).forEach(function (id) {
        var preset = E.BACKGROUND_PRESETS[id];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gls-bgpreset';
        btn.dataset.bgPreset = id;
        btn.title = E.BACKGROUND_PRESET_LABELS[id] || id;
        btn.setAttribute('aria-label', 'Background preset: ' + (E.BACKGROUND_PRESET_LABELS[id] || id));
        var stops = [preset.c1, preset.c2];
        if (preset.useC3) stops.push(preset.c3);
        btn.style.background = 'linear-gradient(135deg, ' + stops.join(', ') + ')';
        var name = document.createElement('span');
        name.textContent = E.BACKGROUND_PRESET_LABELS[id] || id;
        btn.appendChild(name);
        btn.addEventListener('click', function () { loadBackgroundPreset(id); });
        dom.bgPresetList.appendChild(btn);
      });
    }
  }

  function wireButtons() {
    (dom.componentButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.component = btn.dataset.component;
        state = E.normalize(state);
        commit();
        syncControls();
        render();
        announce('Component switched to ' + btn.textContent.trim() + '.');
      });
    });

    (dom.modeButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.dataset.mode;
        updateControlVisibility();
        announce(btn.dataset.mode + ' mode.');
      });
    });

    (dom.intensityButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () { setIntensity(btn.dataset.intensity); });
    });

    all('[data-radius]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var value = parseInt(btn.dataset.radius, 10);
        state.border.radius = value;
        state.border.tl = state.border.tr = state.border.br = state.border.bl = value;
        state = E.normalize(state);
        commit();
        syncControls();
        render();
      });
    });

    (dom.deviceButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.preview.device = btn.dataset.device;
        updateControlVisibility();
        applyDevice();
        announce('Previewing at ' + DEVICE_WIDTHS[state.preview.device] + ' pixels.');
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
    on(dom.reset, 'click', resetBuilder);
    on(dom.randomize, 'click', randomizeDesign);
    on(dom.fullscreen, 'click', function () { toggleFullscreen(); });
    on(dom.saveNow, 'click', function () { saveDesign(true); });

    on(dom.copyHtml, 'click', copyHTML);
    on(dom.copyCss, 'click', copyCSS);
    on(dom.copyAll, 'click', copyAll);
    on(dom.downloadHtml, 'click', downloadHTML);
    on(dom.downloadCss, 'click', downloadCSS);
    on(dom.downloadComplete, 'click', downloadComplete);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('gls-fullscreen-on')) {
        toggleFullscreen(false);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      // Leave native undo alone while the caret is in a text field.
      var t = e.target;
      var editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      var typable = editing && /^(text|url|search|email|number)$/.test(t.type || 'text');
      if (typable) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyDevice, 120);
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

  function initializeBuilder() {
    cacheDom();
    if (!dom.studio) return;

    buildPresetButtons();
    bindControls();
    wireButtons();
    syncControls();
    lastCommitted = E.cloneState(state);
    setCodeTab('html');
    setPane('preview');
    syncHistoryButtons();
    render();
    offerRestore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeBuilder);
  else initializeBuilder();

  /* Exposed for the page's own test suite. */
  window.GlassStudio = {
    getState: function () { return state; },
    setState: function (next) { state = E.normalize(next); syncControls(); render(); },
    render: render,
    loadPreset: loadPreset,
    loadBackgroundPreset: loadBackgroundPreset,
    setIntensity: setIntensity,
    randomizeDesign: randomizeDesign,
    resetBuilder: resetBuilder,
    undo: undo,
    redo: redo,
    saveDesign: saveDesign,
    history: history,
    STORAGE_KEY: STORAGE_KEY
  };
})();
