const TicTacToe = (() => {
  // Rules and opponent live in tic-tac-toe-engine.js so they can be proved by
  // playing every reachable game in a test, which is not something the DOM
  // layer can do. This file keeps the board, the animation and the storage.
  const ENGINE = (typeof window !== 'undefined' && window.TicTacToeEngine) || null;

  const STORAGE_KEY = 'tooladda-tic-tac-toe';
  const players = { X: 'X', O: 'O' };
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  const state = {
    board: Array(9).fill(''),
    currentPlayer: players.X,
    mode: 'pvp',
    active: true,
    aiThinking: false,
    scores: { X: 0, O: 0, draws: 0 },
    winningLine: [],
  };

  const elements = {};

  const saveState = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scores: state.scores,
      mode: state.mode,
    }));
  };

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.scores) {
        state.scores = saved.scores;
      }
      if (saved?.mode) {
        state.mode = saved.mode;
      }
    } catch (error) {
      // ignore parse errors and start fresh
    }
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // The mark is drawn rather than typed: a glyph would inherit the reader's
  // font, sit on a baseline instead of the centre of the square, and could not
  // be animated in. Two lines and a circle are exact and stroke-animatable.
  const buildMark = (value) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'tic-mark');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    if (value === 'X') {
      [[28, 28, 72, 72], [72, 28, 28, 72]].forEach(([x1, y1, x2, y2], i) => {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('class', 'tic-mark__stroke tic-mark__stroke--' + (i + 1));
        svg.appendChild(line);
      });
    } else {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', '50'); circle.setAttribute('cy', '50'); circle.setAttribute('r', '24');
      circle.setAttribute('class', 'tic-mark__stroke');
      svg.appendChild(circle);
    }
    return svg;
  };

  const createCell = (value, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tic-cell';
    if (value) button.appendChild(buildMark(value));
    button.dataset.cellIndex = index;
    if (value) button.dataset.mark = value;
    button.setAttribute('aria-label', value ? `Cell ${index + 1}, ${value}` : `Cell ${index + 1}, empty`);
    if (value) {
      button.classList.add('filled');
    }
    if (state.winningLine.includes(index)) {
      button.classList.add('winning');
    }

    button.addEventListener('click', () => {
      makeMove(index);
    });

    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        makeMove(index);
      }
    });

    return button;
  };

  const renderBoard = () => {
    elements.board.innerHTML = '';
    state.board.forEach((cell, index) => {
      elements.board.appendChild(createCell(cell, index));
    });
  };

  const animateScoreValue = (element) => {
    if (!element) return;
    element.classList.remove('is-updated');
    void element.offsetWidth;
    element.classList.add('is-updated');
  };

  const updateScoreboard = () => {
    elements.xScore.textContent = state.scores.X;
    elements.oScore.textContent = state.scores.O;
    elements.drawScore.textContent = state.scores.draws;
    animateScoreValue(elements.xScore);
    animateScoreValue(elements.oScore);
    animateScoreValue(elements.drawScore);
  };

  const setStatus = (message) => {
    elements.status.textContent = message;
  };

  const updateCurrentPlayerText = () => {
    if (!elements.currentPlayer || !elements.currentPlayerWrapper || !elements.playerIcon) return;

    elements.currentPlayer.textContent = `Current player: ${state.currentPlayer}`;
    elements.playerIcon.textContent = state.currentPlayer === players.X ? '✕' : '◯';
    elements.currentPlayerWrapper.classList.toggle('is-o', state.currentPlayer === players.O);
  };

  const getAvailableMoves = () => state.board
    .map((cell, index) => (cell === '' ? index : null))
    .filter((value) => value !== null);

  const getWinningLine = (board, player) => {
    if (ENGINE) return ENGINE.winningLine(board, player);
    return lines.find((line) => line.every((index) => board[index] === player)) || null;
  };

  const checkDraw = () => (ENGINE
    ? ENGINE.evaluate(state.board).draw
    : state.board.every((cell) => cell !== ''));

  const highlightWinningCells = (winningLine) => {
    state.winningLine = winningLine;
    renderBoard();
  };

  const endGame = () => {
    state.active = false;
  };

  const launchConfetti = () => {
    const container = elements.confetti;
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#8b5cf6', '#22c55e', '#ffffff', '#14b8a6', '#f97316'];
    for (let i = 0; i < 40; i += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = `${Math.random() * 0.2}s`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(piece);
    }
    setTimeout(() => { container.innerHTML = ''; }, 1800);
  };

  const showMessage = (message) => {
    setStatus(message);
    if (elements.status) {
      const lower = message.toLowerCase();
      if (lower.includes('wins') || lower.includes('draw')) {
        elements.status.dataset.tone = 'success';
      } else if (lower.includes('ready') || lower.includes('choose') || lower.includes('reset') || lower.includes('started') || lower.includes('score')) {
        elements.status.dataset.tone = 'neutral';
      } else {
        elements.status.dataset.tone = 'default';
      }
    }
  };

  const switchPlayer = () => {
    state.currentPlayer = state.currentPlayer === players.X ? players.O : players.X;
    updateCurrentPlayerText();
  };

  const canAiMove = () => state.mode !== 'pvp' && state.currentPlayer === players.O && state.active;

  const randomMove = () => {
    const moves = getAvailableMoves();
    return moves[Math.floor(Math.random() * moves.length)];
  };

  const mediumMove = () => {
    const board = [...state.board];
    const available = getAvailableMoves();

    for (let index of available) {
      board[index] = players.O;
      if (getWinningLine(board, players.O)) {
        return index;
      }
      board[index] = '';
    }

    for (let index of available) {
      board[index] = players.X;
      if (getWinningLine(board, players.X)) {
        return index;
      }
      board[index] = '';
    }

    const corners = available.filter((index) => [0, 2, 6, 8].includes(index));
    if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
    return randomMove();
  };

  const minimax = (board, isMaximizing) => {
    const winO = getWinningLine(board, players.O);
    const winX = getWinningLine(board, players.X);

    if (winO) return 10;
    if (winX) return -10;
    if (board.every((cell) => cell !== '')) return 0;

    if (isMaximizing) {
      let bestScore = -Infinity;
      board.forEach((cell, index) => {
        if (cell === '') {
          board[index] = players.O;
          const score = minimax(board, false);
          board[index] = '';
          bestScore = Math.max(score, bestScore);
        }
      });
      return bestScore;
    }

    let bestScore = Infinity;
    board.forEach((cell, index) => {
      if (cell === '') {
        board[index] = players.X;
        const score = minimax(board, true);
        board[index] = '';
        bestScore = Math.min(score, bestScore);
      }
    });
    return bestScore;
  };

  const hardMove = () => {
    let bestScore = -Infinity;
    let move = null;
    state.board.forEach((cell, index) => {
      if (cell === '') {
        state.board[index] = players.O;
        const score = minimax(state.board, false);
        state.board[index] = '';
        if (score > bestScore) {
          bestScore = score;
          move = index;
        }
      }
    });
    return move ?? randomMove();
  };

  const getAiMove = () => {
    // The engine's search is depth-aware: it takes the fastest win and the
    // slowest loss, where the previous local minimax scored every win alike
    // and so would decline an immediate win or concede one needlessly.
    if (ENGINE) {
      const move = ENGINE.chooseMove(state.board, state.currentPlayer, state.mode, Math.random);
      if (typeof move === 'number') return move;
    }
    if (state.mode === 'easy') return randomMove();
    if (state.mode === 'medium') return mediumMove();
    return hardMove();
  };

  const scheduleAi = () => {
    if (!canAiMove()) return;
    state.aiThinking = true;
    if (elements.board) elements.board.style.pointerEvents = 'none';
    showMessage('Computer is thinking…');
    setTimeout(() => {
      state.aiThinking = false;
      if (elements.board) elements.board.style.pointerEvents = '';
      const aiIndex = getAiMove();
      if (typeof aiIndex === 'number') makeMove(aiIndex, true);
    }, 320);
  };

  const makeMove = (index, isAi) => {
    if (!state.active || state.board[index]) return;
    // Block human clicks while the computer is thinking or when it's the AI's turn.
    if (!isAi && (state.aiThinking || canAiMove())) return;
    state.board[index] = state.currentPlayer;
    const line = getWinningLine(state.board, state.currentPlayer);

    if (line) {
      highlightWinningCells(line);
      state.scores[state.currentPlayer] += 1;
      updateScoreboard();
      showMessage(`${state.currentPlayer} wins!`);
      launchConfetti();
      endGame();
      saveState();
      return;
    }

    if (checkDraw()) {
      state.scores.draws += 1;
      updateScoreboard();
      showMessage('It’s a draw. Nice game!');
      endGame();
      saveState();
      return;
    }

    switchPlayer();
    state.winningLine = [];
    renderBoard();
    showMessage(`Ready for ${state.currentPlayer}.`);
    scheduleAi();
  };

  const resetBoard = () => {
    state.board = Array(9).fill('');
    state.currentPlayer = players.X;
    state.active = true;
    state.aiThinking = false;
    state.winningLine = [];
    if (elements.board) elements.board.style.pointerEvents = '';
    updateCurrentPlayerText();
    renderBoard();
    showMessage('Board reset. Ready to play.');
    scheduleAi();
  };

  // New game = fresh round; the scoreboard is kept (use "Reset score" to clear it).
  const newGame = () => {
    resetBoard();
    showMessage('New round — X to start. Good luck!');
  };

  const resetScores = () => {
    state.scores = { X: 0, O: 0, draws: 0 };
    updateScoreboard();
    saveState();
    showMessage('Scoreboard reset.');
  };

  const setMode = (mode) => {
    state.mode = mode;
    elements.modeSelect.value = mode;
    saveState();
    resetBoard();
  };

  const bindEvents = () => {
    elements.newButton.addEventListener('click', newGame);
    elements.clearButton.addEventListener('click', resetScores);
    elements.modeSelect.addEventListener('change', (event) => setMode(event.target.value));
  };

  const hydrateElements = () => {
    elements.board = document.querySelector('[data-board]');
    elements.currentPlayerWrapper = document.querySelector('[data-current-player-wrapper]');
    elements.currentPlayer = document.querySelector('[data-current-player]');
    elements.playerIcon = document.querySelector('[data-player-icon]');
    elements.status = document.querySelector('[data-status-area]');
    elements.modeSelect = document.querySelector('[data-mode-select]');
    elements.xScore = document.querySelector('[data-x-score]');
    elements.oScore = document.querySelector('[data-o-score]');
    elements.drawScore = document.querySelector('[data-draw-score]');
    elements.newButton = document.querySelector('[data-new-btn]');
    elements.clearButton = document.querySelector('[data-clear-btn]');
    elements.confetti = document.querySelector('[data-confetti]');
  };

  const initialize = () => {
    hydrateElements();
    loadState();
    elements.modeSelect.value = state.mode;
    bindEvents();
    updateScoreboard();
    updateCurrentPlayerText();
    renderBoard();
    showMessage('Choose a mode and start playing.');
  };

  return { initialize };
})();

document.addEventListener('DOMContentLoaded', () => TicTacToe.initialize());
