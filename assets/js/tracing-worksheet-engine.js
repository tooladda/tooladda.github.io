/* ToolAdda — Handwriting Tracing Worksheet engine.

   Pure layout maths: page geometry, ruling positions, how many rows fit and
   what goes on each. No DOM, so it is testable under plain Node.

   The one thing a tracing sheet must get right is the ruling. English
   handwriting is taught on four lines and the letters have to sit on them
   exactly: 'a' stops at the dashed middle line, 'h' reaches the top one, 'g'
   drops to the bottom one. That only holds if the lines are derived from the
   font's own metrics. Fixing the lines first and sizing the font to fit — the
   obvious way round — leaves the ascender short of the top line at every row
   height, and a sheet that teaches the wrong proportion is worse than none. */
(function (global) {
  'use strict';

  var MM_PER_INCH = 25.4;

  var PAGES = {
    a4:     { label: 'A4',     width: 210, height: 297 },
    letter: { label: 'Letter', width: 216, height: 279 },
    a5:     { label: 'A5',     width: 148, height: 210 }
  };

  /* Handwriting-face metrics, as fractions of the font size. These are the
     numbers the ruling is derived FROM — not the other way round.

     Fixing the lines first and then sizing the font to fit was the original
     mistake here: the two never agree, and you get a sheet where the ascender
     of 'h' stops short of the top line and the child is taught the wrong
     proportion. Deriving the lines from the metrics makes them consistent by
     construction, whatever row height is chosen. */
  var METRICS = { xHeight: 0.52, ascender: 0.72, descender: 0.21 };

  /* A little air above the ascender line and below the descender line, so the
     rows of a sheet do not touch each other. */
  var ROW_PADDING = 0.12;

  var STYLES = ['four-line', 'two-line', 'single-line', 'devanagari', 'blank', 'grid'];
  var CASES = ['as-typed', 'upper', 'lower', 'capitalise'];
  var FITS = ['repeat', 'sentence'];
  var INKS = ['grey', 'blue', 'light'];

  /* Devanagari hangs from a headline (shirorekha) rather than sitting on a
     baseline, so English four-line ruling is the wrong paper for it — the page
     documented that as a limitation. This ruling gives it the right one: a
     solid line at the top for the letters to hang from, and a lower line for
     the matras that drop below. */
  var DEVANAGARI = { headline: 0.18, bottom: 0.86 };
  var MODES = ['trace-all', 'trace-then-blank', 'model-then-trace'];
  var TRACE = ['faded', 'outline', 'dotted'];

  var PRESETS = {
    'uppercase': 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z',
    'lowercase': 'a b c d e f g h i j k l m n o p q r s t u v w x y z',
    'numbers': '0 1 2 3 4 5 6 7 8 9',
    'cvc-words': 'cat dog sun hat pen bus cup red big top',
    'sight-words': 'the and you are for was his she has him',
    'hindi-vowels': 'अ आ इ ई उ ऊ ए ऐ ओ औ अं अः'
  };

  function clamp(value, min, max) {
    var n = Number(value);
    if (typeof n !== 'number' || !isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function mmToPx(mm, dpi) {
    return (Number(mm) || 0) * ((dpi || 96) / MM_PER_INCH);
  }

  function pxToMm(px, dpi) {
    return (Number(px) || 0) * (MM_PER_INCH / (dpi || 96));
  }

  /** Printable area of a page once margins are removed. */
  function pageGeometry(size, orientation, marginMm) {
    var page = PAGES[String(size || '').toLowerCase()] || PAGES.a4;
    var landscape = orientation === 'landscape';
    var width = landscape ? page.height : page.width;
    var height = landscape ? page.width : page.height;
    var margin = clamp(marginMm, 5, 40);
    return {
      label: page.label,
      width: width,
      height: height,
      margin: margin,
      contentWidth: Math.max(1, width - margin * 2),
      contentHeight: Math.max(1, height - margin * 2)
    };
  }

  /** Font size for the row, in mm.
   *
   *  The row has to hold an ascender, a descender and a little padding, so the
   *  em size is what is left once those are accounted for. Everything else on
   *  the sheet is positioned from this one number. */
  function fontSizeForRow(rowHeightMm, style) {
    var h = Math.max(1, Number(rowHeightMm) || 0);
    if (style === 'blank' || style === 'grid') return h * 0.6;
    if (style === 'single-line') return h * 0.55;
    /* Devanagari fills the band between the headline and the lower line rather
       than an x-height band, so it runs larger in the same row. */
    if (style === 'devanagari') return h * (DEVANAGARI.bottom - DEVANAGARI.headline) * 0.92;
    return h / (METRICS.ascender + METRICS.descender + ROW_PADDING);
  }

  /** Baseline offset from the row's top edge, in mm. */
  function baselineFor(rowHeightMm, style) {
    var h = Math.max(1, Number(rowHeightMm) || 0);
    if (style === 'blank' || style === 'grid') return h * 0.72;
    if (style === 'single-line') return h * 0.8;
    /* The glyph body hangs from the headline, so the baseline sits a little
       above the lower line to leave room for matras. */
    if (style === 'devanagari') return h * DEVANAGARI.bottom - fontSizeForRow(h, style) * 0.14;
    var size = fontSizeForRow(h, style);
    return (h * ROW_PADDING) / 2 + size * METRICS.ascender;
  }

  /** Ruling line positions for one row, in mm from the row's top edge.
   *
   *  Derived from the font size, so an ascender lands exactly on the top line
   *  and an x-height letter lands exactly on the dashed middle one. */
  function ruleLines(rowHeightMm, style) {
    var h = Math.max(1, Number(rowHeightMm) || 0);
    if (style === 'blank' || style === 'grid') return [];

    var base = baselineFor(h, style);
    if (style === 'single-line') return [{ key: 'base', y: base, dashed: false }];
    if (style === 'devanagari') {
      return [
        { key: 'headline', y: h * DEVANAGARI.headline, dashed: false },
        { key: 'bottom', y: h * DEVANAGARI.bottom, dashed: false }
      ];
    }

    var size = fontSizeForRow(h, style);
    var mid = base - size * METRICS.xHeight;
    if (style === 'two-line') {
      return [
        { key: 'mid', y: mid, dashed: false },
        { key: 'base', y: base, dashed: false }
      ];
    }
    return [
      { key: 'top', y: base - size * METRICS.ascender, dashed: false },
      { key: 'mid', y: mid, dashed: true },
      { key: 'base', y: base, dashed: false },
      { key: 'desc', y: base + size * METRICS.descender, dashed: false }
    ];
  }

  /* `@page { margin: 0 }` is a request, not a guarantee — most printers reserve
     a few millimetres of hardware margin and the browser honours that instead.
     A sheet sized to the full paper then overflows by the difference, and the
     spill lands on the next sheet as a sliver that reads as a blank page
     between every real one. Holding this much back costs at most one row per
     page and makes the sheet fit either way.

     12mm, i.e. 6mm a side, because the band has to cover the whole hardware
     margin rather than half of it — at 8mm a Letter sheet with 20mm rows still
     spilled by 3mm. */
  var PRINT_SAFETY_MM = 12;

  function rowsPerPage(geometry, rowHeightMm, headerMm) {
    var usable = geometry.contentHeight - (Number(headerMm) || 0) - PRINT_SAFETY_MM;
    var h = Math.max(1, Number(rowHeightMm) || 0);
    return Math.max(0, Math.floor(usable / h));
  }

  /** Split the text into the items a child traces — words, or single letters. */
  function parseItems(text, splitBy) {
    var raw = String(text === undefined || text === null ? '' : text);
    if (splitBy === 'letters') {
      return raw.split('').filter(function (ch) { return ch.trim() !== ''; });
    }
    if (splitBy === 'lines') {
      return raw.split(/\r?\n/).map(function (l) { return l.trim(); })
                .filter(function (l) { return l !== ''; });
    }
    return raw.split(/\s+/).filter(function (word) { return word !== ''; });
  }

  /** Case transform, applied before anything is measured or laid out. */
  function applyCase(text, mode) {
    var value = String(text === undefined || text === null ? '' : text);
    if (mode === 'upper') return value.toUpperCase();
    if (mode === 'lower') return value.toLowerCase();
    if (mode === 'capitalise') {
      return value.replace(/(^|\s)(\S)/g, function (m, sp, ch) { return sp + ch.toUpperCase(); });
    }
    return value;
  }

  /** Pack words into rows instead of repeating one item — "sentence" mode, for
   *  a child copying a line rather than drilling a single letter.
   *
   *  `measure` is injected rather than computed here so the engine stays
   *  DOM-free: the UI passes a canvas-backed function, tests pass a fake. */
  function wrapItems(items, contentWidth, measure, gapMm) {
    var rows = [];
    var current = [];
    var width = 0;
    var gap = Math.max(0, Number(gapMm) || 0);
    (items || []).forEach(function (item) {
      var w = measure(item);
      var needed = current.length ? width + gap + w : w;
      if (current.length && needed > contentWidth) {
        rows.push(current);
        current = [item];
        width = w;
        return;
      }
      current.push(item);
      width = needed;
    });
    if (current.length) rows.push(current);
    return rows;
  }

  /* Settings travel as a short URL fragment so a teacher can send the exact
     sheet rather than a screenshot and a list of instructions. The keys are
     abbreviated because the link ends up in a WhatsApp message. */
  var SHARE_KEYS = {
    text: 't', splitBy: 's', style: 'r', mode: 'm', trace: 'c', font: 'f',
    rowHeightMm: 'h', linesPerItem: 'l', pageSize: 'p', orientation: 'o',
    marginMm: 'g', title: 'n', textCase: 'u', fit: 'w', ink: 'i',
    startDots: 'd', showPageNumbers: 'z'
  };

  function encodeSettings(settings) {
    var out = [];
    Object.keys(SHARE_KEYS).forEach(function (key) {
      var value = (settings || {})[key];
      if (value === undefined || value === null || value === '') return;
      if (typeof value === 'boolean') value = value ? '1' : '0';
      out.push(SHARE_KEYS[key] + '=' + encodeURIComponent(String(value)));
    });
    return out.join('&');
  }

  function decodeSettings(fragment) {
    var lookup = {};
    Object.keys(SHARE_KEYS).forEach(function (key) { lookup[SHARE_KEYS[key]] = key; });
    var out = {};
    String(fragment || '').replace(/^#/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      if (eq < 1) return;
      var key = lookup[pair.slice(0, eq)];
      if (!key) return;
      out[key] = decodeURIComponent(pair.slice(eq + 1));
    });
    return out;
  }

  /** How many times an item fits across one row. */
  function repeatsPerRow(item, geometry, rowHeightMm, style, gapMm) {
    var fontMm = fontSizeForRow(rowHeightMm, style);
    /* A handwriting face averages roughly 0.5em per character; exact metrics
       need a canvas, and the UI overrides this once it has measured. */
    var itemWidth = Math.max(1, String(item).length * fontMm * 0.5);
    var gap = Math.max(0, Number(gapMm) || 0);
    return Math.max(1, Math.floor((geometry.contentWidth + gap) / (itemWidth + gap)));
  }

  /** Build the rows for the sheet.
   *
   *  modes:
   *    trace-all        every row is traceable
   *    trace-then-blank one traceable row, then an empty ruled row to copy into
   *    model-then-trace a solid model row, then traceable rows
   */
  function buildRows(options) {
    var opts = options || {};
    var items = opts.items || [];
    var mode = MODES.indexOf(opts.mode) === -1 ? 'trace-all' : opts.mode;
    var linesPerItem = Math.max(1, Math.floor(Number(opts.linesPerItem) || 1));
    var rows = [];

    items.forEach(function (item) {
      if (mode === 'model-then-trace') {
        rows.push({ item: item, kind: 'model' });
        for (var m = 0; m < linesPerItem; m += 1) rows.push({ item: item, kind: 'trace' });
      } else if (mode === 'trace-then-blank') {
        for (var t = 0; t < linesPerItem; t += 1) {
          rows.push({ item: item, kind: 'trace' });
          rows.push({ item: item, kind: 'blank' });
        }
      } else {
        for (var a = 0; a < linesPerItem; a += 1) rows.push({ item: item, kind: 'trace' });
      }
    });

    return rows;
  }

  /** Chunk rows into pages. A row is never split across a page break. */
  function paginate(rows, perPage) {
    var size = Math.max(1, Math.floor(Number(perPage) || 1));
    var pages = [];
    for (var i = 0; i < (rows || []).length; i += size) {
      pages.push(rows.slice(i, i + size));
    }
    return pages.length ? pages : [[]];
  }

  /** Everything the renderer needs, in one call. */
  function plan(options) {
    var opts = options || {};
    var geometry = pageGeometry(opts.pageSize, opts.orientation, opts.marginMm);
    var style = STYLES.indexOf(opts.style) === -1 ? 'four-line' : opts.style;
    var rowHeight = clamp(opts.rowHeightMm, 8, 40);
    var headerMm = opts.title ? 14 : 0;
    var items = parseItems(applyCase(opts.text, opts.textCase), opts.splitBy);
    var rows;
    if (opts.fit === 'sentence' && typeof opts.measure === 'function') {
      /* One row per wrapped line, each repeated linesPerItem times so the child
         gets more than one go at the same line. */
      var lines = wrapItems(items, geometry.contentWidth, opts.measure,
                            fontSizeForRow(rowHeight, style) * 0.3);
      rows = buildRows({
        items: lines.map(function (words) { return words.join(' '); }),
        mode: opts.mode,
        linesPerItem: opts.linesPerItem
      });
    } else {
      rows = buildRows({ items: items, mode: opts.mode, linesPerItem: opts.linesPerItem });
    }
    var perPage = rowsPerPage(geometry, rowHeight, headerMm);

    return {
      geometry: geometry,
      style: style,
      rowHeight: rowHeight,
      fontSize: fontSizeForRow(rowHeight, style),
      baseline: baselineFor(rowHeight, style),
      lines: ruleLines(rowHeight, style),
      items: items,
      rows: rows,
      rowsPerPage: perPage,
      pages: paginate(rows, perPage),
      headerMm: headerMm
    };
  }

  var api = {
    MM_PER_INCH: MM_PER_INCH,
    PAGES: PAGES,
    METRICS: METRICS,
    ROW_PADDING: ROW_PADDING,
    PRINT_SAFETY_MM: PRINT_SAFETY_MM,
    STYLES: STYLES,
    CASES: CASES,
    FITS: FITS,
    INKS: INKS,
    DEVANAGARI: DEVANAGARI,
    SHARE_KEYS: SHARE_KEYS,
    applyCase: applyCase,
    wrapItems: wrapItems,
    encodeSettings: encodeSettings,
    decodeSettings: decodeSettings,
    MODES: MODES,
    TRACE: TRACE,
    PRESETS: PRESETS,
    clamp: clamp,
    mmToPx: mmToPx,
    pxToMm: pxToMm,
    pageGeometry: pageGeometry,
    ruleLines: ruleLines,
    fontSizeForRow: fontSizeForRow,
    baselineFor: baselineFor,
    rowsPerPage: rowsPerPage,
    parseItems: parseItems,
    repeatsPerRow: repeatsPerRow,
    buildRows: buildRows,
    paginate: paginate,
    plan: plan
  };

  global.TracingWorksheetEngine = api;

  /* ------------------------------------------------------------------ *
   * Node/test export — everything above this line is pure and DOM-free.
   * ------------------------------------------------------------------ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : this);
