/* ToolAdda — Typing Speed Test UI
 * Wires the studio to TypingSpeedEngine. Tab only restarts while the
 * test box is focused, so the rest of the page stays keyboard-usable.
 */
(function () {
  'use strict';

  var E = window.TypingSpeedEngine;
  if (!E) return;

  var BEST_KEY = 'tooladda-typing-best-wpm';
  var HISTORY_KEY = 'tooladda-typing-history';

  var $ = function (sel) { return document.querySelector(sel); };
  var sampleTextEl = $('[data-sample-text]');
  var inputEl = $('[data-typing-input]');
  var timerEl = $('[data-timer]');
  var statusWrapEl = $('[data-status]');
  var statusEl = $('[data-status-text]');
  var resultEl = $('[data-result-summary]');
  var wpmEl = $('[data-wpm]');
  var rawWpmEl = $('[data-raw-wpm]');
  var cpmEl = $('[data-cpm]');
  var accuracyEl = $('[data-accuracy]');
  var charactersEl = $('[data-characters]');
  var mistakesEl = $('[data-mistakes]');
  var progressFillEl = $('[data-progress-fill]');
  var bestWpmEl = $('[data-best-wpm]');
  var passageChipEl = $('[data-passage-chip]');
  var startBtn = $('[data-start-test]');
  var resetBtn = $('[data-reset-test]');
  var newPassageBtn = $('[data-new-passage]');
  var copyBtn = $('[data-copy-result]');
  var durationGroup = $('[data-duration-group]');
  var difficultyGroup = $('[data-difficulty-group]');
  var customToggle = $('[data-custom-toggle]');
  var customBox = $('[data-custom-text]');
  var historyEl = $('[data-history]');

  if (!inputEl || !sampleTextEl) return;

  var currentSample = '';
  var startTime = null;
  var durationSeconds = 60;
  var difficulty = 'medium';
  var timerInterval = null;
  var finished = false;
  var started = false;
  var lastStats = null;
  var bestWpm = 0;
  try { bestWpm = Number(localStorage.getItem(BEST_KEY) || 0) || 0; } catch (e) { bestWpm = 0; }

  var difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  function readHistory() {
    try {
      var raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0, 8) : [];
    } catch (e) { return []; }
  }

  function writeHistory(entry) {
    var list = readHistory();
    list.unshift(entry);
    list = list.slice(0, 8);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (err) { /* ignore */ }
    renderHistory(list);
  }

  function renderHistory(list) {
    if (!historyEl) return;
    var rows = list || readHistory();
    if (!rows.length) {
      historyEl.innerHTML = '<p class="wpm-muted">Finished tests will land here on this device.</p>';
      return;
    }
    historyEl.innerHTML = rows.map(function (row) {
      return '<li><strong>' + E.escapeHtml(String(row.wpm)) + ' WPM</strong>' +
        '<span>' + E.escapeHtml(row.accuracy) + ' · ' + E.escapeHtml(row.label) + '</span></li>';
    }).join('');
  }

  function renderSample(typedValue) {
    typedValue = typedValue || '';
    var chars = currentSample.split('');
    sampleTextEl.innerHTML = chars.map(function (char, index) {
      var cls = 'char';
      if (index < typedValue.length) cls += typedValue.charAt(index) === char ? ' correct' : ' incorrect';
      if (index === typedValue.length) cls += ' active';
      // a real space, so lines wrap between words, not inside them
      var display = E.escapeHtml(char);
      return '<span class="' + cls + '">' + display + '</span>';
    }).join('');
  }

  function customPassage() {
    if (!customToggle || !customToggle.checked || !customBox) return '';
    return String(customBox.value || '').replace(/\s+/g, ' ').trim();
  }

  function pickSample() {
    var custom = customPassage();
    currentSample = custom || E.pickPassage(difficulty, currentSample);
  }

  function setStatus(text, tone) {
    if (statusEl) statusEl.textContent = text;
    if (statusWrapEl) statusWrapEl.setAttribute('data-tone', tone || 'idle');
  }

  function updateChip() {
    if (!passageChipEl) return;
    passageChipEl.textContent = (customPassage() ? 'Custom' : difficultyLabel[difficulty]) +
      ' · ' + E.durationLabel(durationSeconds);
  }

  function setBestWpm(value) {
    bestWpm = value;
    if (bestWpmEl) bestWpmEl.textContent = value > 0 ? String(value) : '0';
    try { localStorage.setItem(BEST_KEY, String(value)); } catch (e) { /* ignore */ }
  }

  function paintStats(stats) {
    lastStats = stats;
    if (wpmEl) wpmEl.textContent = String(stats.wpm);
    if (rawWpmEl) rawWpmEl.textContent = String(stats.rawWpm);
    if (cpmEl) cpmEl.textContent = String(stats.cpm);
    if (accuracyEl) accuracyEl.textContent = stats.accuracy;
    if (charactersEl) charactersEl.textContent = String(stats.total);
    if (mistakesEl) mistakesEl.textContent = String(stats.mistakes);
    renderSample(inputEl.value);
  }

  function tick() {
    if (!startTime) return;
    var elapsedSeconds = (Date.now() - startTime) / 1000;
    var remaining = Math.max(0, durationSeconds - Math.floor(elapsedSeconds));
    if (timerEl) timerEl.textContent = remaining + 's';
    if (progressFillEl) progressFillEl.style.width = Math.min(100, (elapsedSeconds / durationSeconds) * 100) + '%';
    refreshStats(elapsedSeconds);
    if (remaining <= 0) finishTest();
  }

  function refreshStats(elapsedSeconds) {
    var stats = E.analyze(inputEl.value, currentSample, elapsedSeconds || 0.01);
    paintStats(stats);
    if (stats.completed) finishTest();
  }

  function resetTest(keepSample) {
    clearInterval(timerInterval);
    finished = false;
    started = false;
    startTime = null;
    lastStats = null;
    if (!keepSample) pickSample();
    if (timerEl) timerEl.textContent = durationSeconds + 's';
    setStatus('Ready to begin', 'idle');
    if (resultEl) {
      resultEl.textContent = 'Your best score is saved locally on this device.';
      resultEl.classList.remove('is-best');
    }
    paintStats({ wpm: 0, rawWpm: 0, cpm: 0, accuracy: '100%', total: 0, mistakes: 0 });
    if (progressFillEl) progressFillEl.style.width = '0%';
    inputEl.value = '';
    inputEl.disabled = false;
    updateChip();
    renderSample('');
  }

  function beginTest() {
    if (started && !finished) { inputEl.focus(); return; }
    resetTest(true);
    if (!currentSample) pickSample();
    if (!currentSample) {
      setStatus('Paste a custom passage first.', 'idle');
      return;
    }
    started = true;
    finished = false;
    startTime = Date.now();
    setStatus('Typing in progress…', 'running');
    if (resultEl) {
      resultEl.textContent = 'Keep going until the timer ends.';
      resultEl.classList.remove('is-best');
    }
    inputEl.disabled = false;
    inputEl.focus();
    clearInterval(timerInterval);
    timerInterval = window.setInterval(tick, 200);
  }

  function finishTest() {
    if (finished) return;
    finished = true;
    started = false;
    clearInterval(timerInterval);
    var elapsedSeconds = startTime ? Math.min(durationSeconds, (Date.now() - startTime) / 1000) : durationSeconds;
    var stats = E.analyze(inputEl.value, currentSample, elapsedSeconds);
    paintStats(stats);
    var previousBest = bestWpm;
    var isBest = stats.wpm > previousBest;
    if (isBest) setBestWpm(stats.wpm);
    if (resultEl) {
      resultEl.textContent = E.resultLine(stats, previousBest);
      resultEl.classList.toggle('is-best', isBest);
    }
    setStatus('Time is up', 'done');
    if (timerEl) timerEl.textContent = '0s';
    if (progressFillEl) progressFillEl.style.width = '100%';
    inputEl.disabled = true;
    inputEl.blur();
    writeHistory({
      wpm: stats.wpm,
      accuracy: stats.accuracy,
      label: (customPassage() ? 'Custom' : difficultyLabel[difficulty]) + ' · ' + E.durationLabel(durationSeconds),
      at: Date.now()
    });
  }

  function copyResult() {
    var stats = lastStats || E.analyze(inputEl.value, currentSample, 0.01);
    var line = stats.wpm + ' WPM · raw ' + stats.rawWpm + ' · ' + stats.cpm + ' CPM · ' +
      stats.accuracy + ' accuracy · ' + stats.mistakes + ' mistakes';
    function done() { setStatus('Result copied', 'done'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(line).then(done, done);
    } else {
      done();
    }
  }

  function wireSegment(group, onSelect) {
    if (!group) return;
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !group.contains(btn)) return;
      group.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      onSelect(btn);
    });
  }

  wireSegment(durationGroup, function (btn) {
    durationSeconds = E.normalizeDuration(btn.getAttribute('data-duration'));
    resetTest(true);
  });

  wireSegment(difficultyGroup, function (btn) {
    difficulty = E.normalizeDifficulty(btn.getAttribute('data-difficulty'));
    resetTest(false);
  });

  if (startBtn) startBtn.addEventListener('click', beginTest);
  if (resetBtn) resetBtn.addEventListener('click', function () { resetTest(false); });
  if (newPassageBtn) newPassageBtn.addEventListener('click', function () { resetTest(false); });
  if (copyBtn) copyBtn.addEventListener('click', copyResult);

  if (customToggle) {
    customToggle.addEventListener('change', function () {
      if (customBox) customBox.hidden = !customToggle.checked;
      resetTest(false);
    });
  }
  if (customBox) {
    customBox.addEventListener('input', function () {
      if (customToggle && customToggle.checked && !started) resetTest(false);
    });
  }

  inputEl.addEventListener('input', function () {
    if (finished) return;
    if (!started) {
      // beginTest() clears the box; keep the keystroke that started the test
      var typed = inputEl.value;
      beginTest();
      if (!started) return;
      inputEl.value = typed;
    }
    if (startTime) refreshStats((Date.now() - startTime) / 1000);
  });

  document.addEventListener('keydown', function (e) {
    if (document.activeElement !== inputEl) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      resetTest(true);
      beginTest();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetTest(false);
      inputEl.focus();
    }
  });

  setBestWpm(bestWpm);
  renderHistory();
  resetTest(false);
})();
