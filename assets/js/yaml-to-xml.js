/* ToolAdda — YAML to XML Converter engine.
   Pure parsing/serialization logic (no DOM) lives in YamlToXmlEngine so it can
   be reasoned about and tested independently of the UI. Runs entirely
   client-side — nothing here ever makes a network request. */
(function (global) {
  'use strict';

  // =========================================================================
  // Small helpers
  // =========================================================================

  function escapeXmlText(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r/g, '&#13;');
  }

  function escapeXmlAttr(str) {
    return escapeXmlText(str).replace(/"/g, '&quot;');
  }

  function containsUnsafeXmlChars(str) {
    return /[<>&]/.test(str);
  }

  const XML_NAME_START = /[A-Za-z_]/;
  const XML_NAME_CHAR = /[A-Za-z0-9_.:-]/;

  function sanitizeXmlName(rawName, fallback) {
    const original = String(rawName == null ? '' : rawName);
    let name = original.replace(/[^A-Za-z0-9_.:-]/g, '_');
    if (!name) name = fallback || '_';
    if (!XML_NAME_START.test(name.charAt(0))) name = '_' + name;
    if (/^xml/i.test(name)) name = '_' + name;
    const changed = name !== original;
    return { name, changed, original };
  }

  function singularize(word) {
    const w = String(word || '');
    if (/ies$/i.test(w) && w.length > 3) return w.replace(/ies$/i, 'y');
    if (/(ses|xes|zes|ches|shes)$/i.test(w)) return w.replace(/es$/i, '');
    if (/s$/i.test(w) && !/ss$/i.test(w) && w.length > 3) return w.replace(/s$/i, '');
    return w || 'item';
  }

  function makeError(message, line) {
    const err = new Error(line ? `${message} (line ${line})` : message);
    err.code = 'YAML_PARSE_ERROR';
    err.line = line || null;
    return err;
  }

  // =========================================================================
  // Preprocessing — split into lines, strip comments (respecting quotes),
  // measure indentation, detect tabs.
  // =========================================================================

  function stripInlineComment(code) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < code.length; i += 1) {
      const ch = code[i];
      if (inSingle) {
        if (ch === "'") {
          if (code[i + 1] === "'") { i += 1; continue; }
          inSingle = false;
        }
        continue;
      }
      if (inDouble) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === '"') inDouble = false;
        continue;
      }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === '#' && (i === 0 || /\s/.test(code[i - 1]))) {
        return code.slice(0, i);
      }
    }
    return code;
  }

  function preprocess(text) {
    const normalized = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const rawLines = normalized.split('\n');
    const lines = [];
    let tabWarning = false;
    let docCount = 0;
    let docStart = 0;
    let docEndIdx = rawLines.length;

    rawLines.forEach((raw, i) => {
      const lineNo = i + 1;
      const trimmedFull = raw.trim();
      if (trimmedFull === '---') {
        docCount += 1;
        if (docCount === 1) { docStart = i + 1; return; }
        if (docCount === 2 && docEndIdx === rawLines.length) docEndIdx = i;
      }
      if (trimmedFull === '...') {
        if (docEndIdx === rawLines.length) docEndIdx = i;
      }
    });

    const slice = rawLines.slice(docStart, docEndIdx);
    slice.forEach((raw, i) => {
      const lineNo = docStart + i + 1;
      const leadingMatch = raw.match(/^[ \t]*/)[0];
      if (leadingMatch.indexOf('\t') !== -1) tabWarning = true;
      const indent = leadingMatch.length;
      const content = raw.slice(indent);
      const code = stripInlineComment(content).replace(/\s+$/, '');
      const isBlank = raw.trim() === '';
      const isComment = !isBlank && content.trim().charAt(0) === '#';
      lines.push({ raw, lineNo, indent, content, code, isBlank, isComment });
    });

    return { lines, tabWarning, multiDoc: docCount > 1 };
  }

  // =========================================================================
  // Flow-style parsing ({ ... } and [ ... ])
  // =========================================================================

  function parseFlowValue(str, ctx, lineNo) {
    let i = 0;
    const n = str.length;

    function skipWs() { while (i < n && /\s/.test(str[i])) i += 1; }

    function readQuoted(qc) {
      let out = '';
      i += 1;
      while (i < n) {
        const ch = str[i];
        if (qc === '"' && ch === '\\') {
          out += decodeEscape(str, i);
          i += escapeLength(str, i);
          continue;
        }
        if (ch === qc) {
          if (qc === "'" && str[i + 1] === "'") { out += "'"; i += 2; continue; }
          i += 1;
          return { value: out, quoted: true };
        }
        out += ch;
        i += 1;
      }
      throw makeError('Unterminated quoted string in flow value', lineNo);
    }

    function readToken(stopChars) {
      let out = '';
      while (i < n && stopChars.indexOf(str[i]) === -1) {
        out += str[i];
        i += 1;
      }
      return out.trim();
    }

    function parseValue() {
      skipWs();
      if (i >= n) return { value: null, quoted: false };
      const ch = str[i];
      if (ch === '{') return parseFlowMap();
      if (ch === '[') return parseFlowSeq();
      if (ch === '"' || ch === "'") return readQuoted(ch);
      const tok = readToken([',', ']', '}', ':']);
      return coerceScalar(tok);
    }

    function parseFlowSeq() {
      i += 1; // [
      const items = [];
      skipWs();
      if (str[i] === ']') { i += 1; return { node: { type: 'seq', items: [], line: lineNo } }; }
      while (i < n) {
        skipWs();
        const v = parseValue();
        items.push({ value: toAstScalarOrNode(v), comment: null, line: lineNo });
        skipWs();
        if (str[i] === ',') { i += 1; continue; }
        if (str[i] === ']') { i += 1; break; }
        break;
      }
      return { node: { type: 'seq', items, line: lineNo } };
    }

    function parseFlowMap() {
      i += 1; // {
      const entries = [];
      skipWs();
      if (str[i] === '}') { i += 1; return { node: { type: 'map', entries: [], line: lineNo } }; }
      while (i < n) {
        skipWs();
        let key;
        if (str[i] === '"' || str[i] === "'") key = readQuoted(str[i]).value;
        else key = readToken([':', ',', '}']);
        skipWs();
        if (str[i] === ':') i += 1;
        skipWs();
        const v = parseValue();
        entries.push({ key: String(key).trim(), value: toAstScalarOrNode(v), comment: null, line: lineNo });
        skipWs();
        if (str[i] === ',') { i += 1; continue; }
        if (str[i] === '}') { i += 1; break; }
        break;
      }
      return { node: { type: 'map', entries, line: lineNo } };
    }

    function toAstScalarOrNode(v) {
      if (v && v.node) return v.node;
      return { type: 'scalar', value: v.value, quoted: !!v.quoted, line: lineNo };
    }

    const result = parseValue();
    return toAstScalarOrNode(result);
  }

  function escapeLength(str, i) {
    const ch = str[i + 1];
    if (ch === 'u') return 6;
    if (ch === 'x') return 4;
    return 2;
  }

  function decodeEscape(str, i) {
    const ch = str[i + 1];
    const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '0': '\0', b: '\b', f: '\f', '/': '/' };
    if (map[ch] !== undefined) return map[ch];
    if (ch === 'u') return String.fromCharCode(parseInt(str.substr(i + 2, 4), 16));
    if (ch === 'x') return String.fromCharCode(parseInt(str.substr(i + 2, 2), 16));
    return ch;
  }

  function findClosingQuote(str, qc, from) {
    for (let i = from; i < str.length; i += 1) {
      const ch = str[i];
      if (qc === '"') {
        if (ch === '\\') { i += 1; continue; }
        if (ch === '"') return i;
      } else if (ch === "'") {
        if (str[i + 1] === "'") { i += 1; continue; }
        return i;
      }
    }
    return -1;
  }

  function decodeDoubleQuoted(str) {
    let out = '';
    let i = 0;
    while (i < str.length) {
      if (str[i] === '\\') {
        out += decodeEscape(str, i);
        i += escapeLength(str, i);
      } else {
        out += str[i];
        i += 1;
      }
    }
    return out;
  }

  // =========================================================================
  // Scalar coercion (plain, unquoted values)
  // =========================================================================

  const NULL_WORDS = new Set(['~', 'null', 'Null', 'NULL']);
  const TRUE_WORDS = new Set(['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 'on', 'On', 'ON']);
  const FALSE_WORDS = new Set(['false', 'False', 'FALSE', 'no', 'No', 'NO', 'off', 'Off', 'OFF']);
  const INT_RE = /^[-+]?(0|[1-9][0-9_]*)$/;
  const HEX_RE = /^[-+]?0x[0-9a-fA-F_]+$/;
  const OCT_RE = /^[-+]?0o[0-7_]+$/;
  const FLOAT_RE = /^[-+]?(\.[0-9]+|[0-9][0-9_]*(\.[0-9_]*)?)([eE][-+]?[0-9]+)?$/;
  const SPECIAL_FLOAT_RE = /^[-+]?\.(inf|Inf|INF)$|^\.(nan|NaN|NAN)$/;

  function coerceScalar(raw) {
    const tok = String(raw == null ? '' : raw).trim();
    if (tok === '' || tok === "''" || tok === '""') return { value: tok === '' ? null : '', quoted: tok !== '' };
    if (tok.charAt(0) === '"' && tok.charAt(tok.length - 1) === '"' && tok.length >= 2) {
      return { value: decodeDoubleQuoted(tok.slice(1, -1)), quoted: true };
    }
    if (tok.charAt(0) === "'" && tok.charAt(tok.length - 1) === "'" && tok.length >= 2) {
      return { value: tok.slice(1, -1).replace(/''/g, "'"), quoted: true };
    }
    if (NULL_WORDS.has(tok)) return { value: null, quoted: false };
    if (TRUE_WORDS.has(tok)) return { value: true, quoted: false };
    if (FALSE_WORDS.has(tok)) return { value: false, quoted: false };
    if (SPECIAL_FLOAT_RE.test(tok)) return { value: tok, quoted: false, special: true };
    if (HEX_RE.test(tok)) return { value: parseInt(tok.replace(/_/g, ''), 16), quoted: false };
    if (OCT_RE.test(tok)) return { value: parseInt(tok.replace(/_/g, '').replace('0o', ''), 8), quoted: false };
    if (INT_RE.test(tok)) return { value: parseInt(tok.replace(/_/g, ''), 10), quoted: false };
    if (FLOAT_RE.test(tok) && /[.eE]/.test(tok)) return { value: parseFloat(tok.replace(/_/g, '')), quoted: false };
    return { value: tok, quoted: false };
  }

  // =========================================================================
  // Core recursive-descent block parser
  // =========================================================================

  function createParser(lines) {
    const n = lines.length;
    const anchors = Object.create(null);
    const warnings = [];
    let pendingComments = [];

    function pushWarning(message, lineNo) {
      warnings.push({ message, line: lineNo || null });
    }

    function nextSignificant(idx) {
      let i = idx;
      while (i < n) {
        const l = lines[i];
        if (l.isBlank) { pendingComments = []; i += 1; continue; }
        if (l.isComment) { pendingComments.push(l.content.trim().replace(/^#\s?/, '')); i += 1; continue; }
        return i;
      }
      return i;
    }

    function takeComment() {
      if (!pendingComments.length) return null;
      const c = pendingComments.join(' ');
      pendingComments = [];
      return c;
    }

    function findTopLevelColon(str) {
      let depth = 0;
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < str.length; i += 1) {
        const ch = str[i];
        if (inSingle) { if (ch === "'") inSingle = false; continue; }
        if (inDouble) { if (ch === '\\') { i += 1; continue; } if (ch === '"') inDouble = false; continue; }
        if (ch === "'") { inSingle = true; continue; }
        if (ch === '"') { inDouble = true; continue; }
        if (ch === '[' || ch === '{') { depth += 1; continue; }
        if (ch === ']' || ch === '}') { depth -= 1; continue; }
        if (depth === 0 && ch === ':' && (i === str.length - 1 || /\s/.test(str[i + 1]))) return i;
      }
      return -1;
    }

    function isSeqLineCode(code) {
      return code === '-' || /^-(\s|$)/.test(code);
    }

    function extractAnchorTag(str) {
      let rest = str.trim();
      let anchor = null;
      let alias = null;
      let m;
      while ((m = rest.match(/^&([A-Za-z0-9_-]+)\s*/))) { anchor = m[1]; rest = rest.slice(m[0].length); }
      if ((m = rest.match(/^!!?[A-Za-z0-9_:\/-]+\s*/))) rest = rest.slice(m[0].length);
      if ((m = rest.match(/^\*([A-Za-z0-9_-]+)\s*$/))) { alias = m[1]; rest = ''; }
      return { rest: rest.trim(), anchor, alias: alias };
    }

    function parseKeyToken(rawKey) {
      const trimmed = rawKey.trim();
      if (trimmed.charAt(0) === '"' && trimmed.charAt(trimmed.length - 1) === '"') {
        return decodeDoubleQuoted(trimmed.slice(1, -1));
      }
      if (trimmed.charAt(0) === "'" && trimmed.charAt(trimmed.length - 1) === "'") {
        return trimmed.slice(1, -1).replace(/''/g, "'");
      }
      return trimmed;
    }

    function readPlainContinuation(idx, minIndent, firstText) {
      let text = firstText;
      let i = idx;
      while (i < n) {
        const l = lines[i];
        if (l.isBlank) break;
        if (l.isComment) break;
        if (l.indent < minIndent) break;
        if (isSeqLineCode(l.code)) break;
        if (findTopLevelColon(l.code) !== -1) break;
        text += ' ' + l.code.trim();
        i += 1;
      }
      return { text, idx: i };
    }

    function readBlockScalar(idx, parentIndent, indicator, chomp) {
      const bodyLines = [];
      let i = idx;
      let blockIndent = null;
      while (i < n) {
        const l = lines[i];
        if (l.isBlank) { bodyLines.push(''); i += 1; continue; }
        if (l.indent <= parentIndent && !l.isBlank) break;
        if (blockIndent === null) blockIndent = l.indent;
        bodyLines.push(l.raw.slice(Math.min(blockIndent, l.indent)));
        i += 1;
      }
      while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
      let text;
      if (indicator === '|') {
        text = bodyLines.join('\n');
      } else {
        const paragraphs = [];
        let cur = [];
        bodyLines.forEach((ln) => {
          if (ln === '') { paragraphs.push(cur.join(' ')); paragraphs.push(''); cur = []; }
          else cur.push(ln);
        });
        if (cur.length) paragraphs.push(cur.join(' '));
        text = paragraphs.join('\n').replace(/\n{2,}/g, (m) => '\n'.repeat(m.length - 1));
      }
      if (chomp === '-') text = text.replace(/\n+$/, '');
      else if (chomp === '+') text = text; // keep as-is
      else text = text.replace(/\n*$/, '') + (bodyLines.length ? '\n' : '');
      return { value: text, idx: i };
    }

    function parseScalarCell(idx, indent, rawContent) {
      let content = rawContent.trim();
      const { rest, anchor, alias } = extractAnchorTag(content);
      if (alias) {
        return { node: { type: 'alias', name: alias, line: lines[idx] ? lines[idx].lineNo : null }, idx: idx + 1, anchor };
      }
      content = rest;
      if (content === '') {
        const nested = parseNestedBlock(idx + 1, indent);
        return { node: nested.node, idx: nested.idx, anchor };
      }
      if (content.charAt(0) === '|' || content.charAt(0) === '>') {
        const indicator = content.charAt(0);
        const chomp = content.charAt(1) === '-' || content.charAt(1) === '+' ? content.charAt(1) : null;
        const bs = readBlockScalar(idx + 1, indent, indicator, chomp);
        return { node: { type: 'scalar', value: bs.value, quoted: true, block: true, line: lines[idx].lineNo }, idx: bs.idx, anchor };
      }
      if (content.charAt(0) === '"' || content.charAt(0) === "'") {
        const qc = content.charAt(0);
        let combined = content;
        let closeIdx = findClosingQuote(combined, qc, 1);
        let i = idx + 1;
        while (closeIdx === -1 && i < n && lines[i].indent > indent) {
          combined += ' ' + lines[i].code.trim();
          closeIdx = findClosingQuote(combined, qc, 1);
          i += 1;
        }
        if (closeIdx === -1) {
          throw makeError(`Unterminated ${qc === '"' ? 'double' : 'single'}-quoted string starting with ${qc}`, lines[idx].lineNo);
        }
        const inner = combined.slice(1, closeIdx);
        const value = qc === '"' ? decodeDoubleQuoted(inner) : inner.replace(/''/g, "'");
        return { node: { type: 'scalar', value, quoted: true, line: lines[idx].lineNo }, idx: i, anchor };
      }
      if (content.charAt(0) === '{' || content.charAt(0) === '[') {
        let combined = content;
        let i = idx + 1;
        while (!isBalanced(combined) && i < n) { combined += ' ' + lines[i].code.trim(); i += 1; }
        const node = parseFlowValue(combined, {}, lines[idx].lineNo);
        return { node, idx: i, anchor };
      }
      const cont = readPlainContinuation(idx + 1, indent + 1, content);
      const coerced = coerceScalar(cont.text);
      return { node: { type: 'scalar', value: coerced.value, quoted: coerced.quoted, line: lines[idx].lineNo }, idx: cont.idx, anchor };
    }

    function isBalanced(str) {
      let depth = 0; let inS = false; let inD = false;
      for (let i = 0; i < str.length; i += 1) {
        const ch = str[i];
        if (inS) { if (ch === "'") inS = false; continue; }
        if (inD) { if (ch === '\\') { i += 1; continue; } if (ch === '"') inD = false; continue; }
        if (ch === "'") inS = true;
        else if (ch === '"') inD = true;
        else if (ch === '{' || ch === '[') depth += 1;
        else if (ch === '}' || ch === ']') depth -= 1;
      }
      return depth <= 0;
    }

    function registerAnchor(name, node) {
      if (name) anchors[name] = node;
    }

    function parseMapping(startIdx, blockIndent) {
      const entries = [];
      let i = startIdx;
      const seenKeys = new Set();
      for (;;) {
        i = nextSignificant(i);
        if (i >= n) break;
        const l = lines[i];
        if (l.indent !== blockIndent) break;
        if (isSeqLineCode(l.code)) break;
        const colonIdx = findTopLevelColon(l.code);
        if (colonIdx === -1) break;
        const comment = takeComment();
        const rawKey = l.code.slice(0, colonIdx);
        const key = parseKeyToken(rawKey);
        const rawVal = l.code.slice(colonIdx + 1);
        const cell = parseScalarCell(i, l.indent, rawVal);
        registerAnchor(cell.anchor, cell.node);
        if (key !== '<<') {
          if (seenKeys.has(key)) pushWarning(`Duplicate key "${key}" — later value overrides the earlier one.`, l.lineNo);
          seenKeys.add(key);
        }
        entries.push({ key, value: cell.node, comment, line: l.lineNo });
        i = cell.idx;
      }
      return { node: { type: 'map', entries, line: lines[startIdx] ? lines[startIdx].lineNo : null }, idx: i };
    }

    function parseSequence(startIdx, blockIndent) {
      const items = [];
      let i = startIdx;
      for (;;) {
        i = nextSignificant(i);
        if (i >= n) break;
        const l = lines[i];
        if (l.indent !== blockIndent) break;
        if (!isSeqLineCode(l.code)) break;
        const comment = takeComment();
        const dashCol = l.indent;
        const afterDash = l.code.slice(1);
        const trimmedAfter = afterDash.replace(/^\s*/, '');
        if (trimmedAfter === '') {
          // Unlike a mapping value, a sequence item's nested value has no
          // same-indent dispensation in the spec — an equally-indented "-"
          // line is always the next sibling item, never nested content.
          const j = nextSignificant(i + 1);
          const nested = (j < n && lines[j].indent > dashCol)
            ? parseNode(j, lines[j].indent)
            : { node: { type: 'scalar', value: null, quoted: false, line: l.lineNo }, idx: i + 1 };
          items.push({ value: nested.node, comment, line: l.lineNo });
          i = nested.idx;
          continue;
        }
        const contentCol = dashCol + 1 + (afterDash.length - trimmedAfter.length);
        const colonIdx = findTopLevelColon(trimmedAfter);
        if (colonIdx !== -1 && !isSeqLineCode(trimmedAfter)) {
          const virtualLine = { raw: l.raw, lineNo: l.lineNo, indent: contentCol, content: trimmedAfter, code: trimmedAfter, isBlank: false, isComment: false };
          const savedLine = lines[i];
          lines[i] = virtualLine;
          const mapResult = parseMapping(i, contentCol);
          lines[i] = savedLine;
          items.push({ value: mapResult.node, comment, line: l.lineNo });
          i = mapResult.idx;
        } else if (isSeqLineCode(trimmedAfter)) {
          const virtualLine = { raw: l.raw, lineNo: l.lineNo, indent: contentCol, content: trimmedAfter, code: trimmedAfter, isBlank: false, isComment: false };
          const savedLine = lines[i];
          lines[i] = virtualLine;
          const seqResult = parseSequence(i, contentCol);
          lines[i] = savedLine;
          items.push({ value: seqResult.node, comment, line: l.lineNo });
          i = seqResult.idx;
        } else {
          const cell = parseScalarCell(i, contentCol - 1, trimmedAfter);
          registerAnchor(cell.anchor, cell.node);
          items.push({ value: cell.node, comment, line: l.lineNo });
          i = cell.idx;
        }
      }
      return { node: { type: 'seq', items, line: lines[startIdx] ? lines[startIdx].lineNo : null }, idx: i };
    }

    function parseNode(startIdx, minIndent) {
      const i = nextSignificant(startIdx);
      if (i >= n) return { node: { type: 'scalar', value: null, quoted: false, line: null }, idx: i };
      const l = lines[i];
      if (l.indent < minIndent) return { node: { type: 'scalar', value: null, quoted: false, line: l.lineNo }, idx: startIdx };
      if (isSeqLineCode(l.code)) return parseSequence(i, l.indent);
      if (findTopLevelColon(l.code) !== -1) return parseMapping(i, l.indent);
      const cell = parseScalarCell(i, l.indent, l.code);
      registerAnchor(cell.anchor, cell.node);
      return { node: cell.node, idx: cell.idx };
    }

    // Nested block that follows a "key:" or "-" with nothing else on the line.
    // Per the YAML spec, a block sequence is allowed to start at the SAME
    // indentation as its parent key/dash (the common zero-indent list style
    // used by Ansible, Docker Compose, etc.) — every other nested block must
    // be indented strictly more than the parent.
    function parseNestedBlock(afterIdx, parentIndent) {
      const i = nextSignificant(afterIdx);
      if (i >= n) return { node: { type: 'scalar', value: null, quoted: false, line: null }, idx: i };
      const l = lines[i];
      if (isSeqLineCode(l.code) && l.indent >= parentIndent) return parseSequence(i, l.indent);
      if (l.indent > parentIndent) return parseNode(i, l.indent);
      return { node: { type: 'scalar', value: null, quoted: false, line: l.lineNo }, idx: afterIdx };
    }

    return { parseNode, parseNestedBlock, anchors, warnings, pushWarning };
  }

  function parseYaml(text) {
    const { lines, tabWarning, multiDoc } = preprocess(text);
    const trimmedHasContent = lines.some((l) => !l.isBlank && !l.isComment);
    const parser = createParser(lines);
    if (!trimmedHasContent) {
      return { ast: { type: 'scalar', value: null, quoted: false, line: null }, anchors: {}, warnings: [], tabWarning: false, multiDoc: false, empty: true };
    }
    let result;
    try {
      result = parser.parseNode(0, 0);
    } catch (e) {
      if (e && e.code === 'YAML_PARSE_ERROR') throw e;
      throw makeError('Could not parse YAML: ' + (e && e.message ? e.message : String(e)));
    }
    if (tabWarning) parser.pushWarning('Tab characters were found in indentation; spaces are recommended by the YAML spec.', null);
    if (multiDoc) parser.pushWarning('Multiple YAML documents (separated by "---") were detected; only the first document was converted.', null);
    return { ast: result.node, anchors: parser.anchors, warnings: parser.warnings, tabWarning, multiDoc, empty: false };
  }

  // =========================================================================
  // Alias / merge-key resolution (produces a fully expanded AST, cycle-safe)
  // =========================================================================

  function resolveAst(ast, anchors, warnings) {
    const resolving = new Set();

    function resolveAlias(node) {
      const target = anchors[node.name];
      if (!target) {
        warnings.push({ message: `Unresolved alias "*${node.name}" — no matching anchor was found; treated as null.`, line: node.line });
        return { type: 'scalar', value: null, quoted: false, line: node.line };
      }
      if (resolving.has(node.name)) {
        throw makeError(`Circular reference detected through anchor "&${node.name}"`, node.line);
      }
      resolving.add(node.name);
      const resolved = resolveNode(target);
      resolving.delete(node.name);
      return resolved;
    }

    function resolveNode(node) {
      if (!node) return { type: 'scalar', value: null, quoted: false, line: null };
      if (node.type === 'alias') return resolveAlias(node);
      if (node.type === 'scalar') return node;
      if (node.type === 'seq') {
        return { type: 'seq', line: node.line, items: node.items.map((it) => ({ value: resolveNode(it.value), comment: it.comment, line: it.line })) };
      }
      if (node.type === 'map') {
        const merged = new Map();
        const order = [];
        node.entries.forEach((entry) => {
          if (entry.key === '<<') {
            const sources = [];
            const val = entry.value;
            if (val && val.type === 'alias') sources.push(resolveAlias(val));
            else if (val && val.type === 'seq') val.items.forEach((it) => { sources.push(resolveNode(it.value)); });
            else if (val && val.type === 'map') sources.push(resolveNode(val));
            sources.forEach((src) => {
              if (!src || src.type !== 'map') return;
              src.entries.forEach((se) => {
                if (!merged.has(se.key)) order.push(se.key);
                merged.set(se.key, { key: se.key, value: se.value, comment: se.comment, line: se.line });
              });
            });
            return;
          }
          const resolvedVal = resolveNode(entry.value);
          if (!merged.has(entry.key)) order.push(entry.key);
          merged.set(entry.key, { key: entry.key, value: resolvedVal, comment: entry.comment, line: entry.line });
        });
        return { type: 'map', line: node.line, entries: order.map((k) => merged.get(k)) };
      }
      return { type: 'scalar', value: null, quoted: false, line: node.line || null };
    }

    return resolveNode(ast);
  }

  // =========================================================================
  // AST -> plain JS value (for stats / tree helpers)
  // =========================================================================

  function astToPlain(node) {
    if (!node) return null;
    if (node.type === 'scalar') return node.value;
    if (node.type === 'seq') return node.items.map((it) => astToPlain(it.value));
    if (node.type === 'map') {
      const obj = {};
      node.entries.forEach((e) => { obj[e.key] = astToPlain(e.value); });
      return obj;
    }
    return null;
  }

  function computeStats(node) {
    let maps = 0; let seqs = 0; let scalars = 0; let maxDepth = 0; let keys = 0;
    (function walk(n, depth) {
      maxDepth = Math.max(maxDepth, depth);
      if (!n) return;
      if (n.type === 'map') {
        maps += 1;
        n.entries.forEach((e) => { keys += 1; walk(e.value, depth + 1); });
      } else if (n.type === 'seq') {
        seqs += 1;
        n.items.forEach((it) => walk(it.value, depth + 1));
      } else {
        scalars += 1;
      }
    })(node, 1);
    return { maps, seqs, scalars, maxDepth, keys };
  }

  // =========================================================================
  // XML serialization
  // =========================================================================

  const DEFAULT_OPTIONS = {
    rootName: 'root',
    arrayItemName: 'item',
    arrayItemMode: 'fixed', // 'fixed' | 'auto' (singularize parent key)
    indentSize: 2,
    indentChar: ' ',
    includeDeclaration: true,
    xmlVersion: '1.0',
    encoding: 'UTF-8',
    attributePrefix: '@',
    textKey: '#text',
    selfCloseEmpty: true,
    preserveComments: true,
    addTypeHints: false,
    sanitizeNames: true,
    cdataForUnsafeText: false,
    pretty: true,
  };

  function scalarToText(node, opts) {
    const v = node.value;
    if (v === null || v === undefined) return { text: '', isNull: true };
    if (typeof v === 'boolean') return { text: v ? 'true' : 'false', type: 'boolean' };
    if (typeof v === 'number') return { text: String(v), type: 'number' };
    return { text: String(v), type: 'string' };
  }

  function itemNameFor(key, opts) {
    if (opts.arrayItemMode === 'auto') {
      const s = singularize(key);
      return s === key ? opts.arrayItemName || 'item' : s;
    }
    return opts.arrayItemName || 'item';
  }

  function buildSerializer(opts) {
    const renamed = [];
    const nl = opts.pretty ? '\n' : '';
    const indentUnit = opts.indentChar === '\t' ? '\t' : ' '.repeat(opts.indentSize);

    function ind(depth) {
      return opts.pretty ? indentUnit.repeat(depth) : '';
    }

    function safeName(name) {
      if (!opts.sanitizeNames) return name;
      const res = sanitizeXmlName(name);
      if (res.changed) renamed.push({ from: res.original, to: res.name });
      return res.name;
    }

    function textContent(str) {
      const s = String(str);
      if (opts.cdataForUnsafeText && containsUnsafeXmlChars(s)) return `<![CDATA[${s}]]>`;
      return escapeXmlText(s);
    }

    function splitMapEntries(node) {
      const attrs = [];
      let textEntry = null;
      const children = [];
      node.entries.forEach((e) => {
        if (opts.attributePrefix && e.key.indexOf(opts.attributePrefix) === 0 && e.key.length > opts.attributePrefix.length) {
          attrs.push({ key: e.key.slice(opts.attributePrefix.length), value: e.value, comment: e.comment });
        } else if (e.key === opts.textKey) {
          textEntry = e;
        } else {
          children.push(e);
        }
      });
      return { attrs, textEntry, children };
    }

    function renderAttrs(attrs) {
      if (!attrs.length) return '';
      return attrs.map((a) => {
        const name = safeName(a.key);
        const sc = a.value && a.value.type === 'scalar' ? scalarToText(a.value, opts) : { text: '' };
        return ` ${name}="${escapeXmlAttr(sc.text)}"`;
      }).join('');
    }

    function typeHintAttr(info) {
      if (!opts.addTypeHints) return '';
      if (info.isNull) return ' xsi:nil="true"';
      if (info.type && info.type !== 'string') return ` type="${info.type}"`;
      return '';
    }

    function commentLine(depth, comment) {
      if (!opts.preserveComments || !comment) return '';
      return `${ind(depth)}<!-- ${String(comment).replace(/--/g, '—').trim()} -->${nl}`;
    }

    function emitScalarElement(depth, name, node, attrs, comment) {
      const tag = safeName(name);
      const info = scalarToText(node, opts);
      const attrStr = renderAttrs(attrs) + typeHintAttr(info);
      let out = commentLine(depth, comment);
      if (info.isNull && !attrs.length) {
        if (opts.selfCloseEmpty) return out + `${ind(depth)}<${tag}${attrStr}${opts.addTypeHints ? '' : ''}/>${nl}`;
        return out + `${ind(depth)}<${tag}${attrStr}></${tag}>${nl}`;
      }
      if (info.isNull && attrs.length) {
        return out + (opts.selfCloseEmpty ? `${ind(depth)}<${tag}${attrStr}/>${nl}` : `${ind(depth)}<${tag}${attrStr}></${tag}>${nl}`);
      }
      return out + `${ind(depth)}<${tag}${attrStr}>${textContent(info.text)}</${tag}>${nl}`;
    }

    function emitSeqElement(depth, name, node, comment) {
      const tag = safeName(name);
      let out = commentLine(depth, comment);
      if (!node.items.length) {
        out += opts.selfCloseEmpty ? `${ind(depth)}<${tag}/>${nl}` : `${ind(depth)}<${tag}></${tag}>${nl}`;
        return out;
      }
      const iName = itemNameFor(name, opts);
      out += `${ind(depth)}<${tag}>${nl}`;
      node.items.forEach((it) => {
        out += emitNode(depth + 1, iName, it.value, it.comment);
      });
      out += `${ind(depth)}</${tag}>${nl}`;
      return out;
    }

    function emitMapElement(depth, name, node, comment) {
      const tag = safeName(name);
      const { attrs, textEntry, children } = splitMapEntries(node);
      let out = commentLine(depth, comment);
      const attrStr = renderAttrs(attrs);
      if (!children.length) {
        if (textEntry) {
          const info = scalarToText(textEntry.value.type === 'scalar' ? textEntry.value : { value: '' }, opts);
          out += `${ind(depth)}<${tag}${attrStr}>${textContent(info.text)}</${tag}>${nl}`;
        } else if (attrs.length) {
          out += opts.selfCloseEmpty ? `${ind(depth)}<${tag}${attrStr}/>${nl}` : `${ind(depth)}<${tag}${attrStr}></${tag}>${nl}`;
        } else {
          out += opts.selfCloseEmpty ? `${ind(depth)}<${tag}/>${nl}` : `${ind(depth)}<${tag}></${tag}>${nl}`;
        }
        return out;
      }
      out += `${ind(depth)}<${tag}${attrStr}>${nl}`;
      if (textEntry) {
        const info = scalarToText(textEntry.value.type === 'scalar' ? textEntry.value : { value: '' }, opts);
        out += `${ind(depth + 1)}${textContent(info.text)}${nl}`;
      }
      children.forEach((e) => {
        out += emitNode(depth + 1, e.key, e.value, e.comment);
      });
      out += `${ind(depth)}</${tag}>${nl}`;
      return out;
    }

    function emitNode(depth, name, node, comment) {
      if (!node || node.type === 'scalar') return emitScalarElement(depth, name, node || { type: 'scalar', value: null }, [], comment);
      if (node.type === 'seq') return emitSeqElement(depth, name, node, comment);
      if (node.type === 'map') return emitMapElement(depth, name, node, comment);
      return '';
    }

    function emitRoot(node) {
      const rootTag = safeName(opts.rootName || 'root');
      if (node.type === 'map') return emitMapElement(0, rootTag, node, null);
      if (node.type === 'seq') return emitSeqElement(0, rootTag, node, null);
      return emitScalarElement(0, rootTag, node, [], null);
    }

    return { emitRoot, renamed };
  }

  function toXml(ast, userOptions) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, userOptions || {});
    const serializer = buildSerializer(opts);
    let body = serializer.emitRoot(ast);
    if (!opts.pretty) body = body.trim();
    let out = '';
    if (opts.includeDeclaration) {
      out += `<?xml version="${opts.xmlVersion}" encoding="${opts.encoding}"?>` + (opts.pretty ? '\n' : '');
    }
    out += body;
    if (opts.pretty) out = out.replace(/\n+$/, '\n');
    return { xml: out, renamed: serializer.renamed };
  }

  // =========================================================================
  // Public API
  // =========================================================================

  const YamlToXmlEngine = {
    parseYaml,
    resolveAst,
    astToPlain,
    computeStats,
    toXml,
    sanitizeXmlName,
    escapeXmlText,
    escapeXmlAttr,
    singularize,
    defaultOptions: DEFAULT_OPTIONS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = YamlToXmlEngine;
  } else {
    global.YamlToXmlEngine = YamlToXmlEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
