/* ============================================================
   ToolAdda — Hash Generator (MD5 · SHA-1 · SHA-256 · SHA-512)

   Everything runs locally. No input, file or digest is ever
   transmitted anywhere.

   Layout of this file:
     1.  Configuration
     2.  Byte / hex utilities
     3.  MD5 engine (incremental, RFC 1321)
     4.  Web Crypto SHA engine
     5.  Known-answer test vectors
     6.  Hashing facade (text + file)
     7.  Comparison helpers
     8.  Application state
     9.  DOM cache
     10. Rendering
     11. Text input
     12. File input
     13. Generation pipeline
     14. Clipboard
     15. Download
     16. Local history
     17. Compare panel
     18. Self-test panel
     19. Keyboard + init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ---------------------------------------------------------
     1. CONFIGURATION
     --------------------------------------------------------- */

  var ALGOS = [
    {
      id: 'md5',
      label: 'MD5',
      subtle: null,
      bits: 128,
      hexLength: 32,
      status: 'legacy',
      blurb: '128-bit legacy hash. Not recommended for collision-resistant security applications.'
    },
    {
      id: 'sha1',
      label: 'SHA-1',
      subtle: 'SHA-1',
      bits: 160,
      hexLength: 40,
      status: 'legacy',
      blurb: '160-bit legacy hash. Deprecated for many security applications.'
    },
    {
      id: 'sha256',
      label: 'SHA-256',
      subtle: 'SHA-256',
      bits: 256,
      hexLength: 64,
      status: 'modern',
      blurb: '256-bit SHA-2 hash commonly used for modern integrity and security applications.'
    },
    {
      id: 'sha512',
      label: 'SHA-512',
      subtle: 'SHA-512',
      bits: 512,
      hexLength: 128,
      status: 'modern',
      blurb: '512-bit SHA-2 hash providing a larger digest than SHA-256.'
    }
  ];

  var ALGO_BY_ID = {};
  ALGOS.forEach(function (a) { ALGO_BY_ID[a.id] = a; });

  var HEX_LENGTH_HINTS = {
    32: 'MD5',
    40: 'SHA-1',
    64: 'SHA-256',
    128: 'SHA-512'
  };

  var CHUNK_SIZE = 4 * 1024 * 1024;          // 4 MB read window
  var LARGE_FILE_WARN = 100 * 1024 * 1024;   // advisory threshold
  var STORE_PREFS = 'tooladda-hash-prefs-v1';
  var STORE_HISTORY = 'tooladda-hash-history-v1';
  var HISTORY_LIMIT = 25;

  /* ---------------------------------------------------------
     2. BYTE / HEX UTILITIES
     --------------------------------------------------------- */

  var HEX_TABLE = [];
  for (var hi = 0; hi < 256; hi += 1) {
    HEX_TABLE.push((hi < 16 ? '0' : '') + hi.toString(16));
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 1) out += HEX_TABLE[bytes[i]];
    return out;
  }

  function encodeUtf8(text) {
    return new TextEncoder().encode(text);
  }

  /* ---------------------------------------------------------
     3. MD5 ENGINE — incremental, RFC 1321
     Web Crypto does not expose MD5, so it is implemented here.
     Operates on raw bytes so binary files hash correctly.
     --------------------------------------------------------- */

  var MD5_SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  var MD5_K = new Uint32Array(64);
  for (var ki = 0; ki < 64; ki += 1) {
    MD5_K[ki] = Math.floor(Math.abs(Math.sin(ki + 1)) * 4294967296);
  }

  function Md5() {
    this.state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    this.words = new Uint32Array(16);
    this.tail = new Uint8Array(64);
    this.tailLength = 0;
    this.byteCount = 0;
    this.done = false;
    this.result = null;
  }

  Md5.prototype._block = function (input, offset) {
    var words = this.words;
    var i;
    var j = offset;
    for (i = 0; i < 16; i += 1, j += 4) {
      words[i] = input[j] | (input[j + 1] << 8) | (input[j + 2] << 16) | (input[j + 3] << 24);
    }

    var a = this.state[0];
    var b = this.state[1];
    var c = this.state[2];
    var d = this.state[3];

    for (i = 0; i < 64; i += 1) {
      var f;
      var g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }

      f = (f + a + MD5_K[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      var s = MD5_SHIFTS[i];
      b = (b + ((f << s) | (f >>> (32 - s)))) >>> 0;
    }

    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
  };

  Md5.prototype.update = function (chunk) {
    if (this.done) throw new Error('MD5: update() called after digest()');
    var bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    var length = bytes.length;
    this.byteCount += length;

    var index = 0;
    if (this.tailLength > 0) {
      var take = Math.min(64 - this.tailLength, length);
      this.tail.set(bytes.subarray(0, take), this.tailLength);
      this.tailLength += take;
      index = take;
      if (this.tailLength === 64) {
        this._block(this.tail, 0);
        this.tailLength = 0;
      }
    }

    while (index + 64 <= length) {
      this._block(bytes, index);
      index += 64;
    }

    if (index < length) {
      this.tail.set(bytes.subarray(index), 0);
      this.tailLength = length - index;
    }

    return this;
  };

  Md5.prototype.digest = function () {
    if (this.done) return this.result;

    var total = this.byteCount;
    var bitsLow = (total * 8) >>> 0;
    var bitsHigh = Math.floor(total / 536870912) >>> 0; // total * 8 / 2^32

    var padLength = this.tailLength < 56 ? 56 - this.tailLength : 120 - this.tailLength;
    var suffix = new Uint8Array(padLength + 8);
    suffix[0] = 0x80;
    suffix[padLength] = bitsLow & 0xff;
    suffix[padLength + 1] = (bitsLow >>> 8) & 0xff;
    suffix[padLength + 2] = (bitsLow >>> 16) & 0xff;
    suffix[padLength + 3] = (bitsLow >>> 24) & 0xff;
    suffix[padLength + 4] = bitsHigh & 0xff;
    suffix[padLength + 5] = (bitsHigh >>> 8) & 0xff;
    suffix[padLength + 6] = (bitsHigh >>> 16) & 0xff;
    suffix[padLength + 7] = (bitsHigh >>> 24) & 0xff;
    this.update(suffix);

    var out = new Uint8Array(16);
    for (var i = 0; i < 4; i += 1) {
      var v = this.state[i];
      out[i * 4] = v & 0xff;
      out[i * 4 + 1] = (v >>> 8) & 0xff;
      out[i * 4 + 2] = (v >>> 16) & 0xff;
      out[i * 4 + 3] = (v >>> 24) & 0xff;
    }

    this.done = true;
    this.result = out;
    return out;
  };

  function md5Hex(bytes) {
    return bytesToHex(new Md5().update(bytes).digest());
  }

  /* ---------------------------------------------------------
     4. WEB CRYPTO SHA ENGINE
     SHA-1 / SHA-256 / SHA-512 come from the browser's audited
     implementation — never hand-rolled here.
     --------------------------------------------------------- */

  function getSubtle() {
    var c = globalScope && globalScope.crypto;
    return c && c.subtle ? c.subtle : null;
  }

  function shaSupported() {
    return getSubtle() !== null;
  }

  function shaHex(subtleName, bytes) {
    var subtle = getSubtle();
    if (!subtle) {
      return Promise.reject(new Error('WEB_CRYPTO_UNAVAILABLE'));
    }
    return Promise.resolve(subtle.digest(subtleName, bytes)).then(function (buffer) {
      return bytesToHex(new Uint8Array(buffer));
    });
  }

  /* ---------------------------------------------------------
     5. KNOWN-ANSWER TEST VECTORS
     Published values from RFC 1321, RFC 3174 and FIPS 180-4.
     --------------------------------------------------------- */

  var TEST_VECTORS = [
    {
      name: 'Empty string',
      input: '',
      expected: {
        md5: 'd41d8cd98f00b204e9800998ecf8427e',
        sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sha512: 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce'
          + '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e'
      }
    },
    {
      name: '"abc"',
      input: 'abc',
      expected: {
        md5: '900150983cd24fb0d6963f7d28e17f72',
        sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        sha512: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a'
          + '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
      }
    },
    {
      name: '"message digest"',
      input: 'message digest',
      expected: { md5: 'f96b697d7cb7938d525a2f31aaf161d0' }
    },
    {
      name: 'Lowercase alphabet',
      input: 'abcdefghijklmnopqrstuvwxyz',
      expected: { md5: 'c3fcd3d76192e4007dfb496cca67e13b' }
    },
    {
      name: 'Pangram',
      input: 'The quick brown fox jumps over the lazy dog',
      expected: {
        md5: '9e107d9d372bb6826bd81d3542a419d6',
        sha1: '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'
      }
    },
    {
      name: 'Multi-block digits (80 bytes)',
      input: '1234567890123456789012345678901234567890'
        + '1234567890123456789012345678901234567890',
      expected: { md5: '57edf4a22be3c955ac49da2e2107b67a' }
    }
  ];

  function verifyMd5Engine() {
    try {
      for (var i = 0; i < TEST_VECTORS.length; i += 1) {
        var vector = TEST_VECTORS[i];
        if (!vector.expected.md5) continue;
        if (md5Hex(encodeUtf8(vector.input)) !== vector.expected.md5) return false;
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------------------------------------------------------
     6. HASHING FACADE
     --------------------------------------------------------- */

  function nextTick() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /**
   * Hash an in-memory byte array with the requested algorithms.
   * Returns { md5: '…', sha256: '…' } keyed by algorithm id.
   */
  function hashBytes(bytes, ids) {
    var results = {};
    var chain = Promise.resolve();

    ids.forEach(function (id) {
      var algo = ALGO_BY_ID[id];
      if (!algo) return;
      chain = chain.then(function () {
        if (!algo.subtle) {
          results[id] = md5Hex(bytes);
          return null;
        }
        return shaHex(algo.subtle, bytes).then(function (hex) {
          results[id] = hex;
        });
      });
    });

    return chain.then(function () { return results; });
  }

  /**
   * Hash a File/Blob. The file is read in chunks so progress can be
   * reported and the UI thread stays responsive. Nothing is uploaded.
   */
  function hashFile(file, ids, onProgress) {
    var wantsSha = ids.some(function (id) { return Boolean(ALGO_BY_ID[id] && ALGO_BY_ID[id].subtle); });
    var wantsMd5 = ids.indexOf('md5') !== -1;
    var total = file.size;
    var readWeight = wantsSha ? 0.6 : 1;

    var md5 = wantsMd5 ? new Md5() : null;
    var whole = null;

    if (wantsSha) {
      try {
        whole = new Uint8Array(total);
      } catch (err) {
        return Promise.reject(new Error('FILE_TOO_LARGE'));
      }
    }

    var offset = 0;

    function readNext() {
      if (offset >= total) return Promise.resolve();
      var slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, total));
      return Promise.resolve(slice.arrayBuffer()).then(function (buffer) {
        var view = new Uint8Array(buffer);
        if (md5) md5.update(view);
        if (whole) whole.set(view, offset);
        offset += view.length;
        if (onProgress) {
          onProgress((offset / total) * readWeight, 'Reading file');
        }
        return nextTick().then(readNext);
      });
    }

    return readNext().then(function () {
      var results = {};
      if (md5) results.md5 = bytesToHex(md5.digest());

      var shaIds = ids.filter(function (id) { return ALGO_BY_ID[id] && ALGO_BY_ID[id].subtle; });
      if (!shaIds.length) {
        if (onProgress) onProgress(1, 'Done');
        return results;
      }

      var step = (1 - readWeight) / shaIds.length;
      var chain = Promise.resolve();
      shaIds.forEach(function (id, index) {
        chain = chain.then(function () {
          var algo = ALGO_BY_ID[id];
          if (onProgress) {
            onProgress(readWeight + step * index, 'Calculating ' + algo.label);
          }
          return nextTick()
            .then(function () { return shaHex(algo.subtle, whole); })
            .then(function (hex) { results[id] = hex; });
        });
      });

      return chain.then(function () {
        if (onProgress) onProgress(1, 'Done');
        return results;
      });
    });
  }

  /* ---------------------------------------------------------
     7. COMPARISON HELPERS
     --------------------------------------------------------- */

  var HEX_ONLY = /^[0-9a-fA-F]+$/;
  var CHECKSUM_LINE = /^([0-9a-fA-F]{32,128})[ \t]+\*?(\S.*)$/;

  function isHex(value) {
    return HEX_ONLY.test(value);
  }

  /**
   * Length-independent equality over the digest characters.
   * Intended for local verification, not for authenticating secrets.
   */
  function digestsEqual(left, right) {
    var a = left.toLowerCase();
    var b = right.toLowerCase();
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i += 1) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  function possibleAlgorithm(hex) {
    return HEX_LENGTH_HINTS[hex.length] || null;
  }

  /* ------------------------------------------------------------------
     Everything below drives the page. Skipped when loaded under Node.
     ------------------------------------------------------------------ */

  var engine = {
    ALGOS: ALGOS,
    Md5: Md5,
    md5Hex: md5Hex,
    shaHex: shaHex,
    hashBytes: hashBytes,
    hashFile: hashFile,
    bytesToHex: bytesToHex,
    encodeUtf8: encodeUtf8,
    isHex: isHex,
    digestsEqual: digestsEqual,
    possibleAlgorithm: possibleAlgorithm,
    verifyMd5Engine: verifyMd5Engine,
    TEST_VECTORS: TEST_VECTORS
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = engine;
  }
  if (globalScope) {
    globalScope.ToolAddaHash = engine;
  }

  if (typeof document === 'undefined') return;

  /* ---------------------------------------------------------
     8. APPLICATION STATE
     --------------------------------------------------------- */

  var state = {
    mode: 'text',
    selected: ['sha256'],
    letterCase: 'lower',
    text: '',
    file: null,
    digests: null,
    digestSource: null,       // { type, label, byteLength, fileType }
    expected: {},             // per-algorithm expected hash typed by the user
    running: false,
    runToken: 0,
    md5Healthy: true,
    historyEnabled: false,
    includeInputInJson: false
  };

  var el = {};
  var cards = {};
  var debounceTimer = null;

  /* ---------------------------------------------------------
     9. DOM CACHE
     --------------------------------------------------------- */

  function pick(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function pickAll(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function cacheDom() {
    el.app = pick('[data-hx-app]');
    if (!el.app) return false;

    el.tabs = pickAll('[data-hx-tab]');
    el.panels = pickAll('[data-hx-panel]');
    el.text = pick('#hxText');
    el.textMeta = pick('[data-hx-textmeta]');
    el.textClear = pick('[data-hx-text-clear]');
    el.sample = pick('[data-hx-sample]');

    el.drop = pick('[data-hx-drop]');
    el.fileInput = pick('#hxFileInput');
    el.browse = pickAll('[data-hx-browse]');
    el.fileInfo = pick('[data-hx-file-info]');
    el.fileName = pick('[data-hx-file-name]');
    el.fileMeta = pick('[data-hx-file-meta]');
    el.fileRemove = pick('[data-hx-file-remove]');
    el.fileWarning = pick('[data-hx-file-warning]');

    el.algoInputs = pickAll('[data-hx-algo]');
    el.selectAll = pick('[data-hx-select-all]');
    el.clearAlgos = pick('[data-hx-clear-algos]');
    el.algoError = pick('[data-hx-algo-error]');

    el.caseButtons = pickAll('[data-hx-case]');
    el.generate = pick('[data-hx-generate]');
    el.clearAll = pick('[data-hx-clear]');

    el.results = pick('[data-hx-results]');
    el.empty = pick('[data-hx-empty]');
    el.progress = pick('[data-hx-progress]');
    el.progressBar = pick('[data-hx-progress-bar]');
    el.progressText = pick('[data-hx-progress-text]');
    el.resultActions = pick('[data-hx-result-actions]');
    el.sourceLine = pick('[data-hx-source]');
    el.copyAll = pick('[data-hx-copy-all]');
    el.downloadTxt = pick('[data-hx-download-txt]');
    el.downloadJson = pick('[data-hx-download-json]');
    el.includeInput = pick('[data-hx-include-input]');
    el.status = pick('[data-hx-status]');
    el.errorBox = pick('[data-hx-error]');
    el.cryptoWarning = pick('[data-hx-crypto-warning]');

    el.compareA = pick('#hxCompareA');
    el.compareB = pick('#hxCompareB');
    el.compareAlgo = pick('#hxCompareAlgo');
    el.compareRun = pick('[data-hx-compare-run]');
    el.compareSwap = pick('[data-hx-compare-swap]');
    el.compareClear = pick('[data-hx-compare-clear]');
    el.compareOut = pick('[data-hx-compare-out]');
    el.compareHintA = pick('[data-hx-hint="a"]');
    el.compareHintB = pick('[data-hx-hint="b"]');

    el.historyToggle = pick('[data-hx-history-toggle]');
    el.historyList = pick('[data-hx-history-list]');
    el.historyClear = pick('[data-hx-history-clear]');
    el.historyEmpty = pick('[data-hx-history-empty]');

    el.selfTestRun = pick('[data-hx-selftest-run]');
    el.selfTestOut = pick('[data-hx-selftest-out]');

    return true;
  }

  /* ---------------------------------------------------------
     10. RENDERING
     --------------------------------------------------------- */

  function announce(message) {
    if (el.status) el.status.textContent = message;
  }

  function showError(message) {
    if (!el.errorBox) return;
    if (!message) {
      el.errorBox.hidden = true;
      el.errorBox.textContent = '';
      return;
    }
    el.errorBox.hidden = false;
    el.errorBox.textContent = message;
    announce(message);
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    var value = bytes / Math.pow(1024, power);
    var decimals = power === 0 ? 0 : (value < 10 ? 2 : 1);
    return value.toFixed(decimals) + ' ' + units[power];
  }

  function formatCase(hex) {
    return state.letterCase === 'upper' ? hex.toUpperCase() : hex;
  }

  function buildCard(algo) {
    var card = document.createElement('article');
    card.className = 'hx-card';
    card.setAttribute('data-algo', algo.id);
    card.hidden = true;

    var head = document.createElement('div');
    head.className = 'hx-card__head';

    var identity = document.createElement('div');
    identity.className = 'hx-card__identity';

    var name = document.createElement('h3');
    name.className = 'hx-card__name';
    name.textContent = algo.label;

    var spec = document.createElement('p');
    spec.className = 'hx-card__spec';
    spec.textContent = algo.bits + '-bit · ' + algo.hexLength + ' hex characters';

    identity.appendChild(name);
    identity.appendChild(spec);

    var badge = document.createElement('span');
    badge.className = 'hx-badge hx-badge--' + algo.status;
    badge.textContent = algo.status === 'legacy' ? 'Legacy' : 'Modern';
    badge.title = algo.blurb;

    head.appendChild(identity);
    head.appendChild(badge);

    var readout = document.createElement('div');
    readout.className = 'hx-readout';

    var digest = document.createElement('code');
    digest.className = 'hx-digest';
    digest.setAttribute('tabindex', '0');
    digest.setAttribute('aria-label', algo.label + ' digest');
    readout.appendChild(digest);

    var actions = document.createElement('div');
    actions.className = 'hx-card__actions';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'hx-btn hx-btn--ghost hx-btn--sm';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy ' + algo.label + ' hash');
    copyBtn.addEventListener('click', function () {
      var value = state.digests && state.digests[algo.id];
      if (!value) return;
      copyText(formatCase(value), copyBtn, algo.label + ' hash copied');
    });

    var verifyBtn = document.createElement('button');
    verifyBtn.type = 'button';
    verifyBtn.className = 'hx-btn hx-btn--ghost hx-btn--sm';
    verifyBtn.textContent = 'Verify';
    verifyBtn.setAttribute('aria-expanded', 'false');
    verifyBtn.setAttribute('aria-controls', 'hx-verify-' + algo.id);
    verifyBtn.setAttribute('aria-label', 'Verify ' + algo.label + ' hash against an expected value');

    actions.appendChild(copyBtn);
    actions.appendChild(verifyBtn);

    var verify = document.createElement('div');
    verify.className = 'hx-verify';
    verify.id = 'hx-verify-' + algo.id;
    verify.hidden = true;

    var verifyLabel = document.createElement('label');
    verifyLabel.className = 'hx-label';
    verifyLabel.setAttribute('for', 'hx-expected-' + algo.id);
    verifyLabel.textContent = 'Expected ' + algo.label + ' hash';

    var verifyInput = document.createElement('input');
    verifyInput.type = 'text';
    verifyInput.id = 'hx-expected-' + algo.id;
    verifyInput.className = 'hx-input hx-input--mono';
    verifyInput.setAttribute('spellcheck', 'false');
    verifyInput.setAttribute('autocomplete', 'off');
    verifyInput.setAttribute('placeholder', algo.hexLength + ' hexadecimal characters');

    var verifyOut = document.createElement('p');
    verifyOut.className = 'hx-verify__out';
    verifyOut.setAttribute('role', 'status');

    verifyInput.addEventListener('input', function () {
      state.expected[algo.id] = verifyInput.value;
      renderVerify(algo, verifyInput, verifyOut);
    });

    verifyBtn.addEventListener('click', function () {
      var open = verify.hidden;
      verify.hidden = !open;
      verifyBtn.setAttribute('aria-expanded', String(open));
      verifyBtn.classList.toggle('is-active', open);
      if (open) verifyInput.focus();
    });

    verify.appendChild(verifyLabel);
    verify.appendChild(verifyInput);
    verify.appendChild(verifyOut);

    card.appendChild(head);
    card.appendChild(readout);
    card.appendChild(actions);
    card.appendChild(verify);

    cards[algo.id] = {
      root: card,
      digest: digest,
      verifyInput: verifyInput,
      verifyOut: verifyOut,
      copyBtn: copyBtn
    };

    return card;
  }

  function renderVerify(algo, input, out) {
    var raw = input.value;
    var trimmed = raw.trim();
    out.className = 'hx-verify__out';

    if (!trimmed) {
      out.textContent = '';
      return;
    }

    var match = CHECKSUM_LINE.exec(trimmed);
    if (match) {
      input.value = match[1];
      state.expected[algo.id] = match[1];
      trimmed = match[1];
    }

    if (!isHex(trimmed)) {
      out.classList.add('is-invalid');
      out.textContent = 'The expected hash contains invalid characters. Only 0-9 and a-f are allowed.';
      return;
    }

    if (trimmed.length !== algo.hexLength) {
      out.classList.add('is-invalid');
      out.textContent = 'A ' + algo.label + ' hash is ' + algo.hexLength + ' hex characters — this one has '
        + trimmed.length + '.';
      return;
    }

    var actual = state.digests && state.digests[algo.id];
    if (!actual) {
      out.textContent = 'Generate a ' + algo.label + ' hash to compare against this value.';
      return;
    }

    if (digestsEqual(trimmed, actual)) {
      out.classList.add('is-match');
      out.textContent = '✓ Match — the generated ' + algo.label + ' hash is identical.';
    } else {
      out.classList.add('is-mismatch');
      out.textContent = '✕ No match — the generated ' + algo.label + ' hash is different.';
    }
  }

  function renderCards() {
    ALGOS.forEach(function (algo) {
      var card = cards[algo.id];
      if (!card) return;
      var chosen = state.selected.indexOf(algo.id) !== -1;
      var value = state.digests ? state.digests[algo.id] : null;
      card.root.hidden = !(chosen && value);
      if (value) {
        card.digest.textContent = formatCase(value);
        renderVerify(algo, card.verifyInput, card.verifyOut);
      }
    });

    var hasAny = Boolean(state.digests && Object.keys(state.digests).length);
    if (el.empty) el.empty.hidden = hasAny;
    if (el.resultActions) el.resultActions.hidden = !hasAny;
    if (el.sourceLine) el.sourceLine.hidden = !hasAny;
  }

  function renderSource() {
    if (!el.sourceLine || !state.digestSource) return;
    var source = state.digestSource;
    if (source.type === 'file') {
      el.sourceLine.textContent = 'Source: file — ' + source.label + ' · ' + formatBytes(source.byteLength);
    } else {
      el.sourceLine.textContent = 'Source: text — ' + source.byteLength.toLocaleString()
        + ' bytes (UTF-8)';
    }
  }

  function renderAlgoSelection() {
    el.algoInputs.forEach(function (input) {
      var id = input.getAttribute('data-hx-algo');
      input.checked = state.selected.indexOf(id) !== -1;
      var chip = input.closest('.hx-algo');
      if (chip) chip.classList.toggle('is-selected', input.checked);
    });
    if (el.algoError) el.algoError.hidden = state.selected.length > 0;
  }

  function renderCase() {
    el.caseButtons.forEach(function (button) {
      var active = button.getAttribute('data-hx-case') === state.letterCase;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderMode() {
    el.tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-hx-tab') === state.mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });
    el.panels.forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-hx-panel') !== state.mode;
    });
    if (el.includeInput) {
      var wrapper = el.includeInput.closest('.hx-check');
      if (wrapper) wrapper.hidden = state.mode !== 'text';
    }
  }

  function setProgress(fraction, label) {
    if (!el.progress) return;
    var percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    el.progress.hidden = false;
    el.progress.setAttribute('aria-valuenow', String(percent));
    el.progressBar.style.width = percent + '%';
    el.progressText.textContent = label + ' — ' + percent + '%';
  }

  function hideProgress() {
    if (!el.progress) return;
    el.progress.hidden = true;
    el.progressBar.style.width = '0%';
  }

  /* ---------------------------------------------------------
     11. TEXT INPUT
     --------------------------------------------------------- */

  function updateTextMeta() {
    if (!el.textMeta) return;
    var value = el.text.value;
    var bytes = encodeUtf8(value).length;
    var chars = Array.from(value).length;
    el.textMeta.textContent = chars.toLocaleString() + ' characters · '
      + bytes.toLocaleString() + ' bytes (UTF-8)';
  }

  function onTextInput() {
    state.text = el.text.value;
    updateTextMeta();
    showError('');
    window.clearTimeout(debounceTimer);
    if (!state.text || !state.selected.length) {
      if (!state.text) resetResults();
      return;
    }
    debounceTimer = window.setTimeout(function () { generate(false); }, 200);
  }

  /* ---------------------------------------------------------
     12. FILE INPUT
     --------------------------------------------------------- */

  function setFile(file) {
    state.file = file || null;
    resetResults();
    showError('');

    if (!file) {
      el.fileInfo.hidden = true;
      el.drop.hidden = false;
      if (el.fileWarning) el.fileWarning.hidden = true;
      return;
    }

    el.drop.hidden = true;
    el.fileInfo.hidden = false;
    el.fileName.textContent = file.name;
    el.fileMeta.textContent = formatBytes(file.size)
      + ' · ' + (file.type || 'unknown type');

    if (el.fileWarning) {
      el.fileWarning.hidden = file.size < LARGE_FILE_WARN;
    }
    announce('Selected file ' + file.name + ', ' + formatBytes(file.size));
  }

  function bindDropZone() {
    if (!el.drop) return;

    ['dragenter', 'dragover'].forEach(function (type) {
      el.drop.addEventListener(type, function (event) {
        event.preventDefault();
        el.drop.classList.add('is-over');
      });
    });

    ['dragleave', 'dragend'].forEach(function (type) {
      el.drop.addEventListener(type, function () {
        el.drop.classList.remove('is-over');
      });
    });

    el.drop.addEventListener('drop', function (event) {
      event.preventDefault();
      el.drop.classList.remove('is-over');
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) setFile(files[0]);
    });

    el.drop.addEventListener('click', function () { el.fileInput.click(); });
    el.drop.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        el.fileInput.click();
      }
    });

    el.browse.forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        el.fileInput.click();
      });
    });

    el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files && el.fileInput.files.length) setFile(el.fileInput.files[0]);
      el.fileInput.value = '';
    });

    if (el.fileRemove) {
      el.fileRemove.addEventListener('click', function () {
        setFile(null);
        el.drop.focus();
        announce('File removed');
      });
    }
  }

  /* ---------------------------------------------------------
     13. GENERATION PIPELINE
     --------------------------------------------------------- */

  function resetResults() {
    state.digests = null;
    state.digestSource = null;
    renderCards();
  }

  function setBusy(busy) {
    state.running = busy;
    if (el.generate) {
      el.generate.disabled = busy;
      el.generate.setAttribute('aria-busy', String(busy));
      el.generate.textContent = busy ? 'Generating…' : 'Generate hashes';
    }
  }

  function describeFailure(error) {
    var code = error && error.message;
    if (code === 'WEB_CRYPTO_UNAVAILABLE') {
      return 'SHA hashing needs the Web Crypto API, which this browser did not provide. '
        + 'MD5 still works, or try a current version of Chrome, Edge, Firefox or Safari over HTTPS.';
    }
    if (code === 'FILE_TOO_LARGE') {
      return 'This file is too large for your browser to hold in memory for SHA hashing. '
        + 'Try selecting only MD5, or use a smaller file.';
    }
    if (error && error.name === 'NotReadableError') {
      return 'The file could not be read. It may have been moved, renamed or locked by another program.';
    }
    return 'Something went wrong while hashing. Please try again with a different input.';
  }

  function generate(explicit) {
    if (state.running) return Promise.resolve();
    showError('');

    if (!state.selected.length) {
      if (explicit) showError('Select at least one hashing algorithm.');
      renderAlgoSelection();
      return Promise.resolve();
    }

    if (state.mode === 'text' && !el.text.value) {
      if (explicit) showError('Enter some text before generating a hash.');
      resetResults();
      return Promise.resolve();
    }

    if (state.mode === 'file' && !state.file) {
      if (explicit) showError('Choose a file before generating a hash.');
      resetResults();
      return Promise.resolve();
    }

    var ids = state.selected.slice();
    var token = ++state.runToken;
    setBusy(true);

    var work;
    var source;

    if (state.mode === 'text') {
      var bytes = encodeUtf8(el.text.value);
      source = { type: 'text', label: 'Text input', byteLength: bytes.length };
      if (bytes.length > 512 * 1024) setProgress(0.1, 'Generating hashes');
      work = hashBytes(bytes, ids);
    } else {
      var file = state.file;
      source = {
        type: 'file',
        label: file.name,
        byteLength: file.size,
        fileType: file.type || 'unknown'
      };
      setProgress(0, 'Reading file');
      work = hashFile(file, ids, function (fraction, label) {
        if (token === state.runToken) setProgress(fraction, label);
      });
    }

    return work.then(function (digests) {
      if (token !== state.runToken) return;
      state.digests = digests;
      state.digestSource = source;
      renderCards();
      renderSource();
      recordHistory(digests, source);
      announce('Hashes generated for ' + ids.length + ' algorithm' + (ids.length === 1 ? '' : 's') + '.');
    }).catch(function (error) {
      if (token !== state.runToken) return;
      resetResults();
      showError(describeFailure(error));
    }).then(function () {
      if (token !== state.runToken) return;
      setBusy(false);
      hideProgress();
    });
  }

  /* ---------------------------------------------------------
     14. CLIPBOARD
     --------------------------------------------------------- */

  function legacyCopy(value) {
    try {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }

  function flashButton(button, label) {
    if (!button) return;
    var original = button.getAttribute('data-original-label') || button.textContent;
    button.setAttribute('data-original-label', original);
    button.textContent = label;
    button.classList.add('is-copied');
    window.clearTimeout(button._hxTimer);
    button._hxTimer = window.setTimeout(function () {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 1600);
  }

  function copyText(value, button, message) {
    function succeed() {
      flashButton(button, 'Copied');
      announce(message || 'Copied to clipboard');
    }
    function fail() {
      flashButton(button, 'Press Ctrl+C');
      showError('Your browser blocked clipboard access. Select the hash and copy it manually.');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(succeed).catch(function () {
        if (legacyCopy(value)) succeed(); else fail();
      });
      return;
    }
    if (legacyCopy(value)) succeed(); else fail();
  }

  function buildPlainReport() {
    var lines = [];
    state.selected.forEach(function (id) {
      var value = state.digests && state.digests[id];
      if (!value) return;
      lines.push(ALGO_BY_ID[id].label + ':');
      lines.push(formatCase(value));
      lines.push('');
    });
    return lines.join('\n').trim() + '\n';
  }

  /* ---------------------------------------------------------
     15. DOWNLOAD
     --------------------------------------------------------- */

  function saveBlob(text, filename, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadName(extension) {
    var base = 'hashes';
    if (state.digestSource && state.digestSource.type === 'file') {
      base = state.digestSource.label.replace(/\.[^.]+$/, '') + '-hashes';
    }
    return base.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) + '.' + extension;
  }

  function downloadTxt() {
    if (!state.digests) return;
    var source = state.digestSource;
    var header = [
      '# ToolAdda — Hash Generator',
      '# Generated ' + new Date().toISOString(),
      source.type === 'file'
        ? '# File: ' + source.label + ' (' + source.byteLength.toLocaleString() + ' bytes)'
        : '# Input: text, ' + source.byteLength.toLocaleString() + ' bytes UTF-8',
      ''
    ].join('\n');
    saveBlob(header + buildPlainReport(), downloadName('txt'), 'text/plain;charset=utf-8');
    announce('Hash list downloaded as a text file');
  }

  function downloadJson() {
    if (!state.digests) return;
    var source = state.digestSource;
    var payload = {
      tool: 'ToolAdda Hash Generator',
      generatedAt: new Date().toISOString(),
      inputType: source.type,
      case: state.letterCase === 'upper' ? 'uppercase' : 'lowercase',
      algorithms: {}
    };

    if (source.type === 'file') {
      payload.file = {
        name: source.label,
        byteLength: source.byteLength,
        mimeType: source.fileType
      };
    } else {
      payload.input = { encoding: 'utf-8', byteLength: source.byteLength };
      if (state.includeInputInJson) payload.input.text = state.text;
    }

    state.selected.forEach(function (id) {
      var value = state.digests[id];
      if (value) payload.algorithms[id] = formatCase(value);
    });

    saveBlob(JSON.stringify(payload, null, 2), downloadName('json'), 'application/json');
    announce('Hash list downloaded as a JSON file');
  }

  /* ---------------------------------------------------------
     16. LOCAL HISTORY (opt-in)
     --------------------------------------------------------- */

  function readHistory() {
    try {
      var raw = localStorage.getItem(STORE_HISTORY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeHistory(entries) {
    try {
      localStorage.setItem(STORE_HISTORY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
    } catch (err) {
      /* storage full or blocked — history is a convenience only */
    }
  }

  function recordHistory(digests, source) {
    if (!state.historyEnabled) return;
    var entry = {
      at: Date.now(),
      inputType: source.type,
      label: source.type === 'file' ? source.label : 'Text · ' + source.byteLength + ' bytes',
      digests: {}
    };
    Object.keys(digests).forEach(function (id) { entry.digests[id] = digests[id]; });

    var entries = readHistory();
    entries.unshift(entry);
    writeHistory(entries);
    renderHistory();
  }

  function renderHistory() {
    if (!el.historyList) return;
    var entries = state.historyEnabled ? readHistory() : [];
    el.historyList.textContent = '';

    if (el.historyEmpty) {
      el.historyEmpty.hidden = entries.length > 0;
      el.historyEmpty.textContent = state.historyEnabled
        ? 'No hashes recorded yet in this browser.'
        : 'History is off. Turn it on to keep the last 25 digests in this browser only.';
    }
    if (el.historyClear) el.historyClear.hidden = entries.length === 0;

    entries.forEach(function (entry) {
      var item = document.createElement('li');
      item.className = 'hx-history__item';

      var head = document.createElement('div');
      head.className = 'hx-history__head';

      var label = document.createElement('span');
      label.className = 'hx-history__label';
      label.textContent = entry.label;

      var time = document.createElement('time');
      time.className = 'hx-history__time';
      time.dateTime = new Date(entry.at).toISOString();
      time.textContent = new Date(entry.at).toLocaleString();

      head.appendChild(label);
      head.appendChild(time);
      item.appendChild(head);

      Object.keys(entry.digests).forEach(function (id) {
        var algo = ALGO_BY_ID[id];
        if (!algo) return;
        var row = document.createElement('div');
        row.className = 'hx-history__row';

        var tag = document.createElement('span');
        tag.className = 'hx-history__algo';
        tag.setAttribute('data-algo', id);
        tag.textContent = algo.label;

        var value = document.createElement('code');
        value.className = 'hx-history__hash';
        value.textContent = formatCase(entry.digests[id]);

        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'hx-btn hx-btn--ghost hx-btn--xs';
        copy.textContent = 'Copy';
        copy.setAttribute('aria-label', 'Copy stored ' + algo.label + ' hash');
        copy.addEventListener('click', function () {
          copyText(formatCase(entry.digests[id]), copy, algo.label + ' hash copied');
        });

        row.appendChild(tag);
        row.appendChild(value);
        row.appendChild(copy);
        item.appendChild(row);
      });

      el.historyList.appendChild(item);
    });
  }

  /* ---------------------------------------------------------
     17. COMPARE PANEL
     --------------------------------------------------------- */

  function renderHint(input, hintEl) {
    if (!hintEl) return;
    var value = input.value.trim();
    hintEl.textContent = '';
    hintEl.className = 'hx-hint';
    if (!value) return;

    if (CHECKSUM_LINE.test(value)) {
      hintEl.textContent = 'This looks like a line from a checksum file.';
      var fix = document.createElement('button');
      fix.type = 'button';
      fix.className = 'hx-linkbtn';
      fix.textContent = 'Keep only the hash';
      fix.addEventListener('click', function () {
        var match = CHECKSUM_LINE.exec(input.value.trim());
        if (match) {
          input.value = match[1];
          renderHint(input, hintEl);
        }
        input.focus();
      });
      hintEl.appendChild(document.createTextNode(' '));
      hintEl.appendChild(fix);
      return;
    }

    if (!isHex(value)) {
      hintEl.classList.add('is-invalid');
      hintEl.textContent = 'Contains characters outside 0-9 and a-f.';
      return;
    }

    var guess = possibleAlgorithm(value);
    hintEl.textContent = guess
      ? value.length + ' hex characters · possible algorithm: ' + guess
      : value.length + ' hex characters · no standard algorithm has this length';
  }

  function runCompare() {
    if (!el.compareOut) return;
    var a = el.compareA.value.trim();
    var b = el.compareB.value.trim();
    var out = el.compareOut;
    out.className = 'hx-compare__out';

    if (!a || !b) {
      out.classList.add('is-invalid');
      out.textContent = 'Enter both hashes to compare.';
      announce('Enter both hashes to compare.');
      return;
    }

    if (!isHex(a) || !isHex(b)) {
      out.classList.add('is-invalid');
      out.textContent = 'The expected hash contains invalid characters. A hash may only contain 0-9 and a-f.';
      announce('Invalid characters in one of the hashes.');
      return;
    }

    var chosen = el.compareAlgo ? el.compareAlgo.value : 'auto';
    if (chosen !== 'auto') {
      var algo = ALGO_BY_ID[chosen];
      if (a.length !== algo.hexLength || b.length !== algo.hexLength) {
        out.classList.add('is-invalid');
        out.textContent = 'A ' + algo.label + ' hash is ' + algo.hexLength
          + ' hex characters. One of the values does not match that length.';
        announce('Length does not match the selected algorithm.');
        return;
      }
    }

    if (a.length !== b.length) {
      out.classList.add('is-mismatch');
      out.textContent = '✕ Hashes do not match — they are different lengths ('
        + a.length + ' vs ' + b.length + ' characters), so they cannot be the same digest.';
      announce('Hashes do not match.');
      return;
    }

    if (digestsEqual(a, b)) {
      var guess = possibleAlgorithm(a);
      out.classList.add('is-match');
      out.textContent = '✓ Hashes match'
        + (guess ? ' · ' + a.length + ' hex characters, possible algorithm: ' + guess : '')
        + '. Comparison ignores letter case.';
      announce('Hashes match.');
    } else {
      out.classList.add('is-mismatch');
      out.textContent = '✕ Hashes do not match. Even a single changed byte in the source '
        + 'produces a completely different digest.';
      announce('Hashes do not match.');
    }
  }

  function bindCompare() {
    if (!el.compareRun) return;

    el.compareRun.addEventListener('click', runCompare);
    el.compareA.addEventListener('input', function () { renderHint(el.compareA, el.compareHintA); });
    el.compareB.addEventListener('input', function () { renderHint(el.compareB, el.compareHintB); });

    [el.compareA, el.compareB].forEach(function (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          runCompare();
        }
      });
    });

    if (el.compareSwap) {
      el.compareSwap.addEventListener('click', function () {
        var temp = el.compareA.value;
        el.compareA.value = el.compareB.value;
        el.compareB.value = temp;
        renderHint(el.compareA, el.compareHintA);
        renderHint(el.compareB, el.compareHintB);
        announce('Swapped the two hashes.');
      });
    }

    if (el.compareClear) {
      el.compareClear.addEventListener('click', function () {
        el.compareA.value = '';
        el.compareB.value = '';
        renderHint(el.compareA, el.compareHintA);
        renderHint(el.compareB, el.compareHintB);
        el.compareOut.textContent = '';
        el.compareOut.className = 'hx-compare__out';
        el.compareA.focus();
      });
    }
  }

  /* ---------------------------------------------------------
     18. SELF-TEST PANEL
     --------------------------------------------------------- */

  function runSelfTest() {
    if (!el.selfTestOut) return;
    var out = el.selfTestOut;
    out.textContent = '';

    var list = document.createElement('ul');
    list.className = 'hx-selftest__list';
    var checks = [];

    TEST_VECTORS.forEach(function (vector) {
      var bytes = encodeUtf8(vector.input);
      Object.keys(vector.expected).forEach(function (id) {
        var algo = ALGO_BY_ID[id];
        if (!algo) return;
        var promise = algo.subtle
          ? shaHex(algo.subtle, bytes)
          : Promise.resolve(md5Hex(bytes));
        checks.push(promise.then(function (actual) {
          return { name: vector.name, algo: algo.label, ok: actual === vector.expected[id] };
        }).catch(function () {
          return { name: vector.name, algo: algo.label, ok: false, unavailable: true };
        }));
      });
    });

    Promise.all(checks).then(function (results) {
      var passed = 0;
      results.forEach(function (result) {
        if (result.ok) passed += 1;
        var item = document.createElement('li');
        item.className = 'hx-selftest__item ' + (result.ok ? 'is-pass' : 'is-fail');
        item.textContent = (result.ok ? '✓ ' : '✕ ') + result.algo + ' — ' + result.name
          + (result.unavailable ? ' (algorithm unavailable in this browser)' : '');
        list.appendChild(item);
      });

      var summary = document.createElement('p');
      summary.className = 'hx-selftest__summary ' + (passed === results.length ? 'is-pass' : 'is-fail');
      summary.textContent = passed + ' of ' + results.length
        + ' published test vectors reproduced exactly.';

      out.appendChild(summary);
      out.appendChild(list);
      announce(summary.textContent);
    });
  }

  /* ---------------------------------------------------------
     19. PREFERENCES, KEYBOARD, INIT
     --------------------------------------------------------- */

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORE_PREFS);
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (Array.isArray(prefs.selected) && prefs.selected.length) {
        state.selected = prefs.selected.filter(function (id) { return ALGO_BY_ID[id]; });
      }
      if (prefs.letterCase === 'upper' || prefs.letterCase === 'lower') {
        state.letterCase = prefs.letterCase;
      }
      state.historyEnabled = Boolean(prefs.historyEnabled);
    } catch (err) {
      /* corrupted preferences are simply ignored */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_PREFS, JSON.stringify({
        selected: state.selected,
        letterCase: state.letterCase,
        historyEnabled: state.historyEnabled
      }));
    } catch (err) {
      /* storage blocked — preferences just will not persist */
    }
  }

  function setMode(mode) {
    state.mode = mode;
    resetResults();
    showError('');
    renderMode();
    if (mode === 'text') {
      el.text.focus();
      if (el.text.value) generate(false);
    }
  }

  function bindTabs() {
    el.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { setMode(tab.getAttribute('data-hx-tab')); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        var index = el.tabs.indexOf(tab);
        var next = el.tabs[(index + (event.key === 'ArrowRight' ? 1 : el.tabs.length - 1)) % el.tabs.length];
        next.focus();
        setMode(next.getAttribute('data-hx-tab'));
      });
    });
  }

  function bindAlgorithms() {
    el.algoInputs.forEach(function (input) {
      input.addEventListener('change', function () {
        var id = input.getAttribute('data-hx-algo');
        var index = state.selected.indexOf(id);
        if (input.checked && index === -1) state.selected.push(id);
        if (!input.checked && index !== -1) state.selected.splice(index, 1);

        state.selected.sort(function (a, b) {
          return ALGOS.findIndex(function (x) { return x.id === a; })
            - ALGOS.findIndex(function (x) { return x.id === b; });
        });

        savePrefs();
        renderAlgoSelection();
        renderCards();
        if (state.selected.length) {
          showError('');
          if (state.mode === 'text' && el.text.value) generate(false);
          else if (state.mode === 'file' && state.file) generate(false);
        }
      });
    });

    if (el.selectAll) {
      el.selectAll.addEventListener('click', function () {
        state.selected = ALGOS.filter(function (algo) {
          return algo.subtle ? shaSupported() : state.md5Healthy;
        }).map(function (algo) { return algo.id; });
        savePrefs();
        renderAlgoSelection();
        if (state.mode === 'text' && el.text.value) generate(false);
        else if (state.mode === 'file' && state.file) generate(false);
      });
    }

    if (el.clearAlgos) {
      el.clearAlgos.addEventListener('click', function () {
        state.selected = [];
        savePrefs();
        renderAlgoSelection();
        resetResults();
      });
    }
  }

  function bindOutputControls() {
    el.caseButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        state.letterCase = button.getAttribute('data-hx-case');
        savePrefs();
        renderCase();
        renderCards();
        renderHistory();
      });
    });

    if (el.copyAll) {
      el.copyAll.addEventListener('click', function () {
        if (!state.digests) return;
        copyText(buildPlainReport(), el.copyAll, 'All hashes copied');
      });
    }
    if (el.downloadTxt) el.downloadTxt.addEventListener('click', downloadTxt);
    if (el.downloadJson) el.downloadJson.addEventListener('click', downloadJson);

    if (el.includeInput) {
      el.includeInput.addEventListener('change', function () {
        state.includeInputInJson = el.includeInput.checked;
      });
    }

    if (el.generate) {
      el.generate.addEventListener('click', function () { generate(true); });
    }

    if (el.clearAll) {
      el.clearAll.addEventListener('click', function () {
        el.text.value = '';
        state.text = '';
        setFile(null);
        updateTextMeta();
        resetResults();
        showError('');
        if (state.mode === 'text') el.text.focus();
        announce('Input cleared');
      });
    }

    if (el.textClear) {
      el.textClear.addEventListener('click', function () {
        el.text.value = '';
        state.text = '';
        updateTextMeta();
        resetResults();
        el.text.focus();
      });
    }

    if (el.sample) {
      el.sample.addEventListener('click', function () {
        el.text.value = 'The quick brown fox jumps over the lazy dog';
        onTextInput();
        el.text.focus();
      });
    }
  }

  function bindHistory() {
    if (el.historyToggle) {
      el.historyToggle.checked = state.historyEnabled;
      el.historyToggle.addEventListener('change', function () {
        state.historyEnabled = el.historyToggle.checked;
        savePrefs();
        if (!state.historyEnabled) {
          try { localStorage.removeItem(STORE_HISTORY); } catch (err) { /* ignore */ }
        }
        renderHistory();
        announce(state.historyEnabled ? 'Local history enabled' : 'Local history disabled and cleared');
      });
    }

    if (el.historyClear) {
      el.historyClear.addEventListener('click', function () {
        try { localStorage.removeItem(STORE_HISTORY); } catch (err) { /* ignore */ }
        renderHistory();
        announce('History cleared');
      });
    }
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        var inside = el.app.contains(document.activeElement);
        if (inside) {
          event.preventDefault();
          generate(true);
        }
        return;
      }

      if (event.key === 'Escape' && document.activeElement === el.text && el.text.value) {
        el.text.value = '';
        state.text = '';
        updateTextMeta();
        resetResults();
      }
    });
  }

  function applyEngineAvailability() {
    state.md5Healthy = verifyMd5Engine();
    var shaOk = shaSupported();

    if (!shaOk && el.cryptoWarning) {
      el.cryptoWarning.hidden = false;
      el.cryptoWarning.textContent = 'This browser did not expose the Web Crypto API, so SHA-1, SHA-256 '
        + 'and SHA-512 are unavailable here. MD5 still works. Web Crypto requires a secure (HTTPS) context.';
    }

    ALGOS.forEach(function (algo) {
      var input = el.algoInputs.filter(function (node) {
        return node.getAttribute('data-hx-algo') === algo.id;
      })[0];
      if (!input) return;

      var available = algo.subtle ? shaOk : state.md5Healthy;
      input.disabled = !available;
      var chip = input.closest('.hx-algo');
      if (chip) chip.classList.toggle('is-disabled', !available);

      if (!available) {
        var index = state.selected.indexOf(algo.id);
        if (index !== -1) state.selected.splice(index, 1);
      }
    });

    if (!state.md5Healthy && el.cryptoWarning) {
      el.cryptoWarning.hidden = false;
      el.cryptoWarning.textContent = 'The MD5 engine failed its built-in known-answer test in this browser '
        + 'and has been disabled so it cannot return a wrong digest. SHA algorithms are unaffected.';
    }

    if (!state.selected.length) {
      var fallback = shaOk ? 'sha256' : (state.md5Healthy ? 'md5' : null);
      if (fallback) state.selected = [fallback];
    }
  }

  function init() {
    if (!cacheDom()) return;

    loadPrefs();

    var grid = pick('[data-hx-cards]');
    ALGOS.forEach(function (algo) { grid.appendChild(buildCard(algo)); });

    applyEngineAvailability();

    renderMode();
    renderAlgoSelection();
    renderCase();
    renderCards();
    renderHistory();
    updateTextMeta();

    bindTabs();
    bindDropZone();
    bindAlgorithms();
    bindOutputControls();
    bindCompare();
    bindHistory();
    bindKeyboard();

    el.text.addEventListener('input', onTextInput);
    if (el.selfTestRun) el.selfTestRun.addEventListener('click', runSelfTest);

    if (el.text.value) onTextInput();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
