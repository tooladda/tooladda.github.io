/* ==========================================================================
   ToolAdda — Reversi (engine)

   Rules, move generation and the computer opponent, with no DOM anywhere in
   this file so the whole thing can be exercised from node.

   Three decisions are worth explaining:

   1. RAYS, NOT INDEX ARITHMETIC. With the board in one flat array, "the
      square to the right" computed as i + 1 walks off the end of one row and
      onto the start of the next, and a disc on the right edge appears to
      outflank one on the far left. Every square carries its eight rays out
      to the edge, built from row/column pairs, and flipping walks those.
   2. PASSING IS A RULE, NOT A BUTTON. A player with no legal move must pass,
      and the game ends only when neither side can move. The engine applies
      the pass itself, so no state it hands out ever has a side to move with
      nothing to play.
   3. THE ENDGAME IS COUNTED, NOT GUESSED. Near the end a positional guess is
      worth far less than the real count, so once few enough squares are
      empty the search runs to the last disc and scores the actual result.
   ========================================================================== */
(function (global) {
  'use strict';

  var EMPTY = 0;
  var BLACK = 1;            // always moves first
  var WHITE = 2;

  var SIZES = [8, 6];
  var WIN_SCORE = 1000000;
  var MAX_DEPTH = 40;

  var DIRECTIONS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var GEOMETRY = {};

  /* Per board size: eight rays per square, the eight neighbours, and a
     square-value table. Corners can never be flipped, so they are worth the
     most; the squares touching an empty corner (the X- and C-squares) are
     where games are thrown away, because they hand the corner over. */
  function geometry(size) {
    if (GEOMETRY[size]) return GEOMETRY[size];
    var last = size - 1;
    var rays = [];
    var neighbours = [];
    var weights = [];
    var guards = [];            // for an X- or C-square, the corner it gives away
    var corners = [];

    for (var sq = 0; sq < size * size; sq += 1) {
      var row = Math.floor(sq / size);
      var col = sq % size;
      var out = [];
      var near = [];
      for (var d = 0; d < 8; d += 1) {
        var ray = [];
        var r = row + DIRECTIONS[d][0];
        var c = col + DIRECTIONS[d][1];
        while (r >= 0 && r < size && c >= 0 && c < size) {
          ray.push(r * size + c);
          r += DIRECTIONS[d][0];
          c += DIRECTIONS[d][1];
        }
        out.push(ray);
        if (ray.length) near.push(ray[0]);
      }
      rays.push(out);
      neighbours.push(near);

      var edgeRow = row === 0 || row === last;
      var edgeCol = col === 0 || col === last;
      var nextRow = row === 1 || row === last - 1;
      var nextCol = col === 1 || col === last - 1;
      var corner = (row <= 1 ? 0 : last) * size + (col <= 1 ? 0 : last);
      var weight;
      var guard = -1;

      if (edgeRow && edgeCol) { weight = 100; corners.push(sq); }
      else if (nextRow && nextCol) { weight = -50; guard = corner; }                              // X-square
      else if ((edgeRow && nextCol) || (edgeCol && nextRow)) { weight = -20; guard = corner; }    // C-square
      else if (edgeRow || edgeCol) {
        weight = Math.min(edgeRow ? col : row, last - (edgeRow ? col : row)) === 2 ? 10 : 5;
      }
      else if (nextRow || nextCol) weight = -2;
      else weight = -1;

      weights.push(weight);
      guards.push(guard);
    }

    GEOMETRY[size] = { size: size, rays: rays, neighbours: neighbours, weights: weights, guards: guards, corners: corners };
    return GEOMETRY[size];
  }

  function validSize(size) { return SIZES.indexOf(size) !== -1 ? size : 8; }
  function other(player) { return player === BLACK ? WHITE : BLACK; }

  /* ---------------------------------------------------------------- moves */
  function isLegal(board, sq, player, g) {
    if (board[sq] !== EMPTY) return false;            // also false for anything off the board
    var opponent = other(player);
    var rays = g.rays[sq];
    for (var d = 0; d < 8; d += 1) {
      var ray = rays[d];
      if (ray.length < 2 || board[ray[0]] !== opponent) continue;
      for (var k = 1; k < ray.length; k += 1) {
        var value = board[ray[k]];
        if (value === player) return true;
        if (value !== opponent) break;
      }
    }
    return false;
  }

  function movesFor(board, player, size) {
    var g = geometry(size);
    var out = [];
    for (var sq = 0; sq < board.length; sq += 1) {
      if (board[sq] === EMPTY && isLegal(board, sq, player, g)) out.push(sq);
    }
    return out;
  }

  function hasMove(board, player, size) {
    var g = geometry(size);
    for (var sq = 0; sq < board.length; sq += 1) {
      if (board[sq] === EMPTY && isLegal(board, sq, player, g)) return true;
    }
    return false;
  }

  function countMoves(board, player, g) {
    var count = 0;
    for (var sq = 0; sq < board.length; sq += 1) {
      if (board[sq] === EMPTY && isLegal(board, sq, player, g)) count += 1;
    }
    return count;
  }

  /* In place, for the search: places the disc, flips, and returns the
     flipped squares so `undoMove` can put them back. Assumes a legal move. */
  function applyMove(board, sq, player, size) {
    var g = geometry(size);
    var opponent = other(player);
    var flipped = [];
    var rays = g.rays[sq];
    for (var d = 0; d < 8; d += 1) {
      var ray = rays[d];
      var k = 0;
      while (k < ray.length && board[ray[k]] === opponent) k += 1;
      if (k === 0 || k === ray.length || board[ray[k]] !== player) continue;
      for (var j = 0; j < k; j += 1) {
        board[ray[j]] = player;
        flipped.push(ray[j]);
      }
    }
    board[sq] = player;
    return flipped;
  }

  function undoMove(board, sq, flipped, player) {
    var opponent = other(player);
    board[sq] = EMPTY;
    for (var i = 0; i < flipped.length; i += 1) board[flipped[i]] = opponent;
  }

  /* --------------------------------------------------------------- state */
  function createState(size) {
    var n = validSize(size);
    var board = [];
    for (var i = 0; i < n * n; i += 1) board.push(EMPTY);
    var a = n / 2 - 1;
    var b = n / 2;
    board[a * n + a] = WHITE;
    board[b * n + b] = WHITE;
    board[a * n + b] = BLACK;
    board[b * n + a] = BLACK;
    return {
      size: n,
      board: board,
      turn: BLACK,
      moves: [],              // { player, square, flipped } — square -1 is a pass
      over: false,
      winner: EMPTY
    };
  }

  function cloneState(state) {
    return {
      size: state.size,
      board: state.board.slice(),
      turn: state.turn,
      moves: state.moves.slice(),
      over: state.over,
      winner: state.winner
    };
  }

  function counts(board) {
    var result = { black: 0, white: 0, empty: 0 };
    for (var i = 0; i < board.length; i += 1) {
      if (board[i] === BLACK) result.black += 1;
      else if (board[i] === WHITE) result.white += 1;
      else result.empty += 1;
    }
    return result;
  }

  function leader(board) {
    var c = counts(board);
    if (c.black === c.white) return EMPTY;
    return c.black > c.white ? BLACK : WHITE;
  }

  /* Leaves the state with a side to move that can move — recording a pass
     if the side whose turn it is has nothing — or marks the game over. */
  function settle(state) {
    if (hasMove(state.board, state.turn, state.size)) return;
    var opponent = other(state.turn);
    if (hasMove(state.board, opponent, state.size)) {
      state.moves.push({ player: state.turn, square: -1, flipped: [] });
      state.turn = opponent;
      return;
    }
    state.over = true;
    state.winner = leader(state.board);
  }

  /* A position set up directly — used by the tests and nowhere in play. */
  function positionState(size, board, turn) {
    var state = {
      size: validSize(size),
      board: board.slice(),
      turn: turn === WHITE ? WHITE : BLACK,
      moves: [],
      over: false,
      winner: EMPTY
    };
    settle(state);
    return state;
  }

  function legalMoves(state) {
    if (!state || state.over) return [];
    return movesFor(state.board, state.turn, state.size);
  }

  /* The public move: checks legality and never touches the state it was given. */
  function play(state, sq) {
    if (!state || state.over || typeof sq !== 'number') return state;
    if (!isLegal(state.board, sq, state.turn, geometry(state.size))) return state;
    var next = cloneState(state);
    var player = next.turn;
    var flipped = applyMove(next.board, sq, player, next.size);
    next.moves.push({ player: player, square: sq, flipped: flipped });
    next.turn = other(player);
    settle(next);
    return next;
  }

  /* ---------------------------------------------------------- evaluation */
  /* From `player`'s point of view. Corners and the square table first; then
     mobility (how many moves each side has — the real currency of this game),
     frontier discs (discs touching an empty square give the opponent moves,
     so fewer is better) and, only near the end, the plain disc count. Early
     on, having more discs is usually a weakness, not a lead. */
  function evaluate(board, player, size) {
    var g = geometry(size);
    var opponent = other(player);
    var positional = 0;
    var mine = 0;
    var theirs = 0;
    var myFrontier = 0;
    var theirFrontier = 0;

    for (var sq = 0; sq < board.length; sq += 1) {
      var value = board[sq];
      if (value === EMPTY) continue;
      var weight = g.weights[sq];
      if (g.guards[sq] !== -1 && board[g.guards[sq]] !== EMPTY) weight = 0;   // its corner is already decided
      var frontier = false;
      var near = g.neighbours[sq];
      for (var k = 0; k < near.length; k += 1) {
        if (board[near[k]] === EMPTY) { frontier = true; break; }
      }
      if (value === player) {
        positional += weight;
        mine += 1;
        if (frontier) myFrontier += 1;
      } else {
        positional -= weight;
        theirs += 1;
        if (frontier) theirFrontier += 1;
      }
    }

    var cornerDifference = 0;
    for (var i = 0; i < g.corners.length; i += 1) {
      if (board[g.corners[i]] === player) cornerDifference += 1;
      else if (board[g.corners[i]] === opponent) cornerDifference -= 1;
    }

    var myMoves = countMoves(board, player, g);
    var theirMoves = countMoves(board, opponent, g);
    var empties = board.length - mine - theirs;

    var score = positional + 30 * cornerDifference;
    if (myMoves + theirMoves) score += Math.round((90 * (myMoves - theirMoves)) / (myMoves + theirMoves));
    if (myFrontier + theirFrontier) score -= Math.round((50 * (myFrontier - theirFrontier)) / (myFrontier + theirFrontier));
    if (empties <= size * 2 && mine + theirs) score += Math.round((60 * (mine - theirs)) / (mine + theirs));
    return score;
  }

  /* A finished game: any win outranks every positional score, and a bigger
     margin outranks a smaller one. */
  function finalScore(board, player) {
    var c = counts(board);
    var difference = player === BLACK ? c.black - c.white : c.white - c.black;
    if (difference > 0) return WIN_SCORE + difference;
    if (difference < 0) return -WIN_SCORE + difference;
    return 0;
  }

  /* -------------------------------------------------------------- search */
  function orderSquares(moves, g) {
    moves.sort(function (a, b) { return g.weights[b] - g.weights[a]; });
  }

  /* Negamax with alpha-beta. A pass costs no depth — nothing was placed —
     and two passes in a row end the line with the real count. */
  function search(ctx, depth, alpha, beta, passed) {
    var board = ctx.board;
    var size = ctx.size;
    var player = ctx.turn;

    if (ctx.empties === 0) return finalScore(board, player);
    if (depth <= 0) return evaluate(board, player, size);

    ctx.nodes += 1;
    if (ctx.deadline && (ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) ctx.timedOut = true;
    if (ctx.timedOut) return evaluate(board, player, size);

    var moves = movesFor(board, player, size);
    if (!moves.length) {
      if (passed) return finalScore(board, player);
      ctx.turn = other(player);
      var afterPass = -search(ctx, depth, -beta, -alpha, true);
      ctx.turn = player;
      return afterPass;
    }
    if (moves.length > 1) orderSquares(moves, ctx.g);

    var best = -Infinity;
    for (var i = 0; i < moves.length; i += 1) {
      var sq = moves[i];
      var flipped = applyMove(board, sq, player, size);
      ctx.empties -= 1;
      ctx.turn = other(player);
      var score = -search(ctx, depth - 1, -beta, -alpha, false);
      ctx.turn = player;
      ctx.empties += 1;
      undoMove(board, sq, flipped, player);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                     // this branch is already refuted
    }
    return best;
  }

  /* Scores each root move. With `exact`, every move gets a true score (the
     easier levels choose among near-equal moves). Without it, later moves are
     searched against the best so far minus one — enough to tell a tie from a
     worse move, at a fraction of the cost. */
  function searchRoot(state, moves, depth, deadline, exact) {
    var g = geometry(state.size);
    var ctx = {
      board: state.board.slice(), size: state.size, g: g, turn: state.turn,
      empties: counts(state.board).empty, nodes: 0, deadline: deadline, timedOut: false
    };
    var scored = [];
    var alpha = -Infinity;

    for (var i = 0; i < moves.length; i += 1) {
      var sq = moves[i];
      var flipped = applyMove(ctx.board, sq, state.turn, state.size);
      ctx.empties -= 1;
      ctx.turn = other(state.turn);
      var floor = exact || alpha === -Infinity ? -Infinity : alpha - 1;
      var score = -search(ctx, depth - 1, -Infinity, -floor, false);
      ctx.turn = state.turn;
      ctx.empties += 1;
      undoMove(ctx.board, sq, flipped, state.turn);
      if (ctx.timedOut) break;
      scored.push({ square: sq, score: score });
      if (score > alpha) alpha = score;
    }
    return { scored: scored, complete: !ctx.timedOut, nodes: ctx.nodes };
  }

  /* Iterative deepening. `endgame` is how many empty squares the search may
     solve outright; once the depth reaches the number of empty squares the
     answer is exact, and searching deeper would add nothing. */
  function bestMove(state, depth, options) {
    var opts = options || {};
    var moves = legalMoves(state);
    if (!moves.length) return null;

    var empties = counts(state.board).empty;
    var limit = Math.max(1, depth || 1);
    if (opts.endgame && empties <= opts.endgame) limit = Math.max(limit, empties);
    limit = Math.min(limit, MAX_DEPTH, empties);

    var deadline = opts.timeLimit ? Date.now() + opts.timeLimit : 0;
    var margin = opts.margin || 0;
    var order = moves.slice();
    orderSquares(order, geometry(state.size));
    var result = null;
    var nodes = 0;

    for (var d = 1; d <= limit; d += 1) {
      var pass = searchRoot(state, order, d, d === 1 ? 0 : deadline, margin > 0);
      nodes += pass.nodes;
      if (!pass.complete) break;
      result = { scored: pass.scored, depth: d };
      order = pass.scored.slice()
        .sort(function (a, b) { return b.score - a.score; })
        .map(function (entry) { return entry.square; });
      if (moves.length === 1) break;
      if (deadline && Date.now() > deadline) break;
    }

    var best = -Infinity;
    result.scored.forEach(function (entry) { if (entry.score > best) best = entry.score; });
    var picks = result.scored
      .filter(function (entry) { return entry.score >= best - margin; })
      .map(function (entry) { return entry.square; });
    var random = opts.rng || Math.random;
    var square = picks[Math.floor(random() * picks.length) % picks.length];
    return {
      square: square, score: best, scored: result.scored, depth: result.depth,
      exact: result.depth >= empties, ties: picks, nodes: nodes
    };
  }

  /* --------------------------------------------------------- difficulty */
  var DIFFICULTY = {
    easy: { depth: 1, blunder: 0.4, margin: 30, endgame: 0, label: 'Easy' },
    medium: { depth: 3, blunder: 0.08, margin: 8, endgame: 6, label: 'Medium' },
    hard: { depth: 5, blunder: 0, margin: 0, endgame: 10, label: 'Hard' },
    expert: { depth: 10, blunder: 0, margin: 0, endgame: 14, label: 'Expert' }
  };

  /* `rng` is injectable so the suite can drive the random branches. */
  function chooseMove(state, difficulty, rng, options) {
    var moves = legalMoves(state);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    var random = rng || Math.random;
    var setting = DIFFICULTY[difficulty] || DIFFICULTY.medium;

    if (setting.blunder > 0 && random() < setting.blunder) {
      return moves[Math.floor(random() * moves.length) % moves.length];
    }
    var picked = bestMove(state, setting.depth, {
      timeLimit: (options && options.timeLimit) || 900,
      margin: setting.margin,
      endgame: setting.endgame,
      rng: random
    });
    return picked ? picked.square : moves[0];
  }

  /* ------------------------------------------------------------ notation */
  /* Columns a–h from the left, rows 1–8 from the top: the tournament
     convention, in which black's four opening moves are d3, c4, f5 and e6. */
  function squareName(size, sq) {
    var n = validSize(size);
    return 'abcdefgh'.charAt(sq % n) + String(Math.floor(sq / n) + 1);
  }

  /* ------------------------------------------------------ saved games */
  function serializeMoves(state) {
    return state.moves
      .filter(function (move) { return move.square >= 0; })
      .map(function (move) { return move.square; });
  }

  /* A saved game is replayed move by move through the rules, so anything
     edited into local storage simply fails to replay. Passes are implied. */
  function replay(size, list) {
    if (SIZES.indexOf(size) === -1 || !Array.isArray(list) || list.length > size * size) return null;
    var state = createState(size);
    for (var i = 0; i < list.length; i += 1) {
      var sq = list[i];
      if (typeof sq !== 'number' || sq % 1 !== 0) return null;
      var next = play(state, sq);
      if (next === state) return null;
      state = next;
    }
    return state;
  }

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

  var api = {
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    SIZES: SIZES,
    WIN_SCORE: WIN_SCORE,
    DIFFICULTY: DIFFICULTY,

    geometry: geometry,
    other: other,
    createState: createState,
    positionState: positionState,
    cloneState: cloneState,
    legalMoves: legalMoves,
    isLegal: function (state, sq) { return !state.over && isLegal(state.board, sq, state.turn, geometry(state.size)); },
    play: play,
    applyMove: applyMove,
    undoMove: undoMove,
    counts: counts,

    evaluate: evaluate,
    bestMove: bestMove,
    chooseMove: chooseMove,

    squareName: squareName,
    serializeMoves: serializeMoves,
    replay: replay,
    defaultStats: defaultStats,
    normalizeStats: normalizeStats
  };

  global.ReversiEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

}(typeof window !== 'undefined' ? window : this));
