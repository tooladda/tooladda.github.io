/* ToolAdda — Character Counter & Writing Statistics UI wiring.
   Depends on window.CharacterCounterEngine (assets/js/character-counter.js).
   Everything runs client-side; nothing is uploaded to any server. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-cc-page')) return;
  const Engine = window.CharacterCounterEngine;
  if (!Engine) return;

  const $ = (id) => document.getElementById(id);
  const AUTOSAVE_KEY = 'tooladda:cc:autosave';
  const GOAL_KEY = 'tooladda:cc:goal';
  const STREAK_KEY = 'tooladda:cc:streak';
  const AUTOSAVE_DEBOUNCE = 900;

  const SAMPLE_TEXT = `ToolAdda is a free, privacy-first suite of browser tools built for developers, students, and writers who want things done quickly and without friction. Every tool runs entirely on your device — nothing you paste or upload is ever sent to a server.

This Character Counter goes far beyond a simple count. It measures readability with six different formulas, checks your text against twenty social media and SEO character limits, surfaces your most-repeated keywords, and estimates how long your writing will take to read or speak aloud.

Try replacing this paragraph with your own blog post, product description, tweet draft, or college essay. Watch the statistics below update instantly as you type. Was this page helpful? Tag us @toolAdda and use #writingtools when you share it!`;

  const els = {
    input: $('ccTextInput'),
    dropZone: $('ccDropZone'),
    fileInput: $('ccFileInput'),
    sampleBtn: $('ccSampleBtn'),
    clearBtn: $('ccClearBtn'),
    undoBtn: $('ccUndoBtn'),
    redoBtn: $('ccRedoBtn'),
    wrapBtn: $('ccWrapBtn'),
    spellcheckBtn: $('ccSpellcheckBtn'),
    focusBtn: $('ccFocusBtn'),

    charMeta: $('ccCharMeta'),
    autosaveNotice: $('ccAutosaveNotice'),
    restoreBtn: $('ccRestoreBtn'),
    discardBtn: $('ccDiscardBtn'),

    goalInput: $('ccGoalInput'),
    goalBar: $('ccGoalBar'),
    goalText: $('ccGoalText'),
    goalBadge: $('ccGoalBadge'),
    streakBadge: $('ccStreakBadge'),
    sessionTimer: $('ccSessionTimer'),

    copyTextBtn: $('ccCopyTextBtn'),
    copyStatsBtn: $('ccCopyStatsBtn'),
    downloadTxtBtn: $('ccDownloadTxtBtn'),
    downloadPdfBtn: $('ccDownloadPdfBtn'),
    printBtn: $('ccPrintBtn'),
    shareBtn: $('ccShareBtn'),

    scoreValue: $('ccScoreValue'),
    scoreLabel: $('ccScoreLabel'),
    readingLevelBadge: $('ccReadingLevelBadge'),

    topWordsList: $('ccTopWordsList'),
    topPhrasesList: $('ccTopPhrasesList'),
    duplicateWordsList: $('ccDuplicateWordsList'),
    longestSentence: $('ccLongestSentence'),
    shortestSentence: $('ccShortestSentence'),

    socialGrid: $('ccSocialGrid'),

    seoTitleInput: $('ccSeoTitleInput'),
    seoTitleCount: $('ccSeoTitleCount'),
    seoTitleBar: $('ccSeoTitleBar'),
    seoDescInput: $('ccSeoDescInput'),
    seoDescCount: $('ccSeoDescCount'),
    seoDescBar: $('ccSeoDescBar'),
    serpTitle: $('ccSerpTitle'),
    serpUrl: $('ccSerpUrl'),
    serpDesc: $('ccSerpDesc'),

    toast: $('ccToast'),
    stickyWords: $('ccStickyWords'),
  };

  if (!els.input) return;

  let debounceTimer = null;
  let autosaveTimer = null;
  let sessionStart = null;
  let sessionInterval = null;
  let lastAnalysis = null;

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------

  let toastTimer = null;
  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    els.toast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.classList.remove('is-visible'); }, 2200);
  }

  // ---------------------------------------------------------------------
  // Number formatting + animated count-up
  // ---------------------------------------------------------------------

  function formatNumber(n) {
    return new Intl.NumberFormat('en-US').format(Math.round(n));
  }

  const animState = new WeakMap();
  function setStatValue(el, value) {
    const isNumeric = typeof value === 'number' && Number.isFinite(value);
    if (!isNumeric) {
      el.textContent = value == null || value === '' ? '—' : String(value);
      animState.delete(el);
      return;
    }
    const prev = animState.get(el);
    const from = typeof prev === 'number' ? prev : 0;
    const to = value;
    animState.set(el, to);
    if (Math.abs(to - from) < 1 || !el.isConnected) { el.textContent = formatNumber(to); return; }
    const duration = 300;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) * (1 - t);
      el.textContent = formatNumber(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function decimals(n, d) {
    if (n === null || n === undefined || Number.isNaN(n)) return null;
    return Math.round(n * 10 ** d) / 10 ** d;
  }

  // ---------------------------------------------------------------------
  // Build the flat display-value map consumed by [data-cc-stat] elements
  // ---------------------------------------------------------------------

  function buildDisplayValues(a) {
    const s = a.stats;
    const r = a.readability;
    return {
      charCount: s.charCount,
      charCountNoSpace: s.charCountNoSpace,
      wordCount: s.wordCount,
      uniqueWordCount: s.uniqueWordCount,
      sentenceCount: s.sentenceCount,
      paragraphCount: s.paragraphCount,
      lineCount: s.lineCount,
      readingTime: Engine.formatDuration(a.time.readingMinutes),
      speakingTime: Engine.formatDuration(a.time.speakingMinutes),
      avgWordLength: decimals(s.avgWordLength, 1) ?? 0,
      avgSentenceLength: decimals(s.avgSentenceLength, 1) ?? 0,
      longestWord: s.longestWord || '—',
      shortestWord: s.shortestWord || '—',

      letters: a.chars.letters,
      numbers: a.chars.digits,
      uppercase: a.chars.upper,
      lowercase: a.chars.lower,
      whitespace: a.chars.whitespace,
      punctuation: a.chars.punctuation,
      specialChars: a.chars.specialCharCount,
      emoji: a.chars.emojiCount,
      urls: a.urls,
      emails: a.emails,
      hashtags: a.hashtags,
      mentions: a.mentions,

      estTweets: a.estimates.tweets,
      estSms: a.estimates.smsMessages,
      estReadingPages: a.estimates.readingPages,
      estBookPages: a.estimates.bookPages,

      fleschScore: decimals(r.fleschReadingEase, 1) ?? 'N/A',
      fleschGrade: decimals(r.fleschKincaidGrade, 1) ?? 'N/A',
      gunningFog: decimals(r.gunningFog, 1) ?? 'N/A',
      smog: decimals(r.smog, 1) ?? 'N/A',
      colemanLiau: decimals(r.colemanLiau, 1) ?? 'N/A',
      ari: decimals(r.ari, 1) ?? 'N/A',
      daleChall: decimals(r.daleChall, 1) ?? 'N/A',
      readingLevel: r.readingLevel,
      passivePct: `${decimals(a.passive.percentage, 1) ?? 0}%`,
      vocabRichness: `${decimals(a.vocabRichness, 1) ?? 0}%`,
      stopWordPct: `${decimals(a.keywords.stopWordPercentage, 1) ?? 0}%`,
      complexWords: r.complexWordCount || 0,
      contentScore: a.contentScore.score,
    };
  }

  function renderStats(a) {
    const values = buildDisplayValues(a);
    document.querySelectorAll('[data-cc-stat]').forEach((el) => {
      const key = el.getAttribute('data-cc-stat');
      if (!(key in values)) return;
      setStatValue(el, values[key]);
    });
  }

  // ---------------------------------------------------------------------
  // Lists: top keywords, phrases, duplicates, sentence extremes
  // ---------------------------------------------------------------------

  function renderList(container, items, emptyText, formatter) {
    if (!container) return;
    container.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'cc-empty-row';
      li.textContent = emptyText;
      container.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = formatter(item);
      container.appendChild(li);
    });
  }

  function renderAnalysisLists(a) {
    renderList(els.topWordsList, a.keywords.topWords, 'Add more text to see keyword density.',
      (w) => `<span class="cc-kw-word">${escapeHtml(w.word)}</span><span class="cc-kw-meta">${w.count}× · ${decimals(w.density, 1)}%</span>`);
    renderList(els.topPhrasesList, a.keywords.topBigrams, 'No repeated two-word phrases found.',
      (p) => `<span class="cc-kw-word">${escapeHtml(p.phrase)}</span><span class="cc-kw-meta">${p.count}×</span>`);
    renderList(els.duplicateWordsList, a.duplicateWords, 'No repeated words detected.',
      (d) => `<span class="cc-kw-word">${escapeHtml(d.word)}</span><span class="cc-kw-meta">${d.count}×</span>`);

    if (els.longestSentence) {
      els.longestSentence.textContent = a.sentenceExtremes.longest
        ? `${a.sentenceExtremes.longest} (${a.sentenceExtremes.longestLen} words)` : '—';
    }
    if (els.shortestSentence) {
      els.shortestSentence.textContent = a.sentenceExtremes.shortest
        ? `${a.sentenceExtremes.shortest} (${a.sentenceExtremes.shortestLen} words)` : '—';
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------------------------------------------------------------------
  // Content score + reading level badge
  // ---------------------------------------------------------------------

  function renderScore(a) {
    if (els.scoreValue) setStatValue(els.scoreValue, a.contentScore.score);
    if (els.scoreLabel) {
      const s = a.contentScore.score;
      els.scoreLabel.textContent = s >= 80 ? 'Excellent' : s >= 60 ? 'Good' : s >= 40 ? 'Fair' : s > 0 ? 'Needs work' : 'Add text to score';
    }
    if (els.readingLevelBadge) els.readingLevelBadge.textContent = a.readability.readingLevel;
  }

  // ---------------------------------------------------------------------
  // Social media limit cards (built once, updated in place)
  // ---------------------------------------------------------------------

  function buildSocialCards() {
    if (!els.socialGrid) return;
    els.socialGrid.innerHTML = '';
    Engine.SOCIAL_LIMITS.forEach((platform) => {
      const card = document.createElement('div');
      card.className = 'cc-social-card';
      card.setAttribute('data-platform', platform.id);
      card.innerHTML = `
        <div class="cc-social-head">
          <strong>${escapeHtml(platform.label)}</strong>
          <span class="cc-social-limit">${formatNumber(platform.limit)} max</span>
        </div>
        <div class="cc-social-bar"><div class="cc-social-fill" data-fill></div></div>
        <div class="cc-social-foot">
          <span data-used>0 used</span>
          <span data-remaining>${formatNumber(platform.limit)} left</span>
        </div>`;
      els.socialGrid.appendChild(card);
      // Mobile 300x250 ad (assets/js/inline-ads.js) 8th platform card ke baad.
      // Cards ek hi baar bante hain, to slot bhi ek baar hi judta hai.
      if (els.socialGrid.children.length === 8) {
        const slot = document.createElement('div');
        slot.className = 'ta-inline-ad';
        els.socialGrid.appendChild(slot);
        if (window.TAInlineAd) window.TAInlineAd.fill(slot);
      }
    });
  }

  function renderSocialCards(a) {
    if (!els.socialGrid) return;
    a.social.forEach((platform) => {
      const card = els.socialGrid.querySelector(`[data-platform="${platform.id}"]`);
      if (!card) return;
      const fill = card.querySelector('[data-fill]');
      const used = card.querySelector('[data-used]');
      const remaining = card.querySelector('[data-remaining]');
      fill.style.width = `${Math.min(100, platform.percentage)}%`;
      fill.classList.toggle('is-exceeded', platform.exceeded);
      fill.classList.toggle('is-near', !platform.exceeded && platform.percentage >= 85);
      used.textContent = `${formatNumber(platform.used)} used`;
      remaining.textContent = platform.exceeded
        ? `${formatNumber(Math.abs(platform.remaining))} over limit`
        : `${formatNumber(platform.remaining)} left`;
      card.classList.toggle('is-exceeded', platform.exceeded);
    });
  }

  // ---------------------------------------------------------------------
  // SEO snippet mini-tool (independent of the main textarea)
  // ---------------------------------------------------------------------

  function renderSeoSnippet() {
    if (!els.seoTitleInput) return;
    const title = els.seoTitleInput.value;
    const desc = els.seoDescInput.value;
    els.seoTitleCount.textContent = `${title.length} / 60`;
    els.seoDescCount.textContent = `${desc.length} / 160`;
    els.seoTitleBar.style.width = `${Math.min(100, (title.length / 60) * 100)}%`;
    els.seoTitleBar.classList.toggle('is-exceeded', title.length > 60);
    els.seoDescBar.style.width = `${Math.min(100, (desc.length / 160) * 100)}%`;
    els.seoDescBar.classList.toggle('is-exceeded', desc.length > 160);
    els.serpTitle.textContent = title || 'Your page title appears here';
    els.serpDesc.textContent = desc || 'Your meta description preview appears here so you can check how it reads in Google search results before you publish.';
  }

  // ---------------------------------------------------------------------
  // Writing goal + streak
  // ---------------------------------------------------------------------

  function readGoal() {
    const n = Number(els.goalInput.value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function persistGoal() {
    try { localStorage.setItem(GOAL_KEY, String(readGoal())); } catch (e) { /* ignore */ }
  }

  function restoreGoal() {
    try {
      const saved = localStorage.getItem(GOAL_KEY);
      if (saved) els.goalInput.value = saved;
    } catch (e) { /* ignore */ }
  }

  function renderGoal(wordCount) {
    const goal = readGoal();
    if (!goal) {
      els.goalBar.style.width = '0%';
      els.goalText.textContent = 'Set a target word count to track progress.';
      els.goalBadge.hidden = true;
      return;
    }
    const pct = Math.min(100, (wordCount / goal) * 100);
    els.goalBar.style.width = `${pct}%`;
    els.goalBar.classList.toggle('is-complete', wordCount >= goal);
    els.goalText.textContent = `${formatNumber(wordCount)} / ${formatNumber(goal)} words (${Math.round(pct)}%)`;
    if (wordCount >= goal) {
      els.goalBadge.hidden = false;
      recordGoalMet();
    } else {
      els.goalBadge.hidden = true;
    }
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function recordGoalMet() {
    let data;
    try { data = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null'); } catch (e) { data = null; }
    const today = todayKey();
    if (!data) data = { lastDate: null, streak: 0 };
    if (data.lastDate === today) { renderStreak(data.streak); return; }
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    data.streak = data.lastDate === yesterday ? data.streak + 1 : 1;
    data.lastDate = today;
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    renderStreak(data.streak);
  }

  function renderStreak(streak) {
    if (!els.streakBadge) return;
    if (!streak) { els.streakBadge.hidden = true; return; }
    els.streakBadge.hidden = false;
    els.streakBadge.textContent = `🔥 ${streak} day${streak > 1 ? 's' : ''} streak`;
  }

  function initStreakDisplay() {
    try {
      const data = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null');
      if (data && data.streak) renderStreak(data.streak);
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------
  // Session timer
  // ---------------------------------------------------------------------

  function ensureSessionStarted() {
    if (sessionStart) return;
    sessionStart = Date.now();
    sessionInterval = setInterval(updateSessionTimer, 1000);
  }

  function updateSessionTimer() {
    if (!sessionStart || !els.sessionTimer) return;
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    els.sessionTimer.textContent = `${m}:${s}`;
  }

  // ---------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ text: els.input.value, savedAt: Date.now() }));
      } catch (e) { /* storage unavailable */ }
    }, AUTOSAVE_DEBOUNCE);
  }

  function checkAutosaveOnLoad() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.text || !saved.text.trim() || !els.autosaveNotice) return;
    els.autosaveNotice.hidden = false;
    els.restoreBtn.addEventListener('click', () => {
      els.input.value = saved.text;
      els.autosaveNotice.hidden = true;
      runAnalysis();
      ensureSessionStarted();
      els.input.focus();
    }, { once: true });
    els.discardBtn.addEventListener('click', () => {
      els.autosaveNotice.hidden = true;
      try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
    }, { once: true });
  }

  // ---------------------------------------------------------------------
  // Core analysis pipeline
  // ---------------------------------------------------------------------

  function runAnalysis() {
    const text = els.input.value;
    const a = Engine.analyze(text);
    lastAnalysis = a;
    renderStats(a);
    renderAnalysisLists(a);
    renderScore(a);
    renderSocialCards(a);
    renderGoal(a.stats.wordCount);
    els.charMeta.textContent = `${formatNumber(a.stats.charCount)} character${a.stats.charCount === 1 ? '' : 's'} · ${formatNumber(a.stats.wordCount)} word${a.stats.wordCount === 1 ? '' : 's'}`;
    if (els.stickyWords) els.stickyWords.textContent = `${formatNumber(a.stats.wordCount)} word${a.stats.wordCount === 1 ? '' : 's'}`;
  }

  function scheduleAnalysis() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runAnalysis, 120);
    scheduleAutosave();
    ensureSessionStarted();
  }

  // ---------------------------------------------------------------------
  // Stats-as-text export (for Copy Stats / Download)
  // ---------------------------------------------------------------------

  function statsAsText(a) {
    const r = a.readability;
    return [
      'Character Counter & Writing Statistics — ToolAdda',
      '='.repeat(50),
      `Characters (with spaces): ${a.stats.charCount}`,
      `Characters (without spaces): ${a.stats.charCountNoSpace}`,
      `Words: ${a.stats.wordCount}`,
      `Unique words: ${a.stats.uniqueWordCount}`,
      `Sentences: ${a.stats.sentenceCount}`,
      `Paragraphs: ${a.stats.paragraphCount}`,
      `Lines: ${a.stats.lineCount}`,
      `Reading time: ${Engine.formatDuration(a.time.readingMinutes)}`,
      `Speaking time: ${Engine.formatDuration(a.time.speakingMinutes)}`,
      `Average word length: ${decimals(a.stats.avgWordLength, 1)} characters`,
      `Average sentence length: ${decimals(a.stats.avgSentenceLength, 1)} words`,
      '',
      'Readability',
      '-'.repeat(50),
      `Flesch Reading Ease: ${decimals(r.fleschReadingEase, 1)} (${r.readingLevel})`,
      `Flesch-Kincaid Grade: ${decimals(r.fleschKincaidGrade, 1)}`,
      `Gunning Fog Index: ${decimals(r.gunningFog, 1)}`,
      `SMOG Index: ${decimals(r.smog, 1)}`,
      `Coleman-Liau Index: ${decimals(r.colemanLiau, 1)}`,
      `Automated Readability Index: ${decimals(r.ari, 1)}`,
      `Dale-Chall Score (approx.): ${decimals(r.daleChall, 1)}`,
      `Passive voice: ${decimals(a.passive.percentage, 1)}%`,
      `Vocabulary richness: ${decimals(a.vocabRichness, 1)}%`,
      `Content score: ${a.contentScore.score} / 100`,
    ].join('\n');
  }

  // ---------------------------------------------------------------------
  // PDF export via the vendored pdf-lib
  // ---------------------------------------------------------------------

  async function exportTextAsPdf(text, filename) {
    if (!window.PDFLib) { showToast('PDF export is unavailable right now.'); return; }
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = 11;
    const lineHeight = 15;
    const margin = 54;
    const pageWidth = 612;
    const pageHeight = 792;
    const maxWidth = pageWidth - margin * 2;

    const rawLines = text.replace(/\r\n/g, '\n').split('\n');
    const wrapped = [];
    rawLines.forEach((line) => {
      if (line === '') { wrapped.push(''); return; }
      const words = line.split(' ');
      let current = '';
      words.forEach((word) => {
        const trial = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(trial, fontSize) > maxWidth && current) {
          wrapped.push(current);
          current = word;
        } else {
          current = trial;
        }
      });
      wrapped.push(current);
    });

    let page = doc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;
    wrapped.forEach((line) => {
      if (y < margin) { page = doc.addPage([pageWidth, pageHeight]); y = pageHeight - margin; }
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.15) });
      y -= lineHeight;
    });

    const bytes = await doc.save();
    downloadBlob(filename, bytes, 'application/pdf');
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------
  // File import
  // ---------------------------------------------------------------------

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.input.value = String(reader.result || '');
      runAnalysis();
      scheduleAutosave();
      ensureSessionStarted();
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  function init() {
    restoreGoal();
    initStreakDisplay();
    checkAutosaveOnLoad();
    runAnalysis();
    renderSeoSnippet();
    buildSocialCards();
    renderSocialCards(lastAnalysis);

    els.input.addEventListener('input', scheduleAnalysis);
    els.input.addEventListener('paste', () => setTimeout(scheduleAnalysis, 10));

    els.sampleBtn.addEventListener('click', () => { els.input.value = SAMPLE_TEXT; runAnalysis(); scheduleAutosave(); ensureSessionStarted(); });
    els.clearBtn.addEventListener('click', () => {
      if (!els.input.value || confirm('Clear all text? This cannot be undone.')) {
        els.input.value = '';
        runAnalysis();
        try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
        els.input.focus();
      }
    });
    els.undoBtn.addEventListener('click', () => { els.input.focus(); document.execCommand('undo'); scheduleAnalysis(); });
    els.redoBtn.addEventListener('click', () => { els.input.focus(); document.execCommand('redo'); scheduleAnalysis(); });

    els.wrapBtn.addEventListener('click', () => {
      const noWrap = els.input.classList.toggle('is-nowrap');
      els.wrapBtn.setAttribute('aria-pressed', String(noWrap));
      els.wrapBtn.textContent = noWrap ? '↔️ Wrap: Off' : '↔️ Wrap: On';
    });
    els.spellcheckBtn.addEventListener('click', () => {
      const enabled = els.input.spellcheck === false;
      els.input.spellcheck = enabled;
      els.spellcheckBtn.setAttribute('aria-pressed', String(enabled));
      els.spellcheckBtn.textContent = enabled ? '✓ Spellcheck: On' : '✕ Spellcheck: Off';
    });
    els.focusBtn.addEventListener('click', () => {
      const on = document.body.classList.toggle('cc-focus-mode');
      els.focusBtn.setAttribute('aria-pressed', String(on));
      els.focusBtn.textContent = on ? '⤢ Exit Focus Mode' : '🎯 Focus Mode';
      if (on) els.input.focus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('cc-focus-mode')) els.focusBtn.click();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); els.downloadTxtBtn.click(); }
    });

    els.fileInput.addEventListener('change', (e) => loadFile(e.target.files && e.target.files[0]));
    if (els.dropZone) {
      ['dragover', 'dragenter'].forEach((ev) => els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.add('is-dragover'); }));
      ['dragleave', 'dragend'].forEach((ev) => els.dropZone.addEventListener(ev, () => els.dropZone.classList.remove('is-dragover')));
      els.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        els.dropZone.classList.remove('is-dragover');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) loadFile(file);
      });
    }

    els.copyTextBtn.addEventListener('click', async () => {
      if (!els.input.value) { showToast('Nothing to copy yet.'); return; }
      try { await navigator.clipboard.writeText(els.input.value); showToast('Text copied to clipboard.'); }
      catch (e) { showToast('Could not copy text.'); }
    });
    els.copyStatsBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(statsAsText(lastAnalysis)); showToast('Statistics copied to clipboard.'); }
      catch (e) { showToast('Could not copy statistics.'); }
    });
    els.downloadTxtBtn.addEventListener('click', () => {
      if (!els.input.value) { showToast('Nothing to download yet.'); return; }
      downloadBlob('my-text.txt', els.input.value, 'text/plain');
    });
    els.downloadPdfBtn.addEventListener('click', async () => {
      if (!els.input.value) { showToast('Nothing to download yet.'); return; }
      els.downloadPdfBtn.disabled = true;
      const original = els.downloadPdfBtn.textContent;
      els.downloadPdfBtn.textContent = '⏳ Generating…';
      try { await exportTextAsPdf(els.input.value, 'my-text.pdf'); }
      finally { els.downloadPdfBtn.disabled = false; els.downloadPdfBtn.textContent = original; }
    });
    els.printBtn.addEventListener('click', () => { if (els.input.value) window.print(); else showToast('Nothing to print yet.'); });
    if (els.shareBtn) {
      els.shareBtn.addEventListener('click', async () => {
        if (!els.input.value) { showToast('Nothing to share yet.'); return; }
        if (navigator.share) {
          try { await navigator.share({ title: 'Text from ToolAdda Character Counter', text: els.input.value }); }
          catch (e) { /* user cancelled */ }
        } else {
          try { await navigator.clipboard.writeText(els.input.value); showToast('Sharing not supported here — text copied instead.'); }
          catch (e) { showToast('Sharing is not supported in this browser.'); }
        }
      });
    }

    els.goalInput.addEventListener('input', () => { persistGoal(); renderGoal(lastAnalysis ? lastAnalysis.stats.wordCount : 0); });

    if (els.seoTitleInput) {
      els.seoTitleInput.addEventListener('input', renderSeoSnippet);
      els.seoDescInput.addEventListener('input', renderSeoSnippet);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
