/* ToolAdda — JSON to TypeScript Generator engine.
   Pure parsing/inference/codegen logic (no DOM) lives in JSONToTSEngine so it
   can be reasoned about independently of the UI. Runs entirely client-side —
   nothing here ever makes a network request. */
(function (global) {
  'use strict';

  // ---------- JSON parsing with line/column error reporting ----------

  function extractLineCol(text, message) {
    const m = /position\s+(\d+)/i.exec(message || '');
    if (!m) return { line: null, column: null };
    const pos = Number(m[1]);
    const upTo = text.slice(0, pos);
    const line = (upTo.match(/\n/g) || []).length + 1;
    const lastNewline = upTo.lastIndexOf('\n');
    const column = pos - lastNewline;
    return { line, column };
  }

  function parseJsonText(text) {
    const src = String(text == null ? '' : text);
    if (!src.trim()) {
      const err = new Error('Paste, upload, or drop JSON data first.');
      err.code = 'EMPTY';
      throw err;
    }
    try {
      return JSON.parse(src);
    } catch (e) {
      const { line, column } = extractLineCol(src, e.message);
      const err = new Error(e.message + (line ? ` (around line ${line}, column ${column})` : ''));
      err.code = 'PARSE_ERROR';
      err.line = line;
      err.column = column;
      throw err;
    }
  }

  // ---------- raw JSON stats (objects/arrays/depth) — used before codegen ----------

  function computeRawStats(value) {
    let objects = 0;
    let arrays = 0;
    let maxDepth = 0;
    (function walk(v, depth) {
      maxDepth = Math.max(maxDepth, depth);
      if (Array.isArray(v)) {
        arrays += 1;
        v.forEach((item) => walk(item, depth + 1));
      } else if (v && typeof v === 'object') {
        objects += 1;
        Object.keys(v).forEach((k) => walk(v[k], depth + 1));
      }
    })(value, 1);
    return { objects, arrays, maxDepth };
  }

  // ---------- naming helpers ----------

  const RESERVED_TYPE_NAMES = new Set([
    'any', 'boolean', 'never', 'null', 'number', 'object', 'string', 'symbol',
    'undefined', 'unknown', 'void', 'bigint', 'Array', 'Record', 'Promise',
    'Function', 'Object', 'String', 'Number', 'Boolean',
  ]);

  function toPascalCase(str) {
    const raw = String(str == null ? '' : str);
    const spaced = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim();
    const parts = spaced.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Item';
    let name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
    if (/^[0-9]/.test(name)) name = 'N' + name;
    return name || 'Item';
  }

  function singularize(word) {
    const w = String(word || '');
    if (/ies$/i.test(w)) return w.replace(/ies$/i, 'y');
    if (/(ses|xes|zes|ches|shes)$/i.test(w)) return w.replace(/es$/i, '');
    if (/s$/i.test(w) && !/ss$/i.test(w) && w.length > 3) return w.replace(/s$/i, '');
    return w;
  }

  const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  function isValidIdentifier(key) {
    return IDENT_RE.test(key);
  }

  // ---------- shape inference (structural, with merging across array items) ----------

  const MAX_LITERALS = 12;

  function inferShape(value) {
    if (value === null) return { kind: 'null', nullable: false };
    if (Array.isArray(value)) {
      if (value.length === 0) return { kind: 'array', of: { kind: 'unknown', nullable: false }, nullable: false };
      let merged = inferShape(value[0]);
      for (let i = 1; i < value.length; i += 1) merged = mergeTwo(merged, inferShape(value[i]));
      return { kind: 'array', of: merged, nullable: false };
    }
    if (typeof value === 'object') {
      const fields = new Map();
      Object.keys(value).forEach((k) => {
        fields.set(k, { required: true, shape: inferShape(value[k]) });
      });
      return { kind: 'object', fields, nullable: false };
    }
    if (typeof value === 'string') {
      return {
        kind: 'primitive', type: 'string', nullable: false,
        sample: value, literalValues: new Set([value]), literalOverflow: false, sampleCount: 1,
      };
    }
    if (typeof value === 'number') return { kind: 'primitive', type: 'number', nullable: false };
    if (typeof value === 'boolean') return { kind: 'primitive', type: 'boolean', nullable: false };
    return { kind: 'unknown', nullable: false };
  }

  function signatureOf(shape) {
    let core;
    switch (shape.kind) {
      case 'object': {
        const keys = [...shape.fields.keys()].sort();
        core = 'obj{' + keys.map((k) => {
          const f = shape.fields.get(k);
          return JSON.stringify(k) + (f.required ? '' : '?') + ':' + signatureOf(f.shape);
        }).join(',') + '}';
        break;
      }
      case 'array': core = 'arr<' + signatureOf(shape.of) + '>'; break;
      case 'union': core = 'uni<' + shape.of.map(signatureOf).slice().sort().join('|') + '>'; break;
      case 'primitive': core = 'prim:' + shape.type; break;
      case 'null': core = 'null'; break;
      default: core = 'unknown';
    }
    return shape.nullable ? core + '?N' : core;
  }

  function mergeObjects(a, b) {
    const fields = new Map();
    const keys = new Set([...a.fields.keys(), ...b.fields.keys()]);
    keys.forEach((k) => {
      const inA = a.fields.has(k);
      const inB = b.fields.has(k);
      let shape;
      let required;
      if (inA && inB) {
        const fa = a.fields.get(k);
        const fb = b.fields.get(k);
        shape = mergeTwo(fa.shape, fb.shape);
        required = fa.required && fb.required;
      } else {
        const f = inA ? a.fields.get(k) : b.fields.get(k);
        shape = f.shape;
        required = false; // present in only some merged instances -> optional
      }
      fields.set(k, { required, shape });
    });
    return { kind: 'object', fields };
  }

  function mergePrimitives(a, b) {
    if (a.type !== 'string') return { kind: 'primitive', type: a.type };
    const overflow = a.literalOverflow || b.literalOverflow;
    const values = new Set([...(a.literalValues || []), ...(b.literalValues || [])]);
    return {
      kind: 'primitive',
      type: 'string',
      sample: a.sample != null ? a.sample : b.sample,
      literalValues: overflow || values.size > MAX_LITERALS ? new Set() : values,
      literalOverflow: overflow || values.size > MAX_LITERALS,
      sampleCount: (a.sampleCount || 0) + (b.sampleCount || 0),
    };
  }

  function unionOfParts(parts) {
    const seen = new Map();
    parts.forEach((p) => {
      const sig = signatureOf(p);
      if (!seen.has(sig)) seen.set(sig, p);
    });
    const unique = [...seen.values()];
    if (unique.length === 1) return unique[0];
    return { kind: 'union', of: unique };
  }

  function mergeTwo(a, b) {
    if (a.kind === 'unknown') return { ...b };
    if (b.kind === 'unknown') return { ...a };
    if (a.kind === 'null') return { ...b, nullable: true };
    if (b.kind === 'null') return { ...a, nullable: true };

    const nullable = !!a.nullable || !!b.nullable;
    let merged;
    if (a.kind === 'object' && b.kind === 'object') {
      merged = mergeObjects(a, b);
    } else if (a.kind === 'array' && b.kind === 'array') {
      merged = { kind: 'array', of: mergeTwo(a.of, b.of) };
    } else if (a.kind === 'primitive' && b.kind === 'primitive' && a.type === b.type) {
      merged = mergePrimitives(a, b);
    } else if (a.kind === 'union' || b.kind === 'union') {
      const partsA = a.kind === 'union' ? a.of : [a];
      const partsB = b.kind === 'union' ? b.of : [b];
      merged = unionOfParts([...partsA, ...partsB]);
    } else {
      merged = unionOfParts([a, b]);
    }
    merged.nullable = nullable || !!merged.nullable;
    return merged;
  }

  // ---------- format detection for JSDoc hints ----------

  function detectFormat(shape) {
    if (shape.kind !== 'primitive' || shape.type !== 'string' || shape.sample == null) return null;
    const v = shape.sample;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return 'date-time (ISO 8601)';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date (YYYY-MM-DD)';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return 'uuid';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
    if (/^https?:\/\//i.test(v)) return 'uri';
    return null;
  }

  function isDynamicKeyObject(shape) {
    const keys = [...shape.fields.keys()];
    if (keys.length < 4) return false;
    const allNumeric = keys.every((k) => /^\d+$/.test(k));
    const allUuid = keys.every((k) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k));
    return allNumeric || allUuid;
  }

  function mergeAllFieldShapes(shape) {
    const shapes = [...shape.fields.values()].map((f) => f.shape);
    let merged = shapes[0];
    for (let i = 1; i < shapes.length; i += 1) merged = mergeTwo(merged, shapes[i]);
    return merged;
  }

  // ---------- code generation ----------

  const DEFAULT_OPTIONS = {
    declKind: 'interface',       // interface | type | class
    rootName: 'Root',
    prefix: '',
    suffix: '',
    exportStyle: 'export',       // none | export | export-default
    semicolons: true,
    quoteProps: 'as-needed',     // as-needed | always
    arrayStyle: 'bracket',       // bracket | generic
    optionalMode: 'auto',        // auto | all | none
    nullMode: 'union',           // union | optional | both
    readonly: false,
    detectRecord: true,
    enumMode: 'off',             // off | union | enum
    jsdoc: false,
    dedupe: true,
    indent: '2',                 // '2' | '4' | 'tab'
    sortProps: false,
    header: true,
  };

  function generate(rootValue, userOptions) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, userOptions || {});
    const indentStr = opts.indent === 'tab' ? '\t' : ' '.repeat(Number(opts.indent) || 2);
    const semi = opts.semicolons ? ';' : '';
    const exportKw = opts.exportStyle === 'export' ? 'export ' : '';
    const warnings = [];

    const usedNames = new Set();
    const registry = new Map(); // signature -> name (for dedupe)
    const blocks = [];

    function sanitizeTypeName(name) {
      let n = name.replace(/[^A-Za-z0-9_$]/g, '');
      if (!n || /^[0-9]/.test(n)) n = 'T' + n;
      if (RESERVED_TYPE_NAMES.has(n)) n = n + 'Type';
      return n;
    }

    function allocateName(base) {
      let name = sanitizeTypeName(base) || 'Item';
      let i = 2;
      const orig = name;
      while (usedNames.has(name)) {
        name = orig + i;
        i += 1;
      }
      usedNames.add(name);
      return name;
    }

    function formatPropKey(key) {
      const needsQuote = opts.quoteProps === 'always' || !isValidIdentifier(key);
      return needsQuote ? JSON.stringify(key) : key;
    }

    function escapeLiteral(v) {
      return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }

    function emitEnum(shape, ctxName) {
      const enumName = allocateName((opts.prefix || '') + toPascalCase(ctxName) + (opts.suffix || ''));
      const idx = blocks.length;
      blocks.push('');
      const values = [...shape.literalValues];
      const lines = values.map((v) => `${indentStr}${toPascalCase(v) || 'Value'} = ${escapeLiteral(v)}${opts.semicolons ? ',' : ','}`);
      blocks[idx] = `${exportKw}enum ${enumName} {\n${lines.join('\n')}\n}`;
      return enumName;
    }

    function typeOf(shape, ctxName) {
      switch (shape.kind) {
        case 'unknown':
          return 'unknown';
        case 'null':
          return 'null';
        case 'primitive': {
          if (shape.type === 'string') {
            const eligible = opts.enumMode !== 'off'
              && shape.literalValues && !shape.literalOverflow
              && shape.literalValues.size >= 2 && (shape.sampleCount || 1) >= 2;
            if (eligible) {
              if (opts.enumMode === 'enum') return emitEnum(shape, ctxName);
              return [...shape.literalValues].map(escapeLiteral).join(' | ');
            }
            return 'string';
          }
          return shape.type;
        }
        case 'array': {
          const singular = singularize(ctxName);
          const childCtx = singular === ctxName ? ctxName + 'Item' : singular;
          const inner = typeOf(shape.of, childCtx);
          const wrap = shape.of.kind === 'union';
          if (opts.arrayStyle === 'generic') return `Array<${inner}>`;
          return wrap ? `(${inner})[]` : `${inner}[]`;
        }
        case 'union': {
          const parts = shape.of.map((s) => typeOf(s, ctxName));
          const unique = [...new Set(parts)];
          unique.sort((a, b) => {
            if (a === 'null') return 1;
            if (b === 'null') return -1;
            return a.localeCompare(b);
          });
          return unique.join(' | ');
        }
        case 'object': {
          if (opts.detectRecord && isDynamicKeyObject(shape)) {
            const merged = mergeAllFieldShapes(shape);
            return `Record<string, ${typeOf(merged, ctxName + 'Value')}>`;
          }
          return emitObject(shape, ctxName);
        }
        default:
          return 'unknown';
      }
    }

    function emitObject(shape, suggestedName) {
      const sig = signatureOf(shape);
      if (opts.dedupe && registry.has(sig)) return registry.get(sig);

      if (shape.fields.size === 0) {
        return opts.detectRecord ? 'Record<string, unknown>' : '{}';
      }

      const name = allocateName((opts.prefix || '') + toPascalCase(suggestedName) + (opts.suffix || ''));
      if (opts.dedupe) registry.set(sig, name);
      const idx = blocks.length;
      blocks.push('');

      let keys = [...shape.fields.keys()];
      if (opts.sortProps) keys = keys.slice().sort((a, b) => a.localeCompare(b));

      const lines = keys.map((k) => {
        const f = shape.fields.get(k);
        let required = f.required;
        if (opts.optionalMode === 'all') required = false;
        if (opts.optionalMode === 'none') required = true;

        const nullable = !!f.shape.nullable;
        let typeText = typeOf(f.shape, k);
        if (nullable && opts.nullMode === 'union') typeText += ' | null';
        if (nullable && opts.nullMode === 'optional') required = false;
        if (nullable && opts.nullMode === 'both') { typeText += ' | null'; required = false; }

        const propKey = formatPropKey(k);
        const optMark = required ? '' : '?';
        const bangMark = opts.declKind === 'class' && required ? '!' : '';
        const readonlyMark = opts.readonly ? 'readonly ' : '';
        const jsdocLine = opts.jsdoc ? (() => {
          const fmt = detectFormat(f.shape);
          return fmt ? `${indentStr}/** @format ${fmt} */\n` : '';
        })() : '';
        const declText = `${readonlyMark}${propKey}${optMark}${bangMark}: ${typeText}${semi}`;
        return `${jsdocLine}${indentStr}${declText}`;
      });

      const body = lines.join('\n');
      let block;
      if (opts.declKind === 'type') {
        block = `${exportKw}type ${name} = {\n${body}\n}${semi}`;
      } else if (opts.declKind === 'class') {
        block = `${exportKw}class ${name} {\n${body}\n}`;
      } else {
        block = `${exportKw}interface ${name} {\n${body}\n}`;
      }
      blocks[idx] = block;
      return name;
    }

    const rootShape = inferShape(rootValue);
    const rootBaseName = sanitizeTypeName((opts.prefix || '') + toPascalCase(opts.rootName || 'Root') + (opts.suffix || '')) || 'Root';

    const rootIsDynamicRecord = rootShape.kind === 'object' && opts.detectRecord && isDynamicKeyObject(rootShape);

    let rootName;
    if (rootShape.kind === 'object' && !rootIsDynamicRecord) {
      rootName = emitObject(rootShape, opts.rootName || 'Root');
    } else {
      rootName = allocateName(rootBaseName);
      const typeText = typeOf(rootShape, opts.rootName || 'Root');
      const isDefault = opts.exportStyle === 'export-default';
      blocks.push(`${isDefault ? 'export default ' : exportKw}type ${rootName} = ${typeText}${semi}`);
    }

    if (opts.exportStyle === 'export-default' && rootShape.kind === 'object' && !rootIsDynamicRecord) {
      warnings.push('Export default only applies to a type alias for non-object roots; the root interface/class/type is still named export.');
    }

    const header = opts.header
      ? '/* Generated by ToolAdda — JSON to TypeScript Generator (tooladda.online) */\n\n'
      : '';
    const code = header + blocks.join('\n\n') + (blocks.length ? '\n' : '');

    return {
      code,
      rootName,
      interfaceCount: blocks.length,
      warnings,
    };
  }

  // ---------- lightweight syntax highlighter for the output preview ----------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightTs(code) {
    const KEYWORDS = new Set(['export', 'default', 'interface', 'type', 'class', 'enum', 'readonly', 'extends', 'implements', 'import', 'from', 'as']);
    const TYPES = new Set(['string', 'number', 'boolean', 'null', 'undefined', 'unknown', 'any', 'never', 'void', 'Record', 'Array', 'Partial', 'Pick', 'Omit', 'Required', 'Readonly']);
    // Single-pass tokenizer: scans the escaped source exactly once so later
    // matches never re-scan (and corrupt) HTML markup emitted by earlier ones.
    const TOKEN_RE = /(\/\*[\s\S]*?\*\/|\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|\b([A-Za-z_$][A-Za-z0-9_$]*)\b/gm;
    return escapeHtml(code).replace(TOKEN_RE, (match, comment, string, word) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (string) return `<span class="tok-string">${string}</span>`;
      if (word) {
        if (KEYWORDS.has(word)) return `<span class="tok-keyword">${word}</span>`;
        if (TYPES.has(word)) return `<span class="tok-type">${word}</span>`;
        if (/^[A-Z]/.test(word)) return `<span class="tok-typename">${word}</span>`;
        return word;
      }
      return match;
    });
  }

  global.JSONToTSEngine = {
    parseJsonText,
    computeRawStats,
    generate,
    highlightTs,
    escapeHtml,
    toPascalCase,
  };
})(window);
