/* ToolAdda - Random Name Picker
 * Spinning-wheel name/winner picker. Pure selection & geometry math is kept
 * separate from DOM/canvas code so it can be unit tested outside a browser.
 */
(function () {
  'use strict';

  const hasDom = typeof document !== 'undefined';
  const root = hasDom ? document.querySelector('[data-picker]') : null;

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  const TWO_PI = Math.PI * 2;
  const POINTER_ANGLE = -Math.PI / 2; // pointer is fixed at the top of the wheel
  const MAX_LABELLED_SLICES = 60; // beyond this, draw colors only (readability + perf)
  const MAX_ODDS_ROWS = 200;
  const STORE_KEY = 'tooladda-rnp-list-v1';

  // Confetti colours. Labels are drawn white (see drawWheel), so every slice
  // must carry white text — all of these clear 4.5:1 — and neighbouring
  // slices alternate warm and cool so they stay distinct.
  const PALETTE = ['#be185d', '#1d4ed8', '#c2410c', '#0f766e', '#a16207', '#15803d', '#0369a1'];

  const SAMPLE_NAMES = [
    'Aarav', 'Priya', 'Rohan', 'Ishita', 'Vikram', 'Ananya',
    'Karan', 'Meera', 'Devansh', 'Saanvi', 'Arjun', 'Diya',
  ];

  /* ------------------------------------------------------------------ *
   * Pure engine: parsing, weighting, shuffling, drawing winners
   * ------------------------------------------------------------------ */

  // One name per line. Tabs split too, so a row copied from a spreadsheet
  // becomes separate names instead of one long entry.
  function parseNames(rawText) {
    return String(rawText == null ? '' : rawText)
      .split(/\r\n|\r|\n|\t/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  const keyOf = (name) => String(name).trim().toLowerCase();

  function dedupeNames(names) {
    const seen = new Set();
    const out = [];
    names.forEach((name) => {
      const key = keyOf(name);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(name);
      }
    });
    return out;
  }

  function countDuplicates(names) {
    const counts = new Map();
    const firstSeen = new Map();
    names.forEach((name) => {
      const key = keyOf(name);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!firstSeen.has(key)) firstSeen.set(key, name);
    });
    const out = [];
    counts.forEach((count, key) => {
      if (count > 1) out.push({ name: firstSeen.get(key), count: count });
    });
    out.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
    return out;
  }

  function computeOdds(names) {
    const total = names.length;
    if (!total) return [];
    const counts = new Map();
    const firstSeen = new Map();
    names.forEach((name) => {
      const key = keyOf(name);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!firstSeen.has(key)) firstSeen.set(key, name);
    });
    const out = [];
    counts.forEach((count, key) => {
      out.push({
        name: firstSeen.get(key),
        count: count,
        percent: Math.round((count / total) * 1000) / 10,
      });
    });
    out.sort((a, b) => (b.percent - a.percent) || a.name.localeCompare(b.name));
    return out;
  }

  // A uniform float in [0, 1) from the browser's cryptographic generator,
  // falling back to Math.random where there is none.
  function secureRandom() {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }

  function shuffle(names, rngFn) {
    const rng = rngFn || secureRandom;
    const out = names.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // Draws up to `n` winners from `pool`. Each pick is weighted by how many
  // entries a name has, but a person is a winner at most once per draw: once
  // picked, every one of their entries leaves the working pool. That is also
  // what `remainingPool` holds, so in raffle mode a winner with several
  // tickets cannot come back. `winnerIndexes` are positions in `pool`.
  function drawWinners(pool, n, rngFn) {
    const rng = rngFn || secureRandom;
    let working = pool.map((name, index) => ({ name: name, index: index }));
    const want = Math.max(0, n);
    const winners = [];
    const winnerIndexes = [];
    while (winners.length < want && working.length) {
      const pick = working[Math.floor(rng() * working.length)];
      winners.push(pick.name);
      winnerIndexes.push(pick.index);
      const key = keyOf(pick.name);
      working = working.filter((e) => keyOf(e.name) !== key);
    }
    return { winners: winners, winnerIndexes: winnerIndexes, remainingPool: working.map((e) => e.name) };
  }

  function paletteColor(index) {
    return PALETTE[index % PALETTE.length];
  }

  // Slice colour that never matches either neighbour, including the pair
  // where the last slice meets the first.
  function sliceColor(index, n) {
    if (n > 1 && index === n - 1 && (n - 1) % PALETTE.length === 0) return PALETTE[3 % PALETTE.length];
    return paletteColor(index);
  }

  /* ------------------------------------------------------------------ *
   * Pure engine: wheel angle geometry
   * ------------------------------------------------------------------ */

  function normalizeAngle(angle) {
    const r = angle % TWO_PI;
    return r < 0 ? r + TWO_PI : r;
  }

  function computeIndexAtRotation(rotation, n, pointerAngle) {
    if (n <= 0) return -1;
    const pointer = pointerAngle == null ? POINTER_ANGLE : pointerAngle;
    const sliceAngle = TWO_PI / n;
    const local = normalizeAngle(pointer - rotation);
    let idx = Math.floor(local / sliceAngle);
    if (idx >= n) idx = n - 1;
    if (idx < 0) idx = 0;
    return idx;
  }

  // Returns a rotation (radians, always >= currentRotation) that lands the
  // wheel's fixed pointer inside the `winnerIndex` slice once the spin settles.
  function computeSpinRotation(opts) {
    const n = opts.n;
    const winnerIndex = opts.winnerIndex;
    const currentRotation = opts.currentRotation || 0;
    const extraSpins = opts.extraSpins == null ? 8 : opts.extraSpins;
    const pointer = opts.pointerAngle == null ? POINTER_ANGLE : opts.pointerAngle;
    const jitterRng = opts.jitterRng || Math.random;

    const sliceAngle = TWO_PI / n;
    const center = winnerIndex * sliceAngle + sliceAngle / 2;
    const jitter = (jitterRng() * 2 - 1) * 0.7 * (sliceAngle / 2);
    const localTarget = normalizeAngle(center + jitter);
    const targetBase = normalizeAngle(pointer - localTarget);
    const currentNorm = normalizeAngle(currentRotation);
    const deltaForward = normalizeAngle(targetBase - currentNorm);

    return currentRotation + extraSpins * TWO_PI + deltaForward;
  }

  /* ------------------------------------------------------------------ *
   * Node/test export — everything above this line is pure and DOM-free.
   * ------------------------------------------------------------------ */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseNames: parseNames,
      keyOf: keyOf,
      dedupeNames: dedupeNames,
      countDuplicates: countDuplicates,
      computeOdds: computeOdds,
      secureRandom: secureRandom,
      shuffle: shuffle,
      drawWinners: drawWinners,
      paletteColor: paletteColor,
      sliceColor: sliceColor,
      normalizeAngle: normalizeAngle,
      computeIndexAtRotation: computeIndexAtRotation,
      computeSpinRotation: computeSpinRotation,
      POINTER_ANGLE: POINTER_ANGLE,
      TWO_PI: TWO_PI,
      PALETTE: PALETTE,
    };
  }

  if (!root) {
    return;
  }

  /* ------------------------------------------------------------------ *
   * DOM wiring
   * ------------------------------------------------------------------ */

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phoneQuery = window.matchMedia('(max-width: 768px)');

  const textarea = $('[data-name-input]');
  const addSingleInput = $('[data-add-input]');
  const addSingleBtn = $('[data-add-btn]');
  const statsLine = $('[data-stats]');
  const dupNote = $('[data-dup-note]');
  const canvas = $('[data-wheel-canvas]');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const wheelBox = $('[data-wheel-box]');
  const wheelFrame = $('[data-wheel-frame]');
  const wheelBezel = $('[data-wheel-bezel]');
  const wheelPointer = $('[data-wheel-pointer]');
  const spinBtn = $('[data-spin]');
  const quickBtn = $('[data-quick-pick]');
  const resetWheelBtn = $('[data-reset-wheel]');
  const emptyNote = $('[data-wheel-empty]');
  const winnerCountSelect = $('[data-winner-count]');
  const raffleToggle = $('[data-raffle-mode]');
  const weightToggle = $('[data-weight-mode]');
  const soundToggle = $('[data-sound-toggle]');
  const rememberToggle = $('[data-remember]');
  const shuffleBtn = $('[data-shuffle-list]');
  const sortBtn = $('[data-sort-list]');
  const dedupeBtn = $('[data-dedupe-list]');
  const clearBtn = $('[data-clear-list]');
  const sampleBtn = $('[data-sample-list]');
  const oddsBody = $('[data-odds-body]');
  const oddsNote = $('[data-odds-note]');
  const historyList = $('[data-history-list]');
  const historyEmpty = $('[data-history-empty]');
  const copyHistoryBtn = $('[data-copy-history]');
  const clearHistoryBtn = $('[data-clear-history]');
  const modal = $('[data-winner-modal]');
  const modalNames = $('[data-winner-names]');
  const modalCopyBtn = $('[data-copy-winner]');
  const modalCloseBtn = $('[data-close-modal]');
  const modalSpinAgainBtn = $('[data-modal-spin-again]');
  const confettiCanvas = $('[data-confetti-canvas]');
  const toast = $('[data-toast]');
  const tabs = $$('[data-tab]');
  const tabCounts = { names: $('[data-tab-count="names"]'), history: $('[data-tab-count="history"]') };
  const ticketNo = document.querySelector('[data-ticket-no]');
  const stickyBar = document.querySelector('.lk-sticky-cta');
  const stickyBtn = document.querySelector('[data-sticky-spin]');
  // everything that edits the list or the draw settings; locked while the wheel turns
  const lockable = [addSingleInput, addSingleBtn, shuffleBtn, sortBtn, dedupeBtn, clearBtn, sampleBtn,
    resetWheelBtn, winnerCountSelect, raffleToggle, weightToggle, clearHistoryBtn].filter(Boolean);

  const state = {
    rawText: '',
    names: [],
    pool: [],
    won: new Set(),          // keys of this round's winners (raffle mode)
    raffleMode: true,
    weightMode: true,
    winnerCount: 1,
    spinning: false,
    rotation: 0,
    history: [],
    returnFocus: null,
  };
  const inView = { spin: true };

  /* ---------- toast ---------- */
  let toastTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  async function copyText(text, message) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      showToast(message || 'Copied to clipboard');
    } catch (e) {
      showToast('Copy failed — select the text and press Ctrl+C');
    }
  }

  /* ---------- the list on this device ---------- */
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };
  let saveTimer = null;
  function saveList() {
    if (!rememberToggle) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      if (rememberToggle.checked) store.set(STORE_KEY, JSON.stringify({ text: state.rawText }));
    }, 300);
  }

  /* ---------- name list state ---------- */

  function activeNames() {
    const parsed = parseNames(state.rawText);
    return state.weightMode ? parsed : dedupeNames(parsed);
  }

  // The pool is the list minus this round's winners, so editing the list in
  // the middle of a raffle never brings a winner back.
  function resyncFromText() {
    state.names = activeNames();
    state.pool = state.names.filter((n) => !state.won.has(keyOf(n)));
  }

  function renderStats() {
    const typedTotal = state.names.length;
    const poolTotal = state.pool.length;

    if (!typedTotal) {
      statsLine.textContent = 'No names yet — add at least one to spin the wheel.';
    } else if (!poolTotal) {
      statsLine.textContent = 'Everyone has already won this round. Reset the wheel to spin again.';
    } else {
      const uniqueInPool = dedupeNames(state.pool).length;
      let text;
      if (state.weightMode && uniqueInPool !== poolTotal) {
        text = poolTotal + ' entries (' + uniqueInPool + ' unique) in the wheel. Duplicate entries increase their odds.';
      } else {
        text = poolTotal + ' ' + (poolTotal === 1 ? 'entry' : 'entries') + ' in the wheel.';
      }
      if (poolTotal !== typedTotal) {
        text += ' (' + (typedTotal - poolTotal) + ' already picked this round.)';
      }
      statsLine.textContent = text;
    }

    const dupes = countDuplicates(parseNames(state.rawText));
    if (state.weightMode && dupes.length) {
      const shown = dupes.slice(0, 6).map((d) => esc(d.name) + ' ×' + d.count).join(', ');
      dupNote.hidden = false;
      dupNote.innerHTML = 'Weighted by repetition: ' + shown + (dupes.length > 6 ? ', and more' : '') + '.';
    } else {
      dupNote.hidden = true;
      dupNote.textContent = '';
    }
    if (tabCounts.names) tabCounts.names.textContent = String(dedupeNames(state.pool).length);
  }

  function renderOdds() {
    const odds = computeOdds(state.pool);
    if (!odds.length) {
      const message = state.names.length ? 'Everyone has already won this round.' : 'Add names to see their odds.';
      oddsBody.innerHTML = '<tr><td colspan="3" class="lk-odds-empty">' + message + '</td></tr>';
      oddsNote.textContent = '';
      return;
    }
    const shown = odds.slice(0, MAX_ODDS_ROWS);
    oddsBody.innerHTML = shown.map((row) => (
      '<tr><td>' + esc(row.name) + '</td><td>' + row.count + '</td><td>' + row.percent + '%</td></tr>'
    )).join('');
    oddsNote.textContent = odds.length > MAX_ODDS_ROWS
      ? 'Showing the top ' + MAX_ODDS_ROWS + ' of ' + odds.length + ' unique names.'
      : '';
  }

  function renderEmptyState() {
    const disabled = state.pool.length === 0 || state.spinning;
    spinBtn.disabled = disabled;
    quickBtn.disabled = disabled;
    if (state.names.length === 0) {
      emptyNote.hidden = false;
      emptyNote.textContent = 'Add at least one name below to start the wheel.';
    } else if (state.pool.length === 0) {
      emptyNote.hidden = false;
      emptyNote.textContent = 'Everyone has already won this round. Reset the wheel to spin again.';
    } else {
      emptyNote.hidden = true;
    }
    updateSticky();
  }

  function renderAll() {
    renderStats();
    renderOdds();
    renderEmptyState();
    if (!state.spinning) drawWheel(state.rotation);
  }

  /* ---------- wheel rendering ---------- */

  // The backing store is only resized when the on-screen size changes;
  // resizing a canvas clears and reallocates it, which was happening on
  // every animation frame.
  let canvasSize = 0, canvasDpr = 0;
  function fitCanvas() {
    if (!canvas) return 0;
    // Measured from the outer box, not the bezel: the bezel is sized by the
    // canvas itself, so measuring it shrank the wheel a little on every draw.
    const box = wheelBox || canvas.parentElement;
    const size = Math.round(Math.max(180, Math.min(box.clientWidth - 30, 460)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (size !== canvasSize || dpr !== canvasDpr) {
      canvasSize = size; canvasDpr = dpr;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return size;
  }

  function truncateLabel(name, maxChars) {
    if (name.length <= maxChars) return name;
    return name.slice(0, Math.max(1, maxChars - 1)) + '…';
  }

  // A thin radial highlight over each flat-colored slice gives a glossy depth.
  function paintSliceSheen(radius) {
    const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    sheen.addColorStop(0, 'rgba(255,255,255,0.32)');
    sheen.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = sheen;
    ctx.fill();
  }

  function drawRimPegs(radius) {
    const pegCount = 24;
    const pegRadius = 4;
    for (let p = 0; p < pegCount; p += 1) {
      const angle = p * (TWO_PI / pegCount);
      const px = Math.cos(angle) * (radius + 8);
      const py = Math.sin(angle) * (radius + 8);
      ctx.beginPath();
      ctx.arc(px, py, pegRadius, 0, TWO_PI);
      const gradient = ctx.createRadialGradient(px - 1.3, py - 1.3, 0.5, px, py, pegRadius);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, p % 2 === 0 ? '#f9a8d4' : '#fde68a');
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = 'rgba(40, 10, 30, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawHub(radius) {
    const hubRadius = Math.max(20, radius * 0.15);
    const gradient = ctx.createRadialGradient(-hubRadius * 0.3, -hubRadius * 0.3, 1, 0, 0, hubRadius);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#fbe3ee');
    ctx.beginPath();
    ctx.arc(0, 0, hubRadius, 0, TWO_PI);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#be185d';
    ctx.stroke();
    // a five-point star, drawn rather than an emoji so it looks the same everywhere
    ctx.beginPath();
    for (let k = 0; k < 10; k += 1) {
      const r = k % 2 === 0 ? hubRadius * 0.52 : hubRadius * 0.22;
      const a = -Math.PI / 2 + k * Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#be185d';
    ctx.fill();
  }

  function drawWheel(rotation) {
    if (!ctx) return;
    const size = fitCanvas();
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 16;
    const n = state.pool.length;

    ctx.clearRect(0, 0, size, size);

    if (!n) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TWO_PI);
      ctx.fillStyle = 'rgba(190, 24, 93, 0.07)';
      ctx.fill();
      drawRimPegs(radius);
      ctx.font = '600 15px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(106, 95, 107, 0.95)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Add names to begin', 0, 0);
      ctx.restore();
      return;
    }

    const sliceAngle = TWO_PI / n;
    const showLabels = n <= MAX_LABELLED_SLICES;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    for (let i = 0; i < n; i += 1) {
      const start = i * sliceAngle;
      const end = start + sliceAngle;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = sliceColor(i, n);
      ctx.fill();
      paintSliceSheen(radius);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (showLabels) {
        const mid = start + sliceAngle / 2;
        ctx.save();
        ctx.rotate(mid);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const fontSize = n <= 8 ? 15 : n <= 20 ? 13 : 11;
        ctx.font = '700 ' + fontSize + 'px Inter, system-ui, sans-serif';
        const maxChars = Math.max(4, Math.floor((radius - 30) / (fontSize * 0.55) / (n > 24 ? 1.6 : 1)));
        const label = truncateLabel(state.pool[i], maxChars);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20, 8, 16, 0.55)';
        ctx.strokeText(label, radius - 10, 0);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, radius - 10, 0);
        ctx.restore();
      }
    }

    drawRimPegs(radius);
    ctx.restore();

    // The hub stays fixed while the ring spins beneath it, like a real prize wheel.
    ctx.save();
    ctx.translate(cx, cy);
    drawHub(radius);
    ctx.restore();
  }

  /* ---------- confetti ---------- */

  function launchConfetti() {
    if (reducedMotion || !confettiCanvas) return;
    const cctx = confettiCanvas.getContext('2d');
    const w = window.innerWidth;
    const h = window.innerHeight;
    confettiCanvas.width = w;
    confettiCanvas.height = h;
    confettiCanvas.style.display = 'block';

    const particles = [];
    for (let i = 0; i < 130; i += 1) {
      particles.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.3,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 3,
        size: 5 + Math.random() * 6,
        color: paletteColor(Math.floor(Math.random() * PALETTE.length)),
        rot: Math.random() * TWO_PI,
        vr: (Math.random() - 0.5) * 0.3,
      });
    }

    const start = performance.now();
    const duration = 2600;

    function frame(now) {
      const elapsed = now - start;
      cctx.clearRect(0, 0, w, h);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03;
        p.rot += p.vr;
        cctx.save();
        cctx.translate(p.x, p.y);
        cctx.rotate(p.rot);
        cctx.fillStyle = p.color;
        cctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        cctx.restore();
      });
      if (elapsed < duration) {
        window.requestAnimationFrame(frame);
      } else {
        confettiCanvas.style.display = 'none';
        cctx.clearRect(0, 0, w, h);
      }
    }
    window.requestAnimationFrame(frame);
  }

  /* ---------- sound ---------- */

  // Created or resumed inside the Spin click, while the browser still counts
  // it as a user gesture — made later, in an animation frame, it can start
  // suspended and every tick is silent.
  let audioCtx = null;
  function primeAudio() {
    if (!soundToggle || !soundToggle.checked) return;
    try {
      if (!audioCtx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        audioCtx = new AudioCtor();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* ignore audio failures */ }
  }
  function tick() {
    if (!soundToggle || !soundToggle.checked || !audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 760;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.03);
    } catch (e) { /* ignore audio failures */ }
  }

  /* ---------- history ---------- */

  function renderHistory() {
    if (tabCounts.history) tabCounts.history.textContent = String(state.history.length);
    if (ticketNo) ticketNo.textContent = String(state.history.length).padStart(3, '0');
    if (!state.history.length) {
      historyList.innerHTML = '';
      historyEmpty.hidden = false;
      return;
    }
    historyEmpty.hidden = true;
    historyList.innerHTML = state.history.slice().reverse().map((round) => (
      '<li class="lk-history-row">'
      + '<span class="lk-history-round">#' + round.index + '</span>'
      + '<span class="lk-history-names">' + round.names.map(esc).join(', ') + '</span>'
      + '<span class="lk-history-time">' + esc(round.time) + '</span>'
      + '</li>'
    )).join('');
  }

  function logHistory(names) {
    state.history.push({
      index: state.history.length + 1,
      names: names,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
    renderHistory();
  }

  /* ---------- winner modal ---------- */

  function openModal(names) {
    const ordered = names.length > 1;
    modalNames.innerHTML = names.map((n, i) => '<span class="lk-winner-chip">' + (ordered ? '<b>' + (i + 1) + '</b> ' : '') + esc(n) + '</span>').join('');
    modalNames.dataset.names = JSON.stringify(names);
    state.returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : spinBtn;
    modal.hidden = false;
    modal.classList.add('is-open');
    modalCopyBtn.focus();
    updateSticky();
    launchConfetti();
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.classList.remove('is-open');
    modal.hidden = true;
    const back = state.returnFocus && document.contains(state.returnFocus) && !state.returnFocus.disabled ? state.returnFocus : spinBtn;
    if (back && !back.disabled) back.focus();
    updateSticky();
  }

  // Keep Tab inside the dialog while it is open.
  function trapFocus(event) {
    if (event.key !== 'Tab' || modal.hidden) return;
    const items = Array.from(modal.querySelectorAll('button:not([disabled])'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /* ---------- draw / spin flow ---------- */

  function setSpinning(on) {
    state.spinning = on;
    root.classList.toggle('is-spinning', on);
    lockable.forEach((el) => { el.disabled = on; });
    textarea.readOnly = on;
    if (wheelFrame) wheelFrame.classList.toggle('is-spinning', on);
    renderEmptyState();
  }

  function finishDraw(winners) {
    if (state.raffleMode) {
      winners.forEach((w) => state.won.add(keyOf(w)));
      resyncFromText();
    }
    logHistory(winners);
    renderStats();
    renderOdds();
    renderEmptyState();
    openModal(winners);
  }

  function requestedCount() {
    return state.winnerCount === Infinity ? Infinity : Math.max(1, state.winnerCount);
  }

  function drawNow() {
    const unique = dedupeNames(state.pool).length;
    const want = requestedCount();
    const result = drawWinners(state.pool, want);
    if (want !== Infinity && want > unique) showToast('Only ' + unique + ' ' + (unique === 1 ? 'name is' : 'names are') + ' left, so ' + unique + ' drawn.');
    return result;
  }

  function quickPick() {
    if (state.spinning || !state.pool.length) return;
    const { winners, winnerIndexes } = drawNow();
    state.rotation = computeSpinRotation({
      currentRotation: state.rotation,
      winnerIndex: winnerIndexes[winnerIndexes.length - 1],
      n: state.pool.length,
      extraSpins: 0,
    });
    drawWheel(state.rotation);
    bounceWheel();
    finishDraw(winners);
  }

  function animateSpinTo(finalRotation, onDone) {
    const startRotation = state.rotation;
    const distance = finalRotation - startRotation;
    const duration = 4200 + Math.random() * 700;
    const start = performance.now();
    let lastTickIndex = computeIndexAtRotation(startRotation, state.pool.length);

    function ease(t) { return 1 - Math.pow(1 - t, 3); }

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const current = startRotation + distance * ease(t);
      state.rotation = current;
      drawWheel(current);

      const idx = computeIndexAtRotation(current, state.pool.length);
      if (idx !== lastTickIndex) {
        lastTickIndex = idx;
        tick();
        flickPointer();
      }

      if (t < 1) {
        window.requestAnimationFrame(frame);
      } else {
        state.rotation = finalRotation;
        drawWheel(finalRotation);
        onDone();
      }
    }
    window.requestAnimationFrame(frame);
  }

  let pointerFlickTimer = null;
  function flickPointer() {
    if (reducedMotion || !wheelPointer) return;
    wheelPointer.classList.add('is-tick');
    window.clearTimeout(pointerFlickTimer);
    pointerFlickTimer = window.setTimeout(() => wheelPointer.classList.remove('is-tick'), 90);
  }

  function bounceWheel() {
    if (reducedMotion || !wheelBezel) return;
    wheelBezel.classList.remove('is-landed');
    // eslint-disable-next-line no-unused-expressions -- restart the CSS animation
    void wheelBezel.offsetWidth;
    wheelBezel.classList.add('is-landed');
  }

  // The winners are drawn the moment Spin is pressed; the wheel is then
  // turned so it stops on the last of them.
  function spin() {
    if (state.spinning || !state.pool.length) return;
    primeAudio();
    if (reducedMotion) {
      quickPick();
      return;
    }
    const { winners, winnerIndexes } = drawNow();
    const extraSpins = 6 + Math.floor(Math.random() * 5);
    const finalRotation = computeSpinRotation({
      currentRotation: state.rotation,
      winnerIndex: winnerIndexes[winnerIndexes.length - 1],
      n: state.pool.length,
      extraSpins: extraSpins,
    });
    setSpinning(true);
    animateSpinTo(finalRotation, () => {
      setSpinning(false);
      bounceWheel();
      finishDraw(winners);
    });
  }

  /* ---------- list editing actions ---------- */

  function setRawText(text, opts) {
    state.rawText = text;
    if (textarea.value !== text) textarea.value = text;
    resyncFromText();
    renderAll();
    saveList();
    if (opts && opts.toast) showToast(opts.toast);
  }

  /* ---------- tabs ---------- */

  function selectTab(name, focus) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
      if (on && focus) t.focus();
    });
  }

  /* ---------- phone bar: Spin while the wheel's own button is off screen ---------- */
  function updateSticky() {
    if (!stickyBar || !stickyBtn) return;
    const show = !inView.spin && phoneQuery.matches && !state.spinning && state.pool.length > 0 && modal.hidden;
    stickyBar.classList.toggle('is-visible', show);
    stickyBar.setAttribute('aria-hidden', show ? 'false' : 'true');
    stickyBtn.tabIndex = show ? 0 : -1;
    const was = document.body.classList.contains('lk-sticky-on');
    document.body.classList.toggle('lk-sticky-on', show);
    // app.js re-measures the back-to-top button's clearance on scroll.
    if (was !== show) window.dispatchEvent(new Event('scroll'));
  }

  /* ---------- init ---------- */

  function init() {
    let saved = null;
    try { saved = JSON.parse(store.get(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    if (rememberToggle && store.get(STORE_KEY + ':off') === '1') rememberToggle.checked = false;
    setRawText(saved && typeof saved.text === 'string' && saved.text.trim() ? saved.text : SAMPLE_NAMES.join('\n'));
    renderHistory();

    textarea.addEventListener('input', () => {
      if (state.spinning) return;
      setRawText(textarea.value);
    });

    if (addSingleBtn && addSingleInput) {
      // Several names at once are fine here too: "Asha, Ben, Chen".
      const addName = () => {
        const parts = addSingleInput.value.split(/[,;\t]/).map((s) => s.trim()).filter(Boolean);
        if (!parts.length) return;
        const next = (state.rawText ? state.rawText.replace(/\s+$/, '') + '\n' : '') + parts.join('\n');
        setRawText(next, parts.length > 1 ? { toast: parts.length + ' names added' } : null);
        addSingleInput.value = '';
        addSingleInput.focus();
      };
      addSingleBtn.addEventListener('click', addName);
      addSingleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addName();
        }
      });
    }

    shuffleBtn.addEventListener('click', () => {
      setRawText(shuffle(parseNames(state.rawText)).join('\n'), { toast: 'List order shuffled' });
    });
    sortBtn.addEventListener('click', () => {
      const sorted = parseNames(state.rawText).slice().sort((a, b) => a.localeCompare(b));
      setRawText(sorted.join('\n'), { toast: 'Sorted A–Z' });
    });
    dedupeBtn.addEventListener('click', () => {
      setRawText(dedupeNames(parseNames(state.rawText)).join('\n'), { toast: 'Duplicates removed' });
    });
    clearBtn.addEventListener('click', () => {
      state.won.clear();
      setRawText('', { toast: 'List cleared' });
      store.del(STORE_KEY);
      addSingleInput.focus();
    });
    sampleBtn.addEventListener('click', () => {
      state.won.clear();
      setRawText(SAMPLE_NAMES.join('\n'), { toast: 'Sample names loaded' });
    });
    if (rememberToggle) {
      rememberToggle.addEventListener('change', () => {
        if (rememberToggle.checked) { store.del(STORE_KEY + ':off'); saveList(); showToast('Your list will be remembered on this device'); }
        else { store.del(STORE_KEY); store.set(STORE_KEY + ':off', '1'); showToast('List removed from this device'); }
      });
    }

    raffleToggle.addEventListener('change', () => {
      state.raffleMode = raffleToggle.checked;
    });
    weightToggle.addEventListener('change', () => {
      state.weightMode = weightToggle.checked;
      resyncFromText();
      renderAll();
    });
    winnerCountSelect.addEventListener('change', () => {
      state.winnerCount = winnerCountSelect.value === 'all' ? Infinity : (parseInt(winnerCountSelect.value, 10) || 1);
    });
    resetWheelBtn.addEventListener('click', () => {
      state.won.clear();
      state.rotation = 0;
      resyncFromText();
      renderAll();
      showToast('Wheel reset — everyone is back in');
    });

    spinBtn.addEventListener('click', spin);
    quickBtn.addEventListener('click', quickPick);
    if (stickyBtn) stickyBtn.addEventListener('click', spin);

    modalCloseBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (modal.hidden) return;
      if (event.key === 'Escape') closeModal();
      else trapFocus(event);
    });
    modalCopyBtn.addEventListener('click', () => {
      let names = [];
      try { names = JSON.parse(modalNames.dataset.names || '[]'); } catch (e) { names = []; }
      copyText(names.join(', '), names.length > 1 ? 'Winners copied' : 'Winner copied');
    });
    modalSpinAgainBtn.addEventListener('click', () => {
      state.returnFocus = spinBtn;
      closeModal();
      if (state.pool.length) spin();
    });

    copyHistoryBtn.addEventListener('click', () => {
      const lines = state.history.map((r) => '#' + r.index + ' (' + r.time + '): ' + r.names.join(', '));
      if (lines.length) copyText(lines.join('\n'), 'History copied');
      else showToast('Nothing to copy yet');
    });
    clearHistoryBtn.addEventListener('click', () => {
      state.history = [];
      renderHistory();
    });

    tabs.forEach((t, i) => {
      t.addEventListener('click', () => selectTab(t.dataset.tab));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const n = tabs.length;
        const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
        selectTab(tabs[j].dataset.tab, true);
      });
    });

    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      if (!state.spinning) drawWheel(state.rotation);
    });

    if ('IntersectionObserver' in window) {
      const watch = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.target === spinBtn) inView.spin = en.isIntersecting; });
        updateSticky();
      });
      watch.observe(spinBtn);
    }
    if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', updateSticky);
  }

  init();
}());
