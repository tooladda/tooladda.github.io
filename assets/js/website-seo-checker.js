(function () {
  'use strict';

  const root = document.querySelector('[data-seo-checker]');
  if (!root) return;
  const $ = (s) => root.querySelector(s);

  const el = {
    urlInput: $('[data-url-input]'),
    keywordInput: $('[data-keyword-input]'),
    serpTitle: $('[data-serp-title]'),
    serpUrl: $('[data-serp-url]'),
    serpDesc: $('[data-serp-desc]'),
    serp: $('[data-serp]'),
    filters: Array.from(root.querySelectorAll('[data-filter]')),
    analyzeBtn: $('[data-analyze-btn]'),
    sampleBtn: $('[data-sample-btn]'),
    pasteToggle: $('[data-paste-toggle]'),
    htmlWrap: $('[data-html-wrap]'),
    htmlInput: $('[data-html-input]'),
    htmlAnalyzeBtn: $('[data-html-analyze-btn]'),
    message: $('[data-message]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    results: $('[data-results]'),
    gauge: $('[data-gauge]'),
    gaugeVal: $('[data-gauge-val]'),
    gaugeLabel: $('[data-gauge-label]'),
    countPass: $('[data-count-pass]'),
    countWarn: $('[data-count-warn]'),
    countFail: $('[data-count-fail]'),
    cats: $('[data-cats]'),
    checks: $('[data-checks]'),
    reUrl: $('[data-analyzed-url]'),
    psiLink: $('[data-psi-link]'),
    copyBtn: $('[data-copy-report]'),
    downloadBtn: $('[data-download-report]'),
    printBtn: $('[data-print-report]'),
    reanalyze: $('[data-reanalyze]'),
  };

  let lastReport = null;

  const msg = (t, tone) => { if (!el.message) return; el.message.textContent = t; el.message.hidden = false; el.message.dataset.tone = tone || 'info'; };
  const clearMsg = () => { if (el.message) { el.message.hidden = true; el.message.textContent = ''; } };
  const setProgress = (p, show) => { if (!el.progress) return; el.progress.hidden = !show; if (el.progressBar) el.progressBar.style.width = Math.round(p) + '%'; };

  const normalizeUrl = (v) => {
    v = (v || '').trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { const u = new URL(v); if (!u.hostname.includes('.')) return null; return u; } catch (e) { return null; }
  };

  /* ---------- fetch page HTML via CORS proxies ---------- */
  const PROXIES = [
    (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  ];
  const fetchHtml = async (url) => {
    for (let i = 0; i < PROXIES.length; i++) {
      setProgress(15 + i * 20, true);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(PROXIES[i](url), { signal: ctrl.signal });
        clearTimeout(t);
        const text = await res.text();
        // must look like a real HTML document, not a proxy error page
        if (text && text.length > 200 && /<html|<head|<body|<title/i.test(text)) return text;
      } catch (e) { /* try next */ }
    }
    return null;
  };

  /* ---------- checks ---------- */
  const CATS = {
    onpage: 'On-Page SEO', technical: 'Technical SEO', social: 'Meta & Social',
    schema: 'Structured Data', content: 'Content', links: 'Links & URL', keywords: 'Keyword Usage',
  };

  const runChecks = (doc, url, keyword) => {
    const checks = [];
    const add = (cat, status, label, detail, fix, weight) => checks.push({ cat, status, label, detail, fix, weight: weight || 1 });
    const q = (s) => doc.querySelector(s);
    const qa = (s) => Array.from(doc.querySelectorAll(s));
    const attr = (s, a) => { const e = q(s); return e ? (e.getAttribute(a) || '') : null; };

    // Title
    const titleEls = qa('head title');
    const title = titleEls[0] ? titleEls[0].textContent.trim() : '';
    if (!title) add('onpage', 'fail', 'Title tag', 'No <title> found.', 'Add a unique, descriptive <title> of 30–60 characters with your main keyword.', 3);
    else {
      const n = title.length;
      if (n >= 30 && n <= 60) add('onpage', 'pass', 'Title length', `Title is ${n} characters. "${title.slice(0, 60)}"`, '', 3);
      else add('onpage', 'warn', 'Title length', `Title is ${n} characters (ideal 30–60). "${title.slice(0, 70)}"`, n > 60 ? 'Shorten the title so it is not truncated in search results.' : 'Lengthen the title with descriptive keywords.', 3);
    }
    if (titleEls.length > 1) add('onpage', 'fail', 'Multiple titles', `${titleEls.length} <title> tags found.`, 'Keep exactly one <title> tag.', 1);

    // Meta description
    const descEls = qa('meta[name="description"]');
    const desc = descEls[0] ? (descEls[0].getAttribute('content') || '').trim() : '';
    if (!desc) add('onpage', 'fail', 'Meta description', 'No meta description found.', 'Add a compelling meta description of 70–160 characters.', 3);
    else {
      const n = desc.length;
      if (n >= 70 && n <= 160) add('onpage', 'pass', 'Meta description length', `Description is ${n} characters.`, '', 2);
      else add('onpage', 'warn', 'Meta description length', `Description is ${n} characters (ideal 70–160).`, n > 160 ? 'Trim the description so it is not cut off in SERPs.' : 'Expand the description to better summarize the page.', 2);
    }
    if (descEls.length > 1) add('onpage', 'warn', 'Multiple descriptions', `${descEls.length} meta descriptions found.`, 'Keep only one meta description.', 1);

    // H1
    const h1s = qa('h1');
    if (h1s.length === 0) add('onpage', 'fail', 'H1 heading', 'No H1 found.', 'Add a single H1 that describes the page topic.', 2);
    else if (h1s.length === 1) add('onpage', 'pass', 'H1 heading', `One H1: "${h1s[0].textContent.trim().slice(0, 70)}"`, '', 2);
    else add('onpage', 'warn', 'H1 heading', `${h1s.length} H1 tags found.`, 'Use exactly one H1; make the rest H2/H3.', 2);

    // Headings structure
    const h2 = qa('h2').length, h3 = qa('h3').length;
    if (h2 > 0) add('onpage', 'pass', 'Subheadings', `${h2} H2 and ${h3} H3 headings.`, '', 1);
    else add('onpage', 'warn', 'Subheadings', 'No H2 headings found.', 'Break content into sections with H2/H3 headings.', 1);

    // Images alt
    const imgs = qa('img');
    const noAlt = imgs.filter((i) => !i.getAttribute('alt') || !i.getAttribute('alt').trim());
    if (imgs.length === 0) add('onpage', 'info', 'Image alt text', 'No images found on the page.', '', 0);
    else if (noAlt.length === 0) add('onpage', 'pass', 'Image alt text', `All ${imgs.length} images have alt text.`, '', 2);
    else add('onpage', 'warn', 'Image alt text', `${noAlt.length} of ${imgs.length} images are missing alt text.`, 'Add descriptive alt text to every meaningful image.', 2);

    // Canonical
    const canon = attr('link[rel="canonical"]', 'href');
    if (canon) add('technical', 'pass', 'Canonical tag', `Canonical: ${canon}`, '', 2);
    else add('technical', 'warn', 'Canonical tag', 'No canonical tag found.', 'Add a self-referencing canonical link to avoid duplicate-content issues.', 2);

    // HTTPS
    if (url && url.protocol === 'https:') add('technical', 'pass', 'HTTPS', 'The page is served over HTTPS.', '', 3);
    else if (url) add('technical', 'fail', 'HTTPS', 'The page is not HTTPS.', 'Install an SSL certificate and serve the site over HTTPS.', 3);

    // Viewport / mobile
    const vp = attr('meta[name="viewport"]', 'content');
    if (vp && /width=device-width/i.test(vp)) add('technical', 'pass', 'Mobile viewport', 'Responsive viewport meta tag is present.', '', 3);
    else add('technical', 'fail', 'Mobile viewport', 'No responsive viewport meta tag.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', 3);

    // Robots meta
    const robots = (attr('meta[name="robots"]', 'content') || '').toLowerCase();
    if (robots.includes('noindex')) add('technical', 'fail', 'Indexability', 'Page has a "noindex" robots meta — it will not be indexed.', 'Remove noindex if you want this page to rank.', 3);
    else add('technical', 'pass', 'Indexability', robots ? `Robots meta: ${robots}` : 'No noindex — page is indexable.', '', 2);

    // lang
    const lang = doc.documentElement.getAttribute('lang');
    if (lang) add('technical', 'pass', 'Language attribute', `<html lang="${lang}">`, '', 1);
    else add('technical', 'warn', 'Language attribute', 'No lang attribute on <html>.', 'Add lang="en" (or your language) to <html>.', 1);

    // charset
    if (q('meta[charset]') || q('meta[http-equiv="Content-Type"]')) add('technical', 'pass', 'Charset', 'Character encoding is declared.', '', 1);
    else add('technical', 'warn', 'Charset', 'No charset meta found.', 'Add <meta charset="UTF-8"> as the first head element.', 1);

    // favicon
    if (q('link[rel~="icon"]')) add('technical', 'pass', 'Favicon', 'A favicon is linked.', '', 1);
    else add('technical', 'warn', 'Favicon', 'No favicon link found.', 'Add a favicon for branding and trust.', 1);

    // OG
    const ogT = q('meta[property="og:title"]'), ogD = q('meta[property="og:description"]'), ogI = q('meta[property="og:image"]');
    if (ogT && ogD && ogI) add('social', 'pass', 'Open Graph', 'og:title, og:description and og:image are present.', '', 2);
    else add('social', 'warn', 'Open Graph', 'Some Open Graph tags are missing.', 'Add og:title, og:description, og:image and og:url for rich social sharing.', 2);

    // Twitter
    if (q('meta[name="twitter:card"]')) add('social', 'pass', 'Twitter Card', 'Twitter card meta is present.', '', 1);
    else add('social', 'warn', 'Twitter Card', 'No Twitter card meta.', 'Add twitter:card, twitter:title, twitter:description and twitter:image.', 1);

    // Structured data
    const ld = qa('script[type="application/ld+json"]');
    if (ld.length) {
      let types = [];
      ld.forEach((s) => { try { const d = JSON.parse(s.textContent); (Array.isArray(d) ? d : (d['@graph'] || [d])).forEach((o) => { if (o && o['@type']) types.push([].concat(o['@type']).join('/')); }); } catch (e) {} });
      add('schema', 'pass', 'Structured data', `${ld.length} JSON-LD block(s)${types.length ? ' — ' + Array.from(new Set(types)).slice(0, 6).join(', ') : ''}.`, '', 2);
    } else add('schema', 'warn', 'Structured data', 'No JSON-LD structured data found.', 'Add schema.org markup (e.g. WebPage, Breadcrumb, FAQ) for rich results.', 2);

    // Content length. Script, style and template text is not content a reader sees,
    // so it is left out (a page's JSON-LD or inline JS used to count as words).
    const textRoot = doc.body ? doc.body.cloneNode(true) : null;
    if (textRoot) textRoot.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
    const visibleText = textRoot ? textRoot.textContent : '';
    const bodyText = visibleText.replace(/\s+/g, ' ').trim();
    const words = bodyText ? bodyText.split(' ').length : 0;
    if (words >= 600) add('content', 'pass', 'Content length', `About ${words} words of text.`, '', 2);
    else if (words >= 300) add('content', 'warn', 'Content length', `About ${words} words — a bit thin.`, 'Aim for richer, more helpful content (600+ words for key pages).', 2);
    else add('content', 'fail', 'Content length', `Only about ${words} words — thin content.`, 'Add substantial, original, helpful content.', 2);

    // Links
    const links = qa('a[href]');
    let internal = 0, external = 0;
    // Pasted HTML has no address: judge links against the canonical URL if there is
    // one, and count relative links as internal (they used to all count as external).
    let base = 'https://pasted.invalid/';
    if (url) base = url.href;
    else if (canon) { try { base = new URL(canon).href; } catch (e) { /* keep the placeholder */ } }
    const host = new URL(base).hostname.replace(/^www\./, '');
    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;
      try {
        const lu = new URL(href, base);
        if (lu.hostname.replace(/^www\./, '') === host) internal++; else external++;
      } catch (e) { internal++; }
    });
    if (internal >= 3) add('links', 'pass', 'Internal links', `${internal} internal links found.`, '', 1);
    else add('links', 'warn', 'Internal links', `${internal} internal links.`, 'Add internal links to related pages to spread authority.', 1);
    add('links', 'info', 'External links', `${external} external links found.`, '', 0);

    // URL structure
    if (url) {
      const path = url.pathname + url.search;
      const bad = url.href.length > 115 || /[_ ]/.test(url.pathname) || /[A-Z]/.test(url.pathname) || (url.search && url.search.length > 40);
      if (!bad) add('links', 'pass', 'URL structure', 'Clean, readable URL.', '', 1);
      else add('links', 'warn', 'URL structure', 'URL is long or contains underscores/uppercase/params.', 'Use short, lowercase, hyphenated, keyword-rich URLs.', 1);
    }

    // Heading order (no skipped levels)
    const levels = qa('h1,h2,h3,h4,h5,h6').map((h) => Number(h.tagName[1]));
    if (levels.length) {
      let skip = false, prev = 0;
      levels.forEach((l) => { if (prev && l > prev + 1) skip = true; prev = l; });
      if (skip) add('onpage', 'warn', 'Heading order', 'Heading levels skip a step (e.g. H2 → H4).', 'Keep headings in order (H1→H2→H3) for a clear outline.', 1);
      else add('onpage', 'pass', 'Heading order', 'Headings follow a logical order.', '', 1);
    }

    // Invalid JSON-LD
    let ldBad = 0;
    ld.forEach((s) => { try { JSON.parse(s.textContent); } catch (e) { ldBad++; } });
    if (ldBad) add('schema', 'fail', 'Structured data validity', `${ldBad} JSON-LD block(s) contain invalid JSON.`, 'Fix the JSON syntax so search engines can read your structured data.', 1);

    // target=_blank without rel=noopener (security & perf)
    const blanks = qa('a[target="_blank"]');
    const unsafe = blanks.filter((a) => !/noopener/i.test(a.getAttribute('rel') || ''));
    if (blanks.length) {
      if (unsafe.length) add('technical', 'warn', 'New-tab link safety', `${unsafe.length} target="_blank" link(s) missing rel="noopener".`, 'Add rel="noopener" (or noreferrer) to new-tab links for security and performance.', 1);
      else add('technical', 'pass', 'New-tab link safety', 'All new-tab links use rel="noopener".', '', 1);
    }

    // DOM size (Core Web Vitals / INP hint)
    const nodes = doc.getElementsByTagName('*').length;
    if (nodes > 1800) add('technical', 'warn', 'DOM size', `Large DOM (~${nodes} elements).`, 'Reduce DOM nodes to improve rendering and Interaction to Next Paint (INP).', 1);
    else add('technical', 'pass', 'DOM size', `DOM has ~${nodes} elements.`, '', 1);

    // Focus keyword usage (optional)
    const kw = (keyword || '').trim().toLowerCase();
    if (kw) {
      const has = (s) => (s || '').toLowerCase().includes(kw);
      const tTitle = (qa('head title')[0] || {}).textContent || '';
      const dEl = q('meta[name="description"]'); const dTxt = dEl ? (dEl.getAttribute('content') || '') : '';
      const hh1 = (qa('h1')[0] || {}).textContent || '';
      add('keywords', has(tTitle) ? 'pass' : 'fail', 'Keyword in title', has(tTitle) ? `"${kw}" appears in the title.` : `"${kw}" is missing from the title.`, has(tTitle) ? '' : 'Include your focus keyword near the start of the title.', 2);
      add('keywords', has(dTxt) ? 'pass' : 'warn', 'Keyword in meta description', has(dTxt) ? 'Present in the description.' : 'Not found in the meta description.', has(dTxt) ? '' : 'Add the focus keyword naturally to the meta description.', 1);
      add('keywords', has(hh1) ? 'pass' : 'warn', 'Keyword in H1', has(hh1) ? 'Present in the H1.' : 'Not found in the H1.', has(hh1) ? '' : 'Use the focus keyword in the main H1 heading.', 1);
      const slug = url ? decodeURIComponent(url.pathname || '').toLowerCase().replace(/[-_/]+/g, ' ') : '';
      const inSlug = slug.includes(kw);
      add('keywords', inSlug ? 'pass' : 'warn', 'Keyword in URL', inSlug ? 'Present in the URL slug.' : 'Not found in the URL.', inSlug ? '' : 'Use the focus keyword in the page URL slug where natural.', 1);
      const body = visibleText.toLowerCase();
      const occ = body ? (body.split(kw).length - 1) : 0;
      if (occ >= 1) add('keywords', 'pass', 'Keyword in content', `Appears ~${occ} time(s) in the page content.`, '', 1);
      else add('keywords', 'fail', 'Keyword in content', `"${kw}" does not appear in the visible content.`, 'Use the focus keyword naturally in the body copy.', 1);
    }

    return checks;
  };

  const score = (checks) => {
    let earned = 0, total = 0;
    checks.forEach((c) => {
      if (c.status === 'info' || c.weight === 0) return;
      total += c.weight;
      earned += c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight * 0.5 : 0;
    });
    return total ? Math.round((earned / total) * 100) : 0;
  };

  const catScore = (checks, cat) => score(checks.filter((c) => c.cat === cat));

  /* ---------- render ---------- */
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const band = (s) => (s >= 80 ? 'good' : s >= 50 ? 'warn' : 'bad');
  const bandLabel = (s) => (s >= 80 ? 'Good' : s >= 50 ? 'Needs work' : 'Poor');

  let currentFilter = 'all';
  const applyFilter = () => {
    Array.from(el.checks.children).forEach((node) => {
      node.hidden = !(currentFilter === 'all' || node.getAttribute('data-status') === currentFilter);
    });
  };
  el.filters.forEach((b) => b.addEventListener('click', () => {
    currentFilter = b.getAttribute('data-filter');
    el.filters.forEach((x) => x.classList.toggle('is-active', x === b));
    applyFilter();
  }));

  const render = (checks, url, meta) => {
    const overall = score(checks);
    lastReport = { checks, url, overall };
    el.results.hidden = false;

    // Google SERP preview
    if (el.serp) {
      const t = (meta && meta.title) || 'Untitled page';
      const d = (meta && meta.desc) || 'No meta description found — search engines may generate one from the page content.';
      if (el.serpTitle) el.serpTitle.textContent = t.slice(0, 62) + (t.length > 62 ? '…' : '');
      if (el.serpUrl) el.serpUrl.textContent = url ? (url.hostname + (url.pathname === '/' ? '' : url.pathname)) : 'yourwebsite.com';
      if (el.serpDesc) el.serpDesc.textContent = d.slice(0, 158) + (d.length > 158 ? '…' : '');
      el.serp.hidden = false;
    }

    // gauge
    const circ = 2 * Math.PI * 52;
    if (el.gauge) { el.gauge.style.strokeDasharray = circ; el.gauge.style.strokeDashoffset = circ * (1 - overall / 100); el.gauge.setAttribute('data-band', band(overall)); }
    if (el.gaugeVal) el.gaugeVal.textContent = overall;
    if (el.gaugeLabel) { el.gaugeLabel.textContent = bandLabel(overall); el.gaugeLabel.setAttribute('data-band', band(overall)); }

    const counts = { pass: 0, warn: 0, fail: 0 };
    checks.forEach((c) => { if (counts[c.status] != null) counts[c.status]++; });
    if (el.countPass) el.countPass.textContent = counts.pass;
    if (el.countWarn) el.countWarn.textContent = counts.warn;
    if (el.countFail) el.countFail.textContent = counts.fail;

    // categories (only those that produced checks)
    const present = Object.keys(CATS).filter((k) => checks.some((c) => c.cat === k && c.status !== 'info'));
    el.cats.innerHTML = present.map((k) => {
      const s = catScore(checks, k);
      return `<div class="ssc-cat"><div class="ssc-cat-top"><span>${CATS[k]}</span><strong data-band="${band(s)}">${s}</strong></div><div class="ssc-bar"><div class="ssc-bar-fill" data-band="${band(s)}" style="width:${s}%"></div></div></div>`;
    }).join('');

    // checks grouped: fail, warn, pass, info
    const order = { fail: 0, warn: 1, pass: 2, info: 3 };
    const icon = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
    const sorted = checks.slice().sort((a, b) => order[a.status] - order[b.status]);
    // Details quote the analysed page (its title, H1, canonical...), so everything is
    // escaped: a title such as <img onerror=...> must show as text, never run here.
    // Escaping also lets the fixes that quote a tag (<meta name="viewport"...>) show it.
    el.checks.innerHTML = sorted.map((c) => `
      <div class="ssc-check" data-status="${c.status}">
        <span class="ssc-check-ic" data-status="${c.status}" aria-hidden="true">${icon[c.status]}</span>
        <div>
          <p class="ssc-check-label">${escHtml(c.label)} <span class="ssc-tag">${CATS[c.cat]}</span></p>
          <p class="ssc-check-detail">${escHtml(c.detail || '')}</p>
          ${c.fix ? `<p class="ssc-check-fix">💡 ${escHtml(c.fix)}</p>` : ''}
        </div>
      </div>`).join('');
    currentFilter = 'all';
    el.filters.forEach((x) => x.classList.toggle('is-active', x.getAttribute('data-filter') === 'all'));
    applyFilter();

    if (el.reUrl) el.reUrl.textContent = url ? url.href : 'pasted HTML';
    if (el.psiLink && url) el.psiLink.href = 'https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(url.href);
    if (el.psiLink) el.psiLink.hidden = !url;

    el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- report export ---------- */
  const buildReport = () => {
    if (!lastReport) return '';
    const { checks, url, overall } = lastReport;
    let out = `Website SEO Checker report\nURL: ${url ? url.href : 'pasted HTML'}\nOverall SEO score: ${overall}/100 (${bandLabel(overall)})\n\n`;
    Object.keys(CATS).forEach((k) => { out += `## ${CATS[k]} — ${catScore(checks, k)}/100\n`; checks.filter((c) => c.cat === k).forEach((c) => { out += `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}${c.fix ? ' | Fix: ' + c.fix : ''}\n`; }); out += '\n'; });
    out += 'Generated by ToolAdda Website SEO Checker — https://tooladda.online/website-seo-checker.html\n';
    return out;
  };

  /* ---------- flow ---------- */
  const analyzeHtmlString = (html, url) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const keyword = el.keywordInput ? el.keywordInput.value : '';
    const checks = runChecks(doc, url, keyword);
    const titleEl = doc.querySelector('head title');
    const descEl = doc.querySelector('meta[name="description"]');
    const meta = { title: titleEl ? titleEl.textContent.trim() : '', desc: descEl ? (descEl.getAttribute('content') || '').trim() : '' };
    render(checks, url, meta);
    clearMsg();
    setProgress(0, false);
  };

  const runUrl = async () => {
    const u = normalizeUrl(el.urlInput.value);
    if (!u) { msg('Please enter a valid website URL, e.g. https://example.com', 'error'); return; }
    clearMsg();
    el.analyzeBtn.disabled = true;
    const btnText = el.analyzeBtn.textContent;
    el.analyzeBtn.textContent = '⏳ Analyzing…';
    setProgress(8, true);
    msg('Fetching your page and running SEO checks…', 'info');
    const html = await fetchHtml(u.href);
    el.analyzeBtn.disabled = false;
    el.analyzeBtn.textContent = btnText;
    if (!html) {
      setProgress(0, false);
      msg('Could not fetch that URL automatically (some sites block cross-origin requests). Paste your page HTML below to analyze it instead.', 'error');
      if (el.htmlWrap) el.htmlWrap.hidden = false;
      return;
    }
    setProgress(90, true);
    analyzeHtmlString(html, u);
  };

  el.analyzeBtn.addEventListener('click', runUrl);
  el.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runUrl(); } });
  if (el.sampleBtn) el.sampleBtn.addEventListener('click', () => { el.urlInput.value = 'https://tooladda.online/'; runUrl(); });
  if (el.pasteToggle) el.pasteToggle.addEventListener('click', () => { if (el.htmlWrap) el.htmlWrap.hidden = !el.htmlWrap.hidden; });
  if (el.htmlAnalyzeBtn) el.htmlAnalyzeBtn.addEventListener('click', () => {
    const html = (el.htmlInput.value || '').trim();
    if (html.length < 30) { msg('Paste a page\'s HTML source to analyze it.', 'error'); return; }
    let url = normalizeUrl(el.urlInput.value) || null;
    analyzeHtmlString(html, url);
  });
  if (el.reanalyze) el.reanalyze.addEventListener('click', () => { el.results.hidden = true; el.urlInput.focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  if (el.copyBtn) el.copyBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(buildReport()); el.copyBtn.textContent = '✓ Copied!'; setTimeout(() => el.copyBtn.textContent = '📋 Copy report', 1500); } catch (e) {} });
  if (el.downloadBtn) el.downloadBtn.addEventListener('click', () => {
    const blob = new Blob([buildReport()], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'seo-report.txt'; a.click(); URL.revokeObjectURL(a.href);
  });
  if (el.printBtn) el.printBtn.addEventListener('click', () => window.print());
})();
