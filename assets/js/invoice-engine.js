/* ==========================================================================
   ToolAdda — Offline Invoice Engine

   Money is stored as integer minor units (paise / cents). Tax is rounded
   once per line, and one figure in every split is obtained by subtraction
   so CGST + SGST always equals the GST on that line, and line totals
   always equal taxable + tax.

   Qty is stored as milles (thousandths) so 2.5 units is exact.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_MONEY = 1e13;
  var MAX_QTY = 1e9;
  var MAX_RATE = 100;
  var MAX_LINES = 40;
  var DOC_TYPES = ['invoice', 'quote', 'proforma', 'credit'];
  var TAX_MODES = ['exclusive', 'inclusive', 'none'];
  var TAX_SPLITS = ['intra', 'inter', 'single'];
  var TEMPLATES = ['classic', 'modern', 'minimal'];
  var STATUSES = ['unpaid', 'partial', 'paid'];
  var CURRENCIES = {
    INR: { code: 'INR', symbol: '₹', pdf: 'Rs.', locale: 'en-IN', group: 'indian', major: 'Rupees', minor: 'Paise' },
    USD: { code: 'USD', symbol: '$', pdf: 'USD', locale: 'en-US', group: 'intl', major: 'Dollars', minor: 'Cents' },
    EUR: { code: 'EUR', symbol: 'EUR ', pdf: 'EUR', locale: 'en-IE', group: 'intl', major: 'Euro', minor: 'Cents' },
    GBP: { code: 'GBP', symbol: 'GBP ', pdf: 'GBP', locale: 'en-GB', group: 'intl', major: 'Pounds', minor: 'Pence' },
    AED: { code: 'AED', symbol: 'AED ', pdf: 'AED', locale: 'en-AE', group: 'intl', major: 'Dirhams', minor: 'Fils' },
    SGD: { code: 'SGD', symbol: 'SGD ', pdf: 'SGD', locale: 'en-SG', group: 'intl', major: 'Dollars', minor: 'Cents' }
  };

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) n = typeof fallback === 'number' ? fallback : lo;
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeText(value, max) {
    var s = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
    return s.slice(0, max || 240);
  }

  function safeMultiline(value, max) {
    var s = String(value === null || value === undefined ? '' : value).replace(/\r\n/g, '\n').trim();
    return s.slice(0, max || 800);
  }

  function safeHex(value, fallback) {
    var s = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    return fallback || '#4338ca';
  }

  function safeLogo(value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (!s) return '';
    if (!/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(s)) return '';
    if (s.length > 900000) return '';
    return s.replace(/\s+/g, '');
  }

  function decimalToPaise(text) {
    var raw = String(text === null || text === undefined ? '' : text).replace(/[\s,₹$]/g, '');
    if (!raw || raw === '-' || raw === '.') return 0;
    var neg = raw.charAt(0) === '-';
    if (neg) raw = raw.slice(1);
    var match = /^(\d*)(?:\.(\d*))?$/.exec(raw);
    if (!match) return 0;
    var whole = match[1] || '0';
    var frac = match[2] || '';
    var paise = parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    var next = frac.charAt(2);
    if (next && parseInt(next, 10) >= 5) paise += 1;
    if (!isFinite(paise) || paise > MAX_MONEY) paise = MAX_MONEY;
    return neg ? -paise : paise;
  }

  function decimalToMilles(text) {
    var raw = String(text === null || text === undefined ? '' : text).replace(/[\s,]/g, '');
    if (!raw || raw === '.') return 0;
    var match = /^(\d*)(?:\.(\d*))?$/.exec(raw);
    if (!match) return 0;
    var whole = match[1] || '0';
    var frac = (match[2] || '') + '000';
    var milles = parseInt(whole || '0', 10) * 1000 + parseInt(frac.slice(0, 3), 10);
    var next = frac.charAt(3);
    if (next && parseInt(next, 10) >= 5) milles += 1;
    if (!isFinite(milles) || milles > MAX_QTY) milles = MAX_QTY;
    return milles;
  }

  function millesToQty(milles) {
    var n = milles / 1000;
    if (milles % 1000 === 0) return String(milles / 1000);
    if (milles % 100 === 0) return n.toFixed(1);
    if (milles % 10 === 0) return n.toFixed(2);
    return n.toFixed(3);
  }

  function paiseToMajor(paise) { return paise / 100; }

  function defaultLine() {
    return {
      desc: '',
      hsn: '',
      unit: 'pcs',
      qtyMilles: 1000,
      ratePaise: 0,
      discountPct: 0,
      taxRate: 18
    };
  }

  function isoToday() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) d = new Date();
    d.setDate(d.getDate() + days);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function defaultInvoice() {
    return {
      docType: 'invoice',
      number: 'INV-0001',
      numberPrefix: 'INV-',
      numberSeq: 1,
      issueDate: isoToday(),
      dueDate: addDays(isoToday(), 15),
      currency: 'INR',
      taxMode: 'exclusive',
      taxSplit: 'intra',
      placeOfSupply: '',
      reverseCharge: false,
      roundOff: true,
      template: 'classic',
      accent: '#4338ca',
      from: { name: '', gstin: '', pan: '', address: '', email: '', phone: '', logo: '' },
      to: { name: '', gstin: '', address: '', email: '', phone: '' },
      items: [defaultLine()],
      shippingPaise: 0,
      shippingTaxRate: 0,
      invoiceDiscountPaise: 0,
      notes: '',
      terms: 'Payment due within 15 days. Please quote the invoice number with the transfer.',
      bank: { name: '', acc: '', ifsc: '', upi: '' },
      paidPaise: 0,
      status: 'unpaid'
    };
  }

  function sampleInvoice() {
    var inv = defaultInvoice();
    inv.number = 'INV-0042';
    inv.numberSeq = 42;
    inv.placeOfSupply = 'Maharashtra (27)';
    inv.from = {
      name: 'Northwind Studio',
      gstin: '27AABCU9603R1ZX',
      pan: 'AABCU9603R',
      address: '14, Turner Road\nBandra West\nMumbai 400050',
      email: 'accounts@northwind.example',
      phone: '+91 22 4000 1200',
      logo: ''
    };
    inv.to = {
      name: 'Cedar & Co.',
      gstin: '27AAPFU0939F1ZV',
      address: '88, Senapati Bapat Marg\nLower Parel\nMumbai 400013',
      email: 'ap@cedar.example',
      phone: ''
    };
    inv.items = [
      { desc: 'Website redesign — 8 pages, CMS, mobile layout', hsn: '998314', unit: 'job', qtyMilles: 1000, ratePaise: 4500000, discountPct: 0, taxRate: 18 },
      { desc: 'Monthly retainer — content updates', hsn: '998314', unit: 'mo', qtyMilles: 2000, ratePaise: 1200000, discountPct: 0, taxRate: 18 },
      { desc: 'Stock photography licence', hsn: '997331', unit: 'set', qtyMilles: 1000, ratePaise: 450000, discountPct: 10, taxRate: 18 }
    ];
    inv.shippingPaise = 0;
    inv.notes = 'Thank you for your business. This is a sample invoice — replace every field before sending.';
    inv.bank = { name: 'HDFC Bank, Bandra West', acc: '50100123456789', ifsc: 'HDFC0000123', upi: 'northwind@hdfcbank' };
    return inv;
  }

  function normalizeParty(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      name: safeText(src.name, 80),
      gstin: safeText(src.gstin, 15).toUpperCase(),
      pan: safeText(src.pan, 10).toUpperCase(),
      address: safeMultiline(src.address, 240),
      email: safeText(src.email, 80),
      phone: safeText(src.phone, 24),
      logo: src.logo !== undefined ? safeLogo(src.logo) : ''
    };
  }

  function normalizeLine(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var qty = src.qtyMilles;
    if (qty === undefined && src.qty !== undefined) qty = decimalToMilles(src.qty);
    var rate = src.ratePaise;
    if (rate === undefined && src.rate !== undefined) rate = decimalToPaise(src.rate);
    return {
      desc: safeText(src.desc, 160),
      hsn: safeText(src.hsn, 12),
      unit: safeText(src.unit, 12) || 'pcs',
      qtyMilles: clampNum(qty, 0, MAX_QTY, 1000),
      ratePaise: clampNum(rate, 0, MAX_MONEY, 0),
      discountPct: clampNum(src.discountPct, 0, 100, 0),
      taxRate: clampNum(src.taxRate, 0, MAX_RATE, 0)
    };
  }

  function normalize(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var d = defaultInvoice();
    var items = Array.isArray(src.items) && src.items.length ? src.items.map(normalizeLine) : d.items;
    if (items.length > MAX_LINES) items = items.slice(0, MAX_LINES);
    var from = normalizeParty(src.from);
    from.logo = src.from && src.from.logo ? safeLogo(src.from.logo) : '';
    var to = normalizeParty(src.to);
    delete to.logo;
    delete to.pan;
    return {
      docType: oneOf(src.docType, DOC_TYPES, 'invoice'),
      number: safeText(src.number, 32) || 'INV-0001',
      numberPrefix: safeText(src.numberPrefix, 12) || 'INV-',
      numberSeq: clampNum(src.numberSeq, 1, 999999, 1),
      issueDate: /^\d{4}-\d{2}-\d{2}$/.test(src.issueDate) ? src.issueDate : d.issueDate,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(src.dueDate) ? src.dueDate : d.dueDate,
      currency: CURRENCIES[src.currency] ? src.currency : 'INR',
      taxMode: oneOf(src.taxMode, TAX_MODES, 'exclusive'),
      taxSplit: oneOf(src.taxSplit, TAX_SPLITS, 'intra'),
      placeOfSupply: safeText(src.placeOfSupply, 48),
      reverseCharge: src.reverseCharge === true,
      roundOff: src.roundOff !== false,
      template: oneOf(src.template, TEMPLATES, 'classic'),
      accent: safeHex(src.accent, '#4338ca'),
      from: from,
      to: to,
      items: items,
      shippingPaise: clampNum(src.shippingPaise, 0, MAX_MONEY, 0),
      shippingTaxRate: clampNum(src.shippingTaxRate, 0, MAX_RATE, 0),
      invoiceDiscountPaise: clampNum(src.invoiceDiscountPaise, 0, MAX_MONEY, 0),
      notes: safeMultiline(src.notes, 600),
      terms: safeMultiline(src.terms, 600),
      bank: {
        name: safeText(src.bank && src.bank.name, 80),
        acc: safeText(src.bank && src.bank.acc, 24),
        ifsc: safeText(src.bank && src.bank.ifsc, 16).toUpperCase(),
        upi: safeText(src.bank && src.bank.upi, 48)
      },
      paidPaise: clampNum(src.paidPaise, 0, MAX_MONEY, 0),
      status: oneOf(src.status, STATUSES, 'unpaid')
    };
  }

  function computeLine(line, taxMode) {
    var qty = line.qtyMilles;
    var rate = line.ratePaise;
    var gross = Math.round(qty * rate / 1000);
    var discount = Math.round(gross * line.discountPct / 100);
    var net = gross - discount;
    var taxable, tax;
    if (taxMode === 'none' || line.taxRate === 0) {
      taxable = net;
      tax = 0;
    } else if (taxMode === 'inclusive') {
      taxable = Math.round(net * 100 / (100 + line.taxRate));
      tax = net - taxable;
    } else {
      taxable = net;
      tax = Math.round(taxable * line.taxRate / 100);
    }
    var cgst = 0, sgst = 0, igst = 0, vat = 0;
    return {
      desc: line.desc,
      hsn: line.hsn,
      unit: line.unit,
      qtyMilles: qty,
      ratePaise: rate,
      discountPct: line.discountPct,
      taxRate: line.taxRate,
      grossPaise: gross,
      discountPaise: discount,
      taxablePaise: taxable,
      taxPaise: tax,
      totalPaise: taxable + tax,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      vatPaise: vat
    };
  }

  function splitTax(taxPaise, taxSplit) {
    if (!taxPaise) return { cgst: 0, sgst: 0, igst: 0, vat: 0 };
    if (taxSplit === 'intra') {
      var cgst = Math.round(taxPaise / 2);
      return { cgst: cgst, sgst: taxPaise - cgst, igst: 0, vat: 0 };
    }
    if (taxSplit === 'inter') return { cgst: 0, sgst: 0, igst: taxPaise, vat: 0 };
    return { cgst: 0, sgst: 0, igst: 0, vat: taxPaise };
  }

  function computeInvoice(raw) {
    var inv = normalize(raw);
    var lines = inv.items.map(function (line) {
      var computed = computeLine(line, inv.taxMode);
      var split = splitTax(computed.taxPaise, inv.taxSplit);
      computed.cgstPaise = split.cgst;
      computed.sgstPaise = split.sgst;
      computed.igstPaise = split.igst;
      computed.vatPaise = split.vat;
      return computed;
    });

    var subtotal = 0, taxTotal = 0, cgst = 0, sgst = 0, igst = 0, vat = 0, lineDiscount = 0;
    var i;
    for (i = 0; i < lines.length; i++) {
      subtotal += lines[i].taxablePaise;
      taxTotal += lines[i].taxPaise;
      cgst += lines[i].cgstPaise;
      sgst += lines[i].sgstPaise;
      igst += lines[i].igstPaise;
      vat += lines[i].vatPaise;
      lineDiscount += lines[i].discountPaise;
    }

    var invoiceDiscount = Math.min(inv.invoiceDiscountPaise, subtotal);
    var afterDiscount = subtotal - invoiceDiscount;

    var shipGross = inv.shippingPaise;
    var shipTaxable, shipTax;
    if (!shipGross || inv.taxMode === 'none' || inv.shippingTaxRate === 0) {
      shipTaxable = shipGross;
      shipTax = 0;
    } else if (inv.taxMode === 'inclusive') {
      shipTaxable = Math.round(shipGross * 100 / (100 + inv.shippingTaxRate));
      shipTax = shipGross - shipTaxable;
    } else {
      shipTaxable = shipGross;
      shipTax = Math.round(shipTaxable * inv.shippingTaxRate / 100);
    }
    var shipSplit = splitTax(shipTax, inv.taxSplit);
    taxTotal += shipTax;
    cgst += shipSplit.cgst;
    sgst += shipSplit.sgst;
    igst += shipSplit.igst;
    vat += shipSplit.vat;

    var grand = afterDiscount + taxTotal + (inv.taxMode === 'inclusive' ? 0 : shipTaxable);
    if (inv.taxMode === 'inclusive') {
      grand = afterDiscount + taxTotal + shipGross;
    }

    /* Exclusive shipping: taxable shipping sits outside line subtotal. */
    if (inv.taxMode === 'exclusive') grand = afterDiscount + taxTotal + shipTaxable;
    if (inv.taxMode === 'none') grand = afterDiscount + shipGross;

    var payable = grand;
    var roundOff = 0;
    if (inv.roundOff) {
      payable = Math.round(grand / 100) * 100;
      roundOff = payable - grand;
    }

    var paid = Math.min(inv.paidPaise, payable);
    var balance = payable - paid;
    var status = inv.status;
    if (payable <= 0) status = 'paid';
    else if (paid <= 0) status = 'unpaid';
    else if (balance <= 0) status = 'paid';
    else status = 'partial';

    var taxGroups = groupTax(lines, shipTax, inv.shippingTaxRate, shipSplit, inv.taxSplit);

    return {
      invoice: inv,
      lines: lines,
      subtotalPaise: subtotal,
      lineDiscountPaise: lineDiscount,
      invoiceDiscountPaise: invoiceDiscount,
      shippingTaxablePaise: shipTaxable,
      shippingTaxPaise: shipTax,
      taxPaise: taxTotal,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      vatPaise: vat,
      grandPaise: grand,
      roundOffPaise: roundOff,
      payablePaise: payable,
      paidPaise: paid,
      balancePaise: balance,
      status: status,
      taxGroups: taxGroups,
      words: amountInWords(payable, inv.currency),
      currency: CURRENCIES[inv.currency]
    };
  }

  function groupTax(lines, shipTax, shipRate, shipSplit, taxSplit) {
    var map = {};
    function add(rate, tax, split) {
      var key = String(rate);
      if (!map[key]) map[key] = { rate: rate, taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, vat: 0 };
      map[key].tax += tax;
      map[key].cgst += split.cgst;
      map[key].sgst += split.sgst;
      map[key].igst += split.igst;
      map[key].vat += split.vat;
    }
    var i, line;
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      var key = String(line.taxRate);
      if (!map[key]) map[key] = { rate: line.taxRate, taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, vat: 0 };
      map[key].taxable += line.taxablePaise;
      map[key].tax += line.taxPaise;
      map[key].cgst += line.cgstPaise;
      map[key].sgst += line.sgstPaise;
      map[key].igst += line.igstPaise;
      map[key].vat += line.vatPaise;
    }
    if (shipTax || shipRate) {
      if (!map[String(shipRate)]) map[String(shipRate)] = { rate: shipRate, taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, vat: 0 };
      /* shipping taxable is handled by caller via shippingTaxablePaise; skip double-count here */
      add(shipRate, shipTax, shipSplit);
    }
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.rate - b.rate; });
  }

  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function words99(n) { return n < 20 ? ONES[n] : (TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')); }
  function words999(n) { return n < 100 ? words99(n) : (ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + words99(n % 100) : '')); }

  function wordsIndian(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'Zero';
    var out = [];
    var cr = Math.floor(n / 10000000); n %= 10000000;
    var lk = Math.floor(n / 100000); n %= 100000;
    var th = Math.floor(n / 1000); n %= 1000;
    if (cr) out.push(wordsIndian(cr) + ' Crore');
    if (lk) out.push(words999(lk) + ' Lakh');
    if (th) out.push(words999(th) + ' Thousand');
    if (n) out.push(words999(n));
    return out.join(' ');
  }

  function wordsIntl(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'Zero';
    var scale = ['', 'Thousand', 'Million', 'Billion'];
    var parts = [];
    var i = 0;
    while (n > 0 && i < 4) {
      var c = n % 1000;
      if (c) parts.unshift(words999(c) + (scale[i] ? ' ' + scale[i] : ''));
      n = Math.floor(n / 1000);
      i++;
    }
    return parts.join(' ');
  }

  function amountInWords(paise, currency) {
    var c = CURRENCIES[currency] || CURRENCIES.INR;
    var neg = paise < 0;
    var abs = Math.abs(paise);
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    var major = c.group === 'indian' ? wordsIndian(whole) : wordsIntl(whole);
    var out = (neg ? 'Minus ' : '') + major + ' ' + c.major;
    if (frac) out += ' and ' + (c.group === 'indian' ? words99(frac) : words99(frac)) + ' ' + c.minor;
    return out + ' Only';
  }

  function grouped(paiseAbs, locale, indian) {
    var whole = Math.floor(paiseAbs / 100);
    var frac = paiseAbs % 100;
    var s;
    if (indian) {
      var str = String(whole);
      if (str.length <= 3) s = str;
      else {
        var last3 = str.slice(-3);
        var rest = str.slice(0, -3);
        s = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
      }
    } else {
      s = whole.toLocaleString(locale);
    }
    return frac ? s + '.' + String(frac).padStart(2, '0') : s + '.00';
  }

  function formatMoney(paise, currency, opts) {
    var c = CURRENCIES[currency] || CURRENCIES.INR;
    var o = opts || {};
    var neg = paise < 0;
    var body = grouped(Math.abs(paise), c.locale, c.group === 'indian');
    var sym = o.pdf ? (c.pdf + ' ') : c.symbol;
    if (o.symbol === false) return (neg ? '-' : '') + body;
    return (neg ? '-' : '') + sym + body;
  }

  function formatDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
    var p = iso.split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return p[2] + ' ' + months[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }

  function docLabel(type) {
    return { invoice: 'Tax Invoice', quote: 'Quotation', proforma: 'Proforma Invoice', credit: 'Credit Note' }[type] || 'Invoice';
  }

  function nextNumber(prefix, seq) {
    var n = clampNum(seq, 1, 999999, 1);
    var pad = n < 10000 ? String(n).padStart(4, '0') : String(n);
    return (prefix || 'INV-') + pad;
  }

  function validateGstin(value) {
    var s = String(value || '').toUpperCase().trim();
    if (!s) return { ok: true, empty: true };
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) {
      return { ok: false, message: 'GSTIN must be 15 characters, for example 27AABCU9603R1ZX.' };
    }
    return { ok: true, empty: false, value: s };
  }

  function warnings(model) {
    var list = [];
    var inv = model.invoice;
    if (!inv.from.name) list.push({ field: 'from.name', message: 'Add your business name before sending.' });
    if (!inv.to.name) list.push({ field: 'to.name', message: 'Add the client name.' });
    if (!inv.items.length || !inv.items.some(function (l) { return l.desc && l.ratePaise; })) {
      list.push({ field: 'items', message: 'Add at least one line with a description and rate.' });
    }
    if (inv.taxMode !== 'none' && inv.from.gstin && !validateGstin(inv.from.gstin).ok) {
      list.push({ field: 'from.gstin', message: validateGstin(inv.from.gstin).message });
    }
    if (model.balancePaise < 0) list.push({ field: 'paid', message: 'Paid amount is more than the payable total.' });
    if (inv.dueDate && inv.issueDate && inv.dueDate < inv.issueDate) {
      list.push({ field: 'dueDate', message: 'Due date is before the issue date.' });
    }
    return list;
  }

  function cloneInvoice(raw) { return normalize(JSON.parse(JSON.stringify(normalize(raw)))); }

  global.InvoiceEngine = {
    defaultInvoice: defaultInvoice,
    sampleInvoice: sampleInvoice,
    defaultLine: defaultLine,
    normalize: normalize,
    computeLine: computeLine,
    computeInvoice: computeInvoice,
    splitTax: splitTax,
    decimalToPaise: decimalToPaise,
    decimalToMilles: decimalToMilles,
    millesToQty: millesToQty,
    paiseToMajor: paiseToMajor,
    formatMoney: formatMoney,
    formatDate: formatDate,
    amountInWords: amountInWords,
    wordsIndian: wordsIndian,
    wordsIntl: wordsIntl,
    escapeHtml: escapeHtml,
    safeLogo: safeLogo,
    safeText: safeText,
    docLabel: docLabel,
    nextNumber: nextNumber,
    validateGstin: validateGstin,
    warnings: warnings,
    cloneInvoice: cloneInvoice,
    isoToday: isoToday,
    addDays: addDays,
    CURRENCIES: CURRENCIES,
    DOC_TYPES: DOC_TYPES,
    TAX_MODES: TAX_MODES,
    TAX_SPLITS: TAX_SPLITS,
    TEMPLATES: TEMPLATES
  };

})(typeof window !== 'undefined' ? window : this);
