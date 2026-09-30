/* ==========================================================================
   ToolAdda — Reversi (interface)

   All the rules and the opponent live in reversi-engine.js; this file only
   turns a state into DOM and taps into moves. What it is careful about:

   · Discs are created once and afterwards only turned over, never redrawn,
     so a capture is a real 3D flip that ripples out from the disc just
     placed — and an undo turns the same discs back.
   · Passes are shown, not just applied. When a side has no legal move the
     game says so, instead of silently handing the turn back.
   · Every state is kept for undo; against the computer one press returns to
     your own last decision, over any passes in between.
   · The game in progress is saved as a list of squares and replayed through
     the rules on the next visit, so an edited save cannot produce a board
     the rules would not allow.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.ReversiEngine;
  var root = document.querySelector('[data-reversi]');
  if (!root || !E) return;

  var STORAGE_STATS = 'tooladda-reversi-stats';
  var STORAGE_PREFS = 'tooladda-reversi-prefs';
  var STORAGE_GAME = 'tooladda-reversi-game';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var FLIP_MS = reduceMotion ? 0 : 460;
  var RIPPLE_MS = reduceMotion ? 0 : 60;

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };
  var els = {
    board: $('[data-board]'),
    grid: $('[data-grid]'),
    turn: $('[data-turn]'),
    blackSide: $('[data-black-side]'),
    blackCount: $('[data-black-count]'),
    blackName: $('[data-black-name]'),
    whiteSide: $('[data-white-side]'),
    whiteCount: $('[data-white-count]'),
    whiteName: $('[data-white-name]'),
    bar: $('[data-bar]'),
    result: $('[data-result]'),
    help: $('[data-help]'),
    confetti: $('[data-confetti-layer]'),
    newGame: $('[data-new-game]'),
    undo: $('[data-undo]'),
    hint: $('[data-hint]'),
    sound: $('[data-sound]'),
    modeButtons: $$('[data-mode]'),
    difficultyWrap: $('[data-difficulty-wrap]'),
    difficulty: $('[data-difficulty]'),
    sideWrap: $('[data-side-wrap]'),
    side: $('[data-side]'),
    boardSize: $('[data-board-size]'),
    legal: $('[data-legal-toggle]'),
    styles: $$('[data-style-choice]'),
    scoreTitle: $('[data-score-title]'),
    wins: $('[data-wins]'),
    winLabel: $('[data-win-label]'),
    losses: $('[data-losses]'),
    lossLabel: $('[data-loss-label]'),
    draws: $('[data-draws]'),
    streak: $('[data-streak]'),
    resetScore: $('[data-reset-score]'),
    moves: $('[data-moves]'),
    movesEmpty: $('[data-moves-empty]')
  };

  var STYLE_NAMES = {
    felt: ['Black', 'White'],
    wood: ['Black', 'White'],
    contrast: ['Blue', 'Orange'],
    ocean: ['Navy', 'Gold']
  };

  var prefs = { mode: 'cpu', difficulty: 'medium', side: 'black', size: 8, style: 'felt', legal: true, sound: false };
  var stats = E.defaultStats();
  var session = { black: 0, white: 0, draws: 0 };   // two-player games, never saved
  var state = E.createState(prefs.size);
  var history = [];
  var human = E.BLACK;
  var gamesPlayed = 0;
  var busy = false;
  var settled = false;
  var hint = -1;
  var cursor = -1;
  var squares = [];
  var pieces = [];
  var discs = [];
  var token = 0;
  var defaultHelp = els.help ? els.help.innerHTML : '';
  var timers = { help: 0, hint: 0, arm: 0 };

  /* ------------------------------------------------------------- storage */
  function readJSON(key) {
    try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function removeKey(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    var saved = readJSON(STORAGE_PREFS);
    if (!saved || typeof saved !== 'object') return;
    if (saved.mode === 'cpu' || saved.mode === 'two') prefs.mode = saved.mode;
    if (E.DIFFICULTY[saved.difficulty]) prefs.difficulty = saved.difficulty;
    if (['black', 'white', 'alternate'].indexOf(saved.side) !== -1) prefs.side = saved.side;
    if (E.SIZES.indexOf(saved.size) !== -1) prefs.size = saved.size;
    if (STYLE_NAMES[saved.style]) prefs.style = saved.style;
    prefs.legal = saved.legal !== false;
    prefs.sound = saved.sound === true;
  }
  function savePrefs() { writeJSON(STORAGE_PREFS, prefs); }

  function saveGame() {
    if (state.over || !state.moves.length) { removeKey(STORAGE_GAME); return; }
    writeJSON(STORAGE_GAME, {
      v: 1, size: state.size, mode: prefs.mode, human: human,
      games: gamesPlayed, moves: E.serializeMoves(state)
    });
  }

  function restoreGame() {
    var saved = readJSON(STORAGE_GAME);
    if (!saved || saved.v !== 1 || saved.size !== prefs.size || saved.mode !== prefs.mode) return false;
    if (saved.human !== E.BLACK && saved.human !== E.WHITE) return false;
    var replayed = E.replay(saved.size, saved.moves);
    if (!replayed || replayed.over || !replayed.moves.length) return false;

    history = [];
    var walk = E.createState(saved.size);
    saved.moves.forEach(function (sq) {
      history.push(walk);
      walk = E.play(walk, sq);
    });
    state = walk;
    human = prefs.mode === 'two' ? E.BLACK : saved.human;
    if (typeof saved.games === 'number' && saved.games >= 0 && saved.games < 1e6) gamesPlayed = Math.floor(saved.games);
    return true;
  }

  /* ---------------------------------------------------------------- sound */
  var audio = null;
  function beep(frequency, duration, type, volume) {
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
      gain.gain.exponentialRampToValueAtTime(volume || 0.14, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + duration + 0.02);
    } catch (e) { /* audio is a nicety, never a requirement */ }
  }
  function sound(kind, count) {
    if (kind === 'place') beep(360, 0.07, 'triangle');
    else if (kind === 'flip') {
      for (var i = 0; i < Math.min(count || 0, 8); i += 1) {
        (function (k) { window.setTimeout(function () { beep(760 + k * 40, 0.035, 'sine', 0.06); }, 120 + k * Math.max(RIPPLE_MS, 40)); }(i));
      }
    }
    else if (kind === 'pass') beep(220, 0.14, 'sine', 0.1);
    else if (kind === 'win') [523, 659, 784, 1047].forEach(function (n, k) { window.setTimeout(function () { beep(n, 0.16, 'sine'); }, k * 110); });
  }

  /* ------------------------------------------------------------- naming */
  function colourName(player) { return STYLE_NAMES[prefs.style][player === E.BLACK ? 0 : 1]; }
  function playerName(player) {
    if (prefs.mode === 'two') return colourName(player);
    return player === human ? 'You' : 'Computer';
  }
  function dot(player) {
    return '<span class="rv-dot ' + (player === E.BLACK ? 'is-black' : 'is-white') + '" aria-hidden="true"></span>';
  }

  /* ----------------------------------------------------------- board DOM */
  function buildBoard() {
    var size = state.size;
    els.board.dataset.size = String(size);
    els.grid.style.setProperty('--rv-size', String(size));
    els.grid.setAttribute('aria-label', 'Reversi board, ' + size + ' by ' + size);
    var html = '';
    for (var sq = 0; sq < size * size; sq += 1) {
      html += '<button type="button" class="rv-sq" data-sq="' + sq + '" tabindex="-1">' +
        '<span class="rv-piece" hidden><span class="rv-disc" data-colour="1">' +
        '<span class="rv-face is-black"></span><span class="rv-face is-white"></span></span></span></button>';
    }
    els.grid.innerHTML = html;
    squares = [];
    pieces = [];
    discs = [];
    Array.prototype.forEach.call(els.grid.querySelectorAll('[data-sq]'), function (node) {
      var sq = Number(node.dataset.sq);
      squares[sq] = node;
      pieces[sq] = node.querySelector('.rv-piece');
      discs[sq] = node.querySelector('.rv-disc');
    });
  }

  /* ------------------------------------------------------------- render */
  function interactive() {
    return !state.over && !busy && (prefs.mode === 'two' || state.turn === human);
  }

  function lastSquare() {
    for (var i = state.moves.length - 1; i >= 0; i -= 1) {
      if (state.moves[i].square >= 0) return state.moves[i].square;
    }
    return -1;
  }

  /* `options.placed` is the square just played and `options.flips` maps each
     flipped square to its ripple delay; without them changes still turn over,
     just all at once — which is what an undo looks like. */
  function render(options) {
    var opts = options || {};
    var size = state.size;
    var legal = interactive() ? E.legalMoves(state) : [];
    var legalSet = {};
    legal.forEach(function (sq) { legalSet[sq] = true; });
    var last = lastSquare();
    if (cursor === -1 || !squares[cursor]) cursor = legal.length ? legal[0] : (size / 2 - 1) * size + (size / 2 - 1);

    root.dataset.toMove = String(state.turn);
    root.dataset.legal = prefs.legal ? 'on' : 'off';
    els.board.classList.toggle('is-over', state.over);
    els.board.dataset.winner = state.over ? String(state.winner) : '';

    squares.forEach(function (node, sq) {
      var value = state.board[sq];
      var piece = pieces[sq];
      var disc = discs[sq];

      if (value === E.EMPTY) {
        piece.hidden = true;
        piece.classList.remove('is-placed', 'is-flipping');
      } else if (piece.hidden) {
        disc.style.transition = 'none';
        disc.dataset.colour = String(value);
        piece.hidden = false;
        void disc.offsetWidth;
        disc.style.transition = '';
        if (opts.placed === sq && FLIP_MS) {
          piece.classList.remove('is-placed');
          void piece.offsetWidth;
          piece.classList.add('is-placed');
        }
      } else if (disc.dataset.colour !== String(value)) {
        var delay = opts.flips && opts.flips[sq] !== undefined ? opts.flips[sq] : 0;
        disc.style.setProperty('--rv-delay', delay + 'ms');
        piece.style.setProperty('--rv-delay', delay + 'ms');
        if (FLIP_MS) {
          piece.classList.remove('is-flipping');
          void piece.offsetWidth;
          piece.classList.add('is-flipping');
        }
        disc.dataset.colour = String(value);
      }

      var cls = 'rv-sq';
      if (legalSet[sq]) cls += ' is-legal';
      if (hint === sq) cls += ' is-hint';
      if (sq === last) cls += ' is-last';
      node.className = cls;
      node.setAttribute('aria-label', squareLabel(sq, value, legalSet[sq]));
      node.setAttribute('aria-disabled', legalSet[sq] ? 'false' : 'true');
      node.tabIndex = sq === cursor ? 0 : -1;
    });

    els.undo.disabled = busy || history.length === 0;
    els.hint.disabled = !interactive();
    renderStatus(legal.length);
    renderCount();
    renderMoves();
    renderScore();
  }

  function squareLabel(sq, value, legal) {
    var name = E.squareName(state.size, sq);
    if (value !== E.EMPTY) {
      if (prefs.mode === 'two') return name + ', ' + colourName(value).toLowerCase() + ' disc';
      return name + ', ' + (value === human ? 'your' : 'computer\'s') + ' disc';
    }
    if (!legal) return name + ', empty';
    var trial = state.board.slice();
    var flips = E.applyMove(trial, sq, state.turn, state.size).length;
    return name + ', empty — playing here flips ' + flips + ' disc' + (flips === 1 ? '' : 's');
  }

  function renderStatus(options) {
    if (state.over) {
      els.turn.dataset.state = 'over';
      if (state.winner === E.EMPTY) els.turn.textContent = 'Drawn game';
      else els.turn.innerHTML = dot(state.winner) + playerName(state.winner) + (prefs.mode === 'cpu' && state.winner === human ? ' won!' : ' won');
      return;
    }
    if (busy && prefs.mode === 'cpu' && state.turn !== human) {
      els.turn.dataset.state = 'thinking';
      els.turn.innerHTML = dot(state.turn) + 'Computer is thinking…';
      return;
    }
    els.turn.dataset.state = 'play';
    var who = prefs.mode === 'cpu' ? (state.turn === human ? 'Your turn' : 'Computer to play') : colourName(state.turn) + ' to play';
    var count = options ? ' — ' + options + ' possible move' + (options === 1 ? '' : 's') : '';
    els.turn.innerHTML = dot(state.turn) + who + count;
  }

  function renderCount() {
    var c = E.counts(state.board);
    els.blackCount.textContent = c.black;
    els.whiteCount.textContent = c.white;
    els.blackName.textContent = prefs.mode === 'cpu' ? (human === E.BLACK ? 'You' : 'CPU') : colourName(E.BLACK);
    els.whiteName.textContent = prefs.mode === 'cpu' ? (human === E.WHITE ? 'You' : 'CPU') : colourName(E.WHITE);
    els.blackSide.classList.toggle('is-to-move', !state.over && state.turn === E.BLACK);
    els.whiteSide.classList.toggle('is-to-move', !state.over && state.turn === E.WHITE);
    els.blackSide.classList.toggle('is-winner', state.over && state.winner === E.BLACK);
    els.whiteSide.classList.toggle('is-winner', state.over && state.winner === E.WHITE);
    els.bar.parentNode.style.setProperty('--rv-share', (c.black + c.white ? (100 * c.black) / (c.black + c.white) : 50) + '%');
    els.bar.parentNode.setAttribute('aria-label', colourName(E.BLACK) + ' ' + c.black + ', ' + colourName(E.WHITE) + ' ' + c.white);
  }

  function renderMoves() {
    var list = state.moves;
    els.movesEmpty.hidden = list.length > 0;
    els.moves.hidden = list.length === 0;
    var html = '';
    var cell = function (index) {
      var move = list[index];
      if (!move) return '<span></span>';
      var classes = [];
      if (move.square < 0) classes.push('is-pass');
      if (index === list.length - 1) classes.push('is-latest');
      return '<span' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' +
        (move.square < 0 ? 'pass' : E.squareName(state.size, move.square)) + '</span>';
    };
    for (var i = 0; i < list.length; i += 2) {
      html += '<li><span class="n">' + (i / 2 + 1) + '.</span>' + cell(i) + cell(i + 1) + '</li>';
    }
    els.moves.innerHTML = html;
    els.moves.scrollTop = els.moves.scrollHeight;
  }

  function renderScore() {
    if (prefs.mode === 'two') {
      els.scoreTitle.textContent = 'This session, two players';
      els.wins.textContent = session.black;
      els.winLabel.textContent = colourName(E.BLACK);
      els.losses.textContent = session.white;
      els.lossLabel.textContent = colourName(E.WHITE);
      els.draws.textContent = session.draws;
      els.streak.textContent = 'Two-player games are not added to your score against the computer.';
      return;
    }
    els.scoreTitle.textContent = 'Your score vs the computer';
    els.wins.textContent = stats.wins;
    els.winLabel.textContent = 'Won';
    els.losses.textContent = stats.losses;
    els.lossLabel.textContent = 'Lost';
    els.draws.textContent = stats.draws;
    els.streak.textContent = stats.streak > 0
      ? 'Winning streak: ' + stats.streak + ' · best ' + stats.best
      : 'Best winning streak: ' + stats.best;
  }

  function announce(text, tone) {
    els.result.hidden = false;
    els.result.textContent = text;
    els.result.dataset.tone = tone || 'info';
  }

  function note(text) {
    if (!els.help) return;
    window.clearTimeout(timers.help);
    els.help.textContent = text;
    timers.help = window.setTimeout(function () { els.help.innerHTML = defaultHelp; }, 3400);
  }

  /* ----------------------------------------------------------- game flow */
  function humanPlaysBlack() {
    if (prefs.side === 'white') return false;
    if (prefs.side === 'alternate') return gamesPlayed % 2 === 0;
    return true;
  }

  function newGame() {
    token += 1;
    disarm();
    state = E.createState(prefs.size);
    human = prefs.mode === 'two' || humanPlaysBlack() ? E.BLACK : E.WHITE;
    history = [];
    busy = false;
    settled = false;
    hint = -1;
    cursor = -1;
    buildBoard();
    els.result.hidden = true;
    saveGame();
    render();
    if (prefs.mode === 'cpu' && state.turn !== human) scheduleComputer();
  }

  function onSquare(sq) {
    cursor = sq;
    if (!interactive()) {
      if (!busy) render();
      return;
    }
    if (!E.isLegal(state, sq)) {
      if (state.board[sq] === E.EMPTY) note('That square does not outflank anything — a move has to flip at least one disc.');
      return;
    }
    commit(sq, afterHuman);
  }

  function afterHuman() {
    if (prefs.mode === 'cpu' && !state.over && state.turn !== human) scheduleComputer();
  }

  /* Play `sq`, animate it, then report any pass the engine applied. */
  function commit(sq, done) {
    var myToken = token;
    var before = state;
    history.push(before);
    state = E.play(before, sq);
    busy = true;
    saveGame();                 // now, not after the flip: a reload mid-animation must keep the move
    hint = -1;
    window.clearTimeout(timers.hint);
    if (els.result.dataset.tone === 'info') els.result.hidden = true;

    var added = state.moves.slice(before.moves.length);
    var move = added[0];
    var size = state.size;
    var row = Math.floor(sq / size);
    var col = sq % size;
    var flips = {};
    var longest = 0;
    move.flipped.forEach(function (f) {
      var distance = Math.max(Math.abs(Math.floor(f / size) - row), Math.abs((f % size) - col));
      flips[f] = (distance - 1) * RIPPLE_MS;
      longest = Math.max(longest, flips[f]);
    });

    sound('place');
    sound('flip', move.flipped.length);
    render({ placed: sq, flips: flips });

    window.setTimeout(function () {
      if (myToken !== token) return;
      busy = false;
      pieces.forEach(function (piece, i) {
        piece.classList.remove('is-placed', 'is-flipping');
        piece.style.removeProperty('--rv-delay');
        discs[i].style.removeProperty('--rv-delay');
      });
      saveGame();
      render();
      if (finish()) return;
      if (added.length > 1) reportPass(added[1].player);
      if (done) done();
    }, FLIP_MS ? FLIP_MS + longest + 60 : 20);
  }

  function reportPass(passer) {
    sound('pass');
    if (prefs.mode === 'two') {
      announce(colourName(passer) + ' has no legal move and passes — ' + colourName(E.other(passer)) + ' plays again.', 'info');
    } else if (passer === human) {
      announce('You have no legal move, so you pass — the computer plays again.', 'info');
    } else {
      announce('The computer has no legal move and passes — your turn again.', 'info');
    }
  }

  /* Returns true when the game is over (and has been scored). */
  function finish() {
    if (!state.over) return false;
    if (settled) return true;
    settled = true;
    gamesPlayed += 1;
    var c = E.counts(state.board);
    var high = Math.max(c.black, c.white);
    var low = Math.min(c.black, c.white);

    if (state.winner === E.EMPTY) {
      if (prefs.mode === 'two') session.draws += 1;
      else { stats.draws += 1; stats.streak = 0; }
      announce('A draw — ' + c.black + ' discs each.', 'draw');
    } else if (prefs.mode === 'two') {
      session[state.winner === E.BLACK ? 'black' : 'white'] += 1;
      announce(colourName(state.winner) + ' wins ' + high + '–' + low + '.', 'win');
      celebrate();
    } else if (state.winner === human) {
      stats.wins += 1;
      stats.streak += 1;
      announce('You win ' + high + '–' + low + ' on ' + E.DIFFICULTY[prefs.difficulty].label + '!', 'win');
      celebrate();
    } else {
      stats.losses += 1;
      stats.streak = 0;
      announce('The computer wins ' + high + '–' + low + '. Undo takes your moves back.', 'loss');
    }

    if (stats.streak > stats.best) stats.best = stats.streak;
    if (prefs.mode === 'cpu') writeJSON(STORAGE_STATS, stats);
    saveGame();
    render();
    return true;
  }

  function celebrate() {
    sound('win');
    if (!els.confetti || reduceMotion) return;
    var colours = ['#10b981', '#fbbf24', '#60a5fa', '#f472b6', '#f8fafc'];
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 24; i += 1) {
      var bit = document.createElement('span');
      bit.className = 'confetti-piece';
      bit.style.left = (Math.random() * 100) + '%';
      bit.style.top = '0px';
      bit.style.background = colours[i % colours.length];
      bit.style.setProperty('--x', ((Math.random() - 0.5) * 220) + 'px');
      bit.style.animationDelay = (Math.random() * 120) + 'ms';
      fragment.appendChild(bit);
    }
    els.confetti.appendChild(fragment);
    window.setTimeout(function () { els.confetti.innerHTML = ''; }, 1600);
  }

  /* Deferred twice with timers, not requestAnimationFrame: rAF stalls in a
     background tab, which would leave the game frozen on "thinking". */
  function scheduleComputer() {
    var myToken = token;
    busy = true;
    render();
    window.setTimeout(function () {
      window.setTimeout(function () {
        if (myToken !== token) return;
        var sq;
        try {
          sq = E.chooseMove(state, prefs.difficulty, Math.random, { timeLimit: 800 });
        } catch (error) {
          sq = E.legalMoves(state)[0];            // never leave the game stuck on "thinking"
        }
        if (sq === null || sq === undefined) { busy = false; render(); return; }
        commit(sq, afterComputer);
      }, 260);
    }, 20);
  }

  function afterComputer() {
    if (prefs.mode === 'cpu' && !state.over && state.turn !== human) scheduleComputer();
  }

  function undo() {
    if (busy || !history.length) return;
    token += 1;
    state = history.pop();
    if (prefs.mode === 'cpu') {
      while (history.length && state.turn !== human) state = history.pop();
    }
    settled = false;
    hint = -1;
    els.result.hidden = true;
    saveGame();
    render();
    if (prefs.mode === 'cpu' && !state.over && state.turn !== human) scheduleComputer();
  }

  function showHint() {
    if (!interactive()) return;
    var myToken = token;
    busy = true;
    render();
    window.setTimeout(function () {
      if (myToken !== token) return;
      var picked = null;
      try { picked = E.bestMove(state, 6, { timeLimit: 600, endgame: 12 }); } catch (error) { picked = null; }
      busy = false;
      if (picked) {
        hint = picked.square;
        cursor = picked.square;
        note('Suggested: ' + E.squareName(state.size, picked.square) + ' — the pulsing square.');
        timers.hint = window.setTimeout(function () { hint = -1; render(); }, 4500);
      }
      render();
    }, 30);
  }

  function requestNewGame() {
    if (!state.over && state.moves.length >= 8 && !els.newGame.dataset.armed) {
      els.newGame.dataset.armed = 'true';
      els.newGame.textContent = '⚠️ Tap again to restart';
      timers.arm = window.setTimeout(disarm, 2800);
      return;
    }
    newGame();
  }
  function disarm() {
    window.clearTimeout(timers.arm);
    delete els.newGame.dataset.armed;
    els.newGame.textContent = '🔄 New game';
  }

  /* ------------------------------------------------------------ keyboard */
  function moveCursor(key) {
    var size = state.size;
    var from = cursor !== -1 ? cursor : 0;
    var row = Math.floor(from / size);
    var col = from % size;
    if (key === 'ArrowLeft') col = Math.max(0, col - 1);
    else if (key === 'ArrowRight') col = Math.min(size - 1, col + 1);
    else if (key === 'ArrowUp') row = Math.max(0, row - 1);
    else row = Math.min(size - 1, row + 1);
    var next = row * size + col;
    if (squares[cursor]) squares[cursor].tabIndex = -1;
    cursor = next;
    squares[next].tabIndex = 0;
    squares[next].focus();
  }

  els.grid.addEventListener('click', function (event) {
    var node = event.target.closest ? event.target.closest('[data-sq]') : null;
    if (node) onSquare(Number(node.dataset.sq));
  });
  els.grid.addEventListener('keydown', function (event) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(event.key) === -1) return;
    event.preventDefault();
    moveCursor(event.key);
  });

  document.addEventListener('keydown', function (event) {
    if (event.target && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    var key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); requestNewGame(); }
    else if (key === 'u') { event.preventDefault(); undo(); }
    else if (key === 'h') { event.preventDefault(); showHint(); }
  });

  /* -------------------------------------------------------------- controls */
  function syncControls() {
    els.modeButtons.forEach(function (button) {
      var on = button.dataset.mode === prefs.mode;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    els.difficulty.value = prefs.difficulty;
    els.side.value = prefs.side;
    els.boardSize.value = String(prefs.size);
    els.legal.checked = prefs.legal;
    els.difficultyWrap.hidden = prefs.mode !== 'cpu';
    els.sideWrap.hidden = prefs.mode !== 'cpu';
    els.sound.classList.toggle('is-active', prefs.sound);
    els.sound.setAttribute('aria-pressed', prefs.sound ? 'true' : 'false');
    els.sound.textContent = prefs.sound ? '🔊 Sound on' : '🔇 Sound off';
    root.dataset.style = prefs.style;
    root.dataset.legal = prefs.legal ? 'on' : 'off';
    els.styles.forEach(function (button) {
      var on = button.dataset.styleChoice === prefs.style;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  els.modeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (prefs.mode === button.dataset.mode) return;
      prefs.mode = button.dataset.mode;
      savePrefs();
      syncControls();
      newGame();
    });
  });

  els.difficulty.addEventListener('change', function () {
    if (!E.DIFFICULTY[els.difficulty.value]) return;
    prefs.difficulty = els.difficulty.value;
    savePrefs();
    if (state.moves.length && !state.over) note('The new level plays from the computer\'s next move.');
  });

  els.side.addEventListener('change', function () {
    prefs.side = els.side.value;
    savePrefs();
    newGame();
  });

  els.boardSize.addEventListener('change', function () {
    var size = Number(els.boardSize.value);
    if (E.SIZES.indexOf(size) === -1) return;
    prefs.size = size;
    savePrefs();
    newGame();
  });

  els.legal.addEventListener('change', function () {
    prefs.legal = els.legal.checked;
    savePrefs();
    render();
  });

  els.styles.forEach(function (button) {
    button.addEventListener('click', function () {
      prefs.style = button.dataset.styleChoice;
      savePrefs();
      syncControls();
      render();
    });
  });

  els.sound.addEventListener('click', function () {
    prefs.sound = !prefs.sound;
    savePrefs();
    syncControls();
    sound('place');
  });

  els.newGame.addEventListener('click', requestNewGame);
  els.undo.addEventListener('click', undo);
  els.hint.addEventListener('click', showHint);

  els.resetScore.addEventListener('click', function () {
    if (prefs.mode === 'two') session = { black: 0, white: 0, draws: 0 };
    else {
      stats = E.defaultStats();
      writeJSON(STORAGE_STATS, stats);
    }
    renderScore();
  });

  /* ----------------------------------------------------------------- boot */
  loadPrefs();
  stats = E.normalizeStats(readJSON(STORAGE_STATS));
  syncControls();

  if (restoreGame()) {
    buildBoard();
    render();
    note('Welcome back — your game has been restored where you left it.');
    if (prefs.mode === 'cpu' && state.turn !== human) scheduleComputer();
  } else {
    newGame();
  }
}());
