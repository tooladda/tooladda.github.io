/* ==========================================================================
   ToolAdda — Bingo Card Generator (engine)

   Every decision that can be made without a DOM lives here: the seeded
   random number generator, card layouts for 75-ball, 90-ball and custom
   content, the combinatorial ceiling on how many genuinely distinct cards
   a given configuration can produce, win patterns, and win verification.

   Two rules this file exists to enforce:

   1. UNIQUENESS IS EARNED, NOT CLAIMED. A generator that quietly emits
      duplicates once it runs out of distinct layouts is lying to a teacher
      who printed 30 cards for 30 children. generateCards() reports exactly
      how many unique cards it produced and why it stopped.

   2. A CALL MATCHES A CELL ONLY IF IT IS THE SAME CALL. Substring matching
      makes "B7" satisfy a square holding "B75", which validates wins that
      never happened.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Seeded randomness

     Deterministic by design: the same seed must rebuild the same card
     months later, because that is what makes a printed card verifiable.
     ====================================================================== */

  /** FNV-1a. Stable across engines — Math.random and Date are unusable here. */
  function hashSeed(str) {
    var h = 2166136261;
    var s = String(str === undefined || str === null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** mulberry32 — small, fast, and good enough for shuffling a bingo card. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Fisher-Yates on a copy. Never mutates the caller's array. */
  function shuffle(list, rng) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function pickN(pool, n, rng) { return shuffle(pool, rng).slice(0, n); }

  /* ======================================================================
     2. Reference data
     ====================================================================== */

  var COL75 = ['B', 'I', 'N', 'G', 'O'];
  var RANGE75 = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  /* UK 90-ball columns: the first holds 1-9 and the last 80-90, which is
     why they are listed rather than computed. */
  var UK_COLS = [[1, 9], [10, 19], [20, 29], [30, 39], [40, 49],
                 [50, 59], [60, 69], [70, 79], [80, 90]];

  var TEMPLATES = [
    { id: 'classic', label: 'Classic' },
    { id: 'modern', label: 'Modern' },
    { id: 'playful', label: 'Playful' },
    { id: 'minimal', label: 'Minimal' },
    { id: 'festive', label: 'Festive' }
  ];

  var COLORS = {
    indigo:  { header: '#4f46e5', accent: '#6366f1', cell: '#eef2ff', text: '#1e1b4b', border: '#c7d2fe' },
    emerald: { header: '#059669', accent: '#10b981', cell: '#ecfdf5', text: '#064e3b', border: '#a7f3d0' },
    rose:    { header: '#e11d48', accent: '#f43f5e', cell: '#fff1f2', text: '#881337', border: '#fecdd3' },
    amber:   { header: '#d97706', accent: '#f59e0b', cell: '#fffbeb', text: '#78350f', border: '#fde68a' },
    slate:   { header: '#334155', accent: '#64748b', cell: '#f8fafc', text: '#0f172a', border: '#cbd5e1' }
  };

  var RAW_THEMES = {
    christmas: ['Santa', 'Reindeer', 'Snowman', 'Mistletoe', 'Stocking', 'Ornament', 'Candy Cane', 'Gingerbread', 'Wreath', 'Bell', 'Star', 'Gift', 'Holly', 'Elf', 'Sleigh', 'Carols', 'Nativity', 'Angel', 'Tree', 'Candle', 'Nutcracker', 'Poinsettia', 'Chimney', 'Coal', 'Eggnog', 'Tinsel', 'Frost', 'Snowflake', 'Fireplace', 'Cocoa'],
    halloween: ['Pumpkin', 'Ghost', 'Witch', 'Bat', 'Spider', 'Candy', 'Costume', 'Haunted', 'Zombie', 'Skeleton', 'Vampire', 'Werewolf', 'Mummy', 'Graveyard', 'Cauldron', 'Broomstick', 'Cobweb', 'Frankenstein', 'Black Cat', 'Trick', 'Treat', 'Moon', 'Owl', 'Mask', 'Cemetery', 'Lantern', 'Potion', 'Fog', 'Raven', 'Scarecrow'],
    wedding: ['Bride', 'Groom', 'Ring', 'Bouquet', 'Veil', 'Toast', 'Dance', 'Cake', 'Kiss', 'Love', 'Vows', 'Chapel', 'Reception', 'Garter', 'Honeymoon', 'Rice', 'Lace', 'Champagne', 'Candles', 'First Dance', 'Altar', 'Bridesmaid', 'Groomsman', 'Forever', 'Confetti', 'Speech', 'Bouquet Toss', 'Photographer', 'Best Man', 'Something Blue'],
    babyshower: ['Diaper', 'Bottle', 'Rattle', 'Stroller', 'Crib', 'Pacifier', 'Onesie', 'Blanket', 'Mobile', 'Lullaby', 'Booties', 'Bib', 'Nursery', 'Ultrasound', 'Due Date', 'Gender', 'Name', 'Shower', 'Gift', 'Cake', 'Balloons', 'Stork', 'Teddy', 'Lotion', 'Wipes', 'Highchair', 'Car Seat', 'Nappy', 'Swaddle', 'First Word'],
    office: ['Meeting', 'Deadline', 'Email', 'Coffee', 'Printer', 'Spreadsheet', 'Budget', 'Report', 'Presentation', 'Laptop', 'Calendar', 'Commute', 'Overtime', 'Bonus', 'Team', 'Project', 'KPI', 'Standup', 'Zoom', 'Slack', 'Invoice', 'Client', 'Pitch', 'Review', 'Promotion', 'Onboarding', 'Retro', 'Backlog', 'Sync', 'Roadmap'],
    roadtrip: ['Highway', 'Motel', 'Gas', 'Map', 'Snacks', 'Playlist', 'Rest Stop', 'Scenic', 'Toll', 'Luggage', 'Passport', 'Camera', 'Souvenir', 'Detour', 'Mileage', 'Compass', 'Camping', 'Picnic', 'Sunset', 'Roadside', 'Diner', 'Traffic', 'Horizon', 'Adventure', 'Journey', 'Roadworks', 'Service Station', 'Sunrise', 'Bridge', 'Tunnel'],
    classroom: ['Homework', 'Recess', 'Pencil', 'Eraser', 'Chalkboard', 'Teacher', 'Student', 'Quiz', 'Grade', 'Library', 'Science', 'Math', 'History', 'Art', 'Music', 'Globe', 'Backpack', 'Locker', 'Bell', 'Desk', 'Notebook', 'Ruler', 'Crayon', 'Project', 'Field Trip', 'Assembly', 'Register', 'Marker', 'Glue Stick', 'Reading'],
    movie: ['Popcorn', 'Ticket', 'Director', 'Actor', 'Script', 'Scene', 'Trailer', 'Oscar', 'Cinema', 'Credits', 'Sequel', 'Villain', 'Hero', 'Plot', 'Climax', 'Genre', 'Stunt', 'Soundtrack', 'Premiere', 'Blockbuster', 'Franchise', 'Cast', 'Studio', 'Review', 'Marathon', 'Cameo', 'Prequel', 'Box Office', 'Screening', 'Reel'],
    sports: ['Goal', 'Team', 'Coach', 'Stadium', 'Trophy', 'Medal', 'Referee', 'Penalty', 'Overtime', 'Champion', 'League', 'Draft', 'MVP', 'Fan', 'Jersey', 'Score', 'Match', 'Training', 'Victory', 'Defeat', 'Captain', 'Rival', 'Playoff', 'Record', 'Underdog', 'Halftime', 'Substitute', 'Foul', 'Kickoff', 'Final'],
    birthday: ['Cake', 'Candle', 'Balloon', 'Gift', 'Party', 'Wish', 'Confetti', 'Surprise', 'Age', 'Celebrate', 'Frosting', 'Streamers', 'Piñata', 'Games', 'Friends', 'Family', 'Song', 'Toast', 'Memory', 'Cheers', 'Sparkler', 'Banner', 'Treat', 'Fun', 'Joy', 'Card', 'Party Hat', 'Ice Cream', 'Guests', 'Photo'],
    diwali: ['Diya', 'Rangoli', 'Firecracker', 'Lamp', 'Sweets', 'Lakshmi', 'Ganesha', 'Festival', 'Lights', 'Prosperity', 'Family', 'Puja', 'New Clothes', 'Decor', 'Gift', 'Joy', 'Tradition', 'Home', 'Prayer', 'Celebration', 'Sparkle', 'Gold', 'Incense', 'Mithai', 'Victory', 'Toran', 'Kheel', 'Marigold', 'Aarti', 'Dhanteras'],
    cricket: ['Wicket', 'Bowler', 'Batsman', 'Six', 'Four', 'LBW', 'Catch', 'Run', 'Over', 'Stump', 'Pitch', 'Helmet', 'Pad', 'Glove', 'Boundary', 'Innings', 'Umpire', 'Spin', 'Pace', 'Yorker', 'Bouncer', 'Century', 'Duck', 'Hat-trick', 'Ashes', 'Maiden', 'Slip', 'Powerplay', 'Nightwatchman', 'Declaration'],
    emoji: ['😀', '😂', '😍', '🥳', '😎', '🤔', '😴', '🤯', '👍', '👏', '🎉', '❤️', '🔥', '⭐', '🌈', '🍕', '🎂', '⚽', '🎵', '📱', '💡', '🚀', '🐶', '🐱', '🌸', '🍩', '🏆', '🎈', '🌍', '🎁'],
    sightwords: ['the', 'and', 'a', 'to', 'said', 'in', 'he', 'I', 'of', 'it', 'was', 'you', 'they', 'on', 'she', 'is', 'for', 'at', 'his', 'but', 'that', 'with', 'all', 'we', 'can', 'her', 'my', 'me', 'up', 'go'],
    multiplication: ['1×1=1', '2×2=4', '3×3=9', '4×4=16', '5×5=25', '6×6=36', '7×7=49', '8×8=64', '9×9=81', '2×3=6', '3×4=12', '4×5=20', '5×6=30', '6×7=42', '7×8=56', '8×9=72', '9×10=90', '3×5=15', '4×6=24', '5×7=35', '6×8=48', '7×9=63', '2×5=10', '3×6=18', '4×7=28', '2×7=14', '3×8=24', '4×9=36', '5×9=45', '6×9=54']
  };

  /* A repeated word can land on the same card twice, which looks like a
     printing error to the player. Dedupe once, at load. */
  var THEMES = (function () {
    var out = {};
    Object.keys(RAW_THEMES).forEach(function (key) {
      var seen = {};
      out[key] = RAW_THEMES[key].filter(function (word) {
        var k = word.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    });
    return out;
  })();

  var THEME_IDS = Object.keys(THEMES);
  var CONTENT_MODES = ['ball75', 'ball90', 'words', 'images'];
  var FREE_SPACE_MODES = ['none', 'center'];
  var WIN_PATTERNS = ['line', 'row', 'column', 'diagonal', 'fourcorners', 'blackout', 'x', 'frame', 'tshape'];
  var PAPER_SIZES = {
    a4: { id: 'a4', label: 'A4', widthPt: 595.28, heightPt: 841.89 },
    letter: { id: 'letter', label: 'US Letter', widthPt: 612, heightPt: 792 },
    a5: { id: 'a5', label: 'A5', widthPt: 419.53, heightPt: 595.28 }
  };

  /* ======================================================================
     3. Small helpers
     ====================================================================== */

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) === -1 ? fallback : value;
  }

  /**
   * Text destined for a canvas or a PDF string. Control characters can
   * corrupt a PDF's structure, so they are stripped rather than escaped.
   */
  function safeText(value) {
    var s = String(value === undefined || value === null ? '' : value);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 32 || code === 9) out += s.charAt(i);
    }
    return out.slice(0, 300);
  }

  /* ======================================================================
     4. Card geometry
     ====================================================================== */

  function cardShape(settings) {
    if (settings.contentMode === 'ball90') return { rows: 3, cols: 9 };
    var size = clampNum(settings.gridSize, 3, 6, 5);
    return { rows: size, cols: size };
  }

  /** Does this configuration place a free square, and where? */
  function freeSpaceCell(settings, shape) {
    if (settings.freeSpace !== 'center') return null;
    if (settings.contentMode === 'ball90') return null;
    /* An even grid has no middle square; silently placing one off-centre
       would look like a bug to the user. */
    if (shape.rows % 2 === 0 || shape.cols % 2 === 0) return null;
    return { row: Math.floor(shape.rows / 2), col: Math.floor(shape.cols / 2) };
  }

  /** How many real items a card consumes, excluding any free square. */
  function cellsNeeded(settings) {
    var shape = cardShape(settings);
    if (settings.contentMode === 'ball90') return 15;
    var total = shape.rows * shape.cols;
    return freeSpaceCell(settings, shape) ? total - 1 : total;
  }

  /* ======================================================================
     5. How many distinct cards are actually possible

     Printing 100 cards from a 25-word list is fine; printing 100 from a
     24-word list is not, because only one arrangement's worth of content
     exists. Knowing the ceiling in advance is what lets the UI warn before
     someone sends 100 pages to a printer.
     ====================================================================== */

  /** log10 of nPr, computed in log space so 75-ball values do not overflow. */
  function logPermutations(n, r) {
    if (r > n || r < 0) return -Infinity;
    var total = 0;
    for (var i = 0; i < r; i++) total += Math.log10(n - i);
    return total;
  }

  /**
   * Returns { log10, approx, exact, limited } — `exact` only when the count
   * is small enough to state precisely, so the UI never prints a rounded
   * number as if it were exact.
   */
  function maxUniqueCards(settings, poolSize) {
    var log10;

    if (settings.contentMode === 'ball75') {
      /* Five independent columns; the middle one loses a square to FREE. */
      var shape = cardShape(settings);
      var free = freeSpaceCell(settings, shape);
      log10 = 0;
      for (var c = 0; c < 5; c++) {
        var perColumn = free && c === 2 ? 4 : 5;
        log10 += logPermutations(15, perColumn);
      }
    } else if (settings.contentMode === 'ball90') {
      /* A genuine UK 90-ball count depends on the blank-square layout and
         is not a clean permutation. This is a deliberate under-estimate of
         the column choices alone, which is the honest direction to err. */
      log10 = 0;
      for (var k = 0; k < 9; k++) {
        var span = UK_COLS[k][1] - UK_COLS[k][0] + 1;
        log10 += logPermutations(span, 2);
      }
    } else {
      var need = cellsNeeded(settings);
      if (poolSize < need) return { log10: -Infinity, approx: 0, exact: 0, limited: true };
      log10 = logPermutations(poolSize, need);
    }

    var exact = null;
    if (log10 < 15) exact = Math.round(Math.pow(10, log10));
    return {
      log10: log10,
      approx: Math.pow(10, log10),
      exact: exact,
      limited: log10 < 3   /* fewer than ~1000 distinct cards is worth saying */
    };
  }

  /* ======================================================================
     6. Card builders

     Each returns a grid of cells. A cell is
       { type: 'number'|'text'|'image'|'free', ... }
     or null for a deliberate blank (90-ball only).
     ====================================================================== */

  function generate75Card(rng, settings) {
    var shape = cardShape(settings);
    var free = freeSpaceCell(settings, shape);
    var grid = [];
    var r, c;
    for (r = 0; r < shape.rows; r++) grid.push(new Array(shape.cols).fill(null));

    for (c = 0; c < shape.cols; c++) {
      /* Standard 75-ball only defines five columns. A larger custom grid
         reuses the ranges cyclically rather than inventing new ones. */
      var range = RANGE75[c % RANGE75.length];
      var pool = [];
      for (var n = range[0]; n <= range[1]; n++) pool.push(n);
      var needed = shape.rows;
      var picks = pickN(pool, Math.min(needed, pool.length), rng);
      for (r = 0; r < shape.rows; r++) {
        if (free && r === free.row && c === free.col) {
          grid[r][c] = { type: 'free', text: safeText(settings.freeText) || 'FREE' };
        } else {
          grid[r][c] = { type: 'number', value: picks[r], letter: COL75[c % COL75.length] };
        }
      }
    }

    return {
      type: 'ball75',
      grid: grid,
      rows: shape.rows,
      cols: shape.cols,
      headers: settings.bingoHeader && shape.cols === 5 ? COL75.slice() : null
    };
  }

  /**
   * UK 90-ball: 3 rows x 9 columns, exactly 5 numbers per row (15 total),
   * every column holding at least one number. The layout is generated
   * first, then filled — doing it the other way round makes the row
   * constraint very hard to satisfy.
   */
  function generateUK90Layout(rng) {
    var r, c, i;
    var grid = [];
    for (r = 0; r < 3; r++) grid.push(new Array(9).fill(false));

    /* Step 1: how many numbers each column holds. Every column starts at 1
       so none can end up empty, then six more are spread around, capped at
       3 because a column only has three rows. 9 + 6 = 15. */
    var counts = new Array(9).fill(1);
    var spare = 6;
    while (spare > 0) {
      var choices = [];
      for (c = 0; c < 9; c++) if (counts[c] < 3) choices.push(c);
      var pick = choices[Math.floor(rng() * choices.length)];
      counts[pick]++;
      spare--;
    }

    /* Step 2: place each column's numbers into rows, always filling the
       rows with the most space left first. This is the Havel-Hakimi
       construction: because the totals are feasible (15 numbers, 5 per
       row), taking the emptiest rows first can never paint itself into a
       corner — which the previous "fill then rebalance" approach did,
       leaving roughly one card in ten with the wrong row counts. */
    var rowsLeft = [5, 5, 5];
    var order = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rng);

    for (i = 0; i < order.length; i++) {
      c = order[i];
      var ranked = [0, 1, 2].sort(function (a, b) {
        if (rowsLeft[b] !== rowsLeft[a]) return rowsLeft[b] - rowsLeft[a];
        return rng() - 0.5;      /* break ties at random so cards vary */
      });
      for (var k = 0; k < counts[c]; k++) {
        var row = ranked[k];
        grid[row][c] = true;
        rowsLeft[row]--;
      }
    }

    return grid;
  }

  function generateUK90Card(rng, settings) {
    var layout = generateUK90Layout(rng);
    var grid = [];
    var r, c;
    for (r = 0; r < 3; r++) grid.push(new Array(9).fill(null));

    for (c = 0; c < 9; c++) {
      var span = UK_COLS[c];
      var pool = [];
      for (var n = span[0]; n <= span[1]; n++) pool.push(n);
      var wanted = (layout[0][c] ? 1 : 0) + (layout[1][c] ? 1 : 0) + (layout[2][c] ? 1 : 0);
      /* UK convention: numbers ascend down a column. */
      var picks = pickN(pool, wanted, rng).sort(function (a, b) { return a - b; });
      var used = 0;
      for (r = 0; r < 3; r++) {
        if (layout[r][c]) grid[r][c] = { type: 'number', value: picks[used++] };
      }
    }

    return { type: 'ball90', grid: grid, rows: 3, cols: 9, headers: null };
  }

  function generateContentCard(rng, settings, pool) {
    var shape = cardShape(settings);
    var free = freeSpaceCell(settings, shape);
    var need = cellsNeeded(settings);

    var usable = (pool || []).filter(function (item) {
      return item && (typeof item === 'string' || item.type === 'image');
    });
    if (usable.length < need) {
      throw new Error('Need at least ' + need + ' items for a ' + shape.rows + ' × ' + shape.cols +
        ' card — the list has ' + usable.length + '.');
    }

    var items = pickN(usable, need, rng);
    var grid = [];
    var idx = 0;
    for (var r = 0; r < shape.rows; r++) {
      var row = [];
      for (var c = 0; c < shape.cols; c++) {
        if (free && r === free.row && c === free.col) {
          row.push({ type: 'free', text: safeText(settings.freeText) || 'FREE' });
        } else {
          var item = items[idx++];
          row.push(typeof item === 'string' ? { type: 'text', text: safeText(item) } : item);
        }
      }
      grid.push(row);
    }

    return {
      type: settings.contentMode === 'images' ? 'images' : 'words',
      grid: grid,
      rows: shape.rows,
      cols: shape.cols,
      headers: settings.bingoHeader && shape.cols === 5 ? COL75.slice() : null
    };
  }

  /** Build one card for a given seed. The single entry point for all modes. */
  function buildCard(seed, settings, pool) {
    var rng = mulberry32(seed >>> 0);
    if (settings.contentMode === 'ball75') return generate75Card(rng, settings);
    if (settings.contentMode === 'ball90') return generateUK90Card(rng, settings);
    return generateContentCard(rng, settings, pool);
  }

  /* ======================================================================
     7. Bulk generation

     Reports what it actually achieved. If a configuration can only yield
     12 distinct cards and 30 were requested, the caller finds out here —
     not after printing.
     ====================================================================== */

  function cardSignature(card) {
    var parts = [];
    for (var r = 0; r < card.rows; r++) {
      for (var c = 0; c < card.cols; c++) {
        var cell = card.grid[r][c];
        if (!cell) { parts.push(''); continue; }
        if (cell.type === 'number') parts.push('n' + cell.value);
        else if (cell.type === 'free') parts.push('f');
        /* Prefer the short id: an uploaded image's src is a data URL, and
           500 cards' worth of those would be megabytes of signature. */
        else if (cell.type === 'image') parts.push('i' + (cell.id || cell.src || cell.label || ''));
        else parts.push('t' + cell.text);
      }
      parts.push('|');
    }
    return parts.join(',');
  }

  function cardId(index) { return 'CARD-' + String(index + 1).padStart(3, '0'); }

  /**
   * @returns {{cards:Array, requested:number, unique:number, duplicates:number,
   *            exhausted:boolean, attempts:number, error:string|null}}
   */
  function generateCards(settings, pool, options) {
    var opts = options || {};
    var count = Math.round(clampNum(settings.cardCount, 1, 500, 1));
    var seedText = settings.seed && String(settings.seed).trim()
      ? String(settings.seed).trim()
      : 'auto-' + (opts.now || 0);
    var masterSeed = hashSeed(seedText);

    var cards = [];
    var seen = {};
    var attempts = 0;
    /* Generous, but bounded: a pool with few distinct layouts must not spin. */
    var maxAttempts = Math.max(200, count * 60);
    var error = null;

    while (cards.length < count && attempts < maxAttempts) {
      attempts++;
      var cardSeed = (masterSeed + attempts * 2654435761) >>> 0;
      var card;
      try {
        card = buildCard(cardSeed, settings, pool);
      } catch (err) {
        error = err.message;
        break;
      }
      var sig = cardSignature(card);
      if (seen[sig]) continue;          /* never silently accept a duplicate */
      seen[sig] = true;
      card.id = cardId(cards.length);
      card.seed = cardSeed;
      card.masterSeed = masterSeed;
      card.index = cards.length;
      cards.push(card);
    }

    return {
      cards: cards,
      requested: count,
      unique: cards.length,
      duplicates: 0,
      exhausted: cards.length < count && !error,
      attempts: attempts,
      masterSeed: masterSeed,
      seedText: seedText,
      error: error
    };
  }

  /* ======================================================================
     8. The call pool and labels
     ====================================================================== */

  function cellLabel(cell) {
    if (!cell) return '';
    if (cell.type === 'free') return cell.text || 'FREE';
    if (cell.type === 'text') return cell.text;
    if (cell.type === 'image') return cell.label || 'Image';
    if (cell.type === 'number') {
      return cell.letter ? cell.letter + cell.value : String(cell.value);
    }
    return String(cell);
  }

  function buildCallPool(settings, pool) {
    var out = [];
    var c, n;
    if (settings.contentMode === 'ball75') {
      for (c = 0; c < 5; c++) {
        for (n = RANGE75[c][0]; n <= RANGE75[c][1]; n++) out.push(COL75[c] + n);
      }
    } else if (settings.contentMode === 'ball90') {
      for (n = 1; n <= 90; n++) out.push(String(n));
    } else {
      (pool || []).forEach(function (item) {
        out.push(typeof item === 'string' ? item : (item && item.label) || 'Image');
      });
    }
    return out;
  }

  /** Draw the next call without repeating. Deterministic given the seed. */
  function drawNext(callPool, called, rng) {
    var remaining = callPool.filter(function (item) { return called.indexOf(item) === -1; });
    if (!remaining.length) return null;
    return remaining[Math.floor(rng() * remaining.length)];
  }

  /* ======================================================================
     9. Win patterns
     ====================================================================== */

  /** Drop repeated [row, col] pairs, keeping the first of each. */
  function dedupeCells(cells) {
    var seen = {};
    return cells.filter(function (pair) {
      var key = pair[0] + ':' + pair[1];
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /** Every cell group that counts as a win, as [row, col] pairs. */
  function getWinCells(pattern, rows, cols) {
    var out = [];
    var r, c, cells;

    function row(r0) {
      var list = [];
      for (var i = 0; i < cols; i++) list.push([r0, i]);
      return list;
    }
    function column(c0) {
      var list = [];
      for (var i = 0; i < rows; i++) list.push([i, c0]);
      return list;
    }

    if (pattern === 'row' || pattern === 'line') {
      for (r = 0; r < rows; r++) out.push(row(r));
    }
    if (pattern === 'column' || pattern === 'line') {
      for (c = 0; c < cols; c++) out.push(column(c));
    }
    if ((pattern === 'diagonal' || pattern === 'line' || pattern === 'x') && rows === cols) {
      var down = [], up = [];
      for (r = 0; r < rows; r++) { down.push([r, r]); up.push([r, cols - 1 - r]); }
      /* On an odd grid the diagonals cross at the centre, so a naive
         concat lists that square twice and overstates how many cells the
         pattern needs. */
      if (pattern === 'x') out.push(dedupeCells(down.concat(up)));
      else { out.push(down); out.push(up); }
    }
    if (pattern === 'fourcorners') {
      out.push([[0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1]]);
    }
    if (pattern === 'blackout') {
      cells = [];
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) cells.push([r, c]);
      out.push(cells);
    }
    if (pattern === 'tshape') {
      /* The full top row plus the centre column hanging beneath it. On an
         even grid there is no single centre column, so the left of the two
         middle columns is used rather than refusing the pattern. */
      cells = [];
      var stem = Math.floor((cols - 1) / 2);
      for (c = 0; c < cols; c++) cells.push([0, c]);
      for (r = 1; r < rows; r++) cells.push([r, stem]);
      out.push(dedupeCells(cells));
    }
    if (pattern === 'frame') {
      cells = [];
      for (c = 0; c < cols; c++) { cells.push([0, c]); cells.push([rows - 1, c]); }
      for (r = 1; r < rows - 1; r++) { cells.push([r, 0]); cells.push([r, cols - 1]); }
      /* A single-row card's top and bottom edge are the same row. */
      out.push(dedupeCells(cells));
    }
    return out;
  }

  function patternLabel(pattern) {
    var labels = {
      line: 'Any line', row: 'Any row', column: 'Any column', diagonal: 'Any diagonal',
      fourcorners: 'Four corners', blackout: 'Blackout (full house)', x: 'X shape',
      frame: 'Outer frame', tshape: 'T shape'
    };
    return labels[pattern] || pattern;
  }

  /* ======================================================================
     10. Win verification

     A call matches a square only on an exact, case-insensitive match of the
     full label. Substring matching would let "B7" satisfy a square holding
     "B75", validating a win that never happened.
     ====================================================================== */

  function normalizeCall(value) {
    return String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  }

  function parseCalls(raw) {
    return String(raw || '')
      .split(/[\n,;]+/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  /**
   * @returns {{won:boolean, pattern:string, matchedCells:Array, missing:Array,
   *            marked:number, needed:number}}
   */
  function verifyWin(card, calls, pattern) {
    var calledSet = {};
    parseCalls(Array.isArray(calls) ? calls.join('\n') : calls).forEach(function (call) {
      calledSet[normalizeCall(call)] = true;
    });

    var groups = getWinCells(pattern, card.rows, card.cols);
    var best = null;

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var matched = [];
      var missing = [];
      for (var i = 0; i < group.length; i++) {
        var r = group[i][0], c = group[i][1];
        var cell = card.grid[r][c];
        /* A deliberate blank (90-ball) is not markable and cannot block. */
        if (!cell) continue;
        if (cell.type === 'free') { matched.push(group[i]); continue; }
        if (calledSet[normalizeCall(cellLabel(cell))]) matched.push(group[i]);
        else missing.push({ cell: group[i], label: cellLabel(cell) });
      }
      var record = {
        won: missing.length === 0,
        matchedCells: matched,
        missing: missing,
        marked: matched.length,
        needed: matched.length + missing.length
      };
      if (record.won) { best = record; break; }
      /* Keep the closest near-miss so the UI can say how far off it was. */
      if (!best || record.missing.length < best.missing.length) best = record;
    }

    if (!best) best = { won: false, matchedCells: [], missing: [], marked: 0, needed: 0 };
    best.pattern = pattern;
    best.patternLabel = patternLabel(pattern);
    return best;
  }

  /**
   * Rebuild a card from its printed seed so a card can be verified even
   * after the browser tab that produced it is long gone. This only works
   * because generation is deterministic.
   */
  function rebuildCard(seed, settings, pool) {
    var n = /^\d+$/.test(String(seed).trim()) ? (parseInt(seed, 10) >>> 0) : hashSeed(seed);
    return buildCard(n, settings, pool);
  }

  /* ======================================================================
     11. Word pools
     ====================================================================== */

  function parseWordList(raw) {
    var seen = {};
    return String(raw || '')
      .split(/\r?\n/)
      .map(function (w) { return safeText(w).trim(); })
      .filter(function (w) {
        if (!w) return false;
        var k = w.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
  }

  function themeWords(themeId) {
    return (THEMES[themeId] || []).slice();
  }

  /* ======================================================================
     12. Settings
     ====================================================================== */

  function defaultSettings() {
    return {
      version: 1,
      contentMode: 'ball75',
      theme: 'christmas',
      template: 'classic',
      gridSize: 5,
      freeSpace: 'center',
      freeText: 'FREE',
      bingoHeader: true,
      title: 'BINGO',
      subtitle: '',
      footer: '',
      showCardId: true,
      cardCount: 8,
      seed: '',
      colorTheme: 'indigo',
      font: 'system',
      inkSaver: false,
      paper: 'a4',
      perPage: 2,
      cutLines: true,
      wordList: '',
      mixTheme: false,
      winPattern: 'line'
    };
  }

  function normalize(input) {
    var d = defaultSettings();
    var s = input && typeof input === 'object' ? input : {};
    return {
      version: 1,
      contentMode: oneOf(s.contentMode, CONTENT_MODES, d.contentMode),
      theme: oneOf(s.theme, THEME_IDS, d.theme),
      template: oneOf(s.template, TEMPLATES.map(function (t) { return t.id; }), d.template),
      gridSize: Math.round(clampNum(s.gridSize, 3, 6, d.gridSize)),
      freeSpace: oneOf(s.freeSpace, FREE_SPACE_MODES, d.freeSpace),
      freeText: safeText(s.freeText === undefined ? d.freeText : s.freeText).slice(0, 20),
      bingoHeader: s.bingoHeader === undefined ? d.bingoHeader : !!s.bingoHeader,
      title: safeText(s.title === undefined ? d.title : s.title).slice(0, 60),
      subtitle: safeText(s.subtitle).slice(0, 80),
      footer: safeText(s.footer).slice(0, 80),
      showCardId: s.showCardId === undefined ? d.showCardId : !!s.showCardId,
      cardCount: Math.round(clampNum(s.cardCount, 1, 500, d.cardCount)),
      seed: safeText(s.seed).slice(0, 60),
      colorTheme: oneOf(s.colorTheme, Object.keys(COLORS), d.colorTheme),
      font: oneOf(s.font, ['system', 'serif', 'rounded', 'mono'], d.font),
      inkSaver: s.inkSaver === undefined ? d.inkSaver : !!s.inkSaver,
      paper: oneOf(s.paper, Object.keys(PAPER_SIZES), d.paper),
      perPage: oneOf(Math.round(clampNum(s.perPage, 1, 4, d.perPage)), [1, 2, 4], d.perPage),
      cutLines: s.cutLines === undefined ? d.cutLines : !!s.cutLines,
      wordList: typeof s.wordList === 'string' ? s.wordList.slice(0, 20000) : d.wordList,
      mixTheme: s.mixTheme === undefined ? d.mixTheme : !!s.mixTheme,
      winPattern: oneOf(s.winPattern, WIN_PATTERNS, d.winPattern)
    };
  }

  /* ======================================================================
     Exports
     ====================================================================== */

  global.BingoEngine = {
    hashSeed: hashSeed,
    mulberry32: mulberry32,
    shuffle: shuffle,
    pickN: pickN,
    safeText: safeText,
    clampNum: clampNum,

    COL75: COL75,
    RANGE75: RANGE75,
    UK_COLS: UK_COLS,
    THEMES: THEMES,
    THEME_IDS: THEME_IDS,
    TEMPLATES: TEMPLATES,
    COLORS: COLORS,
    CONTENT_MODES: CONTENT_MODES,
    WIN_PATTERNS: WIN_PATTERNS,
    PAPER_SIZES: PAPER_SIZES,

    cardShape: cardShape,
    freeSpaceCell: freeSpaceCell,
    cellsNeeded: cellsNeeded,
    logPermutations: logPermutations,
    maxUniqueCards: maxUniqueCards,

    generate75Card: generate75Card,
    generateUK90Layout: generateUK90Layout,
    generateUK90Card: generateUK90Card,
    generateContentCard: generateContentCard,
    buildCard: buildCard,
    rebuildCard: rebuildCard,
    generateCards: generateCards,
    cardSignature: cardSignature,
    cardId: cardId,

    cellLabel: cellLabel,
    buildCallPool: buildCallPool,
    drawNext: drawNext,

    getWinCells: getWinCells,
    patternLabel: patternLabel,
    parseCalls: parseCalls,
    normalizeCall: normalizeCall,
    verifyWin: verifyWin,

    parseWordList: parseWordList,
    themeWords: themeWords,

    defaultSettings: defaultSettings,
    normalize: normalize
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.BingoEngine;

})(typeof window !== 'undefined' ? window : this);
