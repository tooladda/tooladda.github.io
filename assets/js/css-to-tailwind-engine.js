/*
 * CSS -> Tailwind conversion engine (pure logic, no DOM).
 * Usable directly in the browser (window.CTW_ENGINE) or in Node (module.exports)
 * for unit testing.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Data tables
  // ---------------------------------------------------------------------
  var SPACING_SCALE = [
    [0, '0'], [1, 'px'], [2, '0.5'], [4, '1'], [6, '1.5'], [8, '2'], [10, '2.5'], [12, '3'],
    [14, '3.5'], [16, '4'], [20, '5'], [24, '6'], [28, '7'], [32, '8'], [36, '9'], [40, '10'],
    [44, '11'], [48, '12'], [56, '14'], [64, '16'], [80, '20'], [96, '24'], [112, '28'], [128, '32'],
    [144, '36'], [160, '40'], [176, '44'], [192, '48'], [208, '52'], [224, '56'], [240, '60'],
    [256, '64'], [288, '72'], [320, '80'], [384, '96'],
  ];
  var FONT_SIZE_SCALE = [
    [12, 'xs'], [14, 'sm'], [16, 'base'], [18, 'lg'], [20, 'xl'], [24, '2xl'], [30, '3xl'],
    [36, '4xl'], [48, '5xl'], [60, '6xl'], [72, '7xl'], [96, '8xl'], [128, '9xl'],
  ];
  var RADIUS_SCALE = [
    [0, 'none'], [2, 'sm'], [4, 'DEFAULT'], [6, 'md'], [8, 'lg'], [12, 'xl'], [16, '2xl'],
    [24, '3xl'], [9999, 'full'],
  ];
  var BORDER_WIDTH_SCALE = [[0, '0'], [1, 'DEFAULT'], [2, '2'], [4, '4'], [8, '8']];
  var BLUR_SCALE = [[0, 'none'], [4, 'sm'], [8, 'DEFAULT'], [12, 'md'], [16, 'lg'], [24, 'xl'], [40, '2xl'], [64, '3xl']];
  var DURATION_SCALE = [0, 75, 100, 150, 200, 300, 500, 700, 1000];
  var OPACITY_SCALE = [0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100];
  var ZINDEX_SCALE = [0, 10, 20, 30, 40, 50];
  var ROTATE_SCALE = [0, 1, 2, 3, 6, 12, 45, 90, 180];
  var SKEW_SCALE = [0, 1, 2, 3, 6, 12];
  var SCALE_SCALE = [0, 50, 75, 90, 95, 100, 105, 110, 125, 150];
  var TRACKING_SCALE = [
    [-0.05, 'tighter'], [-0.025, 'tight'], [0, 'normal'], [0.025, 'wide'], [0.05, 'wider'], [0.1, 'widest'],
  ];
  var LEADING_NAMED = [
    [1, 'none'], [1.25, 'tight'], [1.375, 'snug'], [1.5, 'normal'], [1.625, 'relaxed'], [2, 'loose'],
  ];
  var BREAKPOINTS = [[640, 'sm'], [768, 'md'], [1024, 'lg'], [1280, 'xl'], [1536, '2xl']];
  var FRACTIONS = [
    [8.3333, '1/12'], [16.6667, '1/6'], [20, '1/5'], [25, '1/4'], [33.3333, '1/3'], [41.6667, '5/12'],
    [50, '1/2'], [58.3333, '7/12'], [60, '3/5'], [66.6667, '2/3'], [75, '3/4'], [80, '4/5'],
    [83.3333, '5/6'], [91.6667, '11/12'], [100, 'full'],
  ];

  var PALETTE = {
    slate: ['f8fafc', 'f1f5f9', 'e2e8f0', 'cbd5e1', '94a3b8', '64748b', '475569', '334155', '1e293b', '0f172a'],
    gray: ['f9fafb', 'f3f4f6', 'e5e7eb', 'd1d5db', '9ca3af', '6b7280', '4b5563', '374151', '1f2937', '111827'],
    red: ['fef2f2', 'fee2e2', 'fecaca', 'fca5a5', 'f87171', 'ef4444', 'dc2626', 'b91c1c', '991b1b', '7f1d1d'],
    orange: ['fff7ed', 'ffedd5', 'fed7aa', 'fdba74', 'fb923c', 'f97316', 'ea580c', 'c2410c', '9a3412', '7c2d12'],
    amber: ['fffbeb', 'fef3c7', 'fde68a', 'fcd34d', 'fbbf24', 'f59e0b', 'd97706', 'b45309', '92400e', '78350f'],
    yellow: ['fefce8', 'fef9c3', 'fef08a', 'fde047', 'facc15', 'eab308', 'ca8a04', 'a16207', '854d0e', '713f12'],
    green: ['f0fdf4', 'dcfce7', 'bbf7d0', '86efac', '4ade80', '22c55e', '16a34a', '15803d', '166534', '14532d'],
    emerald: ['ecfdf5', 'd1fae5', 'a7f3d0', '6ee7b7', '34d399', '10b981', '059669', '047857', '065f46', '064e3b'],
    teal: ['f0fdfa', 'ccfbf1', '99f6e4', '5eead4', '2dd4bf', '14b8a6', '0d9488', '0f766e', '115e59', '134e4a'],
    cyan: ['ecfeff', 'cffafe', 'a5f3fc', '67e8f9', '22d3ee', '06b6d4', '0891b2', '0e7490', '155e75', '164e63'],
    blue: ['eff6ff', 'dbeafe', 'bfdbfe', '93c5fd', '60a5fa', '3b82f6', '2563eb', '1d4ed8', '1e40af', '1e3a8a'],
    indigo: ['eef2ff', 'e0e7ff', 'c7d2fe', 'a5b4fc', '818cf8', '6366f1', '4f46e5', '4338ca', '3730a3', '312e81'],
    violet: ['f5f3ff', 'ede9fe', 'ddd6fe', 'c4b5fd', 'a78bfa', '8b5cf6', '7c3aed', '6d28d9', '5b21b6', '4c1d95'],
    purple: ['faf5ff', 'f3e8ff', 'e9d5ff', 'd8b4fe', 'c084fc', 'a855f7', '9333ea', '7e22ce', '6b21a8', '581c87'],
    fuchsia: ['fdf4ff', 'fae8ff', 'f5d0fe', 'f0abfc', 'e879f9', 'd946ef', 'c026d3', 'a21caf', '86198f', '701a75'],
    pink: ['fdf2f8', 'fce7f3', 'fbcfe8', 'f9a8d4', 'f472b6', 'ec4899', 'db2777', 'be185d', '9d174d', '831843'],
    rose: ['fff1f2', 'ffe4e6', 'fecdd3', 'fda4af', 'fb7185', 'f43f5e', 'e11d48', 'be123c', '9f1239', '881337'],
  };
  var SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  var PALETTE_FLAT = (function () {
    var out = [];
    Object.keys(PALETTE).forEach(function (hue) {
      PALETTE[hue].forEach(function (hex, i) {
        out.push({ hue: hue, shade: SHADES[i], hex: '#' + hex });
      });
    });
    return out;
  })();

  var SORT_PREFIX_ORDER = [
    'container', 'sr-only', 'not-sr-only',
    'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents', 'hidden', 'table', 'list-item',
    'absolute', 'relative', 'fixed', 'sticky', 'static',
    'inset-', 'top-', 'right-', 'bottom-', 'left-', 'z-',
    'order-', 'col-', 'row-', 'grid-cols-', 'grid-rows-', 'auto-cols-', 'auto-rows-',
    'float-', 'clear-', 'box-',
    'flex-', 'grow', 'shrink', 'basis-',
    'justify-', 'items-', 'content-', 'self-', 'place-',
    'gap-',
    'w-', 'min-w-', 'max-w-', 'h-', 'min-h-', 'max-h-',
    'm-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-', 'space-',
    'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-',
    'font-', 'text-', 'leading-', 'tracking-', 'whitespace-', 'break-', 'truncate', 'list-', 'align-', 'indent-',
    'underline', 'overline', 'line-through', 'no-underline', 'decoration-', 'uppercase', 'lowercase', 'capitalize', 'normal-case', 'italic', 'not-italic',
    'bg-', 'from-', 'via-', 'to-',
    'border', 'rounded', 'divide-', 'ring', 'outline',
    'shadow', 'opacity-',
    'cursor-', 'pointer-events-', 'select-', 'resize-', 'touch-',
    'object-', 'overflow-', 'overscroll-', 'visible', 'invisible', 'scroll-',
    'transition', 'duration-', 'ease-', 'delay-', 'animate-',
    'transform', 'translate-', 'rotate-', 'scale-', 'skew-', 'origin-',
    'filter', 'blur-', 'brightness-', 'contrast-', 'grayscale', 'sepia', 'saturate-', 'invert', 'hue-rotate-', 'drop-shadow',
    'backdrop-',
    'fill-', 'stroke-', 'accent-', 'caret-',
  ];

  // ---------------------------------------------------------------------
  // Generic helpers
  // ---------------------------------------------------------------------
  function round2(n) { return Math.round(n * 100) / 100; }

  function toPx(value) {
    var v = value.trim();
    if (/^0(\.0+)?$/.test(v)) return 0;
    var m = v.match(/^(-?[\d.]+)px$/i); if (m) return parseFloat(m[1]);
    m = v.match(/^(-?[\d.]+)rem$/i); if (m) return round2(parseFloat(m[1]) * 16);
    m = v.match(/^(-?[\d.]+)em$/i); if (m) return round2(parseFloat(m[1]) * 16);
    return null;
  }
  function splitTopLevel(str, delim) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (c === delim && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim() !== '' || out.length) out.push(cur);
    return out.map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
  }
  function splitSpaceTopLevel(str) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (/\s/.test(c) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur) out.push(cur);
    return out;
  }
  function arbitrary(prefix, raw) {
    var v = String(raw).trim().replace(/\s+/g, '_');
    return prefix + '[' + v + ']';
  }
  function arbitraryProperty(prop, raw) {
    var v = String(raw).trim().replace(/\s+/g, '_');
    return '[' + prop + ':' + v + ']';
  }
  function matchNumericScale(val, scale) {
    for (var i = 0; i < scale.length; i++) if (Math.abs(scale[i] - val) < 1e-6) return scale[i];
    return null;
  }
  function matchLenScale(px, scale, prefix, allowNegative) {
    var neg = px < 0, abs = Math.abs(px);
    for (var i = 0; i < scale.length; i++) {
      if (Math.abs(scale[i][0] - abs) < 0.05) {
        var tok = scale[i][1];
        var cls = tok === 'DEFAULT' ? prefix.replace(/-$/, '') : prefix + tok;
        return (neg && allowNegative ? '-' + cls : cls);
      }
    }
    return null;
  }

  function spacingClass(prefix, valueToken, allowNegative) {
    var t = valueToken.trim();
    if (t === 'auto') return prefix + 'auto';
    if (/^0(\.0+)?$/.test(t)) return prefix + '0';
    var px = toPx(t);
    if (px !== null) {
      var cls = matchLenScale(px, SPACING_SCALE, prefix, allowNegative);
      if (cls) return cls;
      var neg = allowNegative && px < 0;
      return (neg ? '-' : '') + prefix + '[' + Math.abs(px) + 'px]';
    }
    var m = t.match(/^(-?[\d.]+)%$/);
    if (m) {
      var neg2 = allowNegative && parseFloat(m[1]) < 0;
      return (neg2 ? '-' : '') + prefix + '[' + Math.abs(parseFloat(m[1])) + '%]';
    }
    return arbitrary(prefix, t);
  }

  function widthHeightClass(prefix, value, axis) {
    var t = value.trim();
    if (t === 'auto') return prefix + 'auto';
    if (t === '100%') return prefix + 'full';
    if (/^100vh$/i.test(t) && axis === 'h') return prefix + 'screen';
    if (/^100vw$/i.test(t) && axis === 'w') return prefix + 'screen';
    if (/^100dvh$/i.test(t) && axis === 'h') return prefix + 'dvh';
    if (/^fit-content$/i.test(t)) return prefix + 'fit';
    if (/^max-content$/i.test(t)) return prefix + 'max';
    if (/^min-content$/i.test(t)) return prefix + 'min';
    var px = toPx(t);
    if (px !== null) {
      var cls = matchLenScale(px, SPACING_SCALE, prefix, false);
      if (cls) return cls;
      return prefix + '[' + px + 'px]';
    }
    var pm = t.match(/^([\d.]+)%$/);
    if (pm) {
      var pct = parseFloat(pm[1]);
      for (var i = 0; i < FRACTIONS.length; i++) if (Math.abs(FRACTIONS[i][0] - pct) < 0.06) return prefix + FRACTIONS[i][1];
      return prefix + '[' + pct + '%]';
    }
    return arbitrary(prefix, t);
  }

  // ---------------------------------------------------------------------
  // Color handling
  // ---------------------------------------------------------------------
  function rgbToHex(r, g, b) {
    function h(n) { n = Math.max(0, Math.min(255, Math.round(n))); var s = n.toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + h(r) + h(g) + h(b);
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  var NAMED_COLORS = {
    black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00',
    orange: 'ffa500', purple: '800080', pink: 'ffc0cb', gray: '808080', grey: '808080', silver: 'c0c0c0',
    maroon: '800000', olive: '808000', lime: '00ff00', aqua: '00ffff', cyan: '00ffff', teal: '008080',
    navy: '000080', fuchsia: 'ff00ff', magenta: 'ff00ff', brown: 'a52a2a', indigo: '4b0082', violet: 'ee82ee',
    gold: 'ffd700', coral: 'ff7f50', salmon: 'fa8072', khaki: 'f0e68c', crimson: 'dc143c', tomato: 'ff6347',
    orchid: 'da70d6', plum: 'dda0dd', turquoise: '40e0d0', beige: 'f5f5dc', ivory: 'fffff0', chocolate: 'd2691e',
    tan: 'd2b48c', skyblue: '87ceeb', slategray: '708090', slategrey: '708090', darkred: '8b0000',
    darkgreen: '006400', darkblue: '00008b', lightgray: 'd3d3d3', lightgrey: 'd3d3d3', lightblue: 'add8e6',
    lightgreen: '90ee90', lightyellow: 'ffffe0', lightpink: 'ffb6c1',
  };
  function normalizeColor(raw) {
    var v = raw.trim();
    if (NAMED_COLORS[v.toLowerCase()]) return { hex: '#' + NAMED_COLORS[v.toLowerCase()], alpha: 1 };
    var m = v.match(/^#([0-9a-f]{3})$/i);
    if (m) { var p = m[1].split(''); return { hex: ('#' + p[0] + p[0] + p[1] + p[1] + p[2] + p[2]).toLowerCase(), alpha: 1 }; }
    m = v.match(/^#([0-9a-f]{6})$/i);
    if (m) return { hex: '#' + m[1].toLowerCase(), alpha: 1 };
    m = v.match(/^#([0-9a-f]{8})$/i);
    if (m) return { hex: '#' + m[1].slice(0, 6).toLowerCase(), alpha: round2(parseInt(m[1].slice(6, 8), 16) / 255) };
    m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
    if (m) return { hex: rgbToHex(+m[1], +m[2], +m[3]), alpha: m[4] !== undefined ? +m[4] : 1 };
    m = v.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)$/i);
    if (m) return { hex: hslToHex(+m[1], +m[2], +m[3]), alpha: m[4] !== undefined ? +m[4] : 1 };
    return null;
  }
  function hexToRgb(hex) {
    var m = hex.replace('#', '');
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }
  function findPaletteMatch(hex) {
    var exact = PALETTE_FLAT.filter(function (c) { return c.hex === hex; })[0];
    if (exact) return exact.hue + '-' + exact.shade;
    var rgb = hexToRgb(hex), best = null, bestDist = Infinity;
    PALETTE_FLAT.forEach(function (c) {
      var crgb = hexToRgb(c.hex);
      var d = Math.pow(rgb[0] - crgb[0], 2) + Math.pow(rgb[1] - crgb[1], 2) + Math.pow(rgb[2] - crgb[2], 2);
      if (d < bestDist) { bestDist = d; best = c; }
    });
    if (best && bestDist < 350) return best.hue + '-' + best.shade;
    return null;
  }
  function colorClass(prefix, rawValue) {
    var t = rawValue.trim();
    if (/^transparent$/i.test(t)) return prefix + 'transparent';
    if (/^currentcolor$/i.test(t)) return prefix + 'current';
    if (/^inherit$|^unset$|^initial$/i.test(t)) return null;
    if (/^var\(/i.test(t)) return arbitrary(prefix, t);
    var n = normalizeColor(t);
    if (!n) return arbitrary(prefix, t);
    if (n.hex === '#000000' && n.alpha === 1) return prefix + 'black';
    if (n.hex === '#ffffff' && n.alpha === 1) return prefix + 'white';
    var match = findPaletteMatch(n.hex);
    var base = match ? prefix + match : arbitrary(prefix, n.hex);
    if (n.alpha < 1 && match) return base + '/' + Math.round(n.alpha * 100);
    return base;
  }

  // ---------------------------------------------------------------------
  // Shorthand side expansion (margin/padding/border-radius/border-width/...)
  // ---------------------------------------------------------------------
  function expand4(tokens) {
    if (tokens.length === 1) return { top: tokens[0], right: tokens[0], bottom: tokens[0], left: tokens[0] };
    if (tokens.length === 2) return { top: tokens[0], bottom: tokens[0], right: tokens[1], left: tokens[1] };
    if (tokens.length === 3) return { top: tokens[0], right: tokens[1], left: tokens[1], bottom: tokens[2] };
    return { top: tokens[0], right: tokens[1], bottom: tokens[2], left: tokens[3] };
  }
  function borderWidthSides(value) {
    function cls(prefix, tok) {
      var px = toPx(tok);
      return px !== null ? (matchLenScale(px, BORDER_WIDTH_SCALE, prefix, false) || arbitrary(prefix, tok)) : arbitrary(prefix, tok);
    }
    var sides = expand4(splitSpaceTopLevel(value));
    if (sides.top === sides.right && sides.right === sides.bottom && sides.bottom === sides.left) return [cls('border-', sides.top)];
    if (sides.top === sides.bottom && sides.right === sides.left) return [cls('border-y-', sides.top), cls('border-x-', sides.right)];
    var out = [];
    if (sides.top) out.push(cls('border-t-', sides.top));
    if (sides.right) out.push(cls('border-r-', sides.right));
    if (sides.bottom) out.push(cls('border-b-', sides.bottom));
    if (sides.left) out.push(cls('border-l-', sides.left));
    return out;
  }
  function sidesToClasses(prefix, value, allowNegative) {
    var base = prefix.replace(/-$/, ''); // e.g. "p-" -> "p", so side letters read "py-", "pt-" not "p-y-"
    var sides = expand4(splitSpaceTopLevel(value));
    if (sides.top === sides.right && sides.right === sides.bottom && sides.bottom === sides.left) {
      return [spacingClass(prefix, sides.top, allowNegative)];
    }
    if (sides.top === sides.bottom && sides.right === sides.left) {
      return [spacingClass(base + 'y-', sides.top, allowNegative), spacingClass(base + 'x-', sides.right, allowNegative)];
    }
    var out = [];
    if (sides.top) out.push(spacingClass(base + 't-', sides.top, allowNegative));
    if (sides.right) out.push(spacingClass(base + 'r-', sides.right, allowNegative));
    if (sides.bottom) out.push(spacingClass(base + 'b-', sides.bottom, allowNegative));
    if (sides.left) out.push(spacingClass(base + 'l-', sides.left, allowNegative));
    return out;
  }

  // ---------------------------------------------------------------------
  // Keyword lookup tables
  // ---------------------------------------------------------------------
  var KW = {
    display: { block: 'block', inline: 'inline', 'inline-block': 'inline-block', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', none: 'hidden', table: 'table', 'table-row': 'table-row', 'table-cell': 'table-cell', contents: 'contents', 'list-item': 'list-item', 'flow-root': 'flow-root' },
    position: { static: 'static', relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky' },
    'flex-direction': { row: 'flex-row', 'row-reverse': 'flex-row-reverse', column: 'flex-col', 'column-reverse': 'flex-col-reverse' },
    'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
    'justify-content': { 'flex-start': 'justify-start', start: 'justify-start', 'flex-end': 'justify-end', end: 'justify-end', center: 'justify-center', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly' },
    'justify-items': { start: 'justify-items-start', end: 'justify-items-end', center: 'justify-items-center', stretch: 'justify-items-stretch' },
    'justify-self': { auto: 'justify-self-auto', start: 'justify-self-start', end: 'justify-self-end', center: 'justify-self-center', stretch: 'justify-self-stretch' },
    'align-items': { stretch: 'items-stretch', center: 'items-center', 'flex-start': 'items-start', start: 'items-start', 'flex-end': 'items-end', end: 'items-end', baseline: 'items-baseline' },
    'align-content': { center: 'content-center', 'flex-start': 'content-start', start: 'content-start', 'flex-end': 'content-end', end: 'content-end', 'space-between': 'content-between', 'space-around': 'content-around', 'space-evenly': 'content-evenly', stretch: 'content-stretch' },
    'align-self': { auto: 'self-auto', stretch: 'self-stretch', center: 'self-center', 'flex-start': 'self-start', start: 'self-start', 'flex-end': 'self-end', end: 'self-end', baseline: 'self-baseline' },
    float: { left: 'float-left', right: 'float-right', none: 'float-none' },
    clear: { left: 'clear-left', right: 'clear-right', both: 'clear-both', none: 'clear-none' },
    'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
    overflow: { visible: 'overflow-visible', hidden: 'overflow-hidden', scroll: 'overflow-scroll', auto: 'overflow-auto', clip: 'overflow-clip' },
    'overflow-x': { visible: 'overflow-x-visible', hidden: 'overflow-x-hidden', scroll: 'overflow-x-scroll', auto: 'overflow-x-auto', clip: 'overflow-x-clip' },
    'overflow-y': { visible: 'overflow-y-visible', hidden: 'overflow-y-hidden', scroll: 'overflow-y-scroll', auto: 'overflow-y-auto', clip: 'overflow-y-clip' },
    visibility: { visible: 'visible', hidden: 'invisible', collapse: 'collapse' },
    'font-style': { italic: 'italic', normal: 'not-italic', oblique: 'italic' },
    'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' },
    'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
    'text-overflow': { ellipsis: 'text-ellipsis', clip: 'text-clip' },
    'vertical-align': { baseline: 'align-baseline', top: 'align-top', middle: 'align-middle', bottom: 'align-bottom', 'text-top': 'align-text-top', 'text-bottom': 'align-text-bottom', sub: 'align-sub', super: 'align-super' },
    'white-space': { normal: 'whitespace-normal', nowrap: 'whitespace-nowrap', pre: 'whitespace-pre', 'pre-line': 'whitespace-pre-line', 'pre-wrap': 'whitespace-pre-wrap', 'break-spaces': 'whitespace-break-spaces' },
    'word-break': { normal: 'break-normal', 'break-all': 'break-all', 'keep-all': 'break-keep', 'break-word': 'break-words' },
    'overflow-wrap': { normal: 'break-normal', 'break-word': 'break-words', anywhere: 'break-words' },
    'border-style': { solid: 'border-solid', dashed: 'border-dashed', dotted: 'border-dotted', double: 'border-double', none: 'border-none', hidden: 'border-hidden' },
    cursor: { pointer: 'cursor-pointer', default: 'cursor-default', wait: 'cursor-wait', text: 'cursor-text', move: 'cursor-move', 'not-allowed': 'cursor-not-allowed', grab: 'cursor-grab', grabbing: 'cursor-grabbing', help: 'cursor-help', none: 'cursor-none', 'context-menu': 'cursor-context-menu', crosshair: 'cursor-crosshair', 'zoom-in': 'cursor-zoom-in', 'zoom-out': 'cursor-zoom-out', 'col-resize': 'cursor-col-resize', 'row-resize': 'cursor-row-resize', 'all-scroll': 'cursor-all-scroll', progress: 'cursor-progress' },
    'pointer-events': { none: 'pointer-events-none', auto: 'pointer-events-auto' },
    'user-select': { none: 'select-none', text: 'select-text', all: 'select-all', auto: 'select-auto' },
    resize: { none: 'resize-none', both: 'resize', horizontal: 'resize-x', vertical: 'resize-y' },
    'object-fit': { contain: 'object-contain', cover: 'object-cover', fill: 'object-fill', none: 'object-none', 'scale-down': 'object-scale-down' },
    'object-position': { center: 'object-center', top: 'object-top', bottom: 'object-bottom', left: 'object-left', right: 'object-right', 'left top': 'object-left-top', 'right top': 'object-right-top', 'left bottom': 'object-left-bottom', 'right bottom': 'object-right-bottom' },
    'background-size': { cover: 'bg-cover', contain: 'bg-contain', auto: 'bg-auto' },
    'background-repeat': { repeat: 'bg-repeat', 'no-repeat': 'bg-no-repeat', 'repeat-x': 'bg-repeat-x', 'repeat-y': 'bg-repeat-y', round: 'bg-repeat-round', space: 'bg-repeat-space' },
    'background-attachment': { fixed: 'bg-fixed', local: 'bg-local', scroll: 'bg-scroll' },
    'background-position': { center: 'bg-center', top: 'bg-top', bottom: 'bg-bottom', left: 'bg-left', right: 'bg-right', 'left top': 'bg-left-top', 'right top': 'bg-right-top', 'left bottom': 'bg-left-bottom', 'right bottom': 'bg-right-bottom' },
    'list-style-type': { none: 'list-none', disc: 'list-disc', decimal: 'list-decimal' },
    'list-style-position': { inside: 'list-inside', outside: 'list-outside' },
    'grid-auto-flow': { row: 'grid-flow-row', column: 'grid-flow-col', dense: 'grid-flow-dense', 'row dense': 'grid-flow-row-dense', 'column dense': 'grid-flow-col-dense' },
    'text-decoration-line': { underline: 'underline', overline: 'overline', 'line-through': 'line-through', none: 'no-underline' },
    'text-decoration-style': { solid: 'decoration-solid', double: 'decoration-double', dotted: 'decoration-dotted', dashed: 'decoration-dashed', wavy: 'decoration-wavy' },
    'aspect-ratio': { auto: 'aspect-auto', '1/1': 'aspect-square', '1 / 1': 'aspect-square', '16/9': 'aspect-video', '16 / 9': 'aspect-video' },
  };

  var PLACE_KW = { start: '-start', end: '-end', center: '-center', stretch: '-stretch', 'space-between': '-between', 'space-around': '-around', 'space-evenly': '-evenly' };

  // ---------------------------------------------------------------------
  // Declaration -> utility classes
  // ---------------------------------------------------------------------
  function convertTransformFns(value) {
    var out = [];
    var re = /([a-zA-Z]+)\(([^)]*)\)/g, m;
    while ((m = re.exec(value))) {
      var fn = m[1].toLowerCase(), args = splitTopLevel(m[2], ',');
      if (fn === 'translatex' || fn === 'translatey') {
        var axis = fn === 'translatex' ? 'x' : 'y';
        out.push(spacingClass('translate-' + axis + '-', args[0], true));
      } else if (fn === 'translate') {
        out.push(spacingClass('translate-x-', args[0], true));
        if (args[1]) out.push(spacingClass('translate-y-', args[1], true));
      } else if (fn === 'rotate') {
        var deg = parseFloat(args[0]);
        var nearest = ROTATE_SCALE.indexOf(Math.abs(deg)) !== -1 ? Math.abs(deg) : null;
        out.push(nearest !== null ? (deg < 0 ? '-' : '') + 'rotate-' + nearest : arbitrary('rotate-', args[0]));
      } else if (fn === 'scale' || fn === 'scalex' || fn === 'scaley') {
        var pct = Math.round(parseFloat(args[0]) * 100);
        var pfx = fn === 'scale' ? 'scale-' : fn === 'scalex' ? 'scale-x-' : 'scale-y-';
        out.push(SCALE_SCALE.indexOf(pct) !== -1 ? pfx + pct : arbitrary(pfx, pct + '%'));
      } else if (fn === 'skewx' || fn === 'skewy') {
        var sdeg = parseFloat(args[0]);
        var spfx = fn === 'skewx' ? 'skew-x-' : 'skew-y-';
        var sn = SKEW_SCALE.indexOf(Math.abs(sdeg)) !== -1 ? Math.abs(sdeg) : null;
        out.push(sn !== null ? (sdeg < 0 ? '-' : '') + spfx + sn : arbitrary(spfx, args[0]));
      } else {
        out.push(arbitrary('transform-', fn + '(' + args.join(',') + ')'));
      }
    }
    return out;
  }
  function convertFilterFns(value, prefix) {
    var out = [];
    if (/^none$/i.test(value.trim())) return [prefix === 'backdrop-' ? 'backdrop-filter-none' : 'filter-none'];
    var re = /([a-zA-Z-]+)\(([^)]*)\)/g, m;
    while ((m = re.exec(value))) {
      var fn = m[1].toLowerCase(), arg = m[2].trim();
      if (fn === 'blur') {
        var px = toPx(arg);
        out.push(px !== null ? (matchLenScale(px, BLUR_SCALE, prefix + 'blur-', false) || arbitrary(prefix + 'blur-', arg)) : arbitrary(prefix + 'blur-', arg));
      } else if (fn === 'brightness' || fn === 'contrast' || fn === 'saturate') {
        var pct = Math.round(parseFloat(arg) * (arg.indexOf('%') !== -1 ? 1 : 100));
        out.push(prefix + fn + '-' + pct);
      } else if (fn === 'grayscale' || fn === 'sepia' || fn === 'invert') {
        var v = arg ? Math.round(parseFloat(arg) * (arg.indexOf('%') !== -1 ? 1 : 100)) : 100;
        out.push(v >= 100 ? prefix + fn : prefix + fn + '-' + v);
      } else if (fn === 'hue-rotate') {
        var deg = Math.round(parseFloat(arg));
        out.push(prefix + 'hue-rotate-' + deg);
      } else if (fn === 'drop-shadow') {
        out.push(arbitrary(prefix + 'drop-shadow-', arg));
      } else {
        out.push(arbitrary(prefix + 'filter-', fn + '(' + arg + ')'));
      }
    }
    return out.length ? out : null;
  }

  function convertGradient(value) {
    var m = value.match(/^linear-gradient\(([^]*)\)$/i);
    if (!m) return null;
    var parts = splitTopLevel(m[1], ',');
    if (parts.length < 2 || parts.length > 3) return null;
    var dirRaw = parts[0].trim();
    var DIRS = { 'to right': 'r', 'to left': 'l', 'to top': 't', 'to bottom': 'b', 'to top right': 'tr', 'to bottom right': 'br', 'to top left': 'tl', 'to bottom left': 'bl' };
    var dir = DIRS[dirRaw.toLowerCase()];
    var stops = parts.slice(1);
    if (!dir) {
      var deg = dirRaw.match(/^(-?\d+)deg$/);
      if (deg) {
        var d = ((parseInt(deg[1], 10) % 360) + 360) % 360;
        var table = [[0, 't'], [45, 'tr'], [90, 'r'], [135, 'br'], [180, 'b'], [225, 'bl'], [270, 'l'], [315, 'tl'], [360, 't']];
        var bestKey = null, bestDiff = Infinity;
        table.forEach(function (t) { var diff = Math.abs(t[0] - d); if (diff < bestDiff) { bestDiff = diff; bestKey = t[1]; } });
        dir = bestKey;
      } else {
        stops = parts.slice(0); // no explicit direction token, default "to bottom"
        dir = 'b';
      }
    }
    var out = ['bg-gradient-to-' + dir];
    if (stops[0]) out.push(colorClass('from-', stops[0]));
    if (stops[2]) { out.push(colorClass('via-', stops[1])); out.push(colorClass('to-', stops[2])); }
    else if (stops[1]) out.push(colorClass('to-', stops[1]));
    return out;
  }

  function convertDeclaration(propRaw, valueRaw) {
    var prop = propRaw.trim().toLowerCase();
    var value = valueRaw.trim().replace(/\s*!important$/i, '');
    var warn = null;

    if (KW[prop] && KW[prop][value.toLowerCase()]) return { classes: [KW[prop][value.toLowerCase()]] };

    switch (prop) {
      case 'display': case 'position': case 'flex-direction': case 'flex-wrap': case 'justify-content':
      case 'justify-items': case 'justify-self': case 'align-items': case 'align-content': case 'align-self':
      case 'float': case 'clear': case 'box-sizing': case 'overflow': case 'overflow-x': case 'overflow-y':
      case 'visibility': case 'font-style': case 'text-align': case 'text-transform': case 'text-overflow':
      case 'vertical-align': case 'white-space': case 'word-break': case 'overflow-wrap': case 'border-style':
      case 'cursor': case 'pointer-events': case 'user-select': case 'resize': case 'object-fit':
      case 'object-position': case 'background-size': case 'background-repeat': case 'background-attachment':
      case 'background-position': case 'list-style-type': case 'list-style-position': case 'grid-auto-flow':
      case 'text-decoration-line': case 'text-decoration-style': case 'aspect-ratio':
        return { classes: [arbitrary(prop + '-', value)], warning: 'Unrecognized value for ' + prop + ' — used an arbitrary value.' };

      case 'place-items': {
        var pi = PLACE_KW[value.toLowerCase()];
        return pi ? { classes: ['place-items' + pi] } : { classes: [arbitrary('place-items-', value)] };
      }
      case 'place-content': {
        var pc = PLACE_KW[value.toLowerCase()];
        return pc ? { classes: ['place-content' + pc] } : { classes: [arbitrary('place-content-', value)] };
      }
      case 'place-self': {
        var ps = PLACE_KW[value.toLowerCase()];
        return ps ? { classes: ['place-self' + ps] } : { classes: [arbitrary('place-self-', value)] };
      }

      case 'top': case 'right': case 'bottom': case 'left':
        return { classes: [spacingClass(prop + '-', value, true)] };
      case 'inset':
        return { classes: sidesToClasses('inset-', value, true) };
      case 'z-index': {
        var zi = parseInt(value, 10);
        if (value.trim() === 'auto') return { classes: ['z-auto'] };
        return { classes: [ZINDEX_SCALE.indexOf(Math.abs(zi)) !== -1 ? (zi < 0 ? '-' : '') + 'z-' + Math.abs(zi) : arbitrary('z-', value)] };
      }
      case 'order': {
        var ov = parseInt(value, 10);
        return { classes: [(ov >= -12 && ov <= 12) ? (ov < 0 ? '-order-' + Math.abs(ov) : 'order-' + ov) : arbitrary('order-', value)] };
      }
      case 'gap': case 'row-gap': case 'column-gap': {
        var gp = prop === 'gap' ? 'gap-' : prop === 'row-gap' ? 'gap-y-' : 'gap-x-';
        var toks = splitSpaceTopLevel(value);
        if (prop === 'gap' && toks.length === 2) return { classes: [spacingClass('gap-y-', toks[0], false), spacingClass('gap-x-', toks[1], false)] };
        return { classes: [spacingClass(gp, value, false)] };
      }
      case 'flex-grow': return { classes: [/^0(\.0+)?$/.test(value) ? 'grow-0' : (value === '1' ? 'grow' : arbitrary('grow-', value))] };
      case 'flex-shrink': return { classes: [/^0(\.0+)?$/.test(value) ? 'shrink-0' : (value === '1' ? 'shrink' : arbitrary('shrink-', value))] };
      case 'flex-basis': return { classes: [widthHeightClass('basis-', value, 'w')] };
      case 'flex': {
        var fv = value.trim().replace(/\s+/g, ' ');
        var MAP = { '1 1 0%': 'flex-1', '1 1 0': 'flex-1', '1 1 auto': 'flex-auto', '0 1 auto': 'flex-initial', 'none': 'flex-none', '1': 'flex-1' };
        return { classes: [MAP[fv] || arbitrary('flex-', fv)] };
      }
      case 'grid-template-columns': {
        var gm = value.match(/^repeat\(\s*(\d+)\s*,\s*(?:minmax\(0,\s*1fr\)|1fr)\s*\)$/i);
        return { classes: [gm ? 'grid-cols-' + gm[1] : arbitrary('grid-cols-', value)] };
      }
      case 'grid-template-rows': {
        var gr = value.match(/^repeat\(\s*(\d+)\s*,\s*(?:minmax\(0,\s*1fr\)|1fr)\s*\)$/i);
        return { classes: [gr ? 'grid-rows-' + gr[1] : arbitrary('grid-rows-', value)] };
      }
      case 'grid-auto-columns': return { classes: [{ auto: 'auto-cols-auto', min: 'auto-cols-min', max: 'auto-cols-max', fr: 'auto-cols-fr' }[value.trim()] || arbitrary('auto-cols-', value)] };
      case 'grid-auto-rows': return { classes: [{ auto: 'auto-rows-auto', min: 'auto-rows-min', max: 'auto-rows-max', fr: 'auto-rows-fr' }[value.trim()] || arbitrary('auto-rows-', value)] };
      case 'grid-column': {
        var gc = value.match(/^span\s+(\d+)\s*\/\s*span\s+\d+$/i);
        return { classes: [gc ? 'col-span-' + gc[1] : (value.trim() === '1 / -1' ? 'col-span-full' : arbitrary('col-', value))] };
      }
      case 'grid-row': {
        var grw = value.match(/^span\s+(\d+)\s*\/\s*span\s+\d+$/i);
        return { classes: [grw ? 'row-span-' + grw[1] : (value.trim() === '1 / -1' ? 'row-span-full' : arbitrary('row-', value))] };
      }

      case 'width': return { classes: [widthHeightClass('w-', value, 'w')] };
      case 'min-width': return { classes: [widthHeightClass('min-w-', value, 'w')] };
      case 'max-width': return { classes: [widthHeightClass('max-w-', value, 'w')] };
      case 'height': return { classes: [widthHeightClass('h-', value, 'h')] };
      case 'min-height': return { classes: [widthHeightClass('min-h-', value, 'h')] };
      case 'max-height': return { classes: [widthHeightClass('max-h-', value, 'h')] };

      case 'margin': return { classes: sidesToClasses('m-', value, true) };
      case 'margin-top': return { classes: [spacingClass('mt-', value, true)] };
      case 'margin-right': return { classes: [spacingClass('mr-', value, true)] };
      case 'margin-bottom': return { classes: [spacingClass('mb-', value, true)] };
      case 'margin-left': return { classes: [spacingClass('ml-', value, true)] };
      case 'padding': return { classes: sidesToClasses('p-', value, false) };
      case 'padding-top': return { classes: [spacingClass('pt-', value, false)] };
      case 'padding-right': return { classes: [spacingClass('pr-', value, false)] };
      case 'padding-bottom': return { classes: [spacingClass('pb-', value, false)] };
      case 'padding-left': return { classes: [spacingClass('pl-', value, false)] };

      case 'font-size': {
        var fpx = toPx(value);
        return { classes: [fpx !== null ? (matchLenScale(fpx, FONT_SIZE_SCALE, 'text-', false) || arbitrary('text-', value)) : arbitrary('text-', value)] };
      }
      case 'font-weight': {
        var FW = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black', normal: 'normal', bold: 'bold' };
        var key = /^\d+$/.test(value) ? parseInt(value, 10) : value.toLowerCase();
        return { classes: [FW[key] ? 'font-' + FW[key] : arbitrary('font-', value)] };
      }
      case 'line-height': {
        var lpx = toPx(value);
        var num = parseFloat(value);
        if (!isNaN(num) && /^[\d.]+$/.test(value.trim())) {
          for (var li = 0; li < LEADING_NAMED.length; li++) if (Math.abs(LEADING_NAMED[li][0] - num) < 0.001) return { classes: ['leading-' + LEADING_NAMED[li][1]] };
        }
        if (lpx !== null) { var lcls = matchLenScale(lpx, SPACING_SCALE, 'leading-', false); if (lcls) return { classes: [lcls] }; }
        return { classes: [arbitrary('leading-', value)] };
      }
      case 'letter-spacing': {
        var em = value.match(/^(-?[\d.]+)em$/);
        if (em) { var ev = parseFloat(em[1]); for (var ti = 0; ti < TRACKING_SCALE.length; ti++) if (Math.abs(TRACKING_SCALE[ti][0] - ev) < 0.001) return { classes: ['tracking-' + TRACKING_SCALE[ti][1]] }; }
        return { classes: [arbitrary('tracking-', value)] };
      }
      case 'text-decoration':
        return convertDeclaration('text-decoration-line', splitSpaceTopLevel(value)[0] || value);
      case 'text-underline-offset':
        return { classes: [(function () { var px = toPx(value); return px !== null ? (matchLenScale(px, SPACING_SCALE, 'underline-offset-', false) || arbitrary('underline-offset-', value)) : arbitrary('underline-offset-', value); })()] };

      case 'color': return { classes: [colorClass('text-', value)] };
      case 'background-color': return { classes: [colorClass('bg-', value)] };
      case 'background-image': {
        var grad = convertGradient(value);
        if (grad) return { classes: grad };
        if (/^none$/i.test(value)) return { classes: ['bg-none'] };
        return { classes: [arbitrary('bg-', value)], warning: 'background-image was not a simple 2–3 stop linear-gradient — used an arbitrary value.' };
      }
      case 'text-decoration-color': return { classes: [colorClass('decoration-', value)] };
      case 'outline-color': return { classes: [colorClass('outline-', value)] };
      case 'fill': return { classes: [value.trim() === 'none' ? 'fill-none' : colorClass('fill-', value)] };
      case 'stroke': return { classes: [value.trim() === 'none' ? 'stroke-none' : colorClass('stroke-', value)] };
      case 'stroke-width': return { classes: [/^[012]$/.test(value.trim()) ? 'stroke-' + value.trim() : arbitrary('stroke-', value)] };
      case 'accent-color': return { classes: [colorClass('accent-', value)] };
      case 'caret-color': return { classes: [colorClass('caret-', value)] };

      case 'border': {
        var btoks = splitSpaceTopLevel(value);
        var out = [];
        btoks.forEach(function (tok) {
          if (/^\d/.test(tok) || tok === '0') out.push((matchLenScale(toPx(tok) || 0, BORDER_WIDTH_SCALE, 'border-', false)) || arbitrary('border-', tok));
          else if (KW['border-style'][tok.toLowerCase()]) out.push(KW['border-style'][tok.toLowerCase()]);
          else out.push(colorClass('border-', tok));
        });
        return { classes: out };
      }
      case 'border-width': return { classes: borderWidthSides(value) };
      case 'border-top-width': return { classes: [matchLenScale(toPx(value) || 0, BORDER_WIDTH_SCALE, 'border-t-', false) || arbitrary('border-t-', value)] };
      case 'border-right-width': return { classes: [matchLenScale(toPx(value) || 0, BORDER_WIDTH_SCALE, 'border-r-', false) || arbitrary('border-r-', value)] };
      case 'border-bottom-width': return { classes: [matchLenScale(toPx(value) || 0, BORDER_WIDTH_SCALE, 'border-b-', false) || arbitrary('border-b-', value)] };
      case 'border-left-width': return { classes: [matchLenScale(toPx(value) || 0, BORDER_WIDTH_SCALE, 'border-l-', false) || arbitrary('border-l-', value)] };
      case 'border-color': return { classes: [colorClass('border-', value)] };
      case 'border-top-color': return { classes: [colorClass('border-t-', value)] };
      case 'border-right-color': return { classes: [colorClass('border-r-', value)] };
      case 'border-bottom-color': return { classes: [colorClass('border-b-', value)] };
      case 'border-left-color': return { classes: [colorClass('border-l-', value)] };
      case 'border-radius': {
        var rtoks = splitSpaceTopLevel(value);
        var rsides = expand4(rtoks);
        if (rsides.top === rsides.right && rsides.right === rsides.bottom && rsides.bottom === rsides.left) {
          var rpx = toPx(rsides.top);
          return { classes: [rpx !== null ? (matchLenScale(rpx, RADIUS_SCALE, 'rounded-', false) || arbitrary('rounded-', rsides.top)) : arbitrary('rounded-', rsides.top)] };
        }
        var CORNERS = [['tl', rtoks[0]], ['tr', rtoks[1] || rtoks[0]], ['br', rtoks[2] || rtoks[0]], ['bl', rtoks[3] || rtoks[1] || rtoks[0]]];
        return { classes: CORNERS.map(function (c) { var px = toPx(c[1]); return px !== null ? (matchLenScale(px, RADIUS_SCALE, 'rounded-' + c[0] + '-', false) || arbitrary('rounded-' + c[0] + '-', c[1])) : arbitrary('rounded-' + c[0] + '-', c[1]); }) };
      }
      case 'border-top-left-radius': return { classes: [arbitrary('rounded-tl-', value)] };
      case 'border-top-right-radius': return { classes: [arbitrary('rounded-tr-', value)] };
      case 'border-bottom-right-radius': return { classes: [arbitrary('rounded-br-', value)] };
      case 'border-bottom-left-radius': return { classes: [arbitrary('rounded-bl-', value)] };

      case 'box-shadow': {
        var SHADOW_MAP = {
          '0 1px 2px 0 rgba(0, 0, 0, 0.05)': 'shadow-sm',
          '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)': 'shadow',
          '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)': 'shadow-md',
          '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)': 'shadow-lg',
          '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)': 'shadow-xl',
          'none': 'shadow-none',
        };
        var norm = value.replace(/\s+/g, ' ').trim();
        return { classes: [SHADOW_MAP[norm] || arbitrary('shadow-', norm)], warning: SHADOW_MAP[norm] ? undefined : 'box-shadow did not match a default Tailwind shadow — used an arbitrary value.' };
      }
      case 'opacity': {
        var raw = value.trim();
        var num2 = raw.indexOf('%') !== -1 ? parseFloat(raw) : parseFloat(raw) * 100;
        var rounded = Math.round(num2 / 5) * 5;
        return { classes: [OPACITY_SCALE.indexOf(rounded) !== -1 ? 'opacity-' + rounded : arbitrary('opacity-', Math.round(num2) + '%')] };
      }
      case 'outline': {
        if (/^none$/i.test(value.trim()) || value.trim() === '0') return { classes: ['outline-none'] };
        var otoks = splitSpaceTopLevel(value), oc = [];
        otoks.forEach(function (t) {
          if (/^\d/.test(t)) oc.push('outline-' + (toPx(t) || 0));
          else if (/^(solid|dashed|dotted|double)$/i.test(t)) oc.push(t.toLowerCase() === 'solid' ? 'outline' : 'outline-' + t.toLowerCase());
          else oc.push(colorClass('outline-', t));
        });
        return { classes: oc };
      }
      case 'outline-offset': return { classes: [(function () { var px = toPx(value); return px !== null ? 'outline-offset-' + px : arbitrary('outline-offset-', value); })()] };

      case 'transform': return { classes: /^none$/i.test(value.trim()) ? ['transform-none'] : (convertTransformFns(value).length ? convertTransformFns(value) : [arbitrary('transform-', value)]) };
      case 'transform-origin': return { classes: [{ center: 'origin-center', top: 'origin-top', 'top right': 'origin-top-right', right: 'origin-right', 'bottom right': 'origin-bottom-right', bottom: 'origin-bottom', 'bottom left': 'origin-bottom-left', left: 'origin-left', 'top left': 'origin-top-left' }[value.trim().toLowerCase()] || arbitrary('origin-', value)] };

      case 'transition': return { classes: ['transition'], warning: 'transition shorthand simplified to the default "transition" utility — review duration/easing.' };
      case 'transition-property': {
        var tp = value.trim().toLowerCase();
        var TPMAP = { all: 'transition-all', none: 'transition-none', opacity: 'transition-opacity', transform: 'transition-transform', 'box-shadow': 'transition-shadow', color: 'transition-colors' };
        if (TPMAP[tp]) return { classes: [TPMAP[tp]] };
        if (/color|background|border/.test(tp)) return { classes: ['transition-colors'] };
        return { classes: ['transition'] };
      }
      case 'transition-duration': {
        var ms = value.trim().match(/^([\d.]+)s$/) ? parseFloat(value) * 1000 : parseFloat(value);
        return { classes: [DURATION_SCALE.indexOf(ms) !== -1 ? 'duration-' + ms : arbitrary('duration-', Math.round(ms) + 'ms')] };
      }
      case 'transition-delay': {
        var dms = value.trim().match(/^([\d.]+)s$/) ? parseFloat(value) * 1000 : parseFloat(value);
        return { classes: [DURATION_SCALE.indexOf(dms) !== -1 ? 'delay-' + dms : arbitrary('delay-', Math.round(dms) + 'ms')] };
      }
      case 'transition-timing-function': {
        var EASE = { linear: 'ease-linear', 'ease-in': 'ease-in', 'ease-out': 'ease-out', 'ease-in-out': 'ease-in-out' };
        return { classes: [EASE[value.trim().toLowerCase()] || arbitrary('ease-', value)] };
      }
      case 'animation': {
        var av = value.trim().toLowerCase();
        if (/^none$/.test(av)) return { classes: ['animate-none'] };
        if (av.indexOf('spin') !== -1) return { classes: ['animate-spin'] };
        if (av.indexOf('ping') !== -1) return { classes: ['animate-ping'] };
        if (av.indexOf('pulse') !== -1) return { classes: ['animate-pulse'] };
        if (av.indexOf('bounce') !== -1) return { classes: ['animate-bounce'] };
        return { classes: [arbitrary('animate-', value)], warning: 'Custom @keyframes animation — add it to tailwind.config and reference via animate-[name].' };
      }

      case 'filter': { var fc = convertFilterFns(value, ''); return { classes: fc || [arbitrary('filter-', value)] }; }
      case 'backdrop-filter': { var bc = convertFilterFns(value, 'backdrop-'); return { classes: bc || [arbitrary('backdrop-filter-', value)] }; }

      case 'gap-x': return { classes: [spacingClass('gap-x-', value, false)] };
      case 'gap-y': return { classes: [spacingClass('gap-y-', value, false)] };

      default:
        return null; // unmapped property -> caller falls back to arbitrary property syntax
    }
  }

  // ---------------------------------------------------------------------
  // Parser
  // ---------------------------------------------------------------------
  function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

  function parseCSS(cssRaw) {
    var css = stripComments(cssRaw);
    var i = 0, n = css.length;
    var errors = [];
    function skipWs() { while (i < n && /\s/.test(css[i])) i++; }
    function parseBlockContent() {
      var items = [];
      skipWs();
      while (i < n && css[i] !== '}') {
        if (css[i] === '@') items.push(parseAtRule());
        else { var r = parseRule(); if (r) items.push(r); }
        skipWs();
      }
      return items;
    }
    function parseAtRule() {
      var j = i;
      while (j < n && css[j] !== '{' && css[j] !== ';') j++;
      var header = css.slice(i, j).trim();
      if (j >= n) { i = j; errors.push('Unterminated at-rule: ' + header); return { type: 'at-simple', header: header }; }
      if (css[j] === ';') { i = j + 1; return { type: 'at-simple', header: header }; }
      i = j + 1;
      var body = parseBlockContent();
      skipWs();
      if (css[i] === '}') i++; else errors.push('Unterminated block for ' + header);
      return { type: 'at-rule', header: header, body: body };
    }
    function parseRule() {
      var j = i;
      while (j < n && css[j] !== '{' && css[j] !== '}') j++;
      if (j >= n) { errors.push('Unexpected end of input while reading a selector.'); i = j; return null; }
      if (css[j] === '}') { errors.push('Unexpected "}" — extra closing brace.'); i = j + 1; return null; }
      var selector = css.slice(i, j).trim();
      i = j + 1;
      var k = i, depth = 1;
      while (k < n && depth > 0) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; if (depth > 0) k++; }
      if (depth > 0) errors.push('Unterminated rule for selector "' + selector + '".');
      var body = css.slice(i, k);
      i = k + 1;
      return { type: 'rule', selector: selector, declarations: parseDeclarations(body) };
    }
    function parseDeclarations(body) {
      var decls = [], seen = {};
      splitTopLevel(body, ';').forEach(function (p) {
        var t = p.trim();
        if (!t) return;
        var idx = t.indexOf(':');
        if (idx < 0) { decls.push({ raw: t, invalid: true }); return; }
        var prop = t.slice(0, idx).trim();
        var val = t.slice(idx + 1).trim();
        if (!prop || !val) { decls.push({ raw: t, invalid: true }); return; }
        decls.push({ property: prop, value: val, duplicate: !!seen[prop.toLowerCase()] });
        seen[prop.toLowerCase()] = true;
      });
      return decls;
    }
    var top = parseBlockContent();
    if (i < n) errors.push('Unexpected "}" near position ' + i + '.');
    return { nodes: top, errors: errors };
  }

  // ---------------------------------------------------------------------
  // Selector / variant resolution
  // ---------------------------------------------------------------------
  var PSEUDO_CLASS_MAP = {
    hover: 'hover', focus: 'focus', 'focus-visible': 'focus-visible', 'focus-within': 'focus-within',
    active: 'active', disabled: 'disabled', enabled: 'enabled', checked: 'checked', 'first-child': 'first',
    'last-child': 'last', 'only-child': 'only', 'first-of-type': 'first-of-type', 'last-of-type': 'last-of-type',
    required: 'required', optional: 'optional', 'read-only': 'read-only', 'read-write': 'read-write',
    visited: 'visited', target: 'target', empty: 'empty', 'placeholder-shown': 'placeholder-shown', 'in-range': 'in-range', 'out-of-range': 'out-of-range',
  };
  var PSEUDO_ELEMENT_MAP = { before: 'before', after: 'after', placeholder: 'placeholder', selection: 'selection', marker: 'marker', 'first-line': 'first-line', 'first-letter': 'first-letter' };

  function parseSelectorVariants(selectorIn) {
    var base = selectorIn.trim();
    var variants = [];
    var dark = false;

    var darkMatch = base.match(/^(\.dark|\[data-theme=["']?dark["']?\])\s+(.+)$/i);
    if (darkMatch) { dark = true; base = darkMatch[2].trim(); }

    var groupMatch = base.match(/^\.group:([a-z-]+)\s+(.+)$/i);
    if (groupMatch) { variants.push('group-' + groupMatch[1]); base = groupMatch[2].trim(); }
    var peerMatch = base.match(/^\.peer:([a-z-]+)\s*~\s*(.+)$/i);
    if (peerMatch) { variants.push('peer-' + peerMatch[1]); base = peerMatch[2].trim(); }

    if (/[\s>+~]/.test(base)) return { unsupported: selectorIn, dark: dark, variants: [], base: base };

    var element = null;
    var elMatch = base.match(/::?(before|after|placeholder|selection|marker|first-line|first-letter)$/i);
    if (elMatch) { element = PSEUDO_ELEMENT_MAP[elMatch[1].toLowerCase()]; base = base.slice(0, elMatch.index); }

    var guard = 0, unsupportedPseudo = null;
    while (guard++ < 6) {
      var pcMatch = base.match(/:([a-z-]+)(\([^)]*\))?$/i);
      if (!pcMatch) break;
      var key = pcMatch[1].toLowerCase();
      if (key === 'nth-child' || key === 'nth-of-type' || key === 'not') { unsupportedPseudo = pcMatch[0]; base = base.slice(0, pcMatch.index); break; }
      if (PSEUDO_CLASS_MAP[key]) { variants.push(PSEUDO_CLASS_MAP[key]); base = base.slice(0, pcMatch.index); }
      else { unsupportedPseudo = pcMatch[0]; base = base.slice(0, pcMatch.index); break; }
    }
    if (element) variants.push(element);
    if (unsupportedPseudo) return { unsupported: selectorIn, dark: dark, variants: variants, base: base || '&' };
    return { variants: variants, dark: dark, base: base || '&' };
  }

  function resolveMedia(params) {
    if (/prefers-color-scheme\s*:\s*dark/i.test(params)) return { dark: true };
    var min = params.match(/min-width\s*:\s*([\d.]+)(px|rem|em)/i);
    if (min) {
      var px = min[2].toLowerCase() === 'px' ? parseFloat(min[1]) : parseFloat(min[1]) * 16;
      for (var i = 0; i < BREAKPOINTS.length; i++) if (Math.abs(BREAKPOINTS[i][0] - px) < 1) return { variant: BREAKPOINTS[i][1] };
      return { variant: 'min-[' + Math.round(px) + 'px]' };
    }
    var max = params.match(/max-width\s*:\s*([\d.]+)(px|rem|em)/i);
    if (max) {
      var mpx = max[2].toLowerCase() === 'px' ? parseFloat(max[1]) : parseFloat(max[1]) * 16;
      for (var j = 0; j < BREAKPOINTS.length; j++) if (Math.abs(BREAKPOINTS[j][0] - (mpx + 1)) < 2 || Math.abs(BREAKPOINTS[j][0] - mpx) < 2) return { variant: 'max-' + BREAKPOINTS[j][1] };
      return { variant: 'max-[' + Math.round(mpx) + 'px]' };
    }
    return { unsupported: params };
  }

  function flattenNodes(nodes, ctx, out) {
    nodes.forEach(function (node) {
      if (!node) return;
      if (node.type === 'rule') {
        out.push({ selector: node.selector, declarations: node.declarations, ctx: ctx });
      } else if (node.type === 'at-rule') {
        var mediaMatch = node.header.match(/^@media\s*([\s\S]*)$/i);
        var newCtx = ctx;
        if (mediaMatch) {
          var resolved = resolveMedia(mediaMatch[1]);
          newCtx = {
            variant: (ctx.variant ? ctx.variant + ':' : '') + (resolved.variant ? resolved.variant + ':' : ''),
            dark: ctx.dark || !!resolved.dark,
            unsupportedAt: ctx.unsupportedAt || (resolved.unsupported ? node.header : null),
          };
        } else {
          newCtx = { variant: ctx.variant, dark: ctx.dark, unsupportedAt: node.header };
        }
        flattenNodes(node.body, newCtx, out);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Stylesheet -> blocks
  // ---------------------------------------------------------------------
  function sortClasses(classes) {
    function rank(cls) {
      var bare = cls.replace(/^-/, '').split(':').pop();
      for (var i = 0; i < SORT_PREFIX_ORDER.length; i++) {
        var p = SORT_PREFIX_ORDER[i];
        if (bare === p || bare.indexOf(p) === 0) return i;
      }
      return SORT_PREFIX_ORDER.length;
    }
    return classes.map(function (c, idx) { return { c: c, r: rank(c), idx: idx }; })
      .sort(function (a, b) { return a.r - b.r || a.idx - b.idx; })
      .map(function (x) { return x.c; });
  }

  function convertStylesheet(cssText, options) {
    options = options || {};
    var sortEnabled = options.sort !== false;
    var parsed = parseCSS(cssText || '');
    var flat = [];
    flattenNodes(parsed.nodes, { variant: '', dark: false, unsupportedAt: null }, flat);

    var blocks = [];
    var warnings = parsed.errors.map(function (e) { return { type: 'parse', message: e }; });
    var cssVars = [];
    var stats = { rules: 0, classes: 0, arbitrary: 0, unsupportedSelectors: 0 };

    flat.forEach(function (item) {
      var selectors = splitTopLevel(item.selector, ',');
      selectors.forEach(function (rawSel) {
        stats.rules++;
        if (item.ctx.unsupportedAt) {
          warnings.push({ type: 'at-rule', message: '"' + item.ctx.unsupportedAt + '" is not converted automatically — declarations shown without a responsive/state prefix.' });
        }
        var sv = parseSelectorVariants(rawSel);
        if (sv.unsupported) {
          stats.unsupportedSelectors++;
          warnings.push({ type: 'selector', message: 'Selector "' + rawSel.trim() + '" is too complex to auto-map to a Tailwind variant — utilities are shown unprefixed.' });
        }
        var variantPrefix = (item.ctx.variant || '') + (item.ctx.dark || sv.dark ? 'dark:' : '') + sv.variants.map(function (v) { return v + ':'; }).join('');

        var propMap = {}, order = [];
        item.declarations.forEach(function (d) {
          if (d.invalid) { warnings.push({ type: 'declaration', message: 'Could not parse declaration: "' + d.raw + '".' }); return; }
          var key = d.property.toLowerCase();
          if (key.indexOf('--') === 0) { cssVars.push({ name: d.property, value: d.value }); return; }
          if (d.duplicate) warnings.push({ type: 'duplicate', message: 'Property "' + d.property + '" is declared more than once in "' + rawSel.trim() + '" — using the last value.' });
          if (order.indexOf(key) === -1) order.push(key);
          propMap[key] = d;
        });

        var classes = [];
        order.forEach(function (key) {
          var d = propMap[key];
          var res = convertDeclaration(d.property, d.value);
          if (res === null) {
            classes.push(variantPrefix + arbitraryProperty(d.property, d.value));
            stats.arbitrary++;
            warnings.push({ type: 'unsupported-property', message: '"' + d.property + '" has no direct Tailwind utility — used an arbitrary property.' });
            return;
          }
          if (res.warning) warnings.push({ type: 'mapping', message: res.warning });
          res.classes.forEach(function (c) {
            if (!c) return;
            if (c.indexOf('[') !== -1) stats.arbitrary++;
            classes.push(variantPrefix + c);
          });
        });

        classes = classes.filter(function (c, idx) { return classes.indexOf(c) === idx; });
        if (sortEnabled) classes = sortClasses(classes);
        stats.classes += classes.length;

        blocks.push({ selector: rawSel.trim(), fullContext: (item.ctx.variant || '') + (item.ctx.dark ? '(dark) ' : ''), classes: classes });
      });
    });

    return { blocks: blocks, warnings: warnings, cssVars: cssVars, stats: stats };
  }

  // ---------------------------------------------------------------------
  // Export rendering
  // ---------------------------------------------------------------------
  var EXPORT_MODES = [
    { id: 'plain', label: 'Tailwind classes' },
    { id: 'html', label: 'HTML' },
    { id: 'jsx', label: 'JSX' },
    { id: 'tsx', label: 'TSX' },
    { id: 'vue', label: 'Vue' },
    { id: 'svelte', label: 'Svelte' },
    { id: 'angular', label: 'Angular' },
    { id: 'blade', label: 'Blade' },
    { id: 'astro', label: 'Astro' },
  ];
  function renderExport(blocks, mode) {
    if (!blocks || !blocks.length) return '';
    if (mode === 'plain') {
      return blocks.map(function (b) { return '/* ' + b.selector + ' */\n' + (b.classes.join(' ') || '(no utilities generated)'); }).join('\n\n');
    }
    var attr = (mode === 'jsx' || mode === 'tsx') ? 'className' : 'class';
    function cmt(text) {
      if (mode === 'jsx' || mode === 'tsx') return '{/* ' + text + ' */}';
      if (mode === 'blade') return '{{-- ' + text + ' --}}';
      return '<!-- ' + text + ' -->';
    }
    return blocks.map(function (b) {
      return cmt(b.selector) + '\n<div ' + attr + '="' + b.classes.join(' ') + '"></div>';
    }).join('\n\n');
  }

  var CTW_ENGINE = {
    parseCSS: parseCSS,
    convertDeclaration: convertDeclaration,
    convertStylesheet: convertStylesheet,
    renderExport: renderExport,
    sortClasses: sortClasses,
    EXPORT_MODES: EXPORT_MODES,
    _internals: {
      toPx: toPx, spacingClass: spacingClass, widthHeightClass: widthHeightClass, colorClass: colorClass,
      normalizeColor: normalizeColor, findPaletteMatch: findPaletteMatch, parseSelectorVariants: parseSelectorVariants,
      resolveMedia: resolveMedia, PALETTE_FLAT: PALETTE_FLAT,
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CTW_ENGINE;
  if (typeof window !== 'undefined') window.CTW_ENGINE = CTW_ENGINE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
