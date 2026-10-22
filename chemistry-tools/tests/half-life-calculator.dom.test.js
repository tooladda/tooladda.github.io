/* DOM tests for the Half-Life Calculator page.
   Run: node chemistry-tools/tests/half-life-calculator.dom.test.js
   Skips cleanly when jsdom is not installed. */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('half-life-calculator.dom — SKIPPED (jsdom not installed)');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'chemistry-tools', 'half-life-radioactive-decay-calculator.html');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + l); } };
const check = (a, e, l) => {
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${l}\n        expected ${e}\n        actual   ${a}`); }
};
const has = (a, sub, l) => {
  if (String(a).indexOf(sub) !== -1) pass++;
  else { fail++; console.log(`  FAIL  ${l}\n        "${a}" does not contain "${sub}"`); }
};

function boot() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.requestAnimationFrame = () => 0;
  w.cancelAnimationFrame = () => {};
  // the engine and the UI, in the order the page loads them
  w.eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'half-life-engine.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'chemistry-tools', 'js', 'half-life-calculator.js'), 'utf8'));
  return w;
}

const w = boot();
const d = w.document;
const $ = (id) => d.getElementById(id);
const fire = (node, type) => node.dispatchEvent(new w.Event(type, { bubbles: true }));

console.log('half-life-calculator.dom');

/* ------------------------------------------------------------- structure */
console.log(' structure');
check(d.querySelectorAll('h1').length, 1, 'exactly one h1');
check(d.querySelectorAll('[data-hld-mode]').length, 4, 'four solve modes');
check(d.querySelectorAll('[data-hld-gmode]').length, 3, 'three graph modes');
ok($('hldGraph'), 'graph svg exists');
ok($('hldSlider'), 'timeline slider exists');
ok($('hldTableBody'), 'decay table body exists');
ok(d.querySelector('.hld-note'), 'educational disclaimer is present');
// the scripts must load in dependency order
const srcs = [...d.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
ok(srcs.indexOf('../assets/js/half-life-engine.js') < srcs.indexOf('js/half-life-calculator.js'),
  'engine is loaded before the UI');
ok(srcs.every((s) => !/^https?:/.test(s)), 'no third-party scripts');

/* -------------------------------------------------------- default answer */
console.log(' default calculation (1000 g, T=10 y, t=30 y)');
has($('hldHeadValue').textContent, '125', 'headline shows 125');
has($('hldHeadValue').textContent, 'g', 'headline shows the unit');
check($('hldPctRemaining').textContent, '12.5%', 'percent remaining');
check($('hldPctDecayed').textContent, '87.5%', 'percent decayed');
check($('hldHalfLivesPassed').textContent, '3', 'three half-lives');
has($('hldDecayedQty').textContent, '875', 'decayed quantity');
has($('hldLambda').textContent, 'year⁻¹', 'decay constant carries a reciprocal-time unit');
has($('hldMeanLife').textContent, 'year', 'mean lifetime carries a time unit');

/* ------------------------------------------------------------ live edit */
console.log(' live recalculation');
$('hldElapsed').value = '10';
fire($('hldElapsed'), 'input');
has($('hldHeadValue').textContent, '500', 'one half-life leaves 500 g');
check($('hldPctRemaining').textContent, '50%', 'one half-life is 50%');
$('hldElapsed').value = '0';
fire($('hldElapsed'), 'input');
has($('hldHeadValue').textContent, '1000', 'zero elapsed time leaves the initial amount');
check($('hldPctDecayed').textContent, '0%', 'nothing decayed at t=0');
$('hldElapsed').value = '30';
fire($('hldElapsed'), 'input');

/* ------------------------------------------------------ unit conversion */
console.log(' unit conversion through the UI');
$('hldHalfLife').value = '1';
$('hldHalfLifeUnit').value = 'years';
$('hldElapsed').value = '730.5';   // two Julian years expressed in days
$('hldElapsedUnit').value = 'days';
fire($('hldElapsedUnit'), 'change');
check($('hldPctRemaining').textContent, '25%', '730.5 days against a 1-year half-life is two half-lives');

/* --------------------------------------------------------- error states */
console.log(' validation');
$('hldHalfLife').value = '0';
fire($('hldHalfLife'), 'input');
ok(!$('hldError').hidden, 'zero half-life shows an error');
has($('hldError').textContent, 'greater than zero', 'error explains the problem');
check($('hldHeadValue').textContent, '—', 'results are cleared while invalid');
$('hldHalfLife').value = '10';
$('hldElapsed').value = '-5';
$('hldElapsedUnit').value = 'years';
fire($('hldElapsed'), 'input');
ok(!$('hldError').hidden, 'negative elapsed time shows an error');
has($('hldError').textContent, 'negative', 'error mentions the negative value');
$('hldInitial').value = 'abc';
$('hldElapsed').value = '30';
fire($('hldInitial'), 'input');
ok(!$('hldError').hidden, 'non-numeric input shows an error');
// never leak a raw JS error to the user
ok(!/undefined|NaN|\[object|TypeError/.test($('hldError').textContent), 'error text is user-facing prose');
$('hldInitial').value = '1000';
fire($('hldInitial'), 'input');
ok($('hldError').hidden, 'error clears once inputs are valid again');

/* ----------------------------------------------------------- solve modes */
console.log(' solve modes');
const modeBtn = (m) => d.querySelector(`[data-hld-mode="${m}"]`);
modeBtn('time').click();
check(modeBtn('time').getAttribute('aria-pressed'), 'true', 'mode button reflects pressed state');
ok(!$('hldFieldTarget').hidden, 'target field appears in Find time mode');
ok($('hldElapsed').readOnly, 'elapsed time becomes an output in Find time mode');
$('hldInitial').value = '1000';
$('hldHalfLife').value = '10';
$('hldTarget').value = '125';
fire($('hldTarget'), 'input');
check(Number($('hldElapsed').value), 30, 'Find time solves 1000 -> 125 as 30 years');

modeBtn('halflife').click();
ok($('hldHalfLife').readOnly, 'half-life becomes an output in Find half-life mode');
$('hldInitial').value = '1000';
$('hldTarget').value = '125';
$('hldElapsed').value = '30';
fire($('hldTarget'), 'input');
check(Number($('hldHalfLife').value), 10, 'Find half-life solves 1000 -> 125 in 30 y as T = 10');

modeBtn('initial').click();
ok($('hldInitial').readOnly, 'initial becomes an output in Find initial mode');
$('hldHalfLife').value = '10';
$('hldElapsed').value = '30';
$('hldTarget').value = '125';
fire($('hldTarget'), 'input');
check(Number($('hldInitial').value), 1000, 'Find initial recovers N0 = 1000');

modeBtn('remaining').click();
ok(!$('hldElapsed').readOnly, 'inputs become editable again in the default mode');
ok($('hldFieldTarget').hidden, 'target field hides in the default mode');

/* --------------------------------------------------------------- graph */
console.log(' graph');
$('hldInitial').value = '1000';
$('hldHalfLife').value = '10';
$('hldElapsed').value = '30';
fire($('hldElapsed'), 'input');
const svg = $('hldGraph');
ok(svg.querySelector('path.hld-line'), 'curve path is drawn');
ok(svg.querySelector('path.hld-area'), 'area fill is drawn');
ok(svg.querySelector('circle.hld-marker-dot'), 'marker dot is drawn at the elapsed time');
ok(svg.querySelectorAll('line.hld-grid-line').length > 0, 'grid lines are drawn');
const dAttr = svg.querySelector('path.hld-line').getAttribute('d');
ok(/^M[\d.]+ [\d.]+/.test(dAttr), 'path data starts with a move command');
ok(!/NaN|Infinity/.test(dAttr), 'path data contains no NaN or Infinity');
// the accessible description must carry the real numbers, not just say "a chart"
has($('hldGraphDesc').textContent, '125', 'graph description states the remaining quantity');
has($('hldGraphDesc').textContent, '12.5%', 'graph description states the percentage');
const gmode = (m) => d.querySelector(`[data-hld-gmode="${m}"]`);
gmode('percent').click();
check(gmode('percent').getAttribute('aria-pressed'), 'true', 'percent graph mode toggles');
ok(!/NaN/.test(svg.querySelector('path.hld-line').getAttribute('d')), 'percent mode path is valid');
gmode('decayed').click();
ok(!/NaN/.test(svg.querySelector('path.hld-line').getAttribute('d')), 'decayed mode path is valid');
gmode('quantity').click();

/* ------------------------------------------------------------- ladder */
console.log(' half-life ladder');
const rungs = d.querySelectorAll('#hldLadder .hld-rung');
check(rungs.length, 6, 'ladder shows start plus five half-lives');
const vals = [...rungs].map((r) => r.querySelector('.hld-rung-val').textContent);
check(vals[0], '100%', 'ladder starts at 100%');
check(vals[1], '50%', 'ladder 1 half-life');
check(vals[2], '25%', 'ladder 2 half-lives');
check(vals[3], '12.5%', 'ladder 3 half-lives');
check(vals[4], '6.25%', 'ladder 4 half-lives');
check(vals[5], '3.125%', 'ladder 5 half-lives keeps full precision');

/* --------------------------------------------------------------- table */
console.log(' decay table');
const rows = d.querySelectorAll('#hldTableBody tr');
ok(rows.length >= 10, 'table has a useful number of rows');
check(rows[0].querySelectorAll('th,td').length, 5, 'five columns per row');
ok(d.querySelector('#hldTableBody tr.is-current'), 'the row matching the elapsed time is marked');
const before = rows.length;
$('hldShowMore').click();
ok(d.querySelectorAll('#hldTableBody tr').length > before, 'Show more adds rows');

/* ------------------------------------------------------------- steps */
console.log(' step-by-step working');
const steps = d.querySelectorAll('#hldSteps li');
ok(steps.length >= 5, 'at least five working steps');
const stepText = [...steps].map((s) => s.textContent).join(' ');
has(stepText, 'n = t', 'working shows the half-life count formula');
has(stepText, '125', 'working reaches the right answer');
ok(!/NaN|undefined/.test(stepText), 'working has no placeholder values');

/* ------------------------------------------------------------ slider */
console.log(' timeline slider');
$('hldSlider').value = '1';
fire($('hldSlider'), 'input');
check($('hldPctRemaining').textContent, '50%', 'slider at 1 half-life gives 50%');
has($('hldSliderVal').textContent, '1.00', 'slider label shows the half-life count');
$('hldSlider').value = '2';
fire($('hldSlider'), 'input');
check($('hldPctRemaining').textContent, '25%', 'slider at 2 half-lives gives 25%');
check(Number($('hldElapsed').value), 20, 'slider drives the elapsed-time input');

/* ---------------------------------------------------------- simulation */
console.log(' simulation controls');
check($('hldPlay').getAttribute('aria-pressed'), 'false', 'simulation starts paused');
$('hldPlay').click();
check($('hldPlay').getAttribute('aria-pressed'), 'true', 'play toggles on');
$('hldPlay').click();
check($('hldPlay').getAttribute('aria-pressed'), 'false', 'play toggles off');
$('hldRestart').click();
check(Number($('hldSlider').value), 0, 'restart returns the timeline to zero');

/* ------------------------------------------------------------ presets */
console.log(' presets');
const c14 = d.querySelector('[data-hld-preset^="1000|g|5730"]');
ok(c14, 'carbon-14 preset button exists');
c14.click();
check($('hldHalfLife').value, '5730', 'preset loads the carbon-14 half-life');
check($('hldHalfLifeUnit').value, 'years', 'preset loads the right unit');
check($('hldPctRemaining').textContent, '25%', 'two carbon-14 half-lives leave 25%');

/* ----------------------------------------------------------- notation */
console.log(' notation toggle');
$('hldNotation').value = 'scientific';
fire($('hldNotation'), 'change');
has($('hldHeadValue').textContent, '× 10', 'scientific notation is applied');
$('hldNotation').value = 'decimal';
fire($('hldNotation'), 'change');
ok(!/× 10/.test($('hldHeadValue').textContent), 'decimal notation is applied');
$('hldNotation').value = 'auto';
fire($('hldNotation'), 'change');

/* -------------------------------------------------------------- reset */
console.log(' reset');
$('hldReset').click();
check($('hldInitial').value, '1000', 'reset restores the worked example');
check($('hldHalfLife').value, '10', 'reset restores the half-life');
check($('hldElapsed').value, '30', 'reset restores the elapsed time');
has($('hldHeadValue').textContent, '125', 'reset recalculates');

/* ------------------------------------------------------ accessibility */
console.log(' accessibility');
ok(d.querySelector('.skip-link'), 'skip link present');
check(d.documentElement.getAttribute('lang'), 'en', 'lang is declared');
// every control that takes input needs a name
const labelled = [...d.querySelectorAll('input:not([type=range]), select')].every((n) => {
  if (n.id && d.querySelector(`label[for="${n.id}"]`)) return true;
  return !!(n.getAttribute('aria-label') || n.closest('label'));
});
ok(labelled, 'every input and select has an associated label');
ok($('hldGraph').getAttribute('role') === 'img', 'graph is exposed as an image');
ok($('hldGraph').getAttribute('aria-describedby') === 'hldGraphDesc', 'graph points at its text description');
ok($('hldError').getAttribute('role') === 'alert', 'error region is an alert');
ok($('hldSliderVal').getAttribute('aria-live') === 'polite', 'slider readout is announced');
// the table is the non-visual alternative to the chart
ok(d.querySelector('.hld-table caption'), 'decay table has a caption');
ok([...d.querySelectorAll('#hldTableBody tr th')].every((t) => t.getAttribute('scope') === 'row'),
  'table row headers are scoped');

/* ------------------------------------------------------- FAQ vs schema */
console.log(' FAQ schema mirrors the page');
const raw = fs.readFileSync(PAGE, 'utf8');
const ld = JSON.parse(raw.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');
ok(faq, 'FAQPage schema exists');
const visible = [...d.querySelectorAll('.hld-faqs details')].map((n) => ({
  q: n.querySelector('summary').textContent.trim(),
  a: n.querySelector('p').textContent.trim()
}));
check(visible.length, faq.mainEntity.length, 'schema and page have the same number of FAQs');
ok(visible.length >= 20, 'at least 20 FAQs');
let drift = 0;
faq.mainEntity.forEach((entry, i) => {
  if (!visible[i]) { drift++; return; }
  if (entry.name.trim() !== visible[i].q) drift++;
  if (entry.acceptedAnswer.text.trim() !== visible[i].a) drift++;
});
check(drift, 0, 'every schema question and answer appears verbatim on the page');

/* other schema types */
const types = ld['@graph'].map((n) => n['@type']);
ok(types.includes('WebApplication'), 'WebApplication schema present');
ok(types.includes('HowTo'), 'HowTo schema present');
ok(types.includes('BreadcrumbList'), 'BreadcrumbList schema present');
const app = ld['@graph'].find((n) => n['@type'] === 'WebApplication');
ok(!('aggregateRating' in app) && !('review' in app), 'no invented ratings or reviews');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
