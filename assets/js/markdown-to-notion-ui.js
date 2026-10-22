/* ToolAdda — Markdown to Notion Converter UI wiring.
   Depends on window.MarkdownToNotion (assets/js/markdown-to-notion.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-mtn-page')) return;
  const Engine = window.MarkdownToNotion;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const AUTO_CONVERT_LIMIT = 300 * 1024;

  const SAMPLE_MD = [
    '# Project Kickoff Notes',
    '',
    'Welcome to the **Q3 engineering wiki** — this page documents the *rollout plan* for the new API.',
    '',
    '> [!NOTE]',
    '> This document is auto-generated from our Markdown source of truth.',
    '',
    '## Goals',
    '',
    '- Ship the ~~v1~~ **v2** endpoint by Friday',
    '- Migrate docs from Confluence',
    '- [x] Draft the OpenAPI schema',
    '- [ ] Review with the API team',
    '',
    '## Example request',
    '',
    '```json',
    '{ "id": 1, "status": "active" }',
    '```',
    '',
    '| Environment | URL |',
    '| --- | --- |',
    '| Staging | https://staging.example.com |',
    '| Production | https://api.example.com |',
    '',
    '> [!WARNING]',
    '> Rotate the staging API key before demo day.',
    '',
    'Reference: $O(n \\log n)$ for the sort step.',
    '',
    '<details>',
    '<summary>Rollback plan</summary>',
    '',
    'If the deploy fails, revert to the previous tag and notify #eng-oncall.',
    '</details>',
  ].join('\n');

  const els = {
    input: $('mtnMarkdownInput'),
    dropZone: $('mtnDropZone'),
    fileInput: $('mtnFileInput'),
    sampleBtn: $('mtnSampleBtn'),
    clearBtn: $('mtnClearBtn'),

    preview: $('mtnPreview'),
    previewEmpty: $('mtnPreviewEmpty'),

    outputPanel: $('mtnOutputPanel'),
    outputPre: $('mtnOutputPre'),
    outputEmpty: $('mtnOutputEmpty'),
    warnings: $('mtnWarnings'),

    includeIds: $('mtnIncludeIds'),
    minify: $('mtnMinify'),

    statChars: $('mtnStatChars'),
    statBlocks: $('mtnStatBlocks'),
    statWarnings: $('mtnStatWarnings'),
    statOutSize: $('mtnStatOutSize'),
    statTime: $('mtnStatTime'),

    convertBtn: $('mtnConvertBtn'),
    stickyConvertBtn: $('mtnStickyConvertBtn'),
    copyBtn: $('mtnCopyBtn'),
    downloadBtn: $('mtnDownloadBtn'),
    fullscreenBtn: $('mtnFullscreenBtn'),
  };

  if (!els.input || !els.outputPre) return;

  let lastGoodJson = '';
  let debounceTimer = null;

  function readOptions() {
    return {
      includeIds: els.includeIds.checked,
    };
  }

  function updateStats(mdChars, blockCount, warningCount, outSize, elapsedMs) {
    els.statChars.textContent = mdChars.toLocaleString();
    els.statBlocks.textContent = blockCount != null ? String(blockCount) : '—';
    els.statWarnings.textContent = warningCount != null ? String(warningCount) : '—';
    els.statOutSize.textContent = outSize != null ? `${outSize.toLocaleString()} chars` : '—';
    els.statTime.textContent = typeof elapsedMs === 'number' ? `${elapsedMs.toFixed(1)} ms` : '—';
  }

  function renderWarnings(warnings) {
    if (!warnings || !warnings.length) {
      els.warnings.hidden = true;
      els.warnings.innerHTML = '';
      return;
    }
    els.warnings.hidden = false;
    els.warnings.innerHTML = warnings.map((w) => `<li>${Engine.escapeHtml(w)}</li>`).join('');
  }

  function convert() {
    const text = els.input.value;
    const started = performance.now();

    if (!text.trim()) {
      els.preview.innerHTML = '';
      els.previewEmpty.hidden = false;
      els.outputPre.innerHTML = '';
      els.outputEmpty.hidden = false;
      lastGoodJson = '';
      updateStats(0, null, null, null, null);
      renderWarnings(null);
      return;
    }

    const ast = Engine.parseMarkdown(text);
    const { blocks, warnings } = Engine.toNotionBlocks(ast, readOptions());
    const jsonText = JSON.stringify(blocks, null, els.minify.checked ? 0 : 2);
    const elapsed = performance.now() - started;

    els.previewEmpty.hidden = true;
    els.preview.innerHTML = Engine.toHtml(ast);

    els.outputEmpty.hidden = true;
    els.outputPre.innerHTML = Engine.highlightJson(jsonText);
    lastGoodJson = jsonText;

    updateStats(text.length, Engine.countBlocksDeep(blocks), warnings.length, jsonText.length, elapsed);
    renderWarnings(warnings);
  }

  function scheduleConvert() {
    clearTimeout(debounceTimer);
    if (els.input.value.length > AUTO_CONVERT_LIMIT) return;
    debounceTimer = setTimeout(convert, 220);
  }

  // ---------- input events ----------
  els.input.addEventListener('input', scheduleConvert);
  els.includeIds.addEventListener('change', convert);
  els.minify.addEventListener('change', convert);

  els.convertBtn && els.convertBtn.addEventListener('click', convert);
  els.stickyConvertBtn && els.stickyConvertBtn.addEventListener('click', () => {
    convert();
    els.outputPanel && els.outputPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  els.sampleBtn && els.sampleBtn.addEventListener('click', () => {
    els.input.value = SAMPLE_MD;
    convert();
  });

  els.clearBtn && els.clearBtn.addEventListener('click', () => {
    els.input.value = '';
    els.input.focus();
    convert();
  });

  // ---------- file upload + drag & drop ----------
  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.input.value = String(reader.result || '');
      convert();
    };
    reader.readAsText(file);
  }

  els.fileInput && els.fileInput.addEventListener('change', (e) => {
    loadFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  if (els.dropZone) {
    ['dragenter', 'dragover'].forEach((evt) => {
      els.dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropZone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      els.dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropZone.classList.remove('is-dragover');
      });
    });
    els.dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
  }

  // ---------- copy / download / fullscreen ----------
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  els.copyBtn && els.copyBtn.addEventListener('click', async () => {
    if (!lastGoodJson) return;
    const ok = await copyToClipboard(lastGoodJson);
    const original = els.copyBtn.textContent;
    els.copyBtn.textContent = ok ? '✅ Copied!' : '❌ Copy failed';
    setTimeout(() => { els.copyBtn.textContent = original; }, 1600);
  });

  els.downloadBtn && els.downloadBtn.addEventListener('click', () => {
    if (!lastGoodJson) return;
    const blob = new Blob([lastGoodJson], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notion-blocks.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  els.fullscreenBtn && els.fullscreenBtn.addEventListener('click', () => {
    const isFs = document.body.classList.toggle('mtn-output-fullscreen');
    els.fullscreenBtn.setAttribute('aria-pressed', String(isFs));
    els.fullscreenBtn.textContent = isFs ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
    if (isFs) els.outputPre.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('mtn-output-fullscreen')) {
      document.body.classList.remove('mtn-output-fullscreen');
      if (els.fullscreenBtn) {
        els.fullscreenBtn.setAttribute('aria-pressed', 'false');
        els.fullscreenBtn.textContent = '⛶ Fullscreen';
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      convert();
    }
  });

  // ---------- init ----------
  if (!els.input.value.trim()) {
    els.input.value = SAMPLE_MD;
  }
  convert();
})();
