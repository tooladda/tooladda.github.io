(function () {
  'use strict';
  var root = document.querySelector('[data-color-picker-page]');
  if (!root) return;

  /* ============================================================
     Small utilities
     ============================================================ */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function round(n) { return Math.round(n); }

  /* ============================================================
     Color math
     ============================================================ */
  function toHex2(v) { var h = clamp(round(v), 0, 255).toString(16); return h.length === 1 ? '0' + h : h; }
  function rgbToHex(r, g, b) { return '#' + toHex2(r) + toHex2(g) + toHex2(b); }
  function hexToRgb(hex) {
    if (!hex) return null;
    var h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: round(h * 360), s: round(s * 100), l: round(l * 100) };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    if (s === 0) { var v = round(l * 255); return { r: v, g: v, b: v }; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function hue2rgb(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var hk = h / 360;
    return { r: round(hue2rgb(hk + 1 / 3) * 255), g: round(hue2rgb(hk) * 255), b: round(hue2rgb(hk - 1 / 3) * 255) };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: round(h * 360), s: round(s * 100), v: round(v * 100) };
  }

  function rgbToCmyk(r, g, b) {
    if (r === 0 && g === 0 && b === 0) return { c: 0, m: 0, y: 0, k: 100 };
    var rp = r / 255, gp = g / 255, bp = b / 255;
    var k = 1 - Math.max(rp, gp, bp);
    var c = (1 - rp - k) / (1 - k);
    var m = (1 - gp - k) / (1 - k);
    var y = (1 - bp - k) / (1 - k);
    return { c: round(c * 100), m: round(m * 100), y: round(y * 100), k: round(k * 100) };
  }

  function srgbChannelToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function rgbToXyz(r, g, b) {
    var rl = srgbChannelToLinear(r), gl = srgbChannelToLinear(g), bl = srgbChannelToLinear(b);
    return {
      x: rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375,
      y: rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750,
      z: rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041
    };
  }
  var D65 = { x: 0.95047, y: 1.0, z: 1.08883 };
  function xyzToLab(x, y, z) {
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116; }
    var fx = f(x / D65.x), fy = f(y / D65.y), fz = f(z / D65.z);
    return { l: round((116 * fy) - 16), a: round(500 * (fx - fy)), b: round(200 * (fy - fz)) };
  }
  function rgbToLab(r, g, b) {
    var xyz = rgbToXyz(r, g, b);
    return xyzToLab(xyz.x, xyz.y, xyz.z);
  }

  // WCAG relative luminance / contrast ratio
  function relLuminance(r, g, b) {
    return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
  }
  function contrastRatio(rgbA, rgbB) {
    var l1 = relLuminance(rgbA.r, rgbA.g, rgbA.b) + 0.05;
    var l2 = relLuminance(rgbB.r, rgbB.g, rgbB.b) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }

  // 148 standard CSS named colors, for "nearest named color"
  var NAMED_COLORS = {
    aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
    beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
    blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
    chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
    cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
    darkgreen: '#006400', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
    darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
    darkslategray: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff',
    dimgray: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
    fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520',
    gray: '#808080', green: '#008000', greenyellow: '#adff2f', honeydew: '#f0fff0', hotpink: '#ff69b4',
    indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
    lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
    lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90', lightpink: '#ffb6c1',
    lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightsteelblue: '#b0c4de',
    lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff',
    maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db',
    mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
    midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead',
    navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500',
    orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
    palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
    plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000',
    rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460',
    seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb',
    slateblue: '#6a5acd', slategray: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
    tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0',
    violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32'
  };
  var NAMED_COLOR_LIST = Object.keys(NAMED_COLORS).map(function (name) {
    var rgb = hexToRgb(NAMED_COLORS[name]);
    return { name: name, r: rgb.r, g: rgb.g, b: rgb.b };
  });
  function nearestNamedColor(r, g, b) {
    var best = null, bestDist = Infinity;
    NAMED_COLOR_LIST.forEach(function (c) {
      var dist = (c.r - r) * (c.r - r) + (c.g - g) * (c.g - g) + (c.b - b) * (c.b - b);
      if (dist < bestDist) { bestDist = dist; best = c; }
    });
    return best ? best.name : '—';
  }

  /* ============================================================
     Median-cut color quantization (dominant color extraction)
     ============================================================ */
  function quantizeMedianCut(pixels, targetCount) {
    if (!pixels.length) return [];
    function boxRange(box) {
      var rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (var i = 0; i < box.length; i++) {
        var p = box[i];
        if (p[0] < rMin) rMin = p[0]; if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1]; if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2]; if (p[2] > bMax) bMax = p[2];
      }
      var rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
      var widest = rRange >= gRange && rRange >= bRange ? 0 : (gRange >= bRange ? 1 : 2);
      return { range: Math.max(rRange, gRange, bRange), channel: widest };
    }
    var boxes = [pixels];
    while (boxes.length < targetCount) {
      var splitIdx = -1, splitRange = -1, splitChannel = 0;
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        var info = boxRange(boxes[i]);
        if (info.range > splitRange) { splitRange = info.range; splitIdx = i; splitChannel = info.channel; }
      }
      if (splitIdx === -1 || splitRange <= 0) break;
      var box = boxes[splitIdx];
      box.sort(function (a, b) { return a[splitChannel] - b[splitChannel]; });
      var mid = Math.floor(box.length / 2);
      var boxA = box.slice(0, mid), boxB = box.slice(mid);
      boxes.splice(splitIdx, 1, boxA, boxB);
    }
    var total = pixels.length;
    return boxes.map(function (box) {
      var sr = 0, sg = 0, sb = 0;
      for (var i = 0; i < box.length; i++) { sr += box[i][0]; sg += box[i][1]; sb += box[i][2]; }
      var n = box.length || 1;
      return { r: round(sr / n), g: round(sg / n), b: round(sb / n), count: box.length, pct: Math.round((box.length / total) * 100) };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  /* ============================================================
     State
     ============================================================ */
  var state = {
    naturalW: 0, naturalH: 0,
    zoom: 1,
    gridOn: false,
    current: null,      // { r,g,b,x,y }
    recent: [],          // [{r,g,b}]
    favorites: [],        // ["#hex", ...]
    palette: [],          // [{r,g,b,count,pct}]
    average: null,
    activeTab: 'info',
    exportFormat: 'css'
  };

  var FAV_KEY = 'tooladda-color-favorites-v1';
  function loadFavorites() {
    try {
      var raw = window.localStorage.getItem(FAV_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      state.favorites = Array.isArray(arr) ? arr.filter(function (h) { return hexToRgb(h); }) : [];
    } catch (e) { state.favorites = []; }
  }
  function saveFavorites() {
    try { window.localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites)); } catch (e) { /* private mode / quota — non-fatal */ }
  }

  /* ============================================================
     DOM refs
     ============================================================ */
  var fileInput = $('[data-file-input]', root);
  var filePicker = $('[data-file-picker]', root);
  var dropZone = $('[data-drop-zone]', root);
  var preUpload = $('[data-pre-upload]', root);
  var editorRoot = $('[data-editor-root]', root);
  var messageBox = $('[data-message]', root);
  var stepList = $('[data-step-list]', root);
  var canvasWrap = $('[data-canvas-wrap]', root);
  var loadingNote = $('[data-loading-note]', root);
  var imageCanvas = $('[data-image-canvas]', root);
  var zoomLabel = $('[data-zoom-label]', root);
  var hintBar = $('[data-hint-bar]', root);
  var lens = $('[data-lens]');
  var lensCanvas = $('[data-lens-canvas]');
  var eyedropperBtn = $('[data-eyedropper-btn]', root);

  var { clear: clearMessage, show: showMessage } = window.ImageToolKit.createMessageHandlers(messageBox);

  var sourceCanvas = document.createElement('canvas');
  var sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  var imgCtx = imageCanvas.getContext('2d');
  var lensCtx = lensCanvas ? lensCanvas.getContext('2d') : null;

  function setStep(n) {
    $all('li', stepList).forEach(function (li) {
      var s = parseInt(li.getAttribute('data-step'), 10);
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
    });
  }

  /* ============================================================
     Upload
     ============================================================ */
  window.ImageToolKit.bindFileUpload({
    fileInput: fileInput,
    filePicker: filePicker,
    dropZone: dropZone,
    onFile: function (file) { loadFile(file); }
  });

  document.addEventListener('paste', function (e) {
    if (editorRoot && !editorRoot.classList.contains('hidden') && document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var file = items[i].getAsFile();
        if (file) { loadFile(file); e.preventDefault(); }
        break;
      }
    }
  });

  var activeUrl = null;
  async function loadFile(file) {
    if (!file || file.type.indexOf('image/') !== 0) { showMessage('Please choose a valid image file.', 'error'); return; }
    try {
      loadingNote.textContent = 'Decoding image…';
      loadingNote.classList.remove('hidden');
      imageCanvas.classList.add('hidden');
      var loaded = await window.ImageToolKit.loadImageFile(file);
      window.ImageToolKit.revokeUrl(activeUrl);
      activeUrl = loaded.url;

      state.naturalW = loaded.image.naturalWidth;
      state.naturalH = loaded.image.naturalHeight;
      sourceCanvas.width = state.naturalW;
      sourceCanvas.height = state.naturalH;
      sourceCtx.clearRect(0, 0, state.naturalW, state.naturalH);
      sourceCtx.drawImage(loaded.image, 0, 0);

      preUpload.classList.add('hidden');
      editorRoot.classList.remove('hidden');
      $('[data-file-summary]', root).innerHTML = '<strong>' + escapeHtml(file.name) + '</strong> · ' + state.naturalW + '×' + state.naturalH + 'px · ' + window.ImageToolKit.formatBytes(file.size);

      state.palette = []; state.average = null; state.current = null;
      renderPaletteGrid(); renderAverage(); renderGradient();
      resetContrastDefaults();

      fitZoom();
      renderImage();
      setStep(2);
      clearMessage();
      showMessage('Image loaded — hover to magnify, click any pixel to sample its color.', 'success');
    } catch (err) {
      console.error(err);
      showMessage(err.message || 'Could not load that image.', 'error');
    } finally {
      loadingNote.classList.add('hidden');
      imageCanvas.classList.remove('hidden');
    }
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /* ============================================================
     Rendering / zoom
     ============================================================ */
  function fitZoom() {
    var maxW = Math.min(canvasWrap.clientWidth || 640, 900);
    var maxH = 560;
    var z = Math.min(maxW / state.naturalW, maxH / state.naturalH, 1);
    state.zoom = clamp(z, 0.05, 8);
  }

  function renderImage() {
    if (!state.naturalW) return;
    var w = Math.max(1, Math.min(round(state.naturalW * state.zoom), 8000));
    var h = Math.max(1, Math.min(round(state.naturalH * state.zoom), 8000));
    imageCanvas.width = w;
    imageCanvas.height = h;
    imgCtx.imageSmoothingEnabled = state.zoom < 1;
    imgCtx.clearRect(0, 0, w, h);
    imgCtx.drawImage(sourceCanvas, 0, 0, w, h);

    if (state.gridOn && state.zoom >= 6) {
      imgCtx.strokeStyle = 'rgba(15,23,42,0.35)';
      imgCtx.lineWidth = 1;
      imgCtx.beginPath();
      for (var x = 0; x <= w; x += state.zoom) { imgCtx.moveTo(round(x) + 0.5, 0); imgCtx.lineTo(round(x) + 0.5, h); }
      for (var y = 0; y <= h; y += state.zoom) { imgCtx.moveTo(0, round(y) + 0.5); imgCtx.lineTo(w, round(y) + 0.5); }
      imgCtx.stroke();
    }
    zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
    hintBar.textContent = state.gridOn && state.zoom < 6
      ? 'Zoom in further (6x+) to see the pixel grid.'
      : 'Hover to magnify, click to sample a color. Use the precise sampler below on touch devices.';
  }

  $('[data-zoom-in]', root).addEventListener('click', function () { state.zoom = clamp(state.zoom * 1.25, 0.05, 8); renderImage(); });
  $('[data-zoom-out]', root).addEventListener('click', function () { state.zoom = clamp(state.zoom / 1.25, 0.05, 8); renderImage(); });
  $('[data-zoom-reset]', root).addEventListener('click', function () { fitZoom(); renderImage(); });
  $('[data-toggle-grid]', root).addEventListener('click', function () {
    state.gridOn = !state.gridOn;
    this.setAttribute('aria-pressed', state.gridOn ? 'true' : 'false');
    renderImage();
  });

  /* ============================================================
     Sampling
     ============================================================ */
  function samplePixel(sx, sy) {
    sx = clamp(round(sx), 0, state.naturalW - 1);
    sy = clamp(round(sy), 0, state.naturalH - 1);
    var d = sourceCtx.getImageData(sx, sy, 1, 1).data;
    applyPickedColor({ r: d[0], g: d[1], b: d[2], a: d[3], x: sx, y: sy });
  }

  function localPointFromEvent(e) {
    var rect = imageCanvas.getBoundingClientRect();
    var lx = (e.clientX - rect.left) * (imageCanvas.width / rect.width);
    var ly = (e.clientY - rect.top) * (imageCanvas.height / rect.height);
    return { lx: lx, ly: ly };
  }

  imageCanvas.addEventListener('click', function (e) {
    if (!state.naturalW) return;
    var p = localPointFromEvent(e);
    samplePixel(p.lx / state.zoom, p.ly / state.zoom);
    setStep(3);
  });

  imageCanvas.addEventListener('pointermove', function (e) {
    if (!state.naturalW || !lens || e.pointerType === 'touch') return;
    var p = localPointFromEvent(e);
    var sx = clamp(round(p.lx / state.zoom), 0, state.naturalW - 1);
    var sy = clamp(round(p.ly / state.zoom), 0, state.naturalH - 1);
    updateLens(e.clientX, e.clientY, sx, sy);
  });
  imageCanvas.addEventListener('pointerleave', function () { if (lens) lens.classList.remove('is-active'); });

  function updateLens(clientX, clientY, sx, sy) {
    var crop = 15;
    var half = Math.floor(crop / 2);
    var sourceX = clamp(sx - half, 0, Math.max(0, state.naturalW - crop));
    var sourceY = clamp(sy - half, 0, Math.max(0, state.naturalH - crop));
    lensCanvas.width = 150; lensCanvas.height = 150;
    lensCtx.imageSmoothingEnabled = false;
    lensCtx.clearRect(0, 0, 150, 150);
    lensCtx.drawImage(sourceCanvas, sourceX, sourceY, crop, crop, 0, 0, 150, 150);
    var cell = 150 / crop;
    lensCtx.strokeStyle = 'rgba(15,23,42,0.28)';
    lensCtx.lineWidth = 1;
    lensCtx.beginPath();
    for (var i = 0; i <= crop; i++) { lensCtx.moveTo(round(i * cell) + 0.5, 0); lensCtx.lineTo(round(i * cell) + 0.5, 150); }
    for (var j = 0; j <= crop; j++) { lensCtx.moveTo(0, round(j * cell) + 0.5); lensCtx.lineTo(150, round(j * cell) + 0.5); }
    lensCtx.stroke();
    lens.style.left = (clientX + 18) + 'px';
    lens.style.top = (clientY + 18) + 'px';
    lens.classList.add('is-active');
  }

  $('[data-precise-form]', root).addEventListener('submit', function (e) {
    e.preventDefault();
    if (!state.naturalW) { showMessage('Upload an image first.', 'error'); return; }
    var x = parseInt($('#cpPX', root).value, 10) || 0;
    var y = parseInt($('#cpPY', root).value, 10) || 0;
    samplePixel(x, y);
    setStep(3);
  });

  if (window.EyeDropper) {
    eyedropperBtn.hidden = false;
    eyedropperBtn.addEventListener('click', async function () {
      try {
        var result = await new window.EyeDropper().open();
        var rgb = hexToRgb(result.sRGBHex);
        if (rgb) applyPickedColor({ r: rgb.r, g: rgb.g, b: rgb.b, a: 255, x: null, y: null, posLabel: 'screen pick' });
        setStep(3);
      } catch (err) { /* user cancelled — not an error */ }
    });
  }

  /* ============================================================
     Current color panel
     ============================================================ */
  function applyPickedColor(c) {
    state.current = c;
    var hex = rgbToHex(c.r, c.g, c.b);
    var hsl = rgbToHsl(c.r, c.g, c.b);
    var hsv = rgbToHsv(c.r, c.g, c.b);
    var cmyk = rgbToCmyk(c.r, c.g, c.b);
    var lab = rgbToLab(c.r, c.g, c.b);
    var alpha = ((c.a != null ? c.a : 255) / 255).toFixed(2);

    $('[data-current-swatch]', root).style.background = hex;
    $('[data-v-hex]', root).textContent = hex;
    $('[data-v-rgb]', root).textContent = 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
    $('[data-v-rgba]', root).textContent = 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + alpha + ')';
    $('[data-v-hsl]', root).textContent = 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)';
    $('[data-v-hsv]', root).textContent = 'hsv(' + hsv.h + ', ' + hsv.s + '%, ' + hsv.v + '%)';
    $('[data-v-cmyk]', root).textContent = 'cmyk(' + cmyk.c + '%, ' + cmyk.m + '%, ' + cmyk.y + '%, ' + cmyk.k + '%)';
    $('[data-v-lab]', root).textContent = 'lab(' + lab.l + ', ' + lab.a + ', ' + lab.b + ')';
    $('[data-nearest-name]', root).textContent = nearestNamedColor(c.r, c.g, c.b);
    $('[data-v-pos]', root).textContent = c.x != null ? (c.x + ', ' + c.y) : (c.posLabel || '—');
    $('[data-fav-btn]', root).disabled = false;
    updateFavButtonState();

    pushRecent(c);
    renderExport();
  }

  $all('[data-copy]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var field = btn.getAttribute('data-copy');
      var text = $('[data-v-' + field + ']', root).textContent;
      copyText(text);
    });
  });

  async function copyText(text) {
    if (!text || text === '—') return;
    try { await navigator.clipboard.writeText(text); showMessage(text + ' copied to clipboard.', 'success'); }
    catch (e) { showMessage('Could not copy — copy it manually instead.', 'error'); }
  }

  /* ============================================================
     Recent + favorites
     ============================================================ */
  function pushRecent(c) {
    var hex = rgbToHex(c.r, c.g, c.b);
    state.recent = state.recent.filter(function (r) { return rgbToHex(r.r, r.g, r.b) !== hex; });
    state.recent.unshift({ r: c.r, g: c.g, b: c.b });
    if (state.recent.length > 24) state.recent.length = 24;
    renderSwatchStrip($('[data-recent-strip]', root), state.recent.map(function (c) { return rgbToHex(c.r, c.g, c.b); }), 'No colors picked yet.');
  }

  function renderSwatchStrip(container, hexList, emptyText) {
    container.innerHTML = '';
    if (!hexList.length) { container.innerHTML = '<p class="cp-empty-note">' + emptyText + '</p>'; return; }
    hexList.forEach(function (hex) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-mini-swatch';
      b.style.background = hex;
      b.setAttribute('aria-label', 'Use color ' + hex);
      b.title = hex;
      if (state.favorites.indexOf(hex) !== -1) b.innerHTML = '<span class="fav-mark">⭐</span>';
      b.addEventListener('click', function () {
        var rgb = hexToRgb(hex);
        applyPickedColor({ r: rgb.r, g: rgb.g, b: rgb.b, a: 255, x: null, y: null, posLabel: 'reselected' });
      });
      container.appendChild(b);
    });
  }

  function renderFavorites() {
    renderSwatchStrip($('[data-favorite-strip]', root), state.favorites.slice(), 'Star a color to save it here (kept on this device).');
  }
  function updateFavButtonState() {
    var btn = $('[data-fav-btn]', root);
    if (!state.current) return;
    var hex = rgbToHex(state.current.r, state.current.g, state.current.b);
    var isFav = state.favorites.indexOf(hex) !== -1;
    btn.textContent = isFav ? '★ Saved to favorites' : '☆ Save to favorites';
  }
  $('[data-fav-btn]', root).addEventListener('click', function () {
    if (!state.current) return;
    var hex = rgbToHex(state.current.r, state.current.g, state.current.b);
    var idx = state.favorites.indexOf(hex);
    if (idx === -1) { state.favorites.unshift(hex); if (state.favorites.length > 40) state.favorites.length = 40; }
    else state.favorites.splice(idx, 1);
    saveFavorites();
    renderFavorites();
    updateFavButtonState();
    renderSwatchStrip($('[data-recent-strip]', root), state.recent.map(function (c) { return rgbToHex(c.r, c.g, c.b); }), 'No colors picked yet.');
  });

  /* ============================================================
     Tabs
     ============================================================ */
  $all('[data-cp-tab]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.activeTab = btn.getAttribute('data-cp-tab');
      $all('[data-cp-tab]', root).forEach(function (b) { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      $all('[data-cp-panel]', root).forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-cp-panel') === state.activeTab); });
    });
  });

  /* ============================================================
     Palette (median-cut), average, gradient
     ============================================================ */
  function collectSamplePixels() {
    var total = state.naturalW * state.naturalH;
    var targetSamples = 30000;
    var stride = Math.max(1, Math.round(Math.sqrt(total / targetSamples)));
    var data = sourceCtx.getImageData(0, 0, state.naturalW, state.naturalH).data;
    var pixels = [];
    for (var y = 0; y < state.naturalH; y += stride) {
      for (var x = 0; x < state.naturalW; x += stride) {
        var idx = (y * state.naturalW + x) * 4;
        if (data[idx + 3] < 16) continue; // skip near-transparent pixels
        pixels.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
    }
    return pixels;
  }

  $('[data-generate-palette]', root).addEventListener('click', function () {
    if (!state.naturalW) { showMessage('Upload an image first.', 'error'); return; }
    var count = parseInt($('[data-swatch-count]', root).value, 10) || 6;
    var pixels = collectSamplePixels();
    if (!pixels.length) { showMessage('Could not analyze this image (fully transparent?).', 'error'); return; }
    state.palette = quantizeMedianCut(pixels, count);
    var sr = 0, sg = 0, sb = 0;
    pixels.forEach(function (p) { sr += p[0]; sg += p[1]; sb += p[2]; });
    state.average = { r: round(sr / pixels.length), g: round(sg / pixels.length), b: round(sb / pixels.length) };
    renderPaletteGrid();
    renderAverage();
    renderGradient();
    renderExport();
    setStep(4);
    showMessage('Palette generated from ' + pixels.length + ' sampled pixels.', 'success');
  });

  function renderPaletteGrid() {
    var grid = $('[data-palette-grid]', root);
    grid.innerHTML = '';
    if (!state.palette.length) { grid.innerHTML = '<p class="cp-empty-note">Generate a palette to see swatches here.</p>'; return; }
    state.palette.forEach(function (c) {
      var hex = rgbToHex(c.r, c.g, c.b);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-palette-swatch';
      b.style.background = hex;
      b.title = hex + ' — ' + c.pct + '% of image';
      b.innerHTML = '<span class="pct">' + c.pct + '%</span>';
      b.addEventListener('click', function () { applyPickedColor({ r: c.r, g: c.g, b: c.b, a: 255, x: null, y: null, posLabel: 'from palette' }); });
      grid.appendChild(b);
    });
  }

  function renderAverage() {
    if (!state.average) { $('[data-average-swatch]', root).style.background = 'transparent'; $('[data-average-hex]', root).textContent = '—'; return; }
    var hex = rgbToHex(state.average.r, state.average.g, state.average.b);
    $('[data-average-swatch]', root).style.background = hex;
    $('[data-average-hex]', root).textContent = hex;
  }
  $('[data-copy-average]', root).addEventListener('click', function () {
    if (state.average) copyText(rgbToHex(state.average.r, state.average.g, state.average.b));
  });

  function renderGradient() {
    var order = $('[data-gradient-order]', root).value;
    var preview = $('[data-gradient-preview]', root);
    var out = $('[data-gradient-css]', root);
    if (state.palette.length < 2) {
      preview.style.background = 'transparent';
      out.textContent = 'Generate a palette with at least 2 colors first.';
      return;
    }
    var list = state.palette.slice();
    if (order === 'hue') list.sort(function (a, b) { return rgbToHsl(a.r, a.g, a.b).h - rgbToHsl(b.r, b.g, b.b).h; });
    else if (order === 'lightness') list.sort(function (a, b) { return rgbToHsl(a.r, a.g, a.b).l - rgbToHsl(b.r, b.g, b.b).l; });
    var hexes = list.map(function (c) { return rgbToHex(c.r, c.g, c.b); });
    var css = 'linear-gradient(90deg, ' + hexes.join(', ') + ')';
    preview.style.background = css;
    out.textContent = 'background: ' + css + ';';
  }
  $('[data-gradient-order]', root).addEventListener('change', renderGradient);
  $('[data-copy-gradient]', root).addEventListener('click', function () { copyText($('[data-gradient-css]', root).textContent); });

  /* ============================================================
     Accessibility / contrast
     ============================================================ */
  var fgInput = $('[data-contrast-fg]', root), bgInput = $('[data-contrast-bg]', root);
  function resetContrastDefaults() { fgInput.value = '#111111'; bgInput.value = '#ffffff'; renderContrast(); }
  function renderContrast() {
    var fg = hexToRgb(fgInput.value), bg = hexToRgb(bgInput.value);
    var preview = $('[data-contrast-preview]', root), ratioEl = $('[data-contrast-ratio]', root), badges = $('[data-contrast-badges]', root);
    if (!fg || !bg) { ratioEl.textContent = 'Enter valid HEX colors'; badges.innerHTML = ''; return; }
    preview.style.color = rgbToHex(fg.r, fg.g, fg.b);
    preview.style.background = rgbToHex(bg.r, bg.g, bg.b);
    var ratio = contrastRatio(fg, bg);
    ratioEl.textContent = ratio.toFixed(2) + ':1';
    var checks = [
      { label: 'AA Normal', need: 4.5 }, { label: 'AA Large', need: 3 },
      { label: 'AAA Normal', need: 7 }, { label: 'AAA Large', need: 4.5 }
    ];
    badges.innerHTML = checks.map(function (c) {
      var pass = ratio >= c.need;
      return '<span class="' + (pass ? 'cp-badge-pass' : 'cp-badge-fail') + '">' + (pass ? '✓' : '✕') + ' ' + c.label + '</span>';
    }).join('');
  }
  fgInput.addEventListener('input', renderContrast);
  bgInput.addEventListener('input', renderContrast);
  $('[data-use-picked-fg]', root).addEventListener('click', function () {
    if (!state.current) { showMessage('Pick a color first.', 'error'); return; }
    fgInput.value = rgbToHex(state.current.r, state.current.g, state.current.b);
    renderContrast();
  });
  $('[data-use-picked-bg]', root).addEventListener('click', function () {
    if (!state.current) { showMessage('Pick a color first.', 'error'); return; }
    bgInput.value = rgbToHex(state.current.r, state.current.g, state.current.b);
    renderContrast();
  });

  /* ============================================================
     Export
     ============================================================ */
  function currentPaletteHexes() {
    if (state.palette.length) return state.palette.map(function (c) { return rgbToHex(c.r, c.g, c.b); });
    if (state.recent.length) return state.recent.map(function (c) { return rgbToHex(c.r, c.g, c.b); });
    if (state.current) return [rgbToHex(state.current.r, state.current.g, state.current.b)];
    return [];
  }

  var MATERIAL_RAMP = [
    { step: 50, l: 96 }, { step: 100, l: 90 }, { step: 200, l: 80 }, { step: 300, l: 68 }, { step: 400, l: 58 },
    { step: 500, l: 48 }, { step: 600, l: 40 }, { step: 700, l: 32 }, { step: 800, l: 24 }, { step: 900, l: 16 }
  ];

  function renderExport() {
    var hexes = currentPaletteHexes();
    var out = $('[data-export-output]', root);
    if (!hexes.length) { out.textContent = 'Pick a color or generate a palette to see export code.'; return; }
    var fmt = state.exportFormat;
    if (fmt === 'css') {
      out.textContent = ':root {\n' + hexes.map(function (h, i) { return '  --color-' + (i + 1) + ': ' + h + ';'; }).join('\n') + '\n}';
    } else if (fmt === 'tailwind') {
      out.textContent = 'colors: {\n' + hexes.map(function (h, i) { return "  'picked-" + (i + 1) + "': '" + h + "',"; }).join('\n') + '\n}';
    } else if (fmt === 'bootstrap') {
      out.textContent = hexes.map(function (h, i) { return '$color-' + (i + 1) + ': ' + h + ';'; }).join('\n');
    } else if (fmt === 'material') {
      var base = hexToRgb(hexes[0]);
      var hsl = rgbToHsl(base.r, base.g, base.b);
      out.textContent = MATERIAL_RAMP.map(function (step) {
        var rgb = hslToRgb(hsl.h, hsl.s, step.l);
        return '  ' + step.step + ': \'' + rgbToHex(rgb.r, rgb.g, rgb.b) + '\',';
      }).join('\n');
      out.textContent = "colors: {\n  brand: {\n" + out.textContent + '\n  }\n}';
    } else if (fmt === 'json') {
      out.textContent = JSON.stringify(hexes.map(function (h) {
        var rgb = hexToRgb(h);
        return { hex: h, rgb: 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')' };
      }), null, 2);
    }
  }
  $all('[data-export-format]', root).forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.exportFormat = chip.getAttribute('data-export-format');
      $all('[data-export-format]', root).forEach(function (c) { c.classList.toggle('is-active', c === chip); c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      renderExport();
    });
  });
  $('[data-copy-export]', root).addEventListener('click', function () {
    copyText($('[data-export-output]', root).textContent);
    setStep(5);
  });

  $('[data-download-png]', root).addEventListener('click', function () {
    var hexes = currentPaletteHexes();
    if (!hexes.length) { showMessage('Pick a color or generate a palette first.', 'error'); return; }
    var swatchSize = 140;
    var c = document.createElement('canvas');
    c.width = swatchSize * hexes.length; c.height = swatchSize;
    var ctx = c.getContext('2d');
    hexes.forEach(function (hex, i) {
      ctx.fillStyle = hex;
      ctx.fillRect(i * swatchSize, 0, swatchSize, swatchSize);
      ctx.fillStyle = (rgbToHsl(hexToRgb(hex).r, hexToRgb(hex).g, hexToRgb(hex).b).l > 55) ? '#111827' : '#f8fafc';
      ctx.font = '13px monospace';
      ctx.fillText(hex, i * swatchSize + 10, swatchSize - 14);
    });
    c.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'toolladda-palette.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, 'image/png');
  });

  /* ============================================================
     Reset
     ============================================================ */
  function resetTool() {
    window.ImageToolKit.revokeUrl(activeUrl);
    activeUrl = null;
    state.naturalW = 0; state.naturalH = 0; state.current = null; state.palette = []; state.average = null; state.recent = [];
    preUpload.classList.remove('hidden');
    editorRoot.classList.add('hidden');
    fileInput.value = '';
    imageCanvas.width = 0; imageCanvas.height = 0;
    renderPaletteGrid(); renderAverage(); renderGradient();
    renderSwatchStrip($('[data-recent-strip]', root), [], 'No colors picked yet.');
    $('[data-current-swatch]', root).style.background = 'transparent';
    $all('[data-v-hex],[data-v-rgb],[data-v-rgba],[data-v-hsl],[data-v-hsv],[data-v-cmyk],[data-v-lab],[data-nearest-name],[data-v-pos]', root).forEach(function (el) { el.textContent = '—'; });
    $('[data-fav-btn]', root).disabled = true;
    setStep(1);
    clearMessage();
  }
  $('[data-reset-btn]', root).addEventListener('click', resetTool);
  $('[data-change-image]', root).addEventListener('click', function () { fileInput.click(); });

  var stickyCta = $('[data-sticky-picker-cta]');
  if (stickyCta) {
    stickyCta.addEventListener('click', function () {
      var tool = document.getElementById('color-tool');
      if (tool) tool.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!state.naturalW) filePicker.click();
    });
  }

  window.addEventListener('resize', function () {
    if (state.naturalW) { /* keep current zoom on resize; user can click Fit to re-fit */ }
  });

  loadFavorites();
  renderFavorites();
  renderContrast();
})();
