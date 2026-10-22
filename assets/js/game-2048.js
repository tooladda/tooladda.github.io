const Game2048 = (() => {
  const STORAGE_STATE = 'tooladda-2048-state';
  const STORAGE_BEST = 'tooladda-2048-best';
  const BOARD_SIZE = 4;

  const state = {
    grid: [],
    score: 0,
    best: 0,
    moves: 0,
    time: 0,
    hasWon: false,
    gameOver: false,
    undoState: null,
    isBusy: false,
  };

  const elements = {};
  let timerInterval = null;
  let touchStartX = 0;
  let touchStartY = 0;

  const createEmptyGrid = () => Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));

  const deepCopyGrid = (grid) => grid.map((row) => [...row]);

  const loadBest = () => {
    const saved = Number(localStorage.getItem(STORAGE_BEST));
    if (!Number.isNaN(saved)) {
      state.best = saved;
    }
  };

  const saveBest = () => {
    localStorage.setItem(STORAGE_BEST, String(state.best));
  };

  const saveState = () => {
    const gameState = {
      grid: state.grid,
      score: state.score,
      moves: state.moves,
      time: state.time,
      hasWon: state.hasWon,
      gameOver: state.gameOver,
      undoState: state.undoState,
    };
    localStorage.setItem(STORAGE_STATE, JSON.stringify(gameState));
  };

  const loadSavedState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_STATE);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (saved?.grid) {
        state.grid = saved.grid;
        state.score = saved.score ?? 0;
        state.moves = saved.moves ?? 0;
        state.time = saved.time ?? 0;
        state.hasWon = saved.hasWon ?? false;
        state.gameOver = saved.gameOver ?? false;
        state.undoState = saved.undoState ?? null;
        return true;
      }
    } catch (error) {
      // ignore corrupt saved state
    }
    return false;
  };

  const formatTime = (seconds) => {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    const rest = String(seconds % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  };

  const getStatusMessage = () => {
    if (state.gameOver) {
      return 'Game over. Start a new game or restart to try again.';
    }
    if (state.hasWon) {
      return 'You reached 2048! Continue to chase a higher score.';
    }
    return 'Use arrow keys, WASD, or swipe to move tiles.';
  };

  const getHighestTile = () => {
    let highest = 0;
    state.grid.forEach((row) => {
      row.forEach((value) => {
        if (value > highest) highest = value;
      });
    });
    return highest;
  };

  const updateProgress = () => {
    const highest = getHighestTile();
    if (elements.highest) {
      elements.highest.textContent = highest || '—';
    }
    if (elements.progressBar) {
      const progress = highest >= 2048 ? 100 : (Math.log2(Math.max(highest, 1)) / 11) * 100;
      elements.progressBar.style.width = `${Math.min(100, Math.max(4, progress))}%`;
    }
    if (elements.progressLabel) {
      if (highest >= 2048) {
        elements.progressLabel.textContent = '2048 reached — keep going!';
      } else if (highest <= 0) {
        elements.progressLabel.textContent = 'Goal: reach the 2048 tile';
      } else {
        elements.progressLabel.textContent = `Highest: ${highest} · Next: ${highest * 2}`;
      }
    }
  };

  const setTimerDisplay = () => {
    const formatted = formatTime(state.time);
    elements.timers.forEach((node) => {
      node.textContent = formatted;
    });
  };

  const updateStats = () => {
    elements.score.textContent = state.score;
    elements.best.textContent = state.best;
    elements.moves.textContent = state.moves;
    setTimerDisplay();
    elements.status.textContent = getStatusMessage();
    elements.undoButton.disabled = !state.undoState || state.gameOver;
    updateProgress();
  };

  const getEmptyCells = () => {
    const locations = [];
    state.grid.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        if (value === 0) {
          locations.push({ row: rowIndex, col: colIndex });
        }
      });
    });
    return locations;
  };

  const spawnRandomTile = () => {
    const empty = getEmptyCells();
    if (!empty.length) return;
    const index = Math.floor(Math.random() * empty.length);
    const value = Math.random() < 0.9 ? 2 : 4;
    const { row, col } = empty[index];
    state.grid[row][col] = value;
    renderGrid({ animateNew: true });
  };

  const transpose = (grid) => grid[0].map((_, colIndex) => grid.map((row) => row[colIndex]));

  const reverseRows = (grid) => grid.map((row) => [...row].reverse());

  const collapseRow = (row) => {
    const filtered = row.filter((n) => n !== 0);
    const merged = [];
    let scoreGain = 0;

    for (let i = 0; i < filtered.length; i += 1) {
      if (filtered[i] === filtered[i + 1]) {
        const doubled = filtered[i] * 2;
        merged.push(doubled);
        scoreGain += doubled;
        i += 1;
      } else {
        merged.push(filtered[i]);
      }
    }

    while (merged.length < BOARD_SIZE) {
      merged.push(0);
    }

    const moved = merged.some((value, index) => value !== row[index]);
    return { row: merged, moved, scoreGain };
  };

  const moveLeft = () => {
    let moved = false;
    let scoreGain = 0;
    const newGrid = state.grid.map((row) => {
      const { row: collapsed, moved: rowMoved, scoreGain: rowScore } = collapseRow(row);
      if (rowMoved) moved = true;
      scoreGain += rowScore;
      return collapsed;
    });
    if (moved) {
      state.grid = newGrid;
      state.score += scoreGain;
    }
    return moved;
  };

  const moveRight = () => {
    state.grid = reverseRows(state.grid);
    const moved = moveLeft();
    state.grid = reverseRows(state.grid);
    return moved;
  };

  const moveUp = () => {
    state.grid = transpose(state.grid);
    const moved = moveLeft();
    state.grid = transpose(state.grid);
    return moved;
  };

  const moveDown = () => {
    state.grid = transpose(state.grid);
    const moved = moveRight();
    state.grid = transpose(state.grid);
    return moved;
  };

  const canMove = () => {
    if (getEmptyCells().length > 0) return true;
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const value = state.grid[row][col];
        const right = col < BOARD_SIZE - 1 ? state.grid[row][col + 1] : null;
        const down = row < BOARD_SIZE - 1 ? state.grid[row + 1][col] : null;
        if (value === right || value === down) return true;
      }
    }
    return false;
  };

  const saveUndo = () => {
    state.undoState = {
      grid: deepCopyGrid(state.grid),
      score: state.score,
      moves: state.moves,
      time: state.time,
      hasWon: state.hasWon,
      gameOver: state.gameOver,
    };
  };

  const launchConfetti = () => {
    if (!elements.confettiLayer) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const colors = ['#818cf8', '#a78bfa', '#34d399', '#fb7185', '#fbbf24'];

    for (let index = 0; index < 18; index += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.top = '0px';
      piece.style.background = colors[index % colors.length];
      piece.style.setProperty('--x', `${(Math.random() - 0.5) * 180}px`);
      piece.style.animationDelay = `${Math.random() * 80}ms`;
      fragment.appendChild(piece);
    }

    elements.confettiLayer.appendChild(fragment);
    window.setTimeout(() => {
      elements.confettiLayer.innerHTML = '';
    }, 1400);
  };

  const undoMove = () => {
    if (!state.undoState) return;
    state.grid = deepCopyGrid(state.undoState.grid);
    state.score = state.undoState.score;
    state.moves = state.undoState.moves;
    state.time = state.undoState.time;
    state.hasWon = state.undoState.hasWon;
    state.gameOver = state.undoState.gameOver;
    state.undoState = null;
    startTimer();
    updateStats();
    renderGrid();
    saveState();
  };

  const handleWin = () => {
    state.hasWon = true;
    updateStats();
    showOverlay('2048 reached!', 'You can keep playing to chase a higher score.', true);
    launchConfetti();
    startCelebration();
    saveState();
  };

  const handleGameOver = () => {
    state.gameOver = true;
    updateStats();
    showOverlay('Game Over', 'No more moves available. Start a new game or restart.', false);
    stopTimer();
    saveState();
  };

  const updateBestScore = () => {
    if (state.score > state.best) {
      state.best = state.score;
      saveBest();
    }
  };

  const spawnTileAfterMove = () => {
    spawnRandomTile();
    if (state.score > state.best) {
      updateBestScore();
    }
    state.moves += 1;
    saveState();
  };

  const performMove = (direction) => {
    if (state.isBusy || state.gameOver) return;
    state.isBusy = true;
    saveUndo();
    let moved = false;

    if (direction === 'left') moved = moveLeft();
    if (direction === 'right') moved = moveRight();
    if (direction === 'up') moved = moveUp();
    if (direction === 'down') moved = moveDown();

    if (!moved) {
      state.undoState = null;
      state.isBusy = false;
      return;
    }

    spawnTileAfterMove();
    updateStats();

    if (state.grid.some((row) => row.includes(2048)) && !state.hasWon) {
      handleWin();
      state.isBusy = false;
      return;
    }

    if (!canMove()) {
      handleGameOver();
    }

    window.setTimeout(() => {
      state.isBusy = false;
    }, 140);
  };

  const renderGrid = (options = {}) => {
    const { animateNew = false } = options;
    elements.grid.innerHTML = '';
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const value = state.grid[row][col];
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('aria-label', value ? `Tile ${value}` : 'Empty cell');
        if (value) {
          const tile = document.createElement('div');
          tile.className = `tile tile-${value}`;
          if (animateNew) {
            tile.classList.add('tile-new');
          }
          tile.textContent = value;
          cell.appendChild(tile);
        }
        elements.grid.appendChild(cell);
      }
    }
  };

  const showOverlay = (title, text, canContinue) => {
    elements.overlay.classList.remove('hidden');
    elements.overlayTitle.textContent = title;
    elements.overlayText.textContent = text;
    elements.continueButton.disabled = !canContinue;
    elements.continueButton.style.display = canContinue ? 'inline-flex' : 'none';
  };

  const hideOverlay = () => {
    elements.overlay.classList.add('hidden');
  };

  const startTimer = () => {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      if (!state.gameOver) {
        state.time += 1;
        setTimerDisplay();
        saveState();
      }
    }, 1000);
  };

  const stopTimer = () => {
    clearInterval(timerInterval);
    timerInterval = null;
  };

  const startCelebration = () => {
    const originalText = elements.status.textContent;
    elements.status.textContent = '🎉 You reached 2048! Keep going...';
    setTimeout(() => {
      elements.status.textContent = originalText;
    }, 2500);
  };

  const resetGame = (clearBest = false) => {
    if (state.moves > 0 && !window.confirm('Start a fresh game? Your current progress will be lost.')) {
      return;
    }

    state.grid = createEmptyGrid();
    state.score = 0;
    state.moves = 0;
    state.time = 0;
    state.hasWon = false;
    state.gameOver = false;
    state.undoState = null;
    state.isBusy = false;
    if (clearBest) {
      state.best = 0;
      saveBest();
    }
    elements.status.textContent = 'Use arrow keys, WASD, or swipe to move tiles.';
    hideOverlay();
    renderGrid();
    updateStats();
    spawnRandomTile();
    spawnRandomTile();
    saveState();
    startTimer();
  };

  const newGame = () => {
    resetGame();
  };

  const restartGame = () => {
    resetGame();
  };

  const bindEvents = () => {
    elements.newButton.addEventListener('click', newGame);
    elements.restartButton.addEventListener('click', restartGame);
    elements.undoButton.addEventListener('click', () => {
      undoMove();
      elements.status.textContent = 'Undid the last move.';
      window.setTimeout(() => {
        elements.status.textContent = getStatusMessage();
      }, 1200);
    });
    elements.continueButton.addEventListener('click', () => {
      hideOverlay();
      state.gameOver = false;
      updateStats();
      saveState();
    });
    elements.overlayNewButton.addEventListener('click', newGame);

    document.querySelectorAll('[data-move]').forEach((button) => {
      button.addEventListener('click', () => {
        performMove(button.dataset.move);
        if (navigator.vibrate) navigator.vibrate(12);
      });
    });

    window.addEventListener('keydown', (event) => {
      const directionMap = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        W: 'up',
        s: 'down',
        S: 'down',
        a: 'left',
        A: 'left',
        d: 'right',
        D: 'right',
      };
      if (directionMap[event.key]) {
        event.preventDefault();
        performMove(directionMap[event.key]);
      }
    });

    const touchTarget = elements.gameBoard || elements.grid;
    touchTarget.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { passive: false });

    touchTarget.addEventListener('touchmove', (event) => {
      event.preventDefault();
    }, { passive: false });

    touchTarget.addEventListener('touchend', (event) => {
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < 40) return;

      if (absX > absY) {
        performMove(dx > 0 ? 'right' : 'left');
      } else {
        performMove(dy > 0 ? 'down' : 'up');
      }
    }, { passive: false });
  };

  const hydrateElements = () => {
    elements.grid = document.querySelector('[data-grid]');
    elements.gameBoard = document.querySelector('[data-game-board]');
    elements.score = document.querySelector('[data-score]');
    elements.best = document.querySelector('[data-best]');
    elements.moves = document.querySelector('[data-moves]');
    elements.timers = document.querySelectorAll('[data-timer]');
    elements.status = document.querySelector('[data-status]');
    elements.newButton = document.querySelector('[data-new-btn]');
    elements.restartButton = document.querySelector('[data-restart-btn]');
    elements.undoButton = document.querySelector('[data-undo-btn]');
    elements.overlay = document.querySelector('[data-overlay]');
    elements.overlayTitle = document.querySelector('[data-overlay-title]');
    elements.overlayText = document.querySelector('[data-overlay-text]');
    elements.continueButton = document.querySelector('[data-continue-btn]');
    elements.overlayNewButton = document.querySelector('[data-overlay-new-btn]');
    elements.confettiLayer = document.querySelector('[data-confetti-layer]');
    elements.highest = document.querySelector('[data-highest]');
    elements.progressBar = document.querySelector('[data-progress-bar]');
    elements.progressLabel = document.querySelector('[data-progress-label]');
  };

  const initialize = () => {
    hydrateElements();
    loadBest();
    const loaded = loadSavedState();
    if (!loaded) {
      state.grid = createEmptyGrid();
      spawnRandomTile();
      spawnRandomTile();
    }
    renderGrid();
    updateStats();
    bindEvents();
    startTimer();
  };

  return { initialize };
})();

document.addEventListener('DOMContentLoaded', () => Game2048.initialize());
