(function () {
  'use strict';
  var root = document.querySelector('[data-dpc-page]');
  if (!root) return;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  /* ---------------- independent public resolvers ---------------- */
  /* Every resolver below is queried live, directly from this browser, over its own
     real DNS-over-HTTPS JSON endpoint. There is no simulated or fabricated data —
     if a resolver is unreachable it is reported as failed, not backfilled. */
  var RESOLVERS = [
    { id: 'google', name: 'Google Public DNS', operator: 'Google LLC', addr: '8.8.8.8 / 8.8.4.4', url: 'https://dns.google/resolve', headers: {} },
    { id: 'cloudflare', name: 'Cloudflare DNS', operator: 'Cloudflare, Inc.', addr: '1.1.1.1 / 1.0.0.1', url: 'https://cloudflare-dns.com/dns-query', headers: { Accept: 'application/dns-json' } },
    { id: 'dnssb', name: 'DNS.SB', operator: 'DNS.SB (privacy-focused resolver)', addr: '185.222.222.222', url: 'https://doh.dns.sb/dns-query', headers: { Accept: 'application/dns-json' } },
    { id: 'rethink', name: 'RethinkDNS', operator: 'RethinkDNS (open-source resolver)', addr: 'Anycast', url: 'https://basic.rethinkdns.com/dns-query', headers: { Accept: 'application/dns-json' } }
  ];

  var TYPE_NUM = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 43: 'DS', 44: 'SSHFP', 48: 'DNSKEY', 52: 'TLSA', 257: 'CAA' };
  var TYPE_META = {
    A: 'IPv4 address', AAAA: 'IPv6 address', CNAME: 'Canonical name / alias', MX: 'Mail exchange server',
    TXT: 'Text record', NS: 'Authoritative name server', SOA: 'Start of authority', PTR: 'Reverse DNS pointer',
    SRV: 'Service locator', CAA: 'Certificate authority authorization', DNSKEY: 'DNSSEC public key',
    DS: 'DNSSEC delegation signer', TLSA: 'DANE TLS association'
  };

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
  function reverseArpaV4(ip) { return ip.split('.').reverse().join('.') + '.in-addr.arpa'; }
  function reverseArpaV6(ip) {
    var parts = ip.split('::');
    var groups;
    if (parts.length === 1) { groups = ip.split(':'); }
    else {
      var head = parts[0] ? parts[0].split(':') : [];
      var tail = parts[1] ? parts[1].split(':') : [];
      groups = head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill('0')).concat(tail);
    }
    var full = groups.map(function (g) { return (g || '0').padStart(4, '0'); }).join('');
    return full.split('').reverse().join('.') + '.ip6.arpa';
  }

  function normalizeValue(type, data) {
    var v = String(data || '').trim().toLowerCase();
    if (type === 'TXT') v = v.replace(/^"|"$/g, '').replace(/\\"/g, '"');
    else v = v.replace(/\.$/, '');
    return v;
  }

  function parseDetail(type, data) {
    switch (type) {
      case 'MX': { var m = data.match(/^(\d+)\s+(.+)$/); return m ? { priority: m[1], target: m[2].replace(/\.$/, '') } : {}; }
      case 'SRV': { var s = data.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/); return s ? { priority: s[1], weight: s[2], port: s[3], target: s[4].replace(/\.$/, '') } : {}; }
      case 'SOA': { var p = data.split(/\s+/); return { mname: p[0], serial: p[2] }; }
      case 'CAA': { var c = data.match(/^(\d+)\s+(\S+)\s+"?([^"]*)"?$/); return c ? { flag: c[1], tag: c[2], value: c[3] } : {}; }
      case 'TXT': return { text: data.replace(/^"|"$/g, '').replace(/\\"/g, '"') };
      default: return {};
    }
  }

  /* ---------------- state ---------------- */
  var HISTORY_KEY = 'tooladda_dnsprop_history_v1';
  function loadHistory() { try { return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }
  function saveHistory(list) { try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { /* ignore */ } }
  function pushHistory(domain) {
    var list = loadHistory().filter(function (d) { return d !== domain; });
    list.unshift(domain);
    saveHistory(list);
    renderHistory();
  }

  var lastResult = null;
  var autoRefreshTimer = null;
  var abortCtrls = [];

  /* ---------------- DOM refs ---------------- */
  var input = $('[data-domain-input]', root);
  var typeSelect = $('[data-type-select]', root);
  var expectedInput = $('[data-expected-input]', root);
  var checkBtn = $('[data-check-btn]', root);
  var errorBox = $('[data-dpc-error]', root);
  var loadingBox = $('[data-dpc-loading]', root);
  var emptyBox = $('[data-dpc-empty]', root);
  var failBox = $('[data-dpc-fail]', root);
  var failMsg = $('[data-dpc-fail-msg]', root);
  var resultsBox = $('[data-dpc-results]', root);
  var statsGrid = $('[data-stats-grid]', root);
  var diagramWrap = $('[data-resolver-diagram]', root);
  var tableBody = $('[data-resolver-table-body]', root);
  var progressBar = $('[data-progress-bar]', root);
  var progressLabel = $('[data-progress-label]', root);
  var historyRow = $('[data-history-row]', root);
  var historyChips = $('[data-history-chips]', root);
  var autoRefreshToggle = $('[data-auto-refresh]', root);
  var recommendationsBox = $('[data-recommendations]', root);

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
      if (btn) { var o = btn.textContent; btn.textContent = '✅ Copied'; window.setTimeout(function () { btn.textContent = o; }, 1400); }
    } catch (e) {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      document.body.removeChild(ta);
    }
  }

  function renderHistory() {
    var list = loadHistory();
    if (!historyRow) return;
    if (!list.length) { historyRow.classList.add('hidden'); return; }
    historyRow.classList.remove('hidden');
    historyChips.innerHTML = list.map(function (d) {
      return '<button type="button" class="pc-chip" data-history-item="' + escapeHtml(d) + '">' + escapeHtml(d) + '</button>';
    }).join('');
  }

  /* ---------------- single resolver query ---------------- */
  function queryResolver(resolver, name, type, signal) {
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var url = resolver.url + '?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type);
    return fetch(url, { headers: resolver.headers, signal: signal }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      var answers = (json.Answer || []).filter(function (a) { return TYPE_NUM[a.type] === type; });
      return {
        resolver: resolver, ok: true, status: json.Status, ad: !!json.AD, ms: Math.round(t1 - t0),
        answers: answers, values: answers.map(function (a) { return normalizeValue(type, a.data); }),
        ttl: answers.length ? Math.min.apply(null, answers.map(function (a) { return a.TTL; })) : null,
        timestamp: new Date()
      };
    }).catch(function (err) {
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      return { resolver: resolver, ok: false, error: (err && err.name === 'AbortError') ? 'Cancelled' : (err.message || 'Request failed'), ms: Math.round(t1 - t0), answers: [], values: [], timestamp: new Date() };
    });
  }

  /* ---------------- consensus analysis ---------------- */
  function analyze(results, expected) {
    var groups = {};
    results.forEach(function (r) {
      if (!r.ok || !r.values.length) return;
      var key = r.values.slice().sort().join('|');
      groups[key] = (groups[key] || 0) + 1;
    });
    var consensusKey = null, consensusCount = 0;
    Object.keys(groups).forEach(function (k) { if (groups[k] > consensusCount) { consensusCount = groups[k]; consensusKey = k; } });

    var expectedNorm = expected ? normalizeValue('A', expected) : null;

    results.forEach(function (r) {
      var key = r.values.slice().sort().join('|');
      r.matchesConsensus = r.ok && r.values.length && key === consensusKey;
      r.matchesExpected = expectedNorm ? r.values.some(function (v) { return v.indexOf(expectedNorm) !== -1; }) : null;
    });

    var successCount = results.filter(function (r) { return r.ok && r.values.length; }).length;
    var failCount = results.length - successCount;
    var unreachableCount = results.filter(function (r) { return !r.ok; }).length;
    var noRecordCount = results.filter(function (r) { return r.ok && !r.values.length; }).length;
    var dnssecCount = results.filter(function (r) { return r.ok && r.ad && r.values.length; }).length;
    var times = results.filter(function (r) { return r.ok; }).map(function (r) { return r.ms; });
    var avgMs = times.length ? Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length) : 0;
    var fastest = results.filter(function (r) { return r.ok; }).sort(function (a, b) { return a.ms - b.ms; })[0];
    var slowest = results.filter(function (r) { return r.ok; }).sort(function (a, b) { return b.ms - a.ms; })[0];

    var matchTarget = expectedNorm ? results.filter(function (r) { return r.matchesExpected; }).length : consensusCount;
    var pct = results.length ? Math.round((matchTarget / results.length) * 100) : 0;

    var statusLabel, statusClass;
    if (successCount === 0 && unreachableCount === results.length) { statusLabel = 'No resolvers responded'; statusClass = 'fail'; }
    else if (successCount === 0) { statusLabel = 'No resolver has a record of this type yet'; statusClass = 'fail'; }
    else if (expectedNorm) {
      if (pct === 100) { statusLabel = 'Fully propagated — all resolvers match'; statusClass = 'ok'; }
      else if (pct > 0) { statusLabel = 'Partially propagated'; statusClass = 'warn'; }
      else { statusLabel = 'Not yet visible on any checked resolver'; statusClass = 'fail'; }
    } else {
      if (pct === 100 && successCount === results.length) { statusLabel = 'Consistent across all resolvers'; statusClass = 'ok'; }
      else if (pct >= 50) { statusLabel = 'Mostly consistent — some resolvers differ'; statusClass = 'warn'; }
      else { statusLabel = 'Inconsistent — resolvers disagree'; statusClass = 'fail'; }
    }

    return { pct: pct, successCount: successCount, failCount: failCount, unreachableCount: unreachableCount, noRecordCount: noRecordCount, dnssecCount: dnssecCount, avgMs: avgMs, fastest: fastest, slowest: slowest, statusLabel: statusLabel, statusClass: statusClass, consensusKey: consensusKey };
  }

  /* ---------------- rendering ---------------- */
  function renderDiagram(domain, results, stats) {
    var n = results.length;
    var cx = 150, cy = 150, r = 105;
    var nodes = results.map(function (res, i) {
      var angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      var x = cx + r * Math.cos(angle);
      var y = cy + r * Math.sin(angle);
      var cls = !res.ok ? 'fail' : (res.matchesConsensus ? 'ok' : 'warn');
      return { x: x, y: y, cls: cls, res: res };
    });

    var lines = nodes.map(function (n2) {
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + n2.x + '" y2="' + n2.y + '" class="pc-diagram-line pc-line-' + n2.cls + '" />';
    }).join('');

    var circles = nodes.map(function (n2, i) {
      return '<g class="pc-diagram-node pc-node-' + n2.cls + '" tabindex="0" role="img" aria-label="' + escapeHtml(n2.res.resolver.name) + ': ' + (n2.res.ok ? (n2.res.matchesConsensus ? 'matches consensus' : 'differs') : 'failed') + '">' +
        '<circle cx="' + n2.x + '" cy="' + n2.y + '" r="9" class="pc-node-dot" />' +
        '<circle cx="' + n2.x + '" cy="' + n2.y + '" r="9" class="pc-node-pulse" />' +
        '<text x="' + n2.x + '" y="' + (n2.y + (n2.y > cy ? 22 : -16)) + '" text-anchor="middle" class="pc-node-label">' + escapeHtml(n2.res.resolver.name) + '</text>' +
        '</g>';
    }).join('');

    diagramWrap.innerHTML =
      '<svg viewBox="0 0 300 300" class="pc-diagram-svg" aria-hidden="true">' +
      lines +
      '<circle cx="' + cx + '" cy="' + cy + '" r="26" class="pc-diagram-hub" />' +
      '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" class="pc-hub-label">' + escapeHtml(domain.length > 14 ? domain.slice(0, 12) + '…' : domain) + '</text>' +
      circles +
      '</svg>' +
      '<p class="pc-diagram-caption">Live results from ' + n + ' independently operated public DNS resolvers — not a simulated map. <a href="#propagation-faq">Why not a world map?</a></p>';
  }

  function statusPill(res) {
    if (!res.ok) return '<span class="pc-pill pc-pill--fail">✕ Failed</span>';
    if (!res.values.length) return '<span class="pc-pill pc-pill--fail">No record</span>';
    if (res.matchesConsensus) return '<span class="pc-pill pc-pill--ok">✓ Matches consensus</span>';
    return '<span class="pc-pill pc-pill--warn">⚠ Differs</span>';
  }

  function renderTable(type, results) {
    tableBody.innerHTML = results.map(function (r) {
      var valueHtml = r.ok
        ? (r.answers.length ? r.answers.map(function (a) { return '<code>' + escapeHtml(a.data) + '</code>'; }).join('<br>') : '<span class="pc-hint">No ' + type + ' record</span>')
        : '<span class="pc-hint">' + escapeHtml(r.error) + '</span>';
      return '<tr class="' + (r.ok ? '' : 'pc-row-fail') + '">' +
        '<td><strong>' + escapeHtml(r.resolver.name) + '</strong><br><span class="pc-muted">' + escapeHtml(r.resolver.operator) + '</span></td>' +
        '<td><code class="pc-mono">' + escapeHtml(r.resolver.addr) + '</code></td>' +
        '<td>' + statusPill(r) + '</td>' +
        '<td>' + valueHtml + '</td>' +
        '<td>' + (r.ttl != null ? r.ttl + 's' : '—') + '</td>' +
        '<td>' + r.ms + ' ms</td>' +
        '<td>' + (r.ok ? (r.ad ? '✅' : '—') : '—') + '</td>' +
        '<td class="pc-muted">' + r.timestamp.toLocaleTimeString() + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderRecommendations(stats, expected) {
    var tips = [];
    if (stats.unreachableCount > 0) tips.push(stats.unreachableCount + ' of ' + (stats.successCount + stats.failCount) + ' resolvers failed to respond — retry, or check whether your network blocks DNS-over-HTTPS.');
    if (stats.noRecordCount > 0 && stats.successCount > 0) tips.push(stats.noRecordCount + ' resolver(s) returned no record of this type — likely still serving a cached "no record" answer, or the record was only just created.');
    if (stats.successCount === 0 && stats.unreachableCount < (stats.successCount + stats.failCount)) tips.push('Every reachable resolver returned no record of this type. Confirm the record exists at your DNS provider and that you selected the right record type.');
    if (stats.dnssecCount === 0) tips.push('None of the checked resolvers returned a DNSSEC-authenticated record for this query.');
    if (expected && stats.pct < 100 && stats.pct > 0) tips.push('Some resolvers still return the old value — this is normal until each resolver\'s cached TTL expires. Re-check in a few minutes.');
    if (expected && stats.pct === 0) tips.push('No resolver is returning the expected value yet. Confirm the record was saved correctly at your DNS provider, and that you\'re checking the right record type.');
    recommendationsBox.innerHTML = tips.length
      ? '<ul>' + tips.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul>'
      : '<p class="pc-hint">✅ No issues detected — independent public resolvers agree on this record.</p>';
  }

  function renderResults(domain, type, expected, results) {
    var stats = analyze(results, expected);
    lastResult = { domain: domain, type: type, expected: expected || null, results: results, stats: stats, fetchedAt: new Date().toISOString() };

    progressBar.style.setProperty('--pct', stats.pct);
    progressBar.className = 'pc-progress pc-progress--' + stats.statusClass;
    progressLabel.innerHTML = '<strong>' + stats.pct + '%</strong> ' + escapeHtml(stats.statusLabel);

    statsGrid.innerHTML = [
      { label: 'Resolvers checked', value: results.length },
      { label: 'Returned a record', value: stats.successCount },
      { label: 'No record / unreachable', value: stats.failCount },
      { label: 'Avg response time', value: stats.avgMs + ' ms' },
      { label: 'Fastest resolver', value: stats.fastest ? stats.fastest.resolver.name : '—' },
      { label: 'Slowest resolver', value: stats.slowest ? stats.slowest.resolver.name : '—' },
      { label: 'DNSSEC-authenticated records', value: stats.dnssecCount + ' / ' + results.length },
      { label: 'Checked at', value: new Date().toLocaleTimeString() }
    ].map(function (s) { return '<div class="pc-stat-card"><span>' + escapeHtml(s.label) + '</span><strong>' + escapeHtml(s.value) + '</strong></div>'; }).join('');

    renderDiagram(domain, results, stats);
    renderTable(type, results);
    renderRecommendations(stats, expected);

    setState('results');
    pushHistory(domain);
  }

  /* ---------------- orchestration ---------------- */
  function abortInFlight() {
    abortCtrls.forEach(function (c) { try { c.abort(); } catch (e) { /* ignore */ } });
    abortCtrls = [];
  }

  async function runCheck(rawDomain, selectedType, expectedRaw) {
    var domain = normalizeDomainInput(rawDomain);
    if (!domain) { flashError('Enter a domain name to check.'); return; }
    var ascii = toAscii(domain);
    var isIpInput = IPV4_RE.test(domain) || IPV6_RE.test(domain);
    var effectiveType = selectedType;
    var queryName = ascii;

    if (isIpInput) {
      effectiveType = 'PTR';
      queryName = IPV4_RE.test(domain) ? reverseArpaV4(domain) : reverseArpaV6(domain);
    } else if (!isValidTarget(ascii)) {
      flashError('That doesn’t look like a valid domain name. Example: example.com');
      return;
    } else if (selectedType === 'PTR') {
      flashError('PTR lookups require an IP address, e.g. 8.8.8.8');
      return;
    }

    abortInFlight();
    setState('loading');
    checkBtn.disabled = true;

    try {
      var queries = RESOLVERS.map(function (resolver) {
        var ctrl = new AbortController();
        abortCtrls.push(ctrl);
        return queryResolver(resolver, queryName, effectiveType, ctrl.signal);
      });
      var results = await Promise.all(queries);
      var anySuccess = results.some(function (r) { return r.ok; });
      if (!anySuccess) {
        failMsg.textContent = 'None of the independent resolvers responded for "' + domain + '". Your network may be blocking DNS-over-HTTPS requests, or the domain may not exist.';
        setState('fail');
        return;
      }
      renderResults(domain, effectiveType, expectedRaw, results);
    } finally {
      checkBtn.disabled = false;
    }
  }

  async function retryFailed() {
    if (!lastResult) return;
    var toRetry = lastResult.results.filter(function (r) { return !r.ok; });
    if (!toRetry.length) return;
    var queryName = IPV4_RE.test(lastResult.domain) ? reverseArpaV4(lastResult.domain) : (IPV6_RE.test(lastResult.domain) ? reverseArpaV6(lastResult.domain) : toAscii(lastResult.domain));
    var updated = await Promise.all(toRetry.map(function (r) {
      var ctrl = new AbortController(); abortCtrls.push(ctrl);
      return queryResolver(r.resolver, queryName, lastResult.type, ctrl.signal);
    }));
    var map = {}; updated.forEach(function (u) { map[u.resolver.id] = u; });
    var merged = lastResult.results.map(function (r) { return map[r.resolver.id] || r; });
    renderResults(lastResult.domain, lastResult.type, lastResult.expected, merged);
  }

  /* ---------------- export ---------------- */
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }
  function rowsForExport() {
    if (!lastResult) return [];
    return lastResult.results.map(function (r) {
      return { resolver: r.resolver.name, operator: r.resolver.operator, status: r.ok ? 'success' : 'failed', values: r.values.join('; '), ttl: r.ttl, ms: r.ms, dnssec: r.ok && r.ad, matchesConsensus: !!r.matchesConsensus };
    });
  }

  $('[data-export-json]', root) && $('[data-export-json]', root).addEventListener('click', function () {
    if (!lastResult) return;
    download(lastResult.domain + '-dns-propagation.json', JSON.stringify(lastResult, null, 2), 'application/json');
  });
  $('[data-export-csv]', root) && $('[data-export-csv]', root).addEventListener('click', function () {
    var rows = rowsForExport();
    var csv = 'Resolver,Operator,Status,Values,TTL,ResponseTimeMs,DNSSEC,MatchesConsensus\n' + rows.map(function (r) {
      return [r.resolver, r.operator, r.status, '"' + r.values.replace(/"/g, '""') + '"', r.ttl, r.ms, r.dnssec, r.matchesConsensus].join(',');
    }).join('\n');
    download((lastResult ? lastResult.domain : 'dns') + '-dns-propagation.csv', csv, 'text/csv');
  });
  $('[data-export-txt]', root) && $('[data-export-txt]', root).addEventListener('click', function () {
    var rows = rowsForExport();
    var txt = rows.map(function (r) { return r.resolver + '\t' + r.status + '\t' + r.values + '\tTTL ' + r.ttl + 's\t' + r.ms + 'ms'; }).join('\n');
    download((lastResult ? lastResult.domain : 'dns') + '-dns-propagation.txt', txt, 'text/plain');
  });
  $('[data-print-results]', root) && $('[data-print-results]', root).addEventListener('click', function () { window.print(); });
  $('[data-copy-all]', root) && $('[data-copy-all]', root).addEventListener('click', function (e) {
    var rows = rowsForExport();
    copyText(rows.map(function (r) { return r.resolver + ': ' + (r.status === 'success' ? r.values : 'failed') + ' (' + r.ms + 'ms)'; }).join('\n'), e.currentTarget);
  });
  $('[data-share-link]', root) && $('[data-share-link]', root).addEventListener('click', function (e) {
    if (!lastResult) return;
    var url = new URL(window.location.href);
    url.search = '?domain=' + encodeURIComponent(lastResult.domain) + '&type=' + encodeURIComponent(lastResult.type) + (lastResult.expected ? '&expected=' + encodeURIComponent(lastResult.expected) : '');
    copyText(url.toString(), e.currentTarget);
  });

  /* ---------------- wiring ---------------- */
  function submitCheck() { runCheck(input.value, typeSelect.value, expectedInput.value.trim()); }

  checkBtn.addEventListener('click', submitCheck);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitCheck(); } });
  input.addEventListener('input', function () { flashError(''); });
  expectedInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitCheck(); } });

  $all('[data-example]', root).forEach(function (btn) {
    btn.addEventListener('click', function () { input.value = btn.getAttribute('data-example'); submitCheck(); });
  });
  root.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('[data-history-item]');
    if (chip) { input.value = chip.getAttribute('data-history-item'); submitCheck(); }
  });
  $('[data-clear-history]', root) && $('[data-clear-history]', root).addEventListener('click', function () { saveHistory([]); renderHistory(); });
  $('[data-retry-btn]', root) && $('[data-retry-btn]', root).addEventListener('click', submitCheck);
  $('[data-retry-failed]', root) && $('[data-retry-failed]', root).addEventListener('click', retryFailed);

  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', function () {
      if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
      if (autoRefreshToggle.checked) {
        autoRefreshTimer = setInterval(function () {
          if (lastResult) runCheck(lastResult.domain, lastResult.type, lastResult.expected || '');
        }, 30000);
      }
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== input && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) {
      e.preventDefault(); input.focus();
    }
  });

  $all('[data-sticky-dpc-cta]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(function () { input.focus(); }, 350);
    });
  });

  renderHistory();

  (function initFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var d = params.get('domain'), t = params.get('type'), ex = params.get('expected');
    if (t && TYPE_META[t]) typeSelect.value = t;
    if (ex) expectedInput.value = ex;
    if (d) { input.value = d; submitCheck(); }
  })();
})();
