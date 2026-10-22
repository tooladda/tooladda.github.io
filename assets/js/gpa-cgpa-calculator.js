/* ToolAdda - GPA / CGPA Calculator
 * Semester GPA (SGPA), cumulative CGPA, CGPA<->percentage conversion, GPA
 * scale conversion and a "what GPA do I need" target solver. Pure math is
 * kept separate from DOM code so it can be unit tested outside a browser.
 */
(function () {
  'use strict';

  const hasDom = typeof document !== 'undefined';
  const root = hasDom ? document.querySelector('[data-gpa]') : null;

  /* ------------------------------------------------------------------ *
   * Grade scale presets
   * ------------------------------------------------------------------ */

  const GRADE_SCALES = {
    us4: {
      label: '4.0 Scale (US)',
      max: 4,
      grades: [
        { grade: 'A+', points: 4.0 }, { grade: 'A', points: 4.0 }, { grade: 'A-', points: 3.7 },
        { grade: 'B+', points: 3.3 }, { grade: 'B', points: 3.0 }, { grade: 'B-', points: 2.7 },
        { grade: 'C+', points: 2.3 }, { grade: 'C', points: 2.0 }, { grade: 'C-', points: 1.7 },
        { grade: 'D+', points: 1.3 }, { grade: 'D', points: 1.0 }, { grade: 'F', points: 0.0 },
      ],
    },
    india10: {
      label: '10-Point Scale (India)',
      max: 10,
      grades: [
        { grade: 'O', points: 10 }, { grade: 'A+', points: 9 }, { grade: 'A', points: 8 },
        { grade: 'B+', points: 7 }, { grade: 'B', points: 6 }, { grade: 'C', points: 5 },
        { grade: 'P', points: 4 }, { grade: 'F', points: 0 },
      ],
    },
    five: {
      label: '5.0 Scale',
      max: 5,
      grades: [
        { grade: 'A', points: 5 }, { grade: 'B', points: 4 }, { grade: 'C', points: 3 },
        { grade: 'D', points: 2 }, { grade: 'E', points: 1 }, { grade: 'F', points: 0 },
      ],
    },
  };

  /* ------------------------------------------------------------------ *
   * Pure engine
   * ------------------------------------------------------------------ */

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // rows: [{ credits, grade }]; scale: [{ grade, points }]
  function computeGPA(rows, scale) {
    const pointsFor = new Map(scale.map((g) => [g.grade, g.points]));
    let totalCredits = 0;
    let totalPoints = 0;
    rows.forEach((row) => {
      const credits = Number(row.credits);
      if (!Number.isFinite(credits) || credits <= 0) return;
      if (!pointsFor.has(row.grade)) return;
      totalCredits += credits;
      totalPoints += credits * pointsFor.get(row.grade);
    });
    return {
      gpa: totalCredits > 0 ? round2(totalPoints / totalCredits) : 0,
      totalCredits: totalCredits,
      totalPoints: round2(totalPoints),
    };
  }

  // rows: [{ gpa, credits }]
  function computeCGPA(rows) {
    let totalCredits = 0;
    let totalPoints = 0;
    rows.forEach((row) => {
      const gpa = Number(row.gpa);
      const credits = Number(row.credits);
      if (!Number.isFinite(gpa) || !Number.isFinite(credits) || credits <= 0) return;
      totalCredits += credits;
      totalPoints += gpa * credits;
    });
    return {
      cgpa: totalCredits > 0 ? round2(totalPoints / totalCredits) : 0,
      totalCredits: totalCredits,
    };
  }

  // mode: 'multiply' -> cgpa * multiplier ; 'offset' -> (cgpa - 0.75) * 10
  function cgpaToPercentage(cgpa, mode, multiplier) {
    if (!Number.isFinite(cgpa)) return null;
    if (mode === 'offset') return round2((cgpa - 0.75) * 10);
    return round2(cgpa * multiplier);
  }

  function percentageToCgpa(percentage, mode, multiplier) {
    if (!Number.isFinite(percentage)) return null;
    if (mode === 'offset') return round2(percentage / 10 + 0.75);
    if (!multiplier) return null;
    return round2(percentage / multiplier);
  }

  // Proportional conversion between any two GPA scale maximums (e.g. 4 <-> 10).
  function convertScale(value, fromMax, toMax) {
    if (!Number.isFinite(value) || !fromMax) return null;
    return round2((value / fromMax) * toMax);
  }

  // How high the average grade in the remaining credits needs to be to hit a target CGPA.
  function requiredGpa(opts) {
    const currentGpa = Number(opts.currentGpa) || 0;
    const currentCredits = Number(opts.currentCredits) || 0;
    const targetGpa = Number(opts.targetGpa);
    const remainingCredits = Number(opts.remainingCredits);

    if (!Number.isFinite(targetGpa) || !Number.isFinite(remainingCredits) || remainingCredits <= 0) {
      return null;
    }
    const totalCredits = currentCredits + remainingCredits;
    const needed = (targetGpa * totalCredits - currentGpa * currentCredits) / remainingCredits;
    return round2(needed);
  }

  /* ------------------------------------------------------------------ *
   * Node/test export
   * ------------------------------------------------------------------ */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      GRADE_SCALES: GRADE_SCALES,
      computeGPA: computeGPA,
      computeCGPA: computeCGPA,
      cgpaToPercentage: cgpaToPercentage,
      percentageToCgpa: percentageToCgpa,
      convertScale: convertScale,
      requiredGpa: requiredGpa,
      round2: round2,
    };
  }

  if (!root) {
    return;
  }

  /* ------------------------------------------------------------------ *
   * DOM wiring
   * ------------------------------------------------------------------ */

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.prototype.slice.call(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const toast = $('[data-toast]');
  let toastTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }
  async function copyText(text, message) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
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
      showToast(message || 'Copied to clipboard');
    } catch (e) {
      showToast('Copy failed — select the text and press Ctrl+C');
    }
  }

  /* ---------- tabs ---------- */

  const tabButtons = $$('[data-tab-btn]');
  const tabPanels = $$('[data-tab-panel]');
  function activateTab(name) {
    tabButtons.forEach((btn) => {
      const active = btn.getAttribute('data-tab-btn') === name;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    tabPanels.forEach((panel) => {
      panel.hidden = panel.getAttribute('data-tab-panel') !== name;
    });
  }
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab-btn')));
  });

  /* ---------- grade scale state ---------- */

  const scaleSelect = $('[data-scale-preset]');
  const scaleBody = $('[data-scale-body]');
  const scaleMaxLabel = $('[data-scale-max]');
  let activeScale = GRADE_SCALES.india10.grades.slice();
  let activeScaleMax = GRADE_SCALES.india10.max;

  function renderScaleEditor() {
    scaleBody.innerHTML = activeScale.map((row, i) => (
      '<tr>'
      + '<td><input type="text" class="gpa-mini-input" value="' + esc(row.grade) + '" data-scale-grade data-idx="' + i + '" /></td>'
      + '<td><input type="number" class="gpa-mini-input" value="' + row.points + '" step="0.1" data-scale-points data-idx="' + i + '" /></td>'
      + '<td><button type="button" class="gpa-row-remove" data-scale-remove data-idx="' + i + '" aria-label="Remove grade row">✕</button></td>'
      + '</tr>'
    )).join('');
    scaleMaxLabel.textContent = 'Highest point on this scale: ' + activeScaleMax;
    bindScaleEditorEvents();
    renderCourseGradeOptions();
  }

  function bindScaleEditorEvents() {
    $$('[data-scale-grade]').forEach((input) => {
      input.addEventListener('input', () => {
        activeScale[Number(input.getAttribute('data-idx'))].grade = input.value.trim();
        renderCourseGradeOptions();
        recomputeSemester();
      });
    });
    $$('[data-scale-points]').forEach((input) => {
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        activeScale[Number(input.getAttribute('data-idx'))].points = Number.isFinite(v) ? v : 0;
        activeScaleMax = Math.max.apply(null, activeScale.map((r) => r.points).concat([0]));
        scaleMaxLabel.textContent = 'Highest point on this scale: ' + activeScaleMax;
        recomputeSemester();
      });
    });
    $$('[data-scale-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeScale.splice(Number(btn.getAttribute('data-idx')), 1);
        renderScaleEditor();
        recomputeSemester();
      });
    });
  }

  scaleSelect.addEventListener('change', () => {
    const preset = GRADE_SCALES[scaleSelect.value];
    if (!preset) return;
    activeScale = preset.grades.map((g) => ({ grade: g.grade, points: g.points }));
    activeScaleMax = preset.max;
    renderScaleEditor();
    recomputeSemester();
  });

  $('[data-scale-add]').addEventListener('click', () => {
    activeScale.push({ grade: 'New', points: 0 });
    renderScaleEditor();
  });

  /* ---------- semester GPA tab ---------- */

  const courseBody = $('[data-course-body]');
  const semesterResult = $('[data-semester-result]');
  const semesterMeta = $('[data-semester-meta]');
  let courses = [
    { name: '', credits: 4, grade: null },
    { name: '', credits: 3, grade: null },
    { name: '', credits: 3, grade: null },
  ];

  function renderCourseGradeOptions() {
    $$('[data-course-grade]').forEach((select) => {
      const idx = Number(select.getAttribute('data-idx'));
      const current = courses[idx] ? courses[idx].grade : null;
      select.innerHTML = activeScale.map((g) => '<option value="' + esc(g.grade) + '">' + esc(g.grade) + ' (' + g.points + ')</option>').join('');
      if (current && activeScale.some((g) => g.grade === current)) {
        select.value = current;
      } else if (activeScale.length) {
        courses[idx].grade = activeScale[0].grade;
        select.value = activeScale[0].grade;
      }
    });
  }

  function renderCourses() {
    courseBody.innerHTML = courses.map((course, i) => (
      '<tr>'
      + '<td><input type="text" class="gpa-mini-input" placeholder="Course ' + (i + 1) + '" value="' + esc(course.name) + '" data-course-name data-idx="' + i + '" /></td>'
      + '<td><input type="number" class="gpa-mini-input gpa-mini-input--num" min="0" step="0.5" value="' + course.credits + '" data-course-credits data-idx="' + i + '" /></td>'
      + '<td><select class="gpa-mini-input" data-course-grade data-idx="' + i + '"></select></td>'
      + '<td><button type="button" class="gpa-row-remove" data-course-remove data-idx="' + i + '" aria-label="Remove course">✕</button></td>'
      + '</tr>'
    )).join('');
    renderCourseGradeOptions();
    bindCourseEvents();
  }

  function bindCourseEvents() {
    $$('[data-course-name]').forEach((input) => {
      input.addEventListener('input', () => {
        courses[Number(input.getAttribute('data-idx'))].name = input.value;
      });
    });
    $$('[data-course-credits]').forEach((input) => {
      input.addEventListener('input', () => {
        courses[Number(input.getAttribute('data-idx'))].credits = input.value;
        recomputeSemester();
      });
    });
    $$('[data-course-grade]').forEach((select) => {
      select.addEventListener('change', () => {
        courses[Number(select.getAttribute('data-idx'))].grade = select.value;
        recomputeSemester();
      });
    });
    $$('[data-course-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        courses.splice(Number(btn.getAttribute('data-idx')), 1);
        renderCourses();
        recomputeSemester();
      });
    });
  }

  $('[data-course-add]').addEventListener('click', () => {
    courses.push({ name: '', credits: 3, grade: activeScale.length ? activeScale[0].grade : null });
    renderCourses();
    recomputeSemester();
  });

  let lastSemesterResult = null;
  function recomputeSemester() {
    const result = computeGPA(courses, activeScale);
    lastSemesterResult = result;
    semesterResult.textContent = result.totalCredits > 0 ? result.gpa.toFixed(2) : '—';
    semesterMeta.textContent = result.totalCredits > 0
      ? 'Across ' + result.totalCredits + ' credit hour' + (result.totalCredits === 1 ? '' : 's') + ' (out of ' + activeScaleMax + ')'
      : 'Add at least one course with credits to see your GPA.';
  }

  $('[data-copy-semester]').addEventListener('click', () => {
    if (!lastSemesterResult || lastSemesterResult.totalCredits <= 0) {
      showToast('Nothing to copy yet');
      return;
    }
    copyText('Semester GPA: ' + lastSemesterResult.gpa.toFixed(2) + ' (' + lastSemesterResult.totalCredits + ' credits)', 'GPA copied');
  });

  $('[data-send-to-cgpa]').addEventListener('click', () => {
    if (!lastSemesterResult || lastSemesterResult.totalCredits <= 0) {
      showToast('Calculate a semester GPA first');
      return;
    }
    semesters.push({
      label: 'Semester ' + (semesters.length + 1),
      gpa: lastSemesterResult.gpa,
      credits: lastSemesterResult.totalCredits,
    });
    renderSemesters();
    recomputeCumulative();
    activateTab('cumulative');
    showToast('Added to Cumulative CGPA');
  });

  /* ---------- cumulative CGPA tab ---------- */

  const semesterBody = $('[data-semester-body]');
  const cumulativeResult = $('[data-cumulative-result]');
  const cumulativeMeta = $('[data-cumulative-meta]');
  let semesters = [
    { label: 'Semester 1', gpa: 8.2, credits: 24 },
    { label: 'Semester 2', gpa: 7.9, credits: 24 },
  ];

  function renderSemesters() {
    semesterBody.innerHTML = semesters.map((s, i) => (
      '<tr>'
      + '<td><input type="text" class="gpa-mini-input" value="' + esc(s.label) + '" data-sem-label data-idx="' + i + '" /></td>'
      + '<td><input type="number" class="gpa-mini-input gpa-mini-input--num" min="0" step="0.01" value="' + s.gpa + '" data-sem-gpa data-idx="' + i + '" /></td>'
      + '<td><input type="number" class="gpa-mini-input gpa-mini-input--num" min="0" step="0.5" value="' + s.credits + '" data-sem-credits data-idx="' + i + '" /></td>'
      + '<td><button type="button" class="gpa-row-remove" data-sem-remove data-idx="' + i + '" aria-label="Remove semester">✕</button></td>'
      + '</tr>'
    )).join('');
    bindSemesterEvents();
  }

  function bindSemesterEvents() {
    $$('[data-sem-label]').forEach((input) => {
      input.addEventListener('input', () => { semesters[Number(input.getAttribute('data-idx'))].label = input.value; });
    });
    $$('[data-sem-gpa]').forEach((input) => {
      input.addEventListener('input', () => {
        semesters[Number(input.getAttribute('data-idx'))].gpa = input.value;
        recomputeCumulative();
      });
    });
    $$('[data-sem-credits]').forEach((input) => {
      input.addEventListener('input', () => {
        semesters[Number(input.getAttribute('data-idx'))].credits = input.value;
        recomputeCumulative();
      });
    });
    $$('[data-sem-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        semesters.splice(Number(btn.getAttribute('data-idx')), 1);
        renderSemesters();
        recomputeCumulative();
      });
    });
  }

  $('[data-semester-add]').addEventListener('click', () => {
    semesters.push({ label: 'Semester ' + (semesters.length + 1), gpa: '', credits: 24 });
    renderSemesters();
  });

  let lastCumulativeResult = null;
  function recomputeCumulative() {
    const result = computeCGPA(semesters);
    lastCumulativeResult = result;
    cumulativeResult.textContent = result.totalCredits > 0 ? result.cgpa.toFixed(2) : '—';
    cumulativeMeta.textContent = result.totalCredits > 0
      ? 'Weighted across ' + result.totalCredits + ' total credit hours'
      : 'Add at least one semester with credits to see your CGPA.';
  }

  $('[data-copy-cumulative]').addEventListener('click', () => {
    if (!lastCumulativeResult || lastCumulativeResult.totalCredits <= 0) {
      showToast('Nothing to copy yet');
      return;
    }
    copyText('Cumulative CGPA: ' + lastCumulativeResult.cgpa.toFixed(2) + ' (' + lastCumulativeResult.totalCredits + ' credits)', 'CGPA copied');
  });

  /* ---------- CGPA <-> percentage tab ---------- */

  const convModeRadios = $$('[name="gpa-conv-mode"]');
  const convMultiplierInput = $('[data-conv-multiplier]');
  const convCgpaInput = $('[data-conv-cgpa]');
  const convPercentInput = $('[data-conv-percent]');
  const convNote = $('[data-conv-note]');

  function currentConvMode() {
    const checked = convModeRadios.find((r) => r.checked);
    return checked ? checked.value : 'multiply';
  }

  function refreshConvNote() {
    convMultiplierInput.disabled = currentConvMode() === 'offset';
    convNote.textContent = currentConvMode() === 'offset'
      ? 'Formula: Percentage = (CGPA − 0.75) × 10 — used by some universities on a 10-point scale.'
      : 'Formula: Percentage = CGPA × ' + (convMultiplierInput.value || '9.5') + ' — the multiplier varies by institution; check your official conversion certificate.';
  }

  function fromCgpa() {
    const cgpa = parseFloat(convCgpaInput.value);
    const mode = currentConvMode();
    const multiplier = parseFloat(convMultiplierInput.value);
    const pct = cgpaToPercentage(cgpa, mode, multiplier);
    convPercentInput.value = pct === null ? '' : pct.toFixed(2);
  }
  function fromPercent() {
    const pct = parseFloat(convPercentInput.value);
    const mode = currentConvMode();
    const multiplier = parseFloat(convMultiplierInput.value);
    const cgpa = percentageToCgpa(pct, mode, multiplier);
    convCgpaInput.value = cgpa === null ? '' : cgpa.toFixed(2);
  }

  convCgpaInput.addEventListener('input', fromCgpa);
  convPercentInput.addEventListener('input', fromPercent);
  convMultiplierInput.addEventListener('input', () => { refreshConvNote(); fromCgpa(); });
  convModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => { refreshConvNote(); fromCgpa(); });
  });
  $$('[data-multiplier-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      convMultiplierInput.value = btn.getAttribute('data-multiplier-preset');
      refreshConvNote();
      fromCgpa();
    });
  });

  /* ---------- scale converter (4.0 <-> 10.0) ---------- */

  const scaleFromInput = $('[data-scaleconv-from]');
  const scaleFromMax = $('[data-scaleconv-from-max]');
  const scaleToMax = $('[data-scaleconv-to-max]');
  const scaleToOutput = $('[data-scaleconv-to]');

  function recomputeScaleConv() {
    const value = parseFloat(scaleFromInput.value);
    const fromMax = parseFloat(scaleFromMax.value);
    const toMax = parseFloat(scaleToMax.value);
    const result = convertScale(value, fromMax, toMax);
    scaleToOutput.textContent = result === null ? '—' : result.toFixed(2) + ' / ' + toMax;
  }
  [scaleFromInput, scaleFromMax, scaleToMax].forEach((el) => el.addEventListener('input', recomputeScaleConv));

  /* ---------- what GPA do I need ---------- */

  const targetCurrentGpa = $('[data-target-current-gpa]');
  const targetCurrentCredits = $('[data-target-current-credits]');
  const targetGoalGpa = $('[data-target-goal-gpa]');
  const targetRemainingCredits = $('[data-target-remaining-credits]');
  const targetMaxScale = $('[data-target-max-scale]');
  const targetResult = $('[data-target-result]');
  const targetMeta = $('[data-target-meta]');

  function recomputeTarget() {
    const needed = requiredGpa({
      currentGpa: targetCurrentGpa.value,
      currentCredits: targetCurrentCredits.value,
      targetGpa: targetGoalGpa.value,
      remainingCredits: targetRemainingCredits.value,
    });
    const maxScale = parseFloat(targetMaxScale.value) || 10;

    if (needed === null) {
      targetResult.textContent = '—';
      targetMeta.textContent = 'Fill in your target GPA and remaining credits.';
      return;
    }
    targetResult.textContent = needed.toFixed(2);
    if (needed <= 0) {
      targetMeta.textContent = 'You have already reached this target — any passing grade keeps you there.';
    } else if (needed > maxScale) {
      targetMeta.textContent = 'Not achievable with ' + targetRemainingCredits.value + ' remaining credits — even a perfect ' + maxScale.toFixed(1) + ' average falls short.';
    } else {
      targetMeta.textContent = 'You need an average of ' + needed.toFixed(2) + ' out of ' + maxScale.toFixed(1) + ' in your remaining credits.';
    }
  }
  [targetCurrentGpa, targetCurrentCredits, targetGoalGpa, targetRemainingCredits, targetMaxScale].forEach((el) => {
    el.addEventListener('input', recomputeTarget);
  });

  /* ---------- init ---------- */

  function init() {
    activateTab('semester');
    renderScaleEditor();
    renderCourses();
    recomputeSemester();
    renderSemesters();
    recomputeCumulative();
    refreshConvNote();
    fromCgpa();
    recomputeScaleConv();
    recomputeTarget();
  }

  init();
}());
