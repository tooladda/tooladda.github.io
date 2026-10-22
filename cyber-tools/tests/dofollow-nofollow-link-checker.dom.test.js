/* DOM tests for the Dofollow & Nofollow Link Checker page.
   Run: node cyber-tools/tests/dofollow-nofollow-link-checker.dom.test.js
   Skips cleanly when jsdom is not installed. */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('dofollow-nofollow-link-checker.dom — SKIPPED (jsdom not installed)');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'cyber-tools', 'dofollow-nofollow-link-checker.html');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + l); } };
const check = (a, e, l) => {
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${l}\n        expected ${JSON.stringify(e)}\n        actual   ${JSON.stringify(a)}`); }
};
const has = (a, sub, l) => {
  if (String(a).indexOf(sub) !== -1) pass++;
  else { fail++; console.log(`  FAIL  ${l}\n        "${String(a).slice(0, 140)}" lacks "${sub}"`); }
};

const html = fs.readFileSync(PAGE, 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://tooladda.online/cyber-tools/dofollow-nofollow-link-checker.html'
});
const w = dom.window;
// jsdom has no <dialog> support in older builds; stub what the UI calls.
if (!w.HTMLDialogElement || !w.HTMLDialogElement.prototype.showModal) {
  w.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLElement.prototype.close = function () { this.removeAttribute('open'); };
}
// jsdom does not implement scrollIntoView; record the calls instead.
const scrolled = [];
w.Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
w.eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'link-audit-engine.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'cyber-tools', 'js', 'dofollow-nofollow-link-checker.js'), 'utf8'));

const d = w.document;
const $ = (id) => d.getElementById(id);
const fire = (n, t) => n.dispatchEvent(new w.Event(t, { bubbles: true }));

function analyse(htmlText, baseUrl) {
  $('dnlHtml').value = htmlText;
  $('dnlBaseUrl').value = baseUrl || '';
  $('dnlAnalyse').click();
}

const SAMPLE = [
  '<a href="/about">About us</a>',
  '<a href="/pricing" rel="nofollow">Pricing</a>',
  '<a href="https://partner.example/deal" rel="sponsored" target="_blank">Our partner</a>',
  '<a href="https://forum.example/thread" rel="ugc">Reader comment</a>',
  '<a href="https://ads.example/x" rel="nofollow sponsored">Ad unit</a>',
  '<a href="https://old.example/x" rel="nofollow,ugc">Comma mistake</a>',
  '<a href="https://myth.example" rel="dofollow">Inert dofollow</a>',
  '<a href="/guide">Click here</a>',
  '<a href="/paper.pdf">Download the whitepaper</a>',
  '<a href="/product"><img src="p.jpg" alt="Blue widget"></a>',
  '<a href="/gallery"><img src="g.jpg" alt=""></a>',
  '<a href="mailto:hello@example.com">hello@example.com</a>',
  '<a href="#top"></a>'
].join('\n');

console.log('dofollow-nofollow-link-checker.dom');

/* ------------------------------------------------------------- structure */
console.log(' structure');
check(d.querySelectorAll('h1').length, 1, 'exactly one h1');
ok($('dnlUrl'), 'URL input exists');
ok($('dnlHtml'), 'HTML textarea exists');
ok($('dnlAnalyse'), 'analyse button exists');
ok($('dnlTableBody'), 'link table body exists');
ok(d.querySelector('.dnl-note'), 'limitations note is present');
const srcs = [...d.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
ok(srcs.indexOf('../assets/js/link-audit-engine.js') < srcs.indexOf('js/dofollow-nofollow-link-checker.js'),
  'engine loads before the UI');
ok(srcs.every((s) => !/^https?:/.test(s)), 'no third-party scripts');
ok($('dnlResults').hidden, 'results start hidden');

/* the page must never assert that dofollow is an attribute */
console.log(' honest terminology on the page');
const pageText = d.body.textContent;
has(pageText, 'There is no rel="dofollow"', 'page states plainly that rel=dofollow does not exist');
ok(!/rel="dofollow" (?:tells|makes|allows|instructs)/i.test(pageText),
  'page never describes rel=dofollow as doing something');
has(pageText, 'space-separated', 'page explains rel is space separated');

/* --------------------------------------------------------- analysis run */
console.log(' analysing pasted HTML');
analyse(SAMPLE, 'https://example.com/page');
ok(!$('dnlResults').hidden, 'results become visible');
ok(!$('dnlNotice').hidden, 'a status notice is shown');
has($('dnlNotice').textContent, '13 links', 'notice reports the link count');

const metrics = [...d.querySelectorAll('#dnlMetrics .dnl-metric')].map((m) => ({
  label: m.querySelector('span').textContent,
  value: m.querySelector('strong').textContent
}));
const metric = (name) => (metrics.find((m) => m.label === name) || {}).value;
check(metric('Total links'), '13', 'total links');
check(metric('Dofollow'), '9', 'dofollow count (links with no restricting token)');
check(metric('Nofollow'), '2', 'nofollow count (the comma one does not count)');
check(metric('Sponsored'), '2', 'sponsored count');
check(metric('UGC'), '1', 'ugc count');
check(metric('Empty anchor'), '1', 'empty anchor count');

/* -------------------------------------------------------- the comma trap */
console.log(' comma-separated rel is not treated as nofollow');
const rows = () => [...d.querySelectorAll('#dnlTableBody tr')].map((tr) =>
  [...tr.querySelectorAll('td')].map((c) => c.textContent));
const commaRow = rows().find((r) => r.join(' ').indexOf('Comma mistake') !== -1);
ok(commaRow, 'the comma link is listed');
has(commaRow.join(' | '), 'Dofollow', 'a comma-joined rel is reported as an unrestricted link');
has(commaRow.join(' | '), 'comma', 'the comma is flagged as a note');
ok(commaRow.join(' | ').indexOf('Restricted') === -1, 'it is not marked restricted');

console.log(' inert rel=dofollow is flagged');
const dofollowRow = rows().find((r) => r.join(' ').indexOf('Inert dofollow') !== -1);
ok(dofollowRow, 'the dofollow link is listed');
has(dofollowRow.join(' | '), 'inert', 'rel=dofollow is marked inert');
has(dofollowRow.join(' | '), 'Dofollow', 'and reported as an unrestricted link');

/* --------------------------------------------------------------- badges */
console.log(' badges carry words, not only colour');
const statusTexts = [...d.querySelectorAll('#dnlTableBody .dnl-badge-normal, #dnlTableBody .dnl-badge-restricted')]
  .map((b) => b.textContent);
ok(statusTexts.length > 0, 'status badges rendered');
ok(statusTexts.every((t) => /Dofollow|Restricted/.test(t)), 'every status badge names its state in words');
ok(statusTexts.some((t) => /✓/.test(t)) && statusTexts.some((t) => /●/.test(t)),
  'states also differ by glyph');
const locTexts = [...d.querySelectorAll('#dnlTableBody .dnl-badge-internal, #dnlTableBody .dnl-badge-external')]
  .map((b) => b.textContent);
ok(locTexts.some((t) => t === 'Internal') && locTexts.some((t) => t === 'External'),
  'internal and external are named');

/* ------------------------------------------------------------- filters */
console.log(' filters');
const visibleRows = () => d.querySelectorAll('#dnlTableBody tr').length;
check(visibleRows(), 13, 'all rows shown initially');
$('dnlFilterRel').value = 'nofollow';
fire($('dnlFilterRel'), 'change');
check(visibleRows(), 1, 'relationship filter narrows to nofollow only');
$('dnlFilterRel').value = 'multiple';
fire($('dnlFilterRel'), 'change');
check(visibleRows(), 1, 'multiple filter finds the combined rel');
$('dnlFilterRel').value = 'all';
fire($('dnlFilterRel'), 'change');
$('dnlFilterLocation').value = 'external';
fire($('dnlFilterLocation'), 'change');
// partner, forum, ads, old and myth are all on other hosts
check(visibleRows(), 5, 'location filter shows external links');
$('dnlFilterLocation').value = 'all';
fire($('dnlFilterLocation'), 'change');
$('dnlFilterType').value = 'file';
fire($('dnlFilterType'), 'change');
check(visibleRows(), 1, 'type filter finds the PDF');
$('dnlFilterType').value = 'all';
fire($('dnlFilterType'), 'change');
$('dnlFilterFlag').value = 'generic';
fire($('dnlFilterFlag'), 'change');
check(visibleRows(), 1, 'anchor-note filter finds the generic anchor');
$('dnlSearch').value = 'partner';
$('dnlFilterFlag').value = 'all';
fire($('dnlFilterFlag'), 'change');
check(visibleRows(), 1, 'search narrows by URL text');
$('dnlClearFilters').click();
check(visibleRows(), 13, 'clear filters restores every row');

/* -------------------------------------------------------------- sorting */
console.log(' sorting');
const firstAnchor = () => d.querySelector('#dnlTableBody tr td:nth-child(2)').textContent;
const sortBtn = d.querySelector('[data-dnl-sort="anchor"]');
sortBtn.click();
const ascFirst = firstAnchor();
check(sortBtn.closest('th').getAttribute('aria-sort'), 'ascending', 'aria-sort announces ascending');
sortBtn.click();
check(sortBtn.closest('th').getAttribute('aria-sort'), 'descending', 'aria-sort flips to descending');
ok(firstAnchor() !== ascFirst, 'the order actually changes');
d.querySelector('[data-dnl-sort="index"]').click();

/* ----------------------------------------------------------- pagination */
console.log(' pagination');
let many = '';
for (let i = 0; i < 60; i++) many += `<a href="/p${i}">Link ${i}</a>`;
analyse(many, 'https://example.com/page');
check(visibleRows(), 25, 'first page shows 25 rows');
has($('dnlPagerInfo').textContent, 'of 60', 'pager reports the total');
ok($('dnlPrev').disabled, 'previous is disabled on page one');
$('dnlNext').click();
has($('dnlPagerInfo').textContent, '26–50', 'next page advances the range');
ok(!$('dnlPrev').disabled, 'previous becomes available');
$('dnlPerPage').value = '100';
fire($('dnlPerPage'), 'change');
check(visibleRows(), 60, 'per-page change shows everything');
$('dnlPerPage').value = '25';
fire($('dnlPerPage'), 'change');

/* -------------------------------------------------------------- domains */
console.log(' external domain breakdown');
analyse(SAMPLE, 'https://example.com/page');
const domainRows = [...d.querySelectorAll('#dnlDomainsBody tr')].map((tr) => tr.textContent);
ok(domainRows.length >= 4, 'external domains listed');
ok(domainRows.some((r) => /partner\.example/.test(r)), 'a sponsoring domain appears');
ok(!domainRows.some((r) => /example\.com/.test(r) && !/\.example/.test(r)),
  'the analysed host is not listed as external');

/* --------------------------------------------------------- subdomains */
console.log(' subdomain option');
analyse('<a href="https://blog.example.com/post">Blog</a>', 'https://example.com/page');
has(rows()[0].join(' | '), 'External', 'a subdomain is external by default');
$('dnlSubdomains').checked = true;
fire($('dnlSubdomains'), 'change');
has(rows()[0].join(' | '), 'Internal', 'and internal once the option is on');
$('dnlSubdomains').checked = false;
fire($('dnlSubdomains'), 'change');

/* -------------------------------------------------------------- detail */
console.log(' link detail dialog');
analyse(SAMPLE, 'https://example.com/page');
const detailBtn = d.querySelector('#dnlTableBody button');
ok(detailBtn, 'a details button exists');
ok(/View details for link/.test(detailBtn.getAttribute('aria-label')), 'details button has an accessible name');
detailBtn.click();
const dl = $('dnlDialogBody').textContent;
has(dl, 'Anchor text', 'dialog shows anchor text');
has(dl, 'Resolved URL', 'dialog shows the resolved URL');
has(dl, 'Follow status', 'dialog shows follow status');
ok($('dnlDialogBody').querySelector('pre.dnl-code'), 'source HTML shown');
ok($('dnlDialogBody').querySelector('pre.dnl-code mark'), 'attributes are highlighted');
$('dnlDialogClose').click();

console.log(' source viewer cannot inject markup');
analyse('<a href="/x" rel="nofollow">Bad<img src=q onerror=alert(1)></a>', 'https://example.com/p');
d.querySelector('#dnlTableBody button').click();
const pre = $('dnlDialogBody').querySelector('pre.dnl-code');
check(pre.querySelectorAll('img').length, 0, 'no img element created from the audited HTML');
ok(pre.textContent.indexOf('<img') !== -1, 'the markup is shown as text instead');
ok(pre.querySelectorAll('mark').length > 0, 'our own highlight marks still render');
$('dnlDialogClose').click();

/* ------------------------------------------------------------ insights */
console.log(' insights');
analyse(SAMPLE, 'https://example.com/page');
const insights = [...d.querySelectorAll('#dnlInsights li')].map((li) => li.textContent);
ok(insights.length > 0, 'insights rendered');
ok(insights.some((t) => /comma/.test(t)), 'comma mistake surfaced');
ok(insights.some((t) => /not a defined value/.test(t)), 'inert dofollow surfaced');
ok(insights.every((t) => /^(Info|Check|Notice|Good)/.test(t)), 'each insight is prefixed with a word');
ok(!insights.some((t) => /penal|bad for seo|too many|hurts/i.test(t)), 'no invented penalties');

/* ------------------------------------------------------- error states */
console.log(' error states');
analyse('', 'https://example.com/page');
ok(/is-error/.test($('dnlNotice').className), 'empty HTML is an error');
has($('dnlNotice').textContent, 'No HTML content', 'empty HTML message');
ok($('dnlResults').hidden, 'results hidden on error');

analyse('<p>No links here</p>', 'https://example.com/page');
has($('dnlNotice').textContent, 'No HTML links were found', 'a genuinely link-free page says so');
ok(/is-warn/.test($('dnlNotice').className), 'and it is a warning, not an error');

/* --------------------------------------------------- scrolling to results */
console.log(' results are scrolled into view');
scrolled.length = 0;
analyse(SAMPLE, 'https://example.com/page');
check(scrolled.filter((id) => id === 'dnlResults').length, 1, 'a fresh analysis scrolls to the results');
// Re-rendering for a filter or the subdomain rule must leave the reader put.
scrolled.length = 0;
fire($('dnlSubdomains'), 'change');
$('dnlSearch').value = 'about';
fire($('dnlSearch'), 'input');
$('dnlNext').click();
check(scrolled.length, 0, 'filters, paging and the subdomain toggle never scroll');
scrolled.length = 0;
analyse('<p>No links here</p>', 'https://example.com/page');
check(scrolled.length, 0, 'a link-free document has nothing to scroll to');

$('dnlUrl').value = 'not a url';
$('dnlFetch').click();
ok(/is-error/.test($('dnlNotice').className), 'invalid URL rejected');
has($('dnlNotice').textContent, 'valid webpage URL', 'invalid URL message');
check($('dnlUrl').getAttribute('aria-invalid'), 'true', 'URL input flagged invalid');

// A direct request that is refused must fall back to the CORS relays, and only
// when those fail too may the tool report a failure — never as "no links" or "broken".
console.log(' fetch fallback and failure wording');
const noticeStrings = [];
const attempted = [];
scrolled.length = 0;
// Every route fails: the direct request plus one call per relay.
w.fetch = function (target) { attempted.push(String(target)); return Promise.reject(new Error('CORS')); };
$('dnlUrl').value = 'https://example.com';
$('dnlFetch').click();
// The chain is sequential, so wait for the button to be re-enabled rather than
// guessing a tick count.
const settled = (() => {
  const start = Date.now();
  const spin = () => (!$('dnlFetch').disabled || Date.now() - start > 5000)
    ? null
    : Promise.resolve().then(spin);
  return Promise.resolve().then(spin);
})();
return settled.then(() => {
  noticeStrings.push($('dnlNotice').textContent);
  ok(attempted.length >= 2, 'a refused direct request is retried through a relay');
  // 1 direct + 3 relays raced, then the whole race repeated once: relay
  // failures against protected sites are usually transient.
  check(attempted.length, 7, 'all three relays are raced, and the race is retried once');
  check(scrolled.length, 0, 'a failed fetch has no results to scroll to');
  ok(attempted.some((u) => /example\.com/.test(u) && !/proxy|allorigins|corsproxy/.test(u)),
    'the direct request is tried first');
  ok(attempted.some((u) => /codetabs|allorigins|corsproxy/.test(u)), 'a CORS relay is used as fallback');
  ok(!/no links found/i.test(noticeStrings.join(' ')), 'a fetch failure never says no links found');
  ok(!/broken/i.test(noticeStrings.join(' ')), 'a fetch failure never says broken');
  has($('dnlNotice').textContent, 'paste', 'an exhausted fetch points at the paste route');
  check($('dnlTabHtml').getAttribute('aria-selected'), 'true', 'an exhausted fetch switches to the paste tab');
  // That tab switch is the desired behaviour, so put the UI back before the
  // later checks that assert the default tab state.
  $('dnlTabUrl').click();

  /* ------------------------------------------------------------ export */
  console.log(' export');
  analyse(SAMPLE, 'https://example.com/page');
  let copied = '';
  w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  $('dnlCopySummary').click();
  has(copied, 'Total links: 13', 'summary copies the total');
  has(copied, 'There is no dofollow attribute in HTML.', 'summary restates the dofollow fact');

  /* ----------------------------------------------------- accessibility */
  console.log(' accessibility');
  ok(d.querySelector('.skip-link'), 'skip link present');
  check(d.documentElement.getAttribute('lang'), 'en', 'lang declared');
  ok(d.querySelector('label[for="dnlUrl"]'), 'URL input labelled');
  ok(d.querySelector('label[for="dnlHtml"]'), 'HTML textarea labelled');
  check($('dnlNotice').getAttribute('role'), 'status', 'notice is a live status region');
  check($('dnlPagerInfo').getAttribute('aria-live'), 'polite', 'pager updates are announced');
  ok(d.querySelectorAll('.dnl-table caption').length >= 3, 'every data table has a caption');
  ok([...d.querySelectorAll('.dnl-table thead th')].every((t) => t.getAttribute('scope') === 'col'),
    'table column headers are scoped');
  const labelled = [...d.querySelectorAll('select, input[type=search], input[type=url], textarea')]
    .every((n) => (n.id && d.querySelector(`label[for="${n.id}"]`)) || n.getAttribute('aria-label') || n.closest('label'));
  ok(labelled, 'every control has an associated label');
  check($('dnlTabUrl').getAttribute('role'), 'tab', 'input modes are tabs');
  check($('dnlTabUrl').getAttribute('aria-selected'), 'true', 'the URL tab starts selected');
  $('dnlTabHtml').click();
  check($('dnlTabHtml').getAttribute('aria-selected'), 'true', 'tab selection moves');
  ok($('dnlPanelUrl').hidden, 'the inactive panel is hidden');

  /* --------------------------------------------------- schema vs page */
  console.log(' FAQ schema mirrors the page');
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');
  const visible = [...d.querySelectorAll('.dnl-faqs details')].map((n) => ({
    q: n.querySelector('summary').textContent.trim(),
    a: n.querySelector('p').textContent.trim()
  }));
  check(visible.length, faq.mainEntity.length, 'same number of FAQs');
  ok(visible.length >= 20, 'at least 20 FAQs');
  let drift = 0;
  faq.mainEntity.forEach((entry, i) => {
    if (!visible[i]) { drift++; return; }
    if (entry.name.trim() !== visible[i].q) drift++;
    if (entry.acceptedAnswer.text.trim() !== visible[i].a) drift++;
  });
  check(drift, 0, 'every schema question and answer appears verbatim on the page');
  const types = ld['@graph'].map((n) => n['@type']);
  ok(types.includes('WebApplication'), 'WebApplication schema present');
  ok(types.includes('HowTo'), 'HowTo schema present');
  ok(types.includes('BreadcrumbList'), 'BreadcrumbList schema present');
  const app = ld['@graph'].find((n) => n['@type'] === 'WebApplication');
  ok(!('aggregateRating' in app) && !('review' in app), 'no invented ratings or reviews');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
