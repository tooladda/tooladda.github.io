/* ==========================================================================
   ToolAdda — Neumorphism Engine

   Pure, dependency-free logic behind the CSS Neumorphic Element Designer.

   Neumorphism is a narrow effect with an exact recipe: the element is the
   SAME colour as the surface behind it, and depth comes only from a pair of
   shadows — one lighter than the surface, one darker — thrown from a single
   light source. Get the surface colour wrong and the effect disappears
   entirely, which is why the surface is part of the state rather than a
   preview decoration.

   The same two renderers as the other builders walk one component tree, so
   the live preview and the copied HTML cannot drift apart. Every user value
   is sanitised: colours must be hex, numbers are clamped, fonts come from an
   allow-list and all text is escaped on the way into markup.

   This engine also measures contrast honestly. Neumorphism's well-known
   weakness is that same-colour surfaces leave very little contrast for text
   and borders, so `audit()` reports the real WCAG ratios rather than
   pretending the problem does not exist.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Sanitisers
     ====================================================================== */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHex(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return fallback || '#e0e5ec';
  }

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) n = typeof fallback === 'number' ? fallback : lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  /* Strip C0/C1 control characters, keeping tab and newline, and cap the length.
     Written as a scan rather than a regex so this file holds no control bytes. */
  function safeText(value, maxLength) {
    var s = String(value === null || value === undefined ? '' : value);
    var limit = maxLength || 120;
    var out = '';
    for (var i = 0; i < s.length && out.length < limit; i++) {
      var code = s.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10) continue;
      if (code >= 127 && code <= 159) continue;
      out += s.charAt(i);
    }
    return out;
  }

  function round(n, places) {
    var f = Math.pow(10, places || 0);
    return Math.round(n * f) / f;
  }

  /* ======================================================================
     2. Colour maths — the heart of the effect
     ====================================================================== */

  function toRgb(hex) {
    var h = safeHex(hex, '#e0e5ec').slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function toHex(rgb) {
    return '#' + rgb.map(function (v) {
      var c = Math.round(clampNum(v, 0, 255, 0)).toString(16);
      return c.length === 1 ? '0' + c : c;
    }).join('');
  }

  /**
   * Shadow tint — scales each channel by (100 ± percent)%.
   *
   * This is the convention every neumorphism generator uses, and it is what
   * makes the familiar pair fall out: #e0e5ec at 15% gives #bec3c9 / #ffffff.
   * Interpolating towards white instead would give a far weaker highlight and
   * the effect would not read as the style people expect.
   */
  function tint(hex, percent) {
    var p = (100 + clampNum(percent, -100, 100, 0)) / 100;
    return toHex(toRgb(hex).map(function (v) { return v * p; }));
  }

  /**
   * Mix towards white (positive) or black (negative). Used for text and
   * borders, where a channel scale would leave a dark surface's text almost
   * as dark as the surface itself.
   */
  function shift(hex, percent) {
    var p = clampNum(percent, -100, 100, 0) / 100;
    return toHex(toRgb(hex).map(function (v) {
      return p >= 0 ? v + (255 - v) * p : v * (1 + p);
    }));
  }

  function lighten(hex, percent) { return shift(hex, Math.abs(percent)); }
  function darken(hex, percent) { return shift(hex, -Math.abs(percent)); }

  function relativeLuminance(hex) {
    var parts = toRgb(hex).map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }

  function contrastRatio(a, b) {
    var la = relativeLuminance(a), lb = relativeLuminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return round((hi + 0.05) / (lo + 0.05), 2);
  }

  /** Pick whichever of near-black / near-white reads better on a surface. */
  function readableTextOn(hex) {
    return contrastRatio('#ffffff', hex) >= contrastRatio('#111827', hex) ? '#ffffff' : '#111827';
  }

  /* ======================================================================
     3. Constants
     ====================================================================== */

  var ELEMENTS = [
    { id: 'card', label: 'Card', className: 'neu-card' },
    { id: 'button', label: 'Button', className: 'neu-button' },
    { id: 'input', label: 'Input', className: 'neu-input' },
    { id: 'toggle', label: 'Toggle', className: 'neu-toggle' },
    { id: 'checkbox', label: 'Checkbox', className: 'neu-checkbox' },
    { id: 'circle', label: 'Circle / Avatar', className: 'neu-circle' },
    { id: 'search', label: 'Search bar', className: 'neu-search' },
    { id: 'iconbutton', label: 'Icon button', className: 'neu-iconbutton' }
  ];
  var ELEMENT_IDS = ELEMENTS.map(function (e) { return e.id; });

  function elementInfo(id) {
    for (var i = 0; i < ELEMENTS.length; i++) if (ELEMENTS[i].id === id) return ELEMENTS[i];
    return ELEMENTS[0];
  }

  /* Light source -> which corner the dark shadow falls towards. */
  var LIGHT_SOURCES = {
    'top-left': { dx: 1, dy: 1, gradient: 145 },
    'top-right': { dx: -1, dy: 1, gradient: 215 },
    'bottom-left': { dx: 1, dy: -1, gradient: 35 },
    'bottom-right': { dx: -1, dy: -1, gradient: 325 }
  };
  var LIGHT_SOURCE_IDS = Object.keys(LIGHT_SOURCES);

  var SHAPES = ['flat', 'concave', 'convex', 'pressed'];

  var FONTS = {
    system: { label: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
    grotesk: { label: 'Inter / Grotesk', stack: 'Inter, "Helvetica Neue", "Segoe UI", system-ui, sans-serif' },
    rounded: { label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif' },
    geometric: { label: 'Geometric', stack: 'Poppins, "Century Gothic", "Avenir Next", system-ui, sans-serif' },
    mono: { label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' }
  };
  var FONT_IDS = Object.keys(FONTS);

  /* Ten surfaces that actually work. Neumorphism needs a mid-tone: pure white
     leaves no room for a lighter shadow, pure black none for a darker one. */
  var SURFACE_PRESETS = {
    classic: { label: 'Classic Grey', surface: '#e0e5ec' },
    porcelain: { label: 'Porcelain', surface: '#eef0f4' },
    sand: { label: 'Sand', surface: '#e6ded3' },
    mint: { label: 'Mint', surface: '#dfe9e4' },
    lavender: { label: 'Lavender', surface: '#e6e2f1' },
    sky: { label: 'Sky', surface: '#dde6f0' },
    blush: { label: 'Blush', surface: '#f0e2e4' },
    slate: { label: 'Slate', surface: '#3a4048' },
    charcoal: { label: 'Charcoal', surface: '#2e3239' },
    midnight: { label: 'Midnight', surface: '#262b36' }
  };
  var SURFACE_PRESET_IDS = Object.keys(SURFACE_PRESETS);

  var STYLE_PRESETS = {
    'soft-classic': {
      label: 'Soft Classic',
      surface: '#e0e5ec', shape: 'flat', distance: 12, blur: 24, intensity: 15, radius: 24, lightSource: 'top-left'
    },
    'deep-relief': {
      label: 'Deep Relief',
      surface: '#e0e5ec', shape: 'flat', distance: 22, blur: 44, intensity: 20, radius: 32, lightSource: 'top-left'
    },
    'subtle-lift': {
      label: 'Subtle Lift',
      surface: '#eef0f4', shape: 'flat', distance: 6, blur: 14, intensity: 9, radius: 18, lightSource: 'top-left'
    },
    'pressed-in': {
      label: 'Pressed In',
      surface: '#e0e5ec', shape: 'pressed', distance: 10, blur: 22, intensity: 16, radius: 22, lightSource: 'top-left'
    },
    'convex-pill': {
      label: 'Convex Pill',
      surface: '#e0e5ec', shape: 'convex', distance: 14, blur: 28, intensity: 14, radius: 50, lightSource: 'top-left'
    },
    'concave-dish': {
      label: 'Concave Dish',
      surface: '#e6ded3', shape: 'concave', distance: 14, blur: 28, intensity: 14, radius: 28, lightSource: 'top-left'
    },
    'dark-relief': {
      label: 'Dark Relief',
      surface: '#2e3239', shape: 'flat', distance: 14, blur: 28, intensity: 22, radius: 24, lightSource: 'top-left'
    },
    'dark-pressed': {
      label: 'Dark Pressed',
      surface: '#262b36', shape: 'pressed', distance: 10, blur: 20, intensity: 24, radius: 20, lightSource: 'top-left'
    },
    'sharp-edge': {
      label: 'Sharp Edge',
      surface: '#e0e5ec', shape: 'flat', distance: 10, blur: 10, intensity: 18, radius: 8, lightSource: 'top-left'
    },
    'lit-from-right': {
      label: 'Lit From Right',
      surface: '#dde6f0', shape: 'convex', distance: 14, blur: 30, intensity: 14, radius: 26, lightSource: 'top-right'
    }
  };
  var STYLE_PRESET_IDS = Object.keys(STYLE_PRESETS);

  /* ======================================================================
     4. Default state
     ====================================================================== */

  function defaultState() {
    return {
      version: 1,
      element: 'card',
      mode: 'basic',
      surface: '#e0e5ec',
      surfacePreset: 'classic',
      shape: 'flat',
      lightSource: 'top-left',
      distance: 12,
      blur: 24,
      intensity: 15,
      radius: 24,
      gradientStrength: 6,
      size: { width: 320, height: 200, autoHeight: true, padding: 28 },
      border: { enabled: false, width: 1, opacity: 0.5 },
      typography: {
        font: 'system',
        size: 16,
        weight: 600,
        color: '#5a6474',
        align: 'left',
        autoColor: true
      },
      states: { hover: true, active: true },
      content: {
        title: 'Neumorphic Card',
        description: 'Soft UI built from one surface colour and two shadows.',
        buttonText: 'Press me',
        placeholder: 'Search…',
        inputLabel: 'Your email',
        inputValue: '',
        toggleLabel: 'Notifications',
        toggleOn: true,
        checkboxLabel: 'Remember me',
        checkboxOn: true,
        initials: 'AS',
        icon: '♥'
      },
      preview: { showRulers: false }
    };
  }

  /* ======================================================================
     5. Normalising
     ====================================================================== */

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};
    function sec(name) { return (s[name] && typeof s[name] === 'object') ? s[name] : {}; }

    var size = sec('size');
    var border = sec('border');
    var t = sec('typography');
    var st = sec('states');
    var c = sec('content');
    var p = sec('preview');

    var out = {
      version: 1,
      element: oneOf(s.element, ELEMENT_IDS, d.element),
      mode: oneOf(s.mode, ['basic', 'advanced'], d.mode),
      surface: safeHex(s.surface, d.surface),
      surfacePreset: oneOf(s.surfacePreset, SURFACE_PRESET_IDS.concat(['custom']), d.surfacePreset),
      shape: oneOf(s.shape, SHAPES, d.shape),
      lightSource: oneOf(s.lightSource, LIGHT_SOURCE_IDS, d.lightSource),
      distance: Math.round(clampNum(s.distance, 0, 50, d.distance)),
      blur: Math.round(clampNum(s.blur, 0, 100, d.blur)),
      intensity: Math.round(clampNum(s.intensity, 0, 50, d.intensity)),
      radius: Math.round(clampNum(s.radius, 0, 100, d.radius)),
      gradientStrength: Math.round(clampNum(s.gradientStrength, 0, 20, d.gradientStrength)),
      size: {
        width: Math.round(clampNum(size.width, 80, 800, d.size.width)),
        height: Math.round(clampNum(size.height, 40, 600, d.size.height)),
        autoHeight: size.autoHeight === undefined ? d.size.autoHeight : !!size.autoHeight,
        padding: Math.round(clampNum(size.padding, 0, 80, d.size.padding))
      },
      border: {
        enabled: border.enabled === undefined ? d.border.enabled : !!border.enabled,
        width: clampNum(border.width, 0, 6, d.border.width),
        opacity: clampNum(border.opacity, 0, 1, d.border.opacity)
      },
      typography: {
        font: oneOf(t.font, FONT_IDS, d.typography.font),
        size: clampNum(t.size, 10, 40, d.typography.size),
        weight: Math.round(clampNum(t.weight, 100, 900, d.typography.weight) / 100) * 100,
        color: safeHex(t.color, d.typography.color),
        align: oneOf(t.align, ['left', 'center', 'right'], d.typography.align),
        autoColor: t.autoColor === undefined ? d.typography.autoColor : !!t.autoColor
      },
      states: {
        hover: st.hover === undefined ? d.states.hover : !!st.hover,
        active: st.active === undefined ? d.states.active : !!st.active
      },
      content: {},
      preview: {
        showRulers: p.showRulers === undefined ? d.preview.showRulers : !!p.showRulers
      }
    };

    var LONG = { description: 300 };
    Object.keys(d.content).forEach(function (key) {
      var def = d.content[key];
      if (typeof def === 'boolean') out.content[key] = c[key] === undefined ? def : !!c[key];
      else out.content[key] = c[key] === undefined ? def : safeText(c[key], LONG[key] || 90);
    });

    return out;
  }

  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

  /* ======================================================================
     6. Derived values
     ====================================================================== */

  function shadowColors(state) {
    return {
      dark: tint(state.surface, -state.intensity),
      light: tint(state.surface, state.intensity)
    };
  }

  /**
   * The signature two-shadow pair. `inset` is what makes an element look
   * pressed into the surface rather than raised out of it.
   */
  function boxShadowValue(state, forcePressed) {
    var src = LIGHT_SOURCES[state.lightSource] || LIGHT_SOURCES['top-left'];
    var colors = shadowColors(state);
    var d = state.distance;
    var b = state.blur;
    var pressed = forcePressed === undefined ? state.shape === 'pressed' : forcePressed;

    if (d === 0 && b === 0) return 'none';
    var prefix = pressed ? 'inset ' : '';
    return prefix + (d * src.dx) + 'px ' + (d * src.dy) + 'px ' + b + 'px ' + colors.dark + ', ' +
      prefix + (-d * src.dx) + 'px ' + (-d * src.dy) + 'px ' + b + 'px ' + colors.light;
  }

  /** Concave and convex tilt the surface itself with a subtle gradient. */
  function backgroundValue(state) {
    if (state.shape !== 'concave' && state.shape !== 'convex') return state.surface;
    var src = LIGHT_SOURCES[state.lightSource] || LIGHT_SOURCES['top-left'];
    var g = state.gradientStrength;
    var a = lighten(state.surface, g);
    var b = darken(state.surface, g);
    // convex bulges towards the light, concave dips away from it
    return state.shape === 'convex'
      ? 'linear-gradient(' + src.gradient + 'deg, ' + a + ', ' + b + ')'
      : 'linear-gradient(' + src.gradient + 'deg, ' + b + ', ' + a + ')';
  }

  function borderValue(state) {
    if (!state.border.enabled || state.border.width <= 0) return 'none';
    var edge = lighten(state.surface, 40);
    var rgb = toRgb(edge);
    return round(state.border.width, 2) + 'px solid rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' +
      round(state.border.opacity, 2) + ')';
  }

  function textColor(state) {
    if (!state.typography.autoColor) return state.typography.color;
    // A muted tone taken from the surface reads as "soft UI" without the
    // contrast collapse of using the surface colour itself.
    return relativeLuminance(state.surface) > 0.4
      ? darken(state.surface, 62)
      : lighten(state.surface, 72);
  }

  function fontStack(state) {
    return (FONTS[state.typography.font] || FONTS.system).stack;
  }

  /* ======================================================================
     7. Accessibility audit — honest about neumorphism's weak point
     ====================================================================== */

  function audit(state) {
    var text = textColor(state);
    var colors = shadowColors(state);
    var textRatio = contrastRatio(text, state.surface);
    var edgeRatio = contrastRatio(colors.dark, state.surface);

    var notes = [];

    if (textRatio < 4.5) {
      notes.push({
        level: textRatio < 3 ? 'fail' : 'warn',
        text: 'Text contrast is ' + textRatio + ':1 against the surface. WCAG AA needs 4.5:1 for body text (3:1 for text 24px+ or bold 19px+).'
      });
    } else {
      notes.push({ level: 'pass', text: 'Text contrast is ' + textRatio + ':1 — meets WCAG AA for body text.' });
    }

    if (state.intensity < 8) {
      notes.push({
        level: 'warn',
        text: 'Shadow intensity ' + state.intensity + '% gives an edge contrast of only ' + edgeRatio +
          ':1, so the element boundary may be invisible to low-vision users.'
      });
    }

    if (state.shape === 'pressed' && !state.border.enabled) {
      notes.push({
        level: 'info',
        text: 'A pressed element and a raised one differ only by shadow direction. Pair it with a label or an icon so the state is not conveyed by depth alone.'
      });
    }

    if (state.element === 'button' || state.element === 'iconbutton' || state.element === 'toggle') {
      notes.push({
        level: 'info',
        text: 'Interactive neumorphic controls have no visible border by default. The generated CSS includes a :focus-visible outline — keep it.'
      });
    }

    var lum = relativeLuminance(state.surface);
    if (lum > 0.88) {
      notes.push({ level: 'warn', text: 'The surface is very light, so the lighter shadow has almost nowhere to go. Try a mid-tone around #e0e5ec.' });
    } else if (lum < 0.05) {
      notes.push({ level: 'warn', text: 'The surface is very dark, so the darker shadow has almost nowhere to go. Try lifting it towards #2e3239.' });
    }

    return {
      textRatio: textRatio,
      edgeRatio: edgeRatio,
      passesAA: textRatio >= 4.5,
      passesAALarge: textRatio >= 3,
      passesAAA: textRatio >= 7,
      notes: notes
    };
  }

  /* ======================================================================
     8. Component tree
     ====================================================================== */

  function node(tag, className, children, attrs, text) {
    return {
      tag: tag,
      className: className || '',
      attrs: attrs || {},
      text: text === undefined ? null : text,
      children: children || []
    };
  }

  function buildTree(state) {
    var c = state.content;

    switch (state.element) {
      case 'button':
        return node('button', 'neu-button', [], { type: 'button' }, c.buttonText);

      case 'input':
        return node('div', 'neu-field', [
          node('label', 'neu-field__label', [], { for: 'neu-input' }, c.inputLabel),
          node('input', 'neu-input', [], { id: 'neu-input', type: 'text', placeholder: c.placeholder, value: c.inputValue })
        ]);

      case 'search':
        return node('div', 'neu-search', [
          node('span', 'neu-search__icon', [], { 'aria-hidden': 'true' }, '⌕'),
          node('input', 'neu-search__input', [], { type: 'search', placeholder: c.placeholder, 'aria-label': 'Search' })
        ]);

      case 'toggle':
        return node('label', 'neu-toggle', [
          node('input', 'neu-toggle__input', [], {
            type: 'checkbox', role: 'switch', checked: c.toggleOn ? 'checked' : null
          }),
          node('span', 'neu-toggle__track', [node('span', 'neu-toggle__thumb', [], { 'aria-hidden': 'true' })]),
          node('span', 'neu-toggle__label', [], {}, c.toggleLabel)
        ]);

      case 'checkbox':
        return node('label', 'neu-checkbox', [
          node('input', 'neu-checkbox__input', [], { type: 'checkbox', checked: c.checkboxOn ? 'checked' : null }),
          node('span', 'neu-checkbox__box', [], { 'aria-hidden': 'true' }),
          node('span', 'neu-checkbox__label', [], {}, c.checkboxLabel)
        ]);

      case 'circle':
        return node('div', 'neu-circle', [], {}, c.initials);

      case 'iconbutton':
        return node('button', 'neu-iconbutton', [], { type: 'button', 'aria-label': c.buttonText }, c.icon);

      default:
        return node('div', 'neu-card', [
          node('h2', 'neu-card__title', [], {}, c.title),
          node('p', 'neu-card__text', [], {}, c.description),
          node('button', 'neu-button', [], { type: 'button' }, c.buttonText)
        ]);
    }
  }

  var VOID_TAGS = { img: 1, input: 1, br: 1, hr: 1, source: 1 };

  function renderToString(tree, indentLevel) {
    var pad = new Array((indentLevel || 0) + 1).join('  ');
    var attrs = '';
    if (tree.className) attrs += ' class="' + escapeHtml(tree.className) + '"';
    Object.keys(tree.attrs).forEach(function (key) {
      var value = tree.attrs[key];
      if (value === null || value === undefined) return;
      if (value === '' && (key === 'value' || key === 'placeholder')) return;
      if (key === 'checked') { attrs += ' checked'; return; }
      attrs += ' ' + key + '="' + escapeHtml(value) + '"';
    });

    if (VOID_TAGS[tree.tag]) return pad + '<' + tree.tag + attrs + ' />';

    var open = pad + '<' + tree.tag + attrs + '>';
    var close = '</' + tree.tag + '>';
    if (tree.text !== null && !tree.children.length) return open + escapeHtml(tree.text) + close;
    if (!tree.children.length) return open + close;

    var inner = tree.children.map(function (child) {
      return renderToString(child, (indentLevel || 0) + 1);
    }).join('\n');
    return open + '\n' + inner + '\n' + pad + close;
  }

  function renderToDOM(tree, doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return null;
    var element = d.createElement(tree.tag);
    if (tree.className) element.className = tree.className;

    Object.keys(tree.attrs).forEach(function (key) {
      var value = tree.attrs[key];
      if (value === null || value === undefined || value === '') return;
      if (key === 'for') { element.htmlFor = value; return; }
      if (key === 'value') { element.value = value; return; }
      if (key === 'checked') { element.checked = true; return; }
      element.setAttribute(key, value);
    });

    // textContent only — user copy is never parsed as markup.
    if (tree.text !== null && !tree.children.length) element.textContent = tree.text;
    tree.children.forEach(function (child) {
      var kid = renderToDOM(child, d);
      if (kid) element.appendChild(kid);
    });
    return element;
  }

  /* ======================================================================
     9. CSS rules
     ====================================================================== */

  function rule(sel, decls) { return { sel: sel, decls: decls.filter(Boolean) }; }

  function surfaceVars(state) {
    var colors = shadowColors(state);
    return [
      ['--neu-surface', state.surface],
      ['--neu-light', colors.light],
      ['--neu-dark', colors.dark],
      ['--neu-radius', state.radius + 'px'],
      ['--neu-distance', state.distance + 'px'],
      ['--neu-blur', state.blur + 'px'],
      ['--neu-shadow', boxShadowValue(state)],
      ['--neu-shadow-pressed', boxShadowValue(state, true)],
      ['--neu-text', textColor(state)]
    ];
  }

  function surfaceDecls(state) {
    return [
      ['background', backgroundValue(state)],
      ['border-radius', 'var(--neu-radius)'],
      ['box-shadow', 'var(--neu-shadow)'],
      state.border.enabled ? ['border', borderValue(state)] : null,
      ['color', 'var(--neu-text)']
    ];
  }

  function typeDecls(state) {
    var t = state.typography;
    return [
      ['font-family', fontStack(state)],
      ['font-size', round(t.size, 1) + 'px'],
      ['font-weight', String(t.weight)],
      ['text-align', t.align]
    ];
  }

  function interactionRules(state, selector) {
    var out = [];
    if (state.states.hover) {
      out.push(rule(selector + ':hover', [
        ['box-shadow', boxShadowValue({
          surface: state.surface, intensity: Math.min(50, state.intensity + 3),
          distance: Math.max(0, state.distance - 2), blur: Math.max(0, state.blur - 4),
          lightSource: state.lightSource, shape: state.shape
        })]
      ]));
    }
    if (state.states.active) {
      out.push(rule(selector + ':active', [['box-shadow', 'var(--neu-shadow-pressed)']]));
    }
    out.push(rule(selector + ':focus-visible', [
      ['outline', '2px solid ' + darken(state.surface, 55)],
      ['outline-offset', '3px']
    ]));
    return out;
  }

  function elementRules(state) {
    var rules = [];
    var sz = state.size;
    var t = state.typography;

    /* The surface itself is part of the recipe — without it the effect is invisible. */
    rules.push(rule('.neu-surface', [
      ['background', 'var(--neu-surface)'],
      ['display', 'grid'],
      ['place-items', 'center'],
      ['padding', '3rem 1.5rem'],
      ['min-height', '320px']
    ]));

    switch (state.element) {
      case 'button': {
        rules.push(rule('.neu-button', surfaceVars(state).concat(surfaceDecls(state)).concat(typeDecls(state)).concat([
          ['display', 'inline-flex'],
          ['align-items', 'center'],
          ['justify-content', 'center'],
          ['padding', '.85em 2em'],
          ['border', state.border.enabled ? borderValue(state) : 'none'],
          ['cursor', 'pointer'],
          ['transition', 'box-shadow .22s ease']
        ])));
        interactionRules(state, '.neu-button').forEach(function (r) { rules.push(r); });
        break;
      }

      case 'input': {
        rules.push(rule('.neu-field', surfaceVars(state).concat([
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['gap', '.6rem'],
          ['width', sz.width + 'px'],
          ['max-width', '100%'],
          ['font-family', fontStack(state)]
        ])));
        rules.push(rule('.neu-field__label', [
          ['color', 'var(--neu-text)'],
          ['font-size', round(t.size * 0.85, 1) + 'px'],
          ['font-weight', '600']
        ]));
        rules.push(rule('.neu-input', [
          ['width', '100%'],
          ['background', 'var(--neu-surface)'],
          ['border-radius', 'var(--neu-radius)'],
          ['box-shadow', 'var(--neu-shadow-pressed)'],
          ['border', state.border.enabled ? borderValue(state) : 'none'],
          ['color', 'var(--neu-text)'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size, 1) + 'px'],
          ['padding', '.9em 1.2em'],
          ['box-sizing', 'border-box'],
          ['transition', 'box-shadow .22s ease']
        ]));
        rules.push(rule('.neu-input::placeholder', [['color', 'var(--neu-text)'], ['opacity', '.55']]));
        rules.push(rule('.neu-input:focus', [
          ['outline', 'none'],
          ['box-shadow', 'var(--neu-shadow-pressed)'],
          ['color', darken(state.surface, 70)]
        ]));
        rules.push(rule('.neu-input:focus-visible', [
          ['outline', '2px solid ' + darken(state.surface, 55)],
          ['outline-offset', '3px']
        ]));
        break;
      }

      case 'search': {
        rules.push(rule('.neu-search', surfaceVars(state).concat([
          ['display', 'flex'],
          ['align-items', 'center'],
          ['gap', '.7rem'],
          ['width', sz.width + 'px'],
          ['max-width', '100%'],
          ['background', 'var(--neu-surface)'],
          ['border-radius', 'var(--neu-radius)'],
          ['box-shadow', 'var(--neu-shadow-pressed)'],
          ['padding', '.8em 1.2em'],
          ['box-sizing', 'border-box']
        ])));
        rules.push(rule('.neu-search__icon', [
          ['color', 'var(--neu-text)'],
          ['font-size', round(t.size * 1.25, 1) + 'px'],
          ['opacity', '.7']
        ]));
        rules.push(rule('.neu-search__input', [
          ['flex', '1'],
          ['min-width', '0'],
          ['background', 'transparent'],
          ['border', '0'],
          ['color', 'var(--neu-text)'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size, 1) + 'px']
        ]));
        rules.push(rule('.neu-search__input:focus', [['outline', 'none']]));
        rules.push(rule('.neu-search:focus-within', [
          ['outline', '2px solid ' + darken(state.surface, 55)],
          ['outline-offset', '3px']
        ]));
        break;
      }

      case 'toggle': {
        var trackH = Math.max(28, Math.round(t.size * 2));
        var trackW = trackH * 2;
        var thumb = trackH - 8;
        rules.push(rule('.neu-toggle', surfaceVars(state).concat([
          ['display', 'inline-flex'],
          ['align-items', 'center'],
          ['gap', '.85rem'],
          ['cursor', 'pointer'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size, 1) + 'px'],
          ['font-weight', String(t.weight)],
          ['color', 'var(--neu-text)']
        ])));
        rules.push(rule('.neu-toggle__input', [
          ['position', 'absolute'],
          ['opacity', '0'],
          ['width', '1px'],
          ['height', '1px']
        ]));
        rules.push(rule('.neu-toggle__track', [
          ['position', 'relative'],
          ['width', trackW + 'px'],
          ['height', trackH + 'px'],
          ['flex', '0 0 auto'],
          ['border-radius', '999px'],
          ['background', 'var(--neu-surface)'],
          ['box-shadow', 'var(--neu-shadow-pressed)'],
          ['transition', 'box-shadow .22s ease']
        ]));
        rules.push(rule('.neu-toggle__thumb', [
          ['position', 'absolute'],
          ['top', '4px'],
          ['left', '4px'],
          ['width', thumb + 'px'],
          ['height', thumb + 'px'],
          ['border-radius', '50%'],
          ['background', backgroundValue(state)],
          ['box-shadow', boxShadowValue({
            surface: state.surface, intensity: state.intensity,
            distance: Math.max(2, Math.round(state.distance / 3)),
            blur: Math.max(2, Math.round(state.blur / 3)),
            lightSource: state.lightSource, shape: 'flat'
          })],
          ['transition', 'transform .24s cubic-bezier(.4,0,.2,1)']
        ]));
        rules.push(rule('.neu-toggle__input:checked ~ .neu-toggle__track .neu-toggle__thumb', [
          ['transform', 'translateX(' + (trackW - thumb - 8) + 'px)']
        ]));
        rules.push(rule('.neu-toggle__input:focus-visible ~ .neu-toggle__track', [
          ['outline', '2px solid ' + darken(state.surface, 55)],
          ['outline-offset', '3px']
        ]));
        break;
      }

      case 'checkbox': {
        var boxSize = Math.max(22, Math.round(t.size * 1.5));
        rules.push(rule('.neu-checkbox', surfaceVars(state).concat([
          ['display', 'inline-flex'],
          ['align-items', 'center'],
          ['gap', '.75rem'],
          ['cursor', 'pointer'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size, 1) + 'px'],
          ['font-weight', String(t.weight)],
          ['color', 'var(--neu-text)']
        ])));
        rules.push(rule('.neu-checkbox__input', [
          ['position', 'absolute'], ['opacity', '0'], ['width', '1px'], ['height', '1px']
        ]));
        rules.push(rule('.neu-checkbox__box', [
          ['position', 'relative'],
          ['width', boxSize + 'px'],
          ['height', boxSize + 'px'],
          ['flex', '0 0 auto'],
          ['border-radius', Math.min(state.radius, Math.round(boxSize / 2.5)) + 'px'],
          ['background', 'var(--neu-surface)'],
          ['box-shadow', 'var(--neu-shadow-pressed)'],
          ['transition', 'box-shadow .2s ease']
        ]));
        // A tick drawn from two borders — no icon font, no SVG dependency.
        rules.push(rule('.neu-checkbox__input:checked ~ .neu-checkbox__box::after', [
          ['content', '""'],
          ['position', 'absolute'],
          ['left', Math.round(boxSize * 0.34) + 'px'],
          ['top', Math.round(boxSize * 0.18) + 'px'],
          ['width', Math.round(boxSize * 0.22) + 'px'],
          ['height', Math.round(boxSize * 0.45) + 'px'],
          ['border', 'solid ' + darken(state.surface, 45)],
          ['border-width', '0 2px 2px 0'],
          ['transform', 'rotate(45deg)']
        ]));
        rules.push(rule('.neu-checkbox__input:focus-visible ~ .neu-checkbox__box', [
          ['outline', '2px solid ' + darken(state.surface, 55)],
          ['outline-offset', '3px']
        ]));
        break;
      }

      case 'circle': {
        var dia = Math.max(64, Math.min(sz.width, 260));
        rules.push(rule('.neu-circle', surfaceVars(state).concat(typeDecls(state)).concat([
          ['display', 'grid'],
          ['place-items', 'center'],
          ['width', dia + 'px'],
          ['height', dia + 'px'],
          ['border-radius', '50%'],
          ['background', backgroundValue(state)],
          ['box-shadow', 'var(--neu-shadow)'],
          state.border.enabled ? ['border', borderValue(state)] : null,
          ['color', 'var(--neu-text)'],
          ['font-size', round(dia * 0.3, 1) + 'px'],
          ['font-weight', '700'],
          ['letter-spacing', '.02em']
        ])));
        break;
      }

      case 'iconbutton': {
        var side = Math.max(48, Math.min(sz.width, 140));
        rules.push(rule('.neu-iconbutton', surfaceVars(state).concat([
          ['display', 'grid'],
          ['place-items', 'center'],
          ['width', side + 'px'],
          ['height', side + 'px'],
          ['border-radius', 'var(--neu-radius)'],
          ['background', backgroundValue(state)],
          ['box-shadow', 'var(--neu-shadow)'],
          ['border', state.border.enabled ? borderValue(state) : 'none'],
          ['color', 'var(--neu-text)'],
          ['font-family', fontStack(state)],
          ['font-size', round(side * 0.36, 1) + 'px'],
          ['cursor', 'pointer'],
          ['transition', 'box-shadow .22s ease']
        ])));
        interactionRules(state, '.neu-iconbutton').forEach(function (r) { rules.push(r); });
        break;
      }

      default: {
        rules.push(rule('.neu-card', surfaceVars(state).concat(surfaceDecls(state)).concat(typeDecls(state)).concat([
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['gap', '1rem'],
          ['width', sz.width + 'px'],
          ['max-width', '100%'],
          !sz.autoHeight ? ['min-height', sz.height + 'px'] : null,
          ['padding', sz.padding + 'px'],
          ['box-sizing', 'border-box'],
          ['border', state.border.enabled ? borderValue(state) : 'none']
        ])));
        rules.push(rule('.neu-card__title', [
          ['margin', '0'],
          ['font-size', round(t.size * 1.35, 1) + 'px'],
          ['font-weight', '700']
        ]));
        rules.push(rule('.neu-card__text', [['margin', '0'], ['opacity', '.85'], ['line-height', '1.6']]));
        rules.push(rule('.neu-button', [
          ['align-self', t.align === 'center' ? 'center' : (t.align === 'right' ? 'flex-end' : 'flex-start')],
          ['background', backgroundValue(state)],
          ['border-radius', Math.round(state.radius * 0.6) + 'px'],
          ['box-shadow', boxShadowValue({
            surface: state.surface, intensity: state.intensity,
            distance: Math.max(2, Math.round(state.distance * 0.6)),
            blur: Math.max(2, Math.round(state.blur * 0.6)),
            lightSource: state.lightSource, shape: state.shape
          })],
          ['border', 'none'],
          ['color', 'var(--neu-text)'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size * 0.95, 1) + 'px'],
          ['font-weight', '600'],
          ['padding', '.7em 1.6em'],
          ['cursor', 'pointer'],
          ['transition', 'box-shadow .22s ease']
        ]));
        interactionRules(state, '.neu-button').forEach(function (r) { rules.push(r); });
        break;
      }
    }

    /* Motion is decorative here, so respect the user's system preference. */
    if (state.states.hover || state.states.active) {
      rules.push({
        at: '@media (prefers-reduced-motion: reduce)',
        rules: [rule('.neu-card, .neu-button, .neu-input, .neu-toggle__thumb, .neu-iconbutton, .neu-checkbox__box, .neu-toggle__track',
          [['transition', 'none']])]
      });
    }

    return rules;
  }

  function rulesToCSS(rules, scope, indentLevel) {
    var pad = new Array((indentLevel || 0) + 1).join('  ');
    var out = [];
    rules.forEach(function (entry) {
      if (!entry) return;
      if (entry.at) {
        out.push(pad + entry.at + ' {');
        out.push(rulesToCSS(entry.rules, scope, (indentLevel || 0) + 1));
        out.push(pad + '}');
        return;
      }
      if (!entry.decls.length) return;
      var selector = entry.sel.split(',').map(function (part) {
        return (scope ? scope + ' ' : '') + part.trim();
      }).join(', ');
      out.push(pad + selector + ' {');
      entry.decls.forEach(function (d) { out.push(pad + '  ' + d[0] + ': ' + d[1] + ';'); });
      out.push(pad + '}');
    });
    return out.join('\n');
  }

  /* ======================================================================
     10. Generators
     ====================================================================== */

  function generateCSS(state, options) {
    var opts = options || {};
    var rules = elementRules(state);
    if (!opts.includeSurface) rules = rules.filter(function (r) { return r.sel !== '.neu-surface'; });
    return rulesToCSS(rules, opts.scope || '', 0);
  }

  function generateHTML(state) {
    return renderToString(buildTree(state), 0);
  }

  function generateFullDocument(state) {
    var label = elementInfo(state.element).label;
    var css = rulesToCSS(elementRules(state), '', 4);
    var body = renderToString(buildTree(state), 4);
    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Neumorphic ' + escapeHtml(label) + '</title>',
      '    <style>',
      '      * { box-sizing: border-box; }',
      '      body { margin: 0; min-height: 100vh; background: ' + state.surface + '; }',
      css,
      '    </style>',
      '  </head>',
      '  <body>',
      '    <div class="neu-surface">',
      body,
      '    </div>',
      '  </body>',
      '</html>',
      ''
    ].join('\n');
  }

  function inspectProperties(state) {
    return [
      { prop: 'background', value: backgroundValue(state) },
      { prop: 'border-radius', value: state.radius + 'px' },
      { prop: 'box-shadow', value: boxShadowValue(state) },
      { prop: 'light shadow', value: shadowColors(state).light },
      { prop: 'dark shadow', value: shadowColors(state).dark },
      { prop: 'color', value: textColor(state) }
    ];
  }

  /* ======================================================================
     11. Presets & randomiser
     ====================================================================== */

  function applyStylePreset(state, id) {
    var p = STYLE_PRESETS[id];
    if (!p) return state;
    ['surface', 'shape', 'distance', 'blur', 'intensity', 'radius', 'lightSource'].forEach(function (k) {
      if (p[k] !== undefined) state[k] = p[k];
    });
    state.surfacePreset = 'custom';
    return state;
  }

  function applySurfacePreset(state, id) {
    var p = SURFACE_PRESETS[id];
    if (!p) return state;
    state.surface = p.surface;
    state.surfacePreset = id;
    return state;
  }

  /**
   * Randomise inside the band where the effect actually reads: a mid-tone
   * surface, a distance the blur can support, and an intensity high enough
   * to stay visible.
   */
  function randomDesign(state, rng) {
    var rand = rng || Math.random;
    function pick(list) { return list[Math.floor(rand() * list.length)]; }
    function between(lo, hi) { return lo + rand() * (hi - lo); }

    applySurfacePreset(state, pick(SURFACE_PRESET_IDS));
    state.shape = pick(['flat', 'flat', 'convex', 'concave', 'pressed']);
    state.lightSource = pick(LIGHT_SOURCE_IDS);
    state.distance = Math.round(between(6, 22));
    state.blur = Math.round(state.distance * between(1.8, 2.6));
    state.intensity = Math.round(between(10, 24));
    state.radius = pick([12, 16, 20, 24, 28, 32, 40, 50]);
    state.gradientStrength = Math.round(between(4, 10));
    state.typography.autoColor = true;
    return state;
  }

  /* ======================================================================
     12. Export
     ====================================================================== */

  global.NeumorphismEngine = {
    escapeHtml: escapeHtml,
    safeHex: safeHex,
    safeText: safeText,
    clampNum: clampNum,
    lighten: lighten,
    darken: darken,
    shift: shift,
    tint: tint,
    toHex: toHex,
    toRgb: toRgb,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    readableTextOn: readableTextOn,

    defaultState: defaultState,
    normalize: normalize,
    cloneState: cloneState,

    shadowColors: shadowColors,
    boxShadowValue: boxShadowValue,
    backgroundValue: backgroundValue,
    borderValue: borderValue,
    textColor: textColor,
    fontStack: fontStack,
    audit: audit,

    buildTree: buildTree,
    renderToString: renderToString,
    renderToDOM: renderToDOM,
    elementRules: elementRules,
    rulesToCSS: rulesToCSS,

    generateCSS: generateCSS,
    generateHTML: generateHTML,
    generateFullDocument: generateFullDocument,
    inspectProperties: inspectProperties,

    applyStylePreset: applyStylePreset,
    applySurfacePreset: applySurfacePreset,
    randomDesign: randomDesign,

    ELEMENTS: ELEMENTS,
    ELEMENT_IDS: ELEMENT_IDS,
    elementInfo: elementInfo,
    SHAPES: SHAPES,
    LIGHT_SOURCES: LIGHT_SOURCES,
    LIGHT_SOURCE_IDS: LIGHT_SOURCE_IDS,
    FONTS: FONTS,
    SURFACE_PRESETS: SURFACE_PRESETS,
    SURFACE_PRESET_IDS: SURFACE_PRESET_IDS,
    STYLE_PRESETS: STYLE_PRESETS,
    STYLE_PRESET_IDS: STYLE_PRESET_IDS
  };

})(typeof window !== 'undefined' ? window : this);
