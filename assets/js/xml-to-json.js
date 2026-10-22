/* XML to JSON Converter logic (runs fully in-browser via DOMParser) */
(function () {
  'use strict';

  const els = {
    xmlPasteArea: document.getElementById('xmlPasteArea'),
    attrModeSelect: document.getElementById('attrModeSelect'),
    prettyToggle: document.getElementById('prettyToggle'),
    lineWrapToggle: document.getElementById('lineWrapToggle'),
    xmlFileInput: document.getElementById('xmlFileInput'),

    convertBtn: document.getElementById('convertBtn'),
    msgBox: document.getElementById('msgBox'),

    outputPre: document.getElementById('jsonOutputPre'),
    outputHidden: document.getElementById('jsonOutputHidden'),

    copyBtn: document.getElementById('copyJsonBtn'),
    downloadBtn: document.getElementById('downloadJsonBtn'),
    clearBtn: document.getElementById('clearAllBtn'),

    statElements: document.getElementById('statElements'),
    statAttributes: document.getElementById('statAttributes'),
    statDepth: document.getElementById('statDepth'),
    statSize: document.getElementById('statSize'),
  };

  const counters = { elements: 0, attributes: 0, depth: 0 };

  const setMessage = (message, type) => {
    if (!els.msgBox) return;
    const msg = message || '';
    els.msgBox.textContent = msg;
    els.msgBox.classList.toggle('hidden', !msg);
    els.msgBox.classList.remove('error', 'success');
    if (msg) els.msgBox.classList.add(type === 'success' ? 'success' : 'error');
  };

  const attrPrefix = () => {
    const mode = els.attrModeSelect ? els.attrModeSelect.value : 'prefix';
    return mode; // 'prefix' | 'plain' | 'ignore'
  };

  // Coerce simple text values to number/boolean/null where unambiguous.
  const coerce = (text) => {
    const t = text.trim();
    if (t === '') return '';
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    // Numeric, but avoid things like "007" or "1e" or phone numbers with +.
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
    return t;
  };

  const addChild = (parent, key, value) => {
    if (Object.prototype.hasOwnProperty.call(parent, key)) {
      if (Array.isArray(parent[key])) {
        parent[key].push(value);
      } else {
        parent[key] = [parent[key], value];
      }
    } else {
      parent[key] = value;
    }
  };

  // Convert a DOM element to a JS value, tracking stats and depth.
  const elementToValue = (el, depth, mode) => {
    counters.elements += 1;
    if (depth > counters.depth) counters.depth = depth;

    const obj = {};
    let hasChildElements = false;

    // Attributes
    if (mode !== 'ignore' && el.attributes && el.attributes.length) {
      for (let i = 0; i < el.attributes.length; i += 1) {
        const attr = el.attributes[i];
        counters.attributes += 1;
        const key = (mode === 'prefix' ? '@' : '') + attr.name;
        obj[key] = coerce(attr.value);
      }
    }

    // Child nodes
    let textContent = '';
    const children = el.childNodes || [];
    for (let i = 0; i < children.length; i += 1) {
      const node = children[i];
      if (node.nodeType === 1) {
        // Element
        hasChildElements = true;
        addChild(obj, node.nodeName, elementToValue(node, depth + 1, mode));
      } else if (node.nodeType === 3 || node.nodeType === 4) {
        // Text or CDATA
        textContent += node.nodeValue || '';
      }
    }

    const trimmedText = textContent.trim();
    const hasAttrsOrChildren = Object.keys(obj).length > 0;

    if (!hasChildElements && !hasAttrsOrChildren) {
      // Leaf element with only text (or empty)
      return trimmedText === '' ? '' : coerce(trimmedText);
    }

    if (trimmedText !== '') {
      // Mixed content: keep text under a "#text" key alongside attrs/children.
      obj['#text'] = coerce(trimmedText);
    }

    return obj;
  };

  const parseXml = (xmlText) => {
    const src = String(xmlText == null ? '' : xmlText).trim();
    if (!src) throw new Error('Paste or upload XML data first.');

    const parser = new DOMParser();
    const doc = parser.parseFromString(src, 'application/xml');

    // Detect parse errors (browsers insert a <parsererror> element).
    const parseError = doc.getElementsByTagName('parsererror')[0];
    if (parseError) {
      const detail = (parseError.textContent || '').replace(/\s+/g, ' ').trim();
      throw new Error('Invalid XML: ' + (detail || 'please check your syntax.'));
    }

    const root = doc.documentElement;
    if (!root) throw new Error('Invalid XML: no root element found.');

    return root;
  };

  const xmlToJson = (xmlText) => {
    counters.elements = 0;
    counters.attributes = 0;
    counters.depth = 0;

    const mode = attrPrefix();
    const root = parseXml(xmlText);
    const result = { [root.nodeName]: elementToValue(root, 1, mode) };

    const pretty = els.prettyToggle ? !!els.prettyToggle.checked : true;
    const jsonText = JSON.stringify(result, null, pretty ? 2 : 0);

    return {
      jsonText,
      elements: counters.elements,
      attributes: counters.attributes,
      depth: counters.depth,
    };
  };

  const formatBytes = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const renderOutput = (jsonText) => {
    if (!els.outputPre || !els.outputHidden) return;
    els.outputHidden.value = jsonText;
    els.outputPre.textContent = jsonText || '';
    els.outputPre.classList.toggle('wrap-enabled', els.lineWrapToggle ? !!els.lineWrapToggle.checked : false);
  };

  const resetStats = () => {
    if (els.statElements) els.statElements.textContent = '—';
    if (els.statAttributes) els.statAttributes.textContent = '—';
    if (els.statDepth) els.statDepth.textContent = '—';
    if (els.statSize) els.statSize.textContent = '—';
  };

  const convert = () => {
    try {
      setMessage('');
      const { jsonText, elements, attributes, depth } = xmlToJson(els.xmlPasteArea ? els.xmlPasteArea.value : '');
      renderOutput(jsonText);
      if (els.statElements) els.statElements.textContent = String(elements);
      if (els.statAttributes) els.statAttributes.textContent = String(attributes);
      if (els.statDepth) els.statDepth.textContent = String(depth);
      if (els.statSize) els.statSize.textContent = formatBytes(new Blob([jsonText]).size);
      // Let the background scene react to a successful conversion.
      try { window.dispatchEvent(new CustomEvent('xmljson:convert')); } catch (e) { /* ignore */ }
      return jsonText;
    } catch (err) {
      setMessage((err && err.message) || 'Failed to convert XML to JSON.', 'error');
      renderOutput('');
      resetStats();
      return null;
    }
  };

  const clearAll = () => {
    if (els.xmlPasteArea) els.xmlPasteArea.value = '';
    if (els.xmlFileInput) els.xmlFileInput.value = '';
    setMessage('');
    renderOutput('');
    if (els.outputPre) els.outputPre.textContent = 'Paste or upload XML and click Convert to see JSON.';
    if (els.outputHidden) els.outputHidden.value = '';
    resetStats();
  };

  const copyJson = async () => {
    try {
      const txt = (els.outputHidden && els.outputHidden.value) || (els.outputPre && els.outputPre.textContent) || '';
      if (!txt.trim()) {
        setMessage('Nothing to copy yet. Convert XML first.', 'error');
        return;
      }
      await navigator.clipboard.writeText(txt);
      setMessage('Copied JSON to clipboard.', 'success');
      setTimeout(() => setMessage(''), 1800);
    } catch (e) {
      setMessage('Copy failed. Your browser may block clipboard access.', 'error');
    }
  };

  const downloadJson = () => {
    const txt = (els.outputHidden && els.outputHidden.value) || '';
    if (!txt.trim()) {
      setMessage('Nothing to download yet. Convert XML first.', 'error');
      return;
    }
    const blob = new Blob([txt], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xml-to-json.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (els.xmlPasteArea) els.xmlPasteArea.value = String(reader.result || '');
      convert();
    };
    reader.onerror = () => setMessage('Could not read that file.', 'error');
    reader.readAsText(file);
  };

  const setup = () => {
    if (els.convertBtn) els.convertBtn.addEventListener('click', convert);
    if (els.clearBtn) els.clearBtn.addEventListener('click', clearAll);
    if (els.copyBtn) els.copyBtn.addEventListener('click', copyJson);
    if (els.downloadBtn) els.downloadBtn.addEventListener('click', downloadJson);

    if (els.xmlFileInput) {
      els.xmlFileInput.addEventListener('change', (e) => {
        const file = e.target && e.target.files && e.target.files[0];
        handleFile(file);
      });
    }

    if (els.lineWrapToggle && els.outputPre) {
      els.lineWrapToggle.addEventListener('change', () => {
        els.outputPre.classList.toggle('wrap-enabled', !!els.lineWrapToggle.checked);
      });
    }

    // Re-run conversion when options change (only if there is already output/input).
    [els.attrModeSelect, els.prettyToggle].forEach((ctrl) => {
      if (!ctrl) return;
      ctrl.addEventListener('change', () => {
        if (els.xmlPasteArea && els.xmlPasteArea.value.trim()) convert();
      });
    });

    // Debounced live conversion while typing.
    if (els.xmlPasteArea) {
      let t;
      els.xmlPasteArea.addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => {
          if ((e.target.value || '').trim().length < 3) return;
          convert();
        }, 400);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
