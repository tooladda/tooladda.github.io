/* ToolAdda — SSH Key Generator engine.
   Generates real SSH key pairs using the browser's native Web Crypto API
   (window.crypto.subtle) — genuine cryptographic randomness and key
   generation, not a custom/home-rolled implementation. This file only adds
   the OpenSSH *wire-format encoding* around that native key material (byte
   packing + base64), plus fingerprints and randomart. Nothing here ever
   makes a network request; keys never leave the browser.

   DSA is intentionally not offered: it has been disabled by default in
   OpenSSH since 7.0 (2015) for being weak, and the Web Crypto API has never
   supported it — offering a home-grown DSA implementation would mean
   unverifiable, unvetted cryptography for a legacy/insecure algorithm. */
(function (global) {
  'use strict';

  const subtle = global.crypto && global.crypto.subtle;
  const getRandomValues = (n) => {
    const b = new Uint8Array(n);
    global.crypto.getRandomValues(b);
    return b;
  };

  // ---------- byte-level utilities ----------

  function concatBytes(chunks) {
    let len = 0;
    chunks.forEach((c) => { len += c.length; });
    const out = new Uint8Array(len);
    let offset = 0;
    chunks.forEach((c) => { out.set(c, offset); offset += c.length; });
    return out;
  }

  function u32be(n) {
    const b = new Uint8Array(4);
    b[0] = (n >>> 24) & 0xff;
    b[1] = (n >>> 16) & 0xff;
    b[2] = (n >>> 8) & 0xff;
    b[3] = n & 0xff;
    return b;
  }

  function readU32be(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const out = [];
    for (let i = 0; i < str.length; i += 1) out.push(str.charCodeAt(i) & 0xff);
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return s;
  }

  /** SSH wire "string": 4-byte big-endian length + raw bytes. */
  function sshString(data) {
    const bytes = typeof data === 'string' ? utf8Encode(data) : data;
    return concatBytes([u32be(bytes.length), bytes]);
  }

  function stripLeadingZeros(bytes) {
    let i = 0;
    while (i < bytes.length && bytes[i] === 0) i += 1;
    return bytes.slice(i);
  }

  /** SSH wire "mpint": same string framing, but a positive value whose top
   * bit is set gets a 0x00 prefix so it isn't misread as negative, and zero
   * is encoded as a zero-length string (RFC 4251 §5). */
  function mpint(bytesUnsigned) {
    let b = stripLeadingZeros(bytesUnsigned);
    if (b.length > 0 && (b[0] & 0x80) !== 0) {
      const padded = new Uint8Array(b.length + 1);
      padded.set(b, 1);
      b = padded;
    }
    return sshString(b);
  }

  /** Reads one length-prefixed SSH "string"/"mpint" field starting at offset. */
  function readSshString(bytes, offset) {
    const len = readU32be(bytes, offset);
    const value = bytes.slice(offset + 4, offset + 4 + len);
    return { value, next: offset + 4 + len };
  }

  const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64Encode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
      out += B64_CHARS[b0 >> 2];
      out += B64_CHARS[((b0 & 0x03) << 4) | (b1 === null ? 0 : b1 >> 4)];
      out += b1 === null ? '=' : B64_CHARS[((b1 & 0x0f) << 2) | (b2 === null ? 0 : b2 >> 6)];
      out += b2 === null ? '=' : B64_CHARS[b2 & 0x3f];
    }
    return out;
  }

  function base64Decode(str) {
    const clean = str.replace(/[^A-Za-z0-9+/=]/g, '');
    const lookup = {};
    for (let i = 0; i < B64_CHARS.length; i += 1) lookup[B64_CHARS[i]] = i;
    const out = [];
    for (let i = 0; i < clean.length; i += 4) {
      const c0 = lookup[clean[i]] || 0;
      const c1 = lookup[clean[i + 1]] || 0;
      const c2 = clean[i + 2] === '=' || clean[i + 2] === undefined ? null : lookup[clean[i + 2]];
      const c3 = clean[i + 3] === '=' || clean[i + 3] === undefined ? null : lookup[clean[i + 3]];
      out.push((c0 << 2) | (c1 >> 4));
      if (c2 !== null) out.push(((c1 & 0x0f) << 4) | (c2 >> 2));
      if (c3 !== null) out.push(((c2 & 0x03) << 6) | c3);
    }
    return new Uint8Array(out);
  }

  function base64urlToBytes(b64url) {
    let s = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return base64Decode(s);
  }

  function wrapBase64(b64, width) {
    const lines = [];
    for (let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
    return lines.join('\n');
  }

  function hex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- algorithm metadata ----------

  const ALGORITHMS = {
    ed25519: {
      label: 'Ed25519',
      sshType: 'ssh-ed25519',
      webCryptoKeyGen: () => ({ name: 'Ed25519' }),
      sizeLabel: () => '256-bit',
    },
    'ecdsa-p256': {
      label: 'ECDSA P-256',
      sshType: 'ecdsa-sha2-nistp256',
      curveName: 'nistp256',
      webCryptoKeyGen: () => ({ name: 'ECDSA', namedCurve: 'P-256' }),
      sizeLabel: () => 'P-256',
      fieldBytes: 32,
    },
    'ecdsa-p384': {
      label: 'ECDSA P-384',
      sshType: 'ecdsa-sha2-nistp384',
      curveName: 'nistp384',
      webCryptoKeyGen: () => ({ name: 'ECDSA', namedCurve: 'P-384' }),
      sizeLabel: () => 'P-384',
      fieldBytes: 48,
    },
    'ecdsa-p521': {
      label: 'ECDSA P-521',
      sshType: 'ecdsa-sha2-nistp521',
      curveName: 'nistp521',
      webCryptoKeyGen: () => ({ name: 'ECDSA', namedCurve: 'P-521' }),
      sizeLabel: () => 'P-521',
      fieldBytes: 66,
    },
    rsa: {
      label: 'RSA',
      sshType: 'ssh-rsa',
      webCryptoKeyGen: (bits) => ({
        name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
      }),
      sizeLabel: (bits) => `${bits}-bit`,
    },
  };

  // ---------- public key blob (shared by .pub file, fingerprints, and the
  // openssh-key-v1 container's public-key field) ----------

  async function buildPublicKeyBlob(algoId, publicKey, jwkPublic) {
    const algo = ALGORITHMS[algoId];
    if (algoId === 'ed25519') {
      const raw = new Uint8Array(await subtle.exportKey('raw', publicKey));
      return concatBytes([sshString(algo.sshType), sshString(raw)]);
    }
    if (algoId.startsWith('ecdsa-')) {
      const raw = new Uint8Array(await subtle.exportKey('raw', publicKey));
      return concatBytes([sshString(algo.sshType), sshString(algo.curveName), sshString(raw)]);
    }
    // rsa
    const e = stripLeadingZeros(base64urlToBytes(jwkPublic.e));
    const n = stripLeadingZeros(base64urlToBytes(jwkPublic.n));
    return concatBytes([sshString(algo.sshType), mpint(e), mpint(n)]);
  }

  // ---------- openssh-key-v1 private key container ----------

  const AUTH_MAGIC = utf8Encode('openssh-key-v1\0');
  const BLOCK_SIZE = 8; // cipher "none"

  async function buildPrivateKeyFields(algoId, privateKey, pubBlobFieldsOnly, jwkPrivate) {
    // pubBlobFieldsOnly: the algorithm-specific public fields WITHOUT the
    // leading type string (reused inside the private section, which repeats
    // the type string itself separately).
    if (algoId === 'ed25519') {
      const seed = base64urlToBytes(jwkPrivate.d); // 32-byte seed
      const pub = base64urlToBytes(jwkPrivate.x); // 32-byte public key
      const combined = concatBytes([seed, pub]); // OpenSSH stores seed||pub as the 64-byte "private key"
      return concatBytes([sshString(pub), sshString(combined)]);
    }
    if (algoId.startsWith('ecdsa-')) {
      const raw = new Uint8Array(await subtle.exportKey('raw', await reimportPublicFromPrivate(algoId, privateKey, jwkPrivate)));
      const d = stripLeadingZeros(base64urlToBytes(jwkPrivate.d));
      return concatBytes([sshString(ALGORITHMS[algoId].curveName), sshString(raw), mpint(d)]);
    }
    // rsa — private section order is n, e, d, iqmp, p, q (NOT the same e,n
    // order as the public blob, which is fixed by the SSH transport protocol
    // itself; this new-format container is OpenSSH's own serialization).
    const n = stripLeadingZeros(base64urlToBytes(jwkPrivate.n));
    const e = stripLeadingZeros(base64urlToBytes(jwkPrivate.e));
    const d = stripLeadingZeros(base64urlToBytes(jwkPrivate.d));
    const iqmp = stripLeadingZeros(base64urlToBytes(jwkPrivate.qi));
    const p = stripLeadingZeros(base64urlToBytes(jwkPrivate.p));
    const q = stripLeadingZeros(base64urlToBytes(jwkPrivate.q));
    return concatBytes([mpint(n), mpint(e), mpint(d), mpint(iqmp), mpint(p), mpint(q)]);
  }

  // ECDSA JWK doesn't include a convenient "raw public point" export path
  // directly from the private key, so re-derive the public CryptoKey from
  // the private key's own x/y coordinates to reuse exportKey('raw', ...).
  async function reimportPublicFromPrivate(algoId, privateKey, jwkPrivate) {
    const namedCurve = ALGORITHMS[algoId].webCryptoKeyGen().namedCurve;
    const jwkPub = { kty: 'EC', crv: jwkPrivate.crv, x: jwkPrivate.x, y: jwkPrivate.y, ext: true };
    return subtle.importKey('jwk', jwkPub, { name: 'ECDSA', namedCurve }, true, []);
  }

  function encodeOpenSSHPrivateKeyPem(sshType, pubBlob, algoId, privateFields, comment) {
    const checkint = getRandomValues(4);
    const keyType = sshString(sshType);
    const commentField = sshString(comment || '');
    let body = concatBytes([checkint, checkint, keyType, privateFields, commentField]);
    const padLen = (BLOCK_SIZE - (body.length % BLOCK_SIZE)) % BLOCK_SIZE;
    const padding = new Uint8Array(padLen);
    for (let i = 0; i < padLen; i += 1) padding[i] = i + 1;
    body = concatBytes([body, padding]);

    const container = concatBytes([
      AUTH_MAGIC,
      sshString('none'), // ciphername
      sshString('none'), // kdfname
      sshString(new Uint8Array(0)), // kdfoptions (empty)
      u32be(1), // number of keys
      sshString(pubBlob),
      sshString(body),
    ]);

    const b64 = base64Encode(container);
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapBase64(b64, 70)}\n-----END OPENSSH PRIVATE KEY-----\n`;
  }

  /** Decodes an openssh-key-v1 PEM back into its typed fields. Used both as
   * an internal self-consistency check and to power a "paste a key to
   * inspect it" utility. Only supports cipher "none" (unencrypted) keys. */
  function decodeOpenSSHPrivateKeyPem(pem) {
    const b64 = pem.replace(/-----BEGIN OPENSSH PRIVATE KEY-----/, '').replace(/-----END OPENSSH PRIVATE KEY-----/, '').trim();
    const bytes = base64Decode(b64);
    let off = 0;
    const magic = utf8Decode(bytes.slice(0, 15));
    if (magic !== 'openssh-key-v1\0') throw new Error('Not an openssh-key-v1 file');
    off = 15;
    let r = readSshString(bytes, off); const cipherName = utf8Decode(r.value); off = r.next;
    r = readSshString(bytes, off); const kdfName = utf8Decode(r.value); off = r.next;
    r = readSshString(bytes, off); off = r.next; // kdfoptions
    const numKeys = readU32be(bytes, off); off += 4;
    r = readSshString(bytes, off); const pubBlob = r.value; off = r.next;
    r = readSshString(bytes, off); const privSection = r.value; off = r.next;

    let po = 0;
    const check1 = privSection.slice(po, po + 4); po += 4;
    const check2 = privSection.slice(po, po + 4); po += 4;
    r = readSshString(privSection, po); const keyType = utf8Decode(r.value); po = r.next;

    const fields = {};
    if (keyType === 'ssh-ed25519') {
      r = readSshString(privSection, po); fields.pub = r.value; po = r.next;
      r = readSshString(privSection, po); fields.priv64 = r.value; po = r.next;
    } else if (keyType.indexOf('ecdsa-sha2-') === 0) {
      r = readSshString(privSection, po); fields.curve = utf8Decode(r.value); po = r.next;
      r = readSshString(privSection, po); fields.point = r.value; po = r.next;
      r = readSshString(privSection, po); fields.d = r.value; po = r.next;
    } else if (keyType === 'ssh-rsa') {
      r = readSshString(privSection, po); fields.n = r.value; po = r.next;
      r = readSshString(privSection, po); fields.e = r.value; po = r.next;
      r = readSshString(privSection, po); fields.d = r.value; po = r.next;
      r = readSshString(privSection, po); fields.iqmp = r.value; po = r.next;
      r = readSshString(privSection, po); fields.p = r.value; po = r.next;
      r = readSshString(privSection, po); fields.q = r.value; po = r.next;
    } else {
      throw new Error('Unsupported key type: ' + keyType);
    }
    r = readSshString(privSection, po); const comment = utf8Decode(r.value); po = r.next;
    const padding = privSection.slice(po);

    return {
      cipherName, kdfName, numKeys, pubBlob, keyType, fields, comment, padding,
      checkintMatches: check1.every((b, i) => b === check2[i]),
    };
  }

  // ---------- fingerprints ----------

  async function sha256Fingerprint(pubBlob) {
    const digest = new Uint8Array(await subtle.digest('SHA-256', pubBlob));
    return 'SHA256:' + base64Encode(digest).replace(/=+$/, '');
  }

  // MD5 (RFC 1321) — not offered by Web Crypto (deliberately excluded from
  // the spec), only used here for the legacy fingerprint format that some
  // older tooling still displays. Not used for anything security-critical.
  function md5(bytes) {
    function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
    const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    const K = new Int32Array(64);
    for (let i = 0; i < 64; i += 1) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;

    const msgLen = bytes.length;
    const withOne = concatBytes([bytes, new Uint8Array([0x80])]);
    let totalLen = withOne.length;
    while (totalLen % 64 !== 56) totalLen += 1;
    const padded = new Uint8Array(totalLen + 8);
    padded.set(withOne, 0);
    const bitLenLow = (msgLen * 8) >>> 0;
    const bitLenHigh = Math.floor((msgLen * 8) / 4294967296) >>> 0;
    for (let i = 0; i < 4; i += 1) { padded[totalLen + i] = (bitLenLow >>> (8 * i)) & 0xff; }
    for (let i = 0; i < 4; i += 1) { padded[totalLen + 4 + i] = (bitLenHigh >>> (8 * i)) & 0xff; }

    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;

    for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
      const M = new Int32Array(16);
      for (let j = 0; j < 16; j += 1) {
        M[j] = padded[chunkStart + j * 4] | (padded[chunkStart + j * 4 + 1] << 8)
          | (padded[chunkStart + j * 4 + 2] << 16) | (padded[chunkStart + j * 4 + 3] << 24);
      }
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i += 1) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, s[i])) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }

    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((word, idx) => {
      out[idx * 4] = word & 0xff;
      out[idx * 4 + 1] = (word >>> 8) & 0xff;
      out[idx * 4 + 2] = (word >>> 16) & 0xff;
      out[idx * 4 + 3] = (word >>> 24) & 0xff;
    });
    return out;
  }

  function md5Fingerprint(pubBlob) {
    const digest = md5(pubBlob);
    return 'MD5:' + Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join(':');
  }

  // ---------- randomart (OpenSSH's "drunken bishop" visual fingerprint) ----------

  function randomart(digestBytes, title) {
    const W = 17;
    const H = 9;
    const field = new Array(W * H).fill(0);
    let x = Math.floor(W / 2);
    let y = Math.floor(H / 2);
    const at = (xx, yy) => yy * W + xx;
    field[at(x, y)] += 1;
    digestBytes.forEach((byte) => {
      for (let bitPair = 0; bitPair < 4; bitPair += 1) {
        const move = (byte >> (bitPair * 2)) & 0x3;
        const dx = (move & 0x1) ? 1 : -1;
        const dy = (move & 0x2) ? 1 : -1;
        x = Math.min(W - 1, Math.max(0, x + dx));
        y = Math.min(H - 1, Math.max(0, y + dy));
        field[at(x, y)] += 1;
      }
    });
    field[at(Math.floor(W / 2), Math.floor(H / 2))] = -1; // start
    field[at(x, y)] = -2; // end
    const chars = ' .o+=*BOX@%&#/^SE';
    // The frame is W + 2 = 19 wide, so the title band gets 19 - 6 = 13
    // characters; 15 made the top border two wider than the rest of the box.
    let out = '+--' + `[${title}]`.padEnd(W - 4, '-').slice(0, W - 4) + '--+\n';
    for (let yy = 0; yy < H; yy += 1) {
      let row = '|';
      for (let xx = 0; xx < W; xx += 1) {
        const v = field[at(xx, yy)];
        if (v === -1) row += 'S';
        else if (v === -2) row += 'E';
        else row += chars[Math.min(v, chars.length - 3)];
      }
      out += row + '|\n';
    }
    out += '+' + '-'.repeat(W) + '+';
    return out;
  }

  // ---------- top-level orchestration ----------

  function isWebCryptoAvailable() {
    return !!subtle;
  }

  async function isEd25519Supported() {
    if (!subtle) return false;
    try {
      await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function generateSSHKeyPair({ algorithm, bits, comment }) {
    const algo = ALGORITHMS[algorithm];
    if (!algo) throw new Error('Unsupported algorithm: ' + algorithm);
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const genParams = algorithm === 'rsa' ? algo.webCryptoKeyGen(bits) : algo.webCryptoKeyGen();
    const keyPair = await subtle.generateKey(genParams, true, ['sign', 'verify']);

    const jwkPrivate = await subtle.exportKey('jwk', keyPair.privateKey);
    const jwkPublic = algorithm === 'rsa' ? await subtle.exportKey('jwk', keyPair.publicKey) : null;

    const pubBlob = await buildPublicKeyBlob(algorithm, keyPair.publicKey, jwkPublic);
    const privateFields = await buildPrivateKeyFields(algorithm, keyPair.privateKey, null, jwkPrivate);
    const privateKeyPem = encodeOpenSSHPrivateKeyPem(algo.sshType, pubBlob, algorithm, privateFields, comment);
    const publicKeyLine = `${algo.sshType} ${base64Encode(pubBlob)}${comment ? ' ' + comment : ''}\n`;

    const pkcs8Buf = new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey));
    const pkcs8Pem = `-----BEGIN PRIVATE KEY-----\n${wrapBase64(base64Encode(pkcs8Buf), 64)}\n-----END PRIVATE KEY-----\n`;

    const sha256Fp = await sha256Fingerprint(pubBlob);
    const md5Fp = md5Fingerprint(pubBlob);
    // Web Crypto has no MD5 digest (deliberately excluded from the spec);
    // reuse our own MD5 bytes for the classic bishop art, matching
    // ssh-keygen's traditional -E md5 randomart output.
    const art = randomart(md5(pubBlob), algo.label);

    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;

    return {
      algorithm,
      algorithmLabel: algo.label,
      sizeLabel: algorithm === 'rsa' ? algo.sizeLabel(bits) : algo.sizeLabel(),
      comment: comment || '',
      publicKeyLine,
      privateKeyPem,
      pkcs8Pem,
      sha256Fingerprint: sha256Fp,
      md5Fingerprint: md5Fp,
      randomart: art,
      generationTimeMs: elapsed,
    };
  }

  global.SSHKeyGen = {
    ALGORITHMS,
    isWebCryptoAvailable,
    isEd25519Supported,
    generateSSHKeyPair,
    // exposed for testing / advanced "inspect a key" tooling
    decodeOpenSSHPrivateKeyPem,
    buildPublicKeyBlob,
    base64Encode,
    base64Decode,
    hex,
    md5,
    sha256Fingerprint,
    md5Fingerprint,
    randomart,
  };
})(typeof window !== 'undefined' ? window : global);
