/* ==========================================================================
   ToolAdda — Flexbox / Grid Playground Engine

   Pure, dependency-free layout logic. One state object drives:

     • container + per-item CSS for the live preview
     • the HTML and CSS strings in the code panel
     • shareable encoded state

   Preview styles and exported code come from the same generators, so they
   cannot drift apart. Every user-typed value is sanitised on the way in:
   track lists are allow-listed tokens, labels are escaped, numbers are
   clamped. Nothing typed can become executable CSS or HTML.
   ========================================================================== */
(function (global) {
  'use strict';

  var MIN_ITEMS = 1;
  var MAX_ITEMS = 16;
  var ITEM_PALETTE = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#059669', '#dc2626'];

  var FLEX_DISPLAY = ['flex', 'inline-flex'];
  var FLEX_DIRECTION = ['row', 'row-reverse', 'column', 'column-reverse'];
  var FLEX_WRAP = ['nowrap', 'wrap', 'wrap-reverse'];
  var JUSTIFY_CONTENT = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end', 'stretch'];
  var ALIGN_ITEMS = ['stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end'];
  var ALIGN_CONTENT = ['stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end'];
  var ALIGN_SELF = ['auto', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end'];
  var GRID_DISPLAY = ['grid', 'inline-grid'];
  var AUTO_FLOW = ['row', 'column', 'row dense', 'column dense'];
  var JUSTIFY_ITEMS = ['stretch', 'start', 'end', 'center'];
  var SELF_ALIGN = ['auto', 'stretch', 'start', 'end', 'center'];
  var BASIS_UNITS = ['auto', 'px', '%', 'rem'];

  /* ======================================================================
     Sanitisers
     ====================================================================== */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) n = typeof fallback === 'number' ? fallback : lo;
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function round(n, places) {
    var f = Math.pow(10, places || 0);
    return Math.round(n * f) / f;
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  function safeHex(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return fallback || '#0d9488';
  }

  function safeLabel(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
    if (!s) return fallback || '';
    return s.slice(0, 24);
  }

  /**
   * CSS Grid track lists. Only tokens that can appear in
   * grid-template-columns / rows: numbers, length units, fr, minmax,
   * repeat, fit-content, auto, min/max-content. Anything else (url(),
   * expression, @import, quotes) is dropped.
   */
  function safeTrackList(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (!s) return fallback;
    if (s.length > 180) return fallback;
    var lower = s.toLowerCase();
    if (/url\s*\(|expression|javascript|behavior|@import|attr\s*\(|["'\\]|<|>/.test(lower)) return fallback;
    if (!/^[0-9a-z%.,()/\s+-]+$/i.test(s)) return fallback;
    if (!/\b(fr|px|%|rem|em|ch|vh|vw|auto|minmax|repeat|fit-content|min-content|max-content)\b/i.test(s) && !/^\s*auto(\s+auto)*\s*$/i.test(s)) {
      if (!/^[\d.\sfrpx%rememchvhw,()/+-]+$/i.test(s)) return fallback;
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function safeAreas(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (!s) return fallback || '';
    if (s.length > 240) return fallback || '';
    if (/url\s*\(|expression|javascript|@import|<|>|\\/.test(s.toLowerCase())) return fallback || '';
    if (!/^[a-z0-9"'.\s\n-]+$/i.test(s)) return fallback || '';
    return s;
  }

  function px(n) { return round(n, 1) + 'px'; }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* ======================================================================
     Defaults
     ====================================================================== */

  function defaultItem(index) {
    return {
      id: index + 1,
      label: String(index + 1),
      color: ITEM_PALETTE[index % ITEM_PALETTE.length],
      width: 0,
      height: 0,
      grow: 0,
      shrink: 1,
      basis: 'auto',
      basisValue: 0,
      alignSelf: 'auto',
      order: 0,
      colStart: 'auto',
      colSpan: 1,
      rowStart: 'auto',
      rowSpan: 1,
      justifySelf: 'auto',
      alignSelfGrid: 'auto'
    };
  }

  function defaultState() {
    var items = [];
    var i;
    for (i = 0; i < 6; i++) items.push(defaultItem(i));
    return {
      mode: 'flex',
      selected: -1,
      itemCount: 6,
      overlay: true,
      items: items,
      flex: {
        display: 'flex',
        direction: 'row',
        wrap: 'wrap',
        justify: 'flex-start',
        align: 'stretch',
        alignContent: 'stretch'
      },
      grid: {
        display: 'grid',
        columns: 'repeat(3, 1fr)',
        rows: 'auto',
        areas: '',
        autoFlow: 'row',
        justifyItems: 'stretch',
        alignItems: 'stretch',
        justifyContent: 'start',
        alignContent: 'start'
      },
      box: {
        padding: 16,
        gap: 12,
        rowGap: 12,
        columnGap: 12,
        gapLinked: true,
        minHeight: 280,
        width: 100
      }
    };
  }

  function ensureItems(state) {
    var count = clampNum(state.itemCount, MIN_ITEMS, MAX_ITEMS, 6);
    var items = Array.isArray(state.items) ? state.items.slice() : [];
    var i;
    while (items.length < count) items.push(defaultItem(items.length));
    if (items.length > count) items = items.slice(0, count);
    for (i = 0; i < items.length; i++) {
      items[i] = normalizeItem(items[i], i);
    }
    state.itemCount = count;
    state.items = items;
    if (state.selected >= count) state.selected = count - 1;
    return state;
  }

  function normalizeItem(raw, index) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var basis = oneOf(src.basis, BASIS_UNITS, 'auto');
    return {
      id: clampNum(src.id, 1, 99, index + 1),
      label: safeLabel(src.label, String(index + 1)),
      color: safeHex(src.color, ITEM_PALETTE[index % ITEM_PALETTE.length]),
      width: clampNum(src.width, 0, 400, 0),
      height: clampNum(src.height, 0, 400, 0),
      grow: round(clampNum(src.grow, 0, 10, 0), 2),
      shrink: round(clampNum(src.shrink, 0, 10, 1), 2),
      basis: basis,
      basisValue: clampNum(src.basisValue, 0, 800, 0),
      alignSelf: oneOf(src.alignSelf, ALIGN_SELF, 'auto'),
      order: clampNum(src.order, -10, 10, 0),
      colStart: normalizeLine(src.colStart),
      colSpan: clampNum(src.colSpan, 1, 12, 1),
      rowStart: normalizeLine(src.rowStart),
      rowSpan: clampNum(src.rowSpan, 1, 12, 1),
      justifySelf: oneOf(src.justifySelf, SELF_ALIGN, 'auto'),
      alignSelfGrid: oneOf(src.alignSelfGrid, SELF_ALIGN, 'auto')
    };
  }

  function normalizeLine(value) {
    if (value === 'auto' || value === undefined || value === null || value === '') return 'auto';
    var n = parseInt(value, 10);
    if (!isFinite(n) || n < 1 || n > 13) return 'auto';
    return String(n);
  }

  function normalize(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var d = defaultState();
    var flex = src.flex && typeof src.flex === 'object' ? src.flex : {};
    var grid = src.grid && typeof src.grid === 'object' ? src.grid : {};
    var box = src.box && typeof src.box === 'object' ? src.box : {};
    var state = {
      mode: src.mode === 'grid' ? 'grid' : 'flex',
      selected: clampNum(src.selected, -1, MAX_ITEMS - 1, -1),
      itemCount: clampNum(src.itemCount, MIN_ITEMS, MAX_ITEMS, 6),
      overlay: src.overlay !== false,
      items: Array.isArray(src.items) ? src.items : d.items,
      flex: {
        display: oneOf(flex.display, FLEX_DISPLAY, 'flex'),
        direction: oneOf(flex.direction, FLEX_DIRECTION, 'row'),
        wrap: oneOf(flex.wrap, FLEX_WRAP, 'wrap'),
        justify: oneOf(flex.justify, JUSTIFY_CONTENT, 'flex-start'),
        align: oneOf(flex.align, ALIGN_ITEMS, 'stretch'),
        alignContent: oneOf(flex.alignContent, ALIGN_CONTENT, 'stretch')
      },
      grid: {
        display: oneOf(grid.display, GRID_DISPLAY, 'grid'),
        columns: safeTrackList(grid.columns, 'repeat(3, 1fr)'),
        rows: safeTrackList(grid.rows, 'auto'),
        areas: safeAreas(grid.areas, ''),
        autoFlow: oneOf(grid.autoFlow, AUTO_FLOW, 'row'),
        justifyItems: oneOf(grid.justifyItems, JUSTIFY_ITEMS, 'stretch'),
        alignItems: oneOf(grid.alignItems, JUSTIFY_ITEMS, 'stretch'),
        justifyContent: oneOf(grid.justifyContent, JUSTIFY_CONTENT.concat(['start', 'end', 'stretch']), 'start'),
        alignContent: oneOf(grid.alignContent, ALIGN_CONTENT.concat(['start']), 'start')
      },
      box: {
        padding: clampNum(box.padding, 0, 64, 16),
        gap: clampNum(box.gap, 0, 64, 12),
        rowGap: clampNum(box.rowGap, 0, 64, 12),
        columnGap: clampNum(box.columnGap, 0, 64, 12),
        gapLinked: box.gapLinked !== false,
        minHeight: clampNum(box.minHeight, 120, 720, 280),
        width: clampNum(box.width, 40, 100, 100)
      }
    };
    return ensureItems(state);
  }

  function cloneState(state) {
    return normalize(clone(state));
  }

  /* ======================================================================
     CSS generation
     ====================================================================== */

  function gapValue(box) {
    if (box.gapLinked) return px(box.gap);
    if (box.rowGap === box.columnGap) return px(box.rowGap);
    return px(box.rowGap) + ' ' + px(box.columnGap);
  }

  function flexBasisValue(item) {
    if (item.basis === 'auto') return 'auto';
    if (item.basis === 'px') return px(item.basisValue || 0);
    if (item.basis === '%') return round(item.basisValue, 1) + '%';
    if (item.basis === 'rem') return round(item.basisValue, 2) + 'rem';
    return 'auto';
  }

  function itemIsFlexCustom(item) {
    return item.grow !== 0 || item.shrink !== 1 || item.basis !== 'auto' ||
      item.alignSelf !== 'auto' || item.order !== 0 || item.width > 0 || item.height > 0;
  }

  function itemIsGridCustom(item) {
    return item.colStart !== 'auto' || item.colSpan !== 1 ||
      item.rowStart !== 'auto' || item.rowSpan !== 1 ||
      item.justifySelf !== 'auto' || item.alignSelfGrid !== 'auto' ||
      item.width > 0 || item.height > 0;
  }

  function gridLine(start, span) {
    if (start === 'auto' && span === 1) return null;
    if (start === 'auto') return 'span ' + span;
    if (span === 1) return String(start);
    return start + ' / span ' + span;
  }

  function containerDecls(state) {
    var box = state.box;
    var decls = [];
    decls.push(['min-height', px(box.minHeight)]);
    decls.push(['padding', px(box.padding)]);
    decls.push(['gap', gapValue(box)]);

    if (state.mode === 'flex') {
      var f = state.flex;
      decls.unshift(['display', f.display]);
      decls.push(['flex-direction', f.direction]);
      decls.push(['flex-wrap', f.wrap]);
      decls.push(['justify-content', f.justify]);
      decls.push(['align-items', f.align]);
      if (f.wrap !== 'nowrap') decls.push(['align-content', f.alignContent]);
    } else {
      var g = state.grid;
      decls.unshift(['display', g.display]);
      decls.push(['grid-template-columns', g.columns]);
      if (g.rows && g.rows !== 'auto') decls.push(['grid-template-rows', g.rows]);
      if (g.areas) decls.push(['grid-template-areas', formatAreas(g.areas)]);
      if (g.autoFlow !== 'row') decls.push(['grid-auto-flow', g.autoFlow]);
      if (g.justifyItems !== 'stretch') decls.push(['justify-items', g.justifyItems]);
      if (g.alignItems !== 'stretch') decls.push(['align-items', g.alignItems]);
      if (g.justifyContent !== 'start' && g.justifyContent !== 'stretch') decls.push(['justify-content', g.justifyContent]);
      if (g.alignContent !== 'start' && g.alignContent !== 'stretch') decls.push(['align-content', g.alignContent]);
    }
    return decls;
  }

  function formatAreas(areas) {
    var lines = String(areas).split(/\n+/).map(function (line) {
      return line.trim();
    }).filter(Boolean);
    if (!lines.length) return '';
    return lines.map(function (line) {
      if (line.charAt(0) === '"') return line;
      return '"' + line.replace(/"/g, '') + '"';
    }).join('\n    ');
  }

  function itemDecls(state, item) {
    var decls = [];
    if (item.width > 0) decls.push(['width', px(item.width)]);
    if (item.height > 0) decls.push(['height', px(item.height)]);

    if (state.mode === 'flex') {
      if (item.grow !== 0 || item.shrink !== 1 || item.basis !== 'auto') {
        decls.push(['flex', item.grow + ' ' + item.shrink + ' ' + flexBasisValue(item)]);
      }
      if (item.alignSelf !== 'auto') decls.push(['align-self', item.alignSelf]);
      if (item.order !== 0) decls.push(['order', String(item.order)]);
    } else {
      var col = gridLine(item.colStart, item.colSpan);
      var row = gridLine(item.rowStart, item.rowSpan);
      if (col) decls.push(['grid-column', col]);
      if (row) decls.push(['grid-row', row]);
      if (item.justifySelf !== 'auto') decls.push(['justify-self', item.justifySelf]);
      if (item.alignSelfGrid !== 'auto') decls.push(['align-self', item.alignSelfGrid]);
    }
    return decls;
  }

  function serializeDecls(decls, indent) {
    var pad = indent || '  ';
    return decls.map(function (pair) {
      return pad + pair[0] + ': ' + pair[1] + ';';
    }).join('\n');
  }

  function generateCSS(state) {
    state = normalize(state);
    var parts = [];
    parts.push('.layout {');
    parts.push(serializeDecls(containerDecls(state)));
    parts.push('}');
    parts.push('');
    parts.push('.layout__item {');
    parts.push('  display: flex;');
    parts.push('  align-items: center;');
    parts.push('  justify-content: center;');
    parts.push('  min-height: 64px;');
    parts.push('  padding: 0.75rem;');
    parts.push('  border-radius: 10px;');
    parts.push('  color: #fff;');
    parts.push('  font-weight: 800;');
    parts.push('}');

    var i, item, decls, sel;
    for (i = 0; i < state.items.length; i++) {
      item = state.items[i];
      decls = itemDecls(state, item);
      var custom = state.mode === 'flex' ? itemIsFlexCustom(item) : itemIsGridCustom(item);
      if (!custom && !decls.length) continue;
      sel = '.layout__item:nth-child(' + (i + 1) + ')';
      parts.push('');
      parts.push(sel + ' {');
      if (decls.length) parts.push(serializeDecls(decls));
      parts.push('}');
    }
    return parts.join('\n') + '\n';
  }

  function generateHTML(state) {
    state = normalize(state);
    var lines = ['<div class="layout">'];
    var i, item;
    for (i = 0; i < state.items.length; i++) {
      item = state.items[i];
      lines.push('  <div class="layout__item">' + escapeHtml(item.label) + '</div>');
    }
    lines.push('</div>');
    return lines.join('\n');
  }

  function generateFullDocument(state) {
    state = normalize(state);
    var css = generateCSS(state);
    var html = generateHTML(state);
    var itemColors = state.items.map(function (item, i) {
      return '    .layout__item:nth-child(' + (i + 1) + ') { background: ' + item.color + '; }';
    }).join('\n');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '<title>Layout playground</title>\n<style>\n' +
      'body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; font-family: ui-sans-serif, system-ui, sans-serif; background: #f4faf9; color: #134e4a; }\n' +
      css + '\n' + itemColors + '\n' +
      '.layout { width: min(960px, 100%); background: #fff; border: 1px solid #d5e8e4; border-radius: 16px; }\n' +
      '</style>\n</head>\n<body>\n' + html + '\n</body>\n</html>\n';
  }

  function highlightCSS(css) {
    return escapeHtml(css)
      .replace(/(\.layout(?:__item)?(?::nth-child\(\d+\))?)/g, '<span class="fgp-tok-sel">$1</span>')
      .replace(/(display|flex-direction|flex-wrap|justify-content|align-items|align-content|align-self|flex|order|gap|padding|min-height|width|height|grid-template-columns|grid-template-rows|grid-template-areas|grid-auto-flow|justify-items|grid-column|grid-row|justify-self):/g, '<span class="fgp-tok-prop">$1</span>:')
      .replace(/: ([^;{]+);/g, ': <span class="fgp-tok-val">$1</span>;');
  }

  function highlightHTML(html) {
    return escapeHtml(html)
      .replace(/(&lt;\/?)([a-z0-9]+)/gi, '$1<span class="fgp-tok-tag">$2</span>')
      .replace(/(class)=(&quot;.*?&quot;)/g, '<span class="fgp-tok-attr">$1</span>=<span class="fgp-tok-val">$2</span>');
  }

  /* Preview styles — same declarations, as a style object. */
  function containerStyle(state) {
    state = normalize(state);
    var style = {};
    containerDecls(state).forEach(function (pair) { style[pair[0]] = pair[1]; });
    style.width = state.box.width + '%';
    return style;
  }

  function itemStyle(state, index) {
    state = normalize(state);
    var item = state.items[index];
    if (!item) return {};
    var style = { background: item.color };
    itemDecls(state, item).forEach(function (pair) { style[pair[0]] = pair[1]; });
    return style;
  }

  /* ======================================================================
     Presets — real layouts, not decorative snapshots
     ====================================================================== */

  var PRESETS = [
    {
      id: 'navbar', mode: 'flex', label: 'Navbar',
      apply: function (state) {
        state.mode = 'flex';
        state.itemCount = 4;
        state.flex = { display: 'flex', direction: 'row', wrap: 'nowrap', justify: 'space-between', align: 'center', alignContent: 'stretch' };
        state.box.gap = 12;
        state.box.gapLinked = true;
        state.box.minHeight = 72;
        state.box.padding = 12;
        ensureItems(state);
        state.items[0].label = 'Logo';
        state.items[0].grow = 0;
        state.items[1].label = 'Home';
        state.items[2].label = 'Docs';
        state.items[3].label = 'Login';
      }
    },
    {
      id: 'center', mode: 'flex', label: 'Perfect center',
      apply: function (state) {
        state.mode = 'flex';
        state.itemCount = 1;
        state.flex = { display: 'flex', direction: 'row', wrap: 'nowrap', justify: 'center', align: 'center', alignContent: 'stretch' };
        state.box.minHeight = 280;
        state.box.padding = 16;
        ensureItems(state);
        state.items[0].label = 'Centered';
        state.items[0].width = 160;
        state.items[0].height = 88;
      }
    },
    {
      id: 'cards', mode: 'flex', label: 'Wrapping cards',
      apply: function (state) {
        state.mode = 'flex';
        state.itemCount = 8;
        state.flex = { display: 'flex', direction: 'row', wrap: 'wrap', justify: 'flex-start', align: 'stretch', alignContent: 'flex-start' };
        state.box.gap = 12;
        state.box.gapLinked = true;
        state.box.minHeight = 280;
        ensureItems(state);
        state.items.forEach(function (item) {
          item.basis = 'px';
          item.basisValue = 140;
          item.grow = 1;
          item.shrink = 1;
        });
      }
    },
    {
      id: 'sidebar', mode: 'flex', label: 'Sidebar + main',
      apply: function (state) {
        state.mode = 'flex';
        state.itemCount = 2;
        state.flex = { display: 'flex', direction: 'row', wrap: 'nowrap', justify: 'flex-start', align: 'stretch', alignContent: 'stretch' };
        state.box.gap = 16;
        state.box.minHeight = 320;
        ensureItems(state);
        state.items[0].label = 'Sidebar';
        state.items[0].basis = 'px';
        state.items[0].basisValue = 180;
        state.items[0].grow = 0;
        state.items[0].shrink = 0;
        state.items[1].label = 'Main';
        state.items[1].grow = 1;
        state.items[1].shrink = 1;
        state.items[1].basis = 'auto';
      }
    },
    {
      id: 'stack', mode: 'flex', label: 'Vertical stack',
      apply: function (state) {
        state.mode = 'flex';
        state.itemCount = 4;
        state.flex = { display: 'flex', direction: 'column', wrap: 'nowrap', justify: 'flex-start', align: 'stretch', alignContent: 'stretch' };
        state.box.gap = 10;
        state.box.minHeight = 320;
        ensureItems(state);
      }
    },
    {
      id: 'space', mode: 'flex', label: 'Space between',
      apply: function (state) {
        state.mode = 'flex';
        state.itemCount = 3;
        state.flex = { display: 'flex', direction: 'row', wrap: 'nowrap', justify: 'space-between', align: 'center', alignContent: 'stretch' };
        state.box.minHeight = 160;
        ensureItems(state);
      }
    },
    {
      id: 'thirds', mode: 'grid', label: '3-column grid',
      apply: function (state) {
        state.mode = 'grid';
        state.itemCount = 6;
        state.grid.columns = 'repeat(3, 1fr)';
        state.grid.rows = 'auto';
        state.grid.areas = '';
        state.grid.autoFlow = 'row';
        state.grid.justifyItems = 'stretch';
        state.grid.alignItems = 'stretch';
        state.box.gap = 12;
        state.box.minHeight = 280;
        ensureItems(state);
      }
    },
    {
      id: 'autofit', mode: 'grid', label: 'Auto-fit cards',
      apply: function (state) {
        state.mode = 'grid';
        state.itemCount = 8;
        state.grid.columns = 'repeat(auto-fit, minmax(140px, 1fr))';
        state.grid.rows = 'auto';
        state.grid.areas = '';
        state.grid.autoFlow = 'row';
        state.box.gap = 12;
        state.box.minHeight = 280;
        ensureItems(state);
      }
    },
    {
      id: 'hero', mode: 'grid', label: 'Hero + tiles',
      apply: function (state) {
        state.mode = 'grid';
        state.itemCount = 5;
        state.grid.columns = 'repeat(4, 1fr)';
        state.grid.rows = '140px 120px';
        state.grid.areas = '';
        state.grid.autoFlow = 'row';
        state.box.gap = 12;
        state.box.minHeight = 280;
        ensureItems(state);
        state.items[0].label = 'Hero';
        state.items[0].colStart = '1';
        state.items[0].colSpan = 2;
        state.items[0].rowStart = '1';
        state.items[0].rowSpan = 2;
      }
    },
    {
      id: 'holy', mode: 'grid', label: 'Holy grail',
      apply: function (state) {
        state.mode = 'grid';
        state.itemCount = 5;
        state.grid.columns = '180px 1fr 160px';
        state.grid.rows = '64px 1fr 56px';
        state.grid.areas = '"header header header"\n"nav main aside"\n"footer footer footer"';
        state.grid.autoFlow = 'row';
        state.box.gap = 10;
        state.box.minHeight = 360;
        ensureItems(state);
        state.items[0].label = 'Header';
        state.items[1].label = 'Nav';
        state.items[2].label = 'Main';
        state.items[3].label = 'Aside';
        state.items[4].label = 'Footer';
      }
    },
    {
      id: 'dense', mode: 'grid', label: 'Dense packing',
      apply: function (state) {
        state.mode = 'grid';
        state.itemCount = 7;
        state.grid.columns = 'repeat(4, 1fr)';
        state.grid.rows = 'repeat(3, 90px)';
        state.grid.areas = '';
        state.grid.autoFlow = 'row dense';
        state.box.gap = 8;
        ensureItems(state);
        state.items[0].colSpan = 2;
        state.items[0].rowSpan = 2;
        state.items[0].label = 'Feature';
        state.items[3].colSpan = 2;
      }
    },
    {
      id: 'twelve', mode: 'grid', label: '12-column',
      apply: function (state) {
        state.mode = 'grid';
        state.itemCount = 4;
        state.grid.columns = 'repeat(12, 1fr)';
        state.grid.rows = 'auto';
        state.grid.areas = '';
        state.grid.autoFlow = 'row';
        state.box.gap = 8;
        state.box.minHeight = 200;
        ensureItems(state);
        state.items[0].label = '8 cols';
        state.items[0].colSpan = 8;
        state.items[1].label = '4 cols';
        state.items[1].colSpan = 4;
        state.items[2].label = '3';
        state.items[2].colSpan = 3;
        state.items[3].label = '9 cols';
        state.items[3].colSpan = 9;
      }
    }
  ];

  var PRESET_IDS = PRESETS.map(function (p) { return p.id; });

  function applyPreset(state, id) {
    state = normalize(state);
    var preset = null;
    var i;
    for (i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === id) { preset = PRESETS[i]; break; }
    }
    if (!preset) return state;
    preset.apply(state);
    return normalize(state);
  }

  function setMode(state, mode) {
    state = normalize(state);
    state.mode = mode === 'grid' ? 'grid' : 'flex';
    state.selected = -1;
    return state;
  }

  function setItemCount(state, count) {
    state = normalize(state);
    state.itemCount = clampNum(count, MIN_ITEMS, MAX_ITEMS, state.itemCount);
    return ensureItems(state);
  }

  function updateContainer(state, patch) {
    state = normalize(state);
    var key;
    if (!patch || typeof patch !== 'object') return state;
    if (patch.flex && typeof patch.flex === 'object') {
      for (key in patch.flex) if (Object.prototype.hasOwnProperty.call(patch.flex, key)) state.flex[key] = patch.flex[key];
    }
    if (patch.grid && typeof patch.grid === 'object') {
      for (key in patch.grid) if (Object.prototype.hasOwnProperty.call(patch.grid, key)) state.grid[key] = patch.grid[key];
    }
    if (patch.box && typeof patch.box === 'object') {
      for (key in patch.box) if (Object.prototype.hasOwnProperty.call(patch.box, key)) state.box[key] = patch.box[key];
    }
    if (typeof patch.overlay === 'boolean') state.overlay = patch.overlay;
    return normalize(state);
  }

  function updateItem(state, index, patch) {
    state = normalize(state);
    if (index < 0 || index >= state.items.length || !patch) return state;
    var key;
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) state.items[index][key] = patch[key];
    }
    return normalize(state);
  }

  /* ======================================================================
     Educational copy — changes with the live state
     ====================================================================== */

  function explain(state) {
    state = normalize(state);
    if (state.mode === 'flex') {
      var f = state.flex;
      var main = (f.direction === 'row' || f.direction === 'row-reverse') ? 'horizontal' : 'vertical';
      var cross = main === 'horizontal' ? 'vertical' : 'horizontal';
      var bits = [];
      bits.push('Main axis is ' + main + ' (' + f.direction + '). justify-content distributes items along it; align-items along the ' + cross + ' cross axis.');
      if (f.wrap === 'nowrap') bits.push('Items stay on one line — they will shrink (flex-shrink) rather than wrap.');
      else bits.push('Wrapping is on, so align-content now matters: it packs the extra rows.');
      if (f.justify === 'space-between') bits.push('space-between puts the first and last items on the edges with leftover space only between them.');
      if (f.align === 'stretch' && (f.direction === 'row' || f.direction === 'row-reverse')) bits.push('stretch makes every item as tall as the container unless it has a set height or align-self.');
      return bits.join(' ');
    }
    var g = state.grid;
    var bits2 = [];
    bits2.push('Grid lays items onto tracks: columns are `' + g.columns + '`.');
    if (/auto-fit|auto-fill/.test(g.columns)) bits2.push('auto-fit collapses empty tracks so leftover space is absorbed by the items that exist; auto-fill would keep the empty tracks.');
    if (g.areas) bits2.push('Named areas assign whole regions (header, nav, main) without counting line numbers.');
    if (g.autoFlow.indexOf('dense') !== -1) bits2.push('dense packing back-fills holes left by spanning items — the visual order can differ from DOM order, which is an accessibility concern for tab order.');
    else bits2.push('Default auto-flow is row: items fill left to right, then wrap to the next row.');
    return bits2.join(' ');
  }

  function whenToUse(mode) {
    if (mode === 'grid') {
      return 'Use Grid when you need control in two dimensions at once — overlapping regions, a dashboard, a page shell with header/sidebar/footer, or items that span columns. Flexbox is still the right tool for a single row or column of controls.';
    }
    return 'Use Flexbox when the layout is one-dimensional: a navbar, a button group, a wrapping card row, or a sidebar beside a main column. Reach for Grid when you need rows and columns at the same time.';
  }

  /* ======================================================================
     Share encoding
     ====================================================================== */

  function encodeState(state) {
    try {
      var json = JSON.stringify(normalize(state));
      if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(json)));
      return Buffer.from(json, 'utf8').toString('base64');
    } catch (err) {
      return '';
    }
  }

  function decodeState(token) {
    try {
      var json;
      if (typeof atob === 'function') json = decodeURIComponent(escape(atob(token)));
      else json = Buffer.from(token, 'base64').toString('utf8');
      return normalize(JSON.parse(json));
    } catch (err) {
      return null;
    }
  }

  global.FlexboxGridEngine = {
    defaultState: defaultState,
    normalize: normalize,
    cloneState: cloneState,
    applyPreset: applyPreset,
    setMode: setMode,
    setItemCount: setItemCount,
    updateContainer: updateContainer,
    updateItem: updateItem,
    generateCSS: generateCSS,
    generateHTML: generateHTML,
    generateFullDocument: generateFullDocument,
    highlightCSS: highlightCSS,
    highlightHTML: highlightHTML,
    containerStyle: containerStyle,
    itemStyle: itemStyle,
    explain: explain,
    whenToUse: whenToUse,
    encodeState: encodeState,
    decodeState: decodeState,
    itemIsFlexCustom: itemIsFlexCustom,
    itemIsGridCustom: itemIsGridCustom,
    safeTrackList: safeTrackList,
    escapeHtml: escapeHtml,
    PRESETS: PRESETS,
    PRESET_IDS: PRESET_IDS,
    FLEX_DISPLAY: FLEX_DISPLAY,
    FLEX_DIRECTION: FLEX_DIRECTION,
    FLEX_WRAP: FLEX_WRAP,
    JUSTIFY_CONTENT: JUSTIFY_CONTENT,
    ALIGN_ITEMS: ALIGN_ITEMS,
    ALIGN_CONTENT: ALIGN_CONTENT,
    ALIGN_SELF: ALIGN_SELF,
    GRID_DISPLAY: GRID_DISPLAY,
    AUTO_FLOW: AUTO_FLOW,
    JUSTIFY_ITEMS: JUSTIFY_ITEMS,
    SELF_ALIGN: SELF_ALIGN,
    ITEM_PALETTE: ITEM_PALETTE,
    MIN_ITEMS: MIN_ITEMS,
    MAX_ITEMS: MAX_ITEMS
  };

})(typeof window !== 'undefined' ? window : this);
