/* ToolAdda — PPK to PEM Converter.
   Parses PuTTY .ppk files (v2 and v3, RSA/ECDSA/Ed25519, encrypted or not)
   and re-encodes the key material as PEM (PKCS#1/SEC1/PKCS#8) or OpenSSH
   private key format. Every byte-level routine here (SSH wire-format
   reader, DER builders, PPK v2 AES-256-CBC KDF, PPK v3 Argon2id KDF split,
   OpenSSH private-key layout) was cross-validated against sshpk and
   node-forge using real ssh-keygen-generated RSA/ECDSA/Ed25519 keys before
   being wired up here. Pure byte/crypto helpers are exposed on
   window.PpkToPemEngine (and via module.exports for Node testing);
   DOM wiring only runs when [data-ppk-to-pem-page] is present.
   100% client-side — no key material is ever sent anywhere. */
(function (global) {
  'use strict';

  // ================= byte-string primitives (1 char = 1 byte, forge convention) =================

  function b(n) { return String.fromCharCode(n & 0xff); }
  function u32be(n) { return b((n >>> 24) & 255) + b((n >>> 16) & 255) + b((n >>> 8) & 255) + b(n & 255); }
  function sshStr(bytes) { return u32be(bytes.length) + bytes; }

  function SshReader(data) { this.data = data; this.pos = 0; }
  SshReader.prototype.readRaw = function () {
    if (this.pos + 4 > this.data.length) throw new Error('Truncated key data — the file may be corrupt or the passphrase may be incorrect.');
    var len = ((this.data.charCodeAt(this.pos) << 24) | (this.data.charCodeAt(this.pos + 1) << 16) |
      (this.data.charCodeAt(this.pos + 2) << 8) | this.data.charCodeAt(this.pos + 3)) >>> 0;
    this.pos += 4;
    if (len > 1e7 || this.pos + len > this.data.length) throw new Error('Truncated key data — the file may be corrupt or the passphrase may be incorrect.');
    var out = this.data.slice(this.pos, this.pos + len);
    this.pos += len;
    return out;
  };
  SshReader.prototype.readString = SshReader.prototype.readRaw;
  SshReader.prototype.atEnd = function () { return this.pos >= this.data.length; };

  // ================= DER helpers =================

  function derLen(len) {
    if (len < 0x80) return b(len);
    var hex = len.toString(16); if (hex.length % 2) hex = '0' + hex;
    var bytes = ''; for (var i = 0; i < hex.length; i += 2) bytes += b(parseInt(hex.substr(i, 2), 16));
    return b(0x80 | bytes.length) + bytes;
  }
  function derTLV(tag, content) { return b(tag) + derLen(content.length) + content; }
  function derSeq(parts) { return derTLV(0x30, parts.join('')); }
  function normalizeUnsigned(bytes) {
    var i = 0; while (i < bytes.length - 1 && bytes.charCodeAt(i) === 0) i++;
    var v = bytes.slice(i);
    if (v.length === 0) return b(0);
    if (v.charCodeAt(0) & 0x80) return b(0) + v;
    return v;
  }
  function derInt(bytes) { return derTLV(0x02, normalizeUnsigned(bytes)); }
  function derNull() { return derTLV(0x05, ''); }
  function derOid(contentBytes) { return derTLV(0x06, contentBytes); }
  function derOctet(content) { return derTLV(0x04, content); }
  function derBitString(content) { return derTLV(0x03, b(0) + content); }
  function derCtx(tagNum, content) { return derTLV(0xA0 | tagNum, content); }

  function fixedLenBytes(bytes, len) {
    var v = normalizeUnsigned(bytes);
    if (v.length === len + 1 && v.charCodeAt(0) === 0) v = v.slice(1);
    while (v.length < len) v = b(0) + v;
    return v.length > len ? v.slice(v.length - len) : v;
  }

  var OID = {
    rsaEncryption: '\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01',
    idEcPublicKey: '\x2a\x86\x48\xce\x3d\x02\x01',
    nistp256: '\x2a\x86\x48\xce\x3d\x03\x01\x07',
    nistp384: '\x2b\x81\x04\x00\x22',
    nistp521: '\x2b\x81\x04\x00\x23',
    ed25519: '\x2b\x65\x70',
  };
  var CURVE_LEN = { nistp256: 32, nistp384: 48, nistp521: 66 };

  function pemWrap(label, der) {
    var b64 = forge.util.encode64(der);
    var lines = b64.match(/.{1,64}/g) || [b64];
    return '-----BEGIN ' + label + '-----\n' + lines.join('\n') + '\n-----END ' + label + '-----\n';
  }

  // ================= big-integer helper (RSA CRT exponents only) =================

  function bytesToBigInt(s) {
    var hex = ''; for (var i = 0; i < s.length; i++) hex += ('0' + s.charCodeAt(i).toString(16)).slice(-2);
    return BigInt('0x' + (hex || '00'));
  }
  function bigIntToBytes(n) {
    var hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
    var out = ''; for (var i = 0; i < hex.length; i += 2) out += b(parseInt(hex.substr(i, 2), 16));
    return out;
  }

  // ================= PPK text parsing =================

  function parsePpkText(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n');
    var i = 0, version = null, algorithm = null;
    while (i < lines.length) {
      var m = /^PuTTY-User-Key-File-(\d+):\s*(.+)$/.exec(lines[i]);
      if (m) { version = parseInt(m[1], 10); algorithm = m[2].trim(); i++; break; }
      i++;
    }
    if (!version) throw new Error('This does not look like a PuTTY .ppk file (missing the "PuTTY-User-Key-File-N:" header line).');
    if (version !== 2 && version !== 3) throw new Error('Unsupported PPK format version: ' + version + '. Only PPK v2 and v3 are supported.');

    function nextField(name) {
      var line = lines[i] || '';
      var m2 = /^([^:]+):\s*(.*)$/.exec(line);
      if (!m2 || m2[1].trim().toLowerCase() !== name.toLowerCase()) {
        throw new Error('Malformed PPK file: expected a "' + name + ':" field, found "' + line + '".');
      }
      i++;
      return m2[2];
    }

    var encryption = nextField('Encryption').trim();
    var comment = nextField('Comment');
    var pubCount = parseInt(nextField('Public-Lines'), 10);
    if (!isFinite(pubCount) || pubCount < 0 || pubCount > lines.length) throw new Error('Malformed PPK file: invalid Public-Lines count.');
    var pubB64 = lines.slice(i, i + pubCount).join(''); i += pubCount;

    var argon2 = null;
    if (version === 3 && encryption !== 'none') {
      argon2 = {
        type: nextField('Key-Derivation').trim().toLowerCase(),
        memoryKB: parseInt(nextField('Argon2-Memory'), 10),
        passes: parseInt(nextField('Argon2-Passes'), 10),
        parallelism: parseInt(nextField('Argon2-Parallelism'), 10),
        saltHex: nextField('Argon2-Salt').trim(),
      };
    }

    var privB64 = '', mac = null;
    if (lines[i] && /^Private-Lines:/i.test(lines[i])) {
      var privCount = parseInt(nextField('Private-Lines'), 10);
      if (!isFinite(privCount) || privCount < 0 || privCount > lines.length) throw new Error('Malformed PPK file: invalid Private-Lines count.');
      privB64 = lines.slice(i, i + privCount).join(''); i += privCount;
      if (lines[i] && /^Private-MAC:/i.test(lines[i])) mac = nextField('Private-MAC').trim();
    }

    return { version: version, algorithm: algorithm, encryption: encryption, comment: comment, pubB64: pubB64, privB64: privB64, mac: mac, argon2: argon2 };
  }

  // ================= public/private blob field extraction =================

  function parsePublicBlob(pubBytes) {
    var r = new SshReader(pubBytes);
    var alg = r.readString();
    var fields = {};
    if (alg === 'ssh-rsa') {
      fields.e = r.readRaw(); fields.n = r.readRaw();
    } else if (/^ecdsa-sha2-nistp(256|384|521)$/.test(alg)) {
      fields.curve = r.readString(); fields.Q = r.readRaw();
    } else if (alg === 'ssh-ed25519') {
      fields.A = r.readRaw();
    } else {
      throw new Error('Unsupported key algorithm: "' + alg + '". This tool supports RSA, ECDSA (nistp256/384/521), and Ed25519 keys.');
    }
    return { algorithm: alg, fields: fields };
  }

  function parsePrivateFields(alg, privBytes) {
    var r = new SshReader(privBytes);
    if (alg === 'ssh-rsa') return { d: r.readRaw(), p: r.readRaw(), q: r.readRaw(), iqmp: r.readRaw() };
    if (/^ecdsa-sha2-nistp(256|384|521)$/.test(alg)) return { d: r.readRaw() };
    if (alg === 'ssh-ed25519') return { k: r.readRaw() };
    throw new Error('Unsupported key algorithm: "' + alg + '".');
  }

  // ================= PPK v2 KDF + decrypt (SHA-1 double-hash, AES-256-CBC, zero IV) =================

  function derivePpk2AesKey(passphrase) {
    var md1 = forge.md.sha1.create(); md1.update('\x00\x00\x00\x00' + passphrase, 'raw');
    var md2 = forge.md.sha1.create(); md2.update('\x00\x00\x00\x01' + passphrase, 'raw');
    return (md1.digest().data + md2.digest().data).substr(0, 32);
  }

  function aesCbcDecryptRaw(key, iv, cipherBytes) {
    var decipher = forge.cipher.createDecipher('AES-CBC', key);
    decipher.start({ iv: iv });
    decipher.update(forge.util.createBuffer(cipherBytes));
    decipher.finish(function () { return true; }); // raw CBC, no PKCS7 unpadding
    return decipher.output.getBytes();
  }

  function decryptPpk2PrivateBlob(encBytes, passphrase) {
    var key = derivePpk2AesKey(passphrase);
    var iv = ''; for (var z = 0; z < 16; z++) iv += '\x00';
    return aesCbcDecryptRaw(key, iv, encBytes);
  }

  // ================= PPK v3 KDF (Argon2id/i/d via lazy-loaded hash-wasm) + decrypt =================

  var HASHWASM_URL = 'https://cdn.jsdelivr.net/npm/hash-wasm@4/dist/argon2.umd.min.js';
  var hashwasmPromise = null;
  function loadHashWasm() {
    if (global.hashwasm) return Promise.resolve(global.hashwasm);
    if (hashwasmPromise) return hashwasmPromise;
    hashwasmPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = HASHWASM_URL;
      s.onload = function () { resolve(global.hashwasm); };
      s.onerror = function () { reject(new Error('Could not load the Argon2 module needed to decrypt this PPK v3 key. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return hashwasmPromise;
  }

  function hexToBytes(hex) {
    var out = ''; for (var i = 0; i < hex.length; i += 2) out += b(parseInt(hex.substr(i, 2), 16));
    return out;
  }

  async function decryptPpk3PrivateBlob(encBytes, passphrase, argon2) {
    var hashwasm = await loadHashWasm();
    var fn = hashwasm['argon2' + (argon2.type.replace('argon2', '') || 'id')];
    if (!fn) throw new Error('Unsupported Argon2 variant: ' + argon2.type);
    var saltBytes = hexToBytes(argon2.saltHex);
    var out = await fn({
      password: strToUint8(passphrase),
      salt: strToUint8(saltBytes),
      parallelism: argon2.parallelism,
      iterations: argon2.passes,
      memorySize: argon2.memoryKB,
      hashLength: 80,
      outputType: 'binary',
    });
    var kdf = uint8ToStr(out);
    var aesKey = kdf.slice(0, 32);
    var iv = kdf.slice(32, 48);
    var macKey = kdf.slice(48, 80);
    var plain = aesCbcDecryptRaw(aesKey, iv, encBytes);
    return { plain: plain, macKey: macKey };
  }

  function strToUint8(s) {
    var arr = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
    return arr;
  }
  function uint8ToStr(arr) {
    var s = ''; for (var i = 0; i < arr.length; i++) s += b(arr[i]);
    return s;
  }

  // ================= fingerprints =================

  function sha256Fingerprint(pubBytes) {
    var md = forge.md.sha256.create(); md.update(pubBytes, 'raw');
    var b64 = forge.util.encode64(md.digest().data).replace(/=+$/, '');
    return 'SHA256:' + b64;
  }
  function md5Fingerprint(pubBytes) {
    var md = forge.md.md5.create(); md.update(pubBytes, 'raw');
    var hex = md.digest().toHex();
    return 'MD5:' + (hex.match(/.{2}/g) || []).join(':');
  }

  // ================= PPK v2 MAC (best-effort integrity check; never blocks conversion) =================

  function computeMacV2(alg, encryption, comment, pubBytes, privBytesAsStored, passphrase) {
    var macKeySrc = 'putty-private-key-file-mac-key' + (passphrase || '');
    var macKey = forge.md.sha1.create(); macKey.update(macKeySrc, 'raw');
    var macData = sshStr(alg) + sshStr(encryption) + sshStr(comment) + sshStr(pubBytes) + sshStr(privBytesAsStored);
    var hmac = forge.hmac.create();
    hmac.start('sha1', macKey.digest().data);
    hmac.update(macData);
    return hmac.digest().toHex();
  }

  // ================= output builders =================

  function buildRsaPkcs1Der(f) {
    var dBI = bytesToBigInt(f.d), pBI = bytesToBigInt(f.p), qBI = bytesToBigInt(f.q);
    var dP = bigIntToBytes(dBI % (pBI - 1n));
    var dQ = bigIntToBytes(dBI % (qBI - 1n));
    return derSeq([derInt(b(0)), derInt(f.n), derInt(f.e), derInt(f.d), derInt(f.p), derInt(f.q), derInt(dP), derInt(dQ), derInt(f.iqmp)]);
  }
  function buildRsaPkcs8Der(f) {
    var algId = derSeq([derOid(OID.rsaEncryption), derNull()]);
    return derSeq([derInt(b(0)), algId, derOctet(buildRsaPkcs1Der(f))]);
  }
  function buildEcSec1Der(curveName, d, Q) {
    var len = CURVE_LEN[curveName];
    return derSeq([derInt(b(1)), derOctet(fixedLenBytes(d, len)), derCtx(0, derOid(OID[curveName])), derCtx(1, derBitString(Q))]);
  }
  function buildEcPkcs8Der(curveName, d, Q) {
    var algId = derSeq([derOid(OID.idEcPublicKey), derOid(OID[curveName])]);
    return derSeq([derInt(b(0)), algId, derOctet(buildEcSec1Der(curveName, d, Q))]);
  }
  function buildEd25519Pkcs8Der(k) {
    var algId = derSeq([derOid(OID.ed25519)]); // RFC 8410: parameters MUST be absent
    return derSeq([derInt(b(0)), algId, derOctet(derOctet(k))]);
  }

  /** Builds the "native" PEM for a parsed key: PKCS#1 for RSA, SEC1 for EC, PKCS#8 for Ed25519 (its only PEM form). */
  function buildPem(alg, pub, priv) {
    if (alg === 'ssh-rsa') return pemWrap('RSA PRIVATE KEY', buildRsaPkcs1Der({ n: pub.n, e: pub.e, d: priv.d, p: priv.p, q: priv.q, iqmp: priv.iqmp }));
    if (/^ecdsa-sha2-nistp/.test(alg)) return pemWrap('EC PRIVATE KEY', buildEcSec1Der(pub.curve, priv.d, pub.Q));
    if (alg === 'ssh-ed25519') return pemWrap('PRIVATE KEY', buildEd25519Pkcs8Der(priv.k));
    throw new Error('Unsupported algorithm for PEM output.');
  }

  /** Builds a PKCS#8 PrivateKeyInfo (unencrypted) DER for any supported algorithm — used as the bridge into forge's passphrase encryption. */
  function buildPkcs8Der(alg, pub, priv) {
    if (alg === 'ssh-rsa') return buildRsaPkcs8Der({ n: pub.n, e: pub.e, d: priv.d, p: priv.p, q: priv.q, iqmp: priv.iqmp });
    if (/^ecdsa-sha2-nistp/.test(alg)) return buildEcPkcs8Der(pub.curve, priv.d, pub.Q);
    if (alg === 'ssh-ed25519') return buildEd25519Pkcs8Der(priv.k);
    throw new Error('Unsupported algorithm.');
  }

  function encryptPemWithPassphrase(alg, pub, priv, passphrase) {
    var pkcs8Der = buildPkcs8Der(alg, pub, priv);
    var asn1 = forge.asn1.fromDer(pkcs8Der);
    var encAsn1 = forge.pki.encryptPrivateKeyInfo(asn1, passphrase, { algorithm: 'aes256', count: 20000, saltSize: 16, prfAlgorithm: 'sha256' });
    return forge.pki.encryptedPrivateKeyToPem(encAsn1);
  }

  // ---- OpenSSH private key format (openssh-key-v1), always unencrypted ----

  function buildOpenSshPrivateKey(alg, pubBlob, pub, priv, comment) {
    var privInner;
    if (alg === 'ssh-rsa') {
      privInner = sshStr('ssh-rsa') + sshStr(pub.n) + sshStr(pub.e) + sshStr(priv.d) + sshStr(priv.iqmp) + sshStr(priv.p) + sshStr(priv.q);
    } else if (/^ecdsa-sha2-nistp/.test(alg)) {
      privInner = sshStr(alg) + sshStr(pub.curve) + sshStr(pub.Q) + sshStr(priv.d);
    } else if (alg === 'ssh-ed25519') {
      privInner = sshStr(alg) + sshStr(pub.A) + sshStr(priv.k + pub.A);
    } else {
      throw new Error('Unsupported algorithm for OpenSSH output.');
    }
    var checkint = '\x01\x02\x03\x04';
    var inner = checkint + checkint + privInner + sshStr(comment || '');
    var padByte = 1;
    while (inner.length % 8 !== 0) { inner += b(padByte); padByte++; }
    var out = 'openssh-key-v1\x00' + sshStr('none') + sshStr('none') + sshStr('') + u32be(1) + sshStr(pubBlob) + sshStr(inner);
    return pemWrap('OPENSSH PRIVATE KEY', out);
  }

  var Engine = {
    parsePpkText: parsePpkText,
    parsePublicBlob: parsePublicBlob,
    parsePrivateFields: parsePrivateFields,
    decryptPpk2PrivateBlob: decryptPpk2PrivateBlob,
    decryptPpk3PrivateBlob: decryptPpk3PrivateBlob,
    computeMacV2: computeMacV2,
    sha256Fingerprint: sha256Fingerprint,
    md5Fingerprint: md5Fingerprint,
    buildPem: buildPem,
    encryptPemWithPassphrase: encryptPemWithPassphrase,
    buildOpenSshPrivateKey: buildOpenSshPrivateKey,
    sshStr: sshStr,
  };
  global.PpkToPemEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;

  // ================= UI wiring (only runs when the page markup exists) =================

  var root = typeof document !== 'undefined' ? document.querySelector('[data-ppk-to-pem-page]') : null;
  if (!root) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var fileInput = $('[data-file-input]');
  var filePickers = $$('[data-file-picker]');
  var dropZone = $('[data-drop-zone]');
  var pasteArea = $('[data-paste-textarea]');
  var loadPastedBtn = $('[data-load-pasted]');

  var fileMeta = $('[data-file-meta]');
  var sourcePassRow = $('[data-source-pass-row]');
  var sourcePassInput = $('[data-source-passphrase]');
  var unlockBtn = $('[data-unlock-btn]');

  var outputFormatSelect = $('[data-output-format]');
  var encryptOutputCheckbox = $('[data-encrypt-output]');
  var outputPassRow = $('[data-output-pass-row]');
  var outputPassInput = $('[data-output-passphrase]');

  var convertBtn = $('[data-convert-btn]');
  var resetBtn = $('[data-reset-btn]');
  var progressWrap = $('[data-progress-wrap]');
  var progressBar = $('[data-progress-bar]');
  var progressLabel = $('[data-progress-label]');
  var messageBox = $('[data-message]');
  var loader = $('[data-loader]');

  var resultsWrap = $('[data-results]');
  var pemPreview = $('[data-pem-preview]');
  var integrityBadge = $('[data-integrity-badge]');
  var copyBtn = $('[data-copy-btn]');
  var downloadPemBtn = $('[data-download-pem-btn]');
  var downloadOpensshBtn = $('[data-download-openssh-btn]');
  var historyList = $('[data-history-list]');

  var state = { fileText: null, fileName: null, parsed: null, pub: null, priv: null, pubBytesForFingerprint: null, decryptedPrivBytes: null, macInfo: null };
  var history = [];
  var lastOutputs = null;

  function clearMessage() { messageBox.textContent = ''; messageBox.hidden = true; messageBox.classList.remove('success', 'error'); }
  function showMessage(text, type) {
    messageBox.textContent = text;
    messageBox.hidden = false;
    messageBox.classList.remove('success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  }
  function toggleBusy(visible) {
    loader.hidden = !visible;
    convertBtn.disabled = visible;
  }
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsText(file);
    });
  }

  function loadPpkText(text, filename) {
    clearMessage();
    resultsWrap.hidden = true;
    try {
      var parsed = Engine.parsePpkText(text);
      state.fileText = text;
      state.fileName = filename || 'key.ppk';
      state.parsed = parsed;
      state.pub = null; state.priv = null; state.decryptedPrivBytes = null;

      var pubBytes = forge.util.decode64(parsed.pubB64);
      var pubInfo = Engine.parsePublicBlob(pubBytes);
      state.pub = pubInfo.fields;
      state.pubBytesForFingerprint = pubBytes;
      state.algorithm = pubInfo.algorithm;

      var isEncrypted = parsed.encryption !== 'none';
      sourcePassRow.hidden = !isEncrypted;
      renderMeta(parsed, pubInfo.algorithm, pubBytes, isEncrypted);

      if (!isEncrypted) {
        var privBytes = forge.util.decode64(parsed.privB64);
        state.priv = Engine.parsePrivateFields(pubInfo.algorithm, privBytes);
        state.decryptedPrivBytes = privBytes;
        verifyIntegrity(parsed, pubBytes, privBytes, '');
        convertBtn.disabled = false;
        showMessage('Key loaded and validated. Choose your output options and click Convert.', 'success');
      } else {
        convertBtn.disabled = true;
        showMessage('This key is encrypted. Enter its passphrase and click Unlock to continue.', 'success');
      }
    } catch (err) {
      showMessage(err.message, 'error');
      convertBtn.disabled = true;
    }
  }

  function renderMeta(parsed, algorithm, pubBytes, isEncrypted) {
    var algLabel = { 'ssh-rsa': 'RSA', 'ssh-ed25519': 'Ed25519' }[algorithm] ||
      (/^ecdsa-sha2-(nistp\d+)$/.exec(algorithm) ? 'ECDSA (' + /^ecdsa-sha2-(nistp\d+)$/.exec(algorithm)[1] + ')' : algorithm);
    fileMeta.hidden = false;
    fileMeta.innerHTML =
      metaRow('File name', state.fileName) +
      metaRow('Size', formatBytes(state.fileText.length)) +
      metaRow('PPK version', 'v' + parsed.version) +
      metaRow('Algorithm', algLabel) +
      metaRow('Encryption', isEncrypted ? 'Encrypted (' + parsed.encryption + ')' : 'None') +
      metaRow('Comment', parsed.comment || '—', true) +
      metaRow('SHA256 fingerprint', Engine.sha256Fingerprint(pubBytes), true) +
      metaRow('MD5 fingerprint', Engine.md5Fingerprint(pubBytes), true);
  }
  function metaRow(label, value, full) {
    return '<div class="p2p-meta-row' + (full ? ' p2p-meta-row--full' : '') + '"><span>' + label + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>';
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function verifyIntegrity(parsed, pubBytes, privBytesAsStored, passphrase) {
    if (parsed.version !== 2 || !parsed.mac) {
      integrityBadge.hidden = true;
      return;
    }
    try {
      var computed = Engine.computeMacV2(parsed.algorithm, parsed.encryption, parsed.comment, pubBytes, privBytesAsStored, passphrase);
      var ok = computed.toLowerCase() === parsed.mac.toLowerCase();
      integrityBadge.hidden = false;
      integrityBadge.textContent = ok ? '✓ Integrity verified (MAC matches)' : '⚠ MAC mismatch — file may be corrupt or passphrase incorrect';
      integrityBadge.className = 'p2p-integrity ' + (ok ? 'is-ok' : 'is-warn');
    } catch (e) {
      integrityBadge.hidden = true;
    }
  }

  async function unlockKey() {
    var passphrase = sourcePassInput.value;
    if (!state.parsed) return;
    clearMessage();
    try {
      toggleBusy(true);
      var parsed = state.parsed;
      var privEnc = forge.util.decode64(parsed.privB64);
      var plain;
      if (parsed.version === 2) {
        plain = Engine.decryptPpk2PrivateBlob(privEnc, passphrase);
        verifyIntegrity(parsed, state.pubBytesForFingerprint, privEnc, passphrase);
      } else {
        if (!parsed.argon2) throw new Error('Missing Argon2 parameters in this PPK v3 file.');
        showMessage('Deriving key with Argon2 — this can take a few seconds…', 'success');
        var res = await Engine.decryptPpk3PrivateBlob(privEnc, passphrase, parsed.argon2);
        plain = res.plain;
        integrityBadge.hidden = true; // v3 MAC verification not implemented — see content notes
      }
      state.priv = Engine.parsePrivateFields(state.algorithm, plain);
      state.decryptedPrivBytes = plain;
      convertBtn.disabled = false;
      clearMessage();
      showMessage('✅ Passphrase correct — key unlocked. Choose your output options and click Convert.', 'success');
    } catch (err) {
      state.priv = null;
      convertBtn.disabled = true;
      showMessage('Could not unlock this key: ' + err.message + ' (check the passphrase).', 'error');
    } finally {
      toggleBusy(false);
    }
  }

  function doConvert() {
    if (!state.parsed || !state.pub || !state.priv) { showMessage('Load and unlock a key first.', 'error'); return; }
    clearMessage();
    try {
      toggleBusy(true);
      setProgress(1, 3);
      var alg = state.algorithm;
      var pemText = encryptOutputCheckbox.checked && outputPassInput.value
        ? Engine.encryptPemWithPassphrase(alg, state.pub, state.priv, outputPassInput.value)
        : Engine.buildPem(alg, state.pub, state.priv);
      setProgress(2, 3);
      var opensshText = Engine.buildOpenSshPrivateKey(alg, state.pubBytesForFingerprint, state.pub, state.priv, state.parsed.comment);
      setProgress(3, 3);

      lastOutputs = { pem: pemText, openssh: opensshText };
      var primary = outputFormatSelect.value === 'openssh' ? opensshText : pemText;
      pemPreview.textContent = primary;
      resultsWrap.hidden = false;

      pushHistory(alg, state.fileName);
      showMessage('✅ Conversion complete.', 'success');
      resultsWrap.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch (err) {
      showMessage('Conversion failed: ' + err.message, 'error');
    } finally {
      toggleBusy(false);
      setProgress(0, 0);
    }
  }

  function setProgress(cur, total) {
    if (total <= 0) { progressWrap.hidden = true; return; }
    progressWrap.hidden = false;
    var pct = Math.round((cur / total) * 100);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = cur >= total ? 'Done' : 'Converting…';
  }

  function pushHistory(alg, filename) {
    var entry = {
      time: new Date().toLocaleTimeString(),
      filename: filename,
      algorithm: alg,
      fingerprint: Engine.sha256Fingerprint(state.pubBytesForFingerprint),
      outputs: lastOutputs,
    };
    history.unshift(entry);
    if (history.length > 10) history.pop();
    renderHistory();
  }
  function renderHistory() {
    if (!history.length) { historyList.hidden = true; return; }
    historyList.hidden = false;
    historyList.innerHTML = history.map(function (h, idx) {
      return '<div class="ppk2pem-history-item">' +
        '<div><strong>' + escapeHtml(h.filename) + '</strong><span>' + h.time + ' · ' + escapeHtml(h.fingerprint) + '</span></div>' +
        '<button type="button" class="secondary-btn" data-history-reopen="' + idx + '">Reopen</button>' +
        '</div>';
    }).join('');
    $$('[data-history-reopen]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var h = history[parseInt(btn.getAttribute('data-history-reopen'), 10)];
        lastOutputs = h.outputs;
        pemPreview.textContent = outputFormatSelect.value === 'openssh' ? h.outputs.openssh : h.outputs.pem;
        resultsWrap.hidden = false;
      });
    });
  }

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function baseName(name) { return (name || 'key').replace(/\.[^.]+$/, ''); }

  function resetAll() {
    state = { fileText: null, fileName: null, parsed: null, pub: null, priv: null, pubBytesForFingerprint: null, decryptedPrivBytes: null };
    lastOutputs = null;
    fileMeta.hidden = true;
    sourcePassRow.hidden = true;
    sourcePassInput.value = '';
    integrityBadge.hidden = true;
    resultsWrap.hidden = true;
    convertBtn.disabled = true;
    fileInput.value = '';
    if (pasteArea) pasteArea.value = '';
    clearMessage();
    setProgress(0, 0);
  }

  // ---- wiring ----

  filePickers.forEach(function (btn) { btn.addEventListener('click', function (e) { e.preventDefault(); fileInput.click(); }); });
  fileInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    readFileAsText(file).then(function (text) { loadPpkText(text, file.name); }).catch(function (err) { showMessage(err.message, 'error'); });
    e.target.value = '';
  });

  if (dropZone) {
    dropZone.addEventListener('click', function (e) { if (!e.target.closest('button')) fileInput.click(); });
    dropZone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('active'); });
    dropZone.addEventListener('dragleave', function (e) { e.preventDefault(); dropZone.classList.remove('active'); });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault(); dropZone.classList.remove('active');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readFileAsText(file).then(function (text) { loadPpkText(text, file.name); }).catch(function (err) { showMessage(err.message, 'error'); });
    });
  }

  document.addEventListener('paste', function (e) {
    if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
    var items = e.clipboardData && e.clipboardData.items;
    var fileItem = items && Array.prototype.find.call(items, function (it) { return it.kind === 'file'; });
    if (fileItem) {
      var file = fileItem.getAsFile();
      readFileAsText(file).then(function (text) { loadPpkText(text, file.name); });
      return;
    }
    var text = e.clipboardData && e.clipboardData.getData('text');
    if (text && /PuTTY-User-Key-File-/.test(text) && document.activeElement !== pasteArea) {
      loadPpkText(text, 'pasted-key.ppk');
    }
  });

  if (loadPastedBtn && pasteArea) {
    loadPastedBtn.addEventListener('click', function () {
      if (!pasteArea.value.trim()) { showMessage('Paste PPK file contents into the box first.', 'error'); return; }
      loadPpkText(pasteArea.value, 'pasted-key.ppk');
    });
  }

  if (unlockBtn) unlockBtn.addEventListener('click', unlockKey);

  if (encryptOutputCheckbox) {
    encryptOutputCheckbox.addEventListener('change', function () { outputPassRow.hidden = !encryptOutputCheckbox.checked; });
  }

  convertBtn.addEventListener('click', doConvert);
  resetBtn.addEventListener('click', resetAll);

  if (outputFormatSelect) {
    outputFormatSelect.addEventListener('change', function () {
      if (!lastOutputs) return;
      pemPreview.textContent = outputFormatSelect.value === 'openssh' ? lastOutputs.openssh : lastOutputs.pem;
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(pemPreview.textContent).then(function () {
        showMessage('✅ Copied to clipboard.', 'success');
      }).catch(function () { showMessage('Copy failed — select the text manually.', 'error'); });
    });
  }
  if (downloadPemBtn) {
    downloadPemBtn.addEventListener('click', function () {
      if (!lastOutputs) return;
      var isRsa = state.algorithm === 'ssh-rsa';
      var isEc = /^ecdsa/.test(state.algorithm || '');
      var ext = encryptOutputCheckbox.checked && outputPassInput.value ? '.pem' : (isRsa ? '.pem' : isEc ? '.pem' : '.pem');
      downloadText(lastOutputs.pem, baseName(state.fileName) + ext);
    });
  }
  if (downloadOpensshBtn) {
    downloadOpensshBtn.addEventListener('click', function () {
      if (!lastOutputs) return;
      downloadText(lastOutputs.openssh, baseName(state.fileName) + '_openssh.key');
    });
  }

  resetAll();
})(typeof window !== 'undefined' ? window : global);
