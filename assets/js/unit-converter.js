/* ==========================================================================
   ToolAdda — Unit Converter (studio UI)

   Wires the category tabs, the two conversion fields, the all-units table
   and the reference panels to the pure engine in unit-converter-engine.js.

   Two behaviours worth knowing:

     • Either field can be edited. Typing in the right-hand box converts
       backwards, so the tool works in both directions without a swap.

     • The URL hash carries the whole conversion, so any result can be
       linked or bookmarked. Loading a hash restores it exactly.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.UnitConverterEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-unit-converter';
  var HISTORY_KEY = 'tooladda-unit-converter-history';
  var HISTORY_LIMIT = 8;

  var state = E.defaultState();
  var history = [];
  var dom = {};
  var frame = 0;
  var statusTimer = 0;
  var lastEdited = 'from';

  /* ======================================================================
     Helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function status(message, tone) {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.dataset.tone = tone || 'info';
    dom.status.hidden = false;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { dom.status.hidden = true; }, 2400);
  }

  function announce(m) { if (dom.live) dom.live.textContent = m; }

  function copyText(value, label) {
    function good() { status(label + ' ✓', 'good'); }
    function bad() { status('Clipboard blocked — select the value and copy manually.', 'bad'); }
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
      var okCopy = document.execCommand('copy');
      document.body.removeChild(ta);
      return okCopy;
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

  function fmt(value) { return E.formatValue(value, state.format); }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      renderResult();
      renderFormula();
      renderAllUnits();
      renderReference();
      updateHash();
      saveState();
    });
  }

  function renderResult() {
    var result = E.convert(state.value, state.category, state.from, state.to);

    if (lastEdited === 'from' && dom.toValue) {
      dom.toValue.value = isFinite(result) ? fmt(result) : '';
    }
    if (dom.bigResult) {
      var toUnit = E.getUnit(state.category, state.to);
      dom.bigResult.textContent = isFinite(result) ? fmt(result) + ' ' + toUnit.symbol : '—';
    }
    if (dom.bigFrom) {
      var fromUnit = E.getUnit(state.category, state.from);
      dom.bigFrom.textContent = isFinite(state.value)
        ? fmt(state.value) + ' ' + fromUnit.symbol
        : 'Enter a number';
    }
    if (dom.invalid) dom.invalid.hidden = isFinite(state.value) || state.raw === '';
  }

  function renderFormula() {
    if (dom.formula) dom.formula.textContent = E.formula(state.category, state.from, state.to);

    /* Show any caveat attached to either unit — an ambiguous ton or a
       month of unspecified length is worth saying out loud. */
    if (!dom.notes) return;
    while (dom.notes.firstChild) dom.notes.removeChild(dom.notes.firstChild);
    var seen = {};
    [E.getUnit(state.category, state.from), E.getUnit(state.category, state.to)].forEach(function (unit) {
      if (!unit.note || seen[unit.note]) return;
      seen[unit.note] = true;
      dom.notes.appendChild(el('li', 'uc-note', unit.symbol + ' — ' + unit.note));
    });
    dom.notes.hidden = dom.notes.children.length === 0;
  }

  /** Every unit in the category at once — usually faster than a second lookup. */
  function renderAllUnits() {
    if (!dom.allBody) return;
    if (dom.allPanel) dom.allPanel.hidden = !state.showAll;
    if (!state.showAll) return;

    while (dom.allBody.firstChild) dom.allBody.removeChild(dom.allBody.firstChild);
    if (!isFinite(state.value)) return;

    E.convertAll(state.value, state.category, state.from).forEach(function (row) {
      var tr = document.createElement('tr');
      if (row.isSource) tr.className = 'is-source';

      var nameCell = el('th', 'uc-all__name');
      nameCell.scope = 'row';
      nameCell.appendChild(el('span', 'uc-all__unit', row.unit.name));
      nameCell.appendChild(el('span', 'uc-all__symbol', row.unit.symbol));
      tr.appendChild(nameCell);

      tr.appendChild(el('td', 'uc-all__value', fmt(row.value)));

      var actions = el('td', 'uc-all__actions');
      var copy = el('button', 'uc-mini', 'Copy');
      copy.type = 'button';
      copy.setAttribute('aria-label', 'Copy ' + row.unit.name + ' value');
      copy.addEventListener('click', function () {
        copyText(E.formatValue(row.value, { mode: state.format.mode, precision: state.format.precision, grouping: false }),
          row.unit.name + ' copied');
      });
      var use = el('button', 'uc-mini', 'Use');
      use.type = 'button';
      use.setAttribute('aria-label', 'Convert to ' + row.unit.name);
      use.addEventListener('click', function () {
        state.to = row.unit.id;
        state = E.normalize(state);
        syncSelects();
        render();
        announce('Converting to ' + row.unit.name + '.');
      });
      actions.appendChild(copy);
      actions.appendChild(use);
      tr.appendChild(actions);

      dom.allBody.appendChild(tr);
    });
  }

  /** A small printable table for the current pair. */
  function renderReference() {
    if (!dom.refBody) return;
    while (dom.refBody.firstChild) dom.refBody.removeChild(dom.refBody.firstChild);

    var from = E.getUnit(state.category, state.from);
    var to = E.getUnit(state.category, state.to);
    if (dom.refHeadFrom) dom.refHeadFrom.textContent = from.symbol;
    if (dom.refHeadTo) dom.refHeadTo.textContent = to.symbol;

    E.referenceRows(state.category, state.from, state.to).forEach(function (row) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', '', E.formatValue(row.from, { precision: 4 })));
      tr.appendChild(el('td', '', E.formatValue(row.to, { precision: 4 })));
      dom.refBody.appendChild(tr);
    });
  }

  /* ======================================================================
     Category & unit selectors
     ====================================================================== */

  function buildCategoryTabs() {
    if (!dom.tabs) return;
    E.CATEGORIES.forEach(function (cat) {
      var btn = el('button', 'uc-cat');
      btn.type = 'button';
      btn.dataset.category = cat.id;
      btn.setAttribute('role', 'tab');
      btn.appendChild(el('span', 'uc-cat__icon', cat.icon));
      btn.appendChild(el('span', 'uc-cat__label', cat.label));
      btn.addEventListener('click', function () { setCategory(cat.id); });
      dom.tabs.appendChild(btn);
    });
  }

  function setCategory(id) {
    if (state.category === id) return;
    var cat = E.getCategory(id);
    state.category = id;
    /* Start on a sensible pair rather than whatever index happened to match. */
    state.from = cat.units[0].id;
    state.to = (cat.units[1] || cat.units[0]).id;
    state = E.normalize(state);
    lastEdited = 'from';
    fillUnitSelects();
    syncSelects();
    if (dom.fromValue) dom.fromValue.value = state.raw;
    render();
    syncTabs();
    announce(cat.label + ' selected.');
  }

  function syncTabs() {
    all('[data-category]').forEach(function (btn) {
      var active = btn.dataset.category === state.category;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    if (dom.categoryLabel) {
      var cat = E.getCategory(state.category);
      dom.categoryLabel.textContent = cat.icon + ' ' + cat.label;
    }
  }

  function fillUnitSelects() {
    var cat = E.getCategory(state.category);
    [dom.fromUnit, dom.toUnit].forEach(function (select) {
      if (!select) return;
      while (select.firstChild) select.removeChild(select.firstChild);
      cat.units.forEach(function (unit) {
        var opt = document.createElement('option');
        opt.value = unit.id;
        opt.textContent = unit.name + ' (' + unit.symbol + ')';
        select.appendChild(opt);
      });
    });
  }

  function syncSelects() {
    if (dom.fromUnit) dom.fromUnit.value = state.from;
    if (dom.toUnit) dom.toUnit.value = state.to;
  }

  /* ======================================================================
     Input handling
     ====================================================================== */

  function readFrom() {
    state.raw = dom.fromValue.value;
    state.value = E.parseValue(state.raw);
    lastEdited = 'from';
    render();
  }

  /** Editing the result field converts backwards. */
  function readTo() {
    var parsed = E.parseValue(dom.toValue.value);
    lastEdited = 'to';
    if (!isFinite(parsed)) {
      state.value = NaN;
      state.raw = dom.toValue.value;
      render();
      return;
    }
    var back = E.convert(parsed, state.category, state.to, state.from);
    state.value = back;
    state.raw = E.formatValue(back, { mode: state.format.mode, precision: state.format.precision, grouping: false });
    if (dom.fromValue) dom.fromValue.value = state.raw;
    render();
  }

  function swapUnits() {
    var oldFrom = state.from;
    var oldTo = state.to;
    state.from = oldTo;
    state.to = oldFrom;
    /* Keep the number the user is looking at: the displayed result becomes
       the new input, which is what "swap" is expected to do. That result is
       the OLD pair converted — using the new `to` here would convert a unit
       to itself and silently leave the value unchanged. */
    var current = E.convert(state.value, state.category, oldFrom, oldTo);
    if (isFinite(current)) {
      state.value = current;
      state.raw = E.formatValue(current, { mode: state.format.mode, precision: state.format.precision, grouping: false });
      if (dom.fromValue) dom.fromValue.value = state.raw;
    }
    state = E.normalize(state);
    lastEdited = 'from';
    syncSelects();
    render();
    announce('Units swapped.');
  }

  /* ======================================================================
     Quick conversions, search, history
     ====================================================================== */

  function buildQuickChips() {
    if (!dom.quick) return;
    E.QUICK.forEach(function (q) {
      var btn = el('button', 'uc-quick', q.label);
      btn.type = 'button';
      btn.dataset.quick = q.category + ':' + q.from + ':' + q.to;
      btn.addEventListener('click', function () {
        state.category = q.category;
        state.from = q.from;
        state.to = q.to;
        state = E.normalize(state);
        lastEdited = 'from';
        fillUnitSelects();
        syncSelects();
        syncTabs();
        render();
        announce(q.label + ' selected.');
      });
      dom.quick.appendChild(btn);
    });
  }

  function runSearch() {
    if (!dom.searchResults) return;
    var q = dom.search ? dom.search.value : '';
    while (dom.searchResults.firstChild) dom.searchResults.removeChild(dom.searchResults.firstChild);

    var results = E.searchUnits(q, 10);
    dom.searchResults.hidden = results.length === 0;
    if (!results.length) return;

    results.forEach(function (r) {
      var btn = el('button', 'uc-searchitem');
      btn.type = 'button';
      btn.appendChild(el('span', 'uc-searchitem__name', r.unit.name));
      btn.appendChild(el('span', 'uc-searchitem__sym', r.unit.symbol));
      btn.appendChild(el('span', 'uc-searchitem__cat', r.category.label));
      btn.addEventListener('click', function () {
        state.category = r.category.id;
        state.from = r.unit.id;
        var others = r.category.units.filter(function (x) { return x.id !== r.unit.id; });
        state.to = (others[0] || r.unit).id;
        state = E.normalize(state);
        fillUnitSelects();
        syncSelects();
        syncTabs();
        render();
        dom.searchResults.hidden = true;
        if (dom.search) dom.search.value = '';
        announce(r.unit.name + ' selected.');
      });
      dom.searchResults.appendChild(btn);
    });
  }

  function pushHistory() {
    if (!isFinite(state.value)) return;
    var entry = {
      category: state.category, from: state.from, to: state.to,
      raw: state.raw,
      label: fmt(state.value) + ' ' + E.getUnit(state.category, state.from).symbol +
        ' = ' + fmt(E.convert(state.value, state.category, state.from, state.to)) +
        ' ' + E.getUnit(state.category, state.to).symbol
    };
    history = history.filter(function (h) { return h.label !== entry.label; });
    history.unshift(entry);
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (err) {}
    renderHistory();
  }

  function renderHistory() {
    if (!dom.historyList) return;
    while (dom.historyList.firstChild) dom.historyList.removeChild(dom.historyList.firstChild);
    if (dom.historyPanel) dom.historyPanel.hidden = history.length === 0;

    history.forEach(function (entry) {
      var btn = el('button', 'uc-history__item', entry.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        state = E.normalize(Object.assign({}, state, {
          category: entry.category, from: entry.from, to: entry.to, raw: entry.raw, value: entry.raw
        }));
        lastEdited = 'from';
        fillUnitSelects();
        syncSelects();
        syncTabs();
        if (dom.fromValue) dom.fromValue.value = state.raw;
        render();
      });
      dom.historyList.appendChild(btn);
    });
  }

  /* ======================================================================
     Persistence & sharing
     ====================================================================== */

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) {}
  }

  function loadState() {
    /* A hash in the URL beats a saved preference — someone followed a link. */
    var fromHash = E.decodeState(window.location.hash);
    if (fromHash) return fromHash;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return E.normalize(parsed);
      }
    } catch (err) {}
    return E.defaultState();
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) history = parsed.slice(0, HISTORY_LIMIT);
    } catch (err) { history = []; }
  }

  function updateHash() {
    var next = '#' + E.encodeState(state);
    if (window.location.hash !== next) {
      try { window.history.replaceState(null, '', next); } catch (err) {}
    }
  }

  function shareLink() {
    var url = window.location.origin + window.location.pathname + '#' + E.encodeState(state);
    copyText(url, 'Link copied');
  }

  /* ======================================================================
     Export
     ====================================================================== */

  function exportCSV() {
    var cat = E.getCategory(state.category);
    var lines = ['Unit,Symbol,Value'];
    E.convertAll(state.value, state.category, state.from).forEach(function (row) {
      lines.push('"' + row.unit.name.replace(/"/g, '""') + '","' + row.unit.symbol.replace(/"/g, '""') + '",' +
        E.formatValue(row.value, { mode: state.format.mode, precision: state.format.precision, grouping: false }));
    });
    download(lines.join('\r\n'), 'unit-conversion-' + cat.id + '.csv', 'text/csv');
    status('CSV downloaded ✓', 'good');
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.page = document.querySelector('[data-unit-converter-page]');
    dom.status = $('ucStatus');
    dom.live = $('ucLive');

    dom.tabs = $('ucCategoryTabs');
    dom.categoryLabel = $('ucActiveCategory');
    dom.fromValue = $('ucFromValue');
    dom.toValue = $('ucToValue');
    dom.fromUnit = $('ucFromUnit');
    dom.toUnit = $('ucToUnit');
    dom.swap = $('ucSwap');
    dom.invalid = $('ucInvalid');

    dom.bigFrom = $('ucBigFrom');
    dom.bigResult = $('ucBigResult');
    dom.formula = $('ucFormula');
    dom.notes = $('ucUnitNotes');

    dom.allPanel = $('ucAllPanel');
    dom.allBody = $('ucAllBody');
    dom.showAll = $('ucShowAll');

    dom.refBody = $('ucRefBody');
    dom.refHeadFrom = $('ucRefHeadFrom');
    dom.refHeadTo = $('ucRefHeadTo');

    dom.quick = $('ucQuick');
    dom.search = $('ucSearch');
    dom.searchResults = $('ucSearchResults');

    dom.historyPanel = $('ucHistoryPanel');
    dom.historyList = $('ucHistoryList');
    dom.clearHistory = $('ucClearHistory');

    dom.mode = $('ucMode');
    dom.precision = $('ucPrecision');
    dom.grouping = $('ucGrouping');

    dom.copyResult = $('ucCopyResult');
    dom.share = $('ucShare');
    dom.exportCsv = $('ucExportCsv');
    dom.clear = $('ucClear');
  }

  function wire() {
    on(dom.fromValue, 'input', readFrom);
    on(dom.toValue, 'input', readTo);
    on(dom.fromValue, 'change', pushHistory);

    on(dom.fromUnit, 'change', function () {
      state.from = dom.fromUnit.value;
      state = E.normalize(state);
      lastEdited = 'from';
      render();
    });
    on(dom.toUnit, 'change', function () {
      state.to = dom.toUnit.value;
      state = E.normalize(state);
      lastEdited = 'from';
      render();
    });

    on(dom.swap, 'click', swapUnits);

    on(dom.showAll, 'change', function () {
      state.showAll = dom.showAll.checked;
      render();
    });

    on(dom.mode, 'change', function () {
      state.format.mode = dom.mode.value;
      state = E.normalize(state);
      render();
    });
    on(dom.precision, 'input', function () {
      state.format.precision = parseInt(dom.precision.value, 10);
      state = E.normalize(state);
      var out = dom.precision.parentNode.querySelector('output');
      if (out) out.textContent = state.format.precision;
      render();
    });
    on(dom.grouping, 'change', function () {
      state.format.grouping = dom.grouping.checked;
      render();
    });

    on(dom.copyResult, 'click', function () {
      var result = E.convert(state.value, state.category, state.from, state.to);
      if (!isFinite(result)) { status('Enter a number first.', 'bad'); return; }
      copyText(E.formatValue(result, { mode: state.format.mode, precision: state.format.precision, grouping: false }),
        'Result copied');
    });
    on(dom.share, 'click', shareLink);
    on(dom.exportCsv, 'click', exportCSV);
    on(dom.clear, 'click', function () {
      state.raw = '';
      state.value = NaN;
      if (dom.fromValue) dom.fromValue.value = '';
      if (dom.toValue) dom.toValue.value = '';
      render();
    });

    on(dom.clearHistory, 'click', function () {
      history = [];
      try { localStorage.removeItem(HISTORY_KEY); } catch (err) {}
      renderHistory();
      status('History cleared.', 'info');
    });

    var searchTimer = 0;
    on(dom.search, 'input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 140);
    });
    on(dom.search, 'blur', function () {
      setTimeout(function () { if (dom.searchResults) dom.searchResults.hidden = true; }, 180);
    });

    /* Arrow-key movement across the category tabs, as a tablist should. */
    on(dom.tabs, 'keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
      var buttons = all('[data-category]');
      var i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      var next = e.key === 'ArrowRight' ? (i + 1) % buttons.length
        : e.key === 'ArrowLeft' ? (i - 1 + buttons.length) % buttons.length
          : e.key === 'Home' ? 0 : buttons.length - 1;
      buttons[next].focus();
      setCategory(buttons[next].dataset.category);
    });

    window.addEventListener('hashchange', function () {
      var fromHash = E.decodeState(window.location.hash);
      if (!fromHash) return;
      state = fromHash;
      lastEdited = 'from';
      fillUnitSelects();
      syncSelects();
      syncTabs();
      if (dom.fromValue) dom.fromValue.value = state.raw;
      render();
    });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function initializeConverter() {
    cacheDom();
    if (!dom.page) return;

    state = loadState();
    loadHistory();

    buildCategoryTabs();
    buildQuickChips();
    fillUnitSelects();
    syncSelects();
    syncTabs();
    wire();

    if (dom.fromValue) dom.fromValue.value = state.raw;
    if (dom.showAll) dom.showAll.checked = state.showAll;
    if (dom.mode) dom.mode.value = state.format.mode;
    if (dom.precision) {
      dom.precision.value = String(state.format.precision);
      var out = dom.precision.parentNode.querySelector('output');
      if (out) out.textContent = state.format.precision;
    }
    if (dom.grouping) dom.grouping.checked = state.format.grouping;

    renderHistory();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeConverter);
  else initializeConverter();

  window.UnitConverterStudio = {
    getState: function () { return state; },
    setState: function (next) {
      state = E.normalize(next);
      fillUnitSelects(); syncSelects(); syncTabs();
      if (dom.fromValue) dom.fromValue.value = state.raw;
      render();
    },
    setCategory: setCategory,
    swapUnits: swapUnits,
    render: render,
    getHistory: function () { return history; },
    STORAGE_KEY: STORAGE_KEY,
    HISTORY_KEY: HISTORY_KEY
  };
})();
