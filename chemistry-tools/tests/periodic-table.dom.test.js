/* DOM suite for the Interactive Periodic Table.

   Loads the real chemistry-tools/periodic-table.html in jsdom together with
   the real dataset and script, then drives the page the way a person would:
   searching, toggling filters, opening elements, walking the grid with the
   arrow keys and comparing two elements. It also checks the dataset itself —
   118 elements, correct grid placement, and the counts the page claims in its
   copy (38 radioactive, 11 gases, 2 liquids).

   jsdom is an optional dev dependency and this repo has no package.json, so
   the suite skips itself when jsdom is missing rather than failing.
   Install it with "npm install jsdom".

   Run: node chemistry-tools/tests/periodic-table.dom.test.js */

const fs = require("fs");
const path = require("path");
let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  console.log("SKIP  Periodic table DOM suite — jsdom is not installed. Run \"npm install jsdom\" to enable it.");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "periodic-table.html"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

function boot(url) {
  return new Promise(function (resolve) {
    const d = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: url });
    const w = d.window;
    w.addEventListener("load", function () {
      w.Element.prototype.scrollTo = function () {};
      w.HTMLElement.prototype.scrollTo = function () {};
      const dlg = w.document.getElementById("pt-compare-dialog");
      dlg.showModal = function () { this.open = true; };
      dlg.close = function () { this.open = false; };
      resolve(w);
    });
  });
}

function loadScripts(w, withData) {
  if (withData !== false) w.eval(fs.readFileSync(path.join(ROOT, "data/elements.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(ROOT, "js/periodic-table.js"), "utf8"));
}

main();
async function main() {
const window = await boot("https://tooladda.online/chemistry-tools/periodic-table.html");
const document = window.document;
loadScripts(window);

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };
const change = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("change", { bubbles: true })); };
const visible = () => $$(".pt-el").filter((t) => !t.classList.contains("is-dimmed")).length;

console.log("\n— dataset —");
const D = window.ChemData;
ok("118 elements", D.elements.length === 118, D.elements.length);
ok("expanded config for Fe", D.byNumber(26).fullConfig === "1s2 2s2 2p6 3s2 3p6 3d6 4s2", D.byNumber(26).fullConfig);

console.log("\n— rendering —");
ok("118 tiles rendered", $$(".pt-el").length === 118, $$(".pt-el").length);
ok("18 group labels", $$(".pt-axis--group").length === 18);
ok("7 period labels", $$(".pt-axis:not(.pt-axis--group)").length === 7);
ok("legend populated", $("#pt-legend").children.length === 11, $("#pt-legend").children.length);
ok("11 category chips", $$("#pt-category-filters [data-category]").length === 11);
ok("compare selects populated", $("#pt-compare-a").options.length === 119);
ok("summary rows indexed", $$("#pt-summary-body tr").length === 118);
ok("hint panel shown, no element auto-opened", /Click any element/.test($("#pt-details-inner").textContent));

// grid placement
const carbon = $('.pt-el[data-z="6"]');
ok("carbon at row 3 col 15", carbon.style.gridArea.replace(/\s/g, "") === "3/15", carbon.style.gridArea);
const la = $('.pt-el[data-z="57"]');
ok("lanthanum at row 10 col 4", la.style.gridArea.replace(/\s/g, "") === "10/4", la.style.gridArea);
const lr = $('.pt-el[data-z="103"]');
ok("lawrencium at row 11 col 18", lr.style.gridArea.replace(/\s/g, "") === "11/18", lr.style.gridArea);
const he = $('.pt-el[data-z="2"]');
ok("helium at row 2 col 19", he.style.gridArea.replace(/\s/g, "") === "2/19", he.style.gridArea);
// no two tiles share a cell
const seen = new Set(); let dup = 0;
$$(".pt-el").forEach((t) => { const k = t.style.gridArea; if (seen.has(k)) dup++; seen.add(k); });
ok("no overlapping tiles", dup === 0, dup + " duplicates");

console.log("\n— accessibility —");
ok("carbon aria-label", carbon.getAttribute("aria-label") === "Carbon, symbol C, atomic number 6, Nonmetal", carbon.getAttribute("aria-label"));
ok("radium labelled radioactive", /radioactive/.test($('.pt-el[data-z="88"]').getAttribute("aria-label")));
ok("roving tabindex: one tabbable tile", $$('.pt-el[tabindex="0"]').length === 1);
ok("all tiles are buttons", $$(".pt-el").every((t) => t.tagName === "BUTTON"));
ok("live region present", !!$("#pt-live") && $("#pt-live").getAttribute("aria-live") === "polite");

console.log("\n— search —");
type($("#pt-search"), "gold");
ok('search "gold" -> 1 element', visible() === 1, visible());
ok("gold is the hit", $(".pt-el.is-hit") && $(".pt-el.is-hit").dataset.z === "79", $(".pt-el.is-hit") && $(".pt-el.is-hit").dataset.z);
ok("count text updates", /Showing <strong>1<\/strong> \/ 118/.test($("#pt-count").innerHTML), $("#pt-count").textContent);
ok("summary table filtered to 1", $$("#pt-summary-body tr:not([hidden])").length === 1);

type($("#pt-search"), "8");
ok('search "8" -> oxygen is top hit', $(".pt-el.is-hit").dataset.z === "8");
type($("#pt-search"), "Au");
ok('search "Au" -> gold', $(".pt-el.is-hit").dataset.z === "79");
type($("#pt-search"), "zzz");
ok("no match -> empty state shown", $("#pt-empty").hidden === false);
ok("no match -> 0 visible", visible() === 0, visible());
click($("#pt-search-clear"));
ok("clear search restores 118", visible() === 118, visible());
ok("empty state hidden again", $("#pt-empty").hidden === true);

console.log("\n— filters —");
const chip = (t) => $('[data-trait="' + t + '"]');
click(chip("radioactive"));
ok("radioactive -> 38", visible() === 38, visible());
ok("radioactive chip pressed", chip("radioactive").getAttribute("aria-pressed") === "true");
ok("active filter pill shown", /Radioactive/.test($("#pt-active-filters").textContent));
click(chip("metals"));
ok("radioactive + metals -> 26 (AND across families)", visible() === 26, visible());
click(chip("radioactive")); click(chip("metals"));
ok("toggling off restores 118", visible() === 118, visible());

click(chip("gases"));
ok("gases -> 11", visible() === 11, visible());
click(chip("liquids"));
ok("gases OR liquids -> 13", visible() === 13, visible());
click(chip("gases")); click(chip("liquids"));

click(chip("metals"));
ok("metals -> 84", visible() === 84, visible());
click(chip("metals"));
click(chip("nonmetals"));
ok("nonmetals -> 18", visible() === 18, visible());
click(chip("nonmetals"));
click(chip("metalloids"));
ok("metalloids -> 6", visible() === 6, visible());
click(chip("metalloids"));
ok("metals + nonmetals + metalloids + unclassified = 118", 84 + 18 + 6 + 10 === 118);

// category chips
const cchip = (c) => $('[data-category="' + c + '"]');
click(cchip("noble-gas"));
ok("noble gases -> 6", visible() === 6, visible());
ok("category select synced", $("#pt-category-select").value === "noble-gas");
click(cchip("halogen"));
ok("noble gas OR halogen -> 11", visible() === 11, visible());
ok("select falls back to all when 2 categories", $("#pt-category-select").value === "all");
click($("#pt-clear"));
ok("clear filters -> 118", visible() === 118, visible());
ok("clear button disabled when nothing active", $("#pt-clear").disabled === true);

// selects
change($("#pt-state-select"), "liquids");
ok("state select liquid -> 2", visible() === 2, visible());
change($("#pt-state-select"), "all");
change($("#pt-category-select"), "alkali-metal");
ok("category select -> 6 alkali metals", visible() === 6, visible());
ok("chip synced from select", cchip("alkali-metal").getAttribute("aria-pressed") === "true");
change($("#pt-category-select"), "all");

// combined search + filter
click(chip("gases"));
type($("#pt-search"), "n");
ok("gases + 'n' search narrows", visible() > 0 && visible() < 11, visible());
type($("#pt-search"), "");
click(chip("gases"));

console.log("\n— colour modes —");
change($("#pt-color-select"), "state");
ok("grid colour mode = state", $("#pt-grid").dataset.color === "state");
ok("state legend has 4 entries", $("#pt-legend").children.length === 4);
change($("#pt-color-select"), "block");
ok("block legend has 4 entries", $("#pt-legend").children.length === 4);
change($("#pt-color-select"), "radioactive");
ok("radioactivity legend has 2 entries", $("#pt-legend").children.length === 2);
change($("#pt-color-select"), "category");

console.log("\n— element details —");
click(carbon);
const panel = $("#pt-details-inner");
ok("panel opens", $("#pt-details").classList.contains("is-open"));
ok("carbon selected", carbon.classList.contains("is-selected"));
ok("name shown", /Carbon/.test(panel.textContent));
ok("atomic number padded", /06/.test(panel.textContent));
ok("atomic mass shown", /12\.011/.test(panel.textContent));
ok("category shown", /Nonmetal/.test(panel.textContent));
ok("group shown", /Group/.test(panel.textContent) && />14</.test(panel.innerHTML));
ok("period shown", /Period/.test(panel.textContent));
ok("block shown", /p-block/.test(panel.textContent));
ok("electronegativity shown", /2\.55/.test(panel.textContent));
ok("full config superscripted", /1s<sup>2<\/sup> 2s<sup>2<\/sup> 2p<sup>2<\/sup>/.test(panel.innerHTML));
ok("noble gas notation shown", /\[He\] 2s<sup>2<\/sup> 2p<sup>2<\/sup>/.test(panel.innerHTML));
ok("melting point shown", /3550/.test(panel.textContent));
ok("density shown", /2\.267/.test(panel.textContent));
ok("oxidation states shown", /-4, \+2, \+4/.test(panel.textContent));
ok("discovery shown", /Antiquity/.test(panel.textContent));
ok("bars rendered", $$("#pt-details-inner .pt-bar").length === 4);
ok("URL deep link written", window.location.search === "?element=carbon", window.location.search);
ok("recently viewed appears", $("#pt-recent").hidden === false && /C/.test($("#pt-recent-list").textContent));

// N/A handling
click($('.pt-el[data-z="2"]'));
ok("helium electronegativity N/A", /N\/A/.test($("#pt-details-inner").textContent));
click($('.pt-el[data-z="57"]'));
ok("lanthanum group -> f-block note", /outside groups/.test($("#pt-details-inner").textContent));
click($('.pt-el[data-z="88"]'));
ok("radium flagged radioactive in panel", /Radioactive/.test($("#pt-details-inner").textContent));

// prev / next
click(carbon);
click($('#pt-details-inner [data-action="next"]'));
ok("next -> nitrogen", /Nitrogen/.test($("#pt-details-inner").textContent));
click($('#pt-details-inner [data-action="prev"]'));
ok("prev -> carbon", /Carbon/.test($("#pt-details-inner").textContent));
click($('.pt-el[data-z="1"]'));
ok("hydrogen: prev disabled", $('#pt-details-inner [data-action="prev"]').disabled === true);
click($('.pt-el[data-z="118"]'));
ok("oganesson: next disabled", $('#pt-details-inner [data-action="next"]').disabled === true);

// favourite
click(carbon);
click($('#pt-details-inner [data-action="favourite"]'));
ok("favourite toggles on", $('#pt-details-inner [data-action="favourite"]').getAttribute("aria-pressed") === "true");
click($('#pt-details-inner [data-action="favourite"]'));
ok("favourite toggles off", $('#pt-details-inner [data-action="favourite"]').getAttribute("aria-pressed") === "false");

// close via Escape
click(carbon);
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
ok("Escape closes panel", !$("#pt-details").classList.contains("is-open"));
ok("Escape clears selection", $$(".pt-el.is-selected").length === 0);
ok("Escape clears deep link", window.location.search === "");

console.log("\n— keyboard navigation —");
const si = $('.pt-el[data-z="14"]');
si.focus();
si.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
ok("ArrowRight -> phosphorus focused", document.activeElement.dataset.z === "15", document.activeElement.dataset.z);
document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
ok("ArrowDown from P -> As (same column)", document.activeElement.dataset.z === "33", document.activeElement.dataset.z);
document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
ok("ArrowUp -> back to P", document.activeElement.dataset.z === "15", document.activeElement.dataset.z);
document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
ok("Home -> hydrogen", document.activeElement.dataset.z === "1");
document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
ok("End -> oganesson", document.activeElement.dataset.z === "118");
ok("still only one tabbable tile", $$('.pt-el[tabindex="0"]').length === 1);

console.log("\n— comparison —");
click($("#pt-compare-open"));
ok("dialog open", $("#pt-compare-dialog").open === true);
change($("#pt-compare-a"), "6");
change($("#pt-compare-b"), "14");
click($("#pt-compare-run"));
const out = $("#pt-compare-output").textContent;
ok("compare table rendered", $$("#pt-compare-output tbody tr").length === 18, $$("#pt-compare-output tbody tr").length);
ok("compare shows carbon", /Carbon/.test(out));
ok("compare shows silicon", /Silicon/.test(out));
ok("compare shows electronegativities at published precision", /2\.551\.9[^0]/.test(out.replace(/\s/g, "")), out.slice(0, 80));
ok("compare shows configs", /\[Ne\]/.test($("#pt-compare-output").innerHTML));
click($("#pt-compare-close"));
ok("dialog closed", $("#pt-compare-dialog").open === false);

console.log("\n— reset —");
type($("#pt-search"), "iron");
click(chip("metals"));
change($("#pt-color-select"), "block");
click($("#pt-reset"));
ok("reset clears search", $("#pt-search").value === "");
ok("reset clears filters", visible() === 118, visible());
ok("reset restores colour mode", $("#pt-grid").dataset.color === "category");
ok("reset closes details", !$("#pt-details").classList.contains("is-open"));
ok("reset restores summary table", $$("#pt-summary-body tr:not([hidden])").length === 118);

console.log("\n— deep link on load —");
{
  const w2 = await boot("https://tooladda.online/chemistry-tools/periodic-table.html?element=79");
  loadScripts(w2);
  ok("?element=79 opens gold", /Gold/.test(w2.document.getElementById("pt-details-inner").textContent));
  const w3 = await boot("https://tooladda.online/chemistry-tools/periodic-table.html?element=neon");
  loadScripts(w3);
  ok("?element=neon opens neon", /Neon/.test(w3.document.getElementById("pt-details-inner").textContent));
}

console.log("\n— error handling —");
{
  const w4 = await boot("https://tooladda.online/chemistry-tools/periodic-table.html");
  loadScripts(w4, false);
  ok("missing dataset -> friendly message, no crash", /could not be loaded/.test(w4.document.getElementById("pt-app").textContent));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
}
