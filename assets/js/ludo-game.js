/* =========================================================
   ToolAdda Ludo — engine + 3D dice, animated tokens,
   reverse-capture animation, sound effects, fullscreen.
   ========================================================= */
(function () {
  'use strict';

  const RING = [
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
    [7, 0],
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
    [14, 7],
    [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
    [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
    [7, 14],
    [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    [0, 7],
    [0, 6],
  ];
  const HOME_LANES = [
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  ];
  const YARDS = [
    [[1, 1], [4, 1], [1, 4], [4, 4]],
    [[10, 1], [13, 1], [10, 4], [13, 4]],
    [[10, 10], [13, 10], [10, 13], [13, 13]],
    [[1, 10], [4, 10], [1, 13], [4, 13]],
  ];
  const START_OFFSET = [0, 13, 26, 39];
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const FINISH = 57;
  const COLORS = ['#c62828', '#2f7d32', '#b8860b', '#1d4ed8'];
  const NAMES = ['Red', 'Green', 'Yellow', 'Blue'];
  const SEATS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

  const ringIndex = (seat, progress) => (START_OFFSET[seat] + progress - 1) % 52;
  const canMove = (progress, dice) => {
    if (progress === FINISH) return false;
    if (progress === 0) return dice === 6;
    return progress + dice <= FINISH;
  };
  const destProgress = (progress, dice) => (progress === 0 ? 1 : progress + dice);
  const coordOf = (seat, tokenIndex, progress) => {
    if (progress === 0) return YARDS[seat][tokenIndex];
    if (progress <= 51) return RING[ringIndex(seat, progress)];
    if (progress < FINISH) return HOME_LANES[seat][progress - 52];
    return [7, 7];
  };

  const Engine = { RING, HOME_LANES, YARDS, START_OFFSET, SAFE, FINISH, SEATS, ringIndex, canMove, destProgress, coordOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  if (typeof document === 'undefined') return;

  /* ===================== UI ===================== */
  const $ = (s) => document.querySelector(s);
  const boardEl = $('[data-board]');
  if (!boardEl) return;
  const tokenLayer = $('[data-token-layer]');
  const diceCube = $('[data-dice-cube]');
  const diceValueText = $('[data-dice-value]');
  const rollButton = $('[data-roll-btn]');
  const startButton = $('[data-start-btn]');
  const resetButton = $('[data-reset-btn]');
  const tiltButton = $('[data-tilt-btn]');
  const fsBtn = $('[data-fs-btn]');
  const muteBtn = $('[data-mute-btn]');
  const playerCountSelect = $('[data-player-count]');
  const cpuToggle = $('[data-cpu-toggle]');
  const currentLabel = $('[data-current-label]');
  const currentColor = $('[data-current-color]');
  const messageEl = $('[data-message]');
  const historyList = document.querySelector('[data-history-list] ul');
  const boardStage = $('[data-board-stage]');
  const fsTarget = document.querySelector('[data-fs-panel]');
  const fsLabel = $('[data-fs-label]');
  const fsColor = $('[data-fs-color]');
  const fsDice = $('[data-fs-dice]');
  const fsMessage = $('[data-fs-message]');
  const fsRollBtn = $('[data-fs-roll]');
  const mbLabel = $('[data-mb-label]');
  const mbColor = $('[data-mb-color]');
  const mbMessage = $('[data-mb-message]');
  const mbRollBtn = $('[data-mb-roll]');
  const mobileBar = $('[data-mobile-bar]');
  const scoresCard = $('[data-scores-card]');
  const playerScoresEl = $('[data-player-scores]');
  const diceHint = $('[data-dice-hint]');
  let fsExitBtn = null;

  const STORAGE_KEY = 'tooladda-ludo-v3';
  const STEP_MS = 210;

  const state = {
    players: [], current: 0, dice: null, active: false,
    rolling: false, animating: false, playerCount: 4, cpu: false,
    muted: false, history: [], winner: null,
  };

  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} };
  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      Object.assign(state, JSON.parse(raw));
      state.rolling = false; state.animating = false;
      return true;
    } catch (e) { return false; }
  };

  /* ---- Sound (Web Audio, synthesized) ---- */
  let audioCtx = null;
  const ensureAudio = () => {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  };
  const tone = (freq, dur, type, gain, delay) => {
    if (state.muted || !audioCtx) return;
    const t = audioCtx.currentTime + (delay || 0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.14, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  };
  const sfx = (kind) => {
    if (state.muted) return;
    ensureAudio();
    if (!audioCtx) return;
    switch (kind) {
      case 'roll': for (let i = 0; i < 6; i++) tone(180 + Math.random() * 320, 0.05, 'square', 0.07, i * 0.055); break;
      case 'step': tone(700, 0.05, 'triangle', 0.11); break;
      case 'capture': tone(420, 0.1, 'sawtooth', 0.16); tone(170, 0.2, 'sawtooth', 0.14, 0.08); break;
      case 'finish': [523, 659, 784].forEach((f, i) => tone(f, 0.13, 'sine', 0.14, i * 0.09)); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'sine', 0.16, i * 0.13)); break;
      case 'turn': tone(430, 0.07, 'sine', 0.09); break;
      default: break;
    }
  };

  const log = (m) => { state.history.unshift(m); if (state.history.length > 30) state.history.length = 30; };
  const renderHistory = () => {
    if (!historyList) return;
    historyList.innerHTML = '';
    state.history.slice(0, 12).forEach((m) => { const li = document.createElement('li'); li.textContent = m; historyList.appendChild(li); });
  };
  const setMessage = (m) => {
    if (messageEl) messageEl.textContent = m;
    if (fsMessage) fsMessage.textContent = m;
    if (mbMessage) mbMessage.textContent = m;
  };

  const syncTurnUI = (pl) => {
    if (!pl) return;
    const label = pl.name + (pl.isCPU ? ' (CPU)' : '');
    if (currentLabel) currentLabel.textContent = label;
    if (currentColor) {
      currentColor.style.background = pl.color;
      currentColor.style.color = pl.color;
    }
    if (fsLabel) fsLabel.textContent = label;
    if (fsColor) {
      fsColor.style.background = pl.color;
      fsColor.style.color = pl.color;
    }
    if (mbLabel) mbLabel.textContent = label;
    if (mbColor) {
      mbColor.style.background = pl.color;
      mbColor.style.color = pl.color;
    }
    if (diceCube) diceCube.style.setProperty('--dice-col', pl.color);
    if (boardEl) boardEl.setAttribute('data-turn', String(pl.seat));
  };

  const syncDiceUI = (value) => {
    const text = value == null ? '–' : String(value);
    if (diceValueText) diceValueText.textContent = text;
    if (fsDice) fsDice.textContent = text;
  };

  const renderPlayerScores = () => {
    if (!playerScoresEl) return;
    if (!state.active || !state.players.length) {
      if (scoresCard) scoresCard.hidden = true;
      playerScoresEl.innerHTML = '';
      return;
    }
    if (scoresCard) scoresCard.hidden = false;
    playerScoresEl.innerHTML = state.players.map((pl, i) => {
      const home = pl.tokens.filter((tk) => tk.progress === FINISH).length;
      const pips = [0, 1, 2, 3].map((n) => `<span class="player-score-pip${n < home ? ' done' : ''}" style="color:${pl.color}"></span>`).join('');
      return `<div class="player-score${i === state.current ? ' active' : ''}"><span class="player-score-dot" style="background:${pl.color}"></span><span class="player-score-name">${pl.name}${pl.isCPU ? ' 🤖' : ''}</span><span class="player-score-pips" aria-label="${home} of 4 home">${pips}</span></div>`;
    }).join('');
  };

  const updateMobileBar = () => {
    if (!mobileBar) return;
    mobileBar.classList.toggle('show', state.active && window.innerWidth <= 980);
  };
  const seatOf = (p) => state.players[p].seat;

  const cellAt = (x, y) => boardEl.children[y * 15 + x];
  const buildBoard = () => {
    boardEl.innerHTML = '';
    for (let i = 0; i < 225; i++) { const c = document.createElement('div'); c.className = 'lc'; boardEl.appendChild(c); }
    [[0, 0], [9, 0], [9, 9], [0, 9]].forEach(([ox, oy], p) => {
      for (let y = oy; y < oy + 6; y++) for (let x = ox; x < ox + 6; x++) { const c = cellAt(x, y); if (c) c.classList.add('yard', 'yard-' + p); }
    });
    RING.forEach(([x, y], i) => { const c = cellAt(x, y); if (!c) return; c.classList.add('track'); if (SAFE.has(i)) c.classList.add('safe'); });
    START_OFFSET.forEach((idx, p) => { const [x, y] = RING[idx]; const c = cellAt(x, y); if (c) c.classList.add('start-' + p); });
    HOME_LANES.forEach((lane, p) => lane.forEach(([x, y]) => { const c = cellAt(x, y); if (c) c.classList.add('lane-' + p); }));
    [[6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [6, 8], [7, 8], [8, 8]].forEach(([x, y]) => { const c = cellAt(x, y); if (c) c.classList.add('center'); });
    YARDS.forEach((spots) => spots.forEach(([x, y]) => { const c = cellAt(x, y); if (c) c.classList.add('slot'); }));
  };

  const initPlayers = () => {
    const seats = SEATS[state.playerCount] || [0, 1, 2, 3];
    state.players = seats.map((seat, i) => ({
      seat, color: COLORS[seat], name: NAMES[seat],
      isCPU: state.cpu && i !== 0,
      tokens: [0, 0, 0, 0].map(() => ({ progress: 0 })),
    }));
  };

  const tokenCanMove = (p, t) => {
    if (!state.active || state.rolling || state.animating || state.current !== p || state.dice == null) return false;
    return canMove(state.players[p].tokens[t].progress, state.dice);
  };
  const movableTokens = (p) => {
    const out = [];
    state.players[p].tokens.forEach((tk, t) => { if (canMove(tk.progress, state.dice)) out.push(t); });
    return out;
  };

  // returns array of captured token objects (does NOT reset them yet)
  const capture = (moverSeat, moverP, progress) => {
    if (progress < 1 || progress > 51) return [];
    const idx = ringIndex(moverSeat, progress);
    if (SAFE.has(idx)) return [];
    const caught = [];
    state.players.forEach((pl, pi) => {
      if (pi === moverP) return;
      pl.tokens.forEach((tk) => {
        if (tk.progress >= 1 && tk.progress <= 51 && ringIndex(pl.seat, tk.progress) === idx) caught.push(tk);
      });
    });
    return caught;
  };

  const nextPlayer = () => { state.dice = null; state.current = (state.current + 1) % state.players.length; sfx('turn'); renderTurn(); save(); maybeCPU(); };

  // reverse-walk captured tokens back to their yard
  const animateReturn = (tokens, done) => {
    const set = new Set(tokens);
    const tick = () => {
      let moving = false;
      tokens.forEach((tk) => { if (tk.progress > 0) { tk.progress -= 1; moving = true; } });
      renderTokens({ returning: set });
      if (moving) window.setTimeout(tick, 55);
      else { renderTokens(); window.setTimeout(done, 160); }
    };
    tick();
  };

  const applyMove = (p, t) => {
    const pl = state.players[p];
    const token = pl.tokens[t];
    const dice = state.dice;
    const from = token.progress;
    const to = destProgress(from, dice);
    state.dice = null;
    state.animating = true;
    renderControls();

    const steps = [];
    if (from === 0) steps.push(1);
    else for (let s = from + 1; s <= to; s++) steps.push(s);

    let i = 0;
    const stepOnce = () => {
      token.progress = steps[i];
      sfx('step');
      renderTokens({ hop: { p, t } });
      i++;
      if (i < steps.length) window.setTimeout(stepOnce, STEP_MS);
      else window.setTimeout(finishMove, STEP_MS + 60);
    };

    const finishMove = () => {
      let finished = false;
      let caught = [];
      if (token.progress === FINISH) { finished = true; log(`${pl.name} sent a token home! 🏠`); sfx('finish'); }
      else {
        caught = capture(pl.seat, p, token.progress);
        if (caught.length) { log(`${pl.name} captured ${caught.length} token${caught.length > 1 ? 's' : ''}! 💥`); sfx('capture'); }
      }

      const finalize = () => {
        const allHome = pl.tokens.every((tk) => tk.progress === FINISH);
        if (allHome) { state.winner = pl.name; state.active = false; log(`🏆 ${pl.name} wins the game!`); sfx('win'); }
        const extra = dice === 6 || caught.length > 0 || finished;
        renderTokens();
        renderHistory();
        renderPlayerScores();
        save();
        window.setTimeout(() => {
          state.animating = false;
          if (state.winner) { setMessage(`🏆 ${state.winner} wins! Start a new game.`); renderControls(); return; }
          if (!extra) nextPlayer();
          else { setMessage(`${state.players[state.current].name}: roll again!`); renderControls(); maybeCPU(); }
          save();
        }, 200);
      };

      if (caught.length) animateReturn(caught, finalize);
      else finalize();
    };

    stepOnce();
  };

  /* ---- Dice ---- */
  const BASE_TILT = '';
  const DICE_FACE = { 1: '', 2: 'rotateY(-90deg)', 3: 'rotateX(-90deg)', 4: 'rotateX(90deg)', 5: 'rotateY(90deg)', 6: 'rotateY(180deg)' };
  const showDiceFace = (v) => {
    if (diceCube) diceCube.style.transform = BASE_TILT + (DICE_FACE[v] || '');
    syncDiceUI(v);
  };

  const roll = () => {
    if (!state.active || state.rolling || state.animating || state.dice != null) return;
    ensureAudio();
    state.rolling = true;
    renderControls();
    if (diceCube) diceCube.classList.add('rolling');
    sfx('roll');
    const value = Math.floor(Math.random() * 6) + 1;

    window.setTimeout(() => {
      if (diceCube) diceCube.classList.remove('rolling');
      state.rolling = false;
      state.dice = value;
      showDiceFace(value);
      log(`${state.players[state.current].name} rolled a ${value}.`);
      renderHistory();

      const movable = movableTokens(state.current);
      if (!movable.length) {
        setMessage(`${state.players[state.current].name} rolled ${value} — no moves. Next player.`);
        renderTokens(); renderControls(); save();
        window.setTimeout(nextPlayer, 700);
        return;
      }
      renderTokens(); renderControls(); save();

      if (isCPUTurn()) { maybeCPUMove(); return; }
      if (value !== 6 && movable.length === 1) {
        setMessage(`${state.players[state.current].name}: auto-moving your only token…`);
        window.setTimeout(() => applyMove(state.current, movable[0]), 520);
      } else {
        setMessage(`${state.players[state.current].name}: tap a highlighted token to move.`);
      }
    }, 950);
  };

  /* ---- CPU ---- */
  const isCPUTurn = () => state.active && state.players[state.current] && state.players[state.current].isCPU;
  const maybeCPU = () => { if (isCPUTurn()) window.setTimeout(roll, 650); };
  const maybeCPUMove = () => {
    if (!isCPUTurn()) return;
    window.setTimeout(() => {
      const p = state.current;
      const moves = movableTokens(p).map((t) => {
        const np = destProgress(state.players[p].tokens[t].progress, state.dice);
        let score = np;
        if (np === FINISH) score += 100;
        if (np <= 51 && !SAFE.has(ringIndex(seatOf(p), np))) {
          state.players.forEach((pl, pi) => { if (pi !== p) pl.tokens.forEach((o) => { if (o.progress >= 1 && o.progress <= 51 && ringIndex(pl.seat, o.progress) === ringIndex(seatOf(p), np)) score += 60; }); });
        }
        if (state.players[p].tokens[t].progress === 0) score += 20;
        return { t, score };
      });
      if (!moves.length) return;
      moves.sort((a, b) => b.score - a.score);
      applyMove(p, moves[0].t);
    }, 550);
  };

  /* ---- Rendering ---- */
  const renderTurn = () => {
    const pl = state.players[state.current];
    syncTurnUI(pl);
    renderControls();
    renderPlayerScores();
    updateMobileBar();
    save();
  };

  const renderControls = () => {
    const disabled = !state.active || state.rolling || state.animating || state.dice != null || isCPUTurn();
    if (rollButton) rollButton.disabled = disabled;
    if (fsRollBtn) fsRollBtn.disabled = disabled;
    if (mbRollBtn) mbRollBtn.disabled = disabled;
    if (resetButton) resetButton.disabled = !state.active;
    if (diceHint) diceHint.hidden = disabled || isCPUTurn();
    if (diceCube) diceCube.style.cursor = disabled ? 'default' : 'pointer';
  };

  const renderTokens = (opts) => {
    opts = opts || {};
    if (!tokenLayer) return;
    tokenLayer.innerHTML = '';
    const cellPx = (tokenLayer.clientWidth || 560) / 15;
    const groups = new Map();
    state.players.forEach((pl, p) => {
      pl.tokens.forEach((tk, t) => {
        const [x, y] = coordOf(pl.seat, t, tk.progress);
        const key = x + ',' + y;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ p, t, tk, x, y });
      });
    });
    groups.forEach((arr) => {
      const n = arr.length;
      arr.forEach((item, i) => {
        const { p, t, tk, x, y } = item;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'token tk-' + seatOf(p);
        if (n > 1) el.classList.add('stacked');
        if (tokenCanMove(p, t)) el.classList.add('movable');
        if (opts.hop && opts.hop.p === p && opts.hop.t === t) el.classList.add('hopping');
        if (opts.returning && opts.returning.has(tk)) el.classList.add('returning');
        el.style.setProperty('--tc', COLORS[seatOf(p)]);
        const r = n > 1 ? cellPx * 0.24 : 0;
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const dx = n > 1 ? Math.cos(ang) * r : 0;
        const dy = n > 1 ? Math.sin(ang) * r : 0;
        el.style.left = `calc(${(x + 0.5) / 15 * 100}% + ${dx}px)`;
        el.style.top = `calc(${(y + 0.5) / 15 * 100}% + ${dy}px)`;
        el.dataset.player = String(p);
        el.dataset.token = String(t);
        el.disabled = !tokenCanMove(p, t);
        if (n > 1) el.innerHTML = '<span class="tk-count">' + n + '</span>';
        tokenLayer.appendChild(el);
      });
    });
  };

  const renderAll = () => { renderTokens(); renderTurn(); renderHistory(); renderControls(); updateMobileBar(); };

  if (tokenLayer) tokenLayer.addEventListener('click', (e) => {
    const btn = e.target.closest('.token');
    if (!btn) return;
    const p = Number(btn.dataset.player);
    const t = Number(btn.dataset.token);
    if (tokenCanMove(p, t)) applyMove(p, t);
  });

  const newGame = () => {
    ensureAudio();
    state.active = true; state.current = 0; state.dice = null;
    state.rolling = false; state.animating = false; state.winner = null;
    state.playerCount = Number(playerCountSelect ? playerCountSelect.value : 4);
    state.cpu = !!(cpuToggle && cpuToggle.checked);
    state.history = [];
    initPlayers();
    log(`New game — ${state.players.map((p) => p.name).join(', ')}. Roll a 6 to leave the yard!`);
    showDiceFace(1);
    setMessage(`${state.players[0].name}: roll the dice to start.`);
    renderAll();
    save();
    maybeCPU();
  };

  const setMute = (m) => {
    state.muted = m;
    if (muteBtn) muteBtn.textContent = m ? '🔇 Sound off' : '🔊 Sound on';
    save();
  };

  if (rollButton) rollButton.addEventListener('click', roll);
  if (fsRollBtn) fsRollBtn.addEventListener('click', roll);
  if (mbRollBtn) mbRollBtn.addEventListener('click', roll);
  if (diceCube) {
    diceCube.addEventListener('click', () => { if (rollButton && !rollButton.disabled) roll(); });
    diceCube.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && rollButton && !rollButton.disabled) {
        e.preventDefault();
        roll();
      }
    });
  }
  if (startButton) startButton.addEventListener('click', newGame);
  if (resetButton) resetButton.addEventListener('click', newGame);
  if (playerCountSelect) playerCountSelect.addEventListener('change', newGame);
  if (cpuToggle) cpuToggle.addEventListener('change', () => { if (state.active) newGame(); });
  if (muteBtn) muteBtn.addEventListener('click', () => setMute(!state.muted));
  if (tiltButton && boardStage) tiltButton.addEventListener('click', () => {
    const on = boardStage.classList.toggle('tilt');
    tiltButton.textContent = on ? '🎲 3D: On' : '🎲 3D: Off';
  });

  // Fullscreen — only the game board box (CSS overlay, works on mobile incl. iOS)
  if (fsTarget) {
    fsExitBtn = document.createElement('button');
    fsExitBtn.type = 'button';
    fsExitBtn.className = 'ludo-exit';
    fsExitBtn.setAttribute('aria-label', 'Exit fullscreen');
    fsExitBtn.textContent = '✕';
    document.body.appendChild(fsExitBtn);
    fsExitBtn.addEventListener('click', () => exitFs());
  }
  const exitFs = () => {
    if (!fsTarget) return;
    fsTarget.classList.remove('ludo-fs');
    if (fsExitBtn) fsExitBtn.classList.remove('show');
    document.body.style.overflow = '';
    if (fsBtn) fsBtn.textContent = '⛶ Fullscreen';
    setTimeout(() => renderTokens(), 60);
  };
  if (fsBtn && fsTarget) fsBtn.addEventListener('click', () => {
    const on = fsTarget.classList.toggle('ludo-fs');
    if (fsExitBtn) fsExitBtn.classList.toggle('show', on);
    document.body.style.overflow = on ? 'hidden' : '';
    fsBtn.textContent = on ? '✕ Exit fullscreen' : '⛶ Fullscreen';
    setTimeout(() => renderTokens(), 80);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitFs(); });
  window.addEventListener('resize', () => { renderTokens(); updateMobileBar(); });

  buildBoard();
  if (load() && state.active && state.players.length) {
    setMute(state.muted);
    showDiceFace(state.dice || 1);
    setMessage(state.winner ? `🏆 ${state.winner} wins! Start a new game.` : 'Game restored. Continue playing.');
    renderAll();
    maybeCPU();
  } else {
    state.active = false;
    setMute(state.muted);
    initPlayers();
    showDiceFace(1);
    setMessage('Press "New game" to start.');
    renderTokens();
    renderControls();
    renderPlayerScores();
    updateMobileBar();
  }
})();
