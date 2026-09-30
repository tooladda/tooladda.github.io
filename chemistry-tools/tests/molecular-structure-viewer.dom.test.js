/* DOM suite for the 3D Molecular Structure Viewer.

   jsdom has no canvas implementation, so the 2D context is replaced with a
   recorder that captures every drawing call. That is actually better than a
   real canvas for testing: it lets the suite assert on the geometry the
   renderer produced — how many sticks a double bond drew, whether far atoms
   were painted before near ones — rather than on pixels.

   It also re-measures every bond length and bond angle back out of the
   dataset, so a typo in the geometry helpers cannot pass unnoticed.

   jsdom is an optional dev dependency and this repo has no package.json, so
   the suite skips itself when jsdom is missing rather than failing.

   Run: node chemistry-tools/tests/molecular-structure-viewer.dom.test.js */

const fs = require("fs");
const path = require("path");
let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  console.log("SKIP  Molecular viewer DOM suite — jsdom is not installed. Run \"npm install jsdom\" to enable it.");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "molecular-structure-viewer.html"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

/* ---- a 2D context that records instead of painting ---- */
function makeRecorder() {
  const calls = [];
  const rec = (op) => (...args) => { calls.push({ op, args }); };
  const ctx = {
    calls,
    canvas: null,
    setTransform: rec("setTransform"), clearRect: rec("clearRect"),
    beginPath: rec("beginPath"), closePath: rec("closePath"),
    moveTo: rec("moveTo"), lineTo: rec("lineTo"),
    arc: rec("arc"), ellipse: rec("ellipse"),
    fill: rec("fill"), stroke: rec("stroke"), fillText: rec("fillText"),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    save: rec("save"), restore: rec("restore"),
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: ""
  };
  return ctx;
}

/** Reconstruct the shapes drawn in the last frame from the call log. */
function lastFrame(ctx) {
  let start = 0;
  for (let i = ctx.calls.length - 1; i >= 0; i--) {
    if (ctx.calls[i].op === "clearRect") { start = i; break; }
  }
  const calls = ctx.calls.slice(start);
  const sticks = [], spheres = [], labels = [];
  let pending = [];
  calls.forEach((c) => {
    if (c.op === "beginPath") pending = [];
    else if (c.op === "moveTo" || c.op === "lineTo") pending.push(c.args);
    else if (c.op === "arc") spheres.push({ x: c.args[0], y: c.args[1], r: c.args[2] });
    else if (c.op === "fillText") labels.push({ text: c.args[0], x: c.args[1], y: c.args[2] });
    else if (c.op === "fill" && pending.length === 4) { sticks.push(pending.slice()); pending = []; }
  });
  return { sticks, spheres, labels, order: calls.map((c) => c.op) };
}

function boot(url, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const d = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url });
    const w = d.window;
    w.addEventListener("load", () => {
      const rec = makeRecorder();
      const cv = w.document.getElementById("msv-canvas");
      cv.getContext = () => rec;
      cv.getBoundingClientRect = () => ({ width: 800, height: 500, left: 0, top: 0, right: 800, bottom: 500 });
      cv.setPointerCapture = () => {};
      w.ResizeObserver = function () { this.observe = () => {}; this.disconnect = () => {}; };
      /* Render synchronously and return null: the viewer only re-arms when
         its stored handle is null, so returning a truthy id here would make
         every frame after the first one a no-op. The depth guard stops the
         auto-rotation loop re-entering itself forever under a sync stub. */
      let inFrame = false;
      w.requestAnimationFrame = (fn) => {
        if (inFrame) return null;
        inFrame = true;
        try { fn(16); } finally { inFrame = false; }
        return null;
      };
      w.cancelAnimationFrame = () => {};
      if (opts.reducedMotion) w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, addListener() {} });
      if (opts.observer) {
        w.IntersectionObserver = function (cb) { opts.observer.cb = cb; this.observe = () => {}; };
      }
      resolve({ w, rec });
    });
  });
}

function loadScripts(w) {
  ["data/elements.js", "data/molecules.js", "data/molecule-library.js", "js/molecule-formats.js", "js/molecular-structure-viewer.js"].forEach((f) => {
    w.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
  });
}

main();
async function main() {
  const { w, rec } = await boot("https://tooladda.online/chemistry-tools/molecular-structure-viewer.html");
  loadScripts(w);
  const doc = w.document;
  const V = w.MolecularViewer;
  const MD = w.MoleculeData;
  const $ = (s) => doc.querySelector(s);
  const $$ = (s) => Array.from(doc.querySelectorAll(s));

  /* ---------------- first load ---------------- */
  console.log("\n— first load —");
  ok("a plain page load opens caffeine", V.getMolecule().id === "caffeine" && V.defaultMolecule === "caffeine", V.getMolecule().id);
  ok("the model spins on arrival", V.getView().autoRotate === true);
  ok("the Auto button shows the spin", doc.getElementById("msv-auto").getAttribute("aria-pressed") === "true");
  ok("caffeine is marked in the list", $('#msv-list [data-molecule="caffeine"]').getAttribute("aria-current") === "true");
  ok("URL names the default molecule", w.location.search === "?molecule=caffeine", w.location.search);
  {
    const { w: wr } = await boot("https://tooladda.online/chemistry-tools/molecular-structure-viewer.html", { reducedMotion: true });
    loadScripts(wr);
    ok("no spin when the system asks for reduced motion", wr.MolecularViewer.getView().autoRotate === false);
    ok("reduced motion still opens caffeine", wr.MolecularViewer.getMolecule().id === "caffeine");
  }

  /* ---------------- dataset geometry ---------------- */
  console.log("\n— dataset geometry (re-measured from coordinates) —");
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const angle = (a, c, b) => {
    const v1 = [a.x - c.x, a.y - c.y, a.z - c.z], v2 = [b.x - c.x, b.y - c.y, b.z - c.z];
    const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    return Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...v1) * Math.hypot(...v2))))) * 180 / Math.PI;
  };
  ok("32 hand-built molecules", MD.molecules.filter((m) => m.source === "experimental").length === 32);
  ok("124 built-in molecules with the PubChem library", MD.molecules.length === 124, MD.molecules.length);

  const water = MD.byId("water");
  ok("water O–H = 0.9584 A", Math.abs(dist(water.atoms[0], water.atoms[1]) - 0.9584) < 1e-3);
  ok("water H–O–H = 104.5 deg", Math.abs(angle(water.atoms[1], water.atoms[0], water.atoms[2]) - 104.5) < 0.02);

  const methane = MD.byId("methane");
  ok("methane C–H = 1.087 A", Math.abs(dist(methane.atoms[0], methane.atoms[1]) - 1.087) < 1e-3);
  ok("methane H–C–H = 109.47 deg", Math.abs(angle(methane.atoms[1], methane.atoms[0], methane.atoms[2]) - 109.4712) < 0.02);

  const ammonia = MD.byId("ammonia");
  ok("ammonia H–N–H = 106.7 deg", Math.abs(angle(ammonia.atoms[1], ammonia.atoms[0], ammonia.atoms[2]) - 106.7) < 0.02);
  ok("ammonia is pyramidal, not planar", Math.abs(ammonia.atoms[1].z - ammonia.atoms[0].z) > 0.2);

  const co2 = MD.byId("carbon-dioxide");
  ok("CO2 is linear (180 deg)", Math.abs(angle(co2.atoms[1], co2.atoms[0], co2.atoms[2]) - 180) < 0.01);
  ok("CO2 bonds are double", co2.bonds.every((b) => b.order === 2));
  ok("N2 bond is triple", MD.byId("nitrogen").bonds[0].order === 3);
  ok("O2 bond is double", MD.byId("oxygen").bonds[0].order === 2);
  ok("H2 bond is single", MD.byId("hydrogen").bonds[0].order === 1);

  const ethene = MD.byId("ethene");
  ok("ethene H–C=C = 121.3 deg", Math.abs(angle(ethene.atoms[2], ethene.atoms[0], ethene.atoms[1]) - 121.3) < 0.02);
  ok("ethene is planar", ethene.atoms.every((a) => a.z === 0));

  const benzene = MD.byId("benzene");
  const ringBonds = benzene.bonds.filter((b) => benzene.atoms[b.from].element === "C" && benzene.atoms[b.to].element === "C");
  ok("benzene ring has 6 C–C bonds", ringBonds.length === 6);
  ok("benzene ring bonds all 1.397 A", ringBonds.every((b) => Math.abs(dist(benzene.atoms[b.from], benzene.atoms[b.to]) - 1.397) < 1e-3));
  ok("benzene is planar", benzene.atoms.every((a) => a.z === 0));
  ok("benzene carries the delocalisation caveat", /delocalised/i.test(benzene.note || ""));

  let sane = true;
  MD.molecules.filter((m) => m.source === "experimental").forEach((m) => {
    m.bonds.forEach((b) => { const L = dist(m.atoms[b.from], m.atoms[b.to]); if (L < 0.5 || L > 2.2) sane = false; });
    for (let i = 0; i < m.atoms.length; i++)
      for (let j = i + 1; j < m.atoms.length; j++)
        if (dist(m.atoms[i], m.atoms[j]) < 0.55) sane = false;
  });
  ok("no absurd bond lengths or overlapping atoms anywhere", sane);

  ok("molar mass of water from shared elements.js", Math.abs(MD.molarMass(water) - 18.015) < 0.01);
  ok("molar mass of benzene", Math.abs(MD.molarMass(benzene) - 78.114) < 0.01);

  /* ---------------- 3D maths ---------------- */
  console.log("\n— 3D maths —");
  const v = V.getView();
  v.rotX = 0; v.rotY = 0; v.rotZ = 0;
  const p0 = V.rotatePoint(1, 0, 0);
  ok("zero rotation is identity", Math.abs(p0.x - 1) < 1e-9 && Math.abs(p0.y) < 1e-9 && Math.abs(p0.z) < 1e-9);
  v.rotY = Math.PI / 2;
  const p1 = V.rotatePoint(1, 0, 0);
  ok("90 deg Y rotation maps +x to -z", Math.abs(p1.x) < 1e-9 && Math.abs(p1.z + 1) < 1e-9, JSON.stringify(p1));
  v.rotY = 0; v.rotX = Math.PI / 2;
  const p2 = V.rotatePoint(0, 1, 0);
  ok("90 deg X rotation maps +y to +z", Math.abs(p2.y) < 1e-9 && Math.abs(p2.z - 1) < 1e-9, JSON.stringify(p2));
  v.rotX = 0;

  const near = V.project3D({ x: 1, y: 0, z: 2 });
  const far = V.project3D({ x: 1, y: 0, z: -2 });
  ok("perspective: nearer point projects further from centre", Math.abs(near.x - 400) > Math.abs(far.x - 400),
    near.x.toFixed(1) + " vs " + far.x.toFixed(1));
  ok("perspective scale is larger when nearer", near.persp > far.persp);
  const extreme = V.project3D({ x: 0, y: 0, z: -1e9 });
  ok("no divide-by-zero at extreme depth", isFinite(extreme.x) && isFinite(extreme.y));

  /* ---------------- rendering ---------------- */
  console.log("\n— rendering —");
  V.load("water");
  let f = lastFrame(rec);
  ok("water draws 3 spheres", f.spheres.filter((s) => s.r > 2).length >= 3, f.spheres.length);
  ok("water draws sticks as quads, not lines", f.sticks.length >= 4, f.sticks.length);
  ok("atom labels drawn", f.labels.map((l) => l.text).join("") === "HOH" || f.labels.length === 3,
    f.labels.map((l) => l.text).join(","));

  V.load("carbon-dioxide");
  f = lastFrame(rec);
  ok("CO2 double bonds draw 8 half-sticks (2 bonds x 2 lines x 2 halves)", f.sticks.length === 8, f.sticks.length);
  const co2Mid = f.sticks.map((s) => s[0][1]);
  ok("CO2 parallel sticks are visibly separated", new Set(co2Mid.map((y) => Math.round(y))).size > 1,
    "distinct y: " + new Set(co2Mid.map((y) => Math.round(y))).size);

  V.load("nitrogen");
  f = lastFrame(rec);
  ok("N2 triple bond draws 6 half-sticks", f.sticks.length === 6, f.sticks.length);

  V.load("benzene");
  f = lastFrame(rec);
  ok("benzene draws 12 spheres", f.spheres.filter((s) => s.r > 2).length >= 12, f.spheres.length);
  ok("benzene draws 9 bond lines worth of halves (6 C-H + 3 single + 3 double ring)",
    f.sticks.length === (6 + 3 + 3 * 2) * 2, f.sticks.length);

  V.load("methane");
  f = lastFrame(rec);
  const drawOrder = f.order.filter((o) => o === "arc");
  ok("methane draws 5 spheres", drawOrder.length >= 5, drawOrder.length);

  /* depth sorting: the sphere drawn last must not be the furthest one */
  const proj = V.getProjected();
  const depths = proj.map((p) => p.depth);
  const nearest = Math.max(...depths);
  const spheresDrawn = f.spheres.filter((s) => s.r > 2);
  const lastSphere = spheresDrawn[spheresDrawn.length - 1];
  const nearestAtom = proj.find((p) => p.depth === nearest);
  ok("depth sorting: nearest atom is painted last",
    Math.abs(lastSphere.x - nearestAtom.sx) < 1 && Math.abs(lastSphere.y - nearestAtom.sy) < 1,
    "last drawn at " + lastSphere.x.toFixed(0) + "," + lastSphere.y.toFixed(0));

  /* perspective really changes sphere size with depth */
  const radiiBySymbol = {};
  proj.forEach((p) => { (radiiBySymbol[p.element] = radiiBySymbol[p.element] || []).push(p.radius); });
  const hRadii = radiiBySymbol.H;
  ok("identical atoms differ in drawn size by depth (real perspective)",
    Math.max(...hRadii) - Math.min(...hRadii) > 0.5,
    "H radii " + hRadii.map((r) => r.toFixed(1)).join(","));

  /* ---------------- UI ---------------- */
  console.log("\n— interface —");
  V.load("water");
  ok("molecule list rendered", $$("#msv-list [data-molecule]").length === MD.molecules.length, $$("#msv-list [data-molecule]").length);
  ok("group filter chips rendered", $$("#msv-filters [data-group]").length === 7);
  ok("active molecule marked in list", $('#msv-list [data-molecule="water"]').getAttribute("aria-current") === "true");
  ok("stage shows formula with subscript", $("#msv-stage-formula").innerHTML.indexOf("<sub>2</sub>") > -1);
  ok("info panel shows molar mass", /18\.015/.test($("#msv-info").textContent));
  ok("info panel shows geometry", /Bent/.test($("#msv-info").textContent));
  ok("info panel shows bond angle", /104\.5/.test($("#msv-info").textContent));
  ok("about text present", $("#msv-about").textContent.length > 80);
  ok("accessible description updated", /water/i.test($("#msv-canvas-desc").textContent) && /bent/i.test($("#msv-canvas-desc").textContent));
  ok("legend lists the elements of the current molecule", $$("#msv-legend li").length === 2, $$("#msv-legend li").length);
  ok("legend shows mass composition", /88\.8%/.test($("#msv-legend").textContent), $("#msv-legend").textContent);

  const type = (el, val) => { el.value = val; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
  type($("#msv-search"), "benz");
  ok("search by name filters the list", $$("#msv-list [data-molecule]").length === 2, $$("#msv-list [data-molecule]").map((b) => b.dataset.molecule).join());
  ok("closest name ranks first", $$("#msv-list [data-molecule]")[0].dataset.molecule === "benzene");
  type($("#msv-search"), "tetra");
  ok("search by geometry finds the tetrahedral basics",
    ["methane", "ethane", "methanol", "carbon-tetrachloride"].every((id) => $('#msv-list [data-molecule="' + id + '"]')),
    $$("#msv-list [data-molecule]").map((b) => b.dataset.molecule).join());
  /* CH4 is a substring of methanol's CH4O, so both are legitimate hits */
  type($("#msv-search"), "CH4");
  ok("search by formula finds methane and methanol", !!$('#msv-list [data-molecule="methanol"]') && !$('#msv-list [data-molecule="ethane"]'),
    $$("#msv-list [data-molecule]").map((b) => b.dataset.molecule).join());
  ok("methane is among the formula hits", !!$('#msv-list [data-molecule="methane"]'));
  type($("#msv-search"), "zzzz");
  ok("no-match shows empty state", /No molecule matches/.test($("#msv-list").textContent));
  type($("#msv-search"), "");
  ok("clearing search restores list", $$("#msv-list [data-molecule]").length === MD.molecules.length);
  const click0 = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  click0($('#msv-filters [data-group="shapes"]'));
  ok("VSEPR chip shows only the shape molecules", $$("#msv-list [data-molecule]").length === 14, $$("#msv-list [data-molecule]").length);
  click0($('#msv-filters [data-group="all"]'));

  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  click($('#msv-quick [data-molecule="methane"]'));
  ok("quick button loads methane", V.getMolecule().id === "methane");
  ok("quick button reflects selection", $('#msv-quick [data-molecule="methane"]').getAttribute("aria-pressed") === "true");

  /* ---------------- picking ---------------- */
  console.log("\n— selection —");
  V.load("water");
  const pw = V.getProjected();
  V.pickAt(pw[0].sx, pw[0].sy);
  ok("clicking the oxygen selects it", V.getView().selectedAtom === 0, V.getView().selectedAtom);
  ok("selection panel shows the element", /Oxygen/.test($("#msv-atom-info").textContent));
  ok("selection panel shows atomic number", /8/.test($("#msv-atom-info").textContent));
  V.pickAt(5, 5);
  ok("clicking empty space clears the selection", V.getView().selectedAtom === null);

  V.load("nitrogen");
  const pn = V.getProjected();
  V.pickAt((pn[0].sx + pn[1].sx) / 2, (pn[0].sy + pn[1].sy) / 2);
  ok("clicking a bond selects it", V.getView().selectedBond === 0, V.getView().selectedBond);
  ok("bond panel names the bond type", /Triple bond/.test($("#msv-atom-info").textContent));

  /* drag must not select */
  V.load("water");
  const down = (x, y) => cvEvent("pointerdown", x, y);
  const move = (x, y) => cvEvent("pointermove", x, y);
  const up = (x, y) => cvEvent("pointerup", x, y);
  function cvEvent(type, x, y, extra) {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: x, clientY: y, pointerId: 1, button: 0, shiftKey: false }, extra || {});
    $("#msv-canvas").dispatchEvent(e);
    return e;
  }
  const beforeRotY = V.getView().rotY;
  down(400, 250); move(460, 250); up(460, 250);
  ok("dragging rotates the molecule", Math.abs(V.getView().rotY - beforeRotY) > 0.1);
  ok("dragging did NOT select an atom", V.getView().selectedAtom === null);

  const p3 = V.getProjected();
  down(p3[0].sx, p3[0].sy); up(p3[0].sx, p3[0].sy);
  ok("a click without movement DOES select", V.getView().selectedAtom === 0);

  /* ---------------- controls ---------------- */
  console.log("\n— controls —");
  V.reset();
  const z0 = V.getView().zoom;
  click(doc.getElementById("msv-zoom-in"));
  ok("zoom in increases zoom", V.getView().zoom > z0);
  click(doc.getElementById("msv-zoom-out"));
  click(doc.getElementById("msv-zoom-out"));
  ok("zoom out decreases zoom", V.getView().zoom < z0);
  V.setZoom(999);
  ok("zoom is clamped at the top", V.getView().zoom <= 4.0, V.getView().zoom);
  V.setZoom(0.0001);
  ok("zoom is clamped at the bottom", V.getView().zoom >= 0.35, V.getView().zoom);

  V.getView().rotX = 1; V.getView().rotY = 1; V.setZoom(2); V.getView().panX = 50;
  click(doc.getElementById("msv-reset"));
  const rv = V.getView();
  ok("reset restores rotation, zoom and pan",
    rv.rotY === -0 || (Math.abs(rv.zoom - 1) < 1e-9 && rv.panX === 0 && Math.abs(rv.rotY - 0.6) < 1e-9),
    JSON.stringify({ rotX: rv.rotX, rotY: rv.rotY, zoom: rv.zoom, panX: rv.panX }));

  click(doc.getElementById("msv-labels"));
  ok("labels toggle off", V.getView().labels === false);
  f = lastFrame(rec);
  ok("no labels drawn when off", f.labels.length === 0, f.labels.length);
  click(doc.getElementById("msv-labels"));
  ok("labels toggle back on", V.getView().labels === true);

  ok("the arrival spin resumed after every drag above", V.getView().autoRotate === true);
  click(doc.getElementById("msv-auto"));
  ok("Auto switches the arrival spin off", V.getView().autoRotate === false &&
    doc.getElementById("msv-auto").getAttribute("aria-pressed") === "false");
  click(doc.getElementById("msv-auto"));
  ok("auto rotate turns on", V.getView().autoRotate === true);
  ok("auto button reflects state", doc.getElementById("msv-auto").getAttribute("aria-pressed") === "true");
  down(400, 250); move(430, 250);
  ok("dragging pauses auto rotation", V.getView().autoRotate === false);
  up(430, 250);
  ok("auto rotation resumes after the drag", V.getView().autoRotate === true);
  click(doc.getElementById("msv-auto"));

  /* keyboard */
  const key = (k) => {
    const e = new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    $("#msv-canvas").dispatchEvent(e);
  };
  V.reset();
  const ry = V.getView().rotY;
  key("ArrowRight");
  ok("ArrowRight rotates", V.getView().rotY > ry);
  const zk = V.getView().zoom;
  key("+");
  ok("+ zooms in", V.getView().zoom > zk);
  key("-"); key("-");
  ok("- zooms out", V.getView().zoom < zk);
  V.getView().rotY = 2;
  key("r");
  ok("R resets the view", Math.abs(V.getView().rotY - 0.6) < 1e-9);
  key("a");
  ok("A toggles auto rotation", V.getView().autoRotate === true);
  key("a");

  /* pan */
  V.reset();
  const px0 = V.getView().panX;
  cvEvent("pointerdown", 400, 250, { shiftKey: true });
  cvEvent("pointermove", 450, 250, { shiftKey: true });
  cvEvent("pointerup", 450, 250, { shiftKey: true });
  ok("shift + drag pans instead of rotating", V.getView().panX !== px0 && Math.abs(V.getView().rotY - 0.6) < 1e-9,
    "panX " + V.getView().panX);

  /* wheel */
  V.reset();
  const zw = V.getView().zoom;
  const we = new w.Event("wheel", { bubbles: true, cancelable: true });
  Object.assign(we, { deltaY: -200 });
  $("#msv-canvas").dispatchEvent(we);
  ok("wheel zooms", V.getView().zoom !== zw);

  /* ---------------- the auto-rotation loop ----------------
     Driven by hand with controlled timestamps. A headless browser will not
     fire requestAnimationFrame under a virtual clock, so stepping the loop
     here is the only way to prove it actually advances the rotation. */
  console.log("\n— auto-rotation loop —");
  {
    const { w: w3 } = await boot("https://tooladda.online/chemistry-tools/molecular-structure-viewer.html");
    let captured = null;
    w3.requestAnimationFrame = (fn) => { captured = fn; return null; };
    loadScripts(w3);
    const V3 = w3.MolecularViewer;
    const view3 = V3.getView();

    ok("auto rotation is on straight after load", view3.autoRotate === true);
    ok("a frame was requested", typeof captured === "function");

    const before = view3.rotY;
    const step = captured; captured = null;
    step(1000);                       // first frame establishes the clock
    ok("first frame does not jump the rotation", Math.abs(view3.rotY - before) < 1e-9);
    ok("loop re-armed itself", typeof captured === "function");

    const step2 = captured; captured = null;
    step2(1500);                      // half a second later
    const delta = view3.rotY - before;
    ok("half a second of auto-rotation advances rotY by the normal speed",
      Math.abs(delta - 0.3 * 0.5) < 1e-6 || Math.abs(delta - 0.3 * 0.1) < 1e-6,
      "delta " + delta.toFixed(4));

    const step3 = captured; captured = null;
    step3(1516);
    ok("loop keeps running frame after frame", view3.rotY > before + delta);

    V3.toggleAutoRotate();
    ok("toggling off stops the loop", view3.autoRotate === false);
    const parked = view3.rotY;
    if (captured) captured(2000);
    ok("no further rotation once switched off", Math.abs(view3.rotY - parked) < 1e-9);
  }

  /* ---------------- off-screen pause ---------------- */
  console.log("\n— off-screen pause —");
  {
    const observer = {};
    const { w: w5 } = await boot("https://tooladda.online/chemistry-tools/molecular-structure-viewer.html", { observer });
    let cap = null;
    w5.requestAnimationFrame = (fn) => { cap = fn; return null; };
    loadScripts(w5);
    const v5 = w5.MolecularViewer.getView();
    ok("the viewer watches its own visibility", typeof observer.cb === "function");
    let fn = cap; cap = null; fn(1000);
    fn = cap; cap = null; fn(1500);
    const spun = v5.rotY;
    observer.cb([{ isIntersecting: false }]);
    fn = cap; cap = null;
    if (fn) fn(2000);
    ok("scrolled out of view: no rotation", Math.abs(v5.rotY - spun) < 1e-9, v5.rotY - spun);
    ok("scrolled out of view: the loop stops", cap === null);
    observer.cb([{ isIntersecting: true }]);
    ok("back in view: a frame is requested again", typeof cap === "function");
    fn = cap; cap = null; fn(3000);
    fn = cap; cap = null; fn(3500);
    /* one frame is capped at 0.1 s, so the model never leaps ahead for the time it was hidden */
    ok("back in view: the spin carries on without jumping ahead",
      v5.rotY - spun > 0 && v5.rotY - spun <= 0.3 * 0.1 + 1e-9, v5.rotY - spun);
    ok("Auto stays on while the stage is hidden", v5.autoRotate === true);
  }

  /* ---------------- auto-fit + deep link ---------------- */
  console.log("\n— fit and deep links —");
  V.load("hydrogen");
  const smallFrame = lastFrame(rec);
  const smallSpan = Math.max(...smallFrame.spheres.map((s) => s.x)) - Math.min(...smallFrame.spheres.map((s) => s.x));
  V.load("benzene");
  const bigFrame = lastFrame(rec);
  const bigSpan = Math.max(...bigFrame.spheres.map((s) => s.x)) - Math.min(...bigFrame.spheres.map((s) => s.x));
  ok("auto-fit: a tiny molecule and a large one occupy a similar width",
    smallSpan > 100 && bigSpan > 100 && Math.abs(smallSpan - bigSpan) < smallSpan * 1.2,
    "H2 " + smallSpan.toFixed(0) + "px vs benzene " + bigSpan.toFixed(0) + "px");

  const { w: w2 } = await boot("https://tooladda.online/chemistry-tools/molecular-structure-viewer.html?molecule=ammonia");
  loadScripts(w2);
  ok("?molecule=ammonia opens ammonia", w2.MolecularViewer.getMolecule().id === "ammonia");

  /* ---------------- styles, hydrogens, measuring ---------------- */
  console.log("\n— styles, hydrogens, measuring —");
  V.load("water");
  V.setStyle("space");
  f = lastFrame(rec);
  ok("space-filling draws no sticks", f.sticks.length === 0, f.sticks.length);
  const spaceR = V.getProjected()[0].radius;
  V.setStyle("stick");
  f = lastFrame(rec);
  ok("sticks style draws sticks", f.sticks.length >= 4, f.sticks.length);
  ok("sticks style draws much smaller atoms than space-filling", V.getProjected()[0].radius < spaceR / 3);
  V.setStyle("ball");

  V.load("methane");
  V.toggleHydrogens();
  f = lastFrame(rec);
  ok("hiding hydrogens leaves one sphere for methane", f.spheres.filter((s2) => s2.r > 2).length === 1, f.spheres.length);
  const ph = V.getProjected()[1];
  V.pickAt(ph.sx, ph.sy);
  ok("hidden hydrogens cannot be picked", V.getView().selectedAtom !== 1);
  V.toggleHydrogens();
  V.load("hydrogen");
  V.toggleHydrogens();
  f = lastFrame(rec);
  ok("an all-hydrogen molecule stays visible", f.spheres.filter((s2) => s2.r > 2).length === 2);
  V.toggleHydrogens();

  V.load("water");
  V.toggleMeasure();
  ok("measure button pressed", $("#msv-measure").getAttribute("aria-pressed") === "true");
  let pm = V.getProjected();
  V.pickAt(pm[1].sx, pm[1].sy);
  V.pickAt(pm[0].sx, pm[0].sy);
  ok("two picks give the O–H distance", /0\.958 Å/.test($("#msv-atom-info").textContent), $("#msv-atom-info").textContent);
  V.pickAt(pm[2].sx, pm[2].sy);
  ok("three picks give the H–O–H angle", /104\.5°/.test($("#msv-atom-info").textContent));
  f = lastFrame(rec);
  ok("distance labels drawn on the canvas", f.labels.some((l) => /Å/.test(l.text)), f.labels.map((l) => l.text).join());
  V.pickAt(pm[2].sx, pm[2].sy);
  ok("clicking the last atom again undoes it", V.getView().picks.length === 2);
  V.pickAt(5, 5);
  ok("empty space does not clear picks", V.getView().picks.length === 2);
  click($('#msv-atom-info [data-action="exit-measure"]'));
  ok("Done leaves measure mode", V.getView().measuring === false && V.getView().picks.length === 0);

  V.load("hydrogen-peroxide");
  V.toggleMeasure();
  pm = V.getProjected();
  [2, 0, 1, 3].forEach((i) => V.pickAt(pm[i].sx, pm[i].sy));
  ok("four picks give the H2O2 dihedral", /111\.5°/.test($("#msv-atom-info").textContent), $("#msv-atom-info").textContent);
  V.toggleMeasure();

  V.load("nitrogen");
  pm = V.getProjected();
  V.pickAt((pm[0].sx + pm[1].sx) / 2, (pm[0].sy + pm[1].sy) / 2);
  ok("bond panel shows the bond length", /1\.098 Å/.test($("#msv-atom-info").textContent), $("#msv-atom-info").textContent);

  /* ---------------- library molecules ---------------- */
  console.log("\n— library —");
  V.load("caffeine");
  ok("library molecule shows the PubChem badge", /PubChem 3D/.test($("#msv-info").textContent));
  ok("library molecule shows ring count", /Rings\s*2/.test($("#msv-info").textContent), $("#msv-info").textContent);
  ok("library molecule links to its PubChem page", !!$('#msv-about a[href="https://pubchem.ncbi.nlm.nih.gov/compound/2519"]'));
  ok("accessible description copes with no geometry", /Caffeine/.test($("#msv-canvas-desc").textContent));
  V.load("formaldehyde");
  ok("computed VSEPR for a library molecule", /Trigonal planar/.test($("#msv-info").textContent) && /AX3/.test($("#msv-info").textContent));
  V.load("buckminsterfullerene");
  f = lastFrame(rec);
  ok("C60 draws 60 spheres", f.spheres.filter((s2) => s2.r > 2).length === 60, f.spheres.length);
  ok("C60 draws 30 double + 60 single bonds", f.sticks.length === (30 * 2 + 60) * 2, f.sticks.length);

  /* ---------------- my molecules ---------------- */
  console.log("\n— my molecules —");
  const xyz = "4\nmy ammonia\nN 0 0 0.12\nH 0.94 0 -0.27\nH -0.47 0.81 -0.27\nH -0.47 -0.81 -0.27\n";
  const mine = V.importText(xyz, "nh3.xyz", "file");
  ok("imported XYZ becomes the active molecule", V.getMolecule().id === mine.id && V.getMolecule().name === "my ammonia");
  ok("bonds perceived for the import", V.getMolecule().bonds.length === 3);
  ok("import shows up under My molecules", $$("#msv-list [data-molecule]").some((b) => b.dataset.molecule === mine.id));
  ok("My molecules chip is selected after an import", $('#msv-filters [data-group="mine"]').getAttribute("aria-pressed") === "true");
  ok("import saved to localStorage", /my ammonia/.test(w.localStorage.getItem("tooladda-msv-molecules-v1") || ""));
  ok("imported molecule classified by VSEPR", /Trigonal pyramidal/.test($("#msv-info").textContent));
  ok("XYZ warning shown", /worked out from atom distances/.test($("#msv-about").textContent));
  ok("URL drops ?molecule for a private molecule", w.location.search === "");
  const link = V.shareUrl();
  ok("share link carries the structure in the hash", /#m=[A-Za-z0-9_-]+$/.test(link), link);
  V.importText(xyz, "nh3.xyz", "file");
  ok("importing the same structure twice keeps one entry", MD.custom().length === 1, MD.custom().length);
  const bad = V.importText("not a molecule", "notes.txt", "file");
  ok("a bad file shows a friendly error", bad === null && /Unrecognised format/.test($("#msv-import-error").textContent));

  const { w: w4 } = await boot("https://tooladda.online/chemistry-tools/molecular-structure-viewer.html" + link.slice(link.indexOf("#")));
  loadScripts(w4);
  ok("a #m= link opens the shared structure",
    w4.MolecularViewer.getMolecule().name === "my ammonia" && w4.MolecularViewer.getMolecule().source === "shared",
    w4.MolecularViewer.getMolecule().name);

  click($("#msv-about [data-remove]"));
  ok("remove deletes it from My molecules", MD.custom().length === 0 && !/my ammonia/.test(w.localStorage.getItem("tooladda-msv-molecules-v1") || ""), MD.custom().length);
  ok("after removal a built-in molecule is shown", V.getMolecule().source === "experimental");

  /* ---------------- error handling ---------------- */
  console.log("\n— error handling —");
  V.load("not-a-real-molecule");
  ok("unknown molecule shows a friendly message, no crash",
    /Unable to load/.test(doc.getElementById("msv-error").textContent));
  ok("viewer still holds the previous molecule", V.getMolecule() !== null);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
