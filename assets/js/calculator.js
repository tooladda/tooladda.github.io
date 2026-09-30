/* Premium Calculator (glass UI) engine
   - Keyboard input
   - Operator precedence: % postfix then × ÷ then + -
   - Real-time evaluation with error handling
   - History + copy result
*/
(() => {
  const exprEl = document.getElementById('exprDisplay');
  const resultEl = document.getElementById('resultDisplay');
  const errorPill = document.getElementById('errorPill');
  const historyList = document.getElementById('historyList');
  const historyEmpty = document.getElementById('historyEmpty');
  const copyResultBtn = document.getElementById('copyResultBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  const buttons = Array.from(document.querySelectorAll('[data-action]'));

  const state = {
    // Expression tokens (in display/evaluation form)
    // digits: strings
    // operators: '+','-','*','/'
    // percent: ' % ' postfix token as marker
    tokens: [],
    // For current number being typed
    current: '',
    // Last computed result
    lastResult: null,
    // Error message
    error: null,
    // last valid expression string for history
    lastExprString: '0',
    // True right after "=": the next digit starts a new calculation
    justEvaluated: false,
  };

  const MAX_DIGITS = 16;

  const MAX_HISTORY = 20;

  // ---------- Utilities ----------
  const isDigit = (ch) => ch >= '0' && ch <= '9';

  function clampHistoryVisibility() {
    const hasItems = historyList.children.length > 0;
    historyEmpty.style.display = hasItems ? 'none' : 'block';
  }

  function showError(msg) {
    state.error = msg;
    errorPill.textContent = msg;
    errorPill.style.display = 'inline-flex';
  }

  function clearError() {
    state.error = null;
    errorPill.style.display = 'none';
    errorPill.textContent = '';
  }

  // Round to 12 significant digits so binary noise (0.1 + 0.2 = 0.30000000000000004)
  // never reaches the display, as the page promises.
  function roundForDisplay(n) {
    if (!Number.isFinite(n) || n === 0) return n;
    return Number(n.toPrecision(12));
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return 'Error';
    n = roundForDisplay(n);
    // Avoid -0
    if (Object.is(n, -0) || n === 0) return '0';
    const abs = Math.abs(n);

    // Scientific notation only for genuinely very large or very small values
    if (abs >= 1e12 || abs < 1e-6) {
      return n.toExponential(8)
        .replace(/(\.\d*?[1-9])0+e/, '$1e')
        .replace(/\.0+e/, 'e');
    }

    // Trim trailing zeros
    const s = n.toString();
    if (s.includes('e')) return s;
    if (!s.includes('.')) return s;

    return s.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/g, '');
  }

  function buildExprString() {
    // Compose from tokens + current
    const parts = [];

    for (const t of state.tokens) {
      if (t === '%') {
        // postfix
        if (parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]}%`;
        else parts.push('%');
      } else if (t === '*') parts.push('×');
      else if (t === '/') parts.push('÷');
      else parts.push(t);
    }

    if (state.current) parts.push(state.current);
    if (parts.length === 0) return '0';
    return parts.join(' ');
  }

  function updateDisplay({ silentError = false } = {}) {
    exprEl.textContent = buildExprString();

    const evalRes = evaluateTokens();

    if (evalRes.ok) {
      clearError();
      resultEl.textContent = formatNumber(evalRes.value);
      state.lastResult = evalRes.value;
      state.lastExprString = buildExprString();
      return;
    }

    // For incomplete expression, we still keep a friendly interim
    if (!silentError) {
      showError(evalRes.error || 'Invalid expression');
      // Never leave an old answer beside an error (5 ÷ 0 used to keep showing 5).
      resultEl.textContent = '—';
    }
  }

  // ---------- Parser / Evaluator (precedence) ----------
  // Token stream includes: numbers as strings, operators '+','-','*','/', percent '%' postfix
  // We do not support parentheses.

  function tokenizeForEval() {
    const tokens = [];

    // Flush tokens (already in operator/* form)
    for (const t of state.tokens) {
      if (t === '%') tokens.push('%');
      else if (t === '+' || t === '-' || t === '*' || t === '/') tokens.push(t);
      else tokens.push(t); // number string
    }

    if (state.current) tokens.push(state.current);

    return tokens;
  }

  function toNumber(tok) {
    const n = Number(tok);
    return n;
  }

  function isOperator(tok) {
    return tok === '+' || tok === '-' || tok === '*' || tok === '/';
  }

  function evaluateTokens() {
    // Create evaluation tokens from current state.
    const raw = tokenizeForEval();
    // "5 ×" is simply unfinished, not wrong: evaluate what is there so far.
    while (raw.length && isOperator(raw[raw.length - 1])) raw.pop();

    // Basic validation: no consecutive binary operators
    // Allow trailing operator/incomplete to show error.
    if (raw.length === 0) return { ok: true, value: 0 };

    // If expression ends with operator, it's incomplete.
    const last = raw[raw.length - 1];
    // if (isOperator(last)) {
    //   return { ok: false, error: 'Finish the expression' };
    // }

    // Percent must be postfix after a number or percent chain; validate during reduction.

    // Step 1: reduce percent postfix
    // We transform: number '%' => (number * 0.01)
    const step1 = [];
    for (let i = 0; i < raw.length; i++) {
      const tok = raw[i];
      if (tok === '%') {
        // Apply to previous numeric
        if (step1.length === 0) return { ok: false, error: 'Invalid % usage' };
        const prev = step1[step1.length - 1];
        const n = toNumber(prev);
        if (!Number.isFinite(n)) return { ok: false, error: 'Invalid number' };
        step1[step1.length - 1] = String(n * 0.01);
        continue;
      }
      // Normalize number/operator
      if (isOperator(tok)) {
        step1.push(tok);
      } else {
        // number
        // Validate numeric
        const n = toNumber(tok);
        if (!Number.isFinite(n)) return { ok: false, error: 'Invalid number' };
        step1.push(tok);
      }
    }

    // Step 2: reduce × ÷ (left to right)
    const step2 = [];
    for (let i = 0; i < step1.length; i++) {
      const tok = step1[i];
      if (tok === '*' || tok === '/') {
        const prevTok = step2.pop();
        const left = toNumber(prevTok);
        const rightTok = step1[i + 1];
        if (rightTok === undefined || isOperator(rightTok)) return { ok: false, error: 'Invalid operator placement' };
        const right = toNumber(rightTok);
        if (tok === '/') {
          if (right === 0) return { ok: false, error: 'Division by zero' };
          step2.push(String(left / right));
        } else {
          step2.push(String(left * right));
        }
        i++; // skip right
      } else {
        step2.push(tok);
      }
    }

    // Step 3: reduce + - (left to right)
    let acc = null;
    let pendingOp = null;

    for (let i = 0; i < step2.length; i++) {
      const tok = step2[i];
      if (isOperator(tok)) {
        pendingOp = tok;
        continue;
      }

      const num = toNumber(tok);
      if (acc === null) {
        acc = num;
      } else {
        if (!pendingOp) return { ok: false, error: 'Invalid expression' };
        if (pendingOp === '+') acc = acc + num;
        else if (pendingOp === '-') acc = acc - num;
        else return { ok: false, error: 'Invalid expression' };
        pendingOp = null;
      }
    }

    // if (pendingOp) return { ok: false, error: 'Finish the expression' };

    if (!Number.isFinite(acc)) return { ok: false, error: 'Math error' };
    return { ok: true, value: acc };
  }

  // ---------- Interaction helpers ----------
  function rippleOnButton(btn, event) {
    const rect = btn.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    btn.appendChild(r);
    r.addEventListener('animationend', () => r.remove());
  }

  function setPressed(btn) {
    btn.classList.add('is-pressed');
    setTimeout(() => btn.classList.remove('is-pressed'), 140);
  }

  // After "=", typing a number starts a fresh calculation instead of gluing onto the result.
  function startFreshIfEvaluated() {
    if (!state.justEvaluated) return;
    state.justEvaluated = false;
    state.tokens = [];
    state.current = '';
  }

  // A number typed straight after a closed number or % has no operator between them.
  function lastTokenIsValue() {
    const last = state.tokens[state.tokens.length - 1];
    return last !== undefined && !isOperator(last);
  }

  function inputDigit(d) {
    clearError();
    startFreshIfEvaluated();
    if (!state.current && lastTokenIsValue()) {
      showError('Add an operator first');
      return;
    }
    if (state.current.replace(/[-.]/g, '').length >= MAX_DIGITS) {
      showError(`Up to ${MAX_DIGITS} digits`);
      return;
    }
    if (state.current === '0') {
      state.current = d;
    } else if (state.current === '-0') {
      state.current = '-' + d;
    } else {
      state.current += d;
    }
    updateDisplay();
  }

  function inputDecimal() {
    clearError();
    startFreshIfEvaluated();
    if (!state.current && lastTokenIsValue()) {
      showError('Add an operator first');
      return;
    }
    if (!state.current) state.current = '0.';
    else if (!state.current.includes('.')) state.current += '.';
    updateDisplay();
  }

  function commitCurrentNumber() {
    if (state.current) {
      state.tokens.push(state.current);
      state.current = '';
    }
  }

  function inputOperator(op) {
    clearError();
    state.justEvaluated = false;

    // Map op to internal: '+','-','*','/'
    const valid = ['+', '-', '*', '/'];
    if (!valid.includes(op)) return;

    // If currently typing a number, commit it.
    if (state.current) {
      commitCurrentNumber();
    } else {
      // If expression is empty and op is '-', allow unary minus by starting current.
      if (state.tokens.length === 0 && op === '-') {
        state.current = '-0';
        updateDisplay();
        return;
      }
      // Nothing to operate on yet.
      if (state.tokens.length === 0) {
        updateDisplay({ silentError: true });
        return;
      }
    }

    // Replace last operator if user taps operators consecutively
    const last = state.tokens[state.tokens.length - 1];
    if (isOperator(last)) {
      state.tokens[state.tokens.length - 1] = op;
    } else {
      state.tokens.push(op);
    }

    updateDisplay();
  }

  function inputPercent() {
    clearError();
    state.justEvaluated = false;

    // Percent acts on the current number if typing, else on last committed number.
    if (state.current) {
      // Apply as postfix by committing current then adding '%'
      commitCurrentNumber();
    }

    const last = state.tokens[state.tokens.length - 1];
    if (!last || isOperator(last) || last === '%') {
      showError('Invalid % usage');
      return;
    }

    state.tokens.push('%');
    updateDisplay();
  }

  function inputPlusMinus() {
    clearError();
    state.justEvaluated = false;

    // Toggle sign for current number if exists; otherwise toggle last number token.
    if (state.current) {
      if (state.current.startsWith('-')) state.current = state.current.slice(1);
      else state.current = '-' + state.current;
      updateDisplay();
      return;
    }

    // Toggle previous number token
    if (state.tokens.length === 0) {
      state.current = '-0';
      updateDisplay();
      return;
    }

    // If last token is %, apply toggle to number before it.
    if (state.tokens[state.tokens.length - 1] === '%') {
      // find number before '%'
      for (let i = state.tokens.length - 2; i >= 0; i--) {
        const tok = state.tokens[i];
        if (isOperator(tok)) break;
        // tok should be a number string
        const n = tok;
        if (typeof n === 'string') {
          if (n.startsWith('-')) state.tokens[i] = n.slice(1);
          else state.tokens[i] = '-' + n;
          updateDisplay();
          return;
        }
      }
      showError('Invalid ± usage');
      return;
    }

    const lastTok = state.tokens[state.tokens.length - 1];
    if (isOperator(lastTok)) {
      showError('Invalid ± usage');
      return;
    }

    if (lastTok.startsWith('-')) state.tokens[state.tokens.length - 1] = lastTok.slice(1);
    else state.tokens[state.tokens.length - 1] = '-' + lastTok;

    updateDisplay();
  }

  function backspace() {
    clearError();
    state.justEvaluated = false;

    if (state.current) {
      state.current = state.current.slice(0, -1);
      if (state.current === '' || state.current === '-') state.current = '';
      updateDisplay();
      return;
    }

    if (state.tokens.length > 0) {
      const last = state.tokens[state.tokens.length - 1];
      state.tokens.pop();

      // If we removed a percent, it's already okay; just update.
      updateDisplay();
      return;
    }

    updateDisplay();
  }

  function clearAll() {
    state.tokens = [];
    state.current = '';
    state.lastResult = null;
    state.lastExprString = '0';
    state.justEvaluated = false;
    clearError();
    exprEl.textContent = '0';
    resultEl.textContent = '0';
    updateHistoryEmptyState();
  }

  function updateHistoryEmptyState() {
    clampHistoryVisibility();
  }

  function evaluateAndCommitToHistory() {
    // Commit current number and require full expression
    if (state.current) commitCurrentNumber();
    // A dangling operator ("5 +") is dropped rather than saved into history.
    while (state.tokens.length && isOperator(state.tokens[state.tokens.length - 1])) state.tokens.pop();
    // Only a bare number (no operator or %): there is no calculation to save.
    if (!state.tokens.some((t) => isOperator(t) || t === '%')) {
      updateDisplay({ silentError: true });
      return;
    }

    const evalRes = evaluateTokens();
    if (!evalRes.ok) {
      showError(evalRes.error || 'Invalid expression');
      return;
    }

    const res = evalRes.value;
    const exprString = buildExprString();

    // Save history item
    addHistoryItem(exprString, formatNumber(res));

    // Reset expression to result for chaining (rounded, so the next line never shows binary noise)
    const rounded = roundForDisplay(res);
    state.tokens = [String(Object.is(rounded, -0) ? 0 : rounded)];
    state.current = '';
    state.lastResult = rounded;
    state.justEvaluated = true;

    clearError();
    updateDisplay({ silentError: true });

    // Keep the finished sum visible above the answer, calculator-style.
    exprEl.textContent = `${exprString} =`;
    resultEl.textContent = formatNumber(res);
  }

  function addHistoryItem(expr, res) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const safeExpr = expr;

    li.innerHTML = `
      <div class="expr">${escapeHtml(safeExpr)}</div>
      <div class="res">
        <span>=</span>
        <strong>${escapeHtml(res)}</strong>
      </div>
      <div class="actions-row" style="display:none"></div>
    `;

    // Click history to reuse result
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      // Replace entire state with this result
      const numeric = Number(res);
      if (!Number.isFinite(numeric)) return;
      state.tokens = [String(numeric)];
      state.current = '';
      state.justEvaluated = true;
      clearError();
      updateDisplay({ silentError: true });
    });

    historyList.prepend(li);

    while (historyList.children.length > MAX_HISTORY) {
      historyList.removeChild(historyList.lastElementChild);
    }

    clampHistoryVisibility();
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function copyCurrentResult() {
    if (state.lastResult === null || !Number.isFinite(state.lastResult)) {
      showError('Nothing to copy');
      return;
    }

    const text = formatNumber(state.lastResult);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const t = document.createElement('textarea');
        t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.left = '-9999px';
        document.body.appendChild(t); t.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(t);
        if (!ok) throw new Error('copy failed');
      }
      // quick visual feedback
      copyResultBtn.textContent = 'Copied';
      copyResultBtn.style.borderColor = 'rgba(34,197,94,0.35)';
      copyResultBtn.style.boxShadow = '0 0 0 4px rgba(34,197,94,0.12)';
      setTimeout(() => {
        copyResultBtn.textContent = 'Copy';
        copyResultBtn.style.borderColor = '';
        copyResultBtn.style.boxShadow = '';
      }, 900);
    } catch (e) {
      showError('Copy failed (clipboard blocked)');
    }
  }

  function clearHistory() {
    historyList.innerHTML = '';
    clampHistoryVisibility();
  }

  // ---------- Keyboard support ----------
  function handleKey(e) {
    const key = e.key;

    // Avoid interfering with browser shortcuts
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const active = document.activeElement;
    const isInputLike = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (isInputLike) return;

    // Map keys
    if (isDigit(key)) {
      e.preventDefault();
      inputDigit(key);
      return;
    }

    if (key === '.') {
      e.preventDefault();
      inputDecimal();
      return;
    }

    if (key === '+' || key === '-') {
      e.preventDefault();
      inputOperator(key);
      return;
    }

    if (key === '*' || key === 'x' || key === 'X') {
      e.preventDefault();
      inputOperator('*');
      return;
    }

    if (key === '/' || key === '÷') {
      e.preventDefault();
      inputOperator('/');
      return;
    }

    if (key === '%') {
      e.preventDefault();
      inputPercent();
      return;
    }

    if (key === 'Enter' || key === '=') {
      e.preventDefault();
      evaluateAndCommitToHistory();
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      backspace();
      return;
    }

    if (key === 'Escape' || key === 'Delete') {
      e.preventDefault();
      clearAll();
      return;
    }

    // Optional: 'p' for plus/minus toggle
    if (key === 'p' || key === 'P') {
      e.preventDefault();
      inputPlusMinus();
      return;
    }
  }

  // ---------- Bind buttons ----------
  function handleButtonClick(btn, ev) {
    rippleOnButton(btn, ev);
    setPressed(btn);

    const action = btn.getAttribute('data-action');
    const value = btn.getAttribute('data-value');

    switch (action) {
      case 'digit':
        inputDigit(value);
        break;
      case 'decimal':
        inputDecimal();
        break;
      case 'operator':
        inputOperator(value);
        break;
      case 'percent':
        inputPercent();
        break;
      case 'plusMinus':
        inputPlusMinus();
        break;
      case 'clear':
        clearAll();
        break;
      case 'backspace':
        backspace();
        break;
      case 'equals':
        evaluateAndCommitToHistory();
        break;
      default:
        break;
    }
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', (ev) => handleButtonClick(btn, ev));
    // Keyboard focus glow already handled via :focus-visible CSS
  });

  // ---------- History / copy actions ----------
  if (copyResultBtn) copyResultBtn.addEventListener('click', copyCurrentResult);
  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);

  // ---------- Init ----------
  window.addEventListener('keydown', handleKey);

  // Initial display
  exprEl.textContent = '0';
  resultEl.textContent = '0';
  if (historyList && historyEmpty) {
    historyList.innerHTML = '';
    clampHistoryVisibility();
  }

  // If any button is tapped, ensure aria updates are smooth
  updateDisplay({ silentError: true });
})();

