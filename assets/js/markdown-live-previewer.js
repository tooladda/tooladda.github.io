/*!
 * ToolAdda — Markdown Live Previewer
 * -----------------------------------------------------------------------------
 * Split-screen writing environment: Markdown on the left, rendered preview on
 * the right, updated as you type. Rendering is delegated to markdown-engine.js,
 * which escapes raw HTML and vets every URL, so the preview is safe to inject.
 *
 * Nothing leaves the browser. The draft is kept in localStorage only.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.getElementById('mdLab');
  var engine = window.ToolAddaMarkdown;
  if (!root || !engine) { return; }

  var DRAFT_KEY = 'tooladda-md-draft';
  var PREFS_KEY = 'tooladda-md-prefs';
  var RENDER_DELAY = 90;

  var byId = function (id) { return doc.getElementById(id); };

  var el = {
    editor: byId('mdEditor'),
    preview: byId('mdPreview'),
    previewPane: byId('mdPreviewPane'),
    editorPane: byId('mdEditorPane'),
    workspace: byId('mdWorkspace'),
    toolbar: byId('mdToolbar'),
    modes: byId('mdModes'),
    outline: byId('mdOutline'),
    outlineEmpty: byId('mdOutlineEmpty'),
    syncToggle: byId('mdSync'),
    status: byId('mdStatus'),
    live: byId('mdLive'),
    emptyState: byId('mdEmptyState'),
    // stats
    statWords: byId('mdStatWords'),
    statChars: byId('mdStatChars'),
    statRead: byId('mdStatRead'),
    statHeadings: byId('mdStatHeadings'),
    statLinks: byId('mdStatLinks'),
    statImages: byId('mdStatImages'),
    statCode: byId('mdStatCode'),
    statTasks: byId('mdStatTasks'),
    taskMeter: byId('mdTaskMeter'),
    taskFill: byId('mdTaskFill'),
    // actions
    copyMd: byId('mdCopyMarkdown'),
    copyHtml: byId('mdCopyHtml'),
    downloadMd: byId('mdDownloadMd'),
    downloadHtml: byId('mdDownloadHtml'),
    print: byId('mdPrint'),
    importBtn: byId('mdImport'),
    fileInput: byId('mdFile'),
    sample: byId('mdSample'),
    clear: byId('mdClear'),
    fullscreen: byId('mdFullscreen')
  };

  /* =========================================================================
   * Status + announcements
   * ====================================================================== */

  function setStatus(message, tone) {
    if (!el.status) { return; }
    el.status.textContent = message;
    el.status.dataset.tone = tone || 'info';
    el.status.hidden = !message;
  }

  function announce(message) {
    if (!el.live) { return; }
    el.live.textContent = '';
    window.setTimeout(function () { el.live.textContent = message; }, 30);
  }

  function flashButton(button, label) {
    if (!button) { return; }
    if (button.dataset.label === undefined) { button.dataset.label = button.textContent; }
    button.textContent = label;
    button.classList.add('is-done');
    window.clearTimeout(Number(button.dataset.timer || 0));
    button.dataset.timer = String(window.setTimeout(function () {
      button.textContent = button.dataset.label;
      button.classList.remove('is-done');
    }, 1600));
  }

  /* =========================================================================
   * Rendering
   * ====================================================================== */

  var lastResult = { html: '', outline: [], stats: {} };
  var renderTimer = 0;

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderNow, RENDER_DELAY);
  }

  function renderNow() {
    var source = el.editor ? el.editor.value : '';
    var result;
    try {
      result = engine.render(source);
    } catch (err) {
      setStatus('That document could not be rendered. The Markdown source is untouched.', 'error');
      return;
    }
    lastResult = result;

    // Safe by construction: the engine escapes raw HTML and vets every URL.
    el.preview.innerHTML = result.html;
    if (el.emptyState) { el.emptyState.hidden = source.trim() !== ''; }

    renderOutline(result.outline);
    renderStats(result.stats);
    saveDraft(source);
  }

  function renderStats(stats) {
    var set = function (node, value) { if (node) { node.textContent = String(value); } };
    set(el.statWords, stats.words || 0);
    set(el.statChars, stats.characters || 0);
    set(el.statRead, (stats.readingMinutes || 0) + ' min');
    set(el.statHeadings, stats.headings || 0);
    set(el.statLinks, stats.links || 0);
    set(el.statImages, stats.images || 0);
    set(el.statCode, stats.codeBlocks || 0);

    var total = stats.tasksTotal || 0;
    var done = stats.tasksDone || 0;
    set(el.statTasks, total ? done + '/' + total : '0');
    if (el.taskMeter) {
      el.taskMeter.hidden = total === 0;
      el.taskMeter.setAttribute('aria-valuenow', String(total ? Math.round((done / total) * 100) : 0));
    }
    if (el.taskFill) {
      el.taskFill.style.width = (total ? (done / total) * 100 : 0) + '%';
    }
  }

  function renderOutline(outline) {
    if (!el.outline) { return; }
    el.outline.textContent = '';
    if (el.outlineEmpty) { el.outlineEmpty.hidden = outline.length > 0; }

    outline.forEach(function (item) {
      var li = doc.createElement('li');
      var link = doc.createElement('button');
      link.type = 'button';
      link.className = 'mdp-outline__link';
      link.dataset.target = item.id;
      link.style.paddingLeft = (0.2 + (item.level - 1) * 0.7) + 'rem';
      link.dataset.level = String(item.level);
      link.textContent = item.text || '(untitled)';
      li.appendChild(link);
      el.outline.appendChild(li);
    });
  }

  /* =========================================================================
   * Draft persistence
   * ====================================================================== */

  function saveDraft(source) {
    try {
      if (source) { window.localStorage.setItem(DRAFT_KEY, source); }
      else { window.localStorage.removeItem(DRAFT_KEY); }
    } catch (err) { /* private mode or quota — drafting is a convenience */ }
  }

  function loadDraft() {
    try { return window.localStorage.getItem(DRAFT_KEY) || ''; }
    catch (err) { return ''; }
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({
        mode: root.dataset.mode || 'split',
        sync: el.syncToggle ? el.syncToggle.checked : true
      }));
    } catch (err) { /* ignore */ }
  }

  function loadPrefs() {
    try { return JSON.parse(window.localStorage.getItem(PREFS_KEY) || 'null') || {}; }
    catch (err) { return {}; }
  }

  /* =========================================================================
   * View modes + scroll sync
   * ====================================================================== */

  function setMode(mode) {
    root.dataset.mode = mode;
    if (el.modes) {
      Array.prototype.forEach.call(el.modes.querySelectorAll('[data-mode]'), function (button) {
        var active = button.dataset.mode === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }
    savePrefs();
  }

  var syncing = false;

  function mirrorScroll(from, to) {
    if (!el.syncToggle || !el.syncToggle.checked) { return; }
    if (syncing || root.dataset.mode !== 'split') { return; }
    var travel = from.scrollHeight - from.clientHeight;
    if (travel <= 0) { return; }
    syncing = true;
    to.scrollTop = (from.scrollTop / travel) * (to.scrollHeight - to.clientHeight);
    window.requestAnimationFrame(function () { syncing = false; });
  }

  /* =========================================================================
   * Editor helpers (toolbar + shortcuts)
   * ====================================================================== */

  function surround(before, after, placeholder) {
    var area = el.editor;
    var start = area.selectionStart;
    var end = area.selectionEnd;
    var selected = area.value.slice(start, end) || placeholder || '';
    var value = area.value;

    // Toggle off when the selection is already wrapped.
    var hasBefore = value.slice(Math.max(0, start - before.length), start) === before;
    var hasAfter = value.slice(end, end + after.length) === after;
    if (hasBefore && hasAfter) {
      area.value = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
      area.setSelectionRange(start - before.length, start - before.length + selected.length);
    } else {
      area.value = value.slice(0, start) + before + selected + after + value.slice(end);
      area.setSelectionRange(start + before.length, start + before.length + selected.length);
    }
    area.focus();
    scheduleRender();
  }

  function eachSelectedLine(transform) {
    var area = el.editor;
    var value = area.value;
    var start = value.lastIndexOf('\n', area.selectionStart - 1) + 1;
    var end = value.indexOf('\n', area.selectionEnd);
    if (end === -1) { end = value.length; }

    var block = value.slice(start, end).split('\n').map(transform).join('\n');
    area.value = value.slice(0, start) + block + value.slice(end);
    area.setSelectionRange(start, start + block.length);
    area.focus();
    scheduleRender();
  }

  function togglePrefix(prefix) {
    var pattern = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    var area = el.editor;
    var value = area.value;
    var start = value.lastIndexOf('\n', area.selectionStart - 1) + 1;
    var firstLine = value.slice(start, value.indexOf('\n', start) === -1 ? value.length : value.indexOf('\n', start));
    var removing = pattern.test(firstLine);
    eachSelectedLine(function (line) {
      return removing ? line.replace(pattern, '') : prefix + line;
    });
  }

  function insertBlock(text) {
    var area = el.editor;
    var start = area.selectionStart;
    var before = area.value.slice(0, start);
    var lead = before && !/\n\n$/.test(before) ? (/\n$/.test(before) ? '\n' : '\n\n') : '';
    area.value = before + lead + text + area.value.slice(area.selectionEnd);
    var caret = start + lead.length + text.length;
    area.setSelectionRange(caret, caret);
    area.focus();
    scheduleRender();
  }

  var TABLE_SNIPPET = '| Column | Column |\n| --- | --- |\n| Cell | Cell |\n';

  var ACTIONS = {
    bold: function () { surround('**', '**', 'bold text'); },
    italic: function () { surround('_', '_', 'italic text'); },
    strike: function () { surround('~~', '~~', 'struck through'); },
    code: function () { surround('`', '`', 'code'); },
    codeblock: function () { insertBlock('```\ncode block\n```\n'); },
    link: function () { surround('[', '](https://)', 'link text'); },
    image: function () { surround('![', '](https://)', 'alt text'); },
    h1: function () { togglePrefix('# '); },
    h2: function () { togglePrefix('## '); },
    h3: function () { togglePrefix('### '); },
    quote: function () { togglePrefix('> '); },
    ul: function () { togglePrefix('- '); },
    ol: function () { togglePrefix('1. '); },
    task: function () { togglePrefix('- [ ] '); },
    table: function () { insertBlock(TABLE_SNIPPET); },
    hr: function () { insertBlock('---\n'); }
  };

  /* =========================================================================
   * Clipboard, import and export
   * ====================================================================== */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, legacy);
    }
    return Promise.resolve(legacy());

    function legacy() {
      try {
        var area = doc.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        doc.body.appendChild(area);
        area.select();
        var ok = doc.execCommand('copy');
        doc.body.removeChild(area);
        return !!ok;
      } catch (err) { return false; }
    }
  }

  function documentName() {
    var heading = (lastResult.outline && lastResult.outline[0]) ? lastResult.outline[0].text : '';
    var slug = engine.slugify(heading || 'document');
    return slug.slice(0, 60) || 'document';
  }

  function download(filename, contents, mime) {
    try {
      var blob = new Blob([contents], { type: mime });
      var url = URL.createObjectURL(blob);
      var link = doc.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      doc.body.appendChild(link);
      link.click();
      doc.body.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (err) { return false; }
  }

  var EXPORT_CSS = 'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.7;' +
    'max-width:820px;margin:2.5rem auto;padding:0 1.25rem;color:#1f2328;background:#fff}' +
    'h1,h2{border-bottom:1px solid #d8dee4;padding-bottom:.3rem}' +
    'h1,h2,h3,h4{line-height:1.25;margin-top:1.6em}' +
    'code{background:#eff1f3;padding:.15rem .35rem;border-radius:5px;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}' +
    'pre{background:#0d1117;color:#e6edf3;padding:1rem;border-radius:10px;overflow:auto}' +
    'pre code{background:none;color:inherit;padding:0}' +
    'blockquote{margin:1rem 0;padding:.3rem 1rem;border-left:4px solid #d0d7de;color:#59636e}' +
    'table{border-collapse:collapse;width:100%;margin:1rem 0}' +
    'th,td{border:1px solid #d8dee4;padding:.5rem .75rem}th{background:#f6f8fa}' +
    'img{max-width:100%}a{color:#0969da}hr{border:0;border-top:1px solid #d8dee4;margin:1.6rem 0}' +
    '.md-tasklist{list-style:none;padding-left:.4rem}' +
    '.md-alert{border-left:4px solid #0969da;background:#f6f8fa}' +
    '.md-alert__label{font-weight:700;margin:.2rem 0}';

  function standaloneHtml() {
    var title = (lastResult.outline && lastResult.outline[0]) ? lastResult.outline[0].text : 'Markdown document';
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '<title>' + engine.escapeHtml(title) + '</title>\n<style>' + EXPORT_CSS + '</style>\n' +
      '</head>\n<body>\n' + lastResult.html + '\n</body>\n</html>\n';
  }

  function readFile(file) {
    if (!file) { return; }
    if (file.size > 2 * 1024 * 1024) {
      setStatus('That file is larger than 2 MB. Try a smaller Markdown file.', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      el.editor.value = String(reader.result || '');
      renderNow();
      setStatus('Imported ' + file.name + '.', 'success');
      announce('File imported');
    };
    reader.onerror = function () {
      setStatus('That file could not be read.', 'error');
    };
    reader.readAsText(file);
  }

  /* =========================================================================
   * Sample document
   * ====================================================================== */

  var SAMPLE = [
    '# Project Title',
    '',
    'A short description of what this project does and who it is for.',
    '',
    '> [!NOTE]',
    '> This preview renders GitHub-flavored Markdown, including alerts like this one.',
    '',
    '## Installation',
    '',
    '```bash',
    'npm install my-package',
    '```',
    '',
    '## Features',
    '',
    '- **Bold**, _italic_, ~~strikethrough~~ and `inline code`',
    '- [Links](https://tooladda.online) and images',
    '- Nested lists',
    '  - like this one',
    '',
    '## Roadmap',
    '',
    '- [x] Live preview',
    '- [x] Document outline',
    '- [ ] Offline sync',
    '',
    '## Options',
    '',
    '| Option | Type | Default |',
    '| --- | --- | :---: |',
    '| `debug` | boolean | false |',
    '| `retries` | number | 3 |',
    '',
    '---',
    '',
    'Made with the ToolAdda Markdown Live Previewer.'
  ].join('\n');

  /* =========================================================================
   * Wiring
   * ====================================================================== */

  function bind() {
    el.editor.addEventListener('input', scheduleRender);

    // Tab indents instead of leaving the editor.
    el.editor.addEventListener('keydown', function (event) {
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        var area = el.editor;
        var start = area.selectionStart;
        area.value = area.value.slice(0, start) + '  ' + area.value.slice(area.selectionEnd);
        area.setSelectionRange(start + 2, start + 2);
        scheduleRender();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) { return; }
      var key = event.key.toLowerCase();
      var map = { b: 'bold', i: 'italic', k: 'link' };
      if (map[key]) {
        event.preventDefault();
        ACTIONS[map[key]]();
      } else if (key === 'e') {
        event.preventDefault();
        ACTIONS.code();
      }
    });

    if (el.toolbar) {
      el.toolbar.addEventListener('click', function (event) {
        var button = event.target.closest('[data-action]');
        if (!button) { return; }
        var action = ACTIONS[button.dataset.action];
        if (action) { action(); }
      });
    }

    if (el.modes) {
      el.modes.addEventListener('click', function (event) {
        var button = event.target.closest('[data-mode]');
        if (button) { setMode(button.dataset.mode); }
      });
    }

    if (el.syncToggle) {
      el.syncToggle.addEventListener('change', savePrefs);
    }

    el.editor.addEventListener('scroll', function () { mirrorScroll(el.editor, el.previewPane); });
    el.previewPane.addEventListener('scroll', function () { mirrorScroll(el.previewPane, el.editor); });

    if (el.outline) {
      el.outline.addEventListener('click', function (event) {
        var button = event.target.closest('[data-target]');
        if (!button) { return; }
        // Matched by property rather than a selector, so no id needs escaping.
        var headings = el.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
        var heading = null;
        for (var i = 0; i < headings.length; i += 1) {
          if (headings[i].id === button.dataset.target) { heading = headings[i]; break; }
        }
        if (!heading) { return; }
        if (root.dataset.mode === 'write') { setMode('split'); }
        // Offset relative to the scroll container, whatever the offsetParent is.
        el.previewPane.scrollTop += heading.getBoundingClientRect().top -
          el.previewPane.getBoundingClientRect().top - 12;
      });
    }

    // Links inside the preview open in a new tab; never navigate the tool away.
    el.preview.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      if (link && link.getAttribute('href') === '#') { event.preventDefault(); }
    });

    if (el.copyMd) {
      el.copyMd.addEventListener('click', function () {
        copyText(el.editor.value).then(function (ok) {
          flashButton(el.copyMd, ok ? 'Copied ✓' : 'Copy failed');
          announce(ok ? 'Markdown copied' : 'Copy failed');
        });
      });
    }

    if (el.copyHtml) {
      el.copyHtml.addEventListener('click', function () {
        copyText(lastResult.html).then(function (ok) {
          flashButton(el.copyHtml, ok ? 'Copied ✓' : 'Copy failed');
          announce(ok ? 'HTML copied' : 'Copy failed');
        });
      });
    }

    if (el.downloadMd) {
      el.downloadMd.addEventListener('click', function () {
        var ok = download(documentName() + '.md', el.editor.value, 'text/markdown;charset=utf-8');
        setStatus(ok ? 'Markdown file downloaded.' : 'The download could not start.', ok ? 'success' : 'error');
      });
    }

    if (el.downloadHtml) {
      el.downloadHtml.addEventListener('click', function () {
        var ok = download(documentName() + '.html', standaloneHtml(), 'text/html;charset=utf-8');
        setStatus(ok ? 'Standalone HTML file downloaded.' : 'The download could not start.', ok ? 'success' : 'error');
      });
    }

    if (el.print) {
      el.print.addEventListener('click', function () { window.print(); });
    }

    if (el.importBtn && el.fileInput) {
      el.importBtn.addEventListener('click', function () { el.fileInput.click(); });
      el.fileInput.addEventListener('change', function () {
        readFile(el.fileInput.files && el.fileInput.files[0]);
        el.fileInput.value = '';
      });
    }

    // Drag and drop a .md file anywhere on the workspace.
    ['dragenter', 'dragover'].forEach(function (type) {
      el.workspace.addEventListener(type, function (event) {
        event.preventDefault();
        el.workspace.classList.add('is-dropping');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      el.workspace.addEventListener(type, function (event) {
        event.preventDefault();
        if (type === 'drop') { readFile(event.dataTransfer && event.dataTransfer.files[0]); }
        el.workspace.classList.remove('is-dropping');
      });
    });

    if (el.sample) {
      el.sample.addEventListener('click', function () {
        el.editor.value = SAMPLE;
        renderNow();
        setStatus('Sample document loaded.', 'success');
        announce('Sample loaded');
      });
    }

    if (el.clear) {
      el.clear.addEventListener('click', function () {
        el.editor.value = '';
        renderNow();
        el.editor.focus();
        setStatus('Editor cleared.', 'info');
        announce('Editor cleared');
      });
    }

    if (el.fullscreen) {
      el.fullscreen.addEventListener('click', function () {
        if (doc.fullscreenElement) {
          if (doc.exitFullscreen) { doc.exitFullscreen(); }
        } else if (el.workspace.requestFullscreen) {
          el.workspace.requestFullscreen().catch(function () {
            setStatus('Fullscreen was blocked by the browser.', 'error');
          });
        } else {
          setStatus('This browser does not support fullscreen.', 'error');
        }
      });
      doc.addEventListener('fullscreenchange', function () {
        var on = !!doc.fullscreenElement;
        el.workspace.classList.toggle('is-fullscreen', on);
        el.fullscreen.setAttribute('aria-pressed', String(on));
      });
    }
  }

  /* =========================================================================
   * Boot
   * ====================================================================== */

  function init() {
    var prefs = loadPrefs();
    setMode(prefs.mode === 'write' || prefs.mode === 'read' ? prefs.mode : 'split');
    if (el.syncToggle && typeof prefs.sync === 'boolean') { el.syncToggle.checked = prefs.sync; }

    var draft = loadDraft();
    el.editor.value = draft || SAMPLE;
    renderNow();

    if (draft) {
      setStatus('Restored the draft saved in this browser.', 'info');
    }
    bind();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
