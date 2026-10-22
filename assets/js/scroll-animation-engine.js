/* ==========================================================================
   ToolAdda — Scroll Animation Engine

   Pure, dependency-free logic behind the Scroll Animation Keyframe Builder.

   The tool generates two genuinely different things from one set of
   keyframes, because the platform is mid-transition:

     • CSS scroll-driven animations (`animation-timeline: view()` /
       `scroll()`), which need no JavaScript at all but only work in
       Chromium-based browsers and recent Firefox.

     • A classic IntersectionObserver reveal, which works everywhere but
       fires once and is not tied to scroll position.

   The live preview does NOT rely on either. It interpolates the keyframes
   in JavaScript at a given progress, so the preview is identical in every
   browser and — importantly — is deterministic enough to test. The maths
   mirrors what a browser does: find the surrounding keyframe pair, ease
   the segment progress, then interpolate each property linearly.

   Every user value is sanitised: numbers are clamped, easings and modes
   come from allow-lists, identifiers are reduced to a safe CSS name and
   all text is escaped on the way into markup.
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

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) n = typeof fallback === 'number' ? fallback : lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  /* Strip control characters, keeping tab and newline, and cap the length.
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

  /**
   * Reduce anything to a safe CSS identifier. The animation name is written
   * straight into `@keyframes` and a class selector, so it must not be able
   * to carry braces, spaces or a closing brace.
   */
  function safeIdent(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 40);
    if (!s || /^[0-9-]/.test(s)) s = (fallback || 'scroll-reveal');
    return s;
  }

  function round(n, places) {
    var f = Math.pow(10, places === undefined ? 3 : places);
    return Math.round(n * f) / f;
  }

  /* ======================================================================
     2. Easing
     ====================================================================== */

  var EASINGS = {
    linear: { label: 'Linear', css: 'linear', points: [0, 0, 1, 1] },
    ease: { label: 'Ease', css: 'ease', points: [0.25, 0.1, 0.25, 1] },
    'ease-in': { label: 'Ease in', css: 'ease-in', points: [0.42, 0, 1, 1] },
    'ease-out': { label: 'Ease out', css: 'ease-out', points: [0, 0, 0.58, 1] },
    'ease-in-out': { label: 'Ease in out', css: 'ease-in-out', points: [0.42, 0, 0.58, 1] },
    'soft-out': { label: 'Soft out', css: 'cubic-bezier(0.16, 1, 0.3, 1)', points: [0.16, 1, 0.3, 1] },
    'snappy': { label: 'Snappy', css: 'cubic-bezier(0.34, 1.56, 0.64, 1)', points: [0.34, 1.56, 0.64, 1] },
    'gentle': { label: 'Gentle', css: 'cubic-bezier(0.4, 0, 0.2, 1)', points: [0.4, 0, 0.2, 1] }
  };
  var EASING_IDS = Object.keys(EASINGS);

  /**
   * Evaluate a cubic-bezier timing function at x.
   * Newton-Raphson with a bisection fallback, which is what browsers use.
   */
  function cubicBezier(p1x, p1y, p2x, p2y) {
    function A(a1, a2) { return 1 - 3 * a2 + 3 * a1; }
    function B(a1, a2) { return 3 * a2 - 6 * a1; }
    function C(a1) { return 3 * a1; }
    function calc(t, a1, a2) { return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t; }
    function slope(t, a1, a2) { return 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1); }

    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      if (p1x === p1y && p2x === p2y) return x; // linear

      var t = x;
      for (var i = 0; i < 8; i++) {
        var currentSlope = slope(t, p1x, p2x);
        if (currentSlope === 0) break;
        var currentX = calc(t, p1x, p2x) - x;
        t -= currentX / currentSlope;
      }

      // Guard the Newton result; fall back to bisection when it drifts.
      if (t < 0 || t > 1) {
        var lo = 0, hi = 1;
        t = x;
        for (var j = 0; j < 24; j++) {
          var cx = calc(t, p1x, p2x);
          if (Math.abs(cx - x) < 1e-6) break;
          if (cx > x) hi = t; else lo = t;
          t = (lo + hi) / 2;
        }
      }
      return calc(t, p1y, p2y);
    };
  }

  function easingFunction(id) {
    var e = EASINGS[id] || EASINGS.linear;
    return cubicBezier(e.points[0], e.points[1], e.points[2], e.points[3]);
  }

  function easingCSS(id) { return (EASINGS[id] || EASINGS.linear).css; }

  /* ======================================================================
     3. Constants
     ====================================================================== */

  var MODES = [
    { id: 'view', label: 'Scroll-driven — view()', needsJS: false },
    { id: 'scroll', label: 'Scroll-driven — scroll()', needsJS: false },
    { id: 'observer', label: 'IntersectionObserver (works everywhere)', needsJS: true }
  ];
  var MODE_IDS = MODES.map(function (m) { return m.id; });

  var RANGE_NAMES = ['entry', 'exit', 'cover', 'contain', 'entry-crossing', 'exit-crossing'];
  var FILL_MODES = ['both', 'forwards', 'backwards', 'none'];
  var DIRECTIONS = ['normal', 'reverse', 'alternate'];
  var AXES = ['block', 'inline', 'y', 'x'];

  var DEMOS = [
    { id: 'card', label: 'Card' },
    { id: 'heading', label: 'Heading' },
    { id: 'image', label: 'Image block' },
    { id: 'list', label: 'Staggered list' },
    { id: 'progress', label: 'Progress bar' }
  ];
  var DEMO_IDS = DEMOS.map(function (d) { return d.id; });

  /* Every property a keyframe can carry, with its clamp range and unit. */
  var TRACKS = [
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '', neutral: 1 },
    { key: 'x', label: 'Translate X', min: -400, max: 400, step: 1, unit: 'px', neutral: 0 },
    { key: 'y', label: 'Translate Y', min: -400, max: 400, step: 1, unit: 'px', neutral: 0 },
    { key: 'scale', label: 'Scale', min: 0, max: 3, step: 0.01, unit: '', neutral: 1 },
    { key: 'rotate', label: 'Rotate', min: -360, max: 360, step: 1, unit: 'deg', neutral: 0 },
    { key: 'blur', label: 'Blur', min: 0, max: 40, step: 0.5, unit: 'px', neutral: 0 }
  ];
  var TRACK_KEYS = TRACKS.map(function (t) { return t.key; });

  function neutralFrame(at) {
    var f = { at: at };
    TRACKS.forEach(function (t) { f[t.key] = t.neutral; });
    return f;
  }

  function frame(at, overrides) {
    var f = neutralFrame(at);
    Object.keys(overrides || {}).forEach(function (k) { if (k in f) f[k] = overrides[k]; });
    return f;
  }

  /* Fifteen presets covering the patterns people actually ship. */
  var PRESETS = {
    'fade-in': { label: 'Fade in', keyframes: [frame(0, { opacity: 0 }), frame(100, {})] },
    'fade-up': { label: 'Fade up', keyframes: [frame(0, { opacity: 0, y: 48 }), frame(100, {})] },
    'fade-down': { label: 'Fade down', keyframes: [frame(0, { opacity: 0, y: -48 }), frame(100, {})] },
    'slide-left': { label: 'Slide from left', keyframes: [frame(0, { opacity: 0, x: -80 }), frame(100, {})] },
    'slide-right': { label: 'Slide from right', keyframes: [frame(0, { opacity: 0, x: 80 }), frame(100, {})] },
    'zoom-in': { label: 'Zoom in', keyframes: [frame(0, { opacity: 0, scale: 0.85 }), frame(100, {})] },
    'zoom-out': { label: 'Zoom out', keyframes: [frame(0, { opacity: 0, scale: 1.18 }), frame(100, {})] },
    'blur-in': { label: 'Blur in', keyframes: [frame(0, { opacity: 0, blur: 14 }), frame(100, {})] },
    'rotate-in': { label: 'Rotate in', keyframes: [frame(0, { opacity: 0, rotate: -12, scale: 0.92 }), frame(100, {})] },
    'flip-up': { label: 'Flip up', keyframes: [frame(0, { opacity: 0, rotate: 8, y: 60 }), frame(100, {})] },
    'pop': { label: 'Pop', keyframes: [frame(0, { opacity: 0, scale: 0.7 }), frame(70, { opacity: 1, scale: 1.06 }), frame(100, {})] },
    'drift-through': { label: 'Drift through', keyframes: [frame(0, { opacity: 0, y: 60 }), frame(50, {}), frame(100, { opacity: 0, y: -60 })] },
    'parallax': { label: 'Parallax', keyframes: [frame(0, { y: 80 }), frame(100, { y: -80 })] },
    'progress-bar': { label: 'Progress bar', keyframes: [frame(0, { scale: 0 }), frame(100, { scale: 1 })] },
    'sticky-scale': { label: 'Sticky scale', keyframes: [frame(0, { scale: 0.86 }), frame(100, { scale: 1 })] }
  };
  var PRESET_IDS = Object.keys(PRESETS);

  /* ======================================================================
     4. Default state
     ====================================================================== */

  function defaultState() {
    return {
      version: 1,
      mode: 'view',
      preset: 'fade-up',
      demo: 'card',
      name: 'fade-up',
      keyframes: [frame(0, { opacity: 0, y: 48 }), frame(100, {})],
      timeline: {
        rangeStartName: 'entry',
        rangeStartPct: 0,
        rangeEndName: 'cover',
        rangeEndPct: 40,
        axis: 'block'
      },
      animation: {
        easing: 'soft-out',
        duration: 0.8,
        delay: 0,
        fill: 'both',
        direction: 'normal',
        iterations: 1
      },
      stagger: { enabled: false, count: 4, step: 0.12 },
      options: {
        reducedMotion: true,
        supportsFallback: true,
        transformOriginLeft: false
      },
      preview: { progress: 0, autoplay: true },
      content: {
        title: 'Scroll to reveal',
        text: 'This block animates as it enters the viewport.',
        listItems: 'Design\nBuild\nMeasure\nRepeat'
      }
    };
  }

  /* ======================================================================
     5. Normalising
     ====================================================================== */

  function normalizeFrame(input, fallbackAt) {
    var f = { at: Math.round(clampNum(input && input.at, 0, 100, fallbackAt || 0)) };
    TRACKS.forEach(function (t) {
      var v = input ? input[t.key] : undefined;
      f[t.key] = round(clampNum(v, t.min, t.max, t.neutral), 3);
    });
    return f;
  }

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};
    function sec(n) { return (s[n] && typeof s[n] === 'object') ? s[n] : {}; }

    var tl = sec('timeline');
    var an = sec('animation');
    var stg = sec('stagger');
    var op = sec('options');
    var pv = sec('preview');
    var c = sec('content');

    var frames = Array.isArray(s.keyframes) && s.keyframes.length
      ? s.keyframes.map(function (f, i) { return normalizeFrame(f, i === 0 ? 0 : 100); })
      : d.keyframes.map(function (f) { return normalizeFrame(f); });

    /* Keyframes must be ordered and unique on `at`, or the generated
       @keyframes block would contain contradictory stops. */
    frames.sort(function (a, b) { return a.at - b.at; });
    var seen = {};
    frames = frames.filter(function (f) {
      if (seen[f.at]) return false;
      seen[f.at] = true;
      return true;
    });
    if (frames.length < 2) {
      frames = [normalizeFrame(frames[0] || {}, 0), normalizeFrame({ at: 100 }, 100)];
      frames[0].at = 0;
    }
    if (frames.length > 12) frames = frames.slice(0, 12);

    return {
      version: 1,
      mode: oneOf(s.mode, MODE_IDS, d.mode),
      preset: oneOf(s.preset, PRESET_IDS.concat(['custom']), d.preset),
      demo: oneOf(s.demo, DEMO_IDS, d.demo),
      name: safeIdent(s.name, 'scroll-reveal'),
      keyframes: frames,
      timeline: {
        rangeStartName: oneOf(tl.rangeStartName, RANGE_NAMES, d.timeline.rangeStartName),
        rangeStartPct: Math.round(clampNum(tl.rangeStartPct, 0, 100, d.timeline.rangeStartPct)),
        rangeEndName: oneOf(tl.rangeEndName, RANGE_NAMES, d.timeline.rangeEndName),
        rangeEndPct: Math.round(clampNum(tl.rangeEndPct, 0, 100, d.timeline.rangeEndPct)),
        axis: oneOf(tl.axis, AXES, d.timeline.axis)
      },
      animation: {
        easing: oneOf(an.easing, EASING_IDS, d.animation.easing),
        duration: round(clampNum(an.duration, 0.05, 6, d.animation.duration), 2),
        delay: round(clampNum(an.delay, 0, 4, d.animation.delay), 2),
        fill: oneOf(an.fill, FILL_MODES, d.animation.fill),
        direction: oneOf(an.direction, DIRECTIONS, d.animation.direction),
        iterations: Math.round(clampNum(an.iterations, 1, 20, d.animation.iterations))
      },
      stagger: {
        enabled: stg.enabled === undefined ? d.stagger.enabled : !!stg.enabled,
        count: Math.round(clampNum(stg.count, 2, 12, d.stagger.count)),
        step: round(clampNum(stg.step, 0.02, 1, d.stagger.step), 2)
      },
      options: {
        reducedMotion: op.reducedMotion === undefined ? d.options.reducedMotion : !!op.reducedMotion,
        supportsFallback: op.supportsFallback === undefined ? d.options.supportsFallback : !!op.supportsFallback,
        transformOriginLeft: op.transformOriginLeft === undefined ? d.options.transformOriginLeft : !!op.transformOriginLeft
      },
      preview: {
        progress: round(clampNum(pv.progress, 0, 1, d.preview.progress), 4),
        autoplay: pv.autoplay === undefined ? d.preview.autoplay : !!pv.autoplay
      },
      content: {
        title: safeText(c.title === undefined ? d.content.title : c.title, 90),
        text: safeText(c.text === undefined ? d.content.text : c.text, 220),
        listItems: safeText(c.listItems === undefined ? d.content.listItems : c.listItems, 240)
      }
    };
  }

  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

  /* ======================================================================
     6. Interpolation — what the preview draws
     ====================================================================== */

  /**
   * Values at a given progress (0..1), matching what a browser would paint:
   * locate the surrounding keyframe pair, ease the segment, then lerp.
   */
  function valuesAt(state, progress) {
    var frames = state.keyframes;
    var p = clampNum(progress, 0, 1, 0) * 100;
    var ease = easingFunction(state.animation.easing);

    if (p <= frames[0].at) return pick(frames[0]);
    if (p >= frames[frames.length - 1].at) return pick(frames[frames.length - 1]);

    var lower = frames[0];
    var upper = frames[frames.length - 1];
    for (var i = 0; i < frames.length - 1; i++) {
      if (p >= frames[i].at && p <= frames[i + 1].at) {
        lower = frames[i];
        upper = frames[i + 1];
        break;
      }
    }

    var span = upper.at - lower.at;
    var local = span === 0 ? 0 : (p - lower.at) / span;
    var eased = ease(local);

    var out = {};
    TRACK_KEYS.forEach(function (k) {
      out[k] = round(lower[k] + (upper[k] - lower[k]) * eased, 4);
    });
    return out;
  }

  function pick(f) {
    var out = {};
    TRACK_KEYS.forEach(function (k) { out[k] = f[k]; });
    return out;
  }

  /** Turn a value set into the inline style the preview applies. */
  function styleFor(values) {
    var parts = [];
    if (values.x !== 0 || values.y !== 0) {
      parts.push('translate3d(' + round(values.x, 2) + 'px, ' + round(values.y, 2) + 'px, 0)');
    }
    if (values.scale !== 1) parts.push('scale(' + round(values.scale, 3) + ')');
    if (values.rotate !== 0) parts.push('rotate(' + round(values.rotate, 2) + 'deg)');
    return {
      opacity: String(round(values.opacity, 3)),
      transform: parts.length ? parts.join(' ') : 'none',
      filter: values.blur > 0 ? 'blur(' + round(values.blur, 2) + 'px)' : 'none'
    };
  }

  /* ======================================================================
     7. CSS generation
     ====================================================================== */

  function frameDeclarations(f) {
    var decls = [];
    var transform = [];
    if (f.x !== 0 || f.y !== 0) {
      transform.push('translate3d(' + round(f.x, 2) + 'px, ' + round(f.y, 2) + 'px, 0)');
    }
    if (f.scale !== 1) transform.push('scale(' + round(f.scale, 3) + ')');
    if (f.rotate !== 0) transform.push('rotate(' + round(f.rotate, 2) + 'deg)');

    decls.push(['opacity', String(round(f.opacity, 3))]);
    decls.push(['transform', transform.length ? transform.join(' ') : 'none']);
    if (f.blur > 0) decls.push(['filter', 'blur(' + round(f.blur, 2) + 'px)']);
    return decls;
  }

  function keyframesCSS(state) {
    var lines = ['@keyframes ' + state.name + ' {'];
    state.keyframes.forEach(function (f) {
      lines.push('  ' + f.at + '% {');
      frameDeclarations(f).forEach(function (d) { lines.push('    ' + d[0] + ': ' + d[1] + ';'); });
      lines.push('  }');
    });
    lines.push('}');
    return lines.join('\n');
  }

  function animationRange(state) {
    var t = state.timeline;
    return t.rangeStartName + ' ' + t.rangeStartPct + '% ' + t.rangeEndName + ' ' + t.rangeEndPct + '%';
  }

  /** The neutral state an element must fall back to when the animation cannot run. */
  function restingDeclarations() {
    return [
      ['animation', 'none'],
      ['opacity', '1'],
      ['transform', 'none'],
      ['filter', 'none']
    ];
  }

  function block(selector, decls, indent) {
    var pad = new Array((indent || 0) + 1).join('  ');
    var out = [pad + selector + ' {'];
    decls.forEach(function (d) { out.push(pad + '  ' + d[0] + ': ' + d[1] + ';'); });
    out.push(pad + '}');
    return out.join('\n');
  }

  function generateCSS(state) {
    var name = state.name;
    var cls = '.' + name;
    var a = state.animation;
    var parts = [keyframesCSS(state), ''];

    if (state.mode === 'observer') {
      var base = [
        ['opacity', String(round(state.keyframes[0].opacity, 3))],
        ['will-change', 'opacity, transform']
      ];
      if (state.options.transformOriginLeft) base.push(['transform-origin', 'left center']);
      parts.push(block(cls, base));
      parts.push('');
      parts.push(block(cls + '.is-visible', [
        ['animation', name + ' ' + a.duration + 's ' + easingCSS(a.easing) + ' ' + a.delay + 's ' +
          (a.iterations > 1 ? a.iterations + ' ' : '') + a.direction + ' ' + a.fill]
      ]));
    } else {
      var decls = [
        ['animation', name + ' linear ' + a.fill],
        ['animation-timeline', state.mode === 'view' ? 'view(' + state.timeline.axis + ')' : 'scroll(root ' + state.timeline.axis + ')']
      ];
      if (state.mode === 'view') decls.push(['animation-range', animationRange(state)]);
      if (state.options.transformOriginLeft) decls.push(['transform-origin', 'left center']);
      parts.push(block(cls, decls));

      if (state.options.supportsFallback) {
        parts.push('');
        parts.push('/* Safari and older browsers have no scroll timelines: show the');
        parts.push('   finished state rather than leaving the element invisible. */');
        parts.push('@supports not (animation-timeline: view()) {');
        parts.push(block(cls, restingDeclarations(), 1));
        parts.push('}');
      }
    }

    if (state.stagger.enabled) {
      parts.push('');
      parts.push('/* Stagger: each child starts a little later than the one before. */');
      for (var i = 1; i <= state.stagger.count; i++) {
        var delay = round(a.delay + (i - 1) * state.stagger.step, 3);
        if (state.mode === 'observer') {
          parts.push(block(cls + ':nth-child(' + i + ').is-visible', [['animation-delay', delay + 's']]));
        } else {
          var offset = round((i - 1) * state.stagger.step * 100, 1);
          parts.push(block(cls + ':nth-child(' + i + ')', [
            ['animation-range', state.timeline.rangeStartName + ' ' + round(state.timeline.rangeStartPct + offset, 1) + '% ' +
              state.timeline.rangeEndName + ' ' + round(Math.min(100, state.timeline.rangeEndPct + offset), 1) + '%']
          ]));
        }
      }
    }

    if (state.options.reducedMotion) {
      parts.push('');
      parts.push('/* Motion is decorative here, so honour the system preference. */');
      parts.push('@media (prefers-reduced-motion: reduce) {');
      parts.push(block(cls + ', ' + cls + '.is-visible', restingDeclarations(), 1));
      parts.push('}');
    }

    return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ======================================================================
     8. HTML & JS generation
     ====================================================================== */

  function listItems(state) {
    return String(state.content.listItems || '')
      .split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12);
  }

  function generateHTML(state) {
    var name = escapeHtml(state.name);
    var c = state.content;

    switch (state.demo) {
      case 'heading':
        return '<h2 class="' + name + '">' + escapeHtml(c.title) + '</h2>';

      case 'image':
        return '<figure class="' + name + '">\n' +
          '  <img src="photo.jpg" alt="" width="640" height="360" />\n' +
          '  <figcaption>' + escapeHtml(c.title) + '</figcaption>\n' +
          '</figure>';

      case 'list': {
        var items = listItems(state);
        return '<ul class="reveal-list">\n' + items.map(function (item) {
          return '  <li class="' + name + '">' + escapeHtml(item) + '</li>';
        }).join('\n') + '\n</ul>';
      }

      case 'progress':
        return '<div class="progress-track">\n' +
          '  <div class="' + name + ' progress-bar"></div>\n' +
          '</div>';

      default:
        return '<article class="' + name + '">\n' +
          '  <h2>' + escapeHtml(c.title) + '</h2>\n' +
          '  <p>' + escapeHtml(c.text) + '</p>\n' +
          '</article>';
    }
  }

  /** Only the observer mode needs script; the CSS modes are script-free. */
  function generateJS(state) {
    if (state.mode !== 'observer') return '';
    return [
      '// Adds .is-visible once the element scrolls into view, then stops watching it.',
      '// Elements are revealed immediately when IntersectionObserver is unavailable',
      '// or the visitor prefers reduced motion.',
      'const targets = document.querySelectorAll(".' + state.name + '");',
      'const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;',
      '',
      'if (reduced || !("IntersectionObserver" in window)) {',
      '  targets.forEach((el) => el.classList.add("is-visible"));',
      '} else {',
      '  const observer = new IntersectionObserver((entries) => {',
      '    entries.forEach((entry) => {',
      '      if (!entry.isIntersecting) return;',
      '      entry.target.classList.add("is-visible");',
      '      observer.unobserve(entry.target);',
      '    });',
      '  }, { threshold: 0.2, rootMargin: "0px 0px -10% 0px" });',
      '',
      '  targets.forEach((el) => observer.observe(el));',
      '}',
      ''
    ].join('\n');
  }

  function generateFullDocument(state) {
    var css = generateCSS(state);
    var body = generateHTML(state);
    var js = generateJS(state);

    var lines = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Scroll animation demo</title>',
      '    <style>',
      '      * { box-sizing: border-box; }',
      '      body { margin: 0; font-family: system-ui, sans-serif; color: #0f172a; background: #f8fafc; }',
      '      .spacer { height: 90vh; display: grid; place-items: center; color: #94a3b8; }',
      '      .stage { max-width: 640px; margin: 0 auto; padding: 0 1.5rem 60vh; }',
      '      article { background: #fff; border-radius: 16px; padding: 2rem; box-shadow: 0 10px 30px rgba(15,23,42,.08); }',
      '      .reveal-list { list-style: none; padding: 0; display: grid; gap: .75rem; }',
      '      .reveal-list li { background: #fff; border-radius: 12px; padding: 1rem 1.25rem; box-shadow: 0 6px 18px rgba(15,23,42,.06); }',
      '      .progress-track { position: sticky; top: 0; height: 6px; background: #e2e8f0; }',
      '      .progress-bar { height: 100%; background: #db2777; transform-origin: left center; }',
      '',
      css.split('\n').map(function (l) { return l ? '      ' + l : ''; }).join('\n'),
      '    </style>',
      '  </head>',
      '  <body>',
      '    <div class="spacer">Scroll down</div>',
      '    <div class="stage">',
      body.split('\n').map(function (l) { return '      ' + l; }).join('\n'),
      '    </div>'
    ];

    if (js) {
      lines.push('    <script>');
      lines.push(js.split('\n').map(function (l) { return l ? '      ' + l : ''; }).join('\n'));
      lines.push('    </' + 'script>');
    }

    lines.push('  </body>');
    lines.push('</html>');
    lines.push('');
    return lines.join('\n');
  }

  /* ======================================================================
     9. Support reporting — honest about where each mode works
     ====================================================================== */

  function supportNotes(state) {
    var notes = [];

    if (state.mode === 'view' || state.mode === 'scroll') {
      notes.push({
        level: 'info',
        text: 'CSS scroll-driven animations need no JavaScript, but support is not universal — Chrome and Edge 115+ and recent Firefox have it, Safari does not yet.'
      });
      notes.push({
        level: state.options.supportsFallback ? 'pass' : 'warn',
        text: state.options.supportsFallback
          ? 'An @supports fallback is included, so unsupported browsers show the finished state instead of an invisible element.'
          : 'No fallback is generated. In a browser without scroll timelines the element keeps its first keyframe — if that is opacity 0, the content is invisible.'
      });
    } else {
      notes.push({
        level: 'pass',
        text: 'IntersectionObserver works in every current browser, and the generated script reveals everything immediately where it is missing.'
      });
      notes.push({
        level: 'info',
        text: 'This mode fires once when the element enters view. It is a reveal, not a scroll-linked timeline — scrolling back up will not rewind it.'
      });
    }

    notes.push({
      level: state.options.reducedMotion ? 'pass' : 'warn',
      text: state.options.reducedMotion
        ? 'A prefers-reduced-motion block is included, so visitors who ask for less motion see the finished state.'
        : 'No prefers-reduced-motion block. Scroll animations can trigger nausea and migraine for some visitors — this one is worth keeping.'
    });

    var first = state.keyframes[0];
    if (first.opacity === 0 && state.mode !== 'observer' && !state.options.supportsFallback) {
      notes.push({
        level: 'fail',
        text: 'The first keyframe is fully transparent and there is no fallback, so this content would be permanently invisible in Safari.'
      });
    }

    var moves = state.keyframes.some(function (f) {
      return Math.abs(f.x) > 200 || Math.abs(f.y) > 200 || Math.abs(f.rotate) > 90;
    });
    if (moves) {
      notes.push({ level: 'warn', text: 'Large travel or rotation can cause horizontal overflow and reads as heavy motion. Check the page on a narrow screen.' });
    }

    return notes;
  }

  /* ======================================================================
     10. Presets & keyframe editing
     ====================================================================== */

  function applyPreset(state, id) {
    var p = PRESETS[id];
    if (!p) return state;
    state.preset = id;
    state.name = safeIdent(id, 'scroll-reveal');
    state.keyframes = p.keyframes.map(function (f) { return normalizeFrame(f); });
    if (id === 'progress-bar') {
      state.mode = 'scroll';
      state.demo = 'progress';
      state.options.transformOriginLeft = true;
    }
    if (id === 'parallax' || id === 'drift-through' || id === 'sticky-scale') {
      state.timeline.rangeStartName = 'cover';
      state.timeline.rangeStartPct = 0;
      state.timeline.rangeEndName = 'cover';
      state.timeline.rangeEndPct = 100;
    }
    return state;
  }

  function addKeyframe(state, at) {
    var target = Math.round(clampNum(at, 0, 100, 50));
    if (state.keyframes.some(function (f) { return f.at === target; })) return state;
    // A new stop starts from the interpolated value, so adding one changes nothing visually.
    var values = valuesAt(state, target / 100);
    var f = { at: target };
    TRACK_KEYS.forEach(function (k) { f[k] = values[k]; });
    state.keyframes.push(normalizeFrame(f));
    state.keyframes.sort(function (a, b) { return a.at - b.at; });
    state.preset = 'custom';
    return state;
  }

  function removeKeyframe(state, index) {
    if (state.keyframes.length <= 2) return state;
    if (index < 0 || index >= state.keyframes.length) return state;
    state.keyframes.splice(index, 1);
    state.preset = 'custom';
    return state;
  }

  /* ======================================================================
     11. Export
     ====================================================================== */

  global.ScrollAnimationEngine = {
    escapeHtml: escapeHtml,
    safeText: safeText,
    safeIdent: safeIdent,
    clampNum: clampNum,

    cubicBezier: cubicBezier,
    easingFunction: easingFunction,
    easingCSS: easingCSS,

    defaultState: defaultState,
    normalize: normalize,
    normalizeFrame: normalizeFrame,
    cloneState: cloneState,

    valuesAt: valuesAt,
    styleFor: styleFor,

    keyframesCSS: keyframesCSS,
    animationRange: animationRange,
    generateCSS: generateCSS,
    generateHTML: generateHTML,
    generateJS: generateJS,
    generateFullDocument: generateFullDocument,
    supportNotes: supportNotes,

    applyPreset: applyPreset,
    addKeyframe: addKeyframe,
    removeKeyframe: removeKeyframe,

    MODES: MODES,
    MODE_IDS: MODE_IDS,
    RANGE_NAMES: RANGE_NAMES,
    FILL_MODES: FILL_MODES,
    DIRECTIONS: DIRECTIONS,
    AXES: AXES,
    DEMOS: DEMOS,
    DEMO_IDS: DEMO_IDS,
    TRACKS: TRACKS,
    TRACK_KEYS: TRACK_KEYS,
    EASINGS: EASINGS,
    EASING_IDS: EASING_IDS,
    PRESETS: PRESETS,
    PRESET_IDS: PRESET_IDS
  };

})(typeof window !== 'undefined' ? window : this);
