/* ============================================================
   ToolAdda — Manual Tax Calculator (India)

   The previous version hard-coded a single set of new-regime slabs
   with no year label anywhere on the page. Those slabs were the
   FY 2023-24 table, two budgets out of date, paired with a ₹50,000
   standard deduction that belongs to the *old* regime — a combination
   that corresponds to no real tax year at all. It also had no section
   87A rebate, which is the difference between "you owe nothing" and
   "you owe sixty thousand rupees" for a very large share of the
   people who use a tax calculator.

   This rewrite separates three things that must never be tangled:

     TAX_RULES      versioned, dated statutory configuration
     the engine     pure functions that consume a rule set
     the UI         rendering, which owns no tax knowledge at all

   Adding a financial year means adding one object to TAX_RULES.
   Nothing else changes. A year that has not been configured is
   reported as unavailable rather than silently computed with some
   other year's rules.

   Layout:
     1.  TAX_RULES — the only place statutory values live
     2.  Money primitives
     3.  Validation
     4.  Deduction eligibility
     5.  Slab tax
     6.  Rebate, surcharge, cess
     7.  calculateTax — the single authoritative result
     8.  Regime comparison
     9.  Formatting
     10. Copy text
     11. Engine export
     12. UI state + DOM
     13. Rendering
     14. Actions
     15. Events + init
   ============================================================ */

(function (globalScope) {
  'use strict';

  /* ============================================================
     1. TAX_RULES

     ┌──────────────────────────────────────────────────────────┐
     │  THIS IS THE ONLY BLOCK THAT NEEDS EDITING EACH BUDGET.  │
     │                                                          │
     │  To add a financial year:                                │
     │    1. copy the most recent entry                          │
     │    2. update slabs / deduction caps / rebate / surcharge  │
     │    3. set `status: 'configured'` and `lastReviewed`       │
     │    4. add the year to FY_ORDER below                      │
     │                                                          │
     │  Do not edit slab values anywhere else in this file.      │
     └──────────────────────────────────────────────────────────┘

     Every figure below is stated for a specific financial year and
     carries the statute it comes from. Amounts are in rupees.
     Slabs are [upperBound, ratePercent]; null means "and above".
     ============================================================ */

  var TAX_RULES = {

    'FY2024-25': {
      label: 'FY 2024–25',
      assessmentYear: 'AY 2025–26',
      status: 'configured',
      lastReviewed: '2026-08-11',
      source: 'Finance (No. 2) Act, 2024',
      note: 'New-regime slabs and the ₹75,000 standard deduction as revised in the July 2024 Budget.',
      regimes: {
        old: {
          label: 'Old Regime',
          /* The basic exemption limit varies with age only in the
             old regime. The new regime has a single table. */
          slabsByAge: {
            below60: [[250000, 0], [500000, 5], [1000000, 20], [null, 30]],
            senior: [[300000, 0], [500000, 5], [1000000, 20], [null, 30]],
            superSenior: [[500000, 0], [1000000, 20], [null, 30]]
          },
          standardDeduction: 50000,
          allowsChapterVIA: true,
          deductionCaps: {
            sec80C: 150000,
            sec80CCD1B: 50000,
            homeLoanInterest: 200000,
            sec80D_selfBelow60: 25000,
            sec80D_selfSenior: 50000,
            sec80D_parentsBelow60: 25000,
            sec80D_parentsSenior: 50000,
            sec80TTA: 10000,
            sec80TTB: 50000
          },
          rebate87A: { maxTaxableIncome: 500000, maxRebate: 12500, marginalRelief: false },
          surcharge: [
            { above: 5000000, rate: 10 },
            { above: 10000000, rate: 15 },
            { above: 20000000, rate: 25 },
            { above: 50000000, rate: 37 }
          ],
          cessRate: 4
        },
        new: {
          label: 'New Regime',
          slabsByAge: {
            below60: [[300000, 0], [700000, 5], [1000000, 10], [1200000, 15], [1500000, 20], [null, 30]],
            senior: [[300000, 0], [700000, 5], [1000000, 10], [1200000, 15], [1500000, 20], [null, 30]],
            superSenior: [[300000, 0], [700000, 5], [1000000, 10], [1200000, 15], [1500000, 20], [null, 30]]
          },
          standardDeduction: 75000,
          allowsChapterVIA: false,
          deductionCaps: {},
          rebate87A: { maxTaxableIncome: 700000, maxRebate: 25000, marginalRelief: true },
          /* The new regime's top surcharge rate is capped at 25%. */
          surcharge: [
            { above: 5000000, rate: 10 },
            { above: 10000000, rate: 15 },
            { above: 20000000, rate: 25 }
          ],
          cessRate: 4
        }
      }
    },

    'FY2025-26': {
      label: 'FY 2025–26',
      assessmentYear: 'AY 2026–27',
      status: 'configured',
      lastReviewed: '2026-08-11',
      source: 'Finance Act, 2025',
      note: 'New-regime slabs and the enhanced section 87A rebate as revised in the February 2025 Budget. Old-regime slabs and Chapter VI-A caps unchanged.',
      regimes: {
        old: {
          label: 'Old Regime',
          slabsByAge: {
            below60: [[250000, 0], [500000, 5], [1000000, 20], [null, 30]],
            senior: [[300000, 0], [500000, 5], [1000000, 20], [null, 30]],
            superSenior: [[500000, 0], [1000000, 20], [null, 30]]
          },
          standardDeduction: 50000,
          allowsChapterVIA: true,
          deductionCaps: {
            sec80C: 150000,
            sec80CCD1B: 50000,
            homeLoanInterest: 200000,
            sec80D_selfBelow60: 25000,
            sec80D_selfSenior: 50000,
            sec80D_parentsBelow60: 25000,
            sec80D_parentsSenior: 50000,
            sec80TTA: 10000,
            sec80TTB: 50000
          },
          rebate87A: { maxTaxableIncome: 500000, maxRebate: 12500, marginalRelief: false },
          surcharge: [
            { above: 5000000, rate: 10 },
            { above: 10000000, rate: 15 },
            { above: 20000000, rate: 25 },
            { above: 50000000, rate: 37 }
          ],
          cessRate: 4
        },
        new: {
          label: 'New Regime',
          slabsByAge: {
            below60: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [null, 30]],
            senior: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [null, 30]],
            superSenior: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [null, 30]]
          },
          standardDeduction: 75000,
          allowsChapterVIA: false,
          deductionCaps: {},
          rebate87A: { maxTaxableIncome: 1200000, maxRebate: 60000, marginalRelief: true },
          surcharge: [
            { above: 5000000, rate: 10 },
            { above: 10000000, rate: 15 },
            { above: 20000000, rate: 25 }
          ],
          cessRate: 4
        }
      }
    },

    /* Present so the year appears in the selector and the tool can
       say so honestly, rather than quietly applying last year's
       slabs. Fill in from the Finance Act once published and flip
       `status` to 'configured'. */
    'FY2026-27': {
      label: 'FY 2026–27',
      assessmentYear: 'AY 2027–28',
      status: 'not-configured',
      unavailableMessage: 'Tax rules for this financial year are not available in this calculator yet. Rather than apply another year’s slabs and give you a wrong number, nothing is calculated. Select a configured year above, or check the Income Tax Department for the current Finance Act.'
    }
  };

  /* Newest first — drives the order of the selector. */
  var FY_ORDER = ['FY2026-27', 'FY2025-26', 'FY2024-25'];
  var DEFAULT_FY = 'FY2025-26';

  var AGE_GROUPS = {
    below60: 'Below 60',
    senior: '60 to 79 (senior citizen)',
    superSenior: '80 and above (super senior citizen)'
  };

  /* Amounts under section 288B are rounded to the nearest ₹10. */
  var TAX_ROUNDING_MULTIPLE = 10;

  /* ============================================================
     2. Money primitives

     Rupee amounts are held as integer paise so intermediate
     percentages never produce 12345.000000001.
     ============================================================ */

  var MAX_INCOME = 1e11; /* ₹10,000 crore */

  function toPaise(rupees) { return Math.round(rupees * 100); }
  function toRupees(paise) { return paise / 100; }

  function decimalToPaise(text) {
    var m = /^(\d*)(?:\.(\d*))?$/.exec(String(text));
    if (!m) return null;
    var whole = m[1] || '0';
    var frac = m[2] || '';
    if (whole === '' && frac === '') return null;
    var paise = parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    var next = frac.charAt(2);
    if (next && parseInt(next, 10) >= 5) paise += 1;
    return paise;
  }

  /* ============================================================
     3. Validation
     ============================================================ */

  function invalid(field, message) {
    return { ok: false, field: field, message: message };
  }

  function parseAmount(raw, field, label) {
    if (raw === null || raw === undefined) return { ok: true, paise: 0 };
    var text = String(raw).replace(/[\s,₹]/g, '');
    if (!text) return { ok: true, paise: 0 };
    if (!/^-?\d*\.?\d*$/.test(text) || text === '.' || text === '-') {
      return invalid(field, 'Enter ' + label + ' using digits only.');
    }
    var value = parseFloat(text);
    if (!isFinite(value)) return invalid(field, 'Enter ' + label + ' using digits only.');
    if (value < 0) return invalid(field, cap(label) + ' cannot be negative.');
    if (value > MAX_INCOME) {
      return invalid(field, cap(label) + ' is too large. Enter a value up to ₹10,000 crore.');
    }
    var paise = decimalToPaise(text);
    return { ok: true, paise: paise === null ? toPaise(value) : paise };
  }

  function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

  /* ============================================================
     4. Deduction eligibility

     Deductions are not simply subtracted from income. Each one is
     capped at its statutory limit, and Chapter VI-A deductions are
     unavailable altogether under the new regime. Both the amount
     entered and the amount actually allowed are reported so the
     difference is never silently swallowed.
     ============================================================ */

  function allowed(enteredPaise, capRupees) {
    if (!capRupees && capRupees !== 0) return enteredPaise;
    return Math.min(enteredPaise, toPaise(capRupees));
  }

  function computeDeductions(input, regimeRules) {
    var caps = regimeRules.deductionCaps || {};
    var lines = [];
    var totalEntered = 0;
    var totalAllowed = 0;

    function add(key, label, enteredPaise, capRupees, note) {
      if (!enteredPaise) return;
      var allowedPaise = regimeRules.allowsChapterVIA ? allowed(enteredPaise, capRupees) : 0;
      lines.push({
        key: key, label: label,
        entered: enteredPaise, allowed: allowedPaise,
        capRupees: capRupees === undefined ? null : capRupees,
        note: regimeRules.allowsChapterVIA ? (note || '') : 'Not available under this regime'
      });
      totalEntered += enteredPaise;
      totalAllowed += allowedPaise;
    }

    add('sec80C', 'Section 80C', input.sec80C, caps.sec80C);
    add('sec80CCD1B', 'Section 80CCD(1B) — NPS', input.sec80CCD1B, caps.sec80CCD1B);

    /* 80D has separate caps for yourself and for your parents, and
       each doubles once the insured party is 60 or over. A single
       generic field cannot represent that, so it is two fields. */
    var selfCap = input.selfSenior ? caps.sec80D_selfSenior : caps.sec80D_selfBelow60;
    var parentsCap = input.parentsSenior ? caps.sec80D_parentsSenior : caps.sec80D_parentsBelow60;
    add('sec80D_self', 'Section 80D — self and family', input.sec80D_self, selfCap,
      input.selfSenior ? 'Senior citizen limit applied' : '');
    add('sec80D_parents', 'Section 80D — parents', input.sec80D_parents, parentsCap,
      input.parentsSenior ? 'Senior citizen limit applied' : '');

    add('homeLoanInterest', 'Home loan interest — self-occupied', input.homeLoanInterest, caps.homeLoanInterest);

    /* 80TTB replaces 80TTA once you are a senior citizen. */
    var savingsCap = input.selfSenior ? caps.sec80TTB : caps.sec80TTA;
    var savingsLabel = input.selfSenior ? 'Section 80TTB — interest income' : 'Section 80TTA — savings interest';
    add('savingsInterest', savingsLabel, input.savingsInterest, savingsCap);

    add('otherDeductions', 'Other Chapter VI-A deductions', input.otherDeductions, undefined,
      'No cap applied — enter only the eligible amount');

    /* Employer NPS under 80CCD(2) survives into the new regime. */
    if (input.sec80CCD2) {
      lines.push({
        key: 'sec80CCD2', label: 'Section 80CCD(2) — employer NPS',
        entered: input.sec80CCD2, allowed: input.sec80CCD2,
        capRupees: null,
        note: 'Available under both regimes — enter only the eligible amount'
      });
      totalEntered += input.sec80CCD2;
      totalAllowed += input.sec80CCD2;
    }

    return { lines: lines, totalEntered: totalEntered, totalAllowed: totalAllowed };
  }

  /* ============================================================
     5. Slab tax

     Progressive: each slab taxes only the portion of income that
     falls inside it. Returns the per-slab detail so the UI can show
     the working rather than just a total.
     ============================================================ */

  function slabTax(taxableIncomePaise, slabs) {
    var breakdown = [];
    var total = 0;
    var lower = 0;

    for (var i = 0; i < slabs.length; i++) {
      var upperRupees = slabs[i][0];
      var rate = slabs[i][1];
      var upper = upperRupees === null ? Infinity : toPaise(upperRupees);

      var inSlab = Math.max(0, Math.min(taxableIncomePaise, upper) - lower);
      var tax = Math.round(inSlab * rate / 100);
      total += tax;

      breakdown.push({
        fromPaise: lower,
        toPaise: upper === Infinity ? null : upper,
        rate: rate,
        amountInSlabPaise: inSlab,
        taxPaise: tax
      });

      lower = upper;
      if (upper === Infinity) break;
    }

    return { taxPaise: total, breakdown: breakdown };
  }

  /* ============================================================
     6. Rebate, surcharge, cess
     ============================================================ */

  /* Section 87A. The old regime is a cliff — one rupee over the
     threshold and the whole rebate vanishes. The new regime carries
     marginal relief, which caps the tax at the amount by which
     income exceeds the threshold. Both behaviours are configured
     rather than assumed. */
  function applyRebate(taxPaise, taxableIncomePaise, rebateRules) {
    if (!rebateRules) return { rebatePaise: 0, taxAfterPaise: taxPaise, marginalReliefPaise: 0 };

    var threshold = toPaise(rebateRules.maxTaxableIncome);
    var maxRebate = toPaise(rebateRules.maxRebate);

    if (taxableIncomePaise <= threshold) {
      var rebate = Math.min(taxPaise, maxRebate);
      return { rebatePaise: rebate, taxAfterPaise: taxPaise - rebate, marginalReliefPaise: 0 };
    }

    if (rebateRules.marginalRelief) {
      var excess = taxableIncomePaise - threshold;
      if (taxPaise > excess) {
        return {
          rebatePaise: 0,
          taxAfterPaise: excess,
          marginalReliefPaise: taxPaise - excess
        };
      }
    }

    return { rebatePaise: 0, taxAfterPaise: taxPaise, marginalReliefPaise: 0 };
  }

  function surchargeRateFor(totalIncomePaise, bands) {
    var rate = 0;
    var threshold = 0;
    for (var i = 0; i < bands.length; i++) {
      if (totalIncomePaise > toPaise(bands[i].above)) {
        rate = bands[i].rate;
        threshold = toPaise(bands[i].above);
      }
    }
    return { rate: rate, thresholdPaise: threshold };
  }

  /* Surcharge marginal relief: crossing a threshold must never cost
     more in extra tax than the extra income earned. */
  function applySurcharge(taxAfterRebatePaise, totalIncomePaise, regimeRules, slabs) {
    var band = surchargeRateFor(totalIncomePaise, regimeRules.surcharge || []);
    if (!band.rate) {
      return { surchargePaise: 0, rate: 0, marginalReliefPaise: 0, taxAfterPaise: taxAfterRebatePaise };
    }

    var raw = Math.round(taxAfterRebatePaise * band.rate / 100);
    var withSurcharge = taxAfterRebatePaise + raw;

    var atThreshold = slabTax(band.thresholdPaise, slabs).taxPaise;
    var thresholdBand = surchargeRateFor(band.thresholdPaise, regimeRules.surcharge || []);
    if (thresholdBand.rate) {
      atThreshold += Math.round(atThreshold * thresholdBand.rate / 100);
    }
    var maxAllowed = atThreshold + (totalIncomePaise - band.thresholdPaise);

    if (withSurcharge > maxAllowed) {
      var capped = Math.max(0, maxAllowed - taxAfterRebatePaise);
      return {
        surchargePaise: capped, rate: band.rate,
        marginalReliefPaise: raw - capped,
        taxAfterPaise: taxAfterRebatePaise + capped
      };
    }

    return { surchargePaise: raw, rate: band.rate, marginalReliefPaise: 0, taxAfterPaise: withSurcharge };
  }

  function roundToMultiple(paise, multipleRupees) {
    var m = toPaise(multipleRupees);
    if (!m) return paise;
    return Math.round(paise / m) * m;
  }

  /* ============================================================
     7. calculateTax — the single authoritative result

     Every card, table and chart in the UI renders from this object.
     Nothing recomputes anything of its own, which is what keeps the
     taxable income shown in the summary and the taxable income used
     in the slab table from ever disagreeing.
     ============================================================ */

  function calculateTax(input, fyKey, regimeKey) {
    var fy = TAX_RULES[fyKey];
    if (!fy) {
      return { ok: false, unavailable: true, message: 'Unknown financial year.' };
    }
    if (fy.status !== 'configured') {
      return {
        ok: false, unavailable: true, fy: fyKey, fyLabel: fy.label,
        message: fy.unavailableMessage || 'Tax rules for this financial year are not available.'
      };
    }
    var regimeRules = fy.regimes[regimeKey];
    if (!regimeRules) {
      return { ok: false, unavailable: true, message: 'Unknown tax regime.' };
    }

    var ageGroup = AGE_GROUPS[input.ageGroup] ? input.ageGroup : 'below60';
    var slabs = regimeRules.slabsByAge[ageGroup];

    var salary = input.salary || 0;
    var otherIncome = input.otherIncome || 0;
    var grossIncome = salary + otherIncome;

    /* The standard deduction is a salary deduction, so it is capped
       at the salary itself and does not shelter interest income. */
    var standardDeduction = Math.min(toPaise(regimeRules.standardDeduction), salary);

    var deductions = computeDeductions(input, regimeRules);

    var taxableIncome = Math.max(0, grossIncome - standardDeduction - deductions.totalAllowed);

    var slabResult = slabTax(taxableIncome, slabs);
    var taxBeforeRebate = slabResult.taxPaise;

    var rebate = applyRebate(taxBeforeRebate, taxableIncome, regimeRules.rebate87A);
    var surcharge = applySurcharge(rebate.taxAfterPaise, taxableIncome, regimeRules, slabs);

    var cess = Math.round(surcharge.taxAfterPaise * regimeRules.cessRate / 100);
    var totalBeforeRounding = surcharge.taxAfterPaise + cess;
    var finalTax = roundToMultiple(totalBeforeRounding, TAX_ROUNDING_MULTIPLE);

    return {
      ok: true,
      fy: fyKey,
      fyLabel: fy.label,
      assessmentYear: fy.assessmentYear,
      lastReviewed: fy.lastReviewed,
      source: fy.source,
      regime: regimeKey,
      regimeLabel: regimeRules.label,
      ageGroup: ageGroup,

      salaryPaise: salary,
      otherIncomePaise: otherIncome,
      grossIncomePaise: grossIncome,

      standardDeductionPaise: standardDeduction,
      deductionLines: deductions.lines,
      deductionsEnteredPaise: deductions.totalEntered,
      deductionsAllowedPaise: deductions.totalAllowed,
      totalReliefPaise: standardDeduction + deductions.totalAllowed,

      taxableIncomePaise: taxableIncome,
      slabBreakdown: slabResult.breakdown,
      taxBeforeRebatePaise: taxBeforeRebate,

      rebatePaise: rebate.rebatePaise,
      rebateMarginalReliefPaise: rebate.marginalReliefPaise,
      taxAfterRebatePaise: rebate.taxAfterPaise,

      surchargePaise: surcharge.surchargePaise,
      surchargeRate: surcharge.rate,
      surchargeMarginalReliefPaise: surcharge.marginalReliefPaise,

      cessPaise: cess,
      cessRate: regimeRules.cessRate,

      taxBeforeRoundingPaise: totalBeforeRounding,
      roundingAdjustmentPaise: finalTax - totalBeforeRounding,
      finalTaxPaise: finalTax,

      effectiveRate: grossIncome > 0 ? Math.round((finalTax / grossIncome) * 10000) / 100 : 0,
      netIncomePaise: grossIncome - finalTax
    };
  }

  /* ============================================================
     8. Regime comparison
     ============================================================ */

  function compareRegimes(input, fyKey) {
    var oldResult = calculateTax(input, fyKey, 'old');
    var newResult = calculateTax(input, fyKey, 'new');

    if (!oldResult.ok || !newResult.ok) {
      return { ok: false, unavailable: true, message: oldResult.message || newResult.message };
    }

    var diff = oldResult.finalTaxPaise - newResult.finalTaxPaise;
    return {
      ok: true,
      old: oldResult,
      new: newResult,
      differencePaise: Math.abs(diff),
      lower: diff === 0 ? 'equal' : (diff > 0 ? 'new' : 'old')
    };
  }

  /* What the deductions were actually worth in tax, computed by
     re-running the same loan of inputs with the deductions removed. */
  function deductionImpact(input, fyKey, regimeKey) {
    var withDeductions = calculateTax(input, fyKey, regimeKey);
    if (!withDeductions.ok) return null;

    var stripped = {};
    for (var k in input) {
      if (Object.prototype.hasOwnProperty.call(input, k)) stripped[k] = input[k];
    }
    ['sec80C', 'sec80CCD1B', 'sec80D_self', 'sec80D_parents',
     'homeLoanInterest', 'savingsInterest', 'otherDeductions', 'sec80CCD2'].forEach(function (k) {
      stripped[k] = 0;
    });

    var without = calculateTax(stripped, fyKey, regimeKey);
    if (!without.ok) return null;

    return {
      withPaise: withDeductions.finalTaxPaise,
      withoutPaise: without.finalTaxPaise,
      savedPaise: without.finalTaxPaise - withDeductions.finalTaxPaise
    };
  }

  /* ============================================================
     9. Formatting
     ============================================================ */

  var groupFmt = null;
  var decimalFmt = null;

  function formatINR(value, options) {
    var opts = options || {};
    var n = Number(value);
    if (!isFinite(n)) return '₹0';
    var hasPaise = Math.round(Math.abs(n) * 100) % 100 !== 0;
    var showDecimals = opts.forceDecimals || (hasPaise && !opts.round);
    var sign = n < 0 ? '-' : '';
    var mag = Math.abs(n);
    try {
      if (showDecimals) {
        if (!decimalFmt) {
          decimalFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return sign + '₹' + decimalFmt.format(mag);
      }
      if (!groupFmt) groupFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
      return sign + '₹' + groupFmt.format(Math.round(mag));
    } catch (e) {
      return sign + '₹' + (showDecimals ? mag.toFixed(2) : String(Math.round(mag)));
    }
  }

  function formatPaise(paise, options) {
    return formatINR(toRupees(paise), options || { round: true });
  }

  function formatPercent(n) {
    var v = Number(n);
    if (!isFinite(v)) return '0%';
    return (Math.round(v * 100) / 100) + '%';
  }

  /* ============================================================
     10. Copy text
     ============================================================ */

  function comparisonToText(cmp, input) {
    if (!cmp.ok) return cmp.message;
    var o = cmp.old;
    var n = cmp.new;
    var m = { round: true };
    var lines = [
      'Income Tax Calculation',
      '',
      'Financial year:      ' + o.fyLabel + ' (' + o.assessmentYear + ')',
      'Age group:           ' + AGE_GROUPS[o.ageGroup],
      'Gross income:        ' + formatPaise(o.grossIncomePaise, m),
      '',
      '                      Old Regime        New Regime',
      'Standard deduction:  ' + pad(formatPaise(o.standardDeductionPaise, m)) + pad(formatPaise(n.standardDeductionPaise, m)),
      'Other deductions:    ' + pad(formatPaise(o.deductionsAllowedPaise, m)) + pad(formatPaise(n.deductionsAllowedPaise, m)),
      'Taxable income:      ' + pad(formatPaise(o.taxableIncomePaise, m)) + pad(formatPaise(n.taxableIncomePaise, m)),
      'Tax before rebate:   ' + pad(formatPaise(o.taxBeforeRebatePaise, m)) + pad(formatPaise(n.taxBeforeRebatePaise, m)),
      'Rebate u/s 87A:      ' + pad(formatPaise(o.rebatePaise, m)) + pad(formatPaise(n.rebatePaise, m)),
      'Surcharge:           ' + pad(formatPaise(o.surchargePaise, m)) + pad(formatPaise(n.surchargePaise, m)),
      'Cess:                ' + pad(formatPaise(o.cessPaise, m)) + pad(formatPaise(n.cessPaise, m)),
      'Estimated tax:       ' + pad(formatPaise(o.finalTaxPaise, m)) + pad(formatPaise(n.finalTaxPaise, m)),
      'Effective rate:      ' + pad(formatPercent(o.effectiveRate)) + pad(formatPercent(n.effectiveRate)),
      ''
    ];
    if (cmp.lower === 'equal') {
      lines.push('Both regimes produce the same estimated tax.');
    } else {
      lines.push('Estimated difference: ' + formatPaise(cmp.differencePaise, m) +
        ' lower under the ' + (cmp.lower === 'old' ? 'Old' : 'New') + ' Regime.');
    }
    lines.push('');
    lines.push('Estimate only. Verify with the Income Tax Department or a qualified tax professional.');
    lines.push('Rules last reviewed ' + o.lastReviewed + ' against ' + o.source + '.');
    lines.push('Calculated with tooladda.online/calculators/manual-tax-calculator.html');
    return lines.join('\n');
  }

  function pad(s) {
    var str = String(s);
    while (str.length < 18) str += ' ';
    return str;
  }

  /* ============================================================
     11. Engine export
     ============================================================ */

  var engine = {
    TAX_RULES: TAX_RULES,
    FY_ORDER: FY_ORDER,
    DEFAULT_FY: DEFAULT_FY,
    AGE_GROUPS: AGE_GROUPS,
    MAX_INCOME: MAX_INCOME,
    toPaise: toPaise,
    toRupees: toRupees,
    decimalToPaise: decimalToPaise,
    parseAmount: parseAmount,
    slabTax: slabTax,
    applyRebate: applyRebate,
    surchargeRateFor: surchargeRateFor,
    computeDeductions: computeDeductions,
    calculateTax: calculateTax,
    compareRegimes: compareRegimes,
    deductionImpact: deductionImpact,
    formatINR: formatINR,
    formatPaise: formatPaise,
    formatPercent: formatPercent,
    comparisonToText: comparisonToText
  };

  globalScope.ToolAddaTax = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

  /* Node test runs stop here. */
  if (typeof document === 'undefined') return;

  /* ============================================================
     12. UI state + DOM
     ============================================================ */

  var PREFS_KEY = 'tooladda-tax-prefs';

  /* Illustrative scenarios, not recommendations. */
  var PRESETS = {
    p6: { label: '₹6 L salary', salary: 600000 },
    p10: { label: '₹10 L salary', salary: 1000000 },
    p15: { label: '₹15 L salary', salary: 1500000 },
    p25: { label: '₹25 L salary', salary: 2500000 },
    p50: { label: '₹50 L salary', salary: 5000000 }
  };

  var state = {
    fy: DEFAULT_FY,
    view: 'compare',        /* compare | old | new */
    ageGroup: 'below60',
    comparison: null,
    impact: null
  };

  var dom = {};
  var announceTimer = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cacheDom() {
    dom.root = q('[data-tax-app]');
    if (!dom.root) return false;

    dom.fy = q('[data-tax-fy]', dom.root);
    dom.fyMeta = q('[data-tax-fy-meta]', dom.root);
    dom.age = q('[data-tax-age]', dom.root);
    dom.views = qa('[data-tax-view]', dom.root);

    dom.salary = q('[data-tax-salary]', dom.root);
    dom.otherIncome = q('[data-tax-other-income]', dom.root);
    dom.presets = q('[data-tax-presets]', dom.root);

    dom.sec80C = q('[data-tax-80c]', dom.root);
    dom.sec80CCD1B = q('[data-tax-80ccd1b]', dom.root);
    dom.sec80CCD2 = q('[data-tax-80ccd2]', dom.root);
    dom.sec80D_self = q('[data-tax-80d-self]', dom.root);
    dom.sec80D_parents = q('[data-tax-80d-parents]', dom.root);
    dom.parentsSenior = q('[data-tax-parents-senior]', dom.root);
    dom.homeLoanInterest = q('[data-tax-home-loan]', dom.root);
    dom.savingsInterest = q('[data-tax-savings]', dom.root);
    dom.otherDeductions = q('[data-tax-other-deductions]', dom.root);

    dom.errors = q('[data-tax-errors]', dom.root);
    dom.unavailable = q('[data-tax-unavailable]', dom.root);
    dom.results = q('[data-tax-results]', dom.root);
    dom.calculate = q('[data-tax-calculate]', dom.root);
    dom.reset = q('[data-tax-reset]', dom.root);

    dom.headlineLabel = q('[data-tax-headline-label]', dom.root);
    dom.headline = q('[data-tax-headline]', dom.root);
    dom.headlineNote = q('[data-tax-headline-note]', dom.root);
    dom.flow = q('[data-tax-flow]', dom.root);
    dom.compare = q('[data-tax-compare]', dom.root);
    dom.verdict = q('[data-tax-verdict]', dom.root);
    dom.breakdown = q('[data-tax-breakdown]', dom.root);
    dom.slabs = q('[data-tax-slabs]', dom.root);
    dom.slabCaption = q('[data-tax-slab-caption]', dom.root);
    dom.deductionTable = q('[data-tax-deduction-table]', dom.root);
    dom.impact = q('[data-tax-impact]', dom.root);
    dom.status = q('[data-tax-status]', dom.root);

    dom.copy = q('[data-tax-copy]', dom.root);
    dom.share = q('[data-tax-share]', dom.root);
    dom.print = q('[data-tax-print]', dom.root);
    dom.printStamp = q('[data-tax-print-stamp]', dom.root);

    dom.oldOnly = qa('[data-tax-old-only]', dom.root);

    return true;
  }

  /* ============================================================
     13. Rendering
     ============================================================ */

  function announce(message) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { dom.status.textContent = message; }, 500);
  }

  function renderFyOptions() {
    dom.fy.innerHTML = FY_ORDER.map(function (key) {
      var fy = TAX_RULES[key];
      var suffix = fy.status === 'configured' ? '' : ' — rules not yet added';
      return '<option value="' + key + '">' + esc(fy.label + ' (' + fy.assessmentYear + ')' + suffix) + '</option>';
    }).join('');
    dom.fy.value = state.fy;
  }

  function renderFyMeta() {
    var fy = TAX_RULES[state.fy];
    if (!fy) { dom.fyMeta.textContent = ''; return; }
    if (fy.status !== 'configured') {
      dom.fyMeta.innerHTML = '<strong>Rules not configured for this year.</strong>';
      return;
    }
    dom.fyMeta.innerHTML =
      'Applying <strong>' + esc(fy.label) + '</strong> rules (' + esc(fy.assessmentYear) + '). ' +
      'Last reviewed ' + esc(fy.lastReviewed) + ' against ' + esc(fy.source) + '.';
  }

  function renderAgeOptions() {
    dom.age.innerHTML = Object.keys(AGE_GROUPS).map(function (k) {
      return '<option value="' + k + '">' + esc(AGE_GROUPS[k]) + '</option>';
    }).join('');
    dom.age.value = state.ageGroup;
  }

  function showErrors(list) {
    if (!list.length) {
      dom.errors.hidden = true;
      dom.errors.innerHTML = '';
      qa('[data-tax-field]', dom.root).forEach(function (el) { el.removeAttribute('aria-invalid'); });
      return;
    }
    dom.errors.hidden = false;
    dom.errors.innerHTML = '<ul>' + list.map(function (e) {
      return '<li>' + esc(e.message) + '</li>';
    }).join('') + '</ul>';
    qa('[data-tax-field]', dom.root).forEach(function (el) { el.removeAttribute('aria-invalid'); });
    list.forEach(function (e) {
      var el = q('[data-tax-field="' + e.field + '"]', dom.root);
      if (el) el.setAttribute('aria-invalid', 'true');
    });
    announce(list[0].message);
  }

  function row(label, value, variant, hint) {
    return '<div class="tax-row' + (variant ? ' tax-row--' + variant : '') + '">' +
      '<dt>' + esc(label) + (hint ? '<span class="tax-row__hint">' + esc(hint) + '</span>' : '') + '</dt>' +
      '<dd>' + value + '</dd></div>';
  }

  function activeResult() {
    if (!state.comparison || !state.comparison.ok) return null;
    if (state.view === 'old') return state.comparison.old;
    if (state.view === 'new') return state.comparison.new;
    /* In compare mode the headline follows whichever regime is lower. */
    return state.comparison.lower === 'old' ? state.comparison.old : state.comparison.new;
  }

  /* The deduction table and the impact panel deliberately do NOT
     follow the headline. Chapter VI-A only ever applies under the old
     regime, so rendering them from whichever regime happens to be
     cheaper would show every entry as "allowed ₹0, limit —" and hide
     the caps — which is the one thing this table exists to show. */
  function deductionContextResult() {
    if (!state.comparison || !state.comparison.ok) return null;
    return state.view === 'new' ? state.comparison.new : state.comparison.old;
  }

  function renderResult() {
    var cmp = state.comparison;
    var r = activeResult();
    if (!r) return;

    dom.headlineLabel.textContent = state.view === 'compare'
      ? 'Lower estimated tax — ' + r.regimeLabel
      : 'Estimated tax — ' + r.regimeLabel;
    dom.headline.textContent = formatPaise(r.finalTaxPaise);
    dom.headlineNote.textContent =
      'Effective rate ' + formatPercent(r.effectiveRate) + ' of gross income · ' +
      'Taxable income ' + formatPaise(r.taxableIncomePaise) + ' · ' + r.fyLabel;

    renderFlow(r);
    renderCompare(cmp);
    renderBreakdown(r);
    renderSlabs(r);
    renderDeductionTable(deductionContextResult());
    renderImpact();

    var spoken = 'Tax calculated for ' + r.fyLabel + '. ' +
      'Taxable income ' + formatPaise(r.taxableIncomePaise) + '. ' +
      'Estimated tax ' + formatPaise(r.finalTaxPaise) + ' under the ' + r.regimeLabel + '.';
    if (state.view === 'compare' && cmp.lower !== 'equal') {
      spoken += ' That is ' + formatPaise(cmp.differencePaise) + ' lower than the other regime.';
    }
    announce(spoken);
  }

  /* Income → relief → taxable income, as three visible steps. */
  function renderFlow(r) {
    dom.flow.innerHTML =
      '<div class="tax-flow__step tax-flow__step--income"><span>Gross income</span><strong>' +
        formatPaise(r.grossIncomePaise) + '</strong></div>' +
      '<div class="tax-flow__op"><span aria-hidden="true">−</span>' +
        '<span class="tax-flow__oplabel">Standard deduction</span><strong>' +
        formatPaise(r.standardDeductionPaise) + '</strong></div>' +
      '<div class="tax-flow__op"><span aria-hidden="true">−</span>' +
        '<span class="tax-flow__oplabel">Eligible deductions</span><strong>' +
        formatPaise(r.deductionsAllowedPaise) + '</strong></div>' +
      '<div class="tax-flow__step tax-flow__step--taxable"><span>Taxable income</span><strong>' +
        formatPaise(r.taxableIncomePaise) + '</strong></div>';
  }

  function renderCompare(cmp) {
    var o = cmp.old;
    var n = cmp.new;

    var rows = [
      ['Gross income', o.grossIncomePaise, n.grossIncomePaise],
      ['Standard deduction', o.standardDeductionPaise, n.standardDeductionPaise],
      ['Other deductions allowed', o.deductionsAllowedPaise, n.deductionsAllowedPaise],
      ['Taxable income', o.taxableIncomePaise, n.taxableIncomePaise],
      ['Tax before rebate', o.taxBeforeRebatePaise, n.taxBeforeRebatePaise],
      ['Rebate u/s 87A', o.rebatePaise, n.rebatePaise],
      ['Surcharge', o.surchargePaise, n.surchargePaise],
      ['Health & education cess', o.cessPaise, n.cessPaise]
    ];

    dom.compare.innerHTML =
      '<caption>Old and new regime compared on the same income and deductions, ' +
        esc(o.fyLabel) + '</caption>' +
      '<thead><tr><th scope="col">Line</th><th scope="col">Old Regime</th><th scope="col">New Regime</th></tr></thead>' +
      '<tbody>' + rows.map(function (r) {
        return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + formatPaise(r[1]) +
          '</td><td>' + formatPaise(r[2]) + '</td></tr>';
      }).join('') +
      '<tr class="tax-compare__final"><th scope="row">Estimated tax</th><td>' +
        formatPaise(o.finalTaxPaise) + '</td><td>' + formatPaise(n.finalTaxPaise) + '</td></tr>' +
      '<tr><th scope="row">Effective rate</th><td>' + formatPercent(o.effectiveRate) +
        '</td><td>' + formatPercent(n.effectiveRate) + '</td></tr>' +
      '</tbody>';

    if (cmp.lower === 'equal') {
      dom.verdict.className = 'tax-verdict';
      dom.verdict.innerHTML = '<strong>Both regimes produce the same estimated tax</strong>' +
        '<span>On these figures there is no difference in tax between the two regimes.</span>';
      return;
    }
    var lowerLabel = cmp.lower === 'old' ? 'Old Regime' : 'New Regime';
    dom.verdict.className = 'tax-verdict tax-verdict--' + cmp.lower;
    dom.verdict.innerHTML =
      '<strong>' + esc(lowerLabel) + ' is lower by ' + formatPaise(cmp.differencePaise) + '</strong>' +
      '<span>On the income and deductions entered, for ' + esc(o.fyLabel) +
      '. This is an arithmetic comparison of two estimates, not a recommendation — ' +
      'your actual position depends on income types, eligibility and rules this tool does not model.</span>';
  }

  function renderBreakdown(r) {
    var html = '';
    html += row('Gross income', formatPaise(r.grossIncomePaise), 'income');
    html += row('Standard deduction', '− ' + formatPaise(r.standardDeductionPaise), 'deduction');
    html += row('Eligible deductions', '− ' + formatPaise(r.deductionsAllowedPaise), 'deduction');
    html += row('Taxable income', formatPaise(r.taxableIncomePaise), 'taxable');
    html += row('Tax on slabs', formatPaise(r.taxBeforeRebatePaise), 'tax');

    if (r.rebatePaise > 0) {
      html += row('Rebate u/s 87A', '− ' + formatPaise(r.rebatePaise), 'relief');
    } else if (r.rebateMarginalReliefPaise > 0) {
      html += row('Marginal relief on rebate', '− ' + formatPaise(r.rebateMarginalReliefPaise), 'relief',
        'Caps the tax at the amount by which income exceeds the rebate threshold');
    } else {
      html += row('Rebate u/s 87A', 'Not applicable', 'muted');
    }

    if (r.surchargePaise > 0) {
      html += row('Surcharge at ' + r.surchargeRate + '%', '+ ' + formatPaise(r.surchargePaise), 'tax');
      if (r.surchargeMarginalReliefPaise > 0) {
        html += row('Marginal relief on surcharge', '− ' + formatPaise(r.surchargeMarginalReliefPaise), 'relief');
      }
    }

    html += row('Health & education cess at ' + r.cessRate + '%', '+ ' + formatPaise(r.cessPaise), 'tax');

    if (r.roundingAdjustmentPaise !== 0) {
      html += row('Rounding u/s 288B', (r.roundingAdjustmentPaise > 0 ? '+ ' : '− ') +
        formatPaise(Math.abs(r.roundingAdjustmentPaise)), 'muted', 'Tax is rounded to the nearest ₹10');
    }

    html += row('Estimated tax payable', formatPaise(r.finalTaxPaise), 'final');
    html += row('Effective tax rate', formatPercent(r.effectiveRate), 'muted',
      'Final tax as a share of gross income — not the top slab rate');
    html += row('Income after tax', formatPaise(r.netIncomePaise), 'muted');

    dom.breakdown.innerHTML = html;
  }

  /* Slab bands: the width of each bar is the share of taxable income
     that falls in that slab, with the amount and tax stated next to
     it so nothing depends on reading the bar. */
  function renderSlabs(r) {
    var used = r.slabBreakdown.filter(function (s) { return s.amountInSlabPaise > 0; });
    if (!used.length) {
      dom.slabs.innerHTML = '<p class="tax-empty">Taxable income is nil, so no slab tax arises.</p>';
      dom.slabCaption.textContent = '';
      return;
    }
    var maxAmount = 0;
    used.forEach(function (s) { if (s.amountInSlabPaise > maxAmount) maxAmount = s.amountInSlabPaise; });

    dom.slabCaption.textContent =
      r.regimeLabel + ', ' + r.fyLabel + ' — how ' + formatPaise(r.taxableIncomePaise) +
      ' of taxable income is taxed slab by slab.';

    dom.slabs.innerHTML = used.map(function (s) {
      var range = formatPaise(s.fromPaise) + ' – ' + (s.toPaise === null ? 'above' : formatPaise(s.toPaise));
      var width = maxAmount ? Math.max(4, (s.amountInSlabPaise / maxAmount) * 100) : 0;
      return '<div class="tax-slab">' +
        '<div class="tax-slab__head"><span class="tax-slab__range">' + esc(range) + '</span>' +
        '<span class="tax-slab__rate">' + s.rate + '%</span></div>' +
        '<div class="tax-slab__bar"><span style="width:' + width.toFixed(1) + '%"></span></div>' +
        '<div class="tax-slab__foot"><span>' + formatPaise(s.amountInSlabPaise) + ' taxed here</span>' +
        '<strong>' + formatPaise(s.taxPaise) + '</strong></div>' +
        '</div>';
    }).join('');
  }

  /* Entered versus allowed, always both, so a capped deduction is
     visible rather than quietly reduced. */
  function renderDeductionTable(r) {
    if (!r.deductionLines.length) {
      dom.deductionTable.innerHTML =
        '<p class="tax-empty">No deductions entered. Only the standard deduction of ' +
        formatPaise(r.standardDeductionPaise) + ' has been applied.</p>';
      return;
    }
    dom.deductionTable.innerHTML =
      '<table class="tax-table"><caption>Deductions entered and the amount allowed under the ' +
      esc(r.regimeLabel) + ' for ' + esc(r.fyLabel) + '</caption>' +
      '<thead><tr><th scope="col">Deduction</th><th scope="col">Entered</th>' +
      '<th scope="col">Allowed</th><th scope="col">Limit</th></tr></thead><tbody>' +
      r.deductionLines.map(function (l) {
        var capped = l.allowed < l.entered;
        return '<tr' + (capped ? ' class="tax-capped"' : '') + '>' +
          '<th scope="row">' + esc(l.label) +
          (l.note ? '<span class="tax-note">' + esc(l.note) + '</span>' : '') + '</th>' +
          '<td>' + formatPaise(l.entered) + '</td>' +
          '<td>' + formatPaise(l.allowed) + '</td>' +
          '<td>' + (l.capRupees === null || l.capRupees === undefined ? '—' : formatINR(l.capRupees)) + '</td>' +
          '</tr>';
      }).join('') +
      '<tr class="tax-compare__final"><th scope="row">Total</th><td>' +
      formatPaise(r.deductionsEnteredPaise) + '</td><td>' +
      formatPaise(r.deductionsAllowedPaise) + '</td><td>—</td></tr>' +
      '</tbody></table>';
  }

  function renderImpact() {
    if (!dom.impact) return;
    var imp = state.impact;
    if (!imp || imp.savedPaise <= 0) {
      dom.impact.innerHTML = '<p class="tax-hint">Enter deductions above to see what they are worth in tax.</p>';
      return;
    }
    var r = deductionContextResult();
    dom.impact.innerHTML =
      '<dl class="tax-compare-cards">' +
      '<div><dt>Tax without deductions</dt><dd>' + formatPaise(imp.withoutPaise) + '</dd></div>' +
      '<div><dt>Tax with deductions</dt><dd>' + formatPaise(imp.withPaise) + '</dd></div>' +
      '<div class="tax-compare-cards__win"><dt>Estimated tax impact</dt><dd>' +
        formatPaise(imp.savedPaise) + '</dd></div>' +
      '</dl>' +
      '<p class="tax-hint">Calculated under the ' + esc(r.regimeLabel) +
      '. Deductions under Chapter VI-A are not available under the new regime, so the same ' +
      'entries can be worth nothing there and a great deal under the old regime.</p>';
  }

  function renderUnavailable(message) {
    state.comparison = null;
    state.impact = null;
    dom.unavailable.hidden = false;
    dom.unavailable.innerHTML = '<strong>Tax rules unavailable</strong><span>' + esc(message) + '</span>';
    dom.results.hidden = true;
    setActionsEnabled(false);
    announce(message);
  }

  function setActionsEnabled(on) {
    [dom.copy, dom.share, dom.print].forEach(function (b) { if (b) b.disabled = !on; });
  }

  /* ============================================================
     14. Actions
     ============================================================ */

  function readInputs() {
    var errors = [];

    function amount(el, field, label) {
      var res = parseAmount(el ? el.value : '', field, label);
      if (!res.ok) { errors.push(res); return 0; }
      return res.paise;
    }

    var input = {
      ageGroup: state.ageGroup,
      salary: amount(dom.salary, 'salary', 'a salary amount'),
      otherIncome: amount(dom.otherIncome, 'otherIncome', 'other income'),
      sec80C: amount(dom.sec80C, 'sec80C', 'a section 80C amount'),
      sec80CCD1B: amount(dom.sec80CCD1B, 'sec80CCD1B', 'a section 80CCD(1B) amount'),
      sec80CCD2: amount(dom.sec80CCD2, 'sec80CCD2', 'a section 80CCD(2) amount'),
      sec80D_self: amount(dom.sec80D_self, 'sec80D_self', 'a section 80D amount'),
      sec80D_parents: amount(dom.sec80D_parents, 'sec80D_parents', 'a section 80D amount for parents'),
      homeLoanInterest: amount(dom.homeLoanInterest, 'homeLoanInterest', 'a home loan interest amount'),
      savingsInterest: amount(dom.savingsInterest, 'savingsInterest', 'a savings interest amount'),
      otherDeductions: amount(dom.otherDeductions, 'otherDeductions', 'other deductions'),
      selfSenior: state.ageGroup !== 'below60',
      parentsSenior: !!(dom.parentsSenior && dom.parentsSenior.checked)
    };

    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, input: input };
  }

  function run() {
    var fy = TAX_RULES[state.fy];
    if (!fy || fy.status !== 'configured') {
      showErrors([]);
      renderUnavailable(fy ? fy.unavailableMessage : 'Unknown financial year.');
      return;
    }
    dom.unavailable.hidden = true;

    var read = readInputs();
    if (!read.ok) {
      showErrors(read.errors);
      state.comparison = null;
      dom.results.hidden = true;
      setActionsEnabled(false);
      return;
    }
    showErrors([]);

    var cmp = compareRegimes(read.input, state.fy);
    if (!cmp.ok) { renderUnavailable(cmp.message); return; }

    state.comparison = cmp;
    /* Same reasoning as deductionContextResult: what the deductions
       are worth is an old-regime question unless the user has
       explicitly asked to see only the new regime. */
    state.impact = deductionImpact(read.input, state.fy, state.view === 'new' ? 'new' : 'old');

    dom.results.hidden = false;
    setActionsEnabled(true);
    renderResult();
  }

  function flash(button, text) {
    if (!button) return;
    var original = button.getAttribute('data-tax-label') || button.textContent;
    button.setAttribute('data-tax-label', original);
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1600);
  }

  function copyResult() {
    if (!state.comparison) return;
    var text = comparisonToText(state.comparison);
    if (!navigator.clipboard || !navigator.clipboard.writeText) { flash(dom.copy, 'Unavailable'); return; }
    navigator.clipboard.writeText(text).then(function () {
      flash(dom.copy, 'Copied ✓');
      dom.status.textContent = 'Tax summary copied to the clipboard.';
    }, function () { flash(dom.copy, 'Copy failed'); });
  }

  function shareResult() {
    if (!state.comparison) return;
    var text = comparisonToText(state.comparison);
    if (navigator.share) {
      navigator.share({ title: 'Income Tax Calculation', text: text }).catch(function () { /* dismissed */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flash(dom.share, 'Copied ✓');
        dom.status.textContent = 'Sharing is not available in this browser, so the summary was copied instead.';
      });
      return;
    }
    flash(dom.share, 'Unavailable');
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
     15. Preferences, events, init

     Only the financial year, view and age group are remembered.
     Incomes and deductions are never written to storage — the old
     version wrote the whole result object on every calculation and
     never read it back.
     ============================================================ */

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        fy: state.fy, view: state.view, ageGroup: state.ageGroup
      }));
    } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.fy && TAX_RULES[saved.fy]) state.fy = saved.fy;
      if (['compare', 'old', 'new'].indexOf(saved.view) !== -1) state.view = saved.view;
      if (AGE_GROUPS[saved.ageGroup]) state.ageGroup = saved.ageGroup;
    } catch (e) { /* corrupt prefs fall back to defaults */ }
  }

  function syncViewButtons() {
    dom.views.forEach(function (b) {
      var on = b.getAttribute('data-tax-view') === state.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    /* Old-regime-only fields stay visible in compare mode, because
       comparing is exactly when you need to see what they would be
       worth. They are dimmed when only the new regime is shown. */
    dom.oldOnly.forEach(function (el) {
      el.classList.toggle('is-inactive', state.view === 'new');
    });
  }

  function bindEvents() {
    dom.fy.addEventListener('change', function () {
      state.fy = dom.fy.value;
      renderFyMeta();
      savePrefs();
      run();
    });

    dom.age.addEventListener('change', function () {
      state.ageGroup = dom.age.value;
      savePrefs();
      run();
    });

    dom.views.forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.getAttribute('data-tax-view');
        syncViewButtons();
        savePrefs();
        run();
      });
    });

    qa('[data-tax-field]', dom.root).forEach(function (el) {
      el.addEventListener('input', run);
    });
    if (dom.parentsSenior) dom.parentsSenior.addEventListener('change', run);

    dom.presets.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tax-preset]');
      if (!btn) return;
      var preset = PRESETS[btn.getAttribute('data-tax-preset')];
      if (!preset) return;
      dom.salary.value = preset.salary;
      run();
      dom.salary.focus();
    });

    dom.calculate.addEventListener('click', run);

    dom.reset.addEventListener('click', function () {
      state.fy = DEFAULT_FY;
      state.view = 'compare';
      state.ageGroup = 'below60';
      dom.fy.value = state.fy;
      dom.age.value = state.ageGroup;
      qa('[data-tax-field]', dom.root).forEach(function (el) { el.value = ''; });
      dom.salary.value = '1200000';
      if (dom.parentsSenior) dom.parentsSenior.checked = false;
      syncViewButtons();
      renderFyMeta();
      savePrefs();
      run();
      dom.status.textContent = 'Calculator reset to defaults.';
    });

    dom.copy.addEventListener('click', copyResult);
    dom.share.addEventListener('click', shareResult);
    dom.print.addEventListener('click', printResult);
  }

  function init() {
    if (!cacheDom()) return;

    loadPrefs();
    renderFyOptions();
    renderAgeOptions();
    renderFyMeta();
    syncViewButtons();

    if (!dom.salary.value) dom.salary.value = '1200000';

    bindEvents();
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
