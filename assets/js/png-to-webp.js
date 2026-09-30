/* ============================================================
   ToolAdda — Image to WebP Converter

   WHAT WAS WRONG BEFORE
   ---------------------
   1. The encoder result was never checked. Per the HTML spec, when
      canvas.toBlob() is handed a type the user agent cannot encode,
      it must silently fall back to image/png:

          canvas.toBlob(resolve, 'image/webp', quality);
          downloadLink.download = name.replace(/\.[^.]+$/, '.webp');

      So on a browser without WebP encoding the visitor downloaded a
      PNG named .webp and had no way to know. Every blob produced here
      is now checked against the type that was asked for, and WebP
      support is probed once up front so the option is simply not
      offered when it cannot be honoured.

   2. Only PNG was accepted — `if (!isPng) throw`. JPG, JPEG and WebP
      inputs were rejected outright despite the browser decoding all
      of them.

   3. One file at a time, no resize, no output format choice, and no
      way to turn a transparent image into JPG without the alpha
      silently becoming black.

   4. ImageToolKit.formatBytes always printed megabytes, so a 380 KB
      result read "0.37 MB".

   ARCHITECTURE
   ------------
   Everything below the export marker is pure and unit-tested in Node:
   naming, resize arithmetic, size deltas, format rules. The DOM layer
   only orchestrates — decode, draw, encode, revoke — so the parts that
   can be wrong in a subtle way are the parts under test.

   Nothing is uploaded. Decode, resize, encode and download all happen
   in the page.
   ============================================================ */

(function (globalScope) {
  'use strict';

  var MAX_PIXELS = 40000000;          /* ~40 MP before we warn */
  var MAX_FILE_BYTES = 30 * 1024 * 1024;
  var CONCURRENCY = 3;

  var FORMATS = {
    webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', alpha: true, lossy: true },
    png: { mime: 'image/png', ext: 'png', label: 'PNG', alpha: true, lossy: false },
    jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG', alpha: false, lossy: true }
  };

  var ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

  /* ============================================================
     1. Sizes
     ============================================================ */

  function formatBytes(bytes) {
    var b = Number(bytes);
    if (!isFinite(b) || b < 0) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /* A conversion can make a file bigger — re-encoding an already
     optimised JPG at high quality routinely does. Saying "saved" in
     that case would be a lie, so the direction is part of the result. */
  function sizeDelta(originalBytes, outputBytes) {
    var a = Number(originalBytes) || 0;
    var b = Number(outputBytes) || 0;
    var diff = a - b;
    var percent = a > 0 ? Math.abs(diff) / a * 100 : 0;
    return {
      original: a,
      output: b,
      smaller: diff > 0,
      larger: diff < 0,
      same: diff === 0,
      bytes: Math.abs(diff),
      percent: Math.round(percent * 10) / 10,
      label: diff > 0
        ? Math.round(percent * 10) / 10 + '% smaller'
        : (diff < 0 ? 'Output is ' + Math.round(percent * 10) / 10 + '% larger' : 'Same size')
    };
  }

  /* ============================================================
     2. Names

     `summer-photo.png` -> `summer-photo.webp`, never
     `summer-photo.png.webp`. A file with no extension simply gains
     one. Path separators and control characters are stripped so a
     hostile filename cannot escape the download attribute.
     ============================================================ */

  function sanitiseName(name) {
    return String(name || 'image')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/^\.+/, '')
      .trim() || 'image';
  }

  function baseName(name) {
    var clean = sanitiseName(name);
    var dot = clean.lastIndexOf('.');
    /* Only treat it as an extension if it is short and last. */
    if (dot > 0 && clean.length - dot <= 6) return clean.slice(0, dot);
    return clean;
  }

  function outputName(originalName, format) {
    var f = FORMATS[format] || FORMATS.webp;
    return baseName(originalName) + '.' + f.ext;
  }

  /* Two selected files can share a name. The second must not overwrite
     the first in the downloads folder. */
  function uniqueName(name, used) {
    var taken = used || {};
    if (!taken[name]) { taken[name] = true; return name; }
    var dot = name.lastIndexOf('.');
    var stem = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var i = 1;
    while (taken[stem + '-' + i + ext]) i += 1;
    var out = stem + '-' + i + ext;
    taken[out] = true;
    return out;
  }

  /* ============================================================
     3. Resize

     Locked is the default: changing one dimension derives the other.
     Nothing is stretched unless the lock is explicitly released.
     ============================================================ */

  function computeResize(natural, opts) {
    var w = Math.max(1, Math.round(Number(natural.width) || 1));
    var h = Math.max(1, Math.round(Number(natural.height) || 1));
    opts = opts || {};
    var mode = opts.mode || 'original';

    if (mode === 'original') return { width: w, height: h, changed: false };

    if (mode === 'percent') {
      var pct = Math.max(1, Math.min(400, Number(opts.percent) || 100));
      return {
        width: Math.max(1, Math.round(w * pct / 100)),
        height: Math.max(1, Math.round(h * pct / 100)),
        changed: pct !== 100
      };
    }

    if (mode === 'longest') {
      var cap = Math.max(1, Number(opts.longest) || Math.max(w, h));
      var longest = Math.max(w, h);
      /* Presets cap the longest edge and never enlarge. */
      if (longest <= cap) return { width: w, height: h, changed: false };
      var k = cap / longest;
      return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), changed: true };
    }

    /* Explicit width and/or height. */
    var tw = Number(opts.width);
    var th = Number(opts.height);
    var lock = opts.lock !== false;
    var ratio = w / h;

    if (lock) {
      if (tw > 0 && !(th > 0)) {
        return { width: Math.round(tw), height: Math.max(1, Math.round(tw / ratio)), changed: true };
      }
      if (th > 0 && !(tw > 0)) {
        return { width: Math.max(1, Math.round(th * ratio)), height: Math.round(th), changed: true };
      }
      if (tw > 0 && th > 0) {
        /* Both given with the lock on: fit inside the box rather than
           distort, which is what "keep aspect ratio" has to mean. */
        var scale = Math.min(tw / w, th / h);
        return {
          width: Math.max(1, Math.round(w * scale)),
          height: Math.max(1, Math.round(h * scale)),
          changed: true
        };
      }
      return { width: w, height: h, changed: false };
    }

    return {
      width: Math.max(1, Math.round(tw > 0 ? tw : w)),
      height: Math.max(1, Math.round(th > 0 ? th : h)),
      changed: (tw > 0 && Math.round(tw) !== w) || (th > 0 && Math.round(th) !== h)
    };
  }

  function aspectRatio(w, h) {
    function gcd(a, b) { return b ? gcd(b, a % b) : a; }
    var a = Math.round(Number(w) || 0);
    var b = Math.round(Number(h) || 0);
    if (a <= 0 || b <= 0) return '';
    var g = gcd(a, b);
    var rw = a / g;
    var rh = b / g;
    /* Only show a ratio that means something to a person. */
    if (rw > 40 || rh > 40) return (a / b).toFixed(2) + ':1';
    return rw + ':' + rh;
  }

  /* ============================================================
     4. Format rules
     ============================================================ */

  function formatFromMime(mime) {
    var m = String(mime || '').toLowerCase();
    if (m === 'image/png') return 'png';
    if (m === 'image/jpeg' || m === 'image/jpg') return 'jpeg';
    if (m === 'image/webp') return 'webp';
    if (m === 'image/gif') return 'gif';
    if (m === 'image/bmp' || m === 'image/x-ms-bmp') return 'bmp';
    return '';
  }

  function labelFor(format) {
    if (FORMATS[format]) return FORMATS[format].label;
    return String(format || '').toUpperCase() || 'Image';
  }

  function isAccepted(mime) {
    return ACCEPTED.indexOf(String(mime || '').toLowerCase()) !== -1;
  }

  /* JPEG has no alpha channel. Flattening onto a chosen colour is the
     only honest option, and the user has to pick it rather than
     discover black later. */
  function needsBackground(targetFormat, sourceHasAlpha) {
    return targetFormat === 'jpeg' && sourceHasAlpha === true;
  }

  function supportsAlpha(format) {
    return !!(FORMATS[format] && FORMATS[format].alpha);
  }

  /* Only lossy formats take a quality argument; passing one to PNG is
     ignored by every encoder, so the control is hidden instead. */
  function usesQuality(format) {
    return !!(FORMATS[format] && FORMATS[format].lossy);
  }

  var QUALITY_PRESETS = [
    { id: 'small', name: 'Small file', quality: 50 },
    { id: 'balanced', name: 'Balanced', quality: 75 },
    { id: 'high', name: 'High quality', quality: 90 },
    { id: 'max', name: 'Maximum', quality: 100 }
  ];

  function qualityWarning(quality) {
    var q = Number(quality);
    if (q <= 30) return 'Lower quality can introduce visible compression artifacts.';
    return '';
  }

  /* Canvas WebP encoding at quality 100 is still the lossy encoder at
     its highest setting — it is not WebP lossless, and saying so would
     be false. */
  function qualityNote(format, quality) {
    if (format !== 'webp') return '';
    if (Number(quality) >= 100) {
      return 'Quality 100 is the highest lossy setting the browser encoder offers — it is not WebP lossless.';
    }
    return '';
  }

  function pixelWarning(width, height) {
    var px = (Number(width) || 0) * (Number(height) || 0);
    if (px > MAX_PIXELS) {
      return 'This image is very large and may require significant browser memory.';
    }
    return '';
  }

  /* ============================================================
     5. Export
     ============================================================ */

  var engine = {
    FORMATS: FORMATS,
    ACCEPTED: ACCEPTED,
    MAX_PIXELS: MAX_PIXELS,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    CONCURRENCY: CONCURRENCY,
    QUALITY_PRESETS: QUALITY_PRESETS,

    formatBytes: formatBytes,
    sizeDelta: sizeDelta,
    sanitiseName: sanitiseName,
    baseName: baseName,
    outputName: outputName,
    uniqueName: uniqueName,
    computeResize: computeResize,
    aspectRatio: aspectRatio,
    formatFromMime: formatFromMime,
    labelFor: labelFor,
    isAccepted: isAccepted,
    needsBackground: needsBackground,
    supportsAlpha: supportsAlpha,
    usesQuality: usesQuality,
    qualityWarning: qualityWarning,
    qualityNote: qualityNote,
    pixelWarning: pixelWarning
  };

  globalScope.ToolAddaImageConvert = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     6. UI
     ============================================================ */

  /* Probe the encoders once. A format the browser cannot write is
     removed from the selector rather than silently producing a PNG
     under the wrong extension. */
  var ENCODERS = (function () {
    var out = { webp: false, png: true, jpeg: false };
    try {
      var c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      out.webp = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      out.jpeg = c.toDataURL('image/jpeg').indexOf('data:image/jpeg') === 0;
    } catch (e) { /* leave defaults */ }
    return out;
  }());

  var state = {
    items: [],
    target: ENCODERS.webp ? 'webp' : 'png',
    quality: 80,
    resizeMode: 'original',
    resizeWidth: '',
    resizeHeight: '',
    resizePercent: 100,
    resizeLongest: 1920,
    lockRatio: true,
    background: '#ffffff',
    converting: false,
    seq: 0
  };

  var dom = {};
  var announceTimer = null;
  var previewTimer = null;
  /* The phone bar stands in for a control that has scrolled off screen;
     this tracks which of those controls are visible. */
  var inView = { tool: true, convert: false, downloadAll: false };
  var phoneQuery = window.matchMedia ? window.matchMedia('(max-width: 768px)') : { matches: false };
  var JPG_ALPHA_NOTICE = 'JPG does not support transparency. Choose a background colour for the transparent areas.';

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function cacheDom() {
    dom.root = q('[data-iw-root]');
    if (!dom.root) return false;

    dom.drop = q('[data-iw-drop]', dom.root);
    dom.fileInput = q('#iwFile', dom.root);
    dom.picker = q('[data-iw-picker]', dom.root);
    dom.queue = q('[data-iw-queue]', dom.root);
    dom.empty = q('[data-iw-empty]', dom.root);
    dom.count = q('[data-iw-count]', dom.root);

    dom.target = q('#iwTarget', dom.root);
    dom.quality = q('#iwQuality', dom.root);
    dom.qualityOut = q('[data-iw-quality-out]', dom.root);
    dom.qualityRow = q('[data-iw-quality-row]', dom.root);
    dom.presets = q('[data-iw-presets]', dom.root);
    dom.qualityNote = q('[data-iw-quality-note]', dom.root);

    dom.resizeMode = q('#iwResizeMode', dom.root);
    dom.resizeCustom = q('[data-iw-resize-custom]', dom.root);
    dom.resizePercentRow = q('[data-iw-resize-percent]', dom.root);
    dom.resizeLongestRow = q('[data-iw-resize-longest]', dom.root);
    dom.width = q('#iwWidth', dom.root);
    dom.height = q('#iwHeight', dom.root);
    dom.lock = q('#iwLock', dom.root);
    dom.percent = q('#iwPercent', dom.root);
    dom.longest = q('#iwLongest', dom.root);

    dom.bgRow = q('[data-iw-bg-row]', dom.root);
    dom.bg = q('#iwBg', dom.root);
    dom.bgChips = q('[data-iw-bg-chips]', dom.root);

    dom.convert = q('[data-iw-convert]', dom.root);
    dom.downloadAll = q('[data-iw-download-all]', dom.root);
    dom.clearAll = q('[data-iw-clear]', dom.root);
    dom.progress = q('[data-iw-progress]', dom.root);
    dom.progressBar = q('[data-iw-progress-bar]', dom.root);
    dom.status = q('[data-iw-status]', dom.root);
    dom.notice = q('[data-iw-notice]', dom.root);
    dom.announce = q('[data-iw-announce]', dom.root);
    dom.support = q('[data-iw-support]', dom.root);
    dom.sticky = q('[data-iw-sticky]');
    dom.stickyBar = dom.sticky ? dom.sticky.closest('.iw-sticky-cta') : null;
    return true;
  }

  function announce(msg) {
    if (!dom.announce) return;
    dom.announce.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.announce.textContent = msg; }, 60);
  }

  function setStatus(kind, text) {
    if (!dom.status) return;
    dom.status.setAttribute('data-state', kind);
    dom.status.textContent = text;
  }

  function notice(text, kind) {
    if (!dom.notice) return;
    dom.notice.hidden = !text;
    dom.notice.textContent = text || '';
    dom.notice.setAttribute('data-kind', kind || 'info');
  }

  /* ---------- object URL bookkeeping ---------- */

  function revoke(url) {
    if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
  }
  function disposeItem(item) {
    revoke(item.previewUrl);
    revoke(item.outputUrl);
    item.previewUrl = null;
    item.outputUrl = null;
    item.bitmap = null;
    item.blob = null;
  }

  /* ---------- decoding ---------- */

  /* createImageBitmap decodes off the main thread and already honours
     EXIF orientation when asked. HTMLImageElement is the fallback;
     modern browsers apply orientation there too. */
  function decode(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return createImageBitmap(file, { imageOrientation: 'from-image' })
          .catch(function () { return decodeViaImg(file); });
      } catch (e) { return decodeViaImg(file); }
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { revoke(url); resolve(img); };
      img.onerror = function () { revoke(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function sizeOf(source) {
    return {
      width: source.naturalWidth || source.width || 0,
      height: source.naturalHeight || source.height || 0
    };
  }

  /* Sample the alpha channel to find out whether the image actually
     uses transparency, rather than assuming it from the file type. */
  function hasAlpha(source, dims) {
    if (!dims.width || !dims.height) return false;
    var w = Math.min(200, dims.width);
    var h = Math.max(1, Math.round(dims.height * (w / dims.width)));
    try {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      for (var i = 3; i < data.length; i += 4) {
        if (data[i] < 250) return true;
      }
    } catch (e) { return false; }
    return false;
  }

  /* ---------- encoding ---------- */

  function encode(source, dims, targetFormat, quality, background) {
    return new Promise(function (resolve, reject) {
      var f = FORMATS[targetFormat];
      var canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;
      var ctx = canvas.getContext('2d');

      /* Flatten onto the chosen colour before drawing, so a transparent
         source never lands on an unexpected black background. */
      if (!f.alpha) {
        ctx.fillStyle = background || '#ffffff';
        ctx.fillRect(0, 0, dims.width, dims.height);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, dims.width, dims.height);

      var args = usesQuality(targetFormat)
        ? [f.mime, Math.max(0.01, Math.min(1, Number(quality) / 100))]
        : [f.mime];

      canvas.toBlob(function (blob) {
        /* Free the backing store as soon as the blob exists. */
        canvas.width = 0; canvas.height = 0;
        if (!blob) { reject(new Error('encode')); return; }
        /* The spec lets the UA fall back to PNG for a type it cannot
           write. Catching that here is what stops a PNG being handed
           over named .webp. */
        if (blob.type && blob.type !== f.mime) {
          reject(new Error('unsupported:' + blob.type));
          return;
        }
        resolve(blob);
      }, args[0], args[1]);
    });
  }

  /* ---------- queue ---------- */

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var rejected = 0;
    var added = 0;

    files.forEach(function (file) {
      if (!isAccepted(file.type)) { rejected += 1; return; }
      if (file.size > MAX_FILE_BYTES) { rejected += 1; return; }
      state.seq += 1;
      state.items.push({
        id: 'f' + state.seq,
        file: file,
        name: sanitiseName(file.name),
        sourceFormat: formatFromMime(file.type),
        status: 'pending',
        error: '',
        width: 0, height: 0,
        alpha: false,
        previewUrl: null,
        outputUrl: null,
        outputName: '',
        outputSize: 0,
        blob: null
      });
      added += 1;
    });

    if (rejected) {
      notice(rejected + (rejected === 1 ? ' file was' : ' files were') +
        ' skipped — unsupported format or larger than ' + formatBytes(MAX_FILE_BYTES) + '.', 'warn');
    } else {
      notice('');
    }

    if (added) {
      announce(added + (added === 1 ? ' image added.' : ' images added.'));
      renderQueue();
      loadPending();
    }
  }

  function loadPending() {
    state.items.filter(function (i) { return i.status === 'pending' && !i.previewUrl; })
      .forEach(function (item) {
        item.status = 'reading';
        decode(item.file).then(function (source) {
          var dims = sizeOf(source);
          item.width = dims.width;
          item.height = dims.height;
          item.alpha = hasAlpha(source, dims);
          item.previewUrl = URL.createObjectURL(item.file);
          item.status = 'ready';
          if (source.close) source.close();
          renderQueue();
          syncTransparencyNotice();
        }, function () {
          item.status = 'error';
          item.error = 'This image could not be decoded by your browser.';
          renderQueue();
        });
      });
  }

  /* A result belongs to the settings that produced it. Changing the format,
     quality, size or background afterwards used to leave every card showing
     its old result under the new label — "PNG → JPG" next to a download that
     was still the WebP. Those results are now withdrawn instead, and the
     images go back to waiting for Convert. */
  function invalidateResults() {
    var stale = 0;
    state.items.forEach(function (item) {
      if (item.status !== 'done') return;
      revoke(item.outputUrl);
      item.outputUrl = null;
      item.blob = null;
      item.outputSize = 0;
      item.status = 'ready';
      stale += 1;
    });
    if (!stale) return;
    setStatus('stale', 'Settings changed — convert again');
    renderQueue();
    announce('Settings changed. Press Convert images to apply them.');
  }

  function removeItem(id) {
    if (state.converting) return;
    var idx = -1;
    state.items.forEach(function (it, i) { if (it.id === id) idx = i; });
    if (idx < 0) return;
    disposeItem(state.items[idx]);
    state.items.splice(idx, 1);
    renderQueue();
    syncTransparencyNotice();
    announce('Image removed.');
  }

  function clearAll() {
    state.items.forEach(disposeItem);
    state.items = [];
    if (dom.fileInput) dom.fileInput.value = '';
    notice('');
    setStatus('idle', 'Ready');
    if (dom.progress) dom.progress.hidden = true;
    renderQueue();
    announce('All images cleared.');
  }

  /* ---------- rendering ---------- */

  function statusLabel(item) {
    if (item.status === 'reading') return 'Reading…';
    if (item.status === 'ready') return 'Ready';
    if (item.status === 'converting') return 'Converting…';
    if (item.status === 'done') return 'Converted';
    if (item.status === 'error') return 'Failed';
    return 'Ready';
  }

  function renderQueue() {
    if (!dom.queue) return;
    dom.queue.textContent = '';

    var has = state.items.length > 0;
    /* Settings and actions wait for the first image (see .has-images in the
       page CSS); the drop zone shrinks to a strip that still takes files. */
    if (dom.root) dom.root.classList.toggle('has-images', has);
    if (dom.drop) {
      dom.drop.setAttribute('aria-label', has
        ? 'Drop more images here or click to choose files'
        : 'Drop images here or click to choose files');
    }
    if (dom.empty) dom.empty.hidden = has;
    if (dom.count) {
      dom.count.textContent = has
        ? state.items.length + (state.items.length === 1 ? ' image selected' : ' images selected')
        : '';
    }
    if (dom.convert) dom.convert.disabled = !has || state.converting;
    if (dom.clearAll) dom.clearAll.disabled = !has || state.converting;
    var done = state.items.filter(function (i) { return i.status === 'done'; });
    if (dom.downloadAll) dom.downloadAll.disabled = done.length === 0;

    state.items.forEach(function (item) {
      var card = el('li', 'iw-card' + (item.status === 'error' ? ' is-error' : ''));

      var thumbWrap = el('div', 'iw-thumb');
      if (item.previewUrl) {
        var img = document.createElement('img');
        img.src = item.previewUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        thumbWrap.appendChild(img);
      }
      card.appendChild(thumbWrap);

      var meta = el('div', 'iw-meta');
      /* Filenames are user-controlled: always text, never markup. */
      meta.appendChild(el('p', 'iw-name', item.name));

      var facts = [];
      if (item.width) facts.push(item.width + ' × ' + item.height);
      if (item.width) facts.push(aspectRatio(item.width, item.height));
      facts.push(labelFor(item.sourceFormat));
      facts.push(formatBytes(item.file.size));
      meta.appendChild(el('p', 'iw-facts', facts.filter(Boolean).join(' • ')));

      if (item.alpha) meta.appendChild(el('p', 'iw-alpha', 'Transparent background detected'));

      if (item.status === 'done') {
        var d = sizeDelta(item.file.size, item.outputSize);
        var outLabel = labelFor(item.outputFormat || state.target);
        var line = el('p', 'iw-result');
        line.appendChild(el('span', 'iw-arrow', labelFor(item.sourceFormat) + ' → ' + outLabel));
        line.appendChild(el('strong', null, formatBytes(item.outputSize)));
        line.appendChild(el('span', 'iw-delta iw-delta--' + (d.smaller ? 'down' : (d.larger ? 'up' : 'same')), d.label));
        meta.appendChild(line);

        /* Two bars drawn to the real byte counts. */
        var bars = el('div', 'iw-bars');
        var max = Math.max(item.file.size, item.outputSize) || 1;
        [['Original', item.file.size], [outLabel, item.outputSize]].forEach(function (row, i) {
          var r = el('div', 'iw-bar');
          r.appendChild(el('span', 'iw-bar__label', row[0]));
          var track = el('span', 'iw-bar__track');
          var fill = el('span', 'iw-bar__fill' + (i === 1 ? ' is-out' : ''));
          fill.style.width = Math.max(2, Math.round(row[1] / max * 100)) + '%';
          track.appendChild(fill);
          r.appendChild(track);
          r.appendChild(el('span', 'iw-bar__size', formatBytes(row[1])));
          bars.appendChild(r);
        });
        meta.appendChild(bars);
      }

      if (item.status === 'error' && item.error) {
        meta.appendChild(el('p', 'iw-error', item.error));
      }
      card.appendChild(meta);

      var side = el('div', 'iw-side');
      var badge = el('span', 'iw-status iw-status--' + item.status, statusLabel(item));
      side.appendChild(badge);

      if (item.status === 'done' && item.outputUrl) {
        var a = document.createElement('a');
        a.className = 'iw-btn iw-btn--accent iw-btn--sm';
        a.href = item.outputUrl;
        a.download = item.outputName;
        a.textContent = 'Download';
        side.appendChild(a);
      }

      var rm = el('button', 'iw-btn iw-btn--ghost iw-btn--sm', 'Remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + item.name);
      /* Removing a file mid-conversion let its result land on an object
         nobody held any more, leaking the blob URL. */
      rm.disabled = state.converting;
      rm.addEventListener('click', function () { removeItem(item.id); });
      side.appendChild(rm);

      card.appendChild(side);
      dom.queue.appendChild(card);
    });
    updateSticky();
  }

  function syncTransparencyNotice() {
    var anyAlpha = state.items.some(function (i) { return i.alpha; });
    var show = needsBackground(state.target, anyAlpha);
    if (dom.bgRow) dom.bgRow.hidden = !show;
    if (show) {
      notice(JPG_ALPHA_NOTICE, 'warn');
    } else if (dom.notice && dom.notice.textContent === JPG_ALPHA_NOTICE) {
      // Switching back from JPG used to leave this warning on screen.
      notice('');
    }
  }

  /* Phone bottom bar: choose images while the drop zone is off screen, then
     convert while the Convert button is, then download once everything is
     converted and Download all has scrolled away. */
  function updateSticky() {
    if (!dom.sticky || !dom.stickyBar) return;
    var has = state.items.length > 0;
    var pending = state.items.some(function (i) { return i.status !== 'done' && i.status !== 'error'; });
    var done = state.items.filter(function (i) { return i.status === 'done'; }).length;
    var action = 'pick';
    var label = 'Select images';
    var show = !inView.tool;
    if (has && pending) {
      action = 'convert';
      label = 'Convert ' + state.items.length + (state.items.length === 1 ? ' image' : ' images');
      show = !inView.convert;
    } else if (done) {
      action = 'download';
      label = done === 1 ? 'Download ' + labelFor(state.target) : 'Download all (' + done + ')';
      show = !inView.downloadAll;
    }
    show = show && phoneQuery.matches && !state.converting;
    dom.sticky.setAttribute('data-action', action);
    if (dom.sticky.textContent !== label) dom.sticky.textContent = label;
    dom.stickyBar.classList.toggle('is-visible', show);
    dom.stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    dom.sticky.tabIndex = show ? 0 : -1;
    var was = document.body.classList.contains('iw-sticky-on');
    document.body.classList.toggle('iw-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }

  function syncControls() {
    var lossy = usesQuality(state.target);
    if (dom.qualityRow) dom.qualityRow.hidden = !lossy;
    if (dom.qualityOut) dom.qualityOut.textContent = state.quality;
    if (dom.quality) dom.quality.value = state.quality;

    if (dom.presets) {
      qa('[data-iw-preset]', dom.presets).forEach(function (b) {
        b.setAttribute('aria-pressed', Number(b.getAttribute('data-iw-preset')) === Number(state.quality) ? 'true' : 'false');
      });
    }

    var note = [qualityWarning(state.quality), qualityNote(state.target, state.quality)]
      .filter(Boolean).join(' ');
    if (dom.qualityNote) {
      dom.qualityNote.hidden = !note;
      dom.qualityNote.textContent = note;
    }

    if (dom.resizeCustom) dom.resizeCustom.hidden = state.resizeMode !== 'custom';
    if (dom.resizePercentRow) dom.resizePercentRow.hidden = state.resizeMode !== 'percent';
    if (dom.resizeLongestRow) dom.resizeLongestRow.hidden = state.resizeMode !== 'longest';

    syncTransparencyNotice();
  }

  function resizeOptions() {
    return {
      mode: state.resizeMode,
      width: state.resizeWidth,
      height: state.resizeHeight,
      percent: state.resizePercent,
      longest: state.resizeLongest,
      lock: state.lockRatio
    };
  }

  /* ---------- conversion ---------- */

  function convertOne(item, used) {
    item.status = 'converting';
    renderQueue();

    return decode(item.file).then(function (source) {
      var natural = sizeOf(source);
      var dims = computeResize(natural, resizeOptions());
      var warn = pixelWarning(dims.width, dims.height);
      if (warn) notice(warn, 'warn');

      return encode(source, dims, state.target, state.quality, state.background)
        .then(function (blob) {
          if (source.close) source.close();
          revoke(item.outputUrl);
          item.blob = blob;
          item.outputUrl = URL.createObjectURL(blob);
          item.outputName = item.plannedName || uniqueName(outputName(item.name, state.target), used);
          item.outputSize = blob.size;
          item.outputFormat = state.target;
          item.width = dims.width;
          item.height = dims.height;
          item.status = 'done';
          item.error = '';
        });
    }).catch(function (err) {
      item.status = 'error';
      var msg = String((err && err.message) || '');
      if (msg.indexOf('unsupported:') === 0) {
        item.error = 'Your browser cannot write ' + labelFor(state.target) +
          ' — it produced ' + msg.split(':')[1] + ' instead. Pick another output format.';
      } else if (msg === 'decode') {
        item.error = 'This image could not be decoded by your browser.';
      } else {
        item.error = 'This image could not be converted.';
      }
    });
  }

  /* Each image reads the format, quality and size as it is encoded, so a
     change halfway through a batch would split it across two formats. The
     controls are locked for the length of the run. */
  function lockSettings(on) {
    [dom.target, dom.quality, dom.resizeMode, dom.width, dom.height, dom.lock, dom.percent, dom.longest, dom.bg]
      .forEach(function (c) { if (c) c.disabled = on; });
    qa('.iw-chip', dom.root).forEach(function (b) { b.disabled = on; });
  }

  /* A small pool rather than Promise.all over the whole queue: fifty
     large decodes at once is how a tab runs out of memory. */
  function convertAll() {
    if (state.converting || !state.items.length) return;
    var targets = state.items.filter(function (i) { return i.status !== 'error' || true; });
    var used = {};
    /* Names are settled in queue order before the pool starts. Three images
       convert at once, so naming them as they finished handed the "-1" suffix
       to whichever file happened to finish second, which could change from
       one run to the next. */
    targets.forEach(function (item) { item.plannedName = uniqueName(outputName(item.name, state.target), used); });
    var total = targets.length;
    var finished = 0;
    var index = 0;

    state.converting = true;
    lockSettings(true);
    if (dom.progress) dom.progress.hidden = false;
    setStatus('working', 'Converting 1 of ' + total);
    renderQueue();

    function tick() {
      finished += 1;
      var pct = Math.round(finished / total * 100);
      if (dom.progressBar) dom.progressBar.style.width = pct + '%';
      if (dom.progress) dom.progress.setAttribute('aria-valuenow', String(pct));
      setStatus('working', 'Converting ' + Math.min(finished + 1, total) + ' of ' + total);
      renderQueue();
    }

    function next() {
      if (index >= total) return Promise.resolve();
      var item = targets[index++];
      return convertOne(item, used).then(function () { tick(); return next(); });
    }

    var pool = [];
    for (var i = 0; i < Math.min(CONCURRENCY, total); i += 1) pool.push(next());

    Promise.all(pool).then(function () {
      state.converting = false;
      lockSettings(false);
      var ok = state.items.filter(function (x) { return x.status === 'done'; }).length;
      var bad = state.items.filter(function (x) { return x.status === 'error'; }).length;
      setStatus(bad ? 'partial' : 'done',
        ok + ' converted' + (bad ? ', ' + bad + ' failed' : ''));
      if (dom.progress) dom.progress.hidden = true;
      renderQueue();
      announce(ok + ' images converted' + (bad ? ', ' + bad + ' failed' : '') + '.');
    });
  }

  /* ---------- downloads ---------- */

  function downloadAll() {
    var done = state.items.filter(function (i) { return i.status === 'done' && i.blob; });
    if (!done.length) return;

    if (done.length > 1 && globalScope.JSZip) {
      var zip = new globalScope.JSZip();
      done.forEach(function (i) { zip.file(i.outputName, i.blob); });
      setStatus('working', 'Building ZIP…');
      zip.generateAsync({ type: 'blob' }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'tooladda-images.zip';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { revoke(url); }, 1500);
        setStatus('done', done.length + ' images in ZIP');
        announce('ZIP with ' + done.length + ' images downloaded.');
      }, function () {
        setStatus('partial', 'ZIP failed — downloading individually');
        done.forEach(saveOne);
      });
      return;
    }
    done.forEach(saveOne);
    announce(done.length + ' downloads started.');
  }

  function saveOne(item) {
    var a = document.createElement('a');
    a.href = item.outputUrl;
    a.download = item.outputName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  /* ---------- events ---------- */

  function bindEvents() {
    if (dom.picker) dom.picker.addEventListener('click', function () { dom.fileInput.click(); });
    if (dom.fileInput) {
      dom.fileInput.addEventListener('change', function (e) {
        addFiles(e.target.files);
        e.target.value = '';
      });
    }

    if (dom.drop) {
      /* The zone is a plain group now (it holds a real button), so a click on
         any empty part of it opens the picker, as it looks like it should. */
      dom.drop.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('button, input, a')) return;
        dom.fileInput.click();
      });
    }

    /* Files can be dropped anywhere on the panel, not only on the drop zone,
       which shrinks to a strip once images are in. A file dropped anywhere
       else on the page is swallowed: left to the browser it would open the
       image in the tab and throw away the whole queue. */
    function carriesFiles(e) {
      return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1);
    }
    var dragDepth = 0;
    dom.root.addEventListener('dragenter', function (e) {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      dragDepth += 1;
      dom.root.classList.add('is-file-over');
      if (dom.drop) dom.drop.classList.add('is-dragging');
    });
    dom.root.addEventListener('dragover', function (e) {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dom.root.addEventListener('dragleave', function (e) {
      if (!carriesFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) {
        dom.root.classList.remove('is-file-over');
        if (dom.drop) dom.drop.classList.remove('is-dragging');
      }
    });
    dom.root.addEventListener('drop', function (e) {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      dom.root.classList.remove('is-file-over');
      if (dom.drop) dom.drop.classList.remove('is-dragging');
      addFiles(e.dataTransfer.files);
    });
    ['dragover', 'drop'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (carriesFiles(e) && !dom.root.contains(e.target)) e.preventDefault();
      });
    });

    /* Paste: a screenshot on the clipboard is the most common image people
       have to hand. Text pasted into the number fields is left alone. */
    document.addEventListener('paste', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || [])
        .filter(function (f) { return isAccepted(f.type); });
      if (!files.length) return;
      e.preventDefault();
      /* Clipboard images all arrive as "image.png"; number them. */
      files = files.map(function (f, i) {
        if (!/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) return f;
        var ext = f.name.split('.').pop();
        return new File([f], 'pasted-' + (state.seq + i + 1) + '.' + ext, { type: f.type });
      });
      addFiles(files);
    });

    if (dom.target) {
      dom.target.addEventListener('change', function () {
        state.target = dom.target.value;
        invalidateResults();
        syncControls();
        renderQueue();
        announce('Output format set to ' + labelFor(state.target) + '.');
      });
    }

    if (dom.quality) {
      dom.quality.addEventListener('input', function () {
        state.quality = Number(dom.quality.value);
        if (dom.qualityOut) dom.qualityOut.textContent = state.quality;
        invalidateResults();
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(syncControls, 150);
      });
    }
    if (dom.presets) {
      dom.presets.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-iw-preset]');
        if (!b) return;
        state.quality = Number(b.getAttribute('data-iw-preset'));
        invalidateResults();
        syncControls();
        announce('Quality set to ' + state.quality + '.');
      });
    }

    if (dom.resizeMode) {
      dom.resizeMode.addEventListener('change', function () {
        state.resizeMode = dom.resizeMode.value;
        invalidateResults();
        syncControls();
      });
    }
    if (dom.lock) {
      dom.lock.addEventListener('change', function () { state.lockRatio = dom.lock.checked; invalidateResults(); });
    }
    /* Typing a width derives the height from the first image's ratio,
       so the number the user sees is the number they will get. */
    if (dom.width) {
      dom.width.addEventListener('input', function () {
        state.resizeWidth = dom.width.value;
        if (!state.lockRatio) return;
        var first = state.items.filter(function (i) { return i.width; })[0];
        if (!first || !dom.width.value) return;
        var out = computeResize({ width: first.width, height: first.height },
          { mode: 'custom', width: dom.width.value, lock: true });
        dom.height.value = out.height;
        state.resizeHeight = '';
      });
    }
    if (dom.height) {
      dom.height.addEventListener('input', function () {
        state.resizeHeight = dom.height.value;
        if (!state.lockRatio) return;
        var first = state.items.filter(function (i) { return i.width; })[0];
        if (!first || !dom.height.value) return;
        var out = computeResize({ width: first.width, height: first.height },
          { mode: 'custom', height: dom.height.value, lock: true });
        dom.width.value = out.width;
        state.resizeWidth = '';
      });
    }
    if (dom.width) dom.width.addEventListener('input', invalidateResults);
    if (dom.height) dom.height.addEventListener('input', invalidateResults);
    if (dom.percent) dom.percent.addEventListener('input', function () { state.resizePercent = Number(dom.percent.value); invalidateResults(); });
    if (dom.longest) dom.longest.addEventListener('change', function () { state.resizeLongest = Number(dom.longest.value); invalidateResults(); });

    if (dom.bg) dom.bg.addEventListener('input', function () { state.background = dom.bg.value; invalidateResults(); });
    if (dom.bgChips) {
      dom.bgChips.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-iw-bg]');
        if (!b) return;
        state.background = b.getAttribute('data-iw-bg');
        if (dom.bg) dom.bg.value = state.background;
        invalidateResults();
      });
    }

    if (dom.convert) dom.convert.addEventListener('click', convertAll);
    if (dom.downloadAll) dom.downloadAll.addEventListener('click', downloadAll);
    if (dom.clearAll) dom.clearAll.addEventListener('click', clearAll);

    if (dom.sticky) {
      dom.sticky.addEventListener('click', function () {
        if (state.converting) return;
        var action = dom.sticky.getAttribute('data-action');
        if (action === 'download') { downloadAll(); return; }
        dom.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (action === 'convert') convertAll();
        else dom.fileInput.click();
      });
    }
    if ('IntersectionObserver' in window) {
      var watch = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.target === dom.root) inView.tool = entry.isIntersecting;
          else if (entry.target === dom.convert) inView.convert = entry.isIntersecting;
          else if (entry.target === dom.downloadAll) inView.downloadAll = entry.isIntersecting;
        });
        updateSticky();
      });
      watch.observe(dom.root);
      if (dom.convert) watch.observe(dom.convert);
      if (dom.downloadAll) watch.observe(dom.downloadAll);
    } else {
      inView.tool = false;
    }
    if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);

    /* Blob URLs outlive the page otherwise. */
    window.addEventListener('pagehide', function () { state.items.forEach(disposeItem); });
  }

  function renderFormatOptions() {
    if (!dom.target) return;
    dom.target.textContent = '';
    ['webp', 'png', 'jpeg'].forEach(function (id) {
      if (!ENCODERS[id]) return;
      var o = document.createElement('option');
      o.value = id;
      o.textContent = FORMATS[id].label;
      dom.target.appendChild(o);
    });
    dom.target.value = state.target;

    if (dom.support && !ENCODERS.webp) {
      dom.support.hidden = false;
      dom.support.textContent = 'Your browser cannot write WebP images, so WebP has been removed from the output list. PNG and JPG are still available.';
    }
  }

  function renderPresets() {
    if (!dom.presets) return;
    dom.presets.innerHTML = QUALITY_PRESETS.map(function (p) {
      return '<button type="button" class="iw-chip" data-iw-preset="' + p.quality + '">' +
        esc(p.name) + ' · ' + p.quality + '</button>';
    }).join('');
  }

  function init() {
    if (!cacheDom()) return;
    renderFormatOptions();
    renderPresets();
    syncControls();
    renderQueue();
    bindEvents();
    setStatus('idle', 'Ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
