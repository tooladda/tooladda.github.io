(function () {
  'use strict';
  var root = document.querySelector('[data-dns-page]');
  if (!root) return;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  /* ---------------- record type metadata ---------------- */
  var TYPE_META = {
    A: { label: 'A', desc: 'IPv4 address' },
    AAAA: { label: 'AAAA', desc: 'IPv6 address' },
    CNAME: { label: 'CNAME', desc: 'Canonical name / alias' },
    MX: { label: 'MX', desc: 'Mail exchange server' },
    TXT: { label: 'TXT', desc: 'Text record (SPF, verification, etc.)' },
    NS: { label: 'NS', desc: 'Authoritative name server' },
    SOA: { label: 'SOA', desc: 'Start of authority' },
    CAA: { label: 'CAA', desc: 'Certificate authority authorization' },
    PTR: { label: 'PTR', desc: 'Reverse DNS pointer' },
    SRV: { label: 'SRV', desc: 'Service locator' },
    NAPTR: { label: 'NAPTR', desc: 'Naming authority pointer' },
    DNSKEY: { label: 'DNSKEY', desc: 'DNSSEC public key' },
    DS: { label: 'DS', desc: 'DNSSEC delegation signer' },
    TLSA: { label: 'TLSA', desc: 'DANE TLS association' },
    SSHFP: { label: 'SSHFP', desc: 'SSH public key fingerprint' },
    LOC: { label: 'LOC', desc: 'Geographic location' },
    RP: { label: 'RP', desc: 'Responsible person' },
    HINFO: { label: 'HINFO', desc: 'Host information' }
  };
  var CORE_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'];
  var ADVANCED_TYPES = ['PTR', 'SRV', 'NAPTR', 'DNSKEY', 'DS', 'TLSA', 'SSHFP', 'LOC', 'RP', 'HINFO'];
  var TYPE_NUM = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 13: 'HINFO', 15: 'MX', 16: 'TXT', 17: 'RP', 28: 'AAAA', 29: 'LOC', 33: 'SRV', 35: 'NAPTR', 43: 'DS', 44: 'SSHFP', 46: 'RRSIG', 47: 'NSEC', 48: 'DNSKEY', 50: 'NSEC3', 52: 'TLSA', 257: 'CAA' };
  var RCODE = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

  var DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'mail', 'dkim', 'smtp'];

  /* ---------------- validation / normalization ---------------- */
  var HOSTNAME_RE = /^(?=.{1,253}$)(?:(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])\.)+[a-zA-Z]{2,63}$/;
  var IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  var IPV6_RE = /^([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}$|^::$|^::1$/;

  function normalizeDomainInput(raw) {
    var v = String(raw || '').trim().toLowerCase();
    v = v.replace(/^[a-z]+:\/\//, '');
    v = v.split('/')[0].split('?')[0].split('#')[0];
    if (!IPV6_RE.test(v)) v = v.split(':')[0];
    v = v.replace(/\.+$/, '');
    return v;
  }

  function toAscii(domain) {
    if (IPV4_RE.test(domain) || IPV6_RE.test(domain)) return domain;
    try { return new URL('http://' + domain + '/').hostname; } catch (e) { return domain; }
  }

  function isValidTarget(domain) {
    if (!domain) return false;
    if (IPV4_RE.test(domain)) return true;
    if (IPV6_RE.test(domain) && domain.indexOf(':') !== -1) return true;
    return HOSTNAME_RE.test(domain);
  }

  function reverseArpaV4(ip) {
    return ip.split('.').reverse().join('.') + '.in-addr.arpa';
  }
  function reverseArpaV6(ip) {
    var parts = ip.split('::');
    var head = parts[0] ? parts[0].split(':') : [];
    var tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
    var groups = head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill('0')).concat(tail);
    if (parts.length === 1) groups = ip.split(':');
    var full = groups.map(function (g) { return (g || '0').padStart(4, '0'); }).join('');
    return full.split('').reverse().join('.') + '.ip6.arpa';
  }

  /* ---------------- DoH query ---------------- */
  function dohQuery(name, type, signal) {
    var endpoints = [
      { url: 'https://dns.google/resolve?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), kind: 'Google Public DNS (8.8.8.8)', headers: {} },
      { url: 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), kind: 'Cloudflare DNS (1.1.1.1)', headers: { Accept: 'application/dns-json' } }
    ];
    var i = 0;
    function attempt() {
      if (i >= endpoints.length) return Promise.reject(new Error('All public DNS resolvers failed to respond.'));
      var ep = endpoints[i++];
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      return fetch(ep.url, { headers: ep.headers, signal: signal }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (json) {
        var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
        json._server = ep.kind;
        json._ms = Math.round(t1 - t0);
        json._type = type;
        json._name = name;
        return json;
      }).catch(function (err) {
        if (err && err.name === 'AbortError') throw err;
        return attempt();
      });
    }
    return attempt();
  }

  /* ---------------- record data parsing ---------------- */
  function parseDetail(type, data) {
    switch (type) {
      case 'MX': {
        var m = data.match(/^(\d+)\s+(.+)$/);
        return m ? { priority: m[1], target: m[2].replace(/\.$/, '') } : {};
      }
      case 'SRV': {
        var s = data.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
        return s ? { priority: s[1], weight: s[2], port: s[3], target: s[4].replace(/\.$/, '') } : {};
      }
      case 'SOA': {
        var p = data.split(/\s+/);
        return { mname: p[0], rname: p[1], serial: p[2], refresh: p[3], retry: p[4], expire: p[5], minimum: p[6] };
      }
      case 'CAA': {
        var c = data.match(/^(\d+)\s+(\S+)\s+"?([^"]*)"?$/);
        return c ? { flag: c[1], tag: c[2], value: c[3] } : {};
      }
      case 'NAPTR': {
        var n = data.match(/^(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s+(.+)$/);
        return n ? { order: n[1], pref: n[2], flags: n[3], service: n[4], regexp: n[5], replacement: n[6] } : {};
      }
      case 'TXT':
        return { text: data.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/"\s+"/g, '') };
      case 'DS': {
        var ds = data.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
        return ds ? { keyTag: ds[1], algorithm: ds[2], digestType: ds[3], digest: ds[4] } : {};
      }
      case 'SSHFP': {
        var sf = data.match(/^(\d+)\s+(\d+)\s+(.+)$/);
        return sf ? { algorithm: sf[1], fpType: sf[2], fingerprint: sf[3] } : {};
      }
      default:
        return {};
    }
  }

  function cleanTxt(data) { return parseDetail('TXT', data).text; }

  /* ---------------- provider / security heuristics ---------------- */
  var PROVIDER_SIGNATURES = [
    { name: 'Cloudflare', kind: 'CDN / DNS', match: /cloudflare/i },
    { name: 'Amazon Web Services', kind: 'Cloud / DNS', match: /awsdns|amazonaws\.com/i },
    { name: 'Google Cloud', kind: 'Cloud / DNS', match: /googledomains\.com|google\.com|ghs\.google\.com|googlehosted/i },
    { name: 'Microsoft Azure', kind: 'Cloud / DNS', match: /azure-dns|trafficmanager\.net|azurewebsites\.net/i },
    { name: 'Akamai', kind: 'CDN', match: /akamai/i },
    { name: 'Fastly', kind: 'CDN', match: /fastly/i },
    { name: 'Vercel', kind: 'Hosting', match: /vercel-dns|vercel\.app/i },
    { name: 'Netlify', kind: 'Hosting', match: /netlify/i },
    { name: 'GoDaddy', kind: 'Registrar / DNS', match: /domaincontrol\.com/i },
    { name: 'Namecheap', kind: 'Registrar / DNS', match: /registrar-servers\.com/i },
    { name: 'DigitalOcean', kind: 'Cloud', match: /digitalocean\.com/i },
    { name: 'GitHub Pages', kind: 'Hosting', match: /github\.io|github\.com/i },
    { name: 'Shopify', kind: 'Platform', match: /shopify/i },
    { name: 'Squarespace', kind: 'Platform', match: /squarespace/i },
    { name: 'Wix', kind: 'Platform', match: /wixdns\.net|wix\.com/i }
  ];

  function detectProviders(haystack) {
    var found = {};
    PROVIDER_SIGNATURES.forEach(function (p) {
      if (p.match.test(haystack)) found[p.name] = p.kind;
    });
    return Object.keys(found).map(function (name) { return { name: name, kind: found[name] }; });
  }

  /* ---------------- state ---------------- */
  var HISTORY_KEY = 'tooladda_dns_history_v1';
  function loadHistory() {
    try { return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { /* ignore */ }
  }
  function pushHistory(domain) {
    var list = loadHistory().filter(function (d) { return d !== domain; });
    list.unshift(domain);
    saveHistory(list);
    renderHistory();
  }

  var lastResult = null;
  var abortCtrl = null;

  /* ---------------- DOM refs ---------------- */
  var input = $('[data-domain-input]', root);
  var typeSelect = $('[data-type-select]', root);
  var lookupBtn = $('[data-lookup-btn]', root);
  var errorBox = $('[data-dl-error]', root);
  var loadingBox = $('[data-dl-loading]', root);
  var emptyBox = $('[data-dl-empty]', root);
  var failBox = $('[data-dl-fail]', root);
  var failMsg = $('[data-dl-fail-msg]', root);
  var resultsBox = $('[data-dl-results]', root);
  var recordsGrid = $('[data-records-grid]', root);
  var summaryBar = $('[data-dl-summary]', root);
  var historyRow = $('[data-history-row]', root);
  var historyChips = $('[data-history-chips]', root);
  var emailPanel = $('[data-email-security]', root);
  var providerBadges = $('[data-provider-badges]', root);
  var recommendationsBox = $('[data-recommendations]', root);
  var healthScoreEl = $('[data-health-score]', root);

  function setState(state) {
    [loadingBox, emptyBox, failBox, resultsBox].forEach(function (el) { if (el) el.classList.add('hidden'); });
    var map = { loading: loadingBox, empty: emptyBox, fail: failBox, results: resultsBox };
    if (map[state]) map[state].classList.remove('hidden');
  }

  function flashError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg;
    if (msg) window.setTimeout(function () { if (errorBox.textContent === msg) errorBox.textContent = ''; }, 4000);
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = '✅ Copied';
        window.setTimeout(function () { btn.textContent = orig; }, 1400);
      }
    } catch (e) {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      document.body.removeChild(ta);
    }
  }

  /* ---------------- history render ---------------- */
  function renderHistory() {
    var list = loadHistory();
    if (!historyRow) return;
    if (!list.length) { historyRow.classList.add('hidden'); return; }
    historyRow.classList.remove('hidden');
    historyChips.innerHTML = list.map(function (d) {
      return '<button type="button" class="dl-chip" data-history-item="' + escapeHtml(d) + '">' + escapeHtml(d) + '</button>';
    }).join('');
  }

  /* ---------------- rendering ---------------- */
  function typeCardHtml(type, answers, meta) {
    var rows = answers.map(function (a) {
      var detail = parseDetail(type, a.data);
      var valueHtml;
      switch (type) {
        case 'MX':
          valueHtml = '<span class="dl-pill">Priority ' + escapeHtml(detail.priority) + '</span> <code>' + escapeHtml(detail.target) + '</code>';
          break;
        case 'SRV':
          valueHtml = '<span class="dl-pill">Priority ' + escapeHtml(detail.priority) + '</span><span class="dl-pill">Weight ' + escapeHtml(detail.weight) + '</span><span class="dl-pill">Port ' + escapeHtml(detail.port) + '</span> <code>' + escapeHtml(detail.target) + '</code>';
          break;
        case 'SOA':
          valueHtml = '<div class="dl-soa-grid">' +
            '<div><span>Primary NS</span><code>' + escapeHtml(detail.mname) + '</code></div>' +
            '<div><span>Admin email</span><code>' + escapeHtml((detail.rname || '').replace('.', '@')) + '</code></div>' +
            '<div><span>Serial</span><code>' + escapeHtml(detail.serial) + '</code></div>' +
            '<div><span>Refresh</span><code>' + escapeHtml(detail.refresh) + 's</code></div>' +
            '<div><span>Retry</span><code>' + escapeHtml(detail.retry) + 's</code></div>' +
            '<div><span>Expire</span><code>' + escapeHtml(detail.expire) + 's</code></div>' +
            '<div><span>Minimum TTL</span><code>' + escapeHtml(detail.minimum) + 's</code></div></div>';
          break;
        case 'CAA':
          valueHtml = '<span class="dl-pill">Flag ' + escapeHtml(detail.flag) + '</span><span class="dl-pill">' + escapeHtml(detail.tag) + '</span> <code>' + escapeHtml(detail.value) + '</code>';
          break;
        case 'TXT':
          valueHtml = '<code class="dl-txt">' + escapeHtml(detail.text) + '</code>';
          break;
        case 'NAPTR':
          valueHtml = '<code>' + escapeHtml(a.data) + '</code>';
          break;
        default:
          valueHtml = '<code>' + escapeHtml(a.data) + '</code>';
      }
      return '<li class="dl-record-row">' +
        '<div class="dl-record-value">' + valueHtml + '</div>' +
        '<div class="dl-record-meta"><span title="Time to live">TTL ' + a.TTL + 's</span><button type="button" class="dl-mini-copy" data-copy-value="' + escapeHtml(a.data) + '">Copy</button></div>' +
        '</li>';
    }).join('');
    return '<article class="dl-record-card" data-record-card="' + type + '">' +
      '<header class="dl-record-card-head"><h3>' + type + ' <span>' + escapeHtml(meta.desc) + '</span></h3><span class="dl-count-badge">' + answers.length + '</span></header>' +
      '<ul class="dl-record-list">' + rows + '</ul>' +
      '</article>';
  }

  function buildEmailSecurity(txtAnswers, dmarcAnswers) {
    var spf = null, dmarc = null;
    (txtAnswers || []).forEach(function (a) {
      var t = cleanTxt(a.data);
      if (/^v=spf1/i.test(t)) spf = t;
    });
    (dmarcAnswers || []).forEach(function (a) {
      var t = cleanTxt(a.data);
      if (/^v=dmarc1/i.test(t)) dmarc = t;
    });
    var cards = [];
    cards.push('<div class="dl-esec-card ' + (spf ? 'is-ok' : 'is-warn') + '">' +
      '<strong>' + (spf ? '✅' : '⚠️') + ' SPF Record</strong>' +
      (spf ? '<code>' + escapeHtml(spf) + '</code><p>Sender Policy Framework is published — mailbox providers can verify which servers may send mail for this domain.</p>' : '<p>No SPF record found in TXT records. Without SPF, receiving mail servers cannot verify authorized senders, increasing spoofing and spam risk.</p>') +
      '</div>');
    cards.push('<div class="dl-esec-card ' + (dmarc ? 'is-ok' : 'is-warn') + '">' +
      '<strong>' + (dmarc ? '✅' : '⚠️') + ' DMARC Record</strong>' +
      (dmarc ? '<code>' + escapeHtml(dmarc) + '</code><p>DMARC policy is published at _dmarc.' + escapeHtml(root._domain || '') + ', instructing receivers how to treat unauthenticated mail.</p>' : '<p>No DMARC record found at _dmarc subdomain. DMARC ties SPF and DKIM together and tells receivers what to do with mail that fails authentication.</p>') +
      '</div>');
    cards.push('<div class="dl-esec-card is-info" data-dkim-card>' +
      '<strong>🔎 DKIM Record</strong>' +
      '<p>DKIM keys live at a per-provider "selector" subdomain, so it can\'t be auto-discovered. Check common selectors:</p>' +
      '<button type="button" class="dl-btn-ghost" data-check-dkim>Check common DKIM selectors</button>' +
      '<div data-dkim-result></div></div>');
    return cards.join('');
  }

  function computeHealthScore(data) {
    var score = 0, max = 0, tips = [];
    function add(cond, pts, tipIfFail) { max += pts; if (cond) score += pts; else if (tipIfFail) tips.push(tipIfFail); }
    add((data.A && data.A.length) || (data.AAAA && data.AAAA.length), 15, 'Add an A or AAAA record so the domain resolves to an IP address.');
    add(data.NS && data.NS.length >= 2, 15, 'Use at least two authoritative name servers for redundancy.');
    add(!!data._dnssec, 15, 'Enable DNSSEC to protect against DNS spoofing and cache poisoning.');
    add(data.MX && data.MX.length > 0, 15, 'Add an MX record if this domain sends or receives email.');
    add(data._spfOk, 15, 'Publish an SPF TXT record to authorize your outgoing mail servers.');
    add(data._dmarcOk, 15, 'Publish a DMARC record to instruct receivers on handling unauthenticated mail.');
    add(data.CAA && data.CAA.length > 0, 10, 'Add a CAA record to restrict which certificate authorities may issue TLS certs for this domain.');
    var pct = max ? Math.round((score / max) * 100) : 0;
    return { pct: pct, tips: tips };
  }

  function renderResults(domain, type, results, meta) {
    lastResult = { domain: domain, type: type, results: results, fetchedAt: new Date().toISOString(), meta: meta };
    root._domain = domain;

    var haystack = [];
    Object.keys(results).forEach(function (t) {
      (results[t].answers || []).forEach(function (a) { haystack.push(a.data); });
    });
    var providers = detectProviders(haystack.join(' | '));

    var dnssec = Object.keys(results).some(function (t) { return results[t].AD && results[t].answers && results[t].answers.length; });
    var spfOk = (results.TXT && results.TXT.answers || []).some(function (a) { return /^v=spf1/i.test(cleanTxt(a.data)); });
    var dmarcOk = (results.DMARC && results.DMARC.answers || []).some(function (a) { return /^v=dmarc1/i.test(cleanTxt(a.data)); });

    var scoreData = {};
    CORE_TYPES.forEach(function (t) { scoreData[t] = results[t] ? results[t].answers : []; });
    scoreData._dnssec = dnssec; scoreData._spfOk = spfOk; scoreData._dmarcOk = dmarcOk;
    var health = computeHealthScore(scoreData);

    var totalRecords = Object.keys(results).reduce(function (n, t) { return n + (results[t].answers ? results[t].answers.length : 0); }, 0);
    var avgMs = Math.round(Object.keys(results).reduce(function (s, t) { return s + (results[t].ms || 0); }, 0) / Math.max(1, Object.keys(results).length));
    var server = (results[Object.keys(results)[0]] || {}).server || 'Public DNS';

    summaryBar.innerHTML =
      '<div class="dl-sum-item"><span>Domain</span><strong>' + escapeHtml(domain) + '</strong></div>' +
      '<div class="dl-sum-item"><span>Records found</span><strong>' + totalRecords + '</strong></div>' +
      '<div class="dl-sum-item"><span>Response time</span><strong>' + avgMs + ' ms</strong></div>' +
      '<div class="dl-sum-item"><span>Resolver</span><strong>' + escapeHtml(server) + '</strong></div>' +
      '<div class="dl-sum-item"><span>DNSSEC</span><strong class="' + (dnssec ? 'dl-ok' : 'dl-warn') + '">' + (dnssec ? 'Validated ✅' : 'Not detected') + '</strong></div>' +
      '<div class="dl-sum-item"><span>Looked up</span><strong>' + new Date().toLocaleTimeString() + '</strong></div>';

    healthScoreEl.innerHTML = '<div class="dl-score-ring" style="--pct:' + health.pct + '"><span>' + health.pct + '</span><small>/100</small></div><div class="dl-score-label">DNS Health Score</div>';

    var cardsHtml = CORE_TYPES.concat(type !== 'ALL' && ADVANCED_TYPES.indexOf(type) !== -1 ? [type] : [])
      .filter(function (t, i, arr) { return arr.indexOf(t) === i; })
      .map(function (t) {
        var r = results[t];
        if (!r || !r.answers || !r.answers.length) return '';
        return typeCardHtml(t, r.answers, TYPE_META[t]);
      }).filter(Boolean).join('');

    recordsGrid.innerHTML = cardsHtml || '<p class="dl-hint">No standard records were found for this query. Try a different record type or check the domain spelling.</p>';

    emailPanel.innerHTML = buildEmailSecurity(results.TXT && results.TXT.answers, results.DMARC && results.DMARC.answers);

    providerBadges.innerHTML = providers.length
      ? providers.map(function (p) { return '<span class="dl-provider-badge">' + escapeHtml(p.kind) + ': <b>' + escapeHtml(p.name) + '</b></span>'; }).join('')
      : '<span class="dl-provider-badge dl-provider-badge--muted">No known CDN / cloud provider signature detected</span>';

    recommendationsBox.innerHTML = health.tips.length
      ? '<ul>' + health.tips.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul>'
      : '<p class="dl-hint">✅ No major DNS misconfigurations detected — this domain follows core best practices.</p>';

    wireDynamicCopyButtons();
    setState('results');
    pushHistory(domain);
  }

  function wireDynamicCopyButtons() {
    $all('[data-copy-value]', root).forEach(function (btn) {
      btn.addEventListener('click', function () { copyText(btn.getAttribute('data-copy-value'), btn); });
    });
  }

  /* ---------------- DKIM prober ---------------- */
  function wireDkimProbe() {
    root.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-check-dkim]');
      if (!btn || !root._domain) return;
      btn.disabled = true; btn.textContent = 'Checking selectors…';
      var out = $('[data-dkim-result]', root);
      Promise.allSettled(DKIM_SELECTORS.map(function (sel) {
        return dohQuery(sel + '._domainkey.' + root._domain, 'TXT').then(function (json) {
          return { sel: sel, answers: (json.Answer || []).filter(function (a) { return TYPE_NUM[a.type] === 'TXT'; }) };
        });
      })).then(function (results) {
        var found = results.filter(function (r) { return r.status === 'fulfilled' && r.value.answers.length; }).map(function (r) { return r.value; });
        btn.disabled = false; btn.textContent = 'Check common DKIM selectors';
        if (!found.length) {
          out.innerHTML = '<p class="dl-hint">⚠️ No DKIM record found at common selectors (default, google, selector1/2, k1, mail, dkim, smtp). This domain may use a custom selector name — check your email provider\'s docs.</p>';
          return;
        }
        out.innerHTML = '<p class="dl-hint">✅ DKIM key(s) found:</p><ul class="dl-record-list">' + found.map(function (f) {
          return f.answers.map(function (a) {
            return '<li class="dl-record-row"><div class="dl-record-value"><span class="dl-pill">' + escapeHtml(f.sel) + '</span> <code class="dl-txt">' + escapeHtml(cleanTxt(a.data)) + '</code></div></li>';
          }).join('');
        }).join('') + '</ul>';
      });
    });
  }
  wireDkimProbe();

  /* ---------------- lookup orchestration ---------------- */
  async function runLookup(rawDomain, selectedType) {
    var domain = normalizeDomainInput(rawDomain);
    if (!domain) { flashError('Enter a domain name to look up.'); return; }
    var ascii = toAscii(domain);

    var isPtrLookup = selectedType === 'PTR' && (IPV4_RE.test(domain) || IPV6_RE.test(domain));
    var isAutoIp = (IPV4_RE.test(domain) || IPV6_RE.test(domain)) && selectedType === 'ALL';

    if (!isPtrLookup && !isAutoIp && !isValidTarget(ascii) && !IPV4_RE.test(domain) && !IPV6_RE.test(domain)) {
      flashError('That doesn’t look like a valid domain name. Example: example.com');
      return;
    }

    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    var signal = abortCtrl.signal;

    setState('loading');
    lookupBtn.disabled = true;

    try {
      var results = {};

      if (isPtrLookup || isAutoIp) {
        var arpaName = IPV4_RE.test(domain) ? reverseArpaV4(domain) : reverseArpaV6(domain);
        var json = await dohQuery(arpaName, 'PTR', signal);
        results.PTR = {
          answers: (json.Answer || []).filter(function (a) { return TYPE_NUM[a.type] === 'PTR'; }),
          server: json._server, ms: json._ms, AD: json.AD, status: json.Status
        };
        renderResults(domain, 'PTR', results, { queried: [arpaName] });
        lookupBtn.disabled = false;
        return;
      }

      var typesToFetch = selectedType === 'ALL' ? CORE_TYPES.slice() : [selectedType];
      if (typesToFetch.indexOf('TXT') === -1 && (selectedType === 'ALL' || selectedType === 'TXT')) typesToFetch.push('TXT');

      var queries = typesToFetch.map(function (t) {
        return dohQuery(ascii, t, signal).then(function (json) {
          results[t] = {
            answers: (json.Answer || []).filter(function (a) { return TYPE_NUM[a.type] === t; }),
            server: json._server, ms: json._ms, AD: json.AD, status: json.Status, raw: json
          };
        }).catch(function (err) {
          results[t] = { answers: [], error: err.message, status: -1 };
        });
      });

      queries.push(dohQuery('_dmarc.' + ascii, 'TXT', signal).then(function (json) {
        results.DMARC = { answers: (json.Answer || []).filter(function (a) { return TYPE_NUM[a.type] === 'TXT'; }), server: json._server, ms: json._ms, AD: json.AD, status: json.Status };
      }).catch(function () { results.DMARC = { answers: [], status: -1 }; }));

      await Promise.all(queries);

      var anyOk = Object.keys(results).some(function (t) { return results[t].status === 0 && results[t].answers.length; });
      var allNx = Object.keys(results).every(function (t) { return results[t].status === 3 || results[t].status === -1; });

      if (!anyOk && allNx) {
        failMsg.textContent = 'No DNS records found for "' + domain + '". The domain may not exist (NXDOMAIN), or it has no records of the requested type.';
        setState('fail');
        lookupBtn.disabled = false;
        return;
      }

      renderResults(domain, selectedType, results, { queried: typesToFetch });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      failMsg.textContent = 'Lookup failed: ' + (err.message || 'network error') + '. Public DNS-over-HTTPS resolvers may be blocked by your network or browser extension — try again or use a different network.';
      setState('fail');
    } finally {
      lookupBtn.disabled = false;
    }
  }

  /* ---------------- export ---------------- */
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function flattenRows() {
    if (!lastResult) return [];
    var rows = [];
    Object.keys(lastResult.results).forEach(function (t) {
      (lastResult.results[t].answers || []).forEach(function (a) {
        rows.push({ type: t, name: lastResult.domain, ttl: a.TTL, value: a.data });
      });
    });
    return rows;
  }

  $('[data-export-json]', root) && $('[data-export-json]', root).addEventListener('click', function () {
    if (!lastResult) return;
    download(lastResult.domain + '-dns-records.json', JSON.stringify(lastResult, null, 2), 'application/json');
  });
  $('[data-export-csv]', root) && $('[data-export-csv]', root).addEventListener('click', function () {
    var rows = flattenRows();
    var csv = 'Type,Name,TTL,Value\n' + rows.map(function (r) { return [r.type, r.name, r.ttl, '"' + String(r.value).replace(/"/g, '""') + '"'].join(','); }).join('\n');
    download((lastResult ? lastResult.domain : 'dns') + '-dns-records.csv', csv, 'text/csv');
  });
  $('[data-export-txt]', root) && $('[data-export-txt]', root).addEventListener('click', function () {
    var rows = flattenRows();
    var txt = rows.map(function (r) { return r.name + '\t' + r.type + '\t' + r.ttl + '\t' + r.value; }).join('\n');
    download((lastResult ? lastResult.domain : 'dns') + '-dns-records.txt', txt, 'text/plain');
  });
  $('[data-print-results]', root) && $('[data-print-results]', root).addEventListener('click', function () { window.print(); });
  $('[data-copy-all]', root) && $('[data-copy-all]', root).addEventListener('click', function (e) {
    if (!lastResult) return;
    var rows = flattenRows();
    copyText(rows.map(function (r) { return r.type + '\t' + r.value + '\t(TTL ' + r.ttl + 's)'; }).join('\n'), e.currentTarget);
  });
  $('[data-share-link]', root) && $('[data-share-link]', root).addEventListener('click', function (e) {
    if (!lastResult) return;
    var url = new URL(window.location.href);
    url.search = '?domain=' + encodeURIComponent(lastResult.domain) + '&type=' + encodeURIComponent(lastResult.type);
    copyText(url.toString(), e.currentTarget);
  });

  /* ---------------- wiring ---------------- */
  function submitLookup() {
    var domain = input.value;
    var type = typeSelect.value;
    runLookup(domain, type);
  }

  lookupBtn.addEventListener('click', submitLookup);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitLookup(); } });
  input.addEventListener('input', function () { flashError(''); });

  $all('[data-example]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      input.value = btn.getAttribute('data-example');
      submitLookup();
    });
  });

  root.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('[data-history-item]');
    if (chip) { input.value = chip.getAttribute('data-history-item'); submitLookup(); }
  });

  $('[data-clear-history]', root) && $('[data-clear-history]', root).addEventListener('click', function () {
    saveHistory([]); renderHistory();
  });

  $('[data-retry-btn]', root) && $('[data-retry-btn]', root).addEventListener('click', submitLookup);

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== input && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) {
      e.preventDefault(); input.focus();
    }
  });

  $all('[data-sticky-dns-cta]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(function () { input.focus(); }, 350);
    });
  });

  renderHistory();

  /* ---------------- deep-link support ---------------- */
  (function initFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var d = params.get('domain');
    var t = params.get('type');
    if (t && TYPE_META[t]) typeSelect.value = t;
    if (d) { input.value = d; submitLookup(); }
  })();
})();
