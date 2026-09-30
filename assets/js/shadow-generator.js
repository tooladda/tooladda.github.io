/* ============================================================
   ToolAdda — CSS Box Shadow Generator

   WHAT WAS WRONG BEFORE
   ---------------------
   The old build had one slider labelled "Offset" and emitted it
   twice:

       `${offset}px ${offset}px ${blur}px ${spread}px rgba(...)`

   so offset-x and offset-y could never differ. Every shadow the tool
   could produce was a 45-degree diagonal, and the single most common
   shadow in real CSS — `0 10px 30px rgba(0,0,0,.15)`, straight down —
   was unreachable. The slider also started at 0, so negative offsets
   (shadow above or to the left) were impossible too.

   It also always printed four lengths, including `0px` for an unused
   spread, and there was a "Generate" button that did nothing: the
   preview was already live, so the click only fired a toast.

   THE MODEL
   ---------
   One authoritative state object holds an ordered list of layers:

       { x, y, blur, spread, color, opacity, inset }

   `generateBoxShadow(layers)` is the only place a shadow string is
   built. The preview, the code panel, the copy buttons, the download
   and the share link all read from it, so none of them can drift
   apart from what is on screen.

   CSS order matters: the first layer in the list paints on top. The
   list order is preserved exactly through every operation.

   FORMATTING
   ----------
   Zero lengths print as a bare `0` — `0 10px 30px` rather than
   `0px 10px 30px 0px` — because that is what CSS authors write. A
   spread of 0 is dropped entirely. At full opacity the colour is
   emitted as hex; below that it becomes rgba(). Both are valid CSS
   and neither can produce a malformed value: every number is clamped
   and every colour is parsed defensively before it reaches a string.
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. Limits

     Wide enough not to get in a professional's way, bounded enough
     that the UI cannot be driven into nonsense.
     ============================================================ */

  var LIMITS = {
    x: { min: -100, max: 100 },
    y: { min: -100, max: 100 },
    blur: { min: 0, max: 200 },
    spread: { min: -100, max: 100 },
    opacity: { min: 0, max: 1 }
  };

  var MAX_LAYERS = 12;
  var DEFAULT_COLOR = '#000000';

  var DEFAULT_LAYER = {
    x: 0, y: 10, blur: 30, spread: 0,
    color: DEFAULT_COLOR, opacity: 0.15, inset: false
  };

  /* ============================================================
     2. Numeric + colour helpers
     ============================================================ */

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /* Anything that is not a finite number becomes the fallback, so no
     NaN can ever reach the output string. */
  function num(value, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(n) ? n : (fallback || 0);
  }

  function round(n, dp) {
    var f = Math.pow(10, dp || 0);
    return Math.round(n * f) / f;
  }

  function normaliseHex(hex) {
    var raw = String(hex === undefined || hex === null ? '' : hex).trim().replace(/^#/, '');

    /* #abc and #aabbcc are the two forms a colour input can hand back.
       Anything else is treated as absent rather than half-parsed. */
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
      raw = raw.split('').map(function (c) { return c + c; }).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return DEFAULT_COLOR;
    return '#' + raw.toLowerCase();
  }

  function hexToRgb(hex) {
    var clean = normaliseHex(hex).slice(1);
    var int = parseInt(clean, 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255
    };
  }

  function rgbToHex(r, g, b) {
    function part(n) {
      var v = clamp(Math.round(num(n, 0)), 0, 255).toString(16);
      return v.length === 1 ? '0' + v : v;
    }
    return '#' + part(r) + part(g) + part(b);
  }

  /* Alpha as CSS writes it: at most three decimals, no trailing
     zeros, and `.15` rather than `0.15` in compact mode. */
  function formatAlpha(alpha, compact) {
    var a = round(clamp(num(alpha, 0), 0, 1), 3);
    var text = String(a);
    if (compact && text.indexOf('0.') === 0) text = text.slice(1);
    return text;
  }

  /* A fully opaque shadow does not need rgba(), and hex is shorter
     and easier to paste into a design token. */
  function formatColor(hex, opacity, options) {
    options = options || {};
    var compact = options.format === 'compact';
    var alpha = clamp(num(opacity, 1), 0, 1);
    var normalised = normaliseHex(hex);

    if (alpha >= 1 && !options.forceRgba) return normalised;

    var rgb = hexToRgb(normalised);
    var sep = compact ? ',' : ', ';
    return 'rgba(' + rgb.r + sep + rgb.g + sep + rgb.b + sep + formatAlpha(alpha, compact) + ')';
  }

  /* CSS lengths: a bare `0` is idiomatic and shorter, and a unit on
     zero is noise. Everything else keeps px. */
  function formatLength(value) {
    var n = round(num(value, 0), 2);
    if (n === 0) return '0';
    return n + 'px';
  }

  /* ============================================================
     3. Layers
     ============================================================ */

  function normaliseLayer(layer) {
    layer = layer || {};
    return {
      x: clamp(round(num(layer.x, DEFAULT_LAYER.x), 2), LIMITS.x.min, LIMITS.x.max),
      y: clamp(round(num(layer.y, DEFAULT_LAYER.y), 2), LIMITS.y.min, LIMITS.y.max),
      blur: clamp(round(num(layer.blur, DEFAULT_LAYER.blur), 2), LIMITS.blur.min, LIMITS.blur.max),
      spread: clamp(round(num(layer.spread, DEFAULT_LAYER.spread), 2), LIMITS.spread.min, LIMITS.spread.max),
      color: normaliseHex(layer.color === undefined ? DEFAULT_LAYER.color : layer.color),
      opacity: clamp(round(num(layer.opacity, DEFAULT_LAYER.opacity), 3), LIMITS.opacity.min, LIMITS.opacity.max),
      inset: layer.inset === true
    };
  }

  function createLayer(overrides) {
    return normaliseLayer(Object.assign({}, DEFAULT_LAYER, overrides || {}));
  }

  /* One layer as a CSS shadow value.

     `inset` must lead. Spread is omitted when it is zero, which is
     legal — CSS reads the lengths positionally and a missing fourth
     length means no spread. */
  function layerToCss(layer, options) {
    var l = normaliseLayer(layer);
    var parts = [];

    if (l.inset) parts.push('inset');
    parts.push(formatLength(l.x));
    parts.push(formatLength(l.y));
    parts.push(formatLength(l.blur));
    if (l.spread !== 0) parts.push(formatLength(l.spread));
    parts.push(formatColor(l.color, l.opacity, options));

    return parts.join(' ');
  }

  /* The whole box-shadow value. An empty list is `none`, never an
     empty string, because `box-shadow: ;` does not parse. */
  function generateBoxShadow(layers, options) {
    options = options || {};
    var list = Array.isArray(layers) ? layers : [];
    if (!list.length) return 'none';

    var values = list.slice(0, MAX_LAYERS).map(function (l) { return layerToCss(l, options); });

    if (values.length === 1) return values[0];
    if (options.format === 'compact') return values.join(',');

    /* Multi-layer shadows are read down the page, so give each its
       own line under the declaration. */
    return values.join(',\n    ');
  }

  function generateDeclaration(layers, options) {
    return 'box-shadow: ' + generateBoxShadow(layers, options) + ';';
  }

  /* The full rule as it would be pasted into a stylesheet. In
     variable mode the shadow is lifted into a custom property, which
     is how design systems actually store it. */
  function generateCss(layers, options) {
    options = options || {};
    var selector = options.selector || '.box';
    var value = generateBoxShadow(layers, options);

    if (options.cssVariable) {
      var name = sanitiseVarName(options.variableName || '--shadow-card');
      return ':root {\n  ' + name + ': ' + value + ';\n}\n\n' +
        selector + ' {\n  box-shadow: var(' + name + ');\n}';
    }
    return selector + ' {\n  box-shadow: ' + value + ';\n}';
  }

  /* A custom property name has to start with -- and cannot carry
     whitespace or braces, or the generated rule would not parse. */
  function sanitiseVarName(name) {
    var raw = String(name || '').trim().replace(/^-+/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!raw) raw = 'shadow-card';
    return '--' + raw;
  }

  /* ============================================================
     4. Presets

     Every preset is real: the values below are what the controls
     load, and the swatch in the gallery is painted with the same
     generated string. Nothing here is a picture of a shadow the tool
     cannot reproduce.
     ============================================================ */

  var PRESETS = [
    {
      id: 'subtle', name: 'Subtle', hint: 'Barely-there separation',
      layers: [{ x: 0, y: 1, blur: 2, spread: 0, color: '#000000', opacity: 0.05 }]
    },
    {
      id: 'soft', name: 'Soft', hint: 'Gentle, diffuse',
      layers: [{ x: 0, y: 10, blur: 30, spread: 0, color: '#000000', opacity: 0.15 }]
    },
    {
      id: 'card', name: 'Card', hint: 'Standard content card',
      layers: [
        { x: 0, y: 1, blur: 3, spread: 0, color: '#000000', opacity: 0.1 },
        { x: 0, y: 8, blur: 24, spread: -4, color: '#000000', opacity: 0.12 }
      ]
    },
    {
      id: 'floating', name: 'Floating', hint: 'Lifted off the page',
      layers: [
        { x: 0, y: 18, blur: 40, spread: -12, color: '#0f172a', opacity: 0.25 },
        { x: 0, y: 4, blur: 10, spread: -4, color: '#0f172a', opacity: 0.15 }
      ]
    },
    {
      id: 'material', name: 'Material', hint: 'Three-layer elevation',
      layers: [
        { x: 0, y: 3, blur: 1, spread: -2, color: '#000000', opacity: 0.2 },
        { x: 0, y: 2, blur: 2, spread: 0, color: '#000000', opacity: 0.14 },
        { x: 0, y: 1, blur: 5, spread: 0, color: '#000000', opacity: 0.12 }
      ]
    },
    {
      id: 'hard', name: 'Hard', hint: 'No blur, brutalist',
      layers: [{ x: 6, y: 6, blur: 0, spread: 0, color: '#111827', opacity: 1 }]
    },
    {
      id: 'button', name: 'Button', hint: 'Small press-ready lift',
      layers: [
        { x: 0, y: 1, blur: 2, spread: 0, color: '#000000', opacity: 0.15 },
        { x: 0, y: 4, blur: 8, spread: -2, color: '#000000', opacity: 0.12 }
      ]
    },
    {
      id: 'inner', name: 'Inner', hint: 'Recessed well',
      layers: [{ x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.18, inset: true }]
    },
    {
      id: 'neumorphism', name: 'Neumorphism', hint: 'Light above, dark below',
      layers: [
        { x: -8, y: -8, blur: 16, spread: 0, color: '#ffffff', opacity: 0.9 },
        { x: 8, y: 8, blur: 16, spread: 0, color: '#9aa5b1', opacity: 0.6 }
      ]
    },
    {
      id: 'glass', name: 'Glass', hint: 'Frosted edge + drop',
      layers: [
        { x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff', opacity: 0.35, inset: true },
        { x: 0, y: 12, blur: 32, spread: -8, color: '#0f172a', opacity: 0.3 }
      ]
    },
    {
      id: 'long', name: 'Long Shadow', hint: 'Stepped diagonal trail',
      layers: [
        { x: 4, y: 4, blur: 0, spread: 0, color: '#334155', opacity: 0.6 },
        { x: 8, y: 8, blur: 0, spread: 0, color: '#334155', opacity: 0.45 },
        { x: 12, y: 12, blur: 0, spread: 0, color: '#334155', opacity: 0.3 },
        { x: 16, y: 16, blur: 0, spread: 0, color: '#334155', opacity: 0.15 }
      ]
    },
    {
      id: 'dark-ui', name: 'Dark UI', hint: 'Reads on a dark surface',
      layers: [
        { x: 0, y: 0, blur: 0, spread: 1, color: '#ffffff', opacity: 0.08, inset: true },
        { x: 0, y: 16, blur: 32, spread: -8, color: '#000000', opacity: 0.6 }
      ]
    },
    {
      id: 'minimal', name: 'Minimal', hint: 'Hairline edge only',
      layers: [{ x: 0, y: 0, blur: 0, spread: 1, color: '#0f172a', opacity: 0.08 }]
    }
  ];

  function getPreset(id) {
    var found = PRESETS.filter(function (p) { return p.id === id; })[0];
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      hint: found.hint,
      layers: found.layers.map(function (l) { return createLayer(l); })
    };
  }

  /* ============================================================
     5. Randomise

     Constrained on purpose. A uniform random over the full slider
     ranges produces 180px blurs at 97% opacity, which is not a
     shadow anyone would ship. These bounds stay inside the region
     that looks like real UI work.
     ============================================================ */

  function randomLayer(rng) {
    var rand = typeof rng === 'function' ? rng : Math.random;
    function between(min, max) { return Math.round(min + rand() * (max - min)); }

    var y = between(2, 24);
    return createLayer({
      x: between(-6, 6),
      y: y,
      /* Blur tracks the drop distance — a large offset with no blur
         reads as a mistake rather than a style. */
      blur: between(y, y * 3 + 8),
      spread: between(-8, 2),
      color: '#000000',
      opacity: round(0.06 + rand() * 0.22, 2),
      inset: false
    });
  }

  /* ============================================================
     6. Share links

     Compact, human-readable, and carrying nothing but shadow
     geometry — there is no user content in a box-shadow.
     ============================================================ */

  /* `~` separates layers and `_` separates fields. Neither can appear
     inside an encoded value — a dot would, because opacity and the
     lengths are decimals, and splitting on it silently truncated
     every layer at its first fractional value. Both characters are
     unreserved in RFC 3986, so nothing here needs escaping. */
  function encodeLayers(layers) {
    return (Array.isArray(layers) ? layers : []).slice(0, MAX_LAYERS).map(function (raw) {
      var l = normaliseLayer(raw);
      return [
        l.x, l.y, l.blur, l.spread,
        l.color.slice(1),
        l.opacity,
        l.inset ? 1 : 0
      ].join('_');
    }).join('~');
  }

  function decodeLayers(text) {
    if (!text) return [];
    return String(text).split('~').map(function (chunk) {
      var p = chunk.split('_');
      if (p.length < 6) return null;
      return normaliseLayer({
        x: parseFloat(p[0]), y: parseFloat(p[1]),
        blur: parseFloat(p[2]), spread: parseFloat(p[3]),
        color: '#' + p[4], opacity: parseFloat(p[5]),
        inset: p[6] === '1'
      });
    }).filter(Boolean).slice(0, MAX_LAYERS);
  }

  /* ============================================================
     7. Export
     ============================================================ */

  var engine = {
    LIMITS: LIMITS,
    MAX_LAYERS: MAX_LAYERS,
    DEFAULT_LAYER: DEFAULT_LAYER,
    PRESETS: PRESETS,

    clamp: clamp,
    num: num,
    round: round,
    normaliseHex: normaliseHex,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    formatAlpha: formatAlpha,
    formatColor: formatColor,
    formatLength: formatLength,

    normaliseLayer: normaliseLayer,
    createLayer: createLayer,
    layerToCss: layerToCss,
    generateBoxShadow: generateBoxShadow,
    generateDeclaration: generateDeclaration,
    generateCss: generateCss,
    sanitiseVarName: sanitiseVarName,

    getPreset: getPreset,
    randomLayer: randomLayer,
    encodeLayers: encodeLayers,
    decodeLayers: decodeLayers
  };

  globalScope.ToolAddaShadow = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     8. UI state
     ============================================================ */

  var PREFS_KEY = 'tooladda-shadow-prefs';

  var PREVIEW_DEFAULTS = {
    background: 'checker',
    boxColor: '#ffffff',
    radius: 16,
    width: 220,
    height: 140
  };

  var state = {
    layers: [createLayer()],
    active: 0,
    format: 'readable',
    cssVariable: false,
    variableName: '--shadow-card',
    preview: Object.assign({}, PREVIEW_DEFAULTS)
  };

  var dom = {};
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function activeLayer() {
    if (!state.layers.length) state.layers = [createLayer()];
    state.active = clamp(state.active, 0, state.layers.length - 1);
    return state.layers[state.active];
  }

  function options() {
    return { format: state.format };
  }

  /* ============================================================
     9. DOM cache
     ============================================================ */

  function cacheDom() {
    dom.root = q('[data-sg-root]');
    if (!dom.root) return false;

    dom.stage = q('[data-sg-stage]', dom.root);
    dom.box = q('[data-sg-box]', dom.root);

    dom.controls = q('[data-sg-controls]', dom.root);
    dom.layerList = q('[data-sg-layers]', dom.root);
    dom.addLayer = q('[data-sg-add-layer]', dom.root);
    dom.layerCount = q('[data-sg-layer-count]', dom.root);

    dom.color = q('#sgColor', dom.root);
    dom.hex = q('#sgHex', dom.root);
    dom.inset = q('#sgInset', dom.root);

    dom.presets = q('[data-sg-presets]', dom.root);

    dom.code = q('[data-sg-code]', dom.root);
    dom.copyCss = q('[data-sg-copy-css]', dom.root);
    dom.copyProperty = q('[data-sg-copy-property]', dom.root);
    dom.copyValue = q('[data-sg-copy-value]', dom.root);
    dom.download = q('[data-sg-download]', dom.root);
    dom.share = q('[data-sg-share]', dom.root);
    dom.reset = q('[data-sg-reset]', dom.root);
    dom.random = q('[data-sg-random]', dom.root);

    dom.formatButtons = qa('[data-sg-format]', dom.root);
    dom.varToggle = q('#sgVarMode', dom.root);
    dom.varName = q('#sgVarName', dom.root);
    dom.varNameRow = q('[data-sg-var-row]', dom.root);

    dom.bgButtons = qa('[data-sg-bg]', dom.root);
    dom.boxColor = q('#sgBoxColor', dom.root);
    dom.radius = q('#sgRadius', dom.root);
    dom.radiusOut = q('[data-sg-radius-out]', dom.root);
    dom.boxWidth = q('#sgBoxWidth', dom.root);
    dom.boxHeight = q('#sgBoxHeight', dom.root);
    dom.radiusChips = q('[data-sg-radius-presets]', dom.root);

    dom.announce = q('[data-sg-announce]', dom.root);

    return true;
  }

  /* ============================================================
     10. Preferences
     ============================================================ */

  function loadState() {
    /* A shared link always wins over whatever this browser last had
       open, otherwise following someone's link would silently show
       your own shadow. */
    var fromUrl = readShareLink();
    if (fromUrl.length) {
      state.layers = fromUrl;
      return;
    }
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (Array.isArray(saved.layers) && saved.layers.length) {
        state.layers = saved.layers.slice(0, MAX_LAYERS).map(normaliseLayer);
      }
      if (saved.format === 'compact' || saved.format === 'readable') state.format = saved.format;
      if (typeof saved.cssVariable === 'boolean') state.cssVariable = saved.cssVariable;
      if (saved.variableName) state.variableName = sanitiseVarName(saved.variableName);
      if (saved.preview) state.preview = Object.assign({}, PREVIEW_DEFAULTS, saved.preview);
    } catch (e) { /* corrupt or unavailable storage is not fatal */ }
  }

  function saveState() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        layers: state.layers,
        format: state.format,
        cssVariable: state.cssVariable,
        variableName: state.variableName,
        preview: state.preview
      }));
    } catch (e) { /* private mode */ }
  }

  function readShareLink() {
    try {
      var hash = String(window.location.hash || '').replace(/^#/, '');
      if (!hash) return [];
      var params = new URLSearchParams(hash);
      return decodeLayers(params.get('s'));
    } catch (e) { return []; }
  }

  function shareUrl() {
    var base = window.location.origin + window.location.pathname;
    return base + '#s=' + encodeLayers(state.layers);
  }

  /* ============================================================
     11. Announcements
     ============================================================ */

  function announce(message) {
    if (!dom.announce) return;
    dom.announce.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.announce.textContent = message; }, 60);
  }

  function flash(btn, label) {
    if (!btn) return;
    var original = btn.getAttribute('data-sg-label') || btn.textContent;
    btn.setAttribute('data-sg-label', original);
    btn.textContent = label;
    setTimeout(function () { btn.textContent = original; }, 1500);
  }

  /* ============================================================
     12. Rendering
     ============================================================ */

  var NUMERIC_FIELDS = [
    { key: 'x', label: 'X offset', unit: 'px', hint: 'Negative moves left' },
    { key: 'y', label: 'Y offset', unit: 'px', hint: 'Negative moves up' },
    { key: 'blur', label: 'Blur', unit: 'px', hint: 'Higher is softer' },
    { key: 'spread', label: 'Spread', unit: 'px', hint: 'Negative shrinks' }
  ];

  function renderControls() {
    if (!dom.controls) return;
    var l = activeLayer();

    dom.controls.innerHTML = NUMERIC_FIELDS.map(function (f) {
      var lim = LIMITS[f.key];
      var id = 'sg-' + f.key;
      return '<div class="sg-control">' +
        '<div class="sg-control__head">' +
          '<label class="sg-control__label" for="' + id + '-num">' + esc(f.label) + '</label>' +
          '<div class="sg-control__value">' +
            '<input class="sg-num" id="' + id + '-num" type="number" inputmode="numeric" ' +
              'value="' + l[f.key] + '" min="' + lim.min + '" max="' + lim.max + '" step="1" ' +
              'data-sg-field="' + f.key + '" aria-describedby="' + id + '-hint" />' +
            '<span class="sg-unit" aria-hidden="true">' + f.unit + '</span>' +
          '</div>' +
        '</div>' +
        '<input class="sg-range" id="' + id + '-range" type="range" ' +
          'min="' + lim.min + '" max="' + lim.max + '" step="1" value="' + l[f.key] + '" ' +
          'data-sg-field="' + f.key + '" aria-label="' + esc(f.label) + ' slider" />' +
        '<p class="sg-control__hint" id="' + id + '-hint">' + esc(f.hint) + '</p>' +
        '</div>';
    }).join('');

    /* Opacity lives on the same layer but reads as a percentage. */
    var pct = Math.round(l.opacity * 100);
    dom.controls.insertAdjacentHTML('beforeend',
      '<div class="sg-control">' +
        '<div class="sg-control__head">' +
          '<label class="sg-control__label" for="sg-opacity-num">Opacity</label>' +
          '<div class="sg-control__value">' +
            '<input class="sg-num" id="sg-opacity-num" type="number" inputmode="numeric" ' +
              'value="' + pct + '" min="0" max="100" step="1" data-sg-field="opacity" />' +
            '<span class="sg-unit" aria-hidden="true">%</span>' +
          '</div>' +
        '</div>' +
        '<input class="sg-range" id="sg-opacity-range" type="range" min="0" max="100" step="1" ' +
          'value="' + pct + '" data-sg-field="opacity" aria-label="Opacity slider" />' +
        '<p class="sg-control__hint">100% emits hex instead of rgba()</p>' +
      '</div>');

    if (dom.color) dom.color.value = l.color;
    if (dom.hex) dom.hex.value = l.color;
    if (dom.inset) dom.inset.checked = l.inset;
  }

  function layerSwatch(layer) {
    return 'box-shadow:' + layerToCss(layer, { format: 'compact' });
  }

  function renderLayers() {
    if (!dom.layerList) return;

    dom.layerList.innerHTML = state.layers.map(function (layer, i) {
      var isActive = i === state.active;
      return '<li class="sg-layer' + (isActive ? ' is-active' : '') + '">' +
        '<button type="button" class="sg-layer__select" data-sg-select="' + i + '" ' +
          'aria-pressed="' + (isActive ? 'true' : 'false') + '">' +
          '<span class="sg-layer__chip" aria-hidden="true"><span style="' + layerSwatch(layer) + '"></span></span>' +
          '<span class="sg-layer__meta">' +
            '<span class="sg-layer__name">Shadow ' + (i + 1) + (layer.inset ? ' · inset' : '') + '</span>' +
            '<code class="sg-layer__css">' + esc(layerToCss(layer, { format: 'compact' })) + '</code>' +
          '</span>' +
        '</button>' +
        '<span class="sg-layer__tools">' +
          '<button type="button" class="sg-icon" data-sg-move="' + i + '" data-sg-dir="-1" ' +
            'aria-label="Move shadow ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="sg-icon" data-sg-move="' + i + '" data-sg-dir="1" ' +
            'aria-label="Move shadow ' + (i + 1) + ' down"' + (i === state.layers.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" class="sg-icon" data-sg-duplicate="' + i + '" ' +
            'aria-label="Duplicate shadow ' + (i + 1) + '">⧉</button>' +
          '<button type="button" class="sg-icon sg-icon--danger" data-sg-delete="' + i + '" ' +
            'aria-label="Delete shadow ' + (i + 1) + '"' + (state.layers.length === 1 ? ' disabled' : '') + '>✕</button>' +
        '</span>' +
        '</li>';
    }).join('');

    if (dom.layerCount) {
      dom.layerCount.textContent = state.layers.length + ' of ' + MAX_LAYERS;
    }
    if (dom.addLayer) {
      dom.addLayer.disabled = state.layers.length >= MAX_LAYERS;
    }
  }

  function renderPresets() {
    if (!dom.presets) return;
    dom.presets.innerHTML = PRESETS.map(function (p) {
      var css = generateBoxShadow(p.layers, { format: 'compact' });
      return '<button type="button" class="sg-preset" data-sg-preset="' + p.id + '">' +
        '<span class="sg-preset__demo" aria-hidden="true"><span style="box-shadow:' + css + '"></span></span>' +
        '<span class="sg-preset__name">' + esc(p.name) + '</span>' +
        '<span class="sg-preset__hint">' + esc(p.hint) + '</span>' +
        '</button>';
    }).join('');
  }

  function renderPreview() {
    if (!dom.box || !dom.stage) return;
    var p = state.preview;

    dom.box.style.boxShadow = generateBoxShadow(state.layers, { format: 'readable' });
    dom.box.style.background = p.boxColor;
    dom.box.style.borderRadius = p.radius + 'px';
    dom.box.style.width = p.width + 'px';
    dom.box.style.height = p.height + 'px';

    dom.stage.setAttribute('data-bg', p.background);

    if (dom.radiusOut) dom.radiusOut.textContent = p.radius + 'px';
    if (dom.boxColor) dom.boxColor.value = p.boxColor;
    if (dom.radius) dom.radius.value = p.radius;
    if (dom.boxWidth) dom.boxWidth.value = p.width;
    if (dom.boxHeight) dom.boxHeight.value = p.height;

    dom.bgButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-sg-bg') === p.background;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* Tokenised highlighting. Small hand-rolled pass rather than a
     syntax-highlighting dependency: the grammar here is four token
     types and the input is our own generated string. */
  /* Single pass over the source text.

     Chained .replace() calls cannot be used here: the second pass
     would scan the markup the first one injected, so the `var` inside
     `class="tok-var"` got wrapped again and the emitted HTML broke.
     Matching once and escaping each slice as it is consumed means our
     own tags are never re-examined. */
  var TOKEN_RE = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})|(--[a-zA-Z0-9_-]+)|\b(box-shadow|inset|var|none)\b|(-?\d*\.?\d+px)/g;

  function highlight(css) {
    var out = '';
    var last = 0;
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(css)) !== null) {
      out += esc(css.slice(last, m.index));
      var cls = m[1] ? 'tok-color' : m[2] ? 'tok-var' : m[3] ? 'tok-prop' : 'tok-num';
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(css.slice(last));
  }

  function renderCode() {
    if (!dom.code) return;
    dom.code.innerHTML = highlight(currentCss());
    dom.formatButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-sg-format') === state.format;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (dom.varToggle) dom.varToggle.checked = state.cssVariable;
    if (dom.varNameRow) dom.varNameRow.hidden = !state.cssVariable;
    if (dom.varName && document.activeElement !== dom.varName) dom.varName.value = state.variableName;
  }

  function currentCss() {
    return generateCss(state.layers, {
      format: state.format,
      cssVariable: state.cssVariable,
      variableName: state.variableName
    });
  }

  function render() {
    renderControls();
    renderLayers();
    renderPreview();
    renderCode();
    saveState();
  }

  /* ============================================================
     13. Mutations
     ============================================================ */

  function setField(key, rawValue) {
    var l = activeLayer();
    if (key === 'opacity') {
      l.opacity = clamp(num(rawValue, 0) / 100, 0, 1);
    } else {
      var lim = LIMITS[key];
      if (!lim) return;
      l[key] = clamp(num(rawValue, 0), lim.min, lim.max);
    }
    state.layers[state.active] = normaliseLayer(l);
  }

  function addLayer() {
    if (state.layers.length >= MAX_LAYERS) return;
    state.layers.push(createLayer({ y: 4, blur: 12, opacity: 0.1 }));
    state.active = state.layers.length - 1;
    render();
    announce('Shadow ' + state.layers.length + ' added.');
  }

  function duplicateLayer(i) {
    if (state.layers.length >= MAX_LAYERS) return;
    var copy = normaliseLayer(state.layers[i]);
    state.layers.splice(i + 1, 0, copy);
    state.active = i + 1;
    render();
    announce('Shadow ' + (i + 1) + ' duplicated.');
  }

  function deleteLayer(i) {
    if (state.layers.length <= 1) return;
    state.layers.splice(i, 1);
    state.active = clamp(state.active, 0, state.layers.length - 1);
    render();
    announce('Shadow ' + (i + 1) + ' deleted. ' + state.layers.length + ' remaining.');
  }

  /* Order is the whole point of a multi-layer shadow — the first
     entry paints on top — so moving a layer must move it in the
     generated string too, not just in the list UI. */
  function moveLayer(i, dir) {
    var target = i + dir;
    if (target < 0 || target >= state.layers.length) return;
    var moved = state.layers.splice(i, 1)[0];
    state.layers.splice(target, 0, moved);
    state.active = target;
    render();
    announce('Shadow moved to position ' + (target + 1) + '.');
  }

  function applyPreset(id) {
    var preset = getPreset(id);
    if (!preset) return;
    state.layers = preset.layers;
    state.active = 0;
    render();
    announce(preset.name + ' preset applied. ' + preset.layers.length +
      (preset.layers.length === 1 ? ' layer.' : ' layers.'));
  }

  function randomise() {
    var count = Math.random() < 0.35 ? 2 : 1;
    state.layers = [];
    for (var i = 0; i < count; i += 1) state.layers.push(randomLayer());
    state.active = 0;
    render();
    announce('Random shadow generated.');
  }

  function resetAll() {
    state.layers = [createLayer()];
    state.active = 0;
    state.format = 'readable';
    state.cssVariable = false;
    state.variableName = '--shadow-card';
    state.preview = Object.assign({}, PREVIEW_DEFAULTS);
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
    render();
    announce('Reset to the default shadow.');
  }

  /* ============================================================
     14. Clipboard + download
     ============================================================ */

  function copy(text, btn, what) {
    function ok() { announce(what + ' copied to clipboard.'); flash(btn, 'Copied!'); }
    function fail() { announce('Could not copy. Select the code and copy manually.'); flash(btn, 'Copy failed'); }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fail);
      return;
    }
    /* Older Safari and any non-secure context land here. */
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var worked = document.execCommand('copy');
      document.body.removeChild(ta);
      if (worked) ok(); else fail();
    } catch (e) { fail(); }
  }

  function downloadCss() {
    var blob = new Blob([currentCss() + '\n'], { type: 'text/css' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'box-shadow.css';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    announce('box-shadow.css downloaded.');
  }

  /* ============================================================
     15. Events
     ============================================================ */

  function bindEvents() {
    /* Controls are re-rendered on every change, so they are handled
       by delegation rather than by rebinding each input. */
    dom.controls.addEventListener('input', function (e) {
      var field = e.target.getAttribute && e.target.getAttribute('data-sg-field');
      if (!field) return;
      setField(field, e.target.value);

      /* Keep the paired slider and number box in step without a full
         re-render, which would steal focus mid-drag. */
      var partner = qa('[data-sg-field="' + field + '"]', dom.controls)
        .filter(function (el) { return el !== e.target; })[0];
      if (partner) partner.value = e.target.value;

      renderPreview();
      renderCode();
      renderLayers();
      saveState();
    });

    /* Clamp only once the user leaves the box, so typing "-" or "10"
       on the way to "100" is not fought mid-keystroke. */
    dom.controls.addEventListener('change', function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-sg-field')) render();
    });

    if (dom.color) {
      dom.color.addEventListener('input', function () {
        activeLayer().color = normaliseHex(dom.color.value);
        if (dom.hex) dom.hex.value = activeLayer().color;
        renderPreview(); renderCode(); renderLayers(); saveState();
      });
    }

    if (dom.hex) {
      dom.hex.addEventListener('input', function () {
        var raw = dom.hex.value.trim();
        /* Only commit once it is a complete colour, or every
           keystroke would snap the picker back to black. */
        if (!/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return;
        activeLayer().color = normaliseHex(raw);
        if (dom.color) dom.color.value = activeLayer().color;
        renderPreview(); renderCode(); renderLayers(); saveState();
      });
      dom.hex.addEventListener('blur', function () { render(); });
    }

    if (dom.inset) {
      dom.inset.addEventListener('change', function () {
        activeLayer().inset = dom.inset.checked;
        render();
        announce(dom.inset.checked ? 'Inset on — shadow moves inside the box.' : 'Inset off.');
      });
    }

    if (dom.addLayer) dom.addLayer.addEventListener('click', addLayer);

    dom.layerList.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-sg-select],[data-sg-move],[data-sg-duplicate],[data-sg-delete]') : null;
      if (!el) return;
      if (el.hasAttribute('data-sg-select')) {
        state.active = parseInt(el.getAttribute('data-sg-select'), 10) || 0;
        render();
      } else if (el.hasAttribute('data-sg-move')) {
        moveLayer(parseInt(el.getAttribute('data-sg-move'), 10) || 0,
          parseInt(el.getAttribute('data-sg-dir'), 10) || 1);
      } else if (el.hasAttribute('data-sg-duplicate')) {
        duplicateLayer(parseInt(el.getAttribute('data-sg-duplicate'), 10) || 0);
      } else if (el.hasAttribute('data-sg-delete')) {
        deleteLayer(parseInt(el.getAttribute('data-sg-delete'), 10) || 0);
      }
    });

    if (dom.presets) {
      dom.presets.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-sg-preset]') : null;
        if (el) applyPreset(el.getAttribute('data-sg-preset'));
      });
    }

    dom.formatButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.format = btn.getAttribute('data-sg-format') === 'compact' ? 'compact' : 'readable';
        renderCode(); saveState();
      });
    });

    if (dom.varToggle) {
      dom.varToggle.addEventListener('change', function () {
        state.cssVariable = dom.varToggle.checked;
        renderCode(); saveState();
      });
    }
    if (dom.varName) {
      dom.varName.addEventListener('input', function () {
        state.variableName = sanitiseVarName(dom.varName.value);
        renderCode(); saveState();
      });
    }

    dom.bgButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.preview.background = btn.getAttribute('data-sg-bg');
        renderPreview(); saveState();
      });
    });

    if (dom.boxColor) {
      dom.boxColor.addEventListener('input', function () {
        state.preview.boxColor = normaliseHex(dom.boxColor.value);
        renderPreview(); saveState();
      });
    }
    if (dom.radius) {
      dom.radius.addEventListener('input', function () {
        state.preview.radius = clamp(num(dom.radius.value, 16), 0, 200);
        renderPreview(); saveState();
      });
    }
    if (dom.radiusChips) {
      dom.radiusChips.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-sg-radius]') : null;
        if (!el) return;
        state.preview.radius = clamp(num(el.getAttribute('data-sg-radius'), 16), 0, 200);
        renderPreview(); saveState();
      });
    }
    if (dom.boxWidth) {
      dom.boxWidth.addEventListener('input', function () {
        state.preview.width = clamp(num(dom.boxWidth.value, 220), 40, 420);
        renderPreview(); saveState();
      });
    }
    if (dom.boxHeight) {
      dom.boxHeight.addEventListener('input', function () {
        state.preview.height = clamp(num(dom.boxHeight.value, 140), 40, 320);
        renderPreview(); saveState();
      });
    }

    if (dom.copyCss) dom.copyCss.addEventListener('click', function () { copy(currentCss(), dom.copyCss, 'CSS rule'); });
    if (dom.copyProperty) {
      dom.copyProperty.addEventListener('click', function () {
        copy(generateDeclaration(state.layers, options()), dom.copyProperty, 'Declaration');
      });
    }
    if (dom.copyValue) {
      dom.copyValue.addEventListener('click', function () {
        copy(generateBoxShadow(state.layers, options()), dom.copyValue, 'Value');
      });
    }
    if (dom.download) dom.download.addEventListener('click', downloadCss);
    if (dom.share) {
      dom.share.addEventListener('click', function () {
        var url = shareUrl();
        try { window.history.replaceState(null, '', url); } catch (e) { /* ignore */ }
        copy(url, dom.share, 'Share link');
      });
    }
    if (dom.reset) dom.reset.addEventListener('click', resetAll);
    if (dom.random) dom.random.addEventListener('click', randomise);
  }

  /* ============================================================
     16. Init
     ============================================================ */

  function init() {
    if (!cacheDom()) return;
    loadState();
    renderPresets();
    bindEvents();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
