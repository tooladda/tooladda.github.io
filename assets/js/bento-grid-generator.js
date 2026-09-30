/*!
 * ToolAdda — Bento Grid Layout Generator
 * -----------------------------------------------------------------------------
 * A visual CSS Grid builder. There is ONE source of truth — `state` — and three
 * consumers of it: the live canvas, the generated HTML and the generated CSS.
 * Nothing is hard-coded twice, so the preview can never drift from the export.
 *
 * SECURITY
 *   Every user-controlled string (titles, text, icons, class names, image URLs,
 *   custom CSS) is escaped or allow-listed before it reaches the DOM or the
 *   generated code. The preview builds nodes with textContent, never innerHTML.
 *
 * Runs entirely in the browser. Nothing is uploaded.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.getElementById('bentoApp');
  if (!root) { return; }

  var $ = function (id) { return doc.getElementById(id); };
  var $$ = function (selector, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(selector));
  };

  /* =========================================================================
   * 1. Utilities
   * ====================================================================== */

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clamp(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) { return min; }
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  /** Only http(s), protocol-relative and site-relative image URLs are accepted. */
  function safeUrl(raw) {
    var url = String(raw == null ? '' : raw).trim().replace(/[\u0000-\u001F\u007F]/g, '');
    if (!url) { return ''; }
    if (/^https?:\/\//i.test(url) || /^\/\//.test(url)) { return url; }
    if (/^[./]/.test(url) && !/:/.test(url)) { return url; }
    return '';
  }

  /** Class names must be plain CSS identifiers — no spaces, quotes or angle brackets. */
  function safeClass(raw, fallback) {
    var name = String(raw == null ? '' : raw).trim();
    return /^[a-zA-Z_][\w-]*$/.test(name) ? name : fallback;
  }

  var CSS_PROP_DENY = /^(behavior|expression|binding|-moz-binding|filter)$/i;

  /**
   * Custom CSS is parsed into declarations and re-serialised. Anything that is
   * not a plain `property: value` pair, or that smuggles a url(javascript:),
   * an @rule, a brace or a comment, is dropped.
   */
  function sanitizeCustomCss(raw) {
    var text = String(raw == null ? '' : raw);
    if (!text.trim()) { return []; }
    if (/[{}<>]|\/\*|\*\/|@|expression\s*\(/i.test(text)) { return []; }

    var out = [];
    text.split(';').forEach(function (chunk) {
      var colon = chunk.indexOf(':');
      if (colon === -1) { return; }
      var prop = chunk.slice(0, colon).trim().toLowerCase();
      var value = chunk.slice(colon + 1).trim();
      if (!prop || !value) { return; }
      if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) { return; }
      if (CSS_PROP_DENY.test(prop)) { return; }
      if (/url\s*\(\s*['"]?\s*(javascript|data:text|vbscript)/i.test(value)) { return; }
      if (/[;<>]/.test(value)) { return; }
      if (value.length > 200) { return; }
      out.push({ prop: prop, value: value });
    });
    return out;
  }

  function download(filename, contents, mime) {
    try {
      var blob = new Blob([contents], { type: mime });
      var url = URL.createObjectURL(blob);
      var link = doc.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      doc.body.appendChild(link);
      link.click();
      doc.body.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (err) { return false; }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, legacy);
    }
    return Promise.resolve(legacy());
    function legacy() {
      try {
        var area = doc.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        doc.body.appendChild(area);
        area.select();
        var ok = doc.execCommand('copy');
        doc.body.removeChild(area);
        return !!ok;
      } catch (err) { return false; }
    }
  }

  /* =========================================================================
   * 2. State
   * ====================================================================== */

  var idCounter = 0;
  /** Monotonic ids — never derived from array position, so deletion is safe. */
  function nextId() {
    idCounter += 1;
    return 'card-' + idCounter;
  }

  var PALETTE = [
    { bgType: 'gradient', bgGradient: 'linear-gradient(135deg, #0891b2, #1e3a8a)' },
    { bgType: 'solid', bgColor: '#111827' },
    { bgType: 'gradient', bgGradient: 'linear-gradient(135deg, #7c3aed, #2563eb)' },
    { bgType: 'solid', bgColor: '#0f172a' },
    { bgType: 'gradient', bgGradient: 'linear-gradient(135deg, #059669, #0891b2)' },
    { bgType: 'solid', bgColor: '#1f2937' },
    { bgType: 'gradient', bgGradient: 'linear-gradient(135deg, #db2777, #7c3aed)' },
    { bgType: 'solid', bgColor: '#18181b' }
  ];

  function makeCard(overrides) {
    var index = overrides && overrides.paletteIndex !== undefined
      ? overrides.paletteIndex : idCounter % PALETTE.length;
    var tone = PALETTE[index % PALETTE.length];

    var card = {
      id: nextId(),
      colStart: 1, colSpan: 1, rowStart: 1, rowSpan: 1,
      tabletColSpan: 0,   // 0 = inherit / auto
      mobileColSpan: 0,
      type: 'text',
      title: 'Card title',
      description: 'A short supporting line of text.',
      icon: '',
      imageUrl: '',
      objectFit: 'cover',
      buttonLabel: 'Learn more',
      buttonHref: '#',
      statValue: '100+',
      statLabel: 'Happy users',
      bgType: tone.bgType,
      bgColor: tone.bgColor || '#111827',
      bgGradient: tone.bgGradient || 'linear-gradient(135deg, #0891b2, #1e3a8a)',
      borderOn: true,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: 'rgba(255, 255, 255, 0.10)',
      radius: 20,
      padding: 22,
      shadow: 'md',
      shadowCustom: '0 10px 30px rgba(0, 0, 0, 0.25)',
      textColor: '#f8fafc',
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 1.5,
      textAlign: 'left',
      alignX: 'stretch',
      alignY: 'stretch',
      customCss: ''
    };

    Object.keys(overrides || {}).forEach(function (key) {
      if (key !== 'paletteIndex' && card[key] !== undefined) { card[key] = overrides[key]; }
    });
    return card;
  }

  function defaultState() {
    idCounter = 0;
    return {
      grid: {
        columns: 4, rows: 4, gap: 16, useSplitGap: false, columnGap: 16, rowGap: 16,
        maxWidth: 1120, rowHeight: 130, padding: 24,
        containerClass: 'bento-grid', cardClass: 'bento-card'
      },
      responsive: { tabletColumns: 2, mobileColumns: 1 },
      cards: [
        makeCard({ colStart: 1, colSpan: 2, rowStart: 1, rowSpan: 2, type: 'feature', icon: '🍱',
          title: 'Bento layouts', description: 'Cards of different sizes on one CSS Grid.', paletteIndex: 0 }),
        makeCard({ colStart: 3, colSpan: 2, rowStart: 1, rowSpan: 1, type: 'text',
          title: 'Responsive', description: 'Real media queries, not a squashed desktop.', paletteIndex: 1 }),
        makeCard({ colStart: 3, colSpan: 1, rowStart: 2, rowSpan: 2, type: 'stat',
          statValue: '4×4', statLabel: 'Starting grid', paletteIndex: 2 }),
        makeCard({ colStart: 4, colSpan: 1, rowStart: 2, rowSpan: 1, type: 'icon', icon: '⚡', paletteIndex: 3 }),
        makeCard({ colStart: 4, colSpan: 1, rowStart: 3, rowSpan: 2, type: 'text',
          title: 'Clean code', description: 'Copy production-ready HTML and CSS.', paletteIndex: 4 }),
        makeCard({ colStart: 1, colSpan: 2, rowStart: 3, rowSpan: 2, type: 'button',
          title: 'Ship it', description: 'Export the layout when you are happy.', paletteIndex: 5 }),
        makeCard({ colStart: 3, colSpan: 1, rowStart: 4, rowSpan: 1, type: 'text',
          title: 'Free', description: 'No signup.', paletteIndex: 6 })
      ],
      selectedId: null,
      view: 'desktop',
      showGrid: false,
      showLabels: true,
      canvasBg: 'dark',
      canvasCustom: '#0b1220'
    };
  }

  var state = defaultState();

  function selectedCard() {
    if (!state.selectedId) { return null; }
    for (var i = 0; i < state.cards.length; i += 1) {
      if (state.cards[i].id === state.selectedId) { return state.cards[i]; }
    }
    return null;
  }

  function cloneState(source) {
    return JSON.parse(JSON.stringify(source));
  }

  /* =========================================================================
   * 3. History (undo / redo)
   * ====================================================================== */

  var history = { past: [], future: [], limit: 60 };

  function pushHistory() {
    history.past.push(cloneState(state));
    if (history.past.length > history.limit) { history.past.shift(); }
    history.future.length = 0;
    updateHistoryButtons();
  }

  function undo() {
    if (!history.past.length) { return; }
    history.future.push(cloneState(state));
    state = history.past.pop();
    afterHistory('Undid the last change.');
  }

  function redo() {
    if (!history.future.length) { return; }
    history.past.push(cloneState(state));
    state = history.future.pop();
    afterHistory('Redid the change.');
  }

  function afterHistory(message) {
    // ids are restored with the state, so keep the counter ahead of them
    state.cards.forEach(function (card) {
      var n = Number(String(card.id).replace(/\D/g, ''));
      if (n > idCounter) { idCounter = n; }
    });
    renderAll();
    setStatus(message, 'info');
  }

  function updateHistoryButtons() {
    if (el.undo) { el.undo.disabled = history.past.length === 0; }
    if (el.redo) { el.redo.disabled = history.future.length === 0; }
  }

  /* =========================================================================
   * 4. Grid geometry
   * ====================================================================== */

  function cardCells(card) {
    var cells = [];
    for (var r = card.rowStart; r < card.rowStart + card.rowSpan; r += 1) {
      for (var c = card.colStart; c < card.colStart + card.colSpan; c += 1) {
        cells.push(r + ':' + c);
      }
    }
    return cells;
  }

  function occupancy(ignoreId) {
    var map = Object.create(null);
    state.cards.forEach(function (card) {
      if (card.id === ignoreId) { return; }
      cardCells(card).forEach(function (key) { map[key] = card.id; });
    });
    return map;
  }

  function fitsInGrid(colStart, colSpan, rowStart, rowSpan) {
    return colStart >= 1 && rowStart >= 1 &&
      colStart + colSpan - 1 <= state.grid.columns &&
      rowStart + rowSpan - 1 <= state.grid.rows;
  }

  function areaIsFree(colStart, colSpan, rowStart, rowSpan, ignoreId) {
    if (!fitsInGrid(colStart, colSpan, rowStart, rowSpan)) { return false; }
    var map = occupancy(ignoreId);
    for (var r = rowStart; r < rowStart + rowSpan; r += 1) {
      for (var c = colStart; c < colStart + colSpan; c += 1) {
        if (map[r + ':' + c]) { return false; }
      }
    }
    return true;
  }

  /** Ids of the cards sitting under a proposed area. */
  function cardsInArea(colStart, colSpan, rowStart, rowSpan, ignoreId) {
    var map = occupancy(ignoreId);
    var found = {};
    for (var r = rowStart; r < rowStart + rowSpan; r += 1) {
      for (var c = colStart; c < colStart + colSpan; c += 1) {
        var hit = map[r + ':' + c];
        if (hit) { found[hit] = true; }
      }
    }
    return Object.keys(found);
  }

  function findFreeSpot(colSpan, rowSpan) {
    for (var r = 1; r <= state.grid.rows - rowSpan + 1; r += 1) {
      for (var c = 1; c <= state.grid.columns - colSpan + 1; c += 1) {
        if (areaIsFree(c, colSpan, r, rowSpan, null)) { return { colStart: c, rowStart: r }; }
      }
    }
    return null;
  }

  /**
   * Pulls every card back inside the grid after columns or rows shrink.
   * Clamping alone is not enough: several cards can clamp onto the same cells,
   * so each one is re-placed against the cards already settled. Rows grow
   * before any card is given up.
   */
  function reflowIntoGrid() {
    var occupied = Object.create(null);
    var kept = [];
    var dropped = 0;

    function isFree(colStart, colSpan, rowStart, rowSpan) {
      if (colStart < 1 || rowStart < 1) { return false; }
      if (colStart + colSpan - 1 > state.grid.columns) { return false; }
      if (rowStart + rowSpan - 1 > state.grid.rows) { return false; }
      for (var r = rowStart; r < rowStart + rowSpan; r += 1) {
        for (var c = colStart; c < colStart + colSpan; c += 1) {
          if (occupied[r + ':' + c]) { return false; }
        }
      }
      return true;
    }

    function take(card) {
      for (var r = card.rowStart; r < card.rowStart + card.rowSpan; r += 1) {
        for (var c = card.colStart; c < card.colStart + card.colSpan; c += 1) {
          occupied[r + ':' + c] = 1;
        }
      }
      kept.push(card);
    }

    function scan(colSpan, rowSpan) {
      for (var r = 1; r <= state.grid.rows - rowSpan + 1; r += 1) {
        for (var c = 1; c <= state.grid.columns - colSpan + 1; c += 1) {
          if (isFree(c, colSpan, r, rowSpan)) { return { colStart: c, rowStart: r }; }
        }
      }
      return null;
    }

    state.cards.forEach(function (card) {
      card.colSpan = clamp(card.colSpan, 1, state.grid.columns);
      card.rowSpan = clamp(card.rowSpan, 1, state.grid.rows);
      card.colStart = clamp(card.colStart, 1, state.grid.columns - card.colSpan + 1);
      card.rowStart = clamp(card.rowStart, 1, state.grid.rows - card.rowSpan + 1);

      if (isFree(card.colStart, card.colSpan, card.rowStart, card.rowSpan)) { take(card); return; }

      // Same footprint somewhere else, then progressively smaller ones.
      var sizes = [
        [card.colSpan, card.rowSpan],
        [1, card.rowSpan],
        [card.colSpan, 1],
        [1, 1]
      ];
      for (var i = 0; i < sizes.length; i += 1) {
        var spot = scan(sizes[i][0], sizes[i][1]);
        if (spot) {
          card.colSpan = sizes[i][0];
          card.rowSpan = sizes[i][1];
          card.colStart = spot.colStart;
          card.rowStart = spot.rowStart;
          take(card);
          return;
        }
      }

      // Still nowhere to go — make room by growing the grid before giving up.
      while (state.grid.rows < 12) {
        state.grid.rows += 1;
        var extra = scan(1, 1);
        if (extra) {
          card.colSpan = 1;
          card.rowSpan = 1;
          card.colStart = extra.colStart;
          card.rowStart = extra.rowStart;
          take(card);
          return;
        }
      }
      dropped += 1;
    });

    state.cards = kept;
    if (dropped) {
      setStatus(dropped + ' card' + (dropped === 1 ? '' : 's') +
        ' could not fit in the smaller grid and were removed. Press Ctrl+Z to undo.', 'error');
    }
  }

  /* =========================================================================
   * 5. Card operations
   * ====================================================================== */

  function addCard() {
    var spot = findFreeSpot(1, 1);
    if (!spot) {
      if (state.grid.rows < 12) {
        state.grid.rows += 1;
        spot = findFreeSpot(1, 1);
        setStatus('No space left, so a row was added.', 'info');
      }
      if (!spot) {
        setStatus('The grid is full. Increase the columns or rows to add more cards.', 'error');
        return;
      }
    }
    pushHistory();
    var card = makeCard({ colStart: spot.colStart, rowStart: spot.rowStart });
    state.cards.push(card);
    state.selectedId = card.id;
    renderAll();
    announce('Card added');
  }

  function duplicateCard() {
    var card = selectedCard();
    if (!card) { setStatus('Select a card first.', 'error'); return; }
    var spot = findFreeSpot(card.colSpan, card.rowSpan) || findFreeSpot(1, 1);
    if (!spot) { setStatus('No free space for a copy. Add a row or column first.', 'error'); return; }

    pushHistory();
    var copy = cloneState(card);
    copy.id = nextId();
    copy.colStart = spot.colStart;
    copy.rowStart = spot.rowStart;
    if (!areaIsFree(copy.colStart, copy.colSpan, copy.rowStart, copy.rowSpan, null)) {
      copy.colSpan = 1;
      copy.rowSpan = 1;
    }
    state.cards.push(copy);
    state.selectedId = copy.id;
    renderAll();
    announce('Card duplicated');
  }

  function deleteCard() {
    var card = selectedCard();
    if (!card) { setStatus('Select a card first.', 'error'); return; }
    pushHistory();
    state.cards = state.cards.filter(function (item) { return item.id !== card.id; });
    state.selectedId = null;
    renderAll();
    announce('Card deleted');
    setStatus('Card removed. Press Ctrl+Z to undo.', 'info');
  }

  function makeHandle(id) {
    var handle = doc.createElement('span');
    handle.className = 'bento-handle';
    handle.dataset.resize = id;
    handle.setAttribute('aria-hidden', 'true');
    handle.title = 'Drag to resize';
    return handle;
  }

  /**
   * Updates the selected state on the existing nodes.
   *
   * Deliberately does NOT rebuild the grid: selection happens on pointerdown,
   * and destroying the node the user is physically holding would detach it
   * mid-gesture — pointer capture would fail and the drag would break as soon
   * as the pointer left the element.
   */
  function applySelection() {
    $$('.bento-card-node', el.grid).forEach(function (node) {
      var isSelected = node.dataset.id === state.selectedId;
      node.classList.toggle('is-selected', isSelected);
      node.setAttribute('aria-pressed', String(isSelected));

      var handle = node.querySelector('[data-resize]');
      if (isSelected && !handle) { node.appendChild(makeHandle(node.dataset.id)); }
      if (!isSelected && handle) { handle.remove(); }
    });
  }

  function selectCard(id) {
    state.selectedId = id;
    applySelection();
    renderCardList();
    renderInspector();
  }

  function moveCard(card, colStart, rowStart) {
    if (!fitsInGrid(colStart, card.colSpan, rowStart, card.rowSpan)) { return false; }
    if (areaIsFree(colStart, card.colSpan, rowStart, card.rowSpan, card.id)) {
      card.colStart = colStart;
      card.rowStart = rowStart;
      return true;
    }
    // A clean swap is allowed when exactly one card of the same size is in the way.
    var blockers = cardsInArea(colStart, card.colSpan, rowStart, card.rowSpan, card.id);
    if (blockers.length === 1) {
      var other = state.cards.filter(function (c) { return c.id === blockers[0]; })[0];
      if (other && other.colSpan === card.colSpan && other.rowSpan === card.rowSpan) {
        other.colStart = card.colStart;
        other.rowStart = card.rowStart;
        card.colStart = colStart;
        card.rowStart = rowStart;
        return true;
      }
    }
    return false;
  }

  function resizeCard(card, colSpan, rowSpan) {
    colSpan = clamp(colSpan, 1, state.grid.columns);
    rowSpan = clamp(rowSpan, 1, state.grid.rows);
    if (!areaIsFree(card.colStart, colSpan, card.rowStart, rowSpan, card.id)) { return false; }
    card.colSpan = colSpan;
    card.rowSpan = rowSpan;
    return true;
  }

  /* =========================================================================
   * 6. Shared style model — used by BOTH the preview and the generated CSS
   * ====================================================================== */

  var SHADOWS = {
    none: 'none',
    sm: '0 1px 2px rgba(0, 0, 0, 0.16)',
    md: '0 10px 30px rgba(0, 0, 0, 0.25)',
    lg: '0 24px 60px rgba(0, 0, 0, 0.35)'
  };

  function shadowValue(card) {
    if (card.shadow === 'custom') { return card.shadowCustom || 'none'; }
    return SHADOWS[card.shadow] || 'none';
  }

  function backgroundValue(card) {
    if (card.bgType === 'transparent') { return 'transparent'; }
    if (card.bgType === 'gradient') { return card.bgGradient; }
    return card.bgColor;
  }

  /** The full declaration set for a card, as an ordered list of [prop, value]. */
  function cardDeclarations(card) {
    var list = [
      ['background', backgroundValue(card)],
      ['border-radius', card.radius + 'px'],
      ['padding', card.padding + 'px'],
      ['color', card.textColor],
      ['font-size', card.fontSize + 'px'],
      ['font-weight', String(card.fontWeight)],
      ['line-height', String(card.lineHeight)],
      ['text-align', card.textAlign],
      ['box-shadow', shadowValue(card)],
      ['border', card.borderOn
        ? card.borderWidth + 'px ' + card.borderStyle + ' ' + card.borderColor
        : 'none']
    ];
    if (card.alignX && card.alignX !== 'stretch') { list.push(['justify-self', card.alignX]); }
    if (card.alignY && card.alignY !== 'stretch') { list.push(['align-self', card.alignY]); }
    sanitizeCustomCss(card.customCss).forEach(function (decl) {
      list.push([decl.prop, decl.value]);
    });
    return list;
  }

  function placementDeclarations(card) {
    return [
      ['grid-column', card.colStart + ' / span ' + card.colSpan],
      ['grid-row', card.rowStart + ' / span ' + card.rowSpan]
    ];
  }

  /* =========================================================================
   * 7. Rendering the canvas
   * ====================================================================== */

  var el = {};

  var VIEW_WIDTHS = { desktop: 1440, tablet: 768, mobile: 390 };

  function activeColumns() {
    if (state.view === 'tablet') { return state.responsive.tabletColumns; }
    if (state.view === 'mobile') { return state.responsive.mobileColumns; }
    return state.grid.columns;
  }

  /** Span a card actually uses in the current preview viewport. */
  function viewSpan(card) {
    var columns = activeColumns();
    if (state.view === 'tablet') {
      return Math.min(card.tabletColSpan || card.colSpan, columns);
    }
    if (state.view === 'mobile') {
      return Math.min(card.mobileColSpan || card.colSpan, columns);
    }
    return card.colSpan;
  }

  function renderGrid() {
    var grid = el.grid;
    if (!grid) { return; }
    grid.textContent = '';

    var g = state.grid;
    var isDesktop = state.view === 'desktop';
    var columns = activeColumns();

    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0, 1fr))';
    grid.style.gridAutoRows = 'minmax(' + g.rowHeight + 'px, auto)';
    grid.style.gridTemplateRows = isDesktop
      ? 'repeat(' + g.rows + ', minmax(' + g.rowHeight + 'px, auto))' : '';
    grid.style.columnGap = (g.useSplitGap ? g.columnGap : g.gap) + 'px';
    grid.style.rowGap = (g.useSplitGap ? g.rowGap : g.gap) + 'px';
    grid.style.padding = g.padding + 'px';

    // Cell overlay (editor only — never exported)
    if (state.showGrid && isDesktop) {
      for (var r = 1; r <= g.rows; r += 1) {
        for (var c = 1; c <= g.columns; c += 1) {
          var cell = doc.createElement('div');
          cell.className = 'bento-cell';
          cell.style.gridColumn = c + ' / span 1';
          cell.style.gridRow = r + ' / span 1';
          cell.setAttribute('aria-hidden', 'true');
          var num = doc.createElement('span');
          num.textContent = String((r - 1) * g.columns + c);
          cell.appendChild(num);
          grid.appendChild(cell);
        }
      }
    }

    state.cards.forEach(function (card, index) {
      grid.appendChild(renderCard(card, index, isDesktop));
    });

    // Drop indicator lives inside the grid so it shares the same cell math.
    var indicator = doc.createElement('div');
    indicator.className = 'bento-drop';
    indicator.id = 'bentoDrop';
    indicator.hidden = true;
    indicator.setAttribute('aria-hidden', 'true');
    grid.appendChild(indicator);

    updateCanvasFrame();
  }

  function renderCard(card, index, isDesktop) {
    var node = doc.createElement('article');
    node.className = 'bento-card-node';
    node.dataset.id = card.id;
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', 'Card ' + (index + 1) + ': ' + (card.title || card.type) +
      '. Column ' + card.colStart + ' span ' + card.colSpan +
      ', row ' + card.rowStart + ' span ' + card.rowSpan);

    var selected = card.id === state.selectedId;
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-pressed', String(selected));

    if (isDesktop) {
      node.style.gridColumn = card.colStart + ' / span ' + card.colSpan;
      node.style.gridRow = card.rowStart + ' / span ' + card.rowSpan;
    } else {
      // Tablet and mobile flow in source order, exactly like the exported CSS.
      node.style.gridColumn = 'span ' + viewSpan(card);
      node.style.gridRow = 'span 1';
    }

    cardDeclarations(card).forEach(function (pair) {
      node.style.setProperty(pair[0], pair[1]);
    });

    node.style.display = 'flex';
    node.style.flexDirection = 'column';
    node.style.gap = '.4rem';
    node.style.justifyContent = card.textAlign === 'center' ? 'center' : 'flex-start';
    node.style.overflow = 'hidden';
    node.style.position = 'relative';

    node.appendChild(buildCardContent(card));

    if (state.showLabels) {
      var label = doc.createElement('span');
      label.className = 'bento-label';
      label.textContent = 'Card ' + (index + 1);
      label.setAttribute('aria-hidden', 'true');
      node.appendChild(label);
    }

    if (selected) { node.appendChild(makeHandle(card.id)); }
    return node;
  }

  /**
   * Builds the visible card body. Mirrors buildCardHtml() exactly — same
   * elements, same classes, same order — so preview and export cannot diverge.
   * Uses textContent throughout: user text is never parsed as markup.
   */
  function buildCardContent(card) {
    var frag = doc.createDocumentFragment();
    var cardClass = safeClass(state.grid.cardClass, 'bento-card');

    function make(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) { node.className = className; }
      if (text !== undefined) { node.textContent = text; }
      return node;
    }

    if (card.type === 'image') {
      var url = safeUrl(card.imageUrl);
      if (url) {
        var img = doc.createElement('img');
        img.className = cardClass + '__image';
        img.src = url;
        img.alt = card.title || '';
        img.loading = 'lazy';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = card.objectFit;
        img.style.borderRadius = Math.max(0, card.radius - 6) + 'px';
        frag.appendChild(img);
      } else {
        frag.appendChild(make('p', cardClass + '__text', 'Add an image URL in the inspector.'));
      }
      return frag;
    }

    if (card.type === 'empty') { return frag; }

    if (card.type === 'stat') {
      var value = make('strong', cardClass + '__value', card.statValue);
      value.style.fontSize = Math.round(card.fontSize * 2.1) + 'px';
      value.style.lineHeight = '1.1';
      frag.appendChild(value);
      frag.appendChild(make('span', cardClass + '__label', card.statLabel));
      return frag;
    }

    if (card.icon && (card.type === 'icon' || card.type === 'feature')) {
      var icon = make('span', cardClass + '__icon', card.icon);
      icon.style.fontSize = Math.round(card.fontSize * (card.type === 'icon' ? 2.4 : 1.7)) + 'px';
      icon.style.lineHeight = '1';
      frag.appendChild(icon);
    }
    if (card.type === 'icon') { return frag; }

    if (card.title) { frag.appendChild(make('h3', cardClass + '__title', card.title)); }
    if (card.description) {
      var text = make('p', cardClass + '__text', card.description);
      text.style.opacity = '.78';
      text.style.fontWeight = '400';
      text.style.fontSize = Math.max(11, Math.round(card.fontSize * 0.86)) + 'px';
      frag.appendChild(text);
    }

    if (card.type === 'button') {
      var link = make('span', cardClass + '__button', card.buttonLabel);
      link.style.marginTop = 'auto';
      link.style.alignSelf = 'flex-start';
      frag.appendChild(link);
    }
    return frag;
  }

  function updateCanvasFrame() {
    if (!el.frame) { return; }
    var width = VIEW_WIDTHS[state.view] || VIEW_WIDTHS.desktop;
    var target = state.view === 'desktop' ? Math.min(state.grid.maxWidth, width) : width;

    // The frame always takes its simulated width (see flex:0 0 auto in the CSS);
    // fitting the panel is the transform's job, never the layout's.
    el.frame.style.width = target + 'px';
    el.frame.style.maxWidth = 'none';

    var available = el.stage ? el.stage.clientWidth - 24 : target;
    var scale = available > 0 && target > available ? available / target : 1;

    // Always an explicit scale — clearing the property would leave the computed
    // value to the cascade, which is how a stale scale can survive a view switch.
    el.frame.style.transformOrigin = 'top left';
    el.frame.style.transform = 'scale(' + scale + ')';

    // A transform does not change layout size, so the wrapper is sized to the
    // scaled box by hand — otherwise the stage would scroll sideways.
    if (el.stageInner) {
      el.stageInner.style.width = Math.round(target * scale) + 'px';
      el.stageInner.style.height = scale < 1 ? Math.round(el.frame.offsetHeight * scale) + 'px' : '';
    }

    el.frame.dataset.bg = state.canvasBg;
    if (state.canvasBg === 'custom') {
      el.frame.style.background = state.canvasCustom;
    } else {
      el.frame.style.background = '';
    }
    if (el.viewWidth) {
      el.viewWidth.textContent = target + 'px' + (scale < 1 ? ' · ' + Math.round(scale * 100) + '%' : '');
    }
  }

  /* =========================================================================
   * 8. Card list + inspector
   * ====================================================================== */

  function renderCardList() {
    if (!el.cardList) { return; }
    el.cardList.textContent = '';
    state.cards.forEach(function (card, index) {
      var item = doc.createElement('li');
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'bento-cardrow';
      button.dataset.select = card.id;
      button.classList.toggle('is-active', card.id === state.selectedId);
      button.setAttribute('aria-pressed', String(card.id === state.selectedId));

      var swatch = doc.createElement('span');
      swatch.className = 'bento-cardrow__swatch';
      swatch.style.background = backgroundValue(card);

      var name = doc.createElement('span');
      name.className = 'bento-cardrow__name';
      name.textContent = 'Card ' + (index + 1) + (card.title ? ' · ' + card.title : '');

      var meta = doc.createElement('span');
      meta.className = 'bento-cardrow__meta';
      meta.textContent = card.colSpan + '×' + card.rowSpan;

      button.appendChild(swatch);
      button.appendChild(name);
      button.appendChild(meta);
      item.appendChild(button);
      el.cardList.appendChild(item);
    });
    if (el.cardCount) { el.cardCount.textContent = String(state.cards.length); }
  }

  function renderInspector() {
    var card = selectedCard();
    if (el.inspector) { el.inspector.hidden = !card; }
    if (el.inspectorEmpty) { el.inspectorEmpty.hidden = !!card; }
    if (!card) { return; }

    if (el.selectedId) { el.selectedId.textContent = card.id; }
    syncBindings();

    // Only show the fields the chosen card type actually uses.
    $$('[data-when]', el.inspector).forEach(function (node) {
      var types = node.dataset.when.split(',');
      node.hidden = types.indexOf(card.type) === -1;
    });
    $$('[data-when-bg]', el.inspector).forEach(function (node) {
      node.hidden = node.dataset.whenBg !== card.bgType;
    });
    $$('[data-when-shadow]', el.inspector).forEach(function (node) {
      node.hidden = node.dataset.whenShadow !== card.shadow;
    });
    $$('[data-when-border]', el.inspector).forEach(function (node) {
      node.hidden = !card.borderOn;
    });
  }

  /* =========================================================================
   * 9. Two-way bindings — one declarative pass instead of 60 listeners
   * ====================================================================== */

  function resolveTarget(path) {
    var parts = path.split('.');
    if (parts[0] === 'card') {
      var card = selectedCard();
      return card ? { object: card, key: parts[1] } : null;
    }
    if (parts[0] === 'grid') { return { object: state.grid, key: parts[1] }; }
    if (parts[0] === 'responsive') { return { object: state.responsive, key: parts[1] }; }
    return { object: state, key: parts[0] };
  }

  function readControl(input) {
    if (input.type === 'checkbox') { return input.checked; }
    if (input.type === 'number' || input.type === 'range') { return Number(input.value); }
    return input.value;
  }

  function syncBindings() {
    $$('[data-bind]').forEach(function (input) {
      var target = resolveTarget(input.dataset.bind);
      if (!target) { return; }
      var value = target.object[target.key];
      if (value === undefined) { return; }
      if (input.type === 'checkbox') { input.checked = !!value; }
      else if (input.value !== String(value)) { input.value = String(value); }
      var out = input.dataset.output ? $(input.dataset.output) : null;
      if (out) { out.textContent = String(value) + (input.dataset.unit || ''); }
    });
  }

  var historyTimer = 0;
  function pushHistoryDebounced() {
    window.clearTimeout(historyTimer);
    historyTimer = window.setTimeout(pushHistory, 450);
  }

  function bindControls() {
    $$('[data-bind]').forEach(function (input) {
      input.addEventListener('input', function () {
        var target = resolveTarget(input.dataset.bind);
        if (!target) { return; }

        var value = readControl(input);
        var path = input.dataset.bind;

        if (input.dataset.min !== undefined || input.dataset.max !== undefined) {
          value = clamp(value, Number(input.dataset.min || 0), Number(input.dataset.max || 9999));
        }
        target.object[target.key] = value;

        if (path === 'grid.columns' || path === 'grid.rows') {
          state.grid.columns = clamp(state.grid.columns, 1, 12);
          state.grid.rows = clamp(state.grid.rows, 1, 12);
          reflowIntoGrid();
        }
        if (path === 'card.colSpan' || path === 'card.rowSpan' ||
            path === 'card.colStart' || path === 'card.rowStart') {
          constrainSelected(path);
        }
        pushHistoryDebounced();
        renderAll();
      });
      input.addEventListener('change', function () { pushHistoryDebounced(); });
    });
  }

  /** Keeps manual span/start edits inside the grid and off other cards. */
  function constrainSelected(path) {
    var card = selectedCard();
    if (!card) { return; }
    card.colSpan = clamp(card.colSpan, 1, state.grid.columns);
    card.rowSpan = clamp(card.rowSpan, 1, state.grid.rows);
    card.colStart = clamp(card.colStart, 1, state.grid.columns - card.colSpan + 1);
    card.rowStart = clamp(card.rowStart, 1, state.grid.rows - card.rowSpan + 1);

    if (!areaIsFree(card.colStart, card.colSpan, card.rowStart, card.rowSpan, card.id)) {
      var spot = findFreeSpot(card.colSpan, card.rowSpan);
      if (spot) {
        card.colStart = spot.colStart;
        card.rowStart = spot.rowStart;
        setStatus('Moved the card to the nearest free space.', 'info');
      } else {
        card.colSpan = 1;
        card.rowSpan = 1;
        setStatus('That size would overlap another card.', 'error');
      }
    }
  }

  /* =========================================================================
   * 10. Drag to move, drag to resize
   * ====================================================================== */

  var drag = null;

  function parseTracks(value) {
    return String(value || '').split(' ')
      .map(parseFloat)
      .filter(function (n) { return isFinite(n); });
  }

  /** Which track contains `offset`, given real (possibly uneven) track sizes. */
  function trackIndex(tracks, gap, offset) {
    if (!tracks.length) { return 1; }
    var position = 0;
    for (var i = 0; i < tracks.length; i += 1) {
      var end = position + tracks[i];
      if (offset < end + gap / 2) { return i + 1; }
      position = end + gap;
    }
    return tracks.length;
  }

  /**
   * Maps a screen point to a grid cell.
   *
   * Reads the RESOLVED track sizes instead of assuming every row is the same
   * height: rows are minmax(rowHeight, auto), so a card with tall content makes
   * its row taller and uniform maths would drop cards on the wrong row.
   */
  function cellFromPoint(clientX, clientY) {
    var rect = el.grid.getBoundingClientRect();
    // The frame may be scaled down to fit the panel; undo that for pointer math.
    var scale = el.grid.offsetWidth ? rect.width / el.grid.offsetWidth : 1;
    if (!scale) { scale = 1; }

    var cs = window.getComputedStyle(el.grid);
    var cols = parseTracks(cs.gridTemplateColumns);
    var rows = parseTracks(cs.gridTemplateRows);
    var colGap = parseFloat(cs.columnGap) || 0;
    var rowGap = parseFloat(cs.rowGap) || 0;

    var x = (clientX - rect.left) / scale - (parseFloat(cs.paddingLeft) || 0);
    var y = (clientY - rect.top) / scale - (parseFloat(cs.paddingTop) || 0);

    return {
      col: clamp(trackIndex(cols, colGap, x), 1, activeColumns()),
      row: clamp(trackIndex(rows, rowGap, y), 1, state.grid.rows)
    };
  }

  function showDrop(colStart, colSpan, rowStart, rowSpan, valid) {
    var node = $('bentoDrop');
    if (!node) { return; }
    node.hidden = false;
    node.style.gridColumn = colStart + ' / span ' + colSpan;
    node.style.gridRow = rowStart + ' / span ' + rowSpan;
    node.classList.toggle('is-invalid', !valid);
  }

  function hideDrop() {
    var node = $('bentoDrop');
    if (node) { node.hidden = true; }
  }

  function onPointerDown(event) {
    if (state.view !== 'desktop') { return; }
    var handle = event.target.closest('[data-resize]');
    var node = event.target.closest('.bento-card-node');
    if (!node) { return; }

    var card = state.cards.filter(function (c) { return c.id === node.dataset.id; })[0];
    if (!card) { return; }

    selectCard(card.id);

    var start = cellFromPoint(event.clientX, event.clientY);
    drag = {
      card: card, mode: handle ? 'resize' : 'move',
      grabCol: start.col - card.colStart, grabRow: start.row - card.rowStart,
      startX: event.clientX, startY: event.clientY, moved: false,
      origin: { colStart: card.colStart, rowStart: card.rowStart, colSpan: card.colSpan, rowSpan: card.rowSpan }
    };
    // Capture keeps the drag alive if the pointer leaves the card; not every
    // pointer id is capturable, so a failure here must not abort the drag.
    try { node.setPointerCapture(event.pointerId); } catch (err) { /* non-fatal */ }
    node.classList.add('is-dragging');
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!drag) { return; }
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.startX) < 4 && Math.abs(event.clientY - drag.startY) < 4) { return; }
      drag.moved = true;
    }
    var cell = cellFromPoint(event.clientX, event.clientY);
    var card = drag.card;

    if (drag.mode === 'resize') {
      var colSpan = clamp(cell.col - card.colStart + 1, 1, state.grid.columns - card.colStart + 1);
      var rowSpan = clamp(cell.row - card.rowStart + 1, 1, state.grid.rows - card.rowStart + 1);
      drag.next = { colStart: card.colStart, rowStart: card.rowStart, colSpan: colSpan, rowSpan: rowSpan };
      showDrop(card.colStart, colSpan, card.rowStart, rowSpan,
        areaIsFree(card.colStart, colSpan, card.rowStart, rowSpan, card.id));
    } else {
      var colStart = clamp(cell.col - drag.grabCol, 1, state.grid.columns - card.colSpan + 1);
      var rowStart = clamp(cell.row - drag.grabRow, 1, state.grid.rows - card.rowSpan + 1);
      drag.next = { colStart: colStart, rowStart: rowStart, colSpan: card.colSpan, rowSpan: card.rowSpan };
      var free = areaIsFree(colStart, card.colSpan, rowStart, card.rowSpan, card.id);
      var swappable = !free && cardsInArea(colStart, card.colSpan, rowStart, card.rowSpan, card.id).length === 1;
      showDrop(colStart, card.colSpan, rowStart, card.rowSpan, free || swappable);
    }
  }

  function onPointerUp() {
    if (!drag) { return; }
    var card = drag.card;
    var next = drag.next;
    hideDrop();
    $$('.bento-card-node.is-dragging').forEach(function (n) { n.classList.remove('is-dragging'); });

    if (drag.moved && next) {
      var changed = false;
      pushHistory();
      if (drag.mode === 'resize') {
        changed = resizeCard(card, next.colSpan, next.rowSpan);
        if (!changed) { setStatus('That size would overlap another card.', 'error'); }
      } else {
        changed = moveCard(card, next.colStart, next.rowStart);
        if (!changed) { setStatus('That spot is taken. Drop the card on free space.', 'error'); }
      }
      if (!changed) { history.past.pop(); updateHistoryButtons(); }
      renderAll();
    }
    drag = null;
  }

  /* =========================================================================
   * 11. Presets and randomiser
   * ====================================================================== */

  function card(colStart, colSpan, rowStart, rowSpan, extra) {
    var base = { colStart: colStart, colSpan: colSpan, rowStart: rowStart, rowSpan: rowSpan };
    Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
    return base;
  }

  var PRESETS = {
    classic: { name: 'Classic Bento', columns: 4, rows: 4, cards: [
      card(1, 2, 1, 2, { type: 'feature', icon: '🍱', title: 'Classic Bento', description: 'One large hero tile with satellites.', paletteIndex: 0 }),
      card(3, 2, 1, 1, { title: 'Balanced', description: 'Wide tile on the top right.', paletteIndex: 1 }),
      card(3, 1, 2, 2, { type: 'stat', statValue: '12', statLabel: 'Presets', paletteIndex: 2 }),
      card(4, 1, 2, 1, { type: 'icon', icon: '✨', paletteIndex: 3 }),
      card(4, 1, 3, 2, { title: 'Tall', description: 'Vertical accent.', paletteIndex: 4 }),
      card(1, 2, 3, 2, { title: 'Footer tile', description: 'Wide closing block.', paletteIndex: 5 }),
      card(3, 1, 4, 1, { type: 'icon', icon: '🎯', paletteIndex: 6 })
    ] },
    landing: { name: 'Product Landing', columns: 4, rows: 3, cards: [
      card(1, 4, 1, 1, { type: 'feature', icon: '🚀', title: 'Launch faster', description: 'A full-width hero across the top.', fontSize: 20, paletteIndex: 0 }),
      card(1, 1, 2, 2, { title: 'Fast', description: 'Built for speed.', paletteIndex: 1 }),
      card(2, 1, 2, 1, { title: 'Secure', description: 'Private by default.', paletteIndex: 2 }),
      card(3, 2, 2, 1, { title: 'Integrations', description: 'Works with your stack.', paletteIndex: 3 }),
      card(2, 2, 3, 1, { type: 'button', title: 'Start now', description: 'No card required.', paletteIndex: 4 }),
      card(4, 1, 3, 1, { type: 'stat', statValue: '99%', statLabel: 'Uptime', paletteIndex: 5 })
    ] },
    saas: { name: 'SaaS Features', columns: 3, rows: 3, cards: [
      card(1, 2, 1, 1, { type: 'feature', icon: '⚙️', title: 'Automation', description: 'Set it once and forget it.', paletteIndex: 0 }),
      card(3, 1, 1, 2, { type: 'stat', statValue: '10k', statLabel: 'Teams', paletteIndex: 2 }),
      card(1, 1, 2, 2, { type: 'feature', icon: '📊', title: 'Analytics', description: 'Understand usage at a glance.', paletteIndex: 1 }),
      card(2, 1, 2, 1, { type: 'icon', icon: '🔔', paletteIndex: 3 }),
      card(2, 2, 3, 1, { title: 'Everything included', description: 'One price, every feature.', paletteIndex: 4 })
    ] },
    portfolio: { name: 'Portfolio', columns: 4, rows: 4, cards: [
      card(1, 2, 1, 2, { type: 'feature', icon: '👋', title: 'Hello, I design things', description: 'Product designer and front-end developer.', fontSize: 18, paletteIndex: 0 }),
      card(3, 2, 1, 2, { type: 'image', imageUrl: '', title: 'Selected work', paletteIndex: 1 }),
      card(1, 1, 3, 1, { type: 'icon', icon: '🎨', paletteIndex: 2 }),
      card(2, 1, 3, 2, { type: 'stat', statValue: '8y', statLabel: 'Experience', paletteIndex: 3 }),
      card(3, 2, 3, 1, { title: 'Case study', description: 'Redesigning a checkout flow.', paletteIndex: 4 }),
      card(1, 1, 4, 1, { type: 'icon', icon: '📮', paletteIndex: 5 }),
      card(3, 2, 4, 1, { type: 'button', title: 'Get in touch', description: 'Open for freelance.', paletteIndex: 6 })
    ] },
    dashboard: { name: 'Dashboard', columns: 4, rows: 3, cards: [
      card(1, 1, 1, 1, { type: 'stat', statValue: '2.4k', statLabel: 'Visitors', paletteIndex: 0 }),
      card(2, 1, 1, 1, { type: 'stat', statValue: '18%', statLabel: 'Conversion', paletteIndex: 1 }),
      card(3, 1, 1, 1, { type: 'stat', statValue: '$9.1k', statLabel: 'Revenue', paletteIndex: 2 }),
      card(4, 1, 1, 1, { type: 'stat', statValue: '312', statLabel: 'Signups', paletteIndex: 3 }),
      card(1, 3, 2, 2, { type: 'feature', icon: '📈', title: 'Traffic overview', description: 'Your main chart panel goes here.', paletteIndex: 4 }),
      card(4, 1, 2, 2, { title: 'Activity', description: 'Recent events feed.', paletteIndex: 5 })
    ] },
    devtools: { name: 'Developer Tools', columns: 4, rows: 3, cards: [
      card(1, 2, 1, 2, { type: 'feature', icon: '🛠️', title: 'Developer toolkit', description: 'Everything runs in the browser.', paletteIndex: 0 }),
      card(3, 1, 1, 1, { type: 'icon', icon: '{ }', paletteIndex: 1 }),
      card(4, 1, 1, 1, { type: 'icon', icon: '</>', paletteIndex: 2 }),
      card(3, 2, 2, 1, { title: 'No signup', description: 'Open the page and go.', paletteIndex: 3 }),
      card(1, 2, 3, 1, { title: 'Private', description: 'Nothing is uploaded.', paletteIndex: 4 }),
      card(3, 2, 3, 1, { type: 'button', title: 'Browse tools', description: 'Over a hundred utilities.', paletteIndex: 5 })
    ] },
    apple: { name: 'Apple-style', columns: 4, rows: 4, cards: [
      card(1, 2, 1, 2, { type: 'feature', icon: '🌌', title: 'Big, quiet hero', description: 'Lots of space, few words.', fontSize: 20, radius: 28, paletteIndex: 3 }),
      card(3, 2, 1, 2, { type: 'feature', icon: '🔋', title: 'All-day battery', description: 'Up to 22 hours.', fontSize: 18, radius: 28, paletteIndex: 1 }),
      card(1, 1, 3, 2, { type: 'stat', statValue: 'M4', statLabel: 'Chip', radius: 28, paletteIndex: 5 }),
      card(2, 2, 3, 1, { title: 'Liquid Retina', description: 'Sharper than ever.', radius: 28, paletteIndex: 0 }),
      card(4, 1, 3, 2, { type: 'icon', icon: '🍎', radius: 28, paletteIndex: 7 }),
      card(2, 2, 4, 1, { title: 'Built to last', description: 'Recycled aluminium.', radius: 28, paletteIndex: 2 })
    ] },
    minimal: { name: 'Minimal', columns: 3, rows: 3, cards: [
      card(1, 2, 1, 2, { title: 'Less, but better', description: 'Three tones, one accent.', bgType: 'solid', bgColor: '#0f172a', paletteIndex: 3 }),
      card(3, 1, 1, 1, { type: 'icon', icon: '◻️', bgType: 'solid', bgColor: '#111827', paletteIndex: 1 }),
      card(3, 1, 2, 2, { title: 'Quiet', description: 'Nothing shouts.', bgType: 'solid', bgColor: '#18181b', paletteIndex: 7 }),
      card(1, 2, 3, 1, { title: 'Balanced', description: 'Even weight across the grid.', bgType: 'solid', bgColor: '#1f2937', paletteIndex: 5 })
    ] },
    three: { name: '3-Column', columns: 3, rows: 3, cards: [
      card(1, 1, 1, 1, { title: 'One', description: 'First column.', paletteIndex: 0 }),
      card(2, 1, 1, 2, { title: 'Two', description: 'Taller middle.', paletteIndex: 1 }),
      card(3, 1, 1, 1, { title: 'Three', description: 'Third column.', paletteIndex: 2 }),
      card(1, 1, 2, 2, { type: 'stat', statValue: '3', statLabel: 'Columns', paletteIndex: 3 }),
      card(3, 1, 2, 2, { title: 'Flexible', description: 'Spans stay tidy.', paletteIndex: 4 }),
      card(2, 1, 3, 1, { type: 'icon', icon: '🔻', paletteIndex: 5 })
    ] },
    four: { name: '4-Column', columns: 4, rows: 2, cards: [
      card(1, 1, 1, 1, { title: 'Alpha', description: 'Equal weight.', paletteIndex: 0 }),
      card(2, 1, 1, 1, { title: 'Beta', description: 'Equal weight.', paletteIndex: 1 }),
      card(3, 1, 1, 1, { title: 'Gamma', description: 'Equal weight.', paletteIndex: 2 }),
      card(4, 1, 1, 1, { title: 'Delta', description: 'Equal weight.', paletteIndex: 3 }),
      card(1, 2, 2, 1, { title: 'Wide left', description: 'Spans two columns.', paletteIndex: 4 }),
      card(3, 2, 2, 1, { title: 'Wide right', description: 'Spans two columns.', paletteIndex: 5 })
    ] },
    asymmetric: { name: 'Asymmetric', columns: 5, rows: 4, cards: [
      card(1, 3, 1, 2, { type: 'feature', icon: '🌀', title: 'Off balance', description: 'Deliberately uneven tiles.', paletteIndex: 0 }),
      card(4, 2, 1, 1, { title: 'Narrow', description: 'Short and wide.', paletteIndex: 1 }),
      card(4, 1, 2, 3, { type: 'stat', statValue: '5', statLabel: 'Columns', paletteIndex: 2 }),
      card(5, 1, 2, 1, { type: 'icon', icon: '🔸', paletteIndex: 3 }),
      card(5, 1, 3, 2, { title: 'Tall edge', description: 'Anchors the right.', paletteIndex: 4 }),
      card(1, 1, 3, 2, { type: 'icon', icon: '🔷', paletteIndex: 5 }),
      card(2, 2, 3, 1, { title: 'Middle', description: 'Fills the gap.', paletteIndex: 6 }),
      card(2, 2, 4, 1, { title: 'Base', description: 'Closes the layout.', paletteIndex: 7 })
    ] },
    heroFeatures: { name: 'Hero + Features', columns: 3, rows: 3, cards: [
      card(1, 3, 1, 1, { type: 'feature', icon: '⭐', title: 'The headline goes here', description: 'One sentence that explains the product.', fontSize: 20, paletteIndex: 0 }),
      card(1, 1, 2, 1, { type: 'feature', icon: '⚡', title: 'Fast', description: 'Instant results.', paletteIndex: 1 }),
      card(2, 1, 2, 1, { type: 'feature', icon: '🔒', title: 'Private', description: 'Runs locally.', paletteIndex: 2 }),
      card(3, 1, 2, 1, { type: 'feature', icon: '🎁', title: 'Free', description: 'No account.', paletteIndex: 3 }),
      card(1, 3, 3, 1, { type: 'button', title: 'Ready to try it?', description: 'Jump straight in.', paletteIndex: 4 })
    ] }
  };

  function loadPreset(key) {
    var preset = PRESETS[key];
    if (!preset) { return; }
    pushHistory();
    idCounter = 0;
    state.grid.columns = preset.columns;
    state.grid.rows = preset.rows;
    state.cards = preset.cards.map(function (spec) { return makeCard(spec); });
    state.selectedId = null;
    reflowIntoGrid();
    renderAll();
    setStatus('Loaded the “' + preset.name + '” preset.', 'success');
    announce(preset.name + ' preset loaded');
  }

  /** Fills the grid with valid, non-overlapping tiles of varied sizes. */
  function randomizeLayout() {
    pushHistory();
    var columns = state.grid.columns;
    var rows = state.grid.rows;
    var taken = Object.create(null);
    var cards = [];
    var types = ['text', 'text', 'feature', 'stat', 'icon', 'button'];
    var icons = ['✨', '⚡', '🎯', '🍱', '📦', '🚀', '🔷', '🌀'];

    function free(colStart, colSpan, rowStart, rowSpan) {
      if (colStart + colSpan - 1 > columns || rowStart + rowSpan - 1 > rows) { return false; }
      for (var r = rowStart; r < rowStart + rowSpan; r += 1) {
        for (var c = colStart; c < colStart + colSpan; c += 1) {
          if (taken[r + ':' + c]) { return false; }
        }
      }
      return true;
    }

    for (var row = 1; row <= rows; row += 1) {
      for (var col = 1; col <= columns; col += 1) {
        if (taken[row + ':' + col]) { continue; }

        var colSpan = 1;
        var rowSpan = 1;
        var roll = Math.random();
        if (roll > 0.78) { colSpan = 2; rowSpan = 2; }
        else if (roll > 0.55) { colSpan = 2; }
        else if (roll > 0.35) { rowSpan = 2; }

        while (colSpan > 1 && !free(col, colSpan, row, rowSpan)) { colSpan -= 1; }
        while (rowSpan > 1 && !free(col, colSpan, row, rowSpan)) { rowSpan -= 1; }
        if (!free(col, colSpan, row, rowSpan)) { continue; }

        for (var r2 = row; r2 < row + rowSpan; r2 += 1) {
          for (var c2 = col; c2 < col + colSpan; c2 += 1) { taken[r2 + ':' + c2] = true; }
        }

        var type = types[Math.floor(Math.random() * types.length)];
        cards.push({
          colStart: col, colSpan: colSpan, rowStart: row, rowSpan: rowSpan,
          type: type,
          icon: icons[Math.floor(Math.random() * icons.length)],
          title: 'Card ' + (cards.length + 1),
          description: 'Generated tile.',
          statValue: String(Math.floor(Math.random() * 900) + 100),
          statLabel: 'Metric',
          paletteIndex: cards.length % PALETTE.length
        });
      }
    }

    idCounter = 0;
    state.cards = cards.map(function (spec) { return makeCard(spec); });
    state.selectedId = null;
    renderAll();
    setStatus('Randomised ' + cards.length + ' cards inside the grid.', 'success');
    announce('Layout randomised');
  }

  function resetLayout() {
    pushHistory();
    var view = state.view;
    state = defaultState();
    state.view = view;
    renderAll();
    setStatus('Layout reset to the default Bento grid.', 'info');
    announce('Layout reset');
  }

  /* =========================================================================
   * 12. Code generation — same state, different output
   * ====================================================================== */

  function indent(level) { return new Array(level + 1).join('  '); }

  function buildCardHtml(card, index, level) {
    var cardClass = safeClass(state.grid.cardClass, 'bento-card');
    var pad = indent(level);
    var inner = indent(level + 1);
    var lines = [];
    lines.push(pad + '<article class="' + cardClass + ' ' + cardClass + '--' + (index + 1) + '">');

    if (card.type === 'image') {
      var url = safeUrl(card.imageUrl);
      if (url) {
        lines.push(inner + '<img class="' + cardClass + '__image" src="' + escapeHtml(url) +
          '" alt="' + escapeHtml(card.title) + '" loading="lazy" />');
      }
    } else if (card.type === 'stat') {
      lines.push(inner + '<strong class="' + cardClass + '__value">' + escapeHtml(card.statValue) + '</strong>');
      lines.push(inner + '<span class="' + cardClass + '__label">' + escapeHtml(card.statLabel) + '</span>');
    } else if (card.type !== 'empty') {
      if (card.icon && (card.type === 'icon' || card.type === 'feature')) {
        lines.push(inner + '<span class="' + cardClass + '__icon" aria-hidden="true">' + escapeHtml(card.icon) + '</span>');
      }
      if (card.type !== 'icon') {
        if (card.title) {
          lines.push(inner + '<h3 class="' + cardClass + '__title">' + escapeHtml(card.title) + '</h3>');
        }
        if (card.description) {
          lines.push(inner + '<p class="' + cardClass + '__text">' + escapeHtml(card.description) + '</p>');
        }
        if (card.type === 'button') {
          lines.push(inner + '<a class="' + cardClass + '__button" href="' +
            escapeHtml(safeUrl(card.buttonHref) || '#') + '">' + escapeHtml(card.buttonLabel) + '</a>');
        }
      }
    }
    lines.push(pad + '</article>');
    return lines.join('\n');
  }

  function generateHTML() {
    var containerClass = safeClass(state.grid.containerClass, 'bento-grid');
    var lines = ['<section class="' + containerClass + '">'];
    state.cards.forEach(function (card, index) {
      lines.push(buildCardHtml(card, index, 1));
    });
    lines.push('</section>');
    return lines.join('\n') + '\n';
  }

  /** The value most cards share — becomes the base rule so per-card CSS stays small. */
  function modalValue(pairsByCard, prop) {
    var counts = Object.create(null);
    var best = null;
    var bestCount = 0;
    pairsByCard.forEach(function (map) {
      var value = map[prop];
      if (value === undefined) { return; }
      counts[value] = (counts[value] || 0) + 1;
      if (counts[value] > bestCount) { bestCount = counts[value]; best = value; }
    });
    return best;
  }

  function generateCSS() {
    var g = state.grid;
    var containerClass = safeClass(g.containerClass, 'bento-grid');
    var cardClass = safeClass(g.cardClass, 'bento-card');
    var colGap = g.useSplitGap ? g.columnGap : g.gap;
    var rowGap = g.useSplitGap ? g.rowGap : g.gap;

    var maps = state.cards.map(function (card) {
      var map = Object.create(null);
      cardDeclarations(card).forEach(function (pair) { map[pair[0]] = pair[1]; });
      return map;
    });

    var baseProps = ['background', 'border-radius', 'padding', 'color', 'font-size',
      'font-weight', 'line-height', 'text-align', 'box-shadow', 'border'];
    var base = Object.create(null);
    baseProps.forEach(function (prop) {
      var value = modalValue(maps, prop);
      if (value !== null && value !== undefined) { base[prop] = value; }
    });

    var out = [];
    out.push(':root {');
    out.push('  --bento-gap: ' + colGap + 'px;');
    if (rowGap !== colGap) { out.push('  --bento-row-gap: ' + rowGap + 'px;'); }
    out.push('  --bento-radius: ' + (base['border-radius'] || '20px') + ';');
    out.push('  --bento-padding: ' + (base.padding || '22px') + ';');
    out.push('}');
    out.push('');

    out.push('.' + containerClass + ' {');
    out.push('  display: grid;');
    out.push('  grid-template-columns: repeat(' + g.columns + ', minmax(0, 1fr));');
    out.push('  grid-auto-rows: minmax(' + g.rowHeight + 'px, auto);');
    out.push('  column-gap: var(--bento-gap);');
    out.push('  row-gap: ' + (rowGap !== colGap ? 'var(--bento-row-gap)' : 'var(--bento-gap)') + ';');
    out.push('  max-width: ' + g.maxWidth + 'px;');
    out.push('  margin-inline: auto;');
    if (g.padding) { out.push('  padding: ' + g.padding + 'px;'); }
    out.push('}');
    out.push('');

    out.push('.' + cardClass + ' {');
    out.push('  display: flex;');
    out.push('  flex-direction: column;');
    out.push('  gap: 0.4rem;');
    out.push('  overflow: hidden;');
    Object.keys(base).forEach(function (prop) {
      var value = base[prop];
      if (prop === 'border-radius') { value = 'var(--bento-radius)'; }
      if (prop === 'padding') { value = 'var(--bento-padding)'; }
      out.push('  ' + prop + ': ' + value + ';');
    });
    out.push('}');
    out.push('');

    // Per-card rules: placement always, plus only the properties that differ.
    state.cards.forEach(function (card, index) {
      var rules = placementDeclarations(card).slice();
      var map = maps[index];
      Object.keys(map).forEach(function (prop) {
        if (base[prop] !== map[prop]) { rules.push([prop, map[prop]]); }
      });
      out.push('.' + cardClass + '--' + (index + 1) + ' {');
      rules.forEach(function (pair) { out.push('  ' + pair[0] + ': ' + pair[1] + ';'); });
      out.push('}');
      out.push('');
    });

    // Shared element styles, emitted only when a card actually uses them.
    var used = {};
    state.cards.forEach(function (c) { used[c.type] = true; });
    if (used.image) {
      out.push('.' + cardClass + '__image {');
      out.push('  width: 100%;');
      out.push('  height: 100%;');
      out.push('  object-fit: ' + (selectedFit()) + ';');
      out.push('  border-radius: calc(var(--bento-radius) - 6px);');
      out.push('}');
      out.push('');
    }
    if (used.stat) {
      out.push('.' + cardClass + '__value {');
      out.push('  font-size: 2.1em;');
      out.push('  line-height: 1.1;');
      out.push('}');
      out.push('');
    }
    if (used.icon || used.feature) {
      out.push('.' + cardClass + '__icon {');
      out.push('  font-size: 1.7em;');
      out.push('  line-height: 1;');
      out.push('}');
      out.push('');
    }
    out.push('.' + cardClass + '__title {');
    out.push('  margin: 0;');
    out.push('  font-size: 1em;');
    out.push('}');
    out.push('');
    out.push('.' + cardClass + '__text {');
    out.push('  margin: 0;');
    out.push('  font-size: 0.86em;');
    out.push('  font-weight: 400;');
    out.push('  opacity: 0.78;');
    out.push('}');
    out.push('');
    if (used.button) {
      out.push('.' + cardClass + '__button {');
      out.push('  margin-top: auto;');
      out.push('  align-self: flex-start;');
      out.push('  color: inherit;');
      out.push('  font-weight: 600;');
      out.push('}');
      out.push('');
    }

    // Real breakpoints — the spans change, the layout is not just squashed.
    out.push('@media (max-width: 1024px) {');
    out.push('  .' + containerClass + ' {');
    out.push('    grid-template-columns: repeat(' + state.responsive.tabletColumns + ', minmax(0, 1fr));');
    out.push('  }');
    out.push('');
    state.cards.forEach(function (card, index) {
      var span = Math.min(card.tabletColSpan || card.colSpan, state.responsive.tabletColumns);
      out.push('  .' + cardClass + '--' + (index + 1) + ' {');
      out.push('    grid-column: span ' + span + ';');
      out.push('    grid-row: auto;');
      out.push('  }');
    });
    out.push('}');
    out.push('');
    out.push('@media (max-width: 640px) {');
    out.push('  .' + containerClass + ' {');
    out.push('    grid-template-columns: repeat(' + state.responsive.mobileColumns + ', minmax(0, 1fr));');
    out.push('  }');
    out.push('');
    state.cards.forEach(function (card, index) {
      var span = Math.min(card.mobileColSpan || card.colSpan, state.responsive.mobileColumns);
      out.push('  .' + cardClass + '--' + (index + 1) + ' {');
      out.push('    grid-column: span ' + span + ';');
      out.push('  }');
    });
    out.push('}');
    out.push('');

    return out.join('\n');
  }

  function selectedFit() {
    var withImage = state.cards.filter(function (c) { return c.type === 'image'; })[0];
    return withImage ? withImage.objectFit : 'cover';
  }

  function generateDocument() {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '  <meta charset="utf-8" />\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '  <title>Bento Grid Layout</title>\n' +
      '  <style>\n' +
      '    body { margin: 0; padding: 2rem 1rem; background: #0b1220; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }\n' +
      generateCSS().split('\n').map(function (line) { return line ? '    ' + line : ''; }).join('\n') +
      '\n  </style>\n</head>\n<body>\n' +
      generateHTML().split('\n').map(function (line) { return line ? '  ' + line : ''; }).join('\n') +
      '</body>\n</html>\n';
  }

  /* =========================================================================
   * 13. Code panel
   * ====================================================================== */

  var codeCache = { html: '', css: '' };

  function updatePreviewCode() {
    codeCache.html = generateHTML();
    codeCache.css = generateCSS();
    if (el.codeHtml) { el.codeHtml.textContent = codeCache.html; }
    if (el.codeCss) { el.codeCss.textContent = codeCache.css; }
    if (el.codeSize) {
      el.codeSize.textContent = (codeCache.html.length + codeCache.css.length) + ' chars';
    }
  }

  function setCodeTab(name) {
    root.dataset.code = name;
    $$('[data-code-tab]').forEach(function (button) {
      var active = button.dataset.codeTab === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (el.htmlPane) { el.htmlPane.hidden = name !== 'html'; }
    if (el.cssPane) { el.cssPane.hidden = name !== 'css'; }
  }

  /* =========================================================================
   * 14. Status + announcements
   * ====================================================================== */

  function setStatus(message, tone) {
    if (!el.status) { return; }
    el.status.textContent = message;
    el.status.dataset.tone = tone || 'info';
    el.status.hidden = !message;
  }

  function announce(message) {
    if (!el.live) { return; }
    el.live.textContent = '';
    window.setTimeout(function () { el.live.textContent = message; }, 30);
  }

  function flashButton(button, label) {
    if (!button) { return; }
    if (button.dataset.label === undefined) { button.dataset.label = button.textContent; }
    button.textContent = label;
    button.classList.add('is-done');
    window.clearTimeout(Number(button.dataset.timer || 0));
    button.dataset.timer = String(window.setTimeout(function () {
      button.textContent = button.dataset.label;
      button.classList.remove('is-done');
    }, 1600));
  }

  /* =========================================================================
   * 15. Render orchestration
   * ====================================================================== */

  function renderAll() {
    renderGrid();
    renderCardList();
    renderInspector();
    syncBindings();
    updatePreviewCode();
    updateHistoryButtons();
    updateViewButtons();
  }

  function updateViewButtons() {
    $$('[data-view]').forEach(function (button) {
      var active = button.dataset.view === state.view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (el.dragHint) { el.dragHint.hidden = state.view === 'desktop'; }
  }

  /* =========================================================================
   * 16. Wiring
   * ====================================================================== */

  function cacheElements() {
    el = {
      grid: $('bentoGrid'),
      frame: $('bentoFrame'),
      stage: $('bentoStage'),
      stageInner: $('bentoStageInner'),
      viewWidth: $('bentoViewWidth'),
      cardList: $('bentoCardList'),
      cardCount: $('bentoCardCount'),
      inspector: $('bentoInspector'),
      inspectorEmpty: $('bentoInspectorEmpty'),
      selectedId: $('bentoSelectedId'),
      codeHtml: $('bentoCodeHtml'),
      codeCss: $('bentoCodeCss'),
      codeSize: $('bentoCodeSize'),
      htmlPane: $('bentoHtmlPane'),
      cssPane: $('bentoCssPane'),
      status: $('bentoStatus'),
      live: $('bentoLive'),
      undo: $('bentoUndo'),
      redo: $('bentoRedo'),
      dragHint: $('bentoDragHint')
    };
  }

  function bindActions() {
    var actions = {
      addCard: addCard,
      duplicateCard: duplicateCard,
      deleteCard: deleteCard,
      randomize: randomizeLayout,
      reset: resetLayout,
      undo: undo,
      redo: redo
    };

    root.addEventListener('click', function (event) {
      var actionButton = event.target.closest('[data-action]');
      if (actionButton && actions[actionButton.dataset.action]) {
        actions[actionButton.dataset.action]();
        return;
      }

      var selectButton = event.target.closest('[data-select]');
      if (selectButton) { selectCard(selectButton.dataset.select); return; }

      var presetButton = event.target.closest('[data-preset]');
      if (presetButton) { loadPreset(presetButton.dataset.preset); return; }

      var viewButton = event.target.closest('[data-view]');
      if (viewButton) {
        state.view = viewButton.dataset.view;
        renderAll();
        return;
      }

      var codeTab = event.target.closest('[data-code-tab]');
      if (codeTab) { setCodeTab(codeTab.dataset.codeTab); return; }

      var copyButton = event.target.closest('[data-copy]');
      if (copyButton) {
        var kind = copyButton.dataset.copy;
        var payload = kind === 'html' ? codeCache.html
          : kind === 'css' ? codeCache.css
            : codeCache.html + '\n\n<style>\n' + codeCache.css + '</style>\n';
        copyText(payload).then(function (ok) {
          flashButton(copyButton, ok ? 'Copied ✓' : 'Copy failed');
          announce(ok ? kind.toUpperCase() + ' copied' : 'Copy failed');
        });
        return;
      }

      var downloadButton = event.target.closest('[data-download]');
      if (downloadButton) {
        var what = downloadButton.dataset.download;
        var ok = what === 'html' ? download('bento-grid.html', codeCache.html, 'text/html;charset=utf-8')
          : what === 'css' ? download('bento-grid.css', codeCache.css, 'text/css;charset=utf-8')
            : download('bento-grid-complete.html', generateDocument(), 'text/html;charset=utf-8');
        setStatus(ok ? 'Download started.' : 'The download could not start.', ok ? 'success' : 'error');
        return;
      }

      // Clicking blank canvas clears the selection.
      if (event.target === el.grid || event.target === el.frame) {
        state.selectedId = null;
        renderAll();
      }
    });

    // The gesture starts on the canvas but must be tracked on the window:
    // releasing the pointer outside the grid would otherwise strand the drag.
    el.grid.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onPointerUp);

    el.grid.addEventListener('keydown', function (event) {
      var node = event.target.closest('.bento-card-node');
      if (!node) { return; }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectCard(node.dataset.id);
      }
    });

    window.addEventListener('resize', updateCanvasFrame);
  }

  function bindKeyboard() {
    doc.addEventListener('keydown', function (event) {
      var tag = (event.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (typing) { return; }        // leave native undo alone inside fields
        event.preventDefault();
        if (event.shiftKey) { redo(); } else { undo(); }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        if (typing || !state.selectedId) { return; }
        event.preventDefault();
        duplicateCard();
        return;
      }
      if (typing) { return; }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!state.selectedId) { return; }
        event.preventDefault();
        deleteCard();
        return;
      }
      if (event.key === 'Escape') {
        if (state.selectedId) {
          state.selectedId = null;
          renderAll();
        }
        return;
      }

      // Arrows move the selected card; Shift+arrows resize it.
      var card = selectedCard();
      if (!card || state.view !== 'desktop') { return; }
      var deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      var delta = deltas[event.key];
      if (!delta) { return; }
      event.preventDefault();
      pushHistory();
      var changed = event.shiftKey
        ? resizeCard(card, card.colSpan + delta[0], card.rowSpan + delta[1])
        : moveCard(card, card.colStart + delta[0], card.rowStart + delta[1]);
      if (!changed) { history.past.pop(); updateHistoryButtons(); }
      else { renderAll(); }
    });
  }

  /* =========================================================================
   * 17. Boot
   * ====================================================================== */

  function initializeApp() {
    cacheElements();
    if (!el.grid) { return; }
    bindControls();
    bindActions();
    bindKeyboard();
    setCodeTab('html');
    renderAll();
  }

  // Exposed for the automated test harness; harmless in normal use.
  window.__bento = {
    getState: function () { return state; },
    generateHTML: generateHTML,
    generateCSS: generateCSS,
    generateDocument: generateDocument,
    sanitizeCustomCss: sanitizeCustomCss,
    safeUrl: safeUrl,
    safeClass: safeClass,
    escapeHtml: escapeHtml,
    areaIsFree: areaIsFree,
    randomize: randomizeLayout,
    presets: Object.keys(PRESETS)
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }
}());
