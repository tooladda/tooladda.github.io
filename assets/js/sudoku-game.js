const SudokuGame = (() => {
  const hasDom = typeof document !== 'undefined';
  const STORAGE_KEY = 'tooladda-sudoku-state';
  const STATS_KEY = 'tooladda-sudoku-stats';
  const boardElement = hasDom ? document.querySelector('[data-board]') : null;
  const difficultySelect = hasDom ? document.querySelector('[data-difficulty-select]') : null;
  const newGameButton = hasDom ? document.querySelector('[data-new-game-btn]') : null;
  const restartButton = hasDom ? document.querySelector('[data-restart-btn]') : null;
  const pauseButton = hasDom ? document.querySelector('[data-pause-btn]') : null;
  const undoButton = hasDom ? document.querySelector('[data-undo-btn]') : null;
  const redoButton = hasDom ? document.querySelector('[data-redo-btn]') : null;
  const checkButton = hasDom ? document.querySelector('[data-check-btn]') : null;
  const validateButton = hasDom ? document.querySelector('[data-validate-btn]') : null;
  const solveButton = hasDom ? document.querySelector('[data-solve-btn]') : null;
  const noteToggleButton = hasDom ? document.querySelector('[data-note-toggle]') : null;
  const eraseButton = hasDom ? document.querySelector('[data-erase-btn]') : null;
  const hintButton = hasDom ? document.querySelector('[data-hint-btn]') : null;
  const timerText = hasDom ? document.querySelector('[data-timer]') : null;
  const bestTimeText = hasDom ? document.querySelector('[data-best-time]') : null;
  const movesText = hasDom ? document.querySelector('[data-moves]') : null;
  const mistakesText = hasDom ? document.querySelector('[data-mistakes]') : null;
  const gamesPlayedText = hasDom ? document.querySelector('[data-games-played]') : null;
  const gamesWonText = hasDom ? document.querySelector('[data-games-won]') : null;
  const winRateText = hasDom ? document.querySelector('[data-win-rate]') : null;
  const modeButtons = hasDom ? Array.from(document.querySelectorAll('[data-mode-btn]')) : [];
  const modeLabel = hasDom ? document.querySelector('[data-mode-label]') : null;
  const difficultyLabel = hasDom ? document.querySelector('[data-difficulty-label]') : null;
  const statusText = hasDom ? document.querySelector('[data-status-text]') : null;
  const overlay = hasDom ? document.querySelector('[data-overlay]') : null;
  const overlayTitle = hasDom ? document.querySelector('[data-overlay-title]') : null;
  const overlayMessage = hasDom ? document.querySelector('[data-overlay-message]') : null;
  const overlayAction = hasDom ? document.querySelector('[data-overlay-action]') : null;
  const confettiBox = hasDom ? document.querySelector('[data-confetti]') : null;
  const dailyDateText = hasDom ? document.querySelector('[data-daily-date]') : null;

  const size = 9;
  const boxSize = 3;
  const difficulties = {
    easy: 30,
    medium: 38,
    hard: 46,
    expert: 54,
  };

  let selectedCell = null;
  let lastPlacedCell = null;
  let notesMode = false;
  let isPaused = false;
  let isGameOver = false;
  let activeNumber = null;
  let timerInterval = null;
  let elapsedSeconds = 0;
  let moves = 0;
  let mistakes = 0;
  let gameMode = 'random';
  let activeDifficulty = 'medium';
  let board = [];
  let solution = [];
  let originalBoard = [];
  let notes = [];
  let history = [];
  let future = [];
  let stats = {
    gamesPlayed: 0,
    gamesWon: 0,
    bestTime: null,
  };

  const cloneBoard = (value) => value.map((row) => [...row]);

  const createEmptyBoard = () => Array.from({ length: size }, () => Array(size).fill(0));

  const cloneNotesBoard = (value) => value.map((row) => (Array.isArray(row) ? row.map((cell) => (Array.isArray(cell) ? [...cell] : [])) : []));

  const shuffleValues = (values, random = Math.random) => {
    const array = [...values];
    for (let index = array.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(random() * (index + 1));
      [array[index], array[randomIndex]] = [array[randomIndex], array[index]];
    }
    return array;
  };

  const isSafe = (boardState, row, col, value) => {
    for (let index = 0; index < size; index += 1) {
      if (boardState[row][index] === value || boardState[index][col] === value) {
        return false;
      }
    }

    const boxRow = Math.floor(row / boxSize) * boxSize;
    const boxCol = Math.floor(col / boxSize) * boxSize;
    for (let rowIndex = boxRow; rowIndex < boxRow + boxSize; rowIndex += 1) {
      for (let colIndex = boxCol; colIndex < boxCol + boxSize; colIndex += 1) {
        if (boardState[rowIndex][colIndex] === value) {
          return false;
        }
      }
    }
    return true;
  };

  const findEmptyCell = (boardState) => {
    let bestCell = null;
    let bestCandidates = null;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (boardState[row][col] !== 0) continue;
        const candidates = [];
        for (let value = 1; value <= size; value += 1) {
          if (isSafe(boardState, row, col, value)) {
            candidates.push(value);
          }
        }
        if (bestCandidates === null || candidates.length < bestCandidates.length) {
          bestCell = { row, col };
          bestCandidates = candidates;
          if (candidates.length === 1) return { row, col, candidates };
        }
      }
    }
    return bestCell ? { ...bestCell, candidates: bestCandidates } : null;
  };

  // Plain backtracking has no worst-case bound: an unlucky candidate order on
  // certain inputs (especially self-contradictory ones, since nothing here
  // checks whether pre-filled givens already conflict) can blow up
  // combinatorially and freeze the tab, since this runs synchronously on the
  // main thread. Both solvers cap total attempts and bail out safely.
  const SEARCH_BUDGET = 200000;

  const solveSudoku = (boardState) => {
    let attempts = 0;
    const attempt = (state) => {
      attempts += 1;
      if (attempts > SEARCH_BUDGET) return false;
      const emptyCell = findEmptyCell(state);
      if (!emptyCell) return true;
      const values = shuffleValues(emptyCell.candidates || [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const value of values) {
        if (isSafe(state, emptyCell.row, emptyCell.col, value)) {
          state[emptyCell.row][emptyCell.col] = value;
          if (attempt(state)) return true;
          state[emptyCell.row][emptyCell.col] = 0;
        }
        if (attempts > SEARCH_BUDGET) return false;
      }
      return false;
    };
    return attempt(boardState);
  };

  // Returns -1 (instead of a count) if the search budget runs out before the
  // answer is certain. Callers checking `=== 1` for uniqueness must treat -1
  // as "not confirmed unique" — never silently accept an unverified puzzle.
  const countSolutions = (boardState, limit = 2) => {
    let solutions = 0;
    let attempts = 0;
    let aborted = false;
    const search = (state) => {
      if (solutions >= limit || aborted) return;
      attempts += 1;
      if (attempts > SEARCH_BUDGET) { aborted = true; return; }
      const emptyCell = findEmptyCell(state);
      if (!emptyCell) {
        solutions += 1;
        return;
      }
      const values = shuffleValues(emptyCell.candidates || [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const value of values) {
        if (isSafe(state, emptyCell.row, emptyCell.col, value)) {
          state[emptyCell.row][emptyCell.col] = value;
          search(state);
          state[emptyCell.row][emptyCell.col] = 0;
          if (solutions >= limit || aborted) return;
        }
      }
    };
    search(boardState);
    return aborted ? -1 : solutions;
  };

  // Permutes 0..8 while preserving Sudoku validity: the 3 bands (groups of 3
  // rows or columns) are shuffled as whole units, and the 3 lines within each
  // band are shuffled among themselves — never across band boundaries. A
  // fully free permutation of all 9 lines would break the 3x3 box constraint.
  const permuteWithinBands = (random) => shuffleValues([0, 1, 2], random)
    .reduce((order, band) => order.concat(shuffleValues([0, 1, 2], random).map((offset) => band * boxSize + offset)), []);

  const generateSolvedBoard = (seed = Date.now()) => {
    const base = createEmptyBoard();
    const pattern = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const random = createSeededRandom(seed);
    const shuffledPattern = shuffleValues(pattern, random);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        base[row][col] = shuffledPattern[(row * 3 + Math.floor(row / 3) + col) % 9];
      }
    }
    const solvedBoard = cloneBoard(base);
    const rowOrder = permuteWithinBands(random);
    const colOrder = permuteWithinBands(random);
    const transformed = createEmptyBoard();
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        transformed[row][col] = solvedBoard[rowOrder[row]][colOrder[col]];
      }
    }
    return cloneBoard(transformed);
  };

  const createSeededRandom = (seed) => {
    let state = 0;
    const text = String(seed);
    for (let index = 0; index < text.length; index += 1) {
      state = (state * 31 + text.charCodeAt(index)) >>> 0;
    }
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };

  const generatePuzzle = (difficulty, seed = Date.now()) => {
    const solution = generateSolvedBoard(seed);
    const puzzle = cloneBoard(solution);
    const cellsToRemove = difficulties[difficulty] || difficulties.medium;
    const positions = shuffleValues(Array.from({ length: 81 }, (_, index) => ({ row: Math.floor(index / 9), col: index % 9 })), createSeededRandom(seed + 17));
    let removed = 0;
    for (const position of positions) {
      if (removed >= cellsToRemove) break;
      const value = puzzle[position.row][position.col];
      puzzle[position.row][position.col] = 0;
      if (countSolutions(cloneBoard(puzzle)) !== 1) {
        puzzle[position.row][position.col] = value;
      } else {
        removed += 1;
      }
    }
    return { puzzle, solution };
  };

  const dailyKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  };

  const saveState = () => {
    const payload = {
      board: cloneBoard(board),
      originalBoard: cloneBoard(originalBoard),
      solution: cloneBoard(solution),
      notes: cloneNotesBoard(notes),
      moves,
      mistakes,
      elapsedSeconds,
      selectedCell,
      notesMode,
      gameMode,
      activeDifficulty,
      isGameOver,
      history: history.slice(-40),
      future: future.slice(-20),
      stats,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  };

  const loadState = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const loadStats = () => {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const updateStatsDisplay = () => {
    timerText.textContent = formatTime(elapsedSeconds);
    bestTimeText.textContent = stats.bestTime ? formatTime(stats.bestTime) : '—';
    movesText.textContent = String(moves);
    mistakesText.textContent = String(mistakes);
    gamesPlayedText.textContent = String(stats.gamesPlayed);
    gamesWonText.textContent = String(stats.gamesWon);
    const winRate = stats.gamesPlayed ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
    winRateText.textContent = `${winRate}%`;
  };

  const formatTime = (seconds) => {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    const rest = String(seconds % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  };

  const renderBoard = () => {
    if (!boardElement) return;
    boardElement.innerHTML = '';
    board.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        const cellButton = document.createElement('button');
        cellButton.type = 'button';
        cellButton.className = 'cell-btn';
        cellButton.dataset.row = String(rowIndex);
        cellButton.dataset.col = String(colIndex);
        cellButton.setAttribute('role', 'gridcell');
        cellButton.setAttribute('aria-label', `Row ${rowIndex + 1}, Column ${colIndex + 1}`);
        if (originalBoard[rowIndex][colIndex] !== 0) {
          cellButton.classList.add('given');
        }
        if (selectedCell && selectedCell.row === rowIndex && selectedCell.col === colIndex) {
          cellButton.classList.add('selected');
        }
        if (selectedCell && selectedCell.row === rowIndex) {
          cellButton.classList.add('highlight-row');
        }
        if (selectedCell && selectedCell.col === colIndex) {
          cellButton.classList.add('highlight-col');
        }
        if (selectedCell && Math.floor(selectedCell.row / 3) === Math.floor(rowIndex / 3) && Math.floor(selectedCell.col / 3) === Math.floor(colIndex / 3)) {
          cellButton.classList.add('highlight-box');
        }
        const selectedValue = selectedCell ? board[selectedCell.row][selectedCell.col] : 0;
        if (value !== 0 && ((selectedValue !== 0 && value === selectedValue) || value === activeNumber)) {
          cellButton.classList.add('same-value');
        }
        if (value !== 0 && originalBoard[rowIndex][colIndex] === 0 && value !== solution[rowIndex][colIndex]) {
          cellButton.classList.add('error');
          cellButton.setAttribute('aria-invalid', 'true');
        }
        if (lastPlacedCell && lastPlacedCell.row === rowIndex && lastPlacedCell.col === colIndex) {
          cellButton.classList.add('just-placed');
        }
        if (value === 0 && notes[rowIndex][colIndex] && notes[rowIndex][colIndex].length) {
          const noteContainer = document.createElement('div');
          noteContainer.className = 'notes-grid';
          notes[rowIndex][colIndex].forEach((noteValue) => {
            const noteItem = document.createElement('span');
            noteItem.className = 'note-item';
            noteItem.textContent = String(noteValue);
            noteContainer.appendChild(noteItem);
          });
          cellButton.appendChild(noteContainer);
        } else if (value !== 0) {
          cellButton.textContent = String(value);
        }
        if ((colIndex + 1) % 3 === 0 && colIndex < 8) {
          cellButton.classList.add('border-right');
        }
        if ((rowIndex + 1) % 3 === 0 && rowIndex < 8) {
          cellButton.classList.add('border-bottom');
        }
        cellButton.addEventListener('click', () => selectCell(rowIndex, colIndex));
        boardElement.appendChild(cellButton);
      });
    });
    if (selectedCell) {
      const activeButton = boardElement.querySelector(`[data-row="${selectedCell.row}"][data-col="${selectedCell.col}"]`);
      if (activeButton) activeButton.focus({ preventScroll: true });
    }
    lastPlacedCell = null;
    updateStatsDisplay();
  };

  const startTimer = () => {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = window.setInterval(() => {
      if (!isPaused) {
        elapsedSeconds += 1;
        updateStatsDisplay();
        saveState();
      }
    }, 1000);
  };

  const stopTimer = () => {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  };

  const updateStatus = (message) => {
    if (statusText) statusText.textContent = message;
  };

  const setMode = (mode) => {
    gameMode = mode;
    modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.modeBtn === mode));
    if (modeLabel) modeLabel.textContent = mode === 'daily' ? 'Daily' : mode === 'continue' ? 'Continue' : 'Random';
    if (dailyDateText) {
      dailyDateText.textContent = mode === 'daily'
        ? new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : '';
    }
  };

  const setDifficulty = (difficulty) => {
    activeDifficulty = difficulty;
    if (difficultyLabel) difficultyLabel.textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  };

  const clearActiveNumber = () => {
    activeNumber = null;
    document.querySelectorAll('[data-number-btn]').forEach((button) => button.classList.remove('active'));
  };

  const resetGameState = () => {
    selectedCell = null;
    notesMode = false;
    isPaused = false;
    isGameOver = false;
    moves = 0;
    mistakes = 0;
    elapsedSeconds = 0;
    history = [];
    future = [];
    updateStatus('New puzzle loaded');
    if (noteToggleButton) noteToggleButton.classList.remove('active');
    clearActiveNumber();
  };

  const startNewGame = (difficulty = activeDifficulty, mode = gameMode) => {
    if (mode === 'continue') {
      const saved = loadState();
      if (saved && saved.board && saved.originalBoard && saved.solution) {
        board = cloneBoard(saved.board);
        originalBoard = cloneBoard(saved.originalBoard);
        solution = cloneBoard(saved.solution);
        notes = loadSavedNotes(saved.notes);
        moves = saved.moves || 0;
        mistakes = saved.mistakes || 0;
        elapsedSeconds = saved.elapsedSeconds || 0;
        selectedCell = saved.selectedCell || null;
        notesMode = Boolean(saved.notesMode);
        isGameOver = Boolean(saved.isGameOver);
        history = saved.history || [];
        future = saved.future || [];
        stats = saved.stats || stats;
        setMode(mode);
        setDifficulty(difficulty);
        clearActiveNumber();
        renderBoard();
        if (!isGameOver) startTimer();
        updateStatsDisplay();
        if (overlay) overlay.classList.add('hidden');
        if (noteToggleButton && notesMode) noteToggleButton.classList.add('active');
        return;
      }
      updateStatus('No saved game found. Starting a fresh puzzle.');
    }

    resetGameState();
    const seed = mode === 'daily' ? `${dailyKey()}-${difficulty}` : Date.now();
    const generated = generatePuzzle(difficulty, seed);
    board = cloneBoard(generated.puzzle);
    solution = cloneBoard(generated.solution);
    originalBoard = cloneBoard(generated.puzzle);
    notes = createEmptyBoard().map((row) => row.map(() => []));
    setMode(mode);
    setDifficulty(difficulty);
    renderBoard();
    startTimer();
    updateStatsDisplay();
    saveState();
    if (overlay) overlay.classList.add('hidden');
    stats.gamesPlayed += 1;
    saveState();
  };

  const restartGame = () => {
    board = cloneBoard(originalBoard);
    notes = createEmptyBoard().map((row) => row.map(() => []));
    moves = 0;
    mistakes = 0;
    elapsedSeconds = 0;
    selectedCell = null;
    isGameOver = false;
    isPaused = false;
    history = [];
    future = [];
    clearActiveNumber();
    renderBoard();
    startTimer();
    updateStatsDisplay();
    saveState();
    if (overlay) overlay.classList.add('hidden');
  };

  const selectCell = (row, col) => {
    if (isPaused || isGameOver) return;
    selectedCell = { row, col };
    renderBoard();
  };

  const applyValue = (value) => {
    if (isPaused || isGameOver) return;
    if (!selectedCell) return;
    const { row, col } = selectedCell;
    if (originalBoard[row][col] !== 0) return;
    if (notesMode && board[row][col] !== 0) {
      updateStatus('Erase this cell’s value before adding notes');
      return;
    }
    const previousState = { board: cloneBoard(board), notes: cloneNotesBoard(notes), moves, mistakes, elapsedSeconds };
    history.push(previousState);
    future = [];
    if (notesMode) {
      const existing = notes[row][col];
      if (existing.includes(value)) {
        notes[row][col] = existing.filter((item) => item !== value);
      } else {
        notes[row][col] = [...existing, value].sort((a, b) => a - b);
      }
    } else {
      if (board[row][col] === value) {
        board[row][col] = 0;
      } else {
        lastPlacedCell = { row, col };
        if (value === solution[row][col]) {
          board[row][col] = value;
          notes[row][col] = [];
          moves += 1;
          updateStatus('Correct move');
        } else {
          board[row][col] = value;
          notes[row][col] = [];
          mistakes += 1;
          moves += 1;
          updateStatus('Mistake detected');
        }
      }
    }
    renderBoard();
    saveState();
    checkCompletion();
  };

  const eraseCell = () => {
    if (isPaused || isGameOver) return;
    if (!selectedCell) return;
    const { row, col } = selectedCell;
    if (originalBoard[row][col] !== 0) return;
    const previousState = { board: cloneBoard(board), notes: cloneNotesBoard(notes), moves, mistakes, elapsedSeconds };
    history.push(previousState);
    future = [];
    board[row][col] = 0;
    notes[row][col] = [];
    renderBoard();
    saveState();
  };

  const undoMove = () => {
    if (!history.length) return;
    const previousState = history.pop();
    future.push({ board: cloneBoard(board), notes: cloneNotesBoard(notes), moves, mistakes, elapsedSeconds });
    board = cloneBoard(previousState.board);
    notes = cloneNotesBoard(previousState.notes);
    moves = previousState.moves;
    mistakes = previousState.mistakes;
    elapsedSeconds = previousState.elapsedSeconds;
    renderBoard();
    saveState();
  };

  const redoMove = () => {
    if (!future.length) return;
    const nextState = future.pop();
    history.push({ board: cloneBoard(board), notes: cloneNotesBoard(notes), moves, mistakes, elapsedSeconds });
    board = cloneBoard(nextState.board);
    notes = cloneNotesBoard(nextState.notes);
    moves = nextState.moves;
    mistakes = nextState.mistakes;
    elapsedSeconds = nextState.elapsedSeconds;
    renderBoard();
    saveState();
  };

  const validateBoard = () => {
    const rowsValid = board.every((row) => row.every((value) => value === 0 || (value >= 1 && value <= 9)));
    const columnsValid = Array.from({ length: size }, (_, index) => board.map((row) => row[index]));
    const boxesValid = Array.from({ length: size }, (_, index) => {
      const boxRow = Math.floor(index / 3) * 3;
      const boxCol = (index % 3) * 3;
      return Array.from({ length: 9 }, (_, offset) => board[boxRow + Math.floor(offset / 3)][boxCol + (offset % 3)]);
    });
    const valid = rowsValid && columnsValid.every((column) => new Set(column.filter(Boolean)).size === column.filter(Boolean).length) && boxesValid.every((box) => new Set(box.filter(Boolean)).size === box.filter(Boolean).length);
    if (valid) {
      updateStatus('Board structure looks valid');
    } else {
      updateStatus('Board has conflicts');
    }
  };

  const checkMove = () => {
    if (!selectedCell) {
      updateStatus('Select a cell first to check it');
      return;
    }
    const { row, col } = selectedCell;
    if (originalBoard[row][col] !== 0) {
      updateStatus('That is a given clue — it is always correct');
      return;
    }
    const value = board[row][col];
    if (value === 0) {
      updateStatus('That cell is empty — fill it in first');
      return;
    }
    updateStatus(value === solution[row][col] ? 'That entry is correct' : 'That entry is incorrect');
  };

  const checkCompletion = () => {
    const solved = board.every((row, rowIndex) => row.every((value, colIndex) => value === solution[rowIndex][colIndex]));
    if (solved) {
      isGameOver = true;
      stopTimer();
      stats.gamesWon += 1;
      if (!stats.bestTime || elapsedSeconds < stats.bestTime) {
        stats.bestTime = elapsedSeconds;
      }
      saveState();
      updateStatsDisplay();
      updateStatus('Puzzle solved! Great work');
      showWinScreen();
    }
  };

  const showWinScreen = () => {
    if (overlayTitle) overlayTitle.textContent = '🏆 You solved it!';
    if (overlayMessage) overlayMessage.textContent = `Solved in ${formatTime(elapsedSeconds)} with ${moves} moves and ${mistakes} mistake${mistakes === 1 ? '' : 's'}.`;
    if (overlayAction) overlayAction.textContent = 'Play again';
    if (overlay) overlay.classList.remove('hidden');
    spawnConfetti();
  };

  const spawnConfetti = () => {
    if (!confettiBox) return;
    confettiBox.innerHTML = '';
    confettiBox.classList.remove('hidden');
    for (let index = 0; index < 32; index += 1) {
      const piece = document.createElement('span');
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = ['#4f46e5', '#22c55e', '#f59e0b', '#f43f5e'][index % 4];
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 220}px`);
      piece.style.animationDelay = `${Math.random() * 0.2}s`;
      confettiBox.appendChild(piece);
    }
    window.setTimeout(() => confettiBox.classList.add('hidden'), 2200);
  };

  const useHint = () => {
    if (isPaused || isGameOver) return;
    if (!selectedCell) return;
    const { row, col } = selectedCell;
    if (originalBoard[row][col] !== 0 || board[row][col] === solution[row][col]) return;
    const previousState = { board: cloneBoard(board), notes: cloneNotesBoard(notes), moves, mistakes, elapsedSeconds };
    history.push(previousState);
    future = [];
    board[row][col] = solution[row][col];
    notes[row][col] = [];
    moves += 1;
    renderBoard();
    saveState();
    updateStatus('Hint used');
  };

  const togglePause = () => {
    isPaused = !isPaused;
    pauseButton.textContent = isPaused ? 'Resume' : 'Pause';
    if (isPaused) {
      stopTimer();
      if (overlayTitle) overlayTitle.textContent = '⏸️ Paused';
      if (overlayMessage) overlayMessage.textContent = 'Take a breath and resume whenever you are ready.';
      if (overlayAction) overlayAction.textContent = 'Resume';
      if (overlay) overlay.classList.remove('hidden');
    } else {
      startTimer();
      if (overlay) overlay.classList.add('hidden');
    }
  };

  const bindEvents = () => {
    if (newGameButton) newGameButton.addEventListener('click', () => startNewGame(activeDifficulty, gameMode));
    if (restartButton) restartButton.addEventListener('click', restartGame);
    if (pauseButton) pauseButton.addEventListener('click', togglePause);
    if (undoButton) undoButton.addEventListener('click', undoMove);
    if (redoButton) redoButton.addEventListener('click', redoMove);
    if (checkButton) checkButton.addEventListener('click', () => checkMove());
    if (validateButton) validateButton.addEventListener('click', () => validateBoard());
    if (solveButton) solveButton.addEventListener('click', () => {
      board = cloneBoard(solution);
      originalBoard = cloneBoard(solution);
      notes = createEmptyBoard().map((row) => row.map(() => []));
      selectedCell = null;
      isGameOver = true;
      stopTimer();
      renderBoard();
      updateStatus('Puzzle solved for you — start a new game to play again');
      saveState();
    });
    if (noteToggleButton) noteToggleButton.addEventListener('click', () => {
      notesMode = !notesMode;
      noteToggleButton.classList.toggle('active', notesMode);
      updateStatus(notesMode ? 'Notes mode on' : 'Notes mode off');
    });
    if (eraseButton) eraseButton.addEventListener('click', eraseCell);
    if (hintButton) hintButton.addEventListener('click', useHint);
    if (difficultySelect) {
      difficultySelect.addEventListener('change', (event) => {
        setDifficulty(event.target.value);
        startNewGame(event.target.value, gameMode);
      });
    }
    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.modeBtn;
        setMode(nextMode);
        startNewGame(activeDifficulty, nextMode);
      });
    });
    const numberButtons = Array.from(document.querySelectorAll('[data-number-btn]'));
    numberButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.numberBtn);
        activeNumber = activeNumber === value ? null : value;
        numberButtons.forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.numberBtn) === activeNumber));
        applyValue(value);
      });
    });
    document.addEventListener('keydown', (event) => {
      if (isPaused || isGameOver) return;
      const key = event.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(key)) {
        event.preventDefault();
        if (!selectedCell) return;
        const { row, col } = selectedCell;
        const next = {
          ArrowUp: { row: row - 1, col },
          ArrowDown: { row: row + 1, col },
          ArrowLeft: { row, col: col - 1 },
          ArrowRight: { row, col: col + 1 },
          w: { row: row - 1, col },
          s: { row: row + 1, col },
          a: { row, col: col - 1 },
          d: { row, col: col + 1 },
        }[key];
        if (next.row >= 0 && next.row < size && next.col >= 0 && next.col < size) {
          selectedCell = next;
          renderBoard();
        }
      } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) {
        event.preventDefault();
        applyValue(Number(key));
      } else if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        eraseCell();
      } else if (key === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        undoMove();
      } else if (key === 'y' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        redoMove();
      }
    });
    if (overlayAction) {
      overlayAction.addEventListener('click', () => {
        if (isPaused) {
          togglePause();
        } else {
          startNewGame(activeDifficulty, gameMode);
        }
      });
    }
  };

  const initialize = () => {
    bindEvents();
    stats = loadStats() || stats;
    const saved = loadState();
    if (saved) {
      board = cloneBoard(saved.board);
      originalBoard = cloneBoard(saved.originalBoard);
      solution = cloneBoard(saved.solution);
      notes = loadSavedNotes(saved.notes);
      moves = saved.moves || 0;
      mistakes = saved.mistakes || 0;
      elapsedSeconds = saved.elapsedSeconds || 0;
      selectedCell = saved.selectedCell || null;
      notesMode = Boolean(saved.notesMode);
      isGameOver = Boolean(saved.isGameOver);
      gameMode = saved.gameMode || 'random';
      activeDifficulty = saved.activeDifficulty || 'medium';
      history = saved.history || [];
      future = saved.future || [];
      stats = saved.stats || stats;
      setMode(gameMode);
      setDifficulty(activeDifficulty);
      if (difficultySelect) difficultySelect.value = activeDifficulty;
      renderBoard();
      if (!isGameOver) startTimer();
      updateStatsDisplay();
      if (overlay) overlay.classList.add('hidden');
      if (noteToggleButton && notesMode) noteToggleButton.classList.add('active');
      return;
    }
    startNewGame(activeDifficulty, gameMode);
  };

  const loadSavedNotes = (notesState) => {
    if (!Array.isArray(notesState)) return createEmptyBoard().map((row) => row.map(() => []));
    return notesState.map((row) => row.map((cell) => (Array.isArray(cell) ? cell : [])));
  };

  // Everything below is pure puzzle logic with no DOM dependency — exported
  // for unit testing outside a browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      size,
      boxSize,
      difficulties,
      cloneBoard,
      cloneNotesBoard,
      createEmptyBoard,
      shuffleValues,
      isSafe,
      findEmptyCell,
      solveSudoku,
      countSolutions,
      generateSolvedBoard,
      createSeededRandom,
      generatePuzzle,
    };
  }

  return { initialize };
})();

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => SudokuGame.initialize());
}
