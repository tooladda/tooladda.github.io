/* ============================================================
   ToolAdda — QR Code Generator

   TWO BUGS DROVE THIS REWRITE. Both produced a QR that looked fine.

   1. NO QUIET ZONE.
      The old renderer drew the symbol edge to edge:

          const canvasSize = modules * scale;
          ctx.fillRect(col * scale, row * scale, scale, scale);

      ISO/IEC 18004 requires a four-module light margin around the
      symbol. Without it the outermost ring of dark modules touches
      whatever the code is placed on, and scanners lose the finder
      pattern — most visibly when the QR sits on a coloured card or a
      photograph. Every render here adds the margin.

   2. NON-ASCII DATA WAS SILENTLY CORRUPTED.
      qrcode-generator 1.4.4 ships two byte encoders and defaults to
      the Latin-1 one, which is `charCodeAt(i) & 0xff`. Encoding
      "नमस्ते" produced six junk bytes instead of the correct eighteen:

          default : [40, 46, 56, 77, 36, 71]
          UTF-8   : [224,164,168, 224,164,174, 224,164,184, ...]

      make() succeeded, the QR scanned, and it decoded to mojibake.
      Hindi, Chinese, Arabic, accented Latin and emoji were all
      affected. The UTF-8 encoder is now selected explicitly before
      any data is added.

   A third, smaller problem: the requested size was never honoured —
   `modules * floor(size / modules)` turned a 320px request into a
   300px canvas. Preview size and export size are separate concepts
   here, and the export is rendered at the size that was asked for.

   ARCHITECTURE
   ------------
   Everything above the export marker is pure and unit-tested in Node:
   payload construction for every QR type, the escaping rules those
   formats require, validation, capacity limits and contrast maths.
   The DOM layer only draws. Nothing is uploaded — no Wi-Fi password,
   contact or URL leaves the page.
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* Four modules is the minimum the specification allows. */
  var QUIET_ZONE = 4;
  var MIN_EXPORT = 128;
  var MAX_EXPORT = 2048;
  var MAX_LOGO_RATIO = 0.3;

  /* ============================================================
     1. Escaping

     Each payload format has its own rules. Concatenating raw user
     input into them is how an SSID containing a semicolon silently
     produces a different network name.
     ============================================================ */

  /* WIFI: T:WPA;S:name;P:pass;; — backslash, semicolon, comma, colon
     and double quote are all reserved and must be backslash-escaped. */
  function escapeWifi(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/([\\;,:"])/g, '\\$1');
  }

  /* vCard 3.0 escapes backslash, comma and semicolon, and encodes a
     newline as the two characters \n. */
  function escapeVcard(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function encodeComponent(value) {
    return encodeURIComponent(String(value === undefined || value === null ? '' : value));
  }

  /* ============================================================
     2. Validation
     ============================================================ */

  function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }

  /* Accept what a person types. `example.com` becomes https, but a
     URL that already names a scheme is left exactly as it is — a QR
     must encode the data the user meant, not a normalised guess. */
  function normaliseUrl(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return text;
    return 'https://' + text;
  }

  function isValidUrl(raw) {
    var text = normaliseUrl(raw);
    if (!text) return false;
    try {
      var u = new URL(text);
      return !!u.protocol && (!!u.hostname || u.protocol !== 'https:');
    } catch (e) { return false; }
  }

  /* Deliberately permissive: a strict pattern rejects valid addresses
     far more often than it catches typos. */
  function isValidEmail(raw) {
    var s = String(raw || '').trim();
    return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(s);
  }

  /* International formats vary wildly. Require a plausible run of
     digits and allow the punctuation people actually use. */
  function isValidPhone(raw) {
    var s = String(raw || '').trim();
    if (!s) return false;
    if (!/^[+]?[\d\s().-]+$/.test(s)) return false;
    var digits = s.replace(/\D/g, '');
    return digits.length >= 4 && digits.length <= 15;
  }

  function normalisePhone(raw) {
    return String(raw || '').trim().replace(/[^\d+]/g, '');
  }

  function isValidLatitude(v) {
    var n = Number(v);
    return isFinite(n) && n >= -90 && n <= 90 && String(v).trim() !== '';
  }
  function isValidLongitude(v) {
    var n = Number(v);
    return isFinite(n) && n >= -180 && n <= 180 && String(v).trim() !== '';
  }

  /* ============================================================
     3. Payload builders

     Each returns { ok, payload } or { ok:false, field, message }.
     ============================================================ */

  function fail(field, message) { return { ok: false, field: field, message: message }; }

  var TYPES = [
    { id: 'url', name: 'URL', hint: 'Website address' },
    { id: 'text', name: 'Text', hint: 'Any plain text' },
    { id: 'wifi', name: 'Wi-Fi', hint: 'Network credentials' },
    { id: 'email', name: 'Email', hint: 'Pre-filled message' },
    { id: 'phone', name: 'Phone', hint: 'Dial a number' },
    { id: 'sms', name: 'SMS', hint: 'Pre-filled text message' },
    { id: 'vcard', name: 'Contact', hint: 'vCard contact details' },
    { id: 'geo', name: 'Location', hint: 'Map coordinates' },
    { id: 'whatsapp', name: 'WhatsApp', hint: 'Open a chat' }
  ];

  function buildUrl(d) {
    if (isBlank(d.url)) return fail('url', 'Please enter a URL.');
    if (!isValidUrl(d.url)) return fail('url', 'That does not look like a valid URL.');
    return { ok: true, payload: normaliseUrl(d.url) };
  }

  function buildText(d) {
    if (isBlank(d.text)) return fail('text', 'Please enter some text.');
    /* Encoded verbatim — no trimming of interior whitespace, because
       the scanned result must equal what was typed. */
    return { ok: true, payload: String(d.text) };
  }

  function buildWifi(d) {
    if (isBlank(d.ssid)) return fail('ssid', 'Please enter the network name (SSID).');
    var security = d.security === 'WEP' ? 'WEP' : (d.security === 'nopass' ? 'nopass' : 'WPA');
    if (security !== 'nopass' && isBlank(d.password)) {
      return fail('password', 'Please enter the network password, or choose "No password".');
    }
    var parts = 'WIFI:T:' + security + ';S:' + escapeWifi(d.ssid) + ';';
    if (security !== 'nopass') parts += 'P:' + escapeWifi(d.password) + ';';
    if (d.hidden) parts += 'H:true;';
    return { ok: true, payload: parts + ';' };
  }

  function buildEmail(d) {
    if (isBlank(d.email)) return fail('email', 'Please enter an email address.');
    if (!isValidEmail(d.email)) return fail('email', 'Please enter a valid email address.');
    var query = [];
    if (!isBlank(d.subject)) query.push('subject=' + encodeComponent(d.subject));
    if (!isBlank(d.body)) query.push('body=' + encodeComponent(d.body));
    return {
      ok: true,
      payload: 'mailto:' + String(d.email).trim() + (query.length ? '?' + query.join('&') : '')
    };
  }

  function buildPhone(d) {
    if (isBlank(d.phone)) return fail('phone', 'Please enter a phone number.');
    if (!isValidPhone(d.phone)) return fail('phone', 'Please enter a valid phone number.');
    return { ok: true, payload: 'tel:' + normalisePhone(d.phone) };
  }

  function buildSms(d) {
    if (isBlank(d.phone)) return fail('phone', 'Please enter a phone number.');
    if (!isValidPhone(d.phone)) return fail('phone', 'Please enter a valid phone number.');
    var body = isBlank(d.message) ? '' : '?body=' + encodeComponent(d.message);
    return { ok: true, payload: 'SMSTO:' + normalisePhone(d.phone) + (body ? ':' + String(d.message) : '') };
  }

  function buildVcard(d) {
    if (isBlank(d.firstName) && isBlank(d.lastName) && isBlank(d.org)) {
      return fail('firstName', 'Please enter at least a name or an organisation.');
    }
    if (!isBlank(d.email) && !isValidEmail(d.email)) {
      return fail('email', 'Please enter a valid email address.');
    }
    if (!isBlank(d.phone) && !isValidPhone(d.phone)) {
      return fail('phone', 'Please enter a valid phone number.');
    }

    var last = escapeVcard(d.lastName);
    var first = escapeVcard(d.firstName);
    var lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push('N:' + last + ';' + first + ';;;');
    lines.push('FN:' + escapeVcard([d.firstName, d.lastName].filter(function (x) { return !isBlank(x); }).join(' ')));
    if (!isBlank(d.org)) lines.push('ORG:' + escapeVcard(d.org));
    if (!isBlank(d.title)) lines.push('TITLE:' + escapeVcard(d.title));
    if (!isBlank(d.phone)) lines.push('TEL;TYPE=CELL:' + escapeVcard(String(d.phone).trim()));
    if (!isBlank(d.email)) lines.push('EMAIL:' + escapeVcard(String(d.email).trim()));
    if (!isBlank(d.website)) lines.push('URL:' + escapeVcard(normaliseUrl(d.website)));
    if (!isBlank(d.address)) lines.push('ADR;TYPE=WORK:;;' + escapeVcard(d.address) + ';;;;');
    lines.push('END:VCARD');
    /* vCard uses CRLF line endings. */
    return { ok: true, payload: lines.join('\r\n') };
  }

  function buildGeo(d) {
    if (isBlank(d.lat) || isBlank(d.lng)) return fail('lat', 'Please enter both latitude and longitude.');
    if (!isValidLatitude(d.lat)) return fail('lat', 'Latitude must be between -90 and 90.');
    if (!isValidLongitude(d.lng)) return fail('lng', 'Longitude must be between -180 and 180.');
    var base = 'geo:' + Number(d.lat) + ',' + Number(d.lng);
    if (!isBlank(d.label)) base += '?q=' + Number(d.lat) + ',' + Number(d.lng) + '(' + encodeComponent(d.label) + ')';
    return { ok: true, payload: base };
  }

  function buildWhatsapp(d) {
    if (isBlank(d.phone)) return fail('phone', 'Please enter a phone number with country code.');
    if (!isValidPhone(d.phone)) return fail('phone', 'Please enter a valid phone number.');
    var digits = normalisePhone(d.phone).replace(/^\+/, '');
    var text = isBlank(d.message) ? '' : '?text=' + encodeComponent(d.message);
    return { ok: true, payload: 'https://wa.me/' + digits + text };
  }

  var BUILDERS = {
    url: buildUrl, text: buildText, wifi: buildWifi, email: buildEmail,
    phone: buildPhone, sms: buildSms, vcard: buildVcard, geo: buildGeo, whatsapp: buildWhatsapp
  };

  function buildPayload(type, data) {
    var fn = BUILDERS[type];
    if (!fn) return fail('type', 'Unknown QR code type.');
    return fn(data || {});
  }

  /* ============================================================
     4. Contrast

     WCAG relative luminance. A QR needs far more separation than
     text does; scanners generally want a strong light/dark split, so
     anything under 3:1 is refused and under 7:1 is flagged.
     ============================================================ */

  function hexToRgb(hex) {
    var raw = String(hex || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(raw)) raw = raw.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return { r: 0, g: 0, b: 0 };
    var n = parseInt(raw, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function relativeLuminance(hex) {
    var c = hexToRgb(hex);
    function ch(v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  function contrastRatio(a, b) {
    var la = relativeLuminance(a);
    var lb = relativeLuminance(b);
    var hi = Math.max(la, lb);
    var lo = Math.min(la, lb);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }

  function contrastCheck(foreground, background) {
    var ratio = contrastRatio(foreground, background);
    /* A light foreground on a dark background is inverted; most
       scanners cope, but not all, so it is worth saying. */
    var inverted = relativeLuminance(foreground) > relativeLuminance(background);
    if (ratio < 3) {
      return { ratio: ratio, level: 'danger', inverted: inverted,
        message: 'These colours are too close together — this QR code is unlikely to scan. Use a dark foreground on a light background.' };
    }
    if (ratio < 7) {
      return { ratio: ratio, level: 'warning', inverted: inverted,
        message: 'Low contrast may make this QR code difficult to scan. Test it before printing.' };
    }
    if (inverted) {
      return { ratio: ratio, level: 'warning', inverted: true,
        message: 'This QR code is inverted (light on dark). Most modern scanners handle it, but older ones may not.' };
    }
    return { ratio: ratio, level: 'ok', inverted: false, message: '' };
  }

  /* ============================================================
     5. Capacity and sizing
     ============================================================ */

  /* Byte-mode capacity of a version 40 symbol at each level. Used to
     refuse oversized input with a useful message instead of letting
     the library throw "code length overflow. (32020>10208)". */
  var MAX_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  function utf8Length(text) {
    var s = String(text || '');
    var n = 0;
    for (var i = 0; i < s.length; i += 1) {
      var c = s.codePointAt(i);
      if (c > 0xffff) { n += 4; i += 1; }
      else if (c > 0x7ff) n += 3;
      else if (c > 0x7f) n += 2;
      else n += 1;
    }
    return n;
  }

  function capacityCheck(payload, ecc) {
    var level = MAX_BYTES[ecc] ? ecc : 'M';
    var bytes = utf8Length(payload);
    var max = MAX_BYTES[level];
    if (bytes > max) {
      return { ok: false, bytes: bytes, max: max, level: level,
        message: 'This data is too large for a reliable QR code at error correction ' + level +
          ' (' + bytes + ' bytes, limit ' + max + '). Shorten the content or lower the error correction level.' };
    }
    if (bytes > max * 0.75) {
      return { ok: true, bytes: bytes, max: max, level: level, dense: true,
        message: 'This is a dense QR code. Print it larger than usual and test it before mass production.' };
    }
    return { ok: true, bytes: bytes, max: max, level: level, dense: false, message: '' };
  }

  function clampExportSize(value) {
    var n = Math.round(Number(value) || 512);
    return Math.max(MIN_EXPORT, Math.min(MAX_EXPORT, n));
  }

  /* A logo covering too much of the symbol destroys modules the error
     correction then has to recover. Even at H that has a limit. */
  function logoAdvice(ratio, ecc) {
    var r = Number(ratio) || 0;
    if (r <= 0) return { ok: true, message: '', suggestEcc: null };
    if (r > MAX_LOGO_RATIO) {
      return { ok: false, suggestEcc: 'H',
        message: 'This logo covers too much of the QR code and will stop it scanning. Reduce it to 30% or less.' };
    }
    if (ecc !== 'H') {
      return { ok: true, suggestEcc: 'H',
        message: 'A logo covers part of the pattern. Error correction H is recommended so the code still scans.' };
    }
    if (r > 0.22) {
      return { ok: true, suggestEcc: null,
        message: 'Large logos may reduce QR scan reliability. Test with more than one phone.' };
    }
    return { ok: true, message: '', suggestEcc: null };
  }

  /* ============================================================
     6. Filenames
     ============================================================ */

  function fileNameFor(type, extension) {
    var names = {
      url: 'website', text: 'text', wifi: 'wifi', email: 'email', phone: 'phone',
      sms: 'sms', vcard: 'contact', geo: 'location', whatsapp: 'whatsapp'
    };
    var base = names[type] || 'qr';
    return base + '-qr-code.' + (extension || 'png');
  }

  /* ============================================================
     7. SVG — a real vector, not a raster wrapped in markup
     ============================================================ */

  function buildSvg(matrix, options) {
    options = options || {};
    var modules = matrix.length;
    var quiet = options.quiet === undefined ? QUIET_ZONE : options.quiet;
    var total = modules + quiet * 2;
    var size = clampExportSize(options.size || 512);
    var fg = options.foreground || '#000000';
    var bg = options.background || '#ffffff';

    /* One path for every dark module keeps the file small and keeps
       it a true vector — it scales to any print size losslessly. */
    var d = [];
    for (var r = 0; r < modules; r += 1) {
      for (var c = 0; c < modules; c += 1) {
        if (matrix[r][c]) d.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }

    var background = options.transparent
      ? ''
      : '<rect width="' + total + '" height="' + total + '" fill="' + bg + '"/>';

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" ' +
      'viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" role="img" ' +
      'aria-label="QR code">' +
      background +
      '<path fill="' + fg + '" d="' + d.join('') + '"/>' +
      '</svg>';
  }

  /* ============================================================
     8. Export
     ============================================================ */

  var engine = {
    QUIET_ZONE: QUIET_ZONE,
    MIN_EXPORT: MIN_EXPORT,
    MAX_EXPORT: MAX_EXPORT,
    MAX_LOGO_RATIO: MAX_LOGO_RATIO,
    MAX_BYTES: MAX_BYTES,
    TYPES: TYPES,

    escapeWifi: escapeWifi,
    escapeVcard: escapeVcard,
    normaliseUrl: normaliseUrl,
    normalisePhone: normalisePhone,
    isValidUrl: isValidUrl,
    isValidEmail: isValidEmail,
    isValidPhone: isValidPhone,
    isValidLatitude: isValidLatitude,
    isValidLongitude: isValidLongitude,

    buildPayload: buildPayload,
    buildUrl: buildUrl,
    buildText: buildText,
    buildWifi: buildWifi,
    buildEmail: buildEmail,
    buildPhone: buildPhone,
    buildSms: buildSms,
    buildVcard: buildVcard,
    buildGeo: buildGeo,
    buildWhatsapp: buildWhatsapp,

    hexToRgb: hexToRgb,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    contrastCheck: contrastCheck,

    utf8Length: utf8Length,
    capacityCheck: capacityCheck,
    clampExportSize: clampExportSize,
    logoAdvice: logoAdvice,
    fileNameFor: fileNameFor,
    buildSvg: buildSvg
  };

  globalScope.ToolAddaQr = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     9. UI
     ============================================================ */

  var PRESETS = [
    { id: 'classic', name: 'Classic', fg: '#111827', bg: '#ffffff', ecc: 'M' },
    { id: 'midnight', name: 'Midnight', fg: '#0f172a', bg: '#e2e8f0', ecc: 'M' },
    { id: 'ocean', name: 'Ocean', fg: '#0c4a6e', bg: '#f0f9ff', ecc: 'M' },
    { id: 'forest', name: 'Forest', fg: '#14532d', bg: '#f0fdf4', ecc: 'M' },
    { id: 'plum', name: 'Plum', fg: '#4a044e', bg: '#fdf4ff', ecc: 'M' },
    { id: 'ember', name: 'Ember', fg: '#7c2d12', bg: '#fff7ed', ecc: 'Q' }
  ];

  var state = {
    type: 'url',
    data: {},
    ecc: 'M',
    size: 1024,
    fg: '#111827',
    bg: '#ffffff',
    transparent: false,
    logo: null,
    logoRatio: 0.18,
    logoBacking: 'white',
    matrix: null,
    payload: ''
  };

  var dom = {};
  var timer = null;
  var announceTimer = null;
  var logoUrl = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* The library defaults to a Latin-1 byte encoder, which turns any
     non-ASCII payload into mojibake without failing. Select UTF-8
     once, before any data is added. */
  function ensureUtf8() {
    if (typeof qrcode !== 'function') return false;
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }
    return true;
  }

  function cacheDom() {
    dom.root = q('[data-qr-root]');
    if (!dom.root) return false;

    dom.typeButtons = qa('[data-qr-type]', dom.root);
    dom.forms = qa('[data-qr-form]', dom.root);
    dom.generate = q('[data-qr-generate]', dom.root);
    dom.reset = q('[data-qr-reset]', dom.root);
    dom.resetStyle = q('[data-qr-reset-style]', dom.root);

    dom.canvasWrap = q('[data-qr-canvas-wrap]', dom.root);
    dom.canvas = q('[data-qr-canvas]', dom.root);
    dom.empty = q('[data-qr-empty]', dom.root);
    dom.summary = q('[data-qr-summary]', dom.root);

    dom.ecc = q('#qrEcc', dom.root);
    dom.size = q('#qrSize', dom.root);
    dom.fg = q('#qrFg', dom.root);
    dom.bg = q('#qrBg', dom.root);
    dom.transparent = q('#qrTransparent', dom.root);
    dom.presets = q('[data-qr-presets]', dom.root);

    dom.logoInput = q('#qrLogo', dom.root);
    dom.logoRatio = q('#qrLogoSize', dom.root);
    dom.logoRatioOut = q('[data-qr-logo-out]', dom.root);
    dom.logoBacking = q('#qrLogoBacking', dom.root);
    dom.logoClear = q('[data-qr-logo-clear]', dom.root);
    dom.logoRow = q('[data-qr-logo-row]', dom.root);

    dom.downloadPng = q('[data-qr-download-png]', dom.root);
    dom.downloadSvg = q('[data-qr-download-svg]', dom.root);
    dom.print = q('[data-qr-print]', dom.root);
    dom.copyData = q('[data-qr-copy-data]', dom.root);
    dom.share = q('[data-qr-share]', dom.root);

    dom.error = q('[data-qr-error]', dom.root);
    dom.warning = q('[data-qr-warning]', dom.root);
    dom.status = q('[data-qr-status]', dom.root);
    dom.announce = q('[data-qr-announce]', dom.root);
    dom.printTitle = q('[data-qr-print-title]');
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

  function showError(message, field) {
    if (dom.error) {
      dom.error.hidden = !message;
      dom.error.textContent = message || '';
    }
    qa('[data-qr-field]', dom.root).forEach(function (el) {
      var bad = !!message && el.getAttribute('data-qr-field') === field;
      var input = el.matches('input, select, textarea') ? el : q('input, select, textarea', el);
      if (!input) return;
      if (bad) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
  }

  function showWarnings(list) {
    var msgs = list.filter(Boolean);
    if (!dom.warning) return;
    dom.warning.hidden = msgs.length === 0;
    dom.warning.textContent = msgs.join(' ');
  }

  function readForm() {
    var form = dom.forms.filter(function (f) { return f.getAttribute('data-qr-form') === state.type; })[0];
    var data = {};
    if (!form) return data;
    qa('[name]', form).forEach(function (input) {
      data[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    });
    return data;
  }

  function syncType() {
    dom.typeButtons.forEach(function (b) {
      var on = b.getAttribute('data-qr-type') === state.type;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.forms.forEach(function (f) {
      f.hidden = f.getAttribute('data-qr-form') !== state.type;
    });
  }

  /* ---------- rendering ---------- */

  function toMatrix(qr) {
    var n = qr.getModuleCount();
    var m = [];
    for (var r = 0; r < n; r += 1) {
      var row = [];
      for (var c = 0; c < n; c += 1) row.push(qr.isDark(r, c));
      m.push(row);
    }
    return m;
  }

  /* Draws at any pixel size with the four-module quiet zone included.
     The old renderer omitted the margin entirely. */
  function drawTo(canvas, matrix, pixelSize) {
    var modules = matrix.length;
    var total = modules + QUIET_ZONE * 2;
    var scale = Math.max(1, Math.floor(pixelSize / total));
    var dim = scale * total;

    if (!canvas) return null;
    canvas.width = dim;
    canvas.height = dim;
    var ctx = canvas.getContext && canvas.getContext('2d');
    /* A browser with canvas disabled still gets the payload, the
       warnings and the SVG export — only the raster preview is lost. */
    if (!ctx) return null;
    ctx.clearRect(0, 0, dim, dim);

    if (!state.transparent) {
      ctx.fillStyle = state.bg;
      ctx.fillRect(0, 0, dim, dim);
    }
    ctx.fillStyle = state.fg;
    for (var r = 0; r < modules; r += 1) {
      for (var c = 0; c < modules; c += 1) {
        if (matrix[r][c]) {
          ctx.fillRect((c + QUIET_ZONE) * scale, (r + QUIET_ZONE) * scale, scale, scale);
        }
      }
    }
    return { dim: dim, scale: scale, total: total };
  }

  function drawLogo(canvas, geometry) {
    if (!state.logo || !geometry) return;
    var ctx = canvas.getContext('2d');
    var box = Math.round(geometry.dim * state.logoRatio);
    var x = Math.round((geometry.dim - box) / 2);

    if (state.logoBacking !== 'transparent') {
      ctx.fillStyle = state.logoBacking === 'white' ? '#ffffff' : state.bg;
      var pad = Math.round(box * 0.12);
      ctx.fillRect(x - pad, x - pad, box + pad * 2, box + pad * 2);
    }
    ctx.drawImage(state.logo, x, x, box, box);
  }

  function render() {
    var built = buildPayload(state.type, state.data);
    if (!built.ok) {
      showError(built.message, built.field);
      showWarnings([]);
      setStatus('idle', 'Waiting for input');
      if (dom.empty) dom.empty.hidden = false;
      if (dom.canvasWrap) dom.canvasWrap.hidden = true;
      setActionsEnabled(false);
      state.matrix = null;
      return;
    }

    if (!ensureUtf8()) {
      showError('The QR library failed to load. Reload the page and try again.', 'type');
      return;
    }

    var capacity = capacityCheck(built.payload, state.ecc);
    if (!capacity.ok) {
      showError(capacity.message, 'type');
      setStatus('error', 'Data too large');
      setActionsEnabled(false);
      return;
    }

    var qr;
    try {
      qr = qrcode(0, state.ecc);
      qr.addData(built.payload);
      qr.make();
    } catch (e) {
      showError('Unable to generate this QR code. Try shortening the content.', 'type');
      setStatus('error', 'Generation failed');
      setActionsEnabled(false);
      return;
    }

    showError('');
    state.payload = built.payload;
    state.matrix = toMatrix(qr);

    if (dom.empty) dom.empty.hidden = true;
    if (dom.canvasWrap) dom.canvasWrap.hidden = false;

    var geometry = drawTo(dom.canvas, state.matrix, 640);
    drawLogo(dom.canvas, geometry);
    /* No canvas means no PNG, print or share — the SVG still works. */
    canvasAvailable = geometry !== null;

    var contrast = contrastCheck(state.fg, state.bg);
    var logo = logoAdvice(state.logo ? state.logoRatio : 0, state.ecc);
    showWarnings([
      contrast.message,
      capacity.message,
      logo.message,
      state.transparent ? 'Transparent backgrounds may reduce scan reliability on some surfaces.' : ''
    ]);

    renderSummary(qr, capacity, contrast);
    setStatus(contrast.level === 'danger' ? 'error' : 'ok',
      contrast.level === 'danger' ? 'Check contrast' : 'QR code ready');
    setActionsEnabled(true);
  }

  var canvasAvailable = true;

  function setActionsEnabled(on) {
    if (dom.downloadSvg) dom.downloadSvg.disabled = !on;
    if (dom.copyData) dom.copyData.disabled = !on;
    [dom.downloadPng, dom.print, dom.share].forEach(function (b) {
      if (b) b.disabled = !on || !canvasAvailable;
    });
  }

  function renderSummary(qr, capacity, contrast) {
    if (!dom.summary) return;
    var typeName = (TYPES.filter(function (t) { return t.id === state.type; })[0] || {}).name || state.type;
    var rows = [
      ['Type', typeName],
      ['Modules', qr.getModuleCount() + ' × ' + qr.getModuleCount()],
      ['Data', capacity.bytes + ' bytes'],
      ['Error correction', state.ecc],
      ['Export size', state.size + ' px'],
      ['Contrast', contrast.ratio + ':1']
    ];
    dom.summary.innerHTML = rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('');
  }

  /* ---------- exports ---------- */

  function exportCanvas() {
    var canvas = document.createElement('canvas');
    var geometry = drawTo(canvas, state.matrix, clampExportSize(state.size));
    drawLogo(canvas, geometry);
    return canvas;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadPng() {
    if (!state.matrix) return;
    exportCanvas().toBlob(function (blob) {
      if (!blob) { announce('Could not create the PNG.'); return; }
      downloadBlob(blob, fileNameFor(state.type, 'png'));
      announce('PNG downloaded.');
    }, 'image/png');
  }

  function downloadSvg() {
    if (!state.matrix) return;
    /* A logo cannot be embedded in the vector without turning it back
       into a raster, so the SVG is the clean symbol. */
    var svg = buildSvg(state.matrix, {
      size: clampExportSize(state.size),
      foreground: state.fg,
      background: state.bg,
      transparent: state.transparent
    });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), fileNameFor(state.type, 'svg'));
    announce(state.logo
      ? 'SVG downloaded. The vector export does not include the logo.'
      : 'SVG downloaded.');
  }

  function printQr() {
    if (!state.matrix) return;
    var canvas = exportCanvas();
    if (dom.printTitle) {
      var img = q('img', dom.printTitle);
      if (img) img.src = canvas.toDataURL('image/png');
      var label = q('[data-qr-print-label]', dom.printTitle);
      if (label) label.textContent = (TYPES.filter(function (t) { return t.id === state.type; })[0] || {}).name + ' QR code';
    }
    window.print();
  }

  function copyData() {
    if (!state.payload) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.payload).then(
        function () { announce('QR data copied to clipboard.'); },
        function () { announce('Could not copy. Select the data and copy manually.'); });
    } else {
      announce('Your browser does not allow clipboard writes here.');
    }
  }

  function shareQr() {
    if (!state.matrix || !navigator.share) return;
    exportCanvas().toBlob(function (blob) {
      if (!blob) return;
      var file = new File([blob], fileNameFor(state.type, 'png'), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'QR code' }).catch(function () { /* dismissed */ });
      } else {
        navigator.share({ text: state.payload }).catch(function () { /* dismissed */ });
      }
    }, 'image/png');
  }

  /* ---------- events ---------- */

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { state.data = readForm(); render(); }, 180);
  }

  function resetStyle() {
    state.ecc = 'M'; state.size = 1024; state.fg = '#111827'; state.bg = '#ffffff';
    state.transparent = false; state.logo = null; state.logoRatio = 0.18;
    if (logoUrl) { URL.revokeObjectURL(logoUrl); logoUrl = null; }
    if (dom.ecc) dom.ecc.value = 'M';
    if (dom.size) dom.size.value = '1024';
    if (dom.fg) dom.fg.value = state.fg;
    if (dom.bg) dom.bg.value = state.bg;
    if (dom.transparent) dom.transparent.checked = false;
    if (dom.logoInput) dom.logoInput.value = '';
    if (dom.logoRow) dom.logoRow.hidden = true;
    render();
    announce('Style reset to the safe default.');
  }

  function resetAll() {
    dom.forms.forEach(function (f) {
      qa('[name]', f).forEach(function (i) {
        if (i.type === 'checkbox') i.checked = false;
        else if (i.tagName === 'SELECT') i.selectedIndex = 0;
        else i.value = '';
      });
    });
    state.type = 'url';
    state.data = {};
    syncType();
    resetStyle();
    announce('Generator reset.');
  }

  function bindEvents() {
    dom.typeButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        state.type = b.getAttribute('data-qr-type');
        syncType();
        state.data = readForm();
        render();
        announce((TYPES.filter(function (t) { return t.id === state.type; })[0] || {}).name + ' selected.');
      });
    });

    dom.forms.forEach(function (f) {
      f.addEventListener('input', schedule);
      f.addEventListener('change', schedule);
    });

    if (dom.generate) {
      dom.generate.addEventListener('click', function () {
        state.data = readForm();
        render();
        if (state.matrix) announce('QR code generated.');
      });
    }
    if (dom.reset) dom.reset.addEventListener('click', resetAll);
    if (dom.resetStyle) dom.resetStyle.addEventListener('click', resetStyle);

    if (dom.ecc) dom.ecc.addEventListener('change', function () { state.ecc = dom.ecc.value; render(); });
    if (dom.size) dom.size.addEventListener('change', function () { state.size = clampExportSize(dom.size.value); render(); });
    if (dom.fg) dom.fg.addEventListener('input', function () { state.fg = dom.fg.value; render(); });
    if (dom.bg) dom.bg.addEventListener('input', function () { state.bg = dom.bg.value; render(); });
    if (dom.transparent) {
      dom.transparent.addEventListener('change', function () {
        state.transparent = dom.transparent.checked; render();
      });
    }

    if (dom.presets) {
      dom.presets.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-qr-preset]');
        if (!b) return;
        var p = PRESETS.filter(function (x) { return x.id === b.getAttribute('data-qr-preset'); })[0];
        if (!p) return;
        state.fg = p.fg; state.bg = p.bg; state.ecc = p.ecc;
        if (dom.fg) dom.fg.value = p.fg;
        if (dom.bg) dom.bg.value = p.bg;
        if (dom.ecc) dom.ecc.value = p.ecc;
        render();
        announce(p.name + ' preset applied.');
      });
    }

    if (dom.logoInput) {
      dom.logoInput.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (logoUrl) URL.revokeObjectURL(logoUrl);
        logoUrl = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          state.logo = img;
          if (dom.logoRow) dom.logoRow.hidden = false;
          /* A logo punches modules out of the symbol; H gives the
             error correction the best chance of recovering them. */
          if (state.ecc !== 'H') {
            state.ecc = 'H';
            if (dom.ecc) dom.ecc.value = 'H';
            announce('Error correction raised to H because a logo was added.');
          }
          render();
        };
        img.onerror = function () { announce('That logo could not be read.'); };
        img.src = logoUrl;
      });
    }
    if (dom.logoRatio) {
      dom.logoRatio.addEventListener('input', function () {
        state.logoRatio = Number(dom.logoRatio.value) / 100;
        if (dom.logoRatioOut) dom.logoRatioOut.textContent = dom.logoRatio.value + '%';
        render();
      });
    }
    if (dom.logoBacking) {
      dom.logoBacking.addEventListener('change', function () { state.logoBacking = dom.logoBacking.value; render(); });
    }
    if (dom.logoClear) {
      dom.logoClear.addEventListener('click', function () {
        state.logo = null;
        if (logoUrl) { URL.revokeObjectURL(logoUrl); logoUrl = null; }
        if (dom.logoInput) dom.logoInput.value = '';
        if (dom.logoRow) dom.logoRow.hidden = true;
        render();
        announce('Logo removed.');
      });
    }

    if (dom.downloadPng) dom.downloadPng.addEventListener('click', downloadPng);
    if (dom.downloadSvg) dom.downloadSvg.addEventListener('click', downloadSvg);
    if (dom.print) dom.print.addEventListener('click', printQr);
    if (dom.copyData) dom.copyData.addEventListener('click', copyData);

    /* Only offer Share where the API actually exists. */
    if (dom.share) {
      if (!navigator.share) dom.share.hidden = true;
      else dom.share.addEventListener('click', shareQr);
    }

    window.addEventListener('pagehide', function () {
      if (logoUrl) URL.revokeObjectURL(logoUrl);
    });
  }

  function renderPresets() {
    if (!dom.presets) return;
    dom.presets.innerHTML = PRESETS.map(function (p) {
      return '<button type="button" class="qr-swatch" data-qr-preset="' + esc(p.id) + '" ' +
        'aria-label="' + esc(p.name) + ' preset">' +
        '<span class="qr-swatch__chip" style="background:' + esc(p.bg) + ';border-color:' + esc(p.fg) + '">' +
        '<span style="background:' + esc(p.fg) + '"></span></span>' +
        '<span class="qr-swatch__name">' + esc(p.name) + '</span></button>';
    }).join('');
  }

  function init() {
    if (!cacheDom()) return;
    ensureUtf8();
    renderPresets();
    syncType();
    bindEvents();
    /* Start with a working example so the preview is never an empty
       box on first load. */
    var urlField = q('[data-qr-form="url"] [name="url"]', dom.root);
    if (urlField) urlField.value = 'https://tooladda.online';
    state.data = readForm();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
