/* ToolAdda — Fixed Deposit Calculator Pro engine.
   Vanilla JS, no dependencies. All math runs client-side; nothing is transmitted anywhere. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-fd-pro')) return;

  const STORAGE_KEY = 'tooladda-fd-pro-v1';

  const FREQ = { annually: 1, 'half-yearly': 2, quarterly: 4, monthly: 12, daily: 365 };
  const FREQ_LABEL = { simple: 'Simple interest (no compounding)', annually: 'Annually', 'half-yearly': 'Half-yearly', quarterly: 'Quarterly', monthly: 'Monthly', daily: 'Daily' };

  const FD_PRESETS = {
    bank: { label: 'Bank FD (1Y)', amount: 100000, rate: 6.5, tenureValue: 1, tenureUnit: 'years', compounding: 'quarterly', payout: 'cumulative', senior: false },
    short: { label: 'Short Term (91 Days)', amount: 100000, rate: 5.5, tenureValue: 91, tenureUnit: 'days', compounding: 'simple', payout: 'cumulative', senior: false },
    medium: { label: 'Medium Term (3Y)', amount: 200000, rate: 7, tenureValue: 3, tenureUnit: 'years', compounding: 'quarterly', payout: 'cumulative', senior: false },
    long: { label: 'Long Term (5Y)', amount: 300000, rate: 6.75, tenureValue: 5, tenureUnit: 'years', compounding: 'quarterly', payout: 'cumulative', senior: false },
    taxsaving: { label: 'Tax-Saving FD (5Y)', amount: 150000, rate: 6.5, tenureValue: 5, tenureUnit: 'years', compounding: 'quarterly', payout: 'cumulative', senior: false },
    senior: { label: 'Senior Citizen FD', amount: 500000, rate: 7, tenureValue: 5, tenureUnit: 'years', compounding: 'quarterly', payout: 'cumulative', senior: true },
    postoffice: { label: 'Post Office TD (5Y)', amount: 100000, rate: 7.5, tenureValue: 5, tenureUnit: 'years', compounding: 'quarterly', payout: 'cumulative', senior: false },
    payout: { label: 'Monthly Income FD', amount: 500000, rate: 6.5, tenureValue: 3, tenureUnit: 'years', compounding: 'monthly', payout: 'noncumulative', senior: false },
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    chips: document.querySelectorAll('[data-fd-preset]'),
    amount: $('fdAmount'),
    amountRange: $('fdAmountRange'),
    rate: $('fdRate'),
    rateRange: $('fdRateRange'),
    tenureValue: $('fdTenureValue'),
    tenureRange: $('fdTenureRange'),
    tenureUnit: $('fdTenureUnit'),
    compounding: $('fdCompounding'),
    compoundingLabel: $('fdCompoundingLabel'),
    payout: $('fdPayout'),
    seniorToggle: $('fdSeniorToggle'),
    seniorBonusRow: $('fdSeniorBonusRow'),
    seniorBonus: $('fdSeniorBonus'),
    taxSlab: $('fdTaxSlab'),
    inflationRate: $('fdInflationRate'),
    investmentDate: $('fdInvestmentDate'),
    withdrawEnable: $('fdWithdrawEnable'),
    withdrawFields: $('fdWithdrawFields'),
    withdrawDays: $('fdWithdrawDays'),
    withdrawPenalty: $('fdWithdrawPenalty'),
    withdrawSummary: $('fdWithdrawSummary'),
    withdrawMaturity: $('fdWithdrawMaturity'),
    withdrawInterest: $('fdWithdrawInterest'),
    withdrawLost: $('fdWithdrawLost'),
    resetBtn: $('fdResetBtn'),
    copyBtn: $('fdCopyBtn'),
    printBtn: $('fdPrintBtn'),
    shareBtn: $('fdShareBtn'),

    resultMaturity: $('fdResultMaturity'),
    resultInterest: $('fdResultInterest'),
    resultInvestment: $('fdResultInvestment'),
    resultEffectiveYield: $('fdResultEffectiveYield'),
    resultAnnualReturn: $('fdResultAnnualReturn'),
    resultMonthlyEquivalent: $('fdResultMonthlyEquivalent'),
    resultPostTax: $('fdResultPostTax'),
    resultRealReturn: $('fdResultRealReturn'),
    resultMaturityDate: $('fdResultMaturityDate'),
    resultDuration: $('fdResultDuration'),
    resultTds: $('fdResultTds'),
    barPrincipal: $('fdBarPrincipal'),
    barInterest: $('fdBarInterest'),
    resultPrincipalPct: $('fdResultPrincipalPct'),
    resultInterestPct: $('fdResultInterestPct'),

    chartCanvas: $('fdChartCanvas'),
    chartTabs: document.querySelectorAll('[data-fd-chart-tab]'),
    chartLegend: $('fdChartLegend'),
    chartEmpty: $('fdChartEmpty'),

    scheduleBody: $('fdScheduleBody'),
    scheduleHead: $('fdScheduleHead'),

    srStatus: $('fdSrStatus'),
    stickyMaturity: $('fdStickyMaturity'),
    stickyBtn: $('fdStickyCalcBtn'),
  };

  let activeChart = 'doughnut';
  let lastResult = null;
  let lastSchedule = [];

  /* ---------------- formatting ---------------- */

  const formatCurrency = (value, decimals = 0) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(Number.isFinite(value) ? value : 0);

  const formatPercent = (value, decimals = 2) => `${Number.isFinite(value) ? value.toFixed(decimals) : '0.00'}%`;

  const formatDate = (date) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  // toISOString() converts to UTC, which shifts the calendar day for users
  // outside UTC — use local date parts so the default date input matches
  // "today" in the user's own timezone.
  const toLocalDateInputValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const formatDuration = (start, end) => {
    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    let days = end.getDate() - start.getDate();
    if (days < 0) {
      months -= 1;
      const prevMonth = new Date(end.getFullYear(), end.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    const parts = [];
    if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
    if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    if (days > 0 || parts.length === 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    return parts.join(', ');
  };

  /* ---------------- date math ---------------- */

  const addTenure = (start, value, unit) => {
    const d = new Date(start.getTime());
    if (unit === 'years') d.setFullYear(d.getFullYear() + value);
    else if (unit === 'months') d.setMonth(d.getMonth() + value);
    else d.setDate(d.getDate() + value);
    return d;
  };

  const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);

  /* ---------------- core FD math ---------------- */

  const computeFD = ({ principal, effectiveRate, years, compounding, payout }) => {
    const rate = effectiveRate / 100;
    const n = FREQ[compounding] || 1;
    let interest;
    let maturity;
    let periodicPayout = null;

    if (payout === 'noncumulative') {
      interest = principal * rate * years;
      maturity = principal;
      periodicPayout = (principal * rate) / n;
    } else if (compounding === 'simple') {
      interest = principal * rate * years;
      maturity = principal + interest;
    } else {
      const periodicRate = rate / n;
      maturity = principal * Math.pow(1 + periodicRate, n * years);
      interest = maturity - principal;
    }
    return { interest, maturity, periodicPayout, n, rate };
  };

  const effectiveAnnualYield = (effectiveRate, compounding, payout) => {
    const rate = effectiveRate / 100;
    if (payout === 'noncumulative' || compounding === 'simple') return rate;
    const n = FREQ[compounding] || 1;
    return Math.pow(1 + rate / n, n) - 1;
  };

  const buildSchedule = ({ principal, effectiveRate, years, compounding, payout }) => {
    const rate = effectiveRate / 100;
    const fullYears = Math.floor(years + 1e-9);
    const fraction = years - fullYears;
    const points = [];
    for (let y = 1; y <= fullYears; y += 1) points.push({ y, partial: false });
    if (fraction > 0.01) points.push({ y: years, partial: true, label: fullYears + 1 });

    const rows = [];
    let prevClosing = principal;
    points.forEach((point) => {
      let closing;
      let interest;
      let payoutAmount = null;
      if (payout === 'noncumulative') {
        payoutAmount = principal * rate * (point.partial ? point.y - fullYears : 1);
        interest = payoutAmount;
        closing = principal;
      } else {
        closing = computeFD({ principal, effectiveRate, years: point.y, compounding, payout: 'cumulative' }).maturity;
        interest = closing - prevClosing;
      }
      rows.push({
        label: point.partial ? `Year ${point.label} (partial)` : `Year ${point.y}`,
        opening: prevClosing,
        interest,
        payoutAmount,
        closing,
      });
      prevClosing = closing;
    });
    return rows;
  };

  /* ---------------- canvas charts (device-pixel-ratio aware) ---------------- */

  const prepCanvas = (canvas) => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(200, rect.width || 260);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, size };
  };

  const isDarkMode = () => document.documentElement.getAttribute('data-theme') === 'dark';

  const drawDoughnut = (canvas, principal, interest) => {
    const { ctx, size } = prepCanvas(canvas);
    ctx.clearRect(0, 0, size, size);
    const total = principal + interest;
    if (total <= 0) return;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 10;
    const innerRadius = radius * 0.62;
    let start = -Math.PI / 2;
    [
      { v: principal, c: '#4f46e5' },
      { v: Math.max(interest, 0), c: '#10b981' },
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

    ctx.fillStyle = isDarkMode() ? '#f8fafc' : '#14213d';
    ctx.textAlign = 'center';
    ctx.font = '700 13px Inter, sans-serif';
    ctx.fillText('Principal vs', cx, cy - 6);
    ctx.fillText('Interest', cx, cy + 12);
  };

  const drawYearlyBars = (canvas, schedule) => {
    const { ctx, size } = prepCanvas(canvas);
    ctx.clearRect(0, 0, size, size);
    const rows = schedule.slice(0, 20);
    if (!rows.length) return;
    const maxInterest = Math.max(...rows.map((r) => r.interest), 1);
    const padding = 24;
    const w = size - padding * 2;
    const h = size - padding * 2;
    const barW = w / rows.length;
    const dark = isDarkMode();
    ctx.strokeStyle = dark ? 'rgba(148,163,184,0.25)' : 'rgba(20,33,61,0.12)';
    ctx.beginPath();
    ctx.moveTo(padding, size - padding);
    ctx.lineTo(size - padding, size - padding);
    ctx.stroke();

    rows.forEach((row, i) => {
      const barH = Math.max((row.interest / maxInterest) * h, 1);
      const x = padding + i * barW + barW * 0.18;
      const bw = barW * 0.64;
      const yBase = size - padding;
      ctx.fillStyle = '#10b981';
      ctx.fillRect(x, yBase - barH, bw, barH);
      if (bw > 12) {
        ctx.fillStyle = dark ? '#a0aec0' : '#5b6780';
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Y${i + 1}`, x + bw / 2, size - padding + 12);
      }
    });
  };

  const drawGrowthLine = (canvas, schedule, principal) => {
    const { ctx, size } = prepCanvas(canvas);
    ctx.clearRect(0, 0, size, size);
    if (!schedule.length) return;
    const padding = 20;
    const w = size - padding * 2;
    const h = size - padding * 2;
    const maxVal = Math.max(...schedule.map((r) => r.closing + (r.payoutAmount || 0)), principal, 1);
    const points = [{ closing: principal }].concat(schedule);
    const step = w / (points.length - 1 || 1);
    const dark = isDarkMode();

    ctx.strokeStyle = dark ? 'rgba(148,163,184,0.25)' : 'rgba(20,33,61,0.12)';
    ctx.beginPath();
    ctx.moveTo(padding, size - padding);
    ctx.lineTo(size - padding, size - padding);
    ctx.stroke();

    const valueAt = (row) => row.closing + (row.payoutAmount ? points.slice(0, points.indexOf(row) + 1).reduce((s, r) => s + (r.payoutAmount || 0), 0) : 0);

    ctx.beginPath();
    points.forEach((row, i) => {
      const x = padding + i * step;
      const y = padding + h - (valueAt(row) / maxVal) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + w, size - padding);
    ctx.lineTo(padding, size - padding);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
    ctx.fill();

    ctx.beginPath();
    points.forEach((row, i) => {
      const x = padding + i * step;
      const y = padding + h - (valueAt(row) / maxVal) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  };

  const renderChart = (principal, interest, schedule) => {
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
    else drawGrowthLine(canvas, schedule, principal);

    if (els.chartLegend) {
      if (activeChart === 'doughnut') {
        els.chartLegend.innerHTML =
          '<span><i class="fd-dot" style="background:#4f46e5"></i>Principal</span>' +
          '<span><i class="fd-dot" style="background:#10b981"></i>Total interest</span>';
      } else if (activeChart === 'yearly') {
        els.chartLegend.innerHTML = '<span><i class="fd-dot" style="background:#10b981"></i>Interest earned per year</span>';
      } else {
        els.chartLegend.innerHTML = '<span><i class="fd-dot" style="background:#10b981"></i>Deposit value growing toward maturity</span>';
      }
    }
  };

  /* ---------------- schedule table ---------------- */

  const renderSchedule = (schedule, payout) => {
    if (!els.scheduleBody) return;
    if (els.scheduleHead) {
      els.scheduleHead.innerHTML = payout === 'noncumulative'
        ? '<tr><th>Year</th><th>Balance (Principal)</th><th>Interest Paid Out</th><th>Cumulative Payout</th></tr>'
        : '<tr><th>Year</th><th>Opening Balance</th><th>Interest Earned</th><th>Closing Balance</th></tr>';
    }
    if (!schedule.length) {
      els.scheduleBody.innerHTML = '<tr><td colspan="4">Enter a deposit amount to see the year-wise growth table.</td></tr>';
      return;
    }
    let cumulativePayout = 0;
    els.scheduleBody.innerHTML = schedule
      .map((row) => {
        if (payout === 'noncumulative') {
          cumulativePayout += row.payoutAmount || 0;
          return `<tr><td>${row.label}</td><td>${formatCurrency(row.closing)}</td><td>${formatCurrency(row.payoutAmount || 0)}</td><td>${formatCurrency(cumulativePayout)}</td></tr>`;
        }
        return `<tr><td>${row.label}</td><td>${formatCurrency(row.opening)}</td><td>${formatCurrency(row.interest)}</td><td>${formatCurrency(row.closing)}</td></tr>`;
      })
      .join('');
  };

  /* ---------------- inputs ---------------- */

  const getInputs = () => {
    const amount = Math.max(0, Number(els.amount?.value) || 0);
    const baseRate = Math.max(0, Number(els.rate?.value) || 0);
    const senior = !!els.seniorToggle?.checked;
    const seniorBonus = senior ? Math.max(0, Number(els.seniorBonus?.value) || 0) : 0;
    const effectiveRate = baseRate + seniorBonus;
    const tenureValue = Math.max(1, Number(els.tenureValue?.value) || 1);
    const tenureUnit = els.tenureUnit?.value || 'years';
    const compounding = els.compounding?.value || 'quarterly';
    const payout = els.payout?.value || 'cumulative';
    const taxSlab = Math.max(0, Number(els.taxSlab?.value) || 0);
    const inflationRate = Math.max(0, Number(els.inflationRate?.value) || 0);
    let investmentDate = els.investmentDate?.value ? new Date(`${els.investmentDate.value}T00:00:00`) : new Date();
    if (Number.isNaN(investmentDate.getTime())) investmentDate = new Date();

    const maturityDate = addTenure(investmentDate, tenureValue, tenureUnit);
    const totalDays = Math.max(1, daysBetween(investmentDate, maturityDate));
    const years = totalDays / 365;

    return { amount, baseRate, senior, seniorBonus, effectiveRate, tenureValue, tenureUnit, compounding, payout, taxSlab, inflationRate, investmentDate, maturityDate, totalDays, years };
  };

  /* ---------------- withdrawal simulator ---------------- */

  const renderWithdrawal = (inputs, result) => {
    const enabled = !!els.withdrawEnable?.checked;
    if (els.withdrawFields) els.withdrawFields.hidden = !enabled;
    if (els.withdrawSummary) els.withdrawSummary.hidden = !enabled;
    if (!enabled) return;

    const maxDays = Math.max(1, inputs.totalDays - 1);
    let heldDays = Math.min(maxDays, Math.max(1, Number(els.withdrawDays?.value) || Math.round(inputs.totalDays / 2)));
    if (els.withdrawDays) els.withdrawDays.max = String(maxDays);
    const penalty = Math.max(0, Number(els.withdrawPenalty?.value) || 0);
    const reducedRate = Math.max(0, inputs.effectiveRate - penalty);
    const heldYears = heldDays / 365;

    const early = computeFD({ principal: inputs.amount, effectiveRate: reducedRate, years: heldYears, compounding: inputs.compounding, payout: 'cumulative' });
    const lost = result.interest - early.interest;

    if (els.withdrawMaturity) els.withdrawMaturity.textContent = formatCurrency(early.maturity);
    if (els.withdrawInterest) els.withdrawInterest.textContent = formatCurrency(early.interest);
    if (els.withdrawLost) els.withdrawLost.textContent = formatCurrency(Math.max(0, lost));
  };

  /* ---------------- main render ---------------- */

  const calculate = () => {
    const inputs = getInputs();
    const result = computeFD({ principal: inputs.amount, effectiveRate: inputs.effectiveRate, years: inputs.years, compounding: inputs.compounding, payout: inputs.payout });
    const apy = effectiveAnnualYield(inputs.effectiveRate, inputs.compounding, inputs.payout);
    const monthlyEquivalent = Math.pow(1 + apy, 1 / 12) - 1;
    const postTaxInterest = result.interest * (1 - inputs.taxSlab / 100);
    const realRate = ((1 + apy) / (1 + inputs.inflationRate / 100)) - 1;
    const realMaturityValue = result.maturity / Math.pow(1 + inputs.inflationRate / 100, inputs.years);

    const tdsThreshold = inputs.senior ? 50000 : 40000;
    const avgAnnualInterest = inputs.years > 0 ? result.interest / inputs.years : 0;
    const tdsApplicable = avgAnnualInterest > tdsThreshold;
    const estimatedTds = tdsApplicable ? result.interest * 0.1 : 0;

    const schedule = buildSchedule({ principal: inputs.amount, effectiveRate: inputs.effectiveRate, years: inputs.years, compounding: inputs.compounding, payout: inputs.payout });
    lastResult = result;
    lastSchedule = schedule;

    if (els.resultMaturity) els.resultMaturity.textContent = formatCurrency(result.maturity);
    if (els.resultInterest) els.resultInterest.textContent = formatCurrency(result.interest);
    if (els.resultInvestment) els.resultInvestment.textContent = formatCurrency(inputs.amount);
    if (els.resultEffectiveYield) els.resultEffectiveYield.textContent = formatPercent(apy * 100);
    if (els.resultAnnualReturn) els.resultAnnualReturn.textContent = formatPercent(inputs.effectiveRate);
    if (els.resultMonthlyEquivalent) els.resultMonthlyEquivalent.textContent = formatPercent(monthlyEquivalent * 100);
    if (els.resultPostTax) els.resultPostTax.textContent = formatCurrency(inputs.amount + postTaxInterest);
    if (els.resultRealReturn) els.resultRealReturn.textContent = `${formatCurrency(realMaturityValue)} (${realRate >= 0 ? '+' : ''}${formatPercent(realRate * 100)})`;
    if (els.resultMaturityDate) els.resultMaturityDate.textContent = formatDate(inputs.maturityDate);
    if (els.resultDuration) els.resultDuration.textContent = formatDuration(inputs.investmentDate, inputs.maturityDate);
    if (els.resultTds) els.resultTds.textContent = tdsApplicable ? `${formatCurrency(estimatedTds)} (avg. ₹${Math.round(avgAnnualInterest).toLocaleString('en-IN')}/yr interest exceeds the ₹${tdsThreshold.toLocaleString('en-IN')} threshold)` : `Not applicable (avg. annual interest is under the ₹${tdsThreshold.toLocaleString('en-IN')} threshold)`;

    const total = inputs.amount + result.interest;
    const principalPct = total > 0 ? (inputs.amount / total) * 100 : 100;
    const interestPct = 100 - principalPct;
    if (els.barPrincipal) els.barPrincipal.style.width = `${principalPct}%`;
    if (els.barInterest) els.barInterest.style.width = `${interestPct}%`;
    if (els.resultPrincipalPct) els.resultPrincipalPct.textContent = `${principalPct.toFixed(1)}%`;
    if (els.resultInterestPct) els.resultInterestPct.textContent = `${interestPct.toFixed(1)}%`;

    if (els.compoundingLabel) els.compoundingLabel.textContent = inputs.payout === 'noncumulative' ? 'Payout Frequency' : 'Compounding Frequency';

    renderChart(inputs.amount, result.interest, schedule);
    renderSchedule(schedule, inputs.payout);
    renderWithdrawal(inputs, result);

    if (els.stickyMaturity) els.stickyMaturity.textContent = formatCurrency(result.maturity);
    announce(`Maturity amount ${formatCurrency(result.maturity)}, interest earned ${formatCurrency(result.interest)}.`);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        amount: inputs.amount, rate: inputs.baseRate, senior: inputs.senior, seniorBonus: Number(els.seniorBonus?.value) || 0.5,
        tenureValue: inputs.tenureValue, tenureUnit: inputs.tenureUnit, compounding: inputs.compounding, payout: inputs.payout,
        taxSlab: inputs.taxSlab, inflationRate: inputs.inflationRate,
      }));
    } catch (e) { /* storage unavailable */ }

    return { inputs, result };
  };

  const announce = (msg) => { if (els.srStatus) els.srStatus.textContent = msg; };

  /* ---------------- presets ---------------- */

  const applyPreset = (key) => {
    const preset = FD_PRESETS[key];
    if (!preset) return;
    if (els.amount) els.amount.value = preset.amount;
    if (els.rate) els.rate.value = preset.rate;
    if (els.tenureValue) els.tenureValue.value = preset.tenureValue;
    if (els.tenureUnit) els.tenureUnit.value = preset.tenureUnit;
    if (els.compounding) els.compounding.value = preset.compounding;
    if (els.payout) els.payout.value = preset.payout;
    if (els.seniorToggle) els.seniorToggle.checked = preset.senior;
    if (els.seniorBonusRow) els.seniorBonusRow.hidden = !preset.senior;
    syncSliders();
  };

  /* ---------------- sliders ---------------- */

  const syncSliders = () => {
    if (els.amount && els.amountRange) els.amountRange.value = els.amount.value;
    if (els.rate && els.rateRange) els.rateRange.value = els.rate.value;
    if (els.tenureValue && els.tenureRange) {
      const unit = els.tenureUnit?.value || 'years';
      els.tenureRange.max = unit === 'years' ? '30' : unit === 'months' ? '360' : '3650';
      els.tenureRange.value = els.tenureValue.value;
    }
  };

  let rafPending = false;
  const scheduleRender = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      calculate();
    });
  };

  const bindPair = (numberEl, rangeEl) => {
    if (!numberEl || !rangeEl) return;
    numberEl.addEventListener('input', () => { rangeEl.value = numberEl.value; scheduleRender(); });
    rangeEl.addEventListener('input', () => { numberEl.value = rangeEl.value; scheduleRender(); });
  };

  /* ---------------- copy / share / print ---------------- */

  const buildResultText = () => {
    const inputs = getInputs();
    if (!lastResult) return '';
    return [
      'Fixed Deposit Calculator — ToolAdda',
      `Deposit Amount: ${formatCurrency(inputs.amount)}`,
      `Interest Rate: ${formatPercent(inputs.effectiveRate)}${inputs.senior ? ' (incl. senior citizen bonus)' : ''}`,
      `Tenure: ${inputs.tenureValue} ${inputs.tenureUnit} (${formatDuration(inputs.investmentDate, inputs.maturityDate)})`,
      `Compounding: ${FREQ_LABEL[inputs.compounding]}`,
      `Payout: ${inputs.payout === 'noncumulative' ? 'Non-cumulative (periodic payout)' : 'Cumulative (reinvested)'}`,
      `Maturity Amount: ${els.resultMaturity?.textContent || '—'}`,
      `Total Interest: ${els.resultInterest?.textContent || '—'}`,
      `Maturity Date: ${els.resultMaturityDate?.textContent || '—'}`,
      `Effective Annual Yield: ${els.resultEffectiveYield?.textContent || '—'}`,
    ].join('\n');
  };

  const copyResult = async () => {
    const text = buildResultText();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      announce('Result copied to clipboard.');
    } catch (e) { announce('Copy failed — please try again.'); }
  };

  const shareResult = async () => {
    const text = buildResultText();
    if (!text) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'FD Calculator result — ToolAdda', text }); } catch (e) { /* user cancelled */ }
    } else {
      copyResult();
    }
  };

  /* ---------------- persistence ---------------- */

  const loadSaved = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      if (els.amount && saved.amount != null) els.amount.value = saved.amount;
      if (els.rate && saved.rate != null) els.rate.value = saved.rate;
      if (els.seniorToggle && saved.senior != null) els.seniorToggle.checked = saved.senior;
      if (els.seniorBonus && saved.seniorBonus != null) els.seniorBonus.value = saved.seniorBonus;
      if (els.seniorBonusRow) els.seniorBonusRow.hidden = !saved.senior;
      if (els.tenureValue && saved.tenureValue != null) els.tenureValue.value = saved.tenureValue;
      if (els.tenureUnit && saved.tenureUnit != null) els.tenureUnit.value = saved.tenureUnit;
      if (els.compounding && saved.compounding != null) els.compounding.value = saved.compounding;
      if (els.payout && saved.payout != null) els.payout.value = saved.payout;
      if (els.taxSlab && saved.taxSlab != null) els.taxSlab.value = saved.taxSlab;
      if (els.inflationRate && saved.inflationRate != null) els.inflationRate.value = saved.inflationRate;
    } catch (e) { /* ignore invalid storage */ }
  };

  /* ---------------- init ---------------- */

  const init = () => {
    if (els.investmentDate && !els.investmentDate.value) {
      els.investmentDate.value = toLocalDateInputValue(new Date());
    }

    els.chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        els.chips.forEach((c) => { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('is-active');
        chip.setAttribute('aria-pressed', 'true');
        applyPreset(chip.getAttribute('data-fd-preset'));
        scheduleRender();
      });
    });

    bindPair(els.amount, els.amountRange);
    bindPair(els.rate, els.rateRange);
    bindPair(els.tenureValue, els.tenureRange);

    [els.tenureUnit, els.compounding, els.payout, els.taxSlab, els.inflationRate, els.investmentDate, els.withdrawDays, els.withdrawPenalty].forEach((el) => {
      el?.addEventListener('input', () => { syncSliders(); scheduleRender(); });
      el?.addEventListener('change', () => { syncSliders(); scheduleRender(); });
    });

    els.seniorToggle?.addEventListener('change', () => {
      if (els.seniorBonusRow) els.seniorBonusRow.hidden = !els.seniorToggle.checked;
      scheduleRender();
    });
    els.seniorBonus?.addEventListener('input', scheduleRender);

    els.withdrawEnable?.addEventListener('change', scheduleRender);

    els.chartTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        els.chartTabs.forEach((t) => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
        activeChart = tab.getAttribute('data-fd-chart-tab');
        if (lastResult) renderChart(getInputs().amount, lastResult.interest, lastSchedule);
      });
    });

    els.resetBtn?.addEventListener('click', () => {
      applyPreset('bank');
      if (els.seniorToggle) els.seniorToggle.checked = false;
      if (els.seniorBonusRow) els.seniorBonusRow.hidden = true;
      if (els.taxSlab) els.taxSlab.value = '20';
      if (els.inflationRate) els.inflationRate.value = '6';
      if (els.withdrawEnable) els.withdrawEnable.checked = false;
      scheduleRender();
      announce('Calculator reset to defaults.');
    });
    els.copyBtn?.addEventListener('click', copyResult);
    els.printBtn?.addEventListener('click', () => window.print());
    els.shareBtn?.addEventListener('click', shareResult);
    els.stickyBtn?.addEventListener('click', () => {
      document.getElementById('fd-calculator-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      els.amount?.focus();
    });

    window.addEventListener('resize', () => { if (lastResult) renderChart(getInputs().amount, lastResult.interest, lastSchedule); });

    loadSaved();
    syncSliders();
    calculate();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
