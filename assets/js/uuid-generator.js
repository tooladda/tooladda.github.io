/*!
 * ToolAdda — UUID Generator / Identifier Lab
 * -----------------------------------------------------------------------------
 * Everything in this file runs in the visitor's browser. No UUID, no validator
 * input and no history entry is ever sent to a server.
 *
 * Randomness comes exclusively from the Web Crypto API
 * (crypto.randomUUID / crypto.getRandomValues). Math.random() is never used to
 * produce identifier bits.
 *
 * Layouts follow RFC 9562 (which obsoletes RFC 4122).
 */
(function () {
  'use strict';

  /* =========================================================================
   * 1. Small helpers
   * ====================================================================== */

  var doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var root = byId('uuidLab');
  if (!root) { return; }

  var MAX_QTY = 1000;
  var MIN_QTY = 1;
  var HISTORY_KEY = 'tooladda-uuid-history';
  var HISTORY_LIMIT = 8;
  var SETTINGS_KEY = 'tooladda-uuid-settings';

  var NIL_UUID = '00000000-0000-0000-0000-000000000000';
  var MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  /** Pre-computed byte -> two hex chars table (keeps bulk generation cheap). */
  var HEX = (function () {
    var table = new Array(256);
    for (var i = 0; i < 256; i += 1) {
      table[i] = (i + 0x100).toString(16).slice(1);
    }
    return table;
  }());

  function setText(el, value) {
    if (el) { el.textContent = value; }
  }

  /* =========================================================================
   * 2. Secure randomness
   * ====================================================================== */

  var cryptoObj = (typeof window !== 'undefined' && (window.crypto || window.msCrypto)) || null;
  var hasRandomValues = !!(cryptoObj && typeof cryptoObj.getRandomValues === 'function');
  var hasRandomUUID = !!(cryptoObj && typeof cryptoObj.randomUUID === 'function');
  var hasBigInt = (typeof BigInt === 'function');

  /**
   * Cryptographically secure random bytes.
   * Deliberately throws instead of falling back to Math.random().
   */
  function randomBytes(count) {
    if (!hasRandomValues) {
      throw new Error('SECURE_RANDOM_UNAVAILABLE');
    }
    var bytes = new Uint8Array(count);
    cryptoObj.getRandomValues(bytes);
    return bytes;
  }

  function bytesToUuid(b) {
    return HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + '-' +
      HEX[b[4]] + HEX[b[5]] + '-' +
      HEX[b[6]] + HEX[b[7]] + '-' +
      HEX[b[8]] + HEX[b[9]] + '-' +
      HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]];
  }

  /* =========================================================================
   * 3. UUID generators (RFC 9562 layouts)
   * ====================================================================== */

  /* ---- Version 4: 122 random bits ---------------------------------------- */

  function generateV4() {
    if (hasRandomUUID) {
      // Native path: already canonical, lowercase and CSPRNG-backed.
      return cryptoObj.randomUUID();
    }
    var b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx (RFC 9562)
    return bytesToUuid(b);
  }

  /* ---- Version 7: 48-bit Unix ms + monotonic counter + random ------------ */

  var v7LastMs = -1;
  var v7Counter = 0;

  /**
   * RFC 9562 §5.7 layout with the "monotonic random / dedicated counter"
   * guarantee from §6.2: rand_a is used as a 12-bit counter that increments
   * while the millisecond does not change, so a batch stays strictly ordered
   * and never repeats.
   */
  function generateV7() {
    var ms;
    var seq;

    for (;;) {
      ms = Date.now();
      if (ms > v7LastMs) {
        v7LastMs = ms;
        // Seed low so ~3.8k increments of headroom remain inside this ms.
        v7Counter = randomBytes(1)[0] & 0xff;
        seq = v7Counter;
        break;
      }
      // Same millisecond, or the clock stepped backwards: stay monotonic by
      // keeping the previous timestamp and advancing the counter instead.
      if (v7Counter < 0x0fff) {
        v7Counter += 1;
        seq = v7Counter;
        ms = v7LastMs;
        break;
      }
      // Counter exhausted inside one millisecond — wait for the clock to move.
      while (Date.now() <= v7LastMs) { /* spin, sub-millisecond */ }
    }

    var b = randomBytes(16);

    // unix_ts_ms — 48 bits, big endian.
    b[0] = Math.floor(ms / 1099511627776) & 0xff; // >> 40
    b[1] = Math.floor(ms / 4294967296) & 0xff;    // >> 32
    b[2] = (ms >>> 24) & 0xff;
    b[3] = (ms >>> 16) & 0xff;
    b[4] = (ms >>> 8) & 0xff;
    b[5] = ms & 0xff;

    b[6] = 0x70 | ((seq >> 8) & 0x0f); // version 7 + high 4 bits of rand_a
    b[7] = seq & 0xff;                 // low 8 bits of rand_a
    b[8] = (b[8] & 0x3f) | 0x80;       // variant 10xx, rest of b stays random

    return bytesToUuid(b);
  }

  /* ---- Version 1: Gregorian timestamp + clock sequence + node ------------- */

  var v1Node = null;         // 48-bit random node id (multicast bit set)
  var v1ClockSeq = 0;        // 14-bit clock sequence, stable for the session
  var v1LastMs = -1;
  var v1Fraction = 0;        // 0..9999 sub-millisecond 100-ns units
  var v1Offset = null;       // 100-ns intervals between 1582-10-15 and 1970-01-01

  function initV1() {
    var b = randomBytes(8);
    // RFC 9562 §6.10: when no IEEE 802 address is available, use random bits
    // and set the multicast (least significant) bit of the first octet so the
    // value can never be mistaken for a real, globally assigned MAC address.
    v1Node = [b[0] | 0x01, b[1], b[2], b[3], b[4], b[5]];
    v1ClockSeq = ((b[6] << 8) | b[7]) & 0x3fff;
    // Built with BigInt() rather than a literal so this file still parses on
    // engines without BigInt support (v1 is disabled there instead).
    v1Offset = BigInt('122192928000000000');
  }

  function generateV1() {
    if (!hasBigInt) { throw new Error('BIGINT_UNAVAILABLE'); }
    if (!v1Node) { initV1(); }

    var ms = Date.now();
    if (ms === v1LastMs) {
      v1Fraction += 1;
      if (v1Fraction > 9999) {
        while (Date.now() === ms) { /* spin until the clock advances */ }
        ms = Date.now();
        v1LastMs = ms;
        v1Fraction = 0;
      }
    } else if (ms < v1LastMs) {
      // Clock moved backwards — RFC 9562 §6.1 says to change the clock sequence.
      v1ClockSeq = (v1ClockSeq + 1) & 0x3fff;
      v1LastMs = ms;
      v1Fraction = 0;
    } else {
      v1LastMs = ms;
      v1Fraction = 0;
    }

    // 60-bit count of 100-nanosecond intervals since 1582-10-15 00:00:00 UTC.
    var ticks = (BigInt(ms) * BigInt(10000)) + BigInt(v1Fraction) + v1Offset;
    var hex = ticks.toString(16);
    while (hex.length < 15) { hex = '0' + hex; }
    hex = hex.slice(-15);

    var timeHigh = hex.slice(0, 3);
    var timeMid = hex.slice(3, 7);
    var timeLow = hex.slice(7, 15);

    var clockHi = (0x80 | (v1ClockSeq >> 8)) & 0xff; // variant 10xx
    var clockLo = v1ClockSeq & 0xff;

    var node = HEX[v1Node[0]] + HEX[v1Node[1]] + HEX[v1Node[2]] +
      HEX[v1Node[3]] + HEX[v1Node[4]] + HEX[v1Node[5]];

    return timeLow + '-' + timeMid + '-1' + timeHigh + '-' +
      HEX[clockHi] + HEX[clockLo] + '-' + node;
  }

  var GENERATORS = { v1: generateV1, v4: generateV4, v7: generateV7 };

  /**
   * Generates `count` UUIDs of `version`, guaranteeing the batch contains no
   * duplicates. A collision is astronomically unlikely, but if one appears the
   * value is simply drawn again.
   */
  function generateBatch(version, count) {
    var make = GENERATORS[version];
    if (!make) { throw new Error('UNSUPPORTED_VERSION'); }

    var seen = Object.create(null);
    var out = new Array(count);
    var attempts = 0;
    var i = 0;

    while (i < count) {
      var value = make();
      if (seen[value] === undefined) {
        seen[value] = 1;
        out[i] = value;
        i += 1;
      } else if ((attempts += 1) > count + 64) {
        throw new Error('DUPLICATE_LOOP');
      }
    }
    return out;
  }

  /* =========================================================================
   * 4. Output formatting
   * ====================================================================== */

  function formatUuid(canonical, opts) {
    var value = canonical;

    if (opts.wrapper === 'urn') {
      // RFC 9562 §4: the URN form always uses the hyphenated representation.
      if (opts.uppercase) { value = value.toUpperCase(); }
      return 'urn:uuid:' + value;
    }
    if (!opts.hyphens) { value = value.replace(/-/g, ''); }
    if (opts.uppercase) { value = value.toUpperCase(); }
    if (opts.wrapper === 'braces') { value = '{' + value + '}'; }
    return value;
  }

  /* =========================================================================
   * 5. Validation / inspection engine
   * ====================================================================== */

  var VERSION_NAMES = {
    1: 'Version 1 — Gregorian time-based',
    2: 'Version 2 — DCE Security',
    3: 'Version 3 — name-based (MD5)',
    4: 'Version 4 — random',
    5: 'Version 5 — name-based (SHA-1)',
    6: 'Version 6 — reordered Gregorian time',
    7: 'Version 7 — Unix epoch time',
    8: 'Version 8 — custom / vendor-defined'
  };

  var FORM_NAMES = {
    hyphenated: 'Hyphenated (8-4-4-4-12)',
    compact: 'Compact (32 hex digits, no hyphens)'
  };

  function variantOf(nibble) {
    if (nibble < 0x8) { return { label: 'NCS backward compatibility (variant 0)', rfc: false }; }
    if (nibble < 0xc) { return { label: 'RFC 9562 / RFC 4122 (variant 1)', rfc: true }; }
    if (nibble < 0xe) { return { label: 'Microsoft legacy GUID (variant 2)', rfc: false }; }
    return { label: 'Reserved for future definition (variant 3)', rfc: false };
  }

  function decodeTimestamp(hex, version) {
    try {
      if (version === 7) {
        var ms = parseInt(hex.slice(0, 12), 16);
        if (!isFinite(ms)) { return null; }
        return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', 'Z');
      }
      if ((version === 1 || version === 6) && hasBigInt) {
        var ticksHex = version === 1
          ? hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8)  // time_high|mid|low
          : hex.slice(0, 12) + hex.slice(13, 16);                   // already ordered
        var ticks = BigInt('0x' + ticksHex);
        var offset = BigInt('122192928000000000');
        if (ticks < offset) { return null; }
        var millis = Number((ticks - offset) / BigInt(10000));
        if (!isFinite(millis) || millis > 8640000000000000) { return null; }
        return new Date(millis).toISOString().replace('T', ' ').replace('.000Z', 'Z');
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  /**
   * Accepts the canonical hyphenated form, the compact 32-digit form, the
   * Microsoft brace form and the `urn:uuid:` form. Anything else is rejected
   * with a plain-language reason — length alone is never enough.
   */
  function inspectUuid(rawInput) {
    var input = String(rawInput == null ? '' : rawInput).trim();

    if (!input) {
      return { valid: false, reason: 'Enter a UUID to validate.' };
    }
    if (input.length > 200) {
      return { valid: false, reason: 'That string is far too long to be a UUID.' };
    }

    var wrapper = 'none';
    var body = input;

    if (/^urn:uuid:/i.test(body)) {
      wrapper = 'urn';
      body = body.slice(9);
    } else if (body.charAt(0) === '{' && body.charAt(body.length - 1) === '}') {
      wrapper = 'braces';
      body = body.slice(1, -1);
    } else if (body.charAt(0) === '{' || body.charAt(body.length - 1) === '}') {
      return { valid: false, reason: 'Unbalanced braces — a braced UUID must open with { and close with }.' };
    }
    body = body.trim();

    var form = null;
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(body)) {
      form = 'hyphenated';
    } else if (/^[0-9a-fA-F]{32}$/.test(body)) {
      form = 'compact';
    } else {
      return { valid: false, reason: diagnose(body) };
    }

    var hex = body.replace(/-/g, '').toLowerCase();
    var canonical = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) +
      '-' + hex.slice(16, 20) + '-' + hex.slice(20);

    var result = {
      valid: true,
      canonical: canonical,
      wrapper: wrapper,
      form: form,
      length: body.length,
      hexDigits: 32,
      bits: 128,
      special: null,
      versionNumber: null,
      versionLabel: '',
      variantLabel: '',
      timestamp: null
    };

    if (canonical === NIL_UUID) {
      result.special = 'nil';
      result.versionLabel = 'Nil UUID — all 128 bits are zero (RFC 9562 §5.9)';
      result.variantLabel = 'Not applicable to the Nil UUID';
      return result;
    }
    if (canonical === MAX_UUID) {
      result.special = 'max';
      result.versionLabel = 'Max UUID — all 128 bits are one (RFC 9562 §5.10)';
      result.variantLabel = 'Not applicable to the Max UUID';
      return result;
    }

    var variant = variantOf(parseInt(hex.charAt(16), 16));
    result.variantLabel = variant.label;

    var versionNibble = parseInt(hex.charAt(12), 16);
    if (variant.rfc) {
      result.versionNumber = versionNibble;
      result.versionLabel = VERSION_NAMES[versionNibble] ||
        ('Version ' + versionNibble + ' — not defined by RFC 9562');
      result.timestamp = decodeTimestamp(hex, versionNibble);
    } else {
      result.versionLabel = 'Version digit is ' + versionNibble +
        ', but the variant is not RFC 9562, so it carries no standard meaning';
    }

    return result;
  }

  /** Turns a rejected string into one specific, non-cryptic explanation. */
  function diagnose(body) {
    var stripped = body.replace(/-/g, '');
    var bad = stripped.match(/[^0-9a-fA-F]/g);

    if (bad) {
      var unique = [];
      for (var i = 0; i < bad.length && unique.length < 4; i += 1) {
        if (unique.indexOf(bad[i]) === -1) { unique.push(bad[i]); }
      }
      return 'A UUID may only contain the hexadecimal digits 0-9 and a-f. Found: ' +
        unique.map(function (c) { return '"' + c + '"'; }).join(', ') + '.';
    }
    if (stripped.length !== 32) {
      return 'A UUID holds exactly 32 hexadecimal digits — this one has ' + stripped.length + '.';
    }
    return 'The hyphens are misplaced. They must fall after the 8th, 13th, 18th and 23rd characters (8-4-4-4-12).';
  }

  /* =========================================================================
   * 6. Clipboard + download
   * ====================================================================== */

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, legacyCopy);
    }
    return Promise.resolve(legacyCopy());

    function legacyCopy() {
      try {
        var area = doc.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '0';
        area.style.left = '-9999px';
        doc.body.appendChild(area);
        area.select();
        var ok = doc.execCommand('copy');
        doc.body.removeChild(area);
        return !!ok;
      } catch (err) {
        return false;
      }
    }
  }

  function downloadFile(filename, contents, mime) {
    try {
      var blob = new Blob([contents], { type: mime });
      var url = URL.createObjectURL(blob);
      var link = doc.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      doc.body.appendChild(link);
      link.click();
      doc.body.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Keeps generated filenames to a known-safe character set. */
  function safeFilename(version, extension) {
    var slug = String(version).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'uuid';
    return 'uuid-' + slug + '-list.' + extension;
  }

  /* =========================================================================
   * 7. DOM references
   * ====================================================================== */

  var el = {
    versionSelect: byId('uuidVersion'),
    versionNote: byId('uuidVersionNote'),
    quantity: byId('uuidQuantity'),
    presets: byId('uuidPresets'),
    caseSelect: byId('uuidCase'),
    hyphens: byId('uuidHyphens'),
    wrapper: byId('uuidWrapper'),
    generate: byId('uuidGenerate'),
    clear: byId('uuidClear'),
    reset: byId('uuidReset'),
    status: byId('uuidStatus'),
    live: byId('uuidLive'),
    empty: byId('uuidEmpty'),
    outputPanel: byId('uuidOutputPanel'),
    outputWrap: byId('uuidOutputWrap'),
    tbody: byId('uuidRows'),
    resultCount: byId('uuidResultCount'),
    search: byId('uuidSearch'),
    searchRow: byId('uuidSearchRow'),
    searchCount: byId('uuidSearchCount'),
    copyAll: byId('uuidCopyAll'),
    downloadTxt: byId('uuidDownloadTxt'),
    downloadCsv: byId('uuidDownloadCsv'),
    warning: byId('uuidWarning'),
    historyList: byId('uuidHistory'),
    historyEmpty: byId('uuidHistoryEmpty'),
    historyClear: byId('uuidHistoryClear'),
    // validator
    validatorInput: byId('uuidValidatorInput'),
    validateBtn: byId('uuidValidateBtn'),
    validatorClear: byId('uuidValidatorClear'),
    validatorResult: byId('uuidValidatorResult'),
    validatorExamples: byId('uuidValidatorExamples'),
    // anatomy
    anatomyStrip: byId('uuidAnatomyStrip'),
    anatomyDetail: byId('uuidAnatomyDetail'),
    anatomySource: byId('uuidAnatomySource'),
    // specials
    nilValue: byId('uuidNilValue'),
    maxValue: byId('uuidMaxValue')
  };

  /* =========================================================================
   * 8. State
   * ====================================================================== */

  var DEFAULTS = { version: 'v4', quantity: 10, uppercase: false, hyphens: true, wrapper: 'none' };

  var state = {
    version: DEFAULTS.version,
    quantity: DEFAULTS.quantity,
    items: [],          // canonical lowercase hyphenated values
    itemVersion: 'v4'   // version the current batch was produced with
  };

  function readOptions() {
    return {
      uppercase: el.caseSelect ? el.caseSelect.value === 'upper' : false,
      hyphens: el.hyphens ? el.hyphens.checked : true,
      wrapper: el.wrapper ? el.wrapper.value : 'none'
    };
  }

  function formattedList() {
    var opts = readOptions();
    return state.items.map(function (value) { return formatUuid(value, opts); });
  }

  /* =========================================================================
   * 9. Status messages
   * ====================================================================== */

  var statusTimer = null;

  function setStatus(message, tone) {
    if (!el.status) { return; }
    el.status.textContent = message;
    el.status.dataset.tone = tone || 'info';
    el.status.hidden = !message;
  }

  function announce(message) {
    if (!el.live) { return; }
    // Re-set the text so repeat announcements are still read out.
    el.live.textContent = '';
    window.setTimeout(function () { el.live.textContent = message; }, 30);
  }

  /* ---- scrolling the fresh results into view ---------------------------- */

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** The site header is sticky, so anything scrolled to must clear it. */
  function headerOffset() {
    var bar = doc.querySelector('.site-header .navbar') || doc.querySelector('.site-header');
    var height = bar ? bar.getBoundingClientRect().height : 0;
    return Math.round(height) + 16;
  }

  /** Replays the arrival highlight on the output panel. */
  function flashOutput() {
    if (!el.outputPanel) { return; }
    el.outputPanel.classList.remove('is-fresh');
    void el.outputPanel.offsetWidth; // force a reflow so the animation restarts
    el.outputPanel.classList.add('is-fresh');
  }

  /**
   * Brings the generated list into view after a user-triggered generation.
   * Skipped when the list is already comfortably on screen, so repeated
   * clicks never yank a page that did not move.
   */
  function revealOutput() {
    if (!el.outputPanel) { return; }
    flashOutput();

    var rect = el.outputPanel.getBoundingClientRect();
    var offset = headerOffset();
    var alreadyVisible = rect.top >= offset && rect.top < window.innerHeight * 0.7;
    if (alreadyVisible) { return; }

    var target = Math.max(0, rect.top + (window.pageYOffset || doc.documentElement.scrollTop) - offset);
    try {
      window.scrollTo({ top: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (err) {
      window.scrollTo(0, target); // older browsers without the options object
    }
  }

  function flashButton(button, label) {
    if (!button) { return; }
    if (button.dataset.originalLabel === undefined) {
      button.dataset.originalLabel = button.textContent;
    }
    button.textContent = label;
    button.classList.add('is-copied');
    window.clearTimeout(Number(button.dataset.timer || 0));
    var timer = window.setTimeout(function () {
      button.textContent = button.dataset.originalLabel;
      button.classList.remove('is-copied');
    }, 1600);
    button.dataset.timer = String(timer);
  }

  /* =========================================================================
   * 10. Output rendering
   * ====================================================================== */

  var VERSION_BADGE = { v1: 'v1', v4: 'v4', v7: 'v7' };

  function renderOutput() {
    var opts = readOptions();
    var count = state.items.length;
    var hasItems = count > 0;

    if (el.empty) { el.empty.hidden = hasItems; }
    if (el.outputWrap) { el.outputWrap.hidden = !hasItems; }
    if (el.copyAll) { el.copyAll.disabled = !hasItems; }
    if (el.downloadTxt) { el.downloadTxt.disabled = !hasItems; }
    if (el.downloadCsv) { el.downloadCsv.disabled = !hasItems; }
    if (el.clear) { el.clear.disabled = !hasItems; }
    if (el.searchRow) { el.searchRow.hidden = count <= 20; }
    if (el.resultCount) {
      el.resultCount.textContent = hasItems
        ? count + (count === 1 ? ' identifier' : ' identifiers')
        : 'no identifiers yet';
    }

    if (!el.tbody) { return; }
    el.tbody.textContent = '';
    if (!hasItems) { return; }

    var badge = VERSION_BADGE[state.itemVersion] || state.itemVersion;
    var frag = doc.createDocumentFragment();
    var indexWidth = String(count).length;

    for (var i = 0; i < count; i += 1) {
      var display = formatUuid(state.items[i], opts);

      var row = doc.createElement('tr');
      row.className = 'ux-row';
      row.dataset.value = state.items[i];

      var idxCell = doc.createElement('td');
      idxCell.className = 'ux-row__idx';
      idxCell.textContent = String(i + 1).padStart(indexWidth, '0');

      var valueCell = doc.createElement('td');
      valueCell.className = 'ux-row__value';
      var code = doc.createElement('code');
      code.textContent = display;   // textContent only — never innerHTML
      valueCell.appendChild(code);

      var verCell = doc.createElement('td');
      verCell.className = 'ux-row__ver';
      var chip = doc.createElement('span');
      chip.className = 'ux-badge';
      chip.textContent = badge;
      verCell.appendChild(chip);

      var actionCell = doc.createElement('td');
      actionCell.className = 'ux-row__action';
      var copyBtn = doc.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'ux-btn ux-btn--ghost ux-btn--xs';
      copyBtn.textContent = 'Copy';
      copyBtn.setAttribute('data-copy-row', String(i));
      copyBtn.setAttribute('aria-label', 'Copy UUID ' + (i + 1) + ' of ' + count);
      actionCell.appendChild(copyBtn);

      row.appendChild(idxCell);
      row.appendChild(valueCell);
      row.appendChild(verCell);
      row.appendChild(actionCell);
      frag.appendChild(row);
    }

    el.tbody.appendChild(frag);
    applyFilter();
  }

  function applyFilter() {
    if (!el.tbody || !el.search) { return; }
    var term = el.search.value.trim().toLowerCase();
    var rows = el.tbody.children;
    var shown = 0;

    for (var i = 0; i < rows.length; i += 1) {
      var match = !term || rows[i].dataset.value.indexOf(term) !== -1;
      rows[i].hidden = !match;
      if (match) { shown += 1; }
    }

    if (el.searchCount) {
      el.searchCount.textContent = term
        ? shown + ' of ' + rows.length + ' shown'
        : rows.length + ' shown';
    }
  }

  /* =========================================================================
   * 11. Generation
   * ====================================================================== */

  function clampQuantity() {
    var raw = el.quantity ? parseInt(el.quantity.value, 10) : DEFAULTS.quantity;
    if (!isFinite(raw) || isNaN(raw)) { raw = DEFAULTS.quantity; }
    var clamped = Math.min(MAX_QTY, Math.max(MIN_QTY, Math.floor(raw)));
    if (el.quantity && String(clamped) !== el.quantity.value) {
      el.quantity.value = String(clamped);
    }
    return { value: clamped, adjusted: clamped !== raw };
  }

  function generate(options) {
    if (!hasRandomValues) { return; }
    // The batch produced on page load is not a user action: it is not recorded
    // in history and must never scroll the page away from the top.
    var initial = !!(options && options.initial === true);

    var qty = clampQuantity();
    var version = el.versionSelect ? el.versionSelect.value : DEFAULTS.version;

    if (!GENERATORS[version]) {
      setStatus('That UUID version is not available in this tool.', 'error');
      return;
    }

    var clock = (window.performance && typeof window.performance.now === 'function')
      ? function () { return window.performance.now(); }
      : Date.now;
    var started = clock();
    var batch;
    try {
      batch = generateBatch(version, qty.value);
    } catch (err) {
      setStatus(err && err.message === 'BIGINT_UNAVAILABLE'
        ? 'Your browser cannot generate version 1 UUIDs. Choose v4 or v7 instead.'
        : 'UUID generation failed in this browser. Try reloading the page.', 'error');
      return;
    }
    var elapsed = clock() - started;

    state.items = batch;
    state.itemVersion = version;
    state.version = version;
    state.quantity = qty.value;

    renderOutput();
    updateAnatomy(batch[0]);
    saveSettings();

    var label = qty.value === 1 ? '1 UUID generated' : qty.value + ' UUIDs generated';
    var timing = elapsed >= 0.5 ? ' · ' + (elapsed < 10 ? elapsed.toFixed(1) : Math.round(elapsed)) + ' ms' : '';
    setStatus('✓ ' + label + timing + (qty.adjusted ? ' · quantity adjusted to the 1–1000 range' : ''), 'success');
    announce(label);

    if (!initial) {
      pushHistory(version, qty.value);
      revealOutput();
    }
  }

  function clearOutput() {
    state.items = [];
    if (el.search) { el.search.value = ''; }
    renderOutput();
    setStatus('Output cleared. Your settings were kept.', 'info');
    announce('Output cleared');
  }

  function resetSettings() {
    if (el.versionSelect) { el.versionSelect.value = DEFAULTS.version; }
    if (el.quantity) { el.quantity.value = String(DEFAULTS.quantity); }
    if (el.caseSelect) { el.caseSelect.value = 'lower'; }
    if (el.hyphens) { el.hyphens.checked = DEFAULTS.hyphens; }
    if (el.wrapper) { el.wrapper.value = DEFAULTS.wrapper; }
    state.version = DEFAULTS.version;
    state.quantity = DEFAULTS.quantity;
    syncWrapperRules();
    updateVersionNote();
    renderOutput();
    updateAnatomy(state.items[0]);
    saveSettings();
    setStatus('Settings restored to their defaults (v4, 10 UUIDs, lowercase, hyphenated).', 'info');
    announce('Settings reset');
  }

  /* =========================================================================
   * 12. Version + format helpers
   * ====================================================================== */

  var VERSION_NOTES = {
    v1: 'Time-based. Encodes a 60-bit Gregorian timestamp, a 14-bit clock sequence and a 48-bit node ID. ' +
        'A browser cannot read your network hardware address, so the node ID here is random with the multicast bit set, ' +
        'exactly as RFC 9562 §6.10 prescribes for that case.',
    v4: 'Random. 122 of the 128 bits come from the browser CSPRNG (crypto.randomUUID or crypto.getRandomValues). ' +
        'The remaining 6 bits are the fixed version and variant markers. The default choice for general-purpose IDs.',
    v7: 'Time-ordered. Starts with a 48-bit Unix millisecond timestamp, then a 12-bit counter that keeps UUIDs generated ' +
        'inside the same millisecond strictly increasing, then 62 random bits. Sorts naturally, which is friendly to database indexes.'
  };

  function updateVersionNote() {
    if (!el.versionNote || !el.versionSelect) { return; }
    setText(el.versionNote, VERSION_NOTES[el.versionSelect.value] || '');
  }

  /** The URN form is defined only for the hyphenated representation. */
  function syncWrapperRules() {
    if (!el.wrapper || !el.hyphens) { return; }
    var isUrn = el.wrapper.value === 'urn';
    var field = el.hyphens.closest('.ux-check');
    el.hyphens.disabled = isUrn;
    if (field) { field.classList.toggle('is-locked', isUrn); }
    var hint = byId('uuidHyphenHint');
    if (hint) {
      hint.hidden = !isUrn;
    }
  }

  /* =========================================================================
   * 13. History (counts only — never the identifiers themselves)
   * ====================================================================== */

  function loadHistory() {
    try {
      var raw = window.localStorage.getItem(HISTORY_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
    } catch (err) {
      return [];
    }
  }

  function pushHistory(version, count) {
    var entries = loadHistory();
    entries.unshift({ v: version, n: count, t: Date.now() });
    entries = entries.slice(0, HISTORY_LIMIT);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch (err) { /* storage disabled or full — history is optional */ }
    renderHistory(entries);
  }

  function renderHistory(entries) {
    if (!el.historyList) { return; }
    var list = entries || loadHistory();
    el.historyList.textContent = '';

    if (el.historyEmpty) { el.historyEmpty.hidden = list.length > 0; }
    if (el.historyClear) { el.historyClear.disabled = list.length === 0; }

    list.forEach(function (entry) {
      var item = doc.createElement('li');
      var label = doc.createElement('span');
      label.className = 'ux-history__label';
      label.textContent = 'Generated ' + entry.n + ' × ' + (VERSION_BADGE[entry.v] || entry.v);
      var time = doc.createElement('time');
      time.className = 'ux-history__time';
      var when = new Date(entry.t);
      time.dateTime = when.toISOString();
      time.textContent = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.appendChild(label);
      item.appendChild(time);
      el.historyList.appendChild(item);
    });
  }

  function clearHistory() {
    try { window.localStorage.removeItem(HISTORY_KEY); } catch (err) { /* ignore */ }
    renderHistory([]);
    announce('History cleared');
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        version: el.versionSelect ? el.versionSelect.value : DEFAULTS.version,
        quantity: el.quantity ? el.quantity.value : DEFAULTS.quantity,
        uppercase: el.caseSelect ? el.caseSelect.value : 'lower',
        hyphens: el.hyphens ? el.hyphens.checked : true,
        wrapper: el.wrapper ? el.wrapper.value : 'none'
      }));
    } catch (err) { /* ignore */ }
  }

  function restoreSettings() {
    var saved;
    try {
      saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || 'null');
    } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') { return; }

    if (el.versionSelect && GENERATORS[saved.version]) { el.versionSelect.value = saved.version; }
    if (el.quantity && saved.quantity) { el.quantity.value = saved.quantity; }
    if (el.caseSelect && (saved.uppercase === 'upper' || saved.uppercase === 'lower')) {
      el.caseSelect.value = saved.uppercase;
    }
    if (el.hyphens && typeof saved.hyphens === 'boolean') { el.hyphens.checked = saved.hyphens; }
    if (el.wrapper && ['none', 'braces', 'urn'].indexOf(saved.wrapper) !== -1) { el.wrapper.value = saved.wrapper; }
  }

  /* =========================================================================
   * 14. Validator UI
   * ====================================================================== */

  function detailRow(term, value) {
    var wrap = doc.createElement('div');
    wrap.className = 'ux-detail';
    var dt = doc.createElement('dt');
    dt.textContent = term;
    var dd = doc.createElement('dd');
    dd.textContent = value;   // untrusted input never touches innerHTML
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    return wrap;
  }

  function runValidation() {
    if (!el.validatorResult || !el.validatorInput) { return; }
    var report = inspectUuid(el.validatorInput.value);
    var panel = el.validatorResult;

    panel.textContent = '';
    panel.hidden = false;
    panel.dataset.state = report.valid ? 'valid' : 'invalid';

    var head = doc.createElement('p');
    head.className = 'ux-verdict';
    head.textContent = report.valid ? '✓ Valid UUID' : '✕ Invalid UUID';
    panel.appendChild(head);

    if (!report.valid) {
      var why = doc.createElement('p');
      why.className = 'ux-verdict__why';
      why.textContent = report.reason;
      panel.appendChild(why);
      announce('Invalid UUID. ' + report.reason);
      return;
    }

    var list = doc.createElement('dl');
    list.className = 'ux-details';
    list.appendChild(detailRow('Status', 'Valid'));
    list.appendChild(detailRow('Version', report.versionLabel));
    list.appendChild(detailRow('Variant', report.variantLabel));
    list.appendChild(detailRow('Input format', FORM_NAMES[report.form] +
      (report.wrapper === 'braces' ? ' inside braces' : report.wrapper === 'urn' ? ' as a urn:uuid URN' : '')));
    list.appendChild(detailRow('Length', report.length + ' characters'));
    list.appendChild(detailRow('Hex digits', report.hexDigits + ' (' + report.bits + ' bits)'));
    if (report.timestamp) {
      list.appendChild(detailRow('Embedded timestamp (UTC)', report.timestamp));
    }
    list.appendChild(detailRow('Canonical form', report.canonical));
    panel.appendChild(list);

    var actions = doc.createElement('div');
    actions.className = 'ux-verdict__actions';

    var normalise = doc.createElement('button');
    normalise.type = 'button';
    normalise.className = 'ux-btn ux-btn--ghost ux-btn--sm';
    normalise.textContent = 'Normalize to canonical form';
    normalise.addEventListener('click', function () {
      el.validatorInput.value = report.canonical;
      runValidation();
      announce('Normalized to canonical form');
    });

    var copyCanonical = doc.createElement('button');
    copyCanonical.type = 'button';
    copyCanonical.className = 'ux-btn ux-btn--ghost ux-btn--sm';
    copyCanonical.textContent = 'Copy canonical';
    copyCanonical.addEventListener('click', function () {
      copyText(report.canonical).then(function (ok) {
        flashButton(copyCanonical, ok ? 'Copied ✓' : 'Copy failed');
        announce(ok ? 'Canonical UUID copied' : 'Copy failed');
      });
    });

    var inspect = doc.createElement('button');
    inspect.type = 'button';
    inspect.className = 'ux-btn ux-btn--ghost ux-btn--sm';
    inspect.textContent = 'Show in UUID anatomy';
    inspect.addEventListener('click', function () {
      updateAnatomy(report.canonical, 'validator');
      var target = byId('uuid-anatomy');
      if (target && target.scrollIntoView) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });

    actions.appendChild(normalise);
    actions.appendChild(copyCanonical);
    actions.appendChild(inspect);
    panel.appendChild(actions);

    announce('Valid UUID. ' + report.versionLabel);
  }

  function clearValidator() {
    if (el.validatorInput) { el.validatorInput.value = ''; }
    if (el.validatorResult) {
      el.validatorResult.hidden = true;
      el.validatorResult.textContent = '';
    }
  }

  /* =========================================================================
   * 15. Anatomy visualiser
   * ====================================================================== */

  var SAMPLE_UUID = '550e8400-e29b-41d4-a716-446655440000';

  var SEGMENT_INFO = {
    generic: {
      s1: ['Digits 1–8', 'The first 32 bits of the identifier.'],
      s2: ['Digits 9–12', 'The next 16 bits.'],
      s3: ['Digits 13–16', 'Starts with the 4-bit version field.'],
      s4: ['Digits 17–20', 'Starts with the variant field.'],
      s5: ['Digits 21–32', 'The final 48 bits.']
    },
    1: {
      s1: ['time_low — 32 bits', 'The low field of the 60-bit Gregorian timestamp, counted in 100-nanosecond intervals since 15 October 1582.'],
      s2: ['time_mid — 16 bits', 'The middle field of the same timestamp.'],
      s3: ['version + time_high — 4 + 12 bits', 'The leading digit is the version (1). The remaining 12 bits are the high field of the timestamp.'],
      s4: ['variant + clock_seq — 2 + 14 bits', 'The leading bits mark the RFC 9562 variant. The rest is the clock sequence, which changes if the clock is set backwards.'],
      s5: ['node — 48 bits', 'The node identifier. In a browser this is random with the multicast bit set, because no hardware address is available.']
    },
    4: {
      s1: ['random — 32 bits', 'Random bits straight from the browser CSPRNG.'],
      s2: ['random — 16 bits', 'More random bits.'],
      s3: ['version + random — 4 + 12 bits', 'The leading digit is fixed to 4. The other 12 bits are random.'],
      s4: ['variant + random — 2 + 14 bits', 'The two leading bits are the variant marker (so this digit is always 8, 9, a or b). The rest is random.'],
      s5: ['random — 48 bits', 'The last 48 random bits. 122 of the 128 bits in a v4 UUID are random.']
    },
    7: {
      s1: ['unix_ts_ms — high 32 bits', 'The upper half of the 48-bit Unix timestamp in milliseconds.'],
      s2: ['unix_ts_ms — low 16 bits', 'The lower half of the timestamp. Together these make v7 sort in creation order.'],
      s3: ['version + rand_a — 4 + 12 bits', 'The leading digit is fixed to 7. The 12 bits after it hold the monotonic counter that separates UUIDs created inside the same millisecond.'],
      s4: ['variant + rand_b — 2 + 14 bits', 'The variant marker followed by the first random bits of rand_b.'],
      s5: ['rand_b — 48 bits', 'The remaining random bits, 62 in total across this and the previous group.']
    }
  };

  var anatomyState = { uuid: SAMPLE_UUID, source: 'sample', segment: 's3' };

  function updateAnatomy(uuid, source) {
    if (uuid) {
      anatomyState.uuid = uuid;
      anatomyState.source = source || 'generated';
    }
    renderAnatomy();
  }

  function renderAnatomy() {
    if (!el.anatomyStrip) { return; }
    var uuid = anatomyState.uuid;
    var groups = uuid.split('-');
    if (groups.length !== 5) { return; }

    el.anatomyStrip.textContent = '';

    var versionNibble = parseInt(uuid.replace(/-/g, '').charAt(12), 16);
    var infoTable = SEGMENT_INFO[versionNibble] || SEGMENT_INFO.generic;

    groups.forEach(function (group, index) {
      if (index > 0) {
        var dash = doc.createElement('span');
        dash.className = 'ux-anatomy__dash';
        dash.textContent = '-';
        dash.setAttribute('aria-hidden', 'true');
        el.anatomyStrip.appendChild(dash);
      }
      var key = 's' + (index + 1);
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ux-anatomy__seg';
      button.dataset.seg = key;
      button.setAttribute('aria-pressed', String(anatomyState.segment === key));
      // The visible text is raw hex, so spell the field out for screen readers.
      button.setAttribute('aria-label', 'Group ' + (index + 1) + ', ' +
        ((infoTable[key] || SEGMENT_INFO.generic[key])[0]) + ': ' + group);

      if (index === 2 || index === 3) {
        var marker = doc.createElement('span');
        marker.className = 'ux-anatomy__marker';
        marker.textContent = group.charAt(0);
        marker.title = index === 2 ? 'Version digit' : 'Variant digit';
        button.appendChild(marker);
        button.appendChild(doc.createTextNode(group.slice(1)));
      } else {
        button.textContent = group;
      }
      el.anatomyStrip.appendChild(button);
    });

    if (el.anatomySource) {
      el.anatomySource.textContent = anatomyState.source === 'sample'
        ? 'Showing an example UUID — generate one above to inspect your own.'
        : anatomyState.source === 'validator'
          ? 'Showing the UUID from the validator.'
          : 'Showing the first UUID from your latest batch.';
    }

    renderAnatomyDetail();
  }

  function renderAnatomyDetail() {
    if (!el.anatomyDetail) { return; }
    var hex = anatomyState.uuid.replace(/-/g, '');
    var versionNibble = parseInt(hex.charAt(12), 16);
    var table = SEGMENT_INFO[versionNibble] || SEGMENT_INFO.generic;
    var info = table[anatomyState.segment] || SEGMENT_INFO.generic[anatomyState.segment];
    if (!info) { return; }

    el.anatomyDetail.textContent = '';

    var title = doc.createElement('h3');
    title.className = 'ux-anatomy__title';
    title.textContent = info[0];

    var body = doc.createElement('p');
    body.className = 'ux-anatomy__body';
    body.textContent = info[1];

    el.anatomyDetail.appendChild(title);
    el.anatomyDetail.appendChild(body);

    if (anatomyState.segment === 's3' || anatomyState.segment === 's4') {
      var extra = doc.createElement('p');
      extra.className = 'ux-anatomy__flag';
      extra.textContent = anatomyState.segment === 's3'
        ? 'Version digit in this UUID: ' + hex.charAt(12)
        : 'Variant digit in this UUID: ' + hex.charAt(16) + ' → ' + variantOf(parseInt(hex.charAt(16), 16)).label;
      el.anatomyDetail.appendChild(extra);
    }
  }

  /* =========================================================================
   * 16. Wiring
   * ====================================================================== */

  function bind() {
    if (el.generate) { el.generate.addEventListener('click', generate); }
    if (el.clear) { el.clear.addEventListener('click', clearOutput); }
    if (el.reset) { el.reset.addEventListener('click', resetSettings); }

    if (el.versionSelect) {
      el.versionSelect.addEventListener('change', function () {
        updateVersionNote();
        saveSettings();
      });
    }

    if (el.presets) {
      el.presets.addEventListener('click', function (event) {
        var button = event.target.closest('[data-qty]');
        if (!button || !el.quantity) { return; }
        el.quantity.value = button.dataset.qty;
        clampQuantity();
        markActivePreset();
        saveSettings();
      });
    }

    if (el.quantity) {
      el.quantity.addEventListener('input', markActivePreset);
      el.quantity.addEventListener('change', function () {
        clampQuantity();
        markActivePreset();
        saveSettings();
      });
    }

    [el.caseSelect, el.wrapper].forEach(function (control) {
      if (!control) { return; }
      control.addEventListener('change', function () {
        syncWrapperRules();
        renderOutput();
        saveSettings();
      });
    });

    if (el.hyphens) {
      el.hyphens.addEventListener('change', function () {
        renderOutput();
        saveSettings();
      });
    }

    if (el.tbody) {
      el.tbody.addEventListener('click', function (event) {
        var button = event.target.closest('[data-copy-row]');
        if (!button) { return; }
        var index = Number(button.getAttribute('data-copy-row'));
        var value = formatUuid(state.items[index], readOptions());
        copyText(value).then(function (ok) {
          flashButton(button, ok ? 'Copied ✓' : 'Failed');
          announce(ok ? 'UUID ' + (index + 1) + ' copied' : 'Copy failed');
        });
      });
    }

    if (el.copyAll) {
      el.copyAll.addEventListener('click', function () {
        if (!state.items.length) { return; }
        copyText(formattedList().join('\n')).then(function (ok) {
          flashButton(el.copyAll, ok ? 'Copied All ✓' : 'Copy failed');
          if (ok) {
            announce(state.items.length + ' UUIDs copied to the clipboard');
          } else {
            setStatus('The clipboard is blocked in this browser. Select the list and copy it manually.', 'error');
          }
        });
      });
    }

    if (el.downloadTxt) {
      el.downloadTxt.addEventListener('click', function () {
        if (!state.items.length) { return; }
        var ok = downloadFile(safeFilename(state.itemVersion, 'txt'),
          formattedList().join('\n') + '\n', 'text/plain;charset=utf-8');
        if (ok) {
          announce('TXT download started');
        } else {
          setStatus('The download could not start. Use Copy All instead.', 'error');
        }
      });
    }

    if (el.downloadCsv) {
      el.downloadCsv.addEventListener('click', function () {
        if (!state.items.length) { return; }
        var csv = 'uuid\n' + formattedList().join('\n') + '\n';
        var ok = downloadFile(safeFilename(state.itemVersion, 'csv'), csv, 'text/csv;charset=utf-8');
        if (ok) {
          announce('CSV download started');
        } else {
          setStatus('The download could not start. Use Copy All instead.', 'error');
        }
      });
    }

    if (el.search) {
      var frame = 0;
      el.search.addEventListener('input', function () {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(applyFilter);
      });
    }

    if (el.historyClear) { el.historyClear.addEventListener('click', clearHistory); }

    if (el.validateBtn) { el.validateBtn.addEventListener('click', runValidation); }
    if (el.validatorClear) { el.validatorClear.addEventListener('click', clearValidator); }
    if (el.validatorInput) {
      el.validatorInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          runValidation();
        } else if (event.key === 'Escape') {
          clearValidator();
        }
      });
    }
    if (el.validatorExamples) {
      el.validatorExamples.addEventListener('click', function (event) {
        var button = event.target.closest('[data-example]');
        if (!button || !el.validatorInput) { return; }
        el.validatorInput.value = button.dataset.example;
        runValidation();
        el.validatorInput.focus();
      });
    }

    if (el.anatomyStrip) {
      el.anatomyStrip.addEventListener('click', function (event) {
        var button = event.target.closest('[data-seg]');
        if (!button) { return; }
        anatomyState.segment = button.dataset.seg;
        Array.prototype.forEach.call(el.anatomyStrip.querySelectorAll('[data-seg]'), function (node) {
          node.setAttribute('aria-pressed', String(node === button));
        });
        renderAnatomyDetail();
      });
    }

    // Copy buttons on the fixed special identifiers (Nil / Max).
    Array.prototype.forEach.call(root.querySelectorAll('[data-copy-static]'), function (button) {
      button.addEventListener('click', function () {
        copyText(button.getAttribute('data-copy-static')).then(function (ok) {
          flashButton(button, ok ? 'Copied ✓' : 'Failed');
          announce(ok ? 'Copied' : 'Copy failed');
        });
      });
    });

    // Ctrl/Cmd + Enter generates from anywhere on the page.
    doc.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        var active = doc.activeElement;
        if (active === el.validatorInput) { return; }
        event.preventDefault();
        generate();
      }
    });
  }

  function markActivePreset() {
    if (!el.presets || !el.quantity) { return; }
    var current = el.quantity.value;
    Array.prototype.forEach.call(el.presets.querySelectorAll('[data-qty]'), function (button) {
      var active = button.dataset.qty === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  /* =========================================================================
   * 17. Boot
   * ====================================================================== */

  function disableGeneration(message) {
    if (el.warning) {
      el.warning.textContent = message;
      el.warning.hidden = false;
    }
    [el.generate, el.copyAll, el.downloadTxt, el.downloadCsv].forEach(function (button) {
      if (button) { button.disabled = true; }
    });
    if (el.versionSelect) { el.versionSelect.disabled = true; }
    if (el.quantity) { el.quantity.disabled = true; }
  }

  function init() {
    setText(el.nilValue, NIL_UUID);
    setText(el.maxValue, MAX_UUID);

    if (!hasRandomValues) {
      disableGeneration('Your browser does not provide the required secure random number API (crypto.getRandomValues), ' +
        'so this tool will not generate UUIDs. Validation and the reference sections still work.');
      renderOutput();
      renderAnatomy();
      renderHistory();
      bind();
      return;
    }

    if (!hasBigInt && el.versionSelect) {
      // v1 needs 64-bit arithmetic; hide it rather than emit a wrong value.
      var v1Option = el.versionSelect.querySelector('option[value="v1"]');
      if (v1Option) {
        v1Option.disabled = true;
        v1Option.textContent += ' — unsupported in this browser';
        if (el.versionSelect.value === 'v1') { el.versionSelect.value = 'v4'; }
      }
    }

    restoreSettings();
    clampQuantity();
    markActivePreset();
    syncWrapperRules();
    updateVersionNote();
    renderHistory();
    renderAnatomy();
    bind();

    // Generate a first batch so the tool is useful the moment the page loads.
    // Not recorded in history and not scrolled to — the visitor did not ask for it.
    generate({ initial: true });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
