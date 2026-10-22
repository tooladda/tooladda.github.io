/* ==========================================================================
   ToolAdda — Exam Seating Arrangement Planner (UI layer)

   Event wiring, rendering and file assembly. Every decision about WHO sits
   WHERE lives in exam-seating-engine.js, which knows nothing about the DOM
   and is covered by scripts/exam-seating-engine.test.js.

   All four outputs — the seat charts, the room-wise lists, the roll-number
   index and the door notices — are rendered from a single plan object, so
   they can never disagree with one another about where a student is sitting.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.ExamSeatingEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-exam-seating-settings';

  var els = {};
  var current = null;      /* the last plan built, shared by every renderer */

  /* ------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function slug(text) {
    return String(text || 'exam').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exam';
  }

  /* --------------------------------------------------------------- state */

  function readOptions() {
    return {
      order: els.order.value,
      mix: els.mix.value,
      spread: els.spread.value
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        groups: els.groups.value,
        rooms: els.rooms.value,
        examName: els.examName.value,
        examDate: els.examDate.value,
        order: els.order.value,
        mix: els.mix.value,
        spread: els.spread.value,
        showGroup: els.showGroup.checked,
        showSeatNo: els.showSeatNo.checked
      }));
    } catch (err) { /* private browsing — the tool still works, just forgets */ }
  }

  function restore() {
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (err) { return; }
    if (!raw) return;
    var s;
    try { s = JSON.parse(raw); } catch (err) { return; }
    if (!s || typeof s !== 'object') return;

    if (typeof s.groups === 'string') els.groups.value = s.groups;
    if (typeof s.rooms === 'string') els.rooms.value = s.rooms;
    if (typeof s.examName === 'string') els.examName.value = s.examName;
    if (typeof s.examDate === 'string') els.examDate.value = s.examDate;
    if (E.ORDERS.indexOf(s.order) >= 0) els.order.value = s.order;
    if (E.MIXES.indexOf(s.mix) >= 0) els.mix.value = s.mix;
    if (E.SPREADS.indexOf(s.spread) >= 0) els.spread.value = s.spread;
    if (typeof s.showGroup === 'boolean') els.showGroup.checked = s.showGroup;
    if (typeof s.showSeatNo === 'boolean') els.showSeatNo.checked = s.showSeatNo;
  }

  /* ------------------------------------------------------------ rendering */

  function renderMessages(plan) {
    var out = [];
    var warnings = plan.analysis.warnings;

    for (var i = 0; i < warnings.length; i++) {
      var w = warnings[i];
      var cls = w.level === 'error' ? 'esp-msg-error' : (w.level === 'warn' ? 'esp-msg-warn' : 'esp-msg-info');
      var tag = w.level === 'error' ? 'Cannot plan' : (w.level === 'warn' ? 'Check' : 'Note');
      out.push('<div class="esp-msg ' + cls + '"><strong>' + tag + '</strong><span>' + esc(w.text) + '</span></div>');
    }

    var s = plan.summary;

    if (s.conflicts > 0) {
      out.push('<div class="esp-msg esp-msg-warn"><strong>' + s.conflicts + ' seat' +
        (s.conflicts === 1 ? '' : 's') + '</strong><span>could not be kept apart from a same-group neighbour. ' +
        'They are ringed and marked with an exclamation mark on the chart so you can move them by hand or ' +
        'add a room.</span></div>');
    }

    if (s.unplaced > 0) {
      out.push('<div class="esp-msg esp-msg-error"><strong>' + s.unplaced + ' unplaced</strong><span>' +
        'There were not enough seats. Nobody has been dropped from the lists — the unplaced roll numbers are ' +
        'shown under the Room lists tab.</span></div>');
    }

    if (s.clean && s.seated > 0) {
      out.push('<div class="esp-msg esp-msg-ok"><strong>Clean plan</strong><span>All ' + s.seated +
        ' students are seated and no two neighbours share a group.</span></div>');
    }

    els.messages.innerHTML = out.join('');
  }

  function renderStats(plan) {
    var s = plan.summary;
    var cells = [
      [s.seated, 'Seated'],
      [s.rooms, s.rooms === 1 ? 'Room' : 'Rooms'],
      [s.groups, s.groups === 1 ? 'Group' : 'Groups'],
      [s.vacant, 'Vacant'],
      [s.conflicts, 'Clashes']
    ];
    var out = '';
    for (var i = 0; i < cells.length; i++) {
      out += '<div class="esp-stat"><span class="esp-stat-num">' + cells[i][0] +
             '</span><span class="esp-stat-label">' + cells[i][1] + '</span></div>';
    }
    els.stats.innerHTML = out;
  }

  function legendHTML(groups) {
    if (!groups.length) return '';
    var out = '<ul class="esp-legend">';
    for (var i = 0; i < groups.length; i++) {
      if (!groups[i].count) continue;
      out += '<li><span class="esp-swatch esp-g' + (i % 8) + '"></span>' +
             esc(groups[i].label) + ' (' + groups[i].count + ')</li>';
    }
    return out + '</ul>';
  }

  function headerHTML() {
    var name = els.examName.value.trim();
    var date = els.examDate.value.trim();
    if (!name && !date) return '';
    return '<p class="esp-room-meta">' + esc(name) + (name && date ? ' &middot; ' : '') + esc(date) + '</p>';
  }

  /* The seat charts — the sheet an invigilator pins up in the hall. */
  function renderCharts(plan) {
    var alloc = plan.allocation;
    if (!alloc.rooms.length) {
      els.charts.innerHTML = '<p class="esp-empty">Add rooms and classes to see the seating chart.</p>';
      return;
    }

    var showGroup = els.showGroup.checked;
    var showSeatNo = els.showSeatNo.checked;
    var out = '';

    for (var i = 0; i < alloc.rooms.length; i++) {
      var room = alloc.rooms[i];
      var mix = [];
      for (var key in room.counts) {
        if (Object.prototype.hasOwnProperty.call(room.counts, key)) mix.push(key + ' ' + room.counts[key]);
      }

      out += '<section class="esp-room">';
      out += '<div class="esp-room-head"><h3 class="esp-room-name">' + esc(room.name) + '</h3>' +
             '<span class="esp-room-meta">' + room.filled + ' seated &middot; ' + room.vacant + ' vacant &middot; ' +
             room.rows + ' rows x ' + room.cols + ' columns</span></div>';
      out += headerHTML();
      if (mix.length) out += '<p class="esp-room-meta">' + esc(mix.join('  |  ')) + '</p>';
      out += '<div class="esp-board">Front of hall / board</div>';
      out += '<div class="esp-grid" style="grid-template-columns:repeat(' + room.cols + ',minmax(0,1fr))">';

      for (var r = 0; r < room.rows; r++) {
        for (var c = 0; c < room.cols; c++) {
          var cell = room.grid[r][c];
          if (!cell) {
            out += '<div class="esp-seat esp-seat-empty"><span class="esp-seat-roll">' +
                   esc(E.seatLabel(r, c)) + '</span><span class="esp-seat-no">vacant</span></div>';
            continue;
          }
          out += '<div class="esp-seat esp-g' + (cell.groupIndex % 8) + (cell.clash ? ' esp-seat-clash' : '') + '">';
          out += '<span class="esp-seat-roll">' + esc(cell.roll) + '</span>';
          if (showGroup) out += '<span class="esp-seat-group">' + esc(cell.groupLabel) + '</span>';
          if (showSeatNo) out += '<span class="esp-seat-no">' + esc(E.seatLabel(r, c)) + '</span>';
          out += '</div>';
        }
      }

      out += '</div>';
      out += legendHTML(plan.groups);
      out += '</section>';
    }

    els.charts.innerHTML = out;
  }

  /* Room-wise attendance lists, plus anyone who did not fit. */
  function renderRoomLists(plan) {
    var alloc = plan.allocation;
    if (!alloc.rooms.length) {
      els.lists.innerHTML = '<p class="esp-empty">Nothing to list yet.</p>';
      return;
    }

    var out = '';

    for (var i = 0; i < alloc.rooms.length; i++) {
      var room = alloc.rooms[i];
      var rows = [];

      for (var r = 0; r < room.rows; r++) {
        for (var c = 0; c < room.cols; c++) {
          var cell = room.grid[r][c];
          if (cell) rows.push({ seat: E.seatLabel(r, c), roll: cell.roll, group: cell.groupLabel });
        }
      }

      rows.sort(function (a, b) {
        return String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true, sensitivity: 'base' });
      });

      out += '<section class="esp-room">';
      out += '<div class="esp-room-head"><h3 class="esp-room-name">' + esc(room.name) + '</h3>' +
             '<span class="esp-room-meta">' + rows.length + ' candidates</span></div>';
      out += headerHTML();

      if (!rows.length) {
        out += '<p class="esp-empty">No candidates allotted to this room.</p></section>';
        continue;
      }

      out += '<div class="esp-table-wrap"><table class="esp-table"><thead><tr>' +
             '<th>#</th><th>Roll number</th><th>Class / group</th><th>Seat</th><th>Signature</th>' +
             '</tr></thead><tbody>';
      for (var k = 0; k < rows.length; k++) {
        out += '<tr><td>' + (k + 1) + '</td><td>' + esc(rows[k].roll) + '</td><td>' +
               esc(rows[k].group) + '</td><td>' + esc(rows[k].seat) + '</td><td></td></tr>';
      }
      out += '</tbody></table></div></section>';
    }

    if (alloc.unplaced.length) {
      out += '<section class="esp-room"><div class="esp-room-head">' +
             '<h3 class="esp-room-name">Not allotted a seat</h3>' +
             '<span class="esp-room-meta">' + alloc.unplaced.length + ' candidates</span></div>';
      out += '<div class="esp-table-wrap"><table class="esp-table"><thead><tr>' +
             '<th>#</th><th>Roll number</th><th>Class / group</th></tr></thead><tbody>';
      for (var u = 0; u < alloc.unplaced.length; u++) {
        out += '<tr><td>' + (u + 1) + '</td><td>' + esc(alloc.unplaced[u].roll) + '</td><td>' +
               esc(alloc.unplaced[u].groupLabel) + '</td></tr>';
      }
      out += '</tbody></table></div></section>';
    }

    els.lists.innerHTML = out;
  }

  /* Roll-number index — the list students read to find their room. */
  function renderIndex(plan) {
    var idx = plan.index;
    if (!idx.length) {
      els.index.innerHTML = '<p class="esp-empty">Nothing to index yet.</p>';
      return;
    }

    var out = '<section class="esp-room"><div class="esp-room-head">' +
              '<h3 class="esp-room-name">Roll number index</h3>' +
              '<span class="esp-room-meta">' + idx.length + ' candidates, sorted by roll number</span></div>';
    out += headerHTML();
    out += '<div class="esp-table-wrap"><table class="esp-table"><thead><tr>' +
           '<th>Roll number</th><th>Class / group</th><th>Room</th><th>Seat</th></tr></thead><tbody>';

    for (var i = 0; i < idx.length; i++) {
      out += '<tr><td>' + esc(idx[i].roll) + '</td><td>' + esc(idx[i].groupLabel) + '</td><td>' +
             esc(idx[i].roomName) + '</td><td>' + esc(idx[i].seatLabel) + '</td></tr>';
    }

    els.index.innerHTML = out + '</tbody></table></div></section>';
  }

  /* One large-type sheet per room, for the hall door. */
  function renderNotices(plan) {
    var alloc = plan.allocation;
    if (!alloc.rooms.length) {
      els.notices.innerHTML = '<p class="esp-empty">Nothing to post yet.</p>';
      return;
    }

    var name = els.examName.value.trim();
    var date = els.examDate.value.trim();
    var out = '';

    for (var i = 0; i < alloc.rooms.length; i++) {
      var room = alloc.rooms[i];
      var rolls = [];
      for (var r = 0; r < room.rows; r++) {
        for (var c = 0; c < room.cols; c++) {
          if (room.grid[r][c]) rolls.push(room.grid[r][c].roll);
        }
      }
      if (!rolls.length) continue;

      rolls.sort(function (a, b) {
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
      });

      out += '<section class="esp-notice">';
      if (name) out += '<h3>' + esc(name) + '</h3>';
      out += '<p class="esp-notice-room">' + esc(room.name) + '</p>';
      if (date) out += '<p class="esp-room-meta">' + esc(date) + '</p>';
      // Escape each roll first, then join with a literal non-breaking space —
      // escaping the joined string would mangle the separator entity.
      var safe = [];
      for (var q = 0; q < rolls.length; q++) safe.push(esc(rolls[q]));
      out += '<p class="esp-notice-list">' + safe.join('&nbsp; &nbsp;') + '</p>';
      out += '<p class="esp-notice-foot">' + rolls.length +
             ' candidates. Find your seat number on the chart inside the hall.</p>';
      out += '</section>';
    }

    els.notices.innerHTML = out || '<p class="esp-empty">Nothing to post yet.</p>';
  }

  /* ----------------------------------------------------------------- run */

  function build() {
    var plan = E.plan(els.groups.value, els.rooms.value, readOptions());
    current = plan;

    renderMessages(plan);
    renderStats(plan);
    renderCharts(plan);
    renderRoomLists(plan);
    renderIndex(plan);
    renderNotices(plan);

    els.status.textContent = plan.summary.seated ? plan.summary.seated + ' seated' : 'Ready';
    els.csvBtn.disabled = !plan.index.length;
    els.printBtn.disabled = !plan.index.length;

    save();
  }

  /* ---------------------------------------------------------------- tabs */

  function selectTab(name) {
    var tabs = document.querySelectorAll('.esp-tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === name;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      var panel = $('esp-panel-' + tabs[i].getAttribute('data-tab'));
      if (panel) panel.hidden = !on;
    }
  }

  /* ---------------------------------------------------------------- wire */

  function init() {
    els.groups = $('espGroups');
    els.rooms = $('espRooms');
    els.examName = $('espExamName');
    els.examDate = $('espExamDate');
    els.order = $('espOrder');
    els.mix = $('espMix');
    els.spread = $('espSpread');
    els.showGroup = $('espShowGroup');
    els.showSeatNo = $('espShowSeatNo');

    els.messages = $('espMessages');
    els.stats = $('espStats');
    els.charts = $('espCharts');
    els.lists = $('espLists');
    els.index = $('espIndex');
    els.notices = $('espNotices');
    els.status = $('espStatus');

    els.csvBtn = $('espCsv');
    els.printBtn = $('espPrint');

    // A missing element means the markup and this file have drifted; stop
    // rather than throwing on every keystroke.
    for (var key in els) {
      if (Object.prototype.hasOwnProperty.call(els, key) && !els[key]) return;
    }

    restore();

    var inputs = [els.groups, els.rooms, els.examName, els.examDate,
                  els.order, els.mix, els.spread, els.showGroup, els.showSeatNo];
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', build);
      inputs[i].addEventListener('change', build);
    }

    var tabs = document.querySelectorAll('.esp-tab');
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener('click', function () {
        selectTab(this.getAttribute('data-tab'));
      });
    }

    els.csvBtn.addEventListener('click', function () {
      if (!current || !current.index.length) return;
      download(slug(els.examName.value) + '-seating.csv', E.toCSV(current.index), 'text/csv');
    });

    els.printBtn.addEventListener('click', function () { window.print(); });

    var resetBtn = $('espReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        // Kept in step with the textarea defaults in exam-seating-planner.html.
        // These numbers are chosen so the shipped example plans cleanly: 100
        // students into 108 seats, with no class over half the seats.
        els.groups.value = 'CSE 101-135\nECE 201-235\nMECH 301-330';
        els.rooms.value = 'Room 101 6x5\nRoom 102 6x5\nHall A 8x6';
        els.examName.value = '';
        els.examDate.value = '';
        els.order.value = 'row';
        els.mix.value = 'strict';
        els.spread.value = 'spread';
        els.showGroup.checked = true;
        els.showSeatNo.checked = true;
        build();
      });
    }

    selectTab('charts');
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
