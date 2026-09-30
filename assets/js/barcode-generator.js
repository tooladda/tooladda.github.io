/* ============================================================
   ToolAdda — Barcode Generator

   A self-contained 1D barcode engine. The previous version pulled
   JsBarcode off a CDN; this one encodes the symbologies directly so
   the page has no third-party runtime dependency, works offline, and
   — more usefully — exposes every encoder and checksum as a pure
   function that the Node test suite can verify. Barcode accuracy is
   the whole product, so it needs to be testable without a browser.

   Nothing here touches the network. Data goes:
     input -> validate -> encode to a module string -> layout ->
     SVG string / canvas -> Blob -> download.

   Layout of this file:
     1.  Symbology registry (metadata the UI reads)
     2.  Small pure helpers
     3.  Check digit algorithms
     4.  Pattern tables
     5.  Encoders (one per symbology)
     6.  Validation
     7.  encode() — the public entry point
     8.  Geometry / layout
     9.  SVG renderer
     10. Canvas renderer
     11. Filenames + engine export
     12. UI state
     13. DOM cache
     14. Rendering the controls
     15. Generate / preview pipeline
     16. Downloads
     17. Batch mode
     18. Validator mode
     19. Preferences, events, init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. Symbology registry
     ============================================================ */

  var FORMATS = {
    CODE128: {
      id: 'CODE128',
      name: 'CODE 128',
      group: 'General purpose',
      dimension: '1D',
      blurb: 'High-density linear symbology that encodes the full ASCII range and switches character subsets automatically to keep the barcode short.',
      dataType: 'Alphanumeric + symbols',
      charset: 'Any ASCII character, code point 0–127',
      lengthLabel: 'Variable length',
      uses: 'Shipping labels, logistics, warehouse and inventory systems, internal SKUs',
      checksum: 'Mod 103 check character, always embedded and never shown in the printed text',
      placeholder: 'Enter text, numbers, a product code or an identifier…',
      sample: 'TOOLADDA-12345',
      minQuiet: 10,
      supportsText: true,
      autoCheck: false
    },
    CODE39: {
      id: 'CODE39',
      name: 'CODE 39',
      group: 'Industrial',
      dimension: '1D',
      blurb: 'The oldest widely deployed alphanumeric symbology. Low density, but readable by practically every scanner ever made.',
      dataType: 'Uppercase alphanumeric',
      charset: '0–9, A–Z, space, and - . $ / + %',
      lengthLabel: 'Variable length',
      uses: 'Defence and automotive standards, healthcare, badge and asset labelling',
      checksum: 'Optional Mod 43 check character',
      placeholder: 'Enter uppercase letters, digits or - . $ / + %',
      sample: 'ASSET-4417',
      minQuiet: 10,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Append Mod 43 check character',
      autoCheckDefault: false
    },
    CODE93: {
      id: 'CODE93',
      name: 'CODE 93',
      group: 'Industrial',
      dimension: '1D',
      blurb: 'A denser, more secure successor to CODE 39 with two mandatory check characters. Same character set, roughly 25% narrower.',
      dataType: 'Uppercase alphanumeric',
      charset: '0–9, A–Z, space, and - . $ / + %',
      lengthLabel: 'Variable length',
      uses: 'Canada Post, logistics labelling, inventory where label width is tight',
      checksum: 'Two Mod 47 check characters (C and K), always embedded',
      placeholder: 'Enter uppercase letters, digits or - . $ / + %',
      sample: 'CODE93-TEST',
      minQuiet: 10,
      supportsText: true,
      autoCheck: false
    },
    EAN13: {
      id: 'EAN13',
      name: 'EAN-13',
      group: 'Retail',
      dimension: '1D',
      blurb: 'The global retail product barcode. Encodes a 13-digit GTIN-13 and is scannable at any supermarket checkout worldwide.',
      dataType: 'Numeric only',
      charset: 'Digits 0–9',
      lengthLabel: '12 digits (check digit calculated) or 13 digits',
      uses: 'Retail products sold outside North America, books (ISBN-13), magazines',
      checksum: 'Mod 10 check digit — the 13th digit',
      placeholder: 'Enter 12 or 13 digits, e.g. 590123412345',
      sample: '5901234123457',
      minQuiet: 11,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Calculate the 13th check digit from 12 digits',
      autoCheckDefault: true,
      numeric: true
    },
    EAN8: {
      id: 'EAN8',
      name: 'EAN-8',
      group: 'Retail',
      dimension: '1D',
      blurb: 'The short-form retail barcode for packages too small to carry a full EAN-13, such as confectionery and cosmetics.',
      dataType: 'Numeric only',
      charset: 'Digits 0–9',
      lengthLabel: '7 digits (check digit calculated) or 8 digits',
      uses: 'Small retail packaging where an EAN-13 will not physically fit',
      checksum: 'Mod 10 check digit — the 8th digit',
      placeholder: 'Enter 7 or 8 digits, e.g. 9638507',
      sample: '96385074',
      minQuiet: 7,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Calculate the 8th check digit from 7 digits',
      autoCheckDefault: true,
      numeric: true
    },
    UPCA: {
      id: 'UPCA',
      name: 'UPC-A',
      group: 'Retail',
      dimension: '1D',
      blurb: 'The North American retail standard, structurally an EAN-13 with a leading zero. 12 digits, universally scannable at US and Canadian retail.',
      dataType: 'Numeric only',
      charset: 'Digits 0–9',
      lengthLabel: '11 digits (check digit calculated) or 12 digits',
      uses: 'Retail products sold in the United States and Canada',
      checksum: 'Mod 10 check digit — the 12th digit',
      placeholder: 'Enter 11 or 12 digits, e.g. 03600029145',
      sample: '036000291452',
      minQuiet: 9,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Calculate the 12th check digit from 11 digits',
      autoCheckDefault: true,
      numeric: true
    },
    UPCE: {
      id: 'UPCE',
      name: 'UPC-E',
      group: 'Retail',
      dimension: '1D',
      blurb: 'A zero-suppressed UPC-A. Six data digits are compressed into roughly half the width, then expanded back to the full 12-digit UPC-A by the scanner.',
      dataType: 'Numeric only',
      charset: 'Digits 0–9, number system 0 or 1',
      lengthLabel: '6 digits (number system 0 assumed), 7 digits, or a full 8-digit UPC-E',
      uses: 'Very small retail packaging in North America',
      checksum: 'Mod 10 check digit derived from the expanded UPC-A',
      placeholder: 'Enter 6, 7 or 8 digits, e.g. 425261',
      sample: '04252614',
      minQuiet: 9,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Calculate the check digit from the expanded UPC-A',
      autoCheckDefault: true,
      numeric: true
    },
    ITF: {
      id: 'ITF',
      name: 'ITF (Interleaved 2 of 5)',
      group: 'Industrial',
      dimension: '1D',
      blurb: 'A compact numeric-only symbology that encodes two digits per character by interleaving one digit in the bars and the next in the spaces.',
      dataType: 'Numeric only',
      charset: 'Digits 0–9',
      lengthLabel: 'Any even number of digits',
      uses: 'Warehouse and distribution labels, carton identification, film edge marking',
      checksum: 'Optional Mod 10 check digit',
      placeholder: 'Enter an even number of digits, e.g. 1234567890',
      sample: '1234567890',
      minQuiet: 10,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Append a Mod 10 check digit',
      autoCheckDefault: false,
      numeric: true
    },
    ITF14: {
      id: 'ITF14',
      name: 'ITF-14',
      group: 'Industrial',
      dimension: '1D',
      blurb: 'The GS1 shipping container barcode. A fixed 14-digit ITF carrying a GTIN-14, printed inside a heavy bearer bar frame so it survives corrugated packaging.',
      dataType: 'Numeric only',
      charset: 'Digits 0–9',
      lengthLabel: '13 digits (check digit calculated) or 14 digits',
      uses: 'Outer cases, cartons and pallets — the trade unit above the retail item',
      checksum: 'Mod 10 check digit — the 14th digit',
      placeholder: 'Enter 13 or 14 digits, e.g. 1540014128876',
      sample: '15400141288763',
      minQuiet: 10,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Calculate the 14th check digit from 13 digits',
      autoCheckDefault: true,
      numeric: true,
      bearerDefault: true
    },
    CODABAR: {
      id: 'CODABAR',
      name: 'Codabar',
      group: 'Legacy & specialist',
      dimension: '1D',
      blurb: 'A self-checking numeric symbology with four interchangeable start/stop characters (A–D), still standard in blood banking and libraries.',
      dataType: 'Numeric + limited symbols',
      charset: '0–9 and - $ : / . +, wrapped in start/stop characters A, B, C or D',
      lengthLabel: 'Variable length',
      uses: 'Blood bank bags, library circulation, photo processing, air waybills',
      checksum: 'None defined in the base specification',
      placeholder: 'Enter digits and - $ : / . + — start/stop added automatically',
      sample: 'A12345678B',
      minQuiet: 10,
      supportsText: true,
      autoCheck: false
    },
    MSI: {
      id: 'MSI',
      name: 'MSI / Plessey',
      group: 'Legacy & specialist',
      dimension: '1D',
      blurb: 'A numeric-only symbology once common on retail shelf-edge labels for inventory control. Simple to print, low density.',
      dataType: 'Numeric only',
      charset: 'Digits 0–9',
      lengthLabel: 'Variable length',
      uses: 'Shelf-edge labels, warehouse shelf tags, stock control',
      checksum: 'Optional Mod 10 check digit',
      placeholder: 'Enter digits only, e.g. 1234567',
      sample: '1234567',
      minQuiet: 10,
      supportsText: true,
      autoCheck: true,
      autoCheckLabel: 'Append a Mod 10 check digit',
      autoCheckDefault: false,
      numeric: true
    },
    PHARMACODE: {
      id: 'PHARMACODE',
      name: 'Pharmacode',
      group: 'Legacy & specialist',
      dimension: '1D',
      blurb: 'A pharmaceutical packaging control code. It carries no human-readable text and is deliberately hard to misread — it encodes a single integer from 3 to 131070.',
      dataType: 'Integer 3–131070',
      charset: 'Digits 0–9 forming a number between 3 and 131070',
      lengthLabel: 'A single integer, 3 to 131070',
      uses: 'Pharmaceutical carton and leaflet packaging line control',
      checksum: 'None — the encoding itself is the integrity mechanism',
      placeholder: 'Enter a number between 3 and 131070',
      sample: '1234',
      minQuiet: 10,
      supportsText: false,
      autoCheck: false,
      numeric: true
    }
  };

  var FORMAT_ORDER = [
    'CODE128', 'CODE39', 'CODE93',
    'EAN13', 'EAN8', 'UPCA', 'UPCE',
    'ITF', 'ITF14',
    'CODABAR', 'MSI', 'PHARMACODE'
  ];

  var GROUP_ORDER = ['General purpose', 'Retail', 'Industrial', 'Legacy & specialist'];

  /* ============================================================
     2. Small pure helpers
     ============================================================ */

  /* `suggestion` carries the corrected value when one can be derived,
     so both the inline error and the validator panel can offer it. */
  function fail(message, hint, suggestion) {
    return { ok: false, message: message, hint: hint || '', suggestion: suggestion || '' };
  }

  function repeatChar(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  /* Turn a run-length pattern like '212222' into modules. Patterns
     always start with a bar, so digits alternate bar/space. */
  function widthsToModules(widths) {
    var out = '';
    var bar = true;
    for (var i = 0; i < widths.length; i++) {
      out += repeatChar(bar ? '1' : '0', parseInt(widths[i], 10));
      bar = !bar;
    }
    return out;
  }

  /* Turn a wide/narrow mask like '0011010' (1 = wide) into modules,
     alternating bar/space and starting with a bar. */
  function maskToModules(mask, narrow, wide) {
    var out = '';
    var bar = true;
    for (var i = 0; i < mask.length; i++) {
      out += repeatChar(bar ? '1' : '0', mask[i] === '1' ? wide : narrow);
      bar = !bar;
    }
    return out;
  }

  function isDigits(s) {
    return s.length > 0 && /^[0-9]+$/.test(s);
  }

  function digitRunAt(s, i) {
    var n = 0;
    while (i + n < s.length && s.charCodeAt(i + n) >= 48 && s.charCodeAt(i + n) <= 57) n++;
    return n;
  }

  function clamp(n, min, max) {
    if (isNaN(n)) return min;
    return n < min ? min : (n > max ? max : n);
  }

  /* ============================================================
     3. Check digit algorithms
     ============================================================ */

  /* GS1 Mod 10, used by EAN-8/13, UPC-A/E and ITF-14. Weights
     alternate 3 and 1 starting from the rightmost payload digit. */
  function mod10(digits) {
    var sum = 0;
    var weight = 3;
    for (var i = digits.length - 1; i >= 0; i--) {
      sum += parseInt(digits[i], 10) * weight;
      weight = weight === 3 ? 1 : 3;
    }
    return (10 - (sum % 10)) % 10;
  }

  /* ITF and MSI use the Luhn-style variant: double every second
     digit from the right and sum the resulting digits. */
  function mod10Luhn(digits) {
    var sum = 0;
    var doubleIt = true;
    for (var i = digits.length - 1; i >= 0; i--) {
      var d = parseInt(digits[i], 10);
      if (doubleIt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      doubleIt = !doubleIt;
    }
    return (10 - (sum % 10)) % 10;
  }

  var CODE39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

  function mod43(value) {
    var sum = 0;
    for (var i = 0; i < value.length; i++) {
      sum += CODE39_CHARS.indexOf(value[i]);
    }
    return CODE39_CHARS[sum % 43];
  }

  /* CODE 93 C and K check characters: weighted mod 47, the weight
     cycling 1..20 (C) and 1..15 (K) from the rightmost character. */
  function code93Check(values, maxWeight) {
    var sum = 0;
    var weight = 1;
    for (var i = values.length - 1; i >= 0; i--) {
      sum += values[i] * weight;
      weight = weight === maxWeight ? 1 : weight + 1;
    }
    return sum % 47;
  }

  /* ============================================================
     4. Pattern tables
     ============================================================ */

  /* CODE 128: 107 run-length patterns. Index 103/104/105 are the
     Start A/B/C characters and 106 is the stop pattern, which is
     seven elements wide because it carries its own terminating bar. */
  var CODE128_PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
  ];

  /* CODE 39: 12-module binary patterns (narrow 1, wide 2), in the
     same order as CODE39_CHARS, with the start/stop '*' last. */
  var CODE39_PATTERNS = [
    '101001101101', '110100101011', '101100101011', '110110010101', '101001101011',
    '110100110101', '101100110101', '101001011011', '110100101101', '101100101101',
    '110101001011', '101101001011', '110110100101', '101011001011', '110101100101',
    '101101100101', '101010011011', '110101001101', '101101001101', '101011001101',
    '110101010011', '101101010011', '110110101001', '101011010011', '110101101001',
    '101101101001', '101010110011', '110101011001', '101101011001', '101011011001',
    '110010101011', '100110101011', '110011010101', '100101101011', '110010110101',
    '100110110101', '100101011011', '110010101101', '100110101101', '100100100101',
    '100100101001', '100101001001', '101001001001'
  ];
  var CODE39_GUARD = '100101101101';

  /* CODE 93: 9-module patterns in CODE93_CHARS order, then '*'. */
  var CODE93_PATTERNS = [
    '100010100', '101001000', '101000100', '101000010', '100101000',
    '100100100', '100100010', '101010000', '100010010', '100001010',
    '110101000', '110100100', '110100010', '110010100', '110010010',
    '110001010', '101101000', '101100100', '101100010', '100110100',
    '100011010', '101011000', '101001100', '101000110', '100101100',
    '100010110', '110110100', '110110010', '110101100', '110100110',
    '110010110', '110011010', '101101100', '101100110', '100110110',
    '100111010', '100101110', '111010100', '111010010', '111001010',
    '101101110', '101110110', '110101110',
    '100100110', '111011010', '111010110', '100110010'
  ];
  var CODE93_GUARD = '101011110';

  /* EAN / UPC digit encodings. L is odd parity, G is even parity
     (L reversed), R is the complement of L. */
  var EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011',
               '0110001', '0101111', '0111011', '0110111', '0001011'];
  var EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101',
               '0111001', '0000101', '0010001', '0001001', '0010111'];
  var EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100',
               '1001110', '1010000', '1000100', '1001000', '1110100'];

  /* Which of the first six EAN-13 digits use G parity — this is how
     the 13th digit is encoded without occupying any bars of its own. */
  var EAN13_PARITY = [
    'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
  ];

  /* UPC-E parity for number system 0, indexed by check digit.
     Number system 1 uses the inverse of each pattern. */
  var UPCE_PARITY = [
    'EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO',
    'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE'
  ];

  /* ITF digit patterns: five elements, two of them wide. */
  var ITF_PATTERNS = ['00110', '10001', '01001', '11000', '00101',
                      '10100', '01100', '00011', '10010', '01010'];

  /* Codabar: seven-element wide/narrow masks. */
  var CODABAR_CHARS = '0123456789-$:/.+ABCD';
  var CODABAR_PATTERNS = [
    '0000011', '0000110', '0001001', '1100000', '0010010',
    '1000010', '0100001', '0100100', '0110000', '1001000',
    '0001100', '0011000', '1000101', '1010001', '1010100', '0010101',
    '0011010', '0101001', '0001011', '0001110'
  ];

  /* ============================================================
     5. Encoders

     Each encoder receives an already-validated, already-normalized
     value and returns a render spec:

       modules      '1'/'0' string, one character per module
       text         the human-readable line
       guards       module ranges drawn as extended guard bars
       textGroups   text placed under a module range (EAN/UPC)
       textOutside  digits printed in the quiet zone (EAN-13/UPC)
     ============================================================ */

  /* --- CODE 128 ------------------------------------------------ */

  /* True when the next "committed" character can only live in code
     set A (a control character) rather than B (lower case). */
  function code128PrefersA(s, i) {
    for (var j = i; j < s.length; j++) {
      var c = s.charCodeAt(j);
      if (c < 32) return true;
      if (c >= 96) return false;
    }
    return false;
  }

  function code128Value(ch, mode) {
    var c = ch.charCodeAt(0);
    if (mode === 'A') return c < 32 ? c + 64 : c - 32;
    return c - 32;
  }

  /* Builds the code value sequence, including the start character
     but excluding the check character and stop. Subset switching
     follows the standard rules: start in C when four or more digits
     lead (and the run is even so it packs cleanly), pack digit pairs
     while in C, and drop back to A or B for anything else. */
  function code128Codes(s) {
    var codes = [];
    var mode;
    var run0 = digitRunAt(s, 0);

    if (run0 >= 4 && run0 % 2 === 0) mode = 'C';
    else if (run0 === 2 && s.length === 2) mode = 'C';
    else mode = code128PrefersA(s, 0) ? 'A' : 'B';

    codes.push(mode === 'A' ? 103 : mode === 'B' ? 104 : 105);

    var i = 0;
    while (i < s.length) {
      if (mode === 'C') {
        if (digitRunAt(s, i) >= 2) {
          codes.push(parseInt(s.substr(i, 2), 10));
          i += 2;
        } else {
          var toA = code128PrefersA(s, i);
          codes.push(toA ? 101 : 100);
          mode = toA ? 'A' : 'B';
        }
      } else {
        var run = digitRunAt(s, i);
        if (run >= 4 && run % 2 === 0) {
          codes.push(99);
          mode = 'C';
        } else {
          var c = s.charCodeAt(i);
          var fitsMode = mode === 'A' ? (c < 96) : (c >= 32);
          if (!fitsMode) {
            /* One-off characters use SHIFT; longer stretches switch. */
            var other = mode === 'A' ? 'B' : 'A';
            var nextFits = i + 1 < s.length &&
              (mode === 'A' ? s.charCodeAt(i + 1) >= 96 : s.charCodeAt(i + 1) < 32);
            if (nextFits) {
              codes.push(other === 'A' ? 101 : 100);
              mode = other;
            } else {
              codes.push(98); /* SHIFT: next character only */
              codes.push(code128Value(s[i], other));
              i += 1;
              continue;
            }
          } else {
            codes.push(code128Value(s[i], mode));
            i += 1;
          }
        }
      }
    }
    return codes;
  }

  function encodeCode128(value) {
    var codes = code128Codes(value);
    var checksum = codes[0];
    for (var i = 1; i < codes.length; i++) checksum += codes[i] * i;
    codes.push(checksum % 103);
    codes.push(106);

    var modules = '';
    for (var j = 0; j < codes.length; j++) {
      modules += widthsToModules(CODE128_PATTERNS[codes[j]]);
    }
    return { modules: modules, text: value };
  }

  /* --- CODE 39 ------------------------------------------------- */

  function encodeCode39(value, opts) {
    var payload = value;
    if (opts && opts.autoCheck) payload += mod43(value);

    var modules = CODE39_GUARD;
    for (var i = 0; i < payload.length; i++) {
      modules += '0' + CODE39_PATTERNS[CODE39_CHARS.indexOf(payload[i])];
    }
    modules += '0' + CODE39_GUARD;
    return { modules: modules, text: '*' + payload + '*' };
  }

  /* --- CODE 93 ------------------------------------------------- */

  function encodeCode93(value) {
    var values = [];
    for (var i = 0; i < value.length; i++) values.push(CODE39_CHARS.indexOf(value[i]));

    var c = code93Check(values, 20);
    values.push(c);
    var k = code93Check(values, 15);
    values.push(k);

    var modules = CODE93_GUARD;
    for (var j = 0; j < values.length; j++) modules += CODE93_PATTERNS[values[j]];
    modules += CODE93_GUARD + '1'; /* CODE 93 ends with a termination bar */

    return { modules: modules, text: value };
  }

  /* --- EAN / UPC ----------------------------------------------- */

  function encodeEan13(value) {
    var parity = EAN13_PARITY[parseInt(value[0], 10)];
    var modules = '101';
    for (var i = 1; i <= 6; i++) {
      var d = parseInt(value[i], 10);
      modules += parity[i - 1] === 'L' ? EAN_L[d] : EAN_G[d];
    }
    modules += '01010';
    for (var j = 7; j <= 12; j++) modules += EAN_R[parseInt(value[j], 10)];
    modules += '101';

    return {
      modules: modules,
      text: value,
      guards: [[0, 2], [45, 49], [92, 94]],
      textGroups: [
        { text: value.slice(1, 7), from: 3, to: 44 },
        { text: value.slice(7), from: 50, to: 91 }
      ],
      textOutside: [{ text: value[0], side: 'left' }]
    };
  }

  function encodeEan8(value) {
    var modules = '101';
    for (var i = 0; i < 4; i++) modules += EAN_L[parseInt(value[i], 10)];
    modules += '01010';
    for (var j = 4; j < 8; j++) modules += EAN_R[parseInt(value[j], 10)];
    modules += '101';

    return {
      modules: modules,
      text: value,
      guards: [[0, 2], [31, 35], [64, 66]],
      textGroups: [
        { text: value.slice(0, 4), from: 3, to: 30 },
        { text: value.slice(4), from: 36, to: 63 }
      ]
    };
  }

  function encodeUpcA(value) {
    var modules = '101';
    for (var i = 0; i < 6; i++) modules += EAN_L[parseInt(value[i], 10)];
    modules += '01010';
    for (var j = 6; j < 12; j++) modules += EAN_R[parseInt(value[j], 10)];
    modules += '101';

    return {
      modules: modules,
      text: value,
      guards: [[0, 2], [45, 49], [92, 94]],
      textGroups: [
        { text: value.slice(1, 6), from: 10, to: 44 },
        { text: value.slice(6, 11), from: 50, to: 84 }
      ],
      textOutside: [
        { text: value[0], side: 'left' },
        { text: value[11], side: 'right' }
      ]
    };
  }

  /* Expand the six compressed digits back to the 11-digit UPC-A
     payload so the check digit can be computed the normal way. */
  function upceExpand(numberSystem, six) {
    var last = six[5];
    if (last === '0' || last === '1' || last === '2') {
      return numberSystem + six.slice(0, 2) + last + '0000' + six.slice(2, 5);
    }
    if (last === '3') return numberSystem + six.slice(0, 3) + '00000' + six.slice(3, 5);
    if (last === '4') return numberSystem + six.slice(0, 4) + '00000' + six[4];
    return numberSystem + six.slice(0, 5) + '0000' + last;
  }

  function encodeUpcE(value) {
    /* value is the full 8 digits: number system + 6 data + check. */
    var ns = value[0];
    var six = value.slice(1, 7);
    var check = parseInt(value[7], 10);

    var parity = UPCE_PARITY[check];
    var modules = '101';
    for (var i = 0; i < 6; i++) {
      var useEven = parity[i] === 'E';
      if (ns === '1') useEven = !useEven;
      var d = parseInt(six[i], 10);
      modules += useEven ? EAN_G[d] : EAN_L[d];
    }
    modules += '010101';

    return {
      modules: modules,
      text: value,
      guards: [[0, 2], [45, 50]],
      textGroups: [{ text: six, from: 3, to: 44 }],
      textOutside: [
        { text: ns, side: 'left' },
        { text: value[7], side: 'right' }
      ]
    };
  }

  /* --- ITF ----------------------------------------------------- */

  function encodeItf(value, opts) {
    var narrow = 1;
    var wide = 3; /* GS1 requires a 2.25:1 to 3:1 ratio for ITF-14 */
    var modules = '1010'; /* start: narrow bar, narrow space, narrow bar, narrow space */

    for (var i = 0; i < value.length; i += 2) {
      var barPattern = ITF_PATTERNS[parseInt(value[i], 10)];
      var spacePattern = ITF_PATTERNS[parseInt(value[i + 1], 10)];
      for (var k = 0; k < 5; k++) {
        modules += repeatChar('1', barPattern[k] === '1' ? wide : narrow);
        modules += repeatChar('0', spacePattern[k] === '1' ? wide : narrow);
      }
    }
    modules += repeatChar('1', wide) + '0' + '1'; /* stop: wide bar, narrow space, narrow bar */

    return {
      modules: modules,
      text: value,
      bearer: !!(opts && opts.bearer)
    };
  }

  /* --- Codabar -------------------------------------------------- */

  function encodeCodabar(value) {
    var modules = '';
    for (var i = 0; i < value.length; i++) {
      if (i > 0) modules += '0';
      modules += maskToModules(CODABAR_PATTERNS[CODABAR_CHARS.indexOf(value[i])], 1, 3);
    }
    return { modules: modules, text: value };
  }

  /* --- MSI ------------------------------------------------------ */

  function encodeMsi(value, opts) {
    var payload = value;
    if (opts && opts.autoCheck) payload += String(mod10Luhn(value));

    var modules = '110'; /* start */
    for (var i = 0; i < payload.length; i++) {
      var bits = parseInt(payload[i], 10).toString(2);
      while (bits.length < 4) bits = '0' + bits;
      for (var b = 0; b < 4; b++) modules += bits[b] === '1' ? '110' : '100';
    }
    modules += '1001'; /* stop */

    return { modules: modules, text: payload };
  }

  /* --- Pharmacode ---------------------------------------------- */

  function encodePharmacode(value) {
    var n = parseInt(value, 10);
    var bars = [];
    while (n > 0) {
      if (n % 2 === 0) {
        bars.unshift(3); /* thick bar */
        n = (n - 2) / 2;
      } else {
        bars.unshift(1); /* thin bar */
        n = (n - 1) / 2;
      }
    }
    var modules = '';
    for (var i = 0; i < bars.length; i++) {
      if (i > 0) modules += '0';
      modules += repeatChar('1', bars[i]);
    }
    return { modules: modules, text: value };
  }

  /* ============================================================
     6. Validation

     Returns { ok, value, message, hint, autoApplied } where `value`
     is the normalized string that will actually be encoded. Errors
     name the format and say what to do, never just "invalid input".
     ============================================================ */

  function normalizeInput(format, raw) {
    var v = String(raw == null ? '' : raw);
    var meta = FORMATS[format];
    if (!meta) return v;
    v = v.replace(/^\s+|\s+$/g, '');
    if (meta.numeric) v = v.replace(/[\s\-_.]/g, '');
    if (format === 'CODE39' || format === 'CODE93' || format === 'CODABAR') v = v.toUpperCase();
    return v;
  }

  function badCharacters(value, allowed) {
    var bad = [];
    for (var i = 0; i < value.length; i++) {
      if (allowed.indexOf(value[i]) === -1 && bad.indexOf(value[i]) === -1) bad.push(value[i]);
    }
    return bad;
  }

  function describeChars(list) {
    return list.map(function (c) {
      if (c === ' ') return 'space';
      var code = c.charCodeAt(0);
      if (code < 32) return 'control character U+' + code.toString(16).toUpperCase();
      if (code > 126) return '"' + c + '" (U+' + code.toString(16).toUpperCase() + ')';
      return '"' + c + '"';
    }).join(', ');
  }

  /* Numeric fixed-length formats all share the same shape: accept
     either the payload (check digit computed) or the full code
     (check digit verified). */
  function validateGs1(format, value, opts, payloadLength) {
    var meta = FORMATS[format];
    var full = payloadLength + 1;

    if (!isDigits(value)) {
      return fail(
        meta.name + ' encodes digits only.',
        'Remove any letters, spaces or symbols — ' + meta.name + ' cannot represent them.'
      );
    }
    if (value.length === payloadLength) {
      if (!opts.autoCheck) {
        return fail(
          meta.name + ' needs ' + full + ' digits; you entered ' + payloadLength + '.',
          'Turn on "' + meta.autoCheckLabel + '" and the final digit will be calculated for you.'
        );
      }
      var computed = mod10(value);
      return { ok: true, value: value + computed, autoApplied: 'Check digit ' + computed + ' calculated and appended.' };
    }
    if (value.length === full) {
      var expected = mod10(value.slice(0, payloadLength));
      if (String(expected) !== value[payloadLength]) {
        return fail(
          'The ' + meta.name + ' check digit is wrong — ' + value + ' should end in ' + expected + '.',
          'Enter the first ' + payloadLength + ' digits with "' + meta.autoCheckLabel + '" enabled, or correct the last digit to ' + expected + '.',
          value.slice(0, payloadLength) + expected
        );
      }
      return { ok: true, value: value };
    }
    return fail(
      meta.name + ' needs ' + payloadLength + ' or ' + full + ' digits; you entered ' + value.length + '.',
      payloadLength + ' digits lets the tool calculate the check digit, ' + full + ' digits includes it.'
    );
  }

  function validate(format, rawValue, options) {
    var opts = options || {};
    var meta = FORMATS[format];
    if (!meta) return fail('Unknown barcode format.', '');

    var value = normalizeInput(format, rawValue);
    if (!value) {
      return fail('Enter the data you want to encode.', meta.placeholder);
    }

    switch (format) {
      case 'CODE128': {
        var over = [];
        for (var i = 0; i < value.length; i++) {
          if (value.charCodeAt(i) > 127 && over.indexOf(value[i]) === -1) over.push(value[i]);
        }
        if (over.length) {
          return fail(
            'CODE 128 covers ASCII 0–127 only, so ' + describeChars(over) + ' cannot be encoded.',
            'Replace accented or non-Latin characters with their plain ASCII equivalents.'
          );
        }
        if (value.length > 80) {
          return fail(
            'That is ' + value.length + ' characters — long enough that the barcode becomes impractical to scan.',
            'CODE 128 has no hard limit, but keep it under about 80 characters for a label that a handheld scanner can read in one pass.'
          );
        }
        return { ok: true, value: value };
      }

      case 'CODE39': {
        var bad39 = badCharacters(value, CODE39_CHARS);
        if (bad39.length) {
          return fail(
            'CODE 39 does not support ' + describeChars(bad39) + '.',
            'Allowed characters are 0–9, A–Z, space, and - . $ / + % — lower case is converted to upper case automatically.'
          );
        }
        return { ok: true, value: value };
      }

      case 'CODE93': {
        var bad93 = badCharacters(value, CODE39_CHARS);
        if (bad93.length) {
          return fail(
            'CODE 93 does not support ' + describeChars(bad93) + '.',
            'Allowed characters are 0–9, A–Z, space, and - . $ / + % — lower case is converted to upper case automatically.'
          );
        }
        return { ok: true, value: value };
      }

      case 'EAN13': return validateGs1('EAN13', value, opts, 12);
      case 'EAN8': return validateGs1('EAN8', value, opts, 7);
      case 'UPCA': return validateGs1('UPCA', value, opts, 11);
      case 'ITF14': return validateGs1('ITF14', value, opts, 13);

      case 'UPCE': {
        if (!isDigits(value)) {
          return fail('UPC-E encodes digits only.', 'Remove any letters, spaces or symbols.');
        }
        var ns, six, expanded, computedCheck;
        if (value.length === 6) {
          ns = '0';
          six = value;
        } else if (value.length === 7) {
          if (value[0] !== '0' && value[0] !== '1') {
            return fail(
              'A 7-digit UPC-E must start with number system 0 or 1; yours starts with ' + value[0] + '.',
              'Enter just the 6 data digits to use number system 0, or prefix the value with 0 or 1.'
            );
          }
          ns = value[0];
          six = value.slice(1);
        } else if (value.length === 8) {
          if (value[0] !== '0' && value[0] !== '1') {
            return fail(
              'A UPC-E must start with number system 0 or 1; yours starts with ' + value[0] + '.',
              'Change the first digit to 0 or 1, or enter only the 6 data digits.'
            );
          }
          ns = value[0];
          six = value.slice(1, 7);
          expanded = upceExpand(ns, six);
          computedCheck = mod10(expanded);
          if (String(computedCheck) !== value[7]) {
            return fail(
              'The UPC-E check digit is wrong — ' + value + ' should end in ' + computedCheck + '.',
              'The check digit comes from the expanded UPC-A (' + expanded + computedCheck + '), not from the six compressed digits.',
              value.slice(0, 7) + computedCheck
            );
          }
          return { ok: true, value: value };
        } else {
          return fail(
            'UPC-E needs 6, 7 or 8 digits; you entered ' + value.length + '.',
            '6 digits = data only, 7 adds the number system, 8 is the complete code including its check digit.'
          );
        }
        if (!opts.autoCheck) {
          return fail(
            'UPC-E needs its 8th check digit; you entered ' + value.length + ' digits.',
            'Turn on "' + meta.autoCheckLabel + '" or enter the full 8-digit code.'
          );
        }
        expanded = upceExpand(ns, six);
        computedCheck = mod10(expanded);
        return {
          ok: true,
          value: ns + six + computedCheck,
          autoApplied: 'Expanded to UPC-A ' + expanded + computedCheck + ', check digit ' + computedCheck + '.'
        };
      }

      case 'ITF': {
        if (!isDigits(value)) {
          return fail('ITF encodes digits only.', 'Interleaved 2 of 5 has no alphabetic characters — use CODE 128 or CODE 39 for text.');
        }
        var payload = value;
        var note = '';
        if (opts.autoCheck) {
          payload = value + String(mod10Luhn(value));
          note = 'Mod 10 check digit ' + payload[payload.length - 1] + ' appended.';
        }
        if (payload.length % 2 !== 0) {
          return fail(
            'ITF encodes digits in pairs, so it needs an even count — ' + payload.length + ' digits cannot be interleaved.',
            opts.autoCheck
              ? 'With the check digit enabled you need an odd number of digits. Add or remove one digit.'
              : 'Add a leading zero, remove a digit, or enable the Mod 10 check digit to make the count even.'
          );
        }
        return { ok: true, value: payload, autoApplied: note };
      }

      case 'CODABAR': {
        var v = value;
        var startStop = 'ABCD';
        var hasWrapper = v.length >= 2 &&
          startStop.indexOf(v[0]) !== -1 &&
          startStop.indexOf(v[v.length - 1]) !== -1;
        var note2 = '';
        if (!hasWrapper) {
          v = 'A' + v + 'B';
          note2 = 'Start/stop characters A and B added automatically.';
        }
        var body = v.slice(1, -1);
        var badCb = badCharacters(body, '0123456789-$:/.+');
        if (badCb.length) {
          return fail(
            'Codabar does not support ' + describeChars(badCb) + ' inside the code.',
            'Allowed characters are 0–9 and - $ : / . + — A, B, C and D are reserved for the start and stop positions.'
          );
        }
        if (!body.length) {
          return fail('Codabar needs at least one character between the start and stop characters.', 'Try something like A12345B.');
        }
        return { ok: true, value: v, autoApplied: note2 };
      }

      case 'MSI': {
        if (!isDigits(value)) {
          return fail('MSI encodes digits only.', 'MSI / Plessey has no alphabetic characters — use CODE 39 or CODE 128 for text.');
        }
        return { ok: true, value: value };
      }

      case 'PHARMACODE': {
        if (!isDigits(value)) {
          return fail('Pharmacode encodes a single whole number.', 'Enter a number between 3 and 131070 with no letters or symbols.');
        }
        var n = parseInt(value, 10);
        if (n < 3 || n > 131070) {
          return fail(
            'Pharmacode covers 3 to 131070; ' + n + ' is outside that range.',
            'The symbology encodes the number itself rather than its digits, which is what caps it at 131070.'
          );
        }
        return { ok: true, value: String(n) };
      }
    }

    return fail('Unknown barcode format.', '');
  }

  /* ============================================================
     7. encode() — validate, then build the render spec
     ============================================================ */

  function encode(format, rawValue, options) {
    var opts = options || {};
    var result = validate(format, rawValue, opts);
    if (!result.ok) return result;

    var value = result.value;
    var spec;

    switch (format) {
      case 'CODE128': spec = encodeCode128(value); break;
      case 'CODE39': spec = encodeCode39(value, opts); break;
      case 'CODE93': spec = encodeCode93(value); break;
      case 'EAN13': spec = encodeEan13(value); break;
      case 'EAN8': spec = encodeEan8(value); break;
      case 'UPCA': spec = encodeUpcA(value); break;
      case 'UPCE': spec = encodeUpcE(value); break;
      case 'ITF': spec = encodeItf(value, opts); break;
      case 'ITF14': spec = encodeItf(value, { bearer: opts.bearer !== false }); break;
      case 'CODABAR': spec = encodeCodabar(value); break;
      case 'MSI': spec = encodeMsi(value, opts); break;
      case 'PHARMACODE': spec = encodePharmacode(value); break;
      default: return fail('Unknown barcode format.', '');
    }

    spec.ok = true;
    spec.format = format;
    spec.value = value;
    spec.autoApplied = result.autoApplied || '';
    if (!FORMATS[format].supportsText) spec.text = '';
    return spec;
  }

  /* ============================================================
     8. Geometry / layout

     Both renderers consume the same layout so the SVG, the PNG and
     the on-screen preview are guaranteed to agree — the preview is
     the download, not an approximation of it.
     ============================================================ */

  var DEFAULT_OPTIONS = {
    barWidth: 2,
    height: 100,
    quietZone: 10,
    margin: 12,
    foreground: '#000000',
    background: '#ffffff',
    displayValue: true,
    fontSize: 20,
    fontFamily: 'monospace',
    fontWeight: 'normal',
    textAlign: 'center',
    textMargin: 4,
    rotation: 0,
    bearer: false,
    scale: 1
  };

  function normalizeOptions(spec, options) {
    var o = {};
    var src = options || {};
    for (var key in DEFAULT_OPTIONS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_OPTIONS, key)) {
        o[key] = src[key] === undefined ? DEFAULT_OPTIONS[key] : src[key];
      }
    }
    o.barWidth = clamp(parseFloat(o.barWidth), 0.5, 12);
    o.height = clamp(parseFloat(o.height), 20, 600);
    o.quietZone = clamp(parseFloat(o.quietZone), 0, 40);
    o.margin = clamp(parseFloat(o.margin), 0, 80);
    o.fontSize = clamp(parseFloat(o.fontSize), 6, 72);
    o.textMargin = clamp(parseFloat(o.textMargin), 0, 40);
    o.rotation = [0, 90, 180, 270].indexOf(Number(o.rotation)) === -1 ? 0 : Number(o.rotation);
    if (!spec.text) o.displayValue = false;
    return o;
  }

  /* Runs of consecutive set modules become one rect each. */
  function moduleRuns(modules) {
    var runs = [];
    var i = 0;
    while (i < modules.length) {
      if (modules[i] === '1') {
        var start = i;
        while (i < modules.length && modules[i] === '1') i++;
        runs.push({ start: start, length: i - start });
      } else {
        i++;
      }
    }
    return runs;
  }

  function inGuard(guards, start, end) {
    if (!guards) return false;
    for (var i = 0; i < guards.length; i++) {
      if (start >= guards[i][0] && end <= guards[i][1]) return true;
    }
    return false;
  }

  /* Rough advance width, used only to widen the canvas so a long
     human-readable line is never clipped. Deliberately generous. */
  function estimateTextWidth(text, fontSize) {
    return text.length * fontSize * 0.62;
  }

  function layout(spec, options) {
    var o = normalizeOptions(spec, options);
    var mw = o.barWidth;
    var quiet = o.quietZone * mw;
    var symbolWidth = spec.modules.length * mw;

    var hasGuards = !!(spec.guards && spec.guards.length && o.displayValue);
    var guardExtend = hasGuards ? Math.max(o.fontSize * 0.85, mw * 5) : 0;

    var bearerThickness = spec.bearer ? Math.max(mw * 4.5, 3) : 0;

    var barTop = o.margin + bearerThickness;
    var barBottom = barTop + o.height;
    var guardBottom = barBottom + guardExtend;

    var contentBottom = guardBottom + bearerThickness;
    if (o.displayValue) {
      contentBottom = hasGuards
        ? guardBottom + o.fontSize * 0.24
        : barBottom + bearerThickness + o.textMargin + o.fontSize * 1.05;
    }

    /* The bearer frame sits outside the quiet zone — GS1 requires the
       full quiet zone to remain clear inside the frame, not under it. */
    var width = symbolWidth + quiet * 2 + bearerThickness * 2;
    if (o.displayValue && !spec.textGroups) {
      width = Math.max(width, estimateTextWidth(spec.text, o.fontSize) + o.margin * 2);
    }
    if (spec.textOutside && spec.textOutside.length) {
      /* The digits printed outside the symbol need room of their own. */
      width = Math.max(width, symbolWidth + (o.fontSize * 0.75 + mw * 2) * 2);
    }
    var height = contentBottom + o.margin;

    var leftPad = (width - symbolWidth) / 2;

    var bars = [];
    if (spec.bearer) {
      var frameTop = o.margin;
      var frameBottom = guardBottom + bearerThickness;
      bars.push({ x: 0, y: frameTop, w: width, h: bearerThickness });
      bars.push({ x: 0, y: frameBottom - bearerThickness, w: width, h: bearerThickness });
      bars.push({ x: 0, y: frameTop, w: bearerThickness, h: frameBottom - frameTop });
      bars.push({ x: width - bearerThickness, y: frameTop, w: bearerThickness, h: frameBottom - frameTop });
    }

    var runs = moduleRuns(spec.modules);
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      var isGuard = inGuard(spec.guards, run.start, run.start + run.length - 1);
      bars.push({
        x: leftPad + run.start * mw,
        y: barTop,
        w: run.length * mw,
        h: (isGuard ? guardBottom : barBottom) - barTop
      });
    }

    var texts = [];
    if (o.displayValue) {
      var baseline = hasGuards ? guardBottom : barBottom + bearerThickness + o.textMargin + o.fontSize * 0.86;
      if (spec.textGroups) {
        for (var g = 0; g < spec.textGroups.length; g++) {
          var grp = spec.textGroups[g];
          texts.push({
            value: grp.text,
            x: leftPad + ((grp.from + grp.to + 1) / 2) * mw,
            y: baseline,
            anchor: 'middle'
          });
        }
        if (spec.textOutside) {
          for (var t = 0; t < spec.textOutside.length; t++) {
            var out = spec.textOutside[t];
            texts.push({
              value: out.text,
              x: out.side === 'left'
                ? leftPad - mw * 2
                : leftPad + symbolWidth + mw * 2,
              y: baseline,
              anchor: out.side === 'left' ? 'end' : 'start'
            });
          }
        }
      } else {
        var x = width / 2;
        var anchor = 'middle';
        if (o.textAlign === 'left') { x = leftPad; anchor = 'start'; }
        else if (o.textAlign === 'right') { x = leftPad + symbolWidth; anchor = 'end'; }
        texts.push({ value: spec.text, x: x, y: baseline, anchor: anchor });
      }
    }

    return {
      width: Math.ceil(width),
      height: Math.ceil(height),
      bars: bars,
      texts: texts,
      options: o,
      moduleWidth: mw,
      symbolWidth: symbolWidth,
      quietZone: quiet
    };
  }

  /* ============================================================
     9. SVG renderer
     ============================================================ */

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function round(n) {
    return Math.round(n * 1000) / 1000;
  }

  function toSvg(spec, options) {
    var l = layout(spec, options);
    var o = l.options;
    var rot = o.rotation;
    var outerW = (rot === 90 || rot === 270) ? l.height : l.width;
    var outerH = (rot === 90 || rot === 270) ? l.width : l.height;

    var transform = '';
    if (rot === 90) transform = 'translate(' + round(l.height) + ',0) rotate(90)';
    else if (rot === 180) transform = 'translate(' + round(l.width) + ',' + round(l.height) + ') rotate(180)';
    else if (rot === 270) transform = 'translate(0,' + round(l.width) + ') rotate(270)';

    var parts = [];
    var label = FORMATS[spec.format].name + ' barcode encoding ' + spec.value +
      ', ' + outerW + ' by ' + outerH + ' pixels';
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + outerW + '" height="' + outerH +
      '" viewBox="0 0 ' + outerW + ' ' + outerH + '" role="img" aria-label="' +
      escapeXml(label) + '">');
    parts.push('<rect width="' + outerW + '" height="' + outerH + '" fill="' + escapeXml(o.background) + '"/>');
    parts.push(transform ? '<g transform="' + transform + '">' : '<g>');

    parts.push('<g fill="' + escapeXml(o.foreground) + '" shape-rendering="crispEdges">');
    for (var i = 0; i < l.bars.length; i++) {
      var b = l.bars[i];
      parts.push('<rect x="' + round(b.x) + '" y="' + round(b.y) + '" width="' + round(b.w) + '" height="' + round(b.h) + '"/>');
    }
    parts.push('</g>');

    for (var t = 0; t < l.texts.length; t++) {
      var tx = l.texts[t];
      parts.push('<text x="' + round(tx.x) + '" y="' + round(tx.y) +
        '" fill="' + escapeXml(o.foreground) +
        '" font-family="' + escapeXml(o.fontFamily) +
        '" font-size="' + o.fontSize +
        '" font-weight="' + escapeXml(o.fontWeight) +
        '" text-anchor="' + tx.anchor +
        '" xml:space="preserve">' + escapeXml(tx.value) + '</text>');
    }

    parts.push('</g></svg>');
    return parts.join('');
  }

  /* ============================================================
     10. Canvas renderer (browser only)

     Rasterizing directly from the layout rather than round-tripping
     the SVG through an <img> keeps the bar edges on exact pixel
     boundaries at any scale, which is what print output needs.
     ============================================================ */

  function toCanvas(spec, options, scale) {
    var l = layout(spec, options);
    var o = l.options;
    var s = clamp(parseFloat(scale) || 1, 0.25, 12);
    var rot = o.rotation;

    var canvas = document.createElement('canvas');
    var outerW = (rot === 90 || rot === 270) ? l.height : l.width;
    var outerH = (rot === 90 || rot === 270) ? l.width : l.height;
    canvas.width = Math.max(1, Math.round(outerW * s));
    canvas.height = Math.max(1, Math.round(outerH * s));

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(s, s);
    if (rot === 90) { ctx.translate(l.height, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(l.width, l.height); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, l.width); ctx.rotate(-Math.PI / 2); }

    ctx.fillStyle = o.foreground;
    for (var i = 0; i < l.bars.length; i++) {
      var b = l.bars[i];
      /* Snap to the device pixel grid so bars stay hard-edged. */
      var x0 = Math.round(b.x * s) / s;
      var x1 = Math.round((b.x + b.w) * s) / s;
      ctx.fillRect(x0, b.y, Math.max(1 / s, x1 - x0), b.h);
    }

    if (l.texts.length) {
      ctx.font = o.fontWeight + ' ' + o.fontSize + 'px ' + o.fontFamily;
      ctx.fillStyle = o.foreground;
      for (var t = 0; t < l.texts.length; t++) {
        var tx = l.texts[t];
        ctx.textAlign = tx.anchor === 'middle' ? 'center' : (tx.anchor === 'end' ? 'right' : 'left');
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(tx.value, tx.x, tx.y);
      }
    }
    ctx.restore();
    return canvas;
  }

  /* ============================================================
     11. Filenames + engine export
     ============================================================ */

  /* User-supplied filenames are untrusted: strip anything that could
     escape the download directory or confuse the OS. */
  function safeFilename(base, extension) {
    var name = String(base == null ? '' : base)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\.+/g, '.')
      .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-');
    if (!name) name = 'barcode';
    if (name.length > 64) name = name.slice(0, 64);
    var ext = String(extension || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    return ext ? name + '.' + ext : name;
  }

  var engine = {
    FORMATS: FORMATS,
    FORMAT_ORDER: FORMAT_ORDER,
    GROUP_ORDER: GROUP_ORDER,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    mod10: mod10,
    mod10Luhn: mod10Luhn,
    mod43: mod43,
    code93Check: code93Check,
    upceExpand: upceExpand,
    widthsToModules: widthsToModules,
    maskToModules: maskToModules,
    normalizeInput: normalizeInput,
    validate: validate,
    encode: encode,
    layout: layout,
    toSvg: toSvg,
    toCanvas: toCanvas,
    safeFilename: safeFilename,
    estimateTextWidth: estimateTextWidth,
    /* Exposed so the test suite can decode a symbol back to its
       source data rather than only comparing it to itself. */
    tables: {
      CODE128_PATTERNS: CODE128_PATTERNS,
      CODE39_PATTERNS: CODE39_PATTERNS,
      CODE39_GUARD: CODE39_GUARD,
      CODE39_CHARS: CODE39_CHARS,
      CODE93_PATTERNS: CODE93_PATTERNS,
      CODE93_GUARD: CODE93_GUARD,
      EAN_L: EAN_L,
      EAN_G: EAN_G,
      EAN_R: EAN_R,
      EAN13_PARITY: EAN13_PARITY,
      UPCE_PARITY: UPCE_PARITY,
      ITF_PATTERNS: ITF_PATTERNS,
      CODABAR_CHARS: CODABAR_CHARS,
      CODABAR_PATTERNS: CODABAR_PATTERNS
    }
  };

  globalScope.ToolAddaBarcode = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here — everything below needs a document. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     12. UI state
     ============================================================ */

  var PREFS_KEY = 'tooladda-barcode-prefs';

  var PRESETS = {
    retail: {
      label: 'Retail',
      note: 'EAN-13 at retail-standard proportions with the check digit calculated for you.',
      format: 'EAN13',
      value: '590123412345',
      options: { barWidth: 2, height: 110, quietZone: 11, displayValue: true, fontSize: 20, autoCheck: true }
    },
    shipping: {
      label: 'Shipping',
      note: 'ITF-14 inside its bearer bar frame, sized for corrugated cartons.',
      format: 'ITF14',
      value: '1540014128876',
      options: { barWidth: 2.5, height: 120, quietZone: 12, displayValue: true, fontSize: 22, autoCheck: true, bearer: true }
    },
    inventory: {
      label: 'Inventory',
      note: 'CODE 128 at a compact size that still scans from a shelf label.',
      format: 'CODE128',
      value: 'INV-2026-00125',
      options: { barWidth: 2, height: 80, quietZone: 10, displayValue: true, fontSize: 16 }
    },
    developer: {
      label: 'Developer',
      note: 'CODE 128 with a taller symbol and monospace text for screenshots and docs.',
      format: 'CODE128',
      value: 'TOOLADDA-12345',
      options: { barWidth: 2, height: 100, quietZone: 10, displayValue: true, fontSize: 18 }
    }
  };

  var EXAMPLES = {
    CODE128: [
      { label: 'Inventory ID', value: 'INV-2026-00125' },
      { label: 'SKU', value: 'SKU-RED-XL-001' },
      { label: 'Serial number', value: 'SN-2026-000184' },
      { label: 'Shipping code', value: '123456789012' }
    ],
    CODE39: [
      { label: 'Asset tag', value: 'ASSET-4417' },
      { label: 'Batch', value: 'BATCH 2026 A' }
    ],
    CODE93: [
      { label: 'Route code', value: 'RTE-88-NORTH' },
      { label: 'Part number', value: 'PN 4471 X' }
    ],
    EAN13: [
      { label: 'Product code', value: '5901234123457' },
      { label: 'Without check digit', value: '400638133393' }
    ],
    EAN8: [
      { label: 'Small pack', value: '96385074' },
      { label: 'Without check digit', value: '2015036' }
    ],
    UPCA: [
      { label: 'US retail', value: '036000291452' },
      { label: 'Without check digit', value: '01234567890' }
    ],
    UPCE: [
      { label: 'Compressed UPC', value: '04252614' },
      { label: 'Data digits only', value: '425261' }
    ],
    ITF: [
      { label: 'Carton ID', value: '1234567890' },
      { label: 'Long numeric', value: '00123456789012' }
    ],
    ITF14: [
      { label: 'GTIN-14', value: '15400141288763' },
      { label: 'Without check digit', value: '1540014128876' }
    ],
    CODABAR: [
      { label: 'Library card', value: 'A12345678B' },
      { label: 'Blood bag', value: 'A0771234C' }
    ],
    MSI: [
      { label: 'Shelf label', value: '1234567' },
      { label: 'Bin number', value: '80523' }
    ],
    PHARMACODE: [
      { label: 'Carton code', value: '1234' },
      { label: 'Leaflet code', value: '58642' }
    ]
  };

  var PRINT_MODES = {
    screen: { label: 'Screen', scale: 1, note: 'Actual pixel size — right for web pages, documents and screenshots.' },
    standard: { label: 'Standard print', scale: 2, note: 'Rendered at 2× for roughly 150 DPI on a typical label printer.' },
    high: { label: 'High-resolution print', scale: 4, note: 'Rendered at 4× for roughly 300 DPI — the usual minimum for commercial packaging.' }
  };

  var state = {
    format: 'CODE128',
    value: 'TOOLADDA-12345',
    autoCheck: true,
    livePreview: true,
    printMode: 'screen',
    options: {
      barWidth: 2,
      height: 100,
      quietZone: 10,
      margin: 12,
      foreground: '#000000',
      background: '#ffffff',
      displayValue: true,
      fontSize: 20,
      fontFamily: 'monospace',
      fontWeight: 'normal',
      textAlign: 'center',
      textMargin: 4,
      rotation: 0,
      bearer: true
    },
    spec: null,
    batch: [],
    filename: ''
  };

  var dom = {};
  var debounceTimer = null;

  /* ============================================================
     13. DOM cache
     ============================================================ */

  function q(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function cacheDom() {
    dom.root = q('[data-bc-app]');
    if (!dom.root) return false;

    dom.tabs = qa('[data-bc-tab]', dom.root);
    dom.panels = qa('[data-bc-panel]', dom.root);

    dom.quickFormats = q('[data-bc-quick-formats]', dom.root);
    dom.formatSelect = q('[data-bc-format]', dom.root);
    dom.formatInfo = q('[data-bc-format-info]', dom.root);

    dom.input = q('[data-bc-input]', dom.root);
    dom.inputHint = q('[data-bc-input-hint]', dom.root);
    dom.charCount = q('[data-bc-charcount]', dom.root);
    dom.examples = q('[data-bc-examples]', dom.root);
    dom.presets = q('[data-bc-presets]', dom.root);
    dom.autoCheckRow = q('[data-bc-autocheck-row]', dom.root);
    dom.autoCheck = q('[data-bc-autocheck]', dom.root);
    dom.autoCheckLabel = q('[data-bc-autocheck-label]', dom.root);

    dom.generate = q('[data-bc-generate]', dom.root);
    dom.livePreview = q('[data-bc-live]', dom.root);
    dom.reset = q('[data-bc-reset]', dom.root);

    dom.stage = q('[data-bc-stage]', dom.root);
    dom.output = q('[data-bc-output]', dom.root);
    dom.placeholder = q('[data-bc-placeholder]', dom.root);
    dom.status = q('[data-bc-status]', dom.root);
    dom.alert = q('[data-bc-alert]', dom.root);
    dom.meta = q('[data-bc-meta]', dom.root);
    dom.warnings = q('[data-bc-warnings]', dom.root);

    dom.filename = q('[data-bc-filename]', dom.root);
    dom.downloads = qa('[data-bc-download]', dom.root);
    dom.copySvg = q('[data-bc-copy-svg]', dom.root);
    dom.copyData = q('[data-bc-copy-data]', dom.root);

    dom.settingInputs = qa('[data-bc-setting]', dom.root);
    dom.printMode = q('[data-bc-printmode]', dom.root);
    dom.printNote = q('[data-bc-printnote]', dom.root);
    dom.colorPresets = qa('[data-bc-colorpreset]', dom.root);
    dom.bearerRow = q('[data-bc-bearer-row]', dom.root);
    dom.textRows = qa('[data-bc-textrow]', dom.root);

    dom.batchInput = q('[data-bc-batch-input]', dom.root);
    dom.batchFile = q('[data-bc-batch-file]', dom.root);
    dom.batchGenerate = q('[data-bc-batch-generate]', dom.root);
    dom.batchClear = q('[data-bc-batch-clear]', dom.root);
    dom.batchTableWrap = q('[data-bc-batch-tablewrap]', dom.root);
    dom.batchBody = q('[data-bc-batch-body]', dom.root);
    dom.batchSummary = q('[data-bc-batch-summary]', dom.root);
    dom.batchZip = q('[data-bc-batch-zip]', dom.root);
    dom.batchFormatNote = q('[data-bc-batch-format]', dom.root);

    dom.validateFormat = q('[data-bc-validate-format]', dom.root);
    dom.validateInput = q('[data-bc-validate-input]', dom.root);
    dom.validateBtn = q('[data-bc-validate-btn]', dom.root);
    dom.validateResult = q('[data-bc-validate-result]', dom.root);

    return true;
  }

  /* ============================================================
     14. Rendering the controls
     ============================================================ */

  function currentMeta() {
    return FORMATS[state.format];
  }

  function renderFormatSelect() {
    var html = '';
    for (var g = 0; g < GROUP_ORDER.length; g++) {
      var group = GROUP_ORDER[g];
      var members = FORMAT_ORDER.filter(function (id) { return FORMATS[id].group === group; });
      if (!members.length) continue;
      html += '<optgroup label="' + escapeXml(group) + '">';
      for (var m = 0; m < members.length; m++) {
        var meta = FORMATS[members[m]];
        html += '<option value="' + meta.id + '">' + escapeXml(meta.name + ' — ' + meta.dataType) + '</option>';
      }
      html += '</optgroup>';
    }
    dom.formatSelect.innerHTML = html;
    dom.formatSelect.value = state.format;
  }

  function renderQuickFormats() {
    var quick = ['CODE128', 'EAN13', 'UPCA', 'CODE39', 'ITF14'];
    dom.quickFormats.innerHTML = quick.map(function (id) {
      var on = state.format === id ? ' is-on' : '';
      return '<button type="button" class="bc-chip' + on + '" data-bc-quick="' + id +
        '" aria-pressed="' + (state.format === id) + '">' + escapeXml(FORMATS[id].name) + '</button>';
    }).join('');
  }

  function renderFormatInfo() {
    var meta = currentMeta();
    dom.formatInfo.innerHTML =
      '<h3 class="bc-info__name">' + escapeXml(meta.name) + '<span class="bc-info__tag">' + escapeXml(meta.dimension) + '</span></h3>' +
      '<p class="bc-info__blurb">' + escapeXml(meta.blurb) + '</p>' +
      '<dl class="bc-info__list">' +
      '<dt>Data</dt><dd>' + escapeXml(meta.charset) + '</dd>' +
      '<dt>Length</dt><dd>' + escapeXml(meta.lengthLabel) + '</dd>' +
      '<dt>Check digit</dt><dd>' + escapeXml(meta.checksum) + '</dd>' +
      '<dt>Typical use</dt><dd>' + escapeXml(meta.uses) + '</dd>' +
      '</dl>';
  }

  function renderExamples() {
    var list = EXAMPLES[state.format] || [];
    dom.examples.innerHTML = list.map(function (ex) {
      return '<button type="button" class="bc-chip bc-chip--example" data-bc-example="' +
        escapeXml(ex.value) + '"><span class="bc-chip__k">' + escapeXml(ex.label) +
        '</span><code>' + escapeXml(ex.value) + '</code></button>';
    }).join('');
  }

  function renderPresets() {
    dom.presets.innerHTML = Object.keys(PRESETS).map(function (key) {
      return '<button type="button" class="bc-chip" data-bc-preset="' + key + '" title="' +
        escapeXml(PRESETS[key].note) + '">' + escapeXml(PRESETS[key].label) + '</button>';
    }).join('');
  }

  function syncFormatDependentUi() {
    var meta = currentMeta();

    dom.input.setAttribute('placeholder', meta.placeholder);
    dom.input.setAttribute('inputmode', meta.numeric ? 'numeric' : 'text');
    dom.inputHint.textContent = meta.charset + ' · ' + meta.lengthLabel;

    if (meta.autoCheck) {
      dom.autoCheckRow.hidden = false;
      dom.autoCheckLabel.textContent = meta.autoCheckLabel;
      dom.autoCheck.checked = state.autoCheck;
    } else {
      dom.autoCheckRow.hidden = true;
    }

    dom.bearerRow.hidden = state.format !== 'ITF14' && state.format !== 'ITF';

    var textDisabled = !meta.supportsText;
    dom.textRows.forEach(function (row) {
      row.hidden = textDisabled;
    });

    /* The quiet zone minimum is symbology-specific, so nudge it up
       when the user moves to a format that needs more room. */
    var minQuiet = meta.minQuiet;
    var qzInput = q('[data-bc-setting="quietZone"]', dom.root);
    if (qzInput && Number(qzInput.value) < minQuiet) {
      qzInput.value = minQuiet;
      state.options.quietZone = minQuiet;
      syncRangeOutputs();
    }

    renderQuickFormats();
    renderFormatInfo();
    renderExamples();
    if (dom.batchFormatNote) dom.batchFormatNote.textContent = meta.name;
  }

  function syncRangeOutputs() {
    dom.settingInputs.forEach(function (el) {
      var out = q('[data-bc-output-for="' + el.getAttribute('data-bc-setting') + '"]', dom.root);
      if (out) out.textContent = el.value + (el.getAttribute('data-bc-unit') || '');
    });
  }

  function updateCharCount() {
    var n = dom.input.value.length;
    dom.charCount.textContent = n + (n === 1 ? ' character' : ' characters');
  }

  /* ============================================================
     15. Generate / preview pipeline
     ============================================================ */

  function announce(message) {
    dom.status.textContent = message;
  }

  function showError(result) {
    state.spec = null;
    dom.output.innerHTML = '';
    dom.placeholder.hidden = false;
    dom.stage.classList.add('is-error');
    dom.alert.hidden = false;
    dom.alert.innerHTML = '<strong>' + escapeXml(result.message) + '</strong>' +
      (result.hint ? '<span>' + escapeXml(result.hint) + '</span>' : '');
    dom.meta.hidden = true;
    dom.warnings.hidden = true;
    setDownloadsEnabled(false);
    announce(result.message);
  }

  function setDownloadsEnabled(enabled) {
    dom.downloads.forEach(function (b) { b.disabled = !enabled; });
    if (dom.copySvg) dom.copySvg.disabled = !enabled;
    if (dom.copyData) dom.copyData.disabled = !enabled;
  }

  /* Contrast ratio per WCAG, used to warn before a colour choice
     makes the symbol unreadable to a scanner. */
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) {
      var v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    if (la === null || lb === null) return null;
    var hi = Math.max(la, lb);
    var lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* The narrow element's physical width is what actually decides
     whether a printer can reproduce the symbol, so it is reported in
     millimetres rather than left as an abstract pixel count. */
  function narrowBarMm(l) {
    return l.moduleWidth * PRINT_MODES[state.printMode].scale / 300 * 25.4;
  }

  function collectWarnings(spec, l) {
    var w = [];
    var o = state.options;
    var meta = FORMATS[spec.format];

    var ratio = contrastRatio(o.foreground, o.background);
    if (ratio !== null && ratio < 4.5) {
      w.push('Contrast between the bars and the background is only ' + ratio.toFixed(1) +
        ':1. Most laser scanners need a strong dark-on-light contrast — aim for 7:1 or better, and keep the bars darker than the background.');
    }
    if (luminance(o.foreground) !== null && luminance(o.background) !== null &&
        luminance(o.foreground) > luminance(o.background)) {
      w.push('The bars are lighter than the background. Inverted barcodes are read by very few scanners — swap the colours unless you have tested the exact hardware.');
    }
    if (o.barWidth < 1) {
      w.push('A bar width below 1 px will blur on screen and print. The narrow element should stay at or above 0.25 mm (about 3 px at 300 DPI) for reliable decoding.');
    }
    /* Only raised once a print preset is chosen — at the screen
       preset the physical size is simply reported, not complained
       about, because nobody printing has committed to anything yet. */
    if (state.printMode !== 'screen' && narrowBarMm(l) < 0.25) {
      w.push('At the ' + PRINT_MODES[state.printMode].label + ' preset the narrow bar comes out at ' +
        narrowBarMm(l).toFixed(2) + ' mm on a 300 DPI printer, below the 0.25 mm practical minimum. ' +
        'Increase the bar width or move to the high-resolution preset before printing at actual size.');
    }
    if (o.quietZone < meta.minQuiet) {
      w.push(meta.name + ' expects a quiet zone of at least ' + meta.minQuiet +
        ' modules on each side. Yours is ' + o.quietZone + ' — scanners may fail to find the symbol edges.');
    }
    if (o.height < l.symbolWidth * 0.1 && spec.format !== 'PHARMACODE') {
      w.push('The bars are short relative to the symbol width, which narrows the angle a scanner can read from. A height of about 15% of the barcode width is the usual guideline.');
    }
    if (o.rotation !== 0) {
      w.push('The symbol is rotated ' + o.rotation + '°. That is fine for most scanners, but check the orientation your label applicator and hardware expect.');
    }
    return w;
  }

  function renderMeta(spec, l) {
    var meta = FORMATS[spec.format];
    var scale = PRINT_MODES[state.printMode].scale;
    var mmAt300 = (l.width * scale / 300 * 25.4).toFixed(1);

    var rows = [
      ['Symbology', meta.name],
      ['Encoded value', spec.value],
      ['Modules', String(spec.modules.length)],
      ['Output size', l.width + ' × ' + l.height + ' px' + (scale !== 1 ? ' (×' + scale + ' = ' + Math.round(l.width * scale) + ' × ' + Math.round(l.height * scale) + ' px)' : '')],
      ['At 300 DPI', '≈ ' + mmAt300 + ' mm wide'],
      ['Narrow bar', narrowBarMm(l).toFixed(2) + ' mm at 300 DPI']
    ];
    dom.meta.innerHTML = rows.map(function (r) {
      return '<div class="bc-meta__cell"><dt>' + escapeXml(r[0]) + '</dt><dd>' + escapeXml(r[1]) + '</dd></div>';
    }).join('');
    dom.meta.hidden = false;
  }

  function generate(options) {
    var silent = options && options.silent;
    var raw = dom.input.value;
    state.value = raw;

    var result = encode(state.format, raw, {
      autoCheck: state.autoCheck,
      bearer: state.options.bearer
    });

    if (!result.ok) {
      if (!raw.replace(/^\s+|\s+$/g, '') && silent) {
        /* Empty field during live preview is not an error yet. */
        state.spec = null;
        dom.output.innerHTML = '';
        dom.placeholder.hidden = false;
        dom.stage.classList.remove('is-error');
        dom.alert.hidden = true;
        dom.meta.hidden = true;
        dom.warnings.hidden = true;
        setDownloadsEnabled(false);
        return;
      }
      showError(result);
      return;
    }

    state.spec = result;
    var l = layout(result, state.options);

    /* Parsed as XML and imported as a node rather than assigned
       through innerHTML — the barcode value is untrusted input and
       never needs to travel through an HTML parser. */
    var doc = new DOMParser().parseFromString(toSvg(result, state.options), 'image/svg+xml');
    var svgEl = doc.documentElement;
    dom.output.textContent = '';
    if (svgEl && svgEl.nodeName.toLowerCase() === 'svg') {
      /* The width/height attributes stay so the preview keeps the
         symbol's real proportions; CSS caps it to the stage. */
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      dom.output.appendChild(document.importNode(svgEl, true));
    }

    dom.placeholder.hidden = true;
    dom.stage.classList.remove('is-error');
    dom.alert.hidden = true;
    setDownloadsEnabled(true);
    renderMeta(result, l);

    var warnings = collectWarnings(result, l);
    if (warnings.length) {
      dom.warnings.hidden = false;
      dom.warnings.innerHTML = '<p class="bc-warn__title">Scannability check</p><ul>' +
        warnings.map(function (x) { return '<li>' + escapeXml(x) + '</li>'; }).join('') + '</ul>';
    } else {
      dom.warnings.hidden = false;
      dom.warnings.innerHTML = '<p class="bc-warn__title bc-warn__title--ok">Scannability check passed</p>' +
        '<ul><li>Contrast, quiet zone, bar width and height are all within the usual tolerances. Print a test label and scan it with your own hardware before a production run.</li></ul>';
    }

    var announcement = FORMATS[state.format].name + ' barcode generated for ' + result.value +
      ', ' + l.width + ' by ' + l.height + ' pixels.';
    if (result.autoApplied) announcement += ' ' + result.autoApplied;
    announce(announcement);
  }

  function scheduleLivePreview() {
    if (!state.livePreview) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { generate({ silent: true }); }, 160);
  }

  /* ============================================================
     16. Downloads
     ============================================================ */

  function defaultFilename() {
    var typed = dom.filename ? dom.filename.value : '';
    if (typed) return typed;
    return 'barcode-' + state.format.toLowerCase();
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function download(kind) {
    if (!state.spec) return;
    var scale = PRINT_MODES[state.printMode].scale;

    if (kind === 'svg') {
      var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + toSvg(state.spec, state.options);
      triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
        safeFilename(defaultFilename(), 'svg'));
      announce('SVG downloaded.');
      return;
    }

    var canvas = toCanvas(state.spec, state.options, scale);
    var mime = kind === 'jpg' ? 'image/jpeg' : 'image/png';
    var quality = kind === 'jpg' ? 0.95 : undefined;

    canvas.toBlob(function (blob) {
      if (!blob) {
        announce('Your browser could not encode that format. Try PNG or SVG.');
        return;
      }
      triggerDownload(blob, safeFilename(defaultFilename(), kind === 'jpg' ? 'jpg' : 'png'));
      announce(kind.toUpperCase() + ' downloaded at ' + canvas.width + ' by ' + canvas.height + ' pixels.');
    }, mime, quality);
  }

  function copyToClipboard(text, label) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      announce('Clipboard access is not available in this browser.');
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      announce(label + ' copied to the clipboard.');
    }, function () {
      announce('Could not copy to the clipboard.');
    });
  }

  /* ============================================================
     17. Batch mode
     ============================================================ */

  function parseBatchLines(text) {
    return String(text).split(/\r?\n/)
      .map(function (line) { return line.replace(/^\s+|\s+$/g, ''); })
      .filter(function (line) { return line.length > 0; });
  }

  /* Minimal CSV handling: split on commas outside quotes, then take
     the first column. Enough for the "one code per row" exports that
     inventory systems produce, without pulling in a parser. */
  function firstCsvColumn(text) {
    var lines = parseBatchLines(text);
    var values = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var cell = '';
      var inQuotes = false;
      for (var c = 0; c < line.length; c++) {
        var ch = line[c];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) break;
        cell += ch;
      }
      cell = cell.replace(/^\s+|\s+$/g, '');
      if (cell) values.push(cell);
    }
    /* Drop an obvious header row. */
    if (values.length > 1 && /^[a-z_ ]+$/i.test(values[0]) &&
        !validate(state.format, values[0], { autoCheck: state.autoCheck }).ok) {
      var rest = values.slice(1);
      if (rest.length) return rest;
    }
    return values;
  }

  function runBatch() {
    var values = parseBatchLines(dom.batchInput.value);
    if (!values.length) {
      dom.batchSummary.textContent = 'Enter at least one value, one per line.';
      dom.batchTableWrap.hidden = true;
      dom.batchZip.disabled = true;
      return;
    }
    if (values.length > 500) {
      values = values.slice(0, 500);
    }

    state.batch = values.map(function (v) {
      var spec = encode(state.format, v, { autoCheck: state.autoCheck, bearer: state.options.bearer });
      return { input: v, spec: spec.ok ? spec : null, error: spec.ok ? '' : spec.message };
    });

    var ok = state.batch.filter(function (r) { return r.spec; }).length;
    dom.batchSummary.textContent = ok + ' of ' + state.batch.length + ' value' +
      (state.batch.length === 1 ? '' : 's') + ' encoded as ' + FORMATS[state.format].name + '.';
    dom.batchZip.disabled = ok === 0;
    dom.batchTableWrap.hidden = false;

    dom.batchBody.innerHTML = state.batch.map(function (row, i) {
      var status = row.spec
        ? '<span class="bc-badge bc-badge--ok">Ready</span>'
        : '<span class="bc-badge bc-badge--err">Error</span>';
      var detail = row.spec
        ? '<code>' + escapeXml(row.spec.value) + '</code>'
        : '<span class="bc-batch__err">' + escapeXml(row.error) + '</span>';
      var actions = row.spec
        ? '<button type="button" class="bc-btn bc-btn--ghost bc-btn--xs" data-bc-batch-download="' + i + '">PNG</button>' +
          '<button type="button" class="bc-btn bc-btn--ghost bc-btn--xs" data-bc-batch-download-svg="' + i + '">SVG</button>'
        : '<span class="bc-muted">—</span>';
      return '<tr><td><code>' + escapeXml(row.input) + '</code></td><td>' + detail +
        '</td><td>' + status + '</td><td class="bc-batch__actions">' + actions + '</td></tr>';
    }).join('');

    announce(dom.batchSummary.textContent);
  }

  function batchDownloadOne(index, kind) {
    var row = state.batch[index];
    if (!row || !row.spec) return;
    var name = safeFilename('barcode-' + state.format.toLowerCase() + '-' + row.spec.value, kind);
    if (kind === 'svg') {
      triggerDownload(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + toSvg(row.spec, state.options)],
        { type: 'image/svg+xml;charset=utf-8' }), name);
      return;
    }
    toCanvas(row.spec, state.options, PRINT_MODES[state.printMode].scale)
      .toBlob(function (blob) { if (blob) triggerDownload(blob, name); }, 'image/png');
  }

  /* JSZip is only needed when someone actually asks for a ZIP, so it
     is not part of the initial page weight. */
  function loadJsZip() {
    return new Promise(function (resolve, reject) {
      if (globalScope.JSZip) return resolve(globalScope.JSZip);
      var s = document.createElement('script');
      s.src = 'assets/js/jszip.min.js';
      s.onload = function () {
        globalScope.JSZip ? resolve(globalScope.JSZip) : reject(new Error('JSZip unavailable'));
      };
      s.onerror = function () { reject(new Error('Could not load the ZIP library')); };
      document.head.appendChild(s);
    });
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
    });
  }

  function batchZip() {
    var rows = state.batch.filter(function (r) { return r.spec; });
    if (!rows.length) return;

    dom.batchZip.disabled = true;
    var original = dom.batchZip.textContent;
    dom.batchZip.textContent = 'Building ZIP…';

    loadJsZip().then(function (JSZip) {
      var zip = new JSZip();
      var scale = PRINT_MODES[state.printMode].scale;
      var jobs = rows.map(function (row, i) {
        var base = safeFilename(String(i + 1).padStart(4, '0') + '-' + row.spec.value, '');
        zip.file(base + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + toSvg(row.spec, state.options));
        return canvasToBlob(toCanvas(row.spec, state.options, scale)).then(function (blob) {
          if (blob) zip.file(base + '.png', blob);
        });
      });
      return Promise.all(jobs).then(function () {
        return zip.generateAsync({ type: 'blob' });
      });
    }).then(function (blob) {
      triggerDownload(blob, safeFilename('barcodes-' + state.format.toLowerCase(), 'zip'));
      announce(rows.length + ' barcodes downloaded as a ZIP archive.');
    }).catch(function (err) {
      announce('ZIP export failed: ' + (err && err.message ? err.message : 'unknown error'));
    }).then(function () {
      dom.batchZip.disabled = false;
      dom.batchZip.textContent = original;
    });
  }

  /* ============================================================
     18. Validator mode
     ============================================================ */

  function renderValidateFormats() {
    var html = '';
    for (var g = 0; g < GROUP_ORDER.length; g++) {
      var members = FORMAT_ORDER.filter(function (id) { return FORMATS[id].group === GROUP_ORDER[g]; });
      if (!members.length) continue;
      html += '<optgroup label="' + escapeXml(GROUP_ORDER[g]) + '">';
      for (var m = 0; m < members.length; m++) {
        html += '<option value="' + members[m] + '">' + escapeXml(FORMATS[members[m]].name) + '</option>';
      }
      html += '</optgroup>';
    }
    dom.validateFormat.innerHTML = html;
    dom.validateFormat.value = state.format;
  }

  function runValidate() {
    var format = dom.validateFormat.value;
    var raw = dom.validateInput.value;
    var meta = FORMATS[format];

    /* Validate strictly — the point of this panel is to tell you
       whether the code you already have is correct, so nothing is
       auto-corrected here. */
    var strict = validate(format, raw, { autoCheck: false });
    var normalized = normalizeInput(format, raw);

    var rows = [
      ['Format', meta.name],
      ['Input', raw || '(empty)'],
      ['Normalized', normalized || '(empty)'],
      ['Length', String(normalized.length)],
      ['Allowed characters', meta.charset]
    ];

    var body = '<dl class="bc-vresult__list">' + rows.map(function (r) {
      return '<dt>' + escapeXml(r[0]) + '</dt><dd>' + escapeXml(r[1]) + '</dd>';
    }).join('') + '</dl>';

    if (strict.ok) {
      var spec = encode(format, raw, { autoCheck: false });
      dom.validateResult.className = 'bc-vresult bc-vresult--ok';
      dom.validateResult.innerHTML = '<p class="bc-vresult__verdict">Valid ' + escapeXml(meta.name) + '</p>' +
        '<p class="bc-vresult__detail">The value satisfies the character set, the length rules and the check digit for this symbology' +
        (spec.ok ? ' and encodes to ' + spec.modules.length + ' modules' : '') + '.</p>' + body;
    } else {
      /* Offer the corrected value when the only problem is a missing
         or wrong check digit — that is by far the most common case. */
      var repaired = validate(format, raw, { autoCheck: true });
      var fixed = strict.suggestion || (repaired.ok && repaired.value !== normalized ? repaired.value : '');
      var suggestion = fixed
        ? '<p class="bc-vresult__fix">Corrected value: <code>' + escapeXml(fixed) + '</code></p>'
        : '';
      dom.validateResult.className = 'bc-vresult bc-vresult--bad';
      dom.validateResult.innerHTML = '<p class="bc-vresult__verdict">Not a valid ' + escapeXml(meta.name) + '</p>' +
        '<p class="bc-vresult__detail">' + escapeXml(strict.message) + '</p>' +
        (strict.hint ? '<p class="bc-vresult__hint">' + escapeXml(strict.hint) + '</p>' : '') +
        suggestion + body;
    }
    dom.validateResult.hidden = false;
    announce(strict.ok ? 'Validation passed.' : 'Validation failed: ' + strict.message);
  }

  /* ============================================================
     19. Preferences, events, init
     ============================================================ */

  /* Only interface preferences are stored. The barcode data itself
     is never written to localStorage — people put serial numbers and
     internal identifiers in that field. */
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        format: state.format,
        livePreview: state.livePreview,
        printMode: state.printMode,
        options: state.options
      }));
    } catch (e) { /* private mode, quota — not worth surfacing */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.format && FORMATS[saved.format]) state.format = saved.format;
      if (typeof saved.livePreview === 'boolean') state.livePreview = saved.livePreview;
      if (saved.printMode && PRINT_MODES[saved.printMode]) state.printMode = saved.printMode;
      if (saved.options) {
        for (var k in state.options) {
          if (Object.prototype.hasOwnProperty.call(saved.options, k)) state.options[k] = saved.options[k];
        }
      }
    } catch (e) { /* corrupt prefs simply fall back to defaults */ }
  }

  function applyStateToControls() {
    dom.formatSelect.value = state.format;
    dom.livePreview.checked = state.livePreview;
    dom.printMode.value = state.printMode;
    dom.printNote.textContent = PRINT_MODES[state.printMode].note;

    dom.settingInputs.forEach(function (el) {
      var key = el.getAttribute('data-bc-setting');
      if (!(key in state.options)) return;
      if (el.type === 'checkbox') el.checked = !!state.options[key];
      else el.value = state.options[key];
    });
    syncRangeOutputs();
  }

  function readSetting(el) {
    var key = el.getAttribute('data-bc-setting');
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') return parseFloat(el.value);
    return el.value;
  }

  function bindTabs() {
    dom.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-bc-tab');
        dom.tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          t.tabIndex = on ? 0 : -1;
        });
        dom.panels.forEach(function (p) {
          p.hidden = p.getAttribute('data-bc-panel') !== name;
        });
        if (name === 'validate') dom.validateFormat.value = state.format;
      });
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var i = dom.tabs.indexOf(tab);
        var next = dom.tabs[(i + (e.key === 'ArrowRight' ? 1 : dom.tabs.length - 1)) % dom.tabs.length];
        next.focus();
        next.click();
      });
    });
  }

  function setFormat(id) {
    if (!FORMATS[id]) return;
    state.format = id;
    dom.formatSelect.value = id;
    /* The check-digit toggle means something different in each
       symbology — mandatory for EAN and UPC, optional for ITF, MSI
       and CODE 39 — so it resets to that format's convention rather
       than carrying a setting that would immediately invalidate the
       value the user just pasted. */
    state.autoCheck = FORMATS[id].autoCheck ? FORMATS[id].autoCheckDefault !== false : false;
    syncFormatDependentUi();
    savePrefs();
    if (state.livePreview) generate({ silent: true });
  }

  function bindEvents() {
    dom.formatSelect.addEventListener('change', function () { setFormat(dom.formatSelect.value); });

    dom.quickFormats.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-bc-quick]');
      if (btn) setFormat(btn.getAttribute('data-bc-quick'));
    });

    dom.examples.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-bc-example]');
      if (!btn) return;
      dom.input.value = btn.getAttribute('data-bc-example');
      updateCharCount();
      generate();
      dom.input.focus();
    });

    dom.presets.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-bc-preset]');
      if (!btn) return;
      var preset = PRESETS[btn.getAttribute('data-bc-preset')];
      if (!preset) return;
      state.format = preset.format;
      state.autoCheck = typeof preset.options.autoCheck === 'boolean'
        ? preset.options.autoCheck
        : FORMATS[preset.format].autoCheckDefault !== false;
      for (var k in preset.options) {
        if (k !== 'autoCheck' && k in state.options) state.options[k] = preset.options[k];
      }
      dom.input.value = preset.value;
      applyStateToControls();
      syncFormatDependentUi();
      updateCharCount();
      generate();
      savePrefs();
    });

    dom.input.addEventListener('input', function () {
      updateCharCount();
      scheduleLivePreview();
    });
    dom.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        generate();
      }
    });

    dom.autoCheck.addEventListener('change', function () {
      state.autoCheck = dom.autoCheck.checked;
      scheduleLivePreview();
    });

    dom.generate.addEventListener('click', function () { generate(); });

    dom.livePreview.addEventListener('change', function () {
      state.livePreview = dom.livePreview.checked;
      savePrefs();
      if (state.livePreview) generate({ silent: true });
    });

    dom.reset.addEventListener('click', function () {
      state.format = 'CODE128';
      state.autoCheck = true;
      state.printMode = 'screen';
      state.options = {
        barWidth: 2, height: 100, quietZone: 10, margin: 12,
        foreground: '#000000', background: '#ffffff', displayValue: true,
        fontSize: 20, fontFamily: 'monospace', fontWeight: 'normal',
        textAlign: 'center', textMargin: 4, rotation: 0, bearer: true
      };
      dom.input.value = FORMATS.CODE128.sample;
      if (dom.filename) dom.filename.value = '';
      applyStateToControls();
      syncFormatDependentUi();
      updateCharCount();
      generate();
      savePrefs();
      announce('Settings reset to defaults.');
    });

    dom.settingInputs.forEach(function (el) {
      var handler = function () {
        var key = el.getAttribute('data-bc-setting');
        state.options[key] = readSetting(el);
        syncRangeOutputs();
        savePrefs();
        if (state.livePreview) scheduleLivePreview();
        else if (state.spec) generate({ silent: true });
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    dom.printMode.addEventListener('change', function () {
      state.printMode = dom.printMode.value;
      dom.printNote.textContent = PRINT_MODES[state.printMode].note;
      savePrefs();
      if (state.spec) generate({ silent: true });
    });

    dom.colorPresets.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.options.foreground = btn.getAttribute('data-bc-fg');
        state.options.background = btn.getAttribute('data-bc-bg');
        applyStateToControls();
        savePrefs();
        generate({ silent: true });
      });
    });

    dom.downloads.forEach(function (btn) {
      btn.addEventListener('click', function () { download(btn.getAttribute('data-bc-download')); });
    });

    if (dom.copySvg) {
      dom.copySvg.addEventListener('click', function () {
        if (state.spec) copyToClipboard(toSvg(state.spec, state.options), 'SVG markup');
      });
    }
    if (dom.copyData) {
      dom.copyData.addEventListener('click', function () {
        if (state.spec) copyToClipboard(state.spec.value, 'Encoded value');
      });
    }

    /* --- batch --- */
    dom.batchGenerate.addEventListener('click', runBatch);
    dom.batchClear.addEventListener('click', function () {
      dom.batchInput.value = '';
      state.batch = [];
      dom.batchBody.innerHTML = '';
      dom.batchTableWrap.hidden = true;
      dom.batchSummary.textContent = '';
      dom.batchZip.disabled = true;
    });
    dom.batchZip.addEventListener('click', batchZip);
    dom.batchBody.addEventListener('click', function (e) {
      var png = e.target.closest('[data-bc-batch-download]');
      if (png) return batchDownloadOne(parseInt(png.getAttribute('data-bc-batch-download'), 10), 'png');
      var svg = e.target.closest('[data-bc-batch-download-svg]');
      if (svg) batchDownloadOne(parseInt(svg.getAttribute('data-bc-batch-download-svg'), 10), 'svg');
    });
    dom.batchFile.addEventListener('change', function () {
      var file = dom.batchFile.files && dom.batchFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var values = firstCsvColumn(String(reader.result));
        dom.batchInput.value = values.join('\n');
        dom.batchFile.value = '';
        runBatch();
      };
      reader.readAsText(file);
    });

    /* --- validator --- */
    dom.validateBtn.addEventListener('click', runValidate);
    dom.validateInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runValidate(); }
    });

  }

  function init() {
    if (!cacheDom()) return;

    loadPrefs();
    renderFormatSelect();
    renderValidateFormats();
    renderPresets();
    applyStateToControls();
    syncFormatDependentUi();

    state.autoCheck = currentMeta().autoCheck ? currentMeta().autoCheckDefault !== false : false;
    dom.autoCheck.checked = state.autoCheck;

    if (!dom.input.value) dom.input.value = currentMeta().sample;
    updateCharCount();

    bindTabs();
    bindEvents();
    generate({ silent: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
