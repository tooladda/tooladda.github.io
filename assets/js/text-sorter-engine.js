/* ==========================================================================
   ToolAdda — Text Sorter Engine

   Pure, dependency-free sort logic. The UI never invents an order of its
   own: every mode, toggle and export goes through this file so the live
   result and a downloaded file cannot drift apart.

   Natural sort is the one mode people come here for after a spreadsheet
   has disappointed them. "item2" must come before "item10". The compare
   walks numeric and non-numeric runs separately so leading zeros and
   mixed tokens stay stable.

   Shuffle is Fisher–Yates. Tests inject a rng so the permutation is
   deterministic; the page uses Math.random.
   ========================================================================== */
(function (global) {
  'use strict';

  var SPLIT_MODES = ['lines', 'words'];
  var SORT_MODES = ['az', 'za', 'short', 'long', 'natural', 'shuffle'];

  var SAMPLES = {
    fruits: 'Orange\napple\nBanana\nMango\napple\n\nKiwi',
    names: 'Ada Lovelace\nGrace Hopper\nAlan Turing\nBarbara Liskov\nDonald Knuth',
    files: 'item10.txt\nitem2.txt\nitem1.txt\nitem20.txt\nreadme.md',
    words: 'the quick brown fox jumps over the lazy dog'
  };

  var MAX_CHARS = 400000;
  var MAX_UNITS = 80000;

  function defaultOptions() {
    return {
      splitMode: 'lines',
      sortMode: 'az',
      caseInsensitive: false,
      removeBlanks: false,
      removeDuplicates: false,
      trim: true,
      reverse: false,
      ignoreNumbers: false,
      ignorePunctuation: false,
      lastWord: false
    };
  }

  function normalizeOptions(raw) {
    var base = defaultOptions();
    var src = raw && typeof raw === 'object' ? raw : {};
    var next = {};
    next.splitMode = SPLIT_MODES.indexOf(src.splitMode) >= 0 ? src.splitMode : base.splitMode;
    next.sortMode = SORT_MODES.indexOf(src.sortMode) >= 0 ? src.sortMode : base.sortMode;
    next.caseInsensitive = Boolean(src.caseInsensitive);
    next.removeBlanks = Boolean(src.removeBlanks);
    next.removeDuplicates = Boolean(src.removeDuplicates);
    next.trim = src.trim === undefined ? base.trim : Boolean(src.trim);
    next.reverse = Boolean(src.reverse);
    next.ignoreNumbers = Boolean(src.ignoreNumbers);
    next.ignorePunctuation = Boolean(src.ignorePunctuation);
    next.lastWord = Boolean(src.lastWord);
    return next;
  }

  function capText(value) {
    var text = String(value == null ? '' : value);
    if (text.length > MAX_CHARS) return text.slice(0, MAX_CHARS);
    return text;
  }

  function splitUnits(text, splitMode) {
    var v = capText(text);
    if (splitMode === 'words') {
      var t = v.trim();
      return t.length ? t.split(/\s+/) : [];
    }
    return v.split(/\r?\n/);
  }

  function joinUnits(units, splitMode) {
    var list = Array.isArray(units) ? units : [];
    return list.join(splitMode === 'words' ? ' ' : '\n');
  }

  function lastToken(str) {
    var parts = String(str).trim().split(/\s+/);
    return parts[parts.length - 1] || '';
  }

  function stripPunctuation(str) {
    try {
      return String(str).replace(/[^\p{L}\p{N}\s]+/gu, '');
    } catch (e) {
      return String(str).replace(/[^\w\s]+/g, '');
    }
  }

  function normalizeForCompare(str, options) {
    var opts = normalizeOptions(options);
    var s = String(str);
    if (opts.lastWord) s = lastToken(s);
    if (opts.trim) s = s.trim();
    if (opts.ignorePunctuation) s = stripPunctuation(s);
    if (opts.caseInsensitive) s = s.toLowerCase();
    if (opts.ignoreNumbers) s = s.replace(/\d+/g, '');
    return s;
  }

  function naturalCompare(a, b, options) {
    var ax = normalizeForCompare(a, options);
    var bx = normalizeForCompare(b, options);
    var re = /(\d+)|(\D+)/g;
    var ap = ax.match(re) || [];
    var bp = bx.match(re) || [];
    var len = Math.max(ap.length, bp.length);
    var i;
    for (i = 0; i < len; i++) {
      var as = ap[i] || '';
      var bs = bp[i] || '';
      var aNum = /^\d+$/.test(as);
      var bNum = /^\d+$/.test(bs);
      if (aNum && bNum) {
        var an = Number(as);
        var bn = Number(bs);
        if (an !== bn) return an - bn;
        if (as !== bs) return as < bs ? -1 : 1;
      } else if (as !== bs) {
        return as < bs ? -1 : 1;
      }
    }
    return 0;
  }

  function localeCompareSafe(a, b, caseInsensitive) {
    var left = String(a);
    var right = String(b);
    if (caseInsensitive) {
      return left.localeCompare(right, undefined, { numeric: false, sensitivity: 'base' });
    }
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  function prepareUnits(units, options) {
    var opts = normalizeOptions(options);
    var work = (Array.isArray(units) ? units : []).slice();
    if (work.length > MAX_UNITS) work = work.slice(0, MAX_UNITS);

    if (opts.trim) {
      work = work.map(function (line) { return String(line).trim(); });
    }

    if (opts.removeBlanks) {
      work = work.filter(function (line) { return line !== ''; });
    }

    if (opts.removeDuplicates) {
      var seen = {};
      var next = [];
      var i;
      for (i = 0; i < work.length; i++) {
        var line = work[i];
        var key = opts.caseInsensitive ? String(line).toLowerCase() : String(line);
        if (!Object.prototype.hasOwnProperty.call(seen, key)) {
          seen[key] = true;
          next.push(line);
        }
      }
      work = next;
    }

    return work;
  }

  function sortUnits(units, options, rng) {
    var opts = normalizeOptions(options);
    var work = prepareUnits(units, opts);
    var indexed = work.map(function (line, idx) {
      return { line: line, idx: idx };
    });

    function direction(a, b, baseCompare) {
      var res = baseCompare(a, b);
      return res === 0 ? a.idx - b.idx : res;
    }

    if (opts.sortMode === 'shuffle') {
      var rand = typeof rng === 'function' ? rng : Math.random;
      var i;
      for (i = indexed.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var tmp = indexed[i];
        indexed[i] = indexed[j];
        indexed[j] = tmp;
      }
    } else {
      indexed.sort(function (A, B) {
        switch (opts.sortMode) {
          case 'za':
            return direction(A, B, function (a, b) {
              return localeCompareSafe(
                normalizeForCompare(b.line, opts),
                normalizeForCompare(a.line, opts),
                opts.caseInsensitive
              );
            });
          case 'short':
            return direction(A, B, function (a, b) {
              var al = String(a.line).length;
              var bl = String(b.line).length;
              if (al !== bl) return al - bl;
              return localeCompareSafe(normalizeForCompare(a.line, opts), normalizeForCompare(b.line, opts), opts.caseInsensitive);
            });
          case 'long':
            return direction(A, B, function (a, b) {
              var al = String(a.line).length;
              var bl = String(b.line).length;
              if (al !== bl) return bl - al;
              return localeCompareSafe(normalizeForCompare(a.line, opts), normalizeForCompare(b.line, opts), opts.caseInsensitive);
            });
          case 'natural':
            return direction(A, B, function (a, b) {
              return naturalCompare(a.line, b.line, opts);
            });
          case 'az':
          default:
            return direction(A, B, function (a, b) {
              return localeCompareSafe(normalizeForCompare(a.line, opts), normalizeForCompare(b.line, opts), opts.caseInsensitive);
            });
        }
      });
    }

    var result = indexed.map(function (item) { return item.line; });
    if (opts.reverse) result = result.slice().reverse();
    return result;
  }

  function computeStats(units, options) {
    var opts = normalizeOptions(options);
    var original = Array.isArray(units) ? units : [];
    var originalTotal = original.length;
    var originalChars = original.join('\n').length;

    var trimmed = opts.trim ? original.map(function (l) { return String(l).trim(); }) : original.slice();
    var blankCount = trimmed.filter(function (l) { return l === ''; }).length;
    var afterBlanks = opts.removeBlanks ? trimmed.filter(function (l) { return l !== ''; }) : trimmed;

    var seen = {};
    var unique = 0;
    var duplicateCount = 0;
    var i;
    for (i = 0; i < afterBlanks.length; i++) {
      var key = opts.caseInsensitive ? String(afterBlanks[i]).toLowerCase() : String(afterBlanks[i]);
      if (Object.prototype.hasOwnProperty.call(seen, key)) {
        duplicateCount += 1;
      } else {
        seen[key] = true;
        unique += 1;
      }
    }

    var words = 0;
    var joined = afterBlanks.join(' ').trim();
    if (joined) words = joined.split(/\s+/).filter(Boolean).length;

    var lengths = afterBlanks.filter(function (l) { return l !== ''; }).map(function (l) { return String(l).length; });
    var shortest = lengths.length ? Math.min.apply(null, lengths) : 0;
    var longest = lengths.length ? Math.max.apply(null, lengths) : 0;

    return {
      originalTotalLines: originalTotal,
      uniqueLines: unique,
      originalChars: originalChars,
      words: words,
      blanksRemoved: opts.removeBlanks ? blankCount : 0,
      duplicatesRemoved: opts.removeDuplicates ? duplicateCount : 0,
      shortest: shortest,
      longest: longest
    };
  }

  function escapeCsvCell(value) {
    var v = String(value == null ? '' : value);
    if (/[\n\r",]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function toCsv(units) {
    return (Array.isArray(units) ? units : []).map(escapeCsvCell).join('\n');
  }

  function sortText(text, options, rng) {
    var opts = normalizeOptions(options);
    var units = splitUnits(text, opts.splitMode);
    var sorted = sortUnits(units, opts, rng);
    return {
      text: joinUnits(sorted, opts.splitMode),
      units: sorted,
      stats: computeStats(units, opts),
      truncated: String(text == null ? '' : text).length > MAX_CHARS || units.length > MAX_UNITS
    };
  }

  global.TextSorterEngine = {
    SPLIT_MODES: SPLIT_MODES,
    SORT_MODES: SORT_MODES,
    SAMPLES: SAMPLES,
    MAX_CHARS: MAX_CHARS,
    MAX_UNITS: MAX_UNITS,
    defaultOptions: defaultOptions,
    normalizeOptions: normalizeOptions,
    capText: capText,
    splitUnits: splitUnits,
    joinUnits: joinUnits,
    lastToken: lastToken,
    normalizeForCompare: normalizeForCompare,
    naturalCompare: naturalCompare,
    prepareUnits: prepareUnits,
    sortUnits: sortUnits,
    computeStats: computeStats,
    escapeCsvCell: escapeCsvCell,
    toCsv: toCsv,
    sortText: sortText
  };

})(typeof window !== 'undefined' ? window : this);
