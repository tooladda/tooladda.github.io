(function () {
  const page = document.querySelector('[data-coin-flip-page]');
  if (!page) return;

  const STORAGE_KEY = 'tooladda-coin-flip-stats';

  const els = {
    coin: document.getElementById('flipCoin'),
    flipBtn: document.getElementById('flipCoinBtn'),
    resetBtn: document.getElementById('resetStatsBtn'),
    resultText: document.getElementById('flipResultText'),
    statTotal: document.getElementById('statTotalFlips'),
    statHeads: document.getElementById('statHeadsCount'),
    statTails: document.getElementById('statTailsCount'),
    statPercent: document.getElementById('statHeadsPercent'),
    historyList: document.getElementById('flipHistoryList'),
    toast: document.getElementById('coinFlipToast'),
  };

  let isFlipping = false;
  let currentRotation = 0;
  let stats = loadStats();

  /* ---- Sound (Web Audio, synthesized — no files) ---- */
  const MUTE_KEY = 'tooladda-coin-muted';
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  let audioCtx = null;
  const ensureAudio = () => {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  };
  const tone = (freq, dur, type, gain, delay) => {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime + (delay || 0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  };
  const sfxFlip = () => {
    ensureAudio();
    if (muted || !audioCtx) return;
    let d = 0;
    for (let i = 0; i < 9; i++) { tone(500 + (i % 2 ? 110 : 0), 0.03, 'square', 0.06, d); d += 0.05 + i * 0.02; }
  };
  const sfxLand = (result) => {
    ensureAudio();
    if (muted || !audioCtx) return;
    const notes = result === 'heads' ? [660, 880] : [523, 392];
    notes.forEach((f, i) => tone(f, 0.18, 'sine', 0.15, i * 0.08));
    tone(result === 'heads' ? 1320 : 784, 0.26, 'triangle', 0.1, 0.16);
  };
  const sfxReset = () => { ensureAudio(); if (!muted && audioCtx) tone(300, 0.12, 'sine', 0.1); };

  function loadStats() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        total: Number(saved.total) || 0,
        heads: Number(saved.heads) || 0,
        tails: Number(saved.tails) || 0,
        history: Array.isArray(saved.history) ? saved.history.slice(0, 12) : [],
      };
    } catch (error) {
      return { total: 0, heads: 0, tails: 0, history: [] };
    }
  }

  function saveStats() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
  }

  function fairFlip() {
    if (window.crypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0] % 2 === 0 ? 'heads' : 'tails';
    }
    return Math.random() < 0.5 ? 'heads' : 'tails';
  }

  function renderStats() {
    if (els.statTotal) els.statTotal.textContent = String(stats.total);
    if (els.statHeads) els.statHeads.textContent = String(stats.heads);
    if (els.statTails) els.statTails.textContent = String(stats.tails);
    if (els.statPercent) {
      const percent = stats.total ? Math.round((stats.heads / stats.total) * 100) : 0;
      els.statPercent.textContent = `${percent}%`;
    }
    renderHistory();
  }

  function renderHistory() {
    if (!els.historyList) return;
    if (!stats.history.length) {
      els.historyList.innerHTML = '<span class="history-empty">Flip the coin to start your streak.</span>';
      return;
    }
    els.historyList.innerHTML = stats.history
      .map((item) => `<span class="history-chip ${item}">${item === 'heads' ? '🪙 Heads' : '✨ Tails'}</span>`)
      .join('');
  }

  function setResultText(result, flipping) {
    if (!els.resultText) return;
    if (flipping) {
      els.resultText.textContent = 'Flipping…';
      els.resultText.dataset.state = 'flipping';
      return;
    }
    els.resultText.textContent = result === 'heads' ? 'Heads!' : 'Tails!';
    els.resultText.dataset.state = result;
  }

  function flipCoin() {
    if (isFlipping || !els.coin) return;
    isFlipping = true;
    sfxFlip();
    els.flipBtn?.setAttribute('disabled', 'disabled');
    setResultText('', true);

    const result = fairFlip();
    const extraSpins = 4 + Math.floor(Math.random() * 3);
    const target = result === 'tails' ? 180 : 0;
    const base = currentRotation - (currentRotation % 360);
    currentRotation = base + extraSpins * 360 + target;

    els.coin.style.transform = `rotateY(${currentRotation}deg)`;
    els.coin.classList.add('is-flipping');

    const onDone = () => {
      els.coin.removeEventListener('transitionend', onDone);
      els.coin.classList.remove('is-flipping');

      stats.total += 1;
      stats[result] += 1;
      stats.history.unshift(result);
      stats.history = stats.history.slice(0, 12);
      saveStats();
      renderStats();
      setResultText(result, false);
      sfxLand(result);
      showToast(result === 'heads' ? 'It landed on Heads!' : 'It landed on Tails!');

      isFlipping = false;
      els.flipBtn?.removeAttribute('disabled');
    };

    els.coin.addEventListener('transitionend', onDone);
  }

  function resetStats() {
    stats = { total: 0, heads: 0, tails: 0, history: [] };
    saveStats();
    renderStats();
    setResultText('', false);
    if (els.resultText) els.resultText.textContent = 'Ready to flip';
    if (els.resultText) els.resultText.dataset.state = 'idle';
    sfxReset();
    showToast('Stats reset');
  }

  // Mute toggle (injected next to the flip button)
  if (els.flipBtn && els.flipBtn.parentNode) {
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = els.resetBtn ? els.resetBtn.className : 'secondary-btn';
    muteBtn.style.marginLeft = '0.5rem';
    const syncMute = () => { muteBtn.textContent = muted ? '🔇 Sound off' : '🔊 Sound on'; };
    syncMute();
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
      ensureAudio();
      syncMute();
      if (!muted) tone(660, 0.1, 'sine', 0.12);
    });
    els.flipBtn.parentNode.appendChild(muteBtn);
  }

  els.flipBtn?.addEventListener('click', flipCoin);
  els.coin?.addEventListener('click', flipCoin);
  els.coin?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flipCoin();
    }
  });
  els.resetBtn?.addEventListener('click', resetStats);

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.target.closest('input, textarea, select')) {
      event.preventDefault();
      flipCoin();
    }
  });

  if (els.resultText) {
    els.resultText.textContent = 'Ready to flip';
    els.resultText.dataset.state = 'idle';
  }

  renderStats();
})();
