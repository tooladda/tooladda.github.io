/* ToolAdda — Attendance Calculator, UI layer.

   All arithmetic lives in attendance-engine.js. This file only reads inputs,
   renders, and remembers the subject list so a student can come back to it. */
(function () {
  'use strict';

  var root = document.querySelector('[data-attendance]');
  if (!root) return;

  var E = window.AttendanceEngine;
  if (!E) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var el = {
    modeBtns: $$('[data-mode-btn]'),
    quickPanel: $('[data-panel-quick]'),
    subjectPanel: $('[data-panel-subjects]'),

    attended: $('[data-attended]'),
    held: $('[data-held]'),
    remaining: $('[data-remaining]'),
    required: $('[data-required]'),
    presets: $$('[data-preset]'),

    verdict: $('[data-verdict]'),
    percent: $('[data-percent]'),
    ring: $('[data-ring]'),
    statTiles: $('[data-stat-tiles]'),
    skip: $('[data-skip]'),
    need: $('[data-need]'),
    missed: $('[data-missed]'),
    projection: $('[data-projection]'),
    projBest: $('[data-proj-best]'),
    projWorst: $('[data-proj-worst]'),
    projNeed: $('[data-proj-need]'),

    rows: $('[data-rows]'),
    addRow: $('[data-add-row]'),
    overall: $('[data-overall]'),
    overallPct: $('[data-overall-pct]'),
    overallNote: $('[data-overall-note]'),

    reset: $('[data-reset]'),
    copy: $('[data-copy]')
  };

  var STORE_KEY = 'tooladda-attendance-subjects';
  var mode = 'quick';

  /* localStorage throws outright in a locked-down browser rather than
     returning null, so both ends are guarded — a privacy setting must not
     take the calculator down with it. */
  var store = {
    get: function () {
      try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]'); }
      catch (e) { return []; }
    },
    set: function (value) {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(value)); }
      catch (e) { /* private mode — the page still works, it just forgets */ }
    }
  };

  function num(input) {
    return input ? E.toCount(input.value) : 0;
  }

  function requiredValue() {
    return E.clampPercent(el.required ? Number(el.required.value) : E.DEFAULT_REQUIRED);
  }

  function fmt(value) {
    return value === Infinity ? '—' : String(value);
  }

  // ------------------------------------------------------------ quick mode

  function renderQuick() {
    var summary = E.summarise({
      attended: num(el.attended),
      held: num(el.held),
      remaining: num(el.remaining),
      required: requiredValue()
    });

    if (el.verdict) {
      el.verdict.textContent = E.verdictText(summary);
      el.verdict.dataset.status = summary.status;
    }

    var pct = summary.percentage;
    if (el.percent) el.percent.textContent = pct === null ? '—' : E.round(pct, 2) + '%';
    if (el.ring) {
      el.ring.style.setProperty('--ring-value', pct === null ? 0 : Math.min(100, pct));
      el.ring.dataset.status = summary.status;
    }

    if (el.skip) el.skip.textContent = fmt(summary.canSkip);
    if (el.need) el.need.textContent = fmt(summary.mustAttend);
    if (el.missed) el.missed.textContent = String(summary.missed);

    var projection = summary.projection;
    var hasRemaining = num(el.remaining) > 0;
    if (el.projection) el.projection.hidden = !hasRemaining || projection.best === null;
    if (hasRemaining && projection.best !== null) {
      if (el.projBest) el.projBest.textContent = E.round(projection.best, 2) + '%';
      if (el.projWorst) el.projWorst.textContent = E.round(projection.worst, 2) + '%';
      if (el.projNeed) {
        el.projNeed.textContent = projection.reachable
          ? 'Attend ' + projection.mustAttendOfRemaining + ' of the remaining ' + num(el.remaining)
          : 'Out of reach — even attending every remaining class tops out at ' +
            E.round(projection.best, 2) + '%';
      }
    }

    return summary;
  }

  // --------------------------------------------------------- subject mode

  function readRows() {
    return $$('[data-row]').map(function (row) {
      return {
        name: row.querySelector('[data-row-name]').value,
        attended: E.toCount(row.querySelector('[data-row-attended]').value),
        held: E.toCount(row.querySelector('[data-row-held]').value)
      };
    });
  }

  function renderRowResult(row, required) {
    var attended = E.toCount(row.querySelector('[data-row-attended]').value);
    var held = E.toCount(row.querySelector('[data-row-held]').value);
    var summary = E.summarise({ attended: attended, held: held, required: required });
    var out = row.querySelector('[data-row-result]');
    if (!out) return;
    if (summary.percentage === null) {
      out.textContent = '—';
      out.dataset.status = 'unknown';
      return;
    }
    out.textContent = E.round(summary.percentage, 1) + '%';
    out.dataset.status = summary.status;
    out.title = summary.percentage >= summary.required
      ? 'Can miss ' + summary.canSkip
      : 'Must attend ' + fmt(summary.mustAttend);
  }

  function renderSubjects() {
    var required = requiredValue();
    $$('[data-row]').forEach(function (row) { renderRowResult(row, required); });

    var total = E.combine(readRows(), required);
    if (el.overallPct) {
      el.overallPct.textContent = total.percentage === null ? '—' : E.round(total.percentage, 2) + '%';
    }
    if (el.overall) el.overall.dataset.status = total.status;
    if (el.overallNote) el.overallNote.textContent = E.verdictText(total);

    store.set(readRows());
    return total;
  }

  function addRow(data) {
    if (!el.rows) return;
    var values = data || { name: '', attended: '', held: '' };
    var row = document.createElement('div');
    row.className = 'atc-row';
    row.setAttribute('data-row', '');
    row.innerHTML =
      '<input class="atc-control" type="text" data-row-name placeholder="Subject" aria-label="Subject name" />' +
      '<input class="atc-control" type="number" min="0" inputmode="numeric" data-row-attended placeholder="Attended" aria-label="Classes attended" />' +
      '<input class="atc-control" type="number" min="0" inputmode="numeric" data-row-held placeholder="Held" aria-label="Classes held" />' +
      '<span class="atc-row-result" data-row-result>—</span>' +
      '<button type="button" class="atc-row-remove" data-row-remove aria-label="Remove subject">×</button>';

    row.querySelector('[data-row-name]').value = values.name || '';
    row.querySelector('[data-row-attended]').value = values.attended === '' ? '' : values.attended;
    row.querySelector('[data-row-held]').value = values.held === '' ? '' : values.held;

    row.addEventListener('input', renderSubjects);
    row.querySelector('[data-row-remove]').addEventListener('click', function () {
      row.remove();
      /* An empty table is a dead end — keep one row so there is always
         somewhere to type. */
      if (!$$('[data-row]').length) addRow();
      renderSubjects();
    });

    el.rows.appendChild(row);
  }

  // ------------------------------------------------------------ mode + IO

  function setMode(next) {
    mode = next;
    el.modeBtns.forEach(function (button) {
      var on = button.getAttribute('data-mode-btn') === next;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (el.quickPanel) el.quickPanel.hidden = next !== 'quick';
    if (el.subjectPanel) el.subjectPanel.hidden = next !== 'subjects';
    render();
  }

  function render() {
    if (mode === 'quick') renderQuick();
    else renderSubjects();
  }

  function copySummary() {
    var text;
    if (mode === 'quick') {
      var s = renderQuick();
      text = 'Attendance: ' + (s.percentage === null ? '—' : E.round(s.percentage, 2) + '%') +
        ' (' + s.attended + '/' + s.held + ', ' + s.required + '% required)\n' + E.verdictText(s);
    } else {
      var required = requiredValue();
      var lines = readRows().filter(function (r) { return r.held > 0; }).map(function (r) {
        var sum = E.summarise({ attended: r.attended, held: r.held, required: required });
        return (r.name || 'Subject') + ': ' + E.round(sum.percentage, 1) + '% (' + r.attended + '/' + r.held + ')';
      });
      var total = E.combine(readRows(), required);
      lines.push('Overall: ' + (total.percentage === null ? '—' : E.round(total.percentage, 2) + '%'));
      text = lines.join('\n');
    }

    var done = function () {
      if (!el.copy) return;
      var original = el.copy.textContent;
      el.copy.textContent = '✓ Copied';
      window.setTimeout(function () { el.copy.textContent = original; }, 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  }

  // ---------------------------------------------------------------- wiring

  [el.attended, el.held, el.remaining].forEach(function (input) {
    if (input) input.addEventListener('input', render);
  });

  if (el.required) {
    el.required.addEventListener('input', function () {
      el.presets.forEach(function (button) {
        var on = Number(button.getAttribute('data-preset')) === Number(el.required.value);
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  }

  el.presets.forEach(function (button) {
    button.addEventListener('click', function () {
      if (el.required) {
        el.required.value = button.getAttribute('data-preset');
        el.required.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });

  el.modeBtns.forEach(function (button) {
    button.addEventListener('click', function () { setMode(button.getAttribute('data-mode-btn')); });
  });

  if (el.addRow) el.addRow.addEventListener('click', function () { addRow(); renderSubjects(); });
  if (el.copy) el.copy.addEventListener('click', copySummary);
  if (el.reset) {
    el.reset.addEventListener('click', function () {
      if (el.attended) el.attended.value = '';
      if (el.held) el.held.value = '';
      if (el.remaining) el.remaining.value = '';
      if (el.rows) el.rows.innerHTML = '';
      store.set([]);
      addRow();
      render();
    });
  }

  // ------------------------------------------------------------ first paint
  var saved = store.get();
  if (saved.length) saved.forEach(function (row) { addRow(row); });
  else addRow();

  setMode('quick');
})();
