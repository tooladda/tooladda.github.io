/* ToolAdda — Image Watermark engine.

   Pure placement, sizing and naming math. No DOM, no Canvas, no File API, so
   every rule below is unit-testable under plain Node. The UI layer
   (assets/js/image-watermark.js) measures text with a canvas context and hands
   the measured width in; the engine never measures anything itself.

   Two ideas drive most of this file:

   1. Everything is proportional. A watermark specified in absolute pixels is
      illegible on a 6000px camera export and covers half of a 400px thumbnail.
      Size, margin and tile spacing are all percentages of the image, so one
      setting looks the same across a batch of mixed resolutions.

   2. Rotation changes the space a mark occupies. A 300x80 mark at 45 degrees
      needs a 269x269 box, so tiling has to space by the ROTATED bounds or the
      marks overlap — which is the bug most tiled-watermark tools ship with. */
(function (global) {
  'use strict';

  var POSITIONS = [
    'top-left', 'top-center', 'top-right',
    'middle-left', 'center', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right'
  ];

  var LAYOUTS = ['single', 'tiled', 'diagonal'];

  var FORMATS = {
    png: { mime: 'image/png', ext: 'png', lossy: false },
    jpeg: { mime: 'image/jpeg', ext: 'jpg', lossy: true },
    webp: { mime: 'image/webp', ext: 'webp', lossy: true }
  };

  /* A browser canvas stops producing output somewhere above this area
     (Safari is the strictest). Images larger than the cap are worked on at a
     reduced scale and the result is written back at the original size. */
  var MAX_CANVAS_AREA = 16777216; // 4096 * 4096

  function clamp(value, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  // ---------------------------------------------------------------- sizing

  /** Watermark width in px, given as a percentage of the image's SHORTER side.
   *
   *  Shorter side, not width: a panorama and a portrait shot with the same
   *  width setting would otherwise get wildly different-looking marks, because
   *  the panorama's width dwarfs its height. */
  function resolveMarkWidth(imageW, imageH, scalePercent) {
    var basis = Math.min(imageW, imageH);
    var pct = clamp(scalePercent, 1, 100);
    return Math.max(1, Math.round((basis * pct) / 100));
  }

  /** Scale factor to apply to a mark of natural size markW to hit the target. */
  function scaleFactorFor(markNaturalW, targetW) {
    if (!markNaturalW) return 1;
    return targetW / markNaturalW;
  }

  /** Margin in px from the image edge, as a percentage of the shorter side. */
  function resolveMargin(imageW, imageH, marginPercent) {
    var basis = Math.min(imageW, imageH);
    return Math.round((basis * clamp(marginPercent, 0, 40)) / 100);
  }

  /** Font size for a text watermark, as a percentage of the shorter side. */
  function resolveFontSize(imageW, imageH, scalePercent) {
    var basis = Math.min(imageW, imageH);
    return Math.max(8, Math.round((basis * clamp(scalePercent, 1, 40)) / 100));
  }

  // -------------------------------------------------------------- geometry

  /** Axis-aligned bounding box of a w x h rectangle rotated by `angle` degrees.
   *  Tile spacing and edge margins both need this; without it a rotated mark
   *  runs off the canvas or collides with its neighbour. */
  function rotatedBounds(width, height, angle) {
    var rad = Math.abs(toRadians(angle || 0));
    var cos = Math.abs(Math.cos(rad));
    var sin = Math.abs(Math.sin(rad));
    return {
      width: width * cos + height * sin,
      height: width * sin + height * cos
    };
  }

  /** Centre point for one of the nine anchors.
   *
   *  Coordinates are the CENTRE of the mark, not its top-left, because the
   *  canvas draw path rotates about the centre — returning a corner would make
   *  every caller redo the same translation. */
  function anchorPoint(position, imageW, imageH, markW, markH, margin) {
    var bounds = { width: markW, height: markH };
    var halfW = bounds.width / 2;
    var halfH = bounds.height / 2;

    var left = margin + halfW;
    var right = imageW - margin - halfW;
    var top = margin + halfH;
    var bottom = imageH - margin - halfH;
    var midX = imageW / 2;
    var midY = imageH / 2;

    var map = {
      'top-left': [left, top],
      'top-center': [midX, top],
      'top-right': [right, top],
      'middle-left': [left, midY],
      'center': [midX, midY],
      'middle-right': [right, midY],
      'bottom-left': [left, bottom],
      'bottom-center': [midX, bottom],
      'bottom-right': [right, bottom]
    };

    var point = map[position] || map.center;
    return { x: point[0], y: point[1] };
  }

  /** Tile the mark across the whole image on a staggered grid.
   *
   *  Spacing is measured on the ROTATED bounds and every other row is offset by
   *  half a step, which is what stops a tiled diagonal watermark from reading as
   *  obvious parallel stripes with gaps between them. The grid deliberately
   *  starts one step outside the canvas so the pattern runs off all four edges
   *  instead of floating in the middle with a bare border. */
  function tilePlacements(imageW, imageH, markW, markH, angle, gapPercent) {
    var bounds = rotatedBounds(markW, markH, angle);
    var gap = clamp(gapPercent, 0, 200) / 100;
    var stepX = Math.max(1, bounds.width * (1 + gap));
    var stepY = Math.max(1, bounds.height * (1 + gap));

    var placements = [];
    var row = 0;
    for (var y = -stepY / 2; y < imageH + stepY; y += stepY) {
      var offset = row % 2 === 0 ? 0 : stepX / 2;
      for (var x = -stepX / 2 + offset; x < imageW + stepX; x += stepX) {
        placements.push({ x: x, y: y });
      }
      row += 1;
    }
    return placements;
  }

  /** A single line of marks running corner to corner across the image. */
  function diagonalPlacements(imageW, imageH, markW, markH, angle, gapPercent) {
    var bounds = rotatedBounds(markW, markH, angle);
    var gap = clamp(gapPercent, 0, 200) / 100;
    var step = Math.max(1, bounds.width * (1 + gap));
    var diagonal = Math.sqrt(imageW * imageW + imageH * imageH);
    var count = Math.max(1, Math.ceil(diagonal / step));

    var slope = Math.atan2(imageH, imageW);
    var placements = [];
    var start = -(count - 1) / 2;
    for (var i = 0; i < count; i += 1) {
      var distance = (start + i) * step;
      placements.push({
        x: imageW / 2 + Math.cos(slope) * distance,
        y: imageH / 2 + Math.sin(slope) * distance
      });
    }
    return placements;
  }

  /** Every draw position for the current settings.
   *
   *  options: { imageW, imageH, markW, markH, layout, position, angle,
   *             marginPercent, gapPercent } */
  function buildPlacements(options) {
    var opts = options || {};
    var imageW = opts.imageW || 0;
    var imageH = opts.imageH || 0;
    var markW = opts.markW || 0;
    var markH = opts.markH || 0;
    var angle = opts.angle || 0;
    var layout = LAYOUTS.indexOf(opts.layout) === -1 ? 'single' : opts.layout;

    if (!imageW || !imageH || !markW || !markH) return [];

    if (layout === 'tiled') {
      return tilePlacements(imageW, imageH, markW, markH, angle, opts.gapPercent);
    }
    if (layout === 'diagonal') {
      return diagonalPlacements(imageW, imageH, markW, markH, angle, opts.gapPercent);
    }

    /* Single: the anchor has to inset by the rotated bounds, not the raw mark
       size, or a rotated corner mark hangs off the edge of the image. */
    var bounds = rotatedBounds(markW, markH, angle);
    var margin = resolveMargin(imageW, imageH, opts.marginPercent);
    return [anchorPoint(opts.position, imageW, imageH, bounds.width, bounds.height, margin)];
  }

  // ------------------------------------------------------------ appearance

  function opacityFromUi(value) {
    return clamp(value, 0, 100) / 100;
  }

  /** Hex + opacity -> rgba(), so one colour input can drive fill and shadow. */
  function rgbaFromHex(hex, alpha) {
    var clean = String(hex || '#ffffff').replace('#', '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) clean = 'ffffff';
    var r = parseInt(clean.slice(0, 2), 16);
    var g = parseInt(clean.slice(2, 4), 16);
    var b = parseInt(clean.slice(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clamp(alpha, 0, 1) + ')';
  }

  /** Relative luminance, used to pick a readable outline colour automatically.
   *  A white watermark on a white sky is invisible; the contrasting outline is
   *  what keeps a mark legible without the user tuning colours per photo. */
  function relativeLuminance(hex) {
    var clean = String(hex || '#ffffff').replace('#', '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) clean = 'ffffff';
    var channels = [0, 2, 4].map(function (i) {
      var c = parseInt(clean.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function autoOutlineColor(fillHex) {
    return relativeLuminance(fillHex) > 0.5 ? '#000000' : '#ffffff';
  }

  // ----------------------------------------------------------------- files

  function extensionForMime(mime) {
    var keys = Object.keys(FORMATS);
    for (var i = 0; i < keys.length; i += 1) {
      if (FORMATS[keys[i]].mime === mime) return FORMATS[keys[i]].ext;
    }
    return 'png';
  }

  function mimeForFormat(format) {
    var entry = FORMATS[String(format || '').toLowerCase()];
    return entry ? entry.mime : FORMATS.png.mime;
  }

  function isLossy(format) {
    var entry = FORMATS[String(format || '').toLowerCase()];
    return entry ? entry.lossy : false;
  }

  function sanitizeBaseName(name) {
    var base = String(name || 'image').replace(/\.[^.]+$/, '');
    base = base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    /* Collapse runs and drop separators at the ends. Without this,
       "in/valid:name?.png" leaves a trailing dash and the suffix lands as
       "in-valid-name--watermarked.png". */
    base = base.replace(/-{2,}/g, '-').replace(/^[-\s]+|[-\s]+$/g, '');
    return base || 'image';
  }

  function outputName(originalName, format, suffix) {
    var ext = FORMATS[String(format || '').toLowerCase()];
    var tail = suffix === undefined ? '-watermarked' : suffix;
    return sanitizeBaseName(originalName) + tail + '.' + (ext ? ext.ext : 'png');
  }

  /** Two files called photo.jpg from different folders must not overwrite each
   *  other inside the ZIP, so later duplicates get a counter. */
  function uniqueNames(names) {
    var seen = {};
    return (names || []).map(function (name) {
      var key = String(name).toLowerCase();
      if (!seen[key]) {
        seen[key] = 1;
        return name;
      }
      var count = seen[key];
      seen[key] += 1;
      var dot = name.lastIndexOf('.');
      if (dot <= 0) return name + ' (' + count + ')';
      return name.slice(0, dot) + ' (' + count + ')' + name.slice(dot);
    });
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /** Keep a canvas inside the browser's area limit, preserving aspect ratio. */
  function clampCanvasSize(width, height, maxArea) {
    var limit = maxArea || MAX_CANVAS_AREA;
    var area = width * height;
    if (area <= limit) return { width: width, height: height, scale: 1 };
    var scale = Math.sqrt(limit / area);
    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      scale: scale
    };
  }

  // --------------------------------------------------------------- exports

  var api = {
    POSITIONS: POSITIONS,
    LAYOUTS: LAYOUTS,
    FORMATS: FORMATS,
    MAX_CANVAS_AREA: MAX_CANVAS_AREA,
    clamp: clamp,
    toRadians: toRadians,
    resolveMarkWidth: resolveMarkWidth,
    scaleFactorFor: scaleFactorFor,
    resolveMargin: resolveMargin,
    resolveFontSize: resolveFontSize,
    rotatedBounds: rotatedBounds,
    anchorPoint: anchorPoint,
    tilePlacements: tilePlacements,
    diagonalPlacements: diagonalPlacements,
    buildPlacements: buildPlacements,
    opacityFromUi: opacityFromUi,
    rgbaFromHex: rgbaFromHex,
    relativeLuminance: relativeLuminance,
    autoOutlineColor: autoOutlineColor,
    extensionForMime: extensionForMime,
    mimeForFormat: mimeForFormat,
    isLossy: isLossy,
    sanitizeBaseName: sanitizeBaseName,
    outputName: outputName,
    uniqueNames: uniqueNames,
    formatBytes: formatBytes,
    clampCanvasSize: clampCanvasSize
  };

  global.ImageWatermarkEngine = api;

  /* ------------------------------------------------------------------ *
   * Node/test export — everything above this line is pure and DOM-free.
   * ------------------------------------------------------------------ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : this);
