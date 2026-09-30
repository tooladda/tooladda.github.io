/* Link audit engine — rel attribute parsing and link classification.
 *
 * Pure logic plus one DOM-reading helper. Exposed as window.LinkAuditEngine
 * and as a CommonJS module so the tests can require it in Node.
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE:
 *
 *  1. "dofollow" is not a real rel value. There is no HTML attribute that
 *     grants link equity. A link is reported as "normal" when it carries no
 *     token that restricts crawling or attribution — that is the honest
 *     framing, and classify() never invents a dofollow attribute. If an author
 *     literally wrote rel="dofollow", that is recorded as an inert token so
 *     the report can point out that it does nothing.
 *
 *  2. rel is split on ASCII whitespace only, exactly as the HTML spec and
 *     every browser do. rel="nofollow,sponsored" is therefore ONE token that
 *     matches nothing, so the link is normal. Splitting on commas here would
 *     be more forgiving than the browser and would report a restriction that
 *     search engines do not see — a misclassification in the dangerous
 *     direction. The comma is flagged as a likely authoring mistake instead.
 *
 *  3. A request that fails is never a broken link. Cross-origin rules,
 *     firewalls, bot protection and authentication all produce the same
 *     failure as a genuine 404 when seen from a browser, so an unverifiable
 *     link is reported as unverifiable and never as broken.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LinkAuditEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Tokens that restrict crawling or link attribution. */
  var RESTRICTING = ['nofollow', 'sponsored', 'ugc'];

  /* Real, standardised rel values that do not affect attribution — listed so
     the report can separate them from genuine noise. */
  var KNOWN_OTHER = [
    'noopener', 'noreferrer', 'external', 'me', 'alternate', 'author', 'bookmark',
    'canonical', 'help', 'icon', 'license', 'manifest', 'next', 'prev', 'search',
    'stylesheet', 'tag', 'preconnect', 'prefetch', 'preload', 'dns-prefetch', 'opener'
  ];

  var GENERIC_ANCHORS = [
    'click here', 'click', 'here', 'read more', 'learn more', 'more', 'more info',
    'find out more', 'this', 'this page', 'link', 'this link', 'go', 'view',
    'see more', 'details', 'continue', 'continue reading', 'download', 'website'
  ];

  var IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tiff'];
  var FILE_EXT = [
    'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'csv', 'txt', 'rtf', 'odt', 'ods', 'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'exe', 'dmg', 'apk'
  ];

  /* ------------------------------------------------------------ rel parse */

  /* Split exactly as the HTML spec does: on ASCII whitespace, nothing else. */
  function splitRel(rel) {
    if (rel == null) return [];
    return String(rel).split(/[ \t\n\f\r]+/).filter(function (t) { return t !== ''; });
  }

  function parseRel(rel) {
    var raw = rel == null ? null : String(rel);
    var tokens = splitRel(raw);
    var lower = tokens.map(function (t) { return t.toLowerCase(); });

    var restricting = RESTRICTING.filter(function (t) { return lower.indexOf(t) !== -1; });
    var other = lower.filter(function (t) {
      return RESTRICTING.indexOf(t) === -1 && KNOWN_OTHER.indexOf(t) !== -1;
    });
    var unknown = lower.filter(function (t) {
      return RESTRICTING.indexOf(t) === -1 && KNOWN_OTHER.indexOf(t) === -1;
    });

    /* A comma inside rel almost always means the author expected commas to
       separate values. Browsers do not, so the tokens either side are never
       recognised. Worth surfacing — but it must not change the result. */
    var commaSuspected = raw !== null && raw.indexOf(',') !== -1;

    /* rel="dofollow" is inert. Recorded so the UI can say exactly that. */
    var declaresDofollow = lower.indexOf('dofollow') !== -1;

    return {
      raw: raw,
      present: raw !== null,
      tokens: lower,
      restricting: restricting,
      other: other,
      unknown: unknown,
      commaSuspected: commaSuspected,
      declaresDofollow: declaresDofollow,
      nofollow: restricting.indexOf('nofollow') !== -1,
      sponsored: restricting.indexOf('sponsored') !== -1,
      ugc: restricting.indexOf('ugc') !== -1
    };
  }

  /* "normal" — no restricting token. Deliberately not called "dofollow". */
  function followStatus(relInfo) {
    return relInfo.restricting.length ? 'restricted' : 'normal';
  }

  function relationship(relInfo) {
    if (relInfo.restricting.length > 1) return 'multiple';
    if (relInfo.restricting.length === 1) return relInfo.restricting[0];
    return 'none';
  }

  /* --------------------------------------------------------------- URLs */

  function stripWww(host) {
    return String(host || '').replace(/^www\./i, '').toLowerCase();
  }

  /* Not a public-suffix implementation — just the last two labels, which is
     enough to group blog.example.com with example.com when the user asks for
     subdomains to count as internal. Documented as an approximation because
     it is wrong for hosts like example.co.uk. */
  function registrableish(host) {
    var parts = stripWww(host).split('.');
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
  }

  function safeUrl(href, base) {
    try { return base ? new URL(href, base) : new URL(href); }
    catch (e) { return null; }
  }

  function schemeOf(href) {
    var m = /^([a-z][a-z0-9+.-]*):/i.exec(String(href || '').trim());
    return m ? m[1].toLowerCase() : null;
  }

  function extensionOf(pathname) {
    var m = /\.([a-z0-9]+)$/i.exec(String(pathname || ''));
    return m ? m[1].toLowerCase() : null;
  }

  function linkType(href, resolved) {
    var raw = String(href == null ? '' : href).trim();
    var scheme = schemeOf(raw);

    if (raw.charAt(0) === '#') return 'anchor';
    if (scheme === 'mailto') return 'mail';
    if (scheme === 'tel' || scheme === 'sms' || scheme === 'callto') return 'phone';
    if (scheme === 'javascript') return 'script';
    if (scheme === 'data') return 'data';
    if (scheme && scheme !== 'http' && scheme !== 'https') return 'other';

    if (resolved) {
      if (resolved.pathname === '' || resolved.pathname === '/') return 'page';
      var ext = extensionOf(resolved.pathname);
      if (ext) {
        if (IMAGE_EXT.indexOf(ext) !== -1) return 'image';
        if (FILE_EXT.indexOf(ext) !== -1) return 'file';
      }
    }
    return 'page';
  }

  /* ------------------------------------------------------- anchor text */

  function normaliseSpace(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /* Work out the text a reader (and a crawler) actually gets, and where it
     came from, so the report can say "this link's only text is an image alt". */
  function resolveAnchorText(data) {
    var text = normaliseSpace(data.text);
    if (text) return { text: text, source: 'text' };

    var alts = (data.images || [])
      .map(function (i) { return normaliseSpace(i.alt); })
      .filter(Boolean);
    if (alts.length) return { text: alts.join(' '), source: 'image-alt' };

    var aria = normaliseSpace(data.ariaLabel);
    if (aria) return { text: aria, source: 'aria-label' };

    var title = normaliseSpace(data.title);
    if (title) return { text: title, source: 'title' };

    return { text: '', source: 'none' };
  }

  function anchorFlags(data, resolvedText) {
    var flags = [];
    var hasImages = (data.images || []).length > 0;

    if (!resolvedText.text) {
      flags.push(hasImages ? 'image-without-alt' : 'empty');
    } else {
      if (GENERIC_ANCHORS.indexOf(resolvedText.text.toLowerCase()) !== -1) flags.push('generic');
      if (resolvedText.source === 'image-alt') flags.push('image-alt-only');
      if (resolvedText.source === 'aria-label') flags.push('aria-label-only');
      if (resolvedText.source === 'title') flags.push('title-only');
      if (/^https?:\/\//i.test(resolvedText.text)) flags.push('url-as-text');
    }
    return flags;
  }

  /* ------------------------------------------------------------ classify */

  /* data: { href, rel, text, title, target, ariaLabel, hreflang, download,
             images: [{src, alt}], outerHTML }
     options: { baseUrl, subdomainsAreInternal } */
  function classify(data, options) {
    var o = options || {};
    var base = o.baseUrl || null;
    var href = data.href == null ? null : String(data.href);
    var trimmed = href === null ? '' : href.trim();

    var relInfo = parseRel(data.rel);
    var resolved = null;
    var scheme = schemeOf(trimmed);
    var isWebScheme = !scheme || scheme === 'http' || scheme === 'https';

    if (trimmed && isWebScheme) {
      resolved = safeUrl(trimmed, base || undefined);
    }

    var type = linkType(trimmed, resolved);
    var text = resolveAnchorText(data);

    /* Location. Only a resolvable http(s) URL can be compared with the page's
       own host; anything else is neither internal nor external. */
    var location = 'not-applicable';
    var host = null;
    var isWeb = !!(resolved && (resolved.protocol === 'http:' || resolved.protocol === 'https:'));

    if (isWeb) {
      host = resolved.hostname;
      if (base) {
        var baseUrl = safeUrl(base);
        if (baseUrl) {
          var a = stripWww(host);
          var b = stripWww(baseUrl.hostname);
          if (a === b) location = 'internal';
          else if (o.subdomainsAreInternal && registrableish(a) === registrableish(b)) location = 'internal';
          else location = 'external';
        } else {
          location = 'unknown';
        }
      } else {
        location = 'unknown';
      }
    }

    var status = followStatus(relInfo);

    return {
      href: href,
      resolved: resolved ? resolved.href : null,
      host: host,
      scheme: scheme || (trimmed.charAt(0) === '#' ? 'fragment' : 'relative'),
      type: type,
      isWeb: isWeb,
      location: location,

      rel: relInfo,
      relationship: relationship(relInfo),
      followStatus: status,
      /* "Dofollow" is the everyday name for a link that carries no restricting
         token, and it is what people come here looking for, so the label uses
         it. What must never be implied is that the page carries a dofollow
         attribute: rel.declaresDofollow reports that separately, and it is
         false for every link that simply has no rel. */
      followLabel: status === 'normal' ? 'Dofollow' : 'Restricted',

      anchorText: text.text,
      anchorSource: text.source,
      anchorFlags: anchorFlags(data, text),

      title: normaliseSpace(data.title) || null,
      target: data.target || null,
      ariaLabel: normaliseSpace(data.ariaLabel) || null,
      hreflang: data.hreflang || null,
      download: data.download === undefined ? null : data.download,
      images: data.images || [],
      outerHTML: data.outerHTML || null,

      /* Filled in later, only by an actual successful check. */
      httpStatus: null,
      httpState: 'unchecked'
    };
  }

  /* --------------------------------------------------------- extraction */

  /* Reads anchors out of a parsed document. Kept separate from classify() so
     every classification rule stays testable without a DOM. */
  function extractFromDocument(doc) {
    var anchors = doc.querySelectorAll('a');
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var imgs = [];
      var imgNodes = a.querySelectorAll ? a.querySelectorAll('img') : [];
      for (var j = 0; j < imgNodes.length; j++) {
        imgs.push({
          src: imgNodes[j].getAttribute('src') || null,
          alt: imgNodes[j].getAttribute('alt')
        });
      }
      out.push({
        href: a.getAttribute('href'),
        rel: a.getAttribute('rel'),
        text: a.textContent || '',
        title: a.getAttribute('title'),
        target: a.getAttribute('target'),
        ariaLabel: a.getAttribute('aria-label'),
        hreflang: a.getAttribute('hreflang'),
        download: a.hasAttribute('download') ? (a.getAttribute('download') || '') : undefined,
        images: imgs,
        outerHTML: a.outerHTML || null
      });
    }
    return out;
  }

  /* Find a <base href> so relative links resolve the way a browser would. */
  function baseFromDocument(doc, fallback) {
    var b = doc.querySelector ? doc.querySelector('base[href]') : null;
    if (b) {
      var resolved = safeUrl(b.getAttribute('href'), fallback || undefined);
      if (resolved) return resolved.href;
    }
    return fallback || null;
  }

  /* ------------------------------------------------------------ summary */

  function summarise(links) {
    var counts = {
      total: links.length,
      normal: 0, restricted: 0,
      nofollow: 0, sponsored: 0, ugc: 0, multiple: 0,
      internal: 0, external: 0, nonWeb: 0,
      emptyAnchor: 0, genericAnchor: 0, imageWithoutAlt: 0,
      relPresent: 0, commaSuspected: 0, declaresDofollow: 0
    };
    var types = {};

    links.forEach(function (l) {
      if (l.followStatus === 'normal') counts.normal++; else counts.restricted++;
      if (l.rel.nofollow) counts.nofollow++;
      if (l.rel.sponsored) counts.sponsored++;
      if (l.rel.ugc) counts.ugc++;
      if (l.rel.restricting.length > 1) counts.multiple++;
      if (l.rel.present) counts.relPresent++;
      if (l.rel.commaSuspected) counts.commaSuspected++;
      if (l.rel.declaresDofollow) counts.declaresDofollow++;

      if (l.location === 'internal') counts.internal++;
      else if (l.location === 'external') counts.external++;
      if (!l.isWeb) counts.nonWeb++;

      if (l.anchorFlags.indexOf('empty') !== -1) counts.emptyAnchor++;
      if (l.anchorFlags.indexOf('image-without-alt') !== -1) counts.imageWithoutAlt++;
      if (l.anchorFlags.indexOf('generic') !== -1) counts.genericAnchor++;

      types[l.type] = (types[l.type] || 0) + 1;
    });

    counts.types = types;
    return counts;
  }

  /* Percentages of the whole, for the distribution bar. Rounded for display
     only; the counts stay the source of truth. */
  function distribution(summary) {
    var total = summary.total || 0;
    var pc = function (n) { return total ? Math.round((n / total) * 1000) / 10 : 0; };
    return {
      normal: pc(summary.normal),
      nofollow: pc(summary.nofollow),
      sponsored: pc(summary.sponsored),
      ugc: pc(summary.ugc),
      internal: pc(summary.internal),
      external: pc(summary.external)
    };
  }

  function domainBreakdown(links) {
    var map = {};
    links.forEach(function (l) {
      if (!l.isWeb || l.location !== 'external' || !l.host) return;
      var key = stripWww(l.host);
      if (!map[key]) map[key] = { domain: key, links: 0, normal: 0, nofollow: 0, sponsored: 0, ugc: 0 };
      var d = map[key];
      d.links++;
      if (l.followStatus === 'normal') d.normal++;
      if (l.rel.nofollow) d.nofollow++;
      if (l.rel.sponsored) d.sponsored++;
      if (l.rel.ugc) d.ugc++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.links - a.links || a.domain.localeCompare(b.domain); });
  }

  /* Anchor texts used more than once. Worth seeing, but not a fault in
     itself — navigation legitimately repeats. */
  function repeatedAnchors(links) {
    var map = {};
    links.forEach(function (l) {
      if (!l.anchorText) return;
      var k = l.anchorText.toLowerCase();
      if (!map[k]) map[k] = { text: l.anchorText, count: 0, targets: {} };
      map[k].count++;
      if (l.resolved) map[k].targets[l.resolved] = true;
    });
    return Object.keys(map)
      .map(function (k) {
        return { text: map[k].text, count: map[k].count, distinctTargets: Object.keys(map[k].targets).length };
      })
      .filter(function (r) { return r.count > 1; })
      .sort(function (a, b) { return b.count - a.count || a.text.localeCompare(b.text); });
  }

  /* --------------------------------------------------------- insights */

  /* Factual observations only. Nothing here asserts a ranking penalty, and
     nothing calls a ratio good or bad. */
  function insights(links, summary) {
    var out = [];
    var add = function (level, text) { out.push({ level: level, text: text }); };
    var plural = function (n, one, many) { return n === 1 ? one : many; };

    add('info', summary.normal + ' of ' + summary.total +
      ' links carry no nofollow, sponsored or ugc token.');

    if (summary.nofollow) add('info', summary.nofollow + ' ' + plural(summary.nofollow, 'link carries', 'links carry') + ' rel="nofollow".');
    if (summary.sponsored) add('info', summary.sponsored + ' ' + plural(summary.sponsored, 'link carries', 'links carry') + ' rel="sponsored".');
    if (summary.ugc) add('info', summary.ugc + ' ' + plural(summary.ugc, 'link carries', 'links carry') + ' rel="ugc".');
    if (summary.multiple) add('info', summary.multiple + ' ' + plural(summary.multiple, 'link combines', 'links combine') + ' more than one restricting token.');

    if (summary.emptyAnchor) {
      add('warn', summary.emptyAnchor + ' ' + plural(summary.emptyAnchor, 'link has', 'links have') +
        ' no text a reader or crawler can use. Adding text, or an alt on the image inside, would describe the destination.');
    }
    if (summary.imageWithoutAlt) {
      add('warn', summary.imageWithoutAlt + ' image ' + plural(summary.imageWithoutAlt, 'link has', 'links have') +
        ' no alt text, so the link has no accessible name.');
    }
    if (summary.genericAnchor) {
      add('notice', summary.genericAnchor + ' ' + plural(summary.genericAnchor, 'link uses', 'links use') +
        ' generic anchor text such as "click here". More specific wording describes the destination better.');
    }
    if (summary.commaSuspected) {
      add('warn', summary.commaSuspected + ' rel ' + plural(summary.commaSuspected, 'attribute contains', 'attributes contain') +
        ' a comma. Browsers split rel on spaces only, so comma-separated values are read as a single unrecognised token and have no effect.');
    }
    if (summary.declaresDofollow) {
      add('notice', summary.declaresDofollow + ' ' + plural(summary.declaresDofollow, 'link declares', 'links declare') +
        ' rel="dofollow", which is not a defined value and does nothing. Links are followable by default.');
    }
    if (summary.total && !summary.emptyAnchor && !summary.imageWithoutAlt) {
      add('good', 'Every link has text or an accessible name.');
    }
    if (summary.nonWeb) {
      add('info', summary.nonWeb + ' ' + plural(summary.nonWeb, 'link is', 'links are') +
        ' not an http(s) destination (for example mailto, tel or an on-page anchor) and cannot be internal or external.');
    }
    return out;
  }

  /* ------------------------------------------------------------ analyse */

  function analyseDocument(doc, options) {
    var o = options || {};
    var base = baseFromDocument(doc, o.baseUrl || null);
    var raw = extractFromDocument(doc);
    var links = raw.map(function (d) {
      return classify(d, { baseUrl: base, subdomainsAreInternal: !!o.subdomainsAreInternal });
    });
    var summary = summarise(links);
    return {
      baseUrl: base,
      links: links,
      summary: summary,
      distribution: distribution(summary),
      domains: domainBreakdown(links),
      repeatedAnchors: repeatedAnchors(links),
      insights: insights(links, summary)
    };
  }

  function analyseHtml(html, options) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('No HTML parser available in this environment.');
    }
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return analyseDocument(doc, options);
  }

  /* ----------------------------------------------------- status labels */

  /* The only place an HTTP result becomes words. "blocked" and "error" both
     mean the browser could not see the answer — neither is evidence that the
     link is broken. */
  var HTTP_STATES = {
    unchecked: 'Not checked',
    ok: 'Reachable',
    redirect: 'Redirected',
    clientError: 'Client error',
    serverError: 'Server error',
    blocked: 'Could not verify (blocked by the browser)',
    timeout: 'Could not verify (timed out)',
    error: 'Could not verify'
  };

  function describeHttp(state, status) {
    if (state === 'ok' || state === 'redirect' || state === 'clientError' || state === 'serverError') {
      return status + ' ' + HTTP_STATES[state];
    }
    return HTTP_STATES[state] || HTTP_STATES.unchecked;
  }

  function stateForStatus(status) {
    if (status >= 200 && status < 300) return 'ok';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'clientError';
    if (status >= 500) return 'serverError';
    return 'error';
  }

  /* ------------------------------------------------------------- export */

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    /* Neutralise anything a spreadsheet would evaluate as a formula. */
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCsv(links) {
    var head = ['URL', 'Resolved URL', 'Anchor text', 'Follow status', 'Rel', 'Relationship',
      'Location', 'Link type', 'HTTP state', 'HTTP status', 'Title', 'Target'];
    var rows = [head.map(csvCell).join(',')];
    links.forEach(function (l) {
      rows.push([
        l.href, l.resolved, l.anchorText, l.followLabel, l.rel.raw, l.relationship,
        l.location, l.type, HTTP_STATES[l.httpState] || l.httpState, l.httpStatus, l.title, l.target
      ].map(csvCell).join(','));
    });
    return rows.join('\r\n');
  }

  function summaryText(result) {
    var s = result.summary;
    return [
      'Link audit summary' + (result.baseUrl ? ' for ' + result.baseUrl : ''),
      'Total links: ' + s.total,
      'Dofollow: ' + s.normal,
      'Nofollow: ' + s.nofollow,
      'Sponsored: ' + s.sponsored,
      'UGC: ' + s.ugc,
      'Internal: ' + s.internal,
      'External: ' + s.external,
      'Non-web (mailto, tel, anchors): ' + s.nonWeb,
      'Empty anchor text: ' + s.emptyAnchor,
      'Unique external domains: ' + result.domains.length,
      '',
      '"Dofollow" here means the link carries no nofollow, sponsored or ugc token.',
      'There is no dofollow attribute in HTML.'
    ].join('\n');
  }

  return {
    RESTRICTING: RESTRICTING,
    KNOWN_OTHER: KNOWN_OTHER,
    GENERIC_ANCHORS: GENERIC_ANCHORS,
    HTTP_STATES: HTTP_STATES,

    splitRel: splitRel,
    parseRel: parseRel,
    followStatus: followStatus,
    relationship: relationship,

    stripWww: stripWww,
    registrableish: registrableish,
    schemeOf: schemeOf,
    linkType: linkType,
    normaliseSpace: normaliseSpace,
    resolveAnchorText: resolveAnchorText,
    anchorFlags: anchorFlags,

    classify: classify,
    extractFromDocument: extractFromDocument,
    baseFromDocument: baseFromDocument,
    analyseDocument: analyseDocument,
    analyseHtml: analyseHtml,

    summarise: summarise,
    distribution: distribution,
    domainBreakdown: domainBreakdown,
    repeatedAnchors: repeatedAnchors,
    insights: insights,

    describeHttp: describeHttp,
    stateForStatus: stateForStatus,
    toCsv: toCsv,
    summaryText: summaryText
  };
});
