/* ==========================================================================
   ToolAdda — Luxembourg Gross-to-Net Salary Engine

   All the Luxembourg payroll arithmetic, with no DOM, so it can be tested
   on its own and reused by a future frontalier or employer-cost tool.

   Luxembourg is unusual enough that a generic "income tax calculator" gets
   it wrong in five specific ways. This file exists to get those five right.

   1. THE 23-BRACKET SCALE IS NOT THE WHOLE TAX. On top of the barème sits
      the employment-fund surcharge (contribution au fonds pour l'emploi) —
      7% of the tax itself, rising to 9% for the highest earners. It is a
      tax on a tax, not an extra bracket, so it has to be applied after the
      scale and before the credits.

   2. TAX CLASS 1a IS NOT A SECOND BRACKET TABLE. The law (art. 119 LIR)
      defines it as a *transformation* of class 1: the scale is applied to
      the income reduced by a quarter of its shortfall against EUR 79,380,
      and the resulting marginal rate is then capped at 39/40/41/42%. That
      is why class 1a is tax-free to EUR 26,460 — exactly the income whose
      reduced base lands on the EUR 13,230 zero band — and why its advantage
      stops growing and settles at a fixed amount for high earners.

   3. THE DEPENDENCY CONTRIBUTION PLAYS BY ITS OWN RULES. Health and pension
      are capped at the social ceiling and are deductible from taxable
      income. The dependency contribution (assurance dépendance) is neither:
      it is charged on the *whole* salary with no ceiling, it gets its own
      allowance of a quarter of the minimum wage, and it is explicitly NOT
      tax-deductible. Treating all three alike — which is the common
      shortcut — overstates the deduction and understates the tax.

   4. THE CREDITS ARE REFUNDABLE. CIS and CI-CO2 are paid out by the
      employer even when they exceed the tax due, so the net can legitimately
      exceed gross-minus-contributions for a low earner. Clamping the tax at
      zero, as a naive implementation does, silently deletes real money from
      the answer.

   5. CLASS 2 IS A HOUSEHOLD CALCULATION. Splitting halves the combined
      income, taxes it, and doubles the result — so a second earner changes
      the first earner's tax. The only honest headline for a couple is the
      household net, not a per-person figure carved out of a joint bill.

   Sources for every constant are named on the block below. When Luxembourg
   moves the index — which it does, automatically, several times a decade —
   PARAMS is the only thing that needs editing.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Statutory parameters
     ======================================================================

     Everything the state sets, in one object. Nothing below this block
     hard-codes a rate or a threshold.
     ====================================================================== */

  var PARAMS = {
    year: 2026,

    /* The barème, tax class 1. 23 brackets, and the step is not uniform: it
       is EUR 2,205 across the 8-12% bands and EUR 2,295 from 14% up, which
       is easy to miss and wrong for everyone above EUR 24,255 of taxable
       income if you assume one width throughout.

       Two independent facts pin this table down. Class 1a is free of tax to
       EUR 26,460, which fixes the zero band at 13,230; and the statutory
       class 1a rate cap begins at EUR 51,804, which is exactly the income
       whose reduced base (1.25 x 51,804 - 19,845) lands on 44,910 — the top
       of the 30% band here. Both only work with these thresholds.

       Source: Administration des contributions directes, tarif applicable
       aux personnes physiques. */
    bands: [
      { to: 13230, rate: 0.00 },
      { to: 15435, rate: 0.08 },
      { to: 17640, rate: 0.09 },
      { to: 19845, rate: 0.10 },
      { to: 22050, rate: 0.11 },
      { to: 24255, rate: 0.12 },
      { to: 26550, rate: 0.14 },
      { to: 28845, rate: 0.16 },
      { to: 31140, rate: 0.18 },
      { to: 33435, rate: 0.20 },
      { to: 35730, rate: 0.22 },
      { to: 38025, rate: 0.24 },
      { to: 40320, rate: 0.26 },
      { to: 42615, rate: 0.28 },
      { to: 44910, rate: 0.30 },
      { to: 47205, rate: 0.32 },
      { to: 49500, rate: 0.34 },
      { to: 51795, rate: 0.36 },
      { to: 54090, rate: 0.38 },
      { to: 117450, rate: 0.39 },
      { to: 176160, rate: 0.40 },
      { to: 234870, rate: 0.41 },
      { to: Infinity, rate: 0.42 }
    ],

    /* Class 1a, per art. 119 LIR. See computeClass1a for the mechanics. */
    class1a: {
      complement: 79380,   /* income is reduced by a quarter of its shortfall here */
      capFrom: 51804,      /* above this the marginal rate is capped, not derived  */
      capBands: [
        { to: 117450, rate: 0.39 },
        { to: 176160, rate: 0.40 },
        { to: 234870, rate: 0.41 },
        { to: Infinity, rate: 0.42 }
      ]
    },

    /* Contribution au fonds pour l'emploi — a surcharge on the tax itself. */
    surcharge: {
      normal: 0.07,
      high: 0.09,
      thresholdSingle: 150000,   /* classes 1 and 1a */
      thresholdJoint: 300000     /* class 2          */
    },

    /* Employee social contributions. Health and pension stop at the ceiling;
       dependency does not, and has an allowance instead.
       Source: CCSS, paramètres sociaux 2026. */
    social: {
      health: 0.0305,            /* 2.80% in kind + 0.25% cash benefits */
      pension: 0.0850,           /* raised from 8.00% for 2026          */
      dependency: 0.0140,
      ceilingMonthly: 13518.70,  /* 5 x the unqualified minimum wage    */
      dependencyAllowanceMonthly: 675.93  /* a quarter of that wage     */
    },

    /* Employer contributions. Accident and mutuality genuinely vary by
       employer — risk class and absenteeism band — so the UI lets these two
       be edited and these are only the mid-range defaults. */
    employer: {
      health: 0.0305,
      pension: 0.0850,
      accident: 0.0075,
      mutuality: 0.0135,
      occupationalHealth: 0.0011
    },

    /* Automatic flat-rate deductions every employee gets without asking. */
    allowances: {
      workExpenses: 540,     /* forfait pour frais d'obtention  */
      specialExpenses: 480   /* forfait pour dépenses spéciales */
    },

    /* Refundable credits, applied against the tax after the surcharge.
       Source: ACD, CIS et CI-CO2 à partir de l'année d'imposition 2026. */
    credits: {
      /* Employee tax credit. Phases in to EUR 600, holds, phases out to nil
         at EUR 80,000 of gross salary. */
      cis: { floor: 936, rampTo: 11265, plateauTo: 40000, ceiling: 80000, base: 300, rampRate: 0.029, max: 600, taper: 0.015 },
      /* CO2 compensation credit, same shape without the ramp. */
      co2: { floor: 936, plateauTo: 40000, ceiling: 80000, max: 216, taper: 0.0054 },
      /* Single-parent credit, tapering on taxable income with a floor. */
      cim: { max: 3504, taperFrom: 60000, taperTo: 105000, rate: 0.0612, floor: 750 }
    },

    /* Reference wages, used for the presets and the sanity warnings. */
    minimumWage: { unqualified: 2703.74, qualified: 3244.48 }
  };

  var CLASSES = ['1', '1a', '2'];

  /* ======================================================================
     2. Helpers
     ====================================================================== */

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  /* Luxembourg rounds tax to the cent, and so does the payslip. Rounding
     only at the very end keeps the components summing to the total. */
  function cents(n) {
    return Math.round((isFinite(n) ? n : 0) * 100) / 100;
  }

  /* A shallow copy of a state object with a few fields replaced. The rest of
     this file is ES5 to match the other engines here, so no Object.assign. */
  function withFields(state, patch) {
    var out = {};
    var key;
    for (key in state) if (Object.prototype.hasOwnProperty.call(state, key)) out[key] = state[key];
    for (key in patch) if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = patch[key];
    return out;
  }

  /* ======================================================================
     3. The tax scale
     ====================================================================== */

  /* Tax on `income` under the class 1 barème. Band by band, so the result is
     the area under the marginal-rate curve rather than a lookup. */
  function scaleTax(income, bands) {
    if (!(income > 0)) return 0;

    var total = 0;
    var floor = 0;

    for (var i = 0; i < bands.length; i++) {
      var band = bands[i];
      if (income <= floor) break;
      total += (Math.min(income, band.to) - floor) * band.rate;
      floor = band.to;
    }
    return total;
  }

  /* The marginal rate the next euro would meet. */
  function scaleMarginal(income, bands) {
    for (var i = 0; i < bands.length; i++) {
      if (income < bands[i].to) return bands[i].rate;
    }
    return bands[bands.length - 1].rate;
  }

  function taxClass1(income) {
    return scaleTax(income, PARAMS.bands);
  }

  /* Class 2 — the splitting regime. The household income is halved, taxed
     at the class 1 scale, and the result doubled. That is the whole of it;
     there is no separate class 2 table. */
  function taxClass2(income) {
    return 2 * taxClass1(income / 2);
  }

  /* Class 1a — art. 119 LIR.

     Below the cap the scale is applied not to the income but to the income
     reduced by a quarter of its shortfall against EUR 79,380:

         base = income - (79,380 - income) / 4 = 1.25 x income - 19,845

     At income 26,460 that base is exactly 13,230, the top of the zero band,
     which is why class 1a pays nothing up to EUR 26,460. Because the base
     grows 1.25x faster than the income, the effective marginal rate is 1.25
     times the scale's — which is what the statutory cap then bites on.

     Above EUR 51,804 the derived rate would exceed 39%, so the law replaces
     it with flat 39/40/41/42% bands. The consequence, and it is the point of
     the design, is that class 1a's advantage over class 1 stops growing
     there and holds at a constant amount for the rest of the scale. */
  function taxClass1a(income) {
    if (!(income > 0)) return 0;

    var cfg = PARAMS.class1a;

    if (income <= cfg.capFrom) {
      var base = income - Math.max(0, cfg.complement - income) / 4;
      return taxClass1(Math.max(0, base));
    }

    /* The value at the cap, then flat bands above it. Continuous in value;
       the slope steps down, which is exactly what a cap does. */
    var pivotBase = cfg.capFrom - Math.max(0, cfg.complement - cfg.capFrom) / 4;
    var total = taxClass1(Math.max(0, pivotBase));
    var floor = cfg.capFrom;

    for (var i = 0; i < cfg.capBands.length; i++) {
      var band = cfg.capBands[i];
      if (income <= floor) break;
      total += (Math.min(income, band.to) - floor) * band.rate;
      floor = band.to;
    }
    return total;
  }

  function taxForClass(income, taxClass) {
    if (taxClass === '2') return taxClass2(income);
    if (taxClass === '1a') return taxClass1a(income);
    return taxClass1(income);
  }

  /* The marginal rate of the *scale* for a class, before the surcharge.
     Class 2 halves the income before looking it up; class 1a either scales
     the class 1 rate by 1.25 or reads its own capped band. */
  function scaleMarginalForClass(income, taxClass) {
    if (taxClass === '2') return scaleMarginal(income / 2, PARAMS.bands);

    if (taxClass === '1a') {
      var cfg = PARAMS.class1a;
      if (income > cfg.capFrom) return scaleMarginal(income, cfg.capBands);
      var base = income - Math.max(0, cfg.complement - income) / 4;
      return Math.min(1.25 * scaleMarginal(Math.max(0, base), PARAMS.bands), 0.42);
    }

    return scaleMarginal(income, PARAMS.bands);
  }

  function surchargeRate(taxableIncome, taxClass) {
    var s = PARAMS.surcharge;
    var threshold = taxClass === '2' ? s.thresholdJoint : s.thresholdSingle;
    return taxableIncome > threshold ? s.high : s.normal;
  }

  /* ======================================================================
     4. Social contributions
     ====================================================================== */

  /* One earner's employee-side contributions on an annual gross.

     The ceiling and the dependency allowance are both monthly figures in the
     official tables; annualising them by twelve is what the CCSS does too. */
  function socialContributions(annualGross) {
    var s = PARAMS.social;
    var gross = Math.max(0, annualGross);

    var ceiling = s.ceilingMonthly * 12;
    var capped = Math.min(gross, ceiling);

    var health = capped * s.health;
    var pension = capped * s.pension;

    /* No ceiling here — the whole salary is in scope — but an allowance of a
       quarter of the minimum wage comes off the base first. */
    var dependencyBase = Math.max(0, gross - s.dependencyAllowanceMonthly * 12);
    var dependency = dependencyBase * s.dependency;

    return {
      health: health,
      pension: pension,
      dependency: dependency,
      /* Only health and pension reduce taxable income. */
      deductible: health + pension,
      total: health + pension + dependency,
      cappedBase: capped,
      overCeiling: gross > ceiling
    };
  }

  /* What the same employee costs their employer. Accident and mutuality are
     passed in because they are employer-specific, not statutory constants. */
  function employerCost(annualGross, opts) {
    var e = PARAMS.employer;
    var accidentRate = clampNum(opts && opts.accident, 0, 0.05, e.accident);
    var mutualityRate = clampNum(opts && opts.mutuality, 0, 0.05, e.mutuality);

    var gross = Math.max(0, annualGross);
    var capped = Math.min(gross, PARAMS.social.ceilingMonthly * 12);

    var health = capped * e.health;
    var pension = capped * e.pension;
    var accident = capped * accidentRate;
    var mutuality = capped * mutualityRate;
    var occupational = capped * e.occupationalHealth;

    var contributions = health + pension + accident + mutuality + occupational;

    return {
      health: health,
      pension: pension,
      accident: accident,
      mutuality: mutuality,
      occupationalHealth: occupational,
      contributions: contributions,
      total: gross + contributions
    };
  }

  /* ======================================================================
     5. Tax credits
     ====================================================================== */

  /* CIS — ramps from EUR 300 to EUR 600 across the low band, holds at 600,
     then tapers away to nothing at EUR 80,000 of gross. */
  function creditCIS(annualGross) {
    var c = PARAMS.credits.cis;
    if (annualGross < c.floor || annualGross >= c.ceiling) return 0;
    if (annualGross <= c.rampTo) return Math.min(c.max, c.base + (annualGross - c.floor) * c.rampRate);
    if (annualGross <= c.plateauTo) return c.max;
    return Math.max(0, c.max - (annualGross - c.plateauTo) * c.taper);
  }

  /* CI-CO2 — the same shape without a ramp: flat, then tapered to nil at the
     same EUR 80,000. */
  function creditCO2(annualGross) {
    var c = PARAMS.credits.co2;
    if (annualGross < c.floor || annualGross >= c.ceiling) return 0;
    if (annualGross <= c.plateauTo) return c.max;
    return Math.max(0, c.max - (annualGross - c.plateauTo) * c.taper);
  }

  /* CIM — the single-parent credit, class 1a only. Tapers on taxable income
     but never below a floor, so it does not vanish for higher earners. */
  function creditCIM(taxableIncome) {
    var c = PARAMS.credits.cim;
    if (taxableIncome <= c.taperFrom) return c.max;
    if (taxableIncome >= c.taperTo) return c.floor;
    return Math.max(c.floor, c.max - (taxableIncome - c.taperFrom) * c.rate);
  }

  /* ======================================================================
     6. State
     ====================================================================== */

  function defaultState() {
    return {
      grossMonthly: 5500,
      payments: 12,          /* 12, or 13 where a thirteenth month is paid */
      bonus: 0,              /* annual, on top of the monthly salary       */
      taxClass: '1',
      spouseGrossMonthly: 0, /* class 2 only                               */
      singleParent: false,   /* class 1a only — claims the CIM             */
      deductions: 0,         /* annual, beyond the automatic flat rates    */
      resident: true,
      showEmployerCost: false,
      accidentRate: 0.75,    /* percent, employer-specific                 */
      mutualityRate: 1.35    /* percent, employer-specific                 */
    };
  }

  function normalize(raw) {
    var d = defaultState();
    var s = raw && typeof raw === 'object' ? raw : {};

    var out = {
      grossMonthly: clampNum(s.grossMonthly, 0, 1e7, d.grossMonthly),
      payments: s.payments === 13 || s.payments === '13' ? 13 : 12,
      bonus: clampNum(s.bonus, 0, 1e7, d.bonus),
      taxClass: oneOf(s.taxClass, CLASSES, d.taxClass),
      spouseGrossMonthly: clampNum(s.spouseGrossMonthly, 0, 1e7, d.spouseGrossMonthly),
      singleParent: !!s.singleParent,
      deductions: clampNum(s.deductions, 0, 1e6, d.deductions),
      resident: s.resident === undefined ? d.resident : !!s.resident,
      showEmployerCost: !!s.showEmployerCost,
      accidentRate: clampNum(s.accidentRate, 0, 5, d.accidentRate),
      mutualityRate: clampNum(s.mutualityRate, 0, 5, d.mutualityRate)
    };

    /* A spouse income only means anything under joint taxation, and the
       single-parent credit only exists in class 1a. Zeroing them here rather
       than at every use site keeps the rest of the file free of guards. */
    if (out.taxClass !== '2') out.spouseGrossMonthly = 0;
    if (out.taxClass !== '1a') out.singleParent = false;

    return out;
  }

  /* ======================================================================
     7. The calculation
     ====================================================================== */

  /* One earner, from gross to the taxable income the barème will see. */
  function earnerBase(annualGross, extraDeductions) {
    var social = socialContributions(annualGross);
    var a = PARAMS.allowances;

    var taxable = annualGross
      - social.deductible          /* health + pension; NOT dependency */
      - a.workExpenses
      - a.specialExpenses
      - Math.max(0, extraDeductions || 0);

    return {
      gross: annualGross,
      social: social,
      taxable: Math.max(0, taxable)
    };
  }

  /* The whole model for one state object. */
  function compute(raw) {
    var state = normalize(raw);

    var annualGross = state.grossMonthly * state.payments + state.bonus;
    var spouseAnnualGross = state.spouseGrossMonthly * state.payments;
    var joint = state.taxClass === '2' && spouseAnnualGross > 0;

    var me = earnerBase(annualGross, state.deductions);
    var spouse = joint ? earnerBase(spouseAnnualGross, 0) : null;

    /* Class 2 taxes the household as one income. Everything else is
       individual, and the "household" is just the one earner. */
    var taxableIncome = me.taxable + (spouse ? spouse.taxable : 0);
    var householdGross = annualGross + spouseAnnualGross;
    var householdSocial = me.social.total + (spouse ? spouse.social.total : 0);

    var baseTax = taxForClass(taxableIncome, state.taxClass);
    var surchargeAt = surchargeRate(taxableIncome, state.taxClass);
    var surcharge = baseTax * surchargeAt;
    var taxBeforeCredits = baseTax + surcharge;

    /* Credits are per employee: in a two-earner couple each one earns their
       own CIS and CI-CO2 on their own salary. */
    var cis = creditCIS(annualGross) + (spouse ? creditCIS(spouseAnnualGross) : 0);
    var co2 = creditCO2(annualGross) + (spouse ? creditCO2(spouseAnnualGross) : 0);
    var cim = state.singleParent ? creditCIM(taxableIncome) : 0;
    var credits = cis + co2 + cim;

    /* Refundable: the tax may go negative, and that is money paid out, not
       an error to clamp away. */
    var netTax = taxBeforeCredits - credits;
    var netAnnual = householdGross - householdSocial - netTax;

    /* The next euro. The scale's marginal rate, grossed up by the surcharge,
       then added to the contributions that euro also attracts. Above the
       ceiling only the dependency contribution still applies, which is why
       high earners see the marginal rate fall as the ceiling is passed. */
    var scaleRate = scaleMarginalForClass(taxableIncome, state.taxClass);
    var marginalTax = scaleRate * (1 + surchargeAt);
    var overCeiling = me.social.overCeiling;
    var marginalSocial = (overCeiling ? 0 : PARAMS.social.health + PARAMS.social.pension) + PARAMS.social.dependency;
    /* A euro of gross reduces taxable income by the deductible part of the
       contributions it attracts, so the tax bites on less than the full euro. */
    var marginalTaxable = 1 - (overCeiling ? 0 : PARAMS.social.health + PARAMS.social.pension);
    var marginalRate = Math.min(0.95, marginalSocial + marginalTax * marginalTaxable);

    var employer = state.showEmployerCost
      ? employerCost(annualGross, { accident: state.accidentRate / 100, mutuality: state.mutualityRate / 100 })
      : null;

    return {
      state: state,
      params: PARAMS,
      joint: joint,

      annualGross: annualGross,
      spouseAnnualGross: spouseAnnualGross,
      householdGross: householdGross,

      social: me.social,
      spouseSocial: spouse ? spouse.social : null,
      householdSocial: householdSocial,

      taxableIncome: taxableIncome,
      baseTax: baseTax,
      surchargeRate: surchargeAt,
      surcharge: surcharge,
      taxBeforeCredits: taxBeforeCredits,

      credits: { cis: cis, co2: co2, cim: cim, total: credits },
      netTax: netTax,

      netAnnual: netAnnual,
      netMonthly: netAnnual / state.payments,
      grossMonthly: householdGross / state.payments,

      effectiveTaxRate: householdGross > 0 ? netTax / householdGross : 0,
      totalDeductionRate: householdGross > 0 ? (householdGross - netAnnual) / householdGross : 0,
      takeHomeRate: householdGross > 0 ? netAnnual / householdGross : 0,
      marginalRate: marginalRate,

      employer: employer
    };
  }

  /* ======================================================================
     8. Derived views
     ====================================================================== */

  /* The same salary under all three classes, so the reader can see what
     marrying, or a child, is actually worth. Spouse income is deliberately
     excluded: this compares one salary, not two households. */
  function compareClasses(raw) {
    var state = normalize(raw);

    return CLASSES.map(function (taxClass) {
      var result = compute(withFields(state, {
        taxClass: taxClass,
        spouseGrossMonthly: 0,
        singleParent: taxClass === '1a' ? state.singleParent : false
      }));

      return {
        taxClass: taxClass,
        netAnnual: result.netAnnual,
        netMonthly: result.netMonthly,
        netTax: result.netTax,
        takeHomeRate: result.takeHomeRate
      };
    });
  }

  /* Net against gross across a range, for the curve. Sampled rather than
     stepped by euro: 60 points draw the same line at a fraction of the cost. */
  function netCurve(raw, opts) {
    var state = normalize(raw);
    var maxMonthly = clampNum(opts && opts.maxMonthly, 1000, 40000, Math.max(12000, state.grossMonthly * 2));
    var points = clampNum(opts && opts.points, 8, 200, 60);
    var step = maxMonthly / points;
    var out = [];

    for (var i = 0; i <= points; i++) {
      var monthly = i * step;
      var result = compute(withFields(state, { grossMonthly: monthly, bonus: 0 }));
      out.push({
        grossMonthly: monthly,
        netMonthly: result.netMonthly,
        takeHomeRate: result.takeHomeRate
      });
    }
    return out;
  }

  /* Reverse mode: what gross produces this net?

     Net rises with gross almost everywhere, but not quite. Once adjusted
     taxable income passes EUR 150,000 (EUR 300,000 in class 2) the
     employment fund surcharge goes from 7% to 9% of the WHOLE tax rather
     than of the part above the threshold, so roughly EUR 900 of tax appears
     for one more euro of salary and net actually falls. Nothing becomes
     unreachable — the curve climbs back through the same values — but a
     target just below the step is reached at two different salaries, and
     only the lower one answers the question that was asked.

     Plain bisection over the whole range can land on either. A coarse scan
     is no better: the peak before the step is only a few euro of gross wide,
     so any grid coarse enough to be cheap steps straight over it.

     So the curve is split at the step and each half solved on its own, which
     is exact because each half really is monotonic. The step itself is found
     the same way: "is the surcharge at its higher rate" is a monotone
     predicate in gross, so it bisects cleanly. */

  /* The gross either side of the surcharge step: `below` is the largest still
     at 7%, `above` the smallest at 9%. Null when the rate never changes
     within a sane range. */
  function surchargeStep(state) {
    function isHigh(monthly) {
      return compute(withFields(state, { grossMonthly: monthly, bonus: 0 })).surchargeRate
        > PARAMS.surcharge.normal;
    }

    if (isHigh(0)) return null;

    var lo = 0;
    var hi = 5000;
    var guard = 0;
    while (!isHigh(hi) && guard++ < 30) hi *= 2;
    if (!isHigh(hi)) return null;

    for (var i = 0; i < 50; i++) {
      var mid = (lo + hi) / 2;
      if (isHigh(mid)) hi = mid; else lo = mid;
    }
    return { below: lo, above: hi };
  }

  function grossForNet(targetNetMonthly, raw) {
    var state = normalize(raw);
    var target = clampNum(targetNetMonthly, 0, 1e6, 0);
    if (!(target > 0)) return { grossMonthly: 0, exact: true, netMonthly: 0, shortfall: 0 };

    function netAt(monthly) {
      return compute(withFields(state, { grossMonthly: monthly, bonus: 0 })).netMonthly;
    }

    /* The smallest gross in [lo, hi] whose net reaches the target, or null if
       even hi falls short. The caller guarantees the interval is monotonic. */
    function solveBranch(lo, hi) {
      if (netAt(hi) < target) return null;
      if (netAt(lo) >= target) return lo;

      for (var i = 0; i < 50; i++) {
        var mid = (lo + hi) / 2;
        if (netAt(mid) < target) lo = mid; else hi = mid;
      }
      return hi;
    }

    var step = surchargeStep(state);

    /* Below the step first: if the target is reachable there, that is the
       answer, whatever the upper branch would also allow. */
    if (step) {
      var lower = solveBranch(0, step.below);
      if (lower !== null) {
        return {
          grossMonthly: lower,
          exact: Math.abs(netAt(lower) - target) < 0.01,
          netMonthly: netAt(lower),
          shortfall: netAt(lower) - target
        };
      }
    }

    var floor = step ? step.above : 0;
    var ceiling = Math.max(floor * 2, target * 3, 1000);

    var guard = 0;
    while (netAt(ceiling) < target && guard++ < 20) ceiling *= 1.6;
    if (netAt(ceiling) < target) {
      return {
        grossMonthly: ceiling, exact: false,
        netMonthly: netAt(ceiling), shortfall: netAt(ceiling) - target
      };
    }

    var upper = solveBranch(floor, ceiling);
    var reached = netAt(upper);
    return {
      grossMonthly: upper,
      /* A cent of slack: bisection lands on the boundary, not exactly on it. */
      exact: Math.abs(reached - target) < 0.01,
      netMonthly: reached,
      shortfall: reached - target
    };
  }

  /* ======================================================================
     9. Export
     ====================================================================== */

  function toCSV(result) {
    var rows = [['Item', 'Annual (EUR)', 'Monthly (EUR)']];
    var n = result.state.payments;

    function row(label, annual) {
      rows.push([label, cents(annual).toFixed(2), cents(annual / n).toFixed(2)]);
    }

    row('Gross salary', result.annualGross);
    if (result.joint) row('Spouse gross salary', result.spouseAnnualGross);
    row('Health contribution', result.social.health + (result.spouseSocial ? result.spouseSocial.health : 0));
    row('Pension contribution', result.social.pension + (result.spouseSocial ? result.spouseSocial.pension : 0));
    row('Dependency contribution', result.social.dependency + (result.spouseSocial ? result.spouseSocial.dependency : 0));
    row('Taxable income', result.taxableIncome);
    row('Income tax (scale)', result.baseTax);
    row('Employment fund surcharge', result.surcharge);
    row('Tax credits', -result.credits.total);
    row('Tax withheld', result.netTax);
    row('Net salary', result.netAnnual);

    if (result.employer) {
      row('Employer contributions', result.employer.contributions);
      row('Total employer cost', result.employer.total);
    }

    return rows.map(function (r) {
      return r.map(function (cell) {
        var v = String(cell);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\n');
  }

  global.LUSalaryEngine = {
    PARAMS: PARAMS,
    CLASSES: CLASSES,

    scaleTax: scaleTax,
    scaleMarginal: scaleMarginal,
    taxClass1: taxClass1,
    taxClass1a: taxClass1a,
    taxClass2: taxClass2,
    taxForClass: taxForClass,
    surchargeRate: surchargeRate,

    socialContributions: socialContributions,
    employerCost: employerCost,
    creditCIS: creditCIS,
    creditCO2: creditCO2,
    creditCIM: creditCIM,

    defaultState: defaultState,
    normalize: normalize,
    compute: compute,
    compareClasses: compareClasses,
    netCurve: netCurve,
    grossForNet: grossForNet,
    toCSV: toCSV,
    cents: cents
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LUSalaryEngine;

})(typeof window !== 'undefined' ? window : this);
