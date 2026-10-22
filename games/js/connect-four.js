/* ==========================================================================
   ToolAdda — Connect Four (interface)

   All the rules and the opponent live in connect-four-engine.js; this file
   only turns a state into DOM and turns clicks into moves. Three things it
   is careful about:

   · The opponent's search runs after a repaint, not in the click handler, so
     the "thinking" line is actually on screen while it thinks and the board
     never appears frozen.
   · Every state the game passes through is kept, so undo works at any depth
     and, against the computer, steps back over both plies in one press.
   · Input is refused while a move is animating or while the computer is on
     move, which is what stops a fast clicker from playing two discs in a row.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.ConnectFourEngine;
  var root = document.querySelector('[data-connect-four]');
  if (!root || !E) return;

  var STORAGE_STATS = 'tooladda-connect-four-stats';
  var STORAGE_PREFS = 'tooladda-connect-four-prefs';
  var DROP_MS = 340;

  var $ = function (sel) { return root.querySelector(sel); };
  var els = {
    board: $('[data-board]'),
    grid: $('[data-grid]'),
    columns: $('[data-columns]'),
    turn: $('[data-turn]'),
    result: $('[data-result]'),
    confetti: $('[data-confetti-layer]'),
    modeButtons: Array.prototype.slice.call(root.querySelectorAll('[data-mode]')),
    difficultyWrap: $('[data-difficulty-wrap]'),
    difficulty: $('[data-difficulty]'),
    starter: $('[data-starter]'),
    starterWrap: $('[data-starter-wrap]'),
    newGame: $('[data-new-game]'),
    undo: $('[data-undo]'),
    sound: $('[data-sound]'),
    resetScore: $('[data-reset-score]'),
    schemes: Array.prototype.slice.call(root.querySelectorAll('[data-scheme]')),
    wins: $('[data-wins]'),
    losses: $('[data-losses]'),
    draws: $('[data-draws]'),
    streak: $('[data-streak]'),
    scoreTitle: $('[data-score-title]')
  };

  var SCHEMES = ['classic', 'contrast', 'ocean', 'forest', 'sunset', 'mono'];
  var prefs = { mode: 'cpu', difficulty: 'medium', starter: 'you', sound: false, scheme: 'classic' };
  var stats = E.defaultStats();
  var state = E.createState();
  var history = [];
  var busy = false;
  var settled = false;      // the finished game has already been scored
  var human = E.RED;        // which colour the visitor plays against the computer
  var cells = [];

  /* ------------------------------------------------------------- storage */
  function readJSON(key) {
    try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    var saved = readJSON(STORAGE_PREFS);
    if (!saved || typeof saved !== 'object') return;
    if (saved.mode === 'cpu' || saved.mode === 'two') prefs.mode = saved.mode;
    if (E.DIFFICULTY[saved.difficulty]) prefs.difficulty = saved.difficulty;
    if (['you', 'computer', 'alternate'].indexOf(saved.starter) !== -1) prefs.starter = saved.starter;
    prefs.sound = saved.sound === true;
    if (SCHEMES.indexOf(saved.scheme) !== -1) prefs.scheme = saved.scheme;
  }

  /* One attribute on the root swaps every colour: discs, turn dots, the
     landing ghost and the board itself all read the same four variables. */
  function applyScheme() {
    root.dataset.discs = prefs.scheme;
    els.schemes.forEach(function (button) {
      var on = button.dataset.scheme === prefs.scheme;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------------- sound */
  var audio = null;
  function beep(frequency, duration, type) {
    if (!prefs.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume();
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + duration + 0.02);
    } catch (e) { /* audio is a nicety, never a requirement */ }
  }
  var playDropSound = function () { beep(220, 0.09, 'triangle'); };
  var playWinSound = function () {
    [523, 659, 784].forEach(function (note, i) {
      window.setTimeout(function () { beep(note, 0.16, 'sine'); }, i * 110);
    });
  };

  /* ----------------------------------------------------------- board DOM */
  function buildBoard() {
    var gridHtml = '';
    for (var row = 0; row < E.ROWS; row += 1) {
      for (var col = 0; col < E.COLUMNS; col += 1) {
        gridHtml += '<div class="c4-cell" data-cell="' + E.index(row, col) + '">' +
          '<span class="c4-ghost"></span><span class="c4-disc"></span></div>';
      }
    }
    /* The column overlay is a child of the grid (that is what makes the two
       line up exactly), so the cells are inserted in front of it rather than
       written over the whole grid. */
    Array.prototype.slice.call(els.grid.querySelectorAll('.c4-cell')).forEach(function (node) {
      node.parentNode.removeChild(node);
    });
    els.grid.insertAdjacentHTML('afterbegin', gridHtml);
    cells = Array.prototype.slice.call(els.grid.querySelectorAll('[data-cell]'));

    var columnsHtml = '';
    for (var c = 0; c < E.COLUMNS; c += 1) {
      columnsHtml += '<button type="button" class="c4-col" data-column="' + c + '"></button>';
    }
    els.columns.innerHTML = columnsHtml;

    Array.prototype.forEach.call(els.columns.children, function (button) {
      var col = Number(button.dataset.column);
      button.addEventListener('click', function () { humanDrop(col); });
      button.addEventListener('pointerenter', function () { showLanding(col); });
      button.addEventListener('focus', function () { showLanding(col); });
      button.addEventListener('pointerleave', clearLanding);
      button.addEventListener('blur', clearLanding);
    });
  }

  function showLanding(col) {
    clearLanding();
    if (busy || state.winner !== E.EMPTY || !E.canPlay(state, col)) return;
    var cell = cells[E.index(E.landingRow(state, col), col)];
    if (!cell) return;
    cell.classList.add('is-landing', state.turn === E.RED ? 'is-red' : 'is-yellow');
  }

  function clearLanding() {
    cells.forEach(function (cell) { cell.classList.remove('is-landing', 'is-red', 'is-yellow'); });
  }

  /* --------------------------------------------------------------- render */
  function playerName(player) {
    if (prefs.mode === 'two') return player === E.RED ? 'Red' : 'Yellow';
    return player === human ? 'You' : 'Computer';
  }

  function render(options) {
    var opts = options || {};
    cells.forEach(function (cell, i) {
      var value = state.board[i];
      if (value) cell.dataset.player = String(value);
      else cell.removeAttribute('data-player');
      cell.classList.remove('is-win');
      if (opts.dropped !== i) cell.classList.remove('is-dropping');
    });

    if (state.line) {
      state.line.forEach(function (i) { cells[i].classList.add('is-win'); });
    }
    els.board.classList.toggle('is-over', state.winner !== E.EMPTY || E.isFull(state));

    Array.prototype.forEach.call(els.columns.children, function (button) {
      var col = Number(button.dataset.column);
      var open = E.canPlay(state, col);
      button.disabled = !open || busy || (prefs.mode === 'cpu' && state.turn !== human);
      var left = E.ROWS - state.heights[col];
      button.setAttribute('aria-label', open
        ? 'Drop a disc in column ' + (col + 1) + ', ' + left + ' space' + (left === 1 ? '' : 's') + ' left'
        : 'Column ' + (col + 1) + ' is full');
    });

    els.undo.disabled = busy || history.length === 0;
    renderStatus();
    renderScore();
  }

  function renderStatus() {
    var dot = '<span class="c4-dot ' + (state.turn === E.RED ? 'is-red' : 'is-yellow') + '"></span>';
    if (state.winner !== E.EMPTY) {
      els.turn.dataset.state = 'over';
      els.turn.innerHTML = '<span class="c4-dot ' + (state.winner === E.RED ? 'is-red' : 'is-yellow') + '"></span>' +
        playerName(state.winner) + ' won';
      return;
    }
    if (E.isFull(state)) {
      els.turn.dataset.state = 'over';
      els.turn.textContent = 'A draw — the board is full';
      return;
    }
    if (busy && prefs.mode === 'cpu' && state.turn !== human) {
      els.turn.dataset.state = 'thinking';
      els.turn.innerHTML = dot + 'Computer is thinking…';
      return;
    }
    els.turn.dataset.state = 'play';
    els.turn.innerHTML = dot + playerName(state.turn) + (prefs.mode === 'two' ? ' to play' : (state.turn === human ? 'r turn' : ' to play'));
  }

  function renderScore() {
    els.wins.textContent = stats.wins;
    els.losses.textContent = stats.losses;
    els.draws.textContent = stats.draws;
    els.streak.textContent = stats.streak > 0
      ? 'Winning streak: ' + stats.streak + ' · best ' + stats.best
      : 'Best winning streak: ' + stats.best;
    els.scoreTitle.textContent = prefs.mode === 'two' ? 'Session score (red)' : 'Your score vs the computer';
  }

  function announce(text, tone) {
    els.result.hidden = false;
    els.result.textContent = text;
    els.result.dataset.tone = tone || 'info';
  }

  /* ----------------------------------------------------------- game flow */
  function firstPlayerFor(gameNumber) {
    if (prefs.mode === 'two') return E.RED;
    if (prefs.starter === 'computer') return E.other(human);
    if (prefs.starter === 'alternate') return gameNumber % 2 === 0 ? human : E.other(human);
    return human;
  }

  var gamesPlayed = 0;

  function newGame(keepScore) {
    var first = firstPlayerFor(gamesPlayed);
    state = E.createState(first);
    history = [];
    busy = false;
    settled = false;
    els.result.hidden = true;
    clearLanding();
    render();
    if (keepScore !== false) { /* the scoreboard survives a new game on purpose */ }
    if (prefs.mode === 'cpu' && state.turn !== human) scheduleComputer();
  }

  function humanDrop(col) {
    if (busy || state.winner !== E.EMPTY || !E.canPlay(state, col)) return;
    if (prefs.mode === 'cpu' && state.turn !== human) return;
    dropDisc(col, function () {
      if (prefs.mode === 'cpu' && state.winner === E.EMPTY && !E.isFull(state)) scheduleComputer();
    });
  }

  function dropDisc(col, done) {
    var landingIndex = E.index(E.landingRow(state, col), col);
    var distance = E.landingRow(state, col) + 1;
    history.push(E.cloneState(state));
    state = E.play(state, col);
    busy = true;
    clearLanding();

    var cell = cells[landingIndex];
    cell.style.setProperty('--drop', String(distance));
    cell.classList.add('is-dropping');
    render({ dropped: landingIndex });
    playDropSound();

    window.setTimeout(function () {
      cell.classList.remove('is-dropping');
      busy = false;
      render();
      if (finish()) return;
      if (done) done();
    }, DROP_MS);
  }

  /* Returns true when the game is over (and has been scored). */
  function finish() {
    if (state.winner === E.EMPTY && !E.isFull(state)) return false;
    if (settled) return true;
    settled = true;
    gamesPlayed += 1;

    if (state.winner === E.EMPTY) {
      stats.draws += 1;
      stats.streak = 0;
      announce('Draw — every square is full and nobody made four.', 'draw');
    } else if (prefs.mode === 'two') {
      if (state.winner === E.RED) { stats.wins += 1; stats.streak += 1; }
      else { stats.losses += 1; stats.streak = 0; }
      announce((state.winner === E.RED ? 'Red' : 'Yellow') + ' wins with four in a row.',
        state.winner === E.RED ? 'win' : 'loss');
      celebrate();
    } else if (state.winner === human) {
      stats.wins += 1;
      stats.streak += 1;
      announce('You win! Four in a row on ' + E.DIFFICULTY[prefs.difficulty].label + '.', 'win');
      celebrate();
    } else {
      stats.losses += 1;
      stats.streak = 0;
      announce('The computer got four in a row. Undo two moves to try that again.', 'loss');
    }

    if (stats.streak > stats.best) stats.best = stats.streak;
    writeJSON(STORAGE_STATS, stats);
    render();
    return true;
  }

  function celebrate() {
    playWinSound();
    if (!els.confetti) return;
    var colours = ['#ef4444', '#fbbf24', '#60a5fa', '#34d399', '#f472b6'];
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 22; i += 1) {
      var piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random() * 100) + '%';
      piece.style.top = '0px';
      piece.style.background = colours[i % colours.length];
      piece.style.setProperty('--x', ((Math.random() - 0.5) * 200) + 'px');
      piece.style.animationDelay = (Math.random() * 120) + 'ms';
      fragment.appendChild(piece);
    }
    els.confetti.appendChild(fragment);
    window.setTimeout(function () { els.confetti.innerHTML = ''; }, 1500);
  }

  /* The search is deliberately deferred twice: once so the browser paints
     "thinking", and once more so the paint lands before a long search blocks
     the main thread on a slow device.

     Both delays are timers rather than requestAnimationFrame. rAF does not
     run in a background tab, so a visitor who switched tabs mid-move came
     back to a game frozen on "Computer is thinking…" — the move had never
     been scheduled. A timer fires either way. */
  function scheduleComputer() {
    busy = true;
    render();
    window.setTimeout(function () {
      window.setTimeout(function () {
        var col;
        try {
          col = E.chooseMove(state, prefs.difficulty, Math.random, { timeLimit: 700 });
        } catch (error) {
          col = E.legalMoves(state)[0];      // never leave the game stuck on "thinking"
        }
        busy = false;
        if (col === null || col === undefined) { render(); return; }
        dropDisc(col);
      }, 200);
    }, 20);
  }

  function undo() {
    if (busy || !history.length) return;
    // against the computer, one press should undo the exchange, not half of it
    var steps = (prefs.mode === 'cpu' && history.length > 1 && state.turn === human) ? 2 : 1;
    while (steps > 0 && history.length) {
      state = history.pop();
      steps -= 1;
    }
    settled = false;
    els.result.hidden = true;
    render();
    if (prefs.mode === 'cpu' && state.turn !== human && state.winner === E.EMPTY) scheduleComputer();
  }

  /* -------------------------------------------------------------- controls */
  els.modeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      prefs.mode = button.dataset.mode;
      els.modeButtons.forEach(function (other) { other.classList.toggle('is-active', other === button); });
      els.difficultyWrap.hidden = prefs.mode !== 'cpu';
      els.starterWrap.hidden = prefs.mode !== 'cpu';
      writeJSON(STORAGE_PREFS, prefs);
      newGame();
    });
  });

  els.difficulty.addEventListener('change', function () {
    if (!E.DIFFICULTY[els.difficulty.value]) return;
    prefs.difficulty = els.difficulty.value;
    writeJSON(STORAGE_PREFS, prefs);
    newGame();
  });

  els.starter.addEventListener('change', function () {
    prefs.starter = els.starter.value;
    writeJSON(STORAGE_PREFS, prefs);
    newGame();
  });

  els.newGame.addEventListener('click', function () { newGame(); });
  els.undo.addEventListener('click', undo);

  els.sound.addEventListener('click', function () {
    prefs.sound = !prefs.sound;
    els.sound.classList.toggle('is-active', prefs.sound);
    els.sound.setAttribute('aria-pressed', prefs.sound ? 'true' : 'false');
    els.sound.textContent = prefs.sound ? '🔊 Sound on' : '🔇 Sound off';
    writeJSON(STORAGE_PREFS, prefs);
    if (prefs.sound) playDropSound();
  });

  els.schemes.forEach(function (button) {
    button.addEventListener('click', function () {
      prefs.scheme = button.dataset.scheme;
      applyScheme();
      writeJSON(STORAGE_PREFS, prefs);
    });
  });

  els.resetScore.addEventListener('click', function () {
    stats = E.defaultStats();
    writeJSON(STORAGE_STATS, stats);
    renderScore();
  });

  /* Number keys drop straight into a column; arrows walk across it. */
  var cursor = 3;
  document.addEventListener('keydown', function (event) {
    if (event.target && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    var key = event.key;

    if (key >= '1' && key <= '7') {
      event.preventDefault();
      humanDrop(Number(key) - 1);
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      cursor = Math.max(0, Math.min(E.COLUMNS - 1, cursor + (key === 'ArrowRight' ? 1 : -1)));
      var button = els.columns.children[cursor];
      if (button) button.focus();
      return;
    }
    if (key.toLowerCase() === 'n') { event.preventDefault(); newGame(); }
    else if (key.toLowerCase() === 'u') { event.preventDefault(); undo(); }
  });

  /* ----------------------------------------------------------------- boot */
  loadPrefs();
  stats = E.normalizeStats(readJSON(STORAGE_STATS));

  els.difficulty.value = prefs.difficulty;
  els.starter.value = prefs.starter;
  els.modeButtons.forEach(function (button) { button.classList.toggle('is-active', button.dataset.mode === prefs.mode); });
  els.difficultyWrap.hidden = prefs.mode !== 'cpu';
  els.starterWrap.hidden = prefs.mode !== 'cpu';
  els.sound.classList.toggle('is-active', prefs.sound);
  els.sound.setAttribute('aria-pressed', prefs.sound ? 'true' : 'false');
  els.sound.textContent = prefs.sound ? '🔊 Sound on' : '🔇 Sound off';

  applyScheme();
  buildBoard();
  newGame();
}());
