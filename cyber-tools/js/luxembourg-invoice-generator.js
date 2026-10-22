/* ==========================================================================
   ToolAdda — Luxembourg Invoice Generator (UI layer)

   Form wiring, the live A4 preview, and the PDF. Every total, every legal
   mention and every validation verdict comes from lu-invoice-engine.js,
   which has no DOM and is tested on its own.

   Three things this file is deliberate about:

   * THE PREVIEW IS BUILT AS NODES, NOT AS HTML. Every value on the sheet
     came from a text box, and an invoice is a document people paste supplier
     names into. Building with createElement and textContent means there is
     no path from a pasted string to executing markup, without an escaping
     helper anyone can forget to call.

   * THE SHEET IS SCALED, NOT REFLOWED. The preview is a real 210mm sheet
     transformed to fit its column, so what you see is proportionally what
     prints. A responsive re-layout would look tidier and would lie about
     where the page breaks.

   * VALIDATION IS SHOWN WHERE IT IS FIXED. The VAT verdict sits under the
     VAT field, not in a summary at the bottom — and the errors that make an
     invoice legally invalid sit above the download button, because that is
     the moment they matter.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.LUInvoiceEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-lu-invoice';
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  var state = E.sampleInvoice();
  var model = E.computeInvoice(state);
  var isSample = true;
  var dom = {};
  var libCache = {};
  var frame = 0;
  var saveTimer = 0;
  var statusTimer = 0;

  /* ======================================================================
     Helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function money(cents) { return E.formatMoney(cents, state.language); }

  function status(message, tone) {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.dataset.tone = tone || 'info';
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(function () { dom.status.textContent = ''; }, 7000);
  }

  function busy(btn, isBusy, label) {
    if (!btn) return;
    if (isBusy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label || 'Working…';
      btn.disabled = true;
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.disabled = false;
    }
  }

  function loadScript(url) {
    if (libCache[url]) return libCache[url];
    libCache[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { libCache[url] = null; reject(new Error('Could not load PDF engine')); };
      document.head.appendChild(s);
    });
    return libCache[url];
  }

  /* ======================================================================
     Storage
     ====================================================================== */

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) { /* private mode or quota — the page still works */ }
    }, 400);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      state = E.normalize(JSON.parse(raw));
      isSample = false;
    } catch (error) { /* corrupt entry — keep the sample */ }
  }

  /* ======================================================================
     Form -> state
     ====================================================================== */

  function val(id) { return dom[id] ? dom[id].value : ''; }

  function readForm() {
    state.language = val('language') || 'en';
    state.docType = val('docType') || 'invoice';
    state.supplyType = val('supplyType') || 'domestic';

    state.number = val('number');
    state.issueDate = val('issueDate');
    state.supplyDate = val('supplyDate');
    state.dueDate = val('dueDate');

    state.seller = {
      name: val('sellerName'), address: val('sellerAddress'), vat: val('sellerVat'),
      rcs: val('sellerRcs'), permit: val('sellerPermit'),
      email: val('sellerEmail'), phone: val('sellerPhone')
    };
    state.buyer = {
      name: val('buyerName'), address: val('buyerAddress'),
      vat: val('buyerVat'), reference: val('buyerReference')
    };

    state.lines = all('.lxi-line', dom.lines).map(function (rowEl) {
      return {
        description: rowEl.querySelector('[data-field="description"]').value,
        unit: rowEl.querySelector('[data-field="unit"]').value,
        qty: rowEl.querySelector('[data-field="qty"]').value,
        unitPrice: rowEl.querySelector('[data-field="unitPrice"]').value,
        discount: parseFloat(rowEl.querySelector('[data-field="discount"]').value) || 0,
        vatRate: parseFloat(rowEl.querySelector('[data-field="vatRate"]').value) || 0
      };
    });
    if (!state.lines.length) state.lines = [E.defaultLine()];

    state.globalDiscount = parseFloat(val('globalDiscount')) || 0;
    state.paidAmount = val('paidAmount');

    state.iban = val('iban');
    state.bic = val('bic');
    state.bank = val('bank');
    state.paymentReference = val('paymentReference');
    state.payQr = dom.payQr ? dom.payQr.checked : true;

    state.notes = val('notes');
    state.terms = val('terms');
    state.mentionOverride = val('mentionOverride');
    state.accent = val('accent') || '#24356b';

    state = E.normalize(state);
  }

  /* ======================================================================
     State -> form
     ====================================================================== */

  function writeForm() {
    var set = function (id, value) { if (dom[id]) dom[id].value = value === undefined || value === null ? '' : value; };

    set('language', state.language);
    set('docType', state.docType);
    set('supplyType', state.supplyType);
    set('number', state.number);
    set('issueDate', state.issueDate);
    set('supplyDate', state.supplyDate);
    set('dueDate', state.dueDate);

    set('sellerName', state.seller.name);
    set('sellerAddress', state.seller.address);
    set('sellerVat', state.seller.vat);
    set('sellerRcs', state.seller.rcs);
    set('sellerPermit', state.seller.permit);
    set('sellerEmail', state.seller.email);
    set('sellerPhone', state.seller.phone);

    set('buyerName', state.buyer.name);
    set('buyerAddress', state.buyer.address);
    set('buyerVat', state.buyer.vat);
    set('buyerReference', state.buyer.reference);

    set('globalDiscount', state.globalDiscount);
    set('paidAmount', state.paidAmount);
    set('iban', E.formatIban(state.iban));
    set('bic', state.bic);
    set('bank', state.bank);
    set('paymentReference', state.paymentReference);
    set('notes', state.notes);
    set('terms', state.terms);
    set('mentionOverride', state.mentionOverride);
    set('accent', state.accent);
    if (dom.payQr) dom.payQr.checked = state.payQr !== false;
    renderLogoPreview();

    renderLineRows();
  }

  /* One line's row of controls. Rebuilt wholesale only when lines are added
     or removed — typing in a row must not tear down the field being typed
     into, which is why render() updates the totals in place instead. */
  function lineRow(line, index) {
    var row = el('div', 'lxi-line');
    row.dataset.index = String(index);

    function field(label, cls) {
      var wrap = el('div', 'lxi-field' + (cls ? ' ' + cls : ''));
      var id = 'line-' + index + '-' + label.key;
      var lab = el('label', 'lxi-label', label.text);
      lab.setAttribute('for', id);
      wrap.appendChild(lab);
      return { wrap: wrap, id: id };
    }

    function input(label, cls, attrs) {
      var f = field(label, cls);
      var node = el('input', 'lxi-input');
      node.id = f.id;
      node.dataset.field = label.key;
      Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      f.wrap.appendChild(node);
      row.appendChild(f.wrap);
      return node;
    }

    input({ key: 'description', text: 'Description' }, 'lxi-field--desc', { type: 'text', maxlength: '200' }).value = line.description;
    input({ key: 'qty', text: 'Qty' }, null, { type: 'text', inputmode: 'decimal' }).value = line.qty;
    input({ key: 'unit', text: 'Unit' }, null, { type: 'text', maxlength: '20' }).value = line.unit;
    input({ key: 'unitPrice', text: 'Unit price' }, null, { type: 'text', inputmode: 'decimal' }).value = line.unitPrice;
    input({ key: 'discount', text: 'Disc. %' }, null, { type: 'number', min: '0', max: '100', step: '0.5' }).value = line.discount;

    /* VAT rate is a select rather than a number box: Luxembourg has exactly
       four rates and a free number field invites a fifth that does not exist. */
    var rf = field({ key: 'vatRate', text: 'VAT' });
    var select = el('select', 'lxi-select');
    select.id = rf.id;
    select.dataset.field = 'vatRate';
    /* 0% is offered only when the supply type is what makes it exempt —
       Luxembourg has no domestic zero rate, so listing it on a taxable
       invoice would just be an invitation to issue an invalid one. */
    var charges = E.SUPPLY_TYPES[state.supplyType].chargesVat;
    E.VAT_RATES.forEach(function (r) {
      if (charges && r.rate === 0) return;
      var opt = el('option', null, r.rate + '%');
      opt.value = String(r.rate);
      opt.title = r.examples;
      select.appendChild(opt);
    });
    select.value = String(line.vatRate);
    select.disabled = !charges;
    rf.wrap.appendChild(select);
    row.appendChild(rf.wrap);

    var total = el('div', 'lxi-line__total', '—');
    total.dataset.lineTotal = String(index);
    row.appendChild(total);

    var remove = el('button', 'lxi-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove line ' + (index + 1));
    remove.dataset.removeLine = String(index);
    row.appendChild(remove);

    return row;
  }

  function renderLineRows() {
    if (!dom.lines) return;
    clear(dom.lines);
    state.lines.forEach(function (line, i) { dom.lines.appendChild(lineRow(line, i)); });
  }

  /* ======================================================================
     Logo

     The logo is the only binary this tool holds, and it goes straight into
     localStorage alongside the invoice. A phone camera photo used as a logo
     is several megabytes, which blows the ~5MB origin quota and takes the
     whole saved draft down with it — so it is downscaled to a sane print
     size before it is ever stored, not merely checked and rejected.

     PDF pages are 210mm wide and the logo box on the sheet is 40mm, so
     480px is already more resolution than 300dpi printing needs.
     ====================================================================== */

  var LOGO_MAX_PX = 480;
  var LOGO_MAX_INPUT_BYTES = 8 * 1024 * 1024;

  function logoHint(text, bad) {
    if (!dom.logoHint) return;
    dom.logoHint.textContent = text;
    dom.logoHint.dataset.level = bad ? 'bad' : '';
  }

  /* Draws the picked file onto a canvas at a capped size and re-encodes it.
     Re-encoding is what makes the size predictable: a 6MB JPEG and a 40KB
     PNG of the same drawing both come back as a small PNG. */
  function downscaleLogo(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) { reject(new Error('unreadable')); return; }

        var scale = Math.min(1, LOGO_MAX_PX / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));

        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');

        /* A logo is usually artwork on transparency; JPEG would fill that
           with black. PNG keeps it, and after the downscale the size is
           reasonable either way. */
        ctx.drawImage(img, 0, 0, cw, ch);
        try {
          resolve({ url: canvas.toDataURL('image/png'), width: cw, height: ch });
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('unreadable'));
      };
      img.src = url;
    });
  }

  function renderLogoPreview() {
    var has = !!state.logo;
    if (dom.logoPreview) {
      dom.logoPreview.hidden = !has;
      if (has) dom.logoPreview.src = state.logo;
      else dom.logoPreview.removeAttribute('src');
    }
    if (dom.logoClear) dom.logoClear.hidden = !has;
  }

  function handleLogoFile(file) {
    if (!file) return;
    if (file.size > LOGO_MAX_INPUT_BYTES) {
      logoHint('That image is very large. Pick one under 8 MB.', true);
      return;
    }
    logoHint('Preparing the logo…');
    downscaleLogo(file).then(function (out) {
      state.logo = out.url;

      /* normalize() is the gate that decides what is renderable. Round-trip
         through it rather than trusting the canvas output, so the preview
         can never show something the saved state would reject. */
      state = E.normalize(state);
      if (!state.logo) {
        logoHint('That image could not be used. Try a PNG or JPG.', true);
        return;
      }
      renderLogoPreview();
      render();
      save();
      logoHint('Logo added — ' + out.width + '×' + out.height + ', stored in this browser only.');
    }).catch(function () {
      logoHint('That file could not be read as an image.', true);
    });
  }

  function clearLogo() {
    state.logo = '';
    if (dom.logoInput) dom.logoInput.value = '';
    renderLogoPreview();
    render();
    save();
    logoHint('PNG, JPG or WebP. Scaled down and stored in this browser only.');
  }

  /* ======================================================================
     SEPA payment QR

     The payload comes from the engine, which owns the EPC069-12 rules. This
     only turns it into modules and paints them — once, into a canvas that
     both the sheet and the PDF read from, so the two can never disagree
     about what the client would actually scan.
     ====================================================================== */

  var qrCanvas = null;
  var qrPayload = '';

  function buildQrCanvas(payload) {
    if (typeof qrcode !== 'function') return null;
    if (qrCanvas && qrPayload === payload) return qrCanvas;
    try {
      /* Type 0 lets the library pick the smallest version that fits. M is
         the correction level the EPC specifies. */
      var qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();

      var modules = qr.getModuleCount();
      var quiet = 4;                       /* the spec's mandatory margin */
      var scale = 6;
      var size = (modules + quiet * 2) * scale;

      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      for (var r = 0; r < modules; r++) {
        for (var c = 0; c < modules; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
          }
        }
      }
      canvas.dataset.modules = String(modules);
      qrCanvas = canvas;
      qrPayload = payload;
      return canvas;
    } catch (error) {
      return null;
    }
  }

  /* Both the sheet and the PDF ask this, so the hint under the toggle and
     the thing that actually prints are decided in one place. */
  /* A phone camera needs roughly half a millimetre per module to lock on at
     arm's length. The module COUNT grows with the payload — a long business
     name and a long reference can take it from 41 to 65 — so a fixed box
     would quietly become unscannable on exactly the invoices that carry the
     most detail. Size the code from its own module count instead, floored so
     short payloads still look deliberate and capped so it never crowds the
     bank details. */
  var QR_MM_MIN = 24, QR_MM_MAX = 34, QR_MM_PER_MODULE = 0.5;

  function qrMillimetres(canvas) {
    var modules = parseInt(canvas && canvas.dataset ? canvas.dataset.modules : 0, 10) || 41;
    return Math.max(QR_MM_MIN, Math.min(QR_MM_MAX, modules * QR_MM_PER_MODULE));
  }

  function currentQr() {
    var epc = E.epcFromModel(model);
    if (!epc.ok) return { canvas: null, mm: 0, reason: epc.reason };
    var canvas = buildQrCanvas(epc.payload);
    if (!canvas) return { canvas: null, mm: 0, reason: 'The QR library could not load.' };
    return { canvas: canvas, mm: qrMillimetres(canvas), reason: '' };
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      readForm();
      render();
      save();
    });
  }

  function render() {
    model = E.computeInvoice(state);

    renderChecks();
    renderLineTotals();
    renderWarnings();
    renderSheet();
    fitSheet();

    /* A supply that does not charge VAT locks the per-line rate at 0%. */
    /* Keep the rate selects in step with what the engine actually settled
       on, so a supply-type switch is reflected in the form as well as the
       sheet. */
    var charges = model.supply.chargesVat;
    all('[data-field="vatRate"]', dom.lines).forEach(function (sel, i) {
      sel.disabled = !charges;
      var settled = model.invoice.lines[i];
      if (settled) sel.value = String(settled.vatRate);
    });
    if (dom.supplyHint) dom.supplyHint.textContent = supplyHint();
    renderQrHint();
    if (dom.mentionOverride) {
      dom.mentionOverride.placeholder = model.supply.mention
        ? E.t(state.language).mention[model.supply.mention]
        : 'Not required for a domestic supply.';
    }
  }

  /* The toggle can be on while no code is possible — no IBAN yet, nothing
     left to pay, a quote rather than an invoice. Saying which, next to the
     switch, is the difference between a missing feature and an explained
     one. */
  function renderQrHint() {
    if (!dom.payQrHint) return;
    if (!state.payQr) {
      dom.payQrHint.textContent = 'Off — the invoice prints the bank details only.';
      dom.payQrHint.dataset.level = '';
      return;
    }
    var qr = currentQr();
    if (qr.canvas) {
      dom.payQrHint.textContent = 'Shown on the invoice. Any European banking app can scan it to prefill the transfer.';
      dom.payQrHint.dataset.level = 'good';
    } else {
      dom.payQrHint.textContent = qr.reason || 'Not enough payment detail yet.';
      dom.payQrHint.dataset.level = 'warn';
    }
  }

  function supplyHint() {
    var s = model.supply;
    if (s.key === 'domestic') return 'Luxembourg VAT is charged at the rate you pick per line.';
    if (s.key === 'euServices') return 'B2B services to another member state. VAT is 0% and the customer accounts for it — their valid VAT number is mandatory.';
    if (s.key === 'euGoods') return 'Goods dispatched to a VAT-registered business in another member state. Exempt, and you must be able to prove the goods left Luxembourg.';
    if (s.key === 'export') return 'Goods leaving the EU. Exempt, and you must keep the customs export declaration as proof.';
    if (s.key === 'domesticReverse') return 'Luxembourg customer accounts for the VAT — used mainly in construction and specific listed supplies.';
    return 'You are under the small business exemption, so no VAT is charged and none may be deducted. The national threshold is €50,000 of turnover a year.';
  }

  function renderChecks() {
    [['sellerVatCheck', model.sellerVat], ['buyerVatCheck', model.buyerVat], ['ibanCheck', model.ibanCheck]]
      .forEach(function (pair) {
        var node = dom[pair[0]];
        if (!node) return;
        node.dataset.level = pair[1].level;
        node.textContent = pair[1].message;
      });
  }

  function renderLineTotals() {
    model.lines.forEach(function (line, i) {
      var node = dom.lines && dom.lines.querySelector('[data-line-total="' + i + '"]');
      if (node) node.textContent = line.netCents ? money(line.netCents) : '—';
    });
  }

  function renderWarnings() {
    var host = dom.warnings;
    if (!host) return;
    clear(host);

    if (!model.warnings.length) {
      var ok = el('div', 'lxi-clean', '✓ Nothing missing — every mandatory field for this supply type is filled in.');
      host.appendChild(ok);
      return;
    }

    var list = el('ul', 'lxi-warnings');
    model.warnings.forEach(function (w) {
      var li = el('li', 'lxi-warning');
      li.dataset.level = w.level;
      li.appendChild(el('b', null, w.level === 'error' ? 'Fix' : 'Check'));
      li.appendChild(document.createTextNode(' ' + w.message));
      list.appendChild(li);
    });
    host.appendChild(list);
  }

  /* ------------------------------------------------------------ the sheet */

  function renderSheet() {
    var sheet = dom.sheet;
    if (!sheet) return;
    clear(sheet);

    var inv = model.invoice;
    var L = model.lang;
    sheet.style.setProperty('--lxi-doc-accent', inv.accent);
    sheet.lang = L.code;

    /* --- header --- */
    var head = el('div', 'lxi-sheet__head');
    var left = el('div');
    if (inv.logo) {
      var logoImg = document.createElement('img');
      logoImg.className = 'lxi-sheet__logo';
      logoImg.src = inv.logo;
      logoImg.alt = '';
      left.appendChild(logoImg);
    }
    left.appendChild(el('h2', 'lxi-sheet__doctype', L.documentType[inv.docType]));
    left.appendChild(el('div', null, inv.seller.name));
    head.appendChild(left);

    var meta = el('div', 'lxi-sheet__meta');
    var dl = document.createElement('dl');
    function metaRow(term, value) {
      if (!value) return;
      dl.appendChild(el('dt', null, term));
      dl.appendChild(el('dd', null, value));
    }
    metaRow(L.invoiceNo, inv.number);
    metaRow(L.issueDate, E.formatDate(inv.issueDate, L.code));
    metaRow(L.supplyDate, E.formatDate(inv.supplyDate, L.code));
    metaRow(L.dueDate, E.formatDate(inv.dueDate, L.code));
    if (inv.buyer.reference) metaRow(L.yourRef, inv.buyer.reference);
    meta.appendChild(dl);
    head.appendChild(meta);
    sheet.appendChild(head);

    /* --- parties --- */
    var parties = el('div', 'lxi-sheet__parties');

    function party(label, p, ids) {
      var box = el('div');
      box.appendChild(el('p', 'lxi-party__label', label));
      box.appendChild(el('p', 'lxi-party__name', p.name));
      if (p.address) box.appendChild(el('p', 'lxi-party__lines', p.address));
      var idBox = el('div', 'lxi-party__ids');
      ids.forEach(function (pair) {
        if (pair[1]) idBox.appendChild(el('span', null, pair[0] + ' ' + pair[1]));
      });
      if (idBox.childNodes.length) box.appendChild(idBox);
      return box;
    }

    parties.appendChild(party(L.from, inv.seller, [
      [L.vatNo, inv.seller.vat],
      [L.rcs, inv.seller.rcs],
      [L.businessId, inv.seller.permit],
      ['', inv.seller.email],
      ['', inv.seller.phone]
    ]));
    parties.appendChild(party(L.to, inv.buyer, [[L.vatNo, inv.buyer.vat]]));
    sheet.appendChild(parties);

    /* --- supply type banner --- */
    sheet.appendChild(el('div', 'lxi-sheet__supply', L.supply[inv.supplyType]));

    /* --- items --- */
    var table = el('table', 'lxi-items');
    var thead = document.createElement('thead');
    var hrow = document.createElement('tr');
    var showVat = model.supply.chargesVat;
    var headers = [
      { text: L.description, cls: '' },
      { text: L.quantity, cls: 'lxi-num' },
      { text: L.unitPrice, cls: 'lxi-num' },
      { text: L.discount, cls: 'lxi-num' }
    ];
    if (showVat) headers.push({ text: L.vatRate, cls: 'lxi-num' });
    headers.push({ text: L.netAmount, cls: 'lxi-num' });

    headers.forEach(function (h) {
      var th = el('th', h.cls, h.text);
      th.scope = 'col';
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    model.liveLines.forEach(function (line) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'lxi-desc', line.description));
      tr.appendChild(el('td', 'lxi-num', E.formatQty(line.qty, L.code) + (line.unit ? ' ' + line.unit : '')));
      tr.appendChild(el('td', 'lxi-num', money(line.unitPriceCents)));
      tr.appendChild(el('td', 'lxi-num', line.discount ? line.discount + '%' : '—'));
      if (showVat) tr.appendChild(el('td', 'lxi-num', line.vatRate + '%'));
      tr.appendChild(el('td', 'lxi-num', money(line.netCents)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sheet.appendChild(table);

    /* --- footer: VAT summary and totals --- */
    var foot = el('div', 'lxi-sheet__foot');

    var sumBox = el('div');
    if (showVat && model.groups.length) {
      var vs = el('table', 'lxi-vatsum');
      vs.appendChild(el('caption', null, L.vatSummary));
      var vsBody = document.createElement('tbody');
      model.groups.forEach(function (g) {
        var tr = document.createElement('tr');
        var th = el('th', null, g.rate + '% (' + L.rateName[g.rateKey] + ')');
        th.scope = 'row';
        tr.appendChild(th);
        tr.appendChild(el('td', null, money(g.taxableCents)));
        tr.appendChild(el('td', null, money(g.vatCents)));
        vsBody.appendChild(tr);
      });
      vs.appendChild(vsBody);
      sumBox.appendChild(vs);
    }
    foot.appendChild(sumBox);

    var totals = el('table', 'lxi-totals');
    var tBody = document.createElement('tbody');
    function totalRow(label, value, cls) {
      var tr = document.createElement('tr');
      if (cls) tr.className = cls;
      var th = el('th', null, label);
      th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(el('td', null, value));
      tBody.appendChild(tr);
    }

    if (model.globalDiscountCents) {
      totalRow(L.subtotal, money(model.subtotalCents));
      totalRow(L.globalDiscount + ' ' + inv.globalDiscount + '%', '−' + money(model.globalDiscountCents));
    }
    totalRow(L.totalExcl, money(model.taxableTotalCents));
    if (showVat) totalRow(L.totalVat, money(model.vatTotalCents));
    totalRow(model.paidCents ? L.totalIncl : L.amountDue, money(model.totalCents), model.paidCents ? '' : 'is-total');
    if (model.paidCents) {
      totalRow(L.paid, '−' + money(model.paidCents));
      totalRow(L.balance, money(model.balanceCents), 'is-total');
    }
    totals.appendChild(tBody);
    foot.appendChild(totals);
    sheet.appendChild(foot);

    /* --- legal mention --- */
    if (model.mention) sheet.appendChild(el('p', 'lxi-sheet__mention', model.mention));

    /* --- payment, notes, terms --- */
    var blocks = el('div', 'lxi-sheet__blocks');
    if (inv.iban || inv.bic || inv.bank || inv.paymentReference) {
      var pay = el('div', 'lxi-block');
      pay.appendChild(el('h4', null, L.payment));
      var pdl = document.createElement('dl');
      function payRow(term, value) {
        if (!value) return;
        pdl.appendChild(el('dt', null, term));
        pdl.appendChild(el('dd', null, value));
      }
      payRow(L.bank, inv.bank);
      payRow(L.iban, E.formatIban(inv.iban));
      payRow(L.bic, inv.bic);
      payRow(L.reference, inv.paymentReference);
      pay.appendChild(pdl);

      /* The QR sits with the bank details rather than in a corner, because
         it IS the bank details — someone who scans it should not also have
         to hunt for the IBAN to check it against. */
      var qr = currentQr();
      if (qr.canvas) {
        var qrWrap = el('div', 'lxi-sheet__qr');
        var qrImg = document.createElement('img');
        qrImg.src = qr.canvas.toDataURL('image/png');
        qrImg.alt = L.scanToPay;
        qrImg.style.width = qr.mm + 'mm';
        qrImg.style.height = qr.mm + 'mm';
        qrWrap.appendChild(qrImg);
        qrWrap.appendChild(el('span', null, L.scanToPay));
        qrWrap.appendChild(el('small', null, L.scanHint));
        pay.classList.add('lxi-block--withqr');
        pay.appendChild(qrWrap);
      }
      blocks.appendChild(pay);
    }
    if (inv.notes || inv.terms) {
      var text = el('div', 'lxi-block');
      if (inv.notes) {
        text.appendChild(el('h4', null, L.notes));
        text.appendChild(el('p', null, inv.notes));
      }
      if (inv.terms) {
        text.appendChild(el('h4', null, L.terms));
        text.appendChild(el('p', null, inv.terms));
      }
      blocks.appendChild(text);
    }
    if (blocks.childNodes.length) sheet.appendChild(blocks);

    sheet.appendChild(el('div', 'lxi-sheet__footer',
      inv.seller.name + (inv.seller.vat ? ' · ' + L.vatNo + ' ' + inv.seller.vat : '')));
  }

  /* The sheet is a fixed 210mm wide. Scale it down to whatever the stage can
     give it, never up — a magnified A4 sheet on a wide monitor looks like a
     rendering bug rather than a feature. */
  function fitSheet() {
    if (!dom.fit || !dom.stage || !dom.sheet) return;

    var cs = getComputedStyle(dom.stage);
    var available = dom.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var natural = dom.sheet.offsetWidth;
    if (!available || !natural) return;

    var scale = Math.min(1, available / natural);
    dom.fit.style.transform = 'scale(' + scale.toFixed(4) + ')';
    /* The box takes the scaled width, not the natural one — otherwise the
       stage still lays out a full A4 width and grows a scrollbar. */
    dom.fit.style.width = (natural * scale) + 'px';
    dom.fit.style.height = (dom.sheet.offsetHeight * scale) + 'px';
  }

  /* ======================================================================
     PDF
     ====================================================================== */

  /* jsPDF's standard fonts use WinAnsiEncoding — Latin-1 plus a high block
     that includes the euro sign, curly quotes and the en and em dash. That
     covers English, French and German invoices with no font to embed, which
     is why this tool does not ship one.

     What it does not cover is everything else, and an unmapped code point
     prints as the wrong glyph rather than raising an error — so a Polish or
     Czech client name would come out quietly mangled. Strip the diacritic
     and keep the letter: "Michał" as "Michal" is honest, "Micha?" is not,
     and a wrong glyph is worst of all. */
  var WINANSI_HIGH = '€‚ƒ„…†‡ˆ‰Š‹' +
    'ŒŽ‘’“”•–—˜™š›' +
    'œžŸ';

  /* Letters that are not an accented form of anything, so stripping
     diacritics leaves them untouched. Polish and Croatian names reach
     Luxembourg invoices often enough to be worth four lines. */
  var FOLD = {
    'ł': 'l', 'Ł': 'L',   /* l with stroke  */
    'đ': 'd', 'Đ': 'D',   /* d with stroke  */
    'ħ': 'h', 'Ħ': 'H',   /* h with stroke  */
    'ı': 'i', 'İ': 'I'    /* dotless/dotted i */
  };

  function pdfSafe(text) {
    var raw = String(text === null || text === undefined ? '' : text).replace(/ /g, ' ');

    /* eslint-disable no-control-regex */
    return raw.replace(/[^ -ÿ]/g, function (ch) {
      if (WINANSI_HIGH.indexOf(ch) !== -1) return ch;

      if (FOLD[ch]) return FOLD[ch];

      if (typeof ch.normalize === 'function') {
        var stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (stripped && !/[^ -ÿ]/.test(stripped)) return stripped;
      }
      return '?';
    });
    /* eslint-enable no-control-regex */
  }

  function hexToRgb(hex) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return [36, 53, 107];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function drawInvoice(doc) {
    var inv = model.invoice;
    var L = model.lang;
    var accent = hexToRgb(inv.accent);
    var ink = [23, 34, 43], ink2 = [59, 74, 85], ink3 = [124, 140, 151];

    var L0 = 15, R = 195, W = R - L0;
    var y = 20;

    function set(size, weight, colour) {
      doc.setFontSize(size);
      doc.setFont('helvetica', weight);
      doc.setTextColor(colour[0], colour[1], colour[2]);
    }
    function line(yy, colour) {
      doc.setDrawColor(colour[0], colour[1], colour[2]);
      doc.line(L0, yy, R, yy);
    }
    function wrap(text, width, size) {
      doc.setFontSize(size);
      return doc.splitTextToSize(pdfSafe(text), width);
    }
    /* Returns true when it actually started a new page, so callers that owe
       the new page a repeated table header can tell. */
    function page(minSpace) {
      if (y + (minSpace || 10) < 280) return false;
      doc.addPage();
      y = 20;
      return true;
    }

    /* --- header --- */

    /* The logo sits above the document type and pushes it down, so a tall
       logo never lands on top of the title. Width is capped at 40mm and
       height at 18mm, whichever binds first, so a wide banner and a square
       mark both stay inside the header band. */
    if (inv.logo) {
      try {
        var lp = doc.getImageProperties(inv.logo);
        var lw = lp.width, lh = lp.height;
        if (lw > 0 && lh > 0) {
          var k = Math.min(40 / lw, 18 / lh);
          var dw = lw * k, dh = lh * k;
          doc.addImage(inv.logo, 'PNG', L0, y - 5, dw, dh, undefined, 'FAST');
          y += dh + 2;
        }
      } catch (error) { /* an unreadable logo must not lose the invoice */ }
    }

    set(22, 'bold', accent);
    doc.text(pdfSafe(L.documentType[inv.docType]), L0, y);

    set(8.5, 'normal', ink2);
    var metaY = y - 4;
    [[L.invoiceNo, inv.number],
     [L.issueDate, E.formatDate(inv.issueDate, L.code)],
     [L.supplyDate, E.formatDate(inv.supplyDate, L.code)],
     [L.dueDate, E.formatDate(inv.dueDate, L.code)],
     ['Ref.', inv.buyer.reference]].forEach(function (pair) {
      if (!pair[1]) return;
      metaY += 4.2;
      set(8, 'normal', ink3);
      doc.text(pdfSafe(pair[0]), R - 34, metaY, { align: 'right' });
      set(8, 'bold', ink);
      doc.text(pdfSafe(pair[1]), R, metaY, { align: 'right' });
    });

    y += 4;
    set(10, 'normal', ink2);
    doc.text(pdfSafe(inv.seller.name), L0, y);

    y = Math.max(y, metaY) + 5;
    doc.setLineWidth(0.6);
    line(y, accent);
    doc.setLineWidth(0.2);
    y += 7;

    /* --- parties --- */
    var partyTop = y;
    function party(label, p, ids, x, width) {
      var yy = partyTop;
      set(7, 'bold', ink3);
      doc.text(pdfSafe(label.toUpperCase()), x, yy);
      yy += 4.5;
      set(10.5, 'bold', ink);
      doc.text(pdfSafe(p.name), x, yy);
      yy += 4.5;
      set(8.4, 'normal', ink2);
      String(p.address || '').split('\n').forEach(function (ln) {
        if (!ln) return;
        doc.text(pdfSafe(ln), x, yy);
        yy += 3.9;
      });
      ids.forEach(function (pair) {
        if (!pair[1]) return;
        doc.text(pdfSafe((pair[0] ? pair[0] + ' ' : '') + pair[1]), x, yy);
        yy += 3.9;
      });
      return yy;
    }

    var yA = party(L.from, inv.seller, [
      [L.vatNo, inv.seller.vat], [L.rcs, inv.seller.rcs], [L.businessId, inv.seller.permit],
      ['', inv.seller.email], ['', inv.seller.phone]
    ], L0, W / 2 - 5);
    var yB = party(L.to, inv.buyer, [[L.vatNo, inv.buyer.vat]], L0 + W / 2 + 5, W / 2 - 5);
    y = Math.max(yA, yB) + 4;

    /* --- supply banner --- */
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.setGState && doc.setGState(new doc.GState({ opacity: 0.08 }));
    doc.rect(L0, y - 4, W, 7, 'F');
    doc.setGState && doc.setGState(new doc.GState({ opacity: 1 }));
    set(8.5, 'bold', accent);
    doc.text(pdfSafe(L.supply[inv.supplyType]), L0 + 2, y + 0.6);
    y += 10;

    /* --- items --- */
    var showVat = model.supply.chargesVat;
    /* Column right edges, so every number can be right-aligned to one. */
    var cQty = showVat ? 118 : 128;
    var cPrice = showVat ? 143 : 155;
    var cDisc = showVat ? 160 : 172;
    var cVat = 175;
    var cNet = R;
    var descWidth = cQty - L0 - 24;

    function itemsHeader() {
      set(7, 'bold', ink3);
      doc.text(pdfSafe(L.description.toUpperCase()), L0, y);
      doc.text(pdfSafe(L.quantity.toUpperCase()), cQty, y, { align: 'right' });
      doc.text(pdfSafe(L.unitPrice.toUpperCase()), cPrice, y, { align: 'right' });
      doc.text(pdfSafe(L.discount.toUpperCase()), cDisc, y, { align: 'right' });
      if (showVat) doc.text(pdfSafe(L.vatRate.toUpperCase()), cVat, y, { align: 'right' });
      doc.text(pdfSafe(L.netAmount.toUpperCase()), cNet, y, { align: 'right' });
      y += 2;
      line(y, [214, 222, 228]);
      y += 4.5;
    }
    itemsHeader();

    model.liveLines.forEach(function (item) {
      var lines = wrap(item.description, descWidth, 8.6);
      if (page(8 + lines.length * 3.8)) itemsHeader();

      set(8.6, 'normal', ink);
      lines.forEach(function (ln, i) { doc.text(ln, L0, y + i * 3.8); });

      set(8.6, 'normal', ink2);
      doc.text(pdfSafe(E.formatQty(item.qty, L.code) + (item.unit ? ' ' + item.unit : '')), cQty, y, { align: 'right' });
      doc.text(pdfSafe(E.formatMoney(item.unitPriceCents, L.code)), cPrice, y, { align: 'right' });
      doc.text(item.discount ? item.discount + '%' : '-', cDisc, y, { align: 'right' });
      if (showVat) doc.text(item.vatRate + '%', cVat, y, { align: 'right' });
      set(8.6, 'bold', ink);
      doc.text(pdfSafe(E.formatMoney(item.netCents, L.code)), cNet, y, { align: 'right' });

      y += Math.max(1, lines.length) * 3.8 + 2.4;
      line(y - 1.6, [238, 242, 245]);
    });

    y += 4;
    page(52);

    /* --- VAT summary (left) --- */
    var totalsTop = y;
    if (showVat && model.groups.length) {
      var vy = y;
      set(7, 'bold', ink3);
      doc.text(pdfSafe(L.vatSummary.toUpperCase()), L0, vy);
      vy += 4.5;
      model.groups.forEach(function (g) {
        set(8, 'normal', ink2);
        doc.text(pdfSafe(g.rate + '% (' + L.rateName[g.rateKey] + ')'), L0, vy);
        doc.text(pdfSafe(E.formatMoney(g.taxableCents, L.code)), L0 + 52, vy, { align: 'right' });
        doc.text(pdfSafe(E.formatMoney(g.vatCents, L.code)), L0 + 80, vy, { align: 'right' });
        vy += 4.2;
      });
      y = Math.max(y, vy);
    }

    /* --- totals (right) --- */
    var ty = totalsTop;
    function totalLine(label, value, big) {
      set(big ? 11.5 : 9, big ? 'bold' : 'normal', big ? accent : ink2);
      doc.text(pdfSafe(label), R - 40, ty, { align: 'right' });
      set(big ? 11.5 : 9, 'bold', big ? accent : ink);
      doc.text(pdfSafe(value), R, ty, { align: 'right' });
      ty += big ? 7 : 5;
    }

    if (model.globalDiscountCents) {
      totalLine(L.subtotal, E.formatMoney(model.subtotalCents, L.code));
      totalLine(L.globalDiscount + ' ' + model.invoice.globalDiscount + '%', '-' + E.formatMoney(model.globalDiscountCents, L.code));
    }
    totalLine(L.totalExcl, E.formatMoney(model.taxableTotalCents, L.code));
    if (showVat) totalLine(L.totalVat, E.formatMoney(model.vatTotalCents, L.code));

    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.5);
    doc.line(R - 78, ty - 3, R, ty - 3);
    doc.setLineWidth(0.2);
    ty += 2;

    if (model.paidCents) {
      totalLine(L.totalIncl, E.formatMoney(model.totalCents, L.code));
      totalLine(L.paid, '-' + E.formatMoney(model.paidCents, L.code));
      totalLine(L.balance, E.formatMoney(model.balanceCents, L.code), true);
    } else {
      totalLine(L.amountDue, E.formatMoney(model.totalCents, L.code), true);
    }

    y = Math.max(y, ty) + 4;

    /* --- legal mention --- */
    if (model.mention) {
      var mLines = wrap(model.mention, W - 6, 8.4);
      page(10 + mLines.length * 4);
      doc.setDrawColor(accent[0], accent[1], accent[2]);
      doc.rect(L0, y - 4, W, mLines.length * 4 + 4);
      set(8.4, 'bold', ink);
      mLines.forEach(function (ln, i) { doc.text(ln, L0 + 3, y + i * 4); });
      y += mLines.length * 4 + 6;
    }

    /* --- payment, notes, terms --- */
    function block(title, rows) {
      if (!rows.length) return;
      page(10 + rows.length * 4);
      set(7, 'bold', ink3);
      doc.text(pdfSafe(title.toUpperCase()), L0, y);
      y += 4.2;
      set(8.4, 'normal', ink2);
      rows.forEach(function (r) {
        doc.text(pdfSafe(r), L0, y);
        y += 3.9;
      });
      y += 2.5;
    }

    var payRows = [
      inv.bank ? L.bank + ': ' + inv.bank : '',
      inv.iban ? L.iban + ': ' + E.formatIban(inv.iban) : '',
      inv.bic ? L.bic + ': ' + inv.bic : '',
      inv.paymentReference ? L.reference + ': ' + inv.paymentReference : ''
    ].filter(Boolean);

    /* Reserve the QR's height BEFORE the payment block draws, so block()'s
       own page break accounts for it. Doing it afterwards is how a QR ends
       up alone on page two, away from the IBAN it encodes. */
    var pdfQr = payRows.length ? currentQr() : { canvas: null, mm: 0 };
    var QR_MM = pdfQr.mm || 26;
    if (pdfQr.canvas) page(10 + Math.max(payRows.length * 4, QR_MM + 6));

    var payTop = y;
    block(L.payment, payRows);

    if (pdfQr.canvas) {
      var qx = R - QR_MM;
      doc.addImage(pdfQr.canvas.toDataURL('image/png'), 'PNG', qx, payTop - 4, QR_MM, QR_MM, undefined, 'FAST');
      set(6.5, 'bold', ink3);
      doc.text(pdfSafe(L.scanToPay), qx + QR_MM / 2, payTop - 4 + QR_MM + 3, { align: 'center' });
      set(6, 'normal', ink3);
      doc.text(pdfSafe(L.scanHint), qx + QR_MM / 2, payTop - 4 + QR_MM + 6, { align: 'center' });
      /* Keep whatever follows clear of the QR when the text block was
         shorter than the code itself. */
      y = Math.max(y, payTop - 4 + QR_MM + 9);
    }

    if (inv.notes) block(L.notes, wrap(inv.notes, W, 8.4));
    if (inv.terms) block(L.terms, wrap(inv.terms, W, 8.4));

    /* --- page footer on every page --- */
    var pages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      set(7, 'normal', ink3);
      doc.text(pdfSafe(inv.seller.name + (inv.seller.vat ? ' - ' + L.vatNo + ' ' + inv.seller.vat : '')), L0, 288);
      if (pages > 1) doc.text(pdfSafe(L.page + ' ' + p + '/' + pages), R, 288, { align: 'right' });
    }
  }

  function filename(ext) {
    var slug = String(state.number || 'invoice').replace(/[^\w.-]+/g, '-');
    return slug + '.' + ext;
  }

  function downloadPdf() {
    var btn = dom.downloadPdf;
    readForm();
    model = E.computeInvoice(state);

    busy(btn, true, 'Building PDF…');
    loadScript(JSPDF_URL).then(function () {
      if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF engine unavailable');
      var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      drawInvoice(doc);
      doc.save(filename('pdf'));
      status('PDF saved on this device. Nothing was uploaded.', 'good');
    }).catch(function () {
      status('The PDF engine could not load. Use Print instead — it works fully offline.', 'bad');
      if (dom.printInvoice) dom.printInvoice.focus();
    }).then(function () { busy(btn, false); });
  }

  /* ======================================================================
     Actions
     ====================================================================== */

  function addLine() {
    readForm();
    if (state.lines.length >= 60) {
      status('Sixty lines is the limit for one invoice.', 'bad');
      return;
    }
    /* A new line inherits the rate of the one above it, because an invoice
       with mixed rates is the exception and retyping 17% every time is not. */
    var last = state.lines[state.lines.length - 1];
    var line = E.defaultLine();
    if (last) line.vatRate = last.vatRate;
    state.lines.push(line);
    renderLineRows();
    render();

    var inputs = all('[data-field="description"]', dom.lines);
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function removeLine(index) {
    readForm();
    if (state.lines.length <= 1) {
      state.lines = [E.defaultLine()];
    } else {
      state.lines.splice(index, 1);
    }
    renderLineRows();
    render();
    save();
  }

  function downloadJson() {
    readForm();
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename('json');
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    status('Backup saved locally. Load it later to reuse these details.', 'good');
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state = E.normalize(JSON.parse(String(reader.result)));
        isSample = false;
        writeForm();
        render();
        save();
        status('Invoice loaded.', 'good');
      } catch (error) {
        status('That file is not a saved invoice.', 'bad');
      }
    };
    reader.onerror = function () { status('Could not read that file.', 'bad'); };
    reader.readAsText(file);
  }

  function nextInvoice() {
    readForm();
    var today = E.isoToday();
    state.number = E.nextNumber(state.number);
    state.issueDate = today;
    state.dueDate = E.addDays(today, 30);
    state.lines = [E.defaultLine()];
    state.buyer = { name: '', address: '', vat: '', reference: '' };
    state.paidAmount = '';
    state.paymentReference = state.number;
    state.notes = '';
    writeForm();
    render();
    save();
    status('Ready for the next invoice — your own details and bank data are kept.', 'good');
    if (dom.buyerName) dom.buyerName.focus();
  }

  function resetAll() {
    state = E.defaultInvoice();
    isSample = false;
    writeForm();
    render();
    save();
    status('Cleared.', 'info');
  }

  function loadSample() {
    state = E.sampleInvoice();
    isSample = true;
    writeForm();
    render();
    save();
    status('Sample invoice loaded — an intra-EU reverse charge to a German client.', 'info');
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function cache() {
    ['language', 'docType', 'supplyType', 'supplyHint',
     'number', 'issueDate', 'supplyDate', 'dueDate',
     'sellerName', 'sellerAddress', 'sellerVat', 'sellerRcs', 'sellerPermit', 'sellerEmail', 'sellerPhone',
     'buyerName', 'buyerAddress', 'buyerVat', 'buyerReference',
     'sellerVatCheck', 'buyerVatCheck', 'ibanCheck',
     'lines', 'addLine', 'globalDiscount', 'paidAmount',
     'iban', 'bic', 'bank', 'paymentReference',
     'payQr', 'payQrHint',
     'logoInput', 'logoPreview', 'logoClear', 'logoHint',
     'notes', 'terms', 'mentionOverride', 'accent',
     'warnings', 'sheet', 'stage', 'fit', 'status',
     'downloadPdf', 'printInvoice', 'downloadJson', 'importJson', 'nextInvoice', 'resetAll', 'loadSample',
     'studio'
    ].forEach(function (id) { dom[id] = $(id); });

    /* The studio wrapper is the one element whose id does not match its key.
       Under the mobile breakpoint the Edit/Preview tabs work purely by
       setting data-tab on it, so while this was null the buttons changed
       their own pressed state and nothing else — the preview stayed
       unreachable on a phone. */
    dom.studio = $('lxiStudio');
  }

  function wire() {
    /* One delegated listener rather than one per field: the line rows are
       rebuilt as lines come and go, and re-binding them each time is how
       stale handlers accumulate. */
    on(document.getElementById('lxiForm'), 'input', schedule);
    on(document.getElementById('lxiForm'), 'change', function (event) {
      /* Changing the supply type can force every rate to zero, so the rows
         have to be redrawn rather than just re-read. */
      if (event.target && event.target.id === 'supplyType') {
        readForm();
        renderLineRows();
      }
      if (event.target && event.target.id === 'iban') {
        readForm();
        if (dom.iban) dom.iban.value = E.formatIban(state.iban);
      }
      schedule();
    });

    on(dom.lines, 'click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-remove-line]') : null;
      if (!btn) return;
      removeLine(parseInt(btn.dataset.removeLine, 10) || 0);
    });

    on(dom.logoInput, 'change', function (event) {
      handleLogoFile(event.target.files && event.target.files[0]);
    });
    on(dom.logoClear, 'click', clearLogo);

    on(dom.addLine, 'click', addLine);
    on(dom.downloadPdf, 'click', downloadPdf);
    on(dom.printInvoice, 'click', function () { readForm(); render(); window.print(); });
    on(dom.downloadJson, 'click', downloadJson);
    on(dom.importJson, 'change', function (event) {
      importJson(event.target.files && event.target.files[0]);
      event.target.value = '';
    });
    on(dom.nextInvoice, 'click', nextInvoice);
    on(dom.resetAll, 'click', resetAll);
    on(dom.loadSample, 'click', loadSample);

    all('[data-tab]').forEach(function (btn) {
      on(btn, 'click', function () {
        all('[data-tab]').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        if (dom.studio) dom.studio.dataset.tab = btn.dataset.tab;
        fitSheet();
      });
    });

    on(window, 'resize', fitSheet);

    /* A focused number box (the discount fields) eats the mouse wheel: the
       page stops scrolling while the pointer is over it, which reads as the
       page getting stuck. Letting go of focus hands the wheel back to the page. */
    document.addEventListener('wheel', function (e) {
      var t = e.target;
      if (t && t.type === 'number' && t === document.activeElement) t.blur();
    }, { passive: true });
  }

  function init() {
    cache();
    if (!dom.sheet) return;

    load();
    writeForm();
    wire();
    render();

    if (isSample) status('Showing a sample invoice — edit any field, or press Clear to start empty.', 'info');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
