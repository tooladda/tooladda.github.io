/* ==========================================================================
   exam-seating-engine.js — ToolAdda Exam Seating Arrangement Planner

   Pure allocation logic, deliberately kept free of DOM access so it can be
   exercised directly by scripts/exam-seating-engine.test.js under Node.

   The job: take a set of student groups (classes, branches, papers) and a set
   of rooms described as row x column seat grids, and place every student so
   that neighbouring seats hold students from DIFFERENT groups. That adjacency
   rule is the entire reason invigilators draw these charts by hand today.

   Two things this engine refuses to do quietly:
     1. Pretend a mathematically impossible mix succeeded. If one group is
        large enough that neighbours must repeat, analyse() says so BEFORE
        allocation runs, and allocate() marks every seat where it gave up.
     2. Silently drop students who did not fit. Overflow comes back in
        `unplaced` so the UI can show it.
   ========================================================================== */
(function (global) {
  'use strict';

  var ORDERS  = ['row', 'column', 'snake'];
  var MIXES   = ['strict', 'row', 'column', 'block'];
  var SPREADS = ['fill', 'spread'];

  /* ---------------------------------------------------------------- utils */

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function oneOf(v, list, dflt) {
    return list.indexOf(v) >= 0 ? v : dflt;
  }

  /* -------------------------------------------------------------- parsing */

  /* Split a roll token into its non-numeric prefix and numeric tail, so that
     "2021CS101" -> { prefix: "2021CS", num: 101, width: 3 }. Width is kept so
     zero-padded schemes ("007") survive the round trip. */
  function splitRoll(token) {
    var m = /^(.*?)(\d+)\s*$/.exec(String(token == null ? '' : token).trim());
    if (!m) return null;
    return { prefix: m[1], num: parseInt(m[2], 10), width: m[2].length };
  }

  function padNum(num, width) {
    var s = String(num);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /* Accepts, one group per line:
        CSE 101-160
        CSE, 101 - 160
        ECE 201 to 250
        MECH 2021ME01-2021ME40
        PHYSICS 45              (bare count -> rolls 1..45)
     The label is whatever precedes the range. */
  function parseGroups(text) {
    var out = [];
    var lines = String(text == null ? '' : text).split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;

      var body = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
      // Normalise the separators people actually type into a single hyphen.
      body = body.replace(/\s*(?:–|—|to|through|until)\s*/gi, '-');

      var label = body, startTok = null, endTok = null;

      var range = /^(.*?)\s*([A-Za-z0-9_\/]*\d+)\s*-\s*([A-Za-z0-9_\/]*\d+)$/.exec(body);
      if (range) {
        label = range[1].trim();
        startTok = range[2];
        endTok = range[3];
      } else {
        var single = /^(.*?)\s*(\d+)$/.exec(body);
        if (single) {
          label = single[1].trim();
          startTok = '1';
          endTok = single[2];
        } else {
          // No digits at all — keep it as a zero-count group so analyse() can
          // complain about it by name instead of silently dropping the line.
          label = body;
        }
      }

      var group = {
        id: 'g' + (out.length + 1),
        label: label || ('Group ' + (out.length + 1)),
        rolls: [],
        count: 0,
        raw: raw
      };

      if (startTok && endTok) {
        var a = splitRoll(startTok), b = splitRoll(endTok);
        if (a && b) {
          // A prefix on the END token alone ("101-CS160") is a typo, not a
          // scheme; prefer the start token's prefix and keep the numeric span.
          var prefix = a.prefix || b.prefix || '';
          // Zero-padding is something the user expresses on the START token:
          // "007-010" means three digits, "1-45" means none. Taking the wider
          // of the two would turn a plain "45" count into "01".."45".
          var width = a.width;
          var lo = Math.min(a.num, b.num), hi = Math.max(a.num, b.num);
          // Hard ceiling so a fat-fingered "1-999999" cannot hang the browser.
          if (hi - lo > 20000) hi = lo + 20000;
          for (var n = lo; n <= hi; n++) group.rolls.push(prefix + padNum(n, width));
        }
      }

      group.count = group.rolls.length;
      out.push(group);
    }

    return out;
  }

  /* Accepts, one room per line:
        Room 101 6x5
        Hall A, 8 x 4
        R-12 : 30            (bare capacity -> engine picks a near-square grid)
     Everything before the dimensions is the room name. */
  function parseRooms(text) {
    var out = [];
    var lines = String(text == null ? '' : text).split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;

      var body = raw.replace(/[,:]/g, ' ').replace(/\s+/g, ' ').trim();
      var name = body, rows = 0, cols = 0;

      var grid = /^(.*?)\s*(\d+)\s*[x×*]\s*(\d+)$/i.exec(body);
      if (grid) {
        name = grid[1].trim();
        rows = clampInt(grid[2], 1, 60, 1);
        cols = clampInt(grid[3], 1, 60, 1);
      } else {
        var cap = /^(.*?)\s*(\d+)$/.exec(body);
        if (cap) {
          name = cap[1].trim();
          var total = clampInt(cap[2], 1, 3600, 1);
          // Near-square but wider than deep: real halls rarely run deeper than
          // they are wide, and wide rows give the mixer more room to work.
          cols = Math.ceil(Math.sqrt(total));
          rows = Math.ceil(total / cols);
        }
      }

      if (!rows || !cols) continue;

      out.push({
        id: 'r' + (out.length + 1),
        name: name || ('Room ' + (out.length + 1)),
        rows: rows,
        cols: cols,
        capacity: rows * cols,
        raw: raw
      });
    }

    return out;
  }

  /* ---------------------------------------------------------- seat orders */

  /* The order in which seats are FILLED. Not the same as how they are drawn —
     the chart always shows row 1 at the front of the hall. */
  function seatSequence(rows, cols, order) {
    order = oneOf(order, ORDERS, 'row');
    var seq = [], r, c;

    if (order === 'column') {
      for (c = 0; c < cols; c++) {
        for (r = 0; r < rows; r++) seq.push({ r: r, c: c });
      }
    } else if (order === 'snake') {
      for (r = 0; r < rows; r++) {
        if (r % 2 === 0) { for (c = 0; c < cols; c++) seq.push({ r: r, c: c }); }
        else { for (c = cols - 1; c >= 0; c--) seq.push({ r: r, c: c }); }
      }
    } else {
      for (r = 0; r < rows; r++) {
        for (c = 0; c < cols; c++) seq.push({ r: r, c: c });
      }
    }

    return seq;
  }

  /* --------------------------------------------------------- feasibility */

  /* Whether a group can be laid out with no two of its members adjacent is a
     counting question, and it is worth answering before the user prints forty
     charts.

     Along a single line of n seats the largest group that fits with no two
     adjacent is ceil(n/2) — take every other seat. Across a grid under
     'strict' four-neighbour mixing the same bound applies via the checkerboard
     colouring, whose larger colour class holds ceil(rows*cols/2) seats. Either
     way the ceiling is half the seats, rounded up. */
  function analyse(groups, rooms, options) {
    options = options || {};
    var mix = oneOf(options.mix, MIXES, 'strict');

    var students = 0, i;
    for (i = 0; i < groups.length; i++) students += groups[i].count;

    var capacity = 0;
    for (i = 0; i < rooms.length; i++) capacity += rooms[i].capacity;

    var warnings = [];

    if (!groups.length) {
      warnings.push({ level: 'error', text: 'Add at least one class or group of students.' });
    }
    if (!rooms.length) {
      warnings.push({ level: 'error', text: 'Add at least one room with a seat grid, for example "Room 101 6x5".' });
    }

    for (i = 0; i < groups.length; i++) {
      if (groups[i].count === 0) {
        warnings.push({
          level: 'warn',
          text: '"' + groups[i].raw + '" has no roll numbers in it. Use a range like "CSE 101-160" or a plain count like "CSE 60".'
        });
      }
    }

    if (students > capacity) {
      warnings.push({
        level: 'error',
        text: students + ' students but only ' + capacity + ' seats. ' + (students - capacity) +
              ' student(s) will be left unplaced until you add a room or enlarge one.'
      });
    }

    // The impossibility check only bites when neighbours must actually differ.
    if (mix !== 'block' && capacity > 0 && students > 0) {
      var seatsInPlay = Math.min(students, capacity);
      var ceiling = Math.ceil(seatsInPlay / 2);
      for (i = 0; i < groups.length; i++) {
        if (groups[i].count > ceiling) {
          warnings.push({
            level: 'warn',
            text: '"' + groups[i].label + '" holds ' + groups[i].count + ' of the ' + seatsInPlay +
                  ' students being seated. With more than half the seats, some of them must sit next to each ' +
                  'other whatever the arrangement — the plan marks those seats rather than hiding them. Split ' +
                  'the class across two papers, or seat it alongside another class in more rooms.'
          });
        }
      }
    }

    if (groups.length === 1 && mix !== 'block') {
      warnings.push({
        level: 'info',
        text: 'Only one group is present, so there is nobody to alternate with. Every neighbour will be from the same group.'
      });
    }

    return {
      students: students,
      capacity: capacity,
      spare: capacity - students,
      warnings: warnings,
      ok: warnings.filter(function (w) { return w.level === 'error'; }).length === 0
    };
  }

  /* -------------------------------------------------------- distribution */

  /* Decide how many students of each group go into each room before any seat
     is chosen. 'fill' packs room by room; 'spread' gives every room the same
     group mix, which is what most exam offices want because it stops a single
     invigilator facing one entire class. */
  function distribute(groups, rooms, mode) {
    mode = oneOf(mode, SPREADS, 'spread');

    var remaining = groups.map(function (g) { return g.count; });
    var quota = rooms.map(function () { return groups.map(function () { return 0; }); });
    var i, j;

    if (mode === 'fill') {
      var gi = 0;
      for (i = 0; i < rooms.length; i++) {
        var free = rooms[i].capacity;
        while (free > 0 && gi < groups.length) {
          if (remaining[gi] <= 0) { gi++; continue; }
          var take = Math.min(free, remaining[gi]);
          quota[i][gi] += take;
          remaining[gi] -= take;
          free -= take;
        }
      }
      return quota;
    }

    // 'spread': hand each room its proportional share of every group, then
    // settle the rounding remainder one seat at a time into whichever room is
    // emptiest and whichever group is furthest from being seated.
    var totalCapacity = 0;
    for (i = 0; i < rooms.length; i++) totalCapacity += rooms[i].capacity;
    if (totalCapacity === 0) return quota;

    var used = rooms.map(function () { return 0; });

    for (j = 0; j < groups.length; j++) {
      for (i = 0; i < rooms.length; i++) {
        var share = Math.floor(groups[j].count * rooms[i].capacity / totalCapacity);
        share = Math.min(share, rooms[i].capacity - used[i], remaining[j]);
        quota[i][j] += share;
        used[i] += share;
        remaining[j] -= share;
      }
    }

    var guard = 0;
    for (;;) {
      if (++guard > 100000) break;

      var gBest = -1;
      for (j = 0; j < groups.length; j++) {
        if (remaining[j] > 0 && (gBest < 0 || remaining[j] > remaining[gBest])) gBest = j;
      }
      if (gBest < 0) break;

      var rBest = -1, bestFree = 0;
      for (i = 0; i < rooms.length; i++) {
        var free2 = rooms[i].capacity - used[i];
        if (free2 > bestFree) { bestFree = free2; rBest = i; }
      }
      if (rBest < 0) break;

      quota[rBest][gBest] += 1;
      used[rBest] += 1;
      remaining[gBest] -= 1;
    }

    return quota;
  }

  /* ----------------------------------------------------------- allocation */

  function neighboursOf(r, c, mix) {
    var list = [];
    if (mix === 'block') return list;
    if (mix === 'strict' || mix === 'row') {
      list.push({ r: r, c: c - 1 });
      list.push({ r: r, c: c + 1 });
    }
    if (mix === 'strict' || mix === 'column') {
      list.push({ r: r - 1, c: c });
      list.push({ r: r + 1, c: c });
    }
    return list;
  }

  function allocate(groups, rooms, options) {
    options = options || {};
    var order  = oneOf(options.order, ORDERS, 'row');
    var mix    = oneOf(options.mix, MIXES, 'strict');
    var spread = oneOf(options.spread, SPREADS, 'spread');

    var quota = distribute(groups, rooms, spread);

    // Per-group cursor into the roll list, shared across rooms so that no roll
    // number is ever issued twice.
    var cursor = groups.map(function () { return 0; });

    var placedRooms = [];
    var conflicts = [];
    var i, j, r, c;

    for (i = 0; i < rooms.length; i++) {
      var room = rooms[i];
      var grid = [];
      for (r = 0; r < room.rows; r++) {
        var rowArr = [];
        for (c = 0; c < room.cols; c++) rowArr.push(null);
        grid.push(rowArr);
      }

      var left = quota[i].slice();
      var seq = seatSequence(room.rows, room.cols, order);
      var filled = 0;

      for (var s = 0; s < seq.length; s++) {
        var pos = seq[s];

        var anyLeft = false;
        for (j = 0; j < left.length; j++) { if (left[j] > 0) { anyLeft = true; break; } }
        if (!anyLeft) break;

        var forbidden = {};
        var nb = neighboursOf(pos.r, pos.c, mix);
        for (var k = 0; k < nb.length; k++) {
          var n = nb[k];
          if (n.r < 0 || n.c < 0 || n.r >= room.rows || n.c >= room.cols) continue;
          var occ = grid[n.r][n.c];
          if (occ) forbidden[occ.groupIndex] = true;
        }

        // Prefer the group with most students still to seat — it is the one
        // most likely to become impossible to place later on.
        var pick = -1;
        for (j = 0; j < left.length; j++) {
          if (left[j] <= 0 || forbidden[j]) continue;
          if (pick < 0 || left[j] > left[pick]) pick = j;
        }

        var clashed = false;
        if (pick < 0) {
          for (j = 0; j < left.length; j++) {
            if (left[j] <= 0) continue;
            if (pick < 0 || left[j] > left[pick]) pick = j;
          }
          clashed = mix !== 'block';
        }
        if (pick < 0) break;

        var g = groups[pick];
        var roll = g.rolls[cursor[pick]] || (g.label + ' #' + (cursor[pick] + 1));
        cursor[pick] += 1;
        left[pick] -= 1;
        filled += 1;

        grid[pos.r][pos.c] = {
          roll: roll,
          groupIndex: pick,
          groupId: g.id,
          groupLabel: g.label,
          seatNo: s + 1,
          row: pos.r,
          col: pos.c,
          clash: clashed
        };

        if (clashed) {
          conflicts.push({
            roomId: room.id, roomName: room.name,
            row: pos.r, col: pos.c, seatNo: s + 1, roll: roll
          });
        }
      }

      var counts = {};
      for (j = 0; j < groups.length; j++) {
        var seatedHere = quota[i][j] - left[j];
        if (seatedHere > 0) counts[groups[j].label] = seatedHere;
      }

      placedRooms.push({
        id: room.id,
        name: room.name,
        rows: room.rows,
        cols: room.cols,
        capacity: room.capacity,
        grid: grid,
        filled: filled,
        vacant: room.capacity - filled,
        counts: counts
      });
    }

    // Anyone the rooms could not take.
    var unplaced = [];
    for (j = 0; j < groups.length; j++) {
      for (var t = cursor[j]; t < groups[j].rolls.length; t++) {
        unplaced.push({ roll: groups[j].rolls[t], groupLabel: groups[j].label });
      }
    }

    var seated = 0;
    for (j = 0; j < cursor.length; j++) seated += cursor[j];

    return {
      rooms: placedRooms,
      conflicts: conflicts,
      unplaced: unplaced,
      seated: seated,
      options: { order: order, mix: mix, spread: spread }
    };
  }

  /* -------------------------------------------------------------- reports */

  /* Row letter + column number: A1, A2, B1 ... the notation invigilators
     already use when they call out a seat. */
  function seatLabel(rowIdx, colIdx) {
    var letters = '';
    var n = rowIdx;
    do {
      letters = String.fromCharCode(65 + (n % 26)) + letters;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letters + (colIdx + 1);
  }

  /* Roll number -> room and seat, for the list pinned outside the hall. */
  function studentIndex(plan) {
    var rows = [];
    for (var i = 0; i < plan.rooms.length; i++) {
      var room = plan.rooms[i];
      for (var r = 0; r < room.grid.length; r++) {
        for (var c = 0; c < room.grid[r].length; c++) {
          var cell = room.grid[r][c];
          if (!cell) continue;
          rows.push({
            roll: cell.roll,
            groupLabel: cell.groupLabel,
            roomName: room.name,
            seatNo: cell.seatNo,
            seatLabel: seatLabel(r, c),
            row: r + 1,
            col: c + 1
          });
        }
      }
    }
    rows.sort(function (a, b) {
      return String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true, sensitivity: 'base' });
    });
    return rows;
  }

  function summary(plan, groups) {
    var totalCapacity = 0;
    for (var i = 0; i < plan.rooms.length; i++) totalCapacity += plan.rooms[i].capacity;
    return {
      rooms: plan.rooms.length,
      groups: groups.length,
      seated: plan.seated,
      capacity: totalCapacity,
      vacant: totalCapacity - plan.seated,
      unplaced: plan.unplaced.length,
      conflicts: plan.conflicts.length,
      clean: plan.conflicts.length === 0 && plan.unplaced.length === 0
    };
  }

  /* Recheck the finished grid rather than trusting the allocator's own
     bookkeeping — the test suite uses this as an independent oracle. */
  function verify(plan, mix) {
    mix = oneOf(mix, MIXES, 'strict');
    var bad = [];
    if (mix === 'block') return bad;

    for (var i = 0; i < plan.rooms.length; i++) {
      var room = plan.rooms[i];
      for (var r = 0; r < room.rows; r++) {
        for (var c = 0; c < room.cols; c++) {
          var cell = room.grid[r][c];
          if (!cell) continue;
          var nb = neighboursOf(r, c, mix);
          for (var k = 0; k < nb.length; k++) {
            var n = nb[k];
            if (n.r < 0 || n.c < 0 || n.r >= room.rows || n.c >= room.cols) continue;
            var other = room.grid[n.r][n.c];
            if (other && other.groupIndex === cell.groupIndex) {
              bad.push({ roomName: room.name, a: cell.roll, b: other.roll, group: cell.groupLabel });
            }
          }
        }
      }
    }
    return bad;
  }

  function toCSV(rows) {
    var head = ['Roll Number', 'Class / Group', 'Room', 'Seat', 'Row', 'Column'];
    var lines = [head.join(',')];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push([r.roll, r.groupLabel, r.roomName, r.seatLabel, r.row, r.col].map(function (v) {
        var s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','));
    }
    return lines.join('\n');
  }

  /* One-call convenience wrapper used by the UI. */
  function plan(groupsText, roomsText, options) {
    var groups = parseGroups(groupsText);
    var rooms = parseRooms(roomsText);
    var report = analyse(groups, rooms, options);
    var allocation = allocate(groups, rooms, options);
    return {
      groups: groups,
      rooms: rooms,
      analysis: report,
      allocation: allocation,
      index: studentIndex(allocation),
      summary: summary(allocation, groups)
    };
  }

  global.ExamSeatingEngine = {
    ORDERS: ORDERS,
    MIXES: MIXES,
    SPREADS: SPREADS,

    splitRoll: splitRoll,
    padNum: padNum,
    parseGroups: parseGroups,
    parseRooms: parseRooms,

    seatSequence: seatSequence,
    seatLabel: seatLabel,

    analyse: analyse,
    distribute: distribute,
    allocate: allocate,

    studentIndex: studentIndex,
    summary: summary,
    verify: verify,
    toCSV: toCSV,
    plan: plan
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.ExamSeatingEngine;

})(typeof window !== 'undefined' ? window : this);
