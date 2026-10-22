/* Chemical Equation Balancer — UI layer.
 *
 * Every chemical decision lives in assets/js/equation-balancer-engine.js.
 * This file reads the input, asks the engine, and paints the answer: the
 * balanced equation, the before/after atom tables, the working, the reaction
 * type and the copy/export actions.
 *
 * Two rules shape this file:
 *   - Nothing is rendered as "balanced" unless engine.verified is true.
 *   - Chemistry text is written with textContent only. Formulas the user typed
 *     never reach innerHTML, so nothing pasted into the box can execute.
 */
(function () {
  'use strict';

  var E = window.EquationBalancer;
  if (!E) return;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    input: $('cebInput'),
    balanceBtn: $('cebBalance'),
    resetBtn: $('cebReset'),
    status: $('cebStatus'),
    equation: $('cebEquation'),
    meta: $('cebMeta'),

    beforeBody: $('cebBeforeBody'),
    afterBody: $('cebAfterBody'),
    chargeRow: $('cebChargeRow'),

    steps: $('cebSteps'),
    mathToggle: $('cebMathToggle'),
    math: $('cebMath'),

    copyUnicode: $('cebCopyUnicode'),
    copyPlain: $('cebCopyPlain'),
    copyLatex: $('cebCopyLatex'),
    copyHtml: $('cebCopyHtml'),
    downloadTxt: $('cebDownloadTxt'),
    downloadCsv: $('cebDownloadCsv'),
    printBtn: $('cebPrint'),

    historyWrap: $('cebHistoryWrap'),
    history: $('cebHistory'),
    clearHistory: $('cebClearHistory'),
    toast: $('cebToast')
  };

  if (!el.input || !el.equation) return;

  var STORE = 'tooladda-ceb-history';
  var MAX_HISTORY = 8;
  var current = null;   // last verified result, or null

  /* --------------------------------------------------------------- utils */

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function setStatus(kind, text) {
    if (!el.status) return;
    if (!kind) { el.status.hidden = true; el.status.textContent = ''; return; }
    el.status.hidden = false;
    el.status.className = 'ceb-status ' + (kind === 'ok' ? 'is-ok' : 'is-error');
    // the mark is a character, not a colour, so the state survives greyscale
    el.status.textContent = (kind === 'ok' ? '✓ ' : '✕ ') + text;
  }

  function clearNode(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function cell(tag, text, cls) {
    var n = document.createElement(tag);
    n.textContent = text;
    if (cls) n.className = cls;
    if (tag === 'th') n.setAttribute('scope', 'row');
    return n;
  }

  /* --------------------------------------------------------------- render */

  function resetOutput(message) {
    current = null;
    el.equation.className = 'ceb-equation is-empty';
    el.equation.textContent = message || 'The balanced equation will appear here.';
    clearNode(el.meta);
    clearNode(el.beforeBody);
    clearNode(el.afterBody);
    clearNode(el.steps);
    clearNode(el.math);
    if (el.chargeRow) el.chargeRow.hidden = true;
  }

  function balanceNow() {
    var raw = el.input.value;
    if (!raw.trim()) {
      el.input.setAttribute('aria-invalid', 'false');
      setStatus(null);
      resetOutput();
      return;
    }

    var before = null;
    var result = null;
    try {
      before = E.tallyUnbalanced(raw);
      result = E.balance(raw);
    } catch (err) {
      el.input.setAttribute('aria-invalid', 'true');
      // only our own prose reaches the user; anything else becomes generic
      var msg = (err && err.userFacing && err.message)
        ? err.message
        : 'We couldn’t reliably balance this equation. Please check the chemical formulas and notation.';
      setStatus('error', msg);
      resetOutput('No balanced equation — see the message above.');
      // still show the atom counts we managed to read, if any
      if (before) renderBefore(before);
      return;
    }

    // belt and braces: the engine already refuses to return an unverified
    // result, but never print one even if that ever changed
    if (!result.verified) {
      el.input.setAttribute('aria-invalid', 'true');
      setStatus('error', 'We couldn’t reliably balance this equation. Please check the chemical formulas and notation.');
      resetOutput('No balanced equation — see the message above.');
      return;
    }

    el.input.setAttribute('aria-invalid', 'false');
    current = result;
    setStatus('ok', 'All atoms balanced' + (result.hasCharge ? ' and charge balanced' : ''));

    el.equation.className = 'ceb-equation';
    el.equation.textContent = E.formatEquation(result);

    renderMeta(result);
    renderBefore(before);
    renderAfter(result);
    renderSteps(result, before);
    renderMath(result);
    remember(raw.trim());
  }

  function renderMeta(result) {
    clearNode(el.meta);
    var chips = [];

    var type = E.reactionType(result);
    chips.push(['Reaction type', type ? type.type : 'Could not be determined']);
    chips.push(['Coefficients', result.coefficients.join(' : ')]);
    chips.push(['Species', String(result.species.length)]);
    if (result.hasCharge) {
      chips.push(['Net charge', result.check.charge.reactants + ' = ' + result.check.charge.products]);
    }

    chips.forEach(function (pair) {
      var chip = document.createElement('span');
      chip.className = 'ceb-chip';
      chip.appendChild(document.createTextNode(pair[0] + ': '));
      var b = document.createElement('b');
      b.textContent = pair[1];
      chip.appendChild(b);
      el.meta.appendChild(chip);
    });

    if (type && type.why) {
      var why = document.createElement('span');
      why.className = 'ceb-chip';
      why.textContent = type.why;
      el.meta.appendChild(why);
    }
  }

  function atomRows(tbody, tally) {
    clearNode(tbody);
    tally.elements.forEach(function (sym) {
      var t = tally.perElement[sym];
      var tr = document.createElement('tr');
      tr.className = t.equal ? 'is-good' : 'is-bad';
      tr.appendChild(cell('th', sym));
      tr.appendChild(cell('td', String(t.reactants)));
      tr.appendChild(cell('td', String(t.products)));
      // a word, not just a colour, so the state is readable without sight
      tr.appendChild(cell('td', t.equal ? '✓ same' : '✕ differ', 'ceb-mark'));
      tbody.appendChild(tr);
    });
  }

  function renderBefore(tally) { if (el.beforeBody) atomRows(el.beforeBody, tally); }

  function renderAfter(result) {
    if (!el.afterBody) return;
    atomRows(el.afterBody, result.check);
    if (el.chargeRow) {
      if (result.hasCharge) {
        el.chargeRow.hidden = false;
        clearNode(el.chargeRow);
        var tr = document.createElement('tr');
        tr.className = result.check.charge.equal ? 'is-good' : 'is-bad';
        tr.appendChild(cell('th', 'Charge'));
        tr.appendChild(cell('td', String(result.check.charge.reactants)));
        tr.appendChild(cell('td', String(result.check.charge.products)));
        tr.appendChild(cell('td', result.check.charge.equal ? '✓ same' : '✕ differ', 'ceb-mark'));
        el.chargeRow.appendChild(tr);
      } else {
        el.chargeRow.hidden = true;
      }
    }
  }

  function renderSteps(result, before) {
    if (!el.steps) return;
    clearNode(el.steps);
    E.steps(result, before).forEach(function (step) {
      var li = document.createElement('li');
      var b = document.createElement('b');
      b.textContent = step.title;
      li.appendChild(b);
      li.appendChild(document.createTextNode(step.body));
      el.steps.appendChild(li);
    });
  }

  function renderMath(result) {
    if (!el.math) return;
    clearNode(el.math);
    var m = E.mathSolution(result);

    var add = function (label, text) {
      var dt = document.createElement('dt');
      dt.textContent = label;
      var dd = document.createElement('dd');
      dd.className = 'ceb-mathline';
      dd.textContent = text;
      dd.style.margin = '0';
      el.math.appendChild(dt);
      el.math.appendChild(dd);
    };

    add('Let the coefficients be', m.setup);
    m.equations.forEach(function (eq) {
      add(eq.element === 'charge' ? 'Charge balance' : 'Balance ' + eq.element, eq.text);
    });
    add('Solving gives', m.solution.join(',  '));
    add('Smallest whole-number ratio', m.ratio);
  }

  /* -------------------------------------------------------------- history */

  function readHistory() {
    try {
      var raw = localStorage.getItem(STORE);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (x) { return typeof x === 'string'; }) : [];
    } catch (e) { return []; }
  }

  function writeHistory(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, MAX_HISTORY))); }
    catch (e) { /* private mode — history simply does not persist */ }
  }

  function remember(equation) {
    var list = readHistory().filter(function (x) { return x !== equation; });
    list.unshift(equation);
    writeHistory(list);
    renderHistory();
  }

  function renderHistory() {
    if (!el.history) return;
    var list = readHistory();
    clearNode(el.history);
    if (el.historyWrap) el.historyWrap.hidden = list.length === 0;

    list.forEach(function (equation) {
      var li = document.createElement('li');

      var recall = document.createElement('button');
      recall.type = 'button';
      recall.className = 'ceb-recall';
      recall.textContent = equation;
      recall.title = equation;
      recall.addEventListener('click', function () {
        el.input.value = equation;
        balanceNow();
        el.input.focus();
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ceb-del';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Remove ' + equation + ' from history');
      del.addEventListener('click', function () {
        writeHistory(readHistory().filter(function (x) { return x !== equation; }));
        renderHistory();
      });

      li.appendChild(recall);
      li.appendChild(del);
      el.history.appendChild(li);
    });
  }

  if (el.clearHistory) {
    el.clearHistory.addEventListener('click', function () {
      writeHistory([]);
      renderHistory();
      toast('History cleared.');
    });
  }

  /* --------------------------------------------------------------- copy */

  function copyText(text, label) {
    if (!text) { toast('Balance an equation first.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast(label); },
        function () { fallbackCopy(text, label); }
      );
    } else fallbackCopy(text, label);
  }

  function fallbackCopy(text, label) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);   // iOS needs the explicit range
    try { document.execCommand('copy'); toast(label); }
    catch (e) { toast('Copy failed — select the equation manually.'); }
    document.body.removeChild(ta);
  }

  function bindCopy(button, make, label) {
    if (!button) return;
    button.addEventListener('click', function () {
      if (!current) { toast('Balance an equation first.'); return; }
      copyText(make(current), label);
    });
  }

  bindCopy(el.copyUnicode, function (r) { return E.formatEquation(r); }, 'Copied as Unicode.');
  bindCopy(el.copyPlain, function (r) { return E.formatEquation(r, { pretty: false }); }, 'Copied as plain text.');
  bindCopy(el.copyLatex, E.toLatex, 'Copied as LaTeX.');
  bindCopy(el.copyHtml, E.toHtml, 'Copied as HTML.');

  /* -------------------------------------------------------------- export */

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  if (el.downloadTxt) el.downloadTxt.addEventListener('click', function () {
    if (!current) { toast('Balance an equation first.'); return; }
    var lines = [
      'Balanced equation: ' + E.formatEquation(current),
      'Plain text:        ' + E.formatEquation(current, { pretty: false }),
      'Coefficients:      ' + current.coefficients.join(' : '),
      ''
    ];
    var type = E.reactionType(current);
    lines.push('Reaction type: ' + (type ? type.type : 'Could not be determined'));
    lines.push('');
    lines.push('Atom check');
    current.check.elements.forEach(function (sym) {
      var t = current.check.perElement[sym];
      lines.push('  ' + sym + ': ' + t.reactants + ' = ' + t.products);
    });
    if (current.hasCharge) {
      lines.push('  charge: ' + current.check.charge.reactants + ' = ' + current.check.charge.products);
    }
    lines.push('');
    lines.push('Working');
    E.steps(current, E.tallyUnbalanced(el.input.value)).forEach(function (s, i) {
      lines.push('  ' + (i + 1) + '. ' + s.title + ' — ' + s.body);
    });
    lines.push('');
    lines.push('Calculated with ToolAdda Chemical Equation Balancer (educational use).');
    download(new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }), 'balanced-equation.txt');
    toast('Text file downloaded.');
  });

  /* Quote every cell and defuse anything a spreadsheet would treat as a
     formula, so an element symbol can never execute on open. */
  function csvCell(v) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  if (el.downloadCsv) el.downloadCsv.addEventListener('click', function () {
    if (!current) { toast('Balance an equation first.'); return; }
    var before = E.tallyUnbalanced(el.input.value);
    var rows = [['Element', 'Reactants before', 'Products before', 'Reactants after', 'Products after', 'Balanced']
      .map(csvCell).join(',')];
    current.check.elements.forEach(function (sym) {
      var b = before.perElement[sym] || { reactants: '', products: '' };
      var a = current.check.perElement[sym];
      rows.push([sym, b.reactants, b.products, a.reactants, a.products, a.equal ? 'yes' : 'no']
        .map(csvCell).join(','));
    });
    if (current.hasCharge) {
      rows.push(['Charge', '', '', current.check.charge.reactants, current.check.charge.products,
        current.check.charge.equal ? 'yes' : 'no'].map(csvCell).join(','));
    }
    download(new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'atom-comparison.csv');
    toast('CSV downloaded.');
  });

  if (el.printBtn) el.printBtn.addEventListener('click', function () { window.print(); });

  /* -------------------------------------------------------------- events */

  if (el.balanceBtn) el.balanceBtn.addEventListener('click', balanceNow);

  el.input.addEventListener('keydown', function (ev) {
    // Enter balances; Shift+Enter keeps the newline for long equations
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      balanceNow();
    }
  });

  var typingTimer = 0;
  el.input.addEventListener('input', function () {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(balanceNow, 260);
  });

  if (el.resetBtn) el.resetBtn.addEventListener('click', function () {
    el.input.value = '';
    el.input.setAttribute('aria-invalid', 'false');
    setStatus(null);
    resetOutput();
    el.input.focus();
  });

  document.querySelectorAll('[data-ceb-example]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      el.input.value = btn.getAttribute('data-ceb-example');
      balanceNow();
      var card = document.getElementById('cebResult');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  if (el.mathToggle && el.math) {
    el.mathToggle.addEventListener('click', function () {
      var open = el.math.hidden;
      el.math.hidden = !open;
      el.mathToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      el.mathToggle.textContent = open ? 'Hide mathematical solution' : 'Show mathematical solution';
    });
  }

  renderHistory();
  resetOutput();
  if (el.input.value.trim()) balanceNow();
})();
