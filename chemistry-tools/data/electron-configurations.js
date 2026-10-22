/* ============================================================================
   ToolAdda — Electron Configuration Engine
   Parses ground-state configurations from ChemData, distributes electrons
   with Hund's rule, derives shell counts, and builds animation steps.
   ============================================================================ */

(function (global) {
  "use strict";

  var ORBITAL_COUNT = { s: 1, p: 3, d: 5, f: 7 };
  var SUBSHELL_MAX = { s: 2, p: 6, d: 10, f: 14 };

  var AUFBAU_ORDER = [
    "1s", "2s", "2p", "3s", "3p", "4s", "3d", "4p", "5s", "4d", "5p",
    "6s", "4f", "5d", "6p", "7s", "5f", "6d", "7p"
  ];

  var AUFBAU_INDEX = {};
  AUFBAU_ORDER.forEach(function (k, i) { AUFBAU_INDEX[k] = i; });

  var SHELL_LABELS = ["K", "L", "M", "N", "O", "P", "Q"];

  function parseSubshellKey(key) {
    var m = /^(\d)([spdf])$/.exec(key);
    if (!m) return null;
    return { n: parseInt(m[1], 10), type: m[2], key: key };
  }

  /** Parse "1s2 2s2 2p2" or expanded configs into subshell list. */
  function parseConfigString(config) {
    if (!config) return { subshells: [], total: 0, map: {} };
    var map = {};
    var re = /(\d)([spdf])(\d+)/g;
    var match;
    while ((match = re.exec(config)) !== null) {
      var key = match[1] + match[2];
      var count = parseInt(match[3], 10);
      map[key] = (map[key] || 0) + count;
    }
    var subshells = Object.keys(map).map(function (key) {
      var p = parseSubshellKey(key);
      return {
        key: key,
        n: p.n,
        type: p.type,
        count: map[key],
        capacity: SUBSHELL_MAX[p.type],
        orbitals: ORBITAL_COUNT[p.type]
      };
    });
    subshells.sort(function (a, b) {
      var ai = AUFBAU_INDEX[a.key];
      var bi = AUFBAU_INDEX[b.key];
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.n - b.n || a.type.localeCompare(b.type);
    });
    var total = subshells.reduce(function (s, x) { return s + x.count; }, 0);
    return { subshells: subshells, total: total, map: map };
  }

  /** Hund's rule: distribute `count` electrons across `numOrbitals` boxes (max 2 each). */
  function distributeHund(count, numOrbitals) {
    var boxes = new Array(numOrbitals);
    var i;
    for (i = 0; i < numOrbitals; i++) boxes[i] = 0;
    var placed = 0;
    while (placed < count) {
      var added = false;
      for (i = 0; i < numOrbitals && placed < count; i++) {
        if (boxes[i] === 0) {
          boxes[i] = 1;
          placed++;
          added = true;
        }
      }
      if (!added) {
        for (i = 0; i < numOrbitals && placed < count; i++) {
          if (boxes[i] === 1) {
            boxes[i] = 2;
            placed++;
          }
        }
      }
    }
    return boxes;
  }

  function addOneElectronHund(boxes) {
    var next = boxes.slice();
    var i;
    for (i = 0; i < next.length; i++) {
      if (next[i] === 0) {
        next[i] = 1;
        return next;
      }
    }
    for (i = 0; i < next.length; i++) {
      if (next[i] === 1) {
        next[i] = 2;
        return next;
      }
    }
    return next;
  }

  function shellDistributionFromParsed(parsed) {
    var shells = {};
    parsed.subshells.forEach(function (sub) {
      shells[sub.n] = (shells[sub.n] || 0) + sub.count;
    });
    var maxN = 0;
    Object.keys(shells).forEach(function (k) {
      maxN = Math.max(maxN, parseInt(k, 10));
    });
    var out = [];
    for (var n = 1; n <= maxN; n++) {
      if (shells[n]) out.push({ n: n, label: SHELL_LABELS[n - 1] || ("Shell " + n), count: shells[n] });
    }
    return out;
  }

  function buildOrbitalDiagram(parsed) {
    return parsed.subshells.map(function (sub) {
      return {
        key: sub.key,
        type: sub.type,
        n: sub.n,
        count: sub.count,
        capacity: sub.capacity,
        boxes: distributeHund(sub.count, sub.orbitals)
      };
    });
  }

  function buildFillingTable(parsed) {
    return parsed.subshells.map(function (sub) {
      return {
        orbital: sub.key,
        orbitals: sub.orbitals,
        capacity: sub.capacity,
        occupied: sub.count
      };
    });
  }

  function buildAnimationSteps(parsed) {
    var steps = [];
    var cumulative = {};
    var totalElectrons = 0;

    parsed.subshells.forEach(function (sub) {
      var boxes = new Array(sub.orbitals);
      var i;
      for (i = 0; i < sub.orbitals; i++) boxes[i] = 0;

      for (var e = 0; e < sub.count; e++) {
        boxes = addOneElectronHund(boxes);
        totalElectrons++;
        cumulative[sub.key] = boxes.slice();
        var snapshot = {};
        parsed.subshells.forEach(function (s) {
          snapshot[s.key] = cumulative[s.key]
            ? cumulative[s.key].slice()
            : new Array(s.orbitals).fill(0);
        });
        var explanation = "";
        var rule = "aufbau";
        var paired = e >= sub.orbitals;
        if (e === 0) {
          explanation = sub.key + " is the lowest-energy subshell that still has room (Aufbau principle).";
        } else if (!paired) {
          rule = "hund";
          explanation = "It takes an empty " + sub.key + " orbital with the same spin rather than pairing up (Hund's rule).";
        } else {
          rule = "pauli";
          explanation = (sub.orbitals === 1 ? "The " + sub.key + " orbital already holds one electron" : "Every " + sub.key + " orbital already holds one electron") +
            ", so this one pairs with opposite spin (Pauli exclusion principle).";
        }
        steps.push({
          subshell: sub.key,
          electronIndex: e + 1,
          totalElectrons: totalElectrons,
          snapshot: snapshot,
          explanation: explanation,
          rule: rule
        });
      }
    });

    return steps;
  }

  var SUPERSCRIPT_DIGITS = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

  /** "3d6 4s2" -> "3d⁶ 4s²". Only the electron count after the subshell
      letter is raised; the principal quantum number stays on the baseline. */
  function toSuperscript(config) {
    return String(config).replace(/([spdf])(\d+)/g, function (_, letter, n) {
      return letter + n.split("").map(function (d) { return SUPERSCRIPT_DIGITS[d]; }).join("");
    });
  }

  function formatMass(el) {
    if (el.massText) return el.massText;
    if (el.massNum) return "[" + el.mass + "]";
    return String(el.mass);
  }

  function getElementConfig(z) {
    if (!global.ChemData) return null;
    var el = global.ChemData.byNumber(z);
    if (!el) return null;
    var parsed = parseConfigString(el.fullConfig);
    var orbitals = buildOrbitalDiagram(parsed);
    var shells = shellDistributionFromParsed(parsed);
    var outer = shells[shells.length - 1];
    var exception = isKnownException(el);
    return {
      element: el,
      fullConfig: el.fullConfig,
      nobleConfig: el.config,
      parsed: parsed,
      shells: shellDistributionFromParsed(parsed),
      orbitals: orbitals,
      table: buildFillingTable(parsed),
      steps: buildAnimationSteps(parsed),
      electrons: parsed.total,
      unpaired: countUnpaired(orbitals),
      outerShell: outer ? { n: outer.n, label: outer.label, count: outer.count } : null,
      isException: exception,
      aufbauPrediction: exception ? formatNobleConfig(aufbauPredictionMap(el.z), el.z) : null,
      isPredicted: isPredicted(el)
    };
  }

  /* Noble-gas cores in ascending order, for writing a prediction in the same
     shorthand the dataset uses. */
  var NOBLE_CORES = [
    { symbol: "He", z: 2 }, { symbol: "Ne", z: 10 }, { symbol: "Ar", z: 18 },
    { symbol: "Kr", z: 36 }, { symbol: "Xe", z: 54 }, { symbol: "Rn", z: 86 }
  ];
  var TYPE_ORDER = { s: 0, p: 1, d: 2, f: 3 };

  /** Fill `z` electrons strictly in Aufbau order — the textbook prediction
      that ignores the half-filled / filled subshell exceptions. */
  function aufbauPredictionMap(z) {
    var map = {};
    var left = z;
    for (var i = 0; i < AUFBAU_ORDER.length && left > 0; i++) {
      var key = AUFBAU_ORDER[i];
      var take = Math.min(SUBSHELL_MAX[key.charAt(1)], left);
      map[key] = take;
      left -= take;
    }
    return map;
  }

  /** Write a subshell map in noble-gas shorthand, e.g. "[Ar] 3d4 4s2". The
      remainder is ordered by n then s, p, d, f, as in the element dataset. */
  function formatNobleConfig(map, z) {
    var core = null;
    NOBLE_CORES.forEach(function (c) { if (c.z < z) core = c; });
    var coreMap = core ? aufbauPredictionMap(core.z) : {};
    var rest = Object.keys(map).filter(function (key) {
      return map[key] > 0 && coreMap[key] !== map[key];
    });
    rest.sort(function (a, b) {
      return (a.charAt(0) - b.charAt(0)) || (TYPE_ORDER[a.charAt(1)] - TYPE_ORDER[b.charAt(1)]);
    });
    var parts = rest.map(function (key) { return key + map[key]; });
    if (core) parts.unshift("[" + core.symbol + "]");
    return parts.join(" ");
  }

  function sameMap(a, b) {
    var ka = Object.keys(a).filter(function (k) { return a[k] > 0; });
    var kb = Object.keys(b).filter(function (k) { return b[k] > 0; });
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return a[k] === b[k]; });
  }

  /** True when the accepted configuration differs from the strict Aufbau
      prediction (Cr, Cu, Pd, La, U, Lr …). */
  function isKnownException(el) {
    if (!el || !el.fullConfig) return false;
    return !sameMap(parseConfigString(el.fullConfig).map, aufbauPredictionMap(el.z));
  }

  /** Configurations for Z >= 104 are theoretical (see data/elements.js). */
  function isPredicted(el) {
    return !!el && el.z >= 104;
  }

  function countUnpaired(orbitals) {
    return orbitals.reduce(function (sum, sub) {
      return sum + sub.boxes.filter(function (b) { return b === 1; }).length;
    }, 0);
  }

  /** Electron count per shell from an animation snapshot ({ "2p": [2,1,1] }). */
  function shellCountsFromSnapshot(snapshot) {
    var shells = {};
    Object.keys(snapshot).forEach(function (key) {
      var n = parseInt(key.charAt(0), 10);
      shells[n] = (shells[n] || 0) + snapshot[key].reduce(function (s, b) { return s + b; }, 0);
    });
    return shells;
  }

  function searchElements(query, limit) {
    if (!global.ChemData) return [];
    limit = limit || 8;
    var q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    var results = [];
    global.ChemData.elements.forEach(function (el) {
      var score = 0;
      if (String(el.z) === q) score = 100;
      else if (el.symbol.toLowerCase() === q) score = 95;
      else if (el.name.toLowerCase() === q) score = 90;
      else if (el.symbol.toLowerCase().indexOf(q) === 0) score = 80;
      else if (el.name.toLowerCase().indexOf(q) === 0) score = 75;
      else if (el.name.toLowerCase().indexOf(q) !== -1) score = 60;
      else if (String(el.z).indexOf(q) === 0) score = 55;
      if (score) results.push({ el: el, score: score });
    });
    results.sort(function (a, b) {
      return b.score - a.score || a.el.z - b.el.z;
    });
    return results.slice(0, limit).map(function (r) { return r.el; });
  }

  global.ElectronConfig = {
    AUFBAU_ORDER: AUFBAU_ORDER,
    ORBITAL_COUNT: ORBITAL_COUNT,
    SUBSHELL_MAX: SUBSHELL_MAX,
    SHELL_LABELS: SHELL_LABELS,
    parseConfigString: parseConfigString,
    distributeHund: distributeHund,
    shellDistributionFromParsed: shellDistributionFromParsed,
    buildOrbitalDiagram: buildOrbitalDiagram,
    buildFillingTable: buildFillingTable,
    buildAnimationSteps: buildAnimationSteps,
    toSuperscript: toSuperscript,
    formatMass: formatMass,
    getElementConfig: getElementConfig,
    isKnownException: isKnownException,
    isPredicted: isPredicted,
    aufbauPredictionMap: aufbauPredictionMap,
    formatNobleConfig: formatNobleConfig,
    countUnpaired: countUnpaired,
    shellCountsFromSnapshot: shellCountsFromSnapshot,
    searchElements: searchElements
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.ElectronConfig;
})(typeof window !== "undefined" ? window : globalThis);
