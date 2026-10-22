/* ==========================================================================
   ToolAdda — CSS Flexbox / Grid Playground (studio UI)

   Wires the control panel, live playground and code panel to the pure
   state machine in flexbox-grid-engine.js.

   The preview and the generated code are both produced from `state` on
   every change. Item labels are written with textContent, never innerHTML.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.FlexboxGridEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-flexbox-grid-playground';
  var HISTORY_LIMIT = 60;

  var state = E.defaultState();
  var history = { past: [], future: [] };
  var lastCommitted = null;
  var dom = {};
  var frame = 0;
  var statusTimer = 0;
  var saveTimer = 0;
  var dragging = false;

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

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

  function setChipGroup(selector, value, attr) {
    attr = attr || 'data-value';
    all(selector).forEach(function (btn) {
      var on = btn.getAttribute(attr) === String(value);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setVal(id, value) {
    var el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
  }

  function setOut(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function syncControls() {
    setChipGroup('[data-mode]', state.mode);
    setChipGroup('[data-flex-display]', state.flex.display);
    setChipGroup('[data-flex-direction]', state.flex.direction);
    setChipGroup('[data-flex-wrap]', state.flex.wrap);
    setVal('fgpJustify', state.flex.justify);
    setVal('fgpAlign', state.flex.align);
    setVal('fgpAlignContent', state.flex.alignContent);
    setChipGroup('[data-grid-display]', state.grid.display);
    setVal('fgpColumns', state.grid.columns);
    setVal('fgpRows', state.grid.rows);
    setVal('fgpAreas', state.grid.areas);
    setVal('fgpAutoFlow', state.grid.autoFlow);
    setVal('fgpJustifyItems', state.grid.justifyItems);
    setVal('fgpAlignItemsGrid', state.grid.alignItems);
    setVal('fgpJustifyContentGrid', state.grid.justifyContent);
    setVal('fgpAlignContentGrid', state.grid.alignContent);
    setVal('fgpItemCount', state.itemCount);
    setOut('fgpItemCountOut', String(state.itemCount));
    setVal('fgpPadding', state.box.padding);
    setOut('fgpPaddingOut', state.box.padding + 'px');
    setVal('fgpGap', state.box.gap);
    setOut('fgpGapOut', state.box.gap + 'px');
    setVal('fgpRowGap', state.box.rowGap);
    setOut('fgpRowGapOut', state.box.rowGap + 'px');
    setVal('fgpColGap', state.box.columnGap);
    setOut('fgpColGapOut', state.box.columnGap + 'px');
    setVal('fgpGapLinked', state.box.gapLinked);
    setVal('fgpMinHeight', state.box.minHeight);
    setOut('fgpMinHeightOut', state.box.minHeight + 'px');
    setVal('fgpWidth', state.box.width);
    setOut('fgpWidthOut', state.box.width + '%');
    setVal('fgpOverlay', state.overlay);
    syncGapVisibility();
    syncModePanels();
    syncItemControls();
    setChipGroup('[data-preset]', '', 'data-preset');
  }

  function syncGapVisibility() {
    var unlinked = !state.box.gapLinked;
    if (dom.gapLinkedRow) dom.gapLinkedRow.hidden = unlinked;
    if (dom.gapSplitRow) dom.gapSplitRow.hidden = !unlinked;
  }

  function syncModePanels() {
    var isGrid = state.mode === 'grid';
    if (dom.flexControls) dom.flexControls.hidden = isGrid;
    if (dom.gridControls) dom.gridControls.hidden = !isGrid;
    if (dom.flexItemControls) dom.flexItemControls.hidden = isGrid;
    if (dom.gridItemControls) dom.gridItemControls.hidden = !isGrid;
    document.documentElement.style.setProperty('--fgp-mode', isGrid ? 'grid' : 'flex');
  }

  function syncItemControls() {
    var idx = state.selected;
    var has = idx >= 0 && idx < state.items.length;
    if (dom.itemEmpty) dom.itemEmpty.hidden = has;
    if (dom.itemFields) dom.itemFields.hidden = !has;
    if (!has) return;
    var item = state.items[idx];
    setVal('fgpItemLabel', item.label);
    setVal('fgpItemColor', item.color);
    setVal('fgpItemWidth', item.width);
    setOut('fgpItemWidthOut', item.width ? item.width + 'px' : 'auto');
    setVal('fgpItemHeight', item.height);
    setOut('fgpItemHeightOut', item.height ? item.height + 'px' : 'auto');
    setVal('fgpGrow', item.grow);
    setOut('fgpGrowOut', String(item.grow));
    setVal('fgpShrink', item.shrink);
    setOut('fgpShrinkOut', String(item.shrink));
    setVal('fgpBasis', item.basis);
    setVal('fgpBasisValue', item.basisValue);
    if (dom.basisValueField) dom.basisValueField.hidden = item.basis === 'auto';
    setVal('fgpAlignSelf', item.alignSelf);
    setVal('fgpOrder', item.order);
    setOut('fgpOrderOut', String(item.order));
    setVal('fgpColStart', item.colStart);
    setVal('fgpColSpan', item.colSpan);
    setOut('fgpColSpanOut', String(item.colSpan));
    setVal('fgpRowStart', item.rowStart);
    setVal('fgpRowSpan', item.rowSpan);
    setOut('fgpRowSpanOut', String(item.rowSpan));
    setVal('fgpJustifySelf', item.justifySelf);
    setVal('fgpAlignSelfGrid', item.alignSelfGrid);
  }

  function applyStyleMap(el, map) {
    el.style.cssText = '';
    Object.keys(map).forEach(function (key) {
      el.style.setProperty(key, map[key]);
    });
  }

  function renderPreview() {
    if (!dom.canvas) return;
    applyStyleMap(dom.canvas, E.containerStyle(state));
    dom.canvas.classList.toggle('is-grid', state.mode === 'grid');
    dom.canvas.classList.toggle('is-flex', state.mode === 'flex');
    dom.canvas.classList.toggle('is-overlay', state.overlay);

    while (dom.canvas.childNodes.length > state.items.length) {
      dom.canvas.removeChild(dom.canvas.lastChild);
    }
    var i, btn, item, map;
    for (i = 0; i < state.items.length; i++) {
      item = state.items[i];
      btn = dom.canvas.children[i];
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fgp-item';
        dom.canvas.appendChild(btn);
      }
      btn.textContent = item.label;
      btn.setAttribute('data-index', String(i));
      btn.setAttribute('aria-pressed', state.selected === i ? 'true' : 'false');
      btn.classList.toggle('is-selected', state.selected === i);
      map = E.itemStyle(state, i);
      applyStyleMap(btn, map);
    }
  }

  function renderCode() {
    var css = E.generateCSS(state);
    var markup = E.generateHTML(state);
    if (dom.cssCode) dom.cssCode.innerHTML = E.highlightCSS(css);
    if (dom.htmlCode) dom.htmlCode.innerHTML = E.highlightHTML(markup);
    if (dom.explain) dom.explain.textContent = E.explain(state);
    if (dom.when) dom.when.textContent = E.whenToUse(state.mode);
  }

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      renderPreview();
      renderCode();
      scheduleSave();
    });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) { /* private browsing */ }
  }

  function restore() {
    var hash = '';
    try { hash = (window.location.hash || '').replace(/^#s=/, ''); } catch (err) { hash = ''; }
    if (hash && hash.indexOf('fgpStudio') === -1 && hash.length > 8) {
      var fromHash = E.decodeState(hash);
      if (fromHash) {
        state = fromHash;
        lastCommitted = E.cloneState(state);
        return 'hash';
      }
    }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      state = E.normalize(parsed);
      lastCommitted = E.cloneState(state);
      return 'storage';
    } catch (err) {
      return null;
    }
  }

  function shareLink() {
    var token = E.encodeState(state);
    var url = window.location.origin + window.location.pathname + '#s=' + token;
    copyText(url, 'Share link copied');
    try { window.history.replaceState(null, '', '#s=' + token); } catch (err) { /* ignore */ }
  }

  function selectItem(index) {
    state.selected = state.selected === index ? -1 : index;
    syncItemControls();
    renderPreview();
    announce(state.selected >= 0 ? 'Item ' + (state.selected + 1) + ' selected.' : 'Container selected.');
  }

  function cacheDom() {
    dom.status = $('fgpStatus');
    dom.live = $('fgpLive');
    dom.canvas = $('fgpCanvas');
    dom.cssCode = $('fgpCssCode');
    dom.htmlCode = $('fgpHtmlCode');
    dom.explain = $('fgpExplain');
    dom.when = $('fgpWhen');
    dom.undo = $('fgpUndo');
    dom.redo = $('fgpRedo');
    dom.flexControls = $('fgpFlexControls');
    dom.gridControls = $('fgpGridControls');
    dom.flexItemControls = $('fgpFlexItemControls');
    dom.gridItemControls = $('fgpGridItemControls');
    dom.itemEmpty = $('fgpItemEmpty');
    dom.itemFields = $('fgpItemFields');
    dom.gapLinkedRow = $('fgpGapLinkedRow');
    dom.gapSplitRow = $('fgpGapSplitRow');
    dom.basisValueField = $('fgpBasisValueField');
    dom.studio = $('fgpStudio');
  }

  function bind() {
    all('[data-mode]').forEach(function (btn) {
      on(btn, 'click', function () {
        state = E.setMode(state, btn.getAttribute('data-mode'));
        commit();
        syncControls();
        render();
        announce(state.mode === 'grid' ? 'Grid mode.' : 'Flexbox mode.');
      });
    });

    all('[data-flex-display]').forEach(function (btn) {
      on(btn, 'click', function () {
        state = E.updateContainer(state, { flex: { display: btn.getAttribute('data-flex-display') } });
        commit(); syncControls(); render();
      });
    });
    all('[data-flex-direction]').forEach(function (btn) {
      on(btn, 'click', function () {
        state = E.updateContainer(state, { flex: { direction: btn.getAttribute('data-flex-direction') } });
        commit(); syncControls(); render();
      });
    });
    all('[data-flex-wrap]').forEach(function (btn) {
      on(btn, 'click', function () {
        state = E.updateContainer(state, { flex: { wrap: btn.getAttribute('data-flex-wrap') } });
        commit(); syncControls(); render();
      });
    });
    all('[data-grid-display]').forEach(function (btn) {
      on(btn, 'click', function () {
        state = E.updateContainer(state, { grid: { display: btn.getAttribute('data-grid-display') } });
        commit(); syncControls(); render();
      });
    });
    all('[data-columns]').forEach(function (btn) {
      on(btn, 'click', function () {
        state = E.updateContainer(state, { grid: { columns: btn.getAttribute('data-columns') } });
        commit(); syncControls(); render();
      });
    });
    all('[data-preset]').forEach(function (btn) {
      on(btn, 'click', function () {
        state = E.applyPreset(state, btn.getAttribute('data-preset'));
        commit();
        syncControls();
        setChipGroup('[data-preset]', btn.getAttribute('data-preset'), 'data-preset');
        render();
        announce(btn.textContent + ' preset applied.');
      });
    });

    function selectChange(id, patcher) {
      on($(id), 'change', function (ev) {
        state = E.updateContainer(state, patcher(ev.target.value));
        commit(); syncControls(); render();
      });
    }
    selectChange('fgpJustify', function (v) { return { flex: { justify: v } }; });
    selectChange('fgpAlign', function (v) { return { flex: { align: v } }; });
    selectChange('fgpAlignContent', function (v) { return { flex: { alignContent: v } }; });
    selectChange('fgpAutoFlow', function (v) { return { grid: { autoFlow: v } }; });
    selectChange('fgpJustifyItems', function (v) { return { grid: { justifyItems: v } }; });
    selectChange('fgpAlignItemsGrid', function (v) { return { grid: { alignItems: v } }; });
    selectChange('fgpJustifyContentGrid', function (v) { return { grid: { justifyContent: v } }; });
    selectChange('fgpAlignContentGrid', function (v) { return { grid: { alignContent: v } }; });

    on($('fgpColumns'), 'change', function (ev) {
      state = E.updateContainer(state, { grid: { columns: ev.target.value } });
      commit(); syncControls(); render();
    });
    on($('fgpRows'), 'change', function (ev) {
      state = E.updateContainer(state, { grid: { rows: ev.target.value } });
      commit(); syncControls(); render();
    });
    on($('fgpAreas'), 'change', function (ev) {
      state = E.updateContainer(state, { grid: { areas: ev.target.value } });
      commit(); syncControls(); render();
    });

    function rangeCommit(id, apply, liveOut) {
      var el = $(id);
      on(el, 'input', function (ev) {
        dragging = true;
        apply(ev.target.value, true);
        if (liveOut) liveOut(ev.target.value);
        render();
      });
      on(el, 'change', function (ev) {
        dragging = false;
        apply(ev.target.value, false);
        commit();
        syncControls();
        render();
      });
    }

    rangeCommit('fgpItemCount', function (v) {
      state = E.setItemCount(state, v);
    }, function (v) { setOut('fgpItemCountOut', String(v)); });

    rangeCommit('fgpPadding', function (v) {
      state = E.updateContainer(state, { box: { padding: Number(v) } });
    }, function (v) { setOut('fgpPaddingOut', v + 'px'); });

    rangeCommit('fgpGap', function (v) {
      state = E.updateContainer(state, { box: { gap: Number(v), rowGap: Number(v), columnGap: Number(v) } });
    }, function (v) { setOut('fgpGapOut', v + 'px'); });

    rangeCommit('fgpRowGap', function (v) {
      state = E.updateContainer(state, { box: { rowGap: Number(v) } });
    }, function (v) { setOut('fgpRowGapOut', v + 'px'); });

    rangeCommit('fgpColGap', function (v) {
      state = E.updateContainer(state, { box: { columnGap: Number(v) } });
    }, function (v) { setOut('fgpColGapOut', v + 'px'); });

    rangeCommit('fgpMinHeight', function (v) {
      state = E.updateContainer(state, { box: { minHeight: Number(v) } });
    }, function (v) { setOut('fgpMinHeightOut', v + 'px'); });

    rangeCommit('fgpWidth', function (v) {
      state = E.updateContainer(state, { box: { width: Number(v) } });
    }, function (v) { setOut('fgpWidthOut', v + '%'); });

    on($('fgpGapLinked'), 'change', function (ev) {
      state = E.updateContainer(state, { box: { gapLinked: ev.target.checked } });
      commit(); syncControls(); render();
    });
    on($('fgpOverlay'), 'change', function (ev) {
      state = E.updateContainer(state, { overlay: ev.target.checked });
      commit(); syncControls(); render();
    });

    on($('fgpAdd'), 'click', function () {
      state = E.setItemCount(state, state.itemCount + 1);
      commit(); syncControls(); render();
    });
    on($('fgpRemove'), 'click', function () {
      state = E.setItemCount(state, state.itemCount - 1);
      commit(); syncControls(); render();
    });

    on(dom.canvas, 'click', function (ev) {
      var btn = ev.target.closest('.fgp-item');
      if (!btn) {
        state.selected = -1;
        syncItemControls();
        renderPreview();
        return;
      }
      selectItem(parseInt(btn.getAttribute('data-index'), 10));
    });

    function itemPatch(patch) {
      if (state.selected < 0) return;
      state = E.updateItem(state, state.selected, patch);
    }

    on($('fgpItemLabel'), 'input', function (ev) {
      itemPatch({ label: ev.target.value });
      renderPreview();
    });
    on($('fgpItemLabel'), 'change', function () { commit(); syncControls(); render(); });
    on($('fgpItemColor'), 'input', function (ev) {
      itemPatch({ color: ev.target.value });
      renderPreview();
    });
    on($('fgpItemColor'), 'change', function () { commit(); syncControls(); render(); });

    rangeCommit('fgpItemWidth', function (v) { itemPatch({ width: Number(v) }); }, function (v) {
      setOut('fgpItemWidthOut', Number(v) ? v + 'px' : 'auto');
    });
    rangeCommit('fgpItemHeight', function (v) { itemPatch({ height: Number(v) }); }, function (v) {
      setOut('fgpItemHeightOut', Number(v) ? v + 'px' : 'auto');
    });
    rangeCommit('fgpGrow', function (v) { itemPatch({ grow: Number(v) }); }, function (v) { setOut('fgpGrowOut', v); });
    rangeCommit('fgpShrink', function (v) { itemPatch({ shrink: Number(v) }); }, function (v) { setOut('fgpShrinkOut', v); });
    rangeCommit('fgpOrder', function (v) { itemPatch({ order: Number(v) }); }, function (v) { setOut('fgpOrderOut', v); });
    rangeCommit('fgpColSpan', function (v) { itemPatch({ colSpan: Number(v) }); }, function (v) { setOut('fgpColSpanOut', v); });
    rangeCommit('fgpRowSpan', function (v) { itemPatch({ rowSpan: Number(v) }); }, function (v) { setOut('fgpRowSpanOut', v); });

    on($('fgpBasis'), 'change', function (ev) {
      itemPatch({ basis: ev.target.value });
      commit(); syncControls(); render();
    });
    on($('fgpBasisValue'), 'change', function (ev) {
      itemPatch({ basisValue: Number(ev.target.value) });
      commit(); syncControls(); render();
    });
    on($('fgpAlignSelf'), 'change', function (ev) {
      itemPatch({ alignSelf: ev.target.value });
      commit(); syncControls(); render();
    });
    on($('fgpColStart'), 'change', function (ev) {
      itemPatch({ colStart: ev.target.value });
      commit(); syncControls(); render();
    });
    on($('fgpRowStart'), 'change', function (ev) {
      itemPatch({ rowStart: ev.target.value });
      commit(); syncControls(); render();
    });
    on($('fgpJustifySelf'), 'change', function (ev) {
      itemPatch({ justifySelf: ev.target.value });
      commit(); syncControls(); render();
    });
    on($('fgpAlignSelfGrid'), 'change', function (ev) {
      itemPatch({ alignSelfGrid: ev.target.value });
      commit(); syncControls(); render();
    });

    on($('fgpCopyCss'), 'click', function () { copyText(E.generateCSS(state), 'CSS copied'); });
    on($('fgpCopyHtml'), 'click', function () { copyText(E.generateHTML(state), 'HTML copied'); });
    on($('fgpCopyBoth'), 'click', function () {
      copyText(E.generateHTML(state) + '\n\n<style>\n' + E.generateCSS(state) + '</style>\n', 'HTML + CSS copied');
    });
    on($('fgpDownload'), 'click', function () {
      download(E.generateFullDocument(state), 'layout-playground.html', 'text/html');
      status('Page downloaded.', 'good');
    });
    on($('fgpShare'), 'click', shareLink);
    on(dom.undo, 'click', undo);
    on(dom.redo, 'click', redo);
    on($('fgpReset'), 'click', function () {
      state = E.defaultState();
      commit();
      syncControls();
      render();
      announce('Reset to defaults.');
    });

    all('[data-pane-btn]').forEach(function (btn) {
      on(btn, 'click', function () {
        var pane = btn.getAttribute('data-pane-btn');
        if (dom.studio) dom.studio.setAttribute('data-pane', pane);
        all('[data-pane-btn]').forEach(function (b) {
          var onBtn = b === btn;
          b.setAttribute('aria-selected', onBtn ? 'true' : 'false');
        });
      });
    });

    all('[data-code-tab]').forEach(function (btn) {
      on(btn, 'click', function () {
        var tab = btn.getAttribute('data-code-tab');
        all('[data-code-tab]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        if (dom.cssCode) dom.cssCode.hidden = tab !== 'css';
        if (dom.htmlCode) dom.htmlCode.hidden = tab !== 'html';
      });
    });

    on(document, 'keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var key = ev.key.toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && key === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
      if ((ev.ctrlKey || ev.metaKey) && (key === 'y' || (key === 'z' && ev.shiftKey))) { ev.preventDefault(); redo(); }
    });
  }

  function init() {
    cacheDom();
    if (!dom.canvas) return;
    var source = restore();
    bind();
    syncControls();
    lastCommitted = E.cloneState(state);
    render();
    syncHistoryButtons();
    if (source === 'hash') status('Layout restored from the link.', 'info');
    else if (source === 'storage') status('Previous layout restored.', 'info');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
