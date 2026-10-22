/* DOM tests for the Chemical Equation Balancer page.
   Run: node chemistry-tools/tests/chemical-equation-balancer.dom.test.js
   Skips cleanly when jsdom is not installed. */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('chemical-equation-balancer.dom — SKIPPED (jsdom not installed)');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'chemistry-tools', 'chemical-equation-balancer.html');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + l); } };
const check = (a, e, l) => {
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL  ${l}\n        expected ${e}\n        actual   ${a}`); }
};
const has = (a, sub, l) => {
  if (String(a).indexOf(sub) !== -1) pass++;
  else { fail++; console.log(`  FAIL  ${l}\n        "${String(a).slice(0, 120)}" lacks "${sub}"`); }
};

const html = fs.readFileSync(PAGE, 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://tooladda.online/chemistry-tools/chemical-equation-balancer.html' });
const w = dom.window;
w.eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'equation-balancer-engine.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'chemistry-tools', 'js', 'chemical-equation-balancer.js'), 'utf8'));

const d = w.document;
const $ = (id) => d.getElementById(id);
const fire = (n, t) => n.dispatchEvent(new w.Event(t, { bubbles: true }));

/* type an equation and balance it synchronously via the button */
function balance(eq) {
  $('cebInput').value = eq;
  $('cebBalance').click();
}

console.log('chemical-equation-balancer.dom');

/* ------------------------------------------------------------- structure */
console.log(' structure');
check(d.querySelectorAll('h1').length, 1, 'exactly one h1');
ok($('cebInput'), 'equation input exists');
ok($('cebBalance'), 'balance button exists');
ok($('cebEquation'), 'result element exists');
ok(d.querySelectorAll('[data-ceb-example]').length >= 8, 'at least eight example buttons');
ok(d.querySelector('.ceb-note'), 'educational disclaimer present');
const srcs = [...d.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
ok(srcs.indexOf('../assets/js/equation-balancer-engine.js') < srcs.indexOf('js/chemical-equation-balancer.js'),
  'engine loads before the UI');
ok(srcs.every((s) => !/^https?:/.test(s)), 'no third-party scripts');

/* ------------------------------------------------------- default balance */
console.log(' default equation');
balance('H2 + O2 = H2O');
check($('cebEquation').textContent, '2H₂ + O₂ → 2H₂O', 'renders the balanced equation with subscripts');
ok(!$('cebStatus').hidden, 'status is shown');
has($('cebStatus').textContent, 'balanced', 'status says balanced');
has($('cebStatus').textContent, '✓', 'status carries a non-colour success mark');
ok(!/is-empty/.test($('cebEquation').className), 'placeholder styling removed');

/* -------------------------------------------------------- atom tables */
console.log(' atom verification tables');
const rowsOf = (id) => [...d.querySelectorAll('#' + id + ' tr')].map((tr) =>
  [...tr.querySelectorAll('th,td')].map((c) => c.textContent));
const before = rowsOf('cebBeforeBody');
const after = rowsOf('cebAfterBody');
check(before.length, 2, 'before table lists both elements');
check(after.length, 2, 'after table lists both elements');
// H2 + O2 -> H2O as typed: H 2 vs 2, O 2 vs 1
const bH = before.find((r) => r[0] === 'H');
const bO = before.find((r) => r[0] === 'O');
check(bH[1], '2', 'before H reactants');
check(bH[2], '2', 'before H products');
check(bO[1], '2', 'before O reactants');
check(bO[2], '1', 'before O products');
has(bO[3], 'differ', 'before O is marked as differing');
const aH = after.find((r) => r[0] === 'H');
const aO = after.find((r) => r[0] === 'O');
check(aH[1], '4', 'after H reactants');
check(aH[2], '4', 'after H products');
check(aO[1], '2', 'after O reactants');
check(aO[2], '2', 'after O products');
has(aH[3], 'same', 'after rows are marked equal in words');
ok([...d.querySelectorAll('#cebAfterBody tr')].every((tr) => tr.className === 'is-good'),
  'every after-row is marked good');

/* -------------------------------------------------------------- steps */
console.log(' step-by-step working');
const steps = [...d.querySelectorAll('#cebSteps li')];
ok(steps.length >= 5, 'at least five steps');
const stepText = steps.map((s) => s.textContent).join(' | ');
has(stepText, '2 : 1 : 2', 'steps quote the solved ratio');
ok(!/undefined|NaN/.test(stepText), 'no placeholder text in the steps');

console.log(' mathematical solution');
ok($('cebMath').hidden, 'maths panel starts collapsed');
check($('cebMathToggle').getAttribute('aria-expanded'), 'false', 'toggle reports collapsed');
$('cebMathToggle').click();
ok(!$('cebMath').hidden, 'maths panel opens');
check($('cebMathToggle').getAttribute('aria-expanded'), 'true', 'toggle reports expanded');
const mathText = $('cebMath').textContent;
has(mathText, 'aH₂ + bO₂ → cH₂O', 'shows the lettered setup');
has(mathText, '2a = 2c', 'shows the hydrogen equation');
has(mathText, '2b = c', 'shows the oxygen equation');
has(mathText, 'a = 2', 'shows the solved values');
$('cebMathToggle').click();
ok($('cebMath').hidden, 'maths panel closes again');

/* ------------------------------------------------------- more equations */
console.log(' further equations through the UI');
balance('C3H8 + O2 = CO2 + H2O');
check($('cebEquation').textContent, 'C₃H₈ + 5O₂ → 3CO₂ + 4H₂O', 'propane combustion');
balance('Fe + O2 = Fe2O3');
check($('cebEquation').textContent, '4Fe + 3O₂ → 2Fe₂O₃', 'iron oxide');
balance('Al2(SO4)3 + Ca(OH)2 = Al(OH)3 + CaSO4');
check($('cebEquation').textContent, 'Al₂(SO₄)₃ + 3Ca(OH)₂ → 2Al(OH)₃ + 3CaSO₄', 'polyatomic groups render and balance');
balance('HCl + NaOH = NaCl + H2O');
check($('cebEquation').textContent, 'HCl + NaOH → NaCl + H₂O', 'no coefficient 1 is printed');

console.log(' states are preserved');
balance('H2(g) + O2(g) = H2O(l)');
check($('cebEquation').textContent, '2H₂(g) + O₂(g) → 2H₂O(l)', 'state labels survive balancing');

console.log(' ionic equations');
balance('Zn + Ag+ = Zn2+ + Ag');
check($('cebEquation').textContent, 'Zn + 2Ag⁺ → Zn²⁺ + 2Ag', 'charges render as superscripts');
ok(!$('cebChargeRow').hidden, 'charge row is shown for an ionic equation');
has($('cebChargeRow').textContent, 'Charge', 'charge row is labelled');
has($('cebStatus').textContent, 'charge balanced', 'status mentions charge');
balance('H2 + O2 = H2O');
ok($('cebChargeRow').hidden, 'charge row hides again for a neutral equation');

/* ----------------------------------------------------- reaction types */
console.log(' reaction type');
balance('CH4 + O2 = CO2 + H2O');
has($('cebMeta').textContent, 'Combustion', 'combustion is reported');
balance('KClO3 = KCl + O2');
has($('cebMeta').textContent, 'Decomposition', 'decomposition is reported');
balance('Fe2O3 + CO = Fe + CO2');
has($('cebMeta').textContent, 'Could not be determined', 'an unclassifiable reaction says so');

/* ------------------------------------------------------- error handling */
console.log(' errors never produce a guessed answer');
const expectRefusal = (eq, label) => {
  balance(eq);
  ok(!$('cebStatus').hidden && /is-error/.test($('cebStatus').className), label + ' — error shown');
  ok(/is-empty/.test($('cebEquation').className), label + ' — no equation printed');
  ok(!/→/.test($('cebEquation').textContent), label + ' — no arrow output leaked');
  ok($('cebInput').getAttribute('aria-invalid') === 'true', label + ' — input flagged invalid');
};
expectRefusal('H2 + O2', 'missing arrow');
expectRefusal('Xy2 + O2 = XyO', 'unknown element');
expectRefusal('H2 -> O2', 'element on one side only');
expectRefusal('C + O2 = CO + CO2', 'multiple independent solutions');
expectRefusal('NH4+ + Cl- = NH4Cl', 'ambiguous bare charge');
expectRefusal('Ca(OH2 + HCl = CaCl2 + H2O', 'unclosed bracket');
// the message must be prose, never a raw JS error
balance('Xy2 + O2 = XyO');
ok(!/undefined|\[object|TypeError|NaN/.test($('cebStatus').textContent), 'error text is user-facing prose');
has($('cebStatus').textContent, '✕', 'error carries a non-colour mark');

console.log(' recovery after an error');
balance('H2 + O2 = H2O');
check($('cebInput').getAttribute('aria-invalid'), 'false', 'invalid flag clears');
check($('cebEquation').textContent, '2H₂ + O₂ → 2H₂O', 'a good equation works again after a bad one');

/* --------------------------------------------------------------- input */
console.log(' input handling');
$('cebInput').value = 'Na + Cl2 = NaCl';
$('cebInput').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check($('cebEquation').textContent, '2Na + Cl₂ → 2NaCl', 'Enter balances the equation');
const exampleBtn = d.querySelector('[data-ceb-example="KClO3 = KCl + O2"]');
ok(exampleBtn, 'example button exists');
exampleBtn.click();
check($('cebInput').value, 'KClO3 = KCl + O2', 'example loads into the input');
check($('cebEquation').textContent, '2KClO₃ → 2KCl + 3O₂', 'example balances on click');
$('cebReset').click();
check($('cebInput').value, '', 'reset clears the input');
ok(/is-empty/.test($('cebEquation').className), 'reset clears the result');
ok($('cebStatus').hidden, 'reset clears the status');

/* -------------------------------------------------------------- history */
console.log(' local history');
balance('H2 + O2 = H2O');
balance('CH4 + O2 = CO2 + H2O');
const items = [...d.querySelectorAll('#cebHistory .ceb-recall')].map((b) => b.textContent);
ok(items.length >= 2, 'history records equations');
check(items[0], 'CH4 + O2 = CO2 + H2O', 'newest equation is first');
ok(!$('cebHistoryWrap').hidden, 'history panel is shown once there is history');
// recall
d.querySelector('#cebHistory .ceb-recall').click();
check($('cebInput').value, 'CH4 + O2 = CO2 + H2O', 'clicking a history entry reloads it');
// delete one
const beforeCount = d.querySelectorAll('#cebHistory li').length;
d.querySelector('#cebHistory .ceb-del').click();
check(d.querySelectorAll('#cebHistory li').length, beforeCount - 1, 'a single entry can be removed');
$('cebClearHistory').click();
check(d.querySelectorAll('#cebHistory li').length, 0, 'history can be cleared');
ok($('cebHistoryWrap').hidden, 'history panel hides when empty');
// history lives only in localStorage
ok(w.localStorage.getItem('tooladda-ceb-history') !== null, 'history is stored locally');

/* ---------------------------------------------------------------- copy */
console.log(' copy formats');
let copied = '';
w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
balance('H2 + O2 = H2O');
$('cebCopyUnicode').click();
check(copied, '2H₂ + O₂ → 2H₂O', 'copy Unicode');
$('cebCopyPlain').click();
check(copied, '2H2 + O2 -> 2H2O', 'copy plain text');
$('cebCopyLatex').click();
check(copied, '\\mathrm{2H_{2} + O_{2} \\rightarrow 2H_{2}O}', 'copy LaTeX');
$('cebCopyHtml').click();
check(copied, '2H<sub>2</sub> + O<sub>2</sub> &rarr; 2H<sub>2</sub>O', 'copy HTML');

/* --------------------------------------------------------------- XSS */
console.log(' untrusted input cannot inject markup');
balance('<img src=x onerror=alert(1)> + O2 = H2O');
check(d.querySelectorAll('#cebEquation img, #cebStatus img').length, 0, 'no element injected from the input');
ok(/is-error/.test($('cebStatus').className), 'markup input is rejected as invalid chemistry');
ok($('cebStatus').textContent.indexOf('<img') === -1 || $('cebStatus').querySelectorAll('*').length === 0,
  'any echoed text stays inert');

/* ------------------------------------------------------ accessibility */
console.log(' accessibility');
ok(d.querySelector('.skip-link'), 'skip link present');
check(d.documentElement.getAttribute('lang'), 'en', 'lang declared');
ok(d.querySelector('label[for="cebInput"]'), 'the equation input has a label');
check($('cebStatus').getAttribute('role'), 'status', 'status region is announced');
check($('cebStatus').getAttribute('aria-live'), 'polite', 'status is polite live');
check($('cebInput').getAttribute('aria-describedby'), 'cebInputHint', 'input points at its hint');
ok(d.querySelectorAll('.ceb-table caption').length >= 2, 'both atom tables have captions');
ok([...d.querySelectorAll('#cebAfterBody tr th')].every((t) => t.getAttribute('scope') === 'row'),
  'atom table row headers are scoped');
check($('cebMathToggle').getAttribute('aria-controls'), 'cebMath', 'toggle names the panel it controls');
// success and failure are distinguishable without colour
balance('H2 + O2 = H2O');
const okText = $('cebStatus').textContent;
balance('H2 -> O2');
ok(okText !== $('cebStatus').textContent && /✕/.test($('cebStatus').textContent),
  'error and success differ in text, not only colour');

/* --------------------------------------------------- schema vs page */
console.log(' FAQ schema mirrors the page');
const ld = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');
const visible = [...d.querySelectorAll('.ceb-faqs details')].map((n) => ({
  q: n.querySelector('summary').textContent.trim(),
  a: n.querySelector('p').textContent.trim()
}));
check(visible.length, faq.mainEntity.length, 'same number of FAQs in schema and page');
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
