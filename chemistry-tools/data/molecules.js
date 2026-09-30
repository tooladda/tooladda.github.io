/* ============================================================================
   ToolAdda — Chemistry Tools
   Molecule dataset for the 3D Molecular Structure Viewer.

   ---------------------------------------------------------------------------
   HOW THE COORDINATES ARE PRODUCED
   ---------------------------------------------------------------------------
   Nothing here is a hand-typed coordinate triple. Every structure is built by
   a small geometry helper from the two numbers chemistry actually publishes:
   the bond length (in angstroms) and the bond angle (in degrees). The x/y/z
   values are derived from those at load time.

   That matters for accuracy. If a coordinate were typed by hand it could
   silently disagree with the bond angle printed next to it in the UI; built
   this way the two cannot drift apart, and the test suite re-measures every
   bond length and angle back out of the finished coordinates to prove it.

   Lengths and angles are experimental gas-phase values from standard
   structural chemistry references, rounded to the precision quoted there.

   Units: angstroms (1 A = 100 pm). The viewer rescales to fit, so absolute
   size never matters — only the ratios between bonds within a molecule.

   ---------------------------------------------------------------------------
   FIELDS
   ---------------------------------------------------------------------------
   id          slug used in the UI and the ?molecule= deep link
   name        common English name
   formula     Hill-notation formula, plain ASCII; the UI subscripts it
   geometry    VSEPR shape of the molecule as a whole
   category    grouping for the selector list
   bondAngle   the characteristic angle in degrees, or null for a diatomic
   polarity    "Polar" | "Nonpolar" — of the whole molecule, not of one bond
   about       one short original paragraph explaining the shape
   atoms       [{ element, x, y, z }]  built by the helpers below
   bonds       [{ from, to, order }]   indices into atoms; order 1 | 2 | 3
   note        optional caveat shown in the UI (resonance, delocalisation…)
   vsepr       AXnEm class of the central atom, where the molecule has one
   group       filter chip in the viewer: basics | shapes | organic | life |
               everyday. The larger organic, life and everyday molecules come
               from data/molecule-library.js (PubChem 3D conformers).
   ============================================================================ */

(function (global) {
  "use strict";

  var D2R = Math.PI / 180;
  var r3 = function (n) { return Math.round(n * 1e6) / 1e6; };
  var atom = function (element, x, y, z) {
    return { element: element, x: r3(x), y: r3(y), z: r3(z) };
  };

  /* ---- geometry builders -------------------------------------------------
     Each returns { atoms, bonds }. The central atom sits at the origin; the
     viewer re-centres on the centroid afterwards anyway. */

  /** A–B, two atoms on the x axis, separated by r. */
  function diatomic(a, b, r, order) {
    return {
      atoms: [atom(a, -r / 2, 0, 0), atom(b, r / 2, 0, 0)],
      bonds: [{ from: 0, to: 1, order: order }]
    };
  }

  /** X–A–X bent (or linear at 180): both outer atoms in the xy plane. */
  function bentAX2(centre, outer, r, angleDeg, order) {
    var half = (angleDeg / 2) * D2R;
    return {
      atoms: [
        atom(centre, 0, 0, 0),
        atom(outer, -r * Math.sin(half), r * Math.cos(half), 0),
        atom(outer, r * Math.sin(half), r * Math.cos(half), 0)
      ],
      bonds: [{ from: 0, to: 1, order: order }, { from: 0, to: 2, order: order }]
    };
  }

  /** Four outer atoms on a regular tetrahedron around the centre. */
  function tetrahedralAX4(centre, outer, r) {
    var k = r / Math.sqrt(3);
    var dirs = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    var atoms = [atom(centre, 0, 0, 0)];
    var bonds = [];
    dirs.forEach(function (d, i) {
      atoms.push(atom(outer, k * d[0], k * d[1], k * d[2]));
      bonds.push({ from: 0, to: i + 1, order: 1 });
    });
    return { atoms: atoms, bonds: bonds };
  }

  /** Three outer atoms in a trigonal pyramid; angleDeg is the X–A–X angle.
      Solving cos(theta) = cos^2(b) - 0.5 sin^2(b) gives the tilt b from the
      C3 axis, so the pyramid reproduces the published bond angle exactly. */
  function pyramidalAX3(centre, outer, r, angleDeg) {
    var cosT = Math.cos(angleDeg * D2R);
    var sin2b = (1 - cosT) / 1.5;          // from 1 - 1.5 sin^2(b) = cos(theta)
    var sinb = Math.sqrt(sin2b);
    var cosb = Math.sqrt(1 - sin2b);
    var atoms = [atom(centre, 0, 0, 0)];
    var bonds = [];
    for (var i = 0; i < 3; i++) {
      var phi = i * 120 * D2R;
      atoms.push(atom(outer, r * sinb * Math.cos(phi), r * sinb * Math.sin(phi), -r * cosb));
      bonds.push({ from: 0, to: i + 1, order: 1 });
    }
    return { atoms: atoms, bonds: bonds };
  }

  /** Ethane-like A2X6: two centres on z, three outer atoms each, staggered. */
  function ethaneLike(centre, outer, rCC, rCH, angleDeg) {
    var half = rCC / 2;
    var tilt = (180 - angleDeg) * D2R;      // angle away from the far centre
    var dz = rCH * Math.cos(tilt);
    var dr = rCH * Math.sin(tilt);
    var atoms = [atom(centre, 0, 0, half), atom(centre, 0, 0, -half)];
    var bonds = [{ from: 0, to: 1, order: 1 }];
    for (var i = 0; i < 3; i++) {
      var p = i * 120 * D2R;
      atoms.push(atom(outer, dr * Math.cos(p), dr * Math.sin(p), half + dz));
      bonds.push({ from: 0, to: atoms.length - 1, order: 1 });
    }
    for (var j = 0; j < 3; j++) {
      var q = (j * 120 + 60) * D2R;         // staggered by 60 degrees
      atoms.push(atom(outer, dr * Math.cos(q), dr * Math.sin(q), -half - dz));
      bonds.push({ from: 1, to: atoms.length - 1, order: 1 });
    }
    return { atoms: atoms, bonds: bonds };
  }

  /** Planar ethene-like A2X4 in the xy plane. */
  function etheneLike(centre, outer, rCC, rCH, angleDeg) {
    var half = rCC / 2;
    var a = angleDeg * D2R;
    var dx = rCH * Math.cos(Math.PI - a);
    var dy = rCH * Math.sin(Math.PI - a);
    var atoms = [atom(centre, -half, 0, 0), atom(centre, half, 0, 0)];
    var bonds = [{ from: 0, to: 1, order: 2 }];
    [[-1, 1], [-1, -1], [1, 1], [1, -1]].forEach(function (s) {
      // s[0] picks the carbon; the outer atom leans further out along that
      // same direction, which is what makes the X–C=C angle come out right
      atoms.push(atom(outer, s[0] * (half + dx), s[1] * dy, 0));
      bonds.push({ from: s[0] < 0 ? 0 : 1, to: atoms.length - 1, order: 1 });
    });
    return { atoms: atoms, bonds: bonds };
  }

  /** Planar regular ring of `n` centres with one outer atom on each vertex.
      Kekule alternating bond orders; the delocalisation caveat is in `note`. */
  function planarRing(centre, outer, n, rRing, rOuter, alternate) {
    var atoms = [], bonds = [];
    for (var i = 0; i < n; i++) {
      var t = (i * 2 * Math.PI) / n;
      atoms.push(atom(centre, rRing * Math.cos(t), rRing * Math.sin(t), 0));
    }
    for (var j = 0; j < n; j++) {
      var far = rRing + rOuter;
      var u = (j * 2 * Math.PI) / n;
      atoms.push(atom(outer, far * Math.cos(u), far * Math.sin(u), 0));
      bonds.push({ from: j, to: n + j, order: 1 });
    }
    for (var k = 0; k < n; k++) {
      bonds.push({ from: k, to: (k + 1) % n, order: alternate && k % 2 === 0 ? 2 : 1 });
    }
    return { atoms: atoms, bonds: bonds };
  }

  /** Linear chain X–A≡A–X (ethyne). */
  function linearChainAX(centre, outer, rCC, rCH, order) {
    var h = rCC / 2;
    return {
      atoms: [
        atom(outer, -(h + rCH), 0, 0), atom(centre, -h, 0, 0),
        atom(centre, h, 0, 0), atom(outer, h + rCH, 0, 0)
      ],
      bonds: [
        { from: 0, to: 1, order: 1 },
        { from: 1, to: 2, order: order },
        { from: 2, to: 3, order: 1 }
      ]
    };
  }

  /** Methanol: tetrahedral CH3 with the O–H rotated anti to one C–H. */
  function methanol(rCO, rCH, rOH, cohDeg) {
    var tetra = 109.4712;
    var tilt = (180 - tetra) * D2R;
    var dx = rCH * Math.cos(Math.PI - tetra * D2R);
    var dr = rCH * Math.sin(Math.PI - tetra * D2R);
    var atoms = [atom("C", 0, 0, 0), atom("O", rCO, 0, 0)];
    var bonds = [{ from: 0, to: 1, order: 1 }];
    for (var i = 0; i < 3; i++) {
      var p = (i * 120 + 180) * D2R;        // 180 puts one C–H anti to O–H
      atoms.push(atom("H", dx, dr * Math.cos(p), dr * Math.sin(p)));
      bonds.push({ from: 0, to: atoms.length - 1, order: 1 });
    }
    var a = (180 - cohDeg) * D2R;
    atoms.push(atom("H", rCO + rOH * Math.cos(a), rOH * Math.sin(a), 0));
    bonds.push({ from: 1, to: atoms.length - 1, order: 1 });
    void tilt;
    return { atoms: atoms, bonds: bonds };
  }

  /** Hydrogen peroxide: the classic skew chain, set by its dihedral angle. */
  function peroxide(rOO, rOH, ooh, dihedral) {
    var half = rOO / 2;
    var a = (180 - ooh) * D2R;
    var dz = rOH * Math.cos(a);
    var dr = rOH * Math.sin(a);
    var d = dihedral * D2R;
    return {
      atoms: [
        atom("O", 0, 0, half), atom("O", 0, 0, -half),
        atom("H", dr, 0, half + dz),
        atom("H", dr * Math.cos(d), dr * Math.sin(d), -half - dz)
      ],
      bonds: [
        { from: 0, to: 1, order: 1 },
        { from: 0, to: 2, order: 1 },
        { from: 1, to: 3, order: 1 }
      ]
    };
  }

  /** X–A–X in the xy plane with its own bond orders and formal charges,
      for ozone's O=O+–O−. */
  function bentOrders(centre, outer, r, angleDeg, orders, charges) {
    var m = bentAX2(centre, outer, r, angleDeg, 1);
    m.bonds[0].order = orders[0];
    m.bonds[1].order = orders[1];
    m.atoms.forEach(function (a, i) { if (charges[i]) a.charge = charges[i]; });
    return m;
  }

  /** Three outer atoms at 120 degrees in the xy plane. */
  function trigonalPlanarAX3(centre, outer, r, order) {
    var atoms = [atom(centre, 0, 0, 0)];
    var bonds = [];
    for (var i = 0; i < 3; i++) {
      var t = (90 + i * 120) * D2R;
      atoms.push(atom(outer, r * Math.cos(t), r * Math.sin(t), 0));
      bonds.push({ from: 0, to: i + 1, order: order });
    }
    return { atoms: atoms, bonds: bonds };
  }

  /** H–C≡N style linear chain of three different atoms on the x axis. */
  function linearABC(a, b, c, rAB, rBC, orderAB, orderBC) {
    return {
      atoms: [atom(a, -rAB, 0, 0), atom(b, 0, 0, 0), atom(c, rBC, 0, 0)],
      bonds: [{ from: 0, to: 1, order: orderAB }, { from: 1, to: 2, order: orderBC }]
    };
  }

  /** Outer atoms along unit directions, each with its own bond length. */
  function starFromDirections(centre, outer, dirs) {
    var atoms = [atom(centre, 0, 0, 0)];
    var bonds = [];
    dirs.forEach(function (d, i) {
      atoms.push(atom(outer, d.r * d.x, d.r * d.y, d.r * d.z));
      bonds.push({ from: 0, to: i + 1, order: 1 });
    });
    return { atoms: atoms, bonds: bonds };
  }

  /** AX5: two axial atoms on z, three equatorial at 120 degrees. */
  function trigonalBipyramidalAX5(centre, outer, rAx, rEq) {
    var dirs = [{ x: 0, y: 0, z: 1, r: rAx }, { x: 0, y: 0, z: -1, r: rAx }];
    for (var i = 0; i < 3; i++) {
      var t = i * 120 * D2R;
      dirs.push({ x: Math.cos(t), y: Math.sin(t), z: 0, r: rEq });
    }
    return starFromDirections(centre, outer, dirs);
  }

  /** AX4E seesaw. The lone pair sits on +x in the equatorial plane; the
      equatorial pair opens to eqDeg and the axial pair bends back to axDeg. */
  function seesawAX4E(centre, outer, rAx, rEq, axDeg, eqDeg) {
    var e = (eqDeg / 2) * D2R;
    var tilt = ((180 - axDeg) / 2) * D2R;
    return starFromDirections(centre, outer, [
      { x: -Math.sin(tilt), y: 0, z: Math.cos(tilt), r: rAx },
      { x: -Math.sin(tilt), y: 0, z: -Math.cos(tilt), r: rAx },
      { x: -Math.cos(e), y: Math.sin(e), z: 0, r: rEq },
      { x: -Math.cos(e), y: -Math.sin(e), z: 0, r: rEq }
    ]);
  }

  /** AX3E2 T-shape: one equatorial atom on −x, two axial atoms leaning
      towards it so that each axial–equatorial angle is angleDeg. */
  function tShapedAX3E2(centre, outer, rAx, rEq, angleDeg) {
    var a = angleDeg * D2R;
    return starFromDirections(centre, outer, [
      { x: -1, y: 0, z: 0, r: rEq },
      { x: -Math.cos(a), y: 0, z: Math.sin(a), r: rAx },
      { x: -Math.cos(a), y: 0, z: -Math.sin(a), r: rAx }
    ]);
  }

  /** AX6 octahedron, or AX4E2 square plane when `planar` drops the z pair. */
  function octahedralAX6(centre, outer, r, planar) {
    var dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    if (!planar) dirs.push([0, 0, 1], [0, 0, -1]);
    return starFromDirections(centre, outer, dirs.map(function (d) {
      return { x: d[0], y: d[1], z: d[2], r: r };
    }));
  }

  /** AX5E square pyramid: apex on +z, four basal atoms at angleDeg from it. */
  function squarePyramidalAX5E(centre, outer, rAx, rBas, angleDeg) {
    var a = angleDeg * D2R;
    var dirs = [{ x: 0, y: 0, z: 1, r: rAx }];
    for (var i = 0; i < 4; i++) {
      var t = i * 90 * D2R;
      dirs.push({ x: Math.sin(a) * Math.cos(t), y: Math.sin(a) * Math.sin(t), z: Math.cos(a), r: rBas });
    }
    return starFromDirections(centre, outer, dirs);
  }

  /** C60 as a truncated icosahedron. Every carbon sits on an icosahedron
      edge at fraction f from one end. The two atoms on the same edge form a
      6-6 bond of length a(1 - 2f); atoms near the same vertex form a pentagon
      whose 5-6 bonds are f·a long, because icosahedron faces are equilateral.
      Solving those two for the measured lengths reproduces both exactly. */
  function fullerene60(r56, r66) {
    var phi = (1 + Math.sqrt(5)) / 2;
    var verts = [];
    [-1, 1].forEach(function (s1) {
      [-phi, phi].forEach(function (s2) {
        verts.push([0, s1, s2], [s1, s2, 0], [s2, 0, s1]);
      });
    });
    var a = r66 + 2 * r56;            // icosahedron edge in angstroms
    var f = r56 / a;
    var scale = a / 2;                // the raw icosahedron has edge 2
    var atoms = [], bonds = [];
    var nearVertex = {};              // vertex index -> [{ atom, other }]
    var edges = [];
    var i, j;
    for (i = 0; i < 12; i++) {
      for (j = i + 1; j < 12; j++) {
        var d = Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2]);
        if (Math.abs(d - 2) < 1e-6) edges.push([i, j]);
      }
    }
    edges.forEach(function (e) {
      var u = verts[e[0]], v = verts[e[1]];
      var at = function (t) {
        return atom("C", scale * (u[0] + t * (v[0] - u[0])), scale * (u[1] + t * (v[1] - u[1])), scale * (u[2] + t * (v[2] - u[2])));
      };
      atoms.push(at(f), at(1 - f));
      var p = atoms.length - 2, q = atoms.length - 1;
      bonds.push({ from: p, to: q, order: 2 });
      (nearVertex[e[0]] = nearVertex[e[0]] || []).push({ atom: p, other: e[1] });
      (nearVertex[e[1]] = nearVertex[e[1]] || []).push({ atom: q, other: e[0] });
    });
    Object.keys(nearVertex).forEach(function (k) {
      var ring = nearVertex[k];
      for (var x = 0; x < ring.length; x++) {
        for (var y = x + 1; y < ring.length; y++) {
          var ov = verts[ring[x].other], ow = verts[ring[y].other];
          var dd = Math.hypot(ov[0] - ow[0], ov[1] - ow[1], ov[2] - ow[2]);
          if (Math.abs(dd - 2) < 1e-6) bonds.push({ from: ring[x].atom, to: ring[y].atom, order: 1 });
        }
      }
    });
    return { atoms: atoms, bonds: bonds };
  }

  /* ---- the dataset ------------------------------------------------------- */

  var MOLECULES = [
    {
      id: "water", group: "basics", vsepr: "AX2E2",
      name: "Water", formula: "H2O", geometry: "Bent",
      category: "Essential", bondAngle: 104.5, polarity: "Polar",
      about: "Water has a bent shape because the oxygen atom carries two bonding pairs and two lone pairs. The lone pairs push the two O–H bonds closer together than a flat 120 degrees, leaving the familiar 104.5 degree angle and a molecule with a distinct positive and negative end.",
      build: function () { return bentAX2("O", "H", 0.9584, 104.5, 1); }
    },
    {
      id: "carbon-dioxide", group: "basics", vsepr: "AX2",
      name: "Carbon Dioxide", formula: "CO2", geometry: "Linear",
      category: "Essential", bondAngle: 180, polarity: "Nonpolar",
      about: "Carbon dioxide is linear: the carbon sits between two oxygens with no lone pairs of its own to bend the shape. Each C=O bond is polar, but because they point in exactly opposite directions the two pulls cancel and the molecule as a whole is nonpolar.",
      build: function () { return bentAX2("C", "O", 1.16, 180, 2); }
    },
    {
      id: "methane", group: "basics", vsepr: "AX4",
      name: "Methane", formula: "CH4", geometry: "Tetrahedral",
      category: "Essential", bondAngle: 109.5, polarity: "Nonpolar",
      about: "Methane places four hydrogens at the corners of a regular tetrahedron around one carbon. With four identical bonds and no lone pairs, the angles are the ideal 109.5 degrees and every bond pull cancels, so the molecule is nonpolar.",
      build: function () { return tetrahedralAX4("C", "H", 1.087); }
    },
    {
      id: "ammonia", group: "basics", vsepr: "AX3E",
      name: "Ammonia", formula: "NH3", geometry: "Trigonal pyramidal",
      category: "Essential", bondAngle: 106.7, polarity: "Polar",
      about: "Ammonia is a trigonal pyramid rather than a flat triangle. The nitrogen holds one lone pair above the three N–H bonds, pressing them down to about 106.7 degrees and giving the molecule a clear dipole.",
      build: function () { return pyramidalAX3("N", "H", 1.012, 106.7); }
    },
    {
      id: "hydrogen", group: "basics",
      name: "Hydrogen", formula: "H2", geometry: "Linear",
      category: "Essential", bondAngle: null, polarity: "Nonpolar",
      about: "Hydrogen is the simplest molecule there is: two hydrogen atoms sharing a single pair of electrons. Any two-atom molecule is linear by definition, and because both atoms are identical the bond has no polarity.",
      build: function () { return diatomic("H", "H", 0.741, 1); }
    },
    {
      id: "oxygen", group: "basics",
      name: "Oxygen", formula: "O2", geometry: "Linear",
      category: "Essential", bondAngle: null, polarity: "Nonpolar",
      about: "Molecular oxygen is drawn here as a double bond, which is the standard Lewis picture. It is worth knowing that O2 is actually paramagnetic, something the simple double-bond diagram does not capture — molecular orbital theory is needed to explain that.",
      note: "Shown as O=O. The Lewis double bond does not explain why oxygen is paramagnetic.",
      build: function () { return diatomic("O", "O", 1.208, 2); }
    },
    {
      id: "nitrogen", group: "basics",
      name: "Nitrogen", formula: "N2", geometry: "Linear",
      category: "Essential", bondAngle: null, polarity: "Nonpolar",
      about: "Nitrogen gas holds its two atoms together with a triple bond, one of the strongest bonds in chemistry. That strength is why nitrogen makes up most of the air yet reacts with almost nothing at room temperature.",
      build: function () { return diatomic("N", "N", 1.098, 3); }
    },
    {
      id: "carbon-monoxide", group: "basics",
      name: "Carbon Monoxide", formula: "CO", geometry: "Linear",
      category: "Simple", bondAngle: null, polarity: "Polar",
      about: "Carbon monoxide holds a triple bond between carbon and oxygen, giving it a very short, very strong bond. Despite the large electronegativity difference its measured dipole is unusually small, because the lone pair on carbon pushes back against the oxygen's pull.",
      build: function () { return diatomic("C", "O", 1.128, 3); }
    },
    {
      id: "hydrogen-chloride", group: "basics",
      name: "Hydrogen Chloride", formula: "HCl", geometry: "Linear",
      category: "Simple", bondAngle: null, polarity: "Polar",
      about: "Hydrogen chloride is a single polar bond between hydrogen and chlorine. Chlorine pulls the shared electrons strongly towards itself, which is why the molecule ionises readily in water to give hydrochloric acid.",
      build: function () { return diatomic("H", "Cl", 1.2746, 1); }
    },
    {
      id: "hydrogen-sulfide", group: "basics", vsepr: "AX2E2",
      name: "Hydrogen Sulfide", formula: "H2S", geometry: "Bent",
      category: "Simple", bondAngle: 92.1, polarity: "Polar",
      about: "Hydrogen sulfide is bent like water but much more sharply, at about 92 degrees. Sulfur is larger and less electronegative than oxygen, so its lone pairs sit further out and the bonding pairs are squeezed closer to a right angle.",
      build: function () { return bentAX2("S", "H", 1.336, 92.1, 1); }
    },
    {
      id: "sulfur-dioxide", group: "basics", vsepr: "AX2E",
      name: "Sulfur Dioxide", formula: "SO2", geometry: "Bent",
      category: "Simple", bondAngle: 119.3, polarity: "Polar",
      about: "Sulfur dioxide is bent at roughly 119 degrees because the sulfur atom carries one lone pair alongside its two bonds to oxygen. Unlike carbon dioxide the two bond dipoles do not cancel, so SO2 is a polar molecule.",
      note: "Drawn with two S=O bonds. The real bonding is a resonance hybrid, so both bonds are identical and intermediate in character.",
      build: function () { return bentAX2("S", "O", 1.4308, 119.3, 2); }
    },
    {
      id: "hydrogen-peroxide", group: "basics",
      name: "Hydrogen Peroxide", formula: "H2O2", geometry: "Skew chain",
      category: "Simple", bondAngle: 94.8, polarity: "Polar",
      about: "Hydrogen peroxide is the textbook example of a molecule that is not flat. The two O–H bonds sit on a twisted chain, roughly 111 degrees out of plane from one another, because the lone pairs on the two oxygens repel each other.",
      build: function () { return peroxide(1.475, 0.950, 94.8, 111.5); }
    },
    {
      id: "ethane", group: "basics",
      name: "Ethane", formula: "C2H6", geometry: "Tetrahedral centres",
      category: "Organic", bondAngle: 109.5, polarity: "Nonpolar",
      about: "Ethane is two tetrahedral carbons joined by a single bond. That single bond lets the two ends rotate freely, and the staggered arrangement shown here — with the hydrogens on one carbon sitting between those on the other — is the lowest-energy form.",
      build: function () { return ethaneLike("C", "H", 1.535, 1.094, 109.6); }
    },
    {
      id: "ethene", group: "basics",
      name: "Ethene", formula: "C2H4", geometry: "Trigonal planar centres",
      category: "Organic", bondAngle: 121.3, polarity: "Nonpolar",
      about: "Ethene is completely flat. The carbon–carbon double bond locks the two ends together so they cannot rotate, and all six atoms lie in a single plane with bond angles close to 120 degrees.",
      build: function () { return etheneLike("C", "H", 1.339, 1.087, 121.3); }
    },
    {
      id: "ethyne", group: "basics",
      name: "Ethyne", formula: "C2H2", geometry: "Linear",
      category: "Organic", bondAngle: 180, polarity: "Nonpolar",
      about: "Ethyne, also called acetylene, is perfectly linear. The carbon–carbon triple bond pulls the two carbons very close together and forces all four atoms onto one straight line.",
      build: function () { return linearChainAX("C", "H", 1.203, 1.060, 3); }
    },
    {
      id: "methanol", group: "basics",
      name: "Methanol", formula: "CH4O", geometry: "Tetrahedral carbon, bent oxygen",
      category: "Organic", bondAngle: 108.9, polarity: "Polar",
      about: "Methanol joins a tetrahedral CH3 group to an O–H group. The oxygen keeps two lone pairs, so the C–O–H angle is bent at about 109 degrees, and that O–H bond is what lets methanol hydrogen bond and mix freely with water.",
      build: function () { return methanol(1.4270, 1.0936, 0.9451, 108.9); }
    },
    {
      id: "benzene", group: "basics",
      name: "Benzene", formula: "C6H6", geometry: "Planar hexagonal ring",
      category: "Organic", bondAngle: 120, polarity: "Nonpolar",
      about: "Benzene is a flat regular hexagon of six carbons, each carrying one hydrogen. Every ring bond is the same length — midway between a single and a double bond — because the electrons are shared right around the ring rather than fixed in place.",
      note: "Drawn in the alternating Kekule style for clarity. In reality all six ring bonds are identical and the electrons are delocalised.",
      build: function () { return planarRing("C", "H", 6, 1.397, 1.084, true); }
    },

    /* ---- one molecule per VSEPR shape, from gas-phase experimental values */
    {
      id: "beryllium-chloride", group: "shapes", vsepr: "AX2",
      name: "Beryllium Chloride", formula: "BeCl2", geometry: "Linear",
      category: "Two electron domains", bondAngle: 180, polarity: "Nonpolar",
      about: "Gaseous beryllium chloride is the textbook AX2 case: beryllium has only two bonding pairs and no lone pairs, so the two chlorines sit on opposite sides at 180 degrees.",
      note: "This is the isolated gas-phase molecule. Solid beryllium chloride is a chain polymer.",
      build: function () { return bentAX2("Be", "Cl", 1.791, 180, 1); }
    },
    {
      id: "hydrogen-cyanide", group: "shapes", vsepr: "AX2",
      name: "Hydrogen Cyanide", formula: "HCN", geometry: "Linear",
      category: "Two electron domains", bondAngle: 180, polarity: "Polar",
      about: "Carbon forms a single bond to hydrogen and a triple bond to nitrogen. Two bonding regions and no lone pairs make the molecule linear, but its two ends differ, so it is strongly polar.",
      build: function () { return linearABC("H", "C", "N", 1.0655, 1.1532, 1, 3); }
    },
    {
      id: "boron-trifluoride", group: "shapes", vsepr: "AX3",
      name: "Boron Trifluoride", formula: "BF3", geometry: "Trigonal planar",
      category: "Three electron domains", bondAngle: 120, polarity: "Nonpolar",
      about: "Boron has three bonding pairs and no lone pair, so the three fluorines spread to the corners of a flat triangle 120 degrees apart. The three polar B–F bonds cancel, leaving a nonpolar molecule.",
      build: function () { return trigonalPlanarAX3("B", "F", 1.307, 1); }
    },
    {
      id: "sulfur-trioxide", group: "shapes", vsepr: "AX3",
      name: "Sulfur Trioxide", formula: "SO3", geometry: "Trigonal planar",
      category: "Three electron domains", bondAngle: 120, polarity: "Nonpolar",
      about: "Sulfur trioxide is flat, with three oxygens at 120 degrees and no lone pair on sulfur. Compare it with sulfur dioxide, where one lone pair bends the molecule and makes it polar.",
      note: "Drawn with three S=O bonds. The real bonds are identical and are best described by resonance.",
      build: function () { return trigonalPlanarAX3("S", "O", 1.4198, 2); }
    },
    {
      id: "ozone", group: "shapes", vsepr: "AX2E",
      name: "Ozone", formula: "O3", geometry: "Bent",
      category: "Three electron domains", bondAngle: 116.8, polarity: "Polar",
      about: "The central oxygen carries one lone pair beside its two bonds, so ozone is bent at about 117 degrees, just under the 120 degrees of a flat triangle.",
      note: "Drawn as O=O–O. Both O–O bonds are really the same length, because the double bond is shared by resonance.",
      build: function () { return bentOrders("O", "O", 1.278, 116.8, [2, 1], [1, 0, -1]); }
    },
    {
      id: "carbon-tetrachloride", group: "shapes", vsepr: "AX4",
      name: "Carbon Tetrachloride", formula: "CCl4", geometry: "Tetrahedral",
      category: "Four electron domains", bondAngle: 109.5, polarity: "Nonpolar",
      about: "Four chlorines at the corners of a regular tetrahedron. Each C–Cl bond is polar, but the symmetric arrangement cancels them exactly.",
      build: function () { return tetrahedralAX4("C", "Cl", 1.767); }
    },
    {
      id: "phosphine", group: "shapes", vsepr: "AX3E",
      name: "Phosphine", formula: "PH3", geometry: "Trigonal pyramidal",
      category: "Four electron domains", bondAngle: 93.3, polarity: "Polar",
      about: "Phosphine is a pyramid like ammonia but a much steeper one: its H–P–H angles close to about 93 degrees, far below the 107 degrees of ammonia.",
      build: function () { return pyramidalAX3("P", "H", 1.4200, 93.3); }
    },
    {
      id: "phosphorus-pentachloride", group: "shapes", vsepr: "AX5",
      name: "Phosphorus Pentachloride", formula: "PCl5", geometry: "Trigonal bipyramidal",
      category: "Five electron domains", bondAngle: "90 / 120", polarity: "Nonpolar",
      about: "Three chlorines form a triangle around phosphorus and two more sit above and below it. The two axial P–Cl bonds are measurably longer than the three equatorial ones.",
      note: "This is the gas-phase molecule. Solid PCl5 is ionic, [PCl4]+[PCl6]−.",
      build: function () { return trigonalBipyramidalAX5("P", "Cl", 2.124, 2.020); }
    },
    {
      id: "sulfur-tetrafluoride", group: "shapes", vsepr: "AX4E",
      name: "Sulfur Tetrafluoride", formula: "SF4", geometry: "Seesaw",
      category: "Five electron domains", bondAngle: "101.6 / 173.1", polarity: "Polar",
      about: "Sulfur has four bonds and one lone pair. The lone pair takes an equatorial position and pushes the other bonds away, bending the axial pair to about 173 degrees and closing the equatorial pair to about 102.",
      build: function () { return seesawAX4E("S", "F", 1.646, 1.545, 173.1, 101.6); }
    },
    {
      id: "chlorine-trifluoride", group: "shapes", vsepr: "AX3E2",
      name: "Chlorine Trifluoride", formula: "ClF3", geometry: "T-shaped",
      category: "Five electron domains", bondAngle: 87.5, polarity: "Polar",
      about: "Two lone pairs occupy equatorial positions, leaving the three fluorines in a T. The lone pairs press the two axial fluorines towards the third, so the angle is 87.5 degrees rather than 90.",
      build: function () { return tShapedAX3E2("Cl", "F", 1.698, 1.598, 87.5); }
    },
    {
      id: "xenon-difluoride", group: "shapes", vsepr: "AX2E3",
      name: "Xenon Difluoride", formula: "XeF2", geometry: "Linear",
      category: "Five electron domains", bondAngle: 180, polarity: "Nonpolar",
      about: "Xenon carries three lone pairs, all in the equatorial plane. That leaves the two fluorines on the axis, so the molecule is straight even though xenon has five electron domains.",
      build: function () { return bentAX2("Xe", "F", 1.977, 180, 1); }
    },
    {
      id: "sulfur-hexafluoride", group: "shapes", vsepr: "AX6",
      name: "Sulfur Hexafluoride", formula: "SF6", geometry: "Octahedral",
      category: "Six electron domains", bondAngle: 90, polarity: "Nonpolar",
      about: "Six fluorines at the corners of an octahedron, every neighbouring pair at 90 degrees. The perfect symmetry makes SF6 nonpolar and very unreactive, which is why it is used as an insulating gas in electrical switchgear.",
      build: function () { return octahedralAX6("S", "F", 1.561, false); }
    },
    {
      id: "bromine-pentafluoride", group: "shapes", vsepr: "AX5E",
      name: "Bromine Pentafluoride", formula: "BrF5", geometry: "Square pyramidal",
      category: "Six electron domains", bondAngle: 84.8, polarity: "Polar",
      about: "Five fluorines and one lone pair around bromine. The lone pair sits opposite the apex fluorine and pushes the four basal fluorines up, so they meet the apex at 84.8 degrees instead of 90.",
      build: function () { return squarePyramidalAX5E("Br", "F", 1.689, 1.774, 84.8); }
    },
    {
      id: "xenon-tetrafluoride", group: "shapes", vsepr: "AX4E2",
      name: "Xenon Tetrafluoride", formula: "XeF4", geometry: "Square planar",
      category: "Six electron domains", bondAngle: 90, polarity: "Nonpolar",
      about: "Two lone pairs sit above and below xenon, as far apart as possible, which leaves the four fluorines in a flat square.",
      build: function () { return octahedralAX6("Xe", "F", 1.94, true); }
    },

    /* ---- a carbon cage */
    {
      id: "buckminsterfullerene", group: "organic",
      name: "Buckminsterfullerene", formula: "C60", geometry: "Truncated icosahedron",
      category: "Carbon cages", bondAngle: "108 / 120", polarity: "Nonpolar",
      about: "Sixty carbons arranged like the panels of a football: 12 pentagons and 20 hexagons. Bonds shared by two hexagons (1.401 Å) are shorter than bonds on a pentagon edge (1.458 Å), and the model reproduces both.",
      note: "Drawn with its 30 double bonds on the hexagon–hexagon edges, the Kekulé structure that matches the shorter bonds.",
      build: function () { return fullerene60(1.458, 1.401); }
    }
  ];

  /* ---- materialise the coordinates once ---------------------------------- */
  MOLECULES.forEach(function (m) {
    var built = m.build();
    m.atoms = built.atoms;
    m.bonds = built.bonds;
    delete m.build;
  });

  /* ---- element presentation data ----------------------------------------
     Colours follow the CPK convention chemists expect, tuned for a dark
     canvas. Radii are relative drawing sizes, not measured atomic radii —
     the viewer is a ball-and-stick model, not a space-filling one. */
  /* Drawing radii are covalent radii scaled down to about 0.45, which is what
     keeps this a ball-and-stick model: the spheres stay in correct relative
     proportion to one another but leave the bonds clearly visible. Drawn at
     full covalent size the atoms would touch and the sticks would vanish,
     which is a space-filling model — a different thing entirely.
     Hydrogen is nudged up from its true ratio so it does not disappear. */
  var ATOM_STYLE = {
    H:  { color: "#f4f7fb", radius: 0.22, name: "Hydrogen" },
    B:  { color: "#f6a6a6", radius: 0.38, name: "Boron" },
    Be: { color: "#b5e61d", radius: 0.40, name: "Beryllium" },
    Si: { color: "#e8c39e", radius: 0.50, name: "Silicon" },
    Xe: { color: "#4fb3c4", radius: 0.62, name: "Xenon" },
    C:  { color: "#4b5565", radius: 0.34, name: "Carbon" },
    N:  { color: "#4f7bf0", radius: 0.32, name: "Nitrogen" },
    O:  { color: "#e5484d", radius: 0.30, name: "Oxygen" },
    F:  { color: "#5bd6a4", radius: 0.26, name: "Fluorine" },
    P:  { color: "#f08b3c", radius: 0.48, name: "Phosphorus" },
    S:  { color: "#e3c23c", radius: 0.47, name: "Sulfur" },
    Cl: { color: "#67d16a", radius: 0.46, name: "Chlorine" },
    Br: { color: "#b05a3c", radius: 0.54, name: "Bromine" },
    I:  { color: "#9b62d6", radius: 0.62, name: "Iodine" }
  };
  var FALLBACK_STYLE = { color: "#c0a8d8", radius: 0.40, name: "Element" };

  /* Colours for elements that only turn up in imported files (Jmol scheme). */
  var EXTRA_COLOURS = {
    He: "#d9ffff", Li: "#cc80ff", Ne: "#b3e3f5", Na: "#ab5cf2", Mg: "#8aff00", Al: "#bfa6a6",
    Ar: "#80d1e3", K: "#8f40d4", Ca: "#3dff00", Ti: "#bfc2c7", V: "#a6a6ab", Cr: "#8a99c7",
    Mn: "#9c7ac7", Fe: "#e06633", Co: "#f090a0", Ni: "#50d050", Cu: "#c88033", Zn: "#7d80b0",
    Ga: "#c28f8f", Ge: "#668f8f", As: "#bd80e3", Se: "#ffa100", Kr: "#5cb8d1", Rb: "#702eb0",
    Sr: "#00ff00", Mo: "#54b5b5", Ru: "#248f8f", Rh: "#0a7d8c", Pd: "#006985", Ag: "#c0c0c0",
    Cd: "#ffd98f", Sn: "#668080", Sb: "#9e63b5", Te: "#d47a00", Cs: "#57178f", Ba: "#00c900",
    W: "#2194d6", Pt: "#d0d0e0", Au: "#ffd123", Hg: "#b8b8d0", Pb: "#8a8d96", Bi: "#9e4fb5", U: "#008fff"
  };

  /* Covalent radii (Cordero et al., 2008) in angstroms. They size the spheres
     of elements without a hand-tuned style and detect bonds in XYZ/PDB files. */
  var COVALENT = {
    H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
    Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76,
    Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22,
    Ga: 1.22, Ge: 1.20, As: 1.19, Se: 1.20, Br: 1.20, Kr: 1.16, Rb: 2.20, Sr: 1.95, Y: 1.90, Zr: 1.75,
    Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39,
    Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40, Cs: 2.44, Ba: 2.15, W: 1.62, Pt: 1.36, Au: 1.36, Hg: 1.32,
    Tl: 1.45, Pb: 1.46, Bi: 1.48, U: 1.96
  };

  /* Van der Waals radii (Bondi; Mantina for Be) for the space-filling style. */
  var VDW = {
    H: 1.20, He: 1.40, Li: 1.82, Be: 1.53, B: 1.92, C: 1.70, N: 1.55, O: 1.52, F: 1.47, Ne: 1.54,
    Na: 2.27, Mg: 1.73, Al: 1.84, Si: 2.10, P: 1.80, S: 1.80, Cl: 1.75, Ar: 1.88, K: 2.75, Ca: 2.31,
    Ni: 1.63, Cu: 1.40, Zn: 1.39, Ga: 1.87, Ge: 2.11, As: 1.85, Se: 1.90, Br: 1.85, Kr: 2.02,
    Pd: 1.63, Ag: 1.72, Cd: 1.58, In: 1.93, Sn: 2.17, Sb: 2.06, Te: 2.06, I: 1.98, Xe: 2.16,
    Pt: 1.75, Au: 1.66, Hg: 1.55, Tl: 1.96, Pb: 2.02, Bi: 2.07, U: 1.86
  };

  var styleCache = {};
  function styleFor(symbol) {
    if (ATOM_STYLE[symbol]) return ATOM_STYLE[symbol];
    if (styleCache[symbol]) return styleCache[symbol];
    var cov = COVALENT[symbol];
    var el = global.ChemData && global.ChemData.bySymbol ? global.ChemData.bySymbol(symbol) : null;
    var style = {
      color: EXTRA_COLOURS[symbol] || FALLBACK_STYLE.color,
      radius: cov ? Math.max(0.3, Math.min(0.7, cov * 0.42)) : FALLBACK_STYLE.radius,
      name: el ? el.name : FALLBACK_STYLE.name
    };
    styleCache[symbol] = style;
    return style;
  }

  function covalentRadius(symbol) { return COVALENT[symbol] || 1.5; }
  function vdwRadius(symbol) { return VDW[symbol] || 2.0; }

  /** Molar mass from the shared 118-element dataset, so atomic masses live
      in exactly one place. Returns null if elements.js has not loaded. */
  function molarMass(molecule) {
    if (!global.ChemData || typeof global.ChemData.bySymbol !== "function") return null;
    var total = 0;
    for (var i = 0; i < molecule.atoms.length; i++) {
      var el = global.ChemData.bySymbol(molecule.atoms[i].element);
      if (!el || typeof el.mass !== "number") return null;
      total += el.mass;
    }
    return total;
  }

  /** "H2O" -> [["H",2],["O",1]] for subscript rendering. */
  function formulaParts(formula) {
    var out = [], re = /([A-Z][a-z]?)(\d*)/g, m;
    while ((m = re.exec(formula)) !== null) {
      if (!m[1]) continue;
      out.push([m[1], m[2] || ""]);
    }
    return out;
  }

  /** Hill notation: C first, then H, then the rest alphabetically. */
  function hillFormula(atoms) {
    var counts = {};
    atoms.forEach(function (a) { counts[a.element] = (counts[a.element] || 0) + 1; });
    var keys = Object.keys(counts).sort();
    if (counts.C) {
      keys = ["C"].concat(counts.H ? ["H"] : [], keys.filter(function (k) { return k !== "C" && k !== "H"; }));
    }
    return keys.map(function (k) { return k + (counts[k] > 1 ? counts[k] : ""); }).join("");
  }

  var GROUPS = [
    { id: "basics", label: "Basics" },
    { id: "shapes", label: "VSEPR shapes" },
    { id: "organic", label: "Organic" },
    { id: "life", label: "Life" },
    { id: "everyday", label: "Everyday" }
  ];

  var byId = {};
  var custom = [];
  MOLECULES.forEach(function (m) {
    m.source = "experimental";
    byId[m.id] = m;
  });

  /** Library entries arrive in compact form from molecule-library.js. */
  function addLibrary(list) {
    list.forEach(function (e) {
      if (byId[e.id]) return;
      var atoms = e.a.split(";").map(function (s) {
        var p = s.split(",");
        return { element: p[0], x: +p[1], y: +p[2], z: +p[3] };
      });
      var bonds = e.b ? e.b.split(";").map(function (s) {
        var p = s.split(",");
        return { from: +p[0], to: +p[1], order: +p[2] };
      }) : [];
      var m = {
        id: e.id, name: e.name, formula: hillFormula(atoms), group: e.group, category: e.category,
        geometry: null, bondAngle: null, polarity: null, about: e.about,
        source: "pubchem", cid: e.cid, atoms: atoms, bonds: bonds
      };
      MOLECULES.push(m);
      byId[m.id] = m;
    });
  }

  /** Molecules from the visitor's own files or a PubChem search. */
  function setCustom(list) {
    custom.forEach(function (m) { if (byId[m.id] === m) delete byId[m.id]; });
    custom = list.slice();
    custom.forEach(function (m) { byId[m.id] = m; });
  }

  global.MoleculeData = {
    molecules: MOLECULES,
    groups: GROUPS,
    byId: function (id) { return byId[id] || null; },
    custom: function () { return custom; },
    setCustom: setCustom,
    addLibrary: addLibrary,
    styleFor: styleFor,
    covalentRadius: covalentRadius,
    vdwRadius: vdwRadius,
    atomStyles: ATOM_STYLE,
    molarMass: molarMass,
    hillFormula: hillFormula,
    formulaParts: formulaParts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.MoleculeData;
})(typeof window !== "undefined" ? window : globalThis);
