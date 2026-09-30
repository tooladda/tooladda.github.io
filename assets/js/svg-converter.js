/* ============================================================
   ToolAdda — SVG to PNG / JPG / WebP Converter

   Every conversion happens locally: SVG -> sanitized SVG -> Blob
   URL -> <img> -> <canvas> -> Blob. Nothing is uploaded.

   Security model: uploaded SVG is untrusted input. Rather than
   removing dangerous nodes from the parsed tree (easy to miss one),
   sanitizeSvgDocument() walks the source tree and builds a BRAND
   NEW tree, copying over only elements and attributes on an
   allowlist. Anything not explicitly allowed is simply never
   created in the output — script tags, event handlers, foreignObject
   and external resource references included. The result is then
   only ever loaded through <img src="blob:...">, which browsers
   render as a "static SVG image" — script execution and external
   resource loading are disabled by the image context itself,
   layered on top of the sanitizer rather than relied on alone.

   Layout:
     1.  Pure helpers — dimension parsing, quality, filenames
        (framework-free, covered by the Node test suite)
     2.  Href / CSS classification (pure)
     3.  DOCTYPE stripping (pure)
     4.  DOM sanitizer (browser only)
     5.  Rasterization (browser only)
     6.  Format capability detection
     7.  Engine export
     8.  Application state
     9.  DOM cache
     10. Queue management
     11. File intake (upload / drop / paste)
     12. Rendering — single-file workspace
     13. Rendering — batch table
     14. Conversion pipeline
     15. Download / ZIP
     16. Settings, compare slider, theme, keyboard, init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ---------------------------------------------------------
     1. PURE HELPERS
     --------------------------------------------------------- */

  function parseLength(raw) {
    if (typeof raw !== 'string') return null;
    var trimmed = raw.trim();
    if (!trimmed || trimmed.indexOf('%') !== -1) return null;
    var match = /^(-?[0-9]*\.?[0-9]+)(px)?$/i.exec(trimmed);
    if (!match) return null;
    var n = parseFloat(match[1]);
    if (!isFinite(n) || n <= 0) return null;
    return n;
  }

  function parseViewBox(raw) {
    if (typeof raw !== 'string') return null;
    var parts = raw.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(function (n) { return !isFinite(n); })) return null;
    var width = parts[2];
    var height = parts[3];
    if (width <= 0 || height <= 0) return null;
    return { minX: parts[0], minY: parts[1], width: width, height: height };
  }

  /**
   * Determines the SVG's natural size from its width/height/viewBox
   * attributes, following the same fallback order a browser would:
   * explicit width+height wins, then a viewBox combined with
   * whichever single dimension is given, then viewBox alone, then
   * whatever single dimension exists with no derivable ratio.
   */
  function detectDimensions(attrs) {
    var a = attrs || {};
    var w = parseLength(a.width);
    var h = parseLength(a.height);
    var vb = parseViewBox(a.viewBox);

    if (w !== null && h !== null) {
      return { width: w, height: h, ratio: w / h, viewBox: vb, source: 'width-height' };
    }
    if (vb) {
      var ratio = vb.width / vb.height;
      if (w !== null) return { width: w, height: w / ratio, ratio: ratio, viewBox: vb, source: 'width-viewbox' };
      if (h !== null) return { width: h * ratio, height: h, ratio: ratio, viewBox: vb, source: 'height-viewbox' };
      return { width: vb.width, height: vb.height, ratio: ratio, viewBox: vb, source: 'viewbox' };
    }
    if (w !== null) return { width: w, height: null, ratio: null, viewBox: null, source: 'width-only' };
    if (h !== null) return { width: null, height: h, ratio: null, viewBox: null, source: 'height-only' };
    return { width: null, height: null, ratio: null, viewBox: null, source: 'none' };
  }

  /** Given one changed dimension and a width/height ratio, returns the other. */
  function lockedDimension(changedField, value, ratio) {
    if (!ratio || !isFinite(ratio) || ratio <= 0) return null;
    var v = Number(value);
    if (!isFinite(v) || v <= 0) return null;
    return changedField === 'width' ? v / ratio : v * ratio;
  }

  var MAX_OUTPUT_DIMENSION = 8192;
  var MAX_OUTPUT_AREA = 40000000; /* ~40 MP — comfortably under browser canvas limits */
  var LARGE_SVG_BYTES = 2 * 1024 * 1024;

  function clampOutputDimension(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v) || v <= 0) return { value: 1, clamped: true };
    if (v > MAX_OUTPUT_DIMENSION) return { value: MAX_OUTPUT_DIMENSION, clamped: true };
    return { value: v, clamped: false };
  }

  function exceedsSafeArea(width, height) {
    return width * height > MAX_OUTPUT_AREA;
  }

  function clampQuality(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v)) return 90;
    return Math.min(100, Math.max(1, v));
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    var value = bytes / Math.pow(1024, power);
    var decimals = power === 0 ? 0 : (value < 10 ? 2 : 1);
    return value.toFixed(decimals) + ' ' + units[power];
  }

  function stripExtension(name) {
    var idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
  }

  /**
   * Strips path separators, traversal sequences and characters that
   * are reserved on Windows filesystems, so a downloaded file can
   * never escape the browser's download directory or collide with
   * reserved device names.
   */
  function sanitizeFilename(name, fallback) {
    var base = String(name || '').trim();
    base = base.replace(/[\\/]/g, '-');
    base = base.replace(/^\.+/, '');
    base = base.replace(/\.\.+/g, '-');
    base = base.replace(/[\x00-\x1f<>:"|?*]/g, '');
    base = base.trim();
    if (!base) base = fallback || 'converted';
    return base.slice(0, 120);
  }

  function isLikelySvgText(text) {
    if (typeof text !== 'string' || !text.trim()) return false;
    var sample = text.slice(0, 4000);
    return /<svg[\s>]/i.test(sample) && /<\/svg\s*>/.test(text);
  }

  /* ---------------------------------------------------------
     2. HREF / CSS CLASSIFICATION
     --------------------------------------------------------- */

  /**
   * Decides whether a href/xlink:href value is safe to keep. Only an
   * in-document fragment (#id) or an embedded data:image URI survive —
   * everything else (http, //host, javascript:, relative paths) is an
   * external or executable reference and is dropped, both to keep the
   * conversion fully local and to prevent canvas-tainting cross-origin
   * loads.
   */
  function classifyHref(raw) {
    var value = String(raw || '').trim();
    if (!value) return 'empty';
    if (value.charAt(0) === '#') return 'fragment';
    if (/^data:image\//i.test(value)) return 'data-image';
    return 'external';
  }

  /**
   * Best-effort CSS text cleanup for <style> elements and style=""
   * attributes: strips @import, non-data url() references, legacy
   * expression() and javascript: pseudo-protocol usage. A full CSS
   * parser is out of scope; this defends against the realistic
   * attack surface without rewriting arbitrary stylesheets.
   */
  function sanitizeCssText(css) {
    var out = String(css || '');
    var changed = false;

    if (/@import/i.test(out)) {
      out = out.replace(/@import[^;]*;?/gi, '');
      changed = true;
    }
    if (/url\(\s*(['"]?)(?!data:)[^'")]*\1\s*\)/i.test(out)) {
      out = out.replace(/url\(\s*(['"]?)(?!data:)[^'")]*\1\s*\)/gi, 'none');
      changed = true;
    }
    if (/expression\s*\(/i.test(out)) {
      out = out.replace(/expression\s*\([^)]*\)/gi, 'none');
      changed = true;
    }
    if (/javascript\s*:/i.test(out)) {
      out = out.replace(/javascript\s*:/gi, '');
      changed = true;
    }
    return { css: out, changed: changed };
  }

  /* ---------------------------------------------------------
     3. DOCTYPE / PROCESSING-INSTRUCTION STRIPPING
     A hand-rolled scan rather than a regex, because a DOCTYPE's
     internal subset can contain "[...]" entity definitions with
     their own angle brackets — the kind of structure entity-
     expansion ("billion laughs") attacks rely on. Stripping it
     before parsing means the browser's XML parser never sees it.
     --------------------------------------------------------- */

  function stripDoctype(text) {
    var start = text.indexOf('<!DOCTYPE');
    if (start === -1) return text;

    var i = start + 9;
    var depth = 0;
    for (; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (ch === '[') depth += 1;
      else if (ch === ']') depth -= 1;
      else if (ch === '>' && depth <= 0) { i += 1; break; }
    }
    return text.slice(0, start) + text.slice(i);
  }

  function stripProcessingInstructions(text) {
    return text.replace(/<\?(?!xml\s)[\s\S]*?\?>/gi, '');
  }

  function preprocessSvgSource(text) {
    return stripProcessingInstructions(stripDoctype(text));
  }

  /* ---------------------------------------------------------
     7. ENGINE EXPORT (pure parts — browser-only parts appended below)
     --------------------------------------------------------- */

  var engine = {
    parseLength: parseLength,
    parseViewBox: parseViewBox,
    detectDimensions: detectDimensions,
    lockedDimension: lockedDimension,
    clampOutputDimension: clampOutputDimension,
    exceedsSafeArea: exceedsSafeArea,
    clampQuality: clampQuality,
    formatBytes: formatBytes,
    stripExtension: stripExtension,
    sanitizeFilename: sanitizeFilename,
    isLikelySvgText: isLikelySvgText,
    classifyHref: classifyHref,
    sanitizeCssText: sanitizeCssText,
    stripDoctype: stripDoctype,
    stripProcessingInstructions: stripProcessingInstructions,
    preprocessSvgSource: preprocessSvgSource,
    MAX_OUTPUT_DIMENSION: MAX_OUTPUT_DIMENSION,
    MAX_OUTPUT_AREA: MAX_OUTPUT_AREA,
    LARGE_SVG_BYTES: LARGE_SVG_BYTES
  };

  /* ---------------------------------------------------------
     4. DOM SANITIZER (browser only)
     --------------------------------------------------------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  var ALLOWED_ELEMENTS = {
    svg: 1, g: 1, defs: 1, symbol: 1, use: 1, switch: 1,
    path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1,
    text: 1, tspan: 1, textPath: 1, image: 1,
    linearGradient: 1, radialGradient: 1, stop: 1, pattern: 1,
    clipPath: 1, mask: 1, filter: 1,
    feBlend: 1, feColorMatrix: 1, feComponentTransfer: 1,
    feFuncR: 1, feFuncG: 1, feFuncB: 1, feFuncA: 1,
    feComposite: 1, feConvolveMatrix: 1, feDiffuseLighting: 1, feDisplacementMap: 1,
    feDistantLight: 1, feFlood: 1, feGaussianBlur: 1, feImage: 1, feMerge: 1,
    feMergeNode: 1, feMorphology: 1, feOffset: 1, fePointLight: 1,
    feSpecularLighting: 1, feSpotLight: 1, feTile: 1, feTurbulence: 1, feDropShadow: 1,
    marker: 1, title: 1, desc: 1, style: 1,
    animate: 1, animateMotion: 1, animateTransform: 1, set: 1, mpath: 1,
    a: 1
  };

  if (typeof document !== 'undefined') {
    var sanitizeSvgDocument = function (sourceRoot) {
      var warnings = [];
      function warn(message) {
        if (warnings.indexOf(message) === -1) warnings.push(message);
      }

      function copyAttributes(srcEl, destEl) {
        Array.prototype.forEach.call(srcEl.attributes, function (attr) {
          var localName = attr.localName;
          var ns = attr.namespaceURI;

          if (/^on/i.test(localName)) { warn('Event handler attributes were removed for safety.'); return; }

          if (localName === 'href') {
            var kind = classifyHref(attr.value);
            if (kind === 'empty') return;
            if (kind === 'external') { warn('External resource references were removed — conversion stays fully local.'); return; }
          }

          if (localName === 'style') {
            var cleanedAttr = sanitizeCssText(attr.value);
            if (cleanedAttr.changed) warn('Unsafe styles were removed.');
            destEl.setAttribute('style', cleanedAttr.css);
            return;
          }

          if (ns !== null && ns !== XLINK_NS && ns !== XML_NS) return;

          try {
            if (ns === XLINK_NS) destEl.setAttributeNS(XLINK_NS, 'xlink:' + localName, attr.value);
            else if (ns === XML_NS) destEl.setAttributeNS(XML_NS, 'xml:' + localName, attr.value);
            else destEl.setAttribute(attr.name, attr.value);
          } catch (err) { /* the DOM itself rejected a malformed attribute — skip it */ }
        });
      }

      function walk(srcNode) {
        if (srcNode.nodeType === 3 || srcNode.nodeType === 4) {
          return document.createTextNode(srcNode.textContent);
        }
        if (srcNode.nodeType !== 1) return null;

        var tag = srcNode.localName;
        if (srcNode.namespaceURI !== SVG_NS || !ALLOWED_ELEMENTS[tag]) {
          if (tag === 'script') warn('Script content was removed — this tool never executes SVG scripts.');
          else if (tag === 'foreignObject') warn('Embedded HTML content was removed.');
          else if (tag) warn('The unsupported element "' + tag + '" was removed.');
          return null;
        }

        var el = document.createElementNS(SVG_NS, tag);
        copyAttributes(srcNode, el);

        if (tag === 'style') {
          var cleanedText = sanitizeCssText(srcNode.textContent);
          if (cleanedText.changed) warn('Unsafe styles were removed.');
          el.textContent = cleanedText.css;
          return el;
        }

        Array.prototype.forEach.call(srcNode.childNodes, function (child) {
          var cleanChild = walk(child);
          if (cleanChild) el.appendChild(cleanChild);
        });
        return el;
      }

      var cleanRoot = walk(sourceRoot);
      return { root: cleanRoot, warnings: warnings };
    };

    engine.sanitizeSvgText = function (text) {
      if (!isLikelySvgText(text)) {
        return { ok: false, error: 'The uploaded file does not appear to be a valid SVG.' };
      }
      if (typeof DOMParser === 'undefined') {
        return { ok: false, error: 'SVG parsing is not supported in this browser.' };
      }

      var doc;
      try {
        doc = new DOMParser().parseFromString(preprocessSvgSource(text), 'image/svg+xml');
      } catch (err) {
        return { ok: false, error: 'Unable to parse this file as XML.' };
      }

      if (doc.getElementsByTagName('parsererror').length) {
        return { ok: false, error: 'The uploaded file does not appear to be a valid SVG. Check that the XML is well-formed.' };
      }

      var root = doc.documentElement;
      if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
        return { ok: false, error: 'The uploaded file does not appear to be a valid SVG.' };
      }

      var result = sanitizeSvgDocument(root);
      if (!result.root) {
        return { ok: false, error: 'Unable to render this SVG in your browser.' };
      }

      var attrs = {
        width: root.getAttribute('width'),
        height: root.getAttribute('height'),
        viewBox: root.getAttribute('viewBox')
      };

      return {
        ok: true,
        root: result.root,
        dimensions: detectDimensions(attrs),
        warnings: result.warnings
      };
    };

    /* ---------------------------------------------------------
       5. RASTERIZATION (browser only)
       --------------------------------------------------------- */

    function loadSvgImage(svgText) {
      return new Promise(function (resolve, reject) {
        var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () { resolve({ img: img, url: url }); };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('RENDER_FAILED'));
        };
        img.src = url;
      });
    }

    /**
     * Renders a sanitized <svg> root at exactly opts.width x opts.height.
     * The fit mode is delegated to the SVG's own preserveAspectRatio —
     * "meet" (contain) or "slice" (cover) — so the browser's native,
     * spec-correct scaling does the work instead of custom pixel math.
     */
    engine.rasterize = function (svgRoot, opts) {
      var clone = svgRoot.cloneNode(true);
      clone.setAttribute('width', String(opts.width));
      clone.setAttribute('height', String(opts.height));
      clone.setAttribute('preserveAspectRatio', opts.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');

      if (!clone.getAttribute('viewBox') && opts.naturalWidth && opts.naturalHeight) {
        clone.setAttribute('viewBox', '0 0 ' + opts.naturalWidth + ' ' + opts.naturalHeight);
      }
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS);

      var xml = new XMLSerializer().serializeToString(clone);

      return loadSvgImage(xml).then(function (loaded) {
        var canvas = document.createElement('canvas');
        canvas.width = opts.width;
        canvas.height = opts.height;
        var ctx = canvas.getContext('2d');
        if (opts.background) {
          ctx.fillStyle = opts.background;
          ctx.fillRect(0, 0, opts.width, opts.height);
        }
        try {
          ctx.drawImage(loaded.img, 0, 0, opts.width, opts.height);
        } finally {
          URL.revokeObjectURL(loaded.url);
        }
        return canvas;
      });
    };

    engine.canvasToBlob = function (canvas, mime, quality) {
      return new Promise(function (resolve, reject) {
        if (!canvas.toBlob) { reject(new Error('TOBLOB_UNSUPPORTED')); return; }
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('ENCODE_FAILED')); return; }
          resolve(blob);
        }, mime, quality);
      });
    };

    /* ---------------------------------------------------------
       6. FORMAT CAPABILITY DETECTION
       --------------------------------------------------------- */

    var webpSupportPromise = null;
    engine.detectWebpSupport = function () {
      if (webpSupportPromise) return webpSupportPromise;
      webpSupportPromise = new Promise(function (resolve) {
        try {
          var c = document.createElement('canvas');
          c.width = 1;
          c.height = 1;
          c.toBlob(function (blob) {
            resolve(Boolean(blob) && blob.type === 'image/webp');
          }, 'image/webp');
        } catch (err) {
          resolve(false);
        }
      });
      return webpSupportPromise;
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (globalScope) globalScope.ToolAddaSvg = engine;

  if (typeof document === 'undefined') return;

  /* ==========================================================
     8. APPLICATION STATE
     ========================================================== */

  var FORMATS = {
    png: { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', quality: false, alpha: true },
    jpg: { id: 'jpg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg', quality: true, alpha: false },
    webp: { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', quality: true, alpha: true }
  };

  var MAX_BATCH_FILES = 30;
  var STORE_KEY = 'tooladda-svg-converter-prefs-v1';

  var state = {
    queue: [],
    activeId: null,
    formats: { png: true, jpg: false, webp: false },
    widthMode: 'natural',
    width: null,
    height: null,
    lockRatio: true,
    fit: 'contain',
    background: 'transparent',
    customColor: '#ffffff',
    jpgQuality: 90,
    webpQuality: 90,
    previewBg: 'checkerboard',
    compareMode: 'slider',
    webpSupported: null,
    converting: false
  };

  var el = {};
  var nextId = 1;

  function pick(selector, scope) { return (scope || document).querySelector(selector); }
  function pickAll(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  /* ==========================================================
     9. DOM CACHE
     ========================================================== */

  function cacheDom() {
    el.app = pick('[data-svg-app]');
    if (!el.app) return false;

    el.tabs = pickAll('[data-svg-input-tab]');
    el.uploadPanel = pick('[data-svg-panel="upload"]');
    el.pastePanel = pick('[data-svg-panel="paste"]');

    el.drop = pick('[data-svg-drop]');
    el.fileInput = pick('#svgFileInput');
    el.browse = pickAll('[data-svg-browse]');

    el.pasteInput = pick('#svgPasteInput');
    el.pasteRender = pick('[data-svg-paste-render]');

    el.workspace = pick('[data-svg-workspace]');
    el.emptyState = pick('[data-svg-empty]');

    el.singleView = pick('[data-svg-single]');
    el.batchView = pick('[data-svg-batch]');
    el.batchBody = pick('[data-svg-batch-body]');

    el.previewStage = pick('[data-svg-preview-stage]');
    el.previewImg = pick('[data-svg-preview-img]');
    el.resultImg = pick('[data-svg-result-img]');
    el.compareHandle = pick('[data-svg-compare-handle]');
    /* Both the drag handle and the Original/Converted label row carry
       this attribute — they appear and disappear together. */
    el.compareSlider = pickAll('[data-svg-compare-slider]');
    el.previewBgButtons = pickAll('[data-svg-previewbg]');

    el.fileName = pick('[data-svg-filename]');
    el.fileMeta = pick('[data-svg-filemeta]');
    el.detailsToggle = pick('[data-svg-details-toggle]');
    el.detailsPanel = pick('[data-svg-details]');
    el.warnings = pick('[data-svg-warnings]');
    el.largeNotice = pick('[data-svg-large-notice]');

    el.formatCards = pickAll('[data-svg-format]');
    el.widthInput = pick('#svgWidth');
    el.heightInput = pick('#svgHeight');
    el.lockRatio = pick('[data-svg-lock]');
    el.useNatural = pick('[data-svg-use-natural]');
    el.scalePresets = pickAll('[data-svg-scale]');
    el.fitButtons = pickAll('[data-svg-fit]');
    el.dimensionWarning = pick('[data-svg-dimension-warning]');

    el.bgButtons = pickAll('[data-svg-bg]');
    el.customColor = pick('#svgCustomColor');
    el.jpgQualityRow = pick('[data-svg-jpg-quality-row]');
    el.jpgQuality = pick('#svgJpgQuality');
    el.jpgQualityOut = pick('[data-svg-jpg-quality-out]');
    el.webpQualityRow = pick('[data-svg-webp-quality-row]');
    el.webpQuality = pick('#svgWebpQuality');
    el.webpQualityOut = pick('[data-svg-webp-quality-out]');
    el.jpgBgNotice = pick('[data-svg-jpg-bg-notice]');
    el.webpUnsupported = pick('[data-svg-webp-unsupported]');

    el.convertBtn = pick('[data-svg-convert]');
    el.clearBtn = pick('[data-svg-clear]');
    el.addMoreBtn = pick('[data-svg-add-more]');
    el.progress = pick('[data-svg-progress]');
    el.progressText = pick('[data-svg-progress-text]');
    el.progressBar = pick('[data-svg-progress-bar]');

    el.results = pick('[data-svg-results]');
    el.downloadAllZip = pick('[data-svg-download-all-zip]');
    el.sizeTable = pick('[data-svg-size-table]');

    el.status = pick('[data-svg-status]');
    el.error = pick('[data-svg-error]');

    return true;
  }

  function announce(message) {
    if (el.status) el.status.textContent = message;
  }

  function showError(message) {
    if (!el.error) return;
    if (!message) { el.error.hidden = true; el.error.textContent = ''; return; }
    el.error.hidden = false;
    el.error.textContent = message;
    announce(message);
  }

  /* ==========================================================
     10. QUEUE MANAGEMENT
     ========================================================== */

  function activeEntry() {
    return state.queue.find(function (e) { return e.id === state.activeId; }) || null;
  }

  function revokeEntry(entry) {
    Object.keys(entry.objectUrls).forEach(function (key) {
      try { URL.revokeObjectURL(entry.objectUrls[key]); } catch (err) { /* already gone */ }
    });
    entry.objectUrls = {};
  }

  function removeEntry(id) {
    var idx = state.queue.findIndex(function (e) { return e.id === id; });
    if (idx === -1) return;
    revokeEntry(state.queue[idx]);
    state.queue.splice(idx, 1);
    if (state.activeId === id) {
      state.activeId = state.queue.length ? state.queue[0].id : null;
    }
    renderAll();
  }

  /**
   * "Start Over" means exactly that — settings from a previous file
   * (a custom size, a background colour, a fit mode) are reset too,
   * rather than silently carrying over onto whatever gets loaded
   * next.
   */
  function resetQueue() {
    state.queue.forEach(revokeEntry);
    state.queue = [];
    state.activeId = null;
    state.widthMode = 'natural';
    state.width = null;
    state.height = null;
    state.lockRatio = true;
    state.fit = 'contain';
    state.background = 'transparent';
    state.customColor = '#ffffff';
    state.jpgQuality = 90;
    state.webpQuality = 90;
    state.formats = { png: true, jpg: false, webp: false };
    showError(null);
    renderAll();
  }

  /* ==========================================================
     11. FILE INTAKE
     ========================================================== */

  function makeEntry(name, text, sourceBytes) {
    var sanitized = ToolAddaSvg.sanitizeSvgText(text);
    var entry = {
      id: nextId++,
      name: name,
      sourceBytes: sourceBytes,
      status: sanitized.ok ? 'ready' : 'error',
      error: sanitized.ok ? null : sanitized.error,
      warnings: sanitized.ok ? sanitized.warnings : [],
      root: sanitized.ok ? sanitized.root : null,
      dimensions: sanitized.ok ? sanitized.dimensions : null,
      objectUrls: {},
      results: {}
    };
    return entry;
  }

  function addFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) {
      return /\.svg$/i.test(f.name) || f.type === 'image/svg+xml';
    });

    if (!files.length) {
      showError('Please choose an SVG file. Other image formats are not supported here.');
      return;
    }

    if (state.queue.length + files.length > MAX_BATCH_FILES) {
      showError('You can queue up to ' + MAX_BATCH_FILES + ' files at a time.');
      files = files.slice(0, Math.max(0, MAX_BATCH_FILES - state.queue.length));
      if (!files.length) return;
    }

    showError(null);
    var readers = files.map(function (file) {
      return file.text().then(function (text) {
        return makeEntry(file.name, text, file.size);
      });
    });

    Promise.all(readers).then(function (entries) {
      entries.forEach(function (entry) { state.queue.push(entry); });
      if (!state.activeId && state.queue.length) state.activeId = state.queue[0].id;
      renderAll();
      applyDimensionDefaults();
      announce(entries.length === 1 ? 'File loaded.' : entries.length + ' files loaded.');
    });
  }

  function addPastedSvg() {
    var text = el.pasteInput.value;
    if (!text.trim()) {
      showError('Paste some SVG markup first.');
      return;
    }

    /* Unlike a dropped file, pasted code is meant to be fixed and
       retried in place — an invalid paste stays on the paste form
       with an inline error rather than jumping into the workspace,
       which would hide the very textarea the user needs to edit. */
    var probe = ToolAddaSvg.sanitizeSvgText(text);
    if (!probe.ok) {
      showError(probe.error);
      return;
    }

    showError(null);
    var entry = makeEntry('pasted.svg', text, new Blob([text]).size);
    state.queue.push(entry);
    state.activeId = entry.id;
    renderAll();
    applyDimensionDefaults();
    announce('SVG rendered.');
  }

  /* ==========================================================
     DIMENSION DEFAULTS
     ========================================================== */

  function applyDimensionDefaults() {
    var entry = activeEntry();
    if (!entry || entry.status !== 'ready') return;
    if (state.widthMode !== 'natural') return;

    var dims = entry.dimensions;
    if (dims.width && dims.height) {
      state.width = Math.round(dims.width);
      state.height = Math.round(dims.height);
    } else {
      state.width = state.width || 512;
      state.height = state.height || 512;
    }
    renderDimensionInputs();
  }

  /* ==========================================================
     12/13. RENDERING
     ========================================================== */

  function renderTabs() {
    el.tabs.forEach(function (tab) {
      var mode = tab.getAttribute('data-svg-input-tab');
      var active = mode === (state.pasteActive ? 'paste' : 'upload');
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    el.uploadPanel.hidden = Boolean(state.pasteActive);
    el.pastePanel.hidden = !state.pasteActive;
  }

  function renderEmptyState() {
    var hasFiles = state.queue.length > 0;
    el.emptyState.hidden = hasFiles;
    el.workspace.hidden = !hasFiles;
  }

  function renderFileMeta(entry) {
    el.fileName.textContent = entry.name;
    var bits = [ToolAddaSvg.formatBytes(entry.sourceBytes)];
    var dims = entry.dimensions;
    if (dims && dims.width && dims.height) {
      bits.push(Math.round(dims.width) + ' × ' + Math.round(dims.height));
    }
    el.fileMeta.textContent = bits.join(' · ');

    el.largeNotice.hidden = entry.sourceBytes < ToolAddaSvg.LARGE_SVG_BYTES;

    el.detailsPanel.textContent = '';
    if (dims) {
      var rows = [
        ['Detected from', describeDimensionSource(dims.source)],
        ['Width', dims.width ? Math.round(dims.width) + ' px' : '—'],
        ['Height', dims.height ? Math.round(dims.height) + ' px' : '—'],
        ['Aspect ratio', dims.ratio ? dims.ratio.toFixed(3) + ' : 1' : 'Unknown'],
        ['viewBox', dims.viewBox
          ? [dims.viewBox.minX, dims.viewBox.minY, dims.viewBox.width, dims.viewBox.height].join(' ')
          : 'Not present']
      ];
      var dl = document.createElement('dl');
      dl.className = 'sv-detaillist';
      rows.forEach(function (row) {
        var dt = document.createElement('dt'); dt.textContent = row[0];
        var dd = document.createElement('dd'); dd.textContent = row[1];
        dl.appendChild(dt); dl.appendChild(dd);
      });
      el.detailsPanel.appendChild(dl);
    }

    el.warnings.textContent = '';
    el.warnings.hidden = entry.warnings.length === 0;
    if (entry.warnings.length) {
      var list = document.createElement('ul');
      entry.warnings.forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = w;
        list.appendChild(li);
      });
      el.warnings.appendChild(list);
    }
  }

  function describeDimensionSource(source) {
    return {
      'width-height': 'width & height attributes',
      'width-viewbox': 'width attribute + viewBox ratio',
      'height-viewbox': 'height attribute + viewBox ratio',
      viewbox: 'viewBox',
      'width-only': 'width attribute only',
      'height-only': 'height attribute only',
      none: 'not specified — using defaults'
    }[source] || 'unknown';
  }

  function svgToPreviewUrl(entry) {
    if (entry.objectUrls.preview) return entry.objectUrls.preview;
    var clone = entry.root.cloneNode(true);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var xml = new XMLSerializer().serializeToString(clone);
    var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    entry.objectUrls.preview = url;
    return url;
  }

  function renderSingle(entry) {
    el.singleView.hidden = false;
    el.batchView.hidden = true;

    /* Only a genuinely failed entry suppresses the preview. Checking
       for "not ready" would also catch 'converting' and 'converted',
       which would blank the preview the moment a conversion finished. */
    if (entry.status === 'error') {
      el.previewStage.classList.add('is-error');
      el.previewImg.hidden = true;
      showError(entry.error);
      return;
    }
    el.previewStage.classList.remove('is-error');
    showError(null);

    el.previewImg.hidden = false;
    el.previewImg.src = svgToPreviewUrl(entry);
    renderFileMeta(entry);
    renderPreviewBg();
    renderCompare(entry);
  }

  function renderPreviewBg() {
    el.previewBgButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-svg-previewbg') === state.previewBg;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    el.previewStage.setAttribute('data-bg', state.previewBg);
  }

  function renderCompare(entry) {
    var firstFormat = Object.keys(entry.results)[0];
    var show = Boolean(firstFormat);

    el.compareSlider.forEach(function (node) { node.hidden = !show; });
    el.resultImg.hidden = !show;

    if (show) el.resultImg.src = entry.results[firstFormat].url;
  }

  function renderFormatCards() {
    el.formatCards.forEach(function (card) {
      var id = card.getAttribute('data-svg-format');
      var checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = Boolean(state.formats[id]);
      card.classList.toggle('is-on', checkbox.checked);
      if (id === 'webp' && state.webpSupported === false) {
        checkbox.disabled = true;
        card.classList.add('is-disabled');
      }
    });
    el.webpUnsupported.hidden = state.webpSupported !== false;
  }

  function renderDimensionInputs() {
    if (state.width) el.widthInput.value = Math.round(state.width);
    if (state.height) el.heightInput.value = Math.round(state.height);
    el.lockRatio.setAttribute('aria-pressed', String(state.lockRatio));
    el.lockRatio.classList.toggle('is-on', state.lockRatio);

    el.fitButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-svg-fit') === state.fit;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    });

    var w = Number(el.widthInput.value);
    var h = Number(el.heightInput.value);
    el.dimensionWarning.hidden = !(w && h && ToolAddaSvg.exceedsSafeArea(w, h));
  }

  function renderBackgroundControls() {
    el.bgButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-svg-bg') === state.background;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    el.customColor.hidden = state.background !== 'custom';

    var jpgOn = Boolean(state.formats.jpg);
    el.jpgBgNotice.hidden = !(jpgOn && state.background === 'transparent');
    el.jpgQualityRow.hidden = !jpgOn;
    el.webpQualityRow.hidden = !state.formats.webp;
  }

  function renderQuality() {
    el.jpgQuality.value = state.jpgQuality;
    el.jpgQualityOut.textContent = state.jpgQuality;
    el.webpQuality.value = state.webpQuality;
    el.webpQualityOut.textContent = state.webpQuality;
  }

  function renderBatch() {
    el.singleView.hidden = true;
    el.batchView.hidden = false;
    el.batchBody.textContent = '';

    state.queue.forEach(function (entry) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-entry', String(entry.id));

      var nameTd = document.createElement('td');
      nameTd.textContent = entry.name;
      tr.appendChild(nameTd);

      var statusTd = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'sv-status-badge sv-status-badge--' + entry.status;
      badge.textContent = entry.status === 'ready' ? 'Ready'
        : entry.status === 'error' ? 'Error'
          : entry.status === 'converting' ? 'Converting…' : 'Done';
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      ['png', 'jpg', 'webp'].forEach(function (fmt) {
        var td = document.createElement('td');
        var res = entry.results[fmt];
        if (res) {
          var link = document.createElement('a');
          link.href = res.url;
          link.download = res.filename;
          link.className = 'sv-btn sv-btn--ghost sv-btn--xs';
          link.textContent = ToolAddaSvg.formatBytes(res.blob.size);
          link.setAttribute('aria-label', 'Download ' + fmt.toUpperCase() + ' for ' + entry.name);
          td.appendChild(link);
        } else {
          td.textContent = '—';
        }
        tr.appendChild(td);
      });

      var removeTd = document.createElement('td');
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'sv-btn sv-btn--ghost sv-btn--xs';
      removeBtn.textContent = '✕';
      removeBtn.setAttribute('aria-label', 'Remove ' + entry.name + ' from the queue');
      removeBtn.addEventListener('click', function () { removeEntry(entry.id); });
      removeTd.appendChild(removeBtn);
      tr.appendChild(removeTd);

      el.batchBody.appendChild(tr);
    });

    var anyResults = state.queue.some(function (e) { return Object.keys(e.results).length; });
    el.downloadAllZip.hidden = !anyResults;
  }

  function renderResults() {
    var entry = activeEntry();
    el.results.textContent = '';
    if (!entry || !Object.keys(entry.results).length) {
      el.sizeTable.hidden = true;
      return;
    }

    var rows = [];
    Object.keys(FORMATS).forEach(function (fmtId) {
      var res = entry.results[fmtId];
      if (!res) return;

      var card = document.createElement('article');
      card.className = 'sv-resultcard sv-resultcard--' + fmtId;

      var head = document.createElement('div');
      head.className = 'sv-resultcard__head';
      var title = document.createElement('h3');
      title.textContent = FORMATS[fmtId].label;
      head.appendChild(title);
      card.appendChild(head);

      var thumb = document.createElement('div');
      thumb.className = 'sv-resultcard__thumb';
      thumb.setAttribute('data-bg', state.previewBg);
      var img = document.createElement('img');
      img.src = res.url;
      img.alt = FORMATS[fmtId].label + ' preview';
      thumb.appendChild(img);
      card.appendChild(thumb);

      var meta = document.createElement('p');
      meta.className = 'sv-resultcard__meta';
      meta.textContent = res.width + ' × ' + res.height + ' · ' + ToolAddaSvg.formatBytes(res.blob.size)
        + ' · ' + (FORMATS[fmtId].alpha && state.background === 'transparent' ? 'Transparent' : 'Opaque');
      card.appendChild(meta);

      var dl = document.createElement('a');
      dl.href = res.url;
      dl.download = res.filename;
      dl.className = 'sv-btn sv-btn--' + fmtId;
      dl.textContent = 'Download ' + FORMATS[fmtId].label;
      card.appendChild(dl);

      el.results.appendChild(card);

      rows.push({ format: FORMATS[fmtId].label, dims: res.width + '×' + res.height, size: res.blob.size, alpha: FORMATS[fmtId].alpha && state.background === 'transparent' });
    });

    if (rows.length > 1) {
      el.sizeTable.hidden = false;
      var tbody = el.sizeTable.querySelector('tbody');
      tbody.textContent = '';
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        [row.format, row.dims, ToolAddaSvg.formatBytes(row.size), row.alpha ? 'Yes' : 'No'].forEach(function (val) {
          var td = document.createElement('td');
          td.textContent = val;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    } else {
      el.sizeTable.hidden = true;
    }
  }

  function renderAll() {
    renderEmptyState();
    if (!state.queue.length) return;

    if (state.queue.length === 1) {
      state.activeId = state.queue[0].id;
      renderSingle(state.queue[0]);
    } else {
      renderBatch();
    }
    renderFormatCards();
    renderDimensionInputs();
    renderBackgroundControls();
    renderQuality();
    renderResults();

    /* An already-converted entry is still convertible — that is how
       "change a setting and convert again" works. Only a file that
       failed to parse can never be converted. */
    var anyReady = state.queue.some(function (e) {
      return e.status === 'ready' || e.status === 'converted';
    });
    var anyFormat = Object.keys(state.formats).some(function (f) { return state.formats[f]; });
    el.convertBtn.disabled = !(anyReady && anyFormat) || state.converting;
  }

  /* ==========================================================
     14. CONVERSION PIPELINE
     ========================================================== */

  function resolveBackground(formatId) {
    if (FORMATS[formatId].alpha && state.background === 'transparent') return null;
    if (state.background === 'transparent') return '#ffffff'; /* JPG cannot be transparent */
    if (state.background === 'white') return '#ffffff';
    if (state.background === 'black') return '#000000';
    return state.customColor;
  }

  function convertEntry(entry, formatIds) {
    entry.status = 'converting';
    renderAll();

    var w = Math.max(1, Math.round(state.width || 512));
    var h = Math.max(1, Math.round(state.height || 512));

    Object.keys(entry.results).forEach(function (fmt) {
      try { URL.revokeObjectURL(entry.results[fmt].url); } catch (err) { /* already gone */ }
    });
    entry.results = {};

    var chain = Promise.resolve();
    formatIds.forEach(function (formatId) {
      chain = chain.then(function () {
        var format = FORMATS[formatId];
        return ToolAddaSvg.rasterize(entry.root, {
          width: w,
          height: h,
          fit: state.fit,
          background: resolveBackground(formatId),
          naturalWidth: entry.dimensions.width,
          naturalHeight: entry.dimensions.height
        }).then(function (canvas) {
          var quality = format.quality
            ? (formatId === 'jpg' ? state.jpgQuality : state.webpQuality) / 100
            : undefined;
          return ToolAddaSvg.canvasToBlob(canvas, format.mime, quality);
        }).then(function (blob) {
          var base = ToolAddaSvg.stripExtension(ToolAddaSvg.sanitizeFilename(entry.name, 'converted'));
          var filename = base + '.' + format.ext;
          var url = URL.createObjectURL(blob);
          entry.results[formatId] = { blob: blob, url: url, filename: filename, width: w, height: h };
        }).catch(function (err) {
          entry.status = 'error';
          entry.error = describeConvertError(err);
        });
      });
    });

    return chain.then(function () {
      if (entry.status !== 'error') entry.status = 'converted';
    });
  }

  function describeConvertError(err) {
    var code = err && err.message;
    if (code === 'RENDER_FAILED') return 'Unable to render this SVG in your browser.';
    if (code === 'TOBLOB_UNSUPPORTED') return 'This browser cannot export images. Try a current version of Chrome, Edge, Firefox or Safari.';
    if (code === 'ENCODE_FAILED') return 'The image could not be encoded. Try a smaller output size.';
    return 'Something went wrong while converting this file.';
  }

  function runConversion() {
    var formatIds = Object.keys(state.formats).filter(function (f) { return state.formats[f]; });
    if (!formatIds.length) { showError('Select at least one output format.'); return; }

    var w = Number(el.widthInput.value);
    var h = Number(el.heightInput.value);
    if (!w || !h || w <= 0 || h <= 0) { showError('Enter a valid width and height.'); return; }

    var wc = ToolAddaSvg.clampOutputDimension(w);
    var hc = ToolAddaSvg.clampOutputDimension(h);
    state.width = wc.value;
    state.height = hc.value;
    renderDimensionInputs();

    var targets = state.queue.filter(function (e) { return e.status === 'ready' || e.status === 'converted'; });
    if (!targets.length) { showError('Add a valid SVG file first.'); return; }

    state.converting = true;
    el.progress.hidden = false;
    var done = 0;
    updateProgress(done, targets.length);

    var chain = Promise.resolve();
    targets.forEach(function (entry) {
      chain = chain.then(function () {
        return convertEntry(entry, formatIds).then(function () {
          done += 1;
          updateProgress(done, targets.length);
          renderAll();
        });
      });
    });

    chain.then(function () {
      state.converting = false;
      el.progress.hidden = true;
      renderAll();
      announce('Conversion complete.');
    });
  }

  function updateProgress(done, total) {
    el.progressText.textContent = total > 1
      ? 'Converting ' + Math.min(done + 1, total) + ' of ' + total
      : 'Converting…';
    var pct = total ? Math.round((done / total) * 100) : 0;
    el.progressBar.style.width = pct + '%';
  }

  /* ==========================================================
     15. DOWNLOAD / ZIP
     ========================================================== */

  function downloadAllZip() {
    if (typeof JSZip === 'undefined') {
      showError('ZIP download is unavailable in this browser.');
      return;
    }
    var zip = new JSZip();
    var any = false;
    state.queue.forEach(function (entry) {
      Object.keys(entry.results).forEach(function (fmt) {
        var res = entry.results[fmt];
        zip.file(res.filename, res.blob);
        any = true;
      });
    });
    if (!any) return;

    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'svg-converted.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      announce('ZIP file downloaded.');
    });
  }

  /* ==========================================================
     16. SETTINGS, COMPARE SLIDER, THEME, KEYBOARD, INIT
     ========================================================== */

  function bindTabs() {
    el.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.pasteActive = tab.getAttribute('data-svg-input-tab') === 'paste';
        renderTabs();
      });
    });
  }

  function bindDropZone() {
    ['dragenter', 'dragover'].forEach(function (type) {
      el.drop.addEventListener(type, function (event) {
        event.preventDefault();
        el.drop.classList.add('is-over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      el.drop.addEventListener(type, function () { el.drop.classList.remove('is-over'); });
    });
    el.drop.addEventListener('drop', function (event) {
      event.preventDefault();
      el.drop.classList.remove('is-over');
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) addFiles(files);
    });
    el.drop.addEventListener('click', function () { el.fileInput.click(); });
    el.drop.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.fileInput.click(); }
    });
    el.browse.forEach(function (btn) {
      btn.addEventListener('click', function (event) { event.stopPropagation(); el.fileInput.click(); });
    });
    el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files && el.fileInput.files.length) addFiles(el.fileInput.files);
      el.fileInput.value = '';
    });
    el.pasteRender.addEventListener('click', addPastedSvg);
  }

  function bindFormats() {
    el.formatCards.forEach(function (card) {
      var id = card.getAttribute('data-svg-format');
      var checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', function () {
        state.formats[id] = checkbox.checked;
        renderAll();
      });
      card.addEventListener('click', function (event) {
        if (event.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
    });
  }

  function bindDimensions() {
    el.widthInput.addEventListener('input', function () {
      state.widthMode = 'custom';
      var w = Number(el.widthInput.value);
      state.width = w;
      if (state.lockRatio) {
        var entry = activeEntry();
        var ratio = entry && entry.dimensions ? entry.dimensions.ratio : null;
        var h = ToolAddaSvg.lockedDimension('width', w, ratio);
        if (h) { state.height = h; el.heightInput.value = Math.round(h); }
      }
      renderDimensionInputs();
    });

    el.heightInput.addEventListener('input', function () {
      state.widthMode = 'custom';
      var h = Number(el.heightInput.value);
      state.height = h;
      if (state.lockRatio) {
        var entry = activeEntry();
        var ratio = entry && entry.dimensions ? entry.dimensions.ratio : null;
        var w = ToolAddaSvg.lockedDimension('height', h, ratio);
        if (w) { state.width = w; el.widthInput.value = Math.round(w); }
      }
      renderDimensionInputs();
    });

    el.lockRatio.addEventListener('click', function () {
      state.lockRatio = !state.lockRatio;
      renderDimensionInputs();
    });

    el.useNatural.addEventListener('click', function () {
      state.widthMode = 'natural';
      applyDimensionDefaults();
      renderAll();
    });

    el.scalePresets.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var entry = activeEntry();
        if (!entry || !entry.dimensions || !entry.dimensions.width) return;
        var pct = Number(btn.getAttribute('data-svg-scale'));
        state.widthMode = 'custom';
        state.width = Math.round(entry.dimensions.width * (pct / 100));
        state.height = Math.round(entry.dimensions.height * (pct / 100));
        renderDimensionInputs();
      });
    });

    el.fitButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.fit = btn.getAttribute('data-svg-fit');
        renderDimensionInputs();
      });
    });
  }

  function bindBackground() {
    el.bgButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.background = btn.getAttribute('data-svg-bg');
        renderBackgroundControls();
      });
    });
    el.customColor.addEventListener('input', function () {
      state.customColor = el.customColor.value;
    });

    el.jpgQuality.addEventListener('input', function () {
      state.jpgQuality = ToolAddaSvg.clampQuality(el.jpgQuality.value);
      el.jpgQualityOut.textContent = state.jpgQuality;
    });
    el.webpQuality.addEventListener('input', function () {
      state.webpQuality = ToolAddaSvg.clampQuality(el.webpQuality.value);
      el.webpQualityOut.textContent = state.webpQuality;
    });
  }

  function bindPreviewBg() {
    el.previewBgButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.previewBg = btn.getAttribute('data-svg-previewbg');
        renderPreviewBg();
        renderResults();
      });
    });
  }

  function bindCompareSlider() {
    if (!el.compareHandle) return;
    var dragging = false;

    function setSplit(clientX) {
      var rect = el.previewStage.getBoundingClientRect();
      var pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      el.previewStage.style.setProperty('--sv-split', pct + '%');
    }

    el.compareHandle.addEventListener('pointerdown', function (event) {
      dragging = true;
      el.compareHandle.setPointerCapture(event.pointerId);
    });
    el.compareHandle.addEventListener('pointermove', function (event) {
      if (dragging) setSplit(event.clientX);
    });
    el.compareHandle.addEventListener('pointerup', function () { dragging = false; });
    el.compareHandle.addEventListener('keydown', function (event) {
      var rect = el.previewStage.getBoundingClientRect();
      var current = parseFloat(getComputedStyle(el.previewStage).getPropertyValue('--sv-split')) || 50;
      if (event.key === 'ArrowLeft') { setSplit(rect.left + (rect.width * (current - 5) / 100)); event.preventDefault(); }
      if (event.key === 'ArrowRight') { setSplit(rect.left + (rect.width * (current + 5) / 100)); event.preventDefault(); }
    });
  }

  function bindActions() {
    el.convertBtn.addEventListener('click', runConversion);
    el.clearBtn.addEventListener('click', resetQueue);
    el.addMoreBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.downloadAllZip.addEventListener('click', downloadAllZip);
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (el.app.contains(document.activeElement)) {
          event.preventDefault();
          runConversion();
        }
      }
    });
  }

  function init() {
    if (!cacheDom()) return;

    renderTabs();
    renderEmptyState();

    bindTabs();
    bindDropZone();
    bindFormats();
    bindDimensions();
    bindBackground();
    bindPreviewBg();
    bindCompareSlider();
    bindActions();
    bindKeyboard();

    ToolAddaSvg.detectWebpSupport().then(function (supported) {
      state.webpSupported = supported;
      if (!supported) state.formats.webp = false;
      renderFormatCards();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
