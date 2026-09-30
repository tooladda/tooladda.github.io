/* ToolAdda SSL Certificate Checker
   Looks the certificate up through the public networkcalc.com API, then decodes the
   PEM in the browser (key, signature, names, policies) and runs the checks locally.
   It reads the server's leaf certificate only: no chain, protocol or cipher testing. */
(function () {
  'use strict';

  var form = document.getElementById('ssl-form');
  var input = document.getElementById('domain-input');
  var checkBtn = document.getElementById('check-btn');
  var clearBtn = document.getElementById('clear-btn');
  var statusEl = document.getElementById('status');
  var resultsEl = document.getElementById('results');
  var explainEl = document.getElementById('ssl-explain');
  var recentEl = document.getElementById('ssl-recent');
  if (!form || !input || !checkBtn || !statusEl || !resultsEl) return;

  var API = 'https://networkcalc.com/api/security/certificate/';
  var PROXY = 'https://api.codetabs.com/v1/proxy?quest=';
  var RECENT_KEY = 'tooladda-ssl-recent';
  var DAY = 86400000;
  var runToken = 0;
  var last = null; // { host, cert, info, checks, verdict }

  /* ------------------------------------------------------------------ utils */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(d) {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function plural(n, word) { return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's'); }
  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-error', !!isError);
  }

  /* Accepts "Example.com", "https://example.com/path?x", " www.site.org ", IDNs. */
  function normalizeHost(raw) {
    var v = String(raw || '').trim();
    if (!v) return { error: 'Enter a domain name, for example google.com.' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'https://' + v;
    var host;
    try { host = new URL(v).hostname; } catch (e) { return { error: 'That does not look like a domain name. Try something like example.com.' }; }
    host = host.replace(/\.$/, '').toLowerCase();
    if (host.charAt(0) === '[') return { error: 'IPv6 addresses are not supported — enter the site’s domain name instead.' };
    var isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (!isIp && (host.indexOf('.') === -1 || !/^[a-z0-9.-]+$/.test(host) || /(^|\.)-|-(\.|$)|\.\./.test(host))) {
      return { error: 'That does not look like a public domain. Include the ending, e.g. example.com or shop.example.in.' };
    }
    return { host: host };
  }

  /* ------------------------------------------------------------ DER parsing */
  function pemToDer(pem) {
    var b64 = String(pem || '').replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
    if (!b64) return null;
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function tlv(b, off) {
    var tag = b[off];
    var len = b[off + 1];
    var hdr = 2;
    if (len & 0x80) {
      var n = len & 0x7f;
      len = 0;
      for (var i = 0; i < n; i++) len = (len * 256) + b[off + 2 + i];
      hdr = 2 + n;
    }
    return { tag: tag, start: off + hdr, end: off + hdr + len, off: off, len: len };
  }
  function kids(b, node) {
    var out = [], p = node.start;
    while (p < node.end) { var k = tlv(b, p); out.push(k); p = k.end; }
    return out;
  }
  function oid(b, node) {
    var parts = [], v = 0, first = true;
    for (var i = node.start; i < node.end; i++) {
      v = (v * 128) + (b[i] & 0x7f);
      if (!(b[i] & 0x80)) {
        if (first) { parts.push(v < 80 ? Math.floor(v / 40) : 2, v < 80 ? v % 40 : v - 80); first = false; }
        else parts.push(v);
        v = 0;
      }
    }
    return parts.join('.');
  }
  function str(b, node) {
    var bytes = b.subarray(node.start, node.end);
    if (node.tag === 0x1e) { // BMPString
      var s = '';
      for (var i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return s;
    }
    try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return ''; }
  }
  function sameBytes(b, x, y) {
    if ((x.end - x.off) !== (y.end - y.off)) return false;
    for (var i = 0; i < x.end - x.off; i++) if (b[x.off + i] !== b[y.off + i]) return false;
    return true;
  }
  function parseName(b, node) {
    var out = {};
    kids(b, node).forEach(function (set) {
      kids(b, set).forEach(function (atv) {
        var p = kids(b, atv);
        if (p.length < 2) return;
        var key = { '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C' }[oid(b, p[0])];
        if (key && !out[key]) out[key] = str(b, p[1]);
      });
    });
    return out;
  }

  var SIG = {
    '1.2.840.113549.1.1.5': ['SHA-1 with RSA', 'weak'],
    '1.2.840.113549.1.1.4': ['MD5 with RSA', 'weak'],
    '1.2.840.113549.1.1.11': ['SHA-256 with RSA', 'ok'],
    '1.2.840.113549.1.1.12': ['SHA-384 with RSA', 'ok'],
    '1.2.840.113549.1.1.13': ['SHA-512 with RSA', 'ok'],
    '1.2.840.113549.1.1.10': ['RSA-PSS', 'ok'],
    '1.2.840.10045.4.1': ['ECDSA with SHA-1', 'weak'],
    '1.2.840.10045.4.3.2': ['ECDSA with SHA-256', 'ok'],
    '1.2.840.10045.4.3.3': ['ECDSA with SHA-384', 'ok'],
    '1.2.840.10045.4.3.4': ['ECDSA with SHA-512', 'ok'],
    '1.3.101.112': ['Ed25519', 'ok']
  };
  var CURVE = { '1.2.840.10045.3.1.7': ['P-256', 256], '1.3.132.0.34': ['P-384', 384], '1.3.132.0.35': ['P-521', 521] };
  var POLICY = { '2.23.140.1.1': 'EV', '2.23.140.1.2.2': 'OV', '2.23.140.1.2.3': 'IV', '2.23.140.1.2.1': 'DV' };

  function decodeCert(der) {
    var info = {};
    var cert = tlv(der, 0);
    var tbs = kids(der, cert)[0];
    var t = kids(der, tbs);
    var i = (t[0].tag === 0xa0) ? 1 : 0;
    var sigOid = oid(der, kids(der, t[i + 1])[0]);
    info.sig = SIG[sigOid] ? { name: SIG[sigOid][0], strength: SIG[sigOid][1] } : { name: sigOid, strength: 'unknown' };
    info.issuer = parseName(der, t[i + 2]);
    info.subject = parseName(der, t[i + 4]);
    info.selfSigned = sameBytes(der, t[i + 2], t[i + 4]);

    var spki = kids(der, t[i + 5]);
    var alg = kids(der, spki[0]);
    var algOid = oid(der, alg[0]);
    if (algOid === '1.2.840.113549.1.1.1') {
      var bits = spki[1];
      var inner = tlv(der, bits.start + 1);
      var modulus = kids(der, inner)[0];
      var n = modulus.len;
      var p = modulus.start;
      while (n > 0 && der[p] === 0) { n--; p++; }
      var size = n * 8;
      if (n > 0) { var top = der[p]; while (!(top & 0x80)) { size--; top <<= 1; } }
      info.key = { type: 'RSA', bits: size, label: 'RSA ' + size + '-bit', strong: size >= 2048 };
    } else if (algOid === '1.2.840.10045.2.1') {
      var curve = alg[1] ? CURVE[oid(der, alg[1])] : null;
      info.key = curve
        ? { type: 'EC', bits: curve[1], label: 'ECDSA ' + curve[0], strong: curve[1] >= 256 }
        : { type: 'EC', bits: 0, label: 'ECDSA', strong: true };
    } else if (algOid === '1.3.101.112') {
      info.key = { type: 'Ed25519', bits: 256, label: 'Ed25519', strong: true };
    } else {
      info.key = { type: algOid, bits: 0, label: algOid, strong: null };
    }

    t.forEach(function (node) {
      if (node.tag !== 0xa3) return;
      kids(der, kids(der, node)[0]).forEach(function (ext) {
        var e = kids(der, ext);
        if (oid(der, e[0]) !== '2.5.29.32') return;
        var octet = e[e.length - 1];
        kids(der, tlv(der, octet.start)).forEach(function (pol) {
          var id = oid(der, kids(der, pol)[0]);
          if (POLICY[id] && !info.validation) info.validation = POLICY[id];
        });
      });
    });
    return info;
  }

  function hexColon(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16).toUpperCase()).slice(-2); }).join(':');
  }

  /* ------------------------------------------------------------ name match */
  function sanList(cert) {
    return (cert.alternate_names || []).map(function (s) { return String(s).replace(/^DNS:/i, '').trim().toLowerCase(); }).filter(Boolean);
  }
  function nameCovers(pattern, host) {
    if (pattern === host) return true;
    if (pattern.indexOf('*.') === 0) {
      var rest = pattern.slice(2);
      var dot = host.indexOf('.');
      return dot > 0 && host.slice(dot + 1) === rest;
    }
    return false;
  }

  /* ------------------------------------------------------------ fetching */
  function fetchJson(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  function lookup(host) {
    var url = API + encodeURIComponent(host);
    return fetchJson(url, 15000).catch(function () {
      return fetchJson(PROXY + encodeURIComponent(url), 20000);
    });
  }

  /* ------------------------------------------------------------ analysis */
  function analyse(host, cert, info) {
    var now = Date.now();
    var from = new Date(cert.valid_from), to = new Date(cert.valid_to);
    var life = Math.max(1, Math.round((to - from) / DAY));
    var daysLeft = Math.ceil((to - now) / DAY);
    var notYet = from.getTime() > now;
    var expired = to.getTime() < now;
    var sans = sanList(cert);
    var names = sans.length ? sans : [String(cert.issued_to || '').toLowerCase()];
    var covered = names.some(function (n) { return nameCovers(n, host); });

    var checks = [];
    if (expired) checks.push({ s: 'fail', t: 'Certificate has expired', d: 'It expired on ' + fmtDate(to) + ' — ' + plural(-daysLeft, 'day') + ' ago. Browsers show a full-page warning.' });
    else if (notYet) checks.push({ s: 'fail', t: 'Not valid yet', d: 'It only becomes valid on ' + fmtDate(from) + '. Check the server clock or the certificate that was installed.' });
    else checks.push({ s: 'pass', t: 'Within its validity period', d: 'Valid from ' + fmtDate(from) + ' until ' + fmtDate(to) + '.' });

    if (covered) checks.push({ s: 'pass', t: 'Covers ' + host, d: 'The name is listed on the certificate, so browsers accept it for this address.' });
    else checks.push({ s: 'fail', t: 'Does not cover ' + host, d: 'Issued for ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') + '. Browsers will show a name-mismatch error.' });

    if (!expired && !notYet) {
      if (daysLeft > 30) checks.push({ s: 'pass', t: plural(daysLeft, 'day') + ' until renewal is due', d: 'Comfortable runway. Most automated certificates renew around 30 days before expiry.' });
      else checks.push({ s: 'warn', t: 'Expires in ' + plural(daysLeft, 'day'), d: 'Renew soon. If renewal is automated, check that it actually ran.' });
    }

    if (info && info.key) {
      if (info.key.strong === true) checks.push({ s: 'pass', t: 'Strong key: ' + info.key.label, d: info.key.type === 'RSA' ? 'RSA keys of 2048 bits or more meet today’s baseline.' : 'Elliptic-curve keys give strong security with small certificates.' });
      else if (info.key.strong === false) checks.push({ s: 'fail', t: 'Weak key: ' + info.key.label, d: 'Keys under 2048-bit RSA are rejected by modern browsers. Reissue with a stronger key.' });
      else checks.push({ s: 'info', t: 'Key type: ' + info.key.label, d: 'Uncommon key algorithm — could not rate its strength.' });
    }
    if (info && info.sig) {
      if (info.sig.strength === 'ok') checks.push({ s: 'pass', t: 'Modern signature: ' + info.sig.name, d: 'Signed with a hash that browsers still trust.' });
      else if (info.sig.strength === 'weak') checks.push({ s: 'fail', t: 'Weak signature: ' + info.sig.name, d: 'SHA-1 and MD5 signatures are no longer trusted. Reissue the certificate.' });
    }

    var cutoff = new Date('2020-09-01T00:00:00Z');
    if (from >= cutoff) {
      if (life <= 398) checks.push({ s: 'pass', t: 'Lifetime of ' + plural(life, 'day'), d: 'Within the 398-day maximum that browsers enforce for public certificates.' });
      else checks.push({ s: 'fail', t: 'Lifetime of ' + plural(life, 'day'), d: 'Longer than the 398-day maximum — Safari and Chrome reject such certificates.' });
    } else {
      checks.push({ s: 'info', t: 'Lifetime of ' + plural(life, 'day'), d: 'Issued before the 398-day limit took effect in September 2020.' });
    }

    if (info) {
      if (info.selfSigned) checks.push({ s: 'fail', t: 'Self-signed', d: 'Issued by itself rather than a certificate authority, so browsers do not trust it.' });
      else checks.push({ s: 'pass', t: 'Issued by a certificate authority', d: (cert.issued_by || info.issuer.CN || 'A CA') + (info.issuer.O ? ' (' + info.issuer.O + ')' : '') + '.' });
    }

    var fails = checks.filter(function (c) { return c.s === 'fail'; });
    var warns = checks.filter(function (c) { return c.s === 'warn'; });
    var verdict;
    if (fails.length) verdict = { s: 'fail', kicker: plural(fails.length, 'problem') + ' found', title: expired ? 'This certificate has expired' : (!covered ? 'Certificate does not match this domain' : fails[0].t) };
    else if (warns.length) verdict = { s: 'warn', kicker: 'Valid · needs attention', title: 'Certificate is valid but expires soon' };
    else verdict = { s: 'pass', kicker: 'All checks passed', title: 'Certificate is valid and healthy' };

    return {
      from: from, to: to, life: life, daysLeft: daysLeft, expired: expired, notYet: notYet,
      sans: sans, covered: covered, checks: checks, verdict: verdict,
      fraction: expired ? 0 : notYet ? 1 : Math.max(0, Math.min(1, (to - now) / (to - from)))
    };
  }

  /* ------------------------------------------------------------ rendering */
  var ICON = {
    pass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.4 8.6-7 10-3.6-1.4-7-5-7-10V6z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.4 8.6-7 10-3.6-1.4-7-5-7-10V6z"/><path d="M12 8v4.5"/><path d="M12 16h.01"/></svg>',
    fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.4 8.6-7 10-3.6-1.4-7-5-7-10V6z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg>'
  };
  var MARK = { pass: '✓', warn: '!', fail: '✕', info: 'i' };

  function ring(a) {
    var r = 46, c = 2 * Math.PI * r;
    var off = c * (1 - a.fraction);
    var big = a.expired ? Math.abs(a.daysLeft) : a.notYet ? 0 : a.daysLeft;
    var label = a.expired ? 'days ago' : a.notYet ? 'not valid yet' : (a.daysLeft === 1 ? 'day left' : 'days left');
    return '<div class="ssl-ring" role="img" aria-label="' + esc(big + ' ' + label) + '">' +
      '<svg viewBox="0 0 108 108"><circle class="track" cx="54" cy="54" r="' + r + '" fill="none" stroke-width="9"/>' +
      '<circle class="bar" cx="54" cy="54" r="' + r + '" fill="none" stroke-width="9" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>' +
      '<div class="ssl-ring-label"><strong>' + big.toLocaleString() + '</strong><span>' + label + '</span></div></div>';
  }

  function row(label, value, opts) {
    opts = opts || {};
    return '<div class="ssl-row"><dt>' + esc(label) + '</dt><dd' + (opts.mono ? ' class="mono"' : '') + '>' + value + '</dd>' +
      (opts.copy ? '<button type="button" class="ssl-copy" data-copy="' + esc(opts.copy) + '">Copy</button>' : '<span></span>') + '</div>';
  }

  function render(host, cert, info, a, sha256) {
    var v = a.verdict;
    var issuerLabel = esc(cert.issued_by || (info && info.issuer.CN) || 'Unknown');
    var sub = 'For <strong>' + esc(host) + '</strong> · issued by <strong>' + issuerLabel + '</strong>' +
      (info && info.issuer.O ? ' (' + esc(info.issuer.O) + ')' : '');

    var verdictHtml =
      '<section class="ssl-card ssl-verdict ' + v.s + '" aria-labelledby="ssl-verdict-title">' +
      '<div class="ssl-verdict-icon" aria-hidden="true">' + ICON[v.s] + '</div>' +
      '<div><p class="ssl-verdict-kicker">' + esc(v.kicker) + '</p><h2 id="ssl-verdict-title">' + esc(v.title) + '</h2>' +
      '<p class="ssl-verdict-sub">' + sub + '</p></div>' + ring(a) + '</section>';

    var checksHtml =
      '<section class="ssl-card" aria-labelledby="ssl-checks-title"><h2 id="ssl-checks-title">Health checks <small>' +
      a.checks.filter(function (c) { return c.s === 'pass'; }).length + ' of ' + a.checks.length + ' passed</small></h2>' +
      '<div class="ssl-checks">' + a.checks.map(function (c) {
        return '<div class="ssl-check ' + c.s + '"><span class="ssl-check-badge" aria-hidden="true">' + MARK[c.s] + '</span>' +
          '<div><strong><span class="ssl-sr">' + ({ pass: 'Pass: ', warn: 'Warning: ', fail: 'Fail: ', info: 'Info: ' })[c.s] + '</span>' + esc(c.t) + '</strong><span>' + esc(c.d) + '</span></div></div>';
      }).join('') + '</div></section>';

    var nowPct = a.expired ? 100 : a.notYet ? 0 : Math.round((1 - a.fraction) * 1000) / 10;
    var fillClass = a.expired ? 'fail' : (a.daysLeft <= 30 ? 'warn' : '');
    var timelineHtml =
      '<section class="ssl-card" aria-labelledby="ssl-tl-title"><h2 id="ssl-tl-title">Validity timeline <small>' + plural(a.life, 'day') + ' lifetime</small></h2>' +
      '<div class="ssl-timeline" style="margin-top:1.6rem"><div class="ssl-tl-bar"><div class="ssl-tl-fill ' + fillClass + '" style="width:' + nowPct + '%"></div></div>' +
      '<div class="ssl-tl-now' + (nowPct > 85 ? ' edge-r' : nowPct < 15 ? ' edge-l' : '') + '" style="left:' + nowPct + '%" data-label="Today"></div></div>' +
      '<div class="ssl-tl-legend"><div>Issued<strong>' + esc(fmtDate(a.from)) + '</strong></div><div>' + (a.expired ? 'Expired' : 'Expires') + '<strong>' + esc(fmtDate(a.to)) + '</strong></div></div></section>';

    var keyVal = info && info.key ? esc(info.key.label) : '—';
    var detailsHtml =
      '<section class="ssl-card" aria-labelledby="ssl-details-title"><h2 id="ssl-details-title">Certificate details</h2><dl class="ssl-details">' +
      row('Issued to', esc(cert.issued_to || '—') + (info && info.subject.O ? '<small>' + esc(info.subject.O) + '</small>' : '')) +
      row('Issued by', issuerLabel + (info && info.issuer.O ? '<small>' + esc(info.issuer.O) + (info.issuer.C ? ' · ' + esc(info.issuer.C) : '') + '</small>' : '')) +
      (info && info.validation ? row('Validation', esc({ DV: 'Domain validated', OV: 'Organisation validated', EV: 'Extended validation', IV: 'Individual validated' }[info.validation]) + '<span class="ssl-tag">' + info.validation + '</span>') : '') +
      row('Valid from', esc(a.from.toUTCString().replace(' GMT', ' UTC'))) +
      row('Valid until', esc(a.to.toUTCString().replace(' GMT', ' UTC'))) +
      row('Public key', keyVal) +
      (info && info.sig ? row('Signature', esc(info.sig.name)) : '') +
      row('Serial number', esc(cert.serial_number || '—'), { mono: true, copy: cert.serial_number }) +
      (sha256 ? row('SHA-256 fingerprint', esc(sha256), { mono: true, copy: sha256 }) : '') +
      row('SHA-1 fingerprint', esc(cert.fingerprint || '—'), { mono: true, copy: cert.fingerprint }) +
      '</dl></section>';

    var SHOW = 12;
    var sansHtml =
      '<section class="ssl-card" aria-labelledby="ssl-sans-title"><h2 id="ssl-sans-title">Names covered <small>' + plural(a.sans.length, 'name') + '</small></h2>' +
      (a.sans.length ? '<div class="ssl-sans">' + a.sans.map(function (n, i) {
        return '<span class="ssl-san' + (nameCovers(n, host) ? ' is-match' : '') + (i >= SHOW ? ' is-hidden' : '') + '">' + esc(n) + '</span>';
      }).join('') + '</div>' + (a.sans.length > SHOW ? '<button type="button" class="ssl-btn" data-act="more-sans" style="margin-top:.7rem">Show all ' + a.sans.length + '</button>' : '')
        : '<p class="ssl-note" style="margin:0">No subject alternative names listed.</p>') + '</section>';

    var canRemind = !a.expired;
    var actionsHtml =
      '<section class="ssl-card" aria-label="Actions"><div class="ssl-actions">' +
      '<button type="button" class="ssl-btn primary" data-act="copy-report">📋 Copy report</button>' +
      (canRemind ? '<button type="button" class="ssl-btn" data-act="reminder">📅 Add renewal reminder</button>' : '') +
      (cert.raw ? '<button type="button" class="ssl-btn" data-act="pem">⬇️ Download .pem</button>' : '') +
      '<button type="button" class="ssl-btn" data-act="share">🔗 Copy share link</button>' +
      '<button type="button" class="ssl-btn" data-act="recheck">↻ Check again</button>' +
      '</div><p class="ssl-note">Checked ' + esc(new Date().toLocaleString()) + '. This reads the certificate the server presents; it does not test the intermediate chain, protocol versions or cipher suites.</p></section>';

    resultsEl.innerHTML = verdictHtml + '<div class="ssl-grid-2"><div style="display:grid;gap:1rem">' + checksHtml + timelineHtml + '</div><div style="display:grid;gap:1rem">' + detailsHtml + sansHtml + '</div></div>' + actionsHtml;
  }

  function renderError(host, message) {
    resultsEl.innerHTML =
      '<section class="ssl-card ssl-error" role="alert"><h2>⚠️ Couldn’t check ' + esc(host) + '</h2>' +
      '<ul><li>' + esc(message) + '</li><li>Check the spelling, and that the site opens with <strong>https://</strong> in your browser.</li>' +
      '<li>Private, internal or firewalled hosts can’t be reached from the public lookup service.</li></ul>' +
      '<div class="ssl-actions"><button type="button" class="ssl-btn primary" data-act="recheck">↻ Try again</button></div></section>';
  }

  function renderLoading() {
    resultsEl.innerHTML = '<div class="ssl-skel" aria-hidden="true"></div><div class="ssl-grid-2"><div class="ssl-skel tall" aria-hidden="true"></div><div class="ssl-skel tall" aria-hidden="true"></div></div>';
  }

  /* ------------------------------------------------------------ recent */
  function readRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6); } catch (e) { return []; } }
  function saveRecent(host, state) {
    var list = readRecent().filter(function (r) { return r.h !== host; });
    list.unshift({ h: host, s: state });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch (e) {}
    drawRecent();
  }
  function drawRecent() {
    if (!recentEl) return;
    var list = readRecent();
    recentEl.hidden = !list.length;
    recentEl.innerHTML = list.length ? '<span>Recent:</span>' + list.map(function (r) {
      return '<button type="button" class="ssl-chip-btn" data-try="' + esc(r.h) + '"><span class="ssl-dot ' + esc(r.s) + '"></span>' + esc(r.h) + '</button>';
    }).join('') + '<button type="button" class="ssl-link-btn" data-act="clear-recent">Clear</button>' : '';
  }

  /* ------------------------------------------------------------ actions */
  function copyText(text, btn, doneLabel) {
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = doneLabel || 'Copied ✓';
      btn.classList.add('is-done');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('is-done'); }, 1600);
    };
    var fallback = function () {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.left = '-9999px';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { setStatus('Copy failed — select the text and copy it manually.', true); }
      document.body.removeChild(t);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  function download(name, type, text) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click();
    setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 500);
  }
  function report() {
    var a = last.analysis, c = last.cert, i = last.info;
    var lines = [
      'SSL certificate report — ' + last.host,
      a.verdict.title + ' (' + a.verdict.kicker + ')',
      '',
      'Issued to: ' + (c.issued_to || '—'),
      'Issued by: ' + (c.issued_by || '—') + (i && i.issuer.O ? ' (' + i.issuer.O + ')' : ''),
      'Valid: ' + fmtDate(a.from) + ' → ' + fmtDate(a.to) + (a.expired ? ' (expired)' : ' (' + plural(a.daysLeft, 'day') + ' left)'),
      i && i.key ? 'Key: ' + i.key.label : null,
      i && i.sig ? 'Signature: ' + i.sig.name : null,
      'Names: ' + a.sans.join(', '),
      '',
      'Checks:'
    ].filter(function (l) { return l !== null; });
    a.checks.forEach(function (ch) { lines.push('  [' + ch.s.toUpperCase() + '] ' + ch.t); });
    lines.push('', 'Checked with ToolAdda SSL Checker — ' + location.origin + location.pathname + '?domain=' + encodeURIComponent(last.host));
    return lines.join('\n');
  }
  function ics() {
    var a = last.analysis, host = last.host;
    var remind = new Date(Math.max(Date.now() + DAY, a.to.getTime() - 14 * DAY));
    var d = function (x) { return x.toISOString().slice(0, 10).replace(/-/g, ''); };
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ToolAdda//SSL Checker//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:ssl-' + host + '-' + d(a.to) + '@tooladda.online',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + d(remind),
      'SUMMARY:Renew SSL certificate for ' + host,
      'DESCRIPTION:The SSL certificate for ' + host + ' expires on ' + fmtDate(a.to) + ' (issued by ' + String(last.cert.issued_by || 'unknown CA').replace(/[,;\\]/g, ' ') + ').',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Renew SSL certificate for ' + host, 'TRIGGER:-PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
  }

  resultsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.copy) { copyText(btn.dataset.copy, btn); return; }
    var act = btn.dataset.act;
    if (act === 'recheck') { run(); return; }
    if (!last) return;
    if (act === 'copy-report') copyText(report(), btn);
    else if (act === 'pem') download(last.host + '.pem', 'application/x-pem-file', String(last.cert.raw).replace(/\r?\n/g, '\n') + '\n');
    else if (act === 'reminder') download('renew-ssl-' + last.host + '.ics', 'text/calendar', ics());
    else if (act === 'share') copyText(location.origin + location.pathname + '?domain=' + encodeURIComponent(last.host), btn, 'Link copied ✓');
    else if (act === 'more-sans') {
      resultsEl.querySelectorAll('.ssl-san.is-hidden').forEach(function (el) { el.classList.remove('is-hidden'); });
      btn.remove();
    }
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-try], [data-act="clear-recent"]');
    if (!t || resultsEl.contains(t)) return;
    if (t.dataset.act === 'clear-recent') {
      try { localStorage.removeItem(RECENT_KEY); } catch (err) {}
      drawRecent();
      return;
    }
    input.value = t.dataset.try;
    syncClear();
    run();
  });

  /* ------------------------------------------------------------ main */
  /* Bring the verdict (or error) into view once a check finishes, below the sticky header. */
  function scrollToResults() {
    var first = resultsEl.firstElementChild;
    if (!first) return;
    var header = document.querySelector('.site-header');
    // +24: the header grows slightly into its "scrolled" style once the page moves.
    var offset = (header ? Math.max(0, header.getBoundingClientRect().bottom) : 80) + 24;
    var top = first.getBoundingClientRect().top + window.pageYOffset - offset;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }

  function syncClear() { if (clearBtn) clearBtn.hidden = !input.value; }

  function run() {
    var n = normalizeHost(input.value);
    if (n.error) { setStatus(n.error, true); input.focus(); return; }
    var host = n.host;
    input.value = host;
    syncClear();
    var token = ++runToken;
    if (explainEl) explainEl.hidden = true;
    checkBtn.disabled = true;
    checkBtn.innerHTML = '<span class="ssl-spin" aria-hidden="true"></span> Checking…';
    setStatus('Looking up the certificate for ' + host + '…');
    renderLoading();
    try { history.replaceState(null, '', location.pathname + '?domain=' + encodeURIComponent(host)); } catch (e) {}

    lookup(host).then(function (json) {
      if (token !== runToken) return null;
      if (!json || json.status !== 'OK' || !json.certificate || !json.certificate.valid_to) {
        throw new Error('No certificate came back. The domain may not exist, may not serve HTTPS, or blocked the lookup.');
      }
      var cert = json.certificate;
      var info = null, der = null;
      try { der = pemToDer(cert.raw); if (der) info = decodeCert(der); } catch (e) { info = null; }
      var analysis = analyse(host, cert, info);
      var shaPromise = (der && window.crypto && crypto.subtle)
        ? crypto.subtle.digest('SHA-256', der).then(hexColon).catch(function () { return ''; })
        : Promise.resolve('');
      return shaPromise.then(function (sha) {
        if (token !== runToken) return;
        last = { host: host, cert: cert, info: info, analysis: analysis };
        render(host, cert, info, analysis, sha);
        setStatus('');
        saveRecent(host, analysis.verdict.s);
        scrollToResults();
      });
    }).catch(function (err) {
      if (token !== runToken) return;
      last = null;
      var msg = err && err.name === 'AbortError'
        ? 'The lookup service took too long to answer.'
        : (err && err.message && err.message.indexOf('No certificate') === 0 ? err.message : 'The certificate lookup service could not be reached, or it could not connect to this domain.');
      renderError(host, msg);
      setStatus('');
      saveRecent(host, 'err');
      scrollToResults();
    }).finally(function () {
      if (token !== runToken) return;
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check certificate';
    });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
  input.addEventListener('input', syncClear);
  if (clearBtn) clearBtn.addEventListener('click', function () {
    runToken++;
    input.value = '';
    syncClear();
    resultsEl.innerHTML = '';
    last = null;
    if (explainEl) explainEl.hidden = false;
    checkBtn.disabled = false;
    checkBtn.textContent = 'Check certificate';
    setStatus('');
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    input.focus();
  });

  drawRecent();
  var q = new URLSearchParams(location.search).get('domain');
  if (q) { input.value = q; syncClear(); run(); }
})();
