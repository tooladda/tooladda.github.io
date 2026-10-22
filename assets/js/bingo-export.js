/* ==========================================================================
   ToolAdda — Bingo Card Generator (export writers)

   Minimal, dependency-free PDF and ZIP writers.

   This page previously pulled jsPDF, JSZip and a QR library from three
   separate CDNs while its own description promised "100% in your browser".
   Those are also the two features the page is named for, so a blocked CDN
   or an offline classroom broke the headline function with nothing but a
   toast to explain it.

   Neither format needs a library for what this tool does:

   · PDF — one JPEG per page, embedded with /DCTDecode. The JPEG bytes go
     in untouched; there is nothing to encode or compress.
   · ZIP — entries are STORED (method 0). PNG data is already compressed,
     so deflating it again would cost CPU to save almost nothing.

   Both writers emit bytes, so both are testable in Node with no canvas.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Byte helpers
     ====================================================================== */

  /** Latin-1 string to bytes. PDF syntax and ZIP headers are both ASCII. */
  function bytesFromLatin1(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  /** UTF-8 encode — ZIP filenames may carry non-ASCII characters. */
  function bytesFromUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var utf = unescape(encodeURIComponent(str));
    return bytesFromLatin1(utf);
  }

  function concatBytes(chunks) {
    var total = 0;
    var i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var at = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], at); at += chunks[i].length; }
    return out;
  }

  function u16(value) {
    return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
  }
  function u32(value) {
    return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
  }

  /* ======================================================================
     2. CRC-32 (ZIP requires it per entry)
     ====================================================================== */

  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ======================================================================
     3. ZIP writer (STORED entries)
     ====================================================================== */

  /** JavaScript Date to the packed DOS time/date ZIP stores. */
  function dosDateTime(date) {
    var d = date || new Date(2020, 0, 1, 0, 0, 0);
    var year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f),
      date: (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
    };
  }

  /**
   * @param {Array<{name:string, data:Uint8Array}>} files
   * @returns {Uint8Array} a complete .zip
   */
  function buildZip(files, options) {
    var opts = options || {};
    var stamp = dosDateTime(opts.date);
    var local = [];
    var central = [];
    var offset = 0;

    (files || []).forEach(function (file) {
      var nameBytes = bytesFromUtf8(file.name);
      var data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || 0);
      var sum = crc32(data);

      /* Bit 11 marks the filename as UTF-8, which is what we encode. */
      var flags = 0x0800;

      var localHeader = concatBytes([
        bytesFromLatin1('PK\x03\x04'),
        u16(20),          /* version needed */
        u16(flags),
        u16(0),           /* method 0 = stored */
        u16(stamp.time), u16(stamp.date),
        u32(sum),
        u32(data.length), /* compressed   */
        u32(data.length), /* uncompressed */
        u16(nameBytes.length),
        u16(0),           /* extra length */
        nameBytes
      ]);

      local.push(localHeader, data);

      central.push(concatBytes([
        bytesFromLatin1('PK\x01\x02'),
        u16(20),          /* version made by */
        u16(20),          /* version needed  */
        u16(flags),
        u16(0),
        u16(stamp.time), u16(stamp.date),
        u32(sum),
        u32(data.length), u32(data.length),
        u16(nameBytes.length),
        u16(0), u16(0),   /* extra, comment */
        u16(0),           /* disk number    */
        u16(0),           /* internal attrs */
        u32(0),           /* external attrs */
        u32(offset),      /* offset of local header */
        nameBytes
      ]));

      offset += localHeader.length + data.length;
    });

    var centralBytes = concatBytes(central);
    var eocd = concatBytes([
      bytesFromLatin1('PK\x05\x06'),
      u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(centralBytes.length),
      u32(offset),
      u16(0)
    ]);

    return concatBytes([concatBytes(local), centralBytes, eocd]);
  }

  /* ======================================================================
     4. JPEG inspection

     A PDF must declare an image's dimensions and colour space in the
     XObject dictionary. Rather than trust the caller, read them from the
     JPEG's own SOF marker.
     ====================================================================== */

  function readJpegInfo(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    var i = 2;
    while (i < bytes.length - 1) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      var marker = bytes[i + 1];
      /* Standalone markers carry no length field. */
      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      var length = (bytes[i + 2] << 8) | bytes[i + 3];
      /* SOF0..SOF15, excluding the DHT/JPG/DAC markers interleaved in range. */
      var isSOF = (marker >= 0xC0 && marker <= 0xCF) &&
        marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
      if (isSOF) {
        return {
          precision: bytes[i + 4],
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
          components: bytes[i + 9]
        };
      }
      if (marker === 0xDA) break;   /* start of scan — no header past here */
      i += 2 + length;
    }
    return null;
  }

  /* ======================================================================
     5. PDF writer

     One page per image, each drawn to fill its MediaBox. Enough of the
     PDF 1.4 spec to be valid, and no more.
     ====================================================================== */

  function pdfEscape(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  /**
   * @param {Array<{jpeg:Uint8Array, widthPt:number, heightPt:number}>} pages
   * @returns {Uint8Array} a complete PDF
   */
  function buildPdf(pages, options) {
    var opts = options || {};
    var list = (pages || []).filter(function (p) { return p && p.jpeg && p.jpeg.length; });
    if (!list.length) throw new Error('A PDF needs at least one page.');

    var chunks = [];
    var offsets = [0];          /* object 0 is the free head of the xref */
    var length = 0;

    function push(bytes) {
      chunks.push(bytes);
      length += bytes.length;
    }
    function pushStr(str) { push(bytesFromLatin1(str)); }
    function startObject(num) {
      offsets[num] = length;
      pushStr(num + ' 0 obj\n');
    }

    /* 1 = Catalog, 2 = Pages, then three objects per page. */
    var pageObjectIds = [];
    list.forEach(function (_, i) { pageObjectIds.push(3 + i * 3); });
    var totalObjects = 2 + list.length * 3;

    pushStr('%PDF-1.4\n');
    /* Binary comment marks the file as containing binary data. */
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    startObject(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    startObject(2);
    pushStr('<< /Type /Pages /Kids [' +
      pageObjectIds.map(function (id) { return id + ' 0 R'; }).join(' ') +
      '] /Count ' + list.length + ' >>\nendobj\n');

    list.forEach(function (page, i) {
      var pageId = 3 + i * 3;
      var imageId = pageId + 1;
      var contentId = pageId + 2;

      var info = readJpegInfo(page.jpeg) || { width: 1, height: 1, components: 3 };
      var w = page.widthPt || 595.28;
      var h = page.heightPt || 841.89;

      startObject(pageId);
      pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w.toFixed(2) + ' ' + h.toFixed(2) + ']' +
        ' /Resources << /XObject << /Im0 ' + imageId + ' 0 R >> >>' +
        ' /Contents ' + contentId + ' 0 R >>\nendobj\n');

      startObject(imageId);
      pushStr('<< /Type /XObject /Subtype /Image' +
        ' /Width ' + info.width + ' /Height ' + info.height +
        ' /ColorSpace ' + (info.components === 1 ? '/DeviceGray' : '/DeviceRGB') +
        ' /BitsPerComponent 8 /Filter /DCTDecode' +
        ' /Length ' + page.jpeg.length + ' >>\nstream\n');
      push(page.jpeg);
      pushStr('\nendstream\nendobj\n');

      /* Scale the unit image square to the full page. */
      var content = 'q\n' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';
      startObject(contentId);
      pushStr('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
    });

    /* ---- cross-reference table ---- */
    var xrefStart = length;
    pushStr('xref\n0 ' + (totalObjects + 1) + '\n');
    pushStr('0000000000 65535 f \n');
    for (var n = 1; n <= totalObjects; n++) {
      var off = offsets[n] || 0;
      pushStr(String(off).padStart(10, '0') + ' 00000 n \n');
    }

    pushStr('trailer\n<< /Size ' + (totalObjects + 1) + ' /Root 1 0 R' +
      ' /Info << /Title (' + pdfEscape(opts.title || 'Bingo Cards') + ')' +
      ' /Producer (ToolAdda) >> >>\n');
    pushStr('startxref\n' + xrefStart + '\n%%EOF\n');

    return concatBytes(chunks);
  }

  /* ======================================================================
     6. Data URL helpers
     ====================================================================== */

  /** Strip the "data:...;base64," prefix and decode to bytes. */
  function bytesFromDataUrl(dataUrl) {
    var comma = String(dataUrl).indexOf(',');
    if (comma === -1) return new Uint8Array(0);
    var base64 = String(dataUrl).slice(comma + 1);
    if (typeof atob === 'function') {
      var binary = atob(base64);
      var out = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
    return new Uint8Array(0);
  }

  global.BingoExport = {
    bytesFromLatin1: bytesFromLatin1,
    bytesFromUtf8: bytesFromUtf8,
    bytesFromDataUrl: bytesFromDataUrl,
    concatBytes: concatBytes,
    crc32: crc32,
    dosDateTime: dosDateTime,
    buildZip: buildZip,
    readJpegInfo: readJpegInfo,
    buildPdf: buildPdf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.BingoExport;

})(typeof window !== 'undefined' ? window : this);
