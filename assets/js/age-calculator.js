/**
 * ToolAdda Age Calculator — client-side age, difference, pet, and eligibility engine.
 */
(function () {
  'use strict';

  const MS_DAY = 86400000;
  const MS_HOUR = 3600000;
  const MS_MIN = 60000;
  const MS_SEC = 1000;

  const ZODIAC = [
    { sign: 'Capricorn', symbol: '♑', start: [12, 22], end: [1, 19] },
    { sign: 'Aquarius', symbol: '♒', start: [1, 20], end: [2, 18] },
    { sign: 'Pisces', symbol: '♓', start: [2, 19], end: [3, 20] },
    { sign: 'Aries', symbol: '♈', start: [3, 21], end: [4, 19] },
    { sign: 'Taurus', symbol: '♉', start: [4, 20], end: [5, 20] },
    { sign: 'Gemini', symbol: '♊', start: [5, 21], end: [6, 20] },
    { sign: 'Cancer', symbol: '♋', start: [6, 21], end: [7, 22] },
    { sign: 'Leo', symbol: '♌', start: [7, 23], end: [8, 22] },
    { sign: 'Virgo', symbol: '♍', start: [8, 23], end: [9, 22] },
    { sign: 'Libra', symbol: '♎', start: [9, 23], end: [10, 22] },
    { sign: 'Scorpio', symbol: '♏', start: [10, 23], end: [11, 21] },
    { sign: 'Sagittarius', symbol: '♐', start: [11, 22], end: [12, 21] }
  ];

  const CHINESE = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let liveTimer = null;

  function parseDateInput(value, timeValue) {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    if (timeValue) {
      const [hh, mm] = timeValue.split(':').map(Number);
      date.setHours(hh || 0, mm || 0, 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  // Whole months are counted to the last "monthiversary" on or before `to`;
  // a birth day the month lacks rolls over the way Date does (31 Jan + 1
  // month = 3 Mar, 29 Feb + 1 year = 1 Mar), matching nextBirthday(). The
  // old borrow-a-month version went negative there (31 Jan -> 1 Mar gave
  // "1 month, -2 days") and agrees with this one everywhere else.
  function diffYMD(from, to) {
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    const at = (k) => new Date(from.getFullYear(), from.getMonth() + k, from.getDate());
    let months = (end.getFullYear() - from.getFullYear()) * 12 + (end.getMonth() - from.getMonth());
    while (months > 0 && at(months) > end) months -= 1;
    const days = Math.round((end - at(months)) / MS_DAY);
    return { years: Math.floor(months / 12), months: months % 12, days };
  }

  function formatDate(date, opts) {
    return new Intl.DateTimeFormat('en', opts || { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  }

  function formatDateShort(date) {
    return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function getWesternZodiac(month, day) {
    const md = month * 100 + day;
    for (const z of ZODIAC) {
      const [sm, sd] = z.start;
      const [em, ed] = z.end;
      const start = sm * 100 + sd;
      const end = em * 100 + ed;
      if (start > end) {
        if (md >= start || md <= end) return z;
      } else if (md >= start && md <= end) {
        return z;
      }
    }
    return ZODIAC[0];
  }

  function getChineseZodiac(year) {
    return CHINESE[(year - 4) % 12];
  }

  function nextBirthday(birth, from) {
    let next = new Date(from.getFullYear(), birth.getMonth(), birth.getDate());
    next.setHours(birth.getHours(), birth.getMinutes(), birth.getSeconds(), 0);
    if (next <= from) {
      next = new Date(from.getFullYear() + 1, birth.getMonth(), birth.getDate());
      next.setHours(birth.getHours(), birth.getMinutes(), birth.getSeconds(), 0);
    }
    const ms = next - from;
    const daysUntil = Math.ceil(ms / MS_DAY);
    return { date: next, daysUntil, weekday: WEEKDAYS[next.getDay()] };
  }

  function computeAge(birth, target, includeTime) {
    if (!birth || !target || target < birth) return null;

    const ymd = diffYMD(birth, target);
    const totalMs = target - birth;
    const totalDays = Math.floor(totalMs / MS_DAY);
    const totalWeeks = Math.floor(totalDays / 7);
    const totalMonths = ymd.years * 12 + ymd.months;
    const totalHours = Math.floor(totalMs / MS_HOUR);
    const totalMinutes = Math.floor(totalMs / MS_MIN);
    const totalSeconds = Math.floor(totalMs / MS_SEC);

    const remainderMs = totalMs % MS_DAY;
    const hours = Math.floor(remainderMs / MS_HOUR);
    const minutes = Math.floor((remainderMs % MS_HOUR) / MS_MIN);
    const seconds = Math.floor((remainderMs % MS_MIN) / MS_SEC);

    const zodiac = getWesternZodiac(birth.getMonth() + 1, birth.getDate());
    const chinese = getChineseZodiac(birth.getFullYear());
    const bornWeekday = WEEKDAYS[birth.getDay()];
    const nb = nextBirthday(birth, target);

    const milestones = buildMilestones(totalDays, totalSeconds, ymd.years, birth);

    return {
      ymd,
      hours: includeTime ? hours : 0,
      minutes: includeTime ? minutes : 0,
      seconds: includeTime ? seconds : 0,
      totalDays,
      totalWeeks,
      totalMonths,
      totalHours,
      totalMinutes,
      totalSeconds,
      totalMs,
      zodiac,
      chinese,
      bornWeekday,
      nextBirthday: nb,
      milestones,
      birthFormatted: formatDate(birth),
      targetFormatted: formatDate(target),
      birth,
      target
    };
  }

  function buildMilestones(totalDays, totalSeconds, years, birth) {
    const list = [];
    const targets = [
      { label: '10,000 days lived', value: 10000, unit: 'days', current: totalDays },
      { label: '20,000 days lived', value: 20000, unit: 'days', current: totalDays },
      { label: '100 million seconds', value: 100000000, unit: 'seconds', current: totalSeconds },
      { label: '1 billion seconds', value: 1000000000, unit: 'seconds', current: totalSeconds }
    ];

    targets.forEach((t) => {
      const reached = t.current >= t.value;
      const remaining = reached ? 0 : t.value - t.current;
      list.push({ ...t, reached, remaining });
    });

    const retirementAge = 60;
    const yearsToRetirement = Math.max(0, retirementAge - years);
    list.push({
      label: 'Estimated retirement (age 60)',
      value: retirementAge,
      unit: 'years',
      current: years,
      reached: years >= retirementAge,
      remaining: yearsToRetirement,
      note: 'Common benchmark; actual retirement age varies by country and profession.'
    });

    const schoolAges = [
      { label: 'Primary school (age 6+)', age: 6 },
      { label: 'Secondary school (age 11+)', age: 11 },
      { label: 'Higher secondary (age 16+)', age: 16 },
      { label: 'Voting age (18+)', age: 18 }
    ];
    schoolAges.forEach((s) => {
      list.push({
        label: s.label,
        value: s.age,
        unit: 'years',
        current: years,
        reached: years >= s.age,
        remaining: Math.max(0, s.age - years)
      });
    });

    return list;
  }

  function computeAgeDifference(b1, b2, target) {
    const a1 = computeAge(b1, target, false);
    const a2 = computeAge(b2, target, false);
    if (!a1 || !a2) return null;

    const older = b1 <= b2 ? a1 : a2;
    const younger = b1 <= b2 ? a2 : a1;
    const olderBirth = b1 <= b2 ? b1 : b2;
    const youngerBirth = b1 <= b2 ? b2 : b1;
    const gap = diffYMD(olderBirth, youngerBirth);

    return { older, younger, gap, targetFormatted: formatDate(target) };
  }

  function dogYears(humanYears) {
    if (humanYears <= 0) return 0;
    if (humanYears <= 2) return humanYears * 10.5;
    return 21 + (humanYears - 2) * 4;
  }

  function catYears(humanYears) {
    if (humanYears <= 0) return 0;
    if (humanYears === 1) return 15;
    if (humanYears === 2) return 24;
    return 24 + (humanYears - 2) * 4;
  }

  function checkEligibility(years, region) {
    const rules = {
      IN: {
        voting: 18,
        driving: 18,
        marriage: 21,
        school: 6,
        retirement: 60,
        licenseLearner: 16
      },
      US: {
        voting: 18,
        driving: 16,
        marriage: 18,
        school: 5,
        retirement: 67,
        licenseLearner: 15
      },
      UK: {
        voting: 18,
        driving: 17,
        marriage: 18,
        school: 5,
        retirement: 66,
        licenseLearner: 17
      }
    };
    const r = rules[region] || rules.IN;
    return [
      { id: 'voting', label: 'Voting eligibility', minAge: r.voting, eligible: years >= r.voting },
      { id: 'driving', label: 'Full driving license', minAge: r.driving, eligible: years >= r.driving },
      { id: 'learner', label: 'Learner permit', minAge: r.licenseLearner, eligible: years >= r.licenseLearner },
      { id: 'marriage', label: 'Legal marriage (general)', minAge: r.marriage, eligible: years >= r.marriage },
      { id: 'school', label: 'Typical school admission', minAge: r.school, eligible: years >= r.school },
      { id: 'retirement', label: 'Retirement benchmark', minAge: r.retirement, eligible: years >= r.retirement }
    ];
  }

  function plural(n, word) {
    return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function show(el, visible) {
    if (!el) return;
    el.hidden = !visible;
    el.classList.toggle('is-visible', visible);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function announce(msg) {
    const live = document.getElementById('acLiveRegion');
    if (live) {
      live.textContent = '';
      requestAnimationFrame(() => { live.textContent = msg; });
    }
  }

  function renderPrimaryResult(data, includeTime) {
    const { ymd, totalDays, totalWeeks, totalMonths, totalHours, totalMinutes, totalSeconds } = data;
    setText('acBigYears', ymd.years);
    setText('acBigMonths', ymd.months);
    setText('acBigDays', ymd.days);
    setText('acResultHeadline', `${ymd.years} years, ${ymd.months} months, ${ymd.days} days`);
    setText('acResultSub', `As of ${data.targetFormatted}`);

    const empty = document.getElementById('acEmptyState');
    if (empty) empty.hidden = true;

    const stats = [
      ['Weeks', totalWeeks, false],
      ['Total days', totalDays, false],
      ['Total hours', totalHours.toLocaleString(), false],
      ['Total seconds', totalSeconds.toLocaleString(), false]
    ];

    if (includeTime) {
      stats.unshift(['Hours', data.hours, false], ['Minutes', data.minutes, false], ['Seconds', data.seconds, false]);
    }

    setHTML('acStatGrid', stats.map(([label, val]) =>
      `<div class="ac-stat-card"><span class="ac-stat-label">${label}</span><strong class="ac-stat-value">${val}</strong></div>`
    ).join(''));

    setText('acBornDay', data.bornWeekday);
    setText('acZodiacSign', `${data.zodiac.symbol} ${data.zodiac.sign}`);
    setText('acChineseZodiac', data.chinese);
    setText('acNextBirthday', formatDateShort(data.nextBirthday.date));
    setText('acDaysUntilBirthday', plural(data.nextBirthday.daysUntil, 'day'));
    setText('acBirthdayWeekday', data.nextBirthday.weekday);

    setHTML('acMilestoneList', data.milestones.map((m) => {
      const status = m.reached
        ? '<span class="ac-milestone-badge is-done">Reached</span>'
        : `<span class="ac-milestone-badge is-pending">${m.remaining.toLocaleString()} ${m.unit} to go</span>`;
      return `<li class="ac-milestone-item"><div><strong>${m.label}</strong>${m.note ? `<p class="ac-milestone-note">${m.note}</p>` : ''}</div>${status}</li>`;
    }).join(''));

    const countdownEl = document.getElementById('acCountdown');
    if (countdownEl) {
      countdownEl.dataset.targetMs = String(data.nextBirthday.date.getTime());
      updateCountdown();
    }

    startLiveSeconds(data);
  }

  function updateCountdown() {
    const el = document.getElementById('acCountdown');
    const results = document.getElementById('acResults');
    if (!el || !results || results.hidden) return;
    const targetMs = Number(el.dataset.targetMs);
    if (!targetMs) return;
    const now = Date.now();
    const diff = Math.max(0, targetMs - now);
    const d = Math.floor(diff / MS_DAY);
    const h = Math.floor((diff % MS_DAY) / MS_HOUR);
    const m = Math.floor((diff % MS_HOUR) / MS_MIN);
    const s = Math.floor((diff % MS_MIN) / MS_SEC);
    el.innerHTML = `<span><strong>${d}</strong><small>days</small></span><span><strong>${h}</strong><small>hrs</small></span><span><strong>${m}</strong><small>min</small></span><span><strong>${s}</strong><small>sec</small></span>`;
  }

  function startLiveSeconds(data) {
    stopLiveSeconds();
    const el = document.getElementById('acLiveSeconds');
    if (!el || !data) return;
    const baseSeconds = data.totalSeconds;
    const baseTime = data.target.getTime();
    function tick() {
      const extra = Math.floor((Date.now() - baseTime) / MS_SEC);
      el.textContent = (baseSeconds + extra).toLocaleString();
    }
    tick();
    liveTimer = setInterval(tick, 1000);
  }

  function stopLiveSeconds() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
  }

  function renderDifference(diff) {
    const panel = document.getElementById('acDiffResults');
    if (!panel || !diff) return;
    const { older, younger, gap } = diff;
    setHTML('acDiffResults', `
      <div class="ac-diff-grid">
        <article class="ac-person-card">
          <h3>Person A (older)</h3>
          <p class="ac-person-age">${older.ymd.years}y ${older.ymd.months}m ${older.ymd.days}d</p>
          <p class="ac-person-meta">${older.totalDays.toLocaleString()} total days</p>
        </article>
        <div class="ac-diff-gap" aria-hidden="true">⇄ ${gap.years}y ${gap.months}m ${gap.days}d apart</div>
        <article class="ac-person-card">
          <h3>Person B (younger)</h3>
          <p class="ac-person-age">${younger.ymd.years}y ${younger.ymd.months}m ${younger.ymd.days}d</p>
          <p class="ac-person-meta">${younger.totalDays.toLocaleString()} total days</p>
        </article>
      </div>
      <p class="ac-diff-foot">Compared as of ${diff.targetFormatted}</p>
    `);
    show(panel, true);
  }

  function renderPet(humanYears, months) {
    const panel = document.getElementById('acPetResults');
    if (!panel) return;
    const preciseYears = humanYears + months / 12;
    const dog = dogYears(preciseYears);
    const cat = catYears(Math.floor(preciseYears));
    setHTML('acPetResults', `
      <div class="ac-pet-grid">
        <div class="ac-pet-card"><span class="ac-pet-icon" aria-hidden="true">🐕</span><strong>${dog.toFixed(1)} dog years</strong><p>Common veterinary estimate</p></div>
        <div class="ac-pet-card"><span class="ac-pet-icon" aria-hidden="true">🐈</span><strong>${cat} cat years</strong><p>Approximate feline age</p></div>
      </div>
    `);
    show(panel, true);
  }

  function renderEligibility(years, region) {
    const panel = document.getElementById('acEligibilityResults');
    if (!panel) return;
    const checks = checkEligibility(years, region);
    setHTML('acEligibilityResults', checks.map((c) =>
      `<div class="ac-elig-row ${c.eligible ? 'is-eligible' : 'is-pending'}"><span>${c.label}</span><strong>${c.eligible ? 'Eligible' : `Age ${c.minAge}+ required`}</strong></div>`
    ).join(''));
    show(panel, true);
  }

  function renderBaby(data) {
    const panel = document.getElementById('acBabyResults');
    if (!panel || !data) return;
    const weeks = Math.floor(data.totalDays / 7);
    const months = data.totalMonths;
    setHTML('acBabyResults', `
      <p class="ac-baby-head">${weeks} weeks · ${months} months · ${data.totalDays} days old</p>
      <p>Perfect for tracking infant milestones, vaccination schedules, and pediatric visits.</p>
    `);
    show(panel, true);
  }

  function getResultSummary(data) {
    const { ymd } = data;
    return `Age: ${ymd.years} years, ${ymd.months} months, ${ymd.days} days (as of ${data.targetFormatted}). Total days lived: ${data.totalDays.toLocaleString()}. Next birthday: ${formatDate(data.nextBirthday.date)} (${data.nextBirthday.daysUntil} days away).`;
  }

  let lastResult = null;

  function calculatePrimary() {
    const birth = parseDateInput(
      document.getElementById('birthDate')?.value,
      document.getElementById('includeTime')?.checked ? document.getElementById('birthTime')?.value : null
    );
    const useToday = document.getElementById('useToday')?.checked;
    const asOf = useToday
      ? new Date()
      : parseDateInput(
          document.getElementById('asOfDate')?.value,
          document.getElementById('includeTime')?.checked ? document.getElementById('asOfTime')?.value : null
        );

    const err = document.getElementById('acError');
    const results = document.getElementById('acResults');

    if (!birth) {
      show(err, true);
      setText('acErrorMsg', 'Please enter a valid date of birth.');
      show(results, false);
      const empty = document.getElementById('acEmptyState');
      if (empty) empty.hidden = false;
      announce('Please enter a valid date of birth.');
      return;
    }

    if (!asOf) {
      show(err, true);
      setText('acErrorMsg', 'Please choose a calculation date or select Today.');
      show(results, false);
      const empty = document.getElementById('acEmptyState');
      if (empty) empty.hidden = false;
      return;
    }

    if (asOf < birth) {
      show(err, true);
      setText('acErrorMsg', 'The calculation date must be on or after the date of birth.');
      show(results, false);
      const empty = document.getElementById('acEmptyState');
      if (empty) empty.hidden = false;
      return;
    }

    show(err, false);
    const includeTime = document.getElementById('includeTime')?.checked;
    const data = computeAge(birth, asOf, includeTime);
    lastResult = data;
    renderPrimaryResult(data, includeTime);
    show(results, true);
    document.querySelector('.ac-workspace-preview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    announce(getResultSummary(data));
  }

  function calculateMode(mode) {
    const target = parseDateInput(document.getElementById('asOfDate')?.value) || new Date();

    if (mode === 'difference') {
      const b1 = parseDateInput(document.getElementById('diffBirth1')?.value);
      const b2 = parseDateInput(document.getElementById('diffBirth2')?.value);
      if (!b1 || !b2) {
        announce('Enter both birth dates for age comparison.');
        return;
      }
      renderDifference(computeAgeDifference(b1, b2, target));
      return;
    }

    if (mode === 'pet') {
      const birth = parseDateInput(document.getElementById('petBirthDate')?.value);
      if (!birth) {
        announce('Enter pet birth date.');
        return;
      }
      const data = computeAge(birth, new Date(), false);
      renderPet(data.ymd.years, data.ymd.months);
      return;
    }

    if (mode === 'baby') {
      const birth = parseDateInput(document.getElementById('babyBirthDate')?.value);
      if (!birth) {
        announce('Enter baby birth date.');
        return;
      }
      renderBaby(computeAge(birth, new Date(), false));
      return;
    }

    if (mode === 'eligibility') {
      const birth = parseDateInput(document.getElementById('eligBirthDate')?.value);
      if (!birth) {
        announce('Enter birth date for eligibility check.');
        return;
      }
      const data = computeAge(birth, new Date(), false);
      const region = document.getElementById('eligRegion')?.value || 'IN';
      renderEligibility(data.ymd.years, region);
    }
  }

  function switchTab(tabId) {
    document.querySelectorAll('[data-ac-tab]').forEach((btn) => {
      const active = btn.dataset.acTab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-ac-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.acPanel !== tabId;
    });
    const workspace = document.getElementById('acWorkspace');
    if (workspace) workspace.classList.toggle('is-split', tabId === 'exact');
    // On phones the modes are one sideways-scrolling row: keep the chosen one in view.
    const on = document.querySelector('[data-ac-tab].is-active');
    const row = on && on.parentElement;
    if (row && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
    }
  }

  function initReveal() {
    document.querySelector('.ac-hero-card.ac-reveal')?.classList.add('is-in');
    document.querySelector('.ac-tool-card.ac-reveal')?.classList.add('is-in');
    const els = document.querySelectorAll('.ac-reveal:not(.is-in)');
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px 120px 0px' });
    els.forEach((el) => io.observe(el));
    setTimeout(() => els.forEach((el) => el.classList.add('is-in')), 3000);
  }

  function copyResults() {
    if (!lastResult) {
      announce('Calculate age first.');
      return;
    }
    const text = getResultSummary(lastResult);
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('acCopyBtn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1800);
      }
      announce('Results copied to clipboard.');
    }).catch(() => announce('Could not copy. Please select and copy manually.'));
  }

  function shareResults() {
    if (!lastResult) return;
    const text = getResultSummary(lastResult);
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'My Age Calculation — ToolAdda', text, url }).catch(() => {});
    } else {
      copyResults();
    }
  }

  function printResults() {
    if (!lastResult) return;
    window.print();
  }

  function init() {
    const birthDate = document.getElementById('birthDate');
    const asOfDate = document.getElementById('asOfDate');
    const useToday = document.getElementById('useToday');
    const includeTime = document.getElementById('includeTime');
    const timeFields = document.getElementById('acTimeFields');
    const customDateWrap = document.getElementById('acCustomDateWrap');

    if (asOfDate && !asOfDate.value) asOfDate.value = todayISO();
    if (useToday?.checked && asOfDate) {
      asOfDate.disabled = true;
      if (customDateWrap) customDateWrap.classList.add('is-disabled');
    }

    useToday?.addEventListener('change', () => {
      const on = useToday.checked;
      if (asOfDate) asOfDate.disabled = on;
      if (customDateWrap) customDateWrap.classList.toggle('is-disabled', on);
    });

    includeTime?.addEventListener('change', () => {
      if (timeFields) timeFields.hidden = !includeTime.checked;
    });

    document.getElementById('calculateAgeBtn')?.addEventListener('click', calculatePrimary);
    document.getElementById('acStickyCalc')?.addEventListener('click', calculatePrimary);
    document.getElementById('acCopyBtn')?.addEventListener('click', copyResults);
    document.getElementById('acShareBtn')?.addEventListener('click', shareResults);
    document.getElementById('acPrintBtn')?.addEventListener('click', printResults);

    document.querySelectorAll('[data-ac-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.acTab));
    });

    document.querySelectorAll('[data-ac-calc-mode]').forEach((btn) => {
      btn.addEventListener('click', () => calculateMode(btn.dataset.acCalcMode));
    });

    document.getElementById('acHeroCta')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('acTool')?.scrollIntoView({ behavior: 'smooth' });
      birthDate?.focus();
    });

    initReveal();
    document.querySelector('.ac-tool-card.ac-reveal')?.classList.add('is-in');
    setInterval(updateCountdown, 1000);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLiveSeconds();
      else if (lastResult) startLiveSeconds(lastResult);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
