/* ==========================================================================
   ToolAdda — Checkers (engine)

   Rules, move generation and the computer opponent for three rule sets —
   American checkers (English draughts), international draughts and Russian
   draughts — with no DOM anywhere in this file so the whole thing can be
   exercised from node.

   The rule sets differ in five switches, and every one of them is a place
   where implementations of this game quietly go wrong:

   1. WHO MAY CAPTURE BACKWARDS. An American man captures forwards only; in
      the international and Russian games a man captures in all four
      directions, although it still only moves forwards.
   2. FLYING KINGS. An American king steps one square. International and
      Russian kings fly: they move any distance along an open diagonal and
      take a piece any distance away, landing on any empty square beyond it.
   3. THE MAXIMUM-CAPTURE RULE. International draughts forces the sequence
      that takes the most pieces. The other two let you pick any sequence —
      but a sequence, once started, has to be jumped to the end.
   4. PROMOTION DURING A CAPTURE. American: reaching the far row crowns the
      man and ends the move. Russian: it is crowned on the spot and carries
      on capturing as a king. International: it is crowned only if the move
      finishes there.
   5. THE TURKISH STRIKE. Captured pieces are lifted only once the whole
      sequence is over, and no piece may be jumped twice. Until then they
      still stand on the board and block, which decides real positions.

   One decision about the opponent is worth explaining too. Captures are
   compulsory, so a position with a capture pending is never quiet: the
   search carries on past its nominal depth until the captures run out, or
   it would stop halfway through an exchange and count a piece it is about
   to lose.
   ========================================================================== */
(function (global) {
  'use strict';

  var EMPTY = 0;
  var DARK = 1;             // starts on the top rows and moves down the board
  var LIGHT = 2;            // starts on the bottom rows and moves up

  /* A square holds 0 or a piece: the sign is the owner, the size the rank. */
  var DARK_MAN = 1;
  var DARK_KING = 2;
  var LIGHT_MAN = -1;
  var LIGHT_KING = -2;

  var WIN_SCORE = 1000000;
  var MAX_PLY = 72;         // a hard floor under the capture extension
  var MAX_DEPTH = 24;

  /* Everything that separates the rule sets. Nothing below branches on a
     variant's name — only on these switches. */
  var VARIANTS = {
    american: {
      id: 'american', label: 'American checkers', size: 8, rows: 3, first: DARK,
      menCaptureBackwards: false, flyingKings: false, maximumCapture: false,
      promotion: 'stop', drawPlies: 80, notation: 'numeric', captureNotation: 'full',
      kingValue: 150
    },
    international: {
      id: 'international', label: 'International draughts', size: 10, rows: 4, first: LIGHT,
      menCaptureBackwards: true, flyingKings: true, maximumCapture: true,
      promotion: 'end', drawPlies: 50, notation: 'numeric', captureNotation: 'short',
      kingValue: 300
    },
    russian: {
      id: 'russian', label: 'Russian draughts', size: 8, rows: 3, first: LIGHT,
      menCaptureBackwards: true, flyingKings: true, maximumCapture: false,
      promotion: 'continue', drawPlies: 30, notation: 'algebraic', captureNotation: 'full',
      kingValue: 280
    }
  };

  /* ------------------------------------------------------------ geometry */
  var DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];   // ↖ ↗ ↙ ↘
  var GEOMETRY = {};

  /* Per board size: the dark squares, their printed numbers, and for every
     square its four diagonal rays out to the edge. Every move walks one of
     these rays, so no step can wrap from one side of the board to the other. */
  function geometry(size) {
    if (GEOMETRY[size]) return GEOMETRY[size];
    var playable = [];
    var number = [];
    var rays = [];
    var kingBonus = [];
    var mainRoad = [];
    var middle = (size - 1) / 2;

    for (var sq = 0; sq < size * size; sq += 1) {
      var row = Math.floor(sq / size);
      var col = sq % size;
      var out = [];
      for (var d = 0; d < 4; d += 1) {
        var ray = [];
        var r = row + DIRECTIONS[d][0];
        var c = col + DIRECTIONS[d][1];
        while (r >= 0 && r < size && c >= 0 && c < size) {
          ray.push(r * size + c);
          r += DIRECTIONS[d][0];
          c += DIRECTIONS[d][1];
        }
        out.push(ray);
      }
      rays.push(out);

      var dark = (row + col) % 2 === 1;
      if (dark) playable.push(sq);
      number.push(dark ? playable.length : 0);
      kingBonus.push(Math.round(12 - 3 * Math.max(Math.abs(row - middle), Math.abs(col - middle))));
      mainRoad.push(row + col === size - 1);        // the long diagonal, corner to corner
    }

    GEOMETRY[size] = { size: size, playable: playable, number: number, rays: rays, kingBonus: kingBonus, mainRoad: mainRoad };
    return GEOMETRY[size];
  }

  function rulesFor(id) { return VARIANTS[id] || VARIANTS.american; }
  function other(player) { return player === DARK ? LIGHT : DARK; }
  function ownerOf(value) { return value > 0 ? DARK : (value < 0 ? LIGHT : EMPTY); }
  function isKing(value) { return value === DARK_KING || value === LIGHT_KING; }
  function isForward(player, direction) { return player === DARK ? direction >= 2 : direction < 2; }
  function crownRow(player, size) { return player === DARK ? size - 1 : 0; }

  /* --------------------------------------------------------------- state */
  function createBoard(rules) {
    var g = geometry(rules.size);
    var board = [];
    for (var i = 0; i < rules.size * rules.size; i += 1) board.push(EMPTY);
    g.playable.forEach(function (sq) {
      var row = Math.floor(sq / rules.size);
      if (row < rules.rows) board[sq] = DARK_MAN;
      else if (row >= rules.size - rules.rows) board[sq] = LIGHT_MAN;
    });
    return board;
  }

  function positionKey(board, turn) {
    return turn + ':' + board.join('');
  }

  function createState(variantId) {
    var rules = rulesFor(variantId);
    var board = createBoard(rules);
    return {
      variant: rules.id,
      size: rules.size,
      board: board,
      turn: rules.first,
      moves: [],                                  // every move played, in order
      quiet: 0,                                   // plies since the last capture or man move
      keys: [positionKey(board, rules.first)],    // positions since then, for repetition
      result: null                                // { winner, reason } once the game is over
    };
  }

  /* A position set up directly — used by the tests and nowhere in play. */
  function positionState(variantId, board, turn) {
    var rules = rulesFor(variantId);
    var state = {
      variant: rules.id,
      size: rules.size,
      board: board.slice(),
      turn: turn === DARK || turn === LIGHT ? turn : rules.first,
      moves: [],
      quiet: 0,
      keys: [],
      result: null
    };
    state.keys.push(positionKey(state.board, state.turn));
    state.result = judge(state, rules);
    return state;
  }

  function cloneState(state) {
    return {
      variant: state.variant,
      size: state.size,
      board: state.board.slice(),
      turn: state.turn,
      moves: state.moves.slice(),
      quiet: state.quiet,
      keys: state.keys.slice(),
      result: state.result ? { winner: state.result.winner, reason: state.result.reason } : null
    };
  }

  /* ------------------------------------------------------------- captures */
  /* One context per move generation rather than a closure per piece: the
     search generates moves at every node, and the allocations add up. */
  function captureContext(board, rules, g, player, out) {
    return {
      board: board, rules: rules, g: g, size: rules.size,
      owner: player, lastRow: crownRow(player, rules.size),
      from: -1, piece: EMPTY, path: [], taken: [], out: out
    };
  }

  function jumpable(ctx, sq) {
    var value = ctx.board[sq];
    if (value === EMPTY || ownerOf(value) === ctx.owner) return false;
    return ctx.taken.indexOf(sq) === -1;          // the Turkish strike: never the same piece twice
  }

  /* Is there at least one jump from `at`? Cheap, and no sequence is built. */
  function canCapture(ctx, at, king) {
    var board = ctx.board;
    var rays = ctx.g.rays[at];
    for (var d = 0; d < 4; d += 1) {
      if (!king && !ctx.rules.menCaptureBackwards && !isForward(ctx.owner, d)) continue;
      var ray = rays[d];
      if (king && ctx.rules.flyingKings) {
        var k = 0;
        while (k < ray.length && board[ray[k]] === EMPTY) k += 1;
        if (k < ray.length - 1 && jumpable(ctx, ray[k]) && board[ray[k + 1]] === EMPTY) return true;
      } else if (ray.length >= 2 && jumpable(ctx, ray[0]) && board[ray[1]] === EMPTY) {
        return true;
      }
    }
    return false;
  }

  function recordCapture(ctx, promotes) {
    ctx.out.push({ from: ctx.from, path: ctx.path.slice(), captures: ctx.taken.slice(), promotes: promotes });
  }

  function landCapture(ctx, to, over, king) {
    ctx.taken.push(over);
    ctx.path.push(to);
    var crowned = !king && Math.floor(to / ctx.size) === ctx.lastRow;
    if (crowned && ctx.rules.promotion === 'stop') recordCapture(ctx, true);
    else extendCapture(ctx, to, king || (crowned && ctx.rules.promotion === 'continue'));
    ctx.path.pop();
    ctx.taken.pop();
  }

  /* Depth-first over every continuation. Only finished sequences are
     recorded, which is what makes "you must keep jumping" automatic. */
  function extendCapture(ctx, at, king) {
    var board = ctx.board;
    var rays = ctx.g.rays[at];
    var found = false;

    for (var d = 0; d < 4; d += 1) {
      if (!king && !ctx.rules.menCaptureBackwards && !isForward(ctx.owner, d)) continue;
      var ray = rays[d];

      if (king && ctx.rules.flyingKings) {
        var k = 0;
        while (k < ray.length && board[ray[k]] === EMPTY) k += 1;
        if (k >= ray.length - 1 || !jumpable(ctx, ray[k]) || board[ray[k + 1]] !== EMPTY) continue;
        var over = ray[k];
        var end = k + 1;
        while (end < ray.length && board[ray[end]] === EMPTY) end += 1;

        /* A flying king may land on any empty square past the piece — but if
           some of those squares let it keep capturing, it has to use one of
           them rather than stop short. */
        ctx.taken.push(over);
        var onwards = [];
        var anyOnwards = false;
        for (var j = k + 1; j < end; j += 1) {
          var can = canCapture(ctx, ray[j], true);
          onwards.push(can);
          if (can) anyOnwards = true;
        }
        ctx.taken.pop();

        for (j = k + 1; j < end; j += 1) {
          if (anyOnwards && !onwards[j - k - 1]) continue;
          found = true;
          landCapture(ctx, ray[j], over, true);
        }
      } else {
        if (ray.length < 2 || !jumpable(ctx, ray[0]) || board[ray[1]] !== EMPTY) continue;
        found = true;
        landCapture(ctx, ray[1], ray[0], king);
      }
    }

    if (!found && ctx.taken.length) {
      recordCapture(ctx, !isKing(ctx.piece) && (king || Math.floor(at / ctx.size) === ctx.lastRow));
    }
  }

  function hasCapture(board, player, rules) {
    var g = geometry(rules.size);
    var ctx = captureContext(board, rules, g, player, null);
    for (var i = 0; i < g.playable.length; i += 1) {
      var sq = g.playable[i];
      var value = board[sq];
      if (value !== EMPTY && ownerOf(value) === player && canCapture(ctx, sq, isKing(value))) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- moves */
  /* A move is { from, path, captures, promotes }: `path` lists every square
     the piece lands on, so a triple jump has three entries. */
  function generateMoves(board, player, rules) {
    var g = geometry(rules.size);
    var playable = g.playable;
    var captures = [];
    var ctx = null;
    var i, sq, value;

    for (i = 0; i < playable.length; i += 1) {
      sq = playable[i];
      value = board[sq];
      if (value === EMPTY || ownerOf(value) !== player) continue;
      if (!ctx) ctx = captureContext(board, rules, g, player, captures);
      var king = isKing(value);
      if (!canCapture(ctx, sq, king)) continue;
      ctx.from = sq;
      ctx.piece = value;
      board[sq] = EMPTY;                          // the moving piece has left its square
      extendCapture(ctx, sq, king);
      board[sq] = value;
    }

    if (captures.length) {
      if (!rules.maximumCapture) return captures;
      var most = 0;
      for (i = 0; i < captures.length; i += 1) most = Math.max(most, captures[i].captures.length);
      return captures.filter(function (move) { return move.captures.length === most; });
    }

    var moves = [];
    var lastRow = crownRow(player, rules.size);
    for (i = 0; i < playable.length; i += 1) {
      sq = playable[i];
      value = board[sq];
      if (value === EMPTY || ownerOf(value) !== player) continue;
      var crowned = isKing(value);
      var rays = g.rays[sq];
      for (var d = 0; d < 4; d += 1) {
        if (!crowned && !isForward(player, d)) continue;
        var ray = rays[d];
        var reach = crowned && rules.flyingKings ? ray.length : Math.min(1, ray.length);
        for (var k = 0; k < reach && board[ray[k]] === EMPTY; k += 1) {
          moves.push({
            from: sq,
            path: [ray[k]],
            captures: [],
            promotes: !crowned && Math.floor(ray[k] / rules.size) === lastRow
          });
        }
      }
    }
    return moves;
  }

  function legalMoves(state) {
    if (!state || state.result) return [];
    return generateMoves(state.board, state.turn, rulesFor(state.variant));
  }

  function destination(move) {
    return move.path[move.path.length - 1];
  }

  /* The legal move starting at `from` that lands on exactly `path`, or null. */
  function findMove(state, from, path) {
    var moves = legalMoves(state);
    for (var i = 0; i < moves.length; i += 1) {
      var move = moves[i];
      if (move.from !== from || move.path.length !== path.length) continue;
      var same = true;
      for (var k = 0; k < path.length; k += 1) {
        if (move.path[k] !== path[k]) { same = false; break; }
      }
      if (same) return move;
    }
    return null;
  }

  /* In place, for the search. Returns what `unmakeMove` needs to restore it.
     The origin is cleared before the destination is set, so a sequence that
     loops back to its own starting square still comes out right. */
  function makeMove(board, move) {
    var piece = board[move.from];
    var removed = [];
    for (var i = 0; i < move.captures.length; i += 1) {
      removed.push(board[move.captures[i]]);
      board[move.captures[i]] = EMPTY;
    }
    board[move.from] = EMPTY;
    board[destination(move)] = move.promotes ? (piece > 0 ? DARK_KING : LIGHT_KING) : piece;
    return { piece: piece, removed: removed };
  }

  function unmakeMove(board, move, info) {
    board[destination(move)] = EMPTY;
    board[move.from] = info.piece;
    for (var i = 0; i < move.captures.length; i += 1) board[move.captures[i]] = info.removed[i];
  }

  /* Who has won, or whether the game is drawn, with `state.turn` to move. */
  function judge(state, rules) {
    if (!generateMoves(state.board, state.turn, rules).length) {
      return {
        winner: other(state.turn),
        reason: countPieces(state.board, state.turn) ? 'blocked' : 'captured'
      };
    }
    var key = state.keys[state.keys.length - 1];
    var seen = 0;
    for (var i = 0; i < state.keys.length; i += 1) if (state.keys[i] === key) seen += 1;
    if (seen >= 3) return { winner: EMPTY, reason: 'repetition' };
    if (state.quiet >= rules.drawPlies) return { winner: EMPTY, reason: 'no-progress' };
    return null;
  }

  /* The public move: checks legality and never touches the state it was given. */
  function play(state, move) {
    if (!move || !state || state.result) return state;
    var legal = findMove(state, move.from, move.path || []);
    if (!legal) return state;

    var rules = rulesFor(state.variant);
    var next = cloneState(state);
    var piece = next.board[legal.from];
    makeMove(next.board, legal);
    next.moves.push(legal);
    next.turn = other(state.turn);

    /* A capture or a man move can never be undone by later play, so no
       earlier position can repeat and the no-progress count starts again. */
    var key = positionKey(next.board, next.turn);
    if (legal.captures.length || !isKing(piece)) {
      next.quiet = 0;
      next.keys = [key];
    } else {
      next.quiet += 1;
      next.keys.push(key);
    }
    next.result = judge(next, rules);
    return next;
  }

  function countPieces(board, player) {
    var count = 0;
    for (var i = 0; i < board.length; i += 1) {
      if (board[i] !== EMPTY && ownerOf(board[i]) === player) count += 1;
    }
    return count;
  }

  function pieceCounts(board) {
    var counts = { dark: { men: 0, kings: 0 }, light: { men: 0, kings: 0 } };
    for (var i = 0; i < board.length; i += 1) {
      var value = board[i];
      if (value === DARK_MAN) counts.dark.men += 1;
      else if (value === DARK_KING) counts.dark.kings += 1;
      else if (value === LIGHT_MAN) counts.light.men += 1;
      else if (value === LIGHT_KING) counts.light.kings += 1;
    }
    return counts;
  }

  /* ---------------------------------------------------------- evaluation */
  var ADVANCE = {
    8: [0, 1, 3, 5, 8, 12, 17, 0],
    10: [0, 1, 2, 4, 6, 9, 12, 16, 21, 0]
  };
  var CENTRE_COLUMN = {
    8: [0, 2, 3, 4, 4, 3, 2, 0],
    10: [0, 1, 2, 3, 4, 4, 3, 2, 1, 0]
  };
  var huntDarkKings = [];
  var huntLightKings = [];
  var huntDark = [];
  var huntLight = [];

  function nearestDistance(from, targets, size) {
    var best = size;
    var fr = Math.floor(from / size);
    var fc = from % size;
    for (var i = 0; i < targets.length; i += 1) {
      var d = Math.max(Math.abs(fr - Math.floor(targets[i] / size)), Math.abs(fc - targets[i] % size));
      if (d < best) best = d;
    }
    return best;
  }

  /* Positional score from `player`'s point of view. Material first; then
     men are paid for advancing and for holding the back row, kings for the
     centre (and flying kings for the long diagonal). Two terms stop the
     classic ways a checkers program throws away a won game: once ahead it is
     paid to trade pieces, and in a thin endgame its kings are paid to close
     in rather than shuffle. */
  function evaluate(board, player, rules) {
    var size = rules.size;
    var g = geometry(size);
    var playable = g.playable;
    var advance = ADVANCE[size];
    var centre = CENTRE_COLUMN[size];
    var score = 0;
    var darkMaterial = 0;
    var lightMaterial = 0;
    var pieces = 0;

    huntDarkKings.length = 0;
    huntLightKings.length = 0;
    huntDark.length = 0;
    huntLight.length = 0;

    for (var i = 0; i < playable.length; i += 1) {
      var sq = playable[i];
      var value = board[sq];
      if (value === EMPTY) continue;
      pieces += 1;
      var dark = value > 0;
      var worth;

      if (value === DARK_MAN || value === LIGHT_MAN) {
        var row = Math.floor(sq / size);
        var advanced = dark ? row : size - 1 - row;
        worth = 100 + advance[advanced] + centre[sq % size] + (advanced === 0 ? 5 : 0);
        if (dark) darkMaterial += 100; else lightMaterial += 100;
      } else {
        worth = rules.kingValue + g.kingBonus[sq] + (rules.flyingKings && g.mainRoad[sq] ? 10 : 0);
        if (dark) { darkMaterial += rules.kingValue; huntDarkKings.push(sq); }
        else { lightMaterial += rules.kingValue; huntLightKings.push(sq); }
      }
      if (dark) huntDark.push(sq); else huntLight.push(sq);
      score += dark ? worth : -worth;
    }

    if (darkMaterial !== lightMaterial) {
      score += Math.round(((darkMaterial - lightMaterial) * 500) / (darkMaterial + lightMaterial));
    }

    if (pieces <= 8 && darkMaterial !== lightMaterial) {
      var darkLeads = darkMaterial > lightMaterial;
      var hunters = darkLeads ? huntDarkKings : huntLightKings;
      var prey = darkLeads ? huntLight : huntDark;
      var closing = 0;
      for (var k = 0; k < hunters.length; k += 1) closing += size - nearestDistance(hunters[k], prey, size);
      score += (darkLeads ? 1 : -1) * closing * 4;
    }

    return player === DARK ? score : -score;
  }

  /* -------------------------------------------------------------- search */
  function orderMoves(moves, rules) {
    var size = rules.size;
    var g = geometry(size);
    var centre = CENTRE_COLUMN[size];
    for (var i = 0; i < moves.length; i += 1) {
      var move = moves[i];
      var to = destination(move);
      move.order = move.captures.length * 100 + (move.promotes ? 60 : 0) + centre[to % size] + (g.kingBonus[to] >> 2);
    }
    moves.sort(function (a, b) { return b.order - a.order; });
  }

  /* Negamax with alpha-beta. A loss is scored by how soon it arrives, so the
     opponent takes the fastest win and drags out a lost game. */
  function search(ctx, depth, alpha, beta, ply) {
    var board = ctx.board;
    var rules = ctx.rules;
    var player = ctx.turn;

    var moves = generateMoves(board, player, rules);
    if (!moves.length) return -(WIN_SCORE - ply);
    if (ply >= MAX_PLY) return evaluate(board, player, rules);

    if (depth <= 0 && !moves[0].captures.length) {
      /* Quiet for us — but if the opponent has a capture waiting, this is the
         middle of an exchange, not the end of the line. One more ply. */
      if (depth < 0 || !hasCapture(board, other(player), rules)) return evaluate(board, player, rules);
    }

    ctx.nodes += 1;
    if (ctx.deadline && (ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) ctx.timedOut = true;
    if (ctx.timedOut) return evaluate(board, player, rules);

    if (moves.length > 1) orderMoves(moves, rules);

    var best = -Infinity;
    for (var i = 0; i < moves.length; i += 1) {
      var move = moves[i];
      var info = makeMove(board, move);
      ctx.turn = other(player);
      var score = -search(ctx, depth - 1, -beta, -alpha, ply + 1);
      ctx.turn = player;
      unmakeMove(board, move, info);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                   // this branch is already refuted
    }
    return best;
  }

  /* Scores each root move. With `exact`, every move gets a true score (the
     easier levels choose among near-equal moves). Without it, later moves are
     searched against the best so far minus one — enough to tell a tie from a
     worse move, at a fraction of the cost. */
  function searchRoot(state, moves, depth, deadline, exact) {
    var rules = rulesFor(state.variant);
    var ctx = { board: state.board.slice(), rules: rules, turn: state.turn, nodes: 0, deadline: deadline, timedOut: false };
    var scored = [];
    var alpha = -Infinity;

    for (var i = 0; i < moves.length; i += 1) {
      var move = moves[i];
      var info = makeMove(ctx.board, move);
      ctx.turn = other(state.turn);
      var floor = exact || alpha === -Infinity ? -Infinity : alpha - 1;
      var score = -search(ctx, depth - 1, -Infinity, -floor, 1);
      ctx.turn = state.turn;
      unmakeMove(ctx.board, move, info);
      if (ctx.timedOut) break;
      scored.push({ move: move, score: score });
      if (score > alpha) alpha = score;
    }
    return { scored: scored, complete: !ctx.timedOut, nodes: ctx.nodes };
  }

  /* Iterative deepening: each finished depth reorders the root for the next,
     and when time runs out the deepest finished answer is played — so a slow
     phone gets a shallower opponent rather than a frozen page. */
  function bestMove(state, depth, options) {
    var opts = options || {};
    var moves = legalMoves(state);
    if (!moves.length) return null;

    var limit = Math.max(1, Math.min(MAX_DEPTH, depth || 1));
    var deadline = opts.timeLimit ? Date.now() + opts.timeLimit : 0;
    var margin = opts.margin || 0;
    var order = moves.slice();
    var result = null;
    var nodes = 0;

    for (var d = 1; d <= limit; d += 1) {
      var pass = searchRoot(state, order, d, d === 1 ? 0 : deadline, margin > 0);
      nodes += pass.nodes;
      if (!pass.complete) break;
      result = { scored: pass.scored, depth: d };
      order = pass.scored.slice()
        .sort(function (a, b) { return b.score - a.score; })
        .map(function (entry) { return entry.move; });
      if (moves.length === 1) break;
      var top = Math.max.apply(null, pass.scored.map(function (entry) { return entry.score; }));
      if (Math.abs(top) >= WIN_SCORE - MAX_PLY) break;         // a forced result will not change
      if (deadline && Date.now() > deadline) break;
    }

    var best = -Infinity;
    result.scored.forEach(function (entry) { if (entry.score > best) best = entry.score; });
    var picks = result.scored
      .filter(function (entry) { return entry.score >= best - margin; })
      .map(function (entry) { return entry.move; });
    var random = opts.rng || Math.random;
    var move = picks[Math.floor(random() * picks.length) % picks.length];
    return { move: move, score: best, scored: result.scored, depth: result.depth, ties: picks, nodes: nodes };
  }

  /* --------------------------------------------------------- difficulty */
  var DIFFICULTY = {
    easy: { depth: 2, blunder: 0.3, margin: 40, label: 'Easy' },
    medium: { depth: 4, blunder: 0.06, margin: 10, label: 'Medium' },
    hard: { depth: 6, blunder: 0, margin: 0, label: 'Hard' },
    expert: { depth: 16, blunder: 0, margin: 0, label: 'Expert' }
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
      rng: random
    });
    return picked ? picked.move : moves[0];
  }

  /* ------------------------------------------------------------ notation */
  function squareName(variantId, sq) {
    var rules = rulesFor(variantId);
    if (rules.notation === 'algebraic') {
      return 'abcdefghij'.charAt(sq % rules.size) + String(rules.size - Math.floor(sq / rules.size));
    }
    return String(geometry(rules.size).number[sq]);
  }

  /* 11-15 for a step, 22x15x8 for an American double jump, 37x19 for an
     international capture (start and finish only), c3:e5:g3 in Russian. */
  function moveNotation(variantId, move) {
    var rules = rulesFor(variantId);
    var name = function (sq) { return squareName(variantId, sq); };
    var capture = move.captures.length > 0;
    if (rules.notation === 'algebraic') {
      return [move.from].concat(move.path).map(name).join(capture ? ':' : '-');
    }
    if (!capture) return name(move.from) + '-' + name(destination(move));
    if (rules.captureNotation === 'full') return [move.from].concat(move.path).map(name).join('x');
    return name(move.from) + 'x' + name(destination(move));
  }

  /* ------------------------------------------------------ saved games */
  function serializeMoves(state) {
    return state.moves.map(function (move) { return [move.from].concat(move.path); });
  }

  /* A saved game is replayed move by move through the rules, so anything
     that was edited into local storage simply fails to replay. */
  function replay(variantId, list) {
    if (!VARIANTS[variantId] || !Array.isArray(list) || list.length > 1000) return null;
    var state = createState(variantId);
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (!Array.isArray(item) || item.length < 2 || item.length > 24 || state.result) return null;
      for (var k = 0; k < item.length; k += 1) {
        if (typeof item[k] !== 'number' || item[k] % 1 !== 0) return null;
      }
      var legal = findMove(state, item[0], item.slice(1));
      if (!legal) return null;
      state = play(state, legal);
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
    DARK: DARK,
    LIGHT: LIGHT,
    DARK_MAN: DARK_MAN,
    DARK_KING: DARK_KING,
    LIGHT_MAN: LIGHT_MAN,
    LIGHT_KING: LIGHT_KING,
    WIN_SCORE: WIN_SCORE,
    VARIANTS: VARIANTS,
    DIFFICULTY: DIFFICULTY,

    geometry: geometry,
    rulesFor: rulesFor,
    other: other,
    ownerOf: ownerOf,
    isKing: isKing,
    createState: createState,
    positionState: positionState,
    cloneState: cloneState,
    legalMoves: legalMoves,
    generateMoves: generateMoves,
    findMove: findMove,
    destination: destination,
    play: play,
    makeMove: makeMove,
    unmakeMove: unmakeMove,
    hasCapture: hasCapture,
    countPieces: countPieces,
    pieceCounts: pieceCounts,

    evaluate: evaluate,
    bestMove: bestMove,
    chooseMove: chooseMove,

    squareName: squareName,
    moveNotation: moveNotation,
    serializeMoves: serializeMoves,
    replay: replay,
    defaultStats: defaultStats,
    normalizeStats: normalizeStats
  };

  global.CheckersEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

}(typeof window !== 'undefined' ? window : this));
