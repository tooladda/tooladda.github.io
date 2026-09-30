/* JSON to XML Converter logic (runs fully in-browser) */
(function () {
  'use strict';

  const els = {
    jsonPasteArea: document.getElementById('jsonPasteArea'),
    prettyToggle: document.getElementById('prettyToggle'),
    lineWrapToggle: document.getElementById('lineWrapToggle'),
    jsonFileInput: document.getElementById('jsonFileInput'),

    convertBtn: document.getElementById('convertBtn'),
    msgBox: document.getElementById('msgBox'),

    outputPre: document.getElementById('xmlOutputPre'),
    outputHidden: document.getElementById('xmlOutputHidden'),

    copyBtn: document.getElementById('copyXmlBtn'),
    downloadBtn: document.getElementById('downloadXmlBtn'),
    clearBtn: document.getElementById('clearAllBtn'),

    statNodes: document.getElementById('statNodes'),
    statDepth: document.getElementById('statDepth'),
    statSize: document.getElementById('statSize'),
  };

  const counters = { nodes: 0, depth: 0 };

  const setMessage = (message, type) => {
    if (!els.msgBox) return;
    const msg = message || '';
    els.msgBox.textContent = msg;
    els.msgBox.classList.toggle('hidden', !msg);
    els.msgBox.classList.remove('error', 'success');
    if (msg) els.msgBox.classList.add(type === 'success' ? 'success' : 'error');
  };

  const formatBytes = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const escapeXml = (text) => {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const sanitizeTagName = (tagName) => {
    let name = String(tagName || 'item').trim();
    name = name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_:.-]/g, '_');
    if (!name) name = 'item';
    if (!/^[A-Za-z_]/.test(name)) name = '_' + name;
    return name;
  };

  const createElementXml = (tagName, inner, selfClosing = false) => {
    if (selfClosing) {
      return `<${tagName}/>`;
    }
    return `<${tagName}>${inner}</${tagName}>`;
  };

  const reduceDepth = (depth) => {
    if (depth > counters.depth) counters.depth = depth;
  };

  const buildXml = (value, tagName, depth) => {
    counters.nodes += 1;
    reduceDepth(depth);

    tagName = sanitizeTagName(tagName);

    if (value === null || value === undefined) {
      return createElementXml(tagName, '', true);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return createElementXml(tagName, '', true);
      }
      return value.map((item) => buildXml(item, tagName, depth + 1)).join('');
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return createElementXml(tagName, '', false);
      }
      const inner = keys
        .map((key) => buildXml(value[key], key, depth + 1))
        .join('');
      return createElementXml(tagName, inner, false);
    }

    return createElementXml(tagName, escapeXml(value), false);
  };

  const formatXml = (xml) => {
    // Put one node per line before indenting. Only split where two tags are
    // already adjacent, so whitespace that is part of a text value (e.g. a
    // JSON value of "   ") survives instead of being collapsed away.
    const lines = xml.replace(/></g, '>\n<').split('\n');
    let level = 0;
    return lines
      .map((line) => {
        const text = line.trim();
        if (!text) return '';

        // Classify the line explicitly rather than with one dense pattern:
        // a name-length assumption here previously stopped single-letter
        // tags such as <a> from ever opening a level.
        const isClosing = /^<\/[^>]+>/.test(text);
        const isDeclaration = /^<[?!]/.test(text);
        const isSelfClosing = /\/>$/.test(text);
        const openedAndClosed = /^<([A-Za-z_][\w.:-]*)[^>]*>[\s\S]*<\/\1>$/.test(text);
        const isOpening = /^<[A-Za-z_]/.test(text);

        if (isClosing) level = Math.max(level - 1, 0);
        const formatted = '  '.repeat(level) + text;
        if (isOpening && !isClosing && !isDeclaration && !isSelfClosing && !openedAndClosed) {
          level += 1;
        }
        return formatted;
      })
      .join('\n');
  };

  const parseJson = (jsonText) => {
    const src = String(jsonText == null ? '' : jsonText).trim();
    if (!src) throw new Error('Paste or upload JSON data first.');
    try {
      return JSON.parse(src);
    } catch (error) {
      throw new Error('Invalid JSON: please check your syntax.');
    }
  };

  const jsonToXml = (jsonText) => {
    counters.nodes = 0;
    counters.depth = 0;

    const data = parseJson(jsonText);
    let xmlBody = '';

    if (Array.isArray(data)) {
      const items = data.map((item) => buildXml(item, 'item', 2)).join('');
      xmlBody = `<root>${items}</root>`;
    } else if (typeof data === 'object' && data !== null) {
      const keys = Object.keys(data);
      if (keys.length === 1) {
        xmlBody = buildXml(data[keys[0]], keys[0], 1);
      } else {
        const inner = keys.map((key) => buildXml(data[key], key, 2)).join('');
        xmlBody = `<root>${inner}</root>`;
      }
    } else {
      xmlBody = `<root>${escapeXml(data)}</root>`;
      counters.nodes += 1;
      reduceDepth(1);
    }

    const xmlText = `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody}`;
    const pretty = !!els.prettyToggle?.checked;
    return {
      xmlText: pretty ? formatXml(xmlText) : xmlText,
      nodes: counters.nodes,
      depth: counters.depth,
    };
  };

  const renderOutput = (xmlText) => {
    if (!els.outputPre || !els.outputHidden) return;
    els.outputHidden.value = xmlText;
    els.outputPre.textContent = xmlText || '';
    els.outputPre.classList.toggle('wrap-enabled', !!els.lineWrapToggle?.checked);
  };

  const resetStats = () => {
    if (els.statNodes) els.statNodes.textContent = '—';
    if (els.statDepth) els.statDepth.textContent = '—';
    if (els.statSize) els.statSize.textContent = '—';
  };

  const convert = () => {
    try {
      setMessage('');
      const { xmlText, nodes, depth } = jsonToXml(els.jsonPasteArea ? els.jsonPasteArea.value : '');
      renderOutput(xmlText);
      if (els.statNodes) els.statNodes.textContent = String(nodes);
      if (els.statDepth) els.statDepth.textContent = String(depth);
      if (els.statSize) els.statSize.textContent = formatBytes(new Blob([xmlText]).size);
      try { window.dispatchEvent(new CustomEvent('xmljson:convert')); } catch (e) { /* ignore */ }
      return xmlText;
    } catch (err) {
      setMessage((err && err.message) || 'Failed to convert JSON to XML.', 'error');
      renderOutput('');
      resetStats();
      return null;
    }
  };

  const clearAll = () => {
    if (els.jsonPasteArea) els.jsonPasteArea.value = '';
    if (els.jsonFileInput) els.jsonFileInput.value = '';
    setMessage('');
    renderOutput('');
    if (els.outputPre) els.outputPre.textContent = 'Paste JSON and click Convert to see XML.';
    if (els.outputHidden) els.outputHidden.value = '';
    resetStats();
  };

  const copyXml = async () => {
    try {
      const txt = (els.outputHidden && els.outputHidden.value) || (els.outputPre && els.outputPre.textContent) || '';
      if (!txt.trim()) {
        setMessage('Nothing to copy yet. Convert JSON first.', 'error');
        return;
      }
      await navigator.clipboard.writeText(txt);
      setMessage('Copied XML to clipboard.', 'success');
      setTimeout(() => setMessage(''), 1800);
    } catch (e) {
      setMessage('Copy failed. Your browser may block clipboard access.', 'error');
    }
  };

  const downloadXml = () => {
    const txt = (els.outputHidden && els.outputHidden.value) || '';
    if (!txt.trim()) {
      setMessage('Nothing to download yet. Convert JSON first.', 'error');
      return;
    }
    const blob = new Blob([txt], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'json-to-xml.xml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (els.jsonPasteArea) els.jsonPasteArea.value = String(reader.result || '');
      convert();
    };
    reader.onerror = () => setMessage('Could not read that file.', 'error');
    reader.readAsText(file);
  };

  const setup = () => {
    if (els.convertBtn) els.convertBtn.addEventListener('click', convert);
    if (els.clearBtn) els.clearBtn.addEventListener('click', clearAll);
    if (els.copyBtn) els.copyBtn.addEventListener('click', copyXml);
    if (els.downloadBtn) els.downloadBtn.addEventListener('click', downloadXml);

    if (els.lineWrapToggle && els.outputPre) {
      els.lineWrapToggle.addEventListener('change', () => {
        els.outputPre.classList.toggle('wrap-enabled', !!els.lineWrapToggle.checked);
      });
    }

    if (els.jsonFileInput) {
      els.jsonFileInput.addEventListener('change', (e) => {
        const file = e.target.files ? e.target.files[0] : null;
        if (file) handleFile(file);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
