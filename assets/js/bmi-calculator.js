(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const round1 = (v) => Math.round(v * 10) / 10;

  const KG_PER_LB = 0.45359237;
  const CM_PER_IN = 2.54;
  const KCAL_PER_KG = 7700;

  const ACTIVITY = {
    sedentary: { label: 'Sedentary (little/no exercise)', mult: 1.2 },
    light: { label: 'Light exercise (1–3 days/week)', mult: 1.375 },
    moderate: { label: 'Moderate exercise (3–5 days/week)', mult: 1.55 },
    active: { label: 'Active (6–7 days/week)', mult: 1.725 },
    veryActive: { label: 'Very active (hard exercise + physical job)', mult: 1.9 },
  };

  const GOAL_RATES = [
    { id: 'slow', kgPerWeek: 0.25, label: 'Slow — 0.25 kg (0.55 lb) / week' },
    { id: 'moderate', kgPerWeek: 0.5, label: 'Moderate — 0.5 kg (1.1 lb) / week' },
    { id: 'fast', kgPerWeek: 0.75, label: 'Fast — 0.75 kg (1.65 lb) / week' },
    { id: 'veryfast', kgPerWeek: 1, label: 'Very fast — 1 kg (2.2 lb) / week' },
  ];

  const els = {};
  let lastResult = null;

  function cacheElements() {
    [
      'bmiHeightMetric', 'bmiHeightImperial', 'heightCm', 'heightFt', 'heightIn',
      'bmiWeightMetric', 'bmiWeightImperial', 'weightKg', 'weightLb',
      'bmiAge', 'bmiSex', 'bmiActivity',
      'bmiAdvancedToggle', 'bmiAdvancedPanel', 'bmiWaist', 'bmiNeck', 'bmiHip', 'bmiAthlete', 'bmiPregnancy',
      'bmiWaistUnitLabel', 'bmiNeckUnitLabel', 'bmiHipUnitLabel',
      'bmiGoalWeight', 'bmiGoalRate', 'bmiGoalUnitLabel',
      'calculateBmiBtn', 'stickyCalculateBtn', 'bmiResetBtn',
      'bmiError', 'bmiEmptyState', 'bmiResults',
      'bmiGaugeArcs', 'bmiGaugeNeedle', 'bmiGaugeValue', 'bmiGaugeCategory', 'bmiGaugeSr',
      'bmiHealthyRangeText', 'bmiHealthyRangeBar', 'bmiHealthyRangeMarker',
      'bmiIdealWeight', 'bmiIdealWeightRange', 'bmiToGoal',
      'bmiAthleteNote', 'bmiPregnancyNote', 'bmiAsianToggle',
      'bmiBmrCard', 'bmiBmrValue', 'bmiTdeeCard', 'bmiTdeeValue', 'bmiCalorieCard', 'bmiCalorieGrid',
      'bmiWhtrCard', 'bmiWhtrValue', 'bmiWhtrRisk', 'bmiWhrCard', 'bmiWhrValue', 'bmiWhrRisk',
      'bmiBodyFatCard', 'bmiBodyFatValue', 'bmiBodyFatCategory',
      'bmiGoalCard', 'bmiGoalSummary', 'bmiGoalSafety',
      'bmiCopyBtn', 'bmiShareBtn', 'bmiPrintBtn',
    ].forEach((id) => { els[id] = $(id); });
  }

  // ---------- Unit handling ----------
  function isImperial() { return document.querySelector('[data-bmi-unit].is-active')?.dataset.bmiUnit === 'imperial'; }

  function setUnitSystem(system) {
    document.querySelectorAll('[data-bmi-unit]').forEach((btn) => {
      const active = btn.dataset.bmiUnit === system;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const imperial = system === 'imperial';
    els.bmiHeightMetric.hidden = imperial;
    els.bmiHeightImperial.hidden = !imperial;
    els.bmiWeightMetric.hidden = imperial;
    els.bmiWeightImperial.hidden = !imperial;
    const unitLabel = imperial ? 'in' : 'cm';
    [els.bmiWaistUnitLabel, els.bmiNeckUnitLabel, els.bmiHipUnitLabel].forEach((el) => { if (el) el.textContent = unitLabel; });
    if (els.bmiGoalUnitLabel) els.bmiGoalUnitLabel.textContent = imperial ? 'lb' : 'kg';
  }

  function readHeightCm() {
    if (isImperial()) {
      const ft = Number(els.heightFt.value || 0);
      const inch = Number(els.heightIn.value || 0);
      return ((ft * 12) + inch) * CM_PER_IN;
    }
    return Number(els.heightCm.value || 0);
  }

  function readWeightKg() {
    if (isImperial()) return Number(els.weightLb.value || 0) * KG_PER_LB;
    return Number(els.weightKg.value || 0);
  }

  function readCircumferenceCm(input) {
    const raw = Number(input?.value || 0);
    if (!raw) return 0;
    return isImperial() ? raw * CM_PER_IN : raw;
  }

  function readGoalWeightKg() {
    const raw = Number(els.bmiGoalWeight?.value || 0);
    if (!raw) return 0;
    return isImperial() ? raw * KG_PER_LB : raw;
  }

  // ---------- Core formulas ----------
  function calcBMI(weightKg, heightCm) {
    const h = heightCm / 100;
    if (!h || !weightKg) return 0;
    return weightKg / (h * h);
  }

  function getCategoryBands(useAsian) {
    return useAsian
      ? [
        { key: 'under', min: 0, max: 18.5, label: 'Underweight', color: 'blue' },
        { key: 'normal', min: 18.5, max: 23, label: 'Normal weight', color: 'green' },
        { key: 'over', min: 23, max: 27.5, label: 'Overweight', color: 'amber' },
        { key: 'obese1', min: 27.5, max: 100, label: 'Obesity', color: 'red' },
      ]
      : [
        { key: 'under', min: 0, max: 18.5, label: 'Underweight', color: 'blue' },
        { key: 'normal', min: 18.5, max: 25, label: 'Normal weight', color: 'green' },
        { key: 'over', min: 25, max: 30, label: 'Overweight', color: 'amber' },
        { key: 'obese1', min: 30, max: 35, label: 'Obesity Class I', color: 'red' },
        { key: 'obese2', min: 35, max: 40, label: 'Obesity Class II', color: 'red' },
        { key: 'obese3', min: 40, max: 100, label: 'Obesity Class III', color: 'red' },
      ];
  }

  function getCategory(bmi, useAsian) {
    const bands = getCategoryBands(useAsian);
    return bands.find((b) => bmi >= b.min && bmi < b.max) || bands[bands.length - 1];
  }

  function getHealthyRangeKg(heightCm, useAsian) {
    const h = heightCm / 100;
    const upper = useAsian ? 23 : 24.9;
    return { min: 18.5 * h * h, max: upper * h * h };
  }

  function getIdealWeightKg(heightCm, sex) {
    const totalInches = heightCm / CM_PER_IN;
    const overInches = totalInches - 60;
    const isMale = sex === 'male';
    const devine = (isMale ? 50 : 45.5) + 2.3 * overInches;
    const robinson = (isMale ? 52 : 49) + (isMale ? 1.9 : 1.7) * overInches;
    const miller = (isMale ? 56.2 : 53.1) + (isMale ? 1.41 : 1.36) * overInches;
    const hamwi = (isMale ? 48 : 45.5) + (isMale ? 2.7 : 2.2) * overInches;
    const values = [devine, robinson, miller, hamwi].map((v) => Math.max(v, 25));
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { avg, min: Math.min(...values), max: Math.max(...values) };
  }

  function calcBMR(weightKg, heightCm, age, sex) {
    if (!age || !sex) return null;
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === 'male' ? base + 5 : base - 161;
  }

  function calcWHtR(waistCm, heightCm) {
    if (!waistCm || !heightCm) return null;
    return waistCm / heightCm;
  }

  function whtrRisk(ratio) {
    if (ratio < 0.4) return { label: 'Below typical range', className: 'good' };
    if (ratio < 0.5) return { label: 'Healthy range', className: 'good' };
    if (ratio < 0.6) return { label: 'Increased risk', className: 'warn' };
    return { label: 'High risk — consider consulting a doctor', className: 'bad' };
  }

  function calcWHR(waistCm, hipCm) {
    if (!waistCm || !hipCm) return null;
    return waistCm / hipCm;
  }

  function whrRisk(ratio, sex) {
    const cutoff = sex === 'male' ? 0.9 : 0.85;
    if (ratio < cutoff) return { label: 'Lower risk', className: 'good' };
    return { label: 'Increased risk — consult a doctor', className: 'bad' };
  }

  function calcBodyFat(sex, heightCm, waistCm, neckCm, hipCm) {
    if (!waistCm || !neckCm || !heightCm) return null;
    if (sex === 'male') {
      const diff = waistCm - neckCm;
      if (diff <= 0) return null;
      const val = 495 / (1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(heightCm)) - 450;
      return val > 0 && val < 70 ? val : null;
    }
    if (sex === 'female') {
      if (!hipCm) return null;
      const diff = waistCm + hipCm - neckCm;
      if (diff <= 0) return null;
      const val = 495 / (1.29579 - 0.35004 * Math.log10(diff) + 0.221 * Math.log10(heightCm)) - 450;
      return val > 0 && val < 70 ? val : null;
    }
    return null;
  }

  function bodyFatCategory(pct, sex) {
    const table = sex === 'male'
      ? [[2, 5, 'Essential fat'], [6, 13, 'Athletic'], [14, 17, 'Fitness'], [18, 24, 'Acceptable'], [25, 100, 'Above average']]
      : [[10, 13, 'Essential fat'], [14, 20, 'Athletic'], [21, 24, 'Fitness'], [25, 31, 'Acceptable'], [32, 100, 'Above average']];
    const row = table.find(([min, max]) => pct >= min && pct <= max) || table[table.length - 1];
    return row[2];
  }

  function calcGoalPlan(currentKg, goalKg, rateKgPerWeek) {
    const diff = goalKg - currentKg;
    if (Math.abs(diff) < 0.05) return { status: 'atGoal' };
    const weeks = Math.abs(diff) / rateKgPerWeek;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + Math.round(weeks * 7));
    const dailyCalorieAdjustment = (rateKgPerWeek * KCAL_PER_KG) / 7;
    return {
      status: diff < 0 ? 'lose' : 'gain',
      diffKg: Math.abs(diff),
      weeks: Math.round(weeks * 10) / 10,
      targetDate,
      dailyCalorieAdjustment: Math.round(dailyCalorieAdjustment),
    };
  }

  // ---------- SVG gauge ----------
  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArcFlag = Math.abs(startAngle - endAngle) <= 180 ? 0 : 1;
    const sweepFlag = startAngle > endAngle ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  const GAUGE_MIN = 14;
  const GAUGE_MAX = 40;
  const GAUGE_CX = 110;
  const GAUGE_CY = 110;
  const GAUGE_R = 92;

  function bmiToAngle(bmi) {
    const v = clamp(bmi, GAUGE_MIN, GAUGE_MAX);
    return 180 - ((v - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 180;
  }

  function renderGauge(bmi, category, useAsian) {
    const bands = getCategoryBands(useAsian);
    const merged = [];
    bands.forEach((b) => {
      const prev = merged[merged.length - 1];
      if (prev && prev.color === b.color) { prev.max = Math.min(b.max, GAUGE_MAX); }
      else merged.push({ color: b.color, min: Math.max(b.min, GAUGE_MIN), max: Math.min(b.max, GAUGE_MAX) });
    });
    const colorMap = { blue: '#38bdf8', green: '#10b981', amber: '#f59e0b', red: '#ef4444' };
    const svgPaths = merged.map((seg) => {
      const startAngle = bmiToAngle(seg.min);
      const endAngle = bmiToAngle(seg.max);
      return `<path d="${describeArc(GAUGE_CX, GAUGE_CY, GAUGE_R, startAngle, endAngle)}" stroke="${colorMap[seg.color]}" stroke-width="20" fill="none" stroke-linecap="butt" />`;
    }).join('');
    els.bmiGaugeArcs.innerHTML = svgPaths;

    const needleAngle = bmiToAngle(bmi);
    const tip = polarToCartesian(GAUGE_CX, GAUGE_CY, GAUGE_R - 8, needleAngle);
    els.bmiGaugeNeedle.setAttribute('x2', tip.x.toFixed(2));
    els.bmiGaugeNeedle.setAttribute('y2', tip.y.toFixed(2));

    els.bmiGaugeValue.textContent = bmi ? round1(bmi).toFixed(1) : '—';
    els.bmiGaugeCategory.textContent = category.label;
    els.bmiGaugeCategory.className = `bmi-gauge-category bmi-tag-${category.color}`;
    if (els.bmiGaugeSr) els.bmiGaugeSr.textContent = `BMI ${bmi ? round1(bmi).toFixed(1) : 'not available'} — ${category.label}`;
  }

  // ---------- Validation ----------
  function showError(msg) {
    els.bmiError.hidden = false;
    els.bmiError.querySelector('span').textContent = msg;
    els.bmiError.focus?.();
  }
  function clearError() { els.bmiError.hidden = true; }

  // ---------- Main calculate ----------
  function calculate() {
    clearError();
    const heightCm = readHeightCm();
    const weightKg = readWeightKg();

    if (!heightCm || heightCm < 50 || heightCm > 272) { showError('Enter a valid height.'); return; }
    if (!weightKg || weightKg < 10 || weightKg > 500) { showError('Enter a valid weight.'); return; }

    const age = Number(els.bmiAge.value || 0) || null;
    const sex = els.bmiSex.value || '';
    const activityKey = els.bmiActivity.value || '';
    const waistCm = readCircumferenceCm(els.bmiWaist);
    const neckCm = readCircumferenceCm(els.bmiNeck);
    const hipCm = readCircumferenceCm(els.bmiHip);
    const isAthlete = els.bmiAthlete.checked;
    const isPregnant = els.bmiPregnancy.checked;
    const useAsian = els.bmiAsianToggle?.checked || false;

    const bmi = calcBMI(weightKg, heightCm);
    const category = getCategory(bmi, useAsian);
    const healthyRange = getHealthyRangeKg(heightCm, useAsian);
    const ideal = getIdealWeightKg(heightCm, sex || 'male');

    renderGauge(isPregnant ? 0 : bmi, isPregnant ? { label: 'Not applicable during pregnancy', color: 'blue' } : category, useAsian);
    if (!isPregnant) {
      els.bmiGaugeValue.textContent = round1(bmi).toFixed(1);
    }

    // Healthy weight range bar
    const displayUnit = isImperial() ? 'lb' : 'kg';
    const toDisplay = (kg) => (isImperial() ? kg / KG_PER_LB : kg);
    els.bmiHealthyRangeText.textContent = `${toDisplay(healthyRange.min).toFixed(1)} – ${toDisplay(healthyRange.max).toFixed(1)} ${displayUnit}`;
    const rangeSpan = (healthyRange.max - healthyRange.min) * 1.6;
    const rangeStart = healthyRange.min - (healthyRange.max - healthyRange.min) * 0.3;
    const markerPct = clamp(((weightKg - rangeStart) / rangeSpan) * 100, 0, 100);
    els.bmiHealthyRangeMarker.style.left = `${markerPct}%`;
    els.bmiHealthyRangeBar.setAttribute('aria-valuenow', String(Math.round(markerPct)));

    // Ideal weight
    els.bmiIdealWeight.textContent = `${toDisplay(ideal.avg).toFixed(1)} ${displayUnit}`;
    els.bmiIdealWeightRange.textContent = `Typical range: ${toDisplay(ideal.min).toFixed(1)} – ${toDisplay(ideal.max).toFixed(1)} ${displayUnit}`;

    // Weight to reach healthy range
    let toGoalText = 'You are within the healthy weight range.';
    if (weightKg < healthyRange.min) toGoalText = `Gain about ${toDisplay(healthyRange.min - weightKg).toFixed(1)} ${displayUnit} to reach the healthy range.`;
    else if (weightKg > healthyRange.max) toGoalText = `Lose about ${toDisplay(weightKg - healthyRange.max).toFixed(1)} ${displayUnit} to reach the healthy range.`;
    els.bmiToGoal.textContent = toGoalText;

    // Athlete / pregnancy notes
    els.bmiAthleteNote.hidden = !isAthlete;
    els.bmiPregnancyNote.hidden = !isPregnant;

    // BMR / TDEE / Calories
    const bmr = calcBMR(weightKg, heightCm, age, sex);
    if (bmr && !isPregnant) {
      els.bmiBmrCard.hidden = false;
      els.bmiBmrValue.textContent = `${Math.round(bmr)} kcal/day`;
      const activity = ACTIVITY[activityKey];
      if (activity) {
        const tdee = bmr * activity.mult;
        els.bmiTdeeCard.hidden = false;
        els.bmiTdeeValue.textContent = `${Math.round(tdee)} kcal/day`;
        els.bmiCalorieCard.hidden = false;
        els.bmiCalorieGrid.innerHTML = [
          { label: 'Mild loss (−0.25 kg/wk)', kcal: tdee - 250 },
          { label: 'Loss (−0.5 kg/wk)', kcal: tdee - 500 },
          { label: 'Maintenance', kcal: tdee },
          { label: 'Mild gain (+0.25 kg/wk)', kcal: tdee + 250 },
          { label: 'Gain (+0.5 kg/wk)', kcal: tdee + 500 },
        ].map((row) => `<div class="bmi-cal-chip"><strong>${Math.round(row.kcal)}</strong><span>${row.label}</span></div>`).join('');
      } else {
        els.bmiTdeeCard.hidden = true;
        els.bmiCalorieCard.hidden = true;
      }
    } else {
      els.bmiBmrCard.hidden = true;
      els.bmiTdeeCard.hidden = true;
      els.bmiCalorieCard.hidden = true;
    }

    // Waist-to-height
    const whtr = calcWHtR(waistCm, heightCm);
    if (whtr) {
      els.bmiWhtrCard.hidden = false;
      els.bmiWhtrValue.textContent = whtr.toFixed(2);
      const risk = whtrRisk(whtr);
      els.bmiWhtrRisk.textContent = risk.label;
      els.bmiWhtrRisk.className = `bmi-pill bmi-pill--${risk.className}`;
    } else els.bmiWhtrCard.hidden = true;

    // Waist-to-hip
    const whr = calcWHR(waistCm, hipCm);
    if (whr && sex) {
      els.bmiWhrCard.hidden = false;
      els.bmiWhrValue.textContent = whr.toFixed(2);
      const risk = whrRisk(whr, sex);
      els.bmiWhrRisk.textContent = risk.label;
      els.bmiWhrRisk.className = `bmi-pill bmi-pill--${risk.className}`;
    } else els.bmiWhrCard.hidden = true;

    // Body fat
    const bodyFat = calcBodyFat(sex, heightCm, waistCm, neckCm, hipCm);
    if (bodyFat) {
      els.bmiBodyFatCard.hidden = false;
      els.bmiBodyFatValue.textContent = `${bodyFat.toFixed(1)}%`;
      els.bmiBodyFatCategory.textContent = bodyFatCategory(bodyFat, sex);
    } else els.bmiBodyFatCard.hidden = true;

    // Goal planner
    const goalKg = readGoalWeightKg();
    const rate = GOAL_RATES.find((r) => r.id === (els.bmiGoalRate.value || 'moderate')) || GOAL_RATES[1];
    if (goalKg && !isPregnant) {
      const plan = calcGoalPlan(weightKg, goalKg, rate.kgPerWeek);
      els.bmiGoalCard.hidden = false;
      if (plan.status === 'atGoal') {
        els.bmiGoalSummary.textContent = 'You are already at your goal weight.';
        els.bmiGoalSafety.hidden = true;
      } else {
        const verb = plan.status === 'lose' ? 'lose' : 'gain';
        const dateStr = plan.targetDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        els.bmiGoalSummary.innerHTML = `To ${verb} ${toDisplay(plan.diffKg).toFixed(1)} ${displayUnit} at your selected pace, expect about <strong>${plan.weeks} weeks</strong> (around <strong>${dateStr}</strong>) — roughly a <strong>${plan.dailyCalorieAdjustment} kcal/day</strong> ${plan.status === 'lose' ? 'deficit' : 'surplus'}.`;
        const targetCalories = bmr && ACTIVITY[activityKey]
          ? (bmr * ACTIVITY[activityKey].mult) + (plan.status === 'lose' ? -plan.dailyCalorieAdjustment : plan.dailyCalorieAdjustment)
          : null;
        const floor = sex === 'male' ? 1500 : 1200;
        if (targetCalories && targetCalories < floor) {
          els.bmiGoalSafety.hidden = false;
          els.bmiGoalSafety.textContent = `This target (~${Math.round(targetCalories)} kcal/day) is below common safe minimums. Consider a slower pace or speak with a healthcare professional.`;
        } else {
          els.bmiGoalSafety.hidden = true;
        }
      }
    } else {
      els.bmiGoalCard.hidden = true;
    }

    lastResult = {
      bmi: round1(bmi), category: isPregnant ? 'Not interpreted (pregnancy mode)' : category.label,
      healthyRange: els.bmiHealthyRangeText.textContent,
      idealWeight: els.bmiIdealWeight.textContent,
      bmr: bmr ? Math.round(bmr) : null,
    };

    els.bmiEmptyState.hidden = true;
    els.bmiResults.hidden = false;
    els.bmiResults.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetForm() {
    clearError();
    els.heightCm.value = '170';
    els.heightFt.value = '5';
    els.heightIn.value = '7';
    els.weightKg.value = '70';
    els.weightLb.value = '154';
    els.bmiAge.value = '';
    els.bmiSex.value = '';
    els.bmiActivity.value = '';
    els.bmiWaist.value = '';
    els.bmiNeck.value = '';
    els.bmiHip.value = '';
    els.bmiAthlete.checked = false;
    els.bmiPregnancy.checked = false;
    if (els.bmiAsianToggle) els.bmiAsianToggle.checked = false;
    els.bmiGoalWeight.value = '';
    els.bmiEmptyState.hidden = false;
    els.bmiResults.hidden = true;
    lastResult = null;
  }

  function getResultSummary() {
    if (!lastResult) return '';
    return `BMI: ${lastResult.bmi}\nCategory: ${lastResult.category}\nHealthy weight range: ${lastResult.healthyRange}\nIdeal weight estimate: ${lastResult.idealWeight}${lastResult.bmr ? `\nBMR: ${lastResult.bmr} kcal/day` : ''}\n\nCalculated with ToolAdda BMI Calculator — https://tooladda.online/calculators/bmi-calculator.html`;
  }

  function copyResults() {
    if (!lastResult) { announce('Calculate your BMI first.'); return; }
    navigator.clipboard.writeText(getResultSummary()).then(() => {
      const btn = els.bmiCopyBtn;
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1800);
      announce('Results copied to clipboard.');
    }).catch(() => announce('Could not copy. Please select and copy manually.'));
  }

  function shareResults() {
    if (!lastResult) return;
    const text = getResultSummary();
    if (navigator.share) navigator.share({ title: 'My BMI Result — ToolAdda', text, url: window.location.href }).catch(() => {});
    else copyResults();
  }

  function printResults() {
    if (!lastResult) return;
    window.print();
  }

  function announce(msg) {
    let region = document.getElementById('bmiLiveRegion');
    if (!region) {
      region = document.createElement('div');
      region.id = 'bmiLiveRegion';
      region.className = 'sr-only';
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    region.textContent = msg;
  }

  function initReveal() {
    document.querySelector('.bmi-hero-card.bmi-reveal')?.classList.add('is-in');
    document.querySelector('.bmi-tool-card.bmi-reveal')?.classList.add('is-in');
    const els2 = document.querySelectorAll('.bmi-reveal:not(.is-in)');
    if (!('IntersectionObserver' in window)) { els2.forEach((el) => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { threshold: 0.05, rootMargin: '0px 0px 120px 0px' });
    els2.forEach((el) => io.observe(el));
    setTimeout(() => els2.forEach((el) => el.classList.add('is-in')), 3000);
  }

  function initAdvancedToggle() {
    els.bmiAdvancedToggle?.addEventListener('click', () => {
      const expanded = els.bmiAdvancedToggle.getAttribute('aria-expanded') === 'true';
      els.bmiAdvancedToggle.setAttribute('aria-expanded', String(!expanded));
      els.bmiAdvancedPanel.hidden = expanded;
    });
  }

  function init() {
    cacheElements();
    setUnitSystem('metric');
    document.querySelectorAll('[data-bmi-unit]').forEach((btn) => {
      btn.addEventListener('click', () => setUnitSystem(btn.dataset.bmiUnit));
    });
    initAdvancedToggle();
    els.calculateBmiBtn?.addEventListener('click', calculate);
    els.stickyCalculateBtn?.addEventListener('click', calculate);
    els.bmiResetBtn?.addEventListener('click', resetForm);
    els.bmiCopyBtn?.addEventListener('click', copyResults);
    els.bmiShareBtn?.addEventListener('click', shareResults);
    els.bmiPrintBtn?.addEventListener('click', printResults);
    /* The sticky Calculate bar is hidden until the calculator is on screen —
       before that it is a call to action for a form the visitor has not reached.
       Kept visible once they scroll PAST the tool as well, since from the
       article below it becomes the way back. */
    function initStickyBar() {
      const bar = document.querySelector('.bmi-sticky-bar');
      const tool = document.getElementById('bmiTool');
      if (!bar || !tool) return;
      if (!('IntersectionObserver' in window)) { bar.classList.add('is-visible'); return; }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const reached = entry.isIntersecting || entry.boundingClientRect.top < 0;
          bar.classList.toggle('is-visible', reached);
        });
      }, { threshold: 0 });
      io.observe(tool);
    }

    /* Jump to the calculator. Three things were wrong with the old one-liner:
       scrollIntoView() aligns the card to the very top of the viewport, where
       the sticky header covers its heading; the focus() that followed scrolled
       instantly and so cancelled the smooth animation outright; and it always
       reached for the metric height field, which is hidden in imperial mode, so
       the focus silently went nowhere. */
    const scrollToTool = () => {
      const tool = document.getElementById('bmiTool');
      if (!tool) return;
      const header = document.querySelector('.site-header');
      const offset = (header ? header.offsetHeight : 0) + 14;
      const target = Math.max(0, tool.getBoundingClientRect().top + window.pageYOffset - offset);
      const smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      window.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });

      const metricShown = els.bmiHeightMetric && !els.bmiHeightMetric.hidden;
      const field = metricShown ? els.heightCm : els.heightFt;
      if (!field) return;
      /* Deferred, because on a phone the keyboard springs up the moment the
         field takes focus and shifts the viewport out from under the scroll. */
      window.setTimeout(() => {
        try { field.focus({ preventScroll: true }); } catch (e) { field.focus(); }
      }, smooth ? 420 : 0);
    };

    ['bmiHeroCta', 'bmiFinalCta'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        scrollToTool();
      });
    });
    initStickyBar();
    initReveal();
    resetForm();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
