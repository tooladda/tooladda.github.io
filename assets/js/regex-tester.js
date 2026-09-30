/* ============================================================
   ToolAdda — Regex Tester

   JavaScript RegExp semantics, executed locally. Nothing typed
   into this tool is ever sent anywhere.

   The pure engine at the top is shared three ways: by the page,
   by the Web Worker that isolates expensive patterns, and by the
   Node test harness. Nothing above section 10 touches the DOM.

     1.  Feature detection
     2.  Compilation and validation
     3.  Capture-group naming
     4.  Matching
     5.  Segmenting for safe rendering
     6.  Replacement
     7.  Pattern explanation
     8.  Example library
     9.  Engine export
     10. Application state
     11. DOM cache
     12. Worker transport with watchdog
     13. Rendering
     14. Match navigation
     15. Replace mode
     16. Examples and explanation UI
     17. Clipboard, share, persistence
     18. Keyboard and init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ---------------------------------------------------------
     1. FEATURE DETECTION
     --------------------------------------------------------- */

  function supportsFlag(flag) {
    try {
      new RegExp('', flag);
      return true;
    } catch (err) {
      return false;
    }
  }

  function supportsSyntax(source, flags) {
    try {
      new RegExp(source, flags);
      return true;
    } catch (err) {
      return false;
    }
  }

  var FLAGS = [
    { id: 'g', name: 'Global', hint: 'Find all matches instead of stopping at the first' },
    { id: 'i', name: 'Ignore case', hint: 'Match without regard to upper or lower case' },
    { id: 'm', name: 'Multiline', hint: 'Make ^ and $ match at the start and end of every line' },
    { id: 's', name: 'DotAll', hint: 'Let . match line breaks as well' },
    { id: 'u', name: 'Unicode', hint: 'Treat the pattern as a sequence of Unicode code points' },
    { id: 'v', name: 'Unicode sets', hint: 'Newer Unicode mode with set notation. Cannot be combined with u' },
    { id: 'y', name: 'Sticky', hint: 'Match only from the exact position where the last match ended' },
    { id: 'd', name: 'Indices', hint: 'Record the start and end position of every capture group' }
  ];

  function detectFeatures() {
    var supported = {};
    FLAGS.forEach(function (flag) { supported[flag.id] = supportsFlag(flag.id); });
    return {
      flags: supported,
      namedGroups: supportsSyntax('(?<name>a)'),
      lookbehind: supportsSyntax('(?<=a)b'),
      unicodeProperties: supportsSyntax('\\p{L}', 'u'),
      workers: typeof Worker !== 'undefined'
    };
  }

  /* ---------------------------------------------------------
     2. COMPILATION AND VALIDATION
     --------------------------------------------------------- */

  function cleanErrorMessage(message) {
    /* Engines prefix the offending source, which is noise here. */
    var text = String(message || 'Invalid regular expression');
    text = text.replace(/^Invalid regular expression:?\s*/i, '');
    text = text.replace(/^\/[\s\S]*?\/[a-z]*:\s*/i, '');
    text = text.replace(/^SyntaxError:\s*/i, '');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function compile(pattern, flags) {
    try {
      return { ok: true, regex: new RegExp(pattern, flags) };
    } catch (err) {
      return { ok: false, error: cleanErrorMessage(err && err.message) };
    }
  }

  /* ---------------------------------------------------------
     3. CAPTURE-GROUP NAMING
     Reading names straight from the pattern means numbered and
     named groups line up even without the d flag.
     --------------------------------------------------------- */

  function captureGroupNames(pattern) {
    var names = [null];
    var i = 0;
    var inClass = false;

    while (i < pattern.length) {
      var ch = pattern.charAt(i);

      if (ch === '\\') { i += 2; continue; }
      if (inClass) {
        if (ch === ']') inClass = false;
        i += 1;
        continue;
      }
      if (ch === '[') { inClass = true; i += 1; continue; }

      if (ch === '(') {
        if (pattern.charAt(i + 1) === '?') {
          var third = pattern.charAt(i + 2);
          var fourth = pattern.charAt(i + 3);
          if (third === '<' && fourth !== '=' && fourth !== '!') {
            var close = pattern.indexOf('>', i + 3);
            if (close !== -1) {
              names.push(pattern.slice(i + 3, close));
              i = close + 1;
              continue;
            }
          }
          i += 2;
          continue;
        }
        names.push(null);
      }
      i += 1;
    }

    return names;
  }

  /* ---------------------------------------------------------
     4. MATCHING
     --------------------------------------------------------- */

  var DEFAULT_DETAIL_LIMIT = 2000;
  var DEFAULT_COUNT_LIMIT = 100000;

  /* A zero-width match leaves lastIndex where it is, so it has to be
     nudged forward by hand — by a whole code point in Unicode mode. */
  function advanceIndex(text, index, unicodeMode) {
    if (!unicodeMode) return index + 1;
    var code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      var next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) return index + 2;
    }
    return index + 1;
  }

  function lineAndColumn(text, index) {
    var line = 1;
    var lastBreak = -1;
    for (var i = 0; i < index; i += 1) {
      if (text.charCodeAt(i) === 10) { line += 1; lastBreak = i; }
    }
    return { line: line, column: index - lastBreak };
  }

  function toMatch(execResult, text, names) {
    var groups = [];
    var indices = execResult.indices;

    for (var i = 1; i < execResult.length; i += 1) {
      var value = execResult[i];
      var entry = {
        number: i,
        name: names[i] || null,
        value: value === undefined ? null : value,
        start: null,
        end: null
      };
      if (indices && indices[i]) {
        entry.start = indices[i][0];
        entry.end = indices[i][1];
      }
      groups.push(entry);
    }

    var position = lineAndColumn(text, execResult.index);

    return {
      text: execResult[0],
      index: execResult.index,
      end: execResult.index + execResult[0].length,
      length: execResult[0].length,
      line: position.line,
      column: position.column,
      groups: groups
    };
  }

  function findMatches(regex, text, options) {
    var opts = options || {};
    var detailLimit = opts.detailLimit || DEFAULT_DETAIL_LIMIT;
    var countLimit = opts.countLimit || DEFAULT_COUNT_LIMIT;
    var names = captureGroupNames(regex.source);
    var iterates = regex.global || regex.sticky;
    var unicodeMode = Boolean(regex.unicode || regex.unicodeSets);

    /* A private copy keeps the caller's lastIndex untouched. */
    var re = new RegExp(regex.source, regex.flags);
    var matches = [];
    var total = 0;
    var hitCountLimit = false;

    if (!iterates) {
      var single = re.exec(text);
      if (single) {
        matches.push(toMatch(single, text, names));
        total = 1;
      }
      return {
        matches: matches,
        total: total,
        countTruncated: false,
        detailsTruncated: false,
        truncated: false,
        names: names
      };
    }

    var found;
    while ((found = re.exec(text)) !== null) {
      total += 1;
      if (matches.length < detailLimit) matches.push(toMatch(found, text, names));

      if (found[0].length === 0) {
        re.lastIndex = advanceIndex(text, re.lastIndex, unicodeMode);
      }

      if (total >= countLimit) { hitCountLimit = true; break; }
      if (re.lastIndex > text.length) break;
    }

    /* Two different kinds of incompleteness: the count itself may be a
       lower bound, or the count may be exact while only the per-match
       details were capped. Reporting them as one thing would either
       hide a cap or put a misleading "+" on an exact number. */
    return {
      matches: matches,
      total: total,
      countTruncated: hitCountLimit,
      detailsTruncated: total > matches.length,
      truncated: total > matches.length,
      names: names
    };
  }

  /* ---------------------------------------------------------
     5. SEGMENTING FOR SAFE RENDERING
     Returns plain data. The renderer turns it into text nodes and
     <mark> elements, so test text can never become live markup.
     --------------------------------------------------------- */

  function buildSegments(text, matches, activeIndex, limit) {
    var cap = typeof limit === 'number' ? limit : matches.length;
    var segments = [];
    var cursor = 0;

    for (var i = 0; i < matches.length && i < cap; i += 1) {
      var match = matches[i];
      if (match.index > cursor) {
        segments.push({ type: 'text', text: text.slice(cursor, match.index) });
      }
      segments.push({
        type: 'match',
        text: match.text,
        matchIndex: i,
        active: i === activeIndex,
        zeroWidth: match.length === 0
      });
      cursor = match.index + match.length;
    }

    if (cursor < text.length) {
      segments.push({ type: 'text', text: text.slice(cursor) });
    }

    return segments;
  }

  /* ---------------------------------------------------------
     6. REPLACEMENT
     Expansion follows the GetSubstitution rules so $&, $1, $<name>,
     $$, $` and $' behave exactly as String.prototype.replace does.
     The result is verified against the native call before any
     highlighting is trusted.
     --------------------------------------------------------- */

  function expandReplacement(template, match, text, hasNamedGroups) {
    var out = '';
    var i = 0;
    var groupCount = match.groups.length;

    while (i < template.length) {
      var ch = template.charAt(i);

      if (ch !== '$' || i === template.length - 1) {
        out += ch;
        i += 1;
        continue;
      }

      var next = template.charAt(i + 1);

      if (next === '$') { out += '$'; i += 2; continue; }
      if (next === '&') { out += match.text; i += 2; continue; }
      if (next === '`') { out += text.slice(0, match.index); i += 2; continue; }
      if (next === "'") { out += text.slice(match.index + match.text.length); i += 2; continue; }

      if (next === '<') {
        if (!hasNamedGroups) { out += ch; i += 1; continue; }
        var close = template.indexOf('>', i + 2);
        if (close === -1) { out += ch; i += 1; continue; }
        var wanted = template.slice(i + 2, close);
        var named = null;
        for (var g = 0; g < groupCount; g += 1) {
          if (match.groups[g].name === wanted) { named = match.groups[g]; break; }
        }
        out += named && named.value != null ? named.value : '';
        i = close + 1;
        continue;
      }

      if (next >= '0' && next <= '9') {
        var pair = template.slice(i + 1, i + 3);
        if (/^\d{2}$/.test(pair)) {
          var twoDigit = parseInt(pair, 10);
          if (twoDigit >= 1 && twoDigit <= groupCount) {
            var gTwo = match.groups[twoDigit - 1];
            out += gTwo && gTwo.value != null ? gTwo.value : '';
            i += 3;
            continue;
          }
        }
        var oneDigit = parseInt(next, 10);
        if (oneDigit >= 1 && oneDigit <= groupCount) {
          var gOne = match.groups[oneDigit - 1];
          out += gOne && gOne.value != null ? gOne.value : '';
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }

      out += ch;
      i += 1;
    }

    return out;
  }

  function buildReplacement(text, matches, template, isGlobal, hasNamedGroups) {
    var used = isGlobal ? matches : matches.slice(0, 1);
    var out = '';
    var ranges = [];
    var cursor = 0;

    used.forEach(function (match) {
      out += text.slice(cursor, match.index);
      var start = out.length;
      out += expandReplacement(template, match, text, hasNamedGroups);
      ranges.push([start, out.length]);
      cursor = match.index + match.text.length;
    });

    out += text.slice(cursor);
    return { output: out, ranges: ranges, count: used.length };
  }

  function replaceWithVerification(regex, text, matches, template, truncated) {
    var native;
    try {
      native = text.replace(regex, template);
    } catch (err) {
      return { ok: false, error: cleanErrorMessage(err && err.message) };
    }

    var hasNamedGroups = /\(\?<[^=!]/.test(regex.source);
    var built = buildReplacement(text, matches, template, regex.global, hasNamedGroups);

    /* Truncated match lists cannot reproduce the whole output, and a
       mismatch would mean the local expander disagrees with the engine.
       Either way the native result wins and highlighting is dropped. */
    var trustworthy = !truncated && built.output === native;

    return {
      ok: true,
      output: native,
      ranges: trustworthy ? built.ranges : [],
      highlighted: trustworthy,
      count: regex.global ? matches.length : Math.min(1, matches.length)
    };
  }

  function rangesToSegments(text, ranges) {
    var segments = [];
    var cursor = 0;
    ranges.forEach(function (range) {
      if (range[0] > cursor) segments.push({ type: 'text', text: text.slice(cursor, range[0]) });
      segments.push({
        type: 'match',
        text: text.slice(range[0], range[1]),
        zeroWidth: range[0] === range[1]
      });
      cursor = range[1];
    });
    if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
    return segments;
  }

  /* ---------------------------------------------------------
     7. PATTERN EXPLANATION
     Every token is either recognised outright or reported as
     unsupported. Nothing is guessed.
     --------------------------------------------------------- */

  var ESCAPE_MEANINGS = {
    d: 'Any digit, 0 to 9',
    D: 'Any character that is not a digit',
    w: 'Any word character — a letter, digit or underscore',
    W: 'Any character that is not a word character',
    s: 'Any whitespace character, including spaces, tabs and line breaks',
    S: 'Any character that is not whitespace',
    b: 'A word boundary. Matches a position, not a character',
    B: 'A position that is not a word boundary',
    n: 'A newline character',
    r: 'A carriage return character',
    t: 'A tab character',
    f: 'A form feed character',
    v: 'A vertical tab character',
    '0': 'A NUL character'
  };

  function describeClassBody(body) {
    var parts = [];
    var i = 0;

    while (i < body.length && parts.length < 14) {
      if (body.charAt(i) === '\\') {
        var escaped = body.charAt(i + 1);
        parts.push(ESCAPE_MEANINGS[escaped] ? ESCAPE_MEANINGS[escaped].toLowerCase() : '"' + escaped + '"');
        i += 2;
        continue;
      }
      if (body.charAt(i + 1) === '-' && i + 2 < body.length) {
        parts.push(body.charAt(i) + ' to ' + body.charAt(i + 2));
        i += 3;
        continue;
      }
      parts.push('"' + body.charAt(i) + '"');
      i += 1;
    }

    if (i < body.length) parts.push('…');
    return parts.join(', ');
  }

  function explainPattern(pattern) {
    var tokens = [];
    var i = 0;
    var length = pattern.length;
    var groupNumber = 0;

    function push(text, description, kind) {
      tokens.push({ text: text, description: description, kind: kind || 'literal' });
    }

    while (i < length) {
      var ch = pattern.charAt(i);

      /* ---- escapes ---- */
      if (ch === '\\') {
        var next = pattern.charAt(i + 1);

        if (i + 1 >= length) {
          push('\\', 'A trailing backslash with nothing to escape', 'unsupported');
          break;
        }
        if (ESCAPE_MEANINGS[next]) {
          push('\\' + next, ESCAPE_MEANINGS[next], next === 'b' || next === 'B' ? 'anchor' : 'class');
          i += 2;
          continue;
        }
        if (next === 'u' && pattern.charAt(i + 2) === '{') {
          var braceEnd = pattern.indexOf('}', i + 3);
          if (braceEnd !== -1) {
            push(pattern.slice(i, braceEnd + 1),
              'The Unicode code point U+' + pattern.slice(i + 3, braceEnd).toUpperCase()
              + ' (needs the u or v flag)', 'escape');
            i = braceEnd + 1;
            continue;
          }
        }
        if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(pattern.substr(i + 2, 4))) {
          push(pattern.substr(i, 6),
            'The character U+' + pattern.substr(i + 2, 4).toUpperCase(), 'escape');
          i += 6;
          continue;
        }
        if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(pattern.substr(i + 2, 2))) {
          push(pattern.substr(i, 4),
            'The character with hex code ' + pattern.substr(i + 2, 2).toUpperCase(), 'escape');
          i += 4;
          continue;
        }
        if ((next === 'p' || next === 'P') && pattern.charAt(i + 2) === '{') {
          var propEnd = pattern.indexOf('}', i + 3);
          if (propEnd !== -1) {
            var property = pattern.slice(i + 3, propEnd);
            push(pattern.slice(i, propEnd + 1),
              (next === 'p' ? 'Any character with the Unicode property ' : 'Any character without the Unicode property ')
              + property + ' (needs the u or v flag)', 'class');
            i = propEnd + 1;
            continue;
          }
        }
        if (next === 'k' && pattern.charAt(i + 2) === '<') {
          var refEnd = pattern.indexOf('>', i + 3);
          if (refEnd !== -1) {
            push(pattern.slice(i, refEnd + 1),
              'A backreference to the group named "' + pattern.slice(i + 3, refEnd)
              + '" — matches whatever that group captured', 'group');
            i = refEnd + 1;
            continue;
          }
        }
        if (next >= '1' && next <= '9') {
          var digits = /^\d+/.exec(pattern.slice(i + 1))[0];
          push('\\' + digits,
            'A backreference to capture group ' + digits
            + ' — matches the same text that group captured', 'group');
          i += 1 + digits.length;
          continue;
        }
        if (next === 'c' && /[a-zA-Z]/.test(pattern.charAt(i + 2))) {
          push(pattern.substr(i, 3),
            'The control character Ctrl-' + pattern.charAt(i + 2).toUpperCase(), 'escape');
          i += 3;
          continue;
        }
        push('\\' + next, 'A literal "' + next + '" character', 'escape');
        i += 2;
        continue;
      }

      /* ---- character class ---- */
      if (ch === '[') {
        var j = i + 1;
        var negated = pattern.charAt(j) === '^';
        if (negated) j += 1;
        if (pattern.charAt(j) === ']') j += 1;
        while (j < length && pattern.charAt(j) !== ']') {
          j += pattern.charAt(j) === '\\' ? 2 : 1;
        }
        if (j >= length) {
          push(pattern.slice(i), 'An unterminated character class — the closing ] is missing', 'unsupported');
          break;
        }
        var bodyStart = i + 1 + (negated ? 1 : 0);
        push(pattern.slice(i, j + 1),
          (negated ? 'Any single character NOT in this set: ' : 'Any single character from this set: ')
          + describeClassBody(pattern.slice(bodyStart, j)), 'class');
        i = j + 1;
        continue;
      }

      /* ---- groups ---- */
      if (ch === '(') {
        if (pattern.substr(i, 3) === '(?:') {
          push('(?:', 'Start of a non-capturing group — groups the pattern without storing the result', 'group');
          i += 3;
          continue;
        }
        if (pattern.substr(i, 3) === '(?=') {
          push('(?=', 'Start of a positive lookahead — what follows must match here, but is not consumed', 'group');
          i += 3;
          continue;
        }
        if (pattern.substr(i, 3) === '(?!') {
          push('(?!', 'Start of a negative lookahead — what follows must NOT match here', 'group');
          i += 3;
          continue;
        }
        if (pattern.substr(i, 4) === '(?<=') {
          push('(?<=', 'Start of a positive lookbehind — the text before this position must match', 'group');
          i += 4;
          continue;
        }
        if (pattern.substr(i, 4) === '(?<!') {
          push('(?<!', 'Start of a negative lookbehind — the text before this position must NOT match', 'group');
          i += 4;
          continue;
        }
        if (pattern.substr(i, 3) === '(?<') {
          var nameEnd = pattern.indexOf('>', i + 3);
          if (nameEnd !== -1) {
            groupNumber += 1;
            push(pattern.slice(i, nameEnd + 1),
              'Start of capture group ' + groupNumber + ', named "'
              + pattern.slice(i + 3, nameEnd) + '"', 'group');
            i = nameEnd + 1;
            continue;
          }
        }
        if (pattern.charAt(i + 1) === '?') {
          push('(?', 'An unsupported or complex group construct', 'unsupported');
          i += 2;
          continue;
        }
        groupNumber += 1;
        push('(', 'Start of capture group ' + groupNumber, 'group');
        i += 1;
        continue;
      }

      if (ch === ')') { push(')', 'End of the group', 'group'); i += 1; continue; }

      /* ---- quantifiers ---- */
      if (ch === '*' || ch === '+' || ch === '?') {
        var lazy = pattern.charAt(i + 1) === '?';
        var base = ch === '*'
          ? 'Zero or more of the preceding token'
          : ch === '+'
            ? 'One or more of the preceding token'
            : 'Zero or one of the preceding token, making it optional';
        push(ch + (lazy ? '?' : ''),
          base + (lazy ? ', matched lazily — as few as possible' : ', matched greedily — as many as possible'),
          'quantifier');
        i += lazy ? 2 : 1;
        continue;
      }

      if (ch === '{') {
        var repeat = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
        if (repeat) {
          var lazyRepeat = pattern.charAt(i + repeat[0].length) === '?';
          var meaning;
          if (!repeat[2]) {
            meaning = 'Exactly ' + repeat[1] + ' occurrence'
              + (repeat[1] === '1' ? '' : 's') + ' of the preceding token';
          } else if (!repeat[3]) {
            meaning = repeat[1] + ' or more occurrences of the preceding token';
          } else {
            meaning = 'Between ' + repeat[1] + ' and ' + repeat[3]
              + ' occurrences of the preceding token';
          }
          push(repeat[0] + (lazyRepeat ? '?' : ''),
            meaning + (lazyRepeat ? ', matched lazily' : ''), 'quantifier');
          i += repeat[0].length + (lazyRepeat ? 1 : 0);
          continue;
        }
        push('{', 'A literal "{" character', 'literal');
        i += 1;
        continue;
      }

      /* ---- anchors and specials ---- */
      if (ch === '^') {
        push('^', 'Start of the string, or the start of any line when the m flag is on', 'anchor');
        i += 1;
        continue;
      }
      if (ch === '$') {
        push('$', 'End of the string, or the end of any line when the m flag is on', 'anchor');
        i += 1;
        continue;
      }
      if (ch === '.') {
        push('.', 'Any character except a line break — or truly any character with the s flag', 'class');
        i += 1;
        continue;
      }
      if (ch === '|') {
        push('|', 'Alternation — match either the expression on the left or the one on the right', 'alternation');
        i += 1;
        continue;
      }

      /* ---- literal run ---- */
      var runStart = i;
      while (i < length && '\\[](){}*+?^$.|'.indexOf(pattern.charAt(i)) === -1) i += 1;

      if (i === runStart) {
        push(pattern.charAt(runStart), 'An unsupported or complex token', 'unsupported');
        i += 1;
        continue;
      }

      /* A quantifier binds to the last character only, so leave it alone. */
      var runEnd = i;
      if (runEnd - runStart > 1 && runEnd < length && '*+?{'.indexOf(pattern.charAt(runEnd)) !== -1) {
        runEnd -= 1;
      }

      var literal = pattern.slice(runStart, runEnd);
      push(literal,
        literal.length === 1
          ? 'The character "' + literal + '" exactly'
          : 'The literal text "' + literal + '"',
        'literal');
      i = runEnd;
    }

    return tokens;
  }

  /* ---------------------------------------------------------
     8. EXAMPLE LIBRARY
     Each entry is a starting point, not a specification.
     --------------------------------------------------------- */

  var EXAMPLES = [
    {
      id: 'email',
      category: 'Contact',
      title: 'Email address',
      note: 'Catches everyday addresses. The full RFC 5322 grammar is far larger, so treat this as extraction, not validation.',
      pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+',
      flags: 'g',
      text: 'Write to priya.sharma@example.com or sales+india@tooladda.online.\nBounced: no-reply@mail.example.co.uk',
      replacement: '[redacted]'
    },
    {
      id: 'url',
      category: 'Web',
      title: 'HTTP and HTTPS URL',
      note: 'Extracts links from prose. It deliberately stops at whitespace.',
      pattern: 'https?://[^\\s/$.?#][^\\s]*',
      flags: 'gi',
      text: 'Docs live at https://tooladda.online/regex-tester.html and the mirror is http://example.org/path?q=1#top.',
      replacement: '<link>'
    },
    {
      id: 'date-named',
      category: 'Dates',
      title: 'ISO date with named groups',
      note: 'Shows named capture groups. It checks shape only — 2026-13-45 still matches.',
      pattern: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
      flags: 'g',
      text: 'Released 2026-08-09, patched 2026-09-01, archived 2025-12-31.',
      replacement: '$<day>/$<month>/$<year>'
    },
    {
      id: 'ipv4',
      category: 'Network',
      title: 'IPv4 address',
      note: 'Each octet is range-checked to 0-255, so 999.1.1.1 will not match.',
      pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\b',
      flags: 'g',
      text: 'Gateway 192.168.1.1, DNS 8.8.8.8 and 1.1.1.1.\nInvalid: 999.1.1.1 and 256.0.0.1',
      replacement: '0.0.0.0'
    },
    {
      id: 'phone',
      category: 'Contact',
      title: 'Phone number',
      note: 'A loose international shape. Phone formats vary enormously by country.',
      pattern: '\\+?\\d{1,3}[\\s-]?\\(?\\d{2,4}\\)?[\\s-]?\\d{3,4}[\\s-]?\\d{3,4}',
      flags: 'g',
      text: 'Call +91 98765 43210 or (022) 4567 8900.\nUS office: +1 555-010-9999',
      replacement: '[phone]'
    },
    {
      id: 'integer',
      category: 'Numbers',
      title: 'Whole numbers',
      note: 'Matches standalone integers, including negatives.',
      pattern: '-?\\b\\d+\\b',
      flags: 'g',
      text: 'Order 123 contains 45 items, refunded -7 units, code A12B.',
      replacement: '#'
    },
    {
      id: 'decimal',
      category: 'Numbers',
      title: 'Decimal numbers',
      note: 'Optional sign, optional fractional part.',
      pattern: '-?\\d+(?:\\.\\d+)?',
      flags: 'g',
      text: 'Totals: 12.50, -3.75, 100, 0.001 and 42.',
      replacement: '0'
    },
    {
      id: 'hex-color',
      category: 'Web',
      title: 'Hex colour',
      note: 'Three or six hexadecimal digits after a hash.',
      pattern: '#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b',
      flags: 'g',
      text: 'Palette: #5a3fc0, #fff, #ffd98a and the invalid #12345.',
      replacement: 'var(--brand)'
    },
    {
      id: 'html-tag',
      category: 'Web',
      title: 'HTML tag',
      note: 'Fine for a quick scan of simple markup. Regex cannot parse nested HTML properly — use a parser for that.',
      pattern: '</?([a-zA-Z][\\w-]*)(?:\\s[^<>]*)?>',
      flags: 'g',
      text: '<p class="lead">Hello <strong>world</strong></p>\n<img src="a.png" alt="">',
      replacement: ''
    },
    {
      id: 'whitespace',
      category: 'Text',
      title: 'Repeated whitespace',
      note: 'Finds runs of two or more whitespace characters — handy for tidying pasted text.',
      pattern: '\\s{2,}',
      flags: 'g',
      text: 'This  sentence   has    uneven\t\tspacing.',
      replacement: ' '
    },
    {
      id: 'brackets',
      category: 'Text',
      title: 'Text between brackets',
      note: 'Captures whatever sits inside square brackets.',
      pattern: '\\[([^\\]]+)\\]',
      flags: 'g',
      text: 'Log [INFO] started, [WARN] retrying, [ERROR] gave up.',
      replacement: '$1'
    },
    {
      id: 'hashtag',
      category: 'Social',
      title: 'Hashtag',
      note: 'Uses Unicode property escapes so non-Latin hashtags match too. Requires the u flag.',
      pattern: '#[\\p{L}\\p{N}_]+',
      flags: 'gu',
      text: 'Shipping today #regex #开发者 #हिन्दी #dev_tools — not a # on its own.',
      replacement: ''
    },
    {
      id: 'username',
      category: 'Validation',
      title: 'Username rule',
      note: 'An example policy: starts with a letter, 3 to 16 characters. Anchored per line with the m flag.',
      pattern: '^[a-zA-Z][a-zA-Z0-9_]{2,15}$',
      flags: 'gm',
      text: 'priya_dev\nab\n9startswithdigit\nvalid_user_99\nthis_name_is_far_too_long_here',
      replacement: 'ok'
    },
    {
      id: 'password',
      category: 'Validation',
      title: 'Password policy',
      note: 'Lookaheads require a lowercase letter, an uppercase letter, a digit and a symbol, with a minimum length. A policy check, not a strength measure.',
      pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{8,}$',
      flags: 'gm',
      text: 'Str0ng!Pass\nweakpassword\nNoDigits!Here\nSh0rt!\nAn0ther#Good1',
      replacement: 'accepted'
    },
    {
      id: 'duplicate-word',
      category: 'Text',
      title: 'Duplicated word',
      note: 'A backreference finds a word repeated straight after itself — a classic proofreading catch.',
      pattern: '\\b(\\w+)\\s+\\1\\b',
      flags: 'gi',
      text: 'This this is a common typo, and and it hides in in long drafts.',
      replacement: '$1'
    },
    {
      id: 'trailing-space',
      category: 'Text',
      title: 'Trailing whitespace per line',
      note: 'Combines the m flag with $ to clean line ends.',
      pattern: '[ \\t]+$',
      flags: 'gm',
      text: 'first line   \nsecond line\t\nthird line',
      replacement: ''
    }
  ];

  /* ---------------------------------------------------------
     9. ENGINE EXPORT
     --------------------------------------------------------- */

  var engine = {
    FLAGS: FLAGS,
    EXAMPLES: EXAMPLES,
    detectFeatures: detectFeatures,
    supportsFlag: supportsFlag,
    compile: compile,
    captureGroupNames: captureGroupNames,
    findMatches: findMatches,
    buildSegments: buildSegments,
    expandReplacement: expandReplacement,
    buildReplacement: buildReplacement,
    replaceWithVerification: replaceWithVerification,
    rangesToSegments: rangesToSegments,
    explainPattern: explainPattern,
    lineAndColumn: lineAndColumn,
    cleanErrorMessage: cleanErrorMessage,

    /* One call the worker and the synchronous fallback both use. */
    run: function (request) {
      var started = Date.now();
      var compiled = compile(request.pattern, request.flags);
      if (!compiled.ok) {
        return { ok: false, error: compiled.error, elapsed: Date.now() - started };
      }

      var result = findMatches(compiled.regex, request.text, {
        detailLimit: request.detailLimit,
        countLimit: request.countLimit
      });

      var payload = {
        ok: true,
        matches: result.matches,
        total: result.total,
        countTruncated: result.countTruncated,
        detailsTruncated: result.detailsTruncated,
        truncated: result.truncated,
        groupNames: result.names,
        elapsed: Date.now() - started
      };

      if (typeof request.replacement === 'string') {
        var replaced = replaceWithVerification(
          compiled.regex, request.text, result.matches, request.replacement, result.detailsTruncated
        );
        payload.replace = replaced;
      }

      return payload;
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (globalScope) globalScope.ToolAddaRegex = engine;

  if (typeof document === 'undefined') return;

  /* ==========================================================
     10. APPLICATION STATE
     ========================================================== */

  var STORE_KEY = 'tooladda-regex-prefs-v1';
  var DEBOUNCE_MS = 140;
  var WORKER_TIMEOUT_MS = 1500;
  var HIGHLIGHT_LIMIT = 2000;
  var LARGE_TEXT_BYTES = 200000;

  var state = {
    pattern: '',
    flags: 'g',
    text: '',
    replacement: '',
    replaceOn: false,
    matches: [],
    total: 0,
    countTruncated: false,
    detailsTruncated: false,
    active: 0,
    error: null,
    elapsed: 0,
    replaceResult: null,
    features: detectFeatures(),
    exampleFilter: 'All'
  };

  var el = {};
  var debounceTimer = null;

  function pick(selector, scope) { return (scope || document).querySelector(selector); }
  function pickAll(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  /* ==========================================================
     11. DOM CACHE
     ========================================================== */

  function cacheDom() {
    el.app = pick('[data-rx-app]');
    if (!el.app) return false;

    el.pattern = pick('#rxPattern');
    el.flagsRow = pick('[data-rx-flags]');
    el.literal = pick('[data-rx-literal]');
    el.flagSuffix = pick('[data-rx-flag-suffix]');
    el.copyLiteral = pick('[data-rx-copy-literal]');
    el.status = pick('[data-rx-validity]');
    el.text = pick('#rxText');
    el.preview = pick('[data-rx-preview]');
    el.previewEmpty = pick('[data-rx-preview-empty]');
    el.ribbon = pick('[data-rx-ribbon]');
    el.counts = pick('[data-rx-counts]');
    el.timing = pick('[data-rx-timing]');
    el.notice = pick('[data-rx-notice]');
    el.live = pick('[data-rx-live]');

    el.matchNav = pick('[data-rx-match-nav]');
    el.matchPosition = pick('[data-rx-match-position]');
    el.prev = pick('[data-rx-prev]');
    el.next = pick('[data-rx-next]');
    el.detail = pick('[data-rx-detail]');

    el.replaceToggle = pick('[data-rx-replace-toggle]');
    el.replacePanel = pick('[data-rx-replace-panel]');
    el.replacement = pick('#rxReplacement');
    el.originalMirror = pick('[data-rx-original-mirror]');
    el.replaceOut = pick('[data-rx-replace-out]');
    el.replaceStats = pick('[data-rx-replace-stats]');
    el.replaceNote = pick('[data-rx-replace-note]');
    el.copyReplacement = pick('[data-rx-copy-replacement]');

    el.explainBtn = pick('[data-rx-explain]');
    el.explainOut = pick('[data-rx-explain-out]');

    el.exampleList = pick('[data-rx-examples]');
    el.exampleFilters = pick('[data-rx-example-filters]');

    el.copyPattern = pick('[data-rx-copy-pattern]');
    el.copyText = pick('[data-rx-copy-text]');
    el.clear = pick('[data-rx-clear]');
    el.loadExample = pick('[data-rx-load-example]');
    el.sharePattern = pick('[data-rx-share-pattern]');
    el.shareFull = pick('[data-rx-share-full]');
    el.forgetBtn = pick('[data-rx-forget]');
    el.engineInfo = pick('[data-rx-engine-info]');

    return true;
  }

  function announce(message) {
    if (el.live) el.live.textContent = message;
  }

  /* ==========================================================
     12. WORKER TRANSPORT WITH WATCHDOG
     A runaway pattern cannot be interrupted once it starts, so it
     runs in a worker that can simply be terminated.
     ========================================================== */

  var worker = null;
  var workerBroken = false;
  var requestSeq = 0;
  var pending = {};

  function scriptDirectory() {
    var script = document.querySelector('script[src*="regex-tester.js"]');
    var src = script ? script.getAttribute('src') : 'assets/js/regex-tester.js';
    return src.replace(/regex-tester\.js(?:\?.*)?$/, '');
  }

  function spawnWorker() {
    if (workerBroken || typeof Worker === 'undefined') return null;
    try {
      return new Worker(scriptDirectory() + 'regex-tester-worker.js');
    } catch (err) {
      workerBroken = true;
      return null;
    }
  }

  function killWorker(reason) {
    if (worker) {
      try { worker.terminate(); } catch (err) { /* already gone */ }
      worker = null;
    }
    Object.keys(pending).forEach(function (id) {
      window.clearTimeout(pending[id].timer);
      pending[id].reject(new Error(reason || 'TIMEOUT'));
      delete pending[id];
    });
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = spawnWorker();
    if (!worker) return null;

    worker.onmessage = function (event) {
      var data = event.data || {};
      var entry = pending[data.id];
      if (!entry) return;
      window.clearTimeout(entry.timer);
      delete pending[data.id];
      entry.resolve(data.result);
    };

    /* The worker can fail to start at all — opening the page straight from
       disk blocks importScripts, for instance. That is not a slow pattern,
       so pending work is rejected with its own reason and retried inline. */
    worker.onerror = function () {
      workerBroken = true;
      killWorker('WORKER_FAILED');
      renderEngineInfo();
    };

    return worker;
  }

  function runRequest(request) {
    var active = ensureWorker();

    if (!active) {
      /* No worker available — for example when the page is opened from
         disk. Run inline and accept that a pathological pattern can
         block; the input guards below keep that unlikely. */
      try {
        return Promise.resolve(engine.run(request));
      } catch (err) {
        return Promise.resolve({ ok: false, error: cleanErrorMessage(err && err.message) });
      }
    }

    var id = ++requestSeq;
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        delete pending[id];
        killWorker('TIMEOUT');
        reject(new Error('TIMEOUT'));
      }, WORKER_TIMEOUT_MS);

      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      active.postMessage({ id: id, request: request });
    });
  }

  /* ==========================================================
     13. RENDERING
     ========================================================== */

  function renderLiteral() {
    var body = state.pattern || '';
    el.literal.textContent = '/' + body + '/' + state.flags;
    if (el.flagSuffix) el.flagSuffix.textContent = state.flags;
  }

  function setValidity(kind, message) {
    el.status.className = 'rx-validity is-' + kind;
    el.status.textContent = message;
  }

  function renderFlags() {
    pickAll('[data-rx-flag]', el.flagsRow).forEach(function (button) {
      var id = button.getAttribute('data-rx-flag');
      var on = state.flags.indexOf(id) !== -1;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    renderLiteral();
  }

  /* Segments become text nodes and <mark> elements — never markup. */
  function paintSegments(container, segments) {
    var fragment = document.createDocumentFragment();

    segments.forEach(function (segment) {
      if (segment.type === 'text') {
        fragment.appendChild(document.createTextNode(segment.text));
        return;
      }

      var mark = document.createElement('mark');
      mark.className = 'rx-hit';
      if (segment.active) mark.classList.add('is-active');
      if (segment.zeroWidth) {
        mark.classList.add('is-zero');
        mark.setAttribute('aria-label', 'Zero-width match');
      }
      if (typeof segment.matchIndex === 'number') {
        mark.setAttribute('data-match', String(segment.matchIndex));
        mark.setAttribute('tabindex', '-1');
      }
      mark.appendChild(document.createTextNode(segment.text));
      fragment.appendChild(mark);
    });

    container.textContent = '';
    container.appendChild(fragment);
  }

  function renderPreview() {
    var hasPattern = state.pattern.length > 0;
    var hasText = state.text.length > 0;

    if (!hasPattern || !hasText || state.error) {
      el.preview.hidden = true;
      el.previewEmpty.hidden = false;
      el.previewEmpty.textContent = !hasPattern
        ? 'Enter a regex pattern to see matches highlighted here.'
        : !hasText
          ? 'Paste or type text to test against your pattern.'
          : 'Fix the pattern above to see matches.';
      return;
    }

    el.preview.hidden = false;
    el.previewEmpty.hidden = true;

    var segments = buildSegments(state.text, state.matches, state.active, HIGHLIGHT_LIMIT);
    paintSegments(el.preview, segments);
  }

  function renderRibbon() {
    el.ribbon.textContent = '';
    if (!state.matches.length || !state.text.length) {
      el.ribbon.hidden = true;
      return;
    }
    el.ribbon.hidden = false;

    /* One tick per match, thinned out so the strip stays readable. */
    var step = Math.max(1, Math.ceil(state.matches.length / 300));
    for (var i = 0; i < state.matches.length; i += step) {
      var match = state.matches[i];
      var tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'rx-tick';
      if (i === state.active) tick.classList.add('is-active');
      tick.style.left = (match.index / state.text.length) * 100 + '%';
      tick.setAttribute('aria-label', 'Jump to match ' + (i + 1));
      tick.setAttribute('data-jump', String(i));
      el.ribbon.appendChild(tick);
    }
  }

  function countGroups() {
    if (!state.matches.length) {
      var names = captureGroupNames(state.pattern);
      return Math.max(0, names.length - 1);
    }
    return state.matches[0].groups.length;
  }

  function renderCounts() {
    var total = state.total;
    var groups = countGroups();

    /* The "+" belongs only on a count that stopped early, never on an
       exact count whose per-match details happened to be capped. */
    var matchLabel = total === 1 ? '1 match' : total.toLocaleString() + ' matches';
    if (state.countTruncated) matchLabel = total.toLocaleString() + '+ matches';

    var groupLabel = groups === 1 ? '1 group' : groups + ' groups';
    el.counts.textContent = matchLabel + ' · ' + groupLabel;
    el.counts.classList.toggle('is-zero', total === 0);

    el.timing.textContent = state.error ? '' : state.elapsed + ' ms';
  }

  function renderNotice() {
    var messages = [];
    if (state.countTruncated) {
      messages.push('Counting stopped at ' + state.total.toLocaleString()
        + ' matches, so the real total may be higher.');
    } else if (state.detailsTruncated) {
      messages.push('The match count is exact, but only the first '
        + state.matches.length.toLocaleString()
        + ' matches are detailed and highlighted, to keep scrolling smooth.');
    }
    if (state.text.length > LARGE_TEXT_BYTES) {
      messages.push('Large input detected. Live highlighting may be slower.');
    }

    el.notice.hidden = messages.length === 0;
    el.notice.textContent = messages.join(' ');
  }

  function renderDetail() {
    el.detail.textContent = '';

    if (state.error) {
      el.matchNav.hidden = true;
      var problem = document.createElement('p');
      problem.className = 'rx-detail__empty';
      problem.textContent = 'Fix the pattern to inspect matches.';
      el.detail.appendChild(problem);
      return;
    }

    if (!state.matches.length) {
      el.matchNav.hidden = true;
      var none = document.createElement('p');
      none.className = 'rx-detail__empty';
      none.textContent = state.pattern && state.text
        ? 'No matches found. Try changing the pattern, flags, or test text.'
        : 'Match details will appear here.';
      el.detail.appendChild(none);
      return;
    }

    el.matchNav.hidden = false;
    el.matchPosition.textContent = 'Match ' + (state.active + 1) + ' of '
      + state.matches.length.toLocaleString();

    var match = state.matches[state.active];

    var head = document.createElement('div');
    head.className = 'rx-detail__head';

    var title = document.createElement('h3');
    title.className = 'rx-detail__title';
    title.textContent = 'Match ' + (state.active + 1);
    head.appendChild(title);

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'rx-btn rx-btn--ghost rx-btn--xs';
    copy.textContent = 'Copy match';
    copy.setAttribute('aria-label', 'Copy the text of match ' + (state.active + 1));
    copy.addEventListener('click', function () {
      copyValue(match.text, copy, 'Match copied');
    });
    head.appendChild(copy);
    el.detail.appendChild(head);

    var value = document.createElement('div');
    value.className = 'rx-readout';
    var code = document.createElement('code');
    code.className = 'rx-readout__code';
    code.textContent = match.length === 0 ? '(zero-width match)' : match.text;
    if (match.length === 0) code.classList.add('is-meta');
    value.appendChild(code);
    el.detail.appendChild(value);

    var facts = document.createElement('dl');
    facts.className = 'rx-facts';
    [
      ['Start index', String(match.index)],
      ['End index', String(match.end)],
      ['Length', String(match.length)],
      ['Line / column', match.line + ' : ' + match.column]
    ].forEach(function (pair) {
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = pair[1];
      facts.appendChild(dt);
      facts.appendChild(dd);
    });
    el.detail.appendChild(facts);

    var indexNote = document.createElement('p');
    indexNote.className = 'rx-detail__note';
    indexNote.textContent = 'Positions are JavaScript string indexes (UTF-16 code units), '
      + 'so characters outside the Basic Multilingual Plane count as two.';
    el.detail.appendChild(indexNote);

    if (!match.groups.length) {
      var noGroups = document.createElement('p');
      noGroups.className = 'rx-detail__note';
      noGroups.textContent = 'This pattern has no capture groups. Wrap part of it in ( ) to capture it.';
      el.detail.appendChild(noGroups);
      return;
    }

    var groupsTitle = document.createElement('h4');
    groupsTitle.className = 'rx-detail__subtitle';
    groupsTitle.textContent = 'Capture groups';
    el.detail.appendChild(groupsTitle);

    var list = document.createElement('ul');
    list.className = 'rx-groups';

    match.groups.forEach(function (group) {
      var item = document.createElement('li');
      item.className = 'rx-group';
      if (group.name) item.classList.add('is-named');

      var label = document.createElement('span');
      label.className = 'rx-group__label';
      label.textContent = group.name ? group.name : 'Group ' + group.number;

      var number = document.createElement('span');
      number.className = 'rx-group__index';
      number.textContent = String(group.number);
      label.appendChild(number);

      var body = document.createElement('code');
      body.className = 'rx-group__value';
      if (group.value === null) {
        body.textContent = 'did not participate';
        body.classList.add('is-meta');
      } else if (group.value === '') {
        body.textContent = '(empty string)';
        body.classList.add('is-meta');
      } else {
        body.textContent = group.value;
      }

      item.appendChild(label);
      item.appendChild(body);

      if (group.start !== null) {
        var span = document.createElement('span');
        span.className = 'rx-group__span';
        span.textContent = group.start + '–' + group.end;
        item.appendChild(span);
      }

      list.appendChild(item);
    });

    el.detail.appendChild(list);
  }

  function renderReplace() {
    el.replacePanel.hidden = !state.replaceOn;
    el.replaceToggle.setAttribute('aria-expanded', String(state.replaceOn));
    el.replaceToggle.classList.toggle('is-on', state.replaceOn);
    if (!state.replaceOn) return;

    /* Side-by-side original so the two panes can be compared directly. */
    if (el.originalMirror) {
      el.originalMirror.hidden = !state.text;
      if (state.text) {
        paintSegments(el.originalMirror,
          buildSegments(state.text, state.error ? [] : state.matches, -1, HIGHLIGHT_LIMIT));
      }
    }

    var result = state.replaceResult;

    if (state.error || !state.pattern) {
      el.replaceOut.textContent = '';
      el.replaceStats.textContent = '';
      el.replaceNote.hidden = true;
      return;
    }

    if (!result || !result.ok) {
      el.replaceOut.textContent = '';
      el.replaceStats.textContent = result && result.error ? result.error : '';
      return;
    }

    if (result.highlighted && result.ranges.length) {
      paintSegments(el.replaceOut, rangesToSegments(result.output, result.ranges));
    } else {
      el.replaceOut.textContent = result.output;
    }

    var count = result.count;
    el.replaceStats.textContent = state.total.toLocaleString()
      + (state.total === 1 ? ' match' : ' matches') + ' · '
      + count.toLocaleString() + (count === 1 ? ' replacement' : ' replacements')
      + (result.output === state.text ? ' · output identical to the input' : '');

    var isGlobal = state.flags.indexOf('g') !== -1;
    el.replaceNote.hidden = isGlobal;
    if (!isGlobal) {
      el.replaceNote.textContent = 'The g flag is off, so JavaScript replaces only the first match. '
        + 'Turn on g above to replace every match — this tool will not add it for you.';
    }
  }

  function renderAll() {
    renderLiteral();
    renderCounts();
    renderNotice();
    renderPreview();
    renderRibbon();
    renderDetail();
    renderReplace();
  }

  /* ==========================================================
     Evaluation pipeline
     ========================================================== */

  function applyResult(result) {
    if (!result) return;

    if (!result.ok) {
      state.error = result.error;
      state.matches = [];
      state.total = 0;
      state.countTruncated = false;
      state.detailsTruncated = false;
      state.active = 0;
      state.replaceResult = null;
      setValidity('invalid', 'Invalid regular expression: ' + result.error);
      announce('Invalid regular expression. ' + result.error);
      renderAll();
      return;
    }

    state.error = null;
    state.matches = result.matches;
    state.total = result.total;
    state.countTruncated = Boolean(result.countTruncated);
    state.detailsTruncated = Boolean(result.detailsTruncated);
    state.elapsed = result.elapsed || 0;
    state.replaceResult = result.replace || null;
    if (state.active >= state.matches.length) state.active = 0;

    setValidity('valid', 'Valid regular expression');
    renderAll();
    announce(state.total === 1 ? '1 match found' : state.total.toLocaleString() + ' matches found');
  }

  function evaluate() {
    if (!state.pattern) {
      state.error = null;
      state.matches = [];
      state.total = 0;
      state.countTruncated = false;
      state.detailsTruncated = false;
      state.replaceResult = null;
      state.elapsed = 0;
      setValidity('idle', 'Enter a pattern to begin');
      renderAll();
      return;
    }

    /* Reject an unusable pattern before spending a worker round trip. */
    var compiled = compile(state.pattern, state.flags);
    if (!compiled.ok) {
      applyResult({ ok: false, error: compiled.error });
      return;
    }

    var request = {
      pattern: state.pattern,
      flags: state.flags,
      text: state.text,
      detailLimit: HIGHLIGHT_LIMIT,
      countLimit: DEFAULT_COUNT_LIMIT
    };
    if (state.replaceOn) request.replacement = state.replacement;

    runRequest(request).then(applyResult).catch(function (err) {
      /* The worker never started, so nothing has actually been evaluated
         yet. Answer inline instead of blaming the pattern. */
      if (err && err.message === 'WORKER_FAILED') {
        try {
          applyResult(engine.run(request));
        } catch (inner) {
          applyResult({ ok: false, error: cleanErrorMessage(inner && inner.message) });
        }
        return;
      }

      if (err && err.message === 'TIMEOUT') {
        state.error = 'timeout';
        state.matches = [];
        state.total = 0;
        state.countTruncated = false;
        state.detailsTruncated = false;
        state.replaceResult = null;
        setValidity('slow',
          'This pattern is taking longer than expected. Try simplifying the regex, '
          + 'or testing it against a shorter piece of text.');
        announce('The pattern timed out and was stopped.');
        renderAll();
        return;
      }
      applyResult({ ok: false, error: 'The pattern could not be evaluated.' });
    });
  }

  function scheduleEvaluate() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(evaluate, DEBOUNCE_MS);
  }

  /* ==========================================================
     14. MATCH NAVIGATION
     ========================================================== */

  function setActive(index, options) {
    if (!state.matches.length) return;
    var count = state.matches.length;
    state.active = ((index % count) + count) % count;

    renderPreview();
    renderRibbon();
    renderDetail();

    if (!options || options.scroll !== false) {
      var node = el.preview.querySelector('[data-match="' + state.active + '"]');
      if (node && node.scrollIntoView) {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    announce('Match ' + (state.active + 1) + ' of ' + count);
  }

  /* ==========================================================
     15. CLIPBOARD
     ========================================================== */

  function legacyCopy(value) {
    try {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var done = document.execCommand('copy');
      document.body.removeChild(area);
      return done;
    } catch (err) {
      return false;
    }
  }

  function flash(button, label) {
    if (!button) return;
    var original = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', original);
    button.textContent = label;
    button.classList.add('is-copied');
    window.clearTimeout(button._rxTimer);
    button._rxTimer = window.setTimeout(function () {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 1600);
  }

  function copyValue(value, button, message) {
    function done() {
      flash(button, 'Copied');
      announce(message || 'Copied to clipboard');
    }
    function failed() {
      flash(button, 'Press Ctrl+C');
      announce('Clipboard access was blocked. Select the text and copy it manually.');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () {
        if (legacyCopy(value)) done(); else failed();
      });
      return;
    }
    if (legacyCopy(value)) done(); else failed();
  }

  /* ==========================================================
     16. EXAMPLES AND EXPLANATION
     ========================================================== */

  function loadExample(example) {
    state.pattern = example.pattern;
    state.flags = example.flags;
    state.text = example.text;
    state.replacement = example.replacement || '';
    state.active = 0;

    el.pattern.value = state.pattern;
    el.text.value = state.text;
    el.replacement.value = state.replacement;

    renderFlags();
    savePrefs();
    evaluate();
    announce('Loaded the ' + example.title + ' example.');
  }

  // Mobile 300x250 ad (assets/js/inline-ads.js) 6th example ke baad. Slot ek baar banta
  // hai; filter badalne par sirf cards hatte/judte hain, slot ko hilaya nahi jata -
  // iframe ko DOM me move karne se wo reload hota aur naya impression girta.
  var EXAMPLE_AD_AFTER = 6;
  var exampleAd = null;

  function renderExamples() {
    if (!exampleAd) {
      exampleAd = document.createElement('div');
      exampleAd.className = 'ta-inline-ad';
      el.exampleList.appendChild(exampleAd);
      if (window.TAInlineAd) window.TAInlineAd.fill(exampleAd);
    }
    Array.prototype.slice.call(el.exampleList.children).forEach(function (child) {
      if (child !== exampleAd) el.exampleList.removeChild(child);
    });

    var shown = EXAMPLES.filter(function (example) {
      return state.exampleFilter === 'All' || example.category === state.exampleFilter;
    });
    exampleAd.hidden = shown.length === 0;
    shown.forEach(function (example, index) {
      var card = document.createElement('article');
      card.className = 'rx-example';

      var head = document.createElement('div');
      head.className = 'rx-example__head';

      var title = document.createElement('h3');
      title.className = 'rx-example__title';
      title.textContent = example.title;

      var tag = document.createElement('span');
      tag.className = 'rx-example__tag';
      tag.textContent = example.category;

      head.appendChild(title);
      head.appendChild(tag);
      card.appendChild(head);

      var literal = document.createElement('code');
      literal.className = 'rx-example__pattern';
      literal.textContent = '/' + example.pattern + '/' + example.flags;
      card.appendChild(literal);

      var note = document.createElement('p');
      note.className = 'rx-example__note';
      note.textContent = example.note;
      card.appendChild(note);

      var load = document.createElement('button');
      load.type = 'button';
      load.className = 'rx-btn rx-btn--ghost rx-btn--sm';
      load.textContent = 'Load into tester';
      load.setAttribute('aria-label', 'Load the ' + example.title + ' example into the tester');
      load.addEventListener('click', function () {
        loadExample(example);
        el.app.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      card.appendChild(load);

      if (index < EXAMPLE_AD_AFTER) el.exampleList.insertBefore(card, exampleAd);
      else el.exampleList.appendChild(card);
    });
  }

  function renderExampleFilters() {
    var categories = ['All'];
    EXAMPLES.forEach(function (example) {
      if (categories.indexOf(example.category) === -1) categories.push(example.category);
    });

    el.exampleFilters.textContent = '';
    categories.forEach(function (category) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'rx-chip';
      if (category === state.exampleFilter) button.classList.add('is-on');
      button.setAttribute('aria-pressed', String(category === state.exampleFilter));
      button.textContent = category;
      button.addEventListener('click', function () {
        state.exampleFilter = category;
        renderExampleFilters();
        renderExamples();
      });
      el.exampleFilters.appendChild(button);
    });
  }

  function renderExplanation() {
    el.explainOut.textContent = '';

    if (!state.pattern) {
      var empty = document.createElement('p');
      empty.className = 'rx-detail__empty';
      empty.textContent = 'Enter a pattern above, then press Explain to see it broken down token by token.';
      el.explainOut.appendChild(empty);
      return;
    }

    var tokens = explainPattern(state.pattern);
    var list = document.createElement('ol');
    list.className = 'rx-tokens';

    tokens.forEach(function (token) {
      var item = document.createElement('li');
      item.className = 'rx-token is-' + token.kind;

      var code = document.createElement('code');
      code.className = 'rx-token__code';
      code.textContent = token.text;

      var description = document.createElement('span');
      description.className = 'rx-token__text';
      description.textContent = token.description;

      item.appendChild(code);
      item.appendChild(description);
      list.appendChild(item);
    });

    el.explainOut.appendChild(list);
    announce('Pattern explained in ' + tokens.length + ' tokens.');
  }

  function renderEngineInfo() {
    var features = state.features;
    var rows = [
      ['Engine', 'JavaScript RegExp, running in this browser'],
      ['Named capture groups', features.namedGroups ? 'Supported' : 'Not supported'],
      ['Lookbehind', features.lookbehind ? 'Supported' : 'Not supported'],
      ['Unicode property escapes', features.unicodeProperties ? 'Supported' : 'Not supported'],
      ['Match indices (d flag)', features.flags.d ? 'Supported' : 'Not supported'],
      ['Unicode sets (v flag)', features.flags.v ? 'Supported' : 'Not supported'],
      ['Worker isolation', workerBroken || typeof Worker === 'undefined'
        ? 'Unavailable — patterns run on the main thread'
        : 'Active — slow patterns are cancelled after ' + WORKER_TIMEOUT_MS + ' ms']
    ];

    el.engineInfo.textContent = '';
    rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      el.engineInfo.appendChild(dt);
      el.engineInfo.appendChild(dd);
    });
  }

  /* ==========================================================
     17. SHARE AND PERSISTENCE
     ========================================================== */

  function buildShareUrl(includeText) {
    var params = new URLSearchParams();
    params.set('p', state.pattern);
    params.set('f', state.flags);
    if (state.replacement) params.set('r', state.replacement);
    if (includeText && state.text) params.set('t', state.text);
    return location.origin + location.pathname + '#' + params.toString();
  }

  function readShareUrl() {
    if (!location.hash || location.hash.length < 2) return false;
    var params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('p')) return false;

    state.pattern = params.get('p') || '';
    state.flags = params.get('f') || 'g';
    state.replacement = params.get('r') || '';
    if (params.has('t')) state.text = params.get('t') || '';
    return true;
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (typeof saved.pattern === 'string') state.pattern = saved.pattern;
      if (typeof saved.flags === 'string') state.flags = saved.flags;
      if (typeof saved.replacement === 'string') state.replacement = saved.replacement;
      state.replaceOn = Boolean(saved.replaceOn);
      return true;
    } catch (err) {
      return false;
    }
  }

  function savePrefs() {
    try {
      /* Pattern, flags and replacement only. Test text can hold anything,
         so it is never written to storage. */
      localStorage.setItem(STORE_KEY, JSON.stringify({
        pattern: state.pattern,
        flags: state.flags,
        replacement: state.replacement,
        replaceOn: state.replaceOn
      }));
    } catch (err) {
      /* storage blocked — the tool still works, it just will not remember */
    }
  }

  /* ==========================================================
     18. EVENT WIRING AND INIT
     ========================================================== */

  function bindPattern() {
    el.pattern.addEventListener('input', function () {
      state.pattern = el.pattern.value;
      state.active = 0;
      renderLiteral();
      savePrefs();
      scheduleEvaluate();
    });

    el.text.addEventListener('input', function () {
      state.text = el.text.value;
      state.active = 0;
      scheduleEvaluate();
    });

    el.replacement.addEventListener('input', function () {
      state.replacement = el.replacement.value;
      savePrefs();
      scheduleEvaluate();
    });
  }

  function bindFlags() {
    pickAll('[data-rx-flag]', el.flagsRow).forEach(function (button) {
      var id = button.getAttribute('data-rx-flag');

      if (!state.features.flags[id]) {
        button.disabled = true;
        button.classList.add('is-unsupported');
        button.title = 'This browser does not support the ' + id + ' flag.';
        return;
      }

      button.addEventListener('click', function () {
        var on = state.flags.indexOf(id) !== -1;
        var next = on
          ? state.flags.split('').filter(function (f) { return f !== id; })
          : state.flags.split('').concat(id);

        /* u and v are mutually exclusive in the specification. */
        if (!on && id === 'u') next = next.filter(function (f) { return f !== 'v'; });
        if (!on && id === 'v') next = next.filter(function (f) { return f !== 'u'; });

        var order = 'dgimsuvy';
        state.flags = next.sort(function (a, b) {
          return order.indexOf(a) - order.indexOf(b);
        }).join('');

        renderFlags();
        savePrefs();
        evaluate();
      });
    });
  }

  function bindNavigation() {
    el.prev.addEventListener('click', function () { setActive(state.active - 1); });
    el.next.addEventListener('click', function () { setActive(state.active + 1); });

    el.ribbon.addEventListener('click', function (event) {
      var tick = event.target.closest('[data-jump]');
      if (tick) setActive(Number(tick.getAttribute('data-jump')));
    });

    el.preview.addEventListener('click', function (event) {
      var hit = event.target.closest('[data-match]');
      if (hit) setActive(Number(hit.getAttribute('data-match')), { scroll: false });
    });
  }

  function bindActions() {
    el.copyPattern.addEventListener('click', function () {
      copyValue(state.pattern, el.copyPattern, 'Pattern copied');
    });
    el.copyLiteral.addEventListener('click', function () {
      copyValue('/' + state.pattern + '/' + state.flags, el.copyLiteral, 'Regex literal copied');
    });
    el.copyText.addEventListener('click', function () {
      copyValue(state.text, el.copyText, 'Test text copied');
    });
    el.copyReplacement.addEventListener('click', function () {
      var result = state.replaceResult;
      if (!result || !result.ok) return;
      copyValue(result.output, el.copyReplacement, 'Replacement result copied');
    });

    el.clear.addEventListener('click', function () {
      state.pattern = '';
      state.text = '';
      state.replacement = '';
      state.active = 0;
      el.pattern.value = '';
      el.text.value = '';
      el.replacement.value = '';
      savePrefs();
      evaluate();
      el.pattern.focus();
      announce('Workspace cleared');
    });

    el.loadExample.addEventListener('click', function () {
      loadExample(EXAMPLES[2]);
    });

    el.replaceToggle.addEventListener('click', function () {
      state.replaceOn = !state.replaceOn;
      savePrefs();
      renderReplace();
      if (state.replaceOn) {
        evaluate();
        el.replacement.focus();
      }
    });

    el.explainBtn.addEventListener('click', renderExplanation);

    el.sharePattern.addEventListener('click', function () {
      copyValue(buildShareUrl(false), el.sharePattern, 'Link to the pattern copied');
    });
    el.shareFull.addEventListener('click', function () {
      copyValue(buildShareUrl(true), el.shareFull, 'Link including the test text copied');
    });

    el.forgetBtn.addEventListener('click', function () {
      try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
      announce('Saved pattern removed from this browser');
      flash(el.forgetBtn, 'Cleared');
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (event) {
      var meta = event.ctrlKey || event.metaKey;
      if (!meta) return;

      if (event.shiftKey && (event.key === 'F' || event.key === 'f')) {
        event.preventDefault();
        el.pattern.focus();
        el.pattern.select();
        return;
      }

      if (event.shiftKey && (event.key === 'R' || event.key === 'r')) {
        event.preventDefault();
        if (!state.replaceOn) {
          state.replaceOn = true;
          savePrefs();
          renderReplace();
          evaluate();
        }
        el.replacement.focus();
        return;
      }

      if (event.key === 'Enter' && el.app.contains(document.activeElement)) {
        event.preventDefault();
        window.clearTimeout(debounceTimer);
        evaluate();
      }
    });

    /* Enter cycles matches from the pattern box, where it types nothing. */
    el.pattern.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      setActive(state.active + (event.shiftKey ? -1 : 1));
    });
  }

  function syncPreviewScroll() {
    var wrap = el.preview.parentElement;
    var lock = false;

    function mirror(from, to) {
      if (lock) return;
      lock = true;
      to.scrollTop = from.scrollTop;
      window.requestAnimationFrame(function () { lock = false; });
    }

    el.text.addEventListener('scroll', function () { mirror(el.text, wrap); });
    wrap.addEventListener('scroll', function () { mirror(wrap, el.text); });
  }

  function init() {
    if (!cacheDom()) return;

    var fromUrl = readShareUrl();
    if (!fromUrl) loadPrefs();

    /* A first-time visitor lands on a working demo rather than a blank box. */
    if (!state.pattern && !state.text) {
      var demo = EXAMPLES[2];
      state.pattern = demo.pattern;
      state.flags = demo.flags;
      state.text = demo.text;
      state.replacement = demo.replacement;
    }

    el.pattern.value = state.pattern;
    el.text.value = state.text;
    el.replacement.value = state.replacement;

    renderFlags();
    renderExampleFilters();
    renderExamples();
    renderEngineInfo();

    bindPattern();
    bindFlags();
    bindNavigation();
    bindActions();
    bindKeyboard();
    syncPreviewScroll();

    evaluate();

    /* The worker may only fail once it is actually constructed. */
    window.setTimeout(renderEngineInfo, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
