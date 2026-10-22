/* ============================================================
   ToolAdda — Percentage Calculator

   The previous version had two mode keys wired to the wrong
   formulas: `xOfY` computed (A ÷ B) × 100 and `xIsWhatPercentOfY`
   computed (A × B) ÷ 100 — each doing the other's job. The visible
   cards had been relabelled to match the wrong formulas, so the
   arithmetic looked right on screen while the saved history read
   "What is X% of Y?: 25.00%". Dividing by zero printed "Infinity%"
   straight into the result box, and the Copy and Print buttons had
   no handlers at all.

   This rewrite puts every mode behind one pure function that
   returns a single authoritative result object. The headline, the
   formula line, the steps, the visual and the copy text are all
   rendered from that one object, so they cannot disagree.

   Layout:
     1.  Number helpers (float-noise removal, rounding, formatting)
     2.  Validation
     3.  Mode registry
     4.  The thirteen calculators
     5.  calculate() — the single entry point
     6.  Copy text
     7.  Engine export
     8.  UI state + DOM
     9.  Rendering
     10. Actions
     11. Events + init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. Number helpers

     Percentage arithmetic produces float noise constantly:
     (8.75 / 100) * 800 is 70.00000000000001, and (1/3) * 100 is
     33.33333333333333. Every value is passed through clean() before
     it is rounded or displayed.
     ============================================================ */

  var MAX_VALUE = 1e15;

  /* Snaps a float back to the decimal value it is obviously meant to
     be, without changing genuinely distinct numbers. */
  function clean(n) {
    if (!isFinite(n)) return n;
    var r = Math.round(n * 1e10) / 1e10;
    return Object.is(r, -0) ? 0 : r;
  }

  function roundTo(n, dp) {
    if (!isFinite(n)) return n;
    var f = Math.pow(10, dp);
    /* The epsilon nudge fixes the classic 1.005 -> 1.00 rounding
       error, where the stored double is a hair below the decimal. */
    var r = Math.round((n + Number.EPSILON * Math.abs(n)) * f) / f;
    return Object.is(r, -0) ? 0 : r;
  }

  /* 'auto' keeps up to 6 decimals and trims trailing zeros, so 50
     shows as 50 and 33.333333 stays useful. */
  function applyPrecision(n, precision) {
    var v = clean(n);
    if (!isFinite(v)) return v;
    if (precision === 'auto') return roundTo(v, 6);
    return roundTo(v, precision);
  }

  var numberFormatters = {};

  /* Precision is a maximum, not a minimum: 50 shows as "50", not
     "50.00". Padding whole numbers is a currency convention and
     turns "25% of 200 is 50" into "25.00% of 200.00 is 50.00".
     Currency formatting opts back in via minDp. */
  function formatNumber(n, precision, locale, minDp) {
    var v = applyPrecision(n, precision);
    if (!isFinite(v)) return '0';
    var loc = locale || 'en-IN';
    var maxDp = precision === 'auto' ? 6 : precision;
    var minimum = minDp === undefined ? 0 : Math.min(minDp, maxDp);
    var key = loc + '|' + minimum + '|' + maxDp;
    try {
      if (!numberFormatters[key]) {
        numberFormatters[key] = new Intl.NumberFormat(loc, {
          minimumFractionDigits: minimum, maximumFractionDigits: maxDp
        });
      }
      return numberFormatters[key].format(v);
    } catch (e) {
      return String(precision === 'auto' ? v : v.toFixed(maxDp));
    }
  }

  var CURRENCIES = {
    INR: { symbol: '₹', locale: 'en-IN', label: 'Indian Rupee' },
    USD: { symbol: '$', locale: 'en-US', label: 'US Dollar' },
    EUR: { symbol: '€', locale: 'en-IE', label: 'Euro' },
    GBP: { symbol: '£', locale: 'en-GB', label: 'Pound Sterling' }
  };

  function formatCurrency(n, precision, currency) {
    var c = CURRENCIES[currency] || CURRENCIES.INR;
    var dp = precision === 'auto' ? 2 : precision;
    var v = applyPrecision(n, dp);
    var sign = v < 0 ? '-' : '';
    /* Money pads to its full precision — ₹1,600.00, not ₹1,600. */
    return sign + c.symbol + formatNumber(Math.abs(v), dp, c.locale, dp);
  }

  function formatPercent(n, precision) {
    return formatNumber(n, precision === 'auto' ? 'auto' : precision) + '%';
  }

  /* Signed display so direction never depends on colour alone. */
  function formatSigned(n, precision) {
    var v = applyPrecision(n, precision);
    if (v > 0) return '+' + formatNumber(v, precision) + '%';
    if (v < 0) return '−' + formatNumber(Math.abs(v), precision) + '%';
    return '0%';
  }

  /* ============================================================
     2. Validation
     ============================================================ */

  function invalid(field, message) {
    return { ok: false, field: field, message: message };
  }

  /* Percentages above 100, below 0 and with decimals are all
     mathematically legitimate, so none of them are rejected. Only
     genuinely unusable input is. */
  function parseValue(raw, field, label) {
    if (raw === null || raw === undefined) return invalid(field, 'Enter ' + label + '.');
    var text = String(raw).replace(/[\s,₹$€£%]/g, '');
    if (!text) return invalid(field, 'Enter ' + label + '.');
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-' || text === '-.') {
      return invalid(field, 'Enter ' + label + ' using digits only.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid(field, 'Enter ' + label + ' using digits only.');
    if (Math.abs(value) > MAX_VALUE) {
      return invalid(field, cap(label) + ' is too large to calculate accurately.');
    }
    return { ok: true, value: value };
  }

  function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

  /* ============================================================
     3. Mode registry

     Each mode declares its own fields and labels so the UI never
     hard-codes a question or a unit.
     ============================================================ */

  var MODES = {
    percentOf: {
      id: 'percentOf', group: 'core',
      title: 'Percentage of a number',
      question: 'What is X% of Y?',
      fields: [
        { key: 'a', label: 'Percentage', unit: '%', placeholder: '25', example: 25 },
        { key: 'b', label: 'Of number', unit: '', placeholder: '200', example: 200 }
      ],
      formula: 'Result = (X ÷ 100) × Y'
    },
    whatPercent: {
      id: 'whatPercent', group: 'core',
      title: 'What percentage?',
      question: 'X is what percent of Y?',
      fields: [
        { key: 'a', label: 'Part', unit: '', placeholder: '50', example: 50 },
        { key: 'b', label: 'Whole', unit: '', placeholder: '200', example: 200 }
      ],
      formula: 'Percentage = (Part ÷ Whole) × 100'
    },
    reversePercent: {
      id: 'reversePercent', group: 'core',
      title: 'Reverse percentage',
      question: 'X is Y% of what number?',
      fields: [
        { key: 'a', label: 'Known value', unit: '', placeholder: '50', example: 50 },
        { key: 'b', label: 'Is this percent', unit: '%', placeholder: '25', example: 25 }
      ],
      formula: 'Whole = Part ÷ (Percentage ÷ 100)'
    },
    change: {
      id: 'change', group: 'change',
      title: 'Percentage change',
      question: 'What is the percentage change from X to Y?',
      fields: [
        { key: 'a', label: 'Original value', unit: '', placeholder: '100', example: 100 },
        { key: 'b', label: 'New value', unit: '', placeholder: '125', example: 125 }
      ],
      formula: 'Change = ((New − Original) ÷ |Original|) × 100'
    },
    difference: {
      id: 'difference', group: 'change',
      title: 'Percentage difference',
      question: 'What is the percentage difference between X and Y?',
      fields: [
        { key: 'a', label: 'First value', unit: '', placeholder: '100', example: 100 },
        { key: 'b', label: 'Second value', unit: '', placeholder: '120', example: 120 }
      ],
      formula: 'Difference = |A − B| ÷ ((A + B) ÷ 2) × 100'
    },
    increaseBy: {
      id: 'increaseBy', group: 'change',
      title: 'Add a percentage',
      question: 'Increase X by Y%',
      fields: [
        { key: 'a', label: 'Number', unit: '', placeholder: '100', example: 100 },
        { key: 'b', label: 'Increase by', unit: '%', placeholder: '25', example: 25 }
      ],
      formula: 'Result = X × (1 + Y ÷ 100)'
    },
    decreaseBy: {
      id: 'decreaseBy', group: 'change',
      title: 'Subtract a percentage',
      question: 'Decrease X by Y%',
      fields: [
        { key: 'a', label: 'Number', unit: '', placeholder: '100', example: 100 },
        { key: 'b', label: 'Decrease by', unit: '%', placeholder: '25', example: 25 }
      ],
      formula: 'Result = X × (1 − Y ÷ 100)'
    },
    discount: {
      id: 'discount', group: 'money', currency: true,
      title: 'Discount',
      question: 'What is the price after a discount?',
      fields: [
        { key: 'a', label: 'Original price', unit: 'currency', placeholder: '2000', example: 2000 },
        { key: 'b', label: 'Discount', unit: '%', placeholder: '20', example: 20 }
      ],
      formula: 'Final = Original × (1 − Discount ÷ 100)'
    },
    reverseDiscount: {
      id: 'reverseDiscount', group: 'money', currency: true,
      title: 'Original price before discount',
      question: 'After a discount, the price is X. What was it before?',
      fields: [
        { key: 'a', label: 'Price after discount', unit: 'currency', placeholder: '800', example: 800 },
        { key: 'b', label: 'Discount applied', unit: '%', placeholder: '20', example: 20 }
      ],
      formula: 'Original = Final ÷ (1 − Discount ÷ 100)'
    },
    markup: {
      id: 'markup', group: 'money', currency: true,
      title: 'Markup',
      question: 'What selling price gives this markup on cost?',
      fields: [
        { key: 'a', label: 'Cost', unit: 'currency', placeholder: '1000', example: 1000 },
        { key: 'b', label: 'Markup', unit: '%', placeholder: '25', example: 25 }
      ],
      formula: 'Selling price = Cost × (1 + Markup ÷ 100)'
    },
    margin: {
      id: 'margin', group: 'money', currency: true,
      title: 'Profit margin',
      question: 'What margin does this cost and selling price give?',
      fields: [
        { key: 'a', label: 'Cost', unit: 'currency', placeholder: '1000', example: 1000 },
        { key: 'b', label: 'Selling price', unit: 'currency', placeholder: '1250', example: 1250 }
      ],
      formula: 'Margin = (Selling price − Cost) ÷ Selling price × 100'
    },
    addTax: {
      id: 'addTax', group: 'money', currency: true,
      title: 'Add tax',
      question: 'What is the total after adding tax?',
      fields: [
        { key: 'a', label: 'Amount before tax', unit: 'currency', placeholder: '1000', example: 1000 },
        { key: 'b', label: 'Tax rate', unit: '%', placeholder: '18', example: 18 }
      ],
      formula: 'Total = Amount × (1 + Tax ÷ 100)'
    },
    removeTax: {
      id: 'removeTax', group: 'money', currency: true,
      title: 'Remove tax',
      question: 'How much tax is inside a tax-inclusive amount?',
      fields: [
        { key: 'a', label: 'Amount including tax', unit: 'currency', placeholder: '1180', example: 1180 },
        { key: 'b', label: 'Tax rate', unit: '%', placeholder: '18', example: 18 }
      ],
      formula: 'Before tax = Total ÷ (1 + Tax ÷ 100)'
    }
  };

  var MODE_ORDER = [
    'percentOf', 'whatPercent', 'reversePercent',
    'change', 'difference', 'increaseBy', 'decreaseBy',
    'discount', 'reverseDiscount', 'markup', 'margin', 'addTax', 'removeTax'
  ];

  var GROUP_LABELS = {
    core: 'Percentage basics',
    change: 'Change & comparison',
    money: 'Money & business'
  };

  /* ============================================================
     4. The thirteen calculators

     Each returns { primary, secondary, calculation, steps, visual }
     and never a bare number, so the UI has everything it needs from
     one call.
     ============================================================ */

  function num(v, p) { return formatNumber(v, p); }

  var CALCULATORS = {

    percentOf: function (a, b, o) {
      var result = clean((a / 100) * b);
      return {
        primary: { label: num(a, o.p) + '% of ' + num(b, o.p), value: result, type: 'number' },
        secondary: [
          { label: 'As a decimal multiplier', value: clean(a / 100), type: 'number' },
          { label: 'Remaining', value: clean(b - result), type: 'number' }
        ],
        calculation: '(' + num(a, o.p) + ' ÷ 100) × ' + num(b, o.p) + ' = ' + num(result, o.p),
        sentence: num(a, o.p) + '% of ' + num(b, o.p) + ' is ' + num(result, o.p) + '.',
        steps: [
          'Convert ' + num(a, o.p) + '% to a decimal: ' + num(a, o.p) + ' ÷ 100 = ' + num(a / 100, 'auto'),
          'Multiply by the number: ' + num(a / 100, 'auto') + ' × ' + num(b, o.p) + ' = ' + num(result, o.p),
          'Result: ' + num(result, o.p)
        ],
        visual: { type: 'proportion', part: result, whole: b, percent: a }
      };
    },

    whatPercent: function (a, b, o) {
      if (b === 0) {
        return { error: 'The whole cannot be zero — nothing can be a percentage of nothing. Enter a whole value other than 0.' };
      }
      var pct = clean((a / b) * 100);
      return {
        primary: { label: num(a, o.p) + ' out of ' + num(b, o.p), value: pct, type: 'percent' },
        secondary: [
          { label: 'As a decimal', value: clean(a / b), type: 'number' },
          { label: 'Remaining', value: clean(b - a), type: 'number' },
          { label: 'Remaining share', value: clean(100 - pct), type: 'percent' }
        ],
        calculation: '(' + num(a, o.p) + ' ÷ ' + num(b, o.p) + ') × 100 = ' + num(pct, o.p) + '%',
        sentence: num(a, o.p) + ' is ' + num(pct, o.p) + '% of ' + num(b, o.p) + '.',
        steps: [
          'Divide the part by the whole: ' + num(a, o.p) + ' ÷ ' + num(b, o.p) + ' = ' + num(a / b, 'auto'),
          'Multiply by 100: ' + num(a / b, 'auto') + ' × 100 = ' + num(pct, o.p),
          'Result: ' + num(pct, o.p) + '%'
        ],
        visual: { type: 'proportion', part: a, whole: b, percent: pct }
      };
    },

    reversePercent: function (a, b, o) {
      if (b === 0) {
        return { error: 'The percentage cannot be zero — no whole number has 0% equal to a non-zero value. Enter a percentage other than 0.' };
      }
      var whole = clean(a / (b / 100));
      return {
        primary: { label: 'The whole number', value: whole, type: 'number' },
        secondary: [
          { label: 'The part you entered', value: a, type: 'number' },
          { label: 'Rest of the whole', value: clean(whole - a), type: 'number' }
        ],
        calculation: num(a, o.p) + ' ÷ (' + num(b, o.p) + ' ÷ 100) = ' + num(whole, o.p),
        sentence: num(a, o.p) + ' is ' + num(b, o.p) + '% of ' + num(whole, o.p) + '.',
        steps: [
          'Convert ' + num(b, o.p) + '% to a decimal: ' + num(b, o.p) + ' ÷ 100 = ' + num(b / 100, 'auto'),
          'Divide the known value by it: ' + num(a, o.p) + ' ÷ ' + num(b / 100, 'auto') + ' = ' + num(whole, o.p),
          'Result: ' + num(whole, o.p)
        ],
        visual: { type: 'proportion', part: a, whole: whole, percent: b }
      };
    },

    change: function (a, b, o) {
      if (a === 0) {
        return { error: 'Percentage change from zero is undefined — any increase from 0 is infinitely large in percentage terms. Compare the absolute difference instead.' };
      }
      /* Dividing by |original| rather than original keeps the sign
         meaningful when the starting value is negative: −100 → −50
         is an improvement and reads as +50%, not −50%. */
      var pct = clean(((b - a) / Math.abs(a)) * 100);
      var diff = clean(b - a);
      var dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'none';
      return {
        primary: {
          label: dir === 'up' ? 'Increase' : dir === 'down' ? 'Decrease' : 'No change',
          value: Math.abs(pct), type: 'percent', signed: pct, direction: dir
        },
        secondary: [
          { label: 'Absolute change', value: diff, type: 'number' },
          { label: 'From', value: a, type: 'number' },
          { label: 'To', value: b, type: 'number' },
          { label: 'Multiplier', value: clean(b / a), type: 'number' }
        ],
        calculation: '((' + num(b, o.p) + ' − ' + num(a, o.p) + ') ÷ ' + num(Math.abs(a), o.p) + ') × 100 = ' + formatSigned(pct, o.p),
        sentence: dir === 'none'
          ? 'There is no change between ' + num(a, o.p) + ' and ' + num(b, o.p) + '.'
          : num(a, o.p) + ' to ' + num(b, o.p) + ' is a ' + num(Math.abs(pct), o.p) + '% ' +
            (dir === 'up' ? 'increase' : 'decrease') + '.',
        steps: [
          'Find the difference: ' + num(b, o.p) + ' − ' + num(a, o.p) + ' = ' + num(diff, o.p),
          'Divide by the original value: ' + num(diff, o.p) + ' ÷ ' + num(Math.abs(a), o.p) + ' = ' + num(diff / Math.abs(a), 'auto'),
          'Multiply by 100: ' + formatSigned(pct, o.p),
          'Result: a ' + num(Math.abs(pct), o.p) + '% ' + (dir === 'up' ? 'increase' : dir === 'down' ? 'decrease' : 'change')
        ],
        visual: { type: 'beforeAfter', before: a, after: b, percent: pct, direction: dir },
        note: a < 0 ? 'The original value is negative, so the change is measured against its magnitude. A move towards zero reads as an increase.' : ''
      };
    },

    difference: function (a, b, o) {
      var average = (a + b) / 2;
      if (average === 0) {
        return { error: 'Percentage difference needs a non-zero average. These two values average to zero, so there is nothing to compare against.' };
      }
      var diff = Math.abs(a - b);
      var pct = clean((diff / Math.abs(average)) * 100);
      return {
        primary: { label: 'Percentage difference', value: pct, type: 'percent' },
        secondary: [
          { label: 'Absolute difference', value: clean(diff), type: 'number' },
          { label: 'Average of the two', value: clean(average), type: 'number' },
          { label: 'Change from first to second', value: a === 0 ? null : clean(((b - a) / Math.abs(a)) * 100), type: 'percent' }
        ],
        calculation: '|' + num(a, o.p) + ' − ' + num(b, o.p) + '| ÷ ((' + num(a, o.p) + ' + ' + num(b, o.p) + ') ÷ 2) × 100 = ' + num(pct, o.p) + '%',
        sentence: 'The percentage difference between ' + num(a, o.p) + ' and ' + num(b, o.p) + ' is ' + num(pct, o.p) + '%.',
        steps: [
          'Find the absolute difference: |' + num(a, o.p) + ' − ' + num(b, o.p) + '| = ' + num(diff, o.p),
          'Find the average: (' + num(a, o.p) + ' + ' + num(b, o.p) + ') ÷ 2 = ' + num(average, o.p),
          'Divide and multiply by 100: ' + num(diff, o.p) + ' ÷ ' + num(Math.abs(average), o.p) + ' × 100 = ' + num(pct, o.p) + '%',
          'Result: ' + num(pct, o.p) + '%'
        ],
        visual: { type: 'twoBars', a: a, b: b, average: average },
        note: 'Percentage difference compares two values against their average and has no direction. It is not the same as percentage change, which measures a move from a specific starting point.'
      };
    },

    increaseBy: function (a, b, o) {
      var amount = clean((a * b) / 100);
      var result = clean(a + amount);
      return {
        primary: { label: 'Result after increase', value: result, type: 'number' },
        secondary: [
          { label: 'Original', value: a, type: 'number' },
          { label: 'Increase amount', value: amount, type: 'number' },
          { label: 'Multiplier', value: clean(1 + b / 100), type: 'number' }
        ],
        calculation: num(a, o.p) + ' × (1 + ' + num(b, o.p) + ' ÷ 100) = ' + num(result, o.p),
        sentence: num(a, o.p) + ' increased by ' + num(b, o.p) + '% is ' + num(result, o.p) + '.',
        steps: [
          'Find the increase: ' + num(a, o.p) + ' × ' + num(b, o.p) + ' ÷ 100 = ' + num(amount, o.p),
          'Add it to the original: ' + num(a, o.p) + ' + ' + num(amount, o.p) + ' = ' + num(result, o.p),
          'Result: ' + num(result, o.p)
        ],
        visual: { type: 'beforeAfter', before: a, after: result, percent: b, direction: b >= 0 ? 'up' : 'down' }
      };
    },

    decreaseBy: function (a, b, o) {
      var amount = clean((a * b) / 100);
      var result = clean(a - amount);
      return {
        primary: { label: 'Result after decrease', value: result, type: 'number' },
        secondary: [
          { label: 'Original', value: a, type: 'number' },
          { label: 'Decrease amount', value: amount, type: 'number' },
          { label: 'Multiplier', value: clean(1 - b / 100), type: 'number' }
        ],
        calculation: num(a, o.p) + ' × (1 − ' + num(b, o.p) + ' ÷ 100) = ' + num(result, o.p),
        sentence: num(a, o.p) + ' decreased by ' + num(b, o.p) + '% is ' + num(result, o.p) + '.',
        steps: [
          'Find the decrease: ' + num(a, o.p) + ' × ' + num(b, o.p) + ' ÷ 100 = ' + num(amount, o.p),
          'Subtract it from the original: ' + num(a, o.p) + ' − ' + num(amount, o.p) + ' = ' + num(result, o.p),
          'Result: ' + num(result, o.p)
        ],
        visual: { type: 'beforeAfter', before: a, after: result, percent: -b, direction: b >= 0 ? 'down' : 'up' },
        note: b > 100 ? 'A decrease of more than 100% takes the value below zero. That is arithmetically correct but rarely what a price or quantity means.' : ''
      };
    },

    discount: function (a, b, o) {
      var amount = clean((a * b) / 100);
      var final = clean(a - amount);
      return {
        primary: { label: 'Price after discount', value: final, type: 'currency' },
        secondary: [
          { label: 'Original price', value: a, type: 'currency' },
          { label: 'You save', value: amount, type: 'currency' },
          { label: 'You pay', value: clean(100 - b), type: 'percent' }
        ],
        calculation: num(a, o.p) + ' × (1 − ' + num(b, o.p) + ' ÷ 100) = ' + num(final, o.p),
        sentence: 'A ' + num(b, o.p) + '% discount on ' + formatCurrency(a, o.p, o.currency) +
          ' saves ' + formatCurrency(amount, o.p, o.currency) + ', bringing the price to ' +
          formatCurrency(final, o.p, o.currency) + '.',
        steps: [
          'Find the discount: ' + num(a, o.p) + ' × ' + num(b, o.p) + ' ÷ 100 = ' + num(amount, o.p),
          'Subtract it from the price: ' + num(a, o.p) + ' − ' + num(amount, o.p) + ' = ' + num(final, o.p),
          'Result: ' + num(final, o.p)
        ],
        visual: { type: 'beforeAfter', before: a, after: final, percent: -b, direction: 'down', currency: true },
        note: b > 100 ? 'A discount above 100% produces a negative price. Check the discount you entered.' : ''
      };
    },

    reverseDiscount: function (a, b, o) {
      if (b === 100) {
        return { error: 'A 100% discount means the item was free, so the original price cannot be worked back from the final price.' };
      }
      var factor = 1 - b / 100;
      if (factor === 0) {
        return { error: 'That discount leaves nothing to divide by. Enter a discount below 100%.' };
      }
      var original = clean(a / factor);
      var saved = clean(original - a);
      return {
        primary: { label: 'Original price', value: original, type: 'currency' },
        secondary: [
          { label: 'Price after discount', value: a, type: 'currency' },
          { label: 'Amount discounted', value: saved, type: 'currency' },
          { label: 'Discount applied', value: b, type: 'percent' }
        ],
        calculation: num(a, o.p) + ' ÷ (1 − ' + num(b, o.p) + ' ÷ 100) = ' + num(original, o.p),
        sentence: formatCurrency(a, o.p, o.currency) + ' after a ' + num(b, o.p) + '% discount means the original price was ' +
          formatCurrency(original, o.p, o.currency) + '.',
        steps: [
          'Work out what fraction of the price you paid: 1 − ' + num(b, o.p) + ' ÷ 100 = ' + num(factor, 'auto'),
          'Divide the final price by it: ' + num(a, o.p) + ' ÷ ' + num(factor, 'auto') + ' = ' + num(original, o.p),
          'Result: ' + num(original, o.p)
        ],
        visual: { type: 'beforeAfter', before: original, after: a, percent: -b, direction: 'down', currency: true },
        note: 'Dividing by (1 − discount) is the correct reversal. Adding the discount percentage back to the final price gives the wrong answer.'
      };
    },

    markup: function (a, b, o) {
      var amount = clean((a * b) / 100);
      var selling = clean(a + amount);
      var marginPct = selling === 0 ? null : clean((amount / selling) * 100);
      return {
        primary: { label: 'Selling price', value: selling, type: 'currency' },
        secondary: [
          { label: 'Cost', value: a, type: 'currency' },
          { label: 'Markup amount', value: amount, type: 'currency' },
          { label: 'Equivalent profit margin', value: marginPct, type: 'percent' }
        ],
        calculation: num(a, o.p) + ' × (1 + ' + num(b, o.p) + ' ÷ 100) = ' + num(selling, o.p),
        sentence: 'A ' + num(b, o.p) + '% markup on a cost of ' + formatCurrency(a, o.p, o.currency) +
          ' gives a selling price of ' + formatCurrency(selling, o.p, o.currency) + '.',
        steps: [
          'Find the markup: ' + num(a, o.p) + ' × ' + num(b, o.p) + ' ÷ 100 = ' + num(amount, o.p),
          'Add it to the cost: ' + num(a, o.p) + ' + ' + num(amount, o.p) + ' = ' + num(selling, o.p),
          'Result: ' + num(selling, o.p)
        ],
        visual: { type: 'beforeAfter', before: a, after: selling, percent: b, direction: 'up', currency: true },
        note: 'Markup is measured against cost; margin is measured against the selling price. A ' + num(b, o.p) +
          '% markup is a ' + (marginPct === null ? '—' : num(marginPct, o.p)) + '% margin, not the same number.'
      };
    },

    margin: function (a, b, o) {
      if (b === 0) {
        return { error: 'Profit margin is measured against the selling price, so the selling price cannot be zero.' };
      }
      var profit = clean(b - a);
      var marginPct = clean((profit / b) * 100);
      var markupPct = a === 0 ? null : clean((profit / a) * 100);
      return {
        primary: { label: 'Profit margin', value: marginPct, type: 'percent' },
        secondary: [
          { label: 'Profit', value: profit, type: 'currency' },
          { label: 'Cost', value: a, type: 'currency' },
          { label: 'Equivalent markup', value: markupPct, type: 'percent' }
        ],
        calculation: '(' + num(b, o.p) + ' − ' + num(a, o.p) + ') ÷ ' + num(b, o.p) + ' × 100 = ' + num(marginPct, o.p) + '%',
        sentence: 'Selling at ' + formatCurrency(b, o.p, o.currency) + ' on a cost of ' +
          formatCurrency(a, o.p, o.currency) + ' gives a profit of ' + formatCurrency(profit, o.p, o.currency) +
          ' and a margin of ' + num(marginPct, o.p) + '%.',
        steps: [
          'Find the profit: ' + num(b, o.p) + ' − ' + num(a, o.p) + ' = ' + num(profit, o.p),
          'Divide by the selling price: ' + num(profit, o.p) + ' ÷ ' + num(b, o.p) + ' = ' + num(profit / b, 'auto'),
          'Multiply by 100: ' + num(marginPct, o.p) + '%',
          'Result: ' + num(marginPct, o.p) + '%'
        ],
        visual: { type: 'stack', cost: a, profit: profit, total: b },
        note: 'Margin divides profit by the selling price. Markup divides the same profit by the cost, which is why markup is always the larger number.'
      };
    },

    addTax: function (a, b, o) {
      var taxAmount = clean((a * b) / 100);
      var total = clean(a + taxAmount);
      return {
        primary: { label: 'Total including tax', value: total, type: 'currency' },
        secondary: [
          { label: 'Amount before tax', value: a, type: 'currency' },
          { label: 'Tax at ' + num(b, o.p) + '%', value: taxAmount, type: 'currency' }
        ],
        calculation: num(a, o.p) + ' × (1 + ' + num(b, o.p) + ' ÷ 100) = ' + num(total, o.p),
        sentence: formatCurrency(a, o.p, o.currency) + ' plus ' + num(b, o.p) + '% tax is ' +
          formatCurrency(total, o.p, o.currency) + '.',
        steps: [
          'Find the tax: ' + num(a, o.p) + ' × ' + num(b, o.p) + ' ÷ 100 = ' + num(taxAmount, o.p),
          'Add it to the amount: ' + num(a, o.p) + ' + ' + num(taxAmount, o.p) + ' = ' + num(total, o.p),
          'Result: ' + num(total, o.p)
        ],
        visual: { type: 'stack', cost: a, profit: taxAmount, total: total }
      };
    },

    removeTax: function (a, b, o) {
      var factor = 1 + b / 100;
      if (factor === 0) {
        return { error: 'A tax rate of −100% leaves nothing to divide by. Enter a different rate.' };
      }
      var base = clean(a / factor);
      var taxAmount = clean(a - base);
      return {
        primary: { label: 'Amount before tax', value: base, type: 'currency' },
        secondary: [
          { label: 'Total including tax', value: a, type: 'currency' },
          { label: 'Tax inside the total', value: taxAmount, type: 'currency' },
          { label: 'Tax as a share of the total', value: a === 0 ? null : clean((taxAmount / a) * 100), type: 'percent' }
        ],
        calculation: num(a, o.p) + ' ÷ (1 + ' + num(b, o.p) + ' ÷ 100) = ' + num(base, o.p),
        sentence: formatCurrency(a, o.p, o.currency) + ' including ' + num(b, o.p) + '% tax contains ' +
          formatCurrency(base, o.p, o.currency) + ' before tax and ' + formatCurrency(taxAmount, o.p, o.currency) + ' of tax.',
        steps: [
          'Add 1 to the rate as a decimal: 1 + ' + num(b, o.p) + ' ÷ 100 = ' + num(factor, 'auto'),
          'Divide the total by it: ' + num(a, o.p) + ' ÷ ' + num(factor, 'auto') + ' = ' + num(base, o.p),
          'The rest is tax: ' + num(a, o.p) + ' − ' + num(base, o.p) + ' = ' + num(taxAmount, o.p),
          'Result: ' + num(base, o.p) + ' before tax'
        ],
        visual: { type: 'stack', cost: base, profit: taxAmount, total: a },
        note: 'Taking ' + num(b, o.p) + '% of the tax-inclusive total would overstate the tax. The total has to be divided, not multiplied.'
      };
    }
  };

  /* ============================================================
     5. calculate() — the single entry point

     Every part of the UI renders from this one object.
     ============================================================ */

  function calculate(modeId, inputs, options) {
    var mode = MODES[modeId];
    if (!mode) return { ok: false, message: 'Unknown calculation mode.' };

    var opts = options || {};
    var precision = opts.precision === undefined ? 2 : opts.precision;
    if (precision !== 'auto') {
      precision = Math.max(0, Math.min(6, parseInt(precision, 10) || 0));
    }
    var currency = CURRENCIES[opts.currency] ? opts.currency : 'INR';

    var parsedA = parseValue(inputs.a, 'a', fieldLabel(mode, 0));
    if (!parsedA.ok) return { ok: false, field: 'a', message: parsedA.message };
    var parsedB = parseValue(inputs.b, 'b', fieldLabel(mode, 1));
    if (!parsedB.ok) return { ok: false, field: 'b', message: parsedB.message };

    var o = { p: precision, currency: currency };
    var out = CALCULATORS[modeId](parsedA.value, parsedB.value, o);

    if (out.error) {
      return { ok: false, field: null, message: out.error, mode: modeId };
    }

    return {
      ok: true,
      mode: modeId,
      modeTitle: mode.title,
      question: mode.question,
      isCurrency: !!mode.currency,
      precision: precision,
      currency: currency,
      inputs: { a: parsedA.value, b: parsedB.value },
      primary: out.primary,
      secondary: (out.secondary || []).filter(function (s) { return s.value !== null && s.value !== undefined; }),
      formula: mode.formula,
      calculation: out.calculation,
      sentence: out.sentence,
      steps: out.steps || [],
      visual: out.visual || null,
      note: out.note || ''
    };
  }

  function fieldLabel(mode, index) {
    var f = mode.fields[index];
    return 'a value for ' + (f ? f.label.toLowerCase() : 'this field');
  }

  /* Formats a result value according to its declared type, so the
     same number never appears as a bare figure in one place and a
     currency in another. */
  function displayValue(entry, result) {
    if (entry.value === null || entry.value === undefined) return '—';
    if (entry.type === 'percent') return formatPercent(entry.value, result.precision);
    if (entry.type === 'currency' && result.isCurrency) {
      return formatCurrency(entry.value, result.precision, result.currency);
    }
    return formatNumber(entry.value, result.precision);
  }

  /* ============================================================
     6. Copy text
     ============================================================ */

  function resultToText(result) {
    if (!result.ok) return result.message;
    var lines = [
      'Percentage Calculation',
      '',
      result.question,
      '',
      result.primary.label + ': ' + displayValue(result.primary, result)
    ];
    result.secondary.forEach(function (s) {
      lines.push(s.label + ': ' + displayValue(s, result));
    });
    lines.push('');
    lines.push('Formula:      ' + result.formula);
    lines.push('Calculation:  ' + result.calculation);
    lines.push('');
    lines.push(result.sentence);
    lines.push('');
    lines.push('Calculated with tooladda.online/calculators/percentage-calculator.html');
    return lines.join('\n');
  }

  /* ============================================================
     7. Engine export
     ============================================================ */

  var engine = {
    MODES: MODES,
    MODE_ORDER: MODE_ORDER,
    GROUP_LABELS: GROUP_LABELS,
    CURRENCIES: CURRENCIES,
    MAX_VALUE: MAX_VALUE,
    clean: clean,
    roundTo: roundTo,
    applyPrecision: applyPrecision,
    formatNumber: formatNumber,
    formatCurrency: formatCurrency,
    formatPercent: formatPercent,
    formatSigned: formatSigned,
    parseValue: parseValue,
    calculate: calculate,
    displayValue: displayValue,
    resultToText: resultToText
  };

  globalScope.ToolAddaPercent = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     8. UI state + DOM
     ============================================================ */

  var PREFS_KEY = 'tooladda-percent-prefs';
  var HISTORY_KEY = 'tooladda-percent-history';

  var QUICK_PERCENTS = [5, 10, 12.5, 15, 20, 25, 30, 50, 75, 100];

  /* Common searches, calculated live rather than hard-coded. */
  var EXAMPLES = [
    { mode: 'percentOf', a: 10, b: 500 },
    { mode: 'percentOf', a: 15, b: 2000 },
    { mode: 'percentOf', a: 20, b: 1500 },
    { mode: 'percentOf', a: 25, b: 800 },
    { mode: 'percentOf', a: 30, b: 2500 },
    { mode: 'whatPercent', a: 45, b: 60 },
    { mode: 'change', a: 100, b: 125 },
    { mode: 'discount', a: 2000, b: 20 }
  ];

  var state = {
    mode: 'percentOf',
    a: '25',
    b: '200',
    precision: 2,
    currency: 'INR',
    historyEnabled: false,
    result: null
  };

  var dom = {};
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cacheDom() {
    dom.root = q('[data-pc-app]');
    if (!dom.root) return false;

    dom.modeList = q('[data-pc-modes]', dom.root);
    dom.question = q('[data-pc-question]', dom.root);
    dom.fields = q('[data-pc-fields]', dom.root);
    dom.quick = q('[data-pc-quick]', dom.root);
    dom.swap = q('[data-pc-swap]', dom.root);

    dom.error = q('[data-pc-error]', dom.root);
    dom.results = q('[data-pc-results]', dom.root);
    dom.headlineLabel = q('[data-pc-headline-label]', dom.root);
    dom.headline = q('[data-pc-headline]', dom.root);
    dom.sentence = q('[data-pc-sentence]', dom.root);
    dom.visual = q('[data-pc-visual]', dom.root);
    dom.secondary = q('[data-pc-secondary]', dom.root);
    dom.formula = q('[data-pc-formula]', dom.root);
    dom.calculation = q('[data-pc-calculation]', dom.root);
    dom.steps = q('[data-pc-steps]', dom.root);
    dom.note = q('[data-pc-note]', dom.root);
    dom.status = q('[data-pc-status]', dom.root);

    dom.precision = q('[data-pc-precision]', dom.root);
    dom.currency = q('[data-pc-currency]', dom.root);
    dom.currencyRow = q('[data-pc-currency-row]', dom.root);

    dom.copy = q('[data-pc-copy]', dom.root);
    dom.share = q('[data-pc-share]', dom.root);
    dom.reset = q('[data-pc-reset]', dom.root);

    dom.historyToggle = q('[data-pc-history-toggle]', dom.root);
    dom.historyPanel = q('[data-pc-history-panel]', dom.root);
    dom.historyList = q('[data-pc-history-list]', dom.root);
    dom.historyEmpty = q('[data-pc-history-empty]', dom.root);
    dom.historyClear = q('[data-pc-history-clear]', dom.root);

    /* The examples strip lives in its own section below the console,
       outside [data-pc-app], so it is queried from the document. */
    dom.examples = q('[data-pc-examples]');

    return true;
  }

  /* ============================================================
     9. Rendering
     ============================================================ */

  function announce(message) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.status.textContent = message; }, 450);
  }

  function renderModes() {
    var groups = {};
    MODE_ORDER.forEach(function (id) {
      var m = MODES[id];
      if (!groups[m.group]) groups[m.group] = [];
      groups[m.group].push(m);
    });

    dom.modeList.innerHTML = Object.keys(GROUP_LABELS).map(function (g) {
      if (!groups[g]) return '';
      return '<div class="pc-modegroup"><p class="pc-modegroup__label">' + esc(GROUP_LABELS[g]) + '</p>' +
        '<div class="pc-modegroup__items" role="group" aria-label="' + esc(GROUP_LABELS[g]) + '">' +
        groups[g].map(function (m) {
          var on = m.id === state.mode;
          return '<button type="button" class="pc-mode' + (on ? ' is-on' : '') + '" data-pc-mode="' + m.id +
            '" aria-pressed="' + on + '"><span class="pc-mode__title">' + esc(m.title) + '</span>' +
            '<span class="pc-mode__q">' + esc(m.question) + '</span></button>';
        }).join('') + '</div></div>';
    }).join('');

    /* On narrow screens each group is a sideways-scrolling chip row (see CSS); keep the
       chosen chip in view after re-rendering, without moving the page vertically. */
    if (window.matchMedia && window.matchMedia('(max-width: 940px)').matches) {
      var on = dom.modeList.querySelector('.pc-mode.is-on');
      var row = on && on.parentElement;
      if (row && row.scrollWidth > row.clientWidth) {
        row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
      }
    }
  }

  function renderFields() {
    var mode = MODES[state.mode];
    dom.question.textContent = mode.question;

    dom.fields.innerHTML = mode.fields.map(function (f, i) {
      var key = i === 0 ? 'a' : 'b';
      var value = state[key];
      var unit = f.unit === 'currency'
        ? (CURRENCIES[state.currency] || CURRENCIES.INR).symbol
        : f.unit;
      var unitClass = f.unit === '%' ? 'pc-field__unit--post' : 'pc-field__unit--pre';
      return '<div class="pc-fieldwrap">' +
        '<label class="pc-label" for="pc-input-' + key + '">' + esc(f.label) + '</label>' +
        '<div class="pc-field">' +
        (unit ? '<span class="pc-field__unit ' + unitClass + '" aria-hidden="true">' + esc(unit) + '</span>' : '') +
        '<input class="pc-input' + (unit ? (f.unit === '%' ? ' pc-input--suffix' : ' pc-input--prefix') : '') +
        '" id="pc-input-' + key + '" type="text" inputmode="decimal" autocomplete="off" ' +
        'value="' + esc(value) + '" placeholder="' + esc(f.placeholder) + '" data-pc-input="' + key + '" />' +
        '</div></div>';
    }).join('');

    dom.currencyRow.hidden = !mode.currency;
  }

  function renderQuick() {
    var mode = MODES[state.mode];
    /* The quick chips fill whichever field is a percentage. Modes
       without one (margin, percentage change) get value chips. */
    var pctIndex = mode.fields.findIndex(function (f) { return f.unit === '%'; });
    if (pctIndex === -1) {
      dom.quick.innerHTML = '';
      dom.quick.hidden = true;
      return;
    }
    dom.quick.hidden = false;
    var key = pctIndex === 0 ? 'a' : 'b';
    dom.quick.innerHTML = '<span class="pc-quick__label">Quick ' +
      esc(mode.fields[pctIndex].label.toLowerCase()) + '</span>' +
      QUICK_PERCENTS.map(function (p) {
        return '<button type="button" class="pc-chip" data-pc-quick-value="' + p +
          '" data-pc-quick-key="' + key + '">' + p + '%</button>';
      }).join('');
  }

  function showError(message, field) {
    state.result = null;
    dom.error.hidden = false;
    dom.error.textContent = message;
    dom.results.hidden = true;
    qa('[data-pc-input]', dom.root).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    if (field) {
      var el = q('[data-pc-input="' + field + '"]', dom.root);
      if (el) el.setAttribute('aria-invalid', 'true');
    }
    setActionsEnabled(false);
    announce(message);
  }

  function setActionsEnabled(on) {
    [dom.copy, dom.share].forEach(function (b) { if (b) b.disabled = !on; });
  }

  /* Lightweight CSS bars — no chart library for what is a ratio. */
  function renderVisual(result) {
    var v = result.visual;
    if (!v) { dom.visual.innerHTML = ''; return; }

    function fmt(n) {
      return v.currency || result.isCurrency
        ? formatCurrency(n, result.precision, result.currency)
        : formatNumber(n, result.precision);
    }

    if (v.type === 'proportion') {
      var pct = isFinite(v.percent) ? v.percent : 0;
      var width = Math.max(0, Math.min(100, Math.abs(pct)));
      dom.visual.innerHTML =
        '<div class="pc-visual__bar" role="img" aria-label="' +
        esc(formatNumber(v.part, result.precision) + ' of ' + formatNumber(v.whole, result.precision) +
          ', which is ' + formatNumber(pct, result.precision) + ' percent') + '">' +
        '<span class="pc-visual__fill" style="width:' + width.toFixed(2) + '%"></span></div>' +
        '<div class="pc-visual__legend"><span><b class="pc-swatch pc-swatch--part"></b>Part ' +
        fmt(v.part) + '</span><span><b class="pc-swatch pc-swatch--whole"></b>Whole ' + fmt(v.whole) + '</span>' +
        '<span class="pc-visual__pct">' + formatNumber(pct, result.precision) + '%</span></div>' +
        (Math.abs(pct) > 100 ? '<p class="pc-visual__note">The part is larger than the whole, so the bar is capped at 100%.</p>' : '');
      return;
    }

    if (v.type === 'beforeAfter') {
      var max = Math.max(Math.abs(v.before), Math.abs(v.after)) || 1;
      var wBefore = (Math.abs(v.before) / max) * 100;
      var wAfter = (Math.abs(v.after) / max) * 100;
      var arrow = v.direction === 'up' ? '▲' : v.direction === 'down' ? '▼' : '=';
      var word = v.direction === 'up' ? 'up' : v.direction === 'down' ? 'down' : 'unchanged';
      dom.visual.innerHTML =
        '<div class="pc-ba" role="img" aria-label="' +
        esc('Before ' + fmt(v.before) + ', after ' + fmt(v.after) + ', ' + word + ' by ' +
          formatNumber(Math.abs(v.percent), result.precision) + ' percent') + '">' +
        '<div class="pc-ba__row"><span class="pc-ba__label">Before</span>' +
        '<span class="pc-ba__track"><span class="pc-ba__fill pc-ba__fill--before" style="width:' + wBefore.toFixed(2) + '%"></span></span>' +
        '<strong class="pc-ba__value">' + fmt(v.before) + '</strong></div>' +
        '<div class="pc-ba__delta pc-ba__delta--' + v.direction + '">' +
        '<span aria-hidden="true">' + arrow + '</span> ' +
        formatSigned(v.percent, result.precision) + '</div>' +
        '<div class="pc-ba__row"><span class="pc-ba__label">After</span>' +
        '<span class="pc-ba__track"><span class="pc-ba__fill pc-ba__fill--after" style="width:' + wAfter.toFixed(2) + '%"></span></span>' +
        '<strong class="pc-ba__value">' + fmt(v.after) + '</strong></div>' +
        '</div>';
      return;
    }

    if (v.type === 'twoBars') {
      var m2 = Math.max(Math.abs(v.a), Math.abs(v.b)) || 1;
      dom.visual.innerHTML =
        '<div class="pc-ba" role="img" aria-label="' +
        esc('First value ' + fmt(v.a) + ', second value ' + fmt(v.b) + ', average ' + fmt(v.average)) + '">' +
        '<div class="pc-ba__row"><span class="pc-ba__label">A</span>' +
        '<span class="pc-ba__track"><span class="pc-ba__fill pc-ba__fill--before" style="width:' + ((Math.abs(v.a) / m2) * 100).toFixed(2) + '%"></span></span>' +
        '<strong class="pc-ba__value">' + fmt(v.a) + '</strong></div>' +
        '<div class="pc-ba__row"><span class="pc-ba__label">B</span>' +
        '<span class="pc-ba__track"><span class="pc-ba__fill pc-ba__fill--after" style="width:' + ((Math.abs(v.b) / m2) * 100).toFixed(2) + '%"></span></span>' +
        '<strong class="pc-ba__value">' + fmt(v.b) + '</strong></div>' +
        '<div class="pc-ba__row"><span class="pc-ba__label">Average</span>' +
        '<span class="pc-ba__track"><span class="pc-ba__fill pc-ba__fill--avg" style="width:' + ((Math.abs(v.average) / m2) * 100).toFixed(2) + '%"></span></span>' +
        '<strong class="pc-ba__value">' + fmt(v.average) + '</strong></div>' +
        '</div>';
      return;
    }

    if (v.type === 'stack') {
      var total = Math.abs(v.total) || 1;
      var wCost = Math.max(0, Math.min(100, (Math.abs(v.cost) / total) * 100));
      var wProfit = Math.max(0, Math.min(100 - wCost, (Math.abs(v.profit) / total) * 100));
      dom.visual.innerHTML =
        '<div class="pc-visual__bar pc-visual__bar--stack" role="img" aria-label="' +
        esc('Base ' + fmt(v.cost) + ' plus ' + fmt(v.profit) + ' makes ' + fmt(v.total)) + '">' +
        '<span class="pc-visual__fill" style="width:' + wCost.toFixed(2) + '%"></span>' +
        '<span class="pc-visual__fill pc-visual__fill--add" style="width:' + wProfit.toFixed(2) + '%"></span></div>' +
        '<div class="pc-visual__legend">' +
        '<span><b class="pc-swatch pc-swatch--part"></b>Base ' + fmt(v.cost) + '</span>' +
        '<span><b class="pc-swatch pc-swatch--add"></b>Added ' + fmt(v.profit) + '</span>' +
        '<span class="pc-visual__pct">' + fmt(v.total) + '</span></div>';
      return;
    }

    dom.visual.innerHTML = '';
  }

  function renderResult(result) {
    dom.error.hidden = true;
    dom.results.hidden = false;
    qa('[data-pc-input]', dom.root).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    setActionsEnabled(true);

    dom.headlineLabel.textContent = result.primary.label;

    var headline = displayValue(result.primary, result);
    if (result.primary.direction && result.primary.direction !== 'none') {
      headline = (result.primary.direction === 'up' ? '▲ ' : '▼ ') + headline;
    }
    dom.headline.textContent = headline;
    dom.headline.className = 'pc-headline__value' +
      (result.primary.direction ? ' pc-headline__value--' + result.primary.direction : '');

    dom.sentence.textContent = result.sentence;

    renderVisual(result);

    dom.secondary.innerHTML = result.secondary.map(function (s) {
      return '<div class="pc-stat"><dt>' + esc(s.label) + '</dt><dd>' +
        esc(displayValue(s, result)) + '</dd></div>';
    }).join('');

    dom.formula.textContent = result.formula;
    dom.calculation.textContent = result.calculation;
    dom.steps.innerHTML = result.steps.map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');

    if (result.note) {
      dom.note.hidden = false;
      dom.note.textContent = result.note;
    } else {
      dom.note.hidden = true;
      dom.note.textContent = '';
    }

    announce(result.sentence);
  }

  function renderExamples() {
    if (!dom.examples) return;
    dom.examples.innerHTML = EXAMPLES.map(function (ex) {
      var r = calculate(ex.mode, { a: ex.a, b: ex.b }, { precision: state.precision, currency: state.currency });
      if (!r.ok) return '';
      return '<button type="button" class="pc-example" data-pc-example-mode="' + ex.mode +
        '" data-pc-example-a="' + ex.a + '" data-pc-example-b="' + ex.b + '">' +
        '<span class="pc-example__q">' + esc(r.primary.label) + '</span>' +
        '<span class="pc-example__a">' + esc(displayValue(r.primary, r)) + '</span></button>';
    }).join('');
  }

  /* ============================================================
     10. Actions
     ============================================================ */

  function run() {
    var result = calculate(state.mode, { a: state.a, b: state.b }, {
      precision: state.precision, currency: state.currency
    });
    if (!result.ok) {
      showError(result.message, result.field);
      return;
    }
    state.result = result;
    renderResult(result);
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function pushHistory() {
    if (!state.historyEnabled || !state.result) return;
    var r = state.result;
    var entry = {
      mode: r.mode, a: r.inputs.a, b: r.inputs.b,
      text: r.sentence
    };
    var list = loadHistory();
    if (list.length && list[0].mode === entry.mode &&
        list[0].a === entry.a && list[0].b === entry.b) return;
    list.unshift(entry);
    list = list.slice(0, 10);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* quota */ }
    renderHistory();
  }

  function renderHistory() {
    if (!dom.historyList) return;
    var list = state.historyEnabled ? loadHistory() : [];
    dom.historyEmpty.hidden = list.length > 0;
    dom.historyList.innerHTML = list.map(function (e, i) {
      return '<li><button type="button" class="pc-history__item" data-pc-history="' + i + '">' +
        esc(e.text) + '</button></li>';
    }).join('');
  }

  function applyHistory(index) {
    var e = loadHistory()[index];
    if (!e || !MODES[e.mode]) return;
    state.mode = e.mode;
    state.a = String(e.a);
    state.b = String(e.b);
    renderModes();
    renderFields();
    renderQuick();
    run();
  }

  function flash(button, text) {
    if (!button) return;
    var original = button.getAttribute('data-pc-label') || button.textContent;
    button.setAttribute('data-pc-label', original);
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1600);
  }

  function copyResult() {
    if (!state.result) return;
    var text = resultToText(state.result);
    if (!navigator.clipboard || !navigator.clipboard.writeText) { flash(dom.copy, 'Unavailable'); return; }
    navigator.clipboard.writeText(text).then(function () {
      flash(dom.copy, 'Copied ✓');
      dom.status.textContent = 'Calculation copied to the clipboard.';
    }, function () { flash(dom.copy, 'Copy failed'); });
  }

  function shareResult() {
    if (!state.result) return;
    var text = resultToText(state.result);
    if (navigator.share) {
      navigator.share({ title: 'Percentage Calculation', text: text }).catch(function () { /* dismissed */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flash(dom.share, 'Copied ✓');
        dom.status.textContent = 'Sharing is not available in this browser, so the calculation was copied instead.';
      });
      return;
    }
    flash(dom.share, 'Unavailable');
  }

  /* ============================================================
     11. Preferences, events, init

     Only display preferences persist. The numbers people type are
     not stored unless they switch history on themselves.
     ============================================================ */

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        mode: state.mode, precision: state.precision,
        currency: state.currency, historyEnabled: state.historyEnabled
      }));
    } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.mode && MODES[s.mode]) state.mode = s.mode;
      if (s.precision === 'auto' || (typeof s.precision === 'number' && s.precision >= 0 && s.precision <= 6)) {
        state.precision = s.precision;
      }
      if (CURRENCIES[s.currency]) state.currency = s.currency;
      if (typeof s.historyEnabled === 'boolean') state.historyEnabled = s.historyEnabled;
    } catch (e) { /* corrupt prefs fall back to defaults */ }
  }

  function setMode(id) {
    if (!MODES[id] || id === state.mode) return;
    state.mode = id;
    /* Seed the new mode with its own example values so switching
       never lands on an error or a meaningless combination. */
    var m = MODES[id];
    state.a = String(m.fields[0].example);
    state.b = String(m.fields[1].example);
    renderModes();
    renderFields();
    renderQuick();
    savePrefs();
    run();
  }

  function bindEvents() {
    dom.modeList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pc-mode]');
      if (btn) setMode(btn.getAttribute('data-pc-mode'));
    });

    dom.fields.addEventListener('input', function (e) {
      var el = e.target.closest('[data-pc-input]');
      if (!el) return;
      state[el.getAttribute('data-pc-input')] = el.value;
      run();
    });

    dom.quick.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pc-quick-value]');
      if (!btn) return;
      var key = btn.getAttribute('data-pc-quick-key');
      state[key] = btn.getAttribute('data-pc-quick-value');
      var el = q('[data-pc-input="' + key + '"]', dom.root);
      if (el) el.value = state[key];
      run();
    });

    if (dom.swap) {
      dom.swap.addEventListener('click', function () {
        var a = state.a;
        state.a = state.b;
        state.b = a;
        renderFields();
        run();
      });
    }

    dom.precision.addEventListener('change', function () {
      var v = dom.precision.value;
      state.precision = v === 'auto' ? 'auto' : parseInt(v, 10);
      savePrefs();
      renderExamples();
      run();
    });

    dom.currency.addEventListener('change', function () {
      state.currency = dom.currency.value;
      savePrefs();
      renderFields();
      renderExamples();
      run();
    });

    dom.copy.addEventListener('click', function () { copyResult(); pushHistory(); });
    dom.share.addEventListener('click', shareResult);

    dom.reset.addEventListener('click', function () {
      state.mode = 'percentOf';
      state.a = '25';
      state.b = '200';
      state.precision = 2;
      state.currency = 'INR';
      dom.precision.value = '2';
      dom.currency.value = 'INR';
      renderModes();
      renderFields();
      renderQuick();
      renderExamples();
      savePrefs();
      run();
      dom.status.textContent = 'Calculator reset to defaults.';
    });

    dom.historyToggle.addEventListener('change', function () {
      state.historyEnabled = dom.historyToggle.checked;
      dom.historyPanel.hidden = !state.historyEnabled;
      if (!state.historyEnabled) {
        try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
      }
      renderHistory();
      savePrefs();
    });

    dom.historyClear.addEventListener('click', function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
      renderHistory();
      dom.status.textContent = 'History cleared.';
    });

    dom.historyList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pc-history]');
      if (btn) applyHistory(Number(btn.getAttribute('data-pc-history')));
    });

    if (dom.examples) {
      dom.examples.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-pc-example-mode]');
        if (!btn) return;
        state.mode = btn.getAttribute('data-pc-example-mode');
        state.a = btn.getAttribute('data-pc-example-a');
        state.b = btn.getAttribute('data-pc-example-b');
        renderModes();
        renderFields();
        renderQuick();
        savePrefs();
        run();
      });
    }
  }

  function init() {
    if (!cacheDom()) return;

    loadPrefs();

    /* Preferences can carry a mode over from a previous visit, so
       seed its example values rather than the percentOf defaults. */
    if (state.mode !== 'percentOf') {
      var m = MODES[state.mode];
      state.a = String(m.fields[0].example);
      state.b = String(m.fields[1].example);
    }

    dom.precision.value = String(state.precision);
    dom.currency.value = state.currency;
    dom.historyToggle.checked = state.historyEnabled;
    dom.historyPanel.hidden = !state.historyEnabled;

    renderModes();
    renderFields();
    renderQuick();
    renderExamples();
    renderHistory();
    bindEvents();
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
