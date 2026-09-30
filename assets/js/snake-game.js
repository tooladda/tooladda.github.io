(function () {
  'use strict';

  const canvas = document.querySelector('[data-canvas]');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const wrap = document.querySelector('[data-canvas-wrap]') || canvas.parentElement;

  const el = {
    score: document.querySelector('[data-score]'),
    high: document.querySelector('[data-high-score]'),
    timer: document.querySelector('[data-timer]'),
    length: document.querySelector('[data-length]'),
    speedSel: document.querySelector('[data-speed-select]'),
    pauseBtn: document.querySelector('[data-pause-btn]'),
    restartBtn: document.querySelector('[data-restart-btn]'),
    muteBtn: document.querySelector('[data-mute-btn]'),
    overlay: document.querySelector('[data-overlay]'),
    ovTitle: document.querySelector('[data-overlay-title]'),
    ovSub: document.querySelector('[data-overlay-sub]'),
    ovBtn: document.querySelector('[data-overlay-btn]'),
    dpad: Array.from(document.querySelectorAll('[data-control]')),
  };

  const HS_KEY = 'tooladda-snake-high';
  const MUTE_KEY = 'tooladda-snake-muted';
  const GRID = 20;

  const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };

  let cell = 20;
  const state = {
    snake: [], dir: DIRS.right, pendingDir: DIRS.right,
    food: { x: 5, y: 5 }, score: 0, high: 0,
    phase: 'idle', elapsed: 0, lastStep: 0, secMark: 0, muted: false, speedName: 'medium',
  };

  /* ---------- sound ---------- */
  let ac = null;
  const audio = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (ac && ac.state === 'suspended') ac.resume(); };
  const tone = (f, dur, type, gain, delay) => {
    if (state.muted || !ac) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  };
  const sfx = (k) => {
    audio(); if (state.muted || !ac) return;
    if (k === 'eat') { tone(660, 0.08, 'square', 0.12); tone(990, 0.09, 'square', 0.1, 0.06); }
    else if (k === 'die') { tone(400, 0.14, 'sawtooth', 0.16); tone(160, 0.28, 'sawtooth', 0.14, 0.1); }
    else if (k === 'start') { [523, 659, 784].forEach((f, i) => tone(f, 0.1, 'sine', 0.12, i * 0.07)); }
  };

  /* ---------- storage ---------- */
  const loadHigh = () => { try { return Number(localStorage.getItem(HS_KEY)) || 0; } catch (e) { return 0; } };
  const saveHigh = () => { try { localStorage.setItem(HS_KEY, String(state.high)); } catch (e) {} };

  /* ---------- geometry ---------- */
  const fitCanvas = () => {
    const rect = wrap.getBoundingClientRect();
    const cssSize = Math.max(220, Math.floor(rect.width));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssSize + 'px';
    canvas.style.height = cssSize + 'px';
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = cssSize / GRID;
    render();
  };

  const randFood = () => {
    const free = [];
    for (let x = 0; x < GRID; x++) for (let y = 0; y < GRID; y++) {
      if (!state.snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
    return free[Math.floor(Math.random() * free.length)] || { x: 0, y: 0 };
  };

  const stepInterval = () => {
    const base = state.speedName === 'hard' ? 85 : state.speedName === 'easy' ? 145 : 110;
    return Math.max(60, base - Math.floor(state.score / 30) * 6);
  };

  /* ---------- rendering ---------- */
  const roundRect = (x, y, w, h, r) => {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };

  const drawGrid = (size) => {
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 0; x < GRID; x++) for (let y = 0; y < GRID; y++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  };

  const drawFood = (t) => {
    const pulse = 1 + Math.sin(t / 260) * 0.08;
    const cx = state.food.x * cell + cell / 2;
    const cy = state.food.y * cell + cell / 2;
    const r = cell * 0.36 * pulse;
    ctx.save();
    ctx.shadowColor = 'rgba(239,68,68,0.8)'; ctx.shadowBlur = cell * 0.6;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
    g.addColorStop(0, '#fca5a5'); g.addColorStop(0.5, '#ef4444'); g.addColorStop(1, '#b91c1c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.ellipse(cx + r * 0.4, cy - r * 0.9, r * 0.32, r * 0.16, -0.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(cx - r * 0.32, cy - r * 0.32, r * 0.18, 0, Math.PI * 2); ctx.fill();
  };

  const drawSnake = () => {
    const n = state.snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const s = state.snake[i];
      const pad = Math.max(1, cell * 0.08);
      const light = 42 + (1 - i / Math.max(1, n)) * 16;
      if (i === 0) { ctx.save(); ctx.shadowColor = 'rgba(34,197,94,0.55)'; ctx.shadowBlur = cell * 0.5; ctx.fillStyle = '#15803d'; }
      else ctx.fillStyle = `hsl(145,72%,${light}%)`;
      roundRect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.32);
      ctx.fill();
      if (i === 0) ctx.restore();
    }
    const head = state.snake[0];
    if (!head) return;
    const cx = head.x * cell + cell / 2;
    const cy = head.y * cell + cell / 2;
    const d = state.dir;
    const ex = d.x * cell * 0.16, ey = d.y * cell * 0.16;
    const off = cell * 0.18;
    const er = cell * 0.09;
    const perp = { x: -d.y, y: d.x };
    [-1, 1].forEach((sgn) => {
      const eyeX = cx + ex + perp.x * off * sgn;
      const eyeY = cy + ey + perp.y * off * sgn;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(eyeX, eyeY, er, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b1220';
      ctx.beginPath(); ctx.arc(eyeX + ex * 0.5, eyeY + ey * 0.5, er * 0.55, 0, Math.PI * 2); ctx.fill();
    });
  };

  const render = (t) => {
    if (!ctx) return;
    const size = canvas.width / (window.devicePixelRatio || 1);
    drawGrid(size);
    drawFood(t || 0);
    drawSnake();
  };

  /* ---------- stats ---------- */
  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const updateStats = () => {
    if (el.score) el.score.textContent = state.score;
    if (el.high) el.high.textContent = state.high;
    if (el.timer) el.timer.textContent = fmtTime(state.elapsed);
    if (el.length) el.length.textContent = state.snake.length;
  };

  /* ---------- overlay ---------- */
  const showOverlay = (title, sub, btn) => {
    if (!el.overlay) return;
    if (el.ovTitle) el.ovTitle.textContent = title;
    if (el.ovSub) el.ovSub.innerHTML = sub;
    if (el.ovBtn) el.ovBtn.textContent = btn;
    el.overlay.classList.remove('hidden');
  };
  const hideOverlay = () => { if (el.overlay) el.overlay.classList.add('hidden'); };

  /* ---------- flow ---------- */
  const reset = () => {
    const mid = Math.floor(GRID / 2);
    state.snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    state.dir = DIRS.right; state.pendingDir = DIRS.right;
    state.food = randFood();
    state.score = 0; state.elapsed = 0; state.lastStep = 0; state.secMark = 0;
    updateStats(); render();
  };

  const setPending = (name) => {
    const nd = DIRS[name];
    if (!nd) return;
    if (nd.x === -state.dir.x && nd.y === -state.dir.y && state.snake.length > 1) return;
    state.pendingDir = nd;
  };

  const step = () => {
    state.dir = state.pendingDir;
    const head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };
    const hitsWall = head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID;
    const hitsSelf = state.snake.some((s, i) => i < state.snake.length - 1 && s.x === head.x && s.y === head.y);
    if (hitsWall || hitsSelf) { gameOver(); return; }
    state.snake.unshift(head);
    if (head.x === state.food.x && head.y === state.food.y) {
      state.score += 10;
      if (state.score > state.high) { state.high = state.score; saveHigh(); }
      state.food = randFood();
      sfx('eat');
    } else {
      state.snake.pop();
    }
    updateStats();
  };

  const gameOver = () => {
    state.phase = 'over';
    sfx('die');
    if (el.pauseBtn) el.pauseBtn.disabled = true;
    showOverlay('Game Over', `Score <strong>${state.score}</strong> &nbsp;•&nbsp; Best <strong>${state.high}</strong>`, '↻ Play again');
    render();
  };

  const startGame = () => {
    audio();
    reset();
    state.phase = 'running';
    state.lastStep = performance.now();
    state.secMark = performance.now();
    hideOverlay();
    if (el.pauseBtn) { el.pauseBtn.disabled = false; el.pauseBtn.textContent = '⏸ Pause'; }
    if (el.restartBtn) el.restartBtn.disabled = false;
    sfx('start');
    requestAnimationFrame(loop);
  };

  const pauseGame = () => {
    if (state.phase !== 'running') return;
    state.phase = 'paused';
    if (el.pauseBtn) el.pauseBtn.textContent = '▶ Resume';
    showOverlay('Paused', 'Take a breath — your snake is waiting.', '▶ Resume');
  };
  const resumeGame = () => {
    if (state.phase !== 'paused') return;
    state.phase = 'running';
    if (el.pauseBtn) el.pauseBtn.textContent = '⏸ Pause';
    hideOverlay();
    state.lastStep = performance.now();
    state.secMark = performance.now();
    requestAnimationFrame(loop);
  };
  const togglePause = () => { if (state.phase === 'running') pauseGame(); else if (state.phase === 'paused') resumeGame(); };

  const loop = (t) => {
    if (state.phase !== 'running') return;
    if (t - state.secMark >= 1000) { state.secMark = t; state.elapsed += 1; updateStats(); }
    if (t - state.lastStep >= stepInterval()) { state.lastStep = t; step(); if (state.phase !== 'running') return; }
    render(t);
    requestAnimationFrame(loop);
  };

  /* ---------- input ---------- */
  const onKey = (e) => {
    const name = KEYMAP[e.key];
    if (name) { e.preventDefault(); if (state.phase === 'running') setPending(name); return; }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (state.phase === 'idle' || state.phase === 'over') startGame();
      else togglePause();
    }
  };
  const overlayAction = () => { if (state.phase === 'paused') resumeGame(); else startGame(); };

  const bind = () => {
    window.addEventListener('keydown', onKey);
    if (el.ovBtn) el.ovBtn.addEventListener('click', overlayAction);
    if (el.pauseBtn) el.pauseBtn.addEventListener('click', togglePause);
    if (el.restartBtn) el.restartBtn.addEventListener('click', startGame);
    if (el.muteBtn) el.muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      try { localStorage.setItem(MUTE_KEY, state.muted ? '1' : '0'); } catch (e) {}
      el.muteBtn.textContent = state.muted ? '🔇 Sound' : '🔊 Sound';
      audio();
    });
    if (el.speedSel) el.speedSel.addEventListener('change', () => { state.speedName = el.speedSel.value; });
    el.dpad.forEach((b) => {
      const act = (e) => { e.preventDefault(); if (state.phase === 'idle' || state.phase === 'over') startGame(); setPending(b.dataset.control); };
      b.addEventListener('click', act);
      b.addEventListener('touchstart', act, { passive: false });
    });
    /* Swipe steering. Turns commit on touchmove rather than touchend: Snake is
       played in quick flicks, and waiting for the finger to lift cost a turn
       every time. Each committed turn re-bases the origin, so one continuous
       drag can steer several times. The threshold is deliberately short - 24px
       felt unresponsive at the speeds this game reaches. */
    const SWIPE_MIN = 14;
    let sx = 0, sy = 0, swiped = false;
    wrap.addEventListener('touchstart', (e) => {
      const tt = e.touches[0];
      sx = tt.clientX; sy = tt.clientY; swiped = false;
    }, { passive: true });
    wrap.addEventListener('touchmove', (e) => {
      const tt = e.touches[0];
      const dx = tt.clientX - sx, dy = tt.clientY - sy;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
      if (state.phase === 'idle' || state.phase === 'over') startGame();
      if (Math.abs(dx) > Math.abs(dy)) setPending(dx > 0 ? 'right' : 'left');
      else setPending(dy > 0 ? 'down' : 'up');
      sx = tt.clientX; sy = tt.clientY;
      swiped = true;
    }, { passive: true });
    /* A tap on the board that never became a swipe starts or resumes the game.
       On a phone that is the first thing people try, and until now only the
       small overlay button responded to it. Taps that land on a button are left
       alone so the overlay's own handler does not fire startGame() twice. */
    wrap.addEventListener('touchend', (e) => {
      if (swiped) return;
      if (e.target.closest && e.target.closest('button')) return;
      if (state.phase === 'idle' || state.phase === 'over') startGame();
      else if (state.phase === 'paused') resumeGame();
    }, { passive: true });
    window.addEventListener('resize', fitCanvas);
  };

  /* ---------- init ---------- */
  state.high = loadHigh();
  try { state.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  if (el.muteBtn) el.muteBtn.textContent = state.muted ? '🔇 Sound' : '🔊 Sound';
  if (el.speedSel) state.speedName = el.speedSel.value || 'medium';
  reset();
  fitCanvas();
  bind();
  updateStats();
  showOverlay('🐍 Snake', 'Use <strong>arrow keys</strong>, <strong>WASD</strong>, swipe, or the D-pad. Eat apples, avoid walls and your tail.', '▶ Start game');
})();
