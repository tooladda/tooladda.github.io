/* ToolAdda — EMI Calculator Pro engine.
   Vanilla JS, no dependencies. All math runs client-side; nothing is transmitted anywhere. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-emi-pro')) return;

  const STORAGE_KEY = 'tooladda-emi-pro-v1';

  const LOAN_PRESETS = {
    home: { label: 'Home Loan', icon: '🏠', rate: 8.5, tenureYears: 20, amount: 3500000 },
    car: { label: 'Car Loan', icon: '🚗', rate: 9.25, tenureYears: 7, amount: 800000 },
    bike: { label: 'Bike Loan', icon: '🏍️', rate: 11.5, tenureYears: 3, amount: 120000 },
    personal: { label: 'Personal Loan', icon: '💳', rate: 13, tenureYears: 4, amount: 400000 },
    education: { label: 'Education Loan', icon: '🎓', rate: 10.5, tenureYears: 8, amount: 1000000 },
    business: { label: 'Business Loan', icon: '💼', rate: 14, tenureYears: 5, amount: 1500000 },
    gold: { label: 'Gold Loan', icon: '🪙', rate: 10, tenureYears: 2, amount: 200000 },
    mortgage: { label: 'Mortgage', icon: '🏦', rate: 9, tenureYears: 15, amount: 5000000 },
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    chips: document.querySelectorAll('[data-loan-type]'),
    principal: $('emiPrincipal'),
    principalRange: $('emiPrincipalRange'),
    rate: $('emiRate'),
    rateRange: $('emiRateRange'),
    tenureValue: $('emiTenureValue'),
    tenureRange: $('emiTenureRange'),
    tenureUnit: $('emiTenureUnit'),
    assetPrice: $('emiAssetPrice'),
    downPayment: $('emiDownPayment'),
    feeType: $('emiProcessingFeeType'),
    fee: $('emiProcessingFee'),
    insurance: $('emiInsurance'),
    gst: $('emiGst'),
    compounding: $('emiCompounding'),
    firstEmiDate: $('emiFirstEmiDate'),
    resetBtn: $('emiResetBtn'),
    copyBtn: $('emiCopyBtn'),
    printBtn: $('emiPrintBtn'),

    resultEmi: $('emiResultEmi'),
    resultPrincipal: $('emiResultPrincipal'),
    resultInterest: $('emiResultInterest'),
    resultPayment: $('emiResultPayment'),
    resultTotalCost: $('emiResultTotalCost'),
    resultInterestPct: $('emiResultInterestPct'),
    resultPrincipalPct: $('emiResultPrincipalPct'),
    barPrincipal: $('emiBarPrincipal'),
    barInterest: $('emiBarInterest'),
    payoffDate: $('emiPayoffDate'),

    chartCanvas: $('emiChartCanvas'),
    chartTabs: document.querySelectorAll('[data-chart-tab]'),
    chartLegend: $('emiChartLegend'),
    chartEmpty: $('emiChartEmpty'),

    prepayEnable: $('emiPrepayEnable'),
    prepayFields: $('emiPrepayFields'),
    prepayMonthly: $('emiPrepayMonthly'),
    prepayLumpsum: $('emiPrepayLumpsum'),
    prepayLumpsumMonth: $('emiPrepayLumpsumMonth'),
    prepayStrategy: $('emiPrepayStrategy'),
    prepaySummary: $('emiPrepaySummary'),
    prepaySavedInterest: $('emiPrepaySavedInterest'),
    prepayTenureCut: $('emiPrepayTenureCut'),
    prepayNewPayoff: $('emiPrepayNewPayoff'),
    prepayNewEmi: $('emiPrepayNewEmi'),
    savingsBadge: $('emiSavingsBadge'),

    compareRate: $('emiCompareRate'),
    compareTenure: $('emiCompareTenure'),
    compareEmiA: $('emiCompareEmiA'),
    compareEmiB: $('emiCompareEmiB'),
    compareInterestA: $('emiCompareInterestA'),
    compareInterestB: $('emiCompareInterestB'),
    compareVerdict: $('emiCompareVerdict'),

    eligIncome: $('emiEligIncome'),
    eligExisting: $('emiEligExistingEmi'),
    eligFoir: $('emiEligFoir'),
    eligRate: $('emiEligRate'),
    eligTenure: $('emiEligTenure'),
    eligMaxEmi: $('emiEligMaxEmi'),
    eligMaxLoan: $('emiEligMaxLoan'),

    amortBody: $('emiAmortBody'),
    amortSearch: $('emiAmortSearch'),
    amortExport: $('emiAmortExport'),
    amortEmpty: $('emiAmortEmpty'),
    amortTableWrap: $('emiAmortTableWrap'),

    stickyEmi: $('emiStickyEmiValue'),
    srStatus: $('emiSrStatus'),
  };

  const fmtINR = (v, digits = 0) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(
      Number.isFinite(v) ? v : 0
    );

  const fmtNum = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number.isFinite(v) ? v : 0);

  const monthLabel = (date) => date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  const addMonths = (date, n) => {
    const d = new Date(date.getTime());
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    return d;
  };

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  // ---------- Core finance math ----------

  function monthlyRateFromAnnual(annualPct, compounding) {
    const annual = Math.max(0, annualPct) / 100;
    if (compounding === 'daily') {
      const daily = annual / 365;
      return Math.pow(1 + daily, 365 / 12) - 1;
    }
    return annual / 12;
  }

  function emiFor(principal, monthlyRate, months) {
    if (months <= 0 || principal <= 0) return 0;
    if (monthlyRate <= 0) return principal / months;
    const factor = Math.pow(1 + monthlyRate, months);
    return (principal * monthlyRate * factor) / (factor - 1);
  }

  /**
   * Builds a full month-by-month amortization schedule.
   * strategy: 'tenure' keeps EMI fixed and lets tenure shrink; 'emi' recomputes
   * a lower EMI after every extra payment so the original tenure is preserved.
   */
  function buildSchedule({ principal, monthlyRate, months, startDate, extraMonthly = 0, lumpsum = 0, lumpsumMonth = 0, strategy = 'tenure' }) {
    const schedule = [];
    if (principal <= 0 || months <= 0) {
      return { schedule, totalInterest: 0, totalPayment: 0, emi: 0, actualMonths: 0, payoffDate: null };
    }

    let balance = principal;
    let currentEmi = emiFor(principal, monthlyRate, months);
    const baseEmi = currentEmi;
    let revisedEmi = baseEmi;
    let totalInterest = 0;
    let totalPayment = 0;
    const cap = months + 2; // safety ceiling; prepayment only ever shortens or matches original term

    for (let m = 1; m <= cap && balance > 0.5; m += 1) {
      const interest = balance * monthlyRate;
      let principalPortion = currentEmi - interest;
      let extra = extraMonthly > 0 ? extraMonthly : 0;
      const isLumpsumMonth = lumpsum > 0 && m === lumpsumMonth;
      if (isLumpsumMonth) extra += lumpsum;

      if (principalPortion < 0) principalPortion = 0;
      if (principalPortion + extra >= balance) {
        extra = Math.max(0, balance - principalPortion);
        if (principalPortion > balance) principalPortion = balance;
      }

      const emiPaid = interest + principalPortion;
      balance = Math.max(0, balance - principalPortion - extra);
      totalInterest += interest;
      totalPayment += emiPaid + extra;

      schedule.push({
        month: m,
        date: addMonths(startDate, m - 1),
        emi: emiPaid,
        extra,
        principal: principalPortion,
        interest,
        balance,
      });

      // Real lenders only re-strike the EMI after a one-time lump-sum part-payment,
      // not automatically every month a recurring extra is paid — otherwise the EMI
      // would spiral down indefinitely, which no bank actually does.
      const remainingMonths = months - m;
      if (strategy === 'emi' && isLumpsumMonth && remainingMonths > 0 && balance > 0.5) {
        currentEmi = emiFor(balance, monthlyRate, remainingMonths);
        revisedEmi = currentEmi;
      }
    }

    return {
      schedule,
      totalInterest,
      totalPayment,
      emi: baseEmi,
      revisedEmi,
      actualMonths: schedule.length,
      payoffDate: schedule.length ? schedule[schedule.length - 1].date : null,
    };
  }

  function groupByYear(schedule) {
    const groups = [];
    let current = null;
    schedule.forEach((row) => {
      const label = row.date.getFullYear();
      if (!current || current.year !== label) {
        current = { year: label, rows: [], emi: 0, principal: 0, interest: 0, extra: 0, closingBalance: 0 };
        groups.push(current);
      }
      current.rows.push(row);
      current.emi += row.emi;
      current.principal += row.principal;
      current.interest += row.interest;
      current.extra += row.extra;
      current.closingBalance = row.balance;
    });
    return groups;
  }

  // ---------- State ----------

  const state = {
    loanType: 'home',
  };

  function getInputs() {
    const price = Math.max(0, Number(els.assetPrice?.value) || 0);
    const down = Math.max(0, Number(els.downPayment?.value) || 0);
    let principal = Math.max(0, Number(els.principal?.value) || 0);
    if (price > 0) {
      principal = Math.max(0, price - down);
      if (els.principal) els.principal.value = String(Math.round(principal));
    }

    const rate = clamp(Number(els.rate?.value) || 0, 0, 40);
    const tenureVal = Math.max(1, Number(els.tenureValue?.value) || 1);
    const unit = els.tenureUnit?.value || 'years';
    const months = unit === 'years' ? Math.round(tenureVal * 12) : Math.round(tenureVal);
    const compounding = els.compounding?.value || 'monthly';
    const monthlyRate = monthlyRateFromAnnual(rate, compounding);

    const feeType = els.feeType?.value || 'flat';
    const feeRaw = Math.max(0, Number(els.fee?.value) || 0);
    const processingFee = feeType === 'percent' ? (principal * feeRaw) / 100 : feeRaw;
    const insurance = Math.max(0, Number(els.insurance?.value) || 0);
    const gstPct = Math.max(0, Number(els.gst?.value) || 0);
    const gstAmount = ((processingFee + insurance) * gstPct) / 100;

    let startDate = new Date();
    if (els.firstEmiDate?.value) {
      const parsed = new Date(els.firstEmiDate.value);
      if (!Number.isNaN(parsed.getTime())) startDate = parsed;
    } else {
      startDate = addMonths(new Date(), 1);
    }

    return { principal, rate, months, unit, tenureVal, monthlyRate, compounding, processingFee, insurance, gstAmount, startDate };
  }

  let lastBaseline = null;
  let lastActive = null;
  let activeChart = 'doughnut';

  function syncRangeNumberPairs() {
    if (els.principalRange && els.principal) {
      els.principalRange.min = els.principal.min || '10000';
      els.principalRange.max = '20000000';
    }
  }

  function render() {
    const inputs = getInputs();
    const { principal, rate, months, monthlyRate, processingFee, insurance, gstAmount, startDate } = inputs;

    const baseline = buildSchedule({ principal, monthlyRate, months, startDate, strategy: 'tenure' });
    lastBaseline = baseline;

    const prepayOn = !!els.prepayEnable?.checked;
    let active = baseline;
    if (prepayOn) {
      const extraMonthly = Math.max(0, Number(els.prepayMonthly?.value) || 0);
      const lumpsum = Math.max(0, Number(els.prepayLumpsum?.value) || 0);
      const lumpsumMonth = Math.max(1, Number(els.prepayLumpsumMonth?.value) || 1);
      const strategy = els.prepayStrategy?.value || 'tenure';
      active = buildSchedule({ principal, monthlyRate, months, startDate, extraMonthly, lumpsum, lumpsumMonth, strategy });
    }
    lastActive = active;

    const totalCost = active.totalPayment + processingFee + insurance + gstAmount;
    const interestPct = active.totalPayment > 0 ? (active.totalInterest / active.totalPayment) * 100 : 0;
    const principalPct = 100 - interestPct;

    if (els.resultEmi) els.resultEmi.textContent = fmtINR(prepayOn && els.prepayStrategy?.value === 'emi' ? active.revisedEmi : active.emi, 0);
    if (els.resultPrincipal) els.resultPrincipal.textContent = fmtINR(principal);
    if (els.resultInterest) els.resultInterest.textContent = fmtINR(active.totalInterest);
    if (els.resultPayment) els.resultPayment.textContent = fmtINR(active.totalPayment);
    if (els.resultTotalCost) els.resultTotalCost.textContent = fmtINR(totalCost);
    if (els.resultInterestPct) els.resultInterestPct.textContent = interestPct.toFixed(1) + '%';
    if (els.resultPrincipalPct) els.resultPrincipalPct.textContent = principalPct.toFixed(1) + '%';
    if (els.barPrincipal) els.barPrincipal.style.width = principalPct.toFixed(2) + '%';
    if (els.barInterest) els.barInterest.style.width = interestPct.toFixed(2) + '%';
    if (els.payoffDate) els.payoffDate.textContent = active.payoffDate ? monthLabel(active.payoffDate) : '—';
    if (els.stickyEmi) els.stickyEmi.textContent = fmtINR(active.emi, 0);

    renderPrepaySummary(baseline, active, prepayOn);
    renderChart(principal, active.totalInterest, active.schedule);
    renderAmortization(active.schedule);
    renderComparison(inputs);
    persist(inputs);
  }

  function renderPrepaySummary(baseline, active, on) {
    if (els.prepayFields) els.prepayFields.hidden = !on;
    if (!els.prepaySummary) return;
    if (!on) {
      els.prepaySummary.hidden = true;
      if (els.savingsBadge) els.savingsBadge.hidden = true;
      return;
    }
    els.prepaySummary.hidden = false;
    const savedInterest = Math.max(0, baseline.totalInterest - active.totalInterest);
    const tenureCutMonths = Math.max(0, baseline.actualMonths - active.actualMonths);
    if (els.prepaySavedInterest) els.prepaySavedInterest.textContent = fmtINR(savedInterest);
    if (els.prepayTenureCut) els.prepayTenureCut.textContent = tenureCutMonths > 0 ? `${tenureCutMonths} month${tenureCutMonths === 1 ? '' : 's'} earlier` : 'Same tenure, lower EMI';
    if (els.prepayNewPayoff) els.prepayNewPayoff.textContent = active.payoffDate ? monthLabel(active.payoffDate) : '—';
    if (els.prepayNewEmi) els.prepayNewEmi.textContent = fmtINR(active.revisedEmi);
    if (els.savingsBadge) {
      els.savingsBadge.hidden = savedInterest <= 0 && tenureCutMonths <= 0;
      els.savingsBadge.textContent = `💡 Prepaying saves ${fmtINR(savedInterest)} in interest`;
    }
  }

  // ---------- Chart rendering (canvas, no dependency) ----------

  function getCssVar(name, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  // Chart colours come from the page's CSS (--emi-chart-*), so the canvas
  // follows the page theme; the old hard-coded colours are the fallbacks.
  function chartColors() {
    return {
      p: getCssVar('--emi-chart-principal', '#4f46e5'),
      i: getCssVar('--emi-chart-interest', '#22c55e'),
      b: getCssVar('--emi-chart-balance', '#f59e0b'),
    };
  }

  function prepCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(200, rect.width || 260);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, size };
  }

  function renderChart(principal, interest, schedule) {
    const canvas = els.chartCanvas;
    if (!canvas) return;
    const total = principal + interest;
    if (els.chartEmpty) els.chartEmpty.hidden = total > 0;
    if (total <= 0) {
      const { ctx, size } = prepCanvas(canvas);
      ctx.clearRect(0, 0, size, size);
      return;
    }
    if (activeChart === 'doughnut') drawDoughnut(canvas, principal, interest);
    else if (activeChart === 'yearly') drawYearlyBars(canvas, schedule);
    else drawBalanceLine(canvas, schedule, principal);

    if (els.chartLegend) {
      const c = chartColors();
      if (activeChart === 'doughnut') {
        els.chartLegend.innerHTML =
          '<span><i class="emi-dot" style="background:' + c.p + '"></i>Principal</span>' +
          '<span><i class="emi-dot" style="background:' + c.i + '"></i>Total interest</span>';
      } else if (activeChart === 'yearly') {
        els.chartLegend.innerHTML =
          '<span><i class="emi-dot" style="background:' + c.p + '"></i>Principal / year</span>' +
          '<span><i class="emi-dot" style="background:' + c.i + '"></i>Interest / year</span>';
      } else {
        els.chartLegend.innerHTML = '<span><i class="emi-dot" style="background:' + c.b + '"></i>Outstanding balance over time</span>';
      }
    }
  }

  function drawDoughnut(canvas, principal, interest) {
    const { ctx, size } = prepCanvas(canvas);
    ctx.clearRect(0, 0, size, size);
    const total = principal + interest;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 10;
    const innerRadius = radius * 0.62;
    let start = -Math.PI / 2;
    const colors = chartColors();
    [
      { v: principal, c: colors.p },
      { v: interest, c: colors.i },
    ].forEach((slice) => {
      const angle = (slice.v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = slice.c;
      ctx.fill();
      start += angle;
    });
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.fillStyle = isDark ? '#f8fafc' : '#14213d';
    ctx.textAlign = 'center';
    ctx.font = '700 13px Inter, sans-serif';
    ctx.fillText('Principal vs', cx, cy - 6);
    ctx.fillText('Interest', cx, cy + 12);
  }

  function drawYearlyBars(canvas, schedule) {
    const { ctx, size } = prepCanvas(canvas);
    ctx.clearRect(0, 0, size, size);
    const groups = groupByYear(schedule).slice(0, 12);
    if (!groups.length) return;
    const maxTotal = Math.max(...groups.map((g) => g.principal + g.interest), 1);
    const padding = 22;
    const w = size - padding * 2;
    const h = size - padding * 2;
    const barW = w / groups.length;
    const colors = chartColors();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(20,33,61,0.12)';
    ctx.beginPath();
    ctx.moveTo(padding, size - padding);
    ctx.lineTo(size - padding, size - padding);
    ctx.stroke();

    groups.forEach((g, i) => {
      const total = g.principal + g.interest;
      const barH = (total / maxTotal) * h;
      const principalH = (g.principal / total) * barH || 0;
      const interestH = barH - principalH;
      const x = padding + i * barW + barW * 0.18;
      const bw = barW * 0.64;
      const yBase = size - padding;
      ctx.fillStyle = colors.i;
      ctx.fillRect(x, yBase - barH, bw, interestH);
      ctx.fillStyle = colors.p;
      ctx.fillRect(x, yBase - principalH, bw, principalH);
      if (bw > 14) {
        ctx.fillStyle = isDark ? '#a0aec0' : '#5b6780';
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Y${i + 1}`, x + bw / 2, size - padding + 12);
      }
    });
  }

  function drawBalanceLine(canvas, schedule, principal) {
    const { ctx, size } = prepCanvas(canvas);
    ctx.clearRect(0, 0, size, size);
    if (!schedule.length) return;
    const padding = 20;
    const w = size - padding * 2;
    const h = size - padding * 2;
    const step = w / (schedule.length - 1 || 1);
    const colors = chartColors();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(20,33,61,0.12)';
    ctx.beginPath();
    ctx.moveTo(padding, size - padding);
    ctx.lineTo(size - padding, size - padding);
    ctx.stroke();

    ctx.beginPath();
    schedule.forEach((row, i) => {
      const x = padding + i * step;
      const y = padding + h - (row.balance / principal) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + w, size - padding);
    ctx.lineTo(padding, size - padding);
    ctx.closePath();
    ctx.fillStyle = colors.b;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    schedule.forEach((row, i) => {
      const x = padding + i * step;
      const y = padding + h - (row.balance / principal) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = colors.b;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // ---------- Amortization table (lazy-expanded per year) ----------

  function renderAmortization(schedule) {
    if (!els.amortBody) return;
    els.amortBody.innerHTML = '';
    if (!schedule.length) {
      if (els.amortEmpty) els.amortEmpty.hidden = false;
      if (els.amortTableWrap) els.amortTableWrap.hidden = true;
      return;
    }
    if (els.amortEmpty) els.amortEmpty.hidden = true;
    if (els.amortTableWrap) els.amortTableWrap.hidden = false;

    const groups = groupByYear(schedule);
    const frag = document.createDocumentFragment();

    groups.forEach((g, idx) => {
      const yearRow = document.createElement('tr');
      yearRow.className = 'emi-amort-year-row';
      yearRow.dataset.yearIndex = String(idx);
      yearRow.dataset.searchKey = `year ${idx + 1} ${g.year}`;
      yearRow.innerHTML = `
        <td><button type="button" class="emi-amort-toggle" aria-expanded="false" aria-label="Expand year ${idx + 1} monthly breakdown">▸ Year ${idx + 1} <span class="emi-amort-year-tag">${g.year}</span></button></td>
        <td>${fmtINR(g.emi + g.extra, 0)}</td>
        <td>${fmtINR(g.principal + g.extra, 0)}</td>
        <td>${fmtINR(g.interest, 0)}</td>
        <td>${fmtINR(g.closingBalance, 0)}</td>
      `;
      frag.appendChild(yearRow);

      g.rows.forEach((row) => {
        const mRow = document.createElement('tr');
        mRow.className = 'emi-amort-month-row';
        mRow.dataset.yearIndex = String(idx);
        mRow.hidden = true;
        mRow.dataset.searchKey = `${monthLabel(row.date)} month ${row.month}`;
        mRow.innerHTML = `
          <td class="emi-amort-month-cell" data-label="Month">${row.month} · ${monthLabel(row.date)}</td>
          <td data-label="EMI">${fmtINR(row.emi + row.extra, 0)}</td>
          <td data-label="Principal">${fmtINR(row.principal + row.extra, 0)}</td>
          <td data-label="Interest">${fmtINR(row.interest, 0)}</td>
          <td data-label="Balance">${fmtINR(row.balance, 0)}</td>
        `;
        frag.appendChild(mRow);
      });
    });

    els.amortBody.appendChild(frag);
    applyAmortSearch();
  }

  function applyAmortSearch() {
    const term = (els.amortSearch?.value || '').trim().toLowerCase();
    const yearRows = els.amortBody?.querySelectorAll('.emi-amort-year-row') || [];
    yearRows.forEach((yr) => {
      const idx = yr.dataset.yearIndex;
      const monthRows = els.amortBody.querySelectorAll(`.emi-amort-month-row[data-year-index="${idx}"]`);
      if (!term) {
        yr.hidden = false;
        return;
      }
      const yearMatches = yr.dataset.searchKey.includes(term);
      let anyMonthMatch = false;
      monthRows.forEach((mr) => {
        const matches = mr.dataset.searchKey.includes(term);
        if (matches) anyMonthMatch = true;
        if (yearMatches) {
          mr.hidden = false;
        } else {
          mr.hidden = !matches;
        }
      });
      yr.hidden = !(yearMatches || anyMonthMatch);
      if (!yearMatches && anyMonthMatch) {
        yr.querySelector('.emi-amort-toggle')?.setAttribute('aria-expanded', 'true');
      }
    });
  }

  function toggleYear(button) {
    const yearRow = button.closest('.emi-amort-year-row');
    const idx = yearRow.dataset.yearIndex;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    button.textContent = button.textContent.replace(expanded ? '▾' : '▸', expanded ? '▸' : '▾');
    const rows = els.amortBody.querySelectorAll(`.emi-amort-month-row[data-year-index="${idx}"]`);
    rows.forEach((r) => {
      r.hidden = expanded;
    });
  }

  function exportCsv() {
    if (!lastActive || !lastActive.schedule.length) return;
    const rows = [['Month', 'Date', 'EMI', 'Principal', 'Interest', 'Extra Payment', 'Outstanding Balance']];
    lastActive.schedule.forEach((r) => {
      rows.push([r.month, monthLabel(r.date), r.emi.toFixed(2), r.principal.toFixed(2), r.interest.toFixed(2), r.extra.toFixed(2), r.balance.toFixed(2)]);
    });
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emi-amortization-schedule.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    announce('Amortization schedule exported as CSV');
  }

  // ---------- Comparison ----------

  function renderComparison(inputs) {
    if (!els.compareRate || !els.compareEmiA) return;
    const { principal, rate, months, compounding } = inputs;
    const emiA = emiFor(principal, monthlyRateFromAnnual(rate, compounding), months);
    const totalA = emiA * months;
    const interestA = totalA - principal;

    const altRate = Number(els.compareRate?.value) || rate;
    const altYears = Number(els.compareTenure?.value) || months / 12;
    const altMonths = Math.round(altYears * 12);
    const emiB = emiFor(principal, monthlyRateFromAnnual(altRate, compounding), altMonths);
    const totalB = emiB * altMonths;
    const interestB = totalB - principal;

    if (els.compareEmiA) els.compareEmiA.textContent = fmtINR(emiA);
    if (els.compareEmiB) els.compareEmiB.textContent = fmtINR(emiB);
    if (els.compareInterestA) els.compareInterestA.textContent = fmtINR(interestA);
    if (els.compareInterestB) els.compareInterestB.textContent = fmtINR(interestB);
    if (els.compareVerdict) {
      const diff = interestA - interestB;
      if (Math.abs(diff) < 1) {
        els.compareVerdict.textContent = 'Both scenarios cost roughly the same in total interest.';
      } else if (diff > 0) {
        els.compareVerdict.textContent = `Scenario B saves ${fmtINR(diff)} in total interest versus your current plan.`;
      } else {
        els.compareVerdict.textContent = `Your current plan (A) saves ${fmtINR(Math.abs(diff))} in total interest versus Scenario B.`;
      }
    }
  }

  // ---------- Eligibility ----------

  function renderEligibility() {
    if (!els.eligMaxEmi) return;
    const income = Math.max(0, Number(els.eligIncome?.value) || 0);
    const existing = Math.max(0, Number(els.eligExisting?.value) || 0);
    const foir = clamp(Number(els.eligFoir?.value) || 50, 10, 90);
    const rate = Math.max(0, Number(els.eligRate?.value) || 9);
    const years = Math.max(1, Number(els.eligTenure?.value) || 20);
    const months = Math.round(years * 12);

    const maxEmi = Math.max(0, (income * foir) / 100 - existing);
    const monthlyRate = monthlyRateFromAnnual(rate, 'monthly');
    let maxLoan = 0;
    if (monthlyRate > 0) {
      maxLoan = (maxEmi * (Math.pow(1 + monthlyRate, months) - 1)) / (monthlyRate * Math.pow(1 + monthlyRate, months));
    } else {
      maxLoan = maxEmi * months;
    }

    if (els.eligMaxEmi) els.eligMaxEmi.textContent = fmtINR(maxEmi);
    if (els.eligMaxLoan) els.eligMaxLoan.textContent = fmtINR(maxLoan);
  }

  // ---------- Persistence ----------

  function persist(inputs) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          loanType: state.loanType,
          principal: inputs.principal,
          rate: inputs.rate,
          tenureVal: Number(els.tenureValue?.value) || 0,
          unit: inputs.unit,
        })
      );
    } catch (e) {
      /* storage may be unavailable — ignore */
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      if (saved.loanType && LOAN_PRESETS[saved.loanType]) applyLoanType(saved.loanType, false);
      if (saved.principal && els.principal) els.principal.value = String(saved.principal);
      if (saved.rate && els.rate) els.rate.value = String(saved.rate);
      if (saved.tenureVal && els.tenureValue) els.tenureValue.value = String(saved.tenureVal);
      if (saved.unit && els.tenureUnit) els.tenureUnit.value = saved.unit;
      syncSliders();
    } catch (e) {
      /* ignore invalid storage */
    }
  }

  // ---------- UI wiring ----------

  function applyLoanType(type, resetAmount = true) {
    const preset = LOAN_PRESETS[type];
    if (!preset) return;
    state.loanType = type;
    els.chips.forEach((chip) => {
      const isActive = chip.dataset.loanType === type;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });
    if (resetAmount) {
      if (els.principal) els.principal.value = String(preset.amount);
      if (els.rate) els.rate.value = String(preset.rate);
      if (els.tenureValue) els.tenureValue.value = String(preset.tenureYears);
      if (els.tenureUnit) els.tenureUnit.value = 'years';
    }
    syncSliders();
  }

  function syncSliders() {
    if (els.principal && els.principalRange) els.principalRange.value = els.principal.value;
    if (els.rate && els.rateRange) els.rateRange.value = els.rate.value;
    if (els.tenureValue && els.tenureRange) {
      const unit = els.tenureUnit?.value || 'years';
      els.tenureRange.max = unit === 'years' ? '30' : '360';
      els.tenureRange.value = els.tenureValue.value;
    }
  }

  let rafPending = false;
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }

  function announce(msg) {
    if (els.srStatus) els.srStatus.textContent = msg;
  }

  function bindPair(numberEl, rangeEl) {
    if (!numberEl || !rangeEl) return;
    numberEl.addEventListener('input', () => {
      rangeEl.value = numberEl.value;
      scheduleRender();
    });
    rangeEl.addEventListener('input', () => {
      numberEl.value = rangeEl.value;
      scheduleRender();
    });
  }

  function init() {
    els.chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        applyLoanType(chip.dataset.loanType, true);
        scheduleRender();
      });
    });

    bindPair(els.principal, els.principalRange);
    bindPair(els.rate, els.rateRange);
    bindPair(els.tenureValue, els.tenureRange);

    [els.tenureUnit, els.assetPrice, els.downPayment, els.feeType, els.fee, els.insurance, els.gst, els.compounding, els.firstEmiDate].forEach((el) => {
      el?.addEventListener('input', () => {
        syncSliders();
        scheduleRender();
      });
      el?.addEventListener('change', () => {
        syncSliders();
        scheduleRender();
      });
    });

    els.prepayEnable?.addEventListener('change', scheduleRender);
    [els.prepayMonthly, els.prepayLumpsum, els.prepayLumpsumMonth, els.prepayStrategy].forEach((el) => {
      el?.addEventListener('input', scheduleRender);
      el?.addEventListener('change', scheduleRender);
    });

    [els.compareRate, els.compareTenure].forEach((el) => {
      el?.addEventListener('input', () => renderComparison(getInputs()));
    });

    [els.eligIncome, els.eligExisting, els.eligFoir, els.eligRate, els.eligTenure].forEach((el) => {
      el?.addEventListener('input', renderEligibility);
    });

    els.chartTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        activeChart = tab.dataset.chartTab;
        els.chartTabs.forEach((t) => {
          const active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', String(active));
        });
        render();
      });
    });

    els.amortBody?.addEventListener('click', (e) => {
      const btn = e.target.closest('.emi-amort-toggle');
      if (btn) toggleYear(btn);
    });
    els.amortSearch?.addEventListener('input', applyAmortSearch);
    els.amortExport?.addEventListener('click', exportCsv);

    els.resetBtn?.addEventListener('click', () => {
      applyLoanType(state.loanType, true);
      if (els.assetPrice) els.assetPrice.value = '';
      if (els.downPayment) els.downPayment.value = '0';
      if (els.fee) els.fee.value = '0';
      if (els.insurance) els.insurance.value = '0';
      if (els.gst) els.gst.value = '18';
      if (els.prepayEnable) els.prepayEnable.checked = false;
      scheduleRender();
      announce('Calculator reset to defaults');
    });

    els.copyBtn?.addEventListener('click', async () => {
      const text = [
        'ToolAdda EMI Calculator Result',
        `Loan Amount: ${els.resultPrincipal?.textContent || '—'}`,
        `Monthly EMI: ${els.resultEmi?.textContent || '—'}`,
        `Total Interest: ${els.resultInterest?.textContent || '—'}`,
        `Total Payment: ${els.resultPayment?.textContent || '—'}`,
        `Total Cost (incl. fees): ${els.resultTotalCost?.textContent || '—'}`,
      ].join('\n');
      try {
        await navigator.clipboard.writeText(text);
        announce('Result copied to clipboard');
      } catch (e) {
        announce('Copy failed — please try again');
      }
    });

    els.printBtn?.addEventListener('click', () => window.print());

    window.addEventListener('resize', () => render());
    document.addEventListener('theme-change', () => render());
    const observer = new MutationObserver(() => render());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    window.addEventListener('hashchange', () => {
      if (applyFromHash()) {
        scheduleRender();
        document.getElementById('emi-calculator-heading-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    applyLoanType('home', true);
    restore();
    applyFromHash();
    renderEligibility();
    render();
  }

  // Lets internal/external links deep-link straight into a loan type, e.g. emi-calculator.html#car
  function applyFromHash() {
    const key = decodeURIComponent(location.hash.replace('#', '').toLowerCase());
    if (!LOAN_PRESETS[key]) return false;
    applyLoanType(key, true);
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
