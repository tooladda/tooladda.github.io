/* ==========================================================================
   ToolAdda — LinkedIn Post Previewer (studio UI)

   Wires the composer, the feed preview and the analysis panels to the pure
   state machine in linkedin-post-engine.js.

   Two deliberate choices:

     • The composer is a plain textarea and this file never intercepts
       Ctrl+Z. Writing tools that hijack undo are infuriating, so the
       browser's own text undo stack is left alone, and edits are applied
       through execCommand("insertText") where available so formatting
       actions stay inside that same stack.

     • Every part of the preview is built with createElement and
       textContent. A post is untrusted text and must never become markup.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.LinkedInPostEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-linkedin-post-draft';

  var state = E.defaultState();
  var dom = {};
  var frame = 0;
  var statusTimer = 0;
  var saveTimer = 0;

  /* ======================================================================
     Helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }

  function status(message, tone) {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.dataset.tone = tone || 'info';
    dom.status.hidden = false;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { dom.status.hidden = true; }, 2800);
  }

  function announce(m) { if (dom.live) dom.live.textContent = m; }

  function copyText(value, label) {
    function good() { status(label + ' ✓', 'good'); }
    function bad() { status('Clipboard blocked — select the text and copy manually.', 'bad'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(good, function () { legacyCopy(value) ? good() : bad(); });
    } else { legacyCopy(value) ? good() : bad(); }
  }

  function legacyCopy(value) {
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) { return false; }
  }

  function download(content, filename, mime) {
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      renderPreview();
      renderMetrics();
      renderNotes();
      updateVisibility();
      scheduleSave();
    });
  }

  /** Build the feed card. Everything here is textContent — never innerHTML. */
  function renderPreview() {
    if (!dom.card) return;
    while (dom.card.firstChild) dom.card.removeChild(dom.card.firstChild);

    dom.card.dataset.device = state.device;
    dom.card.dataset.theme = state.theme;
    if (dom.stage) dom.stage.dataset.theme = state.theme;

    /* ---- author row ---- */
    var head = el('div', 'lip-post__head');
    var avatar;
    if (state.author.avatarUrl) {
      avatar = document.createElement('img');
      avatar.className = 'lip-post__avatar';
      avatar.src = state.author.avatarUrl;
      avatar.alt = '';
      avatar.width = 48;
      avatar.height = 48;
    } else {
      avatar = el('div', 'lip-post__avatar lip-post__avatar--initials', E.initials(state.author.name));
      avatar.setAttribute('aria-hidden', 'true');
    }
    head.appendChild(avatar);

    var who = el('div', 'lip-post__who');
    var nameRow = el('div', 'lip-post__namerow');
    nameRow.appendChild(el('span', 'lip-post__name', state.author.name || 'Your name'));
    if (state.author.verified) {
      var badge = el('span', 'lip-post__verified', '✓');
      badge.title = 'Verified';
      nameRow.appendChild(badge);
    }
    who.appendChild(nameRow);
    who.appendChild(el('div', 'lip-post__headline', state.author.headline));
    who.appendChild(el('div', 'lip-post__meta', (state.author.timeLabel || '2h') + ' · 🌐'));
    head.appendChild(who);
    head.appendChild(el('span', 'lip-post__dots', '···'));
    dom.card.appendChild(head);

    /* ---- body, split at the fold ---- */
    var body = el('div', 'lip-post__body');
    var limit = state.fold[state.device];
    var split = E.splitAtFold(state.text, limit, state.foldLines);

    body.appendChild(renderSegments(split.visible));

    if (split.truncated) {
      var more = el('span', 'lip-post__more');
      more.appendChild(el('span', 'lip-post__ellipsis', '…'));
      var btn = el('button', 'lip-post__morebtn', 'see more');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', dom.card.dataset.expanded === 'yes' ? 'true' : 'false');
      btn.addEventListener('click', function () {
        var expanded = dom.card.dataset.expanded === 'yes';
        dom.card.dataset.expanded = expanded ? 'no' : 'yes';
        renderPreview();
      });
      more.appendChild(btn);
      body.appendChild(more);

      if (dom.card.dataset.expanded === 'yes') {
        var rest = el('span', 'lip-post__hidden');
        rest.appendChild(renderSegments(split.hidden));
        body.appendChild(rest);
      }
    }
    dom.card.appendChild(body);

    /* ---- attachment ---- */
    var attachment = renderAttachment();
    if (attachment) dom.card.appendChild(attachment);

    /* ---- social bar ---- */
    if (state.social.show) dom.card.appendChild(renderSocial());
  }

  /** Typed segments -> spans. Links and tags are styled, never made clickable. */
  function renderSegments(text) {
    var wrap = document.createDocumentFragment();
    E.segment(text).forEach(function (seg) {
      if (seg.type === 'text') {
        wrap.appendChild(document.createTextNode(seg.value));
      } else {
        wrap.appendChild(el('span', 'lip-tok lip-tok--' + seg.type, seg.value));
      }
    });
    return wrap;
  }

  function renderAttachment() {
    var a = state.attachment;

    if (state.postType === 'image' || state.postType === 'video') {
      var media = el('div', 'lip-post__media');
      if (a.imageUrl) {
        var img = document.createElement('img');
        img.src = a.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        media.appendChild(img);
      } else {
        media.appendChild(el('div', 'lip-post__placeholder',
          state.postType === 'video' ? 'Video' : 'Image'));
      }
      if (state.postType === 'video') media.appendChild(el('span', 'lip-post__play', '▶'));
      return media;
    }

    if (state.postType === 'carousel') {
      var doc = el('div', 'lip-post__carousel');
      var sheet = el('div', 'lip-post__sheet');
      if (a.imageUrl) {
        var cimg = document.createElement('img');
        cimg.src = a.imageUrl;
        cimg.alt = '';
        sheet.appendChild(cimg);
      } else {
        sheet.appendChild(el('div', 'lip-post__placeholder', 'Document'));
      }
      doc.appendChild(sheet);
      doc.appendChild(el('div', 'lip-post__caption', a.caption));
      return doc;
    }

    if (state.postType === 'link') {
      var card = el('div', 'lip-post__link');
      var thumb = el('div', 'lip-post__linkthumb');
      if (a.imageUrl) {
        var limg = document.createElement('img');
        limg.src = a.imageUrl;
        limg.alt = '';
        thumb.appendChild(limg);
      } else {
        thumb.appendChild(el('div', 'lip-post__placeholder', 'Link preview'));
      }
      card.appendChild(thumb);
      var meta = el('div', 'lip-post__linkmeta');
      meta.appendChild(el('div', 'lip-post__linktitle', a.linkTitle));
      meta.appendChild(el('div', 'lip-post__linkdomain', a.linkDomain));
      card.appendChild(meta);
      return card;
    }

    if (state.postType === 'poll') {
      var poll = el('div', 'lip-post__poll');
      poll.appendChild(el('div', 'lip-post__pollq', a.pollQuestion));
      E.pollOptions(state).forEach(function (option) {
        poll.appendChild(el('div', 'lip-post__polloption', option));
      });
      poll.appendChild(el('div', 'lip-post__pollmeta', 'Select an option to see results'));
      return poll;
    }

    return null;
  }

  function renderSocial() {
    var bar = el('div', 'lip-post__social');
    var counts = el('div', 'lip-post__counts');
    var s = state.social;

    if (s.reactions > 0) {
      counts.appendChild(el('span', 'lip-post__reacts', '👍❤️👏'));
      counts.appendChild(el('span', '', E.formatCount(s.reactions)));
    }
    var right = el('span', 'lip-post__countright');
    var bits = [];
    if (s.comments > 0) bits.push(E.formatCount(s.comments) + ' comment' + (s.comments === 1 ? '' : 's'));
    if (s.reposts > 0) bits.push(E.formatCount(s.reposts) + ' repost' + (s.reposts === 1 ? '' : 's'));
    if (bits.length) right.textContent = bits.join(' · ');
    counts.appendChild(right);
    if (counts.textContent.trim()) bar.appendChild(counts);

    var actions = el('div', 'lip-post__actions');
    [['👍', 'Like'], ['💬', 'Comment'], ['🔁', 'Repost'], ['➤', 'Send']].forEach(function (pair) {
      var b = el('span', 'lip-post__action');
      b.appendChild(el('span', 'lip-post__actionicon', pair[0]));
      b.appendChild(el('span', '', pair[1]));
      actions.appendChild(b);
    });
    bar.appendChild(actions);
    return bar;
  }

  /* ---------------------------------------------------------- metrics */

  function renderMetrics() {
    var a = E.analyze(state);

    setText(dom.mChars, a.characters.toLocaleString());
    setText(dom.mLeft, a.charactersLeft.toLocaleString());
    setText(dom.mHook, a.hookLength);
    setText(dom.mWords, a.words);
    setText(dom.mHashtags, a.hashtagCount);
    setText(dom.mReading, E.readingLabel(a.readingSeconds));
    setText(dom.mLines, a.lines);
    setText(dom.mEmoji, a.emojiCount);

    if (dom.meter) {
      var pct = Math.min(100, (a.characters / E.MAX_POST) * 100);
      dom.meter.style.width = pct + '%';
      dom.meter.parentNode.dataset.level = a.overLimit ? 'over' : (pct > 92 ? 'near' : 'ok');
      dom.meter.parentNode.setAttribute('aria-valuenow', String(a.characters));
    }
    if (dom.charBox) dom.charBox.dataset.level = a.overLimit ? 'over' : 'ok';

    /* mirror the fold inside the composer so the hook is visible while writing */
    if (dom.hookMirror) {
      while (dom.hookMirror.firstChild) dom.hookMirror.removeChild(dom.hookMirror.firstChild);
      var visible = el('span', 'lip-mirror__visible');
      visible.textContent = a.hook;
      dom.hookMirror.appendChild(visible);
      if (a.truncated) {
        dom.hookMirror.appendChild(el('span', 'lip-mirror__fold', ' ⟵ fold '));
        dom.hookMirror.appendChild(el('span', 'lip-mirror__hidden', state.text.slice(a.hookLength)));
      }
    }
  }

  function setText(node, value) { if (node) node.textContent = String(value); }

  function renderNotes() {
    if (!dom.noteList) return;
    while (dom.noteList.firstChild) dom.noteList.removeChild(dom.noteList.firstChild);
    E.notes(state).forEach(function (note) {
      var li = el('li', 'lip-note', note.text);
      li.dataset.level = note.level;
      dom.noteList.appendChild(li);
    });
  }

  function updateVisibility() {
    all('[data-for-type]').forEach(function (node) {
      node.hidden = node.getAttribute('data-for-type').split(/\s+/).indexOf(state.postType) === -1;
    });
    press(dom.deviceButtons, 'device', state.device);
    press(dom.themeButtons, 'theme', state.theme);
    press(dom.typeButtons, 'type', state.postType);
  }

  function press(list, key, value) {
    (list || []).forEach(function (btn) {
      var active = btn.dataset[key] === value;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
  }

  /* ======================================================================
     Controls
     ====================================================================== */

  function getPath(p) { return p.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, state); }
  function setPath(p, v) {
    var parts = p.split('.');
    var last = parts.pop();
    parts.reduce(function (o, k) { return o[k]; }, state)[last] = v;
  }
  function outputFor(input) {
    var wrap = input.closest('.lip-field');
    return wrap ? wrap.querySelector('output') : null;
  }
  function syncOutput(input) {
    var out = outputFor(input);
    if (out) out.textContent = input.value + (input.dataset.suffix || '');
  }

  function bindControls() {
    all('[data-path]').forEach(function (input) {
      var path = input.getAttribute('data-path');
      var isToggle = input.type === 'checkbox';
      var isChoice = isToggle || input.tagName === 'SELECT';

      function apply() {
        var value;
        if (isToggle) value = input.checked;
        else if (input.type === 'range' || input.type === 'number') value = parseFloat(input.value);
        else value = input.value;

        setPath(path, value);
        state = E.normalize(state);
        // Never rewrite the textarea mid-typing: it would move the caret.
        if (path !== 'text') input.value = String(getPath(path));
        syncOutput(input);
        render();
      }

      on(input, isChoice ? 'change' : 'input', apply);
      syncOutput(input);
    });
  }

  function syncControls() {
    all('[data-path]').forEach(function (input) {
      var value = getPath(input.getAttribute('data-path'));
      if (value === undefined) return;
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = String(value);
      syncOutput(input);
    });
  }

  /* ======================================================================
     Unicode formatting toolbar
     ====================================================================== */

  /**
   * Restyle the current selection. Uses execCommand("insertText") when the
   * browser supports it so the change lands in the textarea's native undo
   * stack rather than wiping it.
   */
  function applyStyle(style) {
    var ta = dom.composer;
    if (!ta) return;

    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    if (start === end) {
      status('Select some text first, then pick a style.', 'info');
      return;
    }

    var selected = ta.value.slice(start, end);
    var plain = E.fromUnicodeStyle(selected);
    var replacement = style === 'none' ? plain : E.toUnicodeStyle(plain, style);

    ta.focus();
    ta.setSelectionRange(start, end);

    var inserted = false;
    try {
      inserted = document.execCommand && document.execCommand('insertText', false, replacement);
    } catch (err) { inserted = false; }

    if (!inserted) {
      ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(end);
    }
    ta.setSelectionRange(start, start + replacement.length);

    state.text = E.safeText(ta.value, E.MAX_POST + 500);
    state = E.normalize(state);
    render();
    announce(E.STYLE_LABELS[style] + ' applied to the selection.');
  }

  /* ======================================================================
     Templates & actions
     ====================================================================== */

  function loadTemplate(id) {
    var t = E.TEMPLATES[id];
    if (!t) return;
    state.text = E.safeText(t.text, E.MAX_POST + 500);
    state = E.normalize(state);
    if (dom.composer) dom.composer.value = state.text;
    render();
    status('Loaded: ' + t.label, 'good');
  }

  function clearPost() {
    state.text = '';
    if (dom.composer) dom.composer.value = '';
    state = E.normalize(state);
    render();
    status('Composer cleared.', 'info');
  }

  function resetAll() {
    state = E.defaultState();
    if (dom.composer) dom.composer.value = state.text;
    syncControls();
    render();
    status('Reset to the example post.', 'good');
  }

  /* ======================================================================
     Persistence
     ====================================================================== */

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveDraft(false); }, 700);
  }

  function saveDraft(explicit) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (explicit) status('Draft saved locally ✓', 'good');
      if (dom.saveHint) dom.saveHint.textContent = 'Draft saved locally';
    } catch (err) {
      if (explicit) status('Could not save — browser storage is unavailable.', 'bad');
    }
  }

  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) { return null; }
  }

  function offerRestore() {
    var stored = readStored();
    if (!stored || !dom.restoreBar) return;
    dom.restoreBar.hidden = false;
    on(dom.restoreYes, 'click', function () {
      state = E.normalize(stored);
      if (dom.composer) dom.composer.value = state.text;
      syncControls();
      render();
      dom.restoreBar.hidden = true;
      status('Draft restored ✓', 'good');
    });
    on(dom.restoreNo, 'click', function () {
      dom.restoreBar.hidden = true;
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
      status('Starting fresh.', 'info');
    });
  }

  /* ======================================================================
     Panes
     ====================================================================== */

  function setPane(name) {
    if (!dom.studio) return;
    dom.studio.dataset.pane = name;
    (dom.paneButtons || []).forEach(function (btn) {
      var active = btn.dataset.paneBtn === name;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.studio = $('lipStudio');
    dom.status = $('lipStatus');
    dom.live = $('lipLive');

    dom.composer = $('lipComposer');
    dom.hookMirror = $('lipHookMirror');
    dom.charBox = $('lipCharBox');
    dom.meter = $('lipMeterFill');

    dom.stage = $('lipStage');
    dom.card = $('lipCard');

    dom.mChars = $('lipMChars');
    dom.mLeft = $('lipMLeft');
    dom.mHook = $('lipMHook');
    dom.mWords = $('lipMWords');
    dom.mHashtags = $('lipMHashtags');
    dom.mReading = $('lipMReading');
    dom.mLines = $('lipMLines');
    dom.mEmoji = $('lipMEmoji');
    dom.noteList = $('lipNotes');

    dom.templateList = $('lipTemplates');
    dom.styleButtons = all('[data-style]');

    dom.copyPost = $('lipCopyPost');
    dom.copyHook = $('lipCopyHook');
    dom.downloadTxt = $('lipDownloadTxt');
    dom.clearBtn = $('lipClear');
    dom.resetBtn = $('lipReset');
    dom.saveNow = $('lipSaveNow');
    dom.saveHint = $('lipSaveHint');

    dom.restoreBar = $('lipRestoreBar');
    dom.restoreYes = $('lipRestoreYes');
    dom.restoreNo = $('lipRestoreNo');

    dom.deviceButtons = all('[data-device]');
    dom.themeButtons = all('[data-theme-mode]');
    dom.typeButtons = all('[data-type]');
    dom.paneButtons = all('[data-pane-btn]');
  }

  function buildTemplateButtons() {
    if (!dom.templateList) return;
    E.TEMPLATE_IDS.forEach(function (id) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lip-template';
      btn.dataset.template = id;
      btn.textContent = E.TEMPLATES[id].label;
      btn.addEventListener('click', function () { loadTemplate(id); });
      dom.templateList.appendChild(btn);
    });
  }

  function wireButtons() {
    (dom.deviceButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.device = btn.dataset.device;
        state = E.normalize(state);
        render();
        announce('Previewing the ' + btn.textContent.trim() + '.');
      });
    });

    (dom.themeButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.theme = btn.dataset.themeMode;
        state = E.normalize(state);
        render();
      });
    });

    (dom.typeButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.postType = btn.dataset.type;
        state = E.normalize(state);
        render();
      });
    });

    (dom.styleButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () { applyStyle(btn.dataset.style); });
    });

    (dom.paneButtons || []).forEach(function (btn) {
      btn.addEventListener('click', function () { setPane(btn.dataset.paneBtn); });
      btn.addEventListener('keydown', function (e) {
        if (['ArrowLeft', 'ArrowRight'].indexOf(e.key) === -1) return;
        e.preventDefault();
        var i = dom.paneButtons.indexOf(btn);
        var n = e.key === 'ArrowRight'
          ? (i + 1) % dom.paneButtons.length
          : (i - 1 + dom.paneButtons.length) % dom.paneButtons.length;
        dom.paneButtons[n].focus();
        setPane(dom.paneButtons[n].dataset.paneBtn);
      });
    });

    on(dom.copyPost, 'click', function () { copyText(E.exportText(state), 'Post copied'); });
    on(dom.copyHook, 'click', function () {
      copyText(E.analyze(state).hook, 'Hook copied');
    });
    on(dom.downloadTxt, 'click', function () {
      download(E.exportText(state), 'linkedin-post.txt', 'text/plain');
      status('Post downloaded ✓', 'good');
    });
    on(dom.clearBtn, 'click', clearPost);
    on(dom.resetBtn, 'click', resetAll);
    on(dom.saveNow, 'click', function () { saveDraft(true); });

    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].attributeName === 'data-theme') { render(); return; }
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function initializePreviewer() {
    cacheDom();
    if (!dom.studio) return;

    buildTemplateButtons();
    bindControls();
    wireButtons();
    // On a phone, open on the mobile preview: it is the feed the post will be read in.
    if (window.matchMedia && window.matchMedia('(max-width: 699px)').matches) state.device = 'mobile';
    if (dom.composer) dom.composer.value = state.text;
    syncControls();
    setPane('preview');
    render();
    offerRestore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializePreviewer);
  else initializePreviewer();

  window.LinkedInStudio = {
    getState: function () { return state; },
    setState: function (next) {
      state = E.normalize(next);
      if (dom.composer) dom.composer.value = state.text;
      syncControls();
      render();
    },
    render: render,
    applyStyle: applyStyle,
    loadTemplate: loadTemplate,
    clearPost: clearPost,
    resetAll: resetAll,
    saveDraft: saveDraft,
    STORAGE_KEY: STORAGE_KEY
  };
})();
