/* ToolAdda — Image Resizer Pro engine.
   Pure geometry, DPI/preset, and pixel-resampling math — no DOM/Canvas
   dependency — so it can be unit-tested with plain Node.js. The UI layer
   (assets/js/image-resizer-ui.js) calls into this with real ImageData. */
(function (global) {
  'use strict';

  // ---------- geometry: fit modes ----------

  function clampPositive(n) {
    return Math.max(1, Math.round(n));
  }

  /** "Fit" (contain): scale the whole image to fit inside the box, no cropping. */
  function computeContain(srcW, srcH, boxW, boxH) {
    const scale = Math.min(boxW / srcW, boxH / srcH);
    return { width: clampPositive(srcW * scale), height: clampPositive(srcH * scale) };
  }

  /** "Fill" (cover): scale to cover the box entirely, then report the crop
   * rectangle (in source pixels) needed to trim the overflow from the center. */
  function computeCover(srcW, srcH, boxW, boxH) {
    const scale = Math.max(boxW / srcW, boxH / srcH);
    const scaledW = srcW * scale;
    const scaledH = srcH * scale;
    const cropW = boxW / scale;
    const cropH = boxH / scale;
    const cropX = (srcW - cropW) / 2;
    const cropY = (srcH - cropH) / 2;
    return {
      width: clampPositive(boxW),
      height: clampPositive(boxH),
      crop: { x: Math.max(0, cropX), y: Math.max(0, cropY), width: Math.min(srcW, cropW), height: Math.min(srcH, cropH) },
      scaledFullSize: { width: scaledW, height: scaledH },
    };
  }

  /** "Stretch": ignore aspect ratio entirely. */
  function computeStretch(boxW, boxH) {
    return { width: clampPositive(boxW), height: clampPositive(boxH) };
  }

  /** "Crop": place the target box at a given anchor over the (unscaled) source,
   * cropping anything outside it. If the box is bigger than the source on an
   * axis, the crop rectangle is clamped to the source bounds. */
  function computeCrop(srcW, srcH, boxW, boxH, anchor) {
    const a = anchor || 'center';
    const cropW = Math.min(srcW, boxW);
    const cropH = Math.min(srcH, boxH);
    const positions = {
      x: { left: 0, center: (srcW - cropW) / 2, right: srcW - cropW },
      y: { top: 0, center: (srcH - cropH) / 2, bottom: srcH - cropH },
    };
    const [vAnchor, hAnchor] = a === 'center' ? ['center', 'center'] : a.split('-');
    const x = positions.x[hAnchor] ?? positions.x.center;
    const y = positions.y[vAnchor] ?? positions.y.center;
    return { width: clampPositive(cropW), height: clampPositive(cropH), crop: { x, y, width: cropW, height: cropH } };
  }

  function computeByPercent(srcW, srcH, percent) {
    const scale = Math.max(0.01, percent) / 100;
    return { width: clampPositive(srcW * scale), height: clampPositive(srcH * scale) };
  }

  /** Given one dimension changed by the user, derive the other from the locked ratio. */
  function deriveLockedDimension(sourceW, sourceH, changedAxis, newValue) {
    const ratio = sourceW / sourceH;
    if (!Number.isFinite(ratio) || ratio <= 0 || !newValue || newValue <= 0) return null;
    if (changedAxis === 'width') return clampPositive(newValue / ratio);
    return clampPositive(newValue * ratio);
  }

  // ---------- DPI / physical size conversion ----------

  function inchesToPx(inches, dpi) {
    return Math.round(inches * dpi);
  }
  function mmToPx(mm, dpi) {
    return Math.round((mm / 25.4) * dpi);
  }
  function pxToInches(px, dpi) {
    return px / dpi;
  }

  // ---------- verified preset tables ----------
  // Print/passport pixel sizes are computed from physical units at 300 DPI
  // (the standard print resolution), not memorized — see inchesToPx/mmToPx above.

  const SOCIAL_PRESETS = [
    { id: 'ig-post', label: 'Instagram Post (Square)', width: 1080, height: 1080, category: 'Instagram' },
    { id: 'ig-portrait', label: 'Instagram Portrait Post', width: 1080, height: 1350, category: 'Instagram' },
    { id: 'ig-story', label: 'Instagram Story / Reel', width: 1080, height: 1920, category: 'Instagram' },
    { id: 'fb-post', label: 'Facebook Post', width: 1200, height: 630, category: 'Facebook' },
    { id: 'fb-cover', label: 'Facebook Cover Photo', width: 820, height: 312, category: 'Facebook' },
    { id: 'li-post', label: 'LinkedIn Post', width: 1200, height: 627, category: 'LinkedIn' },
    { id: 'li-cover', label: 'LinkedIn Cover Photo', width: 1584, height: 396, category: 'LinkedIn' },
    { id: 'x-post', label: 'X (Twitter) Post', width: 1600, height: 900, category: 'X / Twitter' },
    { id: 'x-header', label: 'X (Twitter) Header', width: 1500, height: 500, category: 'X / Twitter' },
    { id: 'yt-thumb', label: 'YouTube Thumbnail', width: 1280, height: 720, category: 'YouTube' },
    { id: 'yt-banner', label: 'YouTube Channel Art', width: 2560, height: 1440, category: 'YouTube' },
    { id: 'pin-pin', label: 'Pinterest Pin', width: 1000, height: 1500, category: 'Pinterest' },
    { id: 'wa-dp', label: 'WhatsApp Profile Photo', width: 500, height: 500, category: 'WhatsApp' },
    { id: 'tiktok-cover', label: 'TikTok Video Cover', width: 1080, height: 1920, category: 'TikTok' },
  ];

  const PRINT_PRESETS = [
    { id: 'a3-300', label: 'A3 (300 DPI)', width: mmToPx(297, 300), height: mmToPx(420, 300), category: 'Print' },
    { id: 'a4-300', label: 'A4 (300 DPI)', width: mmToPx(210, 300), height: mmToPx(297, 300), category: 'Print' },
    { id: 'a5-300', label: 'A5 (300 DPI)', width: mmToPx(148, 300), height: mmToPx(210, 300), category: 'Print' },
    { id: 'letter-300', label: 'US Letter (300 DPI)', width: inchesToPx(8.5, 300), height: inchesToPx(11, 300), category: 'Print' },
    { id: 'bcard-us-300', label: 'Business Card US (300 DPI)', width: inchesToPx(3.5, 300), height: inchesToPx(2, 300), category: 'Print' },
    { id: 'bcard-iso-300', label: 'Business Card ISO (300 DPI)', width: mmToPx(85, 300), height: mmToPx(55, 300), category: 'Print' },
  ];

  const ID_PHOTO_PRESETS = [
    { id: 'passport-us', label: 'US Passport Photo (2×2in, 300 DPI)', width: inchesToPx(2, 300), height: inchesToPx(2, 300), category: 'ID Photo' },
    { id: 'visa-3545', label: 'Visa / Schengen Photo (35×45mm, 300 DPI)', width: mmToPx(35, 300), height: mmToPx(45, 300), category: 'ID Photo' },
  ];

  const ALL_PRESETS = [].concat(SOCIAL_PRESETS, PRINT_PRESETS, ID_PHOTO_PRESETS);

  // ---------- pixel resampling algorithms ----------
  // Each takes { data: Uint8ClampedArray(RGBA), width, height } and target
  // dimensions, returning a new same-shaped object. Pure, so they can run on
  // synthetic test data without a real browser Canvas.

  function makeBuffer(width, height) {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }

  function getPixel(src, x, y) {
    x = Math.min(src.width - 1, Math.max(0, x));
    y = Math.min(src.height - 1, Math.max(0, y));
    const i = (y * src.width + x) * 4;
    return [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]];
  }

  function resizeNearestNeighbor(src, destW, destH) {
    const out = makeBuffer(destW, destH);
    const xRatio = src.width / destW;
    const yRatio = src.height / destH;
    for (let y = 0; y < destH; y += 1) {
      const sy = Math.min(src.height - 1, Math.floor(y * yRatio));
      for (let x = 0; x < destW; x += 1) {
        const sx = Math.min(src.width - 1, Math.floor(x * xRatio));
        const [r, g, b, a] = getPixel(src, sx, sy);
        const di = (y * destW + x) * 4;
        out.data[di] = r; out.data[di + 1] = g; out.data[di + 2] = b; out.data[di + 3] = a;
      }
    }
    return out;
  }

  function resizeBilinear(src, destW, destH) {
    const out = makeBuffer(destW, destH);
    const xRatio = (src.width - 1) / Math.max(1, destW - 1 || 1);
    const yRatio = (src.height - 1) / Math.max(1, destH - 1 || 1);
    for (let y = 0; y < destH; y += 1) {
      const sy = destH === 1 ? 0 : y * yRatio;
      const y0 = Math.floor(sy);
      const y1 = Math.min(src.height - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < destW; x += 1) {
        const sx = destW === 1 ? 0 : x * xRatio;
        const x0 = Math.floor(sx);
        const x1 = Math.min(src.width - 1, x0 + 1);
        const fx = sx - x0;

        const p00 = getPixel(src, x0, y0);
        const p10 = getPixel(src, x1, y0);
        const p01 = getPixel(src, x0, y1);
        const p11 = getPixel(src, x1, y1);

        const di = (y * destW + x) * 4;
        for (let c = 0; c < 4; c += 1) {
          const top = p00[c] * (1 - fx) + p10[c] * fx;
          const bottom = p01[c] * (1 - fx) + p11[c] * fx;
          out.data[di + c] = top * (1 - fy) + bottom * fy;
        }
      }
    }
    return out;
  }

  // Cubic convolution kernel (Keys, 1981) with a = -0.5 — the widely used
  // "Catmull-Rom-like" default that most bicubic image resizers ship with.
  function cubicWeight(t) {
    const a = -0.5;
    const x = Math.abs(t);
    if (x <= 1) return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1;
    if (x < 2) return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a;
    return 0;
  }

  function resizeBicubic(src, destW, destH) {
    const out = makeBuffer(destW, destH);
    const xRatio = src.width / destW;
    const yRatio = src.height / destH;
    for (let y = 0; y < destH; y += 1) {
      const sy = (y + 0.5) * yRatio - 0.5;
      const y0 = Math.floor(sy);
      for (let x = 0; x < destW; x += 1) {
        const sx = (x + 0.5) * xRatio - 0.5;
        const x0 = Math.floor(sx);

        const acc = [0, 0, 0, 0];
        let weightSum = 0;
        for (let ky = -1; ky <= 2; ky += 1) {
          const wy = cubicWeight(sy - (y0 + ky));
          for (let kx = -1; kx <= 2; kx += 1) {
            const wx = cubicWeight(sx - (x0 + kx));
            const w = wx * wy;
            const p = getPixel(src, x0 + kx, y0 + ky);
            acc[0] += p[0] * w; acc[1] += p[1] * w; acc[2] += p[2] * w; acc[3] += p[3] * w;
            weightSum += w;
          }
        }
        const di = (y * destW + x) * 4;
        for (let c = 0; c < 4; c += 1) {
          out.data[di + c] = weightSum !== 0 ? acc[c] / weightSum : acc[c];
        }
      }
    }
    return out;
  }

  // Lanczos-3 windowed sinc — the highest-quality of the four, best for
  // significant downscaling where bilinear/bicubic can look soft or aliased.
  function sinc(x) {
    if (x === 0) return 1;
    const px = Math.PI * x;
    return Math.sin(px) / px;
  }
  function lanczosWeight(x, a) {
    if (x === 0) return 1;
    if (x <= -a || x >= a) return 0;
    return sinc(x) * sinc(x / a);
  }

  function resizeLanczos(src, destW, destH, radius) {
    const a = radius || 3;
    const out = makeBuffer(destW, destH);
    const xRatio = src.width / destW;
    const yRatio = src.height / destH;
    for (let y = 0; y < destH; y += 1) {
      const sy = (y + 0.5) * yRatio - 0.5;
      const y0 = Math.floor(sy);
      for (let x = 0; x < destW; x += 1) {
        const sx = (x + 0.5) * xRatio - 0.5;
        const x0 = Math.floor(sx);

        const acc = [0, 0, 0, 0];
        let weightSum = 0;
        for (let ky = -a + 1; ky <= a; ky += 1) {
          const wy = lanczosWeight(sy - (y0 + ky), a);
          if (wy === 0) continue;
          for (let kx = -a + 1; kx <= a; kx += 1) {
            const wx = lanczosWeight(sx - (x0 + kx), a);
            if (wx === 0) continue;
            const w = wx * wy;
            const p = getPixel(src, x0 + kx, y0 + ky);
            acc[0] += p[0] * w; acc[1] += p[1] * w; acc[2] += p[2] * w; acc[3] += p[3] * w;
            weightSum += w;
          }
        }
        const di = (y * destW + x) * 4;
        for (let c = 0; c < 4; c += 1) {
          out.data[di + c] = weightSum !== 0 ? acc[c] / weightSum : acc[c];
        }
      }
    }
    return out;
  }

  const RESAMPLERS = {
    nearest: resizeNearestNeighbor,
    bilinear: resizeBilinear,
    bicubic: resizeBicubic,
    lanczos: resizeLanczos,
  };

  function resample(algorithm, src, destW, destH) {
    const fn = RESAMPLERS[algorithm] || RESAMPLERS.bicubic;
    return fn(src, destW, destH);
  }

  // ---------- DPI metadata embedding (pure byte manipulation) ----------
  // Canvas exports pixel data only, with no DPI metadata. These functions
  // patch a real PNG pHYs chunk or JPEG JFIF density field into the encoded
  // bytes afterwards, so the file reports the DPI desktop tools expect —
  // pure binary work, so it's testable without a browser Canvas.

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint32BE(target, offset, value) {
    target[offset] = (value >>> 24) & 0xff;
    target[offset + 1] = (value >>> 16) & 0xff;
    target[offset + 2] = (value >>> 8) & 0xff;
    target[offset + 3] = value & 0xff;
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function isPng(bytes) {
    return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
  }

  /** Inserts (or replaces) a pHYs chunk right after IHDR, expressing DPI as pixels-per-meter. */
  function setPngDpi(bytes, dpi) {
    if (!isPng(bytes)) return bytes;
    const pixelsPerMeter = Math.round(dpi / 0.0254); // 1 inch = 0.0254 m
    const ihdrLength = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
    const ihdrEnd = 8 + 4 + 4 + ihdrLength + 4; // signature + length + "IHDR" + data + CRC

    // Chunk body: 4 bytes X ppu, 4 bytes Y ppu, 1 byte unit specifier (1 = meters)
    const body = new Uint8Array(9);
    writeUint32BE(body, 0, pixelsPerMeter);
    writeUint32BE(body, 4, pixelsPerMeter);
    body[8] = 1;

    const type = [0x70, 0x48, 0x59, 0x73]; // "pHYs"
    const crcInput = new Uint8Array(4 + 9);
    crcInput.set(type, 0);
    crcInput.set(body, 4);
    const crc = crc32(crcInput);

    const chunk = new Uint8Array(4 + 4 + 9 + 4);
    writeUint32BE(chunk, 0, 9);
    chunk.set(type, 4);
    chunk.set(body, 8);
    writeUint32BE(chunk, 17, crc);

    // Strip any pre-existing pHYs chunk so we don't leave a stale/duplicate one behind.
    const withoutOldPhys = stripPngChunk(bytes, 'pHYs');
    const insertAt = 8 + 4 + 4 + ihdrLength + 4 <= withoutOldPhys.length ? ihdrEnd : withoutOldPhys.length;
    const out = new Uint8Array(withoutOldPhys.length + chunk.length);
    out.set(withoutOldPhys.subarray(0, insertAt), 0);
    out.set(chunk, insertAt);
    out.set(withoutOldPhys.subarray(insertAt), insertAt + chunk.length);
    return out;
  }

  function stripPngChunk(bytes, typeName) {
    let offset = 8;
    const parts = [bytes.subarray(0, 8)];
    while (offset + 8 <= bytes.length) {
      const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      const chunkEnd = offset + 8 + length + 4;
      if (type !== typeName) parts.push(bytes.subarray(offset, chunkEnd));
      offset = chunkEnd;
    }
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    parts.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  function isJpeg(bytes) {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  }

  /** Patches the JFIF APP0 segment's density fields, if present, to the given DPI. */
  function setJpegDpi(bytes, dpi) {
    if (!isJpeg(bytes)) return bytes;
    // APP0 must immediately follow SOI (0xFFD8) for a standard JFIF header.
    if (!(bytes[2] === 0xff && bytes[3] === 0xe0)) return bytes;
    const segmentLength = (bytes[4] << 8) | bytes[5];
    // Identifier "JFIF\0" starts at byte 6.
    const isJfif = bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00;
    if (!isJfif || segmentLength < 14) return bytes;

    const out = new Uint8Array(bytes);
    // Layout after the 5-byte "JFIF\0" identifier at 6-10: version (2 bytes) at
    // 11-12, THEN units (1 byte) at 13, Xdensity at 14-15, Ydensity at 16-17.
    const densityOffset = 13;
    out[densityOffset] = 1; // 1 = dots per inch
    out[densityOffset + 1] = (dpi >> 8) & 0xff;
    out[densityOffset + 2] = dpi & 0xff;
    out[densityOffset + 3] = (dpi >> 8) & 0xff;
    out[densityOffset + 4] = dpi & 0xff;
    return out;
  }

  function setImageDpi(bytes, mimeType, dpi) {
    if (mimeType === 'image/png') return setPngDpi(bytes, dpi);
    if (mimeType === 'image/jpeg') return setJpegDpi(bytes, dpi);
    return bytes; // DPI metadata isn't meaningfully supported for other formats here
  }

  /** Reads an existing pHYs chunk, if present, and converts pixels-per-meter back to DPI. */
  function getPngDpi(bytes) {
    if (!isPng(bytes)) return null;
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (type === 'pHYs') {
        const d = offset + 8;
        const xPpu = (bytes[d] << 24) | (bytes[d + 1] << 16) | (bytes[d + 2] << 8) | bytes[d + 3];
        const unit = bytes[d + 8];
        if (unit !== 1) return null; // unit 0 = unknown/aspect-ratio-only, no real DPI
        return Math.round(xPpu * 0.0254);
      }
      if (type === 'IDAT') return null; // pHYs, if present, always comes before IDAT
      offset = offset + 8 + length + 4;
    }
    return null;
  }

  /** Reads the JFIF APP0 density fields, if present, and returns DPI (converting dots-per-cm if needed). */
  function getJpegDpi(bytes) {
    if (!isJpeg(bytes)) return null;
    if (!(bytes[2] === 0xff && bytes[3] === 0xe0)) return null;
    const segmentLength = (bytes[4] << 8) | bytes[5];
    const isJfif = bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00;
    if (!isJfif || segmentLength < 14) return null;
    const units = bytes[13];
    const xDensity = (bytes[14] << 8) | bytes[15];
    if (units === 1) return xDensity; // dots per inch
    if (units === 2) return Math.round(xDensity * 2.54); // dots per cm -> dpi
    return null; // units 0 = aspect ratio only, no real DPI
  }

  function getImageDpi(bytes, mimeType) {
    if (mimeType === 'image/png') return getPngDpi(bytes);
    if (mimeType === 'image/jpeg') return getJpegDpi(bytes);
    return null;
  }

  // ---------- misc helpers ----------

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function sanitizeFileBaseName(name) {
    return String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  }

  function extensionForMime(mime) {
    const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/gif': 'gif' };
    return map[mime] || 'jpg';
  }

  global.ImageResizerEngine = {
    clampPositive,
    computeContain,
    computeCover,
    computeStretch,
    computeCrop,
    computeByPercent,
    deriveLockedDimension,
    inchesToPx,
    mmToPx,
    pxToInches,
    SOCIAL_PRESETS,
    PRINT_PRESETS,
    ID_PHOTO_PRESETS,
    ALL_PRESETS,
    resample,
    resizeNearestNeighbor,
    resizeBilinear,
    resizeBicubic,
    resizeLanczos,
    cubicWeight,
    lanczosWeight,
    formatBytes,
    sanitizeFileBaseName,
    extensionForMime,
    crc32,
    isPng,
    isJpeg,
    setPngDpi,
    setJpegDpi,
    setImageDpi,
    getPngDpi,
    getJpegDpi,
    getImageDpi,
  };
})(typeof self !== 'undefined' ? self : this);
