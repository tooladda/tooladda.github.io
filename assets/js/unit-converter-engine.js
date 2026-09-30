/* ==========================================================================
   ToolAdda — Unit Converter Engine

   Pure, dependency-free conversion logic.

   Three rules this file follows, because they are where unit converters
   usually go wrong:

     1. EXACT factors where an exact definition exists. An inch is
        0.0254 m by international agreement, not 0.0254000001. Every
        factor below is either an exact definition or is marked as an
        approximation in its `note`.

     2. Not every scale is linear. Temperature is affine (it has an
        offset), and fuel economy is inverse (more miles per gallon means
        fewer litres per 100 km). Those units carry explicit toBase and
        fromBase functions instead of a factor.

     3. Ambiguous units are labelled, never silently resolved. A "ton", a
        "gallon", a "month" and a "calorie" all mean different things in
        different places, so each variant is named and any assumption is
        stated in `note`.

   All conversion runs through a single base unit per category, so adding
   a unit needs one factor rather than a matrix.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Helpers
     ====================================================================== */

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) n = typeof fallback === 'number' ? fallback : lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Shorthand for a plain multiplicative unit. */
  function u(id, name, symbol, factor, note) {
    return { id: id, name: name, symbol: symbol, factor: factor, note: note || null };
  }

  /* Shorthand for a unit that needs real functions (affine or inverse). */
  function fn(id, name, symbol, toBase, fromBase, note) {
    return { id: id, name: name, symbol: symbol, toBase: toBase, fromBase: fromBase, note: note || null };
  }

  /* ======================================================================
     2. Categories
     ====================================================================== */

  /* Exact constants reused below, so a factor is never typed twice. */
  var INCH = 0.0254;                 // exact, international yard & pound
  var FOOT = INCH * 12;              // 0.3048 exact
  var YARD = FOOT * 3;               // 0.9144 exact
  var MILE = FOOT * 5280;            // 1609.344 exact
  var NAUTICAL_MILE = 1852;          // exact by definition
  var POUND = 0.45359237;            // exact
  var GALLON_US = 3.785411784;       // exact (231 cubic inches)
  var GALLON_UK = 4.54609;           // exact
  var ATM = 101325;                  // exact
  var YEAR_DAYS = 365.2425;          // mean Gregorian year

  var CATEGORIES = [
    {
      id: 'length', label: 'Length', icon: '📏', base: 'm',
      units: [
        u('nm', 'Nanometer', 'nm', 1e-9),
        u('um', 'Micrometer', 'µm', 1e-6),
        u('mm', 'Millimeter', 'mm', 1e-3),
        u('cm', 'Centimeter', 'cm', 1e-2),
        u('m', 'Meter', 'm', 1),
        u('km', 'Kilometer', 'km', 1000),
        u('in', 'Inch', 'in', INCH),
        u('ft', 'Foot', 'ft', FOOT),
        u('yd', 'Yard', 'yd', YARD),
        u('mi', 'Mile', 'mi', MILE),
        u('nmi', 'Nautical mile', 'nmi', NAUTICAL_MILE),
        u('furlong', 'Furlong', 'fur', 201.168),
        u('ly', 'Light year', 'ly', 9460730472580800, 'Distance light travels in one Julian year.'),
        u('au', 'Astronomical unit', 'au', 149597870700)
      ]
    },
    {
      id: 'mass', label: 'Weight & mass', icon: '⚖️', base: 'kg',
      units: [
        u('mg', 'Milligram', 'mg', 1e-6),
        u('g', 'Gram', 'g', 1e-3),
        u('kg', 'Kilogram', 'kg', 1),
        u('t', 'Metric ton', 't', 1000),
        u('oz', 'Ounce', 'oz', POUND / 16),
        u('lb', 'Pound', 'lb', POUND),
        u('st', 'Stone', 'st', POUND * 14),
        u('ton_us', 'US ton (short)', 'ton', POUND * 2000, '2,000 lb. Different from the UK long ton.'),
        u('ton_uk', 'UK ton (long)', 'ton', POUND * 2240, '2,240 lb. Different from the US short ton.'),
        u('ct', 'Carat', 'ct', 0.0002),
        u('gr', 'Grain', 'gr', 0.00006479891),
        u('quintal', 'Quintal', 'q', 100)
      ]
    },
    {
      id: 'temperature', label: 'Temperature', icon: '🌡️', base: '°C',
      units: [
        fn('c', 'Celsius', '°C', function (v) { return v; }, function (v) { return v; }),
        fn('f', 'Fahrenheit', '°F',
          function (v) { return (v - 32) * 5 / 9; },
          function (v) { return v * 9 / 5 + 32; }),
        fn('k', 'Kelvin', 'K',
          function (v) { return v - 273.15; },
          function (v) { return v + 273.15; }),
        fn('r', 'Rankine', '°R',
          function (v) { return (v - 491.67) * 5 / 9; },
          function (v) { return (v + 273.15) * 9 / 5; }),
        fn('re', 'Réaumur', '°Ré',
          function (v) { return v * 5 / 4; },
          function (v) { return v * 4 / 5; })
      ]
    },
    {
      id: 'volume', label: 'Volume', icon: '🧪', base: 'L',
      units: [
        u('ml', 'Milliliter', 'mL', 1e-3),
        u('l', 'Liter', 'L', 1),
        u('m3', 'Cubic meter', 'm³', 1000),
        u('cm3', 'Cubic centimeter', 'cm³', 1e-3),
        u('in3', 'Cubic inch', 'in³', Math.pow(INCH, 3) * 1000),
        u('ft3', 'Cubic foot', 'ft³', Math.pow(FOOT, 3) * 1000),
        u('tsp_us', 'US teaspoon', 'tsp', GALLON_US / 768),
        u('tbsp_us', 'US tablespoon', 'tbsp', GALLON_US / 256),
        u('floz_us', 'US fluid ounce', 'fl oz', GALLON_US / 128),
        u('cup_us', 'US cup', 'cup', GALLON_US / 16),
        u('pt_us', 'US pint', 'pt', GALLON_US / 8),
        u('qt_us', 'US quart', 'qt', GALLON_US / 4),
        u('gal_us', 'US gallon', 'gal', GALLON_US, 'The US gallon is about 17% smaller than the imperial one.'),
        u('cup_metric', 'Metric cup', 'cup', 0.25),
        u('floz_uk', 'Imperial fluid ounce', 'fl oz', GALLON_UK / 160),
        u('pt_uk', 'Imperial pint', 'pt', GALLON_UK / 8),
        u('gal_uk', 'Imperial gallon', 'gal', GALLON_UK, 'Used in the UK. Larger than the US gallon.'),
        u('bbl', 'Oil barrel', 'bbl', GALLON_US * 42)
      ]
    },
    {
      id: 'area', label: 'Area', icon: '📐', base: 'm²',
      units: [
        u('mm2', 'Square millimeter', 'mm²', 1e-6),
        u('cm2', 'Square centimeter', 'cm²', 1e-4),
        u('m2', 'Square meter', 'm²', 1),
        u('ha', 'Hectare', 'ha', 10000),
        u('km2', 'Square kilometer', 'km²', 1e6),
        u('in2', 'Square inch', 'in²', INCH * INCH),
        u('ft2', 'Square foot', 'ft²', FOOT * FOOT),
        u('yd2', 'Square yard', 'yd²', YARD * YARD),
        u('acre', 'Acre', 'ac', 4046.8564224),
        u('mi2', 'Square mile', 'mi²', MILE * MILE),
        u('are', 'Are', 'a', 100)
      ]
    },
    {
      id: 'speed', label: 'Speed', icon: '🚀', base: 'm/s',
      units: [
        u('mps', 'Meter per second', 'm/s', 1),
        u('kmh', 'Kilometer per hour', 'km/h', 1000 / 3600),
        u('mph', 'Mile per hour', 'mph', MILE / 3600),
        u('fps', 'Foot per second', 'ft/s', FOOT),
        u('knot', 'Knot', 'kn', NAUTICAL_MILE / 3600),
        u('mach', 'Mach', 'M', 340.29, 'At sea level, 15 °C. The speed of sound varies with air temperature.'),
        u('c', 'Speed of light', 'c', 299792458)
      ]
    },
    {
      id: 'time', label: 'Time', icon: '⏱️', base: 's',
      units: [
        u('ns', 'Nanosecond', 'ns', 1e-9),
        u('us', 'Microsecond', 'µs', 1e-6),
        u('ms', 'Millisecond', 'ms', 1e-3),
        u('s', 'Second', 's', 1),
        u('min', 'Minute', 'min', 60),
        u('h', 'Hour', 'h', 3600),
        u('day', 'Day', 'd', 86400),
        u('week', 'Week', 'wk', 604800),
        u('month', 'Month', 'mo', YEAR_DAYS * 86400 / 12, 'An average month — one twelfth of a mean Gregorian year.'),
        u('year', 'Year', 'yr', YEAR_DAYS * 86400, 'A mean Gregorian year of 365.2425 days.'),
        u('decade', 'Decade', 'dec', YEAR_DAYS * 86400 * 10)
      ]
    },
    {
      id: 'data', label: 'Digital storage', icon: '💾', base: 'B',
      units: [
        u('bit', 'Bit', 'b', 1 / 8),
        u('B', 'Byte', 'B', 1),
        u('kB', 'Kilobyte', 'kB', 1e3, 'Decimal: 1,000 bytes. Storage makers use this.'),
        u('MB', 'Megabyte', 'MB', 1e6, 'Decimal: 1,000,000 bytes.'),
        u('GB', 'Gigabyte', 'GB', 1e9, 'Decimal: 1,000,000,000 bytes.'),
        u('TB', 'Terabyte', 'TB', 1e12),
        u('PB', 'Petabyte', 'PB', 1e15),
        u('KiB', 'Kibibyte', 'KiB', 1024, 'Binary: 1,024 bytes. What operating systems usually report.'),
        u('MiB', 'Mebibyte', 'MiB', Math.pow(1024, 2), 'Binary: 1,048,576 bytes.'),
        u('GiB', 'Gibibyte', 'GiB', Math.pow(1024, 3), 'Binary. A "1 TB" drive shows as about 931 GiB.'),
        u('TiB', 'Tebibyte', 'TiB', Math.pow(1024, 4))
      ]
    },
    {
      id: 'datarate', label: 'Data transfer', icon: '📶', base: 'bit/s',
      units: [
        u('bps', 'Bit per second', 'bit/s', 1),
        u('kbps', 'Kilobit per second', 'kbit/s', 1e3),
        u('mbps', 'Megabit per second', 'Mbit/s', 1e6, 'Internet plans are sold in megabits, not megabytes.'),
        u('gbps', 'Gigabit per second', 'Gbit/s', 1e9),
        u('Bps', 'Byte per second', 'B/s', 8),
        u('kBps', 'Kilobyte per second', 'kB/s', 8e3),
        u('MBps', 'Megabyte per second', 'MB/s', 8e6, 'A 100 Mbit/s line downloads at about 12.5 MB/s.')
      ]
    },
    {
      id: 'pressure', label: 'Pressure', icon: '🎈', base: 'Pa',
      units: [
        u('pa', 'Pascal', 'Pa', 1),
        u('hpa', 'Hectopascal', 'hPa', 100, 'Used in weather reports. Same size as a millibar.'),
        u('kpa', 'Kilopascal', 'kPa', 1000),
        u('bar', 'Bar', 'bar', 1e5),
        u('mbar', 'Millibar', 'mbar', 100),
        u('psi', 'Pound per square inch', 'psi', POUND * 9.80665 / (INCH * INCH)),
        u('atm', 'Standard atmosphere', 'atm', ATM),
        u('torr', 'Torr', 'Torr', ATM / 760),
        u('mmhg', 'Millimeter of mercury', 'mmHg', ATM / 760, 'Effectively identical to the torr.')
      ]
    },
    {
      id: 'energy', label: 'Energy', icon: '⚡', base: 'J',
      units: [
        u('j', 'Joule', 'J', 1),
        u('kj', 'Kilojoule', 'kJ', 1000),
        u('cal', 'Calorie (thermochemical)', 'cal', 4.184),
        u('kcal', 'Kilocalorie / food calorie', 'kcal', 4184, 'The "calorie" on nutrition labels is this one.'),
        u('wh', 'Watt hour', 'Wh', 3600),
        u('kwh', 'Kilowatt hour', 'kWh', 3.6e6, 'What an electricity bill is measured in.'),
        u('btu', 'British thermal unit', 'BTU', 1055.05585262),
        u('ev', 'Electronvolt', 'eV', 1.602176634e-19),
        u('ftlb', 'Foot-pound', 'ft·lb', 1.3558179483314004)
      ]
    },
    {
      id: 'power', label: 'Power', icon: '🔌', base: 'W',
      units: [
        u('w', 'Watt', 'W', 1),
        u('kw', 'Kilowatt', 'kW', 1000),
        u('mw', 'Megawatt', 'MW', 1e6),
        u('hp', 'Horsepower (mechanical)', 'hp', 745.6998715822702, 'The imperial horsepower.'),
        u('ps', 'Horsepower (metric)', 'PS', 735.49875, 'Also written PS or CV. Common in European car specs.'),
        u('btuh', 'BTU per hour', 'BTU/h', 1055.05585262 / 3600, 'Used for air-conditioner ratings.')
      ]
    },
    {
      id: 'angle', label: 'Angle', icon: '📡', base: 'deg',
      units: [
        u('deg', 'Degree', '°', 1),
        u('rad', 'Radian', 'rad', 180 / Math.PI),
        u('grad', 'Gradian', 'gon', 0.9),
        u('turn', 'Turn', 'turn', 360),
        u('arcmin', 'Arcminute', "'", 1 / 60),
        u('arcsec', 'Arcsecond', '"', 1 / 3600)
      ]
    },
    {
      id: 'frequency', label: 'Frequency', icon: '〰️', base: 'Hz',
      units: [
        u('hz', 'Hertz', 'Hz', 1),
        u('khz', 'Kilohertz', 'kHz', 1e3),
        u('mhz', 'Megahertz', 'MHz', 1e6),
        u('ghz', 'Gigahertz', 'GHz', 1e9),
        u('rpm', 'Revolution per minute', 'rpm', 1 / 60)
      ]
    },
    {
      /* Fuel economy is INVERSE: a bigger mpg is a smaller L/100km. Base is
         L/100 km, so the distance-per-volume units need real functions. */
      id: 'fuel', label: 'Fuel economy', icon: '⛽', base: 'L/100km',
      units: [
        u('l100km', 'Liters per 100 km', 'L/100km', 1),
        fn('kml', 'Kilometers per liter', 'km/L',
          function (v) { return 100 / v; },
          function (v) { return 100 / v; },
          'Inverse of L/100 km — a higher number is more efficient.'),
        fn('mpg_us', 'Miles per gallon (US)', 'mpg',
          function (v) { return (100 * GALLON_US) / (v * MILE / 1000); },
          function (v) { return (100 * GALLON_US) / (v * MILE / 1000); },
          'US gallon. Roughly 20% lower than the UK figure for the same car.'),
        fn('mpg_uk', 'Miles per gallon (UK)', 'mpg',
          function (v) { return (100 * GALLON_UK) / (v * MILE / 1000); },
          function (v) { return (100 * GALLON_UK) / (v * MILE / 1000); },
          'Imperial gallon, used in the UK.')
      ]
    }
  ];

  var CATEGORY_IDS = CATEGORIES.map(function (c) { return c.id; });

  function getCategory(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return CATEGORIES[0];
  }

  function getUnit(categoryId, unitId) {
    var cat = getCategory(categoryId);
    for (var i = 0; i < cat.units.length; i++) if (cat.units[i].id === unitId) return cat.units[i];
    return cat.units[0];
  }

  /* ======================================================================
     3. Conversion
     ====================================================================== */

  function toBase(unit, value) {
    if (typeof unit.toBase === 'function') return unit.toBase(value);
    return value * unit.factor;
  }

  function fromBase(unit, value) {
    if (typeof unit.fromBase === 'function') return unit.fromBase(value);
    return value / unit.factor;
  }

  /**
   * Convert between two units of the same category.
   * Everything routes through the category's base unit, so N units need N
   * factors rather than N² pairs.
   */
  function convert(value, categoryId, fromUnitId, toUnitId) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return NaN;
    var from = getUnit(categoryId, fromUnitId);
    var to = getUnit(categoryId, toUnitId);
    if (from.id === to.id) return n;
    return fromBase(to, toBase(from, n));
  }

  /** Every unit in the category, converted from one input. */
  function convertAll(value, categoryId, fromUnitId) {
    var cat = getCategory(categoryId);
    return cat.units.map(function (unit) {
      return {
        unit: unit,
        value: convert(value, categoryId, fromUnitId, unit.id),
        isSource: unit.id === fromUnitId
      };
    });
  }

  /* ======================================================================
     4. Parsing & formatting
     ====================================================================== */

  /**
   * Accept what people actually type: grouped digits, a comma decimal
   * separator, a leading plus, scientific notation, and stray spaces.
   */
  function parseValue(input) {
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    var s = String(input === null || input === undefined ? '' : input).trim();
    if (!s) return NaN;
    s = s.replace(/\s| |_/g, '');

    // 1.234,56 -> European grouping with a comma decimal
    if (/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    // Thousands grouping always ENDS in a group of exactly three digits.
    // Requiring that is what keeps "3,14" out of this branch and in the
    // comma-decimal one below.
    else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ||
             /^[+-]?\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    // 3,14 -> comma used as the decimal separator
    else if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.');

    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  /**
   * Format a result for display.
   * `mode` is 'auto' (significant digits), 'decimals' (fixed places) or
   * 'scientific'. Grouping is optional because a copied number often has
   * to go straight into a spreadsheet.
   */
  function formatValue(value, options) {
    var o = options || {};
    var mode = oneOf(o.mode, ['auto', 'decimals', 'scientific'], 'auto');
    var precision = Math.round(clampNum(o.precision, 0, 12, 6));
    var grouping = o.grouping !== false;

    if (value === null || value === undefined || !isFinite(value)) return '—';
    if (value === 0) return '0';

    var abs = Math.abs(value);
    var out;

    if (mode === 'scientific') {
      return value.toExponential(precision);
    }

    if (mode === 'decimals') {
      out = value.toFixed(precision);
    } else {
      /* Auto: round to `precision` decimal places and drop trailing zeros.
         Rounding by significant digits instead would quietly destroy the
         integer part of a large number — 1234567.5 at 6 significant digits
         becomes 1234568, which is not what "6 decimals" should mean. */
      if (abs >= 1e15) return value.toExponential(Math.min(precision, 8));
      // Too small to survive this many decimal places without becoming 0.
      if (abs < Math.pow(10, -precision)) return value.toExponential(Math.min(precision, 8));
      out = value.toFixed(precision);
      if (out.indexOf('.') !== -1) out = out.replace(/0+$/, '').replace(/\.$/, '');
    }

    if (!grouping) return out;

    var parts = out.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  /* ======================================================================
     5. Formula explanation
     ====================================================================== */

  /**
   * A human-readable description of the conversion actually performed.
   * Affine and inverse units get their real formula rather than a
   * multiplication that would be wrong.
   */
  function formula(categoryId, fromUnitId, toUnitId) {
    var from = getUnit(categoryId, fromUnitId);
    var to = getUnit(categoryId, toUnitId);

    if (from.id === to.id) return 'Same unit — the value is unchanged.';

    if (categoryId === 'temperature') {
      var pairs = {
        'c>f': '°F = °C × 9/5 + 32',
        'f>c': '°C = (°F − 32) × 5/9',
        'c>k': 'K = °C + 273.15',
        'k>c': '°C = K − 273.15',
        'f>k': 'K = (°F − 32) × 5/9 + 273.15',
        'k>f': '°F = (K − 273.15) × 9/5 + 32',
        'c>r': '°R = (°C + 273.15) × 9/5',
        'r>c': '°C = (°R − 491.67) × 5/9',
        'c>re': '°Ré = °C × 4/5',
        're>c': '°C = °Ré × 5/4'
      };
      return pairs[from.id + '>' + to.id] || 'Converted via Celsius.';
    }

    if (categoryId === 'fuel') {
      return 'Fuel economy is inverse — converted through litres per 100 km.';
    }

    var ratio = toBase(from, 1) / toBase(to, 1);
    return '1 ' + from.symbol + ' = ' + formatValue(ratio, { precision: 8 }) + ' ' + to.symbol;
  }

  /* ======================================================================
     6. Search across every unit
     ====================================================================== */

  /** Find units by name or symbol anywhere in the tool. */
  function searchUnits(query, limit) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var results = [];

    CATEGORIES.forEach(function (cat) {
      cat.units.forEach(function (unit) {
        var name = unit.name.toLowerCase();
        var symbol = unit.symbol.toLowerCase();
        var score = 0;
        if (symbol === q) score = 100;
        else if (name === q) score = 95;
        else if (name.indexOf(q) === 0) score = 80;
        else if (symbol.indexOf(q) === 0) score = 70;
        else if (name.indexOf(q) !== -1) score = 50;
        else if (cat.label.toLowerCase().indexOf(q) !== -1) score = 20;
        if (score > 0) results.push({ category: cat, unit: unit, score: score });
      });
    });

    results.sort(function (a, b) { return b.score - a.score || a.unit.name.localeCompare(b.unit.name); });
    return results.slice(0, limit || 12);
  }

  /* ======================================================================
     7. Quick conversions & reference tables
     ====================================================================== */

  var QUICK = [
    { label: 'km → miles', category: 'length', from: 'km', to: 'mi' },
    { label: 'cm → inches', category: 'length', from: 'cm', to: 'in' },
    { label: 'kg → lb', category: 'mass', from: 'kg', to: 'lb' },
    { label: '°C → °F', category: 'temperature', from: 'c', to: 'f' },
    { label: 'L → US gal', category: 'volume', from: 'l', to: 'gal_us' },
    { label: 'm² → ft²', category: 'area', from: 'm2', to: 'ft2' },
    { label: 'km/h → mph', category: 'speed', from: 'kmh', to: 'mph' },
    { label: 'GB → GiB', category: 'data', from: 'GB', to: 'GiB' },
    { label: 'Mbps → MB/s', category: 'datarate', from: 'mbps', to: 'MBps' },
    { label: 'kWh → MJ', category: 'energy', from: 'kwh', to: 'kj' },
    { label: 'hp → kW', category: 'power', from: 'hp', to: 'kw' },
    { label: 'mpg → L/100km', category: 'fuel', from: 'mpg_us', to: 'l100km' }
  ];

  /** Rows for a printable reference table. */
  function referenceRows(categoryId, fromUnitId, toUnitId, values) {
    var list = values || [1, 2, 5, 10, 20, 50, 100];
    return list.map(function (v) {
      return { from: v, to: convert(v, categoryId, fromUnitId, toUnitId) };
    });
  }

  /* ======================================================================
     8. State
     ====================================================================== */

  function defaultState() {
    return {
      version: 1,
      category: 'length',
      from: 'km',
      to: 'mi',
      value: 1,
      raw: '1',
      format: { mode: 'auto', precision: 6, grouping: true },
      showAll: true
    };
  }

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};
    var f = (s.format && typeof s.format === 'object') ? s.format : {};

    var category = oneOf(s.category, CATEGORY_IDS, d.category);
    var cat = getCategory(category);
    var unitIds = cat.units.map(function (x) { return x.id; });

    var fromId = oneOf(s.from, unitIds, unitIds[0]);
    var toId = oneOf(s.to, unitIds, unitIds[1] || unitIds[0]);

    var raw = String(s.raw === undefined ? d.raw : s.raw).slice(0, 40);
    var value = parseValue(s.value === undefined ? raw : s.value);

    return {
      version: 1,
      category: category,
      from: fromId,
      to: toId,
      value: isFinite(value) ? value : NaN,
      raw: raw,
      format: {
        mode: oneOf(f.mode, ['auto', 'decimals', 'scientific'], d.format.mode),
        precision: Math.round(clampNum(f.precision, 0, 12, d.format.precision)),
        grouping: f.grouping === undefined ? d.format.grouping : !!f.grouping
      },
      showAll: s.showAll === undefined ? d.showAll : !!s.showAll
    };
  }

  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

  /* A short, shareable hash: category/from/to/value */
  function encodeState(state) {
    return [state.category, state.from, state.to, state.raw].map(encodeURIComponent).join('/');
  }

  function decodeState(hash) {
    var parts = String(hash || '').replace(/^#/, '').split('/').map(decodeURIComponent);
    if (parts.length < 4) return null;
    return normalize({ category: parts[0], from: parts[1], to: parts[2], raw: parts[3], value: parts[3] });
  }

  /* ======================================================================
     9. Export
     ====================================================================== */

  global.UnitConverterEngine = {
    escapeHtml: escapeHtml,
    clampNum: clampNum,

    CATEGORIES: CATEGORIES,
    CATEGORY_IDS: CATEGORY_IDS,
    getCategory: getCategory,
    getUnit: getUnit,

    convert: convert,
    convertAll: convertAll,
    toBase: toBase,
    fromBase: fromBase,

    parseValue: parseValue,
    formatValue: formatValue,
    formula: formula,
    searchUnits: searchUnits,
    referenceRows: referenceRows,

    QUICK: QUICK,

    defaultState: defaultState,
    normalize: normalize,
    cloneState: cloneState,
    encodeState: encodeState,
    decodeState: decodeState
  };

})(typeof window !== 'undefined' ? window : this);
