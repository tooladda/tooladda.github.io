/* ============================================================================
   ToolAdda — 3D Molecular Structure Viewer
   Vanilla JS + HTML5 Canvas 2D. No 3D library of any kind.

   The molecule really is 3D: every atom carries x/y/z in angstroms, gets run
   through rotation matrices, then a perspective divide, and only then reaches
   the canvas. Depth decides both draw order and size, which is what makes it
   read as a solid object rather than a flat diagram.

   Pipeline, once per frame:
     rotate -> scale to pixels -> perspective divide -> project -> sort by
     depth -> draw bonds and atoms far-to-near -> labels -> measurements

   Where molecules come from
     data/molecules.js          hand-built from published bond lengths/angles
     data/molecule-library.js   PubChem 3D conformers, fetched at build time
     the visitor                files, pasted text, shared links and the
                                opt-in PubChem search; kept in localStorage

   Structure
     state                 view / ui objects, no globals scattered about
     setup                 load / clone / centre / fit / analyse
     3D maths              rotate / project / bond perpendiculars
     render*               drawing
     library               filters, search, list
     my molecules          import, PubChem, storage, export
     handle*               pointer, touch, wheel, keyboard
   ============================================================================ */

(function () {
  "use strict";

  /* ---- tunables ---------------------------------------------------------- */
  var MIN_ZOOM = 0.35;
  var MAX_ZOOM = 4.0;
  var DRAG_THRESHOLD = 5;          // px before a press counts as a drag
  var FOCAL_FACTOR = 2.2;          // focal length as a multiple of viewport size
  var BOND_RADIUS = 0.115;         // stick half-width, in angstroms
  var MULTI_BOND_GAP = 0.135;      // separation between parallel sticks
  var STICK_RADIUS = 0.16;         // "Sticks" style: atoms and bonds share it
  var LARGE_MOLECULE = 160;        // above this many atoms, shading is simplified
  var AUTO_SPEEDS = { slow: 0.12, normal: 0.3, fast: 0.7 };  // rad/sec
  var STORE_KEY = "tooladda-msv-molecules-v1";
  var STORE_MAX = 25;
  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  var MAX_LINK_CHARS = 7000;
  var PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
  var PICK_COLOURS = ["#fbbf24", "#f472b6", "#60a5fa", "#a3e635"];
  /* What a first-time visitor sees: colourful, familiar and clearly 3D
     once it turns. It spins on arrival to invite a closer look. */
  var DEFAULT_MOLECULE = "caffeine";

  /* ---- state ------------------------------------------------------------- */
  var view = {
    rotX: -0.32, rotY: 0.6, rotZ: 0,
    zoom: 1, panX: 0, panY: 0,
    autoRotate: false, speed: "normal",
    labels: true, selectedAtom: null, selectedBond: null,
    style: "ball", showH: true, measuring: false, picks: []
  };
  var DEFAULT_VIEW = { rotX: -0.32, rotY: 0.6, rotZ: 0, zoom: 1, panX: 0, panY: 0 };
  var ui = { group: "all", query: "", busy: false };

  var els = {};
  var cv = null, ctx = null;
  var dpr = 1, cssW = 0, cssH = 0;
  var molecule = null;             // active molecule, already centred
  var info = null;                 // derived facts about the active molecule
  var perps = [];                  // cached multi-bond perpendiculars
  var hiddenAtom = [];             // true where hydrogens are switched off
  var baseScale = 1;               // px per angstrom before zoom
  var projected = [];              // per-atom screen data for hit testing
  var frame = null, lastTime = 0, dirty = true;
  var reduceMotion = false;
  var stageVisible = true;         // no point spinning a model nobody can see
  var MD = null, FMT = null;

  /* ==========================================================================
     BOOT
     ========================================================================== */

  function initializeViewer() {
    MD = window.MoleculeData;
    FMT = window.MoleculeFormats || null;
    if (!MD || !MD.molecules.length) {
      showFatalError("Molecule data could not be loaded. Please refresh the page.");
      return;
    }
    cacheDom();
    if (!cv) return;
    ctx = cv.getContext("2d");
    if (!ctx) { showFatalError("This browser cannot draw on a canvas."); return; }

    reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    restoreCustom();
    buildFilters();
    renderMoleculeList();
    bindEvents();
    setupTabs();
    setupCapabilities();
    resizeCanvas();

    var shared = moleculeFromHash();
    var start = shared || moleculeFromUrl() || MD.byId(DEFAULT_MOLECULE) || MD.molecules[0];
    loadMolecule(start.id);
    revealActiveItem();
    watchStageVisibility();
    if (!reduceMotion) setAutoRotate(true);
    requestFrame();
  }

  /** Stop drawing frames while the stage is scrolled out of view, and pick
      the spin up again when it comes back. */
  function watchStageVisibility() {
    if (!window.IntersectionObserver || !els.stage) return;
    new IntersectionObserver(function (entries) {
      stageVisible = entries[entries.length - 1].isIntersecting;
      if (stageVisible && view.autoRotate) { lastTime = 0; requestFrame(); }
    }).observe(els.stage);
  }

  function cacheDom() {
    var id = function (x) { return document.getElementById(x); };
    cv = id("msv-canvas");
    [
      "app", "stage", "list", "search", "quick", "info", "about", "legend", "live", "error",
      "speed", "filters", "count", "online", "pubchem", "pubchem-label", "pubchem-status",
      "open-file", "file", "paste-toggle", "paste", "paste-text", "paste-load", "import-error",
      "stage-source", "stage-hint", "measure-hint", "drop", "style", "hydrogens", "measure",
      "fullscreen", "menu", "labels", "auto"
    ].forEach(function (k) {
      els[k.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = id("msv-" + k);
    });
    els.formula = id("msv-stage-formula");
    els.stageName = id("msv-stage-name");
    els.atomInfo = id("msv-atom-info");
    els.a11y = id("msv-canvas-desc");
    els.lib = id("msv-lib");
    els.inspect = id("msv-inspect");
  }

  function showFatalError(message) {
    var host = document.getElementById("msv-error");
    if (host) { host.textContent = message; host.hidden = false; }
    if (window.console) console.error("[molecular-viewer] " + message);
  }

  /* ==========================================================================
     MOLECULE SETUP
     ========================================================================== */

  var META_FIELDS = ["id", "name", "formula", "geometry", "bondAngle", "polarity", "about", "note",
    "category", "group", "vsepr", "source", "cid", "fileName", "warnings"];

  /** Deep-copy so the shared dataset is never mutated by centring. */
  function cloneMolecule(src) {
    var m = {};
    META_FIELDS.forEach(function (k) { m[k] = src[k]; });
    m.atoms = src.atoms.map(function (a) { return { element: a.element, x: a.x, y: a.y, z: a.z, charge: a.charge || 0 }; });
    m.bonds = src.bonds.map(function (b) { return { from: b.from, to: b.to, order: b.order }; });
    return m;
  }

  /** Shift every atom so the centroid sits at the origin. */
  function centerMolecule(m) {
    var n = m.atoms.length, sx = 0, sy = 0, sz = 0;
    m.atoms.forEach(function (a) { sx += a.x; sy += a.y; sz += a.z; });
    sx /= n; sy /= n; sz /= n;
    m.atoms.forEach(function (a) { a.x -= sx; a.y -= sy; a.z -= sz; });
  }

  function atomRadius(element) {
    if (view.style === "space") return MD.vdwRadius(element);
    if (view.style === "stick") return STICK_RADIUS;
    return MD.styleFor(element).radius;
  }

  function bondRadius() { return view.style === "stick" ? STICK_RADIUS : BOND_RADIUS; }

  /** Bounding radius including each atom's drawn sphere. */
  function boundingRadius(m) {
    var r = 0;
    m.atoms.forEach(function (a) {
      var d = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) + atomRadius(a.element);
      if (d > r) r = d;
    });
    return r || 1;
  }

  /** Pixels-per-angstrom so the molecule fills roughly 76% of the viewport. */
  function fitMoleculeToView() {
    if (!molecule || !cssW || !cssH) return;
    baseScale = (Math.min(cssW, cssH) * 0.38) / boundingRadius(molecule);
  }

  /** Facts shown in the panels, worked out once per molecule. */
  function analyse(m) {
    var out = { rings: null, heavy: 0, vsepr: m.vsepr || null, geometry: m.geometry || null, angle: null, centre: null };
    m.atoms.forEach(function (a) { if (a.element !== "H") out.heavy++; });
    if (FMT) {
      out.rings = FMT.ringCount(m).rings;
      var v = FMT.classifyVsepr(m);
      if (v) {
        out.centre = v.centre;
        if (!out.vsepr) out.vsepr = v.vsepr;
        if (!out.geometry) out.geometry = v.geometry;
        if (m.bondAngle === null || m.bondAngle === undefined) {
          out.angle = v.maxAngle - v.minAngle < 0.5
            ? ((v.maxAngle + v.minAngle) / 2).toFixed(1) + "°"
            : v.minAngle.toFixed(1) + "–" + v.maxAngle.toFixed(1) + "°";
        }
      }
    }
    return out;
  }

  function updateHidden() {
    var allH = molecule.atoms.every(function (a) { return a.element === "H"; });
    hiddenAtom = molecule.atoms.map(function (a) { return !view.showH && !allH && a.element === "H"; });
  }

  function loadMolecule(id) {
    var src = MD.byId(id);
    if (!src) { showFatalError("Unable to load this molecular model."); return; }
    showMolecule(src);
  }

  function showMolecule(src) {
    var next, nextInfo;
    try {
      next = cloneMolecule(src);
      centerMolecule(next);
      nextInfo = analyse(next);
    } catch (e) {
      showFatalError("Unable to load this molecular model.");
      if (window.console) console.error(e);
      return;
    }
    molecule = next;
    info = nextInfo;
    perps = molecule.bonds.map(function (b) { return b.order > 1 ? bondPerpendicular(b) : null; });
    updateHidden();
    fitMoleculeToView();
    if (els.error) els.error.hidden = true;

    view.selectedAtom = null;
    view.selectedBond = null;
    view.picks = [];
    resetView(true);

    updateStageTag();
    renderInfo();
    renderAtomInfo();
    renderLegend();
    markActiveInList();
    updateAccessibleDescription();
    updateUrl();
    updateMeasureHint();
    requestFrame();
  }

  /* ==========================================================================
     3D MATHS
     ========================================================================== */

  /** Rotate a point about X, then Y, then Z — always in that order, so the
      axes never swap meaning between frames. */
  function rotatePoint(x, y, z) {
    var cx = Math.cos(view.rotX), sx = Math.sin(view.rotX);
    var y1 = y * cx - z * sx;
    var z1 = y * sx + z * cx;

    var cy = Math.cos(view.rotY), sy = Math.sin(view.rotY);
    var x2 = x * cy + z1 * sy;
    var z2 = -x * sy + z1 * cy;

    if (!view.rotZ) return { x: x2, y: y1, z: z2 };
    var cz = Math.cos(view.rotZ), sz = Math.sin(view.rotZ);
    return { x: x2 * cz - y1 * sz, y: x2 * sz + y1 * cz, z: z2 };
  }

  /** Perspective divide + screen mapping.

      Convention: +z points towards the viewer. So a larger z means nearer,
      which shrinks the denominator and enlarges the atom. The same convention
      drives the depth sort, where ascending z is far-to-near — the two must
      agree or near atoms end up drawn small and behind. */
  function project3D(p) {
    var s = baseScale * view.zoom;
    var focal = Math.min(cssW, cssH) * FOCAL_FACTOR;
    var zp = p.z * s;
    var denom = focal - zp;
    var floor = focal * 0.15;                  // clamp: no blow-up, no flip
    if (denom < floor) denom = floor;
    var persp = focal / denom;
    return {
      x: cssW / 2 + p.x * s * persp + view.panX,
      y: cssH / 2 - p.y * s * persp + view.panY,
      depth: p.z,
      persp: persp
    };
  }

  function transformAtom(a, i) {
    var r = rotatePoint(a.x, a.y, a.z);
    var pr = project3D(r);
    return {
      element: a.element, sx: pr.x, sy: pr.y, depth: pr.depth, persp: pr.persp,
      radius: atomRadius(a.element) * baseScale * view.zoom * pr.persp,
      hidden: !!hiddenAtom[i]
    };
  }

  /** A unit vector perpendicular to the bond, used to fan out double and
      triple bonds. Derived in molecule space from a neighbouring atom where
      one exists, so the extra sticks lie in the chemically sensible plane and
      rotate with everything else. Cached per molecule. */
  function bondPerpendicular(bond) {
    var a = molecule.atoms[bond.from], b = molecule.atoms[bond.to];
    var ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
    var alen = Math.hypot(ax, ay, az) || 1;
    ax /= alen; ay /= alen; az /= alen;

    var ref = null;
    for (var i = 0; i < molecule.bonds.length && !ref; i++) {
      var o = molecule.bonds[i];
      if (o === bond) continue;
      var shared = null, other = null;
      if (o.from === bond.from || o.from === bond.to) { shared = o.from; other = o.to; }
      else if (o.to === bond.from || o.to === bond.to) { shared = o.to; other = o.from; }
      if (shared === null) continue;
      var s = molecule.atoms[shared], t = molecule.atoms[other];
      var vx = t.x - s.x, vy = t.y - s.y, vz = t.z - s.z;
      // component of v perpendicular to the bond axis
      var dot = vx * ax + vy * ay + vz * az;
      var px = vx - dot * ax, py = vy - dot * ay, pz = vz - dot * az;
      var plen = Math.hypot(px, py, pz);
      if (plen > 1e-6) ref = { x: px / plen, y: py / plen, z: pz / plen };
    }
    /* null means "this bond has no chemically meaningful plane" — a diatomic
       or a linear molecule like CO2. The renderer then fans the extra sticks
       out in view space instead, so they stay visible from every angle. */
    return ref;
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */

  function renderMolecule() {
    if (!ctx || !molecule) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var atoms = molecule.atoms.map(transformAtom);
    projected = atoms;
    var flat = molecule.atoms.length > LARGE_MOLECULE;

    /* build a flat draw list so bonds and atoms interleave by true depth —
       without this, a bond behind an atom would still be painted on top */
    var items = [];
    atoms.forEach(function (p, i) {
      if (!p.hidden) items.push({ kind: "atom", depth: p.depth, i: i, p: p });
    });

    if (view.style !== "space") {
      var stick = view.style === "stick";
      molecule.bonds.forEach(function (bond, bi) {
        if (atoms[bond.from].hidden || atoms[bond.to].hidden) return;
        var perp = perps[bi];
        var offsets = bond.order === 1 ? [0] : bond.order === 2 ? [-0.5, 0.5] : [-1, 0, 1];
        var gap = stick ? STICK_RADIUS * 1.25 : MULTI_BOND_GAP;
        var radius = stick && bond.order > 1 ? STICK_RADIUS * 0.55 : bondRadius();
        offsets.forEach(function (mult) {
          var seg = buildBondSegment(bond, perp, mult * gap, radius, stick);
          if (!seg) return;
          /* each half is sorted on its own midpoint, not the whole bond's — the
             near half of a bond can legitimately sit in front of an atom that
             the far half sits behind */
          items.push({ kind: "half", depth: seg.depthA, half: seg.a, bi: bi });
          items.push({ kind: "half", depth: seg.depthB, half: seg.b, bi: bi });
        });
      });
    }

    sortByDepth(items);

    /* Each label is painted straight after its own atom, so a nearer atom
       covers the label of one behind it — essential in space-filling mode. */
    var busy = molecule.atoms.length > 30;
    items.forEach(function (it) {
      if (it.kind === "half") renderBondHalf(it.half, it.bi, flat);
      else {
        renderAtom(it.p, it.i, flat);
        if (view.labels) renderLabel(it.p, it.i, busy);
      }
    });

    if (view.measuring && view.picks.length) renderMeasurements(atoms);
  }

  /** Far objects first: smaller z is further from the camera in this setup. */
  function sortByDepth(items) {
    items.sort(function (a, b) { return a.depth - b.depth; });
  }

  /** One drawable stick, split into its two coloured halves.

      Each end is pulled back to the surface of its atom's sphere before
      projection. Without that trim the stick is drawn from centre to centre
      and paints straight across the ball whenever it sorts in front of it. */
  function buildBondSegment(bond, perp, offset, radius, noTrim) {
    var a = molecule.atoms[bond.from], b = molecule.atoms[bond.to];
    var ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    if (perp && offset) {
      ax += perp.x * offset; ay += perp.y * offset; az += perp.z * offset;
      bx += perp.x * offset; by += perp.y * offset; bz += perp.z * offset;
    }

    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    var ux = dx / len, uy = dy / len, uz = dz / len;

    var cap = len * 0.4;   // never eat more than 40% of the stick from one end
    var ta = noTrim ? 0 : Math.min(MD.styleFor(a.element).radius * 0.92, cap);
    var tb = noTrim ? 0 : Math.min(MD.styleFor(b.element).radius * 0.92, cap);
    var sax = ax + ux * ta, say = ay + uy * ta, saz = az + uz * ta;
    var sbx = bx - ux * tb, sby = by - uy * tb, sbz = bz - uz * tb;
    var mx = (sax + sbx) / 2, my = (say + sby) / 2, mz = (saz + sbz) / 2;

    var ra = rotatePoint(sax, say, saz);
    var rb = rotatePoint(sbx, sby, sbz);
    var rm = rotatePoint(mx, my, mz);

    /* no molecular plane (diatomic / linear): fan the extra sticks out across
       the screen instead, computed after rotation so they stay perpendicular
       to the bond and never collapse into one another */
    if (!perp && offset) {
      var vx = rb.x - ra.x, vy = rb.y - ra.y;
      var px = vy, py = -vx;                                   // cross(v, z-axis)
      var plen = Math.hypot(px, py);
      if (plen < 1e-6) { px = 1; py = 0; plen = 1; }           // bond points at camera
      px /= plen; py /= plen;
      ra = { x: ra.x + px * offset, y: ra.y + py * offset, z: ra.z };
      rb = { x: rb.x + px * offset, y: rb.y + py * offset, z: rb.z };
      rm = { x: rm.x + px * offset, y: rm.y + py * offset, z: rm.z };
    }

    var pa = project3D(ra), pb = project3D(rb), pm = project3D(rm);
    var w = function (p) { return radius * baseScale * view.zoom * p.persp; };

    var colorA = MD.styleFor(a.element).color;
    var colorB = MD.styleFor(b.element).color;

    return {
      a: { x1: pa.x, y1: pa.y, w1: w(pa), x2: pm.x, y2: pm.y, w2: w(pm), color: colorA },
      b: { x1: pm.x, y1: pm.y, w1: w(pm), x2: pb.x, y2: pb.y, w2: w(pb), color: colorB },
      depthA: (ra.z + rm.z) / 2,
      depthB: (rm.z + rb.z) / 2
    };
  }

  /** A half-stick drawn as a tapered quad with a cross-gradient, so it reads
      as a cylinder rather than a flat bar. */
  function renderBondHalf(h, bondIndex, flat) {
    drawHalfStick(h.x1, h.y1, h.w1, h.x2, h.y2, h.w2, h.color, view.selectedBond === bondIndex, flat);
  }

  function drawHalfStick(x1, y1, w1, x2, y2, w2, color, selected, flat) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    var nx = -dy / len, ny = dx / len;      // unit normal in screen space

    ctx.beginPath();
    ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
    ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
    ctx.lineTo(x2 - nx * w2, y2 - ny * w2);
    ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
    ctx.closePath();

    if (flat) {
      ctx.fillStyle = shade(color, -0.12);
    } else {
      var g = ctx.createLinearGradient(x1 + nx * w1, y1 + ny * w1, x1 - nx * w1, y1 - ny * w1);
      g.addColorStop(0, shade(color, -0.45));
      g.addColorStop(0.34, shade(color, 0.16));
      g.addColorStop(0.62, color);
      g.addColorStop(1, shade(color, -0.55));
      ctx.fillStyle = g;
    }
    ctx.fill();

    if (selected) {
      ctx.strokeStyle = "rgba(45, 212, 191, .95)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  /** A sphere: radial gradient lit from the upper left, rim darkening and a
      specular dot. Flat circles never look three-dimensional. */
  function renderAtom(p, index, flat) {
    if (p.radius < 0.4) return;
    var style = MD.styleFor(p.element);
    var r = p.radius;
    var selected = view.selectedAtom === index;

    if (selected) {
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r * 1.45, 0, Math.PI * 2);
      var glow = ctx.createRadialGradient(p.sx, p.sy, r, p.sx, p.sy, r * 1.45);
      glow.addColorStop(0, "rgba(45, 212, 191, .40)");
      glow.addColorStop(1, "rgba(45, 212, 191, 0)");
      ctx.fillStyle = glow;
      ctx.fill();
    }

    var g = ctx.createRadialGradient(
      p.sx - r * 0.35, p.sy - r * 0.4, r * 0.05,
      p.sx, p.sy, r
    );
    g.addColorStop(0, shade(style.color, 0.62));
    g.addColorStop(0.35, shade(style.color, 0.14));
    g.addColorStop(0.78, style.color);
    g.addColorStop(1, shade(style.color, -0.55));

    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // rim so overlapping spheres stay separable
    ctx.strokeStyle = "rgba(0, 0, 0, .35)";
    ctx.lineWidth = Math.max(0.6, r * 0.055);
    ctx.stroke();

    // specular highlight
    if (r > 3 && !flat) {
      ctx.beginPath();
      ctx.ellipse(p.sx - r * 0.34, p.sy - r * 0.4, r * 0.22, r * 0.16, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, .5)";
      ctx.fill();
    }

    if (selected) {
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r * 1.16, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(45, 212, 191, .95)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /** `busy` molecules label only heteroatoms: thirty "C" and "H" letters
      hide the structure they are meant to explain. */
  function renderLabel(p, index, busy) {
    var picked = view.measuring && view.picks.indexOf(index) > -1;
    if (!picked && (p.radius < 7 || (busy && (p.element === "C" || p.element === "H")))) return;
    var style = MD.styleFor(p.element);
    var size = Math.max(9, Math.min(p.radius * 0.95, 30));
    var text = picked ? atomLabel(index) : p.element;
    if (picked) size = Math.max(10, Math.min(size, 16));
    ctx.font = "700 " + size.toFixed(1) + "px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = luminance(style.color) > 0.55 ? "rgba(10,20,26,.92)" : "rgba(255,255,255,.95)";
    if (picked && p.radius < 12) {
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.fillText(text, p.sx, p.sy - p.radius - size * 0.7);
      return;
    }
    ctx.fillText(text, p.sx, p.sy + size * 0.04);
  }

  /** Dashed lines between picked atoms, a numbered ring on each and the
      distance written beside every segment. */
  function renderMeasurements(atoms) {
    var picks = view.picks;
    var pts = picks.map(function (i) { return atoms[i]; });
    ctx.save();
    if (ctx.setLineDash) ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(251, 191, 36, .95)";
    ctx.beginPath();
    pts.forEach(function (p, k) {
      if (k === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    });
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);

    pts.forEach(function (p, k) {
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, Math.max(p.radius * 1.2, 9), 0, Math.PI * 2);
      ctx.strokeStyle = PICK_COLOURS[k];
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });

    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var k = 1; k < pts.length; k++) {
      var a = pts[k - 1], b = pts[k];
      var d = FMT ? FMT.distance(molecule.atoms[picks[k - 1]], molecule.atoms[picks[k]]) : 0;
      var text = d.toFixed(3) + " Å";
      var mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2 - 12;
      var w = ctx.measureText ? ctx.measureText(text).width + 10 : 60;
      ctx.fillStyle = "rgba(7, 11, 20, .82)";
      ctx.beginPath();
      ctx.moveTo(mx - w / 2, my - 9);
      ctx.lineTo(mx + w / 2, my - 9);
      ctx.lineTo(mx + w / 2, my + 9);
      ctx.lineTo(mx - w / 2, my + 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fde68a";
      ctx.fillText(text, mx, my);
    }
    ctx.restore();
  }

  /* ---- small colour helpers ---- */
  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  function shade(hex, amount) {
    var c = hexToRgb(hex);
    var f = function (v) {
      var out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
      return Math.max(0, Math.min(255, Math.round(out)));
    };
    return "rgb(" + f(c.r) + "," + f(c.g) + "," + f(c.b) + ")";
  }
  function luminance(hex) {
    var c = hexToRgb(hex);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }

  /* ==========================================================================
     CANVAS SIZING
     ========================================================================== */

  function resizeCanvas() {
    if (!cv) return;
    var rect = cv.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);   // cap: 3x costs a lot
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    fitMoleculeToView();
    requestFrame();
  }

  /* ==========================================================================
     ANIMATION
     ========================================================================== */

  function requestFrame() {
    dirty = true;
    if (frame === null) frame = requestAnimationFrame(animate);
  }

  function animate(now) {
    frame = null;
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
    lastTime = now;
    var spinning = view.autoRotate && !reduceMotion && stageVisible;

    if (spinning) {
      view.rotY += (AUTO_SPEEDS[view.speed] || AUTO_SPEEDS.normal) * dt;
      dirty = true;
    }

    if (dirty) {
      renderMolecule();
      dirty = false;
    }
    // keep the loop alive only while something is actually moving
    if (spinning) frame = requestAnimationFrame(animate);
    else lastTime = 0;
  }

  /* ==========================================================================
     POINTER / TOUCH / WHEEL
     ========================================================================== */

  var drag = null;
  var pinch = null;
  var autoResume = false;

  function pauseAutoRotate() {
    if (view.autoRotate) { autoResume = true; setAutoRotate(false); }
  }
  function maybeResumeAutoRotate() {
    if (autoResume) { autoResume = false; setAutoRotate(true); }
  }

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ } }
    drag = {
      id: e.pointerId, x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      moved: false, pan: e.shiftKey
    };
    pauseAutoRotate();
  }

  function handlePointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved &&
        Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved) {
      if (drag.pan) {
        view.panX += dx; view.panY += dy;
      } else {
        view.rotY += dx * 0.0095;
        view.rotX += dy * 0.0095;
        view.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.rotX));
      }
      requestFrame();
    }
    drag.x = e.clientX; drag.y = e.clientY;
  }

  function handlePointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var wasClick = !drag.moved;
    var pt = canvasPoint(e.clientX, e.clientY);
    drag = null;
    maybeResumeAutoRotate();
    if (wasClick && e.type !== "pointercancel") handlePick(pt.x, pt.y);
  }

  function canvasPoint(clientX, clientY) {
    var r = cv.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function handleWheel(e) {
    e.preventDefault();
    var factor = Math.exp(-e.deltaY * 0.0012);
    setZoom(view.zoom * factor);
  }

  function setZoom(z) {
    view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    requestFrame();
  }

  /* ---- touch: 1 finger rotate, 2 fingers pinch + pan ---- */
  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      drag = null;
      pinch = {
        dist: touchDistance(e.touches),
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        zoom: view.zoom
      };
      pauseAutoRotate();
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinch) {
      e.preventDefault();
      var d = touchDistance(e.touches);
      var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setZoom(pinch.zoom * (d / (pinch.dist || 1)));
      view.panX += cx - pinch.cx;
      view.panY += cy - pinch.cy;
      pinch.cx = cx; pinch.cy = cy;
      requestFrame();
    }
  }

  function handleTouchEnd(e) {
    if (e.touches.length < 2) { pinch = null; maybeResumeAutoRotate(); }
  }

  function touchDistance(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  /* ==========================================================================
     PICKING
     ========================================================================== */

  /** Atoms win over bonds, and nearer objects win over further ones. */
  function handlePick(x, y) {
    var best = -1, bestDepth = -Infinity;
    for (var i = 0; i < projected.length; i++) {
      var p = projected[i];
      if (p.hidden) continue;
      if (Math.hypot(x - p.sx, y - p.sy) <= Math.max(p.radius, 4) && p.depth > bestDepth) {
        best = i; bestDepth = p.depth;
      }
    }
    if (view.measuring) {
      if (best >= 0) addPick(best);
      return;
    }
    if (best >= 0) { selectAtom(best); return; }

    var bond = view.style === "space" ? -1 : pickBond(x, y);
    if (bond >= 0) { selectBond(bond); return; }

    clearSelection();
  }

  function pickBond(x, y) {
    var best = -1, bestDepth = -Infinity;
    for (var i = 0; i < molecule.bonds.length; i++) {
      var b = molecule.bonds[i];
      var a = projected[b.from], c = projected[b.to];
      if (!a || !c || a.hidden || c.hidden) continue;
      var d = pointSegmentDistance(x, y, a.sx, a.sy, c.sx, c.sy);
      var tol = Math.max(5, bondRadius() * baseScale * view.zoom * 1.6);
      if (d <= tol) {
        var depth = (a.depth + c.depth) / 2;
        if (depth > bestDepth) { best = i; bestDepth = depth; }
      }
    }
    return best;
  }

  function pointSegmentDistance(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function selectAtom(index) {
    view.selectedAtom = index;
    view.selectedBond = null;
    renderAtomInfo();
    requestFrame();
  }

  function selectBond(index) {
    view.selectedBond = index;
    view.selectedAtom = null;
    renderAtomInfo();
    requestFrame();
  }

  function clearSelection() {
    view.selectedAtom = null;
    view.selectedBond = null;
    if (view.measuring) view.picks = [];
    renderAtomInfo();
    updateMeasureHint();
    requestFrame();
  }

  /* ---- measuring ---- */
  function atomLabel(i) { return molecule.atoms[i].element + (i + 1); }

  function toggleMeasure() {
    view.measuring = !view.measuring;
    view.picks = [];
    view.selectedAtom = null;
    view.selectedBond = null;
    if (els.measure) els.measure.setAttribute("aria-pressed", String(view.measuring));
    if (els.stage) els.stage.classList.toggle("is-measuring", view.measuring);
    if (!FMT && view.measuring) announce("Measuring needs the geometry helpers, which did not load.");
    updateMeasureHint();
    renderAtomInfo();
    requestFrame();
    announce(view.measuring ? "Measure mode on. Click atoms to measure." : "Measure mode off.");
  }

  function addPick(i) {
    var at = view.picks.indexOf(i);
    if (at === view.picks.length - 1 && at > -1) view.picks.pop();          // click again to undo
    else if (at > -1) return;
    else if (view.picks.length >= 4) view.picks = [i];
    else view.picks.push(i);
    updateMeasureHint();
    renderAtomInfo();
    requestFrame();
    var m = measurements();
    if (m.length) announce(m[m.length - 1].label + " " + m[m.length - 1].value);
  }

  function measurements() {
    var p = view.picks, a = molecule.atoms, out = [];
    if (!FMT) return out;
    var L = function (i) { return atomLabel(i); };
    for (var k = 1; k < p.length; k++) {
      out.push({ kind: "Distance", label: L(p[k - 1]) + "–" + L(p[k]), value: FMT.distance(a[p[k - 1]], a[p[k]]).toFixed(3) + " Å" });
    }
    if (p.length >= 3) {
      out.push({ kind: "Angle", label: L(p[0]) + "–" + L(p[1]) + "–" + L(p[2]), value: FMT.angle(a[p[0]], a[p[1]], a[p[2]]).toFixed(1) + "°" });
    }
    if (p.length === 4) {
      out.push({ kind: "Angle", label: L(p[1]) + "–" + L(p[2]) + "–" + L(p[3]), value: FMT.angle(a[p[1]], a[p[2]], a[p[3]]).toFixed(1) + "°" });
      out.push({ kind: "Dihedral", label: L(p[0]) + "–" + L(p[1]) + "–" + L(p[2]) + "–" + L(p[3]), value: FMT.dihedral(a[p[0]], a[p[1]], a[p[2]], a[p[3]]).toFixed(1) + "°" });
    }
    return out;
  }

  function updateMeasureHint() {
    if (!els.measureHint) return;
    els.measureHint.hidden = !view.measuring;
    if (els.stageHint) els.stageHint.hidden = view.measuring;
    if (!view.measuring) return;
    var n = view.picks.length;
    els.measureHint.textContent = n === 0 ? "Measure: click an atom to start"
      : n === 1 ? "Click a second atom for the distance"
      : n === 2 ? "Add a third atom for the angle"
      : n === 3 ? "Add a fourth atom for the dihedral"
      : "Click any atom to start a new measurement";
  }

  /* ==========================================================================
     VIEW ACTIONS
     ========================================================================== */

  function resetView(silent) {
    view.rotX = DEFAULT_VIEW.rotX; view.rotY = DEFAULT_VIEW.rotY; view.rotZ = DEFAULT_VIEW.rotZ;
    view.zoom = DEFAULT_VIEW.zoom; view.panX = DEFAULT_VIEW.panX; view.panY = DEFAULT_VIEW.panY;
    requestFrame();
    if (!silent) announce("View reset.");
  }

  function setAutoRotate(on) {
    view.autoRotate = !!on;
    if (els.auto) els.auto.setAttribute("aria-pressed", String(view.autoRotate));
    if (view.autoRotate) { lastTime = 0; requestFrame(); }
  }

  function toggleAutoRotate() {
    if (reduceMotion && !view.autoRotate) {
      announce("Auto rotation is unavailable because your system requests reduced motion.");
      return;
    }
    setAutoRotate(!view.autoRotate);
    announce(view.autoRotate ? "Auto rotation on." : "Auto rotation off.");
  }

  function toggleLabels() {
    view.labels = !view.labels;
    if (els.labels) els.labels.setAttribute("aria-pressed", String(view.labels));
    requestFrame();
  }

  function toggleHydrogens() {
    view.showH = !view.showH;
    if (els.hydrogens) {
      els.hydrogens.setAttribute("aria-pressed", String(view.showH));
      els.hydrogens.setAttribute("aria-label", view.showH ? "Hide hydrogen atoms" : "Show hydrogen atoms");
    }
    if (!view.showH) {
      if (view.selectedAtom !== null && molecule.atoms[view.selectedAtom].element === "H") view.selectedAtom = null;
      view.picks = view.picks.filter(function (i) { return molecule.atoms[i].element !== "H"; });
      renderAtomInfo();
    }
    updateHidden();
    requestFrame();
    announce(view.showH ? "Hydrogen atoms shown." : "Hydrogen atoms hidden.");
  }

  function setStyle(style) {
    if (["ball", "space", "stick"].indexOf(style) < 0) return;
    view.style = style;
    if (els.style && els.style.value !== style) els.style.value = style;
    if (style === "space") view.selectedBond = null;
    fitMoleculeToView();
    renderAtomInfo();
    requestFrame();
  }

  /* ==========================================================================
     PANELS
     ========================================================================== */

  function formulaHtml(formula) {
    return MD.formulaParts(formula).map(function (p) {
      return escapeHtml(p[0]) + (p[1] ? "<sub>" + escapeHtml(p[1]) + "</sub>" : "");
    }).join("");
  }

  var SOURCE_LABEL = {
    experimental: "Experimental geometry",
    pubchem: "PubChem 3D",
    "pubchem-live": "PubChem 3D · yours",
    file: "Your file",
    pasted: "Pasted",
    shared: "Shared link"
  };

  function updateStageTag() {
    if (els.formula) els.formula.innerHTML = formulaHtml(molecule.formula);
    if (els.stageName) els.stageName.textContent = molecule.name;
    if (els.stageSource) {
      els.stageSource.textContent = SOURCE_LABEL[molecule.source] || "";
      els.stageSource.setAttribute("data-source", molecule.source || "");
    }
  }

  function formatAngle(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v + "<small>°</small>";
    return escapeHtml(v).replace(/(\d+(?:\.\d+)?)/g, "$1<small>°</small>");
  }

  function renderInfo() {
    var mass = MD.molarMass(molecule);
    var orders = molecule.bonds.map(function (b) { return b.order; });
    var bondTypes = [];
    if (orders.indexOf(1) > -1) bondTypes.push("single");
    if (orders.indexOf(2) > -1) bondTypes.push("double");
    if (orders.indexOf(3) > -1) bondTypes.push("triple");

    var prop = function (label, value, wide) {
      var na = value === null || value === undefined || value === "";
      return '<div class="msv-prop' + (wide ? " msv-prop--wide" : "") + '"><dt>' + label + "</dt><dd>" + (na ? "N/A" : value) + "</dd></div>";
    };
    var centre = info.centre !== null ? molecule.atoms[info.centre].element : null;
    var curated = molecule.source === "experimental";

    var html = '<div class="msv-info-head"><h3 class="msv-info-name">' + escapeHtml(molecule.name) + "</h3>" +
      '<span class="msv-badge" data-source="' + escapeHtml(molecule.source || "") + '">' + escapeHtml(SOURCE_LABEL[molecule.source] || "") + "</span></div>";

    html += '<dl class="msv-props">' +
      prop("Formula", formulaHtml(molecule.formula)) +
      (info.geometry ? prop("Geometry", escapeHtml(info.geometry)) : "") +
      (info.vsepr ? prop("VSEPR", '<span class="msv-mono">' + escapeHtml(info.vsepr) + "</span>") : "") +
      prop("Atoms", molecule.atoms.length) +
      prop("Bonds", molecule.bonds.length) +
      prop("Molar mass", mass === null ? null : mass.toFixed(3) + " <small>g/mol</small>");
    if (curated) {
      html += prop("Bond angle", formatAngle(molecule.bondAngle)) +
        prop("Bond types", bondTypes.join(", ")) +
        prop("Polarity", escapeHtml(molecule.polarity));
    } else {
      if (info.angle) html += prop("Angles at " + escapeHtml(centre), info.angle.replace("°", "<small>°</small>"));
      html += prop("Bond types", bondTypes.join(", ") || "none") +
        (info.rings !== null ? prop("Rings", info.rings) : "") +
        prop("Heavy atoms", info.heavy);
    }
    html += "</dl>";
    els.info.innerHTML = html;

    var about = molecule.about ? '<p class="msv-about">' + escapeHtml(molecule.about) + "</p>" : "";
    if (molecule.note) about += '<p class="msv-note">' + escapeHtml(molecule.note) + "</p>";
    (molecule.warnings || []).forEach(function (w) { about += '<p class="msv-note msv-note--warn">' + escapeHtml(w) + "</p>"; });
    about += '<p class="msv-source">' + sourceLine() + "</p>";
    if (molecule.group === "mine") {
      about += '<button type="button" class="msv-btn msv-btn--sm msv-btn--ghost" data-remove="' + escapeHtml(molecule.id) + '">Remove from My molecules</button>';
    }
    els.about.innerHTML = about;
  }

  function pubchemLink(cid) {
    return '<a href="https://pubchem.ncbi.nlm.nih.gov/compound/' + encodeURIComponent(cid) +
      '" target="_blank" rel="noopener noreferrer nofollow">PubChem CID ' + escapeHtml(cid) + "</a>";
  }

  function sourceLine() {
    switch (molecule.source) {
      case "experimental": return "Geometry built from published gas-phase bond lengths and bond angles.";
      case "pubchem": return "3D coordinates: computed conformer from " + pubchemLink(molecule.cid) + ".";
      case "pubchem-live": return "Downloaded from " + pubchemLink(molecule.cid) + " (computed conformer). Saved only in this browser.";
      case "file": return "Opened from your file" + (molecule.fileName ? " “" + escapeHtml(molecule.fileName) + "”" : "") + ". It never left your device.";
      case "pasted": return "Pasted by you. Saved only in this browser.";
      case "shared": return "Opened from a shared link. Saved only in this browser.";
      default: return "";
    }
  }

  function bondsOf(i) {
    return molecule.bonds.map(function (b, bi) { return { b: b, bi: bi }; })
      .filter(function (o) { return o.b.from === i || o.b.to === i; });
  }

  var BOND_WORD = { 1: "Single bond", 2: "Double bond", 3: "Triple bond" };
  var BOND_GLYPH = { 1: "—", 2: "=", 3: "≡" };

  function renderAtomInfo() {
    if (view.measuring) { renderMeasurePanel(); return; }

    if (view.selectedAtom !== null && molecule.atoms[view.selectedAtom]) {
      var i = view.selectedAtom;
      var a = molecule.atoms[i];
      var style = MD.styleFor(a.element);
      var el = window.ChemData ? window.ChemData.bySymbol(a.element) : null;
      var mine = bondsOf(i);
      var neighbours = mine.map(function (o) {
        var j = o.b.from === i ? o.b.to : o.b.from;
        var len = FMT ? FMT.distance(a, molecule.atoms[j]).toFixed(3) + " Å" : "";
        return "<li><span>" + escapeHtml(atomLabel(i)) + " " + BOND_GLYPH[o.b.order] + " " + escapeHtml(atomLabel(j)) + "</span><span>" + len + "</span></li>";
      }).join("");
      els.atomInfo.innerHTML =
        '<div class="msv-atominfo">' +
          '<span class="msv-atominfo__ball" style="background:' + style.color + '">' + escapeHtml(a.element) + "</span>" +
          '<span class="msv-atominfo__meta">' +
            '<span class="msv-atominfo__name">' + escapeHtml(el ? el.name : style.name) + ' <small>' + escapeHtml(atomLabel(i)) + "</small></span><br>" +
            '<span class="msv-atominfo__sub">' +
              (el ? "Atomic number " + el.z + " · " + el.mass + " u" : "Symbol " + escapeHtml(a.element)) +
              " · " + mine.length + " bond" + (mine.length === 1 ? "" : "s") +
              (a.charge ? " · formal charge " + (a.charge > 0 ? "+" : "−") + Math.abs(a.charge) : "") +
            "</span>" +
          "</span>" +
        "</div>" +
        (neighbours ? '<ul class="msv-bondlist">' + neighbours + "</ul>" : "");
      announce(("" + (el ? el.name : a.element)) + " selected.");
      return;
    }

    if (view.selectedBond !== null && molecule.bonds[view.selectedBond]) {
      var b2 = molecule.bonds[view.selectedBond];
      var s1 = molecule.atoms[b2.from].element, s2 = molecule.atoms[b2.to].element;
      var word = BOND_WORD[b2.order];
      var length = FMT ? FMT.distance(molecule.atoms[b2.from], molecule.atoms[b2.to]).toFixed(3) + " Å" : "";
      els.atomInfo.innerHTML =
        '<div class="msv-atominfo">' +
          '<span class="msv-atominfo__glyph" aria-hidden="true">' + BOND_GLYPH[b2.order] + "</span>" +
          '<span class="msv-atominfo__meta">' +
            '<span class="msv-atominfo__name">' + word + "</span><br>" +
            '<span class="msv-atominfo__sub">' + escapeHtml(s1) + " " + BOND_GLYPH[b2.order] + " " + escapeHtml(s2) +
            " · shares " + (b2.order * 2) + " electrons" + (length ? " · length " + length : "") + "</span>" +
          "</span>" +
        "</div>";
      announce(word + " between " + s1 + " and " + s2 + " selected.");
      return;
    }

    els.atomInfo.innerHTML =
      '<p class="msv-hintbox">Click or tap an atom to see its element data, or a bond to see its type and length. Turn on <strong>Measure</strong> to read distances, angles and dihedrals.</p>';
  }

  function renderMeasurePanel() {
    var rows = measurements().map(function (m) {
      return "<tr><th scope=\"row\">" + m.kind + "</th><td>" + escapeHtml(m.label) + "</td><td>" + m.value + "</td></tr>";
    }).join("");
    var chips = view.picks.map(function (i, k) {
      return '<span class="msv-pick" style="--pc:' + PICK_COLOURS[k] + '">' + (k + 1) + " · " + escapeHtml(atomLabel(i)) + "</span>";
    }).join("");
    els.atomInfo.innerHTML =
      '<p class="msv-hintbox"><strong>Measure mode.</strong> Pick 2 atoms for a distance, 3 for an angle, 4 for a dihedral. Click the last atom again to undo it.</p>' +
      (chips ? '<div class="msv-picks">' + chips + "</div>" : "") +
      (rows ? '<table class="msv-measure"><tbody>' + rows + "</tbody></table>" : "") +
      '<div class="msv-measure__actions">' +
        (view.picks.length ? '<button type="button" class="msv-btn msv-btn--sm" data-action="clear-picks">Clear</button>' : "") +
        '<button type="button" class="msv-btn msv-btn--sm msv-btn--ghost" data-action="exit-measure">Done</button>' +
      "</div>";
  }

  function renderLegend() {
    if (!els.legend) return;
    var counts = {}, order = [];
    molecule.atoms.forEach(function (a) {
      if (!counts[a.element]) { counts[a.element] = 0; order.push(a.element); }
      counts[a.element]++;
    });
    var masses = {}, total = 0;
    order.forEach(function (sym) {
      var el = window.ChemData ? window.ChemData.bySymbol(sym) : null;
      masses[sym] = el && typeof el.mass === "number" ? el.mass * counts[sym] : 0;
      total += masses[sym];
    });
    order.sort(function (a, b) { return masses[b] - masses[a]; });
    var bar = total ? '<div class="msv-compo" role="img" aria-label="Mass composition: ' +
      order.map(function (s) { return s + " " + (masses[s] / total * 100).toFixed(1) + "%"; }).join(", ") + '">' +
      order.map(function (s) {
        return '<span style="flex:' + masses[s].toFixed(4) + ";background:" + MD.styleFor(s).color + '"></span>';
      }).join("") + "</div>" : "";
    els.legend.innerHTML = bar + '<ul class="msv-legend__list">' + order.map(function (sym) {
      var s = MD.styleFor(sym);
      var el = window.ChemData ? window.ChemData.bySymbol(sym) : null;
      return '<li><i style="--sw:' + s.color + '"></i><span class="msv-legend__name">' + escapeHtml(sym) + " · " + escapeHtml(el ? el.name : s.name) + "</span>" +
        '<span class="msv-legend__count">×' + counts[sym] + "</span>" +
        '<span class="msv-legend__pct">' + (total ? (masses[sym] / total * 100).toFixed(1) + "%" : "") + "</span></li>";
    }).join("") + "</ul>" +
    (total ? '<p class="msv-legend__foot">Share of molar mass · CPK colours</p>' : "");
  }

  function updateAccessibleDescription() {
    if (!els.a11y) return;
    var counts = {};
    molecule.atoms.forEach(function (a) { counts[a.element] = (counts[a.element] || 0) + 1; });
    var parts = Object.keys(counts).map(function (k) {
      var el = window.ChemData ? window.ChemData.bySymbol(k) : null;
      var name = el ? el.name.toLowerCase() : k;
      return counts[k] + " " + name + (counts[k] === 1 ? " atom" : " atoms");
    });
    var shape = info.geometry ? "a " + info.geometry.toLowerCase() + " molecule" : "a molecule";
    els.a11y.textContent =
      "Currently displaying " + molecule.name + " (" + molecule.formula + "), " + shape + " containing " + parts.join(", ") +
      ", joined by " + molecule.bonds.length + " bond" + (molecule.bonds.length === 1 ? "" : "s") + ".";
  }

  function announce(msg) {
    if (els.live) els.live.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ==========================================================================
     LIBRARY: filters, search, list
     ========================================================================== */

  function allGroups() {
    return [{ id: "all", label: "All" }].concat(MD.groups, [{ id: "mine", label: "My molecules" }]);
  }

  function pool(group) {
    var custom = MD.custom();
    if (group === "mine") return custom;
    var built = MD.molecules;
    if (group !== "all") built = built.filter(function (m) { return m.group === group; });
    return group === "all" ? custom.concat(built) : built;
  }

  function buildFilters() {
    if (!els.filters) return;
    els.filters.innerHTML = allGroups().map(function (g) {
      return '<button type="button" data-group="' + g.id + '" aria-pressed="' + (ui.group === g.id) + '">' +
        escapeHtml(g.label) + ' <span class="msv-chip__n">' + pool(g.id).length + "</span></button>";
    }).join("");
  }

  function setGroup(group) {
    ui.group = group;
    buildFilters();
    renderMoleculeList();
    if (els.list) els.list.scrollTop = 0;
  }

  /** "CH4" matches molecules with exactly one C and four H, whatever else
      they contain — so methane, methanol and urea, but not ethane. */
  function formulaMatches(query, formula) {
    if (!/^([A-Z][a-z]?\d*)+$/.test(query) || !/\d|[A-Z].*[A-Z]/.test(query)) return false;
    var want = {}, have = {};
    MD.formulaParts(query).forEach(function (p) { want[p[0]] = (want[p[0]] || 0) + (p[1] ? +p[1] : 1); });
    MD.formulaParts(formula).forEach(function (p) { have[p[0]] = (have[p[0]] || 0) + (p[1] ? +p[1] : 1); });
    return Object.keys(want).every(function (k) { return have[k] === want[k]; });
  }

  function score(m, q, raw) {
    var name = m.name.toLowerCase();
    if (name === q || m.formula.toLowerCase() === q) return 100;
    if (name.indexOf(q) === 0) return 80;
    if (formulaMatches(raw, m.formula)) return 70;
    if (name.indexOf(q) > -1 || m.id.indexOf(q) > -1) return 60;
    if (m.cid && String(m.cid) === q) return 60;
    var geometry = (m.geometry || "").toLowerCase();
    if (geometry.indexOf(q) > -1) return 40;
    if ((m.vsepr || "").toLowerCase() === q) return 40;
    if ((m.category || "").toLowerCase().indexOf(q) > -1) return 20;
    return 0;
  }

  function itemHtml(m) {
    var sub = m.geometry || m.category || "";
    var row = '<button type="button" class="msv-item" data-molecule="' + escapeHtml(m.id) + '" aria-current="false">' +
      '<span class="msv-item__f">' + formulaHtml(m.formula) + "</span>" +
      '<span class="msv-item__text"><span class="msv-item__n">' + escapeHtml(m.name) + "</span>" +
      '<span class="msv-item__g">' + escapeHtml(sub) + "</span></span>" +
      '<span class="msv-item__check" aria-hidden="true">●</span>' +
      "</button>";
    if (m.group !== "mine") return row;
    return '<div class="msv-row">' + row +
      '<button type="button" class="msv-row__del" data-remove="' + escapeHtml(m.id) + '" aria-label="Remove ' + escapeHtml(m.name) + ' from My molecules" title="Remove">×</button></div>';
  }

  function renderMoleculeList() {
    var raw = ui.query.trim();
    var q = raw.toLowerCase();
    var html = "";
    var count;

    if (q) {
      var hits = pool("all")
        .map(function (m) { return { m: m, s: score(m, q, raw) }; })
        .filter(function (o) { return o.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.m.name.localeCompare(b.m.name); });
      count = hits.length;
      html = hits.length
        ? '<p class="msv-list__meta">' + hits.length + " match" + (hits.length === 1 ? "" : "es") + " in all groups</p>" +
          hits.map(function (o) { return itemHtml(o.m); }).join("")
        : '<p class="msv-empty">No molecule matches that search.' + (canFetch() ? " Try PubChem below." : "") + "</p>";
    } else {
      var list = pool(ui.group);
      count = list.length;
      if (!list.length) {
        html = ui.group === "mine"
          ? '<p class="msv-empty">Nothing here yet. Open or paste a molecule file, or search PubChem — whatever you add is kept in this browser only.</p>'
          : '<p class="msv-empty">No molecules in this group.</p>';
      } else if (ui.group === "all") {
        [{ id: "mine", label: "My molecules" }].concat(MD.groups).forEach(function (g) {
          var inGroup = list.filter(function (m) { return m.group === g.id; });
          if (!inGroup.length) return;
          html += '<p class="msv-list__head">' + escapeHtml(g.label) + " <span>" + inGroup.length + "</span></p>" +
            inGroup.map(itemHtml).join("");
        });
      } else {
        var lastCat = null;
        list.forEach(function (m) {
          if (ui.group !== "mine" && m.category !== lastCat) {
            html += '<p class="msv-list__head">' + escapeHtml(m.category) + "</p>";
            lastCat = m.category;
          }
          html += itemHtml(m);
        });
      }
    }

    els.list.innerHTML = html;
    if (els.count) {
      var mine = MD.custom().length;
      els.count.textContent = q ? count + " found" : MD.molecules.length + " built in" + (mine ? " · " + mine + " yours" : "");
    }
    if (els.online) {
      els.online.hidden = !(q && canFetch());
      if (els.pubchemLabel) els.pubchemLabel.textContent = "Search PubChem for “" + (raw.length > 32 ? raw.slice(0, 31) + "…" : raw) + "”";
    }
    markActiveInList();
  }

  function markActiveInList() {
    if (!els.list || !molecule) return;
    Array.prototype.forEach.call(els.list.querySelectorAll("[data-molecule]"), function (b) {
      var on = b.dataset.molecule === molecule.id;
      b.setAttribute("aria-current", on ? "true" : "false");
    });
    if (els.quick) {
      Array.prototype.forEach.call(els.quick.querySelectorAll("[data-molecule]"), function (b) {
        b.setAttribute("aria-pressed", b.dataset.molecule === molecule.id ? "true" : "false");
      });
    }
  }

  /** Scroll the list — never the page — so the active entry is visible. */
  function revealActiveItem() {
    var item = els.list && els.list.querySelector('[aria-current="true"]');
    if (!item || !els.list.getBoundingClientRect) return;
    var lr = els.list.getBoundingClientRect();
    var ir = item.getBoundingClientRect();
    if (!lr.height) return;
    if (ir.top < lr.top || ir.bottom > lr.bottom) {
      els.list.scrollTop += (ir.top - lr.top) - (lr.height - ir.height) / 2;
    }
  }

  /* ==========================================================================
     MY MOLECULES: storage, import, PubChem, export
     ========================================================================== */

  function storageGet() {
    try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || "[]") || []; } catch (e) { return []; }
  }

  var storageWorks = (function () {
    try {
      window.localStorage.setItem(STORE_KEY + "-probe", "1");
      window.localStorage.removeItem(STORE_KEY + "-probe");
      return true;
    } catch (e) {
      return false;
    }
  })();

  function storageSet(records) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(records));
      return true;
    } catch (e) {
      return false;
    }
  }

  function hashCode(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) : (h * 16777619) | 0;
    }
    return (h >>> 0).toString(36);
  }

  var CATEGORY_FOR = { "pubchem-live": "From PubChem", file: "From a file", pasted: "Pasted", shared: "Shared with you" };

  function customFromRecord(rec, parsed) {
    var m = {
      id: rec.id, name: rec.name || "Untitled molecule", group: "mine",
      category: CATEGORY_FOR[rec.source] || "Yours", source: rec.source, cid: rec.cid || null,
      fileName: rec.fileName || null, warnings: rec.warnings || [],
      geometry: null, bondAngle: null, polarity: null, note: null,
      about: "",
      atoms: parsed.atoms, bonds: parsed.bonds, code: rec.code
    };
    m.formula = MD.hillFormula(m.atoms);
    return m;
  }

  function restoreCustom() {
    if (!FMT) return;
    var list = [];
    storageGet().forEach(function (rec) {
      try { list.push(customFromRecord(rec, FMT.decodeMolecule(rec.code))); } catch (e) { /* skip damaged entries */ }
    });
    MD.setCustom(list);
  }

  function persistCustom() {
    var records = MD.custom().map(function (m) {
      return { id: m.id, name: m.name, source: m.source, cid: m.cid, fileName: m.fileName, warnings: m.warnings, code: m.code };
    });
    var ok = storageSet(records);
    while (!ok && records.length) {          // drop the oldest until it fits
      records.pop();
      ok = storageSet(records);
    }
    return ok && records.length === MD.custom().length;
  }

  /** Add a parsed structure to My molecules and show it. */
  function addCustom(parsed, meta) {
    var code = FMT.encodeMolecule({ name: meta.name || parsed.name, atoms: parsed.atoms, bonds: parsed.bonds });
    var id = "my-" + hashCode(code);
    var rec = {
      id: id, name: (meta.name || parsed.name || "Untitled molecule").slice(0, 80), source: meta.source,
      cid: meta.cid || null, fileName: meta.fileName || null, warnings: parsed.warnings || [], code: code
    };
    var m = customFromRecord(rec, parsed);
    var list = MD.custom().filter(function (x) { return x.id !== id; });
    list.unshift(m);
    MD.setCustom(list.slice(0, STORE_MAX));
    var saved = persistCustom();
    if (!saved) {
      m.warnings = m.warnings.concat([storageWorks
        ? "This structure is too large to keep in browser storage, so it will be gone after a reload. Download it as a MOL file to keep it."
        : "This browser is not letting the page save anything, so the molecule will be gone after a reload. Download it as a MOL file to keep it."]);
    }
    buildFilters();
    renderMoleculeList();
    loadMolecule(id);
    revealActiveItem();
    announce(m.name + " added to My molecules.");
    return m;
  }

  function removeCustom(id) {
    var list = MD.custom().filter(function (m) { return m.id !== id; });
    MD.setCustom(list);
    persistCustom();
    buildFilters();
    renderMoleculeList();
    if (molecule && molecule.id === id) loadMolecule(list.length ? list[0].id : MD.molecules[0].id);
    announce("Removed from My molecules.");
  }

  function showImportError(msg) {
    if (!els.importError) return;
    els.importError.textContent = msg || "";
    els.importError.hidden = !msg;
  }

  function importText(text, fileName, source) {
    showImportError("");
    if (!FMT) { showImportError("File import is unavailable because a script did not load. Please refresh."); return null; }
    try {
      var parsed = FMT.parseMolecule(text, fileName);
      var m = addCustom(parsed, { source: source, fileName: source === "file" ? fileName : null, name: parsed.name });
      /* show where it went: the My molecules list, not a stale search */
      ui.query = "";
      if (els.search) els.search.value = "";
      ui.group = "mine";
      buildFilters();
      renderMoleculeList();
      revealActiveItem();
      focusStageOnSmallScreens();
      return m;
    } catch (e) {
      showImportError(e && e.friendly ? e.message : "That file could not be read as a molecule.");
      if (!(e && e.friendly) && window.console) console.error(e);
      return null;
    }
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { showImportError("That file is larger than 5 MB. Use a single-molecule SDF, MOL, XYZ or PDB file."); return; }
    var done = function (text) { importText(text, file.name, "file"); };
    if (file.text) {
      file.text().then(done, function () { showImportError("The file could not be read."); });
    } else {
      var reader = new FileReader();
      reader.onload = function () { done(String(reader.result || "")); };
      reader.onerror = function () { showImportError("The file could not be read."); };
      reader.readAsText(file);
    }
  }

  /* ---- PubChem (only on an explicit click) ---- */
  function canFetch() { return !!(window.fetch && FMT); }

  function looksLikeSmiles(q) {
    if (/\s/.test(q)) return false;
    if (/[=#()[\]@\\/]/.test(q)) return true;
    if (!/^(Cl|Br|[BCNOSPFIcnosp]|\d)+$/.test(q) || q.length < 3 || !/[Cc]/.test(q)) return false;
    var digits = q.replace(/\D/g, "").split("");
    var tally = {};
    digits.forEach(function (d) { tally[d] = (tally[d] || 0) + 1; });
    return Object.keys(tally).every(function (d) { return tally[d] % 2 === 0; });
  }

  function fetchTimeout(url, opts, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    opts = opts || {};
    if (ctrl) opts.signal = ctrl.signal;
    return window.fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function pubchemError(kind, detail) {
    var e = new Error(detail || kind);
    e.kind = kind;
    return e;
  }

  function lookupCid(q, bySmiles) {
    var req = bySmiles
      ? fetchTimeout(PUBCHEM + "/compound/smiles/cids/JSON", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "smiles=" + encodeURIComponent(q)
        }, 15000)
      : fetchTimeout(PUBCHEM + "/compound/name/" + encodeURIComponent(q) + "/cids/JSON", {}, 15000);
    return req.then(function (res) {
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw pubchemError("server", "PubChem answered " + res.status);
      return res.json().then(function (j) {
        var list = j && j.IdentifierList && j.IdentifierList.CID;
        return list && list[0] ? list[0] : null;
      });
    });
  }

  function resolveCid(q) {
    if (/^\d{1,10}$/.test(q)) return Promise.resolve(+q);
    var smilesFirst = looksLikeSmiles(q);
    return lookupCid(q, smilesFirst).then(function (cid) {
      if (cid || /\s/.test(q)) return cid;
      return lookupCid(q, !smilesFirst).catch(function () { return null; });
    });
  }

  function setPubchemStatus(msg, tone) {
    if (!els.pubchemStatus) return;
    els.pubchemStatus.textContent = msg;
    els.pubchemStatus.setAttribute("data-tone", tone || "");
  }

  function searchPubChem() {
    var q = ui.query.trim();
    if (!q || ui.busy || !canFetch()) return;
    if (q.length > 300) { setPubchemStatus("That search is too long.", "error"); return; }
    ui.busy = true;
    if (els.pubchem) els.pubchem.disabled = true;
    setPubchemStatus("Searching PubChem for “" + q + "”…", "busy");

    resolveCid(q).then(function (cid) {
      if (!cid) throw pubchemError("notfound");
      var inLibrary = MD.molecules.filter(function (m) { return m.cid === cid; })[0];
      if (inLibrary) return { local: inLibrary };
      var saved = MD.custom().filter(function (m) { return m.cid === cid; })[0];
      if (saved) return { local: saved };
      return fetchTimeout(PUBCHEM + "/compound/cid/" + cid + "/SDF?record_type=3d", {}, 20000).then(function (res) {
        if (res.status === 404) throw pubchemError("no3d", String(cid));
        if (!res.ok) throw pubchemError("server", "PubChem answered " + res.status);
        return res.text();
      }).then(function (sdf) {
        return fetchTimeout(PUBCHEM + "/compound/cid/" + cid + "/property/Title/JSON", {}, 10000)
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (j) {
            var title = j && j.PropertyTable && j.PropertyTable.Properties && j.PropertyTable.Properties[0].Title;
            return { sdf: sdf, cid: cid, title: title || q };
          });
      });
    }).then(function (res) {
      if (res.local) {
        loadMolecule(res.local.id);
        revealActiveItem();
        focusStageOnSmallScreens();
        setPubchemStatus(res.local.name + " is already here, so nothing new was downloaded.", "ok");
        return;
      }
      var parsed = FMT.parseMolecule(res.sdf, "pubchem.sdf");
      addCustom(parsed, { source: "pubchem-live", cid: res.cid, name: res.title });
      focusStageOnSmallScreens();
      setPubchemStatus("Added " + res.title + " (CID " + res.cid + ") to My molecules.", "ok");
    }).catch(function (err) {
      var msg;
      if (err && err.kind === "notfound") msg = "PubChem has no compound called “" + q + "”. Check the spelling, or try its CID or SMILES.";
      else if (err && err.kind === "no3d") msg = "PubChem has no 3D model for CID " + err.message + ". Very large molecules, salts, mixtures and metal complexes usually have none.";
      else if (err && err.friendly) msg = err.message;
      else if (err && err.name === "AbortError") msg = "PubChem took too long to answer. Please try again.";
      else if (err && err.kind === "server") msg = "PubChem is not answering properly right now (" + err.message + "). Please try again later.";
      else msg = "Could not reach PubChem. Check your connection and try again.";
      setPubchemStatus(msg, "error");
    }).then(function () {
      ui.busy = false;
      if (els.pubchem) els.pubchem.disabled = false;
    });
  }

  /* ---- export ---- */
  function slug(s) {
    return String(s || "molecule").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "molecule";
  }

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportPng() {
    var off = document.createElement("canvas");
    off.width = cv.width;
    off.height = cv.height;
    var o = off.getContext("2d");
    if (!o || !off.toBlob) { announce("Image export is not supported in this browser."); return; }
    var g = o.createRadialGradient(off.width / 2, 0, 0, off.width / 2, 0, Math.max(off.width, off.height));
    g.addColorStop(0, "#0d1524");
    g.addColorStop(1, "#070b14");
    o.fillStyle = g;
    o.fillRect(0, 0, off.width, off.height);
    o.drawImage(cv, 0, 0);
    o.scale(dpr, dpr);
    o.fillStyle = "#e7f2f3";
    o.font = "700 18px system-ui, -apple-system, Segoe UI, sans-serif";
    o.textBaseline = "top";
    o.fillText(molecule.name + "  ·  " + molecule.formula, 14, 12);
    o.fillStyle = "rgba(139, 163, 168, .9)";
    o.font = "600 11px system-ui, -apple-system, Segoe UI, sans-serif";
    o.textAlign = "right";
    o.textBaseline = "bottom";
    o.fillText("tooladda.online · 3D Molecular Structure Viewer", cssW - 12, cssH - 10);
    off.toBlob(function (blob) {
      if (blob) download(slug(molecule.name) + ".png", blob);
    }, "image/png");
    announce("Image downloaded.");
  }

  function exportText(kind) {
    if (!FMT) return;
    try {
      var data = { name: molecule.name, atoms: molecule.atoms, bonds: molecule.bonds };
      var text = kind === "xyz" ? FMT.toXYZ(data) : FMT.toMolfile(data);
      download(slug(molecule.name) + "." + kind, new Blob([text], { type: kind === "xyz" ? "chemical/x-xyz" : "chemical/x-mdl-molfile" }));
      announce((kind === "xyz" ? "XYZ" : "MOL") + " file downloaded.");
    } catch (e) {
      announce(e.message);
    }
  }

  function shareUrl() {
    var base = location.origin + location.pathname;
    if (molecule.group !== "mine") return base + "?molecule=" + encodeURIComponent(molecule.id);
    var code = MD.byId(molecule.id) && MD.byId(molecule.id).code;
    if (!code || code.length > MAX_LINK_CHARS) return null;
    return base + "#m=" + code;
  }

  function copyLink() {
    var url = shareUrl();
    if (!url) {
      announce("This molecule is too large to share as a link. Download the MOL file and send that instead.");
      flashMenu("Too large for a link — download the MOL file instead.");
      return;
    }
    var ok = function () { flashMenu("Link copied."); announce("Link copied to the clipboard."); };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand("copy"); } catch (e) { done = false; }
      document.body.removeChild(ta);
      if (done) ok();
      else { flashMenu("Copy failed — the link is in the address bar."); history.replaceState(null, "", url); }
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(ok, fallback);
    else fallback();
  }

  function flashMenu(msg) {
    if (!els.menu) return;
    var panel = els.menu.querySelector(".msv-menu__panel");
    var note = panel.querySelector(".msv-menu__note");
    if (!note) {
      note = document.createElement("p");
      note.className = "msv-menu__note";
      note.setAttribute("role", "status");
      panel.appendChild(note);
    }
    note.textContent = msg;
    clearTimeout(flashMenu.timer);
    flashMenu.timer = setTimeout(function () { note.textContent = ""; }, 3000);
  }

  function handleExport(kind) {
    if (kind === "png") exportPng();
    else if (kind === "xyz" || kind === "mol") exportText(kind);
    else if (kind === "link") { copyLink(); return; }
    if (els.menu) els.menu.open = false;
  }

  /* ==========================================================================
     DEEP LINKS
     ========================================================================== */

  function moleculeFromUrl() {
    var m = /[?&]molecule=([^&#]+)/.exec(location.search);
    if (!m) return null;
    return MD.byId(decodeURIComponent(m[1]).toLowerCase());
  }

  function moleculeFromHash() {
    var m = /^#m=([A-Za-z0-9_-]+)$/.exec(location.hash || "");
    if (!m || !FMT) return null;
    try {
      var parsed = FMT.decodeMolecule(m[1]);
      var id = "my-" + hashCode(m[1]);
      if (MD.byId(id)) return MD.byId(id);
      var code = FMT.encodeMolecule(parsed);
      var existing = MD.byId("my-" + hashCode(code));
      if (existing) return existing;
      var rec = { id: "my-" + hashCode(code), name: parsed.name, source: "shared", warnings: [], code: code };
      var list = MD.custom().slice();
      list.unshift(customFromRecord(rec, parsed));
      MD.setCustom(list.slice(0, STORE_MAX));
      persistCustom();
      buildFilters();
      renderMoleculeList();
      return MD.byId(rec.id);
    } catch (e) {
      showImportError(e.friendly ? e.message : "The shared molecule link could not be opened.");
      return null;
    }
  }

  function updateUrl() {
    if (!window.history || !history.replaceState || !molecule) return;
    if (molecule.group === "mine") history.replaceState(null, "", location.pathname);
    else history.replaceState(null, "", location.pathname + "?molecule=" + molecule.id);
  }

  /* ==========================================================================
     LAYOUT HELPERS
     ========================================================================== */

  var narrowQuery = null;

  function isNarrow() { return !!(narrowQuery && narrowQuery.matches); }

  function setupTabs() {
    if (!els.app) return;
    var tabs = els.app.querySelectorAll(".msv-tabs [data-tab]");
    var apply = function () {
      var narrow = isNarrow();
      [[els.lib, "msv-tab-library"], [els.inspect, "msv-tab-details"]].forEach(function (pair) {
        if (!pair[0]) return;
        if (narrow) {
          pair[0].setAttribute("role", "tabpanel");
          pair[0].setAttribute("aria-labelledby", pair[1]);
        } else {
          pair[0].removeAttribute("role");
          pair[0].removeAttribute("aria-labelledby");
        }
      });
    };
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener("click", function () { setTab(t.dataset.tab); });
      t.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        var next = t.dataset.tab === "library" ? "details" : "library";
        setTab(next);
        els.app.querySelector('.msv-tabs [data-tab="' + next + '"]').focus();
      });
    });
    if (window.matchMedia) {
      narrowQuery = window.matchMedia("(max-width: 760px)");
      if (narrowQuery.addEventListener) narrowQuery.addEventListener("change", apply);
      else if (narrowQuery.addListener) narrowQuery.addListener(apply);
    }
    apply();
    setTab(els.app.getAttribute("data-tab") || "library");
  }

  function setTab(name) {
    els.app.setAttribute("data-tab", name);
    Array.prototype.forEach.call(els.app.querySelectorAll(".msv-tabs [data-tab]"), function (t) {
      var on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
  }

  /** On a phone the list sits below the stage; after a choice, bring the
      model back into view. */
  function focusStageOnSmallScreens() {
    if (!isNarrow() || !els.stage || !els.stage.getBoundingClientRect) return;
    var r = els.stage.getBoundingClientRect();
    if (r.top >= 60 && r.top < window.innerHeight * 0.5) return;
    window.scrollTo({ top: window.pageYOffset + r.top - 76, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function setupCapabilities() {
    var fsBtn = els.fullscreen;
    if (fsBtn && document.fullscreenEnabled && els.stage && els.stage.requestFullscreen) {
      fsBtn.hidden = false;
      document.addEventListener("fullscreenchange", function () {
        var on = document.fullscreenElement === els.stage;
        fsBtn.setAttribute("aria-pressed", String(on));
        fsBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
        resizeCanvas();
      });
    }
    if (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches && els.stageHint) {
      els.stageHint.textContent = "Drag to rotate · Pinch to zoom · Two fingers to pan";
    }
    if (!FMT) {
      ["open-file", "paste-toggle"].forEach(function (k) {
        var n = document.getElementById("msv-" + k);
        if (n) n.disabled = true;
      });
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenEnabled || !els.stage.requestFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else els.stage.requestFullscreen().catch(function () { announce("Full screen is not available."); });
  }

  /* ==========================================================================
     EVENTS
     ========================================================================== */

  function bindEvents() {
    cv.addEventListener("pointerdown", handlePointerDown);
    cv.addEventListener("pointermove", handlePointerMove);
    cv.addEventListener("pointerup", handlePointerUp);
    cv.addEventListener("pointercancel", handlePointerUp);
    cv.addEventListener("wheel", handleWheel, { passive: false });
    cv.addEventListener("dblclick", function () { resetView(); });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    cv.addEventListener("touchstart", handleTouchStart, { passive: true });
    cv.addEventListener("touchmove", handleTouchMove, { passive: false });
    cv.addEventListener("touchend", handleTouchEnd);

    cv.addEventListener("keydown", handleCanvasKeys);

    // toolbar
    on("msv-reset", function () { resetView(); });
    on("msv-auto", toggleAutoRotate);
    on("msv-labels", toggleLabels);
    on("msv-hydrogens", toggleHydrogens);
    on("msv-measure", toggleMeasure);
    on("msv-fullscreen", toggleFullscreen);
    on("msv-zoom-in", function () { setZoom(view.zoom * 1.2); });
    on("msv-zoom-out", function () { setZoom(view.zoom / 1.2); });
    on("msv-rot-left", function () { view.rotY -= 0.26; requestFrame(); });
    on("msv-rot-right", function () { view.rotY += 0.26; requestFrame(); });

    if (els.style) els.style.addEventListener("change", function () { setStyle(this.value); });
    if (els.speed) els.speed.addEventListener("change", function () { view.speed = this.value; });
    if (els.menu) {
      els.menu.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-export]");
        if (btn) handleExport(btn.dataset.export);
      });
      document.addEventListener("click", function (e) {
        if (els.menu.open && !els.menu.contains(e.target)) els.menu.open = false;
      });
      els.menu.addEventListener("toggle", function () {
        if (!els.menu.open) return;
        var s = els.menu.getBoundingClientRect();
        var st = els.stage.getBoundingClientRect();
        els.menu.classList.toggle("msv-menu--left", s.right - st.left < 260);
      });
      els.menu.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && els.menu.open) {
          els.menu.open = false;
          els.menu.querySelector("summary").focus();
        }
      });
    }

    // library
    if (els.search) {
      els.search.addEventListener("input", function () {
        ui.query = this.value;
        setPubchemStatus("", "");
        renderMoleculeList();
      });
      els.search.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          var first = els.list.querySelector("[data-molecule]");
          if (first) { e.preventDefault(); chooseFromList(first.dataset.molecule); }
          else if (!els.online.hidden) { e.preventDefault(); searchPubChem(); }
        }
      });
    }
    if (els.filters) {
      els.filters.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-group]");
        if (!btn) return;
        if (ui.query) {
          ui.query = "";
          els.search.value = "";
        }
        setGroup(btn.dataset.group);
      });
    }
    els.list.addEventListener("click", function (e) {
      var del = e.target.closest("[data-remove]");
      if (del) { removeCustom(del.dataset.remove); return; }
      var btn = e.target.closest("[data-molecule]");
      if (btn) chooseFromList(btn.dataset.molecule);
    });
    if (els.quick) {
      els.quick.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-molecule]");
        if (btn) { loadMolecule(btn.dataset.molecule); revealActiveItem(); }
      });
    }
    if (els.pubchem) els.pubchem.addEventListener("click", searchPubChem);

    // import
    if (els.openFile && els.file) {
      els.openFile.addEventListener("click", function () { els.file.click(); });
      els.file.addEventListener("change", function () {
        readFile(els.file.files && els.file.files[0]);
        els.file.value = "";
      });
    }
    if (els.pasteToggle && els.paste) {
      els.pasteToggle.addEventListener("click", function () {
        var open = els.paste.hidden;
        els.paste.hidden = !open;
        els.pasteToggle.setAttribute("aria-expanded", String(open));
        if (open && els.pasteText) els.pasteText.focus();
      });
    }
    if (els.pasteLoad && els.pasteText) {
      els.pasteLoad.addEventListener("click", function () {
        var m = importText(els.pasteText.value, "", "pasted");
        if (m) {
          els.pasteText.value = "";
          els.paste.hidden = true;
          els.pasteToggle.setAttribute("aria-expanded", "false");
        }
      });
    }
    if (els.about) {
      els.about.addEventListener("click", function (e) {
        var del = e.target.closest("[data-remove]");
        if (del) removeCustom(del.dataset.remove);
      });
    }
    els.atomInfo.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "clear-picks") clearSelection();
      if (btn.dataset.action === "exit-measure") toggleMeasure();
    });
    bindDrop(els.stage);
    bindDrop(els.lib);

    if (window.ResizeObserver) {
      new ResizeObserver(resizeCanvas).observe(cv);
    } else {
      window.addEventListener("resize", resizeCanvas);
    }
  }

  function chooseFromList(id) {
    loadMolecule(id);
    focusStageOnSmallScreens();
  }

  function bindDrop(zone) {
    if (!zone || !els.drop) return;
    var depth = 0;
    var hasFiles = function (e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      return !!t && Array.prototype.indexOf.call(t, "Files") > -1;
    };
    zone.addEventListener("dragenter", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      els.drop.hidden = false;
    });
    zone.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    zone.addEventListener("dragleave", function () {
      depth = Math.max(0, depth - 1);
      if (!depth) els.drop.hidden = true;
    });
    zone.addEventListener("drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      els.drop.hidden = true;
      readFile(e.dataTransfer.files[0]);
    });
  }

  function on(id, fn) {
    var n = document.getElementById(id);
    if (n) n.addEventListener("click", fn);
  }

  /** Keys are handled on the canvas only, so typing in the search box is
      never hijacked. */
  function handleCanvasKeys(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var step = 0.16;
    switch (e.key) {
      case "ArrowLeft": view.rotY -= step; break;
      case "ArrowRight": view.rotY += step; break;
      case "ArrowUp": view.rotX -= step; break;
      case "ArrowDown": view.rotX += step; break;
      case "+": case "=": setZoom(view.zoom * 1.15); e.preventDefault(); return;
      case "-": case "_": setZoom(view.zoom / 1.15); e.preventDefault(); return;
      case "r": case "R": resetView(); e.preventDefault(); return;
      case "a": case "A": toggleAutoRotate(); e.preventDefault(); return;
      case "l": case "L": toggleLabels(); e.preventDefault(); return;
      case "h": case "H": toggleHydrogens(); e.preventDefault(); return;
      case "m": case "M": toggleMeasure(); e.preventDefault(); return;
      case "f": case "F": toggleFullscreen(); e.preventDefault(); return;
      case "Escape":
        if (view.selectedAtom !== null || view.selectedBond !== null || view.picks.length) { clearSelection(); e.preventDefault(); }
        return;
      default: return;
    }
    view.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.rotX));
    e.preventDefault();
    pauseAutoRotate();
    requestFrame();
  }

  /* ---- expose a tiny surface for the test suite ---- */
  window.MolecularViewer = {
    load: loadMolecule,
    getView: function () { return view; },
    getProjected: function () { return projected; },
    getMolecule: function () { return molecule; },
    getInfo: function () { return info; },
    defaultMolecule: DEFAULT_MOLECULE,
    pickAt: handlePick,
    reset: resetView,
    setZoom: setZoom,
    setStyle: setStyle,
    toggleAutoRotate: toggleAutoRotate,
    toggleLabels: toggleLabels,
    toggleHydrogens: toggleHydrogens,
    toggleMeasure: toggleMeasure,
    measurements: measurements,
    importText: importText,
    removeCustom: removeCustom,
    shareUrl: function () { return molecule ? shareUrl() : null; },
    rotatePoint: rotatePoint,
    project3D: project3D
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeViewer);
  } else {
    initializeViewer();
  }
})();
