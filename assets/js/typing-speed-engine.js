/* ==========================================================================
   ToolAdda — Typing Speed Engine

   Pure scoring for the WPM test. The UI never invents a number: every
   character compare, every accuracy percent and every words-per-minute
   figure comes from here so the live counters and the finished result
   cannot drift apart.

   WPM is the industry standard: five correct characters count as one
   word, then divide by minutes elapsed. Raw WPM uses every character
   typed, including mistakes. CPM is the same correct-character count
   without the divide-by-five.
   ========================================================================== */
(function (global) {
  'use strict';

  var DURATIONS = [15, 30, 60, 120];
  var DIFFICULTIES = ['easy', 'medium', 'hard'];

  var PASSAGES = {
    easy: [
      'The sun is warm and the sky is clear today. We can walk to the park and play in the grass.',
      'A cup of tea and a good book make a calm evening. The cat sleeps by the door as the rain falls.',
      'She likes to draw small birds and bright flowers. Her desk is full of pens in every color.',
      'We ate fresh bread and sweet fruit for lunch. Then we sat by the lake and watched the boats.',
      'He opens the window and lets the cool air in. Birds sing from the trees along the quiet street.',
      'Please write your name at the top of the page and then read the first three lines slowly.'
    ],
    medium: [
      'The quick brown fox jumps over the lazy dog while the moonlight shines across the quiet valley.',
      'Modern tools make daily work faster, calmer, and easier when the interface stays simple and intuitive.',
      'Great typing comes from steady rhythm, clear focus, and comfortable posture at your desk each day.',
      'A well designed website helps visitors explore content quickly and enjoy a smooth experience on any device.',
      'Practice a few minutes every morning and your hands will find the keys without looking down.',
      'Clear writing is mostly clear thinking. Cut the extra words and the sentence usually improves.'
    ],
    hard: [
      'Approximately 27% of respondents (n=1,438) preferred the "quiet-first" workflow; however, 63% cited latency—not layout—as the key blocker.',
      'The compiler emitted: `TypeError: cannot read property \'length\' of undefined` at line 42, column 17, halting the build immediately.',
      'Jazz & rhythm—those syncopated, off-beat phrases—require exceptional dexterity, unwavering concentration, and impeccable timing.',
      'Version 3.14.2 introduced breaking changes: deprecated `useLegacyParser()`, renamed 12 flags, and dropped support for Node <18.',
      'She wired the webhook to POST /v2/events?limit=50&cursor=eyJ0IjoiIn0, then retried on HTTP 429 with exponential backoff.',
      'The clause read: “Indemnitor shall, at its sole cost, defend, indemnify, and hold harmless Indemnitee from any third-party claim.”'
    ]
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeDifficulty(value) {
    return DIFFICULTIES.indexOf(value) >= 0 ? value : 'medium';
  }

  function normalizeDuration(value) {
    var n = Number(value);
    return DURATIONS.indexOf(n) >= 0 ? n : 60;
  }

  function countCorrect(typed, sample) {
    var a = String(typed == null ? '' : typed);
    var b = String(sample == null ? '' : sample);
    var correct = 0;
    var i;
    var limit = Math.min(a.length, b.length);
    for (i = 0; i < limit; i++) {
      if (a.charAt(i) === b.charAt(i)) correct += 1;
    }
    return correct;
  }

  function computeWpm(correctChars, seconds) {
    var mins = Math.max(1 / 60, Number(seconds) / 60);
    return Math.round((Number(correctChars) / 5) / mins);
  }

  function computeCpm(correctChars, seconds) {
    var mins = Math.max(1 / 60, Number(seconds) / 60);
    return Math.round(Number(correctChars) / mins);
  }

  function formatAccuracy(correct, total) {
    var t = Number(total);
    if (!t) return '100%';
    return String(Math.max(0, Math.round((Number(correct) / t) * 100))) + '%';
  }

  function analyze(typed, sample, seconds) {
    var text = String(typed == null ? '' : typed);
    var target = String(sample == null ? '' : sample);
    var total = text.length;
    var correct = countCorrect(text, target);
    var mistakes = Math.max(0, total - correct);
    var secs = Math.max(0, Number(seconds) || 0);
    var wpm = computeWpm(correct, secs || 0.01);
    var rawWpm = computeWpm(total, secs || 0.01);
    var cpm = computeCpm(correct, secs || 0.01);
    return {
      total: total,
      correct: correct,
      mistakes: mistakes,
      wpm: wpm,
      rawWpm: rawWpm,
      cpm: cpm,
      accuracy: formatAccuracy(correct, total),
      accuracyPct: total ? Math.max(0, Math.round((correct / total) * 100)) : 100,
      completed: target.length > 0 && total >= target.length
    };
  }

  function pickPassage(difficulty, current, rng) {
    var level = normalizeDifficulty(difficulty);
    var pool = PASSAGES[level] || PASSAGES.medium;
    var rand = typeof rng === 'function' ? rng : Math.random;
    var index = Math.floor(rand() * pool.length);
    var next = pool[index] || pool[0];
    if (pool.length > 1 && next === current) {
      next = pool[(index + 1) % pool.length];
    }
    return next;
  }

  function durationLabel(seconds) {
    var s = normalizeDuration(seconds);
    return s >= 120 ? String(s / 60) + 'min' : String(s) + 's';
  }

  function resultLine(stats, bestWpm) {
    var wpm = stats && typeof stats.wpm === 'number' ? stats.wpm : 0;
    var accuracy = stats && stats.accuracy ? stats.accuracy : '100%';
    var best = Number(bestWpm) || 0;
    if (wpm > best) return 'New personal best: ' + wpm + ' WPM at ' + accuracy + ' accuracy.';
    return 'Finished: ' + wpm + ' WPM at ' + accuracy + ' accuracy. Your best is ' + best + ' WPM.';
  }

  global.TypingSpeedEngine = {
    DURATIONS: DURATIONS,
    DIFFICULTIES: DIFFICULTIES,
    PASSAGES: PASSAGES,
    escapeHtml: escapeHtml,
    normalizeDifficulty: normalizeDifficulty,
    normalizeDuration: normalizeDuration,
    countCorrect: countCorrect,
    computeWpm: computeWpm,
    computeCpm: computeCpm,
    formatAccuracy: formatAccuracy,
    analyze: analyze,
    pickPassage: pickPassage,
    durationLabel: durationLabel,
    resultLine: resultLine
  };

})(typeof window !== 'undefined' ? window : this);
