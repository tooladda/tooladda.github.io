/* ==========================================================================
   ToolAdda — Connect Four (engine)

   Rules, win detection and the computer opponent, with no DOM anywhere in
   this file so the whole thing can be exercised from node.

   Three decisions are worth explaining, because they are where naive
   implementations of this game go wrong:

   1. WRAPPING. With the board stored as one flat array, a horizontal run
      computed as i, i+1, i+2, i+3 happily crosses a row boundary — cells
      (row 2, col 6) and (row 3, col 0) look adjacent to the arithmetic and
      "four in a row" gets reported for discs at opposite edges of the
      board. The winning lines are therefore built from row/column pairs
      and validated, never from raw index steps.

   2. WHERE TO LOOK. Rescanning all 69 lines after every move is fine for
      the UI, but the search visits tens of thousands of positions, so each
      cell carries a precomputed list of the lines that pass through it and
      only those are checked after a move.

   3. DEPTH IN THE SCORE. A win must be worth more the sooner it arrives,
      or the opponent dawdles — it sees a win in five as equal to a win in
      one and picks whichever it happened to search first. Terminal scores
      are WIN minus the ply, which reads to a human as "it goes for the
      kill and makes you work for yours".
   ========================================================================== */
(function (global) {
  'use strict';

  var COLUMNS = 7;
  var ROWS = 6;
  var EMPTY = 0;
  var RED = 1;      // always moves first
  var YELLOW = 2;
  var CONNECT = 4;

  var WIN_SCORE = 1000000;
  var MAX_DEPTH = 12;

  /* ------------------------------------------------------------ geometry */
  var index = function (row, col) { return row * COLUMNS + col; };

  /* Every run of four that fits on the board, as arrays of cell indices.
     Built from (row, col) pairs so nothing can wrap around an edge. */
  var LINES = (function () {
    var lines = [];
    var directions = [[0, 1], [1, 0], [1, 1], [1, -1]];   // →, ↓, ↘, ↙
    for (var row = 0; row < ROWS; row += 1) {
      for (var col = 0; col < COLUMNS; col += 1) {
        for (var d = 0; d < directions.length; d += 1) {
          var dr = directions[d][0];
          var dc = directions[d][1];
          var endRow = row + dr * (CONNECT - 1);
          var endCol = col + dc * (CONNECT - 1);
          if (endRow < 0 || endRow >= ROWS || endCol < 0 || endCol >= COLUMNS) continue;
          var line = [];
          for (var k = 0; k < CONNECT; k += 1) line.push(index(row + dr * k, col + dc * k));
          lines.push(line);
        }
      }
    }
    return lines;
  }());

  /* line indices that pass through each cell — the only ones a move can complete */
  var LINES_THROUGH = (function () {
    var map = [];
    for (var i = 0; i < ROWS * COLUMNS; i += 1) map.push([]);
    LINES.forEach(function (line, lineIndex) {
      line.forEach(function (cell) { map[cell].push(lineIndex); });
    });
    return map;
  }());

  /* Centre columns win more games, so they are searched first: a good move
     found early makes alpha-beta cut far more of the tree. */
  var COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];
  var COLUMN_VALUE = [1, 2, 4, 7, 4, 2, 1];

  /* --------------------------------------------------------------- state */
  function createState(firstPlayer) {
    var board = [];
    for (var i = 0; i < ROWS * COLUMNS; i += 1) board.push(EMPTY);
    return {
      board: board,
      heights: [0, 0, 0, 0, 0, 0, 0],   // discs already in each column
      moves: [],                         // columns played, in order
      turn: firstPlayer === YELLOW ? YELLOW : RED,
      winner: EMPTY,
      line: null                         // the four cells that won, once there is a winner
    };
  }

  function cloneState(state) {
    return {
      board: state.board.slice(),
      heights: state.heights.slice(),
      moves: state.moves.slice(),
      turn: state.turn,
      winner: state.winner,
      line: state.line ? state.line.slice() : null
    };
  }

  var other = function (player) { return player === RED ? YELLOW : RED; };

  function canPlay(state, col) {
    return col >= 0 && col < COLUMNS && state.heights[col] < ROWS && state.winner === EMPTY;
  }

  function legalMoves(state) {
    var out = [];
    for (var col = 0; col < COLUMNS; col += 1) if (canPlay(state, col)) out.push(col);
    return out;
  }

  /* The row a disc dropped into `col` would land on (0 is the top row). */
  function landingRow(state, col) {
    return ROWS - 1 - state.heights[col];
  }

  function isFull(state) {
    for (var col = 0; col < COLUMNS; col += 1) if (state.heights[col] < ROWS) return false;
    return true;
  }

  /* Did the disc just placed at `cell` complete a run of four? */
  function lineThrough(board, cell, player) {
    var through = LINES_THROUGH[cell];
    for (var i = 0; i < through.length; i += 1) {
      var line = LINES[through[i]];
      if (board[line[0]] === player && board[line[1]] === player &&
          board[line[2]] === player && board[line[3]] === player) {
        return line;
      }
    }
    return null;
  }

  /* Full scan, for boards that arrive from outside (a restored game). */
  function findWinner(board) {
    for (var i = 0; i < LINES.length; i += 1) {
      var line = LINES[i];
      var first = board[line[0]];
      if (first !== EMPTY && board[line[1]] === first &&
          board[line[2]] === first && board[line[3]] === first) {
        return { player: first, line: line.slice() };
      }
    }
    return null;
  }

  /* In-place move used by the search; `undoMove` puts it back exactly. */
  function applyMove(state, col) {
    var row = landingRow(state, col);
    var cell = index(row, col);
    var player = state.turn;
    state.board[cell] = player;
    state.heights[col] += 1;
    state.moves.push(col);
    var line = lineThrough(state.board, cell, player);
    if (line) {
      state.winner = player;
      state.line = line.slice();
    } else {
      state.turn = other(player);
    }
    return cell;
  }

  function undoMove(state) {
    var col = state.moves.pop();
    if (col === undefined) return;
    state.heights[col] -= 1;
    var cell = index(ROWS - 1 - state.heights[col], col);
    var player = state.board[cell];
    state.board[cell] = EMPTY;
    state.winner = EMPTY;
    state.line = null;
    state.turn = player;
  }

  /* The public move: never touches the state it was handed. */
  function play(state, col) {
    if (!canPlay(state, col)) return state;
    var next = cloneState(state);
    applyMove(next, col);
    return next;
  }

  /* ---------------------------------------------------------- evaluation */
  /* Positional score from `player`'s point of view. Open threes are worth
     far more than open twos, and a line containing both colours is dead
     weight for everyone, so it scores nothing. */
  function evaluate(state, player) {
    var opponent = other(player);
    var score = 0;
    var board = state.board;

    for (var i = 0; i < LINES.length; i += 1) {
      var line = LINES[i];
      var mine = 0;
      var theirs = 0;
      for (var k = 0; k < CONNECT; k += 1) {
        var value = board[line[k]];
        if (value === player) mine += 1;
        else if (value === opponent) theirs += 1;
      }
      if (mine && theirs) continue;                 // blocked line, no value
      if (mine === 3) score += 90;
      else if (mine === 2) score += 12;
      else if (mine === 1) score += 2;
      else if (theirs === 3) score -= 105;          // defence weighted slightly higher
      else if (theirs === 2) score -= 14;
      else if (theirs === 1) score -= 2;
    }

    for (var col = 0; col < COLUMNS; col += 1) {
      for (var row = 0; row < ROWS; row += 1) {
        var cell = board[index(row, col)];
        if (cell === player) score += COLUMN_VALUE[col];
        else if (cell === opponent) score -= COLUMN_VALUE[col];
      }
    }
    return score;
  }

  /* -------------------------------------------------------------- search */
  /* Negamax with alpha-beta. `ply` is how deep we already are, so a win
     found sooner scores higher than the same win found later. */
  function negamax(state, depth, alpha, beta, player, ply, deadline, budget) {
    if (state.winner !== EMPTY) {
      return state.winner === player ? WIN_SCORE - ply : -(WIN_SCORE - ply);
    }
    if (isFull(state)) return 0;
    if (depth === 0) return evaluate(state, player);

    budget.nodes += 1;
    if (deadline && (budget.nodes & 1023) === 0 && Date.now() > deadline) {
      budget.timedOut = true;
      return evaluate(state, player);
    }

    var best = -Infinity;
    for (var i = 0; i < COLUMN_ORDER.length; i += 1) {
      var col = COLUMN_ORDER[i];
      if (!canPlay(state, col)) continue;
      applyMove(state, col);
      var score = -negamax(state, depth - 1, -beta, -alpha, other(player), ply + 1, deadline, budget);
      undoMove(state);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                     // this branch is already refuted
    }
    return best === -Infinity ? evaluate(state, player) : best;
  }

  /* Scores every legal move for the side to play. Returns them in board
     order with the search's own view of each. */
  function scoreMoves(state, depth, options) {
    var opts = options || {};
    var deadline = opts.timeLimit ? Date.now() + opts.timeLimit : 0;
    var budget = { nodes: 0, timedOut: false };
    var player = state.turn;
    var working = cloneState(state);
    var scored = [];

    for (var i = 0; i < COLUMN_ORDER.length; i += 1) {
      var col = COLUMN_ORDER[i];
      if (!canPlay(working, col)) continue;
      applyMove(working, col);
      var score;
      if (working.winner === player) {
        score = WIN_SCORE;                          // no need to search a won position
      } else {
        score = -negamax(working, depth - 1, -Infinity, Infinity, other(player), 1, deadline, budget);
      }
      undoMove(working);
      scored.push({ column: col, score: score });
    }

    scored.sort(function (a, b) { return a.column - b.column; });
    return { moves: scored, nodes: budget.nodes, timedOut: budget.timedOut };
  }

  /* Iterative deepening: play the best move from the deepest search that
     finished inside the time budget, so a slow phone degrades to a shallower
     opponent instead of freezing. */
  function bestMove(state, depth, options) {
    var opts = options || {};
    var limit = Math.max(1, Math.min(MAX_DEPTH, depth || 1));
    var deadline = opts.timeLimit ? Date.now() + opts.timeLimit : 0;
    var result = null;

    for (var d = 1; d <= limit; d += 1) {
      var pass = scoreMoves(state, d, deadline ? { timeLimit: Math.max(1, deadline - Date.now()) } : {});
      if (pass.moves.length === 0) return null;
      if (!pass.timedOut || !result) result = pass;
      if (deadline && Date.now() > deadline) break;
      // a forced win (or loss) will not change with more depth
      if (Math.abs(result.moves.reduce(function (m, x) { return Math.max(m, x.score); }, -Infinity)) >= WIN_SCORE - MAX_DEPTH) break;
    }

    var best = -Infinity;
    var picks = [];
    result.moves.forEach(function (move) {
      if (move.score > best) { best = move.score; picks = [move.column]; }
      else if (move.score === best) picks.push(move.column);
    });

    // tie-break towards the centre, which is where the winning lines are
    picks.sort(function (a, b) { return COLUMN_ORDER.indexOf(a) - COLUMN_ORDER.indexOf(b); });
    return { column: picks[0], score: best, moves: result.moves, ties: picks, nodes: result.nodes };
  }

  /* A move that wins immediately for `player`, or null. */
  function winningMove(state, player) {
    var working = cloneState(state);
    working.turn = player;
    var moves = legalMoves(working);
    for (var i = 0; i < moves.length; i += 1) {
      var col = moves[i];
      applyMove(working, col);
      var won = working.winner === player;
      undoMove(working);
      if (won) return col;
    }
    return null;
  }

  /* --------------------------------------------------------- difficulty */
  var DIFFICULTY = {
    easy: { depth: 1, blunder: 0.45, label: 'Easy' },
    medium: { depth: 3, blunder: 0.12, label: 'Medium' },
    hard: { depth: 5, blunder: 0, label: 'Hard' },
    expert: { depth: 7, blunder: 0, label: 'Expert' }
  };

  /* `rng` is injectable so the suite can drive the random branches. */
  function chooseMove(state, difficulty, rng, options) {
    var moves = legalMoves(state);
    if (!moves.length) return null;
    var random = rng || Math.random;
    var setting = DIFFICULTY[difficulty] || DIFFICULTY.medium;

    // even the easy opponent takes a win it can see; it is the blocking it is bad at
    var win = winningMove(state, state.turn);
    if (win !== null) return win;

    if (setting.blunder > 0 && random() < setting.blunder) {
      return moves[Math.floor(random() * moves.length) % moves.length];
    }

    var picked = bestMove(state, setting.depth, options || { timeLimit: 900 });
    return picked ? picked.column : moves[0];
  }

  /* ------------------------------------------------------- saved results */
  function defaultStats() {
    return { wins: 0, losses: 0, draws: 0, streak: 0, best: 0 };
  }

  /* localStorage is editable by anyone, so a restored scoreboard is treated
     as untrusted input rather than as data this code wrote. */
  function normalizeStats(raw) {
    var stats = defaultStats();
    if (!raw || typeof raw !== 'object') return stats;
    ['wins', 'losses', 'draws', 'streak', 'best'].forEach(function (key) {
      var value = raw[key];
      if (typeof value === 'number' && isFinite(value) && value >= 0 && value < 1e6) {
        stats[key] = Math.floor(value);
      }
    });
    if (stats.best < stats.streak) stats.best = stats.streak;
    return stats;
  }

  /* Is this board something legal play could have produced? */
  function isValidState(state) {
    if (!state || !Array.isArray(state.board) || state.board.length !== ROWS * COLUMNS) return false;
    var counts = {};
    counts[RED] = 0;
    counts[YELLOW] = 0;

    for (var col = 0; col < COLUMNS; col += 1) {
      var seenEmpty = false;
      for (var row = ROWS - 1; row >= 0; row -= 1) {      // bottom to top
        var value = state.board[index(row, col)];
        if (value !== EMPTY && value !== RED && value !== YELLOW) return false;
        if (value === EMPTY) seenEmpty = true;
        else if (seenEmpty) return false;                  // a disc floating above a gap
        else counts[value] += 1;
      }
    }

    var difference = counts[RED] - counts[YELLOW];
    if (difference !== 0 && difference !== 1) return false;  // red moves first
    return true;
  }

  var api = {
    COLUMNS: COLUMNS,
    ROWS: ROWS,
    EMPTY: EMPTY,
    RED: RED,
    YELLOW: YELLOW,
    CONNECT: CONNECT,
    WIN_SCORE: WIN_SCORE,
    LINES: LINES,
    COLUMN_ORDER: COLUMN_ORDER,
    DIFFICULTY: DIFFICULTY,

    index: index,
    createState: createState,
    cloneState: cloneState,
    other: other,
    canPlay: canPlay,
    legalMoves: legalMoves,
    landingRow: landingRow,
    isFull: isFull,
    play: play,
    applyMove: applyMove,
    undoMove: undoMove,
    findWinner: findWinner,
    lineThrough: lineThrough,

    evaluate: evaluate,
    scoreMoves: scoreMoves,
    bestMove: bestMove,
    winningMove: winningMove,
    chooseMove: chooseMove,

    defaultStats: defaultStats,
    normalizeStats: normalizeStats,
    isValidState: isValidState
  };

  global.ConnectFourEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

}(typeof window !== 'undefined' ? window : this));
