(() => {
  const STORAGE_KEY = 'tooladda-minesweeper-state';
  const STATS_KEY = 'tooladda-minesweeper-stats';
  const DIFFICULTIES = {
    beginner: { label: 'Beginner', rows: 9, cols: 9, mines: 10 },
    intermediate: { label: 'Intermediate', rows: 16, cols: 16, mines: 40 },
    expert: { label: 'Expert', rows: 16, cols: 30, mines: 99 },
  };

  const page = document.querySelector('[data-minesweeper-page]');
  if (!page) return;

  const boardEl = page.querySelector('[data-board]');
  const overlayEl = page.querySelector('[data-overlay]');
  const overlayTitleEl = page.querySelector('[data-overlay-title]');
  const overlayCopyEl = page.querySelector('[data-overlay-copy]');
  const timerEl = page.querySelector('[data-timer]');
  const minesLeftEl = page.querySelector('[data-mines-left]');
  const difficultyEl = page.querySelector('[data-difficulty]');
  const statusEl = page.querySelector('[data-status]');
  const bestTimeEl = page.querySelector('[data-best-time]');
  const gamesPlayedEl = page.querySelector('[data-games-played]');
  const gamesWonEl = page.querySelector('[data-games-won]');
  const winPercentEl = page.querySelector('[data-win-percent]');
  const streakEl = page.querySelector('[data-current-streak]');
  const longestStreakEl = page.querySelector('[data-longest-streak]');
  const cellsOpenedEl = page.querySelector('[data-cells-opened]');
  const difficultySelectEl = page.querySelector('[data-difficulty-select]');
  const customSettingsEl = page.querySelector('[data-custom-settings]');
  const customRowsEl = page.querySelector('[data-custom-rows]');
  const customColsEl = page.querySelector('[data-custom-cols]');
  const customMinesEl = page.querySelector('[data-custom-mines]');
  const flagModeButton = page.querySelector('[data-action="toggle-flag-mode"]');
  const confettiLayer = page.querySelector('[data-confetti]');

  const state = {
    rows: 9,
    cols: 9,
    mines: 10,
    difficulty: 'beginner',
    board: [],
    revealed: [],
    flagged: [],
    questionMarks: [],
    gameStarted: false,
    gameOver: false,
    gameWon: false,
    paused: false,
    timer: 0,
    timerId: null,
    flagMode: false,
    firstMoveDone: false,
    stats: loadStats(),
    boardSeed: null,
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const safeStorage = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch (error) {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        // Ignore storage issues.
      }
    },
  };

  function loadStats() {
    try {
      return JSON.parse(safeStorage.get(STATS_KEY) || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveStats() {
    safeStorage.set(STATS_KEY, JSON.stringify(state.stats));
  }

  function loadSavedState() {
    const saved = safeStorage.get(STORAGE_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch (error) {
      return null;
    }
  }

  function saveState() {
    const payload = {
      rows: state.rows,
      cols: state.cols,
      mines: state.mines,
      difficulty: state.difficulty,
      board: state.board,
      revealed: state.revealed,
      flagged: state.flagged,
      questionMarks: state.questionMarks,
      gameStarted: state.gameStarted,
      gameOver: state.gameOver,
      gameWon: state.gameWon,
      paused: state.paused,
      timer: state.timer,
      flagMode: state.flagMode,
      firstMoveDone: state.firstMoveDone,
      stats: state.stats,
    };
    safeStorage.set(STORAGE_KEY, JSON.stringify(payload));
  }

  function updateBestTime() {
    const difficultyKey = state.difficulty === 'custom' ? `${state.rows}x${state.cols}` : state.difficulty;
    const best = state.stats.bestTimes?.[difficultyKey];
    bestTimeEl.textContent = best ? formatTime(best) : '—';
  }

  function updateHud() {
    timerEl.textContent = formatTime(state.timer);
    const flaggedCount = state.flagged.flat().filter(Boolean).length;
    minesLeftEl.textContent = Math.max(state.mines - flaggedCount, 0);
    difficultyEl.textContent = state.difficulty === 'custom' ? `Custom (${state.rows}×${state.cols})` : DIFFICULTIES[state.difficulty]?.label || 'Custom';
    statusEl.textContent = state.gameOver ? 'Game Over' : state.gameWon ? 'Victory' : state.paused ? 'Paused' : state.gameStarted ? 'Playing' : 'Ready';
    updateBestTime();
    gamesPlayedEl.textContent = state.stats.gamesPlayed || 0;
    gamesWonEl.textContent = state.stats.gamesWon || 0;
    winPercentEl.textContent = `${state.stats.winPercentage || 0}%`;
    streakEl.textContent = state.stats.currentStreak || 0;
    longestStreakEl.textContent = state.stats.longestStreak || 0;
    cellsOpenedEl.textContent = state.stats.totalCellsOpened || 0;
    flagModeButton.textContent = `Flag Mode: ${state.flagMode ? 'On' : 'Off'}`;
  }

  function resetTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
    }
    state.timer = 0;
    state.timerId = null;
  }

  function startTimer() {
    if (state.timerId) return;
    state.timerId = window.setInterval(() => {
      state.timer += 1;
      timerEl.textContent = formatTime(state.timer);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function showOverlay(title, copy) {
    overlayTitleEl.textContent = title;
    overlayCopyEl.textContent = copy;
    overlayEl.classList.remove('hidden');
  }

  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  function createEmptyBoard(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(0));
  }

  function generateBoard(firstRow, firstCol) {
    const board = createEmptyBoard(state.rows, state.cols);
    const minePositions = new Set();
    const totalCells = state.rows * state.cols;
    const safeZone = new Set();

    for (let r = -1; r <= 1; r += 1) {
      for (let c = -1; c <= 1; c += 1) {
        const nr = firstRow + r;
        const nc = firstCol + c;
        if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
          safeZone.add(nr * state.cols + nc);
        }
      }
    }

    while (minePositions.size < state.mines) {
      const id = Math.floor(Math.random() * totalCells);
      if (safeZone.has(id)) continue;
      minePositions.add(id);
    }

    minePositions.forEach((id) => {
      const row = Math.floor(id / state.cols);
      const col = id % state.cols;
      board[row][col] = 'M';
    });

    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        if (board[row][col] === 'M') continue;
        let count = 0;
        for (let r = -1; r <= 1; r += 1) {
          for (let c = -1; c <= 1; c += 1) {
            if (r === 0 && c === 0) continue;
            const nr = row + r;
            const nc = col + c;
            if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols && board[nr][nc] === 'M') {
              count += 1;
            }
          }
        }
        board[row][col] = count;
      }
    }

    return board;
  }

  function initBoard() {
    state.board = createEmptyBoard(state.rows, state.cols);
    state.revealed = Array.from({ length: state.rows }, () => Array(state.cols).fill(false));
    state.flagged = Array.from({ length: state.rows }, () => Array(state.cols).fill(false));
    state.questionMarks = Array.from({ length: state.rows }, () => Array(state.cols).fill(false));
    state.gameStarted = false;
    state.gameOver = false;
    state.gameWon = false;
    state.paused = false;
    state.firstMoveDone = false;
    state.boardSeed = null;
    resetTimer();
    updateHud();
    renderBoard();
    hideOverlay();
  }

  function renderBoard() {
    boardEl.style.setProperty('--cols', state.cols);
    boardEl.innerHTML = '';
    const total = state.rows * state.cols;
    boardEl.style.setProperty('grid-template-columns', `repeat(${state.cols}, minmax(0, 1fr))`);
    for (let index = 0; index < total; index += 1) {
      const row = Math.floor(index / state.cols);
      const col = index % state.cols;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'minesweeper-cell';
      button.setAttribute('aria-label', `Cell ${row + 1}, ${col + 1}`);
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      const isRevealed = state.revealed[row][col];
      const isFlagged = state.flagged[row][col];
      const isQuestion = state.questionMarks[row][col];
      if (isRevealed) {
        button.classList.add('revealed');
        const value = state.board[row][col];
        if (value === 'M') {
          button.classList.add('mine');
          button.textContent = '💣';
        } else if (value > 0) {
          button.textContent = value;
          button.dataset.value = String(value);
        }
      } else if (isFlagged) {
        button.classList.add('flagged');
        button.textContent = '🚩';
      } else if (isQuestion) {
        button.classList.add('question');
        button.textContent = '?';
      }

      button.addEventListener('click', () => handleCellClick(row, col));
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        handleCellFlag(row, col);
      });
      button.addEventListener('touchstart', (event) => {
        if (event.touches.length > 1) return;
        const touchTimer = window.setTimeout(() => {
          event.preventDefault();
          handleCellFlag(row, col);
        }, 450);
        button.dataset.touchTimer = String(touchTimer);
      }, { passive: false });
      button.addEventListener('touchend', () => {
        const timer = Number(button.dataset.touchTimer || 0);
        if (timer) {
          window.clearTimeout(timer);
        }
      });
      boardEl.appendChild(button);
    }
  }

  function revealCell(row, col) {
    if (state.revealed[row][col] || state.flagged[row][col] || state.paused || state.gameOver || state.gameWon) return;
    if (!state.gameStarted) {
      state.gameStarted = true;
      state.firstMoveDone = true;
      state.board = generateBoard(row, col);
      startTimer();
      hideOverlay();
    }
    const value = state.board[row][col];
    if (value === 'M') {
      state.revealed[row][col] = true;
      state.gameOver = true;
      stopTimer();
      revealAllMines();
      updateStats(false);
      updateHud();
      showOverlay('Boom!', 'That mine exploded. Start another round and try again.');
      return;
    }

    floodReveal(row, col);
    checkWin();
    updateHud();
    saveState();
  }

  function floodReveal(row, col) {
    const stack = [[row, col]];
    while (stack.length) {
      const [currentRow, currentCol] = stack.pop();
      if (state.revealed[currentRow][currentCol]) continue;
      state.revealed[currentRow][currentCol] = true;
      const value = state.board[currentRow][currentCol];
      if (value !== 0) continue;
      for (let r = -1; r <= 1; r += 1) {
        for (let c = -1; c <= 1; c += 1) {
          if (r === 0 && c === 0) continue;
          const nr = currentRow + r;
          const nc = currentCol + c;
          if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
            if (!state.revealed[nr][nc] && !state.flagged[nr][nc]) {
              stack.push([nr, nc]);
            }
          }
        }
      }
    }
  }

  function handleCellClick(row, col) {
    if (state.paused || state.gameOver || state.gameWon) return;
    if (state.flagMode) {
      handleCellFlag(row, col);
      return;
    }
    revealCell(row, col);
    renderBoard();
  }

  function handleCellFlag(row, col) {
    if (state.paused || state.gameOver || state.gameWon) return;
    if (state.revealed[row][col]) return;
    if (state.questionMarks[row][col]) {
      state.questionMarks[row][col] = false;
      state.flagged[row][col] = false;
    } else if (state.flagged[row][col]) {
      state.flagged[row][col] = false;
      state.questionMarks[row][col] = true;
    } else {
      state.flagged[row][col] = true;
      state.questionMarks[row][col] = false;
    }
    updateHud();
    renderBoard();
    saveState();
  }

  function revealAllMines() {
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        if (state.board[row][col] === 'M') {
          state.revealed[row][col] = true;
        }
      }
    }
  }

  function checkWin() {
    const safeCells = state.rows * state.cols - state.mines;
    let revealedSafeCells = 0;
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        if (state.revealed[row][col] && state.board[row][col] !== 'M') {
          revealedSafeCells += 1;
        }
      }
    }
    if (revealedSafeCells === safeCells) {
      state.gameWon = true;
      state.gameOver = true;
      stopTimer();
      updateStats(true);
      updateHud();
      showOverlay('You win!', 'Every safe cell has been cleared.');
      launchConfetti();
    }
  }

  function updateStats(isWin) {
    state.stats.gamesPlayed = (state.stats.gamesPlayed || 0) + 1;
    if (isWin) {
      state.stats.gamesWon = (state.stats.gamesWon || 0) + 1;
      state.stats.currentStreak = (state.stats.currentStreak || 0) + 1;
      state.stats.longestStreak = Math.max(state.stats.longestStreak || 0, state.stats.currentStreak);
      const difficultyKey = state.difficulty === 'custom' ? `${state.rows}x${state.cols}` : state.difficulty;
      const bestTime = state.stats.bestTimes?.[difficultyKey];
      if (!bestTime || state.timer < bestTime) {
        state.stats.bestTimes = state.stats.bestTimes || {};
        state.stats.bestTimes[difficultyKey] = state.timer;
      }
      state.stats.totalCellsOpened = (state.stats.totalCellsOpened || 0) + countRevealedSafeCells();
    } else {
      state.stats.currentStreak = 0;
      state.stats.totalCellsOpened = (state.stats.totalCellsOpened || 0) + countRevealedSafeCells();
    }
    state.stats.winPercentage = state.stats.gamesPlayed ? Math.round((state.stats.gamesWon / state.stats.gamesPlayed) * 100) : 0;
    saveStats();
    saveState();
  }

  function countRevealedSafeCells() {
    let total = 0;
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        if (state.revealed[row][col] && state.board[row][col] !== 'M') {
          total += 1;
        }
      }
    }
    return total;
  }

  function launchConfetti() {
    const colors = ['#4f46e5', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6'];
    for (let index = 0; index < 22; index += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 240}px`);
      piece.style.animationDelay = `${Math.random() * 0.2}s`;
      confettiLayer.appendChild(piece);
      window.setTimeout(() => piece.remove(), 2400);
    }
  }

  function applyDifficulty(level, options = {}) {
    const preset = DIFFICULTIES[level];
    if (preset) {
      state.rows = preset.rows;
      state.cols = preset.cols;
      state.mines = preset.mines;
      state.difficulty = level;
      difficultySelectEl.value = level;
      customSettingsEl.hidden = true;
    } else {
      state.rows = clamp(Number(options.rows || 10), 4, 30);
      state.cols = clamp(Number(options.cols || 10), 4, 30);
      const maxMines = Math.max(1, Math.floor(state.rows * state.cols * 0.6));
      state.mines = clamp(Number(options.mines || 15), 1, maxMines);
      state.difficulty = 'custom';
      difficultySelectEl.value = 'custom';
      customSettingsEl.hidden = false;
    }
    initBoard();
  }

  function setupEventHandlers() {
    page.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'new-game') {
          applyDifficulty(state.difficulty === 'custom' ? 'custom' : state.difficulty, {
            rows: state.rows,
            cols: state.cols,
            mines: state.mines,
          });
        } else if (action === 'restart') {
          applyDifficulty(state.difficulty === 'custom' ? 'custom' : state.difficulty, {
            rows: state.rows,
            cols: state.cols,
            mines: state.mines,
          });
        } else if (action === 'pause') {
          state.paused = true;
          updateHud();
          showOverlay('Paused', 'Resume when you are ready.');
        } else if (action === 'resume') {
          state.paused = false;
          updateHud();
          hideOverlay();
        } else if (action === 'hint') {
          applyHint();
        } else if (action === 'apply-custom') {
          applyDifficulty('custom', {
            rows: customRowsEl.value,
            cols: customColsEl.value,
            mines: customMinesEl.value,
          });
        } else if (action === 'toggle-flag-mode') {
          state.flagMode = !state.flagMode;
          updateHud();
        }
      });
    });

    difficultySelectEl.addEventListener('change', (event) => {
      const value = event.target.value;
      if (value === 'custom') {
        customSettingsEl.hidden = false;
        return;
      }
      applyDifficulty(value);
    });

    window.addEventListener('beforeunload', saveState);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'f' || event.key === 'F') {
        state.flagMode = !state.flagMode;
        updateHud();
      }
      if (event.key === 'p' || event.key === 'P') {
        state.paused = !state.paused;
        updateHud();
        if (state.paused) showOverlay('Paused', 'Resume when you are ready.');
        else hideOverlay();
      }
    });
  }

  function applyHint() {
    if (state.paused || state.gameOver || state.gameWon) return;
    const cells = [];
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        if (!state.revealed[row][col] && !state.flagged[row][col]) {
          cells.push([row, col]);
        }
      }
    }
    if (!cells.length) return;
    const [row, col] = cells[Math.floor(Math.random() * cells.length)];
    const element = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (element) {
      element.classList.add('hint');
      window.setTimeout(() => element.classList.remove('hint'), 800);
    }
  }

  function initialize() {
    setupEventHandlers();
    const saved = loadSavedState();
    if (saved) {
      state.rows = saved.rows || state.rows;
      state.cols = saved.cols || state.cols;
      state.mines = saved.mines || state.mines;
      state.difficulty = saved.difficulty || state.difficulty;
      state.board = saved.board || [];
      state.revealed = saved.revealed || [];
      state.flagged = saved.flagged || [];
      state.questionMarks = saved.questionMarks || [];
      state.gameStarted = saved.gameStarted || false;
      state.gameOver = saved.gameOver || false;
      state.gameWon = saved.gameWon || false;
      state.paused = saved.paused || false;
      state.timer = saved.timer || 0;
      state.flagMode = saved.flagMode || false;
      state.firstMoveDone = saved.firstMoveDone || false;
      state.stats = saved.stats || state.stats;
      difficultySelectEl.value = state.difficulty;
      customSettingsEl.hidden = state.difficulty !== 'custom';
      if (state.difficulty === 'custom') {
        customRowsEl.value = state.rows;
        customColsEl.value = state.cols;
        customMinesEl.value = state.mines;
      }
    }
    if (!state.board.length) {
      applyDifficulty(state.difficulty === 'custom' ? 'custom' : state.difficulty, {
        rows: state.rows,
        cols: state.cols,
        mines: state.mines,
      });
    } else {
      renderBoard();
      if (state.gameStarted && !state.gameOver && !state.gameWon) {
        startTimer();
        if (state.paused) showOverlay('Paused', 'Resume when you are ready.');
      }
      updateHud();
    }
  }

  initialize();
})();
