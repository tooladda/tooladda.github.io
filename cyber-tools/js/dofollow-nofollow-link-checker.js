/* Dofollow & Nofollow Link Checker — UI layer.
 *
 * All classification lives in assets/js/link-audit-engine.js. This file reads
 * the input, drives the engine and renders the dashboard, table, filters,
 * detail dialog and exports.
 *
 * On fetching: ToolAdda is a static site with no server of its own, so a URL
 * can only be read when the target site itself sends permissive CORS headers.
 * Most sites do not. The fetch is therefore offered as best-effort, and a
 * failure is reported as "could not be fetched" with the HTML paste route
 * suggested — never as "no links found" and never as a broken link.
 *
 * Untrusted HTML is parsed with DOMParser, which does not execute scripts, and
 * every extracted value reaches the page through textContent. The one place
 * markup is generated (the source-HTML viewer) escapes first, then re-inserts
 * only its own <mark> tags.
 */
(function () {
  'use strict';

  var E = window.LinkAuditEngine;
  if (!E) return;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    tabUrl: $('dnlTabUrl'),
    tabHtml: $('dnlTabHtml'),
    panelUrl: $('dnlPanelUrl'),
    panelHtml: $('dnlPanelHtml'),

    url: $('dnlUrl'),
    fetchBtn: $('dnlFetch'),
    html: $('dnlHtml'),
    baseUrl: $('dnlBaseUrl'),
    analyseBtn: $('dnlAnalyse'),
    fileInput: $('dnlFile'),
    exampleBtn: $('dnlExample'),
    subdomains: $('dnlSubdomains'),

    notice: $('dnlNotice'),
    results: $('dnlResults'),
    metrics: $('dnlMetrics'),
    distFollow: $('dnlDistFollow'),
    distLocation: $('dnlDistLocation'),

    search: $('dnlSearch'),
    filterFollow: $('dnlFilterFollow'),
    filterRel: $('dnlFilterRel'),
    filterLocation: $('dnlFilterLocation'),
    filterType: $('dnlFilterType'),
    filterFlag: $('dnlFilterFlag'),
    clearFilters: $('dnlClearFilters'),

    tableBody: $('dnlTableBody'),
    tableEmpty: $('dnlTableEmpty'),
    pagerInfo: $('dnlPagerInfo'),
    prev: $('dnlPrev'),
    next: $('dnlNext'),
    perPage: $('dnlPerPage'),

    domainsBody: $('dnlDomainsBody'),
    domainsEmpty: $('dnlDomainsEmpty'),
    repeatBody: $('dnlRepeatBody'),
    repeatEmpty: $('dnlRepeatEmpty'),
    insights: $('dnlInsights'),

    copySummary: $('dnlCopySummary'),
    downloadCsv: $('dnlDownloadCsv'),
    downloadJson: $('dnlDownloadJson'),
    printBtn: $('dnlPrint'),

    dialog: $('dnlDialog'),
    dialogBody: $('dnlDialogBody'),
    dialogClose: $('dnlDialogClose'),
    toast: $('dnlToast')
  };

  if (!el.html || !el.tableBody) return;

  var state = {
    result: null,
    page: 1,
    perPage: 25,
    sortKey: 'index',
    sortDir: 'asc'
  };

  /* ---------------------------------------------------------------- utils */

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, 2400);
  }

  /* Every notice carries a leading word, so the meaning survives without
     colour vision and in a screen reader. */
  function notice(kind, text) {
    if (!el.notice) return;
    if (!kind) { el.notice.hidden = true; el.notice.textContent = ''; return; }
    var prefix = { error: 'Error: ', warn: 'Note: ', ok: 'Done: ', info: 'Info: ' }[kind] || '';
    el.notice.hidden = false;
    el.notice.className = 'dnl-notice is-' + kind;
    el.notice.textContent = prefix + text;
  }

  function clearNode(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  function td(text, label, cls) {
    var c = document.createElement('td');
    c.textContent = text;
    if (label) c.setAttribute('data-label', label);
    if (cls) c.className = cls;
    return c;
  }

  function badge(text, cls) {
    var b = document.createElement('span');
    b.className = 'dnl-badge ' + cls;
    b.textContent = text;
    return b;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* -------------------------------------------------------------- tabs */

  function selectTab(which) {
    var urlMode = which === 'url';
    if (el.tabUrl) el.tabUrl.setAttribute('aria-selected', urlMode ? 'true' : 'false');
    if (el.tabHtml) el.tabHtml.setAttribute('aria-selected', urlMode ? 'false' : 'true');
    if (el.panelUrl) el.panelUrl.hidden = !urlMode;
    if (el.panelHtml) el.panelHtml.hidden = urlMode;
  }

  if (el.tabUrl) el.tabUrl.addEventListener('click', function () { selectTab('url'); });
  if (el.tabHtml) el.tabHtml.addEventListener('click', function () { selectTab('html'); });

  /* ------------------------------------------------------------ analysis */

  function normaliseUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch (e) { return null; }
  }

  function runAnalysis(html, baseUrl, opts) {
    opts = opts || {};
    if (!String(html || '').trim()) {
      notice('error', 'No HTML content was detected. Paste a page’s HTML or upload a file.');
      hideResults();
      return;
    }

    var result;
    try {
      result = E.analyseHtml(html, {
        baseUrl: baseUrl || null,
        subdomainsAreInternal: !!(el.subdomains && el.subdomains.checked)
      });
    } catch (err) {
      notice('error', 'This HTML could not be parsed. Check that you pasted the page source.');
      hideResults();
      return;
    }

    if (!result.links.length) {
      /* An empty result here means the HTML really contains no anchors — it is
         never used to describe a failed fetch. */
      notice('warn', 'No HTML links were found in this content. The page may build its links with JavaScript, which this parser does not run.');
      hideResults();
      return;
    }

    state.result = result;
    state.page = 1;
    notice('ok', 'Analysed ' + result.links.length + ' link' + (result.links.length === 1 ? '' : 's') +
      (baseUrl ? ' against ' + baseUrl : '. Add a page URL to classify links as internal or external.') +
      (opts.via ? ' Fetched through the ' + opts.via + ' relay.' : ''));
    showResults();
    renderAll();
    /* Only a fresh analysis scrolls. Re-running for a filter or the subdomain
       toggle must leave the reader where they are. */
    if (opts.scroll) scrollToResults();
  }

  function scrollToResults() {
    if (el.results && el.results.scrollIntoView) {
      el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function hideResults() { if (el.results) el.results.hidden = true; }
  function showResults() { if (el.results) el.results.hidden = false; }

  /* Fetching. A direct browser request only succeeds when the target sends
     Access-Control-Allow-Origin, and most sites do not, so the direct attempt
     is followed by the same public CORS relays the SEO checker uses. Those are
     third-party services: the URL being checked is visible to them, which is
     why the paste route stays available for anything private.

     The relays are raced rather than tried one after another. Their failures
     are largely transient — a Cloudflare-protected site answers a relay with
     520/522 on one request and 200 on the next — so racing all three and then
     repeating the race once turns most of those flukes into a result, in about
     a third of the wall time a sequential walk needed. When every route still
     fails the reason is stated, with the status each relay reported — never
     "no links found", never "broken". */
  var PROXIES = [
    { name: 'allorigins', build: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
    { name: 'codetabs', build: function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); } },
    { name: 'corsproxy', build: function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); } }
  ];
  var RELAY_PASSES = 2;

  /* A response only counts when it looks like the target's own HTML document.
     Relays fail loudly in two ways that must not be analysed as if they were
     the page: a JSON error envelope, and a rate-limit or gateway error page
     that is itself valid HTML. The second is why a bare "<html> is present"
     test is not enough. */
  var RELAY_ERROR = /rate ?limit|too many requests|error code:?\s*\d|connection timed out|origin is unreachable|web server is down|invalid url|missing (the )?url|not allowed to (be )?proxy/i;

  function looksLikeHtml(text) {
    if (!text || text.length < 120) return false;
    var head = text.slice(0, 200).trim();
    /* A byte order mark ahead of the doctype is common and would otherwise
       make the JSON-envelope check below look at the wrong character. */
    if (head.charCodeAt(0) === 65279) head = head.slice(1).trim();
    if (head.charAt(0) === '{' || head.charAt(0) === '[') return false;
    if (!/<html|<head|<body|<title|<a\s/i.test(text)) return false;
    /* Only the opening chunk is scanned: a real page may well discuss rate
       limits somewhere in its body, whereas a relay's error page says so
       immediately. */
    if (RELAY_ERROR.test(text.slice(0, 1500))) return false;
    return true;
  }

  function fetchText(target, timeoutMs) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);
    return fetch(target, {
      signal: controller ? controller.signal : undefined,
      redirect: 'follow'
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      return res.text();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function describeFailure(err) {
    if (err && err.status) return String(err.status);
    if (err && err.name === 'AbortError') return 'timed out';
    return 'refused';
  }

  /* Races every relay and keeps the first response that really is the page.
     Resolves with { text, via }; rejects with a list of { name, why } once all
     of them have failed. */
  function raceRelays(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var pending = PROXIES.length;
      var failures = [];
      var settled = false;

      var lose = function (name, why) {
        failures.push({ name: name, why: why });
        pending -= 1;
        if (!pending && !settled) { settled = true; reject(failures); }
      };

      PROXIES.forEach(function (proxy) {
        fetchText(proxy.build(url), timeoutMs).then(function (text) {
          if (settled) return;
          if (looksLikeHtml(text)) { settled = true; resolve({ text: text, via: proxy.name }); }
          else lose(proxy.name, 'returned its own error page');
        }, function (err) {
          if (settled) return;
          lose(proxy.name, describeFailure(err));
        });
      });
    });
  }

  function fetchUrl() {
    var url = normaliseUrl(el.url.value);
    if (!url) {
      el.url.setAttribute('aria-invalid', 'true');
      notice('error', 'Please enter a valid webpage URL, for example https://example.com/page');
      return;
    }
    el.url.setAttribute('aria-invalid', 'false');
    el.url.value = url;

    notice('info', 'Requesting ' + url + ' …');
    el.fetchBtn.disabled = true;

    /* Remembered only to explain the outcome: a 401/403/404 from the target
       itself is worth reporting even after the relays have also failed. */
    var directStatus = null;

    function succeed(text, via) {
      el.fetchBtn.disabled = false;
      el.html.value = text;
      if (el.baseUrl) el.baseUrl.value = url;
      runAnalysis(text, url, { scroll: true, via: via });
    }

    function giveUp(failures) {
      el.fetchBtn.disabled = false;
      var detail = (failures || []).map(function (f) { return f.name + ' ' + f.why; }).join(', ');
      /* A gateway status, a timeout or a relay error page all mean the relay
         reached the site and the site's protection dropped the connection.
         That is the failure worth inviting a retry for: the next attempt on
         the very same URL often succeeds. */
      var transient = (failures || []).some(function (f) {
        return f.why === 'timed out' || f.why === 'returned its own error page' || /^5\d\d$/.test(f.why);
      });
      notice('warn', 'This page could not be retrieved. ' +
        (directStatus
          ? 'The site answered ' + directStatus + ' to the direct request'
          : 'Your browser’s direct request was blocked by CORS') +
        ', and every relay failed' + (detail ? ' (' + detail + ')' : '') + '. ' +
        (transient
          ? 'That is usually bot protection dropping the relay rather than a permanent block, so pressing "Check links" again often works. '
          : 'Pages behind a sign-in or a firewall cannot be read this way. ') +
        'Nothing about this page’s links is being guessed — open the page yourself, press Ctrl+U to view source, and paste it below.');
      selectTab('html');
    }

    function relayPass(pass) {
      notice('info', pass === 1
        ? 'Direct request blocked by CORS. Trying ' + PROXIES.length + ' relays …'
        : 'Every relay was refused on attempt ' + (pass - 1) + '. Retrying them …');
      raceRelays(url, 20000).then(function (hit) {
        succeed(hit.text, hit.via);
      }, function (failures) {
        if (pass < RELAY_PASSES) relayPass(pass + 1);
        else giveUp(failures);
      });
    }

    /* The direct attempt fails within a second or so when CORS blocks it, so a
       short budget here keeps the relay fallback from feeling stalled; the
       relays themselves need longer, several seconds being normal for them. */
    fetchText(url, 10000).then(function (text) {
      if (looksLikeHtml(text)) succeed(text, null);
      else relayPass(1);
    }, function (err) {
      if (err && err.status) directStatus = String(err.status);
      relayPass(1);
    });
  }

  if (el.fetchBtn) el.fetchBtn.addEventListener('click', fetchUrl);
  if (el.url) el.url.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); fetchUrl(); }
  });

  if (el.analyseBtn) el.analyseBtn.addEventListener('click', function () {
    var base = el.baseUrl ? normaliseUrl(el.baseUrl.value) : null;
    if (el.baseUrl && el.baseUrl.value.trim() && !base) {
      el.baseUrl.setAttribute('aria-invalid', 'true');
      notice('error', 'Please enter a valid page URL, or leave the box empty.');
      return;
    }
    if (el.baseUrl) el.baseUrl.setAttribute('aria-invalid', 'false');
    runAnalysis(el.html.value, base, { scroll: true });
  });

  if (el.fileInput) el.fileInput.addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      el.html.value = String(reader.result || '');
      selectTab('html');
      runAnalysis(el.html.value, el.baseUrl ? normaliseUrl(el.baseUrl.value) : null, { scroll: true });
    };
    reader.onerror = function () { notice('error', 'That file could not be read.'); };
    reader.readAsText(file);
  });

  if (el.exampleBtn) el.exampleBtn.addEventListener('click', function () {
    el.html.value = [
      '<a href="/about">About us</a>',
      '<a href="/pricing" rel="nofollow">Pricing</a>',
      '<a href="https://partner.example/deal" rel="sponsored" target="_blank">Our partner</a>',
      '<a href="https://forum.example/thread" rel="ugc">Reader comment</a>',
      '<a href="https://ads.example/x" rel="nofollow sponsored">Ad unit</a>',
      '<a href="https://old.example/x" rel="nofollow,ugc">Comma mistake</a>',
      '<a href="https://myth.example" rel="dofollow">Inert dofollow</a>',
      '<a href="/guide">Click here</a>',
      '<a href="/whitepaper.pdf">Download the whitepaper</a>',
      '<a href="/product"><img src="p.jpg" alt="Blue widget"></a>',
      '<a href="/gallery"><img src="g.jpg" alt=""></a>',
      '<a href="mailto:hello@example.com">hello@example.com</a>',
      '<a href="tel:+441234567890">Call us</a>',
      '<a href="#top"></a>',
      '<a href="https://blog.example.com/post">Our blog subdomain</a>'
    ].join('\n');
    if (el.baseUrl) el.baseUrl.value = 'https://example.com/page';
    selectTab('html');
    runAnalysis(el.html.value, 'https://example.com/page', { scroll: true });
  });

  if (el.subdomains) el.subdomains.addEventListener('change', function () {
    if (!state.result) return;
    runAnalysis(el.html.value, el.baseUrl ? normaliseUrl(el.baseUrl.value) : null);
  });

  /* --------------------------------------------------------- rendering */

  function renderAll() {
    renderMetrics();
    renderDistribution();
    renderTable();
    renderDomains();
    renderRepeats();
    renderInsights();
  }

  function renderMetrics() {
    var s = state.result.summary;
    clearNode(el.metrics);
    [
      ['Total links', s.total, true],
      ['Dofollow', s.normal, false],
      ['Nofollow', s.nofollow, false],
      ['Sponsored', s.sponsored, false],
      ['UGC', s.ugc, false],
      ['Internal', s.internal, false],
      ['External', s.external, false],
      ['Empty anchor', s.emptyAnchor, false]
    ].forEach(function (m) {
      var box = document.createElement('div');
      box.className = 'dnl-metric' + (m[2] ? ' is-accent' : '');
      var label = document.createElement('span');
      label.textContent = m[0];
      var value = document.createElement('strong');
      value.textContent = String(m[1]);
      box.appendChild(label);
      box.appendChild(value);
      el.metrics.appendChild(box);
    });
  }

  function bar(container, segments) {
    clearNode(container);
    var wrap = document.createElement('div');
    wrap.className = 'dnl-bar';
    segments.forEach(function (seg) {
      if (!seg.pc) return;
      var s = document.createElement('span');
      s.className = 'dnl-seg-' + seg.key;
      s.style.width = seg.pc + '%';
      s.textContent = seg.pc >= 8 ? seg.pc + '%' : '';
      s.title = seg.label + ': ' + seg.pc + '%';
      wrap.appendChild(s);
    });
    container.appendChild(wrap);

    var legend = document.createElement('ul');
    legend.className = 'dnl-legend';
    segments.forEach(function (seg) {
      var li = document.createElement('li');
      var i = document.createElement('i');
      i.className = 'dnl-seg-' + seg.key;
      li.appendChild(i);
      li.appendChild(document.createTextNode(seg.label + ' ' + seg.pc + '%'));
      legend.appendChild(li);
    });
    container.appendChild(legend);
  }

  function renderDistribution() {
    var d = state.result.distribution;
    bar(el.distFollow, [
      { key: 'normal', label: 'Dofollow', pc: d.normal },
      { key: 'nofollow', label: 'Nofollow', pc: d.nofollow },
      { key: 'sponsored', label: 'Sponsored', pc: d.sponsored },
      { key: 'ugc', label: 'UGC', pc: d.ugc }
    ]);
    bar(el.distLocation, [
      { key: 'internal', label: 'Internal', pc: d.internal },
      { key: 'external', label: 'External', pc: d.external }
    ]);
  }

  /* -------------------------------------------------------- filtering */

  function filtered() {
    var links = state.result.links.map(function (l, i) { l._index = i + 1; return l; });
    var q = (el.search && el.search.value || '').trim().toLowerCase();

    return links.filter(function (l) {
      if (el.filterFollow && el.filterFollow.value !== 'all' && l.followStatus !== el.filterFollow.value) return false;
      if (el.filterRel && el.filterRel.value !== 'all' && l.relationship !== el.filterRel.value) return false;
      if (el.filterLocation && el.filterLocation.value !== 'all' && l.location !== el.filterLocation.value) return false;
      if (el.filterType && el.filterType.value !== 'all' && l.type !== el.filterType.value) return false;
      if (el.filterFlag && el.filterFlag.value !== 'all' && l.anchorFlags.indexOf(el.filterFlag.value) === -1) return false;
      if (q) {
        var hay = [l.anchorText, l.href, l.resolved, l.rel.raw, l.title].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var SORTERS = {
    index: function (a, b) { return a._index - b._index; },
    anchor: function (a, b) { return a.anchorText.localeCompare(b.anchorText); },
    url: function (a, b) { return String(a.resolved || a.href || '').localeCompare(String(b.resolved || b.href || '')); },
    status: function (a, b) { return a.followStatus.localeCompare(b.followStatus); },
    rel: function (a, b) { return a.relationship.localeCompare(b.relationship); },
    type: function (a, b) { return a.type.localeCompare(b.type); },
    location: function (a, b) { return a.location.localeCompare(b.location); }
  };

  function sorted(list) {
    var fn = SORTERS[state.sortKey] || SORTERS.index;
    var out = list.slice().sort(fn);
    if (state.sortDir === 'desc') out.reverse();
    return out;
  }

  function renderTable() {
    var rows = sorted(filtered());
    var per = state.perPage;
    var pages = Math.max(1, Math.ceil(rows.length / per));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * per;
    var slice = rows.slice(start, start + per);

    clearNode(el.tableBody);
    if (el.tableEmpty) el.tableEmpty.hidden = rows.length > 0;

    slice.forEach(function (l) {
      var tr = document.createElement('tr');

      tr.appendChild(td(String(l._index), '#', 'dnl-num'));
      tr.appendChild(td(l.anchorText || '(no text)', 'Anchor', 'dnl-anchor'));
      tr.appendChild(td(l.href === null ? '(no href)' : l.href, 'URL', 'dnl-url'));

      var statusCell = document.createElement('td');
      statusCell.setAttribute('data-label', 'Status');
      statusCell.appendChild(l.followStatus === 'normal'
        ? badge('✓ Dofollow', 'dnl-badge-normal')
        : badge('● Restricted', 'dnl-badge-restricted'));
      tr.appendChild(statusCell);

      var relCell = document.createElement('td');
      relCell.setAttribute('data-label', 'Rel');
      relCell.className = 'dnl-rel';
      relCell.textContent = l.rel.raw ? l.rel.raw : '—';
      if (l.rel.commaSuspected) relCell.appendChild(badge('comma', 'dnl-badge-flag'));
      if (l.rel.declaresDofollow) relCell.appendChild(badge('inert', 'dnl-badge-muted'));
      tr.appendChild(relCell);

      tr.appendChild(td(l.type, 'Type'));

      var locCell = document.createElement('td');
      locCell.setAttribute('data-label', 'Location');
      if (l.location === 'internal') locCell.appendChild(badge('Internal', 'dnl-badge-internal'));
      else if (l.location === 'external') locCell.appendChild(badge('External', 'dnl-badge-external'));
      else locCell.appendChild(badge('n/a', 'dnl-badge-muted'));
      tr.appendChild(locCell);

      var flagCell = document.createElement('td');
      flagCell.setAttribute('data-label', 'Notes');
      if (l.anchorFlags.length) {
        l.anchorFlags.forEach(function (f) { flagCell.appendChild(badge(f.replace(/-/g, ' '), 'dnl-badge-flag')); });
      } else {
        flagCell.textContent = '—';
      }
      tr.appendChild(flagCell);

      var actions = document.createElement('td');
      actions.setAttribute('data-label', 'Actions');
      var view = document.createElement('button');
      view.type = 'button';
      view.className = 'dnl-btn dnl-btn-sm';
      view.textContent = 'Details';
      view.setAttribute('aria-label', 'View details for link ' + l._index +
        (l.anchorText ? ': ' + l.anchorText : ''));
      view.addEventListener('click', function () { openDetail(l); });
      actions.appendChild(view);
      tr.appendChild(actions);

      el.tableBody.appendChild(tr);
    });

    if (el.pagerInfo) {
      el.pagerInfo.textContent = rows.length
        ? 'Showing ' + (start + 1) + '–' + Math.min(start + per, rows.length) + ' of ' + rows.length +
          ' (page ' + state.page + ' of ' + pages + ')'
        : 'No links match the current filters.';
    }
    if (el.prev) el.prev.disabled = state.page <= 1;
    if (el.next) el.next.disabled = state.page >= pages;
  }

  [el.search, el.filterFollow, el.filterRel, el.filterLocation, el.filterType, el.filterFlag].forEach(function (c) {
    if (!c) return;
    c.addEventListener('input', function () { state.page = 1; if (state.result) renderTable(); });
    c.addEventListener('change', function () { state.page = 1; if (state.result) renderTable(); });
  });

  if (el.clearFilters) el.clearFilters.addEventListener('click', function () {
    if (el.search) el.search.value = '';
    [el.filterFollow, el.filterRel, el.filterLocation, el.filterType, el.filterFlag].forEach(function (s) {
      if (s) s.value = 'all';
    });
    state.page = 1;
    if (state.result) renderTable();
  });

  if (el.perPage) el.perPage.addEventListener('change', function () {
    state.perPage = Number(el.perPage.value) || 25;
    state.page = 1;
    if (state.result) renderTable();
  });

  if (el.prev) el.prev.addEventListener('click', function () {
    if (state.page > 1) { state.page--; renderTable(); }
  });
  if (el.next) el.next.addEventListener('click', function () {
    state.page++; renderTable();
  });

  document.querySelectorAll('[data-dnl-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-dnl-sort');
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      document.querySelectorAll('.dnl-table thead th').forEach(function (th) { th.removeAttribute('aria-sort'); });
      var th = btn.closest('th');
      if (th) th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      if (state.result) renderTable();
    });
  });

  /* ------------------------------------------------------------ detail */

  /* Escapes the whole snippet first, then wraps the interesting attributes in
     <mark>. Because the escape happens before any tag is added, nothing from
     the audited page can become live markup here. */
  function highlightSource(html) {
    var safe = escapeHtml(html);
    return safe
      .replace(/(href=&quot;[^&]*?&quot;)/g, '<mark>$1</mark>')
      .replace(/(rel=&quot;[^&]*?&quot;)/g, '<mark>$1</mark>')
      .replace(/(target=&quot;[^&]*?&quot;)/g, '<mark>$1</mark>');
  }

  function openDetail(link) {
    if (!el.dialog || !el.dialogBody) return;
    clearNode(el.dialogBody);

    var dl = document.createElement('dl');
    dl.className = 'dnl-detail';
    var row = function (label, value) {
      if (value === null || value === undefined || value === '') return;
      var dt = document.createElement('dt');
      dt.textContent = label;
      var dd = document.createElement('dd');
      dd.textContent = String(value);
      dl.appendChild(dt); dl.appendChild(dd);
    };

    row('Anchor text', link.anchorText || '(none)');
    row('Text source', link.anchorSource);
    row('href', link.href === null ? '(no href attribute)' : link.href);
    row('Resolved URL', link.resolved || '(not a web URL)');
    row('Follow status', link.followLabel);
    row('Relationship', link.relationship);
    row('rel attribute', link.rel.raw === null ? '(no rel attribute)' : (link.rel.raw || '(empty)'));
    if (link.rel.restricting.length) row('Restricting tokens', link.rel.restricting.join(', '));
    if (link.rel.other.length) row('Other rel tokens', link.rel.other.join(', '));
    if (link.rel.unknown.length) row('Unrecognised tokens', link.rel.unknown.join(', '));
    row('Location', link.location);
    row('Host', link.host);
    row('Link type', link.type);
    row('Target', link.target);
    row('Title', link.title);
    row('ARIA label', link.ariaLabel);
    row('hreflang', link.hreflang);
    if (link.images.length) {
      row('Images inside', link.images.map(function (i) {
        return (i.src || '(no src)') + ' — alt: ' + (i.alt === null ? '(missing)' : (i.alt || '(empty)'));
      }).join(' | '));
    }
    if (link.anchorFlags.length) row('Notes', link.anchorFlags.join(', '));
    row('HTTP status', E.describeHttp(link.httpState, link.httpStatus));
    el.dialogBody.appendChild(dl);

    if (link.rel.commaSuspected) {
      var warn = document.createElement('p');
      warn.className = 'dnl-notice is-warn';
      warn.style.marginTop = '.8rem';
      warn.textContent = 'Note: this rel contains a comma. Browsers split rel on spaces only, so these values are read as one unrecognised token and have no effect.';
      el.dialogBody.appendChild(warn);
    }
    if (link.rel.declaresDofollow) {
      var inert = document.createElement('p');
      inert.className = 'dnl-notice is-info';
      inert.style.marginTop = '.8rem';
      inert.textContent = 'Note: rel="dofollow" is not a defined value and has no effect. Links are followable by default.';
      el.dialogBody.appendChild(inert);
    }

    if (link.outerHTML) {
      var pre = document.createElement('pre');
      pre.className = 'dnl-code';
      pre.innerHTML = highlightSource(link.outerHTML);
      el.dialogBody.appendChild(pre);
    }

    var actions = document.createElement('div');
    actions.className = 'dnl-btnrow';
    var copyUrl = document.createElement('button');
    copyUrl.type = 'button';
    copyUrl.className = 'dnl-btn dnl-btn-sm';
    copyUrl.textContent = 'Copy URL';
    copyUrl.addEventListener('click', function () { copyText(link.resolved || link.href || '', 'URL copied.'); });
    var copyAnchor = document.createElement('button');
    copyAnchor.type = 'button';
    copyAnchor.className = 'dnl-btn dnl-btn-sm';
    copyAnchor.textContent = 'Copy anchor text';
    copyAnchor.addEventListener('click', function () { copyText(link.anchorText, 'Anchor text copied.'); });
    actions.appendChild(copyUrl);
    actions.appendChild(copyAnchor);
    el.dialogBody.appendChild(actions);

    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else el.dialog.setAttribute('open', '');
  }

  if (el.dialogClose) el.dialogClose.addEventListener('click', function () {
    if (typeof el.dialog.close === 'function') el.dialog.close();
    else el.dialog.removeAttribute('open');
  });

  /* --------------------------------------------------------- breakdowns */

  function renderDomains() {
    clearNode(el.domainsBody);
    var domains = state.result.domains;
    if (el.domainsEmpty) el.domainsEmpty.hidden = domains.length > 0;
    domains.forEach(function (d) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.setAttribute('scope', 'row');
      th.textContent = d.domain;
      tr.appendChild(th);
      [d.links, d.normal, d.nofollow, d.sponsored, d.ugc].forEach(function (n, i) {
        tr.appendChild(td(String(n), ['Links', 'Normal', 'Nofollow', 'Sponsored', 'UGC'][i], 'dnl-num'));
      });
      el.domainsBody.appendChild(tr);
    });
  }

  function renderRepeats() {
    clearNode(el.repeatBody);
    var reps = state.result.repeatedAnchors;
    if (el.repeatEmpty) el.repeatEmpty.hidden = reps.length > 0;
    reps.slice(0, 25).forEach(function (r) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.setAttribute('scope', 'row');
      th.textContent = r.text;
      tr.appendChild(th);
      tr.appendChild(td(String(r.count), 'Uses', 'dnl-num'));
      tr.appendChild(td(String(r.distinctTargets), 'Destinations', 'dnl-num'));
      el.repeatBody.appendChild(tr);
    });
  }

  function renderInsights() {
    clearNode(el.insights);
    var LABEL = { info: 'Info', warn: 'Check', notice: 'Notice', good: 'Good' };
    state.result.insights.forEach(function (i) {
      var li = document.createElement('li');
      li.className = 'dnl-ins-' + i.level;
      var b = document.createElement('b');
      b.textContent = LABEL[i.level] || i.level;
      li.appendChild(b);
      li.appendChild(document.createTextNode(i.text));
      el.insights.appendChild(li);
    });
  }

  /* ------------------------------------------------------------ export */

  function copyText(text, label) {
    if (!text) { toast('Nothing to copy.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(label); },
        function () { fallbackCopy(text, label); });
    } else fallbackCopy(text, label);
  }

  function fallbackCopy(text, label) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    try { document.execCommand('copy'); toast(label); }
    catch (e) { toast('Copy failed — select the text manually.'); }
    document.body.removeChild(ta);
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function needResult() {
    if (state.result) return true;
    toast('Analyse a page first.');
    return false;
  }

  if (el.copySummary) el.copySummary.addEventListener('click', function () {
    if (!needResult()) return;
    copyText(E.summaryText(state.result), 'Summary copied.');
  });

  if (el.downloadCsv) el.downloadCsv.addEventListener('click', function () {
    if (!needResult()) return;
    download(new Blob([E.toCsv(state.result.links)], { type: 'text/csv;charset=utf-8' }), 'link-audit.csv');
    toast('CSV downloaded.');
  });

  if (el.downloadJson) el.downloadJson.addEventListener('click', function () {
    if (!needResult()) return;
    var payload = {
      baseUrl: state.result.baseUrl,
      summary: state.result.summary,
      distribution: state.result.distribution,
      domains: state.result.domains,
      repeatedAnchors: state.result.repeatedAnchors,
      insights: state.result.insights,
      links: state.result.links.map(function (l) {
        return {
          href: l.href, resolved: l.resolved, host: l.host, anchorText: l.anchorText,
          anchorSource: l.anchorSource, anchorFlags: l.anchorFlags,
          followStatus: l.followStatus, relationship: l.relationship,
          rel: l.rel.raw, relTokens: l.rel.tokens, location: l.location, type: l.type,
          target: l.target, title: l.title, httpState: l.httpState, httpStatus: l.httpStatus
        };
      })
    };
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'link-audit.json');
    toast('JSON downloaded.');
  });

  if (el.printBtn) el.printBtn.addEventListener('click', function () { window.print(); });

  selectTab('url');
  hideResults();
})();
