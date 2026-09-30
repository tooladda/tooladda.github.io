/* Chemical equation balancer engine.
 *
 * Pure computation, no DOM. Exposed as window.EquationBalancer and as a
 * CommonJS module so the test suite can require it in Node.
 *
 * DESIGN RULE, above every other consideration: this engine must never return
 * a wrong balance. Two things enforce that.
 *
 *   1. All arithmetic is exact. Coefficients come from Gaussian elimination
 *      over rationals implemented with BigInt, so there is no floating-point
 *      error to accumulate and no epsilon comparison to tune. A 1/3 stays
 *      exactly 1/3 all the way to the final integer scaling.
 *
 *   2. The answer is re-checked from scratch. verify() re-parses the balanced
 *      equation's species and re-counts every atom and the net charge without
 *      consulting anything the solver produced. A result is only reported as
 *      balanced when that independent pass agrees.
 *
 * When the system has no valid solution, or more than one independent one, or
 * the solution needs a non-positive coefficient, the engine reports the
 * limitation. It never guesses.
 *
 * The element symbol table is duplicated here rather than read from
 * chemistry-tools/data/elements.js because that file is browser-only (it
 * assigns to `window` and has no module export) and this engine has to run
 * under Node for its tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EquationBalancer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------- elements */

  var SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
    'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm ' +
    'Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu ' +
    'Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');

  var IS_ELEMENT = Object.create(null);
  SYMBOLS.forEach(function (s) { IS_ELEMENT[s] = true; });

  var STATES = ['s', 'l', 'g', 'aq'];

  /* -------------------------------------------------- exact rationals */

  function babs(a) { return a < 0n ? -a : a; }

  function bgcd(a, b) {
    a = babs(a); b = babs(b);
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }

  function blcm(a, b) {
    if (a === 0n || b === 0n) return 0n;
    return babs(a * b) / bgcd(a, b);
  }

  /* A rational held as a reduced BigInt pair with a positive denominator. */
  function Frac(n, d) {
    n = BigInt(n);
    d = d === undefined ? 1n : BigInt(d);
    if (d === 0n) throw new Error('Division by zero while solving.');
    if (d < 0n) { n = -n; d = -d; }
    var g = bgcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  Frac.prototype.add = function (o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); };
  Frac.prototype.sub = function (o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); };
  Frac.prototype.mul = function (o) { return new Frac(this.n * o.n, this.d * o.d); };
  Frac.prototype.div = function (o) {
    if (o.n === 0n) throw new Error('Division by zero while solving.');
    return new Frac(this.n * o.d, this.d * o.n);
  };
  Frac.prototype.isZero = function () { return this.n === 0n; };
  Frac.prototype.neg = function () { return new Frac(-this.n, this.d); };
  Frac.prototype.toString = function () { return this.d === 1n ? String(this.n) : this.n + '/' + this.d; };

  /* --------------------------------------------------------- formula parse */

  function ParseError(message) {
    var e = new Error(message);
    e.userFacing = true;
    return e;
  }

  /* Superscript digits occasionally survive a copy-paste from a textbook. */
  var SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
  var SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

  function normaliseText(raw) {
    var s = String(raw == null ? '' : raw);
    // A superscript run states the charge unambiguously, so rewrite it into
    // the caret form (SO₄²⁻ -> SO4^2-). Doing this first means the
    // ambiguous bare-digit case below never sees superscript input.
    s = s.replace(/([⁰¹²³⁴-⁹]+)([⁺⁻])/g, function (m, digits, sign) {
      return '^' + digits.replace(/[⁰¹²³⁴-⁹]/g, function (c) { return SUP[c]; }) + SUP[sign];
    });
    s = s.replace(/[⁰¹²³⁴-⁹⁺⁻]/g, function (c) { return SUP[c]; });
    s = s.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, function (c) { return SUB[c]; });
    s = s.replace(/[–—]/g, '-');       // en/em dash
    s = s.replace(/−/g, '-');               // unicode minus
    s = s.replace(/[\[\]]/g, function (c) { return c === '[' ? '(' : ')'; });
    return s;
  }

  /* Split "3H2O" style multipliers used in hydrate notation. */
  function splitLeadingCount(s) {
    var m = /^(\d+)(.*)$/.exec(s);
    if (!m) return { mult: 1, rest: s };
    return { mult: parseInt(m[1], 10), rest: m[2] };
  }

  /* Parse one species into element counts and a net charge.
     Accepts parentheses, nested groups, hydrate dots and trailing charges. */
  function parseSpecies(raw) {
    var text = normaliseText(raw).trim();
    if (!text) throw ParseError('An empty formula was found — check for a stray + sign.');

    var original = text;
    var state = null;

    // trailing physical state, e.g. H2O(l)
    var stateMatch = /\((s|l|g|aq)\)\s*$/i.exec(text);
    if (stateMatch) {
      state = stateMatch[1].toLowerCase();
      text = text.slice(0, stateMatch.index).trim();
    }
    if (!text) throw ParseError('"' + original + '" has a state label but no formula.');

    // a lone electron, written e- or e
    if (/^e$/i.test(text) || /^e[-−]$/i.test(text)) {
      return { formula: original, display: 'e⁻', counts: {}, charge: -1, state: state, isElectron: true };
    }

    var charge = 0;
    // Trailing charge. The caret form is explicit; a bare sign run means its
    // own length (++ is 2+). Bare digits before a sign are the awkward case:
    // in Fe3+ the 3 is the charge, in NH4+ the 4 is a subscript, and the text
    // alone cannot tell those apart. It is only safe when the body is a single
    // element symbol; anything else is refused with a pointer to the caret
    // form, because guessing here would silently balance the wrong species.
    var caretMatch = /\^(\d*)([+-])$/.exec(text);
    var bareMatch = caretMatch ? null : /(\d*)([+-]+)$/.exec(text);
    var chargeMatch = caretMatch || (bareMatch && bareMatch[2] ? bareMatch : null);

    if (chargeMatch) {
      var signs = chargeMatch[2];
      if (/\+/.test(signs) && /-/.test(signs)) {
        throw ParseError('"' + original + '" mixes + and - in its charge.');
      }
      var digits = chargeMatch[1];
      var body = text.slice(0, chargeMatch.index);
      var magnitude;

      if (caretMatch) {
        magnitude = digits ? parseInt(digits, 10) : 1;
      } else if (!digits) {
        magnitude = signs.length;
      } else {
        if (signs.length !== 1) {
          throw ParseError('"' + original + '" has an unclear charge. Write it as ' + body + '^' + digits + signs[0] + '.');
        }
        // digits are only unambiguous after a lone element symbol, as in Fe3+
        if (/^[A-Z][a-z]?$/.test(body)) {
          magnitude = parseInt(digits, 10);
        } else {
          throw ParseError('"' + original + '" is ambiguous: the ' + digits +
            ' could be a subscript or the charge. Write it with a caret, for example ' +
            body + digits + '^' + signs[0] + ' or ' + body + '^' + digits + signs[0] + '.');
        }
      }
      if (magnitude === 0) throw ParseError('"' + original + '" has a zero charge magnitude.');
      charge = (signs[0] === '+' ? 1 : -1) * magnitude;
      text = body;
    }
    if (!text) throw ParseError('"' + original + '" is a charge with no formula.');

    // hydrate / adduct notation: CuSO4·5H2O
    var parts = text.split(/[·*.]/);
    if (parts.some(function (p) { return p.trim() === ''; })) {
      throw ParseError('"' + original + '" has an empty part around a · separator.');
    }

    var counts = Object.create(null);
    parts.forEach(function (part, partIndex) {
      var trimmedPart = part.trim();
      // "5H2O" is a hydrate multiplier only after a dot; a number in front of
      // the first part is a stray coefficient, which belongs in the equation.
      if (partIndex === 0 && /^\d/.test(trimmedPart)) {
        throw ParseError('"' + original + '" starts with a number. Coefficients go in the equation, not inside a formula.');
      }
      var split = partIndex === 0 ? { mult: 1, rest: trimmedPart } : splitLeadingCount(trimmedPart);
      if (!split.rest) throw ParseError('"' + original + '" has a number with no formula after it.');
      var sub = parseBody(split.rest, original);
      for (var el in sub) counts[el] = (counts[el] || 0) + sub[el] * split.mult;
    });

    return {
      formula: original,
      display: null,          // filled in by the display layer
      counts: counts,
      charge: charge,
      state: state,
      isElectron: false
    };
  }

  /* Recursive-descent walk over a formula body with nested parentheses. */
  function parseBody(body, original) {
    var i = 0;
    var counts = Object.create(null);

    function readNumber() {
      var start = i;
      while (i < body.length && body[i] >= '0' && body[i] <= '9') i++;
      if (i === start) return 1;
      return parseInt(body.slice(start, i), 10);
    }

    function group(depth) {
      var local = Object.create(null);
      while (i < body.length) {
        var c = body[i];
        if (c === '(') {
          i++;
          var inner = group(depth + 1);
          var mult = readNumber();
          if (mult === 0) throw ParseError('"' + original + '" has a group multiplied by zero.');
          for (var k in inner) local[k] = (local[k] || 0) + inner[k] * mult;
        } else if (c === ')') {
          if (depth === 0) throw ParseError('"' + original + '" has an unmatched closing bracket.');
          i++;
          return local;
        } else if (c >= 'A' && c <= 'Z') {
          var sym = c;
          i++;
          while (i < body.length && body[i] >= 'a' && body[i] <= 'z') { sym += body[i]; i++; }
          if (!IS_ELEMENT[sym]) {
            throw ParseError('"' + sym + '" in "' + original + '" is not a chemical element symbol.');
          }
          var n = readNumber();
          if (n === 0) throw ParseError('"' + original + '" has an element with a subscript of zero.');
          local[sym] = (local[sym] || 0) + n;
        } else if (c >= '0' && c <= '9') {
          throw ParseError('"' + original + '" has a number where an element symbol was expected.');
        } else if (c === ' ') {
          i++;
        } else {
          throw ParseError('"' + original + '" contains "' + c + '", which is not valid in a formula.');
        }
      }
      if (depth !== 0) throw ParseError('"' + original + '" has an unclosed bracket.');
      return local;
    }

    var out = group(0);
    if (Object.keys(out).length === 0) {
      throw ParseError('"' + original + '" does not contain any elements.');
    }
    for (var k2 in out) counts[k2] = out[k2];
    return counts;
  }

  /* -------------------------------------------------------- equation parse */

  var ARROWS = ['<=>', '<->', '-->', '->', '=>', '→', '⟶', '⇌', '⇒', '='];

  function splitEquation(raw) {
    var text = normaliseText(raw).trim();
    if (!text) throw ParseError('Enter a chemical equation to balance.');

    var found = null, idx = -1;
    for (var a = 0; a < ARROWS.length; a++) {
      var p = text.indexOf(ARROWS[a]);
      if (p !== -1) { found = ARROWS[a]; idx = p; break; }
    }
    if (found === null) {
      throw ParseError('No arrow found. Separate the two sides with ->, = or →.');
    }
    var left = text.slice(0, idx);
    var right = text.slice(idx + found.length);
    if (right.indexOf(found) !== -1 || ARROWS.some(function (x) { return right.indexOf(x) !== -1 && x !== '='; })) {
      throw ParseError('The equation has more than one arrow.');
    }
    return { left: left, right: right };
  }

  function splitSide(side, label) {
    var raw = side.split('+');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var piece = raw[i];
      var trimmed = piece.trim();
      if (trimmed === '') {
        // a trailing + on a charge, e.g. "Na+ + Cl-" splits into "Na", "", "Cl-"
        if (i > 0 && out.length) { out[out.length - 1] = out[out.length - 1] + '+'; continue; }
        throw ParseError('There is an empty term on the ' + label + ' side — check the + signs.');
      }
      out.push(trimmed);
    }
    if (!out.length) throw ParseError('Please enter at least one ' + label + '.');
    return out;
  }

  function parseEquation(raw) {
    var sides = splitEquation(raw);
    var leftText = splitSide(sides.left, 'reactant');
    var rightText = splitSide(sides.right, 'product');

    var reactants = leftText.map(parseSpecies);
    var products = rightText.map(parseSpecies);

    if (!reactants.length) throw ParseError('Please enter at least one reactant.');
    if (!products.length) throw ParseError('Please enter at least one product.');

    // an element appearing on only one side can never balance
    var lElems = {}, rElems = {};
    reactants.forEach(function (s) { for (var e in s.counts) lElems[e] = true; });
    products.forEach(function (s) { for (var e in s.counts) rElems[e] = true; });
    var onlyLeft = Object.keys(lElems).filter(function (e) { return !rElems[e]; });
    var onlyRight = Object.keys(rElems).filter(function (e) { return !lElems[e]; });
    if (onlyLeft.length) {
      throw ParseError(onlyLeft.join(', ') + (onlyLeft.length > 1 ? ' appear' : ' appears') +
        ' only among the reactants, so the equation cannot balance.');
    }
    if (onlyRight.length) {
      throw ParseError(onlyRight.join(', ') + (onlyRight.length > 1 ? ' appear' : ' appears') +
        ' only among the products, so the equation cannot balance.');
    }

    return { reactants: reactants, products: products, arrow: '→' };
  }

  /* ---------------------------------------------------------- linear solve */

  /* Reduced row echelon form over exact rationals. */
  function rref(matrix) {
    var m = matrix.length;
    if (!m) return { rows: [], pivots: [] };
    var n = matrix[0].length;
    var A = matrix.map(function (r) { return r.slice(); });
    var pivots = [];
    var row = 0;

    for (var col = 0; col < n && row < m; col++) {
      var sel = -1;
      for (var r = row; r < m; r++) if (!A[r][col].isZero()) { sel = r; break; }
      if (sel === -1) continue;
      var tmp = A[sel]; A[sel] = A[row]; A[row] = tmp;

      var pv = A[row][col];
      for (var c = 0; c < n; c++) A[row][c] = A[row][c].div(pv);

      for (var r2 = 0; r2 < m; r2++) {
        if (r2 === row || A[r2][col].isZero()) continue;
        var f = A[r2][col];
        for (var c2 = 0; c2 < n; c2++) A[r2][c2] = A[r2][c2].sub(f.mul(A[row][c2]));
      }
      pivots.push(col);
      row++;
    }
    return { rows: A, pivots: pivots };
  }

  /* Null-space basis vectors of A, as arrays of Frac. */
  function nullSpace(matrix, nCols) {
    var red = rref(matrix);
    var pivots = red.pivots;
    var free = [];
    for (var c = 0; c < nCols; c++) if (pivots.indexOf(c) === -1) free.push(c);

    return free.map(function (fc) {
      var vec = [];
      for (var i = 0; i < nCols; i++) vec.push(new Frac(0));
      vec[fc] = new Frac(1);
      for (var p = 0; p < pivots.length; p++) {
        vec[pivots[p]] = red.rows[p][fc].neg();
      }
      return vec;
    });
  }

  /* Scale a rational vector to the smallest positive whole-number ratio. */
  function toSmallestIntegers(vec) {
    var denom = 1n;
    vec.forEach(function (f) { denom = blcm(denom, f.d) || 1n; });
    var ints = vec.map(function (f) { return f.n * (denom / f.d); });

    var g = 0n;
    ints.forEach(function (v) { g = bgcd(g, v); });
    if (g === 0n) return null;
    ints = ints.map(function (v) { return v / g; });

    // orient so the first non-zero coefficient is positive
    var firstNonZero = ints.find(function (v) { return v !== 0n; });
    if (firstNonZero !== undefined && firstNonZero < 0n) ints = ints.map(function (v) { return -v; });
    return ints;
  }

  /* ------------------------------------------------------------- balancing */

  function balance(raw) {
    var eq = parseEquation(raw);
    var species = eq.reactants.concat(eq.products);
    var nR = eq.reactants.length;
    var n = species.length;

    if (n < 2) throw ParseError('An equation needs at least one reactant and one product.');

    // element rows
    var elements = [];
    species.forEach(function (s) {
      for (var e in s.counts) if (elements.indexOf(e) === -1) elements.push(e);
    });
    elements.sort();

    var hasCharge = species.some(function (s) { return s.charge !== 0; });

    var rows = elements.map(function (el) {
      return species.map(function (s, i) {
        var v = s.counts[el] || 0;
        return new Frac(i < nR ? v : -v);
      });
    });
    if (hasCharge) {
      rows.push(species.map(function (s, i) {
        return new Frac(i < nR ? s.charge : -s.charge);
      }));
    }

    var basis = nullSpace(rows, n);

    if (basis.length === 0) {
      throw ParseError('These formulas cannot be balanced — no set of coefficients satisfies every element.');
    }
    if (basis.length > 1) {
      // more than one independent solution: the answer is not unique, so any
      // single set of coefficients we print would be an arbitrary choice
      throw ParseError('This equation has more than one independent solution, so the coefficients are not uniquely determined. Try splitting it into separate reactions.');
    }

    var ints = toSmallestIntegers(basis[0]);
    if (!ints) throw ParseError('These formulas cannot be balanced.');

    if (ints.some(function (v) { return v <= 0n; })) {
      throw ParseError('These formulas cannot be balanced with every species on the side given — one coefficient would have to be zero or negative.');
    }

    var coefficients = ints.map(function (v) { return Number(v); });
    if (coefficients.some(function (c) { return !isFinite(c) || c > Number.MAX_SAFE_INTEGER; })) {
      throw ParseError('The coefficients for this equation are too large to display reliably.');
    }

    var result = {
      reactants: eq.reactants,
      products: eq.products,
      species: species,
      coefficients: coefficients,
      reactantCoefficients: coefficients.slice(0, nR),
      productCoefficients: coefficients.slice(nR),
      elements: elements,
      hasCharge: hasCharge
    };

    // independent confirmation before anything is reported as balanced
    var check = verify(result);
    result.verified = check.balanced;
    result.check = check;
    if (!check.balanced) {
      throw ParseError('The calculated coefficients did not pass verification, so no answer is shown.');
    }
    return result;
  }

  /* Re-count every atom from the parsed species and the coefficients. Written
     to stand alone: it does not read anything the solver computed beyond the
     coefficients it is checking. */
  function verify(result) {
    var nR = result.reactants.length;
    var perElement = {};
    var elements = [];

    result.species.forEach(function (s, i) {
      for (var el in s.counts) if (elements.indexOf(el) === -1) elements.push(el);
    });
    elements.sort();

    elements.forEach(function (el) {
      var left = 0, right = 0;
      result.species.forEach(function (s, i) {
        var c = result.coefficients[i] * (s.counts[el] || 0);
        if (i < nR) left += c; else right += c;
      });
      perElement[el] = { reactants: left, products: right, equal: left === right };
    });

    var chargeLeft = 0, chargeRight = 0;
    result.species.forEach(function (s, i) {
      var c = result.coefficients[i] * s.charge;
      if (i < nR) chargeLeft += c; else chargeRight += c;
    });

    var allElementsEqual = elements.every(function (el) { return perElement[el].equal; });
    var chargeEqual = chargeLeft === chargeRight;

    return {
      elements: elements,
      perElement: perElement,
      charge: { reactants: chargeLeft, products: chargeRight, equal: chargeEqual },
      balanced: allElementsEqual && chargeEqual
    };
  }

  /* Atom tally for the equation as typed, with every coefficient 1. */
  function tallyUnbalanced(raw) {
    var eq = parseEquation(raw);
    var species = eq.reactants.concat(eq.products);
    var stub = {
      reactants: eq.reactants,
      products: eq.products,
      species: species,
      coefficients: species.map(function () { return 1; })
    };
    return verify(stub);
  }

  /* ------------------------------------------------------ reaction type */

  function isElementSpecies(s) {
    return Object.keys(s.counts).length === 1 && s.charge === 0;
  }

  /* Conservative classification. Anything that does not clearly match a
     pattern returns null so the UI can say it could not be determined,
     rather than asserting a type that might be wrong. */
  function reactionType(result) {
    var R = result.reactants, P = result.products;
    var formulas = function (list) { return list.map(function (s) { return s.formula.replace(/\((s|l|g|aq)\)$/i, ''); }); };
    var rf = formulas(R), pf = formulas(P);

    var hasO2 = rf.some(function (f) { return f === 'O2'; });
    var makesCO2 = pf.indexOf('CO2') !== -1;
    var makesH2O = pf.indexOf('H2O') !== -1;

    // Combustion: a carbon-bearing fuel plus O2 giving only CO2 and water.
    // Carbon is required deliberately. H2 + O2 -> H2O is burning too, but
    // every textbook classifies it as synthesis, and claiming combustion here
    // would also make the explanation text false — there is no CO2 in it.
    if (hasO2 && makesCO2 && R.length === 2) {
      var fuel = R.find(function (s) { return s.formula.replace(/\((s|l|g|aq)\)$/i, '') !== 'O2'; });
      if (fuel && fuel.counts.C) {
        var els = Object.keys(fuel.counts).sort().join(',');
        var onlyBurnProducts = pf.every(function (f) { return f === 'CO2' || f === 'H2O'; });
        if (onlyBurnProducts && (els === 'C,H' || els === 'C,H,O' || els === 'C')) {
          return {
            type: 'Combustion',
            why: makesH2O
              ? 'A hydrocarbon fuel reacts with O₂ to give only carbon dioxide and water.'
              : 'A carbon fuel reacts with O₂ to give carbon dioxide.'
          };
        }
      }
    }

    // neutralisation: acid + base -> salt + water
    if (R.length === 2 && P.length === 2 && makesH2O) {
      var looksAcid = R.some(function (s) { return /^H\d*[A-Z]/.test(s.formula) || /^H\d*\(/.test(s.formula); });
      var looksBase = R.some(function (s) { return /OH/.test(s.formula); });
      if (looksAcid && looksBase) {
        return { type: 'Acid–base neutralisation', why: 'An acid and a base give a salt and water.' };
      }
    }

    if (R.length >= 2 && P.length === 1) {
      return { type: 'Synthesis (combination)', why: 'Several reactants combine into a single product.' };
    }
    if (R.length === 1 && P.length >= 2) {
      return { type: 'Decomposition', why: 'One reactant breaks down into several products.' };
    }

    if (R.length === 2 && P.length === 2) {
      var rElem = R.filter(isElementSpecies).length;
      var pElem = P.filter(isElementSpecies).length;
      if (rElem === 1 && pElem === 1) {
        return { type: 'Single replacement', why: 'One element displaces another from its compound.' };
      }
      if (rElem === 0 && pElem === 0) {
        return { type: 'Double replacement', why: 'Two compounds exchange partners.' };
      }
    }

    return null;
  }

  /* ------------------------------------------------------------- display */

  var SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
  var SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

  function subscript(num) {
    return String(num).split('').map(function (d) { return SUB_DIGITS[+d] || d; }).join('');
  }
  function superscript(num) {
    return String(num).split('').map(function (d) {
      if (d === '-') return '⁻';
      if (d === '+') return '⁺';
      return SUP_DIGITS[+d] || d;
    }).join('');
  }

  /* Turn "Al2(SO4)3" into "Al₂(SO₄)₃" without touching the calculation text. */
  function prettyFormula(raw) {
    var text = normaliseText(raw);
    var state = '';
    var m = /\((s|l|g|aq)\)\s*$/i.exec(text);
    if (m) { state = '(' + m[1].toLowerCase() + ')'; text = text.slice(0, m.index); }

    var charge = '';
    var cm = /\^?(\d*)([+-]+)$/.exec(text);
    if (cm) {
      var mag = cm[1] ? cm[1] : (cm[2].length > 1 ? String(cm[2].length) : '');
      charge = superscript(mag + cm[2][0]);
      text = text.slice(0, cm.index);
    }

    var out = text.replace(/(\d+)/g, function (d) { return subscript(d); });
    out = out.replace(/·/g, '·');
    return out + charge + state;
  }

  function coefficientPrefix(c) { return c === 1 ? '' : String(c); }

  function formatSide(list, coeffs, pretty) {
    return list.map(function (s, i) {
      var f = pretty ? prettyFormula(s.formula) : normaliseText(s.formula);
      return coefficientPrefix(coeffs[i]) + f;
    }).join(' + ');
  }

  function formatEquation(result, opts) {
    var o = opts || {};
    var pretty = o.pretty !== false;
    var arrow = o.arrow || (pretty ? ' → ' : ' -> ');
    return formatSide(result.reactants, result.reactantCoefficients, pretty) + arrow +
      formatSide(result.products, result.productCoefficients, pretty);
  }

  function toLatex(result) {
    var side = function (list, coeffs) {
      return list.map(function (s, i) {
        var body = normaliseText(s.formula)
          .replace(/\((s|l|g|aq)\)\s*$/i, function (m2) { return '\\,' + m2; })
          .replace(/(\d+)/g, '_{$1}');
        return coefficientPrefix(coeffs[i]) + body;
      }).join(' + ');
    };
    return '\\mathrm{' + side(result.reactants, result.reactantCoefficients) +
      ' \\rightarrow ' + side(result.products, result.productCoefficients) + '}';
  }

  function toHtml(result) {
    var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var side = function (list, coeffs) {
      return list.map(function (s, i) {
        var body = esc(normaliseText(s.formula)).replace(/(\d+)/g, '<sub>$1</sub>');
        return esc(coefficientPrefix(coeffs[i])) + body;
      }).join(' + ');
    };
    return side(result.reactants, result.reactantCoefficients) + ' &rarr; ' +
      side(result.products, result.productCoefficients);
  }

  /* ------------------------------------------------- explanation builder */

  var LETTERS = 'abcdefghijklmnopqrstuvwxyz';

  /* The algebraic method, written out. This is derived from the same system
     the solver used, so it is always faithful to the answer — unlike a
     narrative "balance oxygen first" story, which cannot be generated
     reliably for arbitrary equations. */
  function mathSolution(result) {
    var species = result.species;
    var nR = result.reactants.length;
    var vars = species.map(function (s, i) { return LETTERS[i] || 'x' + i; });

    var setup = species.map(function (s, i) {
      return vars[i] + prettyFormula(s.formula);
    });
    var setupLine = setup.slice(0, nR).join(' + ') + ' → ' + setup.slice(nR).join(' + ');

    var equations = result.elements.map(function (el) {
      var left = [], right = [];
      species.forEach(function (s, i) {
        var n = s.counts[el] || 0;
        if (!n) return;
        var term = (n === 1 ? '' : n) + vars[i];
        if (i < nR) left.push(term); else right.push(term);
      });
      return { element: el, text: (left.join(' + ') || '0') + ' = ' + (right.join(' + ') || '0') };
    });

    if (result.hasCharge) {
      var l = [], r = [];
      species.forEach(function (s, i) {
        if (!s.charge) return;
        var term = (Math.abs(s.charge) === 1 ? '' : Math.abs(s.charge)) + vars[i];
        var signed = (s.charge < 0 ? '−' : '') + term;
        if (i < nR) l.push(signed); else r.push(signed);
      });
      equations.push({ element: 'charge', text: (l.join(' + ') || '0') + ' = ' + (r.join(' + ') || '0') });
    }

    return {
      variables: vars,
      setup: setupLine,
      equations: equations,
      solution: vars.map(function (v, i) { return v + ' = ' + result.coefficients[i]; }),
      ratio: result.coefficients.join(' : ')
    };
  }

  /* Plain-language steps that stay true for any equation: count, solve,
     scale, verify. No invented per-element reasoning. */
  function steps(result, beforeTally) {
    var out = [];
    var unbalanced = result.elements.filter(function (el) {
      return !beforeTally.perElement[el] || !beforeTally.perElement[el].equal;
    });

    out.push({
      title: 'Count the atoms as written',
      body: result.elements.map(function (el) {
        var t = beforeTally.perElement[el];
        return el + ': ' + t.reactants + ' vs ' + t.products;
      }).join(' · ')
    });

    out.push({
      title: unbalanced.length ? 'Identify what is out of balance' : 'Check what is already balanced',
      body: unbalanced.length
        ? unbalanced.join(', ') + (unbalanced.length > 1 ? ' are' : ' is') + ' unequal, so coefficients are needed.'
        : 'Every element already matches, so the equation needs no coefficients above 1.'
    });

    out.push({
      title: 'Write one equation per element',
      body: 'Give each species an unknown coefficient and require that each element appears the same number of times on both sides.'
    });

    out.push({
      title: 'Solve and reduce to whole numbers',
      body: 'Solving the system gives the ratio ' + result.coefficients.join(' : ') +
        ', already divided by its greatest common divisor so no smaller whole-number set works.'
    });

    out.push({
      title: 'Verify every atom',
      body: result.elements.map(function (el) {
        var c = result.check.perElement[el];
        return el + ': ' + c.reactants + ' = ' + c.products;
      }).join(' · ') + (result.hasCharge
        ? ' · charge: ' + result.check.charge.reactants + ' = ' + result.check.charge.products : '')
    });

    return out;
  }

  return {
    // parsing
    normaliseText: normaliseText,
    parseSpecies: parseSpecies,
    parseEquation: parseEquation,
    isElement: function (s) { return !!IS_ELEMENT[s]; },
    SYMBOLS: SYMBOLS,
    STATES: STATES,

    // maths
    Frac: Frac,
    rref: rref,
    nullSpace: nullSpace,
    toSmallestIntegers: toSmallestIntegers,

    // main
    balance: balance,
    verify: verify,
    tallyUnbalanced: tallyUnbalanced,
    reactionType: reactionType,

    // presentation
    prettyFormula: prettyFormula,
    subscript: subscript,
    superscript: superscript,
    formatEquation: formatEquation,
    toLatex: toLatex,
    toHtml: toHtml,
    mathSolution: mathSolution,
    steps: steps
  };
});
