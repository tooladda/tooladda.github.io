/* ============================================================================
   ToolAdda — molecule file formats and geometry helpers
   Used by the 3D Molecular Structure Viewer. No DOM access, so the whole file
   runs under node for the test suite (scripts/molecule-formats.test.js).

   Reads   MOL / SDF (V2000 and V3000), XYZ, PDB
   Writes  XYZ, MOL (V2000)
   Also    bond perception from covalent radii, VSEPR classification of a
           single-centre molecule, ring count, distance / angle / dihedral,
           and a compact text encoding for share links.

   A parsed molecule is { name, atoms: [{element, x, y, z, charge}],
   bonds: [{from, to, order}], warnings: [] } in angstroms.
   ============================================================================ */

(function (global) {
  "use strict";

  var MAX_ATOMS = 2000;

  /* Group valence electrons for main-group central atoms (VSEPR). */
  var VALENCE = {
    H: 1, Li: 1, Na: 1, K: 1, Be: 2, Mg: 2, Ca: 2, B: 3, Al: 3, Ga: 3,
    C: 4, Si: 4, Ge: 4, Sn: 4, Pb: 4, N: 5, P: 5, As: 5, Sb: 5, Bi: 5,
    O: 6, S: 6, Se: 6, Te: 6, F: 7, Cl: 7, Br: 7, I: 7,
    He: 2, Ne: 8, Ar: 8, Kr: 8, Xe: 8, Rn: 8
  };

  var VSEPR_SHAPES = {
    AX2: "Linear", AX2E: "Bent", AX2E2: "Bent", AX2E3: "Linear",
    AX3: "Trigonal planar", AX3E: "Trigonal pyramidal", AX3E2: "T-shaped",
    AX4: "Tetrahedral", AX4E: "Seesaw", AX4E2: "Square planar",
    AX5: "Trigonal bipyramidal", AX5E: "Square pyramidal",
    AX6: "Octahedral", AX7: "Pentagonal bipyramidal"
  };

  function data() { return global.MoleculeData || null; }

  function fail(message) {
    var e = new Error(message);
    e.friendly = true;
    return e;
  }

  /** "CL" / "cl" -> "Cl". Returns "" for anything that is not a symbol. */
  function normaliseElement(raw) {
    var s = String(raw || "").replace(/[^A-Za-z]/g, "");
    if (!s) return "";
    s = s.charAt(0).toUpperCase() + s.slice(1, 2).toLowerCase();
    return s;
  }

  function finite(n) { return typeof n === "number" && isFinite(n); }

  /* ---------------------------------------------------------------------------
     Format detection
     --------------------------------------------------------------------------- */
  function detectFormat(text, fileName) {
    var ext = String(fileName || "").toLowerCase().split(".").pop();
    if (ext === "sdf" || ext === "sd" || ext === "mol") return "mol";
    if (ext === "xyz") return "xyz";
    if (ext === "pdb" || ext === "ent") return "pdb";
    if (/^(ATOM  |HETATM)/m.test(text)) return "pdb";
    if (/V[23]000/.test(text) || /^M {2}END/m.test(text)) return "mol";
    if (/^\s*\d+\s*$/m.test(text.split(/\r?\n/)[0] || "")) return "xyz";
    return null;
  }

  function parseMolecule(text, fileName) {
    text = String(text || "").replace(/^\uFEFF/, "");
    if (!text.trim()) throw fail("The file is empty.");
    var format = detectFormat(text, fileName);
    var m;
    if (format === "mol") m = parseMolfile(text);
    else if (format === "xyz") m = parseXYZ(text);
    else if (format === "pdb") m = parsePDB(text);
    else throw fail("Unrecognised format. Use an SDF, MOL, XYZ or PDB file.");
    m.format = format;
    validate(m);
    if (!m.name && fileName) m.name = String(fileName).replace(/\.[^.]+$/, "");
    return m;
  }

  function validate(m) {
    if (!m.atoms.length) throw fail("No atoms were found in the file.");
    if (m.atoms.length > MAX_ATOMS) throw fail("This structure has " + m.atoms.length + " atoms. The viewer handles up to " + MAX_ATOMS + ".");
    m.atoms.forEach(function (a, i) {
      if (!a.element) throw fail("Atom " + (i + 1) + " has no element symbol.");
      if (!finite(a.x) || !finite(a.y) || !finite(a.z)) throw fail("Atom " + (i + 1) + " has invalid coordinates.");
    });
    m.bonds = m.bonds.filter(function (b) {
      return b.from !== b.to && m.atoms[b.from] && m.atoms[b.to];
    });
    if (looksLike2D(m)) {
      m.warnings.push("This looks like a flat 2D drawing rather than a 3D structure, so the shape shown is not the real shape of the molecule.");
    }
  }

  /** A flat file is only suspicious when the molecule cannot be flat. Benzene
      or formaldehyde really are planar, so the test is chemical: an atom with
      four or more neighbours can never have them all in one plane with it.
      A MOL header that says 2D is believed outright. */
  function looksLike2D(m) {
    if (m.dimension === "3D") return false;
    var zs = m.atoms.map(function (a) { return a.z; });
    if (Math.max.apply(null, zs) - Math.min.apply(null, zs) > 1e-3) return false;
    if (m.dimension === "2D") return m.atoms.length > 2;
    var degree = m.atoms.map(function () { return 0; });
    m.bonds.forEach(function (b) { degree[b.from]++; degree[b.to]++; });
    return degree.some(function (d) { return d >= 4; });
  }

  /* ---------------------------------------------------------------------------
     MOL / SDF
     --------------------------------------------------------------------------- */
  function parseMolfile(text) {
    var lines = text.split(/\r?\n/);
    var end = lines.findIndex(function (l) { return /^M {2}END/.test(l) || l.trim() === "$$$$"; });
    if (end > -1) lines = lines.slice(0, end + 1);
    if (lines.length < 4) throw fail("The MOL file is too short.");
    var name = lines[0].trim();
    var dimension = (lines[1] || "").slice(20, 22).toUpperCase();
    var counts = lines[3] || "";
    if (/V3000/.test(counts)) {
      var v3 = parseV3000(lines, name);
      v3.dimension = dimension;
      return v3;
    }

    var nAtoms = parseInt(counts.slice(0, 3), 10);
    var nBonds = parseInt(counts.slice(3, 6), 10);
    if (!(nAtoms >= 0) || !(nBonds >= 0)) throw fail("The MOL counts line could not be read.");
    if (lines.length < 4 + nAtoms + nBonds) throw fail("The MOL file ends before all atoms and bonds are listed.");

    var atoms = [], bonds = [], warnings = [];
    var i;
    for (i = 0; i < nAtoms; i++) {
      var l = lines[4 + i];
      var el = normaliseElement(l.slice(31, 34));
      var chgCode = parseInt(l.slice(36, 39), 10) || 0;
      atoms.push({
        element: el,
        x: parseFloat(l.slice(0, 10)), y: parseFloat(l.slice(10, 20)), z: parseFloat(l.slice(20, 30)),
        charge: chgCode ? 4 - chgCode : 0
      });
    }
    var aromatic = false;
    for (i = 0; i < nBonds; i++) {
      var b = lines[4 + nAtoms + i];
      var type = parseInt(b.slice(6, 9), 10);
      if (type === 4) aromatic = true;
      bonds.push({ from: parseInt(b.slice(0, 3), 10) - 1, to: parseInt(b.slice(3, 6), 10) - 1, order: bondOrderFromType(type) });
    }
    /* property block: M  CHG overrides the atom-line charge field */
    lines.slice(4 + nAtoms + nBonds).forEach(function (l) {
      if (!/^M {2}CHG/.test(l)) return;
      var parts = l.trim().split(/\s+/).slice(3);
      for (var k = 0; k + 1 < parts.length; k += 2) {
        var idx = parseInt(parts[k], 10) - 1;
        if (atoms[idx]) atoms[idx].charge = parseInt(parts[k + 1], 10) || 0;
      }
    });
    if (aromatic) warnings.push("Aromatic bonds in the file are drawn as double bonds.");
    return { name: name, atoms: atoms, bonds: bonds, warnings: warnings, dimension: dimension };
  }

  function bondOrderFromType(type) {
    if (type === 2 || type === 4) return 2;
    if (type === 3) return 3;
    return 1;
  }

  function parseV3000(lines, name) {
    var atoms = [], bonds = [], warnings = [];
    var idMap = {};
    var block = null;
    var joined = [];
    /* V3000 lines ending in "-" continue on the next line */
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!/^M {2}V30 /.test(l)) continue;
      var body = l.slice(7);
      while (/-\s*$/.test(body) && i + 1 < lines.length) {
        body = body.replace(/-\s*$/, "") + lines[++i].slice(7);
      }
      joined.push(body.trim());
    }
    var aromatic = false;
    joined.forEach(function (l) {
      if (/^BEGIN ATOM/.test(l)) { block = "atom"; return; }
      if (/^BEGIN BOND/.test(l)) { block = "bond"; return; }
      if (/^END /.test(l)) { block = null; return; }
      var p = l.split(/\s+/);
      if (block === "atom") {
        var chg = /CHG=(-?\d+)/.exec(l);
        idMap[p[0]] = atoms.length;
        atoms.push({ element: normaliseElement(p[1]), x: parseFloat(p[2]), y: parseFloat(p[3]), z: parseFloat(p[4]), charge: chg ? parseInt(chg[1], 10) : 0 });
      } else if (block === "bond") {
        var type = parseInt(p[1], 10);
        if (type === 4) aromatic = true;
        bonds.push({ from: idMap[p[2]], to: idMap[p[3]], order: bondOrderFromType(type) });
      }
    });
    if (aromatic) warnings.push("Aromatic bonds in the file are drawn as double bonds.");
    return { name: name, atoms: atoms, bonds: bonds, warnings: warnings };
  }

  /* ---------------------------------------------------------------------------
     XYZ
     --------------------------------------------------------------------------- */
  function parseXYZ(text) {
    var lines = text.split(/\r?\n/);
    var n = parseInt(lines[0], 10);
    if (!(n > 0)) throw fail("The first line of an XYZ file must be the atom count.");
    if (lines.length < n + 2) throw fail("The XYZ file lists " + n + " atoms but has fewer lines than that.");
    var atoms = [];
    for (var i = 0; i < n; i++) {
      var p = lines[2 + i].trim().split(/\s+/);
      var sym = /^\d+$/.test(p[0]) && global.ChemData ? (global.ChemData.byNumber(+p[0]) || {}).symbol : p[0];
      atoms.push({ element: normaliseElement(sym), x: parseFloat(p[1]), y: parseFloat(p[2]), z: parseFloat(p[3]), charge: 0 });
    }
    var m = { name: lines[1].trim(), atoms: atoms, bonds: [], warnings: [], dimension: "3D" };
    m.bonds = perceiveBonds(atoms);
    m.warnings.push("XYZ files carry no bonds, so bonds were worked out from atom distances and drawn as single bonds.");
    return m;
  }

  /* ---------------------------------------------------------------------------
     PDB
     --------------------------------------------------------------------------- */
  function parsePDB(text) {
    var atoms = [], serialMap = {}, bonds = [], warnings = [], name = "";
    var seenBond = {};
    var lines = text.split(/\r?\n/);
    var modelsSeen = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var rec = l.slice(0, 6);
      if (rec === "MODEL ") { modelsSeen++; if (modelsSeen > 1) break; continue; }
      if (rec === "ENDMDL") break;
      if (!name && (rec === "COMPND" || rec === "HEADER")) name = l.slice(10).trim().replace(/^MOLECULE:\s*/, "");
      if (rec === "ATOM  " || rec === "HETATM") {
        var alt = l.charAt(16);
        if (alt !== " " && alt !== "A") continue;
        var el = normaliseElement(l.slice(76, 78));
        if (!el) el = normaliseElement(l.slice(12, 16).trim().replace(/^\d+/, ""));
        serialMap[parseInt(l.slice(6, 11), 10)] = atoms.length;
        atoms.push({ element: el, x: parseFloat(l.slice(30, 38)), y: parseFloat(l.slice(38, 46)), z: parseFloat(l.slice(46, 54)), charge: 0 });
      } else if (rec === "CONECT") {
        var a = serialMap[parseInt(l.slice(6, 11), 10)];
        [11, 16, 21, 26].forEach(function (c) {
          var b = serialMap[parseInt(l.slice(c, c + 5), 10)];
          if (a === undefined || b === undefined) return;
          var key = Math.min(a, b) + "-" + Math.max(a, b);
          if (seenBond[key]) return;   // CONECT lists most bonds from both ends
          seenBond[key] = { from: Math.min(a, b), to: Math.max(a, b), order: 1 };
          bonds.push(seenBond[key]);
        });
      }
    }
    var m = { name: name, atoms: atoms, bonds: bonds, warnings: warnings, dimension: "3D" };
    /* CONECT usually covers only hetero groups; perceive the rest */
    var perceived = perceiveBonds(atoms);
    perceived.forEach(function (b) {
      var key = b.from + "-" + b.to;
      if (!seenBond[key]) { seenBond[key] = b; bonds.push(b); }
    });
    warnings.push("Bonds were worked out from atom distances and drawn as single bonds.");
    return m;
  }

  /* ---------------------------------------------------------------------------
     Bond perception: two atoms are bonded when their distance is below the sum
     of their covalent radii plus a 0.45 Å tolerance. A spatial grid keeps it
     linear in the atom count.
     --------------------------------------------------------------------------- */
  function perceiveBonds(atoms) {
    var md = data();
    var rad = function (el) { return md ? md.covalentRadius(el) : 1.0; };
    var cell = 3.2;
    var grid = {};
    atoms.forEach(function (a, i) {
      var key = Math.floor(a.x / cell) + "," + Math.floor(a.y / cell) + "," + Math.floor(a.z / cell);
      (grid[key] = grid[key] || []).push(i);
    });
    var bonds = [];
    atoms.forEach(function (a, i) {
      var cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell), cz = Math.floor(a.z / cell);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
        var list = grid[(cx + dx) + "," + (cy + dy) + "," + (cz + dz)];
        if (!list) continue;
        for (var k = 0; k < list.length; k++) {
          var j = list[k];
          if (j <= i) continue;
          var b = atoms[j];
          var d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          if (a.element === "H" && b.element === "H" && d > 0.9) continue;
          if (d > 0.4 && d < rad(a.element) + rad(b.element) + 0.45) bonds.push({ from: i, to: j, order: 1 });
        }
      }
    });
    return bonds;
  }

  /* ---------------------------------------------------------------------------
     Writers
     --------------------------------------------------------------------------- */
  function fixed(n, d) { return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function pad(s, w, right) {
    s = String(s);
    while (s.length < w) s = right ? s + " " : " " + s;
    return s;
  }

  function toXYZ(m) {
    return [String(m.atoms.length), m.name || ""].concat(m.atoms.map(function (a) {
      return pad(a.element, 2, true) + " " + pad(fixed(a.x, 5), 11) + " " + pad(fixed(a.y, 5), 11) + " " + pad(fixed(a.z, 5), 11);
    })).join("\n") + "\n";
  }

  function toMolfile(m) {
    if (m.atoms.length > 999 || m.bonds.length > 999) throw fail("MOL V2000 files hold at most 999 atoms and bonds.");
    var out = [
      (m.name || "").slice(0, 80),
      "  ToolAdda" + "0000000000" + "3D",   // cols 21-22 carry the dimension
      "",
      pad(m.atoms.length, 3) + pad(m.bonds.length, 3) + "  0  0  0  0  0  0  0  0999 V2000"
    ];
    var charges = [];
    m.atoms.forEach(function (a, i) {
      out.push(pad(fixed(a.x, 4), 10) + pad(fixed(a.y, 4), 10) + pad(fixed(a.z, 4), 10) + " " +
        pad(a.element, 3, true) + " 0  0  0  0  0  0  0  0  0  0  0  0");
      if (a.charge) charges.push([i + 1, a.charge]);
    });
    m.bonds.forEach(function (b) {
      out.push(pad(b.from + 1, 3) + pad(b.to + 1, 3) + pad(b.order, 3) + "  0  0  0  0");
    });
    for (var k = 0; k < charges.length; k += 8) {
      var chunk = charges.slice(k, k + 8);
      out.push("M  CHG" + pad(chunk.length, 3) + chunk.map(function (c) { return " " + pad(c[0], 3) + " " + pad(c[1], 3); }).join(""));
    }
    out.push("M  END");
    return out.join("\n") + "\n";
  }

  /* ---------------------------------------------------------------------------
     Geometry
     --------------------------------------------------------------------------- */
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

  function angle(a, centre, b) {
    var u = [a.x - centre.x, a.y - centre.y, a.z - centre.z];
    var v = [b.x - centre.x, b.y - centre.y, b.z - centre.z];
    var d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(u[0], u[1], u[2]) * Math.hypot(v[0], v[1], v[2]) || 1);
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }

  /** Signed torsion a-b-c-d in degrees, -180 to 180. */
  function dihedral(a, b, c, d) {
    var b0 = [a.x - b.x, a.y - b.y, a.z - b.z];
    var b1 = [c.x - b.x, c.y - b.y, c.z - b.z];
    var b2 = [d.x - c.x, d.y - c.y, d.z - c.z];
    var n1 = Math.hypot(b1[0], b1[1], b1[2]) || 1;
    b1 = [b1[0] / n1, b1[1] / n1, b1[2] / n1];
    var dot = function (p, q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; };
    var v = [b0[0] - dot(b0, b1) * b1[0], b0[1] - dot(b0, b1) * b1[1], b0[2] - dot(b0, b1) * b1[2]];
    var w = [b2[0] - dot(b2, b1) * b1[0], b2[1] - dot(b2, b1) * b1[1], b2[2] - dot(b2, b1) * b1[2]];
    var x = dot(v, w);
    var cross = [b1[1] * v[2] - b1[2] * v[1], b1[2] * v[0] - b1[0] * v[2], b1[0] * v[1] - b1[1] * v[0]];
    var y = dot(cross, w);
    return Math.atan2(y, x) * 180 / Math.PI;
  }

  /** Independent ring count: bonds - atoms + connected pieces. */
  function ringCount(m) {
    var parent = m.atoms.map(function (_, i) { return i; });
    var find = function (i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    var pieces = m.atoms.length;
    m.bonds.forEach(function (b) {
      var x = find(b.from), y = find(b.to);
      if (x !== y) { parent[x] = y; pieces--; }
    });
    return { rings: m.bonds.length - m.atoms.length + pieces, pieces: pieces };
  }

  /** VSEPR for a molecule with one central atom bonded to every other atom
      and no other bonds. Lone pairs come from the central atom's valence
      electrons minus the electrons it uses in bonds, minus any charge. */
  function classifyVsepr(m) {
    var n = m.atoms.length;
    if (n < 3) return null;
    var degree = m.atoms.map(function () { return 0; });
    var orderSum = m.atoms.map(function () { return 0; });
    m.bonds.forEach(function (b) {
      degree[b.from]++; degree[b.to]++;
      orderSum[b.from] += b.order; orderSum[b.to] += b.order;
    });
    var centre = degree.indexOf(n - 1);
    if (centre < 0 || m.bonds.length !== n - 1) return null;
    var el = m.atoms[centre].element;
    if (!(el in VALENCE)) return null;
    var free = VALENCE[el] - orderSum[centre] - (m.atoms[centre].charge || 0);
    if (free < 0 || free % 2) return null;
    var key = "AX" + (n - 1) + (free ? "E" + (free / 2 > 1 ? free / 2 : "") : "");
    if (!VSEPR_SHAPES[key]) return null;
    var angles = [];
    for (var i = 0; i < n; i++) {
      if (i === centre) continue;
      for (var j = i + 1; j < n; j++) {
        if (j === centre) continue;
        angles.push(angle(m.atoms[i], m.atoms[centre], m.atoms[j]));
      }
    }
    return {
      centre: centre, vsepr: key, geometry: VSEPR_SHAPES[key],
      minAngle: Math.min.apply(null, angles), maxAngle: Math.max.apply(null, angles)
    };
  }

  /* ---------------------------------------------------------------------------
     Share-link encoding: "name|el,x,y,z;...|from,to,order;..." in base64url.
     --------------------------------------------------------------------------- */
  function b64urlEncode(str) {
    var bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(str) : Buffer.from(str, "utf8");
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlDecode(s) {
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return typeof TextDecoder !== "undefined" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("utf8");
  }

  function encodeMolecule(m) {
    var r = function (n) { return String(Math.round(n * 1000) / 1000); };
    var name = String(m.name || "").replace(/[|]/g, " ").slice(0, 80);
    var atoms = m.atoms.map(function (a) {
      return a.element + "," + r(a.x) + "," + r(a.y) + "," + r(a.z) + (a.charge ? "," + a.charge : "");
    }).join(";");
    var bonds = m.bonds.map(function (b) { return b.from + "," + b.to + "," + b.order; }).join(";");
    return b64urlEncode(name + "|" + atoms + "|" + bonds);
  }

  function decodeMolecule(code) {
    var text;
    try { text = b64urlDecode(String(code || "")); } catch (e) { throw fail("The shared molecule link is damaged."); }
    var parts = text.split("|");
    if (parts.length !== 3 || !parts[1]) throw fail("The shared molecule link is damaged.");
    var m = {
      name: parts[0],
      atoms: parts[1].split(";").map(function (s) {
        var p = s.split(",");
        return { element: normaliseElement(p[0]), x: +p[1], y: +p[2], z: +p[3], charge: +(p[4] || 0) };
      }),
      bonds: parts[2] ? parts[2].split(";").map(function (s) {
        var p = s.split(",");
        return { from: +p[0], to: +p[1], order: Math.max(1, Math.min(3, +p[2] || 1)) };
      }) : [],
      warnings: []
    };
    validate(m);
    return m;
  }

  var api = {
    MAX_ATOMS: MAX_ATOMS,
    VSEPR_SHAPES: VSEPR_SHAPES,
    detectFormat: detectFormat,
    parseMolecule: parseMolecule,
    parseMolfile: parseMolfile,
    parseXYZ: parseXYZ,
    parsePDB: parsePDB,
    perceiveBonds: perceiveBonds,
    toXYZ: toXYZ,
    toMolfile: toMolfile,
    distance: distance,
    angle: angle,
    dihedral: dihedral,
    ringCount: ringCount,
    classifyVsepr: classifyVsepr,
    encodeMolecule: encodeMolecule,
    decodeMolecule: decodeMolecule,
    normaliseElement: normaliseElement
  };
  global.MoleculeFormats = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
