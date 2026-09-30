/* ==========================================================================
   ToolAdda — Glassmorphism Engine

   Pure, dependency-free logic behind the CSS Glassmorphism UI Builder.

   The whole builder is driven by one state object. From that state this
   module derives:

     • a component tree (plain objects)  -> rendered to DOM for the preview
                                         -> rendered to a string for the code panel
       Both renderers walk the SAME tree, so the preview and the generated
       HTML cannot drift apart.

     • a rule list (selector + declarations) -> serialised to CSS with an
       optional scope prefix. The preview injects the scoped variant; the
       code panel shows the unscoped one. Same rules either way.

   Every user-controlled value is sanitised on the way in: colours must be
   hex, numbers are clamped, fonts come from an allow-list, URLs must be
   http(s), and all text is escaped when it reaches markup. Nothing the
   user types can become executable CSS or HTML.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Sanitisers — the security boundary
     ====================================================================== */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Colours are the main CSS-injection vector, so only #rrggbb survives. */
  function safeHex(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return fallback || '#ffffff';
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

  /** Only http(s) image URLs. javascript:, data:, vbscript: and friends are dropped. */
  function safeUrl(value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (!s) return '';
    if (/[\r\n\t]/.test(s)) return '';
    if (!/^https?:\/\/[^\s"'()<>\\]+$/i.test(s)) return '';
    return s;
  }

  /** A CSS url() token — quoted and with the quote character forbidden inside. */
  function cssUrl(value) {
    var u = safeUrl(value);
    return u ? 'url("' + u + '")' : '';
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

  /* ======================================================================
     2. Colour helpers
     ====================================================================== */

  function hexToRgbParts(hex) {
    var h = safeHex(hex, '#ffffff').slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgba(hex, alpha) {
    var p = hexToRgbParts(hex);
    var a = round(clampNum(alpha, 0, 1, 1), 3);
    return 'rgba(' + p[0] + ', ' + p[1] + ', ' + p[2] + ', ' + a + ')';
  }

  /** Relative luminance, used to keep randomised designs readable. */
  function luminance(hex) {
    var p = hexToRgbParts(hex).map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  }

  function contrastRatio(a, b) {
    var la = luminance(a), lb = luminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* ======================================================================
     3. Constants
     ====================================================================== */

  var COMPONENTS = [
    { id: 'card', label: 'Card', className: 'glass-card' },
    { id: 'button', label: 'Button', className: 'glass-button' },
    { id: 'input', label: 'Input', className: 'glass-input' },
    { id: 'badge', label: 'Badge', className: 'glass-badge' },
    { id: 'navbar', label: 'Navbar', className: 'glass-navbar' },
    { id: 'modal', label: 'Modal', className: 'glass-modal' },
    { id: 'profile', label: 'Profile Card', className: 'glass-profile' },
    { id: 'pricing', label: 'Pricing Card', className: 'glass-pricing' }
  ];

  var COMPONENT_IDS = COMPONENTS.map(function (c) { return c.id; });

  function componentInfo(id) {
    for (var i = 0; i < COMPONENTS.length; i++) if (COMPONENTS[i].id === id) return COMPONENTS[i];
    return COMPONENTS[0];
  }

  var FONTS = {
    system: { label: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
    grotesk: { label: 'Inter / Grotesk', stack: 'Inter, "Helvetica Neue", "Segoe UI", system-ui, sans-serif' },
    geometric: { label: 'Geometric', stack: 'Poppins, "Century Gothic", "Avenir Next", system-ui, sans-serif' },
    rounded: { label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif' },
    serif: { label: 'Serif', stack: 'Georgia, "Iowan Old Style", "Times New Roman", serif' },
    mono: { label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' }
  };

  var FONT_IDS = Object.keys(FONTS);

  var SHADOW_PRESETS = {
    none: null,
    soft: { x: 0, y: 4, blur: 18, spread: -2, opacity: 0.18 },
    medium: { x: 0, y: 8, blur: 32, spread: -4, opacity: 0.32 },
    strong: { x: 0, y: 18, blur: 52, spread: -8, opacity: 0.48 }
  };

  var GLOW_LEVELS = {
    none: null,
    subtle: { blur: 22, alpha: 0.22 },
    medium: { blur: 38, alpha: 0.38 },
    strong: { blur: 62, alpha: 0.55 }
  };

  var INTENSITIES = {
    subtle: { opacity: 0.08, blur: 8, saturate: 120, brightness: 104, borderOpacity: 0.14, shadow: 'soft' },
    medium: { opacity: 0.15, blur: 20, saturate: 160, brightness: 110, borderOpacity: 0.26, shadow: 'medium' },
    strong: { opacity: 0.24, blur: 32, saturate: 190, brightness: 114, borderOpacity: 0.38, shadow: 'strong' },
    extreme: { opacity: 0.36, blur: 46, saturate: 220, brightness: 120, borderOpacity: 0.52, shadow: 'strong' }
  };

  var INTENSITY_IDS = Object.keys(INTENSITIES);

  var BACKGROUND_PRESETS = {
    aurora: { type: 'gradient', gradientType: 'linear', angle: 135, c1: '#5b21b6', c2: '#2563eb', c3: '#06b6d4', useC3: true },
    sunset: { type: 'gradient', gradientType: 'linear', angle: 160, c1: '#f97316', c2: '#db2777', c3: '#7c3aed', useC3: true },
    ocean: { type: 'gradient', gradientType: 'linear', angle: 120, c1: '#0e7490', c2: '#1d4ed8', c3: '#0f766e', useC3: true },
    purple: { type: 'gradient', gradientType: 'linear', angle: 140, c1: '#7c3aed', c2: '#c026d3', c3: '#4338ca', useC3: true },
    midnight: { type: 'gradient', gradientType: 'linear', angle: 150, c1: '#0f172a', c2: '#1e1b4b', c3: '#312e81', useC3: true },
    candy: { type: 'gradient', gradientType: 'linear', angle: 130, c1: '#f472b6', c2: '#a78bfa', c3: '#38bdf8', useC3: true },
    forest: { type: 'gradient', gradientType: 'linear', angle: 145, c1: '#065f46', c2: '#166534', c3: '#0891b2', useC3: true },
    neon: { type: 'gradient', gradientType: 'radial', angle: 135, c1: '#1e1b4b', c2: '#9333ea', c3: '#22d3ee', useC3: true },
    minimal: { type: 'gradient', gradientType: 'linear', angle: 135, c1: '#e2e8f0', c2: '#cbd5e1', c3: '#94a3b8', useC3: false }
  };

  var BACKGROUND_PRESET_LABELS = {
    aurora: 'Aurora', sunset: 'Sunset', ocean: 'Ocean', purple: 'Purple Dream',
    midnight: 'Midnight', candy: 'Candy', forest: 'Forest', neon: 'Neon', minimal: 'Minimal'
  };

  /* Ten glass presets. Each is a partial state merged over the current one. */
  var GLASS_PRESETS = {
    'frosted-white': {
      label: 'Frosted White',
      glass: { bgColor: '#ffffff', opacity: 0.18, blur: 20, saturate: 160, brightness: 110 },
      border: { enabled: true, width: 1, style: 'solid', color: '#ffffff', opacity: 0.32, radius: 20 },
      shadow: { preset: 'medium', color: '#0b1020', opacity: 0.3, glowLevel: 'none' },
      typography: { color: '#ffffff' }
    },
    'dark-glass': {
      label: 'Dark Glass',
      glass: { bgColor: '#0b1020', opacity: 0.42, blur: 24, saturate: 140, brightness: 90 },
      border: { enabled: true, width: 1, style: 'solid', color: '#ffffff', opacity: 0.14, radius: 18 },
      shadow: { preset: 'strong', color: '#000000', opacity: 0.5, glowLevel: 'none' },
      typography: { color: '#f8fafc' }
    },
    'crystal-glass': {
      label: 'Crystal Glass',
      glass: { bgColor: '#ffffff', opacity: 0.07, blur: 14, saturate: 200, brightness: 118 },
      border: { enabled: true, width: 1, style: 'solid', color: '#ffffff', opacity: 0.45, radius: 24 },
      shadow: { preset: 'soft', color: '#0b1020', opacity: 0.22, glowLevel: 'none' },
      typography: { color: '#ffffff' }
    },
    'blue-glass': {
      label: 'Blue Glass',
      glass: { bgColor: '#38bdf8', opacity: 0.18, blur: 22, saturate: 170, brightness: 108 },
      border: { enabled: true, width: 1, style: 'solid', color: '#bae6fd', opacity: 0.36, radius: 20 },
      shadow: { preset: 'medium', color: '#0c4a6e', opacity: 0.4, glowLevel: 'subtle', glowColor: '#38bdf8' },
      typography: { color: '#f0f9ff' }
    },
    'purple-glass': {
      label: 'Purple Glass',
      glass: { bgColor: '#a855f7', opacity: 0.2, blur: 26, saturate: 180, brightness: 108 },
      border: { enabled: true, width: 1, style: 'solid', color: '#e9d5ff', opacity: 0.34, radius: 22 },
      shadow: { preset: 'medium', color: '#3b0764', opacity: 0.44, glowLevel: 'subtle', glowColor: '#c084fc' },
      typography: { color: '#faf5ff' }
    },
    'neon-glass': {
      label: 'Neon Glass',
      glass: { bgColor: '#0f172a', opacity: 0.34, blur: 18, saturate: 210, brightness: 105 },
      border: { enabled: true, width: 1.5, style: 'solid', color: '#22d3ee', opacity: 0.75, radius: 16 },
      shadow: { preset: 'medium', color: '#020617', opacity: 0.5, glowLevel: 'strong', glowColor: '#22d3ee' },
      typography: { color: '#ecfeff' }
    },
    'minimal-glass': {
      label: 'Minimal Glass',
      glass: { bgColor: '#ffffff', opacity: 0.1, blur: 10, saturate: 120, brightness: 104 },
      border: { enabled: true, width: 1, style: 'solid', color: '#ffffff', opacity: 0.18, radius: 12 },
      shadow: { preset: 'soft', color: '#0b1020', opacity: 0.16, glowLevel: 'none' },
      typography: { color: '#ffffff' }
    },
    'soft-glass': {
      label: 'Soft Glass',
      glass: { bgColor: '#f8fafc', opacity: 0.22, blur: 30, saturate: 150, brightness: 112 },
      border: { enabled: true, width: 1, style: 'solid', color: '#ffffff', opacity: 0.4, radius: 32 },
      shadow: { preset: 'soft', color: '#1e293b', opacity: 0.24, glowLevel: 'none' },
      typography: { color: '#ffffff' }
    },
    'aurora-glass': {
      label: 'Aurora Glass',
      glass: { bgColor: '#34d399', opacity: 0.14, blur: 28, saturate: 200, brightness: 115 },
      border: { enabled: true, width: 1, style: 'solid', color: '#a7f3d0', opacity: 0.4, radius: 26 },
      shadow: { preset: 'medium', color: '#064e3b', opacity: 0.38, glowLevel: 'medium', glowColor: '#34d399' },
      typography: { color: '#ecfdf5' }
    },
    'black-glass': {
      label: 'Black Glass',
      glass: { bgColor: '#000000', opacity: 0.5, blur: 20, saturate: 120, brightness: 85 },
      border: { enabled: true, width: 1, style: 'solid', color: '#ffffff', opacity: 0.1, radius: 14 },
      shadow: { preset: 'strong', color: '#000000', opacity: 0.6, glowLevel: 'none' },
      typography: { color: '#f1f5f9' }
    }
  };

  var GLASS_PRESET_IDS = Object.keys(GLASS_PRESETS);

  /* ======================================================================
     4. Default state
     ====================================================================== */

  function defaultState() {
    return {
      version: 1,
      component: 'card',
      mode: 'basic',
      background: {
        type: 'gradient',
        preset: 'aurora',
        solid: '#1e1b4b',
        gradientType: 'linear',
        angle: 135,
        c1: '#5b21b6',
        c2: '#2563eb',
        c3: '#06b6d4',
        useC3: true,
        imageUrl: '',
        imagePosition: 'center',
        imageSize: 'cover',
        blobs: {
          enabled: true,
          count: 3,
          size: 300,
          opacity: 0.55,
          blur: 70,
          c1: '#f472b6',
          c2: '#22d3ee',
          c3: '#a78bfa'
        },
        includeInExport: false
      },
      glass: {
        intensity: 'medium',
        bgColor: '#ffffff',
        opacity: 0.15,
        blur: 20,
        saturate: 160,
        brightness: 110
      },
      border: {
        enabled: true,
        width: 1,
        style: 'solid',
        color: '#ffffff',
        opacity: 0.26,
        radiusLinked: true,
        radius: 20,
        tl: 20, tr: 20, br: 20, bl: 20
      },
      shadow: {
        preset: 'medium',
        x: 0, y: 8, blur: 32, spread: -4,
        color: '#0b1020', opacity: 0.32,
        innerEnabled: true,
        innerX: 0, innerY: 1, innerBlur: 0, innerSpread: 0,
        innerColor: '#ffffff', innerOpacity: 0.28,
        glowLevel: 'none',
        glowColor: '#a78bfa',
        glowBlur: 38
      },
      typography: {
        font: 'system',
        size: 16,
        weight: 500,
        lineHeight: 1.6,
        letterSpacing: 0,
        color: '#ffffff',
        align: 'left'
      },
      layout: {
        width: 360,
        autoHeight: true,
        height: 240,
        maxWidth: 0,
        padding: 28,
        gap: 14,
        alignH: 'left',
        alignV: 'center'
      },
      content: {
        title: 'Premium Glass Card',
        description: 'Beautiful modern glassmorphism UI, generated as clean HTML and CSS.',
        buttonText: 'Explore Design',
        badgeText: 'New',
        showBadge: true,
        placeholder: 'you@example.com',
        inputValue: '',
        inputLabel: 'Email address',
        logo: 'Auralis',
        menu: 'Home, Features, Pricing, Docs',
        navButton: 'Get started',
        modalTitle: 'Confirm your plan',
        modalDescription: 'You are about to upgrade to the Studio plan. You can cancel any time.',
        modalPrimary: 'Upgrade',
        modalSecondary: 'Cancel',
        profileName: 'Ada Sharma',
        profileRole: 'Product Designer',
        profileBio: 'Designing calm interfaces for complex products.',
        avatarUrl: '',
        profileLink: 'View portfolio',
        profileButton: 'Follow',
        planName: 'Studio',
        planPrice: '$24',
        planPeriod: '/month',
        planDescription: 'Everything a small design team needs.',
        planFeatures: 'Unlimited projects\nComponent library\nPriority support',
        planButton: 'Choose plan',
        planBadge: 'Popular'
      },
      preview: {
        device: 'desktop',
        compare: false
      }
    };
  }

  /* ======================================================================
     5. Normalising — every read path goes through this
     ====================================================================== */

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};

    function sec(name) { return (s[name] && typeof s[name] === 'object') ? s[name] : {}; }

    var bg = sec('background');
    var blobsIn = (bg.blobs && typeof bg.blobs === 'object') ? bg.blobs : {};
    var g = sec('glass');
    var b = sec('border');
    var sh = sec('shadow');
    var t = sec('typography');
    var l = sec('layout');
    var c = sec('content');
    var p = sec('preview');

    var out = {
      version: 1,
      component: oneOf(s.component, COMPONENT_IDS, d.component),
      mode: oneOf(s.mode, ['basic', 'advanced'], d.mode),
      background: {
        type: oneOf(bg.type, ['gradient', 'solid', 'image'], d.background.type),
        preset: oneOf(bg.preset, Object.keys(BACKGROUND_PRESETS).concat(['custom']), d.background.preset),
        solid: safeHex(bg.solid, d.background.solid),
        gradientType: oneOf(bg.gradientType, ['linear', 'radial'], d.background.gradientType),
        angle: clampNum(bg.angle, 0, 360, d.background.angle),
        c1: safeHex(bg.c1, d.background.c1),
        c2: safeHex(bg.c2, d.background.c2),
        c3: safeHex(bg.c3, d.background.c3),
        useC3: bg.useC3 === undefined ? d.background.useC3 : !!bg.useC3,
        imageUrl: safeUrl(bg.imageUrl),
        imagePosition: oneOf(bg.imagePosition, ['center', 'top', 'bottom', 'left', 'right'], d.background.imagePosition),
        imageSize: oneOf(bg.imageSize, ['cover', 'contain'], d.background.imageSize),
        blobs: {
          enabled: blobsIn.enabled === undefined ? d.background.blobs.enabled : !!blobsIn.enabled,
          count: Math.round(clampNum(blobsIn.count, 0, 6, d.background.blobs.count)),
          size: Math.round(clampNum(blobsIn.size, 60, 700, d.background.blobs.size)),
          opacity: clampNum(blobsIn.opacity, 0, 1, d.background.blobs.opacity),
          blur: Math.round(clampNum(blobsIn.blur, 0, 200, d.background.blobs.blur)),
          c1: safeHex(blobsIn.c1, d.background.blobs.c1),
          c2: safeHex(blobsIn.c2, d.background.blobs.c2),
          c3: safeHex(blobsIn.c3, d.background.blobs.c3)
        },
        includeInExport: bg.includeInExport === undefined ? d.background.includeInExport : !!bg.includeInExport
      },
      glass: {
        intensity: oneOf(g.intensity, INTENSITY_IDS.concat(['custom']), d.glass.intensity),
        bgColor: safeHex(g.bgColor, d.glass.bgColor),
        opacity: clampNum(g.opacity, 0, 1, d.glass.opacity),
        blur: clampNum(g.blur, 0, 50, d.glass.blur),
        saturate: clampNum(g.saturate, 50, 250, d.glass.saturate),
        brightness: clampNum(g.brightness, 50, 200, d.glass.brightness)
      },
      border: {
        enabled: b.enabled === undefined ? d.border.enabled : !!b.enabled,
        width: clampNum(b.width, 0, 12, d.border.width),
        style: oneOf(b.style, ['solid', 'dashed', 'dotted'], d.border.style),
        color: safeHex(b.color, d.border.color),
        opacity: clampNum(b.opacity, 0, 1, d.border.opacity),
        radiusLinked: b.radiusLinked === undefined ? d.border.radiusLinked : !!b.radiusLinked,
        radius: Math.round(clampNum(b.radius, 0, 100, d.border.radius)),
        tl: Math.round(clampNum(b.tl, 0, 100, d.border.tl)),
        tr: Math.round(clampNum(b.tr, 0, 100, d.border.tr)),
        br: Math.round(clampNum(b.br, 0, 100, d.border.br)),
        bl: Math.round(clampNum(b.bl, 0, 100, d.border.bl))
      },
      shadow: {
        preset: oneOf(sh.preset, ['none', 'soft', 'medium', 'strong', 'custom'], d.shadow.preset),
        x: clampNum(sh.x, -60, 60, d.shadow.x),
        y: clampNum(sh.y, -60, 60, d.shadow.y),
        blur: clampNum(sh.blur, 0, 120, d.shadow.blur),
        spread: clampNum(sh.spread, -40, 40, d.shadow.spread),
        color: safeHex(sh.color, d.shadow.color),
        opacity: clampNum(sh.opacity, 0, 1, d.shadow.opacity),
        innerEnabled: sh.innerEnabled === undefined ? d.shadow.innerEnabled : !!sh.innerEnabled,
        innerX: clampNum(sh.innerX, -40, 40, d.shadow.innerX),
        innerY: clampNum(sh.innerY, -40, 40, d.shadow.innerY),
        innerBlur: clampNum(sh.innerBlur, 0, 80, d.shadow.innerBlur),
        innerSpread: clampNum(sh.innerSpread, -40, 40, d.shadow.innerSpread),
        innerColor: safeHex(sh.innerColor, d.shadow.innerColor),
        innerOpacity: clampNum(sh.innerOpacity, 0, 1, d.shadow.innerOpacity),
        glowLevel: oneOf(sh.glowLevel, ['none', 'subtle', 'medium', 'strong'], d.shadow.glowLevel),
        glowColor: safeHex(sh.glowColor, d.shadow.glowColor),
        glowBlur: clampNum(sh.glowBlur, 0, 120, d.shadow.glowBlur)
      },
      typography: {
        font: oneOf(t.font, FONT_IDS, d.typography.font),
        size: clampNum(t.size, 10, 40, d.typography.size),
        weight: Math.round(clampNum(t.weight, 100, 900, d.typography.weight) / 100) * 100,
        lineHeight: clampNum(t.lineHeight, 1, 2.4, d.typography.lineHeight),
        letterSpacing: clampNum(t.letterSpacing, -2, 8, d.typography.letterSpacing),
        color: safeHex(t.color, d.typography.color),
        align: oneOf(t.align, ['left', 'center', 'right'], d.typography.align)
      },
      layout: {
        width: Math.round(clampNum(l.width, 160, 900, d.layout.width)),
        autoHeight: l.autoHeight === undefined ? d.layout.autoHeight : !!l.autoHeight,
        height: Math.round(clampNum(l.height, 80, 900, d.layout.height)),
        maxWidth: Math.round(clampNum(l.maxWidth, 0, 1200, d.layout.maxWidth)),
        padding: Math.round(clampNum(l.padding, 0, 80, d.layout.padding)),
        gap: Math.round(clampNum(l.gap, 0, 60, d.layout.gap)),
        alignH: oneOf(l.alignH, ['left', 'center', 'right'], d.layout.alignH),
        alignV: oneOf(l.alignV, ['top', 'center', 'bottom'], d.layout.alignV)
      },
      content: {},
      preview: {
        device: oneOf(p.device, ['desktop', 'tablet', 'mobile'], d.preview.device),
        compare: p.compare === undefined ? d.preview.compare : !!p.compare
      }
    };

    /* content: copy every known key, escaping-safe and length-capped */
    var LONG = { description: 400, modalDescription: 400, profileBio: 300, planFeatures: 400, menu: 200 };
    Object.keys(d.content).forEach(function (key) {
      var def = d.content[key];
      if (typeof def === 'boolean') {
        out.content[key] = c[key] === undefined ? def : !!c[key];
      } else if (key === 'avatarUrl') {
        out.content[key] = safeUrl(c[key]);
      } else {
        out.content[key] = c[key] === undefined ? def : safeText(c[key], LONG[key] || 120);
      }
    });

    return out;
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  /* ======================================================================
     6. Derived CSS values
     ====================================================================== */

  function glassBackground(state) {
    return rgba(state.glass.bgColor, state.glass.opacity);
  }

  /**
   * Compose every enabled backdrop filter into one value.
   * Filters are appended, never replaced, so blur + saturate + brightness
   * all survive together.
   */
  function backdropFilter(state) {
    var g = state.glass;
    var parts = [];
    if (g.blur > 0) parts.push('blur(' + round(g.blur, 1) + 'px)');
    if (Math.round(g.saturate) !== 100) parts.push('saturate(' + Math.round(g.saturate) + '%)');
    if (Math.round(g.brightness) !== 100) parts.push('brightness(' + Math.round(g.brightness) + '%)');
    return parts.length ? parts.join(' ') : 'none';
  }

  function borderValue(state) {
    var b = state.border;
    if (!b.enabled || b.width <= 0) return 'none';
    return round(b.width, 2) + 'px ' + b.style + ' ' + rgba(b.color, b.opacity);
  }

  function radiusValue(state) {
    var b = state.border;
    if (b.radiusLinked) return b.radius + 'px';
    if (b.tl === b.tr && b.tr === b.br && b.br === b.bl) return b.tl + 'px';
    return b.tl + 'px ' + b.tr + 'px ' + b.br + 'px ' + b.bl + 'px';
  }

  /** Outer shadow + optional glow + optional inset, as one box-shadow list. */
  function boxShadowValue(state) {
    var s = state.shadow;
    var layers = [];

    if (s.preset !== 'none') {
      var geo = s.preset === 'custom' ? s : SHADOW_PRESETS[s.preset];
      if (geo) {
        var opacity = s.preset === 'custom' ? s.opacity : geo.opacity;
        layers.push(
          round(geo.x, 1) + 'px ' + round(geo.y, 1) + 'px ' + round(geo.blur, 1) + 'px ' +
          round(geo.spread, 1) + 'px ' + rgba(s.color, opacity)
        );
      }
    }

    var glow = GLOW_LEVELS[s.glowLevel];
    if (glow) {
      var blur = s.glowBlur > 0 ? s.glowBlur : glow.blur;
      layers.push('0 0 ' + round(blur, 1) + 'px ' + rgba(s.glowColor, glow.alpha));
    }

    if (s.innerEnabled) {
      layers.push(
        'inset ' + round(s.innerX, 1) + 'px ' + round(s.innerY, 1) + 'px ' +
        round(s.innerBlur, 1) + 'px ' + round(s.innerSpread, 1) + 'px ' +
        rgba(s.innerColor, s.innerOpacity)
      );
    }

    return layers.length ? layers.join(', ') : 'none';
  }

  function backgroundValue(state) {
    var bg = state.background;
    if (bg.type === 'solid') return bg.solid;
    if (bg.type === 'image') {
      var url = cssUrl(bg.imageUrl);
      if (!url) return bg.solid;
      return url + ' ' + bg.imagePosition + ' / ' + bg.imageSize + ' no-repeat';
    }
    var stops = [bg.c1, bg.c2];
    if (bg.useC3) stops.push(bg.c3);
    if (bg.gradientType === 'radial') {
      return 'radial-gradient(circle at 30% 20%, ' + stops.join(', ') + ')';
    }
    return 'linear-gradient(' + Math.round(bg.angle) + 'deg, ' + stops.join(', ') + ')';
  }

  function fontStack(state) {
    return (FONTS[state.typography.font] || FONTS.system).stack;
  }

  var FLEX_H = { left: 'flex-start', center: 'center', right: 'flex-end' };
  var FLEX_V = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

  /* ======================================================================
     7. Component trees
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

  function splitList(value, limit) {
    return String(value || '')
      .split(/[\n,]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .slice(0, limit || 6);
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** The single tree both renderers walk. */
  function buildTree(state) {
    var c = state.content;

    switch (state.component) {
      case 'button':
        return node('button', 'glass-button', [], { type: 'button' }, c.buttonText);

      case 'badge':
        return node('span', 'glass-badge', [], {}, c.badgeText);

      case 'input':
        return node('div', 'glass-field', [
          node('label', 'glass-field__label', [], { for: 'glass-input' }, c.inputLabel),
          node('input', 'glass-input', [], {
            id: 'glass-input',
            type: 'text',
            placeholder: c.placeholder,
            value: c.inputValue
          })
        ]);

      case 'navbar':
        return node('nav', 'glass-navbar', [
          node('a', 'glass-navbar__logo', [], { href: '#' }, c.logo),
          node('ul', 'glass-navbar__menu',
            splitList(c.menu, 6).map(function (item) {
              return node('li', '', [node('a', '', [], { href: '#' }, item)]);
            })
          ),
          node('button', 'glass-navbar__cta', [], { type: 'button' }, c.navButton)
        ], { 'aria-label': 'Main' });

      case 'modal':
        return node('div', 'glass-modal-backdrop', [
          node('div', 'glass-modal', [
            node('button', 'glass-modal__close', [], { type: 'button', 'aria-label': 'Close dialog' }, '×'),
            node('h2', 'glass-modal__title', [], { id: 'glass-modal-title' }, c.modalTitle),
            node('p', 'glass-modal__text', [], {}, c.modalDescription),
            node('div', 'glass-modal__actions', [
              node('button', 'glass-btn glass-btn--ghost', [], { type: 'button' }, c.modalSecondary),
              node('button', 'glass-btn glass-btn--primary', [], { type: 'button' }, c.modalPrimary)
            ])
          ], { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'glass-modal-title' })
        ]);

      case 'profile': {
        var avatar = c.avatarUrl
          ? node('img', 'glass-profile__avatar', [], { src: c.avatarUrl, alt: c.profileName, width: '72', height: '72' })
          : node('div', 'glass-profile__avatar glass-profile__avatar--initials', [], { 'aria-hidden': 'true' }, initials(c.profileName));
        return node('div', 'glass-profile', [
          avatar,
          node('h2', 'glass-profile__name', [], {}, c.profileName),
          node('p', 'glass-profile__role', [], {}, c.profileRole),
          node('p', 'glass-profile__bio', [], {}, c.profileBio),
          node('a', 'glass-profile__link', [], { href: '#' }, c.profileLink),
          node('button', 'glass-btn glass-btn--primary', [], { type: 'button' }, c.profileButton)
        ]);
      }

      case 'pricing': {
        var kids = [];
        if (c.planBadge) kids.push(node('span', 'glass-badge', [], {}, c.planBadge));
        kids.push(node('h2', 'glass-pricing__plan', [], {}, c.planName));
        kids.push(node('p', 'glass-pricing__price', [
          node('span', 'glass-pricing__amount', [], {}, c.planPrice),
          node('span', 'glass-pricing__period', [], {}, c.planPeriod)
        ]));
        kids.push(node('p', 'glass-pricing__text', [], {}, c.planDescription));
        kids.push(node('ul', 'glass-pricing__features',
          splitList(c.planFeatures, 6).map(function (f) { return node('li', '', [], {}, f); })
        ));
        kids.push(node('button', 'glass-btn glass-btn--primary', [], { type: 'button' }, c.planButton));
        return node('div', 'glass-pricing', kids);
      }

      default: {
        var cardKids = [];
        if (c.showBadge && c.badgeText) cardKids.push(node('span', 'glass-badge', [], {}, c.badgeText));
        cardKids.push(node('h2', 'glass-card__title', [], {}, c.title));
        cardKids.push(node('p', 'glass-card__text', [], {}, c.description));
        if (c.buttonText) cardKids.push(node('button', 'glass-btn glass-btn--primary', [], { type: 'button' }, c.buttonText));
        return node('div', 'glass-card', cardKids);
      }
    }
  }

  /** Wrap the component in the decorative scene when the user exports it. */
  function wrapScene(tree, state) {
    if (!state.background.includeInExport) return tree;
    var kids = [];
    var blobs = state.background.blobs;
    if (blobs.enabled) {
      for (var i = 0; i < blobs.count; i++) {
        kids.push(node('span', 'glass-scene__blob glass-scene__blob--' + (i + 1), [], { 'aria-hidden': 'true' }));
      }
    }
    kids.push(tree);
    return node('div', 'glass-scene', kids);
  }

  /* ---------------------------------------------------- tree -> string */

  var VOID_TAGS = { img: 1, input: 1, br: 1, hr: 1, source: 1 };

  function renderToString(tree, indentLevel) {
    var pad = new Array((indentLevel || 0) + 1).join('  ');
    var attrs = '';

    if (tree.className) attrs += ' class="' + escapeHtml(tree.className) + '"';
    Object.keys(tree.attrs).forEach(function (key) {
      var value = tree.attrs[key];
      if (value === '' && (key === 'value' || key === 'placeholder')) return;
      if (value === null || value === undefined) return;
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

  /* ------------------------------------------------------- tree -> DOM */

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
      element.setAttribute(key, value);
    });

    if (tree.text !== null && !tree.children.length) {
      // textContent — never innerHTML. User copy cannot become markup.
      element.textContent = tree.text;
    }
    tree.children.forEach(function (child) {
      var childEl = renderToDOM(child, d);
      if (childEl) element.appendChild(childEl);
    });

    // Preview-only: keep the demo inert so clicks do not navigate or submit.
    if (tree.tag === 'a') element.setAttribute('tabindex', '-1');
    return element;
  }

  /* ======================================================================
     8. CSS rules
     ====================================================================== */

  function rule(sel, decls) { return { sel: sel, decls: decls.filter(Boolean) }; }
  function at(query, rules) { return { at: query, rules: rules }; }

  function glassVars(state) {
    return [
      ['--glass-bg', glassBackground(state)],
      ['--glass-blur', backdropFilter(state)],
      ['--glass-border', borderValue(state)],
      ['--glass-radius', radiusValue(state)],
      ['--glass-shadow', boxShadowValue(state)],
      ['--glass-text', state.typography.color],
      ['--glass-padding', state.layout.padding + 'px'],
      ['--glass-gap', state.layout.gap + 'px']
    ];
  }

  function glassSurface() {
    return [
      ['background', 'var(--glass-bg)'],
      ['-webkit-backdrop-filter', 'var(--glass-blur)'],
      ['backdrop-filter', 'var(--glass-blur)'],
      ['border', 'var(--glass-border)'],
      ['border-radius', 'var(--glass-radius)'],
      ['box-shadow', 'var(--glass-shadow)']
    ];
  }

  function typeDecls(state) {
    var t = state.typography;
    return [
      ['color', 'var(--glass-text)'],
      ['font-family', fontStack(state)],
      ['font-size', round(t.size, 1) + 'px'],
      ['font-weight', String(t.weight)],
      ['line-height', String(round(t.lineHeight, 2))],
      t.letterSpacing !== 0 ? ['letter-spacing', round(t.letterSpacing, 2) + 'px'] : null,
      ['text-align', t.align]
    ];
  }

  function sizeDecls(state) {
    var l = state.layout;
    return [
      ['width', l.width + 'px'],
      l.maxWidth > 0 ? ['max-width', l.maxWidth + 'px'] : ['max-width', '100%'],
      !l.autoHeight ? ['min-height', l.height + 'px'] : null,
      ['padding', 'var(--glass-padding)'],
      ['box-sizing', 'border-box']
    ];
  }

  /** A more opaque background for browsers without backdrop-filter. */
  function fallbackRule(state, selector) {
    if (state.glass.blur <= 0) return null;
    var boosted = Math.min(0.92, state.glass.opacity + 0.45);
    return at('@supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px)))', [
      rule(selector, [['background', rgba(state.glass.bgColor, boosted)]])
    ]);
  }

  function buttonRules(state, selector) {
    var accent = state.typography.color;
    return [
      rule(selector, [
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['gap', '.5rem'],
        ['background', 'var(--glass-bg)'],
        ['-webkit-backdrop-filter', 'var(--glass-blur)'],
        ['backdrop-filter', 'var(--glass-blur)'],
        ['border', 'var(--glass-border)'],
        ['border-radius', 'var(--glass-radius)'],
        ['box-shadow', 'var(--glass-shadow)'],
        ['color', 'var(--glass-text)'],
        ['font-family', fontStack(state)],
        ['font-size', round(state.typography.size, 1) + 'px'],
        ['font-weight', String(Math.max(500, state.typography.weight))],
        ['letter-spacing', round(state.typography.letterSpacing, 2) + 'px'],
        ['padding', '.75em 1.5em'],
        ['cursor', 'pointer'],
        ['transition', 'transform .18s ease, box-shadow .18s ease, background .18s ease']
      ]),
      rule(selector + ':hover', [
        ['background', rgba(state.glass.bgColor, Math.min(1, state.glass.opacity + 0.1))],
        ['transform', 'translateY(-2px)']
      ]),
      rule(selector + ':active', [['transform', 'translateY(0)']]),
      rule(selector + ':focus-visible', [
        ['outline', '2px solid ' + rgba(accent, 0.9)],
        ['outline-offset', '3px']
      ])
    ];
  }

  function componentRules(state) {
    var rules = [];
    var l = state.layout;
    var t = state.typography;

    switch (state.component) {
      case 'button': {
        rules.push(rule('.glass-button', glassVars(state)));
        buttonRules(state, '.glass-button').forEach(function (r) { rules.push(r); });
        var fb = fallbackRule(state, '.glass-button');
        if (fb) rules.push(fb);
        break;
      }

      case 'badge': {
        rules.push(rule('.glass-badge', glassVars(state).concat([
          ['display', 'inline-flex'],
          ['align-items', 'center'],
          ['background', 'var(--glass-bg)'],
          ['-webkit-backdrop-filter', 'var(--glass-blur)'],
          ['backdrop-filter', 'var(--glass-blur)'],
          ['border', 'var(--glass-border)'],
          ['border-radius', 'var(--glass-radius)'],
          ['box-shadow', 'var(--glass-shadow)'],
          ['color', 'var(--glass-text)'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size * 0.78, 1) + 'px'],
          ['font-weight', '600'],
          ['letter-spacing', round(Math.max(t.letterSpacing, 0.2), 2) + 'px'],
          ['padding', '.35em .9em']
        ])));
        var fbb = fallbackRule(state, '.glass-badge');
        if (fbb) rules.push(fbb);
        break;
      }

      case 'input': {
        rules.push(rule('.glass-field', [
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['gap', '.5rem'],
          ['width', l.width + 'px'],
          ['max-width', '100%'],
          ['font-family', fontStack(state)]
        ]));
        rules.push(rule('.glass-field__label', [
          ['color', 'var(--glass-text)'],
          ['font-size', round(t.size * 0.82, 1) + 'px'],
          ['font-weight', '600']
        ]));
        rules.push(rule('.glass-input', glassVars(state).concat([
          ['width', '100%'],
          ['background', 'var(--glass-bg)'],
          ['-webkit-backdrop-filter', 'var(--glass-blur)'],
          ['backdrop-filter', 'var(--glass-blur)'],
          ['border', 'var(--glass-border)'],
          ['border-radius', 'var(--glass-radius)'],
          ['box-shadow', 'var(--glass-shadow)'],
          ['color', 'var(--glass-text)'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size, 1) + 'px'],
          ['padding', '.85em 1.1em'],
          ['box-sizing', 'border-box'],
          ['transition', 'border-color .18s ease, box-shadow .18s ease']
        ])));
        rules.push(rule('.glass-input::placeholder', [
          ['color', rgba(t.color, 0.6)]
        ]));
        rules.push(rule('.glass-input:focus', [
          ['outline', 'none'],
          ['border-color', rgba(state.shadow.glowColor, 0.85)],
          ['box-shadow', 'var(--glass-shadow), 0 0 0 3px ' + rgba(state.shadow.glowColor, 0.3)]
        ]));
        var fbi = fallbackRule(state, '.glass-input');
        if (fbi) rules.push(fbi);
        break;
      }

      case 'navbar': {
        rules.push(rule('.glass-navbar', glassVars(state).concat(glassSurface()).concat([
          ['display', 'flex'],
          ['align-items', 'center'],
          ['justify-content', 'space-between'],
          ['gap', 'var(--glass-gap)'],
          ['width', l.width + 'px'],
          ['max-width', '100%'],
          ['padding', '.75rem var(--glass-padding)'],
          ['box-sizing', 'border-box'],
          ['color', 'var(--glass-text)'],
          ['font-family', fontStack(state)],
          ['font-size', round(t.size, 1) + 'px']
        ])));
        rules.push(rule('.glass-navbar__logo', [
          ['color', 'var(--glass-text)'],
          ['font-weight', '700'],
          ['font-size', round(t.size * 1.1, 1) + 'px'],
          ['text-decoration', 'none'],
          ['letter-spacing', '-.01em']
        ]));
        rules.push(rule('.glass-navbar__menu', [
          ['display', 'flex'],
          ['align-items', 'center'],
          ['gap', '1.5rem'],
          ['list-style', 'none'],
          ['margin', '0'],
          ['padding', '0']
        ]));
        rules.push(rule('.glass-navbar__menu a', [
          ['color', rgba(t.color, 0.82)],
          ['text-decoration', 'none'],
          ['font-weight', '500'],
          ['transition', 'color .18s ease']
        ]));
        rules.push(rule('.glass-navbar__menu a:hover', [['color', 'var(--glass-text)']]));
        rules.push(rule('.glass-navbar__cta', [
          ['background', rgba(state.glass.bgColor, Math.min(1, state.glass.opacity + 0.12))],
          ['border', 'var(--glass-border)'],
          ['border-radius', '999px'],
          ['color', 'var(--glass-text)'],
          ['font-family', 'inherit'],
          ['font-size', round(t.size * 0.92, 1) + 'px'],
          ['font-weight', '600'],
          ['padding', '.55em 1.2em'],
          ['cursor', 'pointer'],
          ['transition', 'transform .18s ease, background .18s ease']
        ]));
        rules.push(rule('.glass-navbar__cta:hover', [['transform', 'translateY(-1px)']]));
        // A navbar genuinely needs to reflow on narrow screens.
        rules.push(at('@media (max-width: 640px)', [
          rule('.glass-navbar', [
            ['flex-direction', 'column'],
            ['align-items', 'stretch'],
            ['text-align', 'center']
          ]),
          rule('.glass-navbar__menu', [
            ['flex-wrap', 'wrap'],
            ['justify-content', 'center'],
            ['gap', '1rem']
          ])
        ]));
        var fbn = fallbackRule(state, '.glass-navbar');
        if (fbn) rules.push(fbn);
        break;
      }

      case 'modal': {
        rules.push(rule('.glass-modal-backdrop', [
          ['display', 'grid'],
          ['place-items', 'center'],
          ['padding', '1.5rem'],
          ['background', rgba('#0b1020', 0.45)]
        ]));
        rules.push(rule('.glass-modal', glassVars(state).concat(glassSurface()).concat(sizeDecls(state)).concat(typeDecls(state)).concat([
          ['position', 'relative'],
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['gap', 'var(--glass-gap)']
        ])));
        rules.push(rule('.glass-modal__close', [
          ['position', 'absolute'],
          ['top', '.75rem'],
          ['right', '.9rem'],
          ['width', '2rem'],
          ['height', '2rem'],
          ['display', 'grid'],
          ['place-items', 'center'],
          ['background', 'transparent'],
          ['border', '0'],
          ['border-radius', '50%'],
          ['color', 'var(--glass-text)'],
          ['font-size', '1.4rem'],
          ['line-height', '1'],
          ['cursor', 'pointer'],
          ['opacity', '.7']
        ]));
        rules.push(rule('.glass-modal__close:hover', [['opacity', '1']]));
        rules.push(rule('.glass-modal__title', [['margin', '0'], ['font-size', round(t.size * 1.35, 1) + 'px'], ['font-weight', '700']]));
        rules.push(rule('.glass-modal__text', [['margin', '0'], ['opacity', '.85']]));
        rules.push(rule('.glass-modal__actions', [
          ['display', 'flex'],
          ['gap', '.65rem'],
          ['justify-content', 'flex-end'],
          ['flex-wrap', 'wrap']
        ]));
        buttonRules(state, '.glass-btn').forEach(function (r) { rules.push(r); });
        rules.push(rule('.glass-btn--ghost', [['background', 'transparent'], ['box-shadow', 'none']]));
        var fbm = fallbackRule(state, '.glass-modal');
        if (fbm) rules.push(fbm);
        break;
      }

      case 'profile': {
        rules.push(rule('.glass-profile', glassVars(state).concat(glassSurface()).concat(sizeDecls(state)).concat(typeDecls(state)).concat([
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['align-items', FLEX_H[t.align]],
          ['gap', 'var(--glass-gap)']
        ])));
        rules.push(rule('.glass-profile__avatar', [
          ['width', '72px'],
          ['height', '72px'],
          ['border-radius', '50%'],
          ['object-fit', 'cover'],
          ['border', 'var(--glass-border)']
        ]));
        rules.push(rule('.glass-profile__avatar--initials', [
          ['display', 'grid'],
          ['place-items', 'center'],
          ['background', rgba(state.glass.bgColor, Math.min(1, state.glass.opacity + 0.16))],
          ['font-size', '1.6rem'],
          ['font-weight', '700']
        ]));
        rules.push(rule('.glass-profile__name', [['margin', '0'], ['font-size', round(t.size * 1.3, 1) + 'px'], ['font-weight', '700']]));
        rules.push(rule('.glass-profile__role', [['margin', '0'], ['opacity', '.78'], ['font-size', round(t.size * 0.92, 1) + 'px']]));
        rules.push(rule('.glass-profile__bio', [['margin', '0'], ['opacity', '.85']]));
        rules.push(rule('.glass-profile__link', [
          ['color', 'var(--glass-text)'],
          ['font-weight', '600'],
          ['text-decoration', 'underline'],
          ['text-underline-offset', '3px']
        ]));
        buttonRules(state, '.glass-btn').forEach(function (r) { rules.push(r); });
        var fbp = fallbackRule(state, '.glass-profile');
        if (fbp) rules.push(fbp);
        break;
      }

      case 'pricing': {
        rules.push(rule('.glass-pricing', glassVars(state).concat(glassSurface()).concat(sizeDecls(state)).concat(typeDecls(state)).concat([
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['align-items', FLEX_H[t.align]],
          ['gap', 'var(--glass-gap)']
        ])));
        rules.push(rule('.glass-pricing__plan', [['margin', '0'], ['font-size', round(t.size * 1.15, 1) + 'px'], ['font-weight', '600'], ['opacity', '.85']]));
        rules.push(rule('.glass-pricing__price', [['margin', '0'], ['display', 'flex'], ['align-items', 'baseline'], ['gap', '.25rem']]));
        rules.push(rule('.glass-pricing__amount', [['font-size', round(t.size * 2.6, 1) + 'px'], ['font-weight', '800'], ['letter-spacing', '-.02em']]));
        rules.push(rule('.glass-pricing__period', [['opacity', '.7'], ['font-size', round(t.size * 0.9, 1) + 'px']]));
        rules.push(rule('.glass-pricing__text', [['margin', '0'], ['opacity', '.82']]));
        rules.push(rule('.glass-pricing__features', [
          ['list-style', 'none'],
          ['margin', '0'],
          ['padding', '0'],
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['gap', '.5rem'],
          ['width', '100%']
        ]));
        rules.push(rule('.glass-pricing__features li', [
          ['display', 'flex'],
          ['align-items', 'center'],
          ['gap', '.55rem'],
          ['opacity', '.9']
        ]));
        rules.push(rule('.glass-pricing__features li::before', [
          ['content', '"\\2713"'],
          ['font-weight', '700'],
          ['opacity', '.75']
        ]));
        rules.push(rule('.glass-badge', [
          ['display', 'inline-flex'],
          ['background', rgba(state.glass.bgColor, Math.min(1, state.glass.opacity + 0.14))],
          ['border', 'var(--glass-border)'],
          ['border-radius', '999px'],
          ['color', 'var(--glass-text)'],
          ['font-size', round(t.size * 0.75, 1) + 'px'],
          ['font-weight', '600'],
          ['letter-spacing', '.04em'],
          ['padding', '.3em .85em'],
          ['text-transform', 'uppercase']
        ]));
        buttonRules(state, '.glass-btn').forEach(function (r) { rules.push(r); });
        rules.push(rule('.glass-btn--primary', [['width', '100%']]));
        var fbr = fallbackRule(state, '.glass-pricing');
        if (fbr) rules.push(fbr);
        break;
      }

      default: {
        rules.push(rule('.glass-card', glassVars(state).concat(glassSurface()).concat(sizeDecls(state)).concat(typeDecls(state)).concat([
          ['display', 'flex'],
          ['flex-direction', 'column'],
          ['align-items', FLEX_H[t.align]],
          ['justify-content', FLEX_V[l.alignV]],
          ['gap', 'var(--glass-gap)']
        ])));
        rules.push(rule('.glass-card__title', [
          ['margin', '0'],
          ['font-size', round(t.size * 1.4, 1) + 'px'],
          ['font-weight', '700'],
          ['letter-spacing', '-.01em']
        ]));
        rules.push(rule('.glass-card__text', [['margin', '0'], ['opacity', '.85']]));
        rules.push(rule('.glass-badge', [
          ['display', 'inline-flex'],
          ['background', rgba(state.glass.bgColor, Math.min(1, state.glass.opacity + 0.14))],
          ['border', 'var(--glass-border)'],
          ['border-radius', '999px'],
          ['color', 'var(--glass-text)'],
          ['font-size', round(t.size * 0.75, 1) + 'px'],
          ['font-weight', '600'],
          ['letter-spacing', '.04em'],
          ['padding', '.3em .85em'],
          ['text-transform', 'uppercase']
        ]));
        buttonRules(state, '.glass-btn').forEach(function (r) { rules.push(r); });
        var fbc = fallbackRule(state, '.glass-card');
        if (fbc) rules.push(fbc);
        break;
      }
    }

    return rules;
  }

  /** Scene = the background surface plus the decorative blobs. */
  function sceneRules(state) {
    var bg = state.background;
    var blobs = bg.blobs;
    var rules = [rule('.glass-scene', [
      ['position', 'relative'],
      ['overflow', 'hidden'],
      ['display', 'grid'],
      ['place-items', 'center'],
      ['min-height', '420px'],
      ['padding', '3rem 1.5rem'],
      ['background', backgroundValue(state)],
      ['isolation', 'isolate']
    ])];

    if (blobs.enabled && blobs.count > 0) {
      rules.push(rule('.glass-scene__blob', [
        ['position', 'absolute'],
        ['width', blobs.size + 'px'],
        ['height', blobs.size + 'px'],
        ['border-radius', '50%'],
        ['filter', 'blur(' + blobs.blur + 'px)'],
        ['opacity', String(round(blobs.opacity, 2))],
        ['pointer-events', 'none'],
        ['z-index', '-1']
      ]));
      var spots = [
        { c: blobs.c1, top: '-8%', left: '-6%' },
        { c: blobs.c2, top: '48%', left: '62%' },
        { c: blobs.c3, top: '58%', left: '-10%' },
        { c: blobs.c1, top: '-14%', left: '58%' },
        { c: blobs.c2, top: '22%', left: '30%' },
        { c: blobs.c3, top: '70%', left: '34%' }
      ];
      for (var i = 0; i < blobs.count && i < spots.length; i++) {
        rules.push(rule('.glass-scene__blob--' + (i + 1), [
          ['background', spots[i].c],
          ['top', spots[i].top],
          ['left', spots[i].left]
        ]));
      }
    }
    return rules;
  }

  /* ---------------------------------------------------- rules -> text */

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
      entry.decls.forEach(function (d) {
        out.push(pad + '  ' + d[0] + ': ' + d[1] + ';');
      });
      out.push(pad + '}');
    });

    return out.join('\n');
  }

  /* ======================================================================
     9. Public generators
     ====================================================================== */

  function generateCSS(state, options) {
    var opts = options || {};
    var rules = [];
    if (opts.includeScene || state.background.includeInExport) {
      rules = rules.concat(sceneRules(state));
    }
    rules = rules.concat(componentRules(state));
    return rulesToCSS(rules, opts.scope || '', 0);
  }

  function generateHTML(state) {
    return renderToString(wrapScene(buildTree(state), state), 0);
  }

  function generateFullDocument(state) {
    var title = componentInfo(state.component).label;
    var sceneCSS = rulesToCSS(sceneRules(state), '', 4);
    var componentCSS = rulesToCSS(componentRules(state), '', 4);
    var body = renderToString(buildTree(state), 5);
    var blobs = [];
    if (state.background.blobs.enabled) {
      for (var i = 0; i < state.background.blobs.count; i++) {
        blobs.push('          <span class="glass-scene__blob glass-scene__blob--' + (i + 1) + '" aria-hidden="true"></span>');
      }
    }

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Glassmorphism ' + escapeHtml(title) + '</title>',
      '    <style>',
      '      * { box-sizing: border-box; }',
      '      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }',
      sceneCSS,
      componentCSS,
      '    </style>',
      '  </head>',
      '  <body>',
      '    <div class="glass-scene">',
      blobs.join('\n'),
      body,
      '    </div>',
      '  </body>',
      '</html>',
      ''
    ].filter(function (line) { return line !== ''; }).join('\n');
  }

  /** The values shown in the "Generated properties" inspector. */
  function inspectProperties(state) {
    var list = [
      { prop: 'background', value: glassBackground(state) },
      { prop: 'backdrop-filter', value: backdropFilter(state) },
      { prop: 'border', value: borderValue(state) },
      { prop: 'border-radius', value: radiusValue(state) },
      { prop: 'box-shadow', value: boxShadowValue(state) }
    ];
    if (state.component !== 'badge' && state.component !== 'button') {
      list.push({ prop: 'padding', value: state.layout.padding + 'px' });
    }
    list.push({ prop: 'color', value: state.typography.color });
    return list;
  }

  /* ======================================================================
     10. Presets, intensity, randomiser
     ====================================================================== */

  function applyIntensity(state, level) {
    var preset = INTENSITIES[level];
    if (!preset) return state;
    state.glass.intensity = level;
    state.glass.opacity = preset.opacity;
    state.glass.blur = preset.blur;
    state.glass.saturate = preset.saturate;
    state.glass.brightness = preset.brightness;
    state.border.opacity = preset.borderOpacity;
    state.shadow.preset = preset.shadow;
    return state;
  }

  function applyGlassPreset(state, id) {
    var preset = GLASS_PRESETS[id];
    if (!preset) return state;

    Object.keys(preset.glass).forEach(function (k) { state.glass[k] = preset.glass[k]; });
    state.glass.intensity = 'custom';

    Object.keys(preset.border).forEach(function (k) {
      state.border[k] = preset.border[k];
      if (k === 'radius') {
        state.border.tl = state.border.tr = state.border.br = state.border.bl = preset.border.radius;
      }
    });

    state.shadow.preset = preset.shadow.preset;
    state.shadow.color = preset.shadow.color;
    state.shadow.opacity = preset.shadow.opacity;
    state.shadow.glowLevel = preset.shadow.glowLevel;
    if (preset.shadow.glowColor) state.shadow.glowColor = preset.shadow.glowColor;

    state.typography.color = preset.typography.color;
    return state;
  }

  function applyBackgroundPreset(state, id) {
    var preset = BACKGROUND_PRESETS[id];
    if (!preset) return state;
    Object.keys(preset).forEach(function (k) { state.background[k] = preset[k]; });
    state.background.preset = id;
    return state;
  }

  /**
   * Randomise within readable bounds: opacity, blur and border stay inside
   * ranges that keep text legible, and the text colour is chosen for
   * contrast against the glass rather than at random.
   */
  function randomDesign(state, rng) {
    var rand = rng || Math.random;
    function pick(list) { return list[Math.floor(rand() * list.length)]; }
    function between(lo, hi) { return lo + rand() * (hi - lo); }

    var bgKeys = Object.keys(BACKGROUND_PRESETS).filter(function (k) { return k !== 'minimal'; });
    applyBackgroundPreset(state, pick(bgKeys));

    var tints = ['#ffffff', '#f8fafc', '#e0f2fe', '#ede9fe', '#0b1020', '#0f172a', '#1e1b4b'];
    var tint = pick(tints);
    var dark = luminance(tint) < 0.2;

    state.glass.bgColor = tint;
    state.glass.opacity = dark ? round(between(0.28, 0.48), 2) : round(between(0.1, 0.24), 2);
    state.glass.blur = Math.round(between(10, 34));
    state.glass.saturate = Math.round(between(130, 200));
    state.glass.brightness = Math.round(between(98, 118));
    state.glass.intensity = 'custom';

    state.border.enabled = true;
    state.border.width = pick([1, 1, 1, 1.5, 2]);
    state.border.style = 'solid';
    state.border.color = dark ? '#ffffff' : '#ffffff';
    state.border.opacity = round(between(0.16, 0.42), 2);
    state.border.radius = pick([12, 16, 20, 24, 28, 32]);
    state.border.tl = state.border.tr = state.border.br = state.border.bl = state.border.radius;

    state.shadow.preset = pick(['soft', 'medium', 'medium', 'strong']);
    state.shadow.color = '#0b1020';
    state.shadow.opacity = round(between(0.22, 0.46), 2);
    state.shadow.glowLevel = pick(['none', 'none', 'subtle', 'medium']);
    state.shadow.glowColor = pick(['#a78bfa', '#22d3ee', '#f472b6', '#34d399', '#fb923c']);
    state.shadow.innerEnabled = rand() > 0.4;

    // Text must stay readable on the glass it sits on.
    state.typography.color = contrastRatio('#ffffff', tint) >= contrastRatio('#0b1020', tint)
      ? '#ffffff' : '#0b1020';
    if (!dark) state.typography.color = '#ffffff';

    return state;
  }

  /* ======================================================================
     11. Export
     ====================================================================== */

  global.GlassmorphismEngine = {
    // sanitisers
    escapeHtml: escapeHtml,
    safeHex: safeHex,
    safeUrl: safeUrl,
    safeText: safeText,
    clampNum: clampNum,
    rgba: rgba,
    contrastRatio: contrastRatio,
    luminance: luminance,
    // state
    defaultState: defaultState,
    normalize: normalize,
    cloneState: cloneState,
    // derived values
    glassBackground: glassBackground,
    backdropFilter: backdropFilter,
    borderValue: borderValue,
    radiusValue: radiusValue,
    boxShadowValue: boxShadowValue,
    backgroundValue: backgroundValue,
    fontStack: fontStack,
    // trees & rendering
    buildTree: buildTree,
    wrapScene: wrapScene,
    renderToString: renderToString,
    renderToDOM: renderToDOM,
    componentRules: componentRules,
    sceneRules: sceneRules,
    rulesToCSS: rulesToCSS,
    // generators
    generateCSS: generateCSS,
    generateHTML: generateHTML,
    generateFullDocument: generateFullDocument,
    inspectProperties: inspectProperties,
    // presets
    applyIntensity: applyIntensity,
    applyGlassPreset: applyGlassPreset,
    applyBackgroundPreset: applyBackgroundPreset,
    randomDesign: randomDesign,
    // constants
    COMPONENTS: COMPONENTS,
    FONTS: FONTS,
    INTENSITIES: INTENSITIES,
    GLASS_PRESETS: GLASS_PRESETS,
    GLASS_PRESET_IDS: GLASS_PRESET_IDS,
    BACKGROUND_PRESETS: BACKGROUND_PRESETS,
    BACKGROUND_PRESET_LABELS: BACKGROUND_PRESET_LABELS,
    SHADOW_PRESETS: SHADOW_PRESETS,
    GLOW_LEVELS: GLOW_LEVELS
  };

})(typeof window !== 'undefined' ? window : this);
