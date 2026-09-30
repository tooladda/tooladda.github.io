/* ==========================================================================
   ToolAdda — Luxembourg Invoice Engine

   Totals, VAT treatment, identifier validation and the document's own
   translations. No DOM, so it can be tested on its own.

   Money is stored as integer cents and quantities as milles (thousandths),
   so 2.5 hours at EUR 87.50 is exact rather than 218.74999999999997.

   Four things this file is careful about, because they are what separates a
   Luxembourg invoice from a generic one:

   1. VAT IS ROUNDED ONCE PER RATE, NOT ONCE PER LINE. Ten lines at 17% get
      one rounding, applied to the summed base. Rounding each line instead
      lets the VAT summary disagree with the sum of the lines by a cent or
      two — which is exactly the discrepancy a VAT inspection picks up on.

   2. THE REASON FOR NOT CHARGING VAT IS MANDATORY. An invoice at 0% is not
      a valid invoice unless it says *why* it is at 0%. Each supply type here
      carries its own legal mention, in the invoice's own language, and the
      customer's VAT number becomes mandatory for the cross-border ones.

   3. LUXEMBOURG VAT NUMBERS HAVE A CHECKSUM. LU + eight digits, where the
      last two are the first six modulo 89. That catches a transposed digit
      offline, before it reaches VIES or an accountant.

   4. THE DOCUMENT AND THE INTERFACE ARE DIFFERENT LANGUAGES. The tool is in
      English; the invoice may need to be in French or German because that is
      what the client's accounts department reads. Those are separate
      choices, so the translations here cover the document only.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_MONEY = 1e11;      /* cents — a hundred million euro a line       */
  var MAX_QTY = 1e9;         /* milles                                      */
  var MAX_LINES = 60;

  /* ======================================================================
     1. Luxembourg VAT rates
     ======================================================================

     Four rates, and the official names matter: Luxembourg's 14% is the
     *intermediate* rate and its 8% is the *reduced* one, which is the
     opposite of what the numbers suggest to anyone used to another member
     state. Getting the label wrong on an invoice is the kind of thing a
     client's accountant queries.
     ====================================================================== */

  var VAT_RATES = [
    { rate: 17, key: 'standard', examples: 'Most goods and services — the default' },
    { rate: 14, key: 'intermediate', examples: 'Wine, solid mineral fuels, some advertising and custodial services' },
    { rate: 8, key: 'reduced', examples: 'Electricity, gas, hairdressing, bicycle and shoe repair, cleaning' },
    { rate: 3, key: 'superReduced', examples: 'Food, books, medicine, children’s clothing, passenger transport, restaurants' },
    { rate: 0, key: 'zero', examples: 'Only where the supply type below makes it exempt' }
  ];

  /* ======================================================================
     2. Supply types
     ======================================================================

     Each one decides three things at once: whether VAT is charged, whether
     the customer's VAT number is mandatory, and what legal mention has to
     appear on the face of the invoice. They travel together because getting
     one right and another wrong produces an invoice that looks correct and
     is not.
     ====================================================================== */

  var SUPPLY_TYPES = {
    domestic: {
      key: 'domestic',
      chargesVat: true,
      requiresCustomerVat: false,
      mention: null
    },
    euServices: {
      key: 'euServices',
      chargesVat: false,
      requiresCustomerVat: true,
      mention: 'euServices'
    },
    euGoods: {
      key: 'euGoods',
      chargesVat: false,
      requiresCustomerVat: true,
      mention: 'euGoods'
    },
    export: {
      key: 'export',
      chargesVat: false,
      requiresCustomerVat: false,
      mention: 'export'
    },
    domesticReverse: {
      key: 'domesticReverse',
      chargesVat: false,
      requiresCustomerVat: true,
      mention: 'domesticReverse'
    },
    franchise: {
      key: 'franchise',
      chargesVat: false,
      requiresCustomerVat: false,
      mention: 'franchise'
    }
  };

  var DEFAULT_VAT_RATE = 17;

  var SUPPLY_ORDER = ['domestic', 'euServices', 'euGoods', 'export', 'domesticReverse', 'franchise'];

  /* ======================================================================
     3. Translations — the document only
     ====================================================================== */

  var I18N = {
    en: {
      code: 'en',
      locale: 'en-IE',
      documentType: { invoice: 'Invoice', credit: 'Credit note', quote: 'Quotation', proforma: 'Pro forma invoice' },
      from: 'From', to: 'Bill to',
      invoiceNo: 'Invoice no.', issueDate: 'Issue date', dueDate: 'Due date', supplyDate: 'Date of supply',
      vatNo: 'VAT no.', businessId: 'Business permit no.', rcs: 'Trade register no.',
      description: 'Description', quantity: 'Qty', unit: 'Unit', unitPrice: 'Unit price',
      discount: 'Disc.', netAmount: 'Net amount', vatRate: 'VAT',
      subtotal: 'Subtotal', globalDiscount: 'Discount', taxableBase: 'Taxable base',
      vatSummary: 'VAT summary', base: 'Base', vatAmount: 'VAT amount',
      totalExcl: 'Total excl. VAT', totalVat: 'Total VAT', totalIncl: 'Total incl. VAT',
      amountDue: 'Amount due', paid: 'Already paid', balance: 'Balance due',
      payment: 'Payment details', iban: 'IBAN', bic: 'BIC', bank: 'Bank', reference: 'Payment reference',
      notes: 'Notes', terms: 'Terms', page: 'Page', yourRef: 'Your ref.',
      scanToPay: 'Scan to pay', scanHint: 'SEPA credit transfer',
      supply: {
        domestic: 'Supply in Luxembourg',
        euServices: 'Intra-Community supply of services',
        euGoods: 'Intra-Community supply of goods',
        export: 'Export outside the European Union',
        domesticReverse: 'Domestic reverse charge',
        franchise: 'Small business exemption scheme'
      },
      mention: {
        euServices: 'Reverse charge — VAT to be accounted for by the recipient (Article 196 of Directive 2006/112/EC).',
        euGoods: 'Intra-Community supply, exempt from VAT (Article 138 of Directive 2006/112/EC).',
        export: 'Export outside the European Union, exempt from VAT (Article 146 of Directive 2006/112/EC).',
        domesticReverse: 'Reverse charge — VAT to be accounted for by the recipient.',
        franchise: 'VAT not applicable — small business exemption scheme.'
      },
      rateName: { standard: 'standard', intermediate: 'intermediate', reduced: 'reduced', superReduced: 'super-reduced', zero: 'zero' }
    },

    fr: {
      code: 'fr',
      locale: 'fr-LU',
      documentType: { invoice: 'Facture', credit: 'Note de crédit', quote: 'Devis', proforma: 'Facture pro forma' },
      from: 'Émetteur', to: 'Facturé à',
      invoiceNo: 'Facture n°', issueDate: 'Date d’émission', dueDate: 'Date d’échéance', supplyDate: 'Date de la prestation',
      vatNo: 'N° TVA', businessId: 'N° d’autorisation d’établissement', rcs: 'N° RCS',
      description: 'Désignation', quantity: 'Qté', unit: 'Unité', unitPrice: 'Prix unitaire',
      discount: 'Remise', netAmount: 'Montant net', vatRate: 'TVA',
      subtotal: 'Sous-total', globalDiscount: 'Remise', taxableBase: 'Base imposable',
      vatSummary: 'Récapitulatif TVA', base: 'Base', vatAmount: 'Montant TVA',
      totalExcl: 'Total HTVA', totalVat: 'Total TVA', totalIncl: 'Total TVAC',
      amountDue: 'Montant dû', paid: 'Déjà payé', balance: 'Solde dû',
      payment: 'Coordonnées bancaires', iban: 'IBAN', bic: 'BIC', bank: 'Banque', reference: 'Communication',
      notes: 'Remarques', terms: 'Conditions', page: 'Page', yourRef: 'Votre réf.',
      scanToPay: 'Scanner pour payer', scanHint: 'Virement SEPA',
      supply: {
        domestic: 'Prestation au Luxembourg',
        euServices: 'Prestation de services intracommunautaire',
        euGoods: 'Livraison intracommunautaire de biens',
        export: 'Exportation hors Union européenne',
        domesticReverse: 'Autoliquidation nationale',
        franchise: 'Régime de franchise des petites entreprises'
      },
      mention: {
        euServices: 'Autoliquidation — TVA due par le preneur (article 196 de la directive 2006/112/CE).',
        euGoods: 'Livraison intracommunautaire exonérée de TVA (article 138 de la directive 2006/112/CE).',
        export: 'Exportation hors Union européenne, exonérée de TVA (article 146 de la directive 2006/112/CE).',
        domesticReverse: 'Autoliquidation — TVA due par le preneur.',
        franchise: 'TVA non applicable — régime de franchise des petites entreprises.'
      },
      rateName: { standard: 'normal', intermediate: 'intermédiaire', reduced: 'réduit', superReduced: 'super-réduit', zero: 'zéro' }
    },

    de: {
      code: 'de',
      locale: 'de-LU',
      documentType: { invoice: 'Rechnung', credit: 'Gutschrift', quote: 'Angebot', proforma: 'Pro-forma-Rechnung' },
      from: 'Von', to: 'Rechnung an',
      invoiceNo: 'Rechnungsnr.', issueDate: 'Rechnungsdatum', dueDate: 'Fällig am', supplyDate: 'Leistungsdatum',
      vatNo: 'USt-IdNr.', businessId: 'Niederlassungsgenehmigung', rcs: 'Handelsregisternr.',
      description: 'Bezeichnung', quantity: 'Menge', unit: 'Einheit', unitPrice: 'Einzelpreis',
      discount: 'Rabatt', netAmount: 'Nettobetrag', vatRate: 'MwSt.',
      subtotal: 'Zwischensumme', globalDiscount: 'Rabatt', taxableBase: 'Bemessungsgrundlage',
      vatSummary: 'MwSt.-Übersicht', base: 'Basis', vatAmount: 'MwSt.-Betrag',
      totalExcl: 'Summe netto', totalVat: 'MwSt. gesamt', totalIncl: 'Summe brutto',
      amountDue: 'Rechnungsbetrag', paid: 'Bereits bezahlt', balance: 'Offener Betrag',
      payment: 'Zahlungsdaten', iban: 'IBAN', bic: 'BIC', bank: 'Bank', reference: 'Verwendungszweck',
      notes: 'Anmerkungen', terms: 'Bedingungen', page: 'Seite', yourRef: 'Ihre Ref.',
      scanToPay: 'Zum Bezahlen scannen', scanHint: 'SEPA-Überweisung',
      supply: {
        domestic: 'Leistung in Luxemburg',
        euServices: 'Innergemeinschaftliche Dienstleistung',
        euGoods: 'Innergemeinschaftliche Lieferung',
        export: 'Ausfuhr außerhalb der Europäischen Union',
        domesticReverse: 'Nationale Umkehr der Steuerschuldnerschaft',
        franchise: 'Kleinunternehmerregelung'
      },
      mention: {
        euServices: 'Steuerschuldnerschaft des Leistungsempfängers (Artikel 196 der Richtlinie 2006/112/EG).',
        euGoods: 'Innergemeinschaftliche Lieferung, steuerfrei (Artikel 138 der Richtlinie 2006/112/EG).',
        export: 'Ausfuhrlieferung außerhalb der Europäischen Union, steuerfrei (Artikel 146 der Richtlinie 2006/112/EG).',
        domesticReverse: 'Steuerschuldnerschaft des Leistungsempfängers.',
        franchise: 'Keine Mehrwertsteuer — Kleinunternehmerregelung.'
      },
      rateName: { standard: 'Normalsatz', intermediate: 'Zwischensatz', reduced: 'ermäßigt', superReduced: 'stark ermäßigt', zero: 'null' }
    }
  };

  var LANGS = ['en', 'fr', 'de'];

  function t(lang) {
    return I18N[lang] || I18N.en;
  }

  /* ======================================================================
     4. Identifier validation
     ====================================================================== */

  /* EU VAT number formats, by country. Format only — a well-formed number
     can still be unregistered, which only VIES can tell you. The one
     exception is LU, which carries a checksum we can verify offline. */
  var EU_VAT_FORMATS = {
    AT: /^U[0-9]{8}$/, BE: /^[01][0-9]{9}$/, BG: /^[0-9]{9,10}$/,
    CY: /^[0-9]{8}[A-Z]$/, CZ: /^[0-9]{8,10}$/, DE: /^[0-9]{9}$/,
    DK: /^[0-9]{8}$/, EE: /^[0-9]{9}$/, EL: /^[0-9]{9}$/,
    ES: /^[A-Z0-9][0-9]{7}[A-Z0-9]$/, FI: /^[0-9]{8}$/,
    FR: /^[A-Z0-9]{2}[0-9]{9}$/, HR: /^[0-9]{11}$/, HU: /^[0-9]{8}$/,
    IE: /^([0-9]{7}[A-Z]{1,2}|[0-9][A-Z*+][0-9]{5}[A-Z])$/,
    IT: /^[0-9]{11}$/, LT: /^([0-9]{9}|[0-9]{12})$/, LU: /^[0-9]{8}$/,
    LV: /^[0-9]{11}$/, MT: /^[0-9]{8}$/, NL: /^[0-9]{9}B[0-9]{2}$/,
    PL: /^[0-9]{10}$/, PT: /^[0-9]{9}$/, RO: /^[0-9]{2,10}$/,
    SE: /^[0-9]{12}$/, SI: /^[0-9]{8}$/, SK: /^[0-9]{10}$/
  };

  /* Greece bills as EL but is written GR by nearly everyone; Northern
     Ireland kept an EU-facing prefix after Brexit. Normalise both rather
     than rejecting numbers that are perfectly valid as written. */
  var VAT_PREFIX_ALIAS = { GR: 'EL' };

  function cleanId(value) {
    return String(value === null || value === undefined ? '' : value)
      .toUpperCase().replace(/[^A-Z0-9*+]/g, '');
  }

  /* LU + 8 digits, where the last two are the first six modulo 89. */
  function luVatChecksum(digits) {
    var body = parseInt(digits.slice(0, 6), 10);
    var check = parseInt(digits.slice(6, 8), 10);
    if (!isFinite(body) || !isFinite(check)) return false;
    return body % 89 === check;
  }

  /* Returns { ok, level, country, normalized, message }.
     `level` is 'empty' | 'invalid' | 'format' | 'verified' — 'format' means
     it is well-formed for its country but only VIES can confirm it exists;
     'verified' is reserved for LU, whose checksum we can actually check. */
  function validateVat(value) {
    var raw = cleanId(value);
    if (!raw) return { ok: false, level: 'empty', country: '', normalized: '', message: '' };

    var country = raw.slice(0, 2);
    if (VAT_PREFIX_ALIAS[country]) country = VAT_PREFIX_ALIAS[country];
    var body = raw.slice(2);

    if (!EU_VAT_FORMATS[country]) {
      return {
        ok: false, level: 'invalid', country: country, normalized: raw,
        message: 'Not an EU VAT number. It should start with a two-letter member state code.'
      };
    }

    if (!EU_VAT_FORMATS[country].test(body)) {
      return {
        ok: false, level: 'invalid', country: country, normalized: country + body,
        message: 'Wrong shape for a ' + country + ' VAT number.'
      };
    }

    if (country === 'LU') {
      if (!luVatChecksum(body)) {
        return {
          ok: false, level: 'invalid', country: country, normalized: 'LU' + body,
          message: 'Checksum fails — the last two digits should be the first six modulo 89. Likely a typo.'
        };
      }
      return {
        ok: true, level: 'verified', country: 'LU', normalized: 'LU' + body,
        message: 'Valid Luxembourg VAT number — checksum passes.'
      };
    }

    return {
      ok: true, level: 'format', country: country, normalized: country + body,
      message: 'Well-formed ' + country + ' VAT number. Confirm it is registered on VIES before relying on a reverse charge.'
    };
  }

  /* IBAN lengths for the member states that matter here, plus the handful of
     non-EU countries a Luxembourg business commonly banks with. */
  var IBAN_LENGTHS = {
    AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
    ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26,
    IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15,
    PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27
  };

  /* The mod-97 check from ISO 13616, taken in chunks so the arithmetic stays
     inside a safe integer for an IBAN of any length. */
  function iban97(rearranged) {
    var remainder = 0;
    for (var i = 0; i < rearranged.length; i += 7) {
      remainder = parseInt(String(remainder) + rearranged.substr(i, 7), 10) % 97;
    }
    return remainder;
  }

  function validateIban(value) {
    var raw = cleanId(value);
    if (!raw) return { ok: false, level: 'empty', normalized: '', message: '' };

    var country = raw.slice(0, 2);
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(raw)) {
      return { ok: false, level: 'invalid', normalized: raw, message: 'Not an IBAN — it should be two letters, two digits, then the account.' };
    }

    var expected = IBAN_LENGTHS[country];
    if (expected && raw.length !== expected) {
      return {
        ok: false, level: 'invalid', normalized: raw,
        message: 'A ' + country + ' IBAN is ' + expected + ' characters; this one is ' + raw.length + '.'
      };
    }

    var moved = raw.slice(4) + raw.slice(0, 4);
    var numeric = moved.replace(/[A-Z]/g, function (ch) { return String(ch.charCodeAt(0) - 55); });

    if (iban97(numeric) !== 1) {
      return { ok: false, level: 'invalid', normalized: raw, message: 'Checksum fails — a digit is wrong or transposed.' };
    }

    return { ok: true, level: 'verified', normalized: raw, message: 'Valid IBAN — checksum passes.' };
  }

  /* IBANs are read aloud and typed by hand, so they print in groups of four. */
  /* ======================================================================
     5b. EPC QR (Girocode) payload
     ====================================================================== */

  /* EPC069-12: the SEPA Credit Transfer QR that every European banking app
     scans to prefill a transfer. Twelve lines, in a fixed order, and the
     bank apps are unforgiving about it — an extra field or a stray decimal
     comma and the scan silently does nothing.

     The rules that actually bite, and why each one is enforced here rather
     than left to the caller:

     * EUR ONLY, and the amount is written "EUR12.34" with a dot. This tool
       is euro-only anyway, so the currency is fixed rather than a parameter.
     * VERSION 002 makes the BIC optional. On 001 it is mandatory, so a
       domestic invoice with no BIC to hand would be unscannable. We emit
       002 and include the BIC only when there is one.
     * AMOUNT 0.01 – 999999999.99. A zero balance is not an error — it means
       there is nothing to pay — but it is not a payment either, so no QR is
       produced rather than one that asks for nothing.
     * ONE REMITTANCE FIELD, NOT BOTH. Structured (line 10) and unstructured
       (line 11) are mutually exclusive; filling both invalidates the code.
       We use the unstructured line, which is what a payment reference is.
     * 331 BYTES, UTF-8. The cap is on encoded bytes, not characters, so an
       accented business name costs more than its length suggests. Checked
       after assembly, not estimated before it.

     Returns { ok, payload, reason } rather than throwing or returning null,
     because the caller shows the reason to the user next to the toggle. */

  var EPC_MAX_BYTES = 331;

  /* The spec is a line-based format, so a newline inside a field would be
     read as the start of the next field. Collapse whitespace, then trim to
     the field's own limit. */
  function epcField(value, max) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, max);
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    /* Node before the global TextEncoder, and very old browsers. */
    return unescape(encodeURIComponent(text)).length;
  }

  /* amountCents is the balance actually due, which is the invoice total less
     anything already paid — that is the number the client should transfer,
     not the gross total. */
  function buildEpcPayload(opts) {
    var o = opts || {};
    var iban = cleanId(o.iban);
    var name = epcField(o.name, 70);
    var cents = Math.round(Number(o.amountCents) || 0);

    if (!iban) return { ok: false, payload: '', reason: 'Add an IBAN to show a payment QR code.' };

    var ibanCheck = validateIban(iban);
    if (!ibanCheck.ok) return { ok: false, payload: '', reason: 'The IBAN must be valid before a payment QR code can be produced.' };

    if (!name) return { ok: false, payload: '', reason: 'Add your business name to show a payment QR code.' };

    if (cents <= 0) return { ok: false, payload: '', reason: 'Nothing is due, so there is no payment to encode.' };
    if (cents > 99999999999) return { ok: false, payload: '', reason: 'The amount is above the SEPA QR limit of 999,999,999.99 EUR.' };

    var lines = [
      'BCD',
      '002',
      '1',
      'SCT',
      epcField(o.bic, 11),
      name,
      iban,
      'EUR' + (cents / 100).toFixed(2),
      '',                        /* purpose code — none */
      '',                        /* structured remittance — unused */
      epcField(o.reference, 140),
      ''                         /* beneficiary-to-originator note */
    ];

    /* Trailing empty fields are optional; dropping them buys back bytes for
       a long business name without changing how the code reads. */
    while (lines.length > 6 && lines[lines.length - 1] === '') lines.pop();

    var payload = lines.join('\n');
    if (utf8Bytes(payload) > EPC_MAX_BYTES) {
      return { ok: false, payload: '', reason: 'The payment details are too long to fit in a SEPA QR code.' };
    }
    return { ok: true, payload: payload, reason: '' };
  }

  /* The invoice-shaped wrapper, so callers do not have to know which of the
     computed totals is the one a client should actually transfer. */
  function epcFromModel(model) {
    if (!model || !model.invoice) return { ok: false, payload: '', reason: '' };
    var inv = model.invoice;
    if (!inv.payQr) return { ok: false, payload: '', reason: '' };
    if (inv.docType === 'quote' || inv.docType === 'credit') {
      return { ok: false, payload: '', reason: 'A payment QR code is only added to invoices.' };
    }
    return buildEpcPayload({
      iban: inv.iban,
      bic: inv.bic,
      name: inv.seller.name,
      amountCents: model.balanceCents,
      reference: inv.paymentReference || inv.number
    });
  }

  function formatIban(value) {
    var raw = cleanId(value);
    return raw.replace(/(.{4})/g, '$1 ').trim();
  }

  /* ======================================================================
     5. Money and quantities
     ====================================================================== */

  /* Decimal separators, in a country that writes 1.234,56 and is full of
     people who write 1,234.56. Stripping commas unconditionally — the usual
     shortcut — turns "1 234,56" into a hundred times the money, silently, on
     an invoice. So the separator is worked out rather than assumed:

       * both present  -> the rightmost is the decimal point
       * a lone comma  -> decimal point when it ends the string with one or
                          two digits ("1234,56"), grouping otherwise ("1,234")
       * a lone dot    -> decimal point, which is what type="number" produces

     Returns { neg, whole, frac } with `frac` padded to `places` digits, or
     null when what is left is not a number at all. */
  function parseDecimal(text, places) {
    var raw = String(text === null || text === undefined ? '' : text)
      .replace(/[\s  €]/g, '');
    if (!raw) return null;

    var neg = raw.charAt(0) === '-';
    if (neg) raw = raw.slice(1);

    var lastDot = raw.lastIndexOf('.');
    var lastComma = raw.lastIndexOf(',');

    if (lastDot >= 0 && lastComma >= 0) {
      raw = lastComma > lastDot
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '');
    } else if (lastComma >= 0) {
      raw = /,\d{1,2}$/.test(raw)
        ? raw.replace(',', '.')
        : raw.replace(/,/g, '');
    }

    var parts = raw.match(/^(\d*)(?:\.(\d*))?$/);
    if (!parts) return null;

    /* One digit more than asked for, so a half unit rounds up rather than
       being truncated away. */
    var padded = ((parts[2] || '') + new Array(places + 2).join('0')).slice(0, places + 1);

    return {
      neg: neg,
      whole: parseInt(parts[1] || '0', 10) || 0,
      frac: parseInt(padded, 10) || 0
    };
  }

  /* Money, as an integer number of cents. */
  function toCents(text) {
    var d = parseDecimal(text, 2);
    if (!d) return 0;

    var value = Math.round((d.whole * 1000 + d.frac) / 10);
    if (!isFinite(value)) value = 0;
    value = Math.min(MAX_MONEY, Math.max(0, value));
    return d.neg ? -value : value;
  }

  /* Quantities, as milles. Same separator treatment — "1,5 hours" must be
     one and a half, not fifteen — with a decimal place more than money so a
     part-kilo or a quarter-hour survives. */
  function toMilles(text) {
    var d = parseDecimal(text, 3);
    if (!d) return 0;

    var value = Math.round((d.whole * 10000 + d.frac) / 10);
    if (!isFinite(value)) value = 0;
    return Math.min(MAX_QTY, Math.max(0, value));
  }

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  function safeText(value, max) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\s+/g, ' ').trim().slice(0, max || 200);
  }

  function safeMultiline(value, max) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\r\n/g, '\n').trim().slice(0, max || 900);
  }

  /* ======================================================================
     6. State
     ====================================================================== */

  function isoToday() {
    var d = new Date();
    return [d.getFullYear(),
      ('0' + (d.getMonth() + 1)).slice(-2),
      ('0' + d.getDate()).slice(-2)].join('-');
  }

  function addDays(iso, days) {
    var parts = String(iso || '').split('-');
    var d = new Date(Date.UTC(+parts[0] || 1970, (+parts[1] || 1) - 1, +parts[2] || 1));
    if (isNaN(d.getTime())) return iso;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function defaultLine() {
    return { description: '', unit: '', qty: '1', unitPrice: '', discount: 0, vatRate: 17 };
  }

  function defaultInvoice() {
    var today = isoToday();
    return {
      language: 'en',
      docType: 'invoice',
      supplyType: 'domestic',

      number: 'INV-2026-001',
      issueDate: today,
      supplyDate: '',
      dueDate: addDays(today, 30),

      seller: {
        name: '', address: '', vat: '', rcs: '', permit: '',
        email: '', phone: ''
      },
      buyer: {
        name: '', address: '', vat: '', reference: ''
      },

      lines: [defaultLine()],
      globalDiscount: 0,
      paidAmount: '',

      iban: '', bic: '', bank: '', paymentReference: '',
      payQr: true,
      notes: '', terms: '',
      mentionOverride: '',
      accent: '#24356b',
      logo: ''
    };
  }

  function sampleInvoice() {
    var inv = defaultInvoice();
    inv.seller = {
      name: 'Atelier Kremer S.à r.l.',
      address: '14, rue de la Boucherie\nL-1247 Luxembourg\nLuxembourg',
      vat: 'LU20260743',
      rcs: 'B123456',
      permit: '10012345/0',
      email: 'facturation@atelier-kremer.lu',
      phone: '+352 26 12 34 56'
    };
    inv.buyer = {
      name: 'Nordlicht Medien GmbH',
      address: 'Hafenstraße 8\n54290 Trier\nGermany',
      vat: 'DE123456789',
      reference: 'PO-4471'
    };
    inv.supplyType = 'euServices';
    inv.lines = [
      { description: 'Brand identity workshop', unit: 'day', qty: '2', unitPrice: '1450.00', discount: 0, vatRate: 0 },
      { description: 'Design system build', unit: 'hour', qty: '38.5', unitPrice: '95.00', discount: 5, vatRate: 0 },
      { description: 'Production files and handover', unit: 'item', qty: '1', unitPrice: '640.00', discount: 0, vatRate: 0 }
    ];
    inv.iban = 'LU28 0019 4006 4475 0000';
    inv.bic = 'BCEELULL';
    inv.bank = 'Banque et Caisse d’Épargne de l’État';
    inv.paymentReference = 'INV-2026-001';
    inv.terms = 'Payable within 30 days. Late payment interest at the statutory rate.';
    return inv;
  }

  function normalizeParty(raw, isSeller) {
    var p = raw && typeof raw === 'object' ? raw : {};
    var out = {
      name: safeText(p.name, 120),
      address: safeMultiline(p.address, 400),
      vat: cleanId(p.vat).slice(0, 20)
    };
    if (isSeller) {
      out.rcs = safeText(p.rcs, 40);
      out.permit = safeText(p.permit, 40);
      out.email = safeText(p.email, 120);
      out.phone = safeText(p.phone, 40);
    } else {
      out.reference = safeText(p.reference, 60);
    }
    return out;
  }

  function normalizeLine(raw) {
    var l = raw && typeof raw === 'object' ? raw : {};
    var rates = VAT_RATES.map(function (r) { return r.rate; });
    var rate = clampNum(l.vatRate, 0, 27, 17);
    if (rates.indexOf(rate) === -1) rate = 17;

    return {
      description: safeText(l.description, 200),
      unit: safeText(l.unit, 20),
      qty: String(l.qty === undefined || l.qty === null ? '' : l.qty).slice(0, 16),
      unitPrice: String(l.unitPrice === undefined || l.unitPrice === null ? '' : l.unitPrice).slice(0, 20),
      discount: clampNum(l.discount, 0, 100, 0),
      vatRate: rate
    };
  }

  /* png/jpeg/webp only, base64 only — see the note in normalize. */
  var LOGO_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i;

  function normalize(raw) {
    var d = defaultInvoice();
    var s = raw && typeof raw === 'object' ? raw : {};

    var lines = Array.isArray(s.lines) ? s.lines.slice(0, MAX_LINES).map(normalizeLine) : [defaultLine()];
    if (!lines.length) lines = [defaultLine()];

    var supplyType = oneOf(s.supplyType, SUPPLY_ORDER, d.supplyType);

    /* The supply type and the line rates cannot disagree, so the type wins.
       An exempt supply forces every line to 0%; a taxable one forces any line
       still sitting at 0% back to the standard rate, because Luxembourg has
       no domestic zero rate and a line left at 0% after switching back from
       an exempt type would quietly produce a VAT-free domestic invoice.
       Doing it here rather than at render time means the totals, the PDF and
       the exported JSON can never disagree about it. */
    if (SUPPLY_TYPES[supplyType].chargesVat) {
      lines = lines.map(function (l) {
        if (!l.vatRate) l.vatRate = DEFAULT_VAT_RATE;
        return l;
      });
    } else {
      lines = lines.map(function (l) { l.vatRate = 0; return l; });
    }

    return {
      language: oneOf(s.language, LANGS, d.language),
      docType: oneOf(s.docType, ['invoice', 'credit', 'quote', 'proforma'], d.docType),
      supplyType: supplyType,

      number: safeText(s.number, 40) || d.number,
      issueDate: safeText(s.issueDate, 10) || d.issueDate,
      supplyDate: safeText(s.supplyDate, 10),
      dueDate: safeText(s.dueDate, 10),

      seller: normalizeParty(s.seller, true),
      buyer: normalizeParty(s.buyer, false),

      lines: lines,
      globalDiscount: clampNum(s.globalDiscount, 0, 100, 0),
      paidAmount: String(s.paidAmount === undefined || s.paidAmount === null ? '' : s.paidAmount).slice(0, 20),

      iban: cleanId(s.iban).slice(0, 34),
      bic: cleanId(s.bic).slice(0, 11),
      bank: safeText(s.bank, 120),
      paymentReference: safeText(s.paymentReference, 60),
      payQr: s.payQr === undefined ? d.payQr : !!s.payQr,

      notes: safeMultiline(s.notes, 900),
      terms: safeMultiline(s.terms, 900),
      mentionOverride: safeMultiline(s.mentionOverride, 300),
      accent: /^#[0-9a-f]{6}$/i.test(String(s.accent || '')) ? String(s.accent).toLowerCase() : d.accent,

      /* A logo arrives as a data URL the user chose, and it is written into
         an <img> src and into the PDF. Anything that is not an inline raster
         image is dropped rather than sanitised — SVG is excluded on purpose,
         because an SVG data URL can carry script and this one is rendered
         back into the page. */
      logo: LOGO_URL_RE.test(String(s.logo || '')) ? String(s.logo) : ''
    };
  }

  /* ======================================================================
     7. Totals
     ====================================================================== */

  /* One line's net amount, in cents, before the global discount.

     qty is in milles and unitPrice in cents, so the product is in
     cent-milles and has to come back down by a thousand — with the rounding
     done once, at the end, after the line discount. */
  function computeLine(line) {
    var qty = toMilles(line.qty);
    var unitPrice = toCents(line.unitPrice);
    var gross = (qty * unitPrice) / 1000;
    var discount = gross * (line.discount / 100);
    var net = Math.round(gross - discount);

    return {
      description: line.description,
      unit: line.unit,
      qtyMilles: qty,
      qty: qty / 1000,
      unitPriceCents: unitPrice,
      discount: line.discount,
      vatRate: line.vatRate,
      grossCents: Math.round(gross),
      discountCents: Math.round(discount),
      netCents: net,
      empty: !line.description && !net
    };
  }

  function computeInvoice(raw) {
    var inv = normalize(raw);
    var supply = SUPPLY_TYPES[inv.supplyType];
    var lang = t(inv.language);

    var lines = inv.lines.map(computeLine);
    var live = lines.filter(function (l) { return !l.empty; });

    var subtotalCents = live.reduce(function (a, l) { return a + l.netCents; }, 0);

    /* The global discount is spread across the rate groups in proportion to
       their share of the subtotal, so each group's taxable base is reduced
       by its own share rather than the whole discount landing on one rate. */
    var globalDiscountCents = Math.round(subtotalCents * (inv.globalDiscount / 100));
    var taxableTotalCents = subtotalCents - globalDiscountCents;

    /* Group by rate, then round VAT once per group. */
    var groups = {};
    live.forEach(function (l) {
      var key = String(l.vatRate);
      if (!groups[key]) groups[key] = { rate: l.vatRate, baseCents: 0 };
      groups[key].baseCents += l.netCents;
    });

    var groupList = Object.keys(groups).map(function (key) { return groups[key]; })
      .sort(function (a, b) { return b.rate - a.rate; });

    /* Distribute the discount, giving the last group whatever is left so the
       parts always sum back to the whole. */
    var distributed = 0;
    groupList.forEach(function (g, i) {
      var share = i === groupList.length - 1
        ? globalDiscountCents - distributed
        : Math.round(globalDiscountCents * (g.baseCents / (subtotalCents || 1)));
      distributed += share;
      g.discountCents = share;
      g.taxableCents = g.baseCents - share;
      g.vatCents = Math.round(g.taxableCents * (g.rate / 100));
      g.totalCents = g.taxableCents + g.vatCents;
      g.rateKey = (VAT_RATES.filter(function (r) { return r.rate === g.rate; })[0] || { key: 'zero' }).key;
    });

    var vatTotalCents = groupList.reduce(function (a, g) { return a + g.vatCents; }, 0);
    var totalCents = taxableTotalCents + vatTotalCents;
    var paidCents = toCents(inv.paidAmount);
    var balanceCents = totalCents - paidCents;

    /* Warnings — things that make the invoice legally wrong, not just ugly.
       Kept as data rather than rendered strings so the UI can decide where
       each one belongs. */
    var warnings = [];
    var sellerVat = validateVat(inv.seller.vat);
    var buyerVat = validateVat(inv.buyer.vat);

    if (!inv.seller.name) warnings.push({ field: 'sellerName', level: 'error', message: 'Your business name is missing. An invoice must identify who issued it.' });
    if (!inv.seller.address) warnings.push({ field: 'sellerAddress', level: 'error', message: 'Your address is missing.' });
    if (!inv.buyer.name) warnings.push({ field: 'buyerName', level: 'error', message: 'The customer name is missing.' });
    if (!live.length) warnings.push({ field: 'lines', level: 'error', message: 'Add at least one line with a description and an amount.' });
    if (!inv.number) warnings.push({ field: 'number', level: 'error', message: 'An invoice number is mandatory and must be sequential.' });

    if (supply.chargesVat && !inv.seller.vat) {
      warnings.push({ field: 'sellerVat', level: 'error', message: 'Charging VAT requires your own VAT number on the invoice.' });
    }
    if (inv.seller.vat && !sellerVat.ok) {
      warnings.push({ field: 'sellerVat', level: 'error', message: 'Your VAT number: ' + sellerVat.message });
    }
    if (supply.requiresCustomerVat && !inv.buyer.vat) {
      warnings.push({
        field: 'buyerVat', level: 'error',
        message: 'This supply type requires the customer’s VAT number on the invoice. Without it the exemption does not hold and you owe the VAT yourself.'
      });
    }
    if (inv.buyer.vat && !buyerVat.ok) {
      warnings.push({ field: 'buyerVat', level: 'error', message: 'Customer VAT number: ' + buyerVat.message });
    }
    if (inv.supplyType === 'euServices' || inv.supplyType === 'euGoods') {
      if (buyerVat.ok && buyerVat.country === 'LU') {
        warnings.push({
          field: 'buyerVat', level: 'error',
          message: 'The customer has a Luxembourg VAT number, so this is not an intra-Community supply. Use “Supply in Luxembourg”.'
        });
      } else if (buyerVat.ok) {
        warnings.push({
          field: 'buyerVat', level: 'info',
          message: buyerVat.normalized + ' is well-formed, but only the EU VIES service can confirm it is registered. A reverse charge against an unregistered number is your liability, not the customer’s.'
        });
      }
    }
    var ibanCheck = validateIban(inv.iban);
    if (inv.iban && !ibanCheck.ok) {
      warnings.push({ field: 'iban', level: 'error', message: 'IBAN: ' + ibanCheck.message });
    }
    if (inv.dueDate && inv.issueDate && inv.dueDate < inv.issueDate) {
      warnings.push({ field: 'dueDate', level: 'error', message: 'The due date is before the issue date.' });
    }
    if (balanceCents < 0) {
      warnings.push({ field: 'paidAmount', level: 'info', message: 'More has been paid than the invoice is for — the balance is a credit.' });
    }

    var mention = inv.mentionOverride ||
      (supply.mention ? lang.mention[supply.mention] : '');

    return {
      invoice: inv,
      lang: lang,
      supply: supply,
      lines: lines,
      liveLines: live,
      groups: groupList,

      subtotalCents: subtotalCents,
      globalDiscountCents: globalDiscountCents,
      taxableTotalCents: taxableTotalCents,
      vatTotalCents: vatTotalCents,
      totalCents: totalCents,
      paidCents: paidCents,
      balanceCents: balanceCents,

      sellerVat: sellerVat,
      buyerVat: buyerVat,
      ibanCheck: ibanCheck,
      mention: mention,
      warnings: warnings,
      errorCount: warnings.filter(function (w) { return w.level === 'error'; }).length
    };
  }

  /* ======================================================================
     8. Formatting
     ====================================================================== */

  function formatMoney(cents, lang, opts) {
    var l = t(lang);
    var value = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat(l.locale, {
        style: opts && opts.plain ? 'decimal' : 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    } catch (error) {
      return '€' + value.toFixed(2);
    }
  }

  function formatQty(qty, lang) {
    var l = t(lang);
    try {
      return new Intl.NumberFormat(l.locale, { maximumFractionDigits: 3 }).format(qty);
    } catch (error) {
      return String(qty);
    }
  }

  function formatDate(iso, lang) {
    if (!iso) return '';
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var l = t(lang);
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    if (isNaN(d.getTime())) return iso;
    try {
      return new Intl.DateTimeFormat(l.locale, { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(d);
    } catch (error) {
      return iso;
    }
  }

  /* The next number in a series, preserving the width of the trailing digits
     so INV-2026-009 becomes INV-2026-010 rather than INV-2026-10. */
  function nextNumber(current) {
    var match = String(current || '').match(/^(.*?)(\d+)(\D*)$/);
    if (!match) return current;
    var next = String(parseInt(match[2], 10) + 1);
    while (next.length < match[2].length) next = '0' + next;
    return match[1] + next + match[3];
  }

  global.LUInvoiceEngine = {
    VAT_RATES: VAT_RATES,
    SUPPLY_TYPES: SUPPLY_TYPES,
    SUPPLY_ORDER: SUPPLY_ORDER,
    I18N: I18N,
    LANGS: LANGS,
    EU_VAT_FORMATS: EU_VAT_FORMATS,

    t: t,
    validateVat: validateVat,
    luVatChecksum: luVatChecksum,
    validateIban: validateIban,
    formatIban: formatIban,

    toCents: toCents,
    toMilles: toMilles,
    isoToday: isoToday,
    addDays: addDays,

    defaultLine: defaultLine,
    defaultInvoice: defaultInvoice,
    sampleInvoice: sampleInvoice,
    normalize: normalize,
    computeLine: computeLine,
    computeInvoice: computeInvoice,

    buildEpcPayload: buildEpcPayload,
    epcFromModel: epcFromModel,

    formatMoney: formatMoney,
    formatQty: formatQty,
    formatDate: formatDate,
    nextNumber: nextNumber
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LUInvoiceEngine;

})(typeof window !== 'undefined' ? window : this);
