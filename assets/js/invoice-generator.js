/* ==========================================================================
   ToolAdda — Offline Invoice Generator (studio UI)

   Binds the form to InvoiceEngine.computeInvoice, paints a live A4 preview,
   autosaves a draft locally, and lazy-loads jsPDF only when the user asks
   for a download. Standard PDF fonts have no rupee glyph, so the PDF uses
   "Rs." while the on-screen preview may show ₹.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.InvoiceEngine;
  if (!E) return;

  var DRAFT_KEY = 'tooladda-invoice-draft';
  var SELLER_KEY = 'tooladda-invoice-seller';
  var SEQ_KEY = 'tooladda-invoice-seq';
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  var state = E.sampleInvoice();
  var model = E.computeInvoice(state);
  var libCache = {};
  var frame = 0;
  var saveTimer = 0;
  var statusTimer = 0;
  var isSample = true;

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }

  function status(message, tone) {
    var el = $('invStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone || 'info';
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(function () { el.textContent = ''; }, 4200);
  }

  function money(paise) {
    return E.formatMoney(paise, state.currency);
  }

  function hexToRgb(hex) {
    var n = parseInt(String(hex || '#4338ca').replace('#', ''), 16);
    if (!isFinite(n)) n = 0x4338ca;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function pdfSafe(s) {
    return String(s == null ? '' : s)
      .replace(/₹/g, 'Rs.')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/[^ -ÿ]/g, '');
  }

  function loadScript(url) {
    if (libCache[url]) return libCache[url];
    libCache[url] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = res;
      s.onerror = function () { libCache[url] = null; rej(new Error('Could not load PDF engine')); };
      document.head.appendChild(s);
    });
    return libCache[url];
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.innerHTML = label || 'Working…';
      btn.disabled = true;
    } else {
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
      btn.disabled = false;
    }
  }

  function readSeller() {
    try { return JSON.parse(localStorage.getItem(SELLER_KEY) || 'null'); } catch (e) { return null; }
  }

  function writeSeller() {
    try {
      localStorage.setItem(SELLER_KEY, JSON.stringify({
        from: state.from,
        bank: state.bank,
        taxMode: state.taxMode,
        taxSplit: state.taxSplit,
        currency: state.currency,
        numberPrefix: state.numberPrefix,
        accent: state.accent,
        template: state.template,
        terms: state.terms
      }));
    } catch (e) {}
  }

  function nextSeq() {
    var n = 1;
    try { n = parseInt(localStorage.getItem(SEQ_KEY), 10) || 1; } catch (e) {}
    return n;
  }

  function bumpSeq() {
    var n = Math.max(state.numberSeq, nextSeq()) + 1;
    try { localStorage.setItem(SEQ_KEY, String(n)); } catch (e) {}
    return n;
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), invoice: state, sample: isSample }));
    } catch (e) {}
  }

  function loadDraft() {
    try {
      var raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (raw && raw.invoice && raw.at && Date.now() - raw.at < 1000 * 60 * 60 * 24 * 90) {
        return raw;
      }
    } catch (e) {}
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Form ↔ state                                                       */
  /* ------------------------------------------------------------------ */

  function applyPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function readField(el) {
    var kind = el.getAttribute('data-kind') || 'text';
    if (el.type === 'checkbox') return el.checked;
    if (kind === 'paise') return E.decimalToPaise(el.value);
    if (kind === 'milles') return E.decimalToMilles(el.value);
    if (kind === 'number') return parseFloat(el.value) || 0;
    return el.value;
  }

  function writeField(el, value) {
    var kind = el.getAttribute('data-kind') || 'text';
    if (el.type === 'checkbox') { el.checked = !!value; return; }
    if (kind === 'paise') { el.value = value ? E.paiseToMajor(value).toFixed(2) : ''; return; }
    if (kind === 'milles') { el.value = E.millesToQty(value || 0); return; }
    if (value === undefined || value === null) { el.value = ''; return; }
    el.value = value;
  }

  function readForm() {
    all('[data-inv]').forEach(function (el) {
      applyPath(state, el.getAttribute('data-inv'), readField(el));
    });
    state.items = all('.inv-line').map(function (row) {
      function v(name) {
        var n = row.querySelector('[data-line="' + name + '"]');
        return n ? readField(n) : '';
      }
      return {
        desc: v('desc'),
        hsn: v('hsn'),
        unit: v('unit'),
        qtyMilles: v('qty'),
        ratePaise: v('rate'),
        discountPct: v('disc'),
        taxRate: v('tax')
      };
    });
    if (!state.items.length) state.items = [E.defaultLine()];
    state = E.normalize(state);
  }

  function writeForm() {
    all('[data-inv]').forEach(function (el) {
      var parts = el.getAttribute('data-inv').split('.');
      var cur = state;
      var i;
      for (i = 0; i < parts.length; i++) {
        if (cur == null) break;
        cur = cur[parts[i]];
      }
      writeField(el, cur);
    });
    renderLineEditor();
  }

  function renderLineEditor() {
    var wrap = $('invLines');
    if (!wrap) return;
    wrap.innerHTML = '';
    state.items.forEach(function (line, i) {
      wrap.appendChild(lineRow(line, i));
    });
  }

  function lineRow(line, index) {
    var row = document.createElement('div');
    row.className = 'inv-line';
    row.setAttribute('data-index', String(index));

    function field(label, name, value, extra) {
      var lab = document.createElement('label');
      lab.className = 'inv-field';
      var span = document.createElement('span');
      span.textContent = label;
      var input = document.createElement('input');
      input.className = 'inv-input';
      input.setAttribute('data-line', name);
      if (extra) {
        if (extra.kind) input.setAttribute('data-kind', extra.kind);
        if (extra.inputmode) input.setAttribute('inputmode', extra.inputmode);
        if (extra.placeholder) input.placeholder = extra.placeholder;
      }
      writeField(input, value);
      lab.appendChild(span);
      lab.appendChild(input);
      return lab;
    }

    row.appendChild(field('Description', 'desc', line.desc, { placeholder: 'What you sold' }));
    row.appendChild(field('HSN / SAC', 'hsn', line.hsn, { placeholder: '998314' }));
    row.appendChild(field('Unit', 'unit', line.unit, { placeholder: 'pcs' }));
    row.appendChild(field('Qty', 'qty', line.qtyMilles, { kind: 'milles', inputmode: 'decimal' }));
    row.appendChild(field('Rate', 'rate', line.ratePaise, { kind: 'paise', inputmode: 'decimal' }));
    row.appendChild(field('Disc %', 'disc', line.discountPct, { kind: 'number', inputmode: 'decimal' }));
    row.appendChild(field('Tax %', 'tax', line.taxRate, { kind: 'number', inputmode: 'decimal' }));

    var actions = document.createElement('div');
    actions.className = 'inv-line__actions';
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'inv-btn inv-btn--ghost inv-btn--sm';
    del.textContent = 'Remove';
    del.setAttribute('aria-label', 'Remove line ' + (index + 1));
    on(del, 'click', function () {
      if (state.items.length <= 1) {
        state.items = [E.defaultLine()];
      } else {
        state.items.splice(index, 1);
      }
      isSample = false;
      writeForm();
      schedule();
    });
    actions.appendChild(del);
    row.appendChild(actions);
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Live A4 preview                                                    */
  /* ------------------------------------------------------------------ */

  function previewHtml(m) {
    var inv = m.invoice;
    var esc = E.escapeHtml;
    var accent = esc(inv.accent);
    var logo = E.safeLogo(inv.from.logo);
    var showTax = inv.taxMode !== 'none';
    var rows = m.lines.map(function (line, i) {
      var hsn = line.hsn ? '<div class="inv-sheet__hsn">HSN ' + esc(line.hsn) + '</div>' : '';
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><strong>' + esc(line.desc || '—') + '</strong>' + hsn + '</td>' +
        '<td>' + esc(E.millesToQty(line.qtyMilles)) + ' ' + esc(line.unit) + '</td>' +
        '<td class="num">' + esc(money(line.ratePaise)) + '</td>' +
        (showTax ? '<td class="num">' + esc(String(line.taxRate)) + '%</td>' : '') +
        '<td class="num">' + esc(money(line.totalPaise)) + '</td>' +
        '</tr>';
    }).join('');

    var taxRows = '';
    if (showTax && inv.taxSplit === 'intra') {
      taxRows += tot('CGST', m.cgstPaise) + tot('SGST', m.sgstPaise);
    } else if (showTax && inv.taxSplit === 'inter') {
      taxRows += tot('IGST', m.igstPaise);
    } else if (showTax) {
      taxRows += tot('Tax', m.vatPaise || m.taxPaise);
    }

    function tot(label, paise, cls) {
      if (!paise && label !== 'Total' && label !== 'Balance due') return '';
      return '<div class="inv-tot' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><strong>' + esc(money(paise)) + '</strong></div>';
    }

    var ship = '';
    if (inv.shippingPaise) ship = tot('Shipping', inv.taxMode === 'exclusive' ? m.shippingTaxablePaise : inv.shippingPaise);

    var logoHtml = logo ? '<img class="inv-sheet__logo" src="' + logo + '" alt="">' : '';
    var fromBits = [esc(inv.from.address).replace(/\n/g, '<br>'), inv.from.email ? esc(inv.from.email) : '', inv.from.phone ? esc(inv.from.phone) : '']
      .filter(Boolean).join('<br>');
    var gstin = inv.from.gstin ? '<div>GSTIN: ' + esc(inv.from.gstin) + '</div>' : '';
    var pan = inv.from.pan ? '<div>PAN: ' + esc(inv.from.pan) + '</div>' : '';
    var toGst = inv.to.gstin ? '<div>GSTIN: ' + esc(inv.to.gstin) + '</div>' : '';
    var rcm = inv.reverseCharge ? '<div class="inv-sheet__badge">Reverse charge</div>' : '';
    var pos = inv.placeOfSupply ? '<div>Place of supply: ' + esc(inv.placeOfSupply) + '</div>' : '';

    var bank = '';
    if (inv.bank.name || inv.bank.acc || inv.bank.upi) {
      bank = '<div class="inv-sheet__bank"><h4>Bank details</h4>' +
        (inv.bank.name ? '<div>' + esc(inv.bank.name) + '</div>' : '') +
        (inv.bank.acc ? '<div>A/c ' + esc(inv.bank.acc) + '</div>' : '') +
        (inv.bank.ifsc ? '<div>IFSC ' + esc(inv.bank.ifsc) + '</div>' : '') +
        (inv.bank.upi ? '<div>UPI ' + esc(inv.bank.upi) + '</div>' : '') +
        '</div>';
    }

    var notes = inv.notes ? '<div class="inv-sheet__notes"><h4>Notes</h4><p>' + esc(inv.notes).replace(/\n/g, '<br>') + '</p></div>' : '';
    var terms = inv.terms ? '<div class="inv-sheet__notes"><h4>Terms</h4><p>' + esc(inv.terms).replace(/\n/g, '<br>') + '</p></div>' : '';

    return '<article class="inv-sheet inv-sheet--' + esc(inv.template) + '" style="--inv-accent:' + accent + '">' +
      '<header class="inv-sheet__head">' +
        '<div class="inv-sheet__from">' + logoHtml +
          '<h2>' + esc(inv.from.name || 'Your business') + '</h2>' +
          '<div class="inv-sheet__meta">' + fromBits + gstin + pan + '</div>' +
        '</div>' +
        '<div class="inv-sheet__doc">' +
          '<p class="inv-sheet__label">' + esc(E.docLabel(inv.docType)) + '</p>' +
          '<p class="inv-sheet__num">' + esc(inv.number) + '</p>' +
          '<div>Date: ' + esc(E.formatDate(inv.issueDate)) + '</div>' +
          (inv.dueDate ? '<div>Due: ' + esc(E.formatDate(inv.dueDate)) + '</div>' : '') +
          rcm + pos +
        '</div>' +
      '</header>' +
      '<section class="inv-sheet__bill">' +
        '<h3>Bill to</h3>' +
        '<strong>' + esc(inv.to.name || 'Client') + '</strong>' +
        '<div>' + esc(inv.to.address).replace(/\n/g, '<br>') + '</div>' +
        toGst +
        (inv.to.email ? '<div>' + esc(inv.to.email) + '</div>' : '') +
      '</section>' +
      '<table class="inv-sheet__table">' +
        '<thead><tr><th>#</th><th>Description</th><th>Qty</th><th class="num">Rate</th>' +
        (showTax ? '<th class="num">Tax</th>' : '') +
        '<th class="num">Amount</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '<div class="inv-sheet__foot">' +
        '<div class="inv-sheet__words"><h4>Amount in words</h4><p>' + esc(m.words) + '</p>' + bank + notes + terms + '</div>' +
        '<div class="inv-sheet__totals">' +
          tot('Taxable', m.subtotalPaise) +
          tot('Invoice discount', -m.invoiceDiscountPaise) +
          ship +
          taxRows +
          (m.roundOffPaise ? tot('Round off', m.roundOffPaise) : '') +
          tot('Total', m.payablePaise, 'inv-tot--grand') +
          (m.paidPaise ? tot('Paid', m.paidPaise) + tot('Balance due', m.balancePaise, 'inv-tot--due') : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderWarnings(m) {
    var box = $('invWarnings');
    if (!box) return;
    var list = E.warnings(m);
    var gstFrom = E.validateGstin(m.invoice.from.gstin);
    var gstTo = E.validateGstin(m.invoice.to.gstin);
    if (!gstFrom.ok) list.push({ message: 'Your GSTIN: ' + gstFrom.message });
    if (!gstTo.ok) list.push({ message: 'Client GSTIN: ' + gstTo.message });
    box.innerHTML = '';
    list.forEach(function (w) {
      var p = document.createElement('p');
      p.textContent = w.message;
      box.appendChild(p);
    });
    box.hidden = !list.length;
  }

  function render() {
    model = E.computeInvoice(state);
    var page = $('invPreview');
    if (page) page.innerHTML = previewHtml(model);
    var payable = $('invPayable');
    if (payable) payable.textContent = money(model.payablePaise);
    var offline = $('invOfflineBadge');
    if (offline && navigator.serviceWorker && navigator.serviceWorker.controller) {
      offline.hidden = false;
    }
    renderWarnings(model);
    var sampleNote = $('invSampleNote');
    if (sampleNote) sampleNote.hidden = !isSample;
    requestAnimationFrame(fitPreview);
  }

  var SHEET_PX = 794;

  function stageInnerWidth(stage) {
    var cs = window.getComputedStyle(stage);
    var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return stage.clientWidth - pad;
  }

  function fitPreview() {
    var stage = $('invStage');
    var fit = $('invFit');
    var page = $('invPreview');
    if (!stage || !fit || !page || !page.firstElementChild) return;
    if (stage.clientWidth < 40) return;
    var avail = Math.max(140, stageInnerWidth(stage));
    var z = Math.min(1, avail / SHEET_PX);
    page.style.transform = 'scale(' + z + ')';
    fit.style.width = Math.round(SHEET_PX * z) + 'px';
    fit.style.height = Math.round(page.offsetHeight * z) + 'px';
  }

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      readForm();
      render();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 400);
    });
  }

  /* ------------------------------------------------------------------ */
  /* PDF                                                                */
  /* ------------------------------------------------------------------ */

  function drawInvoice(doc, m) {
    var inv = m.invoice;
    var L = 14, R = 196, y = 16;
    var serif = inv.template === 'classic';
    var F = serif ? 'times' : 'helvetica';
    var ink = [17, 24, 39], ink2 = [55, 65, 81], ink3 = [107, 114, 128], rule = [226, 232, 240];
    var brand = hexToRgb(inv.accent);
    var showTax = inv.taxMode !== 'none';
    var moneyPdf = function (p) { return E.formatMoney(p, inv.currency, { pdf: true }); };

    function set(sz, st, c) {
      doc.setFont(F, st || 'normal');
      doc.setFontSize(sz);
      c = c || ink;
      doc.setTextColor(c[0], c[1], c[2]);
    }
    function line(x1, y1, x2, y2, c, w) {
      c = c || rule;
      doc.setDrawColor(c[0], c[1], c[2]);
      doc.setLineWidth(w || 0.2);
      doc.line(x1, y1, x2, y2);
    }
    function clip(txt, w) {
      return doc.splitTextToSize(pdfSafe(txt), w)[0] || '';
    }
    function wrap(txt, w, max) {
      return doc.splitTextToSize(pdfSafe(txt || ''), w).slice(0, max || 6);
    }
    function ensure(need) {
      if (y + need < 280) return;
      doc.addPage();
      y = 16;
    }

    if (inv.template === 'modern') {
      doc.setFillColor(brand[0], brand[1], brand[2]);
      doc.rect(0, 0, 210, 8, 'F');
      y = 18;
    }

    var logo = E.safeLogo(inv.from.logo);
    if (logo && /^data:image\/(png|jpe?g)/i.test(logo)) {
      try {
        var fmt = /jpeg/i.test(logo) ? 'JPEG' : 'PNG';
        doc.addImage(logo, fmt, L, y - 4, 18, 18);
      } catch (e) {}
    }

    var textX = logo ? L + 22 : L;
    set(13, 'bold', ink);
    doc.text(clip(inv.from.name || 'Your business', 90), textX, y + 2);
    var hy = y + 7;
    set(8, 'normal', ink2);
    wrap(inv.from.address, 90, 4).forEach(function (ln) { doc.text(ln, textX, hy); hy += 3.4; });
    if (inv.from.email || inv.from.phone) {
      set(7.4, 'normal', ink3);
      doc.text(pdfSafe([inv.from.email, inv.from.phone].filter(Boolean).join('  ·  ')), textX, hy);
      hy += 3.4;
    }
    if (inv.from.gstin) { set(7.6, 'bold', ink2); doc.text(pdfSafe('GSTIN: ' + inv.from.gstin), textX, hy); hy += 3.4; }
    if (inv.from.pan) { set(7.4, 'normal', ink3); doc.text(pdfSafe('PAN: ' + inv.from.pan), textX, hy); hy += 3.4; }

    set(8, 'normal', ink3);
    doc.text(pdfSafe(E.docLabel(inv.docType).toUpperCase()), R, y, { align: 'right' });
    set(14, 'bold', brand);
    doc.text(pdfSafe(inv.number), R, y + 7, { align: 'right' });
    set(8, 'normal', ink2);
    doc.text(pdfSafe('Date: ' + E.formatDate(inv.issueDate)), R, y + 13, { align: 'right' });
    if (inv.dueDate) doc.text(pdfSafe('Due: ' + E.formatDate(inv.dueDate)), R, y + 17.5, { align: 'right' });
    if (inv.placeOfSupply) {
      set(7.4, 'normal', ink3);
      doc.text(pdfSafe('Place of supply: ' + inv.placeOfSupply), R, y + 22, { align: 'right' });
    }

    y = Math.max(hy, y + 24) + 4;
    line(L, y, R, y, brand, 0.7);
    y += 7;

    set(7.2, 'bold', ink3);
    doc.text('BILL TO', L, y);
    y += 4.5;
    set(10, 'bold', ink);
    doc.text(clip(inv.to.name || 'Client', 100), L, y);
    y += 4.2;
    set(8, 'normal', ink2);
    wrap(inv.to.address, 100, 4).forEach(function (ln) { doc.text(ln, L, y); y += 3.4; });
    if (inv.to.gstin) { set(7.6, 'bold', ink2); doc.text(pdfSafe('GSTIN: ' + inv.to.gstin), L, y); y += 3.6; }
    if (inv.reverseCharge) { set(7.4, 'bold', brand); doc.text('Reverse charge applicable', L, y); y += 4; }
    y += 3;

    var cols = showTax
      ? [{ w: 8, h: '#' }, { w: 78, h: 'Description' }, { w: 22, h: 'Qty' }, { w: 26, h: 'Rate' }, { w: 16, h: 'Tax' }, { w: 32, h: 'Amount' }]
      : [{ w: 8, h: '#' }, { w: 90, h: 'Description' }, { w: 24, h: 'Qty' }, { w: 28, h: 'Rate' }, { w: 32, h: 'Amount' }];

    function headerRow() {
      doc.setFillColor(248, 250, 252);
      doc.rect(L, y, R - L, 7, 'F');
      var x = L;
      set(7.2, 'bold', ink3);
      cols.forEach(function (c, i) {
        var align = i >= 2 ? 'right' : 'left';
        var tx = align === 'right' ? x + c.w - 1.6 : x + 1.6;
        doc.text(c.h, tx, y + 4.6, { align: align });
        x += c.w;
      });
      y += 7;
    }
    headerRow();

    m.lines.forEach(function (ln, i) {
      var descLines = wrap((ln.desc || '—') + (ln.hsn ? '\nHSN ' + ln.hsn : ''), cols[1].w - 4, 3);
      var h = Math.max(8, descLines.length * 3.6 + 4);
      ensure(h + 8);
      if (i % 2) {
        doc.setFillColor(252, 252, 253);
        doc.rect(L, y, R - L, h, 'F');
      }
      var x = L;
      var cells = showTax
        ? [String(i + 1), descLines, E.millesToQty(ln.qtyMilles) + ' ' + ln.unit, moneyPdf(ln.ratePaise), ln.taxRate + '%', moneyPdf(ln.totalPaise)]
        : [String(i + 1), descLines, E.millesToQty(ln.qtyMilles) + ' ' + ln.unit, moneyPdf(ln.ratePaise), moneyPdf(ln.totalPaise)];
      cells.forEach(function (cell, ci) {
        var c = cols[ci];
        var align = ci >= 2 ? 'right' : 'left';
        var tx = align === 'right' ? x + c.w - 1.6 : x + 1.6;
        set(ci === 1 ? 8 : 7.6, ci === 0 ? 'bold' : 'normal', ink);
        if (Array.isArray(cell)) {
          cell.forEach(function (row, ri) {
            set(ri ? 6.8 : 8, ri ? 'normal' : 'normal', ri ? ink3 : ink);
            doc.text(row, tx, y + 4 + ri * 3.4);
          });
        } else {
          doc.text(pdfSafe(cell), tx, y + 4.8, { align: align });
        }
        x += c.w;
      });
      y += h;
    });

    line(L, y, R, y, rule, 0.3);
    y += 6;

    var totals = [];
    totals.push(['Taxable', m.subtotalPaise]);
    if (m.invoiceDiscountPaise) totals.push(['Invoice discount', -m.invoiceDiscountPaise]);
    if (inv.shippingPaise) totals.push(['Shipping', inv.taxMode === 'exclusive' ? m.shippingTaxablePaise : inv.shippingPaise]);
    if (showTax && inv.taxSplit === 'intra') {
      totals.push(['CGST', m.cgstPaise]);
      totals.push(['SGST', m.sgstPaise]);
    } else if (showTax && inv.taxSplit === 'inter') {
      totals.push(['IGST', m.igstPaise]);
    } else if (showTax) {
      totals.push(['Tax', m.vatPaise || m.taxPaise]);
    }
    if (m.roundOffPaise) totals.push(['Round off', m.roundOffPaise]);
    totals.push(['Total', m.payablePaise]);
    if (m.paidPaise) {
      totals.push(['Paid', m.paidPaise]);
      totals.push(['Balance due', m.balancePaise]);
    }

    ensure(totals.length * 6 + 28);
    var tx = 118;
    totals.forEach(function (row, i) {
      var last = i === totals.length - 1 || row[0] === 'Balance due';
      if (last) {
        doc.setFillColor(brand[0], brand[1], brand[2]);
        doc.rect(tx, y - 3.5, R - tx, 7.2, 'F');
        set(8.5, 'bold', [255, 255, 255]);
      } else {
        set(8, row[0] === 'Total' ? 'bold' : 'normal', ink2);
      }
      doc.text(pdfSafe(row[0]), tx + 2, y);
      doc.text(pdfSafe(moneyPdf(row[1])), R - 2, y, { align: 'right' });
      y += 6.2;
    });

    y += 4;
    ensure(22);
    set(7.2, 'bold', ink3);
    doc.text('AMOUNT IN WORDS', L, y);
    y += 4.2;
    set(8.5, 'italic', ink);
    wrap(m.words, 96, 3).forEach(function (ln) { doc.text(ln, L, y); y += 3.8; });

    if (inv.bank.name || inv.bank.acc || inv.bank.upi) {
      y += 3;
      ensure(20);
      set(7.2, 'bold', ink3);
      doc.text('BANK DETAILS', L, y);
      y += 4;
      set(8, 'normal', ink2);
      [inv.bank.name, inv.bank.acc ? 'A/c ' + inv.bank.acc : '', inv.bank.ifsc ? 'IFSC ' + inv.bank.ifsc : '', inv.bank.upi ? 'UPI ' + inv.bank.upi : '']
        .filter(Boolean)
        .forEach(function (ln) { doc.text(pdfSafe(ln), L, y); y += 3.5; });
    }

    if (inv.notes) {
      y += 3;
      ensure(16);
      set(7.2, 'bold', ink3);
      doc.text('NOTES', L, y);
      y += 4;
      set(8, 'normal', ink2);
      wrap(inv.notes, 180, 5).forEach(function (ln) { doc.text(ln, L, y); y += 3.5; });
    }
    if (inv.terms) {
      y += 3;
      ensure(16);
      set(7.2, 'bold', ink3);
      doc.text('TERMS', L, y);
      y += 4;
      set(8, 'normal', ink2);
      wrap(inv.terms, 180, 5).forEach(function (ln) { doc.text(ln, L, y); y += 3.5; });
    }

    set(6.8, 'normal', ink3);
    doc.text('Generated on this device with ToolAdda Offline Invoice Generator. Not an e-invoice under GSTN.', L, 290);
  }

  function filename() {
    var slug = String(state.number || 'invoice').replace(/[^\w.-]+/g, '-');
    return slug + '.pdf';
  }

  function downloadPdf() {
    var btn = $('invDownloadPdf');
    readForm();
    model = E.computeInvoice(state);
    busy(btn, true, 'Building PDF…');
    loadScript(JSPDF_URL).then(function () {
      if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF engine unavailable');
      var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      drawInvoice(doc, model);
      doc.save(filename());
      writeSeller();
      bumpSeq();
      status('PDF saved on this device. Nothing was uploaded.', 'good');
    }).catch(function () {
      status('PDF engine could not load. Use Print instead — it works fully offline.', 'bad');
      var printBtn = $('invPrint');
      if (printBtn) printBtn.focus();
    }).then(function () { busy(btn, false); });
  }

  function printInvoice() {
    readForm();
    render();
    window.print();
  }

  function downloadJson() {
    readForm();
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.number || 'invoice') + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    status('JSON backup saved locally.', 'good');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result || ''));
        state = E.normalize(parsed);
        isSample = false;
        writeForm();
        render();
        saveDraft();
        status('Invoice restored from JSON.', 'good');
      } catch (e) {
        status('That file is not a valid invoice JSON backup.', 'bad');
      }
    };
    reader.readAsText(file);
  }

  function newInvoice(keepSeller) {
    var next = keepSeller ? E.defaultInvoice() : E.defaultInvoice();
    var seq = Math.max(nextSeq(), 1);
    next.numberSeq = seq;
    next.number = E.nextNumber(next.numberPrefix, seq);
    if (keepSeller) {
      var saved = readSeller();
      if (saved) {
        if (saved.from) next.from = saved.from;
        if (saved.bank) next.bank = saved.bank;
        if (saved.taxMode) next.taxMode = saved.taxMode;
        if (saved.taxSplit) next.taxSplit = saved.taxSplit;
        if (saved.currency) next.currency = saved.currency;
        if (saved.numberPrefix) next.numberPrefix = saved.numberPrefix;
        if (saved.accent) next.accent = saved.accent;
        if (saved.template) next.template = saved.template;
        if (saved.terms) next.terms = saved.terms;
        next.number = E.nextNumber(next.numberPrefix, seq);
      }
    }
    state = E.normalize(next);
    isSample = false;
    writeForm();
    render();
    saveDraft();
  }

  function loadLogo(file) {
    if (!file) return;
    if (file.size > 600000) {
      status('Logo is too large. Use a PNG or JPEG under 600 KB.', 'bad');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var logo = E.safeLogo(String(reader.result || ''));
      if (!logo) {
        status('Logo must be a PNG, JPEG, WebP, GIF or SVG data image.', 'bad');
        return;
      }
      state.from.logo = logo;
      isSample = false;
      render();
      saveDraft();
      status('Logo added. It stays in this browser only.', 'good');
    };
    reader.readAsDataURL(file);
  }

  /* ------------------------------------------------------------------ */
  /* Bind                                                               */
  /* ------------------------------------------------------------------ */

  function bind() {
    var form = $('invForm');
    on(form, 'input', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('[data-inv], .inv-line')) {
        isSample = false;
        schedule();
      }
    });
    on(form, 'change', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('[data-inv], .inv-line')) {
        isSample = false;
        schedule();
      }
    });

    on($('invAddLine'), 'click', function () {
      readForm();
      if (state.items.length >= 40) {
        status('40 lines is the maximum on one invoice.', 'bad');
        return;
      }
      var line = E.defaultLine();
      if (state.items.length) line.taxRate = state.items[0].taxRate;
      state.items.push(line);
      isSample = false;
      writeForm();
      schedule();
    });

    on($('invDownloadPdf'), 'click', downloadPdf);
    on($('invPrint'), 'click', printInvoice);
    on($('invDownloadJson'), 'click', downloadJson);
    on($('invNew'), 'click', function () { newInvoice(true); status('Blank invoice with your saved business details.', 'good'); });
    on($('invSample'), 'click', function () {
      state = E.sampleInvoice();
      isSample = true;
      writeForm();
      render();
      saveDraft();
    });
    on($('invClearLogo'), 'click', function () {
      state.from.logo = '';
      var input = $('invLogo');
      if (input) input.value = '';
      isSample = false;
      render();
      saveDraft();
    });
    on($('invLogo'), 'change', function (ev) {
      var file = ev.target && ev.target.files && ev.target.files[0];
      if (file) loadLogo(file);
    });
    on($('invImportJson'), 'change', function (ev) {
      var file = ev.target && ev.target.files && ev.target.files[0];
      if (file) importJson(file);
      ev.target.value = '';
    });

    all('.inv-tab').forEach(function (tab) {
      on(tab, 'click', function () {
        var name = tab.getAttribute('data-tab');
        all('.inv-tab').forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        var formPanel = $('invFormPanel');
        var previewPanel = $('invPreviewPanel');
        if (formPanel) formPanel.dataset.tabActive = name === 'form' ? 'true' : 'false';
        if (previewPanel) previewPanel.dataset.tabActive = name === 'preview' ? 'true' : 'false';
        requestAnimationFrame(function () { requestAnimationFrame(fitPreview); });
      });
    });

    all('[data-tpl]').forEach(function (chip) {
      on(chip, 'click', function () {
        state.template = chip.getAttribute('data-tpl');
        all('[data-tpl]').forEach(function (c) { c.classList.toggle('is-active', c === chip); });
        isSample = false;
        writeForm();
        schedule();
      });
    });
  }

  function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/invoice-generator-sw.js', { scope: '/invoice-generator.html' }).then(function () {
      navigator.serviceWorker.ready.then(function () {
        var badge = $('invOfflineBadge');
        if (badge) badge.hidden = false;
      });
    }).catch(function () {});
  }

  function boot() {
    var draft = loadDraft();
    if (draft && draft.invoice && !draft.sample) {
      state = E.normalize(draft.invoice);
      isSample = false;
    } else {
      state = E.sampleInvoice();
      isSample = true;
    }
    writeForm();
    all('[data-tpl]').forEach(function (c) {
      c.classList.toggle('is-active', c.getAttribute('data-tpl') === state.template);
    });
    render();
    bind();
    registerSw();
    window.addEventListener('resize', fitPreview);
    if (typeof ResizeObserver === 'function') {
      var stage = $('invStage');
      if (stage) new ResizeObserver(fitPreview).observe(stage);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.InvoiceStudio = {
    getState: function () { return E.cloneInvoice(state); },
    getModel: function () { return E.computeInvoice(state); },
    setState: function (raw) {
      state = E.normalize(raw);
      isSample = false;
      writeForm();
      render();
    },
    render: render,
    previewHtml: previewHtml
  };
})();
