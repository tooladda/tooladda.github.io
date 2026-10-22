/* ==========================================================================
   ToolAdda — Checkers (interface)

   All the rules and the opponent live in checkers-engine.js; this file only
   turns a state into DOM and turns taps into moves. What it is careful about:

   · A multiple capture is entered one landing at a time, but nothing is
     committed until the sequence is complete — and as soon as only one way
     to finish remains, the rest of it is played for you.
   · The board is drawn from the player's side: against the computer your
     pieces sit at the bottom whichever colour you play.
   · Every state the game passes through is kept, so undo works at any
     depth and, against the computer, returns you to your own last decision.
   · The game in progress is saved as a move list and replayed through the
     rules on the next visit. A reload never loses a long game, and a save
     edited by hand cannot produce a position the rules would not allow.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.CheckersEngine;
  var root = document.querySelector('[data-checkers]');
  if (!root || !E) return;

  var STORAGE_STATS = 'tooladda-checkers-stats';
  var STORAGE_PREFS = 'tooladda-checkers-prefs';
  var STORAGE_GAME = 'tooladda-checkers-game';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var HOP_MS = reduceMotion ? 0 : 210;
  var TAKE_MS = reduceMotion ? 0 : 220;

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };
  var els = {
    board: $('[data-board]'),
    grid: $('[data-grid]'),
    turn: $('[data-turn]'),
    tally: $('[data-tally]'),
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
    variant: $('[data-variant]'),
    numbers: $('[data-numbers-toggle]'),
    movable: $('[data-movable-toggle]'),
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

  /* Each set names its two colours, so "Red to play" matches what is on screen. */
  var STYLE_NAMES = {
    wood: ['Black', 'White'],
    classic: ['Black', 'Red'],
    contrast: ['Blue', 'Orange'],
    ocean: ['Navy', 'Gold']
  };

  var prefs = {
    mode: 'cpu', difficulty: 'medium', side: 'first', variant: 'american',
    style: 'wood', numbers: false, movable: true, sound: false
  };
  var stats = E.defaultStats();
  var session = { dark: 0, light: 0, draws: 0 };   // two-player games, never saved
  var state = E.createState(prefs.variant);
  var history = [];
  var human = E.DARK;        // the colour the visitor plays against the computer
  var gamesPlayed = 0;
  var busy = false;          // a move is animating or the computer is searching
  var settled = false;       // the finished game has already been scored
  var selected = -1;         // the square of the piece being moved
  var partial = [];          // landings already entered for a multiple capture
  var hint = null;           // { from, path } until the next action
  var cursor = -1;           // the square holding keyboard focus
  var flipped = false;       // dark (the engine's top side) is drawn at the bottom
  var squares = [];          // dark-square buttons by engine index
  var token = 0;             // bumped by new game and undo, so stale timers stand down
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
    if (['first', 'second', 'alternate'].indexOf(saved.side) !== -1) prefs.side = saved.side;
    if (E.VARIANTS[saved.variant]) prefs.variant = saved.variant;
    if (STYLE_NAMES[saved.style]) prefs.style = saved.style;
    prefs.numbers = saved.numbers === true;
    prefs.movable = saved.movable !== false;
    prefs.sound = saved.sound === true;
  }
  function savePrefs() { writeJSON(STORAGE_PREFS, prefs); }

  function saveGame() {
    if (state.result || !state.moves.length) { removeKey(STORAGE_GAME); return; }
    writeJSON(STORAGE_GAME, {
      v: 1, variant: state.variant, mode: prefs.mode, human: human,
      games: gamesPlayed, moves: E.serializeMoves(state)
    });
  }

  /* The saved move list goes back through the rules one move at a time; the
     undo history is rebuilt on the way, so undo still works after a reload. */
  function restoreGame() {
    var saved = readJSON(STORAGE_GAME);
    if (!saved || saved.v !== 1 || saved.variant !== prefs.variant || saved.mode !== prefs.mode) return false;
    if (saved.human !== E.DARK && saved.human !== E.LIGHT) return false;
    var replayed = E.replay(saved.variant, saved.moves);
    if (!replayed || replayed.result || !replayed.moves.length) return false;

    history = [];
    var walk = E.createState(saved.variant);
    replayed.moves.forEach(function (move) {
      history.push(walk);
      walk = E.play(walk, move);
    });
    state = walk;
    human = prefs.mode === 'two' ? E.rulesFor(state.variant).first : saved.human;
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
  function sound(kind) {
    if (kind === 'move') beep(300, 0.07, 'triangle');
    else if (kind === 'select') beep(540, 0.04, 'sine', 0.08);
    else if (kind === 'capture') beep(170, 0.1, 'square', 0.07);
    else if (kind === 'crown') [660, 880].forEach(function (n, i) { window.setTimeout(function () { beep(n, 0.12, 'sine'); }, i * 90); });
    else if (kind === 'win') [523, 659, 784, 1047].forEach(function (n, i) { window.setTimeout(function () { beep(n, 0.16, 'sine'); }, i * 110); });
  }

  /* ------------------------------------------------------------- naming */
  function colourName(player) { return STYLE_NAMES[prefs.style][player === E.DARK ? 0 : 1]; }
  function playerName(player) {
    if (prefs.mode === 'two') return colourName(player);
    return player === human ? 'You' : 'Computer';
  }
  function dot(player) {
    return '<span class="ck-dot ' + (player === E.DARK ? 'is-p1' : 'is-p2') + '" aria-hidden="true"></span>';
  }
  function describePiece(value) {
    var kind = E.isKing(value) ? 'king' : 'man';
    var owner = E.ownerOf(value);
    if (prefs.mode === 'two') return colourName(owner) + ' ' + kind;
    return (owner === human ? 'your ' : 'computer ') + kind;
  }

  /* ------------------------------------------------------------ geometry */
  function visual(sq) {
    var size = state.size;
    var r = Math.floor(sq / size);
    var c = sq % size;
    return flipped ? { r: size - 1 - r, c: size - 1 - c } : { r: r, c: c };
  }
  function toSquare(r, c) {
    var size = state.size;
    return flipped ? (size - 1 - r) * size + (size - 1 - c) : r * size + c;
  }
  /* The side at the bottom: yours against the computer, the side that moves
     first in a two-player game. The engine keeps dark at the top. */
  function computeFlip() {
    var bottom = prefs.mode === 'two' ? E.rulesFor(state.variant).first : human;
    return bottom === E.DARK;
  }

  /* ----------------------------------------------------------- board DOM */
  function buildBoard() {
    var size = state.size;
    var g = E.geometry(size);
    els.board.dataset.size = String(size);
    els.grid.style.setProperty('--ck-size', String(size));
    els.grid.setAttribute('aria-label', E.rulesFor(state.variant).label + ' board, ' + size + ' by ' + size);

    var html = '';
    for (var r = 0; r < size; r += 1) {
      for (var c = 0; c < size; c += 1) {
        var sq = toSquare(r, c);
        if (g.number[sq]) {
          html += '<button type="button" class="ck-sq is-dark" data-sq="' + sq + '" tabindex="-1"></button>';
        } else {
          html += '<span class="ck-sq is-light" aria-hidden="true"></span>';
        }
      }
    }
    els.grid.innerHTML = html;
    squares = [];
    Array.prototype.forEach.call(els.grid.querySelectorAll('[data-sq]'), function (node) {
      squares[Number(node.dataset.sq)] = node;
    });
  }

  function pieceHtml(value, extra) {
    return '<span class="ck-piece ' + (value > 0 ? 'is-p1' : 'is-p2') + (E.isKing(value) ? ' is-king' : '') + (extra || '') + '">' +
      '<span class="ck-disc"><span class="ck-crown"></span></span></span>';
  }
  function pieceAt(sq) { return squares[sq] ? squares[sq].querySelector('.ck-piece') : null; }

  /* ------------------------------------------------------------- render */
  function interactive() {
    return !state.result && !busy && (prefs.mode === 'two' || state.turn === human);
  }

  function startsWith(path, prefix) {
    for (var i = 0; i < prefix.length; i += 1) if (path[i] !== prefix[i]) return false;
    return true;
  }

  function candidatesFor(moves) {
    if (selected === -1) return [];
    return moves.filter(function (move) { return move.from === selected && startsWith(move.path, partial); });
  }

  function render() {
    var moves = interactive() ? E.legalMoves(state) : [];
    var forced = moves.length > 0 && moves[0].captures.length > 0;
    var movers = {};
    moves.forEach(function (move) { movers[move.from] = true; });

    if (selected !== -1 && !movers[selected]) { selected = -1; partial = []; }
    var candidates = candidatesFor(moves);
    var targets = {};
    candidates.forEach(function (move) {
      var next = move.path[partial.length];
      if (next !== undefined) targets[next] = move.captures.length ? 'jump' : 'step';
    });

    /* Mid-capture the move is not committed yet, so the piece is drawn where
       the player has walked it and the pieces it has jumped are faded. */
    var board = state.board.slice();
    var pending = {};
    var walked = {};
    var lifted = selected;
    if (selected !== -1 && partial.length && candidates.length) {
      var moving = board[selected];
      board[selected] = E.EMPTY;
      lifted = partial[partial.length - 1];
      board[lifted] = moving;
      candidates[0].captures.slice(0, partial.length).forEach(function (sq) { pending[sq] = true; });
      partial.forEach(function (sq) { walked[sq] = true; });
    }

    var last = state.moves.length ? state.moves[state.moves.length - 1] : null;
    var hinted = {};
    if (hint) [hint.from].concat(hint.path).forEach(function (sq) { hinted[sq] = true; });
    if (cursor === -1 || !squares[cursor]) cursor = firstFocus(moves);

    squares.forEach(function (node, sq) {
      if (!node) return;
      var value = board[sq];
      var cls = 'ck-sq is-dark';
      if (last && !partial.length && (sq === last.from || sq === E.destination(last))) cls += ' is-last';
      if (sq === selected && !partial.length) cls += ' is-selected';
      if (walked[sq]) cls += ' is-path';
      if (targets[sq]) cls += ' is-target' + (targets[sq] === 'jump' ? ' is-jump' : '');
      if (hinted[sq]) cls += ' is-hint';
      node.className = cls;

      var html = '<span class="ck-num" aria-hidden="true">' + E.squareName(state.variant, sq) + '</span>';
      if (value !== E.EMPTY) {
        var extra = '';
        if (sq === lifted && selected !== -1) extra += ' is-lifted';
        if (pending[sq]) extra += ' is-pending';
        if (movers[sq] && selected === -1) extra += forced ? ' is-must' : (prefs.movable ? ' is-movable' : '');
        html += pieceHtml(value, extra);
      }
      node.innerHTML = html;

      var label = 'Square ' + E.squareName(state.variant, sq);
      if (value !== E.EMPTY) label += ', ' + describePiece(value);
      if (targets[sq]) label += targets[sq] === 'jump' ? ', capture by landing here' : ', move here';
      else if (movers[sq] && selected === -1) label += forced ? ', must capture' : ', can move';
      if (sq === selected) label += ', selected';
      node.setAttribute('aria-label', label);
      node.setAttribute('aria-disabled', interactive() ? 'false' : 'true');
      node.tabIndex = sq === cursor ? 0 : -1;
    });

    els.undo.disabled = busy || history.length === 0;
    els.hint.disabled = !interactive();
    renderStatus(forced);
    renderTally();
    renderMoves();
    renderScore();
  }

  function firstFocus(moves) {
    if (moves && moves.length) return moves[0].from;
    for (var sq = 0; sq < squares.length; sq += 1) if (squares[sq]) return sq;
    return -1;
  }

  function renderStatus(forced) {
    var result = state.result;
    if (result) {
      els.turn.dataset.state = 'over';
      if (result.winner === E.EMPTY) els.turn.textContent = 'Drawn game';
      else els.turn.innerHTML = dot(result.winner) + playerName(result.winner) + (prefs.mode === 'cpu' && result.winner === human ? ' won!' : ' won');
      return;
    }
    if (busy && prefs.mode === 'cpu' && state.turn !== human) {
      els.turn.dataset.state = 'thinking';
      els.turn.innerHTML = dot(state.turn) + 'Computer is thinking…';
      return;
    }
    els.turn.dataset.state = 'play';
    var who = prefs.mode === 'cpu' ? (state.turn === human ? 'Your turn' : 'Computer to play') : colourName(state.turn) + ' to play';
    var extra = '';
    if (partial.length) extra = ' — keep jumping';
    else if (forced) extra = ' — a capture is compulsory';
    els.turn.innerHTML = dot(state.turn) + who + extra;
  }

  function renderTally() {
    var counts = E.pieceCounts(state.board);
    var chip = function (player, c) {
      var kings = c.kings ? ' <small>· ' + c.kings + ' king' + (c.kings === 1 ? '' : 's') + '</small>' : '';
      return '<span>' + dot(player) + colourName(player) + ' ' + (c.men + c.kings) + kings + '</span>';
    };
    els.tally.innerHTML = chip(E.DARK, counts.dark) + chip(E.LIGHT, counts.light);
  }

  function renderMoves() {
    var list = state.moves;
    els.movesEmpty.hidden = list.length > 0;
    els.moves.hidden = list.length === 0;
    var html = '';
    for (var i = 0; i < list.length; i += 2) {
      var cell = function (index) {
        if (!list[index]) return '<span></span>';
        return '<span' + (index === list.length - 1 ? ' class="is-latest"' : '') + '>' + E.moveNotation(state.variant, list[index]) + '</span>';
      };
      html += '<li><span class="n">' + (i / 2 + 1) + '.</span>' + cell(i) + cell(i + 1) + '</li>';
    }
    els.moves.innerHTML = html;
    els.moves.scrollTop = els.moves.scrollHeight;
  }

  function renderScore() {
    if (prefs.mode === 'two') {
      els.scoreTitle.textContent = 'This session, two players';
      els.wins.textContent = session.dark;
      els.winLabel.textContent = colourName(E.DARK);
      els.losses.textContent = session.light;
      els.lossLabel.textContent = colourName(E.LIGHT);
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

  function shake(sq) {
    var piece = pieceAt(sq);
    if (!piece) return;
    piece.classList.remove('is-shake');
    void piece.offsetWidth;
    piece.classList.add('is-shake');
  }

  /* ----------------------------------------------------------- game flow */
  function humanMovesFirst() {
    if (prefs.side === 'second') return false;
    if (prefs.side === 'alternate') return gamesPlayed % 2 === 0;
    return true;
  }

  function resetInput() {
    selected = -1;
    partial = [];
    hint = null;
    window.clearTimeout(timers.hint);
  }

  function newGame() {
    token += 1;
    disarm();
    state = E.createState(prefs.variant);
    var first = E.rulesFor(prefs.variant).first;
    human = prefs.mode === 'two' || humanMovesFirst() ? first : E.other(first);
    history = [];
    busy = false;
    settled = false;
    resetInput();
    flipped = computeFlip();
    cursor = -1;
    buildBoard();
    els.result.hidden = true;
    saveGame();
    render();
    if (prefs.mode === 'cpu' && state.turn !== human) scheduleComputer();
  }

  function onSquare(sq) {
    cursor = sq;
    /* never redraw mid-animation: the piece in flight would be drawn twice */
    if (!interactive()) { if (!busy) render(); return; }
    if (hint) { hint = null; window.clearTimeout(timers.hint); }
    var moves = E.legalMoves(state);

    if (partial.length) {
      if (!stepTo(sq, moves)) note('Keep jumping — choose one of the ringed squares, or press Esc to start the move again.');
      return;
    }
    if (selected !== -1 && stepTo(sq, moves)) return;

    var value = state.board[sq];
    if (value !== E.EMPTY && E.ownerOf(value) === state.turn) {
      if (moves.some(function (move) { return move.from === sq; })) {
        selected = selected === sq ? -1 : sq;
        sound('select');
        render();
        return;
      }
      shake(sq);
      note(moves.length && moves[0].captures.length
        ? 'A capture is compulsory — one of the pulsing pieces has to take.'
        : 'That piece has no legal move.');
      return;
    }
    if (selected !== -1) {
      selected = -1;
      render();
    }
  }

  /* Enter one landing. Returns false when `sq` is not a legal next landing. */
  function stepTo(sq, moves) {
    var candidates = candidatesFor(moves).filter(function (move) { return move.path[partial.length] === sq; });
    if (!candidates.length) return false;
    var shown = partial.length;
    if (candidates.length === 1) {
      perform(candidates[0], shown, 0, afterHuman);
      return true;
    }
    var previous = shown ? partial[shown - 1] : selected;
    partial.push(sq);
    sound('capture');
    render();
    slideIn(sq, previous);
    return true;
  }

  function afterHuman() {
    if (prefs.mode === 'cpu' && !state.result && state.turn !== human) scheduleComputer();
  }

  function hopTime(from, to) {
    if (!HOP_MS) return 0;
    var a = visual(from);
    var b = visual(to);
    return Math.min(440, HOP_MS + (Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) - 1) * 45);
  }

  /* Slide a piece into `to` from `from`: move the element, offset it back by
     the whole-square distance, then let the transition carry it home. */
  function animateHop(piece, from, to, ms) {
    var target = squares[to];
    if (!piece || !target) return;
    if (piece.parentNode && piece.parentNode.classList) piece.parentNode.classList.remove('is-moving');
    target.appendChild(piece);
    if (!ms) return;
    var a = visual(from);
    var b = visual(to);
    target.classList.add('is-moving');
    piece.style.setProperty('--ck-hop', ms + 'ms');
    piece.style.transition = 'none';
    piece.style.transform = 'translate(' + ((a.c - b.c) * 100) + '%, ' + ((a.r - b.r) * 100) + '%)';
    void piece.offsetWidth;
    piece.style.transition = '';
    piece.style.transform = '';
  }

  function slideIn(sq, from) {
    var ms = hopTime(from, sq);
    var piece = pieceAt(sq);
    if (!piece || !ms) return;
    squares[sq].removeChild(piece);
    animateHop(piece, from, sq, ms);
  }

  /* Commit a move and animate what is left of it. `shown` is how many of its
     landings are already on screen; `lead` holds the piece up before it goes,
     so a computer move can be followed by eye. */
  function perform(move, shown, lead, done) {
    var myToken = token;
    var hops = [move.from].concat(move.path);
    var piece = pieceAt(hops[shown]);

    history.push(E.cloneState(state));
    state = E.play(state, move);
    busy = true;
    saveGame();                 // now, not after the animation: a reload mid-move must keep it
    resetInput();
    els.undo.disabled = true;
    els.hint.disabled = true;
    squares.forEach(function (node) {
      if (node) node.classList.remove('is-target', 'is-jump', 'is-selected', 'is-path', 'is-hint', 'is-last');
    });
    Array.prototype.forEach.call(els.grid.querySelectorAll('.is-must, .is-movable'), function (node) {
      node.classList.remove('is-must', 'is-movable');
    });
    if (piece) piece.classList.add('is-lifted');

    var step = shown + 1;
    function advance() {
      if (myToken !== token) return;
      if (step >= hops.length) { land(); return; }
      var from = hops[step - 1];
      var to = hops[step];
      var ms = hopTime(from, to);
      animateHop(piece, from, to, ms);
      if (move.captures.length) {
        var taken = pieceAt(move.captures[step - 1]);
        if (taken) taken.classList.add('is-pending');
        sound('capture');
      } else {
        sound('move');
      }
      step += 1;
      window.setTimeout(advance, ms);
    }

    function land() {
      move.captures.forEach(function (sq) {
        var taken = pieceAt(sq);
        if (taken && taken !== piece) {
          taken.classList.remove('is-pending');
          taken.classList.add('is-taken');
        }
      });
      if (piece) {
        piece.classList.remove('is-lifted');
        if (move.promotes) { piece.classList.add('is-king'); sound('crown'); }
      }
      window.setTimeout(function () {
        if (myToken !== token) return;
        busy = false;
        saveGame();
        render();
        if (finish()) return;
        if (done) done();
      }, move.captures.length || move.promotes ? TAKE_MS + 80 : 30);
    }

    window.setTimeout(advance, lead || 0);
  }

  /* Returns true when the game is over (and has been scored). */
  function finish() {
    var result = state.result;
    if (!result) return false;
    if (settled) return true;
    settled = true;
    gamesPlayed += 1;
    var why = reasonText(result);

    if (result.winner === E.EMPTY) {
      if (prefs.mode === 'two') session.draws += 1;
      else { stats.draws += 1; stats.streak = 0; }
      announce('Draw — ' + why + '.', 'draw');
    } else if (prefs.mode === 'two') {
      session[result.winner === E.DARK ? 'dark' : 'light'] += 1;
      announce(colourName(result.winner) + ' wins — ' + why + '.', 'win');
      celebrate();
    } else if (result.winner === human) {
      stats.wins += 1;
      stats.streak += 1;
      announce('You win on ' + E.DIFFICULTY[prefs.difficulty].label + ' — ' + why + '.', 'win');
      celebrate();
    } else {
      stats.losses += 1;
      stats.streak = 0;
      announce('The computer wins — ' + why + '. Undo takes your moves back.', 'loss');
    }

    if (stats.streak > stats.best) stats.best = stats.streak;
    if (prefs.mode === 'cpu') writeJSON(STORAGE_STATS, stats);
    saveGame();
    render();
    return true;
  }

  function reasonText(result) {
    var loser = E.other(result.winner);
    var subject = prefs.mode === 'two' ? colourName(loser) + ' has' : (loser === human ? 'you have' : 'the computer has');
    if (result.reason === 'captured') return subject + ' no pieces left';
    if (result.reason === 'blocked') return subject + ' no legal move left';
    if (result.reason === 'repetition') return 'the same position came up three times';
    return (E.rulesFor(state.variant).drawPlies / 2) + ' moves each with no capture and no man moved';
  }

  function celebrate() {
    sound('win');
    if (!els.confetti || reduceMotion) return;
    var colours = ['#ef4444', '#fbbf24', '#60a5fa', '#34d399', '#f472b6'];
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

  /* Deferred twice, both times with timers: once so "thinking" is painted,
     once more so the paint lands before the search holds the main thread.
     requestAnimationFrame would stall in a background tab and leave the game
     frozen on "thinking" until the tab came back. */
  function scheduleComputer() {
    var myToken = token;
    busy = true;
    render();
    window.setTimeout(function () {
      window.setTimeout(function () {
        if (myToken !== token) return;
        var move;
        try {
          move = E.chooseMove(state, prefs.difficulty, Math.random, { timeLimit: 800 });
        } catch (error) {
          move = E.legalMoves(state)[0];       // never leave the game stuck on "thinking"
        }
        if (!move) { busy = false; render(); return; }
        perform(move, 0, reduceMotion ? 0 : 160, null);
      }, 200);
    }, 20);
  }

  function undo() {
    if (busy || !history.length) return;
    token += 1;
    state = history.pop();
    if (prefs.mode === 'cpu') {
      while (history.length && state.turn !== human) state = history.pop();
    }
    settled = false;
    resetInput();
    els.result.hidden = true;
    saveGame();
    render();
    if (prefs.mode === 'cpu' && state.turn !== human && !state.result) scheduleComputer();
  }

  function showHint() {
    if (!interactive()) return;
    var myToken = token;
    busy = true;
    render();
    window.setTimeout(function () {
      if (myToken !== token) return;
      var picked = null;
      try { picked = E.bestMove(state, 8, { timeLimit: 600 }); } catch (error) { picked = null; }
      busy = false;
      resetInput();
      if (picked) {
        hint = { from: picked.move.from, path: picked.move.path };
        note('Suggested: ' + E.moveNotation(state.variant, picked.move) + ' — the highlighted piece and squares.');
        timers.hint = window.setTimeout(function () { hint = null; render(); }, 4500);
      }
      render();
    }, 30);
  }

  /* A long game is not thrown away by one stray tap: New game asks twice. */
  function requestNewGame() {
    if (!state.result && state.moves.length >= 6 && !els.newGame.dataset.armed) {
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
  /* Arrows walk the dark squares. Each row holds size/2 of them, so the
     position within the row is kept when moving up or down — which makes
     every arrow press reversible. Enter and Space are the buttons' own. */
  function moveCursor(key) {
    var size = state.size;
    var from = cursor !== -1 && squares[cursor] ? cursor : firstFocus();
    var v = visual(from);
    var row = v.r;
    var slot = Math.floor(v.c / 2);
    if (key === 'ArrowLeft') slot = Math.max(0, slot - 1);
    else if (key === 'ArrowRight') slot = Math.min(size / 2 - 1, slot + 1);
    else if (key === 'ArrowUp') row = Math.max(0, row - 1);
    else row = Math.min(size - 1, row + 1);
    var next = toSquare(row, row % 2 === 0 ? 2 * slot + 1 : 2 * slot);
    if (!squares[next]) return;
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
    if (key === 'escape' && (selected !== -1 || partial.length)) {
      resetInput();
      render();
    } else if (key === 'n') {
      event.preventDefault();
      requestNewGame();
    } else if (key === 'u') {
      event.preventDefault();
      undo();
    } else if (key === 'h') {
      event.preventDefault();
      showHint();
    }
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
    els.variant.value = prefs.variant;
    els.numbers.checked = prefs.numbers;
    els.movable.checked = prefs.movable;
    els.difficultyWrap.hidden = prefs.mode !== 'cpu';
    els.sideWrap.hidden = prefs.mode !== 'cpu';
    els.sound.classList.toggle('is-active', prefs.sound);
    els.sound.setAttribute('aria-pressed', prefs.sound ? 'true' : 'false');
    els.sound.textContent = prefs.sound ? '🔊 Sound on' : '🔇 Sound off';
    root.dataset.numbers = prefs.numbers ? 'on' : 'off';
    root.dataset.style = prefs.style;
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
    if (state.moves.length && !state.result) note('The new level plays from the computer\'s next move.');
  });

  els.side.addEventListener('change', function () {
    prefs.side = els.side.value;
    savePrefs();
    newGame();
  });

  els.variant.addEventListener('change', function () {
    if (!E.VARIANTS[els.variant.value]) return;
    prefs.variant = els.variant.value;
    savePrefs();
    newGame();
  });

  els.numbers.addEventListener('change', function () {
    prefs.numbers = els.numbers.checked;
    root.dataset.numbers = prefs.numbers ? 'on' : 'off';
    savePrefs();
  });

  els.movable.addEventListener('change', function () {
    prefs.movable = els.movable.checked;
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
    sound('move');
  });

  els.newGame.addEventListener('click', requestNewGame);
  els.undo.addEventListener('click', undo);
  els.hint.addEventListener('click', showHint);

  els.resetScore.addEventListener('click', function () {
    if (prefs.mode === 'two') session = { dark: 0, light: 0, draws: 0 };
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
    flipped = computeFlip();
    buildBoard();
    render();
    note('Welcome back — your game has been restored where you left it.');
    if (prefs.mode === 'cpu' && state.turn !== human) scheduleComputer();
  } else {
    newGame();
  }
}());
