/* ToolAdda — XML to JSON Converter Pro engine.
   Pure conversion logic (no DOM globals beyond a parsed Document/Element tree)
   lives in XMLJSONEngine so it can be unit-tested with synthetic node trees.
   Runs entirely client-side; nothing is uploaded anywhere. */
(function (global) {
  'use strict';

  const ELEMENT_NODE = 1;
  const TEXT_NODE = 3;
  const CDATA_NODE = 4;

  // ---------- value coercion ----------

  function coerce(text, enabled) {
    const t = String(text == null ? '' : text).trim();
    if (!enabled) return t;
    if (t === '') return '';
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
    return t;
  }

  function splitName(name) {
    const idx = name.indexOf(':');
    if (idx === -1) return { prefix: '', local: name };
    return { prefix: name.slice(0, idx), local: name.slice(idx + 1) };
  }

  function resolveName(name, nsMode) {
    if (nsMode === 'strip-prefix') return splitName(name).local;
    return name; // 'keep' and 'drop-xmlns-only' both keep the raw (possibly prefixed) name
  }

  function isNamespaceDeclAttr(attrName) {
    return attrName === 'xmlns' || attrName.indexOf('xmlns:') === 0;
  }

  function addChild(parent, key, value, forceArray) {
    if (Object.prototype.hasOwnProperty.call(parent, key)) {
      if (Array.isArray(parent[key])) {
        parent[key].push(value);
      } else {
        parent[key] = [parent[key], value];
      }
    } else {
      parent[key] = forceArray ? [value] : value;
    }
  }

  function iterAttributes(el) {
    const list = [];
    const attrs = el.attributes;
    if (!attrs) return list;
    const len = attrs.length;
    for (let i = 0; i < len; i += 1) list.push(attrs[i]);
    return list;
  }

  function iterChildNodes(el) {
    const list = [];
    const kids = el.childNodes;
    if (!kids) return list;
    const len = kids.length;
    for (let i = 0; i < len; i += 1) list.push(kids[i]);
    return list;
  }

  /**
   * Converts one element (and its subtree) into a compact JS value.
   * This is the "default" shape: objects keyed by tag name, repeated
   * tags collapse into arrays, attributes get an @-prefix (configurable).
   */
  function elementToCompactValue(el, depth, opts, stats) {
    stats.elements += 1;
    if (depth > stats.depth) stats.depth = depth;

    const obj = {};

    if (opts.attrMode !== 'ignore') {
      iterAttributes(el).forEach((attr) => {
        if (opts.nsMode !== 'keep' && isNamespaceDeclAttr(attr.name)) return;
        stats.attributes += 1;
        const name = resolveName(attr.name, opts.nsMode);
        const key = (opts.attrMode === 'prefix' ? '@' : '') + name;
        obj[key] = coerce(attr.value, opts.coerceTypes);
      });
    }

    let hasChildElements = false;
    let textContent = '';

    iterChildNodes(el).forEach((node) => {
      if (node.nodeType === ELEMENT_NODE) {
        hasChildElements = true;
        const key = resolveName(node.nodeName, opts.nsMode);
        const value = elementToCompactValue(node, depth + 1, opts, stats);
        addChild(obj, key, value, opts.arrayMode === 'force');
      } else if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
        textContent += node.nodeValue || '';
      }
    });

    const trimmedText = textContent.trim();
    const hasAttrsOrChildren = Object.keys(obj).length > 0;

    if (!hasChildElements && !hasAttrsOrChildren) {
      return trimmedText === '' ? '' : coerce(trimmedText, opts.coerceTypes);
    }
    if (trimmedText !== '') {
      obj['#text'] = coerce(trimmedText, opts.coerceTypes);
    }
    return obj;
  }

  /**
   * Converts one element into an order-preserving node: { attributes, elements: [...] }
   * where `elements` is an ordered array of { name, type: 'element'|'text', value }.
   * Guarantees exact document order even when distinct tags are interleaved,
   * which the compact object shape cannot represent.
   */
  function elementToOrderedValue(el, depth, opts, stats) {
    stats.elements += 1;
    if (depth > stats.depth) stats.depth = depth;

    const node = {};

    if (opts.attrMode !== 'ignore') {
      const attributes = {};
      let any = false;
      iterAttributes(el).forEach((attr) => {
        if (opts.nsMode !== 'keep' && isNamespaceDeclAttr(attr.name)) return;
        stats.attributes += 1;
        any = true;
        const name = resolveName(attr.name, opts.nsMode);
        const key = (opts.attrMode === 'prefix' ? '@' : '') + name;
        attributes[key] = coerce(attr.value, opts.coerceTypes);
      });
      if (any) node.attributes = attributes;
    }

    const elements = [];
    iterChildNodes(el).forEach((child) => {
      if (child.nodeType === ELEMENT_NODE) {
        elements.push({
          type: 'element',
          name: resolveName(child.nodeName, opts.nsMode),
          value: elementToOrderedValue(child, depth + 1, opts, stats),
        });
      } else if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) {
        const text = (child.nodeValue || '').trim();
        if (text !== '') elements.push({ type: 'text', text: coerce(text, opts.coerceTypes) });
      }
    });
    if (elements.length) node.elements = elements;
    return node;
  }

  // ---------- post-processing ----------

  function isEmptyValue(v) {
    if (v === '' || v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }

  function removeEmptyDeep(value) {
    if (Array.isArray(value)) {
      const cleaned = value.map(removeEmptyDeep).filter((v) => !isEmptyValue(v));
      return cleaned;
    }
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach((key) => {
        const cleaned = removeEmptyDeep(value[key]);
        if (!isEmptyValue(cleaned)) out[key] = cleaned;
      });
      return out;
    }
    return value;
  }

  // ---------- XML well-formedness parsing ----------

  function extractLineCol(message) {
    const m = /line[:\s]*(\d+)[,\s]+column[:\s]*(\d+)/i.exec(message) || /(\d+):(\d+)/.exec(message);
    if (!m) return { line: null, column: null };
    return { line: Number(m[1]), column: Number(m[2]) };
  }

  function parseXmlDocument(xmlText, DOMParserImpl) {
    const src = String(xmlText == null ? '' : xmlText).trim();
    if (!src) {
      const err = new Error('Paste, upload, or import XML data first.');
      err.code = 'EMPTY';
      throw err;
    }
    const parser = new DOMParserImpl();
    const doc = parser.parseFromString(src, 'application/xml');
    const parseError = doc.getElementsByTagName('parsererror')[0];
    if (parseError) {
      const detail = (parseError.textContent || '').replace(/\s+/g, ' ').trim();
      const { line, column } = extractLineCol(detail);
      const err = new Error(detail || 'The XML is not well-formed.');
      err.code = 'PARSE_ERROR';
      err.line = line;
      err.column = column;
      throw err;
    }
    const root = doc.documentElement;
    if (!root) {
      const err = new Error('No root element found in this XML document.');
      err.code = 'NO_ROOT';
      throw err;
    }
    return { doc, root };
  }

  // ---------- public conversion entry point ----------

  function defaultOptions(overrides) {
    return Object.assign(
      {
        attrMode: 'prefix', // 'prefix' | 'plain' | 'ignore'
        nsMode: 'keep', // 'keep' | 'strip-prefix' | 'drop-xmlns-only'
        arrayMode: 'smart', // 'smart' | 'force'
        preserveOrder: false,
        removeEmpty: false,
        unwrapRoot: false,
        coerceTypes: true,
        indent: 2, // 2 | 4 | '\t'
        minify: false,
      },
      overrides || {}
    );
  }

  function convert(xmlText, rawOptions, DOMParserImpl) {
    const opts = defaultOptions(rawOptions);
    const stats = { elements: 0, attributes: 0, depth: 0 };
    const { root } = parseXmlDocument(xmlText, DOMParserImpl);

    const rootName = resolveName(root.nodeName, opts.nsMode);
    const rootValue = opts.preserveOrder
      ? elementToOrderedValue(root, 1, opts, stats)
      : elementToCompactValue(root, 1, opts, stats);

    let data = opts.unwrapRoot ? rootValue : { [rootName]: rootValue };
    if (opts.removeEmpty) data = removeEmptyDeep(data);

    const indent = opts.minify ? 0 : opts.indent === 'tab' ? '\t' : Number(opts.indent) || 2;
    const jsonText = opts.minify ? JSON.stringify(data) : JSON.stringify(data, null, indent);

    return {
      data,
      jsonText,
      stats: {
        elements: stats.elements,
        attributes: stats.attributes,
        depth: stats.depth,
        rootName,
        inputChars: xmlText.length,
        outputChars: jsonText.length,
      },
    };
  }

  // ---------- JSON Schema (draft-07) inference ----------

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return typeof v; // 'string' | 'boolean' | 'object'
  }

  function mergeTypeSets(a, b) {
    const set = new Set([].concat(a, b));
    if (set.has('integer') && set.has('number')) set.delete('integer');
    return Array.from(set);
  }

  function inferSchema(value) {
    const t = typeOf(value);
    if (t === 'array') {
      if (!value.length) return { type: 'array', items: {} };
      const itemSchemas = value.map(inferSchema);
      const merged = itemSchemas.reduce((acc, s) => mergeSchemaPair(acc, s));
      return { type: 'array', items: merged };
    }
    if (t === 'object') {
      const properties = {};
      const required = [];
      Object.keys(value).forEach((key) => {
        properties[key] = inferSchema(value[key]);
        required.push(key);
      });
      return { type: 'object', properties, required };
    }
    return { type: t };
  }

  function mergeSchemaPair(a, b) {
    const aType = Array.isArray(a.type) ? a.type : [a.type];
    const bType = Array.isArray(b.type) ? b.type : [b.type];
    const types = mergeTypeSets(aType, bType);
    if (types.length === 1 && types[0] === 'object') {
      const properties = Object.assign({}, a.properties, b.properties);
      const required = (a.required || []).filter((k) => (b.required || []).includes(k));
      return { type: 'object', properties, required };
    }
    if (types.length === 1 && types[0] === 'array') {
      const items = a.items && b.items ? mergeSchemaPair(a.items, b.items) : a.items || b.items || {};
      return { type: 'array', items };
    }
    return { type: types.length === 1 ? types[0] : types };
  }

  function generateSchema(data, title) {
    return Object.assign(
      { $schema: 'http://json-schema.org/draft-07/schema#', title: title || 'Generated from XML' },
      inferSchema(data)
    );
  }

  // ---------- encoding sniffing (for file uploads) ----------

  function sniffEncoding(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { encoding: 'utf-8', bomLength: 3 };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { encoding: 'utf-16le', bomLength: 2 };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { encoding: 'utf-16be', bomLength: 2 };
    }
    // Peek at the XML declaration for an explicit encoding= attribute.
    const asciiPeek = Array.from(bytes.slice(0, 200))
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' '))
      .join('');
    const m = /encoding\s*=\s*["']([\w-]+)["']/i.exec(asciiPeek);
    if (m) return { encoding: m[1].toLowerCase(), bomLength: 0 };
    return { encoding: 'utf-8', bomLength: 0 };
  }

  // ---------- misc formatting helpers ----------

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  global.XMLJSONEngine = {
    coerce,
    splitName,
    resolveName,
    isNamespaceDeclAttr,
    addChild,
    elementToCompactValue,
    elementToOrderedValue,
    removeEmptyDeep,
    isEmptyValue,
    parseXmlDocument,
    defaultOptions,
    convert,
    generateSchema,
    inferSchema,
    sniffEncoding,
    formatBytes,
  };
})(typeof self !== 'undefined' ? self : this);
