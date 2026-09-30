(function () {
  const page = document.querySelector('[data-ppf-page]');
  if (!page) return;

  const STORAGE_KEY = 'tooladda-ppf-last';

  const els = {
    yearlyInvestment: document.getElementById('ppfYearlyInvestment'),
    interestRate: document.getElementById('ppfInterestRate'),
    tenureYears: document.getElementById('ppfTenureYears'),
    depositTiming: document.getElementById('ppfDepositTiming'),
    maturityValue: document.getElementById('ppfMaturityValue'),
    investedValue: document.getElementById('ppfInvestedValue'),
    interestValue: document.getElementById('ppfInterestValue'),
    summaryRate: document.getElementById('ppfSummaryRate'),
    summaryTenure: document.getElementById('ppfSummaryTenure'),
    summaryDeposit: document.getElementById('ppfSummaryDeposit'),
    breakdownBody: document.getElementById('ppfBreakdownBody'),
    chart: document.getElementById('ppfChart'),
    copyBtn: document.getElementById('ppfCopyBtn'),
    resetBtn: document.getElementById('ppfResetBtn'),
    toast: document.getElementById('ppfToast'),
    warn: document.getElementById('ppfWarn'),
    sticky: document.getElementById('ppfSticky'),
    stickyMaturity: document.getElementById('ppfStickyMaturity'),
    stickyBtn: document.getElementById('ppfStickyBtn'),
    results: page.querySelector('.ppf-results'),
    layout: page.querySelector('.ppf-layout'),
  };

  const PPF_MIN_DEPOSIT = 500;
  const PPF_MAX_DEPOSIT = 150000;
  const PPF_MIN_YEARS = 15;
  const PPF_MAX_YEARS = 50;
  const picks = Array.from(page.querySelectorAll('[data-ppf-pick]'));

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);

  const formatCurrencyDetailed = (value) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value || 0);

  const showToast = (message) => {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
  };

  const calculatePPF = (yearlyInvestment, ratePercent, years, depositAtStart) => {
    let balance = 0;
    const schedule = [];
    const rate = ratePercent / 100;

    for (let year = 1; year <= years; year += 1) {
      const opening = balance;
      if (depositAtStart) balance += yearlyInvestment;
      const interest = balance * rate;
      balance += interest;
      if (!depositAtStart) balance += yearlyInvestment;
      schedule.push({ year, opening, deposit: yearlyInvestment, interest, closing: balance });
    }

    const totalInvested = yearlyInvestment * years;
    return {
      maturity: balance,
      totalInvested,
      totalInterest: balance - totalInvested,
      schedule,
    };
  };

  const CHART_SIZE = 240;

  const drawChart = (invested, interest) => {
    const canvas = els.chart;
    if (!canvas) return;
    // Draw at device resolution so the pie stays sharp on phones and retina screens.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.round(CHART_SIZE * dpr);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
      canvas.style.width = `${CHART_SIZE}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = CHART_SIZE;
    const height = CHART_SIZE;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 18;

    ctx.clearRect(0, 0, width, height);
    const total = invested + interest;
    if (total <= 0) return;

    const slices = [
      { value: invested, color: '#4f46e5' },
      { value: interest, color: '#16a34a' },
    ];

    let startAngle = -Math.PI / 2;
    slices.forEach((slice) => {
      const sliceAngle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      startAngle += sliceAngle;
    });

    ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#0f172a' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
  };

  const renderBreakdown = (schedule) => {
    if (!els.breakdownBody) return;
    if (!schedule.length) {
      els.breakdownBody.innerHTML = '<tr><td colspan="5">Enter values to see year-wise breakdown.</td></tr>';
      return;
    }
    els.breakdownBody.innerHTML = schedule
      .map(
        (row) => `
      <tr>
        <td>${row.year}</td>
        <td>${formatCurrencyDetailed(row.opening)}</td>
        <td>${formatCurrencyDetailed(row.deposit)}</td>
        <td>${formatCurrencyDetailed(row.interest)}</td>
        <td>${formatCurrencyDetailed(row.closing)}</td>
      </tr>`
      )
      .join('');
  };

  const clampTenure = (value) =>
    Math.max(PPF_MIN_YEARS, Math.min(PPF_MAX_YEARS, Math.round(Number(value) || PPF_MIN_YEARS)));

  // PPF refuses deposits above the yearly limit, so the maths uses the capped amount.
  const getInputs = () => {
    const entered = Math.max(0, Number(els.yearlyInvestment?.value) || 0);
    return {
      enteredInvestment: entered,
      yearlyInvestment: Math.min(entered, PPF_MAX_DEPOSIT),
      interestRate: Math.min(20, Math.max(0, Number(els.interestRate?.value) || 0)),
      tenureYears: clampTenure(els.tenureYears?.value),
      depositAtStart: els.depositTiming?.value !== 'end',
    };
  };

  const setWarning = (message, field) => {
    [els.yearlyInvestment, els.tenureYears].forEach((input) => input?.removeAttribute('aria-invalid'));
    if (!els.warn) return;
    els.warn.textContent = message || '';
    els.warn.hidden = !message;
    if (message && field) field.setAttribute('aria-invalid', 'true');
  };

  const updateWarning = ({ enteredInvestment }) => {
    const rawTenure = Number(els.tenureYears?.value);
    if (enteredInvestment > PPF_MAX_DEPOSIT) {
      setWarning(`PPF accepts at most ${formatCurrency(PPF_MAX_DEPOSIT)} a year, so the results use ${formatCurrency(PPF_MAX_DEPOSIT)}.`, els.yearlyInvestment);
    } else if (enteredInvestment > 0 && enteredInvestment < PPF_MIN_DEPOSIT) {
      setWarning(`The minimum PPF deposit is ${formatCurrency(PPF_MIN_DEPOSIT)} a year.`, els.yearlyInvestment);
    } else if (els.tenureYears?.value !== '' && rawTenure < PPF_MIN_YEARS) {
      setWarning(`PPF runs for at least ${PPF_MIN_YEARS} years, so the results use ${PPF_MIN_YEARS}.`, els.tenureYears);
    } else if (rawTenure > PPF_MAX_YEARS) {
      setWarning(`This calculator goes up to ${PPF_MAX_YEARS} years, so the results use ${PPF_MAX_YEARS}.`, els.tenureYears);
    } else {
      setWarning('');
    }
  };

  const syncPicks = () => {
    picks.forEach((chip) => {
      const input = els[chip.dataset.ppfPick];
      const active = !!input && Number(input.value) === Number(chip.dataset.value) && input.value !== '';
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  };

  const calculate = () => {
    const inputs = getInputs();
    const { yearlyInvestment, interestRate, tenureYears, depositAtStart } = inputs;
    updateWarning(inputs);
    syncPicks();

    const result = calculatePPF(yearlyInvestment, interestRate, tenureYears, depositAtStart);

    if (els.maturityValue) els.maturityValue.textContent = formatCurrency(result.maturity);
    if (els.stickyMaturity) els.stickyMaturity.textContent = formatCurrency(result.maturity);
    if (els.investedValue) els.investedValue.textContent = formatCurrency(result.totalInvested);
    if (els.interestValue) els.interestValue.textContent = formatCurrency(result.totalInterest);
    if (els.summaryRate) els.summaryRate.textContent = `${interestRate.toFixed(2)}% p.a.`;
    if (els.summaryTenure) els.summaryTenure.textContent = `${tenureYears} years`;
    if (els.summaryDeposit) els.summaryDeposit.textContent = formatCurrency(yearlyInvestment);

    drawChart(result.totalInvested, result.totalInterest);
    renderBreakdown(result.schedule);

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ yearlyInvestment, interestRate, tenureYears, depositAtStart: els.depositTiming?.value })
      );
    } catch (error) {
      /* ignore storage errors */
    }

    return result;
  };

  const resetAll = () => {
    if (els.yearlyInvestment) els.yearlyInvestment.value = '150000';
    if (els.interestRate) els.interestRate.value = '7.1';
    if (els.tenureYears) els.tenureYears.value = '15';
    if (els.depositTiming) els.depositTiming.value = 'start';
    calculate();
    showToast('Calculator reset');
  };

  const copyResult = async () => {
    const { yearlyInvestment, interestRate, tenureYears } = getInputs();
    const text = [
      'PPF Calculator Result',
      `Yearly Investment: ${formatCurrency(yearlyInvestment)}`,
      `Interest Rate: ${interestRate}% p.a.`,
      `Tenure: ${tenureYears} years`,
      `Total Invested: ${els.investedValue?.textContent || '—'}`,
      `Total Interest: ${els.interestValue?.textContent || '—'}`,
      `Maturity Amount: ${els.maturityValue?.textContent || '—'}`,
    ].join('\n');

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
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
      showToast('Result copied to clipboard');
    } catch (error) {
      showToast('Copy failed — please try again');
    }
  };

  const loadSaved = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      if (els.yearlyInvestment && saved.yearlyInvestment != null) els.yearlyInvestment.value = saved.yearlyInvestment;
      if (els.interestRate && saved.interestRate != null) els.interestRate.value = saved.interestRate;
      if (els.tenureYears && saved.tenureYears != null) els.tenureYears.value = saved.tenureYears;
      if (els.depositTiming && saved.depositAtStart != null) {
        els.depositTiming.value = saved.depositAtStart === 'end' ? 'end' : 'start';
      }
    } catch (error) {
      /* ignore invalid storage */
    }
  };

  [els.yearlyInvestment, els.interestRate, els.tenureYears, els.depositTiming].forEach((input) => {
    input?.addEventListener('input', calculate);
    input?.addEventListener('change', calculate);
  });

  // Tidy the tenure box only once the user leaves it, never mid-typing.
  els.tenureYears?.addEventListener('blur', () => {
    const tidy = String(clampTenure(els.tenureYears.value));
    if (els.tenureYears.value !== tidy) {
      els.tenureYears.value = tidy;
      calculate();
    }
  });

  picks.forEach((chip) => {
    chip.addEventListener('click', () => {
      const input = els[chip.dataset.ppfPick];
      if (!input) return;
      input.value = chip.dataset.value;
      calculate();
    });
  });

  // Redraw the pie with the right border colour when the theme flips.
  new MutationObserver(() => {
    const { yearlyInvestment, interestRate, tenureYears, depositAtStart } = getInputs();
    const r = calculatePPF(yearlyInvestment, interestRate, tenureYears, depositAtStart);
    drawChart(r.totalInvested, r.totalInterest);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  els.copyBtn?.addEventListener('click', copyResult);
  els.resetBtn?.addEventListener('click', resetAll);

  // Sticky result bar: only while the calculator is on screen and the result cards are not.
  if (els.sticky && els.results && els.layout && 'IntersectionObserver' in window) {
    let layoutOn = false;
    let resultsOn = false;
    const update = () => els.sticky.classList.toggle('is-off', !(layoutOn && !resultsOn));
    els.sticky.classList.add('is-off');
    els.sticky.hidden = false;
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === els.results) resultsOn = entry.isIntersecting;
        else layoutOn = entry.isIntersecting;
      });
      update();
    }).observe(els.results);
    new IntersectionObserver((entries) => {
      layoutOn = entries[entries.length - 1].isIntersecting;
      update();
    }).observe(els.layout);
    els.stickyBtn?.addEventListener('click', () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const y = els.results.getBoundingClientRect().top + window.pageYOffset - 90;
      window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  loadSaved();
  calculate();
})();
