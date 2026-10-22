/* ============================================================
   ToolAdda — GST Calculator (India)

   The whole point of this file is that the numbers reconcile. A GST
   breakdown that shows base + tax ≠ total is worse than useless on an
   invoice, and that is exactly what you get if you compute each line
   independently in floating point and round them separately.

   Two rules are applied everywhere:

     1. All money is held as an integer number of paise. 18% of ₹10,000
        is 180000 paise, not 1800.0000000002.
     2. Exactly one derived figure per breakdown is obtained by
        SUBTRACTION rather than by its own rounded formula, so the
        components always sum to the anchor the user actually typed.

   That second rule is what makes CGST ₹7.63 + SGST ₹7.62 = ₹15.25
   instead of the ₹7.63 + ₹7.63 = ₹15.26 that most calculators print.

   Nothing here is tax advice. The calculator applies the rate the user
   selects; it does not classify supplies or determine liability.

   Layout:
     1.  Money primitives (paise integers)
     2.  Validation
     3.  Core calculation
     4.  Formatting
     5.  Sharing / serialisation helpers
     6.  Engine export
     7.  UI state + DOM
     8.  Rendering
     9.  Actions (copy, share, print, history)
     10. Events + init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. Money primitives

     Everything internal is an integer count of paise. Rupee values
     only exist at the display boundary.
     ============================================================ */

  var MAX_AMOUNT = 1e11;          /* ₹10,000 crore — beyond any invoice */
  var MAX_RATE = 100;             /* leaves room for cess-inclusive rates */

  function toPaise(rupees) {
    return Math.round(rupees * 100);
  }

  function toRupees(paise) {
    return paise / 100;
  }

  /* Parsing "1.005" via parseFloat then multiplying by 100 gives
     100.49999999999999, because 1.005 has no exact binary
     representation — so it rounds DOWN to ₹1.00 when decimal
     arithmetic says ₹1.01. Reading the digits out of the string
     instead removes that whole class of error at the input boundary,
     which is the only place a user's decimal can be misread. */
  function decimalToPaise(text) {
    var match = /^(\d*)(?:\.(\d*))?$/.exec(String(text));
    if (!match) return null;
    var whole = match[1] || '0';
    var frac = match[2] || '';
    if (whole === '' && frac === '') return null;

    var paise = parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    var nextDigit = frac.charAt(2);
    if (nextDigit && parseInt(nextDigit, 10) >= 5) paise += 1;
    return paise;
  }

  /* ============================================================
     2. Validation

     Messages name the field and say what to do. No alert boxes and
     no bare "invalid input".
     ============================================================ */

  function invalid(field, message) {
    return { ok: false, field: field, message: message };
  }

  function validateAmount(raw) {
    if (raw === null || raw === undefined) return invalid('amount', 'Enter an amount to calculate GST.');
    var text = String(raw).replace(/[\s,₹]/g, '');
    if (!text) return invalid('amount', 'Enter an amount to calculate GST.');
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid('amount', 'Enter a valid amount using digits only.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid('amount', 'Enter a valid amount using digits only.');
    if (value < 0) return invalid('amount', 'Amount cannot be negative. Enter a positive value.');
    if (value > MAX_AMOUNT) {
      return invalid('amount', 'Amount is too large. Enter a value up to ₹10,000 crore.');
    }
    var paise = decimalToPaise(text);
    return { ok: true, value: value, paise: paise === null ? toPaise(value) : paise };
  }

  function validateRate(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return invalid('rate', 'Enter a GST rate.');
    }
    var text = String(raw).replace(/[\s%]/g, '');
    if (!/^\d*\.?\d*$/.test(text) || text === '.') {
      return invalid('rate', 'Enter a valid GST rate, for example 18.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid('rate', 'Enter a valid GST rate, for example 18.');
    if (value < 0) return invalid('rate', 'GST rate cannot be negative.');
    if (value > MAX_RATE) return invalid('rate', 'Enter a GST rate between 0% and 100%.');
    return { ok: true, value: value };
  }

  /* ============================================================
     3. Core calculation

     mode        'add'    — the amount entered is the pre-tax base
                 'remove' — the amount entered already includes GST
     transaction 'intra'  — CGST + SGST (or UTGST), each half the GST
                 'inter'  — IGST, the whole GST
     ============================================================ */

  function calculate(input) {
    var amountCheck = validateAmount(input.amount);
    if (!amountCheck.ok) return amountCheck;

    var rateCheck = validateRate(input.rate);
    if (!rateCheck.ok) return rateCheck;

    var rate = rateCheck.value;
    var mode = input.mode === 'remove' ? 'remove' : 'add';
    var transaction = input.transaction === 'inter' ? 'inter' : 'intra';
    var amountPaise = amountCheck.paise;

    var basePaise, gstPaise, totalPaise;

    if (mode === 'add') {
      /* The base is what the user typed, so it is exact. Round the
         tax, then let the total be their sum — it cannot drift. */
      basePaise = amountPaise;
      gstPaise = Math.round(basePaise * rate / 100);
      totalPaise = basePaise + gstPaise;
    } else {
      /* The total is what the user typed. Round the base out of it,
         then take the tax as the remainder for the same reason.

         base = total / (1 + rate/100), rearranged to stay in integers
         as total * 100 / (100 + rate). */
      totalPaise = amountPaise;
      basePaise = Math.round(totalPaise * 100 / (100 + rate));
      gstPaise = totalPaise - basePaise;
    }

    /* Half of an odd number of paise cannot be split evenly, so round
       one half and subtract for the other. CGST takes the extra paisa,
       which is the convention accounting software follows. */
    var cgstPaise = 0;
    var sgstPaise = 0;
    var igstPaise = 0;
    if (transaction === 'intra') {
      cgstPaise = Math.round(gstPaise / 2);
      sgstPaise = gstPaise - cgstPaise;
    } else {
      igstPaise = gstPaise;
    }

    /* Indian tax invoices commonly carry a round-off line that brings
       the payable amount to a whole rupee. */
    var payablePaise = Math.round(totalPaise / 100) * 100;
    var roundOffPaise = payablePaise - totalPaise;

    return {
      ok: true,
      mode: mode,
      transaction: transaction,
      rate: rate,
      base: toRupees(basePaise),
      gst: toRupees(gstPaise),
      total: toRupees(totalPaise),
      cgst: toRupees(cgstPaise),
      sgst: toRupees(sgstPaise),
      igst: toRupees(igstPaise),
      roundOff: toRupees(roundOffPaise),
      payable: toRupees(payablePaise),
      /* Exposed so the UI can prove the breakdown adds up. */
      paise: {
        base: basePaise,
        gst: gstPaise,
        total: totalPaise,
        cgst: cgstPaise,
        sgst: sgstPaise,
        igst: igstPaise
      }
    };
  }

  /* Same amount evaluated at every standard slab, for the comparison
     strip. Reuses calculate() so it can never disagree with the main
     result. */
  var STANDARD_RATES = [0, 3, 5, 12, 18, 28];

  function compareRates(amount, mode, transaction) {
    return STANDARD_RATES.map(function (rate) {
      var r = calculate({ amount: amount, rate: rate, mode: mode, transaction: transaction });
      return r.ok ? { rate: rate, gst: r.gst, total: r.total, base: r.base } : null;
    }).filter(Boolean);
  }

  /* ============================================================
     4. Formatting

     Indian digit grouping throughout (₹1,00,000 not ₹100,000), and
     paise shown only when there are paise — ₹10,000 reads better than
     ₹10,000.00 when the value is exact.
     ============================================================ */

  var groupFormatter = null;
  var decimalFormatter = null;

  function formatINR(value, options) {
    var opts = options || {};
    var n = Number(value);
    if (!isFinite(n)) return '₹0';

    var hasPaise = Math.round(Math.abs(n) * 100) % 100 !== 0;
    var showDecimals = opts.forceDecimals || hasPaise;

    /* The sign belongs outside the symbol: an invoice round-off reads
       -₹0.41, never ₹-0.41. Format the magnitude and re-attach it. */
    var sign = n < 0 ? '-' : '';
    var magnitude = Math.abs(n);

    try {
      if (showDecimals) {
        if (!decimalFormatter) {
          decimalFormatter = new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
          });
        }
        return sign + '₹' + decimalFormatter.format(magnitude);
      }
      if (!groupFormatter) {
        groupFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
      }
      return sign + '₹' + groupFormatter.format(magnitude);
    } catch (e) {
      /* Intl is present everywhere this page runs, but a manual
         fallback costs nothing and keeps output sane if it is not. */
      return sign + '₹' + (showDecimals ? magnitude.toFixed(2) : String(Math.round(magnitude)));
    }
  }

  function formatRate(rate) {
    var n = Number(rate);
    if (!isFinite(n)) return '0%';
    return (Math.round(n * 100) / 100) + '%';
  }

  /* ₹1,23,45,678 -> "1.23 crore" style helper for the large-number hint */
  function describeMagnitude(value) {
    var n = Math.abs(Number(value));
    if (!isFinite(n) || n < 100000) return '';
    if (n >= 10000000) return (Math.round(n / 100000) / 100) + ' crore';
    return (Math.round(n / 1000) / 100) + ' lakh';
  }

  /* ============================================================
     5. Sharing / serialisation
     ============================================================ */

  function resultToText(result) {
    var lines = [
      'GST Calculation',
      '',
      'Base amount:   ' + formatINR(result.base, { forceDecimals: true }),
      'GST rate:      ' + formatRate(result.rate),
      'GST amount:    ' + formatINR(result.gst, { forceDecimals: true })
    ];
    if (result.transaction === 'intra') {
      lines.push('CGST:          ' + formatINR(result.cgst, { forceDecimals: true }));
      lines.push('SGST/UTGST:    ' + formatINR(result.sgst, { forceDecimals: true }));
    } else {
      lines.push('IGST:          ' + formatINR(result.igst, { forceDecimals: true }));
    }
    lines.push('Total amount:  ' + formatINR(result.total, { forceDecimals: true }));
    if (result.roundOff !== 0) {
      lines.push('Round off:     ' + (result.roundOff > 0 ? '+' : '') +
        formatINR(result.roundOff, { forceDecimals: true }));
      lines.push('Payable:       ' + formatINR(result.payable));
    }
    lines.push('');
    lines.push(result.mode === 'add'
      ? 'GST was added to a tax-exclusive amount.'
      : 'GST was removed from a tax-inclusive amount.');
    lines.push('Calculated with tooladda.online/calculators/gst-calculator.html');
    return lines.join('\n');
  }

  /* Query strings are only ever written when the user explicitly asks
     for a shareable link — amounts should not leak into history or
     Referer headers as a side effect of typing. */
  function stateToQuery(state) {
    var params = [];
    params.push('amt=' + encodeURIComponent(state.amount));
    params.push('rate=' + encodeURIComponent(state.rate));
    params.push('mode=' + encodeURIComponent(state.mode));
    params.push('txn=' + encodeURIComponent(state.transaction));
    return '?' + params.join('&');
  }

  function queryToState(search) {
    var out = {};
    var query = String(search || '').replace(/^\?/, '');
    if (!query) return out;
    query.split('&').forEach(function (pair) {
      var bits = pair.split('=');
      var key = decodeURIComponent(bits[0] || '');
      var value = decodeURIComponent((bits[1] || '').replace(/\+/g, ' '));
      if (key === 'amt' && validateAmount(value).ok) out.amount = parseFloat(value);
      if (key === 'rate' && validateRate(value).ok) out.rate = parseFloat(value);
      if (key === 'mode' && (value === 'add' || value === 'remove')) out.mode = value;
      if (key === 'txn' && (value === 'intra' || value === 'inter')) out.transaction = value;
    });
    return out;
  }

  /* ============================================================
     6. Engine export
     ============================================================ */

  var engine = {
    MAX_AMOUNT: MAX_AMOUNT,
    MAX_RATE: MAX_RATE,
    STANDARD_RATES: STANDARD_RATES,
    toPaise: toPaise,
    toRupees: toRupees,
    decimalToPaise: decimalToPaise,
    validateAmount: validateAmount,
    validateRate: validateRate,
    calculate: calculate,
    compareRates: compareRates,
    formatINR: formatINR,
    formatRate: formatRate,
    describeMagnitude: describeMagnitude,
    resultToText: resultToText,
    stateToQuery: stateToQuery,
    queryToState: queryToState
  };

  globalScope.ToolAddaGst = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     7. UI state + DOM
     ============================================================ */

  var PREFS_KEY = 'tooladda-gst-prefs';
  var HISTORY_KEY = 'tooladda-gst-history';

  var state = {
    amount: '10000',
    rate: 18,
    customRate: '',
    mode: 'add',
    transaction: 'intra',
    showRoundOff: false,
    historyEnabled: false,
    result: null
  };

  var dom = {};
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function cacheDom() {
    dom.root = q('[data-gst-app]');
    if (!dom.root) return false;

    dom.modeButtons = qa('[data-gst-mode]', dom.root);
    dom.amount = q('[data-gst-amount]', dom.root);
    dom.amountHint = q('[data-gst-amount-hint]', dom.root);
    dom.amountError = q('[data-gst-amount-error]', dom.root);
    dom.quickAmounts = q('[data-gst-quick-amounts]', dom.root);

    dom.rateButtons = q('[data-gst-rates]', dom.root);
    dom.customRateWrap = q('[data-gst-custom-wrap]', dom.root);
    dom.customRate = q('[data-gst-custom-rate]', dom.root);
    dom.rateError = q('[data-gst-rate-error]', dom.root);

    dom.txnButtons = qa('[data-gst-txn]', dom.root);
    dom.txnNote = q('[data-gst-txn-note]', dom.root);

    dom.calculate = q('[data-gst-calculate]', dom.root);
    dom.reset = q('[data-gst-reset]', dom.root);

    dom.flow = q('[data-gst-flow]', dom.root);
    dom.breakdown = q('[data-gst-breakdown]', dom.root);
    dom.headline = q('[data-gst-headline]', dom.root);
    dom.headlineLabel = q('[data-gst-headline-label]', dom.root);
    dom.reconcile = q('[data-gst-reconcile]', dom.root);
    dom.status = q('[data-gst-status]', dom.root);

    dom.copy = q('[data-gst-copy]', dom.root);
    dom.share = q('[data-gst-share]', dom.root);
    dom.print = q('[data-gst-print]', dom.root);
    dom.link = q('[data-gst-link]', dom.root);

    dom.roundOff = q('[data-gst-roundoff]', dom.root);
    dom.historyToggle = q('[data-gst-history-toggle]', dom.root);
    dom.historyPanel = q('[data-gst-history-panel]', dom.root);
    dom.historyList = q('[data-gst-history-list]', dom.root);
    dom.historyClear = q('[data-gst-history-clear]', dom.root);
    dom.historyEmpty = q('[data-gst-history-empty]', dom.root);

    dom.compare = q('[data-gst-compare]', dom.root);
    dom.printStamp = q('[data-gst-print-stamp]', dom.root);

    return true;
  }

  /* ============================================================
     8. Rendering
     ============================================================ */

  function activeRateValue() {
    return state.rate === 'custom' ? state.customRate : state.rate;
  }

  function renderModeButtons() {
    dom.modeButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-gst-mode') === state.mode;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.amountHint.textContent = state.mode === 'add'
      ? 'Enter the price before GST. Tax will be added on top.'
      : 'Enter the price that already includes GST. Tax will be separated out.';
    var label = q('[data-gst-amount-label]', dom.root);
    if (label) {
      label.textContent = state.mode === 'add' ? 'Amount (before GST)' : 'Amount (including GST)';
    }
  }

  function renderRateButtons() {
    qa('[data-gst-rate]', dom.rateButtons).forEach(function (btn) {
      var value = btn.getAttribute('data-gst-rate');
      var on = value === 'custom' ? state.rate === 'custom' : Number(value) === state.rate;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.customRateWrap.hidden = state.rate !== 'custom';
  }

  function renderTxnButtons() {
    dom.txnButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-gst-txn') === state.transaction;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dom.txnNote.textContent = state.transaction === 'intra'
      ? 'Supplier and buyer in the same state or union territory. GST splits into CGST and SGST — in a union territory the state half is UTGST, with identical arithmetic.'
      : 'Supplier and buyer in different states. The whole GST is charged as a single IGST line.';
  }

  function showError(field, message) {
    var target = field === 'rate' ? dom.rateError : dom.amountError;
    var other = field === 'rate' ? dom.amountError : dom.rateError;
    target.textContent = message;
    target.hidden = false;
    other.hidden = true;
    if (field === 'rate') {
      dom.customRate.setAttribute('aria-invalid', 'true');
      dom.amount.removeAttribute('aria-invalid');
    } else {
      dom.amount.setAttribute('aria-invalid', 'true');
      dom.customRate.removeAttribute('aria-invalid');
    }
    dom.root.classList.add('is-invalid');
    state.result = null;
    setActionsEnabled(false);
    announce(message);
  }

  function clearErrors() {
    dom.amountError.hidden = true;
    dom.rateError.hidden = true;
    dom.amount.removeAttribute('aria-invalid');
    dom.customRate.removeAttribute('aria-invalid');
    dom.root.classList.remove('is-invalid');
  }

  function setActionsEnabled(enabled) {
    [dom.copy, dom.share, dom.print, dom.link].forEach(function (btn) {
      if (btn) btn.disabled = !enabled;
    });
  }

  /* Screen readers should hear the answer, not every keystroke, so the
     announcement is debounced and states only the figures that matter. */
  function announce(message) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      dom.status.textContent = message;
    }, 450);
  }

  function row(label, value, variant, hint) {
    return '<div class="gst-row' + (variant ? ' gst-row--' + variant : '') + '">' +
      '<dt>' + label + (hint ? '<span class="gst-row__hint">' + hint + '</span>' : '') + '</dt>' +
      '<dd>' + value + '</dd></div>';
  }

  function renderResult(result) {
    var isAdd = result.mode === 'add';

    /* Headline: the figure the user actually came for. Adding GST -> the
       total they will pay. Removing GST -> the base hiding inside it. */
    dom.headlineLabel.textContent = isAdd ? 'Total amount payable' : 'Base amount before GST';
    dom.headline.textContent = formatINR(isAdd ? result.total : result.base);

    var rows = '';
    rows += row('Base amount', formatINR(result.base), 'base');
    rows += row('GST rate', formatRate(result.rate), 'rate');
    rows += row('GST amount', formatINR(result.gst), 'gst');
    if (result.transaction === 'intra') {
      rows += row('CGST', formatINR(result.cgst), 'split', formatRate(result.rate / 2));
      rows += row('SGST / UTGST', formatINR(result.sgst), 'split', formatRate(result.rate / 2));
    } else {
      rows += row('IGST', formatINR(result.igst), 'split', formatRate(result.rate));
    }
    rows += row('Total amount', formatINR(result.total), 'total');

    if (state.showRoundOff) {
      var sign = result.roundOff > 0 ? '+' : '';
      rows += row('Round off', result.roundOff === 0 ? '—' : sign + formatINR(result.roundOff), 'roundoff');
      rows += row('Payable (rounded)', formatINR(result.payable), 'payable');
    }
    dom.breakdown.innerHTML = rows;

    /* The visual flow: amount, what happens to it, what comes out. */
    var flowTop = isAdd ? result.base : result.total;
    var flowBottom = isAdd ? result.total : result.base;
    dom.flow.innerHTML =
      '<div class="gst-flow__step"><span class="gst-flow__label">' +
        (isAdd ? 'Base amount' : 'Amount including GST') + '</span>' +
        '<strong>' + formatINR(flowTop) + '</strong></div>' +
      '<div class="gst-flow__op"><span aria-hidden="true">' + (isAdd ? '+' : '−') + '</span>' +
        '<span class="gst-flow__oplabel">' + (isAdd ? 'add' : 'remove') + ' GST @ ' +
        formatRate(result.rate) + '</span>' +
        '<strong>' + formatINR(result.gst) + '</strong></div>' +
      '<div class="gst-flow__step gst-flow__step--out"><span class="gst-flow__label">' +
        (isAdd ? 'Total payable' : 'Base amount') + '</span>' +
        '<strong>' + formatINR(flowBottom) + '</strong></div>';

    /* Reconciliation proof — integer paise, so this is exact. */
    var p = result.paise;
    var splitOk = result.transaction === 'intra'
      ? (p.cgst + p.sgst === p.gst)
      : (p.igst === p.gst);
    dom.reconcile.textContent = (p.base + p.gst === p.total && splitOk)
      ? 'Checked: base + GST = total exactly, to the paisa.'
      : 'Rounding check failed — please report this calculation.';
    dom.reconcile.classList.toggle('is-bad', !(p.base + p.gst === p.total && splitOk));

    renderCompare();
    setActionsEnabled(true);

    var spoken = 'GST calculated. ' +
      (isAdd
        ? 'Base ' + formatINR(result.base) + ' plus ' + formatRate(result.rate) +
          ' GST of ' + formatINR(result.gst) + ' gives a total of ' + formatINR(result.total) + '.'
        : 'Of ' + formatINR(result.total) + ', ' + formatINR(result.gst) +
          ' is GST at ' + formatRate(result.rate) + ' and ' + formatINR(result.base) + ' is the base amount.');
    announce(spoken);
  }

  function renderCompare() {
    if (!dom.compare || !state.result) return;
    var amountValue = validateAmount(state.amount);
    if (!amountValue.ok) { dom.compare.innerHTML = ''; return; }

    var rows = compareRates(amountValue.value, state.mode, state.transaction);
    var current = Number(activeRateValue());
    dom.compare.innerHTML = rows.map(function (r) {
      var on = Math.abs(r.rate - current) < 0.0001;
      return '<button type="button" class="gst-compare__item' + (on ? ' is-on' : '') +
        '" data-gst-compare-rate="' + r.rate + '"' + (on ? ' aria-current="true"' : '') + '>' +
        '<span class="gst-compare__rate">' + formatRate(r.rate) + '</span>' +
        '<span class="gst-compare__gst">GST ' + formatINR(r.gst) + '</span>' +
        '<span class="gst-compare__total">' +
        (state.mode === 'add' ? formatINR(r.total) : formatINR(r.base)) + '</span></button>';
    }).join('');
  }

  function renderPlaceholder(message) {
    dom.headlineLabel.textContent = 'Waiting for an amount';
    dom.headline.textContent = '—';
    dom.breakdown.innerHTML = '<p class="gst-empty">' + message + '</p>';
    dom.flow.innerHTML = '';
    dom.reconcile.textContent = '';
    if (dom.compare) dom.compare.innerHTML = '';
  }

  /* ============================================================
     9. Actions
     ============================================================ */

  function run(options) {
    var silent = options && options.silent;
    clearErrors();

    var raw = dom.amount.value;
    if (!String(raw).trim()) {
      state.result = null;
      setActionsEnabled(false);
      renderPlaceholder('Enter an amount to see the GST breakdown.');
      if (!silent) showError('amount', 'Enter an amount to calculate GST.');
      return;
    }

    var result = calculate({
      amount: raw,
      rate: activeRateValue(),
      mode: state.mode,
      transaction: state.transaction
    });

    if (!result.ok) {
      renderPlaceholder(result.message);
      showError(result.field, result.message);
      return;
    }

    state.amount = String(raw);
    state.result = result;
    renderResult(result);
    savePrefs();
  }

  function pushHistory(result) {
    if (!state.historyEnabled || !result) return;
    var entry = {
      t: Date.now(),
      amount: state.amount,
      rate: result.rate,
      mode: result.mode,
      transaction: result.transaction,
      base: result.base,
      gst: result.gst,
      total: result.total
    };
    var list = loadHistory();
    /* Skip an identical consecutive entry so scrolling a slider does
       not fill the list with near-duplicates. */
    if (list.length && list[0].amount === entry.amount && list[0].rate === entry.rate &&
        list[0].mode === entry.mode && list[0].transaction === entry.transaction) {
      return;
    }
    list.unshift(entry);
    list = list.slice(0, 12);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* quota */ }
    renderHistory();
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function renderHistory() {
    if (!dom.historyList) return;
    var list = state.historyEnabled ? loadHistory() : [];
    dom.historyEmpty.hidden = list.length > 0;
    dom.historyList.innerHTML = list.map(function (e, i) {
      var sign = e.mode === 'add' ? '+' : '−';
      return '<li><button type="button" class="gst-history__item" data-gst-history="' + i + '">' +
        '<span class="gst-history__calc">' + formatINR(e.mode === 'add' ? e.base : e.total) +
        ' ' + sign + ' ' + formatRate(e.rate) + ' GST</span>' +
        '<span class="gst-history__res">' + formatINR(e.mode === 'add' ? e.total : e.base) + '</span>' +
        '</button></li>';
    }).join('');
  }

  function applyHistoryEntry(index) {
    var list = loadHistory();
    var entry = list[index];
    if (!entry) return;
    dom.amount.value = entry.amount;
    state.mode = entry.mode;
    state.transaction = entry.transaction;
    if (STANDARD_RATES.indexOf(entry.rate) !== -1) {
      state.rate = entry.rate;
    } else {
      state.rate = 'custom';
      state.customRate = String(entry.rate);
      dom.customRate.value = String(entry.rate);
    }
    renderModeButtons();
    renderRateButtons();
    renderTxnButtons();
    run();
  }

  function flash(button, text) {
    if (!button) return;
    var original = button.getAttribute('data-gst-label') || button.textContent;
    button.setAttribute('data-gst-label', original);
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1600);
  }

  function copyResult() {
    if (!state.result) return;
    var text = resultToText(state.result);
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flash(dom.copy, 'Copy unavailable');
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      flash(dom.copy, 'Copied ✓');
      dom.status.textContent = 'Calculation copied to the clipboard.';
    }, function () {
      flash(dom.copy, 'Copy failed');
    });
  }

  function shareResult() {
    if (!state.result) return;
    var text = resultToText(state.result);
    if (navigator.share) {
      navigator.share({
        title: 'GST Calculation',
        text: text
      }).catch(function () { /* user dismissed the sheet */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flash(dom.share, 'Copied ✓');
        dom.status.textContent = 'Sharing is not available in this browser, so the calculation was copied instead.';
      });
      return;
    }
    flash(dom.share, 'Unavailable');
  }

  function copyLink() {
    if (!state.result) return;
    var url = location.origin + location.pathname + stateToQuery({
      amount: state.amount,
      rate: activeRateValue(),
      mode: state.mode,
      transaction: state.transaction
    });
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flash(dom.link, 'Unavailable');
      return;
    }
    navigator.clipboard.writeText(url).then(function () {
      flash(dom.link, 'Link copied ✓');
      dom.status.textContent = 'A link containing this calculation was copied to the clipboard.';
    }, function () {
      flash(dom.link, 'Copy failed');
    });
  }

  function printResult() {
    if (dom.printStamp) {
      try {
        dom.printStamp.textContent = 'Generated ' + new Date().toLocaleString('en-IN', {
          dateStyle: 'medium', timeStyle: 'short'
        });
      } catch (e) {
        dom.printStamp.textContent = 'Generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
      }
    }
    window.print();
  }

  /* ============================================================
     10. Preferences, events, init

     Only interface preferences are stored. Amounts are never written
     to localStorage unless the user switches history on themselves.
     ============================================================ */

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        rate: state.rate,
        customRate: state.customRate,
        mode: state.mode,
        transaction: state.transaction,
        showRoundOff: state.showRoundOff,
        historyEnabled: state.historyEnabled
      }));
    } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.rate === 'custom' || STANDARD_RATES.indexOf(saved.rate) !== -1) state.rate = saved.rate;
      if (typeof saved.customRate === 'string') state.customRate = saved.customRate;
      if (saved.mode === 'add' || saved.mode === 'remove') state.mode = saved.mode;
      if (saved.transaction === 'intra' || saved.transaction === 'inter') state.transaction = saved.transaction;
      if (typeof saved.showRoundOff === 'boolean') state.showRoundOff = saved.showRoundOff;
      if (typeof saved.historyEnabled === 'boolean') state.historyEnabled = saved.historyEnabled;
    } catch (e) { /* corrupt prefs fall back to defaults */ }
  }

  function bindEvents() {
    dom.modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.getAttribute('data-gst-mode');
        renderModeButtons();
        run({ silent: true });
        savePrefs();
      });
    });

    dom.rateButtons.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-gst-rate]');
      if (!btn) return;
      var value = btn.getAttribute('data-gst-rate');
      state.rate = value === 'custom' ? 'custom' : Number(value);
      renderRateButtons();
      if (state.rate === 'custom') {
        dom.customRate.focus();
        if (!dom.customRate.value) return;
      }
      run({ silent: true });
      savePrefs();
    });

    dom.customRate.addEventListener('input', function () {
      state.customRate = dom.customRate.value;
      if (state.rate === 'custom') run({ silent: true });
      savePrefs();
    });

    dom.txnButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.transaction = btn.getAttribute('data-gst-txn');
        renderTxnButtons();
        run({ silent: true });
        savePrefs();
      });
    });

    dom.amount.addEventListener('input', function () { run({ silent: true }); });
    dom.amount.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); run(); pushHistory(state.result); }
    });

    dom.quickAmounts.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-gst-quick]');
      if (!btn) return;
      dom.amount.value = btn.getAttribute('data-gst-quick');
      run();
      dom.amount.focus();
    });

    dom.calculate.addEventListener('click', function () {
      run();
      pushHistory(state.result);
    });

    dom.reset.addEventListener('click', function () {
      state.mode = 'add';
      state.rate = 18;
      state.customRate = '';
      state.transaction = 'intra';
      state.showRoundOff = false;
      dom.amount.value = '10000';
      dom.customRate.value = '';
      dom.roundOff.checked = false;
      renderModeButtons();
      renderRateButtons();
      renderTxnButtons();
      run();
      savePrefs();
      dom.status.textContent = 'Calculator reset to defaults.';
    });

    dom.roundOff.addEventListener('change', function () {
      state.showRoundOff = dom.roundOff.checked;
      if (state.result) renderResult(state.result);
      savePrefs();
    });

    dom.copy.addEventListener('click', copyResult);
    dom.share.addEventListener('click', shareResult);
    dom.print.addEventListener('click', printResult);
    if (dom.link) dom.link.addEventListener('click', copyLink);

    if (dom.compare) {
      dom.compare.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-gst-compare-rate]');
        if (!btn) return;
        state.rate = Number(btn.getAttribute('data-gst-compare-rate'));
        renderRateButtons();
        run();
        savePrefs();
      });
    }

    dom.historyToggle.addEventListener('change', function () {
      state.historyEnabled = dom.historyToggle.checked;
      dom.historyPanel.hidden = !state.historyEnabled;
      if (!state.historyEnabled) {
        try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
      }
      renderHistory();
      savePrefs();
    });

    dom.historyClear.addEventListener('click', function () {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
      renderHistory();
      dom.status.textContent = 'Calculation history cleared.';
    });

    dom.historyList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-gst-history]');
      if (btn) applyHistoryEntry(Number(btn.getAttribute('data-gst-history')));
    });
  }

  function init() {
    if (!cacheDom()) return;

    loadPrefs();

    /* A shared link wins over saved preferences — someone following a
       link expects to see that calculation, not their own last one. */
    var shared = queryToState(location.search);
    if (shared.mode) state.mode = shared.mode;
    if (shared.transaction) state.transaction = shared.transaction;
    if (typeof shared.rate === 'number') {
      if (STANDARD_RATES.indexOf(shared.rate) !== -1) {
        state.rate = shared.rate;
      } else {
        state.rate = 'custom';
        state.customRate = String(shared.rate);
      }
    }
    if (typeof shared.amount === 'number') state.amount = String(shared.amount);

    dom.amount.value = state.amount;
    dom.customRate.value = state.customRate;
    dom.roundOff.checked = state.showRoundOff;
    dom.historyToggle.checked = state.historyEnabled;
    dom.historyPanel.hidden = !state.historyEnabled;

    renderModeButtons();
    renderRateButtons();
    renderTxnButtons();
    renderHistory();
    bindEvents();

    run({ silent: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
