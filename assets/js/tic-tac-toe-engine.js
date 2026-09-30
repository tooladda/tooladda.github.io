/* ==========================================================================
   ToolAdda — Tic Tac Toe (engine)

   Board rules, win detection and the computer opponent, with no DOM. A
   3x3 game is small enough to solve exactly, which means the hard opponent
   is not "clever" — it is provably unbeatable, and the test suite proves it
   by playing every game that can be played.

   The detail most implementations get wrong is DEPTH. A plain minimax
   scores every win as +10 and every loss as -10, so it cannot tell a win
   in one move from a win in five, or a loss now from a loss in three. That
   produces an opponent which:

     · declines an immediate win in favour of a slower one, and
     · walks straight into a loss instead of making you work for it.

   Scoring wins as (10 - depth) and losses as (depth - 10) makes the search
   prefer the fastest win and the slowest loss, which is what a human reads
   as "playing properly".
   ========================================================================== */
(function (global) {
  'use strict';

  var X = 'X';
  var O = 'O';
  var EMPTY = '';

  /* All eight ways to make a line, as board indices. */
  var LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],   /* rows    */
    [0, 3, 6], [1, 4, 7], [2, 5, 8],   /* columns */
    [0, 4, 8], [2, 4, 6]               /* diagonals */
  ];

  var CORNERS = [0, 2, 6, 8];
  var EDGES = [1, 3, 5, 7];
  var CENTER = 4;

  /* ======================================================================
     1. Board basics
     ====================================================================== */

  function emptyBoard() {
    return [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  }

  function isValidBoard(board) {
    return Array.isArray(board) && board.length === 9 &&
      board.every(function (c) { return c === X || c === O || c === EMPTY; });
  }

  function availableMoves(board) {
    var out = [];
    for (var i = 0; i < 9; i++) if (board[i] === EMPTY) out.push(i);
    return out;
  }

  function isFull(board) {
    return availableMoves(board).length === 0;
  }

  /** The winning line for a player, or null. */
  function winningLine(board, player) {
    for (var i = 0; i < LINES.length; i++) {
      var l = LINES[i];
      if (board[l[0]] === player && board[l[1]] === player && board[l[2]] === player) return l;
    }
    return null;
  }

  /**
   * @returns {{winner: 'X'|'O'|null, line: number[]|null, draw: boolean, over: boolean}}
   */
  function evaluate(board) {
    var xLine = winningLine(board, X);
    if (xLine) return { winner: X, line: xLine, draw: false, over: true };
    var oLine = winningLine(board, O);
    if (oLine) return { winner: O, line: oLine, draw: false, over: true };
    if (isFull(board)) return { winner: null, line: null, draw: true, over: true };
    return { winner: null, line: null, draw: false, over: false };
  }

  /** Apply a move to a copy. Never mutates the board handed in. */
  function play(board, index, player) {
    var next = board.slice();
    if (index >= 0 && index < 9 && next[index] === EMPTY) next[index] = player;
    return next;
  }

  function opponentOf(player) { return player === X ? O : X; }

  /* ======================================================================
     2. Minimax, depth-aware

     The board has at most 9! = 362,880 orderings, so the full tree is tiny
     and there is no need for pruning to keep it fast. Correctness is worth
     more here than cleverness.
     ====================================================================== */

  /**
   * @param {Array} board
   * @param {string} player   the side whose turn it is
   * @param {string} me       the side being scored for
   * @param {number} depth    plies from the root
   */
  function minimax(board, player, me, depth) {
    var result = evaluate(board);
    if (result.over) {
      if (!result.winner) return 0;
      /* Subtracting depth makes a win now worth more than the same win
         later, and a loss later less bad than a loss now. */
      return result.winner === me ? 10 - depth : depth - 10;
    }

    var moves = availableMoves(board);
    var maximizing = player === me;
    var best = maximizing ? -Infinity : Infinity;

    for (var i = 0; i < moves.length; i++) {
      var score = minimax(play(board, moves[i], player), opponentOf(player), me, depth + 1);
      best = maximizing ? Math.max(best, score) : Math.min(best, score);
    }
    return best;
  }

  /**
   * The best move for `player`, with ties broken deterministically unless a
   * random function is supplied. Returns null when the game is already over.
   */
  function bestMove(board, player, rng) {
    if (!isValidBoard(board)) return null;
    if (evaluate(board).over) return null;

    var moves = availableMoves(board);
    if (!moves.length) return null;

    var bestScore = -Infinity;
    var tied = [];
    for (var i = 0; i < moves.length; i++) {
      var score = minimax(play(board, moves[i], player), opponentOf(player), player, 1);
      if (score > bestScore) { bestScore = score; tied = [moves[i]]; }
      else if (score === bestScore) tied.push(moves[i]);
    }
    /* Equally good moves are genuinely equal, so varying between them keeps
       repeated games from being identical without weakening play. */
    if (typeof rng === 'function' && tied.length > 1) {
      return tied[Math.floor(rng() * tied.length) % tied.length];
    }
    return tied[0];
  }

  /* ======================================================================
     3. Tactics used by the easier opponents
     ====================================================================== */

  /** A square that completes a line for `player` this move, or null. */
  function winningMove(board, player) {
    var moves = availableMoves(board);
    for (var i = 0; i < moves.length; i++) {
      if (winningLine(play(board, moves[i], player), player)) return moves[i];
    }
    return null;
  }

  /** The square that stops the opponent winning next move, or null. */
  function blockingMove(board, player) {
    return winningMove(board, opponentOf(player));
  }

  function pickFrom(list, board, rng) {
    var open = list.filter(function (i) { return board[i] === EMPTY; });
    if (!open.length) return null;
    var r = typeof rng === 'function' ? rng() : 0;
    return open[Math.floor(r * open.length) % open.length];
  }

  var DIFFICULTIES = ['easy', 'medium', 'hard'];

  /**
   * easy   — random. Genuinely beatable, which is the point.
   * medium — takes a win, blocks a loss, otherwise prefers centre then a
   *          corner. Beatable by a player who plans two moves ahead.
   * hard   — full depth-aware search. Cannot be beaten; the best available
   *          result against it is a draw.
   */
  function chooseMove(board, player, difficulty, rng) {
    if (!isValidBoard(board) || evaluate(board).over) return null;
    var level = DIFFICULTIES.indexOf(difficulty) === -1 ? 'hard' : difficulty;

    if (level === 'easy') return pickFrom(availableMoves(board), board, rng);

    if (level === 'medium') {
      var win = winningMove(board, player);
      if (win !== null) return win;
      var block = blockingMove(board, player);
      if (block !== null) return block;
      if (board[CENTER] === EMPTY) return CENTER;
      var corner = pickFrom(CORNERS, board, rng);
      if (corner !== null) return corner;
      return pickFrom(EDGES.concat(availableMoves(board)), board, rng);
    }

    return bestMove(board, player, rng);
  }

  /* ======================================================================
     4. Game state
     ====================================================================== */

  var MODES = ['pvp', 'easy', 'medium', 'hard'];

  function defaultState() {
    return {
      version: 1,
      board: emptyBoard(),
      currentPlayer: X,
      mode: 'medium',
      scores: { X: 0, O: 0, draw: 0 },
      starter: X
    };
  }

  function clampScore(n) {
    var v = typeof n === 'number' ? n : parseInt(n, 10);
    if (!isFinite(v) || v < 0) return 0;
    return Math.min(9999, Math.floor(v));
  }

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};
    var board = isValidBoard(s.board) ? s.board.slice() : d.board;

    /* A board where the move counts cannot have arisen from legal play is
       rejected outright rather than resumed into a broken game. */
    var xs = board.filter(function (c) { return c === X; }).length;
    var os = board.filter(function (c) { return c === O; }).length;
    if (xs - os > 1 || os - xs > 1) board = d.board;
    if (winningLine(board, X) && winningLine(board, O)) board = d.board;

    var scores = s.scores && typeof s.scores === 'object' ? s.scores : {};
    return {
      version: 1,
      board: board,
      currentPlayer: s.currentPlayer === O ? O : X,
      mode: MODES.indexOf(s.mode) === -1 ? d.mode : s.mode,
      scores: { X: clampScore(scores.X), O: clampScore(scores.O), draw: clampScore(scores.draw) },
      starter: s.starter === O ? O : X
    };
  }

  /* ======================================================================
     5. Descriptions
     ====================================================================== */

  function describeResult(result, mode) {
    if (!result || !result.over) return '';
    if (result.draw) return "It's a draw.";
    if (mode === 'pvp') return 'Player ' + result.winner + ' wins!';
    return result.winner === X ? 'You win!' : 'Computer wins.';
  }

  var MODE_LABELS = {
    pvp: 'Two players',
    easy: 'Computer — Easy',
    medium: 'Computer — Medium',
    hard: 'Computer — Unbeatable'
  };

  function modeLabel(mode) { return MODE_LABELS[mode] || MODE_LABELS.medium; }

  /** Total games recorded, for the scoreboard. */
  function totalGames(scores) {
    var s = scores || {};
    return clampScore(s.X) + clampScore(s.O) + clampScore(s.draw);
  }

  global.TicTacToeEngine = {
    X: X, O: O, EMPTY: EMPTY,
    LINES: LINES, CORNERS: CORNERS, EDGES: EDGES, CENTER: CENTER,
    MODES: MODES, DIFFICULTIES: DIFFICULTIES,

    emptyBoard: emptyBoard,
    isValidBoard: isValidBoard,
    availableMoves: availableMoves,
    isFull: isFull,
    winningLine: winningLine,
    evaluate: evaluate,
    play: play,
    opponentOf: opponentOf,

    minimax: minimax,
    bestMove: bestMove,
    winningMove: winningMove,
    blockingMove: blockingMove,
    chooseMove: chooseMove,

    defaultState: defaultState,
    normalize: normalize,
    describeResult: describeResult,
    modeLabel: modeLabel,
    totalGames: totalGames
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.TicTacToeEngine;

})(typeof window !== 'undefined' ? window : this);
