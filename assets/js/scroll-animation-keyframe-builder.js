/* ==========================================================================
   ToolAdda — Scroll Animation Keyframe Builder (studio UI)

   Wires the keyframe editor, scroll preview and code panel to the pure
   state machine in scroll-animation-engine.js.

   The preview deliberately does NOT use `animation-timeline`. It drives the
   engine's interpolation from the scroll position (or the scrubber), so the
   preview behaves identically in every browser — including the ones that
   cannot run the CSS this tool generates. That is stated in the UI rather
   than glossed over.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.ScrollAnimationEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-scroll-animation';
  var HISTORY_LIMIT = 60;

  var state = E.defaultState();
  var history = { past: [], future: [] };
  var lastCommitted = null;
  var dom = {};
  var frame = 0;
  var statusTimer = 0;
  var saveTimer = 0;
  var playTimer = 0;
  var scrubbing = false;

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

  function announce(m) { if (dom.live) dom.live.textContent = m; }

  function copyText(value, label) {
    function good() { status(label + ' ✓', 'good'); }
    function bad() { status('Clipboard blocked — select the code and copy manually.', 'bad'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(good, function () { legacyCopy(value) ? good() : bad(); });
    } else { legacyCopy(value) ? good() : bad(); }
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
    // Scrubbing the preview is not a design change, so ignore it here.
    var a = E.cloneState(lastCommitted); a.preview.progress = 0;
    var b = E.cloneState(state); b.preview.progress = 0;
    if (JSON.stringify(a) === JSON.stringify(b)) return;
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
    rebuild();
    announce('Undone.');
  }

  function redo() {
    if (!history.future.length) { status('Nothing to redo.', 'info'); return; }
    history.past.push(E.cloneState(state));
    state = E.normalize(history.future.pop());
    lastCommitted = E.cloneState(state);
    rebuild();
    announce('Redone.');
  }

  function syncHistoryButtons() {
    if (dom.undo) dom.undo.disabled = !history.past.length;
    if (dom.redo) dom.redo.disabled = !history.future.length;
  }

  function rebuild() {
    syncControls();
    renderKeyframeEditor();
    render();
    syncHistoryButtons();
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      buildDemo();
      applyProgress(state.preview.progress);
      renderCode();
      renderSupport();
      updateControlVisibility();
      scheduleSave();
    });
  }

  /** Rebuild the demo markup from the engine's own HTML generator. */
  function buildDemo() {
    if (!dom.demo) return;
    while (dom.demo.firstChild) dom.demo.removeChild(dom.demo.firstChild);

    var name = state.name;
    var c = state.content;

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text; // never innerHTML
      return n;
    }

    if (state.demo === 'list') {
      var ul = el('ul', 'sab-demo-list');
      var items = String(c.listItems || '').split(/[\n,]/)
        .map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12);
      items.forEach(function (item) { ul.appendChild(el('li', name, item)); });
      dom.demo.appendChild(ul);
    } else if (state.demo === 'progress') {
      var track = el('div', 'sab-demo-track');
      track.appendChild(el('div', name + ' sab-demo-bar'));
      dom.demo.appendChild(track);
    } else if (state.demo === 'heading') {
      dom.demo.appendChild(el('h3', name + ' sab-demo-heading', c.title));
    } else if (state.demo === 'image') {
      var fig = el('figure', name + ' sab-demo-figure');
      fig.appendChild(el('div', 'sab-demo-image'));
      fig.appendChild(el('figcaption', '', c.title));
      dom.demo.appendChild(fig);
    } else {
      var art = el('article', name + ' sab-demo-card');
      art.appendChild(el('h3', '', c.title));
      art.appendChild(el('p', '', c.text));
      dom.demo.appendChild(art);
    }
  }

  function animatedNodes() {
    if (!dom.demo) return [];
    return Array.prototype.slice.call(dom.demo.querySelectorAll('.' + CSS_ESCAPE(state.name)));
  }

  /* The animation name is already reduced to [a-z0-9-] by the engine, but
     escape anyway so a future change cannot break the selector. */
  function CSS_ESCAPE(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '');
  }

  /**
   * Paint the demo at a given progress by interpolating the keyframes in JS.
   * This is what makes the preview work in browsers that cannot run the
   * generated CSS at all.
   */
  function applyProgress(progress) {
    var nodes = animatedNodes();
    var stagger = state.stagger.enabled;

    nodes.forEach(function (node, i) {
      var p = progress;
      if (stagger && nodes.length > 1) {
        // Spread the children across the timeline the way the CSS does.
        var spread = Math.min(0.6, state.stagger.step * (nodes.length - 1));
        var offset = nodes.length > 1 ? (i / (nodes.length - 1)) * spread : 0;
        var span = Math.max(0.05, 1 - spread);
        p = (progress - offset) / span;
      }
      var style = E.styleFor(E.valuesAt(state, Math.max(0, Math.min(1, p))));
      node.style.opacity = style.opacity;
      node.style.transform = style.transform;
      node.style.filter = style.filter;
      if (state.options.transformOriginLeft) node.style.transformOrigin = 'left center';
      else node.style.transformOrigin = '';
    });

    if (dom.progressOut) dom.progressOut.textContent = Math.round(progress * 100) + '%';
    if (dom.scrubber && !scrubbing) dom.scrubber.value = String(Math.round(progress * 100));
  }

  function renderCode() {
    var css = E.generateCSS(state);
    var html = E.generateHTML(state);
    var js = E.generateJS(state);

    if (dom.cssCode) dom.cssCode.textContent = css;
    if (dom.htmlCode) dom.htmlCode.textContent = html;
    if (dom.jsCode) dom.jsCode.textContent = js || '/* This mode needs no JavaScript — the animation is pure CSS. */\n';

    if (dom.cssSize) dom.cssSize.textContent = css.split('\n').length + ' lines';
    if (dom.htmlSize) dom.htmlSize.textContent = html.split('\n').length + ' lines';
    if (dom.jsSize) dom.jsSize.textContent = js ? js.split('\n').length + ' lines' : 'not needed';
    if (dom.jsTab) dom.jsTab.dataset.needed = js ? 'yes' : 'no';
  }

  function renderSupport() {
    if (!dom.supportList) return;
    while (dom.supportList.firstChild) dom.supportList.removeChild(dom.supportList.firstChild);
    E.supportNotes(state).forEach(function (note) {
      var li = document.createElement('li');
      li.className = 'sab-note';
      li.dataset.level = note.level;
      li.textContent = note.text;
      dom.supportList.appendChild(li);
    });
  }

  function updateControlVisibility() {
    all('[data-for-mode]').forEach(function (el) {
      el.hidden = el.getAttribute('data-for-mode').split(/\s+/).indexOf(state.mode) === -1;
    });
    all('[data-not-mode]').forEach(function (el) {
      el.hidden = el.getAttribute('data-not-mode').split(/\s+/).indexOf(state.mode) !== -1;
    });
    press(dom.modeButtons, 'mode', state.mode);
    press(dom.demoButtons, 'demo', state.demo);
    if (dom.staggerFields) dom.staggerFields.hidden = !state.stagger.enabled;
  }

  function press(list, key, value) {
    (list || []).forEach(function (btn) {
      var active = btn.dataset[key] === value;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
  }

  /* ======================================================================
     Keyframe editor
     ====================================================================== */

  function renderKeyframeEditor() {
    if (!dom.keyframeList) return;
    while (dom.keyframeList.firstChild) dom.keyframeList.removeChild(dom.keyframeList.firstChild);

    state.keyframes.forEach(function (kf, index) {
      var row = document.createElement('div');
      row.className = 'sab-kf';

      var head = document.createElement('div');
      head.className = 'sab-kf__head';

      var atLabel = document.createElement('label');
      atLabel.className = 'sab-kf__at';
      var atId = 'sabKfAt' + index;
      atLabel.setAttribute('for', atId);
      atLabel.textContent = 'Stop';

      var atInput = document.createElement('input');
      atInput.type = 'number';
      atInput.id = atId;
      atInput.className = 'sab-input sab-input--tiny';
      atInput.min = '0';
      atInput.max = '100';
      atInput.value = String(kf.at);
      atInput.setAttribute('aria-label', 'Keyframe ' + (index + 1) + ' position, percent');
      atInput.addEventListener('input', function () {
        state.keyframes[index].at = E.clampNum(atInput.value, 0, 100, kf.at);
        state.preset = 'custom';
        state = E.normalize(state);
        render();
      });
      atInput.addEventListener('change', function () { commit(); renderKeyframeEditor(); });

      var pct = document.createElement('span');
      pct.className = 'sab-kf__pct';
      pct.textContent = '%';

      var jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'sab-iconbtn';
      jump.textContent = '⇥';
      jump.title = 'Preview this stop';
      jump.setAttribute('aria-label', 'Preview keyframe ' + (index + 1));
      jump.addEventListener('click', function () {
        state.preview.progress = kf.at / 100;
        applyProgress(state.preview.progress);
      });

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sab-iconbtn sab-iconbtn--danger';
      remove.textContent = '✕';
      remove.title = 'Remove this stop';
      remove.setAttribute('aria-label', 'Remove keyframe ' + (index + 1));
      remove.disabled = state.keyframes.length <= 2;
      remove.addEventListener('click', function () {
        E.removeKeyframe(state, index);
        state = E.normalize(state);
        commit();
        renderKeyframeEditor();
        render();
      });

      head.appendChild(atLabel);
      head.appendChild(atInput);
      head.appendChild(pct);
      head.appendChild(document.createElement('span')).className = 'sab-kf__spacer';
      head.appendChild(jump);
      head.appendChild(remove);
      row.appendChild(head);

      var tracks = document.createElement('div');
      tracks.className = 'sab-kf__tracks';
      E.TRACKS.forEach(function (track) {
        var field = document.createElement('div');
        field.className = 'sab-kf__track';

        var id = 'sabKf' + index + track.key;
        var label = document.createElement('label');
        label.className = 'sab-kf__tracklabel';
        label.setAttribute('for', id);
        label.textContent = track.label;

        var out = document.createElement('output');
        out.textContent = kf[track.key] + track.unit;
        label.appendChild(out);

        var input = document.createElement('input');
        input.type = 'range';
        input.id = id;
        input.min = String(track.min);
        input.max = String(track.max);
        input.step = String(track.step);
        input.value = String(kf[track.key]);
        input.addEventListener('input', function () {
          state.keyframes[index][track.key] = parseFloat(input.value);
          state.preset = 'custom';
          state = E.normalize(state);
          out.textContent = state.keyframes[index][track.key] + track.unit;
          render();
        });
        input.addEventListener('change', commit);

        field.appendChild(label);
        field.appendChild(input);
        tracks.appendChild(field);
      });

      row.appendChild(tracks);
      dom.keyframeList.appendChild(row);
    });

    if (dom.addKeyframe) dom.addKeyframe.disabled = state.keyframes.length >= 12;
  }

  /* ======================================================================
     Controls
     ====================================================================== */

  function getPath(p) { return p.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, state); }
  function setPath(p, v) {
    var parts = p.split('.');
    var last = parts.pop();
    parts.reduce(function (o, k) { return o[k]; }, state)[last] = v;
  }
  function outputFor(input) {
    var wrap = input.closest('.sab-field');
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
        if (input.type === 'range' || input.type === 'number') return parseFloat(input.value) / controlScale(input);
        return input.value;
      }

      function apply() {
        setPath(path, read());
        state = E.normalize(state);
        syncOutput(input);
        if (path === 'name') input.value = state.name;
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
     Preview driving
     ====================================================================== */

  /** Scroll position inside the preview column maps to animation progress. */
  function progressFromScroll() {
    if (!dom.scroller || !dom.demo) return;
    var scroller = dom.scroller.getBoundingClientRect();
    var target = dom.demo.getBoundingClientRect();
    // 0 when the element's top hits the bottom of the frame, 1 once it has
    // travelled to the configured share of the frame height.
    var travel = scroller.height + target.height;
    var moved = scroller.bottom - target.top;
    var raw = travel === 0 ? 0 : moved / travel;
    var startPct = state.timeline.rangeStartPct / 100;
    var endPct = Math.max(startPct + 0.05, state.timeline.rangeEndPct / 100 + 0.35);
    var mapped = (raw - startPct) / (endPct - startPct);
    state.preview.progress = Math.max(0, Math.min(1, mapped));
    applyProgress(state.preview.progress);
  }

  function play() {
    stopPlay();
    var duration = state.mode === 'observer' ? state.animation.duration * 1000 : 1200;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / duration);
      state.preview.progress = p;
      applyProgress(p);
      if (p < 1) playTimer = requestAnimationFrame(step);
      else playTimer = 0;
    }
    state.preview.progress = 0;
    applyProgress(0);
    playTimer = requestAnimationFrame(step);
  }

  function stopPlay() {
    if (playTimer) { cancelAnimationFrame(playTimer); playTimer = 0; }
  }

  /* ======================================================================
     Presets & actions
     ====================================================================== */

  function loadPreset(id) {
    E.applyPreset(state, id);
    state = E.normalize(state);
    commit();
    rebuild();
    var p = E.PRESETS[id];
    status('Applied ' + (p ? p.label : id), 'good');
    play();
  }

  function resetBuilder() {
    state = E.defaultState();
    commit();
    rebuild();
    status('Reset to the default fade-up', 'good');
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
      rebuild();
      dom.restoreBar.hidden = true;
      status('Previous animation restored ✓', 'good');
    });
    on(dom.restoreNo, 'click', function () {
      dom.restoreBar.hidden = true;
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
      status('Starting fresh.', 'info');
    });
  }

  /* ======================================================================
     Panes
     ====================================================================== */

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
    if (dom.cssPane) dom.cssPane.hidden = name !== 'css';
    if (dom.htmlPane) dom.htmlPane.hidden = name !== 'html';
    if (dom.jsPane) dom.jsPane.hidden = name !== 'js';
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.studio = $('sabStudio');
    dom.status = $('sabStatus');
    dom.live = $('sabLive');

    dom.scroller = $('sabScroller');
    dom.demo = $('sabDemo');
    dom.scrubber = $('sabScrubber');
    dom.progressOut = $('sabProgressOut');
    dom.play = $('sabPlay');
    dom.previewPanel = $('sabPreviewPanel');

    dom.keyframeList = $('sabKeyframes');
    dom.addKeyframe = $('sabAddKeyframe');
    dom.presetList = $('sabPresets');
    dom.staggerFields = $('sabStaggerFields');

    dom.cssCode = $('sabCssCode');
    dom.htmlCode = $('sabHtmlCode');
    dom.jsCode = $('sabJsCode');
    dom.cssPane = $('sabCssPane');
    dom.htmlPane = $('sabHtmlPane');
    dom.jsPane = $('sabJsPane');
    dom.cssSize = $('sabCssSize');
    dom.htmlSize = $('sabHtmlSize');
    dom.jsSize = $('sabJsSize');
    dom.jsTab = document.querySelector('[data-code-tab="js"]');
    dom.supportList = $('sabSupportList');

    dom.undo = $('sabUndo');
    dom.redo = $('sabRedo');
    dom.reset = $('sabReset');
    dom.saveNow = $('sabSaveNow');
    dom.saveHint = $('sabSaveHint');

    dom.restoreBar = $('sabRestoreBar');
    dom.restoreYes = $('sabRestoreYes');
    dom.restoreNo = $('sabRestoreNo');

    dom.copyCss = $('sabCopyCss');
    dom.copyHtml = $('sabCopyHtml');
    dom.copyJs = $('sabCopyJs');
    dom.copyAll = $('sabCopyAll');
    dom.downloadCss = $('sabDownloadCss');
    dom.downloadPage = $('sabDownloadPage');

    dom.modeButtons = all('[data-mode]');
    dom.demoButtons = all('[data-demo]');
    dom.paneButtons = all('[data-pane-btn]');
    dom.codeTabs = all('[data-code-tab]');
  }

  function buildPresetButtons() {
    if (!dom.presetList) return;
    E.PRESET_IDS.forEach(function (id) {
      var p = E.PRESETS[id];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sab-preset';
      btn.dataset.preset = id;
      btn.textContent = p.label;
      btn.addEventListener('click', function () { loadPreset(id); });
      dom.presetList.appendChild(btn);
    });
  }

  function wireButtons() {
    (dom.modeButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.dataset.mode;
        state = E.normalize(state);
        commit(); rebuild();
        announce('Mode: ' + btn.textContent.trim());
      });
    });

    (dom.demoButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.demo = btn.dataset.demo;
        state = E.normalize(state);
        commit(); rebuild(); play();
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
        var n = e.key === 'ArrowRight'
          ? (i + 1) % dom.paneButtons.length
          : (i - 1 + dom.paneButtons.length) % dom.paneButtons.length;
        dom.paneButtons[n].focus();
        setPane(dom.paneButtons[n].dataset.paneBtn);
      });
    });

    on(dom.addKeyframe, 'click', function () {
      E.addKeyframe(state, Math.round(state.preview.progress * 100) || 50);
      state = E.normalize(state);
      commit();
      renderKeyframeEditor();
      render();
    });

    on(dom.scrubber, 'input', function () {
      scrubbing = true;
      stopPlay();
      state.preview.progress = parseFloat(dom.scrubber.value) / 100;
      applyProgress(state.preview.progress);
      scrubbing = false;
    });

    on(dom.play, 'click', play);
    on(dom.scroller, 'scroll', function () { stopPlay(); progressFromScroll(); }, { passive: true });

    on(dom.undo, 'click', undo);
    on(dom.redo, 'click', redo);
    on(dom.reset, 'click', resetBuilder);
    on(dom.saveNow, 'click', function () { saveDesign(true); });

    on(dom.copyCss, 'click', function () { copyText(E.generateCSS(state), 'CSS copied'); });
    on(dom.copyHtml, 'click', function () { copyText(E.generateHTML(state), 'HTML copied'); });
    on(dom.copyJs, 'click', function () {
      var js = E.generateJS(state);
      if (!js) { status('This mode needs no JavaScript.', 'info'); return; }
      copyText(js, 'JavaScript copied');
    });
    on(dom.copyAll, 'click', function () {
      var js = E.generateJS(state);
      copyText('<!-- HTML -->\n' + E.generateHTML(state) + '\n\n/* CSS */\n' + E.generateCSS(state) +
        (js ? '\n\n// JavaScript\n' + js : ''), 'Everything copied');
    });
    on(dom.downloadCss, 'click', function () {
      download(E.generateCSS(state), state.name + '.css', 'text/css');
      status('CSS downloaded ✓', 'good');
    });
    on(dom.downloadPage, 'click', function () {
      download(E.generateFullDocument(state), state.name + '-demo.html', 'text/html');
      status('Demo page downloaded ✓', 'good');
    });

    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var t = e.target;
      var editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (editing && /^(text|url|search|email|number)$/.test(t.type || 'text')) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    });
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
    renderKeyframeEditor();
    lastCommitted = E.cloneState(state);
    setCodeTab('css');
    setPane('preview');
    syncHistoryButtons();
    render();
    offerRestore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeBuilder);
  else initializeBuilder();

  window.ScrollStudio = {
    getState: function () { return state; },
    setState: function (next) { state = E.normalize(next); rebuild(); },
    render: render,
    applyProgress: applyProgress,
    loadPreset: loadPreset,
    resetBuilder: resetBuilder,
    undo: undo,
    redo: redo,
    saveDesign: saveDesign,
    history: history,
    STORAGE_KEY: STORAGE_KEY
  };
})();
