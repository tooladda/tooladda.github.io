/* ============================================================================
   ToolAdda — Electron Configuration Builder
   ============================================================================ */

(function () {
  "use strict";

  var MIN_Z = 1;
  var MAX_Z = 118;
  var DEFAULT_Z = 6;

  /* Animation pacing at 1×: light atoms get the full 650 ms per electron, heavy
     ones speed up so a whole run stays near nine seconds (oganesson would
     otherwise take well over a minute). */
  var MAX_DELAY = 650;
  var MIN_DELAY = 90;
  var RUN_BUDGET = 9000;

  var TYPE_ORDER = { s: 0, p: 1, d: 2, f: 3 };
  var RULE_LABEL = { aufbau: "Aufbau principle", hund: "Hund's rule", pauli: "Pauli exclusion" };

  var state = {
    z: DEFAULT_Z,
    data: null,
    configMode: "both",
    view: "order",
    learning: false,
    anim: { playing: false, step: 0, speed: 1, timer: null },
    suggest: { items: [], active: -1 }
  };

  var cache = {};
  var els = {};

  function $(id) { return document.getElementById(id); }

  function getData(z) {
    if (!cache[z]) cache[z] = ElectronConfig.getElementConfig(z);
    return cache[z];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }

  function boot() {
    if (!window.ChemData || !window.ElectronConfig) {
      showFatal();
      return;
    }
    cacheDom();
    populateSelect();
    buildMiniTable();
    bindEvents();
    var z = readUrl();
    selectElement(z || DEFAULT_Z, { animate: false, keepUrl: !z });
  }

  function showFatal() {
    var app = $("ecb-app");
    if (!app) return;
    app.innerHTML = "<p class=\"ecb-error\">Element data failed to load. Please refresh the page.</p>";
  }

  function cacheDom() {
    [
      ["app", "ecb-app"], ["search", "ecb-search"], ["suggest", "ecb-suggest"], ["atomicInput", "ecb-atomic"],
      ["atomicError", "ecb-atomic-error"], ["select", "ecb-select"], ["prev", "ecb-prev"],
      ["next", "ecb-next"], ["random", "ecb-random"], ["reset", "ecb-reset"], ["share", "ecb-share"],
      ["live", "ecb-live"], ["learningToggle", "ecb-learning-toggle"], ["learnPanel", "ecb-learn-panel"],
      ["head", "ecb-element-head"], ["exception", "ecb-exception"], ["predicted", "ecb-predicted"],
      ["configFull", "ecb-config-full"], ["configNoble", "ecb-config-noble"], ["configTabs", "ecb-config-tabs"],
      ["blockFull", "ecb-block-full"], ["blockNoble", "ecb-block-noble"], ["chargeCard", "ecb-charge-card"],
      ["atom", "ecb-atom"], ["shells", "ecb-shells-list"], ["orbitals", "ecb-orbitals"],
      ["viewToggle", "ecb-orbital-view"], ["table", "ecb-table-body"], ["aufbau", "ecb-aufbau-track"],
      ["miniGrid", "ecb-mini-grid"], ["play", "ecb-play"], ["pause", "ecb-pause"], ["replay", "ecb-replay"],
      ["stepBtn", "ecb-step"], ["speed", "ecb-speed"], ["scrub", "ecb-scrub"], ["scrubOut", "ecb-scrub-out"],
      ["stepInfo", "ecb-step-info"]
    ].forEach(function (pair) { els[pair[0]] = $(pair[1]); });
    els.quick = document.querySelector(".ecb-quick");
    els.miniScroll = document.querySelector(".ecb-mini-scroll");
  }

  function populateSelect() {
    els.select.innerHTML = ChemData.elements.map(function (el) {
      return "<option value=\"" + el.z + "\">" + el.name + " (" + el.symbol + ") — " + el.z + "</option>";
    }).join("");
  }

  /* ------------------------------------------------------------------------
     Mini periodic table — every tile is placed on the 18-column grid from its
     period and group; the f-block sits in two rows underneath.
     ------------------------------------------------------------------------ */
  function tilePosition(el) {
    if (el.group === null) {
      var first = el.period === 6 ? 57 : 89;
      return { row: el.period === 6 ? 9 : 10, col: 3 + (el.z - first) };
    }
    return { row: el.period, col: el.group };
  }

  function buildMiniTable() {
    var html = "";
    ChemData.elements.forEach(function (el) {
      var pos = tilePosition(el);
      html += "<button type=\"button\" class=\"ecb-mini-tile\" data-z=\"" + el.z + "\" data-type=\"" + el.block + "\"" +
        " data-row=\"" + pos.row + "\" data-col=\"" + pos.col + "\" tabindex=\"-1\" aria-pressed=\"false\"" +
        " style=\"grid-row:" + pos.row + ";grid-column:" + pos.col + "\"" +
        " title=\"" + el.name + " (" + el.symbol + ") — " + el.z + "\" aria-label=\"" + el.name + ", " + el.z + "\">" +
        "<span class=\"ecb-mini-tile__z\" aria-hidden=\"true\">" + el.z + "</span>" +
        "<span class=\"ecb-mini-tile__sym\" aria-hidden=\"true\">" + el.symbol + "</span>" +
      "</button>";
    });
    html += "<span class=\"ecb-mini-marker\" style=\"grid-row:6;grid-column:3\" aria-hidden=\"true\">57–71</span>";
    html += "<span class=\"ecb-mini-marker\" style=\"grid-row:7;grid-column:3\" aria-hidden=\"true\">89–103</span>";
    els.miniGrid.innerHTML = html;

    els.tiles = {};
    els.tileAt = {};
    els.miniGrid.querySelectorAll(".ecb-mini-tile").forEach(function (t) {
      els.tiles[t.dataset.z] = t;
      els.tileAt[t.dataset.row + ":" + t.dataset.col] = t;
    });
  }

  function onMiniKeydown(e) {
    var tile = e.target.closest(".ecb-mini-tile");
    if (!tile || e.altKey || e.ctrlKey || e.metaKey) return;
    var row = +tile.dataset.row;
    var col = +tile.dataset.col;
    var target = null;
    var r, c, d;

    function at(rr, cc) { return els.tileAt[rr + ":" + cc] || null; }
    /* Nearest tile to column `cc` in row `rr`, for rows with gaps. */
    function nearestInRow(rr, cc) {
      for (d = 0; d < 18; d++) {
        if (at(rr, cc - d)) return at(rr, cc - d);
        if (at(rr, cc + d)) return at(rr, cc + d);
      }
      return null;
    }

    switch (e.key) {
      case "ArrowRight":
        for (c = col + 1; c <= 18 && !target; c++) target = at(row, c);
        break;
      case "ArrowLeft":
        for (c = col - 1; c >= 1 && !target; c--) target = at(row, c);
        break;
      case "ArrowDown":
        for (r = row + 1; r <= 10 && !target; r++) target = r === 8 ? null : nearestInRow(r, col);
        break;
      case "ArrowUp":
        for (r = row - 1; r >= 1 && !target; r--) target = r === 8 ? null : nearestInRow(r, col);
        break;
      case "Home":
        target = nearestInRow(row, 1);
        break;
      case "End":
        target = nearestInRow(row, 18);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (target) {
      tile.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    }
  }

  /* ------------------------------------------------------------------------
     Events
     ------------------------------------------------------------------------ */
  function bindEvents() {
    els.search.addEventListener("input", onSearchInput);
    els.search.addEventListener("keydown", onSearchKeydown);
    els.search.addEventListener("focus", function () { els.search.select(); });
    els.search.addEventListener("blur", hideSuggest);
    /* Keep focus in the input while a suggestion is clicked. */
    els.suggest.addEventListener("mousedown", function (e) { e.preventDefault(); });
    els.suggest.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-z]");
      if (opt) chooseSuggestion(+opt.dataset.z);
    });

    els.atomicInput.addEventListener("input", onAtomicInput);
    els.atomicInput.addEventListener("change", onAtomicChange);
    els.select.addEventListener("change", function () { selectElement(+els.select.value); });

    els.prev.addEventListener("click", function () { selectElement(state.z - 1); });
    els.next.addEventListener("click", function () { selectElement(state.z + 1); });
    els.reset.addEventListener("click", function () { selectElement(DEFAULT_Z); });
    els.random.addEventListener("click", function () {
      var z;
      do { z = MIN_Z + Math.floor(Math.random() * MAX_Z); } while (z === state.z);
      selectElement(z);
    });
    els.quick.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-z]");
      if (btn) selectElement(+btn.dataset.z);
    });
    els.share.addEventListener("click", function () {
      copyText(location.href, els.share.querySelector("span"), "Link copied", "Copy link");
    });

    els.configTabs.addEventListener("click", onConfigTab);
    document.querySelectorAll(".ecb-copy").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.dataset.copy === "full" ? state.data.fullConfig : state.data.nobleConfig;
        copyText(ElectronConfig.toSuperscript(text), btn, "Copied", "Copy");
      });
    });

    els.viewToggle.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-view]");
      if (!btn || btn.dataset.view === state.view) return;
      state.view = btn.dataset.view;
      setPressed(els.viewToggle, btn);
      showStep(state.anim.step);
    });

    els.learningToggle.addEventListener("change", function () {
      state.learning = els.learningToggle.checked;
      els.learnPanel.hidden = !state.learning;
      showStep(state.anim.step);
    });

    els.play.addEventListener("click", startAnimation);
    els.pause.addEventListener("click", pauseAnimation);
    els.replay.addEventListener("click", replayAnimation);
    els.stepBtn.addEventListener("click", stepAnimation);
    els.speed.addEventListener("change", function () {
      state.anim.speed = parseFloat(els.speed.value) || 1;
      if (state.anim.playing) {
        clearTimeout(state.anim.timer);
        scheduleTick();
      }
    });
    els.scrub.addEventListener("input", function () {
      pauseAnimation();
      showStep(+els.scrub.value);
    });

    els.miniGrid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-z]");
      if (btn) selectElement(+btn.dataset.z);
    });
    els.miniGrid.addEventListener("keydown", onMiniKeydown);

    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (e.target.closest && e.target.closest("input, select, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft" && state.z > MIN_Z) { e.preventDefault(); selectElement(state.z - 1); }
      if (e.key === "ArrowRight" && state.z < MAX_Z) { e.preventDefault(); selectElement(state.z + 1); }
    });
  }

  function setPressed(group, active) {
    group.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", b === active ? "true" : "false");
    });
  }

  /* ?element=8 or ?element=Fe */
  function readUrl() {
    var m = /[?&]element=([^&#]+)/i.exec(location.search);
    if (!m) return null;
    var raw = decodeURIComponent(m[1]).trim();
    if (/^\d+$/.test(raw)) {
      var z = parseInt(raw, 10);
      return z >= MIN_Z && z <= MAX_Z ? z : null;
    }
    var el = ChemData.bySymbol(raw);
    return el ? el.z : null;
  }

  function updateUrl(z) {
    try {
      var url = new URL(location.href);
      url.searchParams.set("element", String(z));
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) { /* file:// or a sandboxed frame */ }
  }

  function copyText(text, labelEl, done, idle) {
    function feedback(ok) {
      labelEl.textContent = ok ? done : "Copy failed";
      labelEl.closest("button").classList.toggle("is-done", ok);
      announce(ok ? done + "." : "Copy failed.");
      clearTimeout(labelEl._t);
      labelEl._t = setTimeout(function () {
        labelEl.textContent = idle;
        labelEl.closest("button").classList.remove("is-done");
      }, 1600);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      feedback(ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { feedback(true); }, fallback);
    } else {
      fallback();
    }
  }

  function announce(msg) {
    els.live.textContent = "";
    setTimeout(function () { els.live.textContent = msg; }, 30);
  }

  /* ------------------------------------------------------------------------
     Atomic number field
     ------------------------------------------------------------------------ */
  function validateAtomic(val) {
    var n = parseInt(val, 10);
    if (val === "" || isNaN(n) || String(n) !== String(val).trim() || n < MIN_Z || n > MAX_Z) return { ok: false };
    return { ok: true, n: n };
  }

  function setAtomicError(show) {
    els.atomicError.hidden = !show;
    els.atomicInput.setAttribute("aria-invalid", show ? "true" : "false");
  }

  function onAtomicInput() {
    var val = els.atomicInput.value.trim();
    setAtomicError(val !== "" && !validateAtomic(val).ok);
  }

  function onAtomicChange() {
    var v = validateAtomic(els.atomicInput.value.trim());
    if (v.ok) selectElement(v.n);
    else setAtomicError(true);
  }

  /* ------------------------------------------------------------------------
     Search combobox
     ------------------------------------------------------------------------ */
  function onSearchInput() {
    var q = els.search.value.trim();
    if (!q) { hideSuggest(); return; }
    var hits = ElectronConfig.searchElements(q, 8);
    state.suggest.items = hits;
    state.suggest.active = hits.length ? 0 : -1;
    if (!hits.length) {
      els.suggest.innerHTML = "<li class=\"ecb-suggest__empty\" role=\"option\" aria-disabled=\"true\" aria-selected=\"false\">No element matches “" + escapeHtml(q) + "”</li>";
    } else {
      els.suggest.innerHTML = hits.map(function (el, i) {
        return "<li role=\"option\" id=\"ecb-opt-" + i + "\" data-z=\"" + el.z + "\" data-type=\"" + el.block + "\" aria-selected=\"false\">" +
          "<span class=\"ecb-suggest__sym\">" + el.symbol + "</span>" +
          "<span class=\"ecb-suggest__name\">" + el.name + "</span>" +
          "<span class=\"ecb-suggest__meta\">" + el.z + " · " + el.block + "-block</span></li>";
      }).join("");
    }
    els.suggest.hidden = false;
    els.search.setAttribute("aria-expanded", "true");
    paintActiveSuggestion();
  }

  function paintActiveSuggestion() {
    var opts = els.suggest.querySelectorAll("[data-z]");
    opts.forEach(function (o, i) {
      var on = i === state.suggest.active;
      o.classList.toggle("is-active", on);
      o.setAttribute("aria-selected", on ? "true" : "false");
      if (on) o.scrollIntoView({ block: "nearest" });
    });
    if (state.suggest.active >= 0) els.search.setAttribute("aria-activedescendant", "ecb-opt-" + state.suggest.active);
    else els.search.removeAttribute("aria-activedescendant");
  }

  function onSearchKeydown(e) {
    var open = !els.suggest.hidden;
    var count = state.suggest.items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) { if (els.search.value.trim()) onSearchInput(); e.preventDefault(); return; }
      if (!count) return;
      e.preventDefault();
      var delta = e.key === "ArrowDown" ? 1 : -1;
      state.suggest.active = (state.suggest.active + delta + count) % count;
      paintActiveSuggestion();
    } else if (e.key === "Enter") {
      if (open && state.suggest.active >= 0) {
        e.preventDefault();
        chooseSuggestion(state.suggest.items[state.suggest.active].z);
      }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); hideSuggest(); }
    }
  }

  function chooseSuggestion(z) {
    hideSuggest();
    selectElement(z);
    els.search.select();
  }

  function hideSuggest() {
    els.suggest.hidden = true;
    els.suggest.innerHTML = "";
    state.suggest.items = [];
    state.suggest.active = -1;
    els.search.setAttribute("aria-expanded", "false");
    els.search.removeAttribute("aria-activedescendant");
  }

  /* ------------------------------------------------------------------------
     Configuration display mode
     ------------------------------------------------------------------------ */
  function onConfigTab(e) {
    var btn = e.target.closest("[data-mode]");
    if (!btn) return;
    state.configMode = btn.dataset.mode;
    setPressed(els.configTabs, btn);
    applyConfigVisibility();
  }

  function applyConfigVisibility() {
    els.blockFull.hidden = state.configMode === "noble";
    els.blockNoble.hidden = state.configMode === "full";
  }

  /* ------------------------------------------------------------------------
     Selecting an element
     ------------------------------------------------------------------------ */
  function selectElement(z, opts) {
    opts = opts || {};
    if (!(z >= MIN_Z && z <= MAX_Z)) return;
    var data = getData(z);
    if (!data) return;
    pauseAnimation();
    state.z = z;
    state.data = data;

    els.select.value = String(z);
    els.atomicInput.value = String(z);
    setAtomicError(false);
    els.search.value = data.element.name;
    els.prev.disabled = z <= MIN_Z;
    els.next.disabled = z >= MAX_Z;

    renderHead(data);
    renderNotes(data);
    renderConfig(data);
    renderTable(data);
    highlightMiniTile(z);
    els.quick.querySelectorAll("[data-z]").forEach(function (b) {
      b.setAttribute("aria-pressed", +b.dataset.z === z ? "true" : "false");
    });

    els.scrub.max = String(data.steps.length);

    if (opts.animate !== false && !prefersReducedMotion()) {
      replayAnimation();
    } else {
      showStep(data.steps.length);
    }

    if (!opts.keepUrl) updateUrl(z);
    announce(data.element.name + " (" + data.element.symbol + ") selected. Electron configuration " + data.nobleConfig + ".");
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function renderHead(data) {
    var el = data.element;
    els.head.setAttribute("data-cat", el.category);
    els.head.innerHTML =
      "<div class=\"ecb-glyph\" aria-hidden=\"true\">" +
        "<span class=\"ecb-glyph__z\">" + el.z + "</span>" +
        "<span class=\"ecb-glyph__sym\">" + el.symbol + "</span>" +
        "<span class=\"ecb-glyph__mass\">" + ElectronConfig.formatMass(el) + "</span>" +
      "</div>" +
      "<div class=\"ecb-element-head__body\">" +
        "<div class=\"ecb-element-head__title\">" +
          "<h2>" + el.name + "</h2>" +
          "<span class=\"ecb-cat-chip\">" + el.categoryLabel + "</span>" +
        "</div>" +
        "<dl class=\"ecb-meta-grid\">" +
          dtdd("Period", el.period) +
          dtdd("Group", el.group === null ? "f-block" : el.group) +
          dtdd("Block", "<span class=\"ecb-block-tag\" data-type=\"" + el.block + "\">" + el.block + "</span>") +
        "</dl>" +
      "</div>";
  }

  function dtdd(label, value) {
    return "<div><dt>" + label + "</dt><dd>" + value + "</dd></div>";
  }

  function renderNotes(data) {
    var sup = ElectronConfig.toSuperscript;
    els.exception.hidden = !data.isException;
    if (data.isException) {
      els.exception.innerHTML =
        "<strong>Ground-state exception.</strong> Filling strictly in Aufbau order predicts " +
        "<span class=\"ecb-mono\">" + sup(data.aufbauPrediction) + "</span>, but the accepted configuration is " +
        "<span class=\"ecb-mono\">" + sup(data.nobleConfig) + "</span>.";
    }
    els.predicted.hidden = !data.isPredicted;
    if (data.isPredicted) {
      els.predicted.innerHTML =
        "<strong>Predicted configuration.</strong> Elements 104–118 have only been made a few atoms at a time, " +
        "so this ground state comes from theory rather than measurement.";
    }
  }

  function renderConfig(data) {
    els.configFull.innerHTML = configHtml(data.fullConfig);
    els.configNoble.innerHTML = configHtml(data.nobleConfig);

    var outer = data.outerShell;
    var magnetic = data.unpaired > 0 ? "Paramagnetic" : "Diamagnetic";
    els.chargeCard.innerHTML =
      stat("Protons", data.element.z) +
      stat("Electrons", data.electrons) +
      stat("Charge", "0", "neutral atom") +
      stat("Unpaired e⁻", data.unpaired) +
      stat("Atom is", magnetic, data.unpaired > 0 ? "has unpaired electrons" : "all electrons paired") +
      stat("Outer shell", outer.count + " e⁻", outer.label + " shell, n = " + outer.n);
    applyConfigVisibility();
  }

  /* Each subshell becomes a chip coloured by its type. */
  function configHtml(config) {
    return String(config).split(/\s+/).map(function (part) {
      var m = /^(\d)([spdf])(\d+)$/.exec(part);
      if (!m) return "<span class=\"ecb-cfg-core\">" + part + "</span>";
      return "<span class=\"ecb-cfg-sub\" data-type=\"" + m[2] + "\">" + m[1] + m[2] + "<sup>" + m[3] + "</sup></span>";
    }).join(" ");
  }

  function stat(label, value, hint) {
    return "<div class=\"ecb-stat\"><span class=\"ecb-stat__label\">" + label + "</span>" +
      "<strong class=\"ecb-stat__value\">" + value + "</strong>" +
      (hint ? "<span class=\"ecb-stat__hint\">" + hint + "</span>" : "") + "</div>";
  }

  function renderTable(data) {
    els.table.innerHTML = data.orbitals.map(function (sub) {
      var unpaired = sub.boxes.filter(function (b) { return b === 1; }).length;
      var pct = Math.round(sub.count / sub.capacity * 100);
      return "<tr>" +
        "<th scope=\"row\"><span class=\"ecb-dot\" data-type=\"" + sub.type + "\" aria-hidden=\"true\"></span>" + sub.key + "</th>" +
        "<td>" + sub.boxes.length + "</td>" +
        "<td>" + sub.capacity + "</td>" +
        "<td><span class=\"ecb-occ\"><span class=\"ecb-occ__bar\" data-type=\"" + sub.type + "\" aria-hidden=\"true\"><i style=\"width:" + pct + "%\"></i></span>" +
          sub.count + (sub.count === sub.capacity ? " <span class=\"ecb-occ__full\">full</span>" : "") + "</span></td>" +
        "<td>" + unpaired + "</td>" +
      "</tr>";
    }).join("");
  }

  /* Roving tabindex: only the selected tile is in the tab order. */
  function highlightMiniTile(z) {
    Object.keys(els.tiles).forEach(function (key) {
      var t = els.tiles[key];
      var on = +key === z;
      t.classList.toggle("is-selected", on);
      t.setAttribute("aria-pressed", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    revealMiniTile(els.tiles[z]);
  }

  /* On narrow screens the table scrolls sideways; bring the selected tile
     into view without moving the page. */
  function revealMiniTile(tile) {
    var box = els.miniScroll;
    if (!tile || !box || box.scrollWidth <= box.clientWidth) return;
    var t = tile.getBoundingClientRect();
    var b = box.getBoundingClientRect();
    if (t.left >= b.left && t.right <= b.right) return;
    box.scrollLeft += (t.left - b.left) - (b.width - t.width) / 2;
  }

  /* ------------------------------------------------------------------------
     One animation frame: `k` electrons placed (0 … total). Every visual that
     depends on the electron count is drawn from here. `live` marks a frame
     reached by Play or Step, so the final electron still gets explained.
     ------------------------------------------------------------------------ */
  function showStep(k, live) {
    var data = state.data;
    var total = data.steps.length;
    k = Math.max(0, Math.min(total, k));
    state.anim.step = k;

    var step = k > 0 ? data.steps[k - 1] : null;
    var snapshot = step ? step.snapshot : emptySnapshot(data);
    var current = k > 0 && (k < total || live) ? step : null;

    renderOrbitals(data, snapshot, current);
    renderShells(data, ElectronConfig.shellCountsFromSnapshot(snapshot), current);
    renderAufbau(data, snapshot, current);

    els.scrub.value = String(k);
    els.scrubOut.textContent = k + " / " + total;
    els.scrub.style.setProperty("--pct", (total ? k / total * 100 : 0) + "%");
    els.scrub.setAttribute("aria-valuetext", k + " of " + total + " electrons placed");

    renderStepInfo(data, k, current);

    els.learnPanel.querySelectorAll("[data-rule]").forEach(function (p) {
      p.classList.toggle("is-active", !!current && p.dataset.rule === current.rule);
    });
  }

  function emptySnapshot(data) {
    var snap = {};
    data.orbitals.forEach(function (sub) {
      snap[sub.key] = sub.boxes.map(function () { return 0; });
    });
    return snap;
  }

  /* Which box the electron of this step landed in: the first pass fills boxes
     left to right, the second pass pairs them in the same order. */
  function activeBoxIndex(step, orbitalCount) {
    var e = step.electronIndex;
    return e <= orbitalCount ? e - 1 : e - orbitalCount - 1;
  }

  function subshellHtml(sub, boxes, current) {
    var filled = boxes.reduce(function (s, b) { return s + b; }, 0);
    var unpaired = boxes.filter(function (b) { return b === 1; }).length;
    var isCurrent = current && current.subshell === sub.key;
    var activeIdx = isCurrent ? activeBoxIndex(current, boxes.length) : -1;

    var boxHtml = boxes.map(function (count, idx) {
      var cls = "ecb-box";
      if (count) cls += " is-filled";
      if (idx === activeIdx) cls += " is-active";
      var up = count >= 1 ? "<span class=\"ecb-spin-up" + (idx === activeIdx && count === 1 ? " is-new" : "") + "\">↑</span>" : "";
      var down = count === 2 ? "<span class=\"ecb-spin-down" + (idx === activeIdx ? " is-new" : "") + "\">↓</span>" : "";
      return "<span class=\"" + cls + "\" aria-hidden=\"true\">" + up + down + "</span>";
    }).join("");

    var label = sub.key + ": " + filled + " of " + sub.capacity + " electrons in " + boxes.length +
      (boxes.length === 1 ? " orbital" : " orbitals") + ", " + unpaired + " unpaired";

    return "<div class=\"ecb-sub" + (isCurrent ? " is-current" : "") + (filled ? "" : " is-empty") + "\" data-type=\"" + sub.type + "\">" +
      "<div class=\"ecb-sub__boxes\" role=\"img\" aria-label=\"" + label + "\">" + boxHtml + "</div>" +
      "<div class=\"ecb-sub__label\" aria-hidden=\"true\"><b>" + sub.key + "</b><span>" + filled + "/" + sub.capacity + "</span></div>" +
    "</div>";
  }

  function renderOrbitals(data, snapshot, current) {
    var html;
    if (state.view === "shell") {
      var byShell = {};
      data.orbitals.forEach(function (sub) { (byShell[sub.n] = byShell[sub.n] || []).push(sub); });
      html = Object.keys(byShell).sort().map(function (n) {
        var subs = byShell[n].slice().sort(function (a, b) { return TYPE_ORDER[a.type] - TYPE_ORDER[b.type]; });
        return "<div class=\"ecb-shell-row\">" +
          "<span class=\"ecb-shell-row__n\">n = " + n + "<small>" + ElectronConfig.SHELL_LABELS[n - 1] + " shell</small></span>" +
          "<div class=\"ecb-shell-row__subs\">" +
            subs.map(function (sub) { return subshellHtml(sub, snapshot[sub.key], current); }).join("") +
          "</div></div>";
      }).join("");
      els.orbitals.className = "ecb-orbital-map is-by-shell";
    } else {
      html = data.orbitals.map(function (sub) { return subshellHtml(sub, snapshot[sub.key], current); }).join("");
      els.orbitals.className = "ecb-orbital-map is-by-order";
    }
    els.orbitals.innerHTML = html;
  }

  /* Shell model: concentric rings with evenly spaced electrons, plus a bar per
     shell against its 2n² capacity. */
  function renderShells(data, counts, current) {
    var shells = data.shells;
    var maxN = shells[shells.length - 1].n;
    var c = 120;
    var inner = 40;
    var outer = 110;
    var gap = maxN > 1 ? Math.min(24, (outer - inner) / (maxN - 1)) : 0;
    var dotR = Math.max(2.6, Math.min(4.4, gap ? gap * 0.3 : 4.4));
    var currentN = current ? parseInt(current.subshell.charAt(0), 10) : 0;

    var svg = "<svg viewBox=\"0 0 240 240\" role=\"img\" aria-label=\"Shell diagram of " + data.element.name + ": " +
      shells.map(function (s) { return s.label + " " + (counts[s.n] || 0); }).join(", ") + "\">" +
      "<defs><radialGradient id=\"ecb-nucleus\" cx=\"35%\" cy=\"30%\" r=\"75%\">" +
        "<stop offset=\"0\" stop-color=\"var(--nucleus-hi)\"/><stop offset=\"1\" stop-color=\"var(--nucleus-lo)\"/>" +
      "</radialGradient></defs>";

    shells.forEach(function (s) {
      var r = inner + (s.n - 1) * gap;
      var count = counts[s.n] || 0;
      svg += "<circle class=\"ecb-ring" + (s.n === currentN ? " is-current" : "") + "\" cx=\"" + c + "\" cy=\"" + c + "\" r=\"" + r.toFixed(2) + "\"/>";
      for (var i = 0; i < count; i++) {
        var a = -Math.PI / 2 + (i / count) * Math.PI * 2;
        svg += "<circle class=\"ecb-electron\" cx=\"" + (c + r * Math.cos(a)).toFixed(2) + "\" cy=\"" + (c + r * Math.sin(a)).toFixed(2) + "\" r=\"" + dotR.toFixed(2) + "\"/>";
      }
    });

    svg += "<circle class=\"ecb-nucleus\" cx=\"" + c + "\" cy=\"" + c + "\" r=\"24\" fill=\"url(#ecb-nucleus)\"/>" +
      "<text class=\"ecb-nucleus-sym\" x=\"" + c + "\" y=\"" + (c - 2) + "\">" + data.element.symbol + "</text>" +
      "<text class=\"ecb-nucleus-z\" x=\"" + c + "\" y=\"" + (c + 11) + "\">" + data.element.z + "+</text>" +
      "</svg>";
    els.atom.innerHTML = svg;

    els.shells.innerHTML = shells.map(function (s) {
      var count = counts[s.n] || 0;
      var cap = 2 * s.n * s.n;
      return "<div class=\"ecb-shell-item" + (s.n === currentN ? " is-current" : "") + "\">" +
        "<span class=\"ecb-shell-item__badge\" aria-hidden=\"true\">" + s.label + "</span>" +
        "<span class=\"ecb-shell-item__label\">" + s.label + " shell <small>(n = " + s.n + ")</small></span>" +
        "<span class=\"ecb-shell-item__count\">" + count + " e<sup>−</sup></span>" +
        "<span class=\"ecb-shell-item__bar\" aria-hidden=\"true\"><i style=\"width:" + (count / cap * 100).toFixed(1) + "%\"></i></span>" +
        "<span class=\"ecb-shell-item__cap\">max " + cap + "</span>" +
      "</div>";
    }).join("");
  }

  function renderAufbau(data, snapshot, current) {
    var inConfig = {};
    data.orbitals.forEach(function (sub) { inConfig[sub.key] = true; });
    els.aufbau.innerHTML = ElectronConfig.AUFBAU_ORDER.map(function (key) {
      var type = key.charAt(1);
      var cap = ElectronConfig.SUBSHELL_MAX[type];
      var count = snapshot[key] ? snapshot[key].reduce(function (s, b) { return s + b; }, 0) : 0;
      var cls = "ecb-aufbau-item";
      if (count === cap) cls += " is-filled";
      else if (count > 0) cls += " is-partial";
      if (current && current.subshell === key) cls += " is-current";
      if (!inConfig[key]) cls += " is-unused";
      return "<li class=\"" + cls + "\" data-type=\"" + type + "\" style=\"--fill:" + (count / cap).toFixed(3) + "\">" +
        key + (count ? "<sup>" + count + "</sup>" : "") + "</li>";
    }).join("");
  }

  function renderStepInfo(data, k, current) {
    var total = data.steps.length;
    var html;
    if (current) {
      html = "<span class=\"ecb-rule\" data-rule=\"" + current.rule + "\">" + RULE_LABEL[current.rule] + "</span> " +
        "<strong>Electron " + k + " of " + total + "</strong> goes into <strong>" + current.subshell + "</strong>. " +
        current.explanation;
      if (k === total) {
        html += " <span class=\"ecb-step-done\">That completes " + data.element.name + ": <span class=\"ecb-mono\">" +
          ElectronConfig.toSuperscript(data.nobleConfig) + "</span></span>";
      }
    } else if (k === 0) {
      html = "Press Play to animate electron filling, or Step to advance one electron at a time.";
    } else {
      html = "<span class=\"ecb-rule ecb-rule--done\">Complete</span> " + data.element.name + " has " + data.electrons +
        " electrons: <span class=\"ecb-mono\">" + ElectronConfig.toSuperscript(data.fullConfig) + "</span>." +
        (state.anim.playing ? "" : " Press Play or Step to watch them fill.");
    }
    els.stepInfo.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Animation controls
     ------------------------------------------------------------------------ */
  function stepDelay() {
    var total = state.data.steps.length || 1;
    var base = Math.max(MIN_DELAY, Math.min(MAX_DELAY, RUN_BUDGET / total));
    return Math.round(base / state.anim.speed);
  }

  function setPlayingUi(playing) {
    els.play.disabled = playing;
    els.pause.disabled = !playing;
    els.app.classList.toggle("is-playing", playing);
  }

  function startAnimation() {
    var total = state.data.steps.length;
    if (!total) return;
    if (prefersReducedMotion()) {
      showStep(total);
      return;
    }
    if (state.anim.step >= total) showStep(0);
    state.anim.playing = true;
    setPlayingUi(true);
    tick();
  }

  function scheduleTick() {
    state.anim.timer = setTimeout(tick, stepDelay());
  }

  function tick() {
    if (!state.anim.playing) return;
    var total = state.data.steps.length;
    var next = state.anim.step + 1;
    if (next >= total) {
      pauseAnimation();
      showStep(total, true);
      return;
    }
    showStep(next, true);
    scheduleTick();
  }

  function pauseAnimation() {
    state.anim.playing = false;
    if (state.anim.timer) {
      clearTimeout(state.anim.timer);
      state.anim.timer = null;
    }
    if (els.play) setPlayingUi(false);
  }

  function replayAnimation() {
    pauseAnimation();
    showStep(0);
    startAnimation();
  }

  function stepAnimation() {
    pauseAnimation();
    var total = state.data.steps.length;
    showStep(state.anim.step >= total ? 1 : state.anim.step + 1, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
