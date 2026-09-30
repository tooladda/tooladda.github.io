/* ==========================================================================
   ToolAdda — Passport Photo Engine

   Pure, dependency-free logic behind the Passport Size Photo Maker.
   Canvas work stays in the UI; everything computable lives here so it can
   be tested without a browser.

   The rules this file encodes are the ones that actually get photos
   rejected:

     • A passport photo is a PHYSICAL size at a stated print resolution.
       35 × 45 mm at 300 DPI is 413 × 531 px — not "about 400 px". Every
       preset stores millimetres and a DPI and derives pixels from them.

     • The head must occupy a set fraction of the frame. Most authorities
       specify it, and a correctly cropped but wrongly scaled head is the
       most common rejection reason, so the guide overlay is computed from
       the preset rather than drawn at a fixed size.

     • Upscaling is a lie. If the source photo has fewer pixels than the
       target needs, the result is soft and can be rejected. That is
       reported, not silently interpolated.

     • Indian exam portals enforce hard file-size caps in KB. Hitting them
       needs a real search over JPEG quality, not a guess.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Helpers
     ====================================================================== */

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) n = typeof fallback === 'number' ? fallback : lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeHex(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return fallback || '#ffffff';
  }

  var MM_PER_INCH = 25.4;

  function mmToPx(mm, dpi) { return Math.round((mm / MM_PER_INCH) * dpi); }
  function inchToPx(inch, dpi) { return Math.round(inch * dpi); }
  function pxToMm(px, dpi) { return (px / dpi) * MM_PER_INCH; }

  /* ======================================================================
     2. Presets
     ====================================================================== */

  /**
   * Every preset carries millimetres plus a DPI, so the pixel size is
   * derived rather than hard-coded. Where an authority publishes an exact
   * pixel requirement instead (several Indian exam portals do), `px`
   * overrides the derivation and the millimetre figure is informational.
   *
   * `head` is the fraction of the image height the head should occupy,
   * from the relevant published guidance. `maxKB` is a hard portal limit.
   */
  var PRESETS = [
    /* ---- India ---- */
    { id: 'in-passport', group: 'India', label: 'Passport / Visa', mm: [35, 45], dpi: 300, head: [0.62, 0.74],
      note: 'Indian passport photo: 35 × 45 mm, plain white background, full face, front view.' },
    { id: 'in-pan', group: 'India', label: 'PAN card', mm: [25, 35], dpi: 300, head: [0.60, 0.75] },
    { id: 'in-aadhaar', group: 'India', label: 'Aadhaar', mm: [35, 45], dpi: 300, head: [0.60, 0.75] },
    { id: 'in-voter', group: 'India', label: 'Voter ID', mm: [35, 45], dpi: 300, head: [0.60, 0.75] },
    { id: 'in-dl', group: 'India', label: 'Driving licence', mm: [35, 45], dpi: 300, head: [0.60, 0.75] },
    { id: 'in-ssc', group: 'India', label: 'SSC / UPSC exam', px: [200, 230], mm: [35, 45], dpi: 300, maxKB: 50,
      note: 'Most SSC and UPSC portals want 200 × 230 px and cap the file at 20–50 KB.' },
    { id: 'in-neet', group: 'India', label: 'NEET / JEE', px: [200, 230], mm: [35, 45], dpi: 300, maxKB: 200,
      note: 'Check the current information bulletin — these portals change their limits most years.' },
    { id: 'in-bank', group: 'India', label: 'Bank KYC', mm: [35, 45], dpi: 300, maxKB: 100 },

    /* ---- Rest of world ---- */
    { id: 'us-passport', group: 'United States', label: 'Passport / Visa', inch: [2, 2], dpi: 300, head: [0.50, 0.69],
      note: 'US rules measure the head from chin to crown at 1 to 1 3/8 inches on a 2 × 2 inch photo.' },
    { id: 'us-greencard', group: 'United States', label: 'Green card', inch: [2, 2], dpi: 300, head: [0.50, 0.69] },
    { id: 'uk-passport', group: 'United Kingdom', label: 'Passport', mm: [35, 45], dpi: 300, head: [0.64, 0.75] },
    { id: 'schengen', group: 'Europe', label: 'Schengen visa', mm: [35, 45], dpi: 300, head: [0.70, 0.80] },
    { id: 'de-passport', group: 'Europe', label: 'Germany', mm: [35, 45], dpi: 300, head: [0.70, 0.80] },
    { id: 'fr-passport', group: 'Europe', label: 'France', mm: [35, 45], dpi: 300, head: [0.70, 0.80] },
    { id: 'it-passport', group: 'Europe', label: 'Italy', mm: [35, 45], dpi: 300, head: [0.70, 0.80] },
    { id: 'ca-passport', group: 'Canada', label: 'Passport', mm: [50, 70], dpi: 300, head: [0.44, 0.51],
      note: 'Canada uses a larger 50 × 70 mm photo with a smaller head fraction.' },
    { id: 'au-passport', group: 'Australia', label: 'Passport', mm: [35, 45], dpi: 300, head: [0.65, 0.80] },
    { id: 'cn-visa', group: 'China', label: 'Visa', mm: [33, 48], dpi: 300, head: [0.60, 0.70] },
    { id: 'jp-passport', group: 'Japan', label: 'Passport', mm: [35, 45], dpi: 300, head: [0.70, 0.80] },
    { id: 'ae-visa', group: 'UAE', label: 'Visa', mm: [43, 55], dpi: 300, head: [0.62, 0.75] },
    { id: 'sg-passport', group: 'Singapore', label: 'Passport', mm: [35, 45], dpi: 300, head: [0.60, 0.80] },
    { id: 'br-passport', group: 'Brazil', label: 'Passport', mm: [50, 70], dpi: 300, head: [0.44, 0.51] },
    { id: 'za-passport', group: 'South Africa', label: 'Passport', mm: [35, 45], dpi: 300, head: [0.62, 0.75] },
    { id: 'ru-visa', group: 'Russia', label: 'Visa', mm: [35, 45], dpi: 300, head: [0.62, 0.75] },

    { id: 'custom', group: 'Custom', label: 'Custom size', mm: [35, 45], dpi: 300, head: [0.62, 0.74] }
  ];

  var PRESET_IDS = PRESETS.map(function (p) { return p.id; });

  function getPreset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return PRESETS[0];
  }

  /** Presets grouped by country, in declaration order. */
  function presetGroups() {
    var order = [];
    var map = {};
    PRESETS.forEach(function (p) {
      if (!map[p.group]) { map[p.group] = []; order.push(p.group); }
      map[p.group].push(p);
    });
    return order.map(function (g) { return { group: g, presets: map[g] }; });
  }

  /**
   * The output size in pixels, and the physical size it represents.
   * A published pixel requirement wins over the millimetre derivation.
   */
  function presetSize(preset, custom) {
    var p = preset;
    if (p.id === 'custom' && custom) {
      var dpi = Math.round(clampNum(custom.dpi, 72, 1200, 300));
      var unit = oneOf(custom.unit, ['mm', 'inch', 'px'], 'mm');
      var w = clampNum(custom.width, 1, 20000, 35);
      var h = clampNum(custom.height, 1, 20000, 45);
      if (unit === 'px') {
        return { width: Math.round(w), height: Math.round(h), dpi: dpi,
          mm: [pxToMm(w, dpi), pxToMm(h, dpi)], exactPx: true };
      }
      if (unit === 'inch') {
        return { width: inchToPx(w, dpi), height: inchToPx(h, dpi), dpi: dpi,
          mm: [w * MM_PER_INCH, h * MM_PER_INCH], exactPx: false };
      }
      return { width: mmToPx(w, dpi), height: mmToPx(h, dpi), dpi: dpi, mm: [w, h], exactPx: false };
    }

    var d = p.dpi || 300;
    if (p.px) {
      return { width: p.px[0], height: p.px[1], dpi: d, mm: p.mm || [pxToMm(p.px[0], d), pxToMm(p.px[1], d)], exactPx: true };
    }
    if (p.inch) {
      return { width: inchToPx(p.inch[0], d), height: inchToPx(p.inch[1], d), dpi: d,
        mm: [p.inch[0] * MM_PER_INCH, p.inch[1] * MM_PER_INCH], exactPx: false };
    }
    return { width: mmToPx(p.mm[0], d), height: mmToPx(p.mm[1], d), dpi: d, mm: p.mm.slice(), exactPx: false };
  }

  /* ======================================================================
     3. Crop geometry
     ====================================================================== */

  /** The smallest zoom at which the image still covers the whole frame. */
  function minZoomToCover(imgW, imgH, frameW, frameH) {
    if (!imgW || !imgH || !frameW || !frameH) return 1;
    return Math.max(frameW / imgW, frameH / imgH);
  }

  /**
   * Keep the image covering the frame — a passport photo may not have
   * transparent or blank edges, so panning has to stop at the image edge.
   */
  function clampPan(pan, imgW, imgH, frameW, frameH, zoom) {
    var drawnW = imgW * zoom;
    var drawnH = imgH * zoom;
    var maxX = Math.max(0, (drawnW - frameW) / 2);
    var maxY = Math.max(0, (drawnH - frameH) / 2);
    return {
      x: clampNum(pan.x, -maxX, maxX, 0),
      y: clampNum(pan.y, -maxY, maxY, 0)
    };
  }

  /** The head-size guide box, derived from the preset's published fraction. */
  function headGuide(size, preset) {
    var head = preset.head || [0.62, 0.74];
    var minH = size.height * head[0];
    var maxH = size.height * head[1];
    /* Guidance places the eye line roughly 55–60% up from the bottom. */
    var eyeLine = size.height * 0.42;
    return {
      minHeadHeight: minH,
      maxHeadHeight: maxH,
      eyeLineY: eyeLine,
      /* A face is roughly 0.72 as wide as it is tall; used only for the overlay. */
      minHeadWidth: minH * 0.72,
      maxHeadWidth: maxH * 0.72,
      fraction: head
    };
  }

  /* ======================================================================
     4. Source quality validation
     ====================================================================== */

  /**
   * Compare what the source can supply with what the target needs.
   * Upscaling past the source resolution produces a soft photo, which is
   * a real rejection reason, so it is reported rather than hidden.
   */
  function validateSource(imgW, imgH, size, zoom) {
    var notes = [];
    if (!imgW || !imgH) return { notes: notes, effectiveDpi: 0, upscaled: false };

    var z = zoom || minZoomToCover(imgW, imgH, size.width, size.height);
    var sourcePixelsAcross = size.width / z;
    var effectiveDpi = Math.round((size.width / z) / (size.mm[0] / MM_PER_INCH));
    var upscaled = z > 1;

    if (upscaled) {
      notes.push({
        level: z > 1.6 ? 'fail' : 'warn',
        text: 'The photo is being enlarged ' + (Math.round(z * 100) / 100) + '× to fill this size. ' +
          'Enlarging cannot add detail, so the result will look soft. Use a higher-resolution original if you can.'
      });
    } else {
      notes.push({ level: 'pass', text: 'The source photo has enough resolution for this size at ' + size.dpi + ' DPI.' });
    }

    if (effectiveDpi < 150 && !upscaled) {
      notes.push({ level: 'warn', text: 'Effective print resolution is about ' + effectiveDpi + ' DPI. Most authorities expect 300 DPI for printed photos.' });
    }

    if (imgW > imgH * 1.6) {
      notes.push({ level: 'info', text: 'This looks like a landscape photo. A passport crop is portrait, so most of the width will be cut away.' });
    }

    return { notes: notes, effectiveDpi: effectiveDpi, upscaled: upscaled, sourcePixelsAcross: Math.round(sourcePixelsAcross) };
  }

  /* ======================================================================
     5. Print sheet layout
     ====================================================================== */

  var SHEETS = [
    { id: '4x6', label: '4 × 6 inch print', mm: [152.4, 101.6] },
    { id: '5x7', label: '5 × 7 inch print', mm: [177.8, 127] },
    { id: 'a4', label: 'A4 sheet', mm: [210, 297] },
    { id: 'letter', label: 'US Letter', mm: [215.9, 279.4] },
    { id: '3.5x5', label: '3.5 × 5 inch print', mm: [127, 88.9] }
  ];
  var SHEET_IDS = SHEETS.map(function (s) { return s.id; });

  function getSheet(id) {
    for (var i = 0; i < SHEETS.length; i++) if (SHEETS[i].id === id) return SHEETS[i];
    return SHEETS[0];
  }

  /**
   * How many photos fit on a sheet, and where.
   * Tries both photo orientations and keeps whichever fits more, because a
   * 4 × 6 print holds more 35 × 45 mm photos one way than the other.
   */
  function sheetLayout(photoMm, sheetId, options) {
    var o = options || {};
    var gutter = clampNum(o.gutter, 0, 20, 2);
    var margin = clampNum(o.margin, 0, 30, 4);
    var sheet = getSheet(sheetId);

    function fit(sheetW, sheetH, pw, ph) {
      var usableW = sheetW - margin * 2;
      var usableH = sheetH - margin * 2;
      if (usableW <= 0 || usableH <= 0) return { cols: 0, rows: 0, count: 0 };
      var cols = Math.floor((usableW + gutter) / (pw + gutter));
      var rows = Math.floor((usableH + gutter) / (ph + gutter));
      cols = Math.max(0, cols);
      rows = Math.max(0, rows);
      return { cols: cols, rows: rows, count: cols * rows };
    }

    var w = sheet.mm[0], h = sheet.mm[1];
    var candidates = [
      { sheetW: w, sheetH: h, rotated: false, r: fit(w, h, photoMm[0], photoMm[1]) },
      { sheetW: h, sheetH: w, rotated: true, r: fit(h, w, photoMm[0], photoMm[1]) }
    ];
    candidates.sort(function (a, b) { return b.r.count - a.r.count; });
    var best = candidates[0];

    var positions = [];
    var gridW = best.r.cols * photoMm[0] + Math.max(0, best.r.cols - 1) * gutter;
    var gridH = best.r.rows * photoMm[1] + Math.max(0, best.r.rows - 1) * gutter;
    var startX = (best.sheetW - gridW) / 2;
    var startY = (best.sheetH - gridH) / 2;

    for (var row = 0; row < best.r.rows; row++) {
      for (var col = 0; col < best.r.cols; col++) {
        positions.push({
          x: startX + col * (photoMm[0] + gutter),
          y: startY + row * (photoMm[1] + gutter)
        });
      }
    }

    return {
      sheet: sheet,
      sheetWidthMm: best.sheetW,
      sheetHeightMm: best.sheetH,
      rotated: best.rotated,
      cols: best.r.cols,
      rows: best.r.rows,
      count: best.r.count,
      gutter: gutter,
      margin: margin,
      positions: positions
    };
  }

  /* ======================================================================
     6. File size targeting
     ====================================================================== */

  /**
   * Find the highest JPEG quality whose output fits a byte budget.
   *
   * `measure(quality)` returns the encoded size in bytes; it is injected so
   * this search is testable without a canvas. Binary search over quality,
   * because encoded size is monotonic in quality in practice.
   */
  function pickQuality(measure, targetBytes, options) {
    var o = options || {};
    var lo = clampNum(o.min, 0.05, 1, 0.3);
    var hi = clampNum(o.max, 0.05, 1, 0.95);
    var steps = Math.round(clampNum(o.steps, 3, 12, 7));

    var bestQuality = null;
    var bestBytes = null;

    /* If even the lowest quality is too big, say so rather than pretending. */
    var lowBytes = measure(lo);
    if (lowBytes > targetBytes) {
      return { quality: lo, bytes: lowBytes, achieved: false, attempts: 1 };
    }

    var attempts = 1;
    var a = lo, b = hi;
    for (var i = 0; i < steps; i++) {
      var mid = (a + b) / 2;
      var bytes = measure(mid);
      attempts++;
      if (bytes <= targetBytes) {
        bestQuality = mid;
        bestBytes = bytes;
        a = mid;
      } else {
        b = mid;
      }
    }

    if (bestQuality === null) {
      return { quality: lo, bytes: lowBytes, achieved: true, attempts: attempts };
    }
    return { quality: bestQuality, bytes: bestBytes, achieved: true, attempts: attempts };
  }

  function formatBytes(bytes) {
    var n = Math.max(0, Math.round(bytes));
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (Math.round(n / 102.4) / 10) + ' KB';
    return (Math.round(n / (1024 * 104.857)) / 10) + ' MB';
  }

  /* ======================================================================
     7. JPEG DPI header
     ====================================================================== */

  /**
   * Write the print resolution into a JPEG's JFIF header.
   *
   * Without this a 413 × 531 px file still prints at whatever DPI the
   * printer assumes, so the photo comes out the wrong physical size. The
   * JFIF APP0 segment stores density units (1 = DPI) and X/Y density.
   */
  function setJpegDpi(bytes, dpi) {
    var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var d = Math.round(clampNum(dpi, 1, 65535, 300));

    /* SOI must be FFD8, then look for the APP0 JFIF marker at offset 2. */
    if (data.length < 18) return data;
    if (data[0] !== 0xFF || data[1] !== 0xD8) return data;
    if (data[2] !== 0xFF || data[3] !== 0xE0) return data;
    if (!(data[6] === 0x4A && data[7] === 0x46 && data[8] === 0x49 && data[9] === 0x46)) return data;

    var out = new Uint8Array(data);
    out[13] = 1;                 // density units: pixels per inch
    out[14] = (d >> 8) & 0xFF;   // X density high byte
    out[15] = d & 0xFF;          // X density low byte
    out[16] = (d >> 8) & 0xFF;   // Y density high byte
    out[17] = d & 0xFF;          // Y density low byte
    return out;
  }

  /** Read the DPI back out, so the write can be verified. */
  function readJpegDpi(bytes) {
    var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (data.length < 18) return null;
    if (data[0] !== 0xFF || data[1] !== 0xD8) return null;
    if (data[2] !== 0xFF || data[3] !== 0xE0) return null;
    if (!(data[6] === 0x4A && data[7] === 0x46 && data[8] === 0x49 && data[9] === 0x46)) return null;
    return { units: data[13], x: (data[14] << 8) | data[15], y: (data[16] << 8) | data[17] };
  }

  /* ======================================================================
     8. Background presets
     ====================================================================== */

  var BACKGROUNDS = [
    { id: 'white', label: 'White', color: '#ffffff', note: 'Required for most passports and Indian documents.' },
    { id: 'offwhite', label: 'Off white', color: '#f5f5f5' },
    { id: 'lightgrey', label: 'Light grey', color: '#e6e6e6', note: 'Accepted by several European authorities.' },
    { id: 'lightblue', label: 'Light blue', color: '#d7e8f7', note: 'Common for Indian PAN and some state documents.' },
    { id: 'blue', label: 'Blue', color: '#3b82f6' },
    { id: 'red', label: 'Red', color: '#dc2626', note: 'Used by some Chinese document types.' },
    { id: 'cream', label: 'Cream', color: '#faf3e0' }
  ];
  var BACKGROUND_IDS = BACKGROUNDS.map(function (b) { return b.id; });

  /* ======================================================================
     9. State
     ====================================================================== */

  function defaultState() {
    return {
      version: 1,
      preset: 'in-passport',
      custom: { width: 35, height: 45, unit: 'mm', dpi: 300 },
      background: { id: 'white', color: '#ffffff', apply: true },
      adjust: { brightness: 100, contrast: 100, saturation: 100 },
      transform: { zoom: 1, panX: 0, panY: 0, rotate: 0, flip: false },
      guide: { show: true, grid: false },
      output: { format: 'jpeg', quality: 0.92, targetKB: 0 },
      sheet: { id: '4x6', gutter: 2, margin: 4, cutMarks: true }
    };
  }

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};
    function sec(n) { return (s[n] && typeof s[n] === 'object') ? s[n] : {}; }

    var custom = sec('custom');
    var bg = sec('background');
    var adjust = sec('adjust');
    var tf = sec('transform');
    var guide = sec('guide');
    var out = sec('output');
    var sheet = sec('sheet');

    return {
      version: 1,
      preset: oneOf(s.preset, PRESET_IDS, d.preset),
      custom: {
        width: clampNum(custom.width, 1, 20000, d.custom.width),
        height: clampNum(custom.height, 1, 20000, d.custom.height),
        unit: oneOf(custom.unit, ['mm', 'inch', 'px'], d.custom.unit),
        dpi: Math.round(clampNum(custom.dpi, 72, 1200, d.custom.dpi))
      },
      background: {
        id: oneOf(bg.id, BACKGROUND_IDS.concat(['custom']), d.background.id),
        color: safeHex(bg.color, d.background.color),
        apply: bg.apply === undefined ? d.background.apply : !!bg.apply
      },
      adjust: {
        brightness: Math.round(clampNum(adjust.brightness, 50, 150, d.adjust.brightness)),
        contrast: Math.round(clampNum(adjust.contrast, 50, 150, d.adjust.contrast)),
        saturation: Math.round(clampNum(adjust.saturation, 0, 200, d.adjust.saturation))
      },
      transform: {
        zoom: clampNum(tf.zoom, 0.05, 12, d.transform.zoom),
        panX: clampNum(tf.panX, -20000, 20000, d.transform.panX),
        panY: clampNum(tf.panY, -20000, 20000, d.transform.panY),
        rotate: oneOf(Math.round(clampNum(tf.rotate, 0, 270, 0) / 90) * 90, [0, 90, 180, 270], 0),
        flip: tf.flip === undefined ? d.transform.flip : !!tf.flip
      },
      guide: {
        show: guide.show === undefined ? d.guide.show : !!guide.show,
        grid: guide.grid === undefined ? d.guide.grid : !!guide.grid
      },
      output: {
        format: oneOf(out.format, ['jpeg', 'png'], d.output.format),
        quality: clampNum(out.quality, 0.3, 1, d.output.quality),
        targetKB: Math.round(clampNum(out.targetKB, 0, 5000, d.output.targetKB))
      },
      sheet: {
        id: oneOf(sheet.id, SHEET_IDS, d.sheet.id),
        gutter: clampNum(sheet.gutter, 0, 20, d.sheet.gutter),
        margin: clampNum(sheet.margin, 0, 30, d.sheet.margin),
        cutMarks: sheet.cutMarks === undefined ? d.sheet.cutMarks : !!sheet.cutMarks
      }
    };
  }

  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

  /** A CSS filter string for the preview and the export, from one source. */
  function filterString(state) {
    var a = state.adjust;
    var parts = [];
    if (a.brightness !== 100) parts.push('brightness(' + a.brightness + '%)');
    if (a.contrast !== 100) parts.push('contrast(' + a.contrast + '%)');
    if (a.saturation !== 100) parts.push('saturate(' + a.saturation + '%)');
    return parts.length ? parts.join(' ') : 'none';
  }

  function describeSize(size) {
    var mmText = (Math.round(size.mm[0] * 10) / 10) + ' × ' + (Math.round(size.mm[1] * 10) / 10) + ' mm';
    return size.width + ' × ' + size.height + ' px  ·  ' + mmText + '  ·  ' + size.dpi + ' DPI';
  }

  function suggestedFilename(state) {
    var preset = getPreset(state.preset);
    var base = (preset.group + '-' + preset.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'passport-photo-' + base + '.' + (state.output.format === 'png' ? 'png' : 'jpg');
  }

  /* ======================================================================
     10. Export
     ====================================================================== */

  global.PassportPhotoEngine = {
    escapeHtml: escapeHtml,
    safeHex: safeHex,
    clampNum: clampNum,

    MM_PER_INCH: MM_PER_INCH,
    mmToPx: mmToPx,
    inchToPx: inchToPx,
    pxToMm: pxToMm,

    PRESETS: PRESETS,
    PRESET_IDS: PRESET_IDS,
    getPreset: getPreset,
    presetGroups: presetGroups,
    presetSize: presetSize,

    minZoomToCover: minZoomToCover,
    clampPan: clampPan,
    headGuide: headGuide,
    validateSource: validateSource,

    SHEETS: SHEETS,
    SHEET_IDS: SHEET_IDS,
    getSheet: getSheet,
    sheetLayout: sheetLayout,

    pickQuality: pickQuality,
    formatBytes: formatBytes,
    setJpegDpi: setJpegDpi,
    readJpegDpi: readJpegDpi,

    BACKGROUNDS: BACKGROUNDS,
    BACKGROUND_IDS: BACKGROUND_IDS,

    defaultState: defaultState,
    normalize: normalize,
    cloneState: cloneState,
    filterString: filterString,
    describeSize: describeSize,
    suggestedFilename: suggestedFilename
  };

})(typeof window !== 'undefined' ? window : this);
