(function () {
  'use strict';

  // ================= Pure logic (Node-testable, DOM-independent) =================
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function inlineFormat(text) {
    var esc = escapeHtml(text);
    esc = esc.replace(/\(\(([^)]+)\)\)/g, '<span class="tp-note">($1)</span>');
    esc = esc.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    return esc;
  }

  function isMarkerLine(line) {
    var t = line.trim();
    return /^\[[^\]]+\]$/.test(t) || /^#{1,6}\s+/.test(t);
  }
  function markerLabel(line) {
    var t = line.trim();
    var m = /^\[([^\]]+)\]$/.exec(t);
    if (m) return m[1];
    return t.replace(/^#{1,6}\s+/, '');
  }

  function wordCount(text) {
    var t = (text || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function paragraphCount(text) {
    var t = (text || '').replace(/\r\n/g, '\n').trim();
    if (!t) return 0;
    return t.split(/\n\s*\n/).filter(function (b) { return b.trim().length; }).length;
  }

  function buildParagraphsHtml(rawText) {
    var lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
    var html = '';
    var paraIndex = 0;
    var markers = []; // { label, paraIndex }
    var buffer = [];
    function flush() {
      if (buffer.length) {
        html += '<p data-para="' + paraIndex + '">' + buffer.map(inlineFormat).join('<br>') + '</p>';
        paraIndex++;
        buffer = [];
      }
    }
    lines.forEach(function (line) {
      if (!line.trim()) { flush(); return; }
      if (isMarkerLine(line)) {
        flush();
        markers.push({ label: markerLabel(line), paraIndex: paraIndex });
        html += '<p class="tp-marker-line" data-para="' + paraIndex + '"><strong>' + escapeHtml(markerLabel(line)) + '</strong></p>';
        paraIndex++;
        return;
      }
      buffer.push(line);
    });
    flush();
    return { html: html, markers: markers, totalWords: wordCount(rawText), paragraphCount: paragraphCount(rawText) };
  }

  function computePxPerSec(totalContentHeightPx, totalWords, wpm) {
    if (totalWords <= 0 || wpm <= 0) return 0;
    var totalDurationSec = (totalWords / wpm) * 60;
    if (totalDurationSec <= 0) return 0;
    return totalContentHeightPx / totalDurationSec;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  var GUIDE_MODES = ['dim', 'eye', 'both', 'off'];
  var GUIDE_LABELS = { dim: 'Dim', eye: 'Eye-line', both: 'Both', off: 'Off' };
  function guideFlags(mode) {
    return { dimEnabled: mode === 'dim' || mode === 'both', eyeLines: mode === 'eye' || mode === 'both' };
  }

  var SAMPLE_SCRIPT = '[Intro]\nHi, I\'m so glad you\'re here today. In the next few minutes, I\'m going to walk you through *three simple ideas* that changed the way I work.\n\n((pause, smile, look at the lens))\n\n[Idea One]\nThe first idea is this: small, consistent steps beat big, occasional bursts of effort. It sounds obvious, but almost nobody actually plans around it.\n\n[Idea Two]\nThe second idea is about feedback. You cannot improve what you never measure, and you cannot measure what you never write down.\n\n[Closing]\nThat\'s it for today. If this was useful, the next video goes even deeper — I\'ll see you there.';

  // ==== DOM wiring (skipped during Node-based unit testing) ====
  if (typeof window === 'undefined' || !document.getElementById('tpScriptInput')) {
    if (typeof module !== 'undefined') {
      module.exports = {
        buildParagraphsHtml: buildParagraphsHtml, computePxPerSec: computePxPerSec, wordCount: wordCount,
        paragraphCount: paragraphCount, isMarkerLine: isMarkerLine, markerLabel: markerLabel,
        formatTime: formatTime, inlineFormat: inlineFormat, guideFlags: guideFlags, GUIDE_MODES: GUIDE_MODES,
      };
    }
    return;
  }

  var scriptInput = document.getElementById('tpScriptInput');
  var startBtn = document.querySelector('[data-start-btn]');
  var importBtn = document.querySelector('[data-import-btn]');
  var importInput = document.querySelector('[data-import-input]');
  var sampleBtn = document.querySelector('[data-sample-btn]');
  var wpmInput = document.getElementById('tpWpm');
  var fontSizeInput = document.getElementById('tpFontSize');
  var textWidthInput = document.getElementById('tpTextWidth');
  var fontFamilySelect = document.getElementById('tpFontFamily');
  var colorPresetSelect = document.getElementById('tpColorPreset');
  var fontWeightSelect = document.getElementById('tpFontWeight');
  var textAlignSelect = document.getElementById('tpTextAlign');
  var lineHeightInput = document.getElementById('tpLineHeight');
  var letterSpacingInput = document.getElementById('tpLetterSpacing');
  var paraSpacingInput = document.getElementById('tpParaSpacing');
  var countdownSelect = document.getElementById('tpCountdownDuration');
  var readingGuideSelect = document.getElementById('tpReadingGuide');
  var brightnessInput = document.getElementById('tpBrightness');
  var statsLine = document.querySelector('[data-stats-line]');
  var estTimeEl = document.querySelector('[data-est-time]');
  var resumeNote = document.querySelector('[data-resume-note]');
  var scriptNameInput = document.getElementById('tpScriptName');
  var saveScriptBtn = document.querySelector('[data-save-script-btn]');
  var savedList = document.querySelector('[data-saved-list]');
  var openControllerBtn = document.querySelector('[data-open-controller]');
  var advancedToggle = document.querySelector('[data-advanced-toggle]');
  var advancedBody = document.querySelector('[data-advanced-body]');
  var editorViews = Array.from(document.querySelectorAll('[data-tp-editor-view]'));

  var stage = document.getElementById('tpStage');
  var mirrorLayer = document.getElementById('tpMirrorLayer');
  var content = document.getElementById('tpContent');
  var bandTop = document.querySelector('[data-band-top]');
  var bandBottom = document.querySelector('[data-band-bottom]');
  var bandLine = document.querySelector('[data-band-line]');
  var eyeLeft = document.querySelector('[data-eye-left]');
  var eyeRight = document.querySelector('[data-eye-right]');
  var brightnessOverlay = document.querySelector('[data-brightness-overlay]');
  var countdownEl = document.getElementById('tpCountdown');
  var helpPanel = document.getElementById('tpHelp');
  var markersPanel = document.getElementById('tpMarkersPanel');
  var markersListEl = document.querySelector('[data-markers-list]');

  var hudPlayBtn = document.querySelector('[data-hud-play]');
  var hudRestartBtn = document.querySelector('[data-hud-restart]');
  var hudMirrorBtn = document.querySelector('[data-hud-mirror]');
  var hudGuideBtn = document.querySelector('[data-hud-guide]');
  var hudFullscreenBtn = document.querySelector('[data-hud-fullscreen]');
  var hudHelpBtn = document.querySelector('[data-hud-help]');
  var hudMarkersBtn = document.querySelector('[data-hud-markers]');
  var hudExitBtn = document.querySelector('[data-hud-exit]');
  var wpmDisplay = document.getElementById('tpWpmDisplay');
  var remainingDisplay = document.getElementById('tpRemainingDisplay');

  var COLOR_PRESETS = {
    'white-black': { bg: '#000000', fg: '#ffffff' },
    'black-white': { bg: '#ffffff', fg: '#111111' },
    'yellow-black': { bg: '#000000', fg: '#facc15' },
    'amber-black': { bg: '#000000', fg: '#f59e0b' },
    'green-black': { bg: '#000000', fg: '#22c55e' },
    'blue-black': { bg: '#000000', fg: '#38bdf8' },
  };
  var MIRROR_MODES = ['none', 'mirror-h', 'mirror-v', 'mirror-hv'];
  var MIRROR_LABELS = { none: 'Off', 'mirror-h': 'Horizontal', 'mirror-v': 'Vertical', 'mirror-hv': 'Both' };

  var state = {
    markers: [], totalWords: 0, totalContentHeightPx: 0,
    currentOffset: 0, isPlaying: false, mirrorIndex: 0,
    bandPercent: 45, bandHeightPercent: 14, guideMode: 'dim',
    wakeLockSentinel: null, lastFrameTs: null,
  };

  function updateEstimate() {
    var text = scriptInput.value;
    var words = wordCount(text);
    var chars = text.length;
    var paras = paragraphCount(text);
    var wpm = parseInt(wpmInput.value, 10) || 140;
    var sec = words > 0 ? (words / wpm) * 60 : 0;
    if (statsLine) statsLine.textContent = words + ' word' + (words === 1 ? '' : 's') + ' · ' + chars + ' character' + (chars === 1 ? '' : 's') + ' · ' + paras + ' paragraph' + (paras === 1 ? '' : 's') + ' · ' + (words > 0 ? formatTime(sec) + ' read time' : '— read time');
    if (estTimeEl) estTimeEl.textContent = words > 0 ? formatTime(sec) + ' (' + words + ' words)' : '—';
  }
  scriptInput.addEventListener('input', updateEstimate);
  wpmInput.addEventListener('input', updateEstimate);
  updateEstimate();

  importBtn.addEventListener('click', function () { importInput.click(); });
  function loadScriptFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { scriptInput.value = reader.result; updateEstimate(); };
    reader.readAsText(file);
  }
  importInput.addEventListener('change', function (e) {
    loadScriptFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) { scriptInput.addEventListener(ev, function (e) { e.preventDefault(); }); });
  scriptInput.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && /text|plain/.test(file.type || '')) { e.preventDefault(); loadScriptFile(file); }
  });
  if (sampleBtn) {
    sampleBtn.addEventListener('click', function () { scriptInput.value = SAMPLE_SCRIPT; updateEstimate(); });
  }

  if (advancedToggle && advancedBody) {
    advancedToggle.addEventListener('click', function () {
      var open = advancedBody.classList.toggle('is-open');
      advancedToggle.textContent = open ? '⚙️ Advanced settings ▴' : '⚙️ Advanced settings ▾';
    });
  }

  // ---- localStorage saved scripts ----
  var STORAGE_KEY = 'tooladda-teleprompter-scripts';
  var LAST_KEY = 'tooladda-teleprompter-last';
  var RESUME_KEY = 'tooladda-teleprompter-resume';
  function loadSavedScripts() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { return {}; } }
  function saveSavedScripts(obj) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (e) {} }
  function renderSavedList() {
    var scripts = loadSavedScripts();
    savedList.innerHTML = '';
    Object.keys(scripts).forEach(function (name) {
      var li = document.createElement('li');
      li.className = 'tpx-saved-item';
      var span = document.createElement('span');
      span.textContent = name;
      var actions = document.createElement('div');
      var loadBtn = document.createElement('button'); loadBtn.type = 'button'; loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', function () { scriptInput.value = scripts[name]; updateEstimate(); });
      var delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.textContent = '✕'; delBtn.style.color = '#dc2626'; delBtn.style.marginLeft = '0.5rem';
      delBtn.addEventListener('click', function () { var s = loadSavedScripts(); delete s[name]; saveSavedScripts(s); renderSavedList(); });
      actions.appendChild(loadBtn); actions.appendChild(delBtn);
      li.appendChild(span); li.appendChild(actions);
      savedList.appendChild(li);
    });
  }
  saveScriptBtn.addEventListener('click', function () {
    var name = (scriptNameInput.value || '').trim();
    if (!name) { alert('Please enter a name for this script.'); return; }
    var scripts = loadSavedScripts();
    scripts[name] = scriptInput.value;
    saveSavedScripts(scripts);
    renderSavedList();
  });
  renderSavedList();

  try {
    var lastText = localStorage.getItem(LAST_KEY);
    if (lastText) scriptInput.value = lastText;
    updateEstimate();
  } catch (e) {}
  scriptInput.addEventListener('input', function () { try { localStorage.setItem(LAST_KEY, scriptInput.value); } catch (e) {} });

  function getResumeData() {
    try { return JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch (e) { return null; }
  }
  function clearResumeNote() { if (resumeNote) resumeNote.hidden = true; }
  function refreshResumeNote() {
    if (!resumeNote) return;
    var r = getResumeData();
    if (r && r.text === scriptInput.value && r.offset > 40) {
      resumeNote.hidden = false;
      resumeNote.textContent = '⏸ You have a saved position in this script. Starting the prompter will resume from there — use Restart once inside to begin from the top instead.';
    } else {
      clearResumeNote();
    }
  }
  scriptInput.addEventListener('input', refreshResumeNote);
  refreshResumeNote();

  // ---- BroadcastChannel remote control ----
  var bc = ('BroadcastChannel' in window) ? new BroadcastChannel('tooladda-teleprompter') : null;
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('controller') === '1') {
    document.body.innerHTML = '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#0f172a;color:#fff;font-family:Inter,sans-serif;">' +
      '<h1>Teleprompter Remote</h1>' +
      '<button id="rcPlay" style="font-size:1.5rem;padding:1rem 2rem;border-radius:999px;border:none;background:#4f46e5;color:#fff;">⏯ Play / Pause</button>' +
      '<div><button id="rcSlower" style="font-size:1.2rem;padding:0.8rem 1.4rem;margin-right:1rem;">− Slower</button><button id="rcFaster" style="font-size:1.2rem;padding:0.8rem 1.4rem;">+ Faster</button></div>' +
      '<button id="rcRestart" style="font-size:1.1rem;padding:0.7rem 1.4rem;">⏮ Restart</button>' +
      '<p style="opacity:0.7;">Controls the teleprompter open in another tab of this browser.</p></div>';
    var rcChannel = new BroadcastChannel('tooladda-teleprompter');
    document.getElementById('rcPlay').addEventListener('click', function () { rcChannel.postMessage({ type: 'togglePlay' }); });
    document.getElementById('rcFaster').addEventListener('click', function () { rcChannel.postMessage({ type: 'speed', delta: 10 }); });
    document.getElementById('rcSlower').addEventListener('click', function () { rcChannel.postMessage({ type: 'speed', delta: -10 }); });
    document.getElementById('rcRestart').addEventListener('click', function () { rcChannel.postMessage({ type: 'restart' }); });
    return;
  }
  openControllerBtn.addEventListener('click', function () {
    window.open(window.location.pathname + '?controller=1', '_blank');
  });
  if (bc) {
    bc.onmessage = function (ev) {
      var msg = ev.data;
      if (msg.type === 'togglePlay') togglePlay();
      else if (msg.type === 'restart') restart();
      else if (msg.type === 'speed') { wpmInput.value = Math.max(50, Math.min(400, (parseInt(wpmInput.value, 10) || 140) + msg.delta)); applyWpm(); }
    };
  }

  // ---- Enter prompter ----
  function applyStyles() {
    var preset = COLOR_PRESETS[colorPresetSelect.value] || COLOR_PRESETS['white-black'];
    stage.style.background = preset.bg;
    content.style.color = preset.fg;
    content.style.fontFamily = fontFamilySelect.value;
    content.style.fontSize = fontSizeInput.value + 'px';
    content.style.fontWeight = fontWeightSelect ? fontWeightSelect.value : '600';
    content.style.textAlign = textAlignSelect ? textAlignSelect.value : 'center';
    content.style.lineHeight = lineHeightInput ? lineHeightInput.value : '1.4';
    content.style.letterSpacing = (letterSpacingInput ? letterSpacingInput.value : '0') + 'px';
    content.style.width = textWidthInput.value + '%';
    content.style.maxWidth = textWidthInput.value + '%';
    content.style.setProperty('--tp-para-gap', (paraSpacingInput ? paraSpacingInput.value : '1.6') + 'em');
    if (brightnessOverlay) brightnessOverlay.style.opacity = String((parseInt(brightnessInput ? brightnessInput.value : '0', 10) || 0) / 100);
  }

  function rebuildContent() {
    var parsed = buildParagraphsHtml(scriptInput.value);
    content.innerHTML = parsed.html || '<p>(Empty script)</p>';
    state.markers = parsed.markers;
    state.totalWords = parsed.totalWords;
    applyStyles();
    // measure after layout
    requestAnimationFrame(function () {
      state.totalContentHeightPx = content.scrollHeight;
    });
  }

  function applyGuideMode() {
    if (readingGuideSelect) state.guideMode = readingGuideSelect.value;
    if (hudGuideBtn) hudGuideBtn.textContent = '🎯 Guide: ' + GUIDE_LABELS[state.guideMode];
    applyBandOverlay();
  }

  function applyBandOverlay() {
    var flags = guideFlags(state.guideMode);
    var vh = window.innerHeight;
    var bandTopPx = (state.bandPercent / 100) * vh - (state.bandHeightPercent / 100 * vh) / 2;
    var bandH = (state.bandHeightPercent / 100) * vh;
    bandTop.style.top = '0'; bandTop.style.height = Math.max(0, bandTopPx) + 'px';
    bandBottom.style.top = (bandTopPx + bandH) + 'px'; bandBottom.style.bottom = '0';
    bandLine.style.top = (state.bandPercent / 100 * vh) + 'px';
    bandTop.style.display = flags.dimEnabled ? 'block' : 'none';
    bandBottom.style.display = flags.dimEnabled ? 'block' : 'none';
    eyeLeft.style.top = (state.bandPercent / 100 * vh - 10) + 'px';
    eyeRight.style.top = (state.bandPercent / 100 * vh - 10) + 'px';
    eyeLeft.hidden = !flags.eyeLines; eyeRight.hidden = !flags.eyeLines;
  }

  function positionContent() {
    var vh = window.innerHeight;
    var bandY = (state.bandPercent / 100) * vh;
    content.style.transform = 'translate(-50%, ' + (bandY - state.currentOffset) + 'px)';
  }

  function applyWpm() {
    wpmDisplay.textContent = (parseInt(wpmInput.value, 10) || 140) + ' WPM';
    updateEstimate();
  }

  function updateRemaining() {
    var wpm = parseInt(wpmInput.value, 10) || 140;
    var pxPerSec = computePxPerSec(state.totalContentHeightPx, state.totalWords, wpm);
    var remainingPx = Math.max(0, state.totalContentHeightPx - state.currentOffset);
    var remainingSec = pxPerSec > 0 ? remainingPx / pxPerSec : 0;
    remainingDisplay.textContent = formatTime(remainingSec) + ' left';
  }

  var rafId = null;
  function frame(ts) {
    if (state.isPlaying) {
      if (state.lastFrameTs != null) {
        var dt = (ts - state.lastFrameTs) / 1000;
        var wpm = parseInt(wpmInput.value, 10) || 140;
        var pxPerSec = computePxPerSec(state.totalContentHeightPx, state.totalWords, wpm);
        state.currentOffset += pxPerSec * dt;
        if (state.currentOffset >= state.totalContentHeightPx) {
          state.currentOffset = state.totalContentHeightPx;
          state.isPlaying = false;
          hudPlayBtn.textContent = '▶ Play';
        }
      }
      state.lastFrameTs = ts;
      positionContent();
      updateRemaining();
    } else {
      state.lastFrameTs = null;
    }
    rafId = requestAnimationFrame(frame);
  }

  function togglePlay() {
    state.isPlaying = !state.isPlaying;
    hudPlayBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
  }
  function restart() { state.currentOffset = 0; positionContent(); updateRemaining(); }

  function jumpParagraph(dir) {
    var offsets = Array.from(content.querySelectorAll('p')).map(function (p) { return p.offsetTop; });
    if (!offsets.length) return;
    if (dir > 0) {
      var next = offsets.find(function (o) { return o > state.currentOffset + 4; });
      state.currentOffset = next != null ? next : state.totalContentHeightPx;
    } else {
      var prevList = offsets.filter(function (o) { return o < state.currentOffset - 4; });
      state.currentOffset = prevList.length ? prevList[prevList.length - 1] : 0;
    }
    positionContent(); updateRemaining();
  }

  function cycleMirror() {
    state.mirrorIndex = (state.mirrorIndex + 1) % MIRROR_MODES.length;
    mirrorLayer.className = MIRROR_MODES[state.mirrorIndex] === 'none' ? '' : MIRROR_MODES[state.mirrorIndex];
    hudMirrorBtn.textContent = '🪞 Mirror: ' + MIRROR_LABELS[MIRROR_MODES[state.mirrorIndex]];
  }

  function cycleGuide() {
    var idx = GUIDE_MODES.indexOf(state.guideMode);
    state.guideMode = GUIDE_MODES[(idx + 1) % GUIDE_MODES.length];
    if (readingGuideSelect) readingGuideSelect.value = state.guideMode;
    applyGuideMode();
  }

  function requestWakeLockIfPossible() {
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(function (sentinel) { state.wakeLockSentinel = sentinel; }).catch(function () {});
    }
  }
  function releaseWakeLock() {
    if (state.wakeLockSentinel) { state.wakeLockSentinel.release().catch(function () {}); state.wakeLockSentinel = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && stage.classList.contains('is-active')) requestWakeLockIfPossible();
  });

  function runCountdown(seconds, done) {
    if (seconds <= 0) { done(); return; }
    countdownEl.classList.add('is-active');
    var n = seconds;
    countdownEl.textContent = String(n);
    var iv = window.setInterval(function () {
      n--;
      if (n <= 0) { window.clearInterval(iv); countdownEl.classList.remove('is-active'); done(); }
      else countdownEl.textContent = String(n);
    }, 1000);
  }

  function openMarkersPanel() {
    markersListEl.innerHTML = '';
    if (!state.markers.length) {
      markersListEl.innerHTML = '<li style="opacity:0.7;">No [Section] or ## markers found in this script.</li>';
    } else {
      state.markers.forEach(function (m) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = m.label;
        btn.addEventListener('click', function () {
          var target = content.querySelector('[data-para="' + m.paraIndex + '"]');
          if (target) { state.currentOffset = target.offsetTop; positionContent(); updateRemaining(); }
          markersPanel.classList.remove('is-active');
        });
        li.appendChild(btn);
        markersListEl.appendChild(li);
      });
    }
    markersPanel.classList.add('is-active');
  }

  function enterPrompter() {
    editorViews.forEach(function (el) { el.style.display = 'none'; });
    stage.classList.add('is-active');
    state.isPlaying = false; state.lastFrameTs = null;
    rebuildContent();
    applyGuideMode();
    applyWpm();
    hudPlayBtn.textContent = '▶ Play';

    var resume = getResumeData();
    var resumeOffset = (resume && resume.text === scriptInput.value && resume.offset > 40) ? resume.offset : 0;
    state.currentOffset = 0;

    var countdownSecs = countdownSelect ? (parseInt(countdownSelect.value, 10) || 0) : 3;
    window.setTimeout(function () {
      state.currentOffset = resumeOffset;
      positionContent();
      updateRemaining();
      runCountdown(countdownSecs, function () { state.isPlaying = true; hudPlayBtn.textContent = '⏸ Pause'; });
    }, 60);
    requestWakeLockIfPossible();
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function exitPrompter() {
    stage.classList.remove('is-active');
    editorViews.forEach(function (el) { el.style.display = ''; });
    state.isPlaying = false;
    releaseWakeLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    try {
      if (state.currentOffset > 40 && state.currentOffset < state.totalContentHeightPx - 20) {
        localStorage.setItem(RESUME_KEY, JSON.stringify({ text: scriptInput.value, offset: state.currentOffset }));
      } else {
        localStorage.removeItem(RESUME_KEY);
      }
    } catch (e) {}
    refreshResumeNote();
  }

  startBtn.addEventListener('click', enterPrompter);
  hudExitBtn.addEventListener('click', exitPrompter);
  hudPlayBtn.addEventListener('click', togglePlay);
  hudRestartBtn.addEventListener('click', restart);
  hudMirrorBtn.addEventListener('click', cycleMirror);
  if (hudGuideBtn) hudGuideBtn.addEventListener('click', cycleGuide);
  hudMarkersBtn.addEventListener('click', openMarkersPanel);
  document.querySelector('[data-close-markers]').addEventListener('click', function () { markersPanel.classList.remove('is-active'); });
  hudHelpBtn.addEventListener('click', function () { helpPanel.classList.add('is-active'); });
  document.querySelector('[data-close-help]').addEventListener('click', function () { helpPanel.classList.remove('is-active'); });
  hudFullscreenBtn.addEventListener('click', function () {
    if (!document.fullscreenElement) stage.requestFullscreen().catch(function () {});
    else document.exitFullscreen().catch(function () {});
  });
  window.addEventListener('resize', function () { applyBandOverlay(); positionContent(); });

  if (readingGuideSelect) readingGuideSelect.addEventListener('change', applyGuideMode);
  if (brightnessInput) brightnessInput.addEventListener('input', applyStyles);
  [fontWeightSelect, textAlignSelect, lineHeightInput, letterSpacingInput, paraSpacingInput].forEach(function (el) {
    if (el) el.addEventListener('input', applyStyles);
  });

  // ---- Sticky bar / final CTA ----
  var stickyBtn = document.getElementById('tpxStickyBtn');
  var stickyBar = document.getElementById('tpxSticky');
  function scrollToEditor() {
    scriptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    scriptInput.focus();
  }
  if (stickyBtn) stickyBtn.addEventListener('click', enterPrompter);
  Array.from(document.querySelectorAll('[data-tpx-scroll-editor]')).forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); scrollToEditor(); });
  });
  if (stickyBar) stickyBar.classList.add('is-visible');

  // ---- Touch controls ----
  var touchStartY = null;
  function isHudTouch(el) {
    return el && (el.closest('#tpHud') || el.closest('#tpHelp') || el.closest('#tpMarkersPanel') || el.closest('#tpCountdown'));
  }
  stage.addEventListener('touchstart', function (e) {
    if (isHudTouch(e.target)) return;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (isHudTouch(e.target)) { touchStartY = null; return; }
    if (touchStartY == null) return;
    var dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dy) < 12) { togglePlay(); }
    else if (dy < -40) { wpmInput.value = Math.min(400, (parseInt(wpmInput.value, 10) || 140) + 10); applyWpm(); }
    else if (dy > 40) { wpmInput.value = Math.max(50, (parseInt(wpmInput.value, 10) || 140) - 10); applyWpm(); }
    touchStartY = null;
  });

  // ---- Keyboard controls (also catches presentation clickers) ----
  document.addEventListener('keydown', function (e) {
    if (!stage.classList.contains('is-active')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); wpmInput.value = Math.min(400, (parseInt(wpmInput.value, 10) || 140) + 5); applyWpm(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); wpmInput.value = Math.max(50, (parseInt(wpmInput.value, 10) || 140) - 5); applyWpm(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); jumpParagraph(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); jumpParagraph(-1); }
    else if (e.key === 'Home') { e.preventDefault(); restart(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); fontSizeInput.value = Math.min(140, (parseInt(fontSizeInput.value, 10) || 56) + 4); applyStyles(); requestAnimationFrame(function(){ state.totalContentHeightPx = content.scrollHeight; }); }
    else if (e.key === '-') { e.preventDefault(); fontSizeInput.value = Math.max(24, (parseInt(fontSizeInput.value, 10) || 56) - 4); applyStyles(); requestAnimationFrame(function(){ state.totalContentHeightPx = content.scrollHeight; }); }
    else if (e.key === 'm' || e.key === 'M') { cycleMirror(); }
    else if (e.key === 'g' || e.key === 'G') { cycleGuide(); }
    else if (e.key === 'f' || e.key === 'F') { hudFullscreenBtn.click(); }
    else if (e.key === 'Escape') { exitPrompter(); }
  });
})();
