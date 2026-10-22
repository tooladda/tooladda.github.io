/**
 * EXIF / embedded metadata engine — browser-side scan, clean, verify.
 * Prefix: ExifEngine (global)
 */
(function (global) {
  'use strict';

  var MAX_FILE_BYTES = 50 * 1024 * 1024;
  var MAX_PIXELS = 50331648; // ~50 MP
  var MAX_DIMENSION = 16384;

  var SUPPORTED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
  var SUPPORTED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

  var SENSITIVE_KEYS = ['gps', 'serial', 'device', 'author', 'datetime', 'maker'];

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function bytesToAscii(view, offset, len) {
    var s = '';
    for (var i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  }

  function escapeValue(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(escapeValue).join(', ');
    return String(v);
  }

  function fieldEntry(category, name, value, opts) {
    var o = opts || {};
    return {
      category: category,
      name: name,
      value: escapeValue(value),
      raw: value,
      sensitive: !!o.sensitive,
      key: (category + ':' + name).toLowerCase()
    };
  }

  function emptyScan() {
    return {
      fields: [],
      categories: {},
      summary: {
        total: 0,
        gps: false,
        camera: false,
        datetime: false,
        author: false,
        software: false,
        image: false,
        other: false,
        makerNote: false,
        xmp: false,
        iptc: false,
        icc: false
      },
      hasMetadata: false
    };
  }

  function pushField(scan, entry) {
    scan.fields.push(entry);
    scan.categories[entry.category] = scan.categories[entry.category] || [];
    scan.categories[entry.category].push(entry);
    scan.summary.total++;
    if (entry.category === 'gps') scan.summary.gps = true;
    if (entry.category === 'camera') scan.summary.camera = true;
    if (entry.category === 'datetime') scan.summary.datetime = true;
    if (entry.category === 'author') scan.summary.author = true;
    if (entry.category === 'software') scan.summary.software = true;
    if (entry.category === 'image') scan.summary.image = true;
    if (entry.category === 'other') scan.summary.other = true;
    if (/maker/i.test(entry.name)) scan.summary.makerNote = true;
    if (/xmp/i.test(entry.name)) scan.summary.xmp = true;
    if (/iptc/i.test(entry.name)) scan.summary.iptc = true;
    if (/icc/i.test(entry.name)) scan.summary.icc = true;
    scan.hasMetadata = true;
  }

  /* ---------- TIFF / EXIF IFD reader (JPEG APP1, PNG eXIf) ---------- */

  function readRational(view, offset, little) {
    var num = view.getUint32(offset, little);
    var den = view.getUint32(offset + 4, little);
    if (!den) return num;
    return num / den;
  }

  function readSRational(view, offset, little) {
    var num = view.getInt32(offset, little);
    var den = view.getInt32(offset + 4, little);
    if (!den) return num;
    return num / den;
  }

  function formatExifDate(raw) {
    if (!raw) return raw;
    var s = String(raw).trim();
    if (/^\d{4}:\d{2}:\d{2}/.test(s)) return s.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
    return s;
  }

  function dmsToDecimal(dms, ref) {
    if (!dms || dms.length < 3) return null;
    var d = typeof dms[0] === 'number' ? dms[0] : readRationalFromPair(dms[0]);
    var m = typeof dms[1] === 'number' ? dms[1] : readRationalFromPair(dms[1]);
    var s = typeof dms[2] === 'number' ? dms[2] : readRationalFromPair(dms[2]);
    var dec = d + m / 60 + s / 3600;
    if (ref === 'S' || ref === 'W') dec = -dec;
    return Math.round(dec * 1e6) / 1e6;
  }

  function readRationalFromPair(v) {
    if (v && typeof v === 'object' && 'num' in v) return v.num / (v.den || 1);
    return Number(v) || 0;
  }

  var TAG_INFO = {
    0x010e: { name: 'ImageDescription', cat: 'image' },
    0x010f: { name: 'Make', cat: 'camera' },
    0x0110: { name: 'Model', cat: 'camera' },
    0x0112: { name: 'Orientation', cat: 'image' },
    0x011a: { name: 'XResolution', cat: 'image' },
    0x011b: { name: 'YResolution', cat: 'image' },
    0x0131: { name: 'Software', cat: 'software' },
    0x0132: { name: 'DateTime', cat: 'datetime', sensitive: true },
    0x013b: { name: 'Artist', cat: 'author', sensitive: true },
    0x013c: { name: 'HostComputer', cat: 'software' },
    0x8298: { name: 'Copyright', cat: 'author', sensitive: true },
    0x8769: { name: 'ExifIFD', cat: 'other', pointer: true },
    0x8825: { name: 'GPSIFD', cat: 'other', pointer: true },
    0x0100: { name: 'ImageWidth', cat: 'image' },
    0x0101: { name: 'ImageLength', cat: 'image' },
    0x9003: { name: 'DateTimeOriginal', cat: 'datetime', sensitive: true },
    0x9004: { name: 'DateTimeDigitized', cat: 'datetime', sensitive: true },
    0x920a: { name: 'FocalLength', cat: 'camera' },
    0x829a: { name: 'FocalLengthIn35mmFilm', cat: 'camera' },
    0x8827: { name: 'ISO', cat: 'camera' },
    0x829d: { name: 'FNumber', cat: 'camera' },
    0x829a: { name: 'FocalLengthIn35mmFilm', cat: 'camera' },
    0x9209: { name: 'Flash', cat: 'camera' },
    0xa403: { name: 'WhiteBalance', cat: 'camera' },
    0x8822: { name: 'ExposureProgram', cat: 'camera' },
    0x9201: { name: 'ShutterSpeedValue', cat: 'camera' },
    0x829a: { name: 'FocalLengthIn35mmFilm', cat: 'camera' },
    0x9202: { name: 'ApertureValue', cat: 'camera' },
    0x9204: { name: 'ExposureBiasValue', cat: 'camera' },
    0x9207: { name: 'MeteringMode', cat: 'camera' },
    0xa405: { name: 'FocalLengthIn35mmFilm', cat: 'camera' },
    0xa434: { name: 'LensModel', cat: 'camera' },
    0xa433: { name: 'LensMake', cat: 'camera' },
    0x9286: { name: 'UserComment', cat: 'author', sensitive: true },
    0xa431: { name: 'BodySerialNumber', cat: 'camera', sensitive: true },
    0xa420: { name: 'LensSerialNumber', cat: 'camera', sensitive: true },
    0x927c: { name: 'MakerNote', cat: 'other' },
    0x014a: { name: 'SubIFDs', cat: 'other', pointer: true }
  };

  var GPS_TAGS = {
    0x0000: 'GPSVersionID',
    0x0001: 'GPSLatitudeRef',
    0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef',
    0x0004: 'GPSLongitude',
    0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude',
    0x0007: 'GPSTimeStamp',
    0x0009: 'GPSProcessingMethod',
    0x0010: 'GPSImgDirection',
    0x0011: 'GPSImgDirectionRef',
    0x001d: 'GPSDateStamp'
  };

  function readTagValue(view, tiffOffset, entryOffset, little) {
    var type = view.getUint16(entryOffset + 2, little);
    var count = view.getUint32(entryOffset + 4, little);
    var valueOffset = entryOffset + 8;
    var byteLen = count * ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1);
    var dataOffset = byteLen <= 4 ? valueOffset : tiffOffset + view.getUint32(valueOffset, little);

    if (dataOffset + byteLen > view.byteLength) return null;

    if (type === 2) {
      var str = bytesToAscii(view, dataOffset, Math.max(0, count - 1));
      return str.replace(/\0+$/, '');
    }
    if (type === 1 || type === 7) {
      if (count === 1) return view.getUint8(dataOffset);
      var arr = [];
      for (var i = 0; i < count; i++) arr.push(view.getUint8(dataOffset + i));
      return arr;
    }
    if (type === 3) {
      if (count === 1) return view.getUint16(dataOffset, little);
      var u16 = [];
      for (var j = 0; j < count; j++) u16.push(view.getUint16(dataOffset + j * 2, little));
      return u16;
    }
    if (type === 4) {
      if (count === 1) return view.getUint32(dataOffset, little);
      var u32 = [];
      for (var k = 0; k < count; k++) u32.push(view.getUint32(dataOffset + k * 4, little));
      return u32;
    }
    if (type === 5) {
      var rats = [];
      for (var r = 0; r < count; r++) {
        rats.push({
          num: view.getUint32(dataOffset + r * 8, little),
          den: view.getUint32(dataOffset + r * 8 + 4, little)
        });
      }
      if (count === 1) return readRationalFromPair(rats[0]);
      return rats;
    }
    if (type === 10) {
      if (count === 1) return readSRational(view, dataOffset, little);
      var sr = [];
      for (var s = 0; s < count; s++) sr.push(readSRational(view, dataOffset + s * 8, little));
      return sr;
    }
    return null;
  }

  function parseIfd(view, tiffOffset, ifdOffset, scan, ifdName, tagMap, gpsContext) {
    if (ifdOffset < 0 || tiffOffset + ifdOffset + 2 > view.byteLength) return { exifIfd: null, gpsIfd: null };
    var dirStart = tiffOffset + ifdOffset;
    var little = view.getUint16(tiffOffset, false) === 0x4949;
    var entries = view.getUint16(dirStart, little);
    var exifPtr = null;
    var gpsPtr = null;
    var gpsData = gpsContext || {};

    for (var i = 0; i < entries; i++) {
      var entryOffset = dirStart + 2 + i * 12;
      if (entryOffset + 12 > view.byteLength) break;
      var tag = view.getUint16(entryOffset, little);
      var val = readTagValue(view, tiffOffset, entryOffset, little);

      if (ifdName === 'GPS') {
        var gName = GPS_TAGS[tag];
        if (!gName) continue;
        if (tag === 0x0001) gpsData.latRef = val;
        else if (tag === 0x0002) gpsData.lat = val;
        else if (tag === 0x0003) gpsData.lonRef = val;
        else if (tag === 0x0004) gpsData.lon = val;
        else if (tag === 0x0005) gpsData.altRef = val;
        else if (tag === 0x0006) gpsData.alt = val;
        else if (tag === 0x0007 && Array.isArray(val)) gpsData.time = val;
        else if (tag === 0x0010) gpsData.direction = val;
        else if (tag === 0x001d) gpsData.date = val;
        else pushField(scan, fieldEntry('gps', gName, formatGpsValue(gName, val), { sensitive: true }));
        continue;
      }

      if (tag === 0x8769) { exifPtr = val; continue; }
      if (tag === 0x8825) { gpsPtr = val; continue; }

      var info = tagMap[tag];
      if (!info || info.pointer) continue;
      if (val == null) continue;

      var display = val;
      if (tag === 0x9209) display = flashLabel(val);
      if (tag === 0xa403) display = val === 0 ? 'Auto' : val === 1 ? 'Manual' : val;
      if (tag === 0x8822) display = exposureProgramLabel(val);
      if (tag === 0x829d || tag === 0x9202) display = 'f/' + (typeof val === 'number' ? val.toFixed(1) : val);
      if (tag === 0x920a) display = (typeof val === 'number' ? val.toFixed(1) : val) + ' mm';
      if (tag === 0x9201 || tag === 0x829a) {
        if (typeof val === 'number') display = tag === 0x9201 ? exposureTimeLabel(val) : val + ' mm';
      }
      if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) display = formatExifDate(val);
      if (tag === 0x927c) {
        pushField(scan, fieldEntry('other', 'MakerNote', 'Detected (manufacturer-specific data)', { sensitive: true }));
        continue;
      }

      pushField(scan, fieldEntry(info.cat, info.name, display, { sensitive: !!info.sensitive }));
    }

    if (gpsData.lat && gpsData.lon) {
      var lat = dmsToDecimal(gpsData.lat, gpsData.latRef);
      var lon = dmsToDecimal(gpsData.lon, gpsData.lonRef);
      if (lat != null) pushField(scan, fieldEntry('gps', 'Latitude', lat, { sensitive: true }));
      if (lon != null) pushField(scan, fieldEntry('gps', 'Longitude', lon, { sensitive: true }));
    }
    if (gpsData.alt != null) {
      var alt = typeof gpsData.alt === 'number' ? gpsData.alt : readRationalFromPair(gpsData.alt);
      pushField(scan, fieldEntry('gps', 'Altitude', alt + ' m', { sensitive: true }));
    }
    if (gpsData.direction != null) {
      pushField(scan, fieldEntry('gps', 'GPS direction', gpsData.direction + '°', { sensitive: true }));
    }
    if (gpsData.date) pushField(scan, fieldEntry('gps', 'GPS date', gpsData.date, { sensitive: true }));

    return { exifIfd: exifPtr, gpsIfd: gpsPtr };
  }

  function formatGpsValue(name, val) {
    if (val == null) return '';
    if (Array.isArray(val) && val[0] && typeof val[0] === 'object' && 'num' in val[0]) {
      return val.map(function (r) { return readRationalFromPair(r); }).join('° ');
    }
    return escapeValue(val);
  }

  function flashLabel(v) {
    var map = { 0: 'No flash', 1: 'Fired', 5: 'Fired, no return', 7: 'Fired, return detected' };
    return map[v] || ('Flash code ' + v);
  }

  function exposureProgramLabel(v) {
    var map = { 0: 'Not defined', 1: 'Manual', 2: 'Normal program', 3: 'Aperture priority', 4: 'Shutter priority' };
    return map[v] || ('Program ' + v);
  }

  function exposureTimeLabel(v) {
    if (v >= 1) return v.toFixed(1) + ' s';
    var denom = Math.round(Math.pow(2, v));
    return denom ? '1/' + denom + ' s' : v + ' s';
  }

  function parseExifTiff(view, tiffOffset) {
    var scan = emptyScan();
    if (tiffOffset + 8 > view.byteLength) return scan;
    var little = view.getUint16(tiffOffset, false) === 0x4949;
    var firstIfd = view.getUint32(tiffOffset + 4, little);
    var ptrs = parseIfd(view, tiffOffset, firstIfd, scan, 'IFD0', TAG_INFO, {});
    if (ptrs.exifIfd) parseIfd(view, tiffOffset, ptrs.exifIfd, scan, 'Exif', TAG_INFO, {});
    if (ptrs.gpsIfd) parseIfd(view, tiffOffset, ptrs.gpsIfd, scan, 'GPS', GPS_TAGS, {});
    return scan;
  }

  function parseJpegExif(buffer) {
    var scan = emptyScan();
    var view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return scan;
    var offset = 2;
    while (offset + 4 <= view.byteLength) {
      var marker = view.getUint16(offset, false);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffe1) {
        var segLen = view.getUint16(offset + 2, false);
        if (view.getUint32(offset + 4, false) === 0x45786966) {
          return parseExifTiff(view, offset + 10);
        }
      } else if (marker === 0xffe0 || marker === 0xffed) {
        /* APP0 / APP13 may contain JFIF / IPTC — note APP13 lightly */
        if (marker === 0xffed) {
          var len = view.getUint16(offset + 2, false);
          var hdr = bytesToAscii(view, offset + 4, Math.min(10, len - 2));
          if (hdr.indexOf('Photoshop') !== -1) {
            pushField(scan, fieldEntry('other', 'IPTC', 'Photoshop/IPTC segment detected', { sensitive: true }));
          }
        }
      }
      if (marker === 0xffda) break;
      offset += 2 + view.getUint16(offset + 2, false);
    }
    return scan;
  }

  function parsePngMetadata(buffer) {
    var scan = emptyScan();
    var view = new DataView(buffer);
    if (view.byteLength < 8) return scan;
    var sig = bytesToAscii(view, 0, 8);
    if (sig !== '\x89PNG\r\n\x1a\n') return scan;
    var offset = 8;
    while (offset + 12 <= view.byteLength) {
      var length = view.getUint32(offset, false);
      var type = bytesToAscii(view, offset + 4, 4);
      var dataStart = offset + 8;
      if (dataStart + length > view.byteLength) break;

      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        var raw = new Uint8Array(buffer, dataStart, length);
        var nul = raw.indexOf(0);
        var keyword = bytesToAscii(view, dataStart, nul >= 0 ? nul : Math.min(length, 32));
        pushField(scan, fieldEntry('other', type + ': ' + keyword, 'Textual metadata chunk', { sensitive: /author|copyright|title|description/i.test(keyword) }));
      } else if (type === 'eXIf') {
        var exifScan = parseExifTiff(view, dataStart);
        mergeScans(scan, exifScan);
      } else if (type === 'iCCP') {
        pushField(scan, fieldEntry('other', 'ICC Profile', 'Embedded colour profile', {}));
        scan.summary.icc = true;
      } else if (type === 'tIME') {
        var y = view.getUint16(dataStart, false);
        var mo = view.getUint8(dataStart + 2);
        var d = view.getUint8(dataStart + 3);
        pushField(scan, fieldEntry('datetime', 'PNG tIME', y + '-' + mo + '-' + d, { sensitive: true }));
      }

      offset = dataStart + length + 4;
      if (type === 'IEND') break;
    }
    return scan;
  }

  function parseWebpMetadata(buffer) {
    var scan = emptyScan();
    var view = new DataView(buffer);
    if (view.byteLength < 12) return scan;
    if (bytesToAscii(view, 0, 4) !== 'RIFF' || bytesToAscii(view, 8, 4) !== 'WEBP') return scan;
    var offset = 12;
    while (offset + 8 <= view.byteLength) {
      var fourcc = bytesToAscii(view, offset, 4);
      var size = view.getUint32(offset + 4, true);
      var dataStart = offset + 8;
      var padded = size + (size % 2);
      if (dataStart + size > view.byteLength) break;

      if (fourcc === 'EXIF') {
        var exifScan = parseExifTiff(view, dataStart + (size > 4 && view.getUint32(dataStart, false) === 0x45786966 ? 6 : 0));
        mergeScans(scan, exifScan);
      } else if (fourcc === 'XMP ') {
        pushField(scan, fieldEntry('other', 'XMP', 'XMP metadata chunk detected', { sensitive: true }));
      } else if (fourcc === 'ICCP') {
        pushField(scan, fieldEntry('other', 'ICC Profile', 'Embedded colour profile', {}));
        scan.summary.icc = true;
      }

      offset = dataStart + padded;
    }
    return scan;
  }

  function mergeScans(target, source) {
    source.fields.forEach(function (f) { pushField(target, f); });
  }

  function scanMetadata(buffer, mimeType) {
    try {
      if (mimeType === 'image/jpeg') return parseJpegExif(buffer);
      if (mimeType === 'image/png') return parsePngMetadata(buffer);
      if (mimeType === 'image/webp') return parseWebpMetadata(buffer);
    } catch (e) { /* fail safe */ }
    return emptyScan();
  }

  /* ---------- validation ---------- */

  function validateFile(file) {
    if (!file) return { ok: false, error: 'No file selected.' };
    var mime = (file.type || '').toLowerCase();
    var name = (file.name || '').toLowerCase();
    var extOk = SUPPORTED_EXT.some(function (ext) { return name.endsWith(ext); });
    if (SUPPORTED_MIMES.indexOf(mime) === -1 && !extOk) {
      var n = name.toLowerCase();
      if (/\.(heic|heif|avif|gif|bmp|tiff?|svg|raw|cr2|nef)$/.test(n)) {
        return { ok: false, error: 'This format is not supported. Use JPG, PNG, or WebP — convert HEIC/HEIF first with a converter tool.' };
      }
      return { ok: false, error: 'Unsupported image format. Please choose JPG, PNG, or WebP.' };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: 'This image is too large to safely process in your browser (max ' + formatBytes(MAX_FILE_BYTES) + ').' };
    }
    return { ok: true, mime: mime || mimeFromName(name) };
  }

  function mimeFromName(name) {
    if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
    if (/\.png$/i.test(name)) return 'image/png';
    if (/\.webp$/i.test(name)) return 'image/webp';
    return '';
  }

  function validateDimensions(width, height) {
    if (!width || !height) return { ok: false, error: 'Could not read image dimensions.' };
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return { ok: false, error: 'This image is too large to safely process in your browser (max ' + MAX_DIMENSION + ' px per side).' };
    }
    if (width * height > MAX_PIXELS) {
      return { ok: false, error: 'This image has too many pixels to safely process in your browser.' };
    }
    return { ok: true };
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatPct(before, after) {
    if (!before) return '0%';
    var diff = ((after - before) / before) * 100;
    var sign = diff >= 0 ? '+' : '';
    return sign + diff.toFixed(1) + '%';
  }

  function cleanFileName(name) {
    var base = name.replace(/\.[a-z0-9]+$/i, '');
    var ext = name.match(/(\.[a-z0-9]+)$/i);
    ext = ext ? ext[1].toLowerCase() : '.jpg';
    if (ext === '.jpeg') ext = '.jpg';
    return base + '-clean' + ext;
  }

  /* ---------- clean image via canvas re-encode ---------- */

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ img: img, url: url, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode this image.'));
      };
      img.src = url;
    });
  }

  function createCleanBlob(img, mimeType, quality) {
    return new Promise(function (resolve, reject) {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) { reject(new Error('Canvas is not available.')); return; }
      ctx.drawImage(img, 0, 0, w, h);

      var outMime = mimeType;
      if (outMime === 'image/jpg') outMime = 'image/jpeg';
      if (SUPPORTED_MIMES.indexOf(outMime) === -1) outMime = 'image/png';

      var q = clamp(quality / 100, 0.8, 1);
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('Could not encode the cleaned image.')); return; }
        resolve(blob);
      }, outMime, outMime === 'image/jpeg' || outMime === 'image/webp' ? q : undefined);
    });
  }

  function createCleanImage(file, imageInfo, options) {
    var opts = options || {};
    var mime = opts.mime || file.type || mimeFromName(file.name) || 'image/jpeg';
    var quality = opts.quality == null ? 95 : opts.quality;
    return createCleanBlob(imageInfo.img, mime, quality).then(function (blob) {
      return blob.arrayBuffer().then(function (buf) {
        var verify = scanMetadata(buf, blob.type || mime);
        return {
          blob: blob,
          buffer: buf,
          mime: blob.type || mime,
          size: blob.size,
          verify: verify,
          fileName: cleanFileName(file.name)
        };
      });
    });
  }

  global.ExifEngine = {
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_PIXELS: MAX_PIXELS,
    MAX_DIMENSION: MAX_DIMENSION,
    SUPPORTED_MIMES: SUPPORTED_MIMES,
    SENSITIVE_KEYS: SENSITIVE_KEYS,
    scanMetadata: scanMetadata,
    validateFile: validateFile,
    validateDimensions: validateDimensions,
    formatBytes: formatBytes,
    formatPct: formatPct,
    cleanFileName: cleanFileName,
    loadImageElement: loadImageElement,
    createCleanImage: createCleanImage,
    emptyScan: emptyScan
  };
})(typeof window !== 'undefined' ? window : globalThis);
