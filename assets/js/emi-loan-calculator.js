(function () {
  const page = document.querySelector('[data-loan-calc-page]');
  if (!page) return;

  const config = {
    storageKey: page.dataset.storageKey || 'tooladda-loan-calc',
    defaultPrice: Number(page.dataset.defaultPrice) || 1000000,
    defaultDown: Number(page.dataset.defaultDown) || 200000,
    defaultRate: Number(page.dataset.defaultRate) || 9,
    defaultTenure: Number(page.dataset.defaultTenure) || 5,
    maxTenure: Number(page.dataset.maxTenure) || 30,
    loanName: page.dataset.loanName || 'Loan',
  };

  const els = {
    price: document.getElementById('loanCalcPrice'),
    downPayment: document.getElementById('loanCalcDownPayment'),
    interestRate: document.getElementById('loanCalcInterestRate'),
    tenureYears: document.getElementById('loanCalcTenureYears'),
    processingFee: document.getElementById('loanCalcProcessingFee'),
    loanAmount: document.getElementById('loanCalcLoanAmount'),
    emiValue: document.getElementById('loanCalcEmi'),
    interestValue: document.getElementById('loanCalcTotalInterest'),
    paymentValue: document.getElementById('loanCalcTotalPayment'),
    summaryLoan: document.getElementById('loanCalcSummaryLoan'),
    summaryRate: document.getElementById('loanCalcSummaryRate'),
    summaryTenure: document.getElementById('loanCalcSummaryTenure'),
    breakdownBody: document.getElementById('loanCalcBreakdownBody'),
    chart: document.getElementById('loanCalcChart'),
    copyBtn: document.getElementById('loanCalcCopyBtn'),
    resetBtn: document.getElementById('loanCalcResetBtn'),
    toast: document.getElementById('loanCalcToast'),
    warn: document.getElementById('loanCalcWarn'),
    downShare: document.getElementById('loanCalcDownShare'),
    sticky: document.getElementById('loanCalcSticky'),
    stickyEmi: document.getElementById('loanCalcStickyEmi'),
    stickyBtn: document.getElementById('loanCalcStickyBtn'),
    results: page.querySelector('.loan-calc-results'),
    layout: page.querySelector('.loan-calc-layout'),
  };
  const picks = Array.from(page.querySelectorAll('[data-loan-pick]'));
  const downPicks = Array.from(page.querySelectorAll('[data-loan-down-pct]'));

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

  const calculateEmi = (principal, annualRate, months) => {
    if (principal <= 0 || months <= 0) {
      return { emi: 0, totalInterest: 0, totalPayment: 0, schedule: [] };
    }
    const monthlyRate = annualRate / 100 / 12;
    let emi = monthlyRate > 0
      ? (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : principal / months;

    let balance = principal;
    const schedule = [];
    let totalInterest = 0;

    for (let month = 1; month <= months; month += 1) {
      const interest = balance * monthlyRate;
      let principalPortion = emi - interest;
      if (month === months) {
        principalPortion = balance;
        emi = interest + principalPortion;
      }
      balance = Math.max(balance - principalPortion, 0);
      totalInterest += interest;
      schedule.push({ month, emi, principalPortion, interest, balance });
    }

    return {
      emi: schedule[0]?.emi || emi,
      totalInterest,
      totalPayment: principal + totalInterest,
      schedule,
    };
  };

  const drawChart = (principal, interest) => {
    const canvas = els.chart;
    if (!canvas) return;
    // Draw at device resolution so the pie stays sharp on phones and retina screens.
    const size = 240;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
      canvas.style.width = `${size}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = size;
    const height = size;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 18;

    ctx.clearRect(0, 0, width, height);
    const total = principal + interest;
    if (total <= 0) return;

    const slices = [
      { value: principal, color: '#4f46e5' },
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
      els.breakdownBody.innerHTML = '<tr><td colspan="5">Enter values to see EMI schedule.</td></tr>';
      return;
    }
    els.breakdownBody.innerHTML = schedule
      .map(
        (row) => `
      <tr>
        <td>${row.month}</td>
        <td>${formatCurrencyDetailed(row.emi)}</td>
        <td>${formatCurrencyDetailed(row.principalPortion)}</td>
        <td>${formatCurrencyDetailed(row.interest)}</td>
        <td>${formatCurrencyDetailed(row.balance)}</td>
      </tr>`
      )
      .join('');
  };

  const getInputs = () => {
    const price = Math.max(0, Number(els.price?.value) || 0);
    const downPayment = Math.max(0, Math.min(price, Number(els.downPayment?.value) || 0));
    const interestRate = Math.max(0, Number(els.interestRate?.value) || 0);
    const tenureYears = clampTenure(els.tenureYears?.value);
    const processingFee = Math.max(0, Number(els.processingFee?.value) || 0);
    const principal = Math.max(0, price - downPayment);
    const months = tenureYears * 12;
    return { price, downPayment, interestRate, tenureYears, processingFee, principal, months };
  };

  const clampTenure = (value) =>
    Math.max(1, Math.min(config.maxTenure, Math.round(Number(value) || config.defaultTenure)));

  const setWarning = (message, field) => {
    [els.price, els.downPayment, els.tenureYears].forEach((input) => input?.removeAttribute('aria-invalid'));
    if (!els.warn) return;
    els.warn.textContent = message || '';
    els.warn.hidden = !message;
    if (message && field) field.setAttribute('aria-invalid', 'true');
  };

  const updateWarning = (price) => {
    const rawDown = Number(els.downPayment?.value) || 0;
    const rawTenure = Number(els.tenureYears?.value);
    if (els.price?.value !== '' && price <= 0) {
      setWarning(`Enter the ${config.loanName.toLowerCase()} price to see your EMI.`, els.price);
    } else if (price > 0 && rawDown >= price) {
      setWarning('Your down payment covers the full price, so there is no loan to repay.', els.downPayment);
    } else if (els.tenureYears?.value !== '' && rawTenure > config.maxTenure) {
      setWarning(`This calculator goes up to ${config.maxTenure} years, so the results use ${config.maxTenure}.`, els.tenureYears);
    } else if (els.tenureYears?.value !== '' && rawTenure < 1) {
      setWarning('The shortest tenure is 1 year, so the results use 1.', els.tenureYears);
    } else {
      setWarning('');
    }
  };

  const syncPicks = (price, downPayment) => {
    picks.forEach((chip) => {
      const input = els[chip.dataset.loanPick];
      const on = !!input && input.value !== '' && Number(input.value) === Number(chip.dataset.value);
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
    const share = price > 0 ? (downPayment / price) * 100 : 0;
    downPicks.forEach((chip) => {
      const on = price > 0 && Math.abs(share - Number(chip.dataset.loanDownPct)) < 0.05;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
    if (els.downShare) {
      els.downShare.textContent = price > 0 && downPayment > 0
        ? `${share.toFixed(share % 1 ? 1 : 0)}% of the price — you borrow ${formatCurrency(Math.max(0, price - downPayment))}`
        : '';
    }
  };

  const calculate = () => {
    const { downPayment, interestRate, tenureYears, processingFee, principal, months, price } = getInputs();
    updateWarning(price);
    syncPicks(price, downPayment);

    const result = calculateEmi(principal, interestRate, months);
    const totalWithFee = result.totalPayment + processingFee;

    if (els.loanAmount) els.loanAmount.textContent = formatCurrency(principal);
    if (els.emiValue) els.emiValue.textContent = formatCurrency(result.emi);
    if (els.stickyEmi) els.stickyEmi.textContent = formatCurrency(result.emi);
    if (els.interestValue) els.interestValue.textContent = formatCurrency(result.totalInterest);
    if (els.paymentValue) els.paymentValue.textContent = formatCurrency(totalWithFee);
    if (els.summaryLoan) els.summaryLoan.textContent = formatCurrency(principal);
    if (els.summaryRate) els.summaryRate.textContent = `${interestRate.toFixed(2)}% p.a.`;
    if (els.summaryTenure) els.summaryTenure.textContent = `${tenureYears} years (${months} months)`;

    drawChart(principal, result.totalInterest);
    renderBreakdown(result.schedule);

    try {
      localStorage.setItem(
        config.storageKey,
        JSON.stringify({ price, downPayment, interestRate, tenureYears, processingFee })
      );
    } catch (error) {
      /* ignore storage errors */
    }

    return result;
  };

  const resetAll = () => {
    if (els.price) els.price.value = String(config.defaultPrice);
    if (els.downPayment) els.downPayment.value = String(config.defaultDown);
    if (els.interestRate) els.interestRate.value = String(config.defaultRate);
    if (els.tenureYears) els.tenureYears.value = String(config.defaultTenure);
    if (els.processingFee) els.processingFee.value = '0';
    calculate();
    showToast('Calculator reset');
  };

  const copyResult = async () => {
    const { tenureYears, processingFee } = getInputs();
    const text = [
      `${config.loanName} Calculator Result`,
      `Loan Amount: ${els.loanAmount?.textContent || '—'}`,
      `Interest Rate: ${els.summaryRate?.textContent || '—'}`,
      `Tenure: ${tenureYears} years`,
      `Monthly EMI: ${els.emiValue?.textContent || '—'}`,
      `Total Interest: ${els.interestValue?.textContent || '—'}`,
      `Total Payment: ${els.paymentValue?.textContent || '—'}`,
      processingFee > 0 ? `Processing Fee: ${formatCurrency(processingFee)}` : null,
    ]
      .filter(Boolean)
      .join('\n');

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
      const saved = JSON.parse(localStorage.getItem(config.storageKey) || 'null');
      if (!saved) return;
      if (els.price && saved.price != null) els.price.value = saved.price;
      if (els.downPayment && saved.downPayment != null) els.downPayment.value = saved.downPayment;
      if (els.interestRate && saved.interestRate != null) els.interestRate.value = saved.interestRate;
      if (els.tenureYears && saved.tenureYears != null) els.tenureYears.value = saved.tenureYears;
      if (els.processingFee && saved.processingFee != null) els.processingFee.value = saved.processingFee;
    } catch (error) {
      /* ignore invalid storage */
    }
  };

  [els.price, els.downPayment, els.interestRate, els.tenureYears, els.processingFee].forEach((input) => {
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
      const input = els[chip.dataset.loanPick];
      if (!input) return;
      input.value = chip.dataset.value;
      calculate();
    });
  });
  downPicks.forEach((chip) => {
    chip.addEventListener('click', () => {
      const price = Math.max(0, Number(els.price?.value) || 0);
      if (!price || !els.downPayment) { els.price?.focus(); return; }
      els.downPayment.value = String(Math.round((price * Number(chip.dataset.loanDownPct)) / 100));
      calculate();
    });
  });

  els.copyBtn?.addEventListener('click', copyResult);
  els.resetBtn?.addEventListener('click', resetAll);

  // Redraw the pie with the right border colour when the theme flips.
  new MutationObserver(() => {
    const { principal, interestRate, months } = getInputs();
    drawChart(principal, calculateEmi(principal, interestRate, months).totalInterest);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Sticky EMI bar: only while the calculator is on screen and the result cards are not.
  if (els.sticky && els.results && els.layout && 'IntersectionObserver' in window) {
    let layoutOn = false;
    let resultsOn = false;
    const update = () => els.sticky.classList.toggle('is-off', !(layoutOn && !resultsOn));
    els.sticky.classList.add('is-off');
    els.sticky.hidden = false;
    new IntersectionObserver((entries) => {
      resultsOn = entries[entries.length - 1].isIntersecting;
      update();
    }).observe(els.results);
    new IntersectionObserver((entries) => {
      layoutOn = entries[entries.length - 1].isIntersecting;
      update();
    }).observe(els.layout);
    els.stickyBtn?.addEventListener('click', () => {
      const target = els.results;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset - 90, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  loadSaved();
  calculate();
})();
