/* ============================================================================
   ToolAdda — Interactive Periodic Table
   Vanilla JS, no dependencies. Reads the shared dataset from
   /chemistry-tools/data/elements.js (window.ChemData).

   Structure
     state            single source of truth for search / filters / view
     init*            wiring, run once
     render*          DOM production
     filter/search    matching rules
     select/show      element detail panel
     compare*         two-element comparison dialog
     favourites/recent/share/deep-link
   ============================================================================ */

(function () {
  "use strict";

  var LS_FAVOURITES = "tooladda.periodic.favourites";
  var LS_RECENT = "tooladda.periodic.recent";
  var RECENT_MAX = 8;
  /* Must match the side-panel breakpoint in periodic-table.css: below this
     width the details panel is an overlay drawer rather than a column. */
  var SIDE_PANEL_MIN = 1500;

  /* Trait families. Within a family the options are OR-ed, across families
     they are AND-ed, so "Metals + Solids" narrows while "Gases + Liquids"
     widens. That keeps multi-select filtering predictable. */
  var TRAITS = {
    metals:      { family: "class", label: "Metals",      test: function (el) { return el.metal; } },
    /* Metalloids are their own class, so Nonmetals excludes them. Metals,
       nonmetals, metalloids and the unclassified superheavies then partition
       all 118 elements exactly once: 84 + 18 + 6 + 10. */
    nonmetals:   { family: "class", label: "Nonmetals",   test: function (el) { return !el.metal && el.category !== "unknown" && el.category !== "metalloid"; } },
    metalloids:  { family: "class", label: "Metalloids",  test: function (el) { return el.category === "metalloid"; } },
    gases:       { family: "state", label: "Gases",       test: function (el) { return el.state === "gas"; } },
    liquids:     { family: "state", label: "Liquids",     test: function (el) { return el.state === "liquid"; } },
    solids:      { family: "state", label: "Solids",      test: function (el) { return el.state === "solid"; } },
    radioactive: { family: "radio", label: "Radioactive", test: function (el) { return el.radioactive; } }
  };

  var state = {
    query: "",
    categories: [],   // category keys; empty means "any"
    traits: [],       // keys of TRAITS; empty means "any"
    colorMode: "category",
    selected: null,   // atomic number
    matches: [],      // atomic numbers currently matching
    topHit: null
  };

  var data = null;
  var els = {};        // cached DOM references
  var tiles = {};      // atomic number -> button
  var rows = {};       // atomic number -> summary table row
  var ranges = {};     // property -> {min,max} for the normalised bars
  var favourites = [];
  var recent = [];
  var hitTimer = null;
  var sheetHome = null;

  function useSheetOverlay() {
    return window.innerWidth < SIDE_PANEL_MIN;
  }

  function mountMobileSheet() {
    if (!useSheetOverlay() || !els.details || !els.backdrop) return;
    if (!sheetHome) {
      sheetHome = {
        details: els.details.parentNode,
        backdrop: els.backdrop.parentNode
      };
    }
    if (els.backdrop.parentNode !== document.body) {
      document.body.appendChild(els.backdrop);
      document.body.appendChild(els.details);
    }
  }

  function restoreMobileSheet() {
    if (!sheetHome || els.details.parentNode !== document.body) return;
    sheetHome.backdrop.appendChild(els.backdrop);
    sheetHome.details.appendChild(els.details);
  }

  function lockPageScroll() {
    document.documentElement.style.overflow = "hidden";
  }

  function unlockPageScroll() {
    document.documentElement.style.overflow = "";
  }

  /* ==========================================================================
     BOOT
     ========================================================================== */

  function initializePeriodicTable() {
    if (!window.ChemData || !window.ChemData.elements || window.ChemData.elements.length !== 118) {
      showFatalError();
      return;
    }
    data = window.ChemData;

    cacheDom();
    computeRanges();
    favourites = readStore(LS_FAVOURITES);
    recent = readStore(LS_RECENT);

    renderTable();
    renderLegend();
    renderCategoryFilters();
    populateCompareSelects();
    indexSummaryRows();
    bindEvents();

    applyFilters();
    renderRecent();
    openFromUrl();
  }

  function showFatalError() {
    var host = document.getElementById("pt-app");
    if (!host) return;
    host.innerHTML =
      '<p class="pt-error"><strong>Element data could not be loaded.</strong> ' +
      "Please refresh the page. If the problem continues, the data file " +
      "(/chemistry-tools/data/elements.js) may be blocked or incomplete. " +
      "The element table further down this page still lists every element.</p>";
  }

  function cacheDom() {
    var id = function (x) { return document.getElementById(x); };
    els.grid = id("pt-grid");
    els.viewport = id("pt-viewport");
    els.search = id("pt-search");
    els.searchClear = id("pt-search-clear");
    els.categorySelect = id("pt-category-select");
    els.stateSelect = id("pt-state-select");
    els.colorSelect = id("pt-color-select");
    els.quick = id("pt-quick");
    els.categoryFilters = id("pt-category-filters");
    els.legend = id("pt-legend");
    els.count = id("pt-count");
    els.activeFilters = id("pt-active-filters");
    els.empty = id("pt-empty");
    els.details = id("pt-details");
    els.detailsInner = id("pt-details-inner");
    els.backdrop = id("pt-backdrop");
    els.tooltip = id("pt-tooltip");
    els.clearBtn = id("pt-clear");
    els.resetBtn = id("pt-reset");
    els.compareBtn = id("pt-compare-open");
    els.dialog = id("pt-compare-dialog");
    els.compareA = id("pt-compare-a");
    els.compareB = id("pt-compare-b");
    els.compareRun = id("pt-compare-run");
    els.compareOut = id("pt-compare-output");
    els.recent = id("pt-recent");
    els.recentList = id("pt-recent-list");
    els.tableBody = id("pt-summary-body");
    els.tableCount = id("pt-summary-count");
  }

  /** Min/max of each numeric property, used to normalise the detail bars. */
  function computeRanges() {
    ["en", "mass", "radius", "ie"].forEach(function (key) {
      var values = data.elements
        .map(function (el) { return el[key]; })
        .filter(function (v) { return typeof v === "number"; });
      ranges[key] = { min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
    });
  }

  /* ==========================================================================
     RENDERING — THE TABLE
     ========================================================================== */

  function renderTable() {
    var frag = document.createDocumentFragment();

    // group headers (row 1)
    for (var g = 1; g <= 18; g++) {
      var gh = document.createElement("div");
      gh.className = "pt-axis pt-axis--group";
      gh.setAttribute("aria-hidden", "true");
      gh.style.gridArea = "1 / " + (g + 1);
      gh.textContent = String(g);
      frag.appendChild(gh);
    }

    // period labels (column 1)
    for (var p = 1; p <= 7; p++) {
      var ph = document.createElement("div");
      ph.className = "pt-axis";
      ph.setAttribute("aria-hidden", "true");
      ph.style.gridArea = (p + 1) + " / 1";
      ph.textContent = String(p);
      frag.appendChild(ph);
    }

    // element tiles, in atomic-number order so the DOM order is the reading order
    data.elements.forEach(function (el) {
      frag.appendChild(renderElement(el));
    });

    // "57–71" / "89–103" markers sitting in group 3 of periods 6 and 7
    frag.appendChild(makePlaceholder("57–71", "La–Lu", "7 / 4"));
    frag.appendChild(makePlaceholder("89–103", "Ac–Lr", "8 / 4"));

    // spacer + f-block row labels
    var spacer = document.createElement("div");
    spacer.className = "pt-grid__spacer";
    spacer.setAttribute("aria-hidden", "true");
    frag.appendChild(spacer);

    frag.appendChild(makeFblockLabel("Lanthanides", "57–71 · f-block", "10 / 2 / 10 / 4"));
    frag.appendChild(makeFblockLabel("Actinides", "89–103 · f-block", "11 / 2 / 11 / 4"));

    els.grid.appendChild(frag);
    els.grid.dataset.color = state.colorMode;
  }

  function renderElement(el) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pt-el";
    btn.dataset.z = String(el.z);
    btn.dataset.cat = el.category;
    btn.dataset.state = el.state;
    btn.dataset.block = el.block;
    btn.dataset.radio = el.radioactive ? "yes" : "no";
    btn.tabIndex = el.z === 1 ? 0 : -1;      // roving tabindex
    btn.setAttribute("aria-label", ariaLabelFor(el));
    btn.style.gridArea = gridAreaFor(el);

    btn.innerHTML =
      '<span class="pt-el__z">' + el.z + "</span>" +
      (el.radioactive ? '<span class="pt-el__radio" aria-hidden="true">☢</span>' : "") +
      '<span class="pt-el__sym">' + el.symbol + "</span>" +
      '<span class="pt-el__name">' + el.name + "</span>" +
      '<span class="pt-el__mass">' + formatMass(el) + "</span>";

    tiles[el.z] = btn;
    return btn;
  }

  function ariaLabelFor(el) {
    return el.name + ", symbol " + el.symbol + ", atomic number " + el.z +
      ", " + el.categoryLabel + (el.radioactive ? ", radioactive" : "");
  }

  /** Explicit grid placement. Row = period + 1; the f-block sits on rows 10-11. */
  function gridAreaFor(el) {
    if (el.z >= 57 && el.z <= 71) return "10 / " + (el.z - 53);
    if (el.z >= 89 && el.z <= 103) return "11 / " + (el.z - 85);
    return (el.period + 1) + " / " + (el.group + 1);
  }

  function makePlaceholder(range, symbols, area) {
    var d = document.createElement("div");
    d.className = "pt-placeholder";
    d.setAttribute("aria-hidden", "true");
    d.style.gridArea = area;
    d.innerHTML = "<b>" + range + "</b>" + symbols;
    return d;
  }

  function makeFblockLabel(title, sub, area) {
    var d = document.createElement("div");
    d.className = "pt-fblock-label";
    d.setAttribute("aria-hidden", "true");
    d.style.gridArea = area;
    d.innerHTML = title + "<span>" + sub + "</span>";
    return d;
  }

  /* ==========================================================================
     RENDERING — LEGEND + FILTER CHIPS
     ========================================================================== */

  var LEGEND_SETS = {
    category: Object.keys(window.ChemData ? window.ChemData.categories : {}).map(function (key) {
      return { label: window.ChemData.categories[key].label, varName: window.ChemData.categories[key].var };
    }),
    state: [
      { label: "Solid", varName: "--state-solid" },
      { label: "Liquid", varName: "--state-liquid" },
      { label: "Gas", varName: "--state-gas" },
      { label: "Unknown", varName: "--state-unknown" }
    ],
    block: [
      { label: "s-block", varName: "--block-s" },
      { label: "p-block", varName: "--block-p" },
      { label: "d-block", varName: "--block-d" },
      { label: "f-block", varName: "--block-f" }
    ],
    radioactive: [
      { label: "Radioactive (no stable isotope)", varName: "--radio-yes" },
      { label: "Has at least one stable isotope", varName: "--radio-no" }
    ]
  };

  function renderLegend() {
    var set = LEGEND_SETS[state.colorMode] || LEGEND_SETS.category;
    els.legend.innerHTML = set.map(function (item) {
      return '<span class="pt-legend__item">' +
        '<span class="pt-legend__swatch" style="--sw: var(' + item.varName + ')" aria-hidden="true"></span>' +
        item.label + "</span>";
    }).join("");
  }

  function renderCategoryFilters() {
    /* The chip shows the short label so all eleven fit on one line; the full
       category name still reaches screen readers and hover tooltips. */
    var html = Object.keys(data.categories).map(function (key) {
      var cat = data.categories[key];
      return '<button type="button" class="pt-chip" data-category="' + key + '" aria-pressed="false" ' +
        'title="' + cat.label + '" aria-label="' + cat.label + '" ' +
        'style="--chip: var(' + cat.var + ')">' +
        '<span class="pt-chip__dot" aria-hidden="true"></span>' + cat.short + "</button>";
    }).join("");
    els.categoryFilters.innerHTML = html;

    // keep the toolbar select in step with the chip set
    var opts = ['<option value="all">All categories</option>'].concat(
      Object.keys(data.categories).map(function (key) {
        return '<option value="' + key + '">' + data.categories[key].label + "</option>";
      })
    );
    els.categorySelect.innerHTML = opts.join("");
  }

  /* ==========================================================================
     FILTERING + SEARCH
     ========================================================================== */

  function searchElements(el, query) {
    if (!query) return true;
    var q = query.trim().toLowerCase();
    if (!q) return true;
    return el.name.toLowerCase().indexOf(q) === 0 ||
      el.symbol.toLowerCase() === q ||
      String(el.z) === q ||
      el.name.toLowerCase().indexOf(q) > -1 ||
      el.symbol.toLowerCase().indexOf(q) === 0;
  }

  /** Rank a search match so the best hit can be scrolled into view. */
  function searchScore(el, q) {
    if (!q) return 0;
    if (String(el.z) === q) return 100;
    if (el.symbol.toLowerCase() === q) return 90;
    if (el.name.toLowerCase() === q) return 90;
    if (el.name.toLowerCase().indexOf(q) === 0) return 70;
    if (el.symbol.toLowerCase().indexOf(q) === 0) return 50;
    if (el.name.toLowerCase().indexOf(q) > -1) return 30;
    return 0;
  }

  function matchesFilters(el) {
    if (state.categories.length && state.categories.indexOf(el.category) === -1) return false;

    // group the active traits by family, OR within, AND across
    var families = {};
    state.traits.forEach(function (key) {
      var t = TRAITS[key];
      (families[t.family] = families[t.family] || []).push(t.test);
    });
    return Object.keys(families).every(function (family) {
      return families[family].some(function (test) { return test(el); });
    });
  }

  function filterElements() {
    var q = state.query.trim().toLowerCase();
    var best = null;
    var bestScore = 0;
    var matches = [];

    data.elements.forEach(function (el) {
      var ok = matchesFilters(el) && searchElements(el, q);
      if (!ok) return;
      matches.push(el.z);
      var score = searchScore(el, q);
      if (q && score > bestScore) { bestScore = score; best = el.z; }
    });

    state.matches = matches;
    state.topHit = q ? best : null;
    return matches;
  }

  function applyFilters() {
    filterElements();

    var matchSet = Object.create(null);
    state.matches.forEach(function (z) { matchSet[z] = true; });

    var filtering = isFiltering();
    els.grid.classList.toggle("is-filtering", filtering);

    data.elements.forEach(function (el) {
      var tile = tiles[el.z];
      var on = !!matchSet[el.z];
      tile.classList.toggle("is-dimmed", filtering && !on);
      tile.classList.toggle("is-match", filtering && on);
      if (rows[el.z]) rows[el.z].hidden = filtering && !on;
    });

    updateFilterState();
    highlightTopHit();
  }

  function isFiltering() {
    return !!(state.query.trim() || state.categories.length || state.traits.length);
  }

  /** Counts, active-filter pills, empty state and control synchronisation. */
  function updateFilterState() {
    var n = state.matches.length;
    var total = data.elements.length;

    els.count.innerHTML = "Showing <strong>" + n + "</strong> / " + total + " elements";
    els.empty.hidden = n !== 0;
    if (els.tableCount) els.tableCount.textContent = n + " of " + total + " elements shown";

    var pills = [];
    state.categories.forEach(function (key) {
      pills.push({ label: data.categories[key].label, kind: "category", value: key });
    });
    state.traits.forEach(function (key) {
      pills.push({ label: TRAITS[key].label, kind: "trait", value: key });
    });
    if (state.query.trim()) pills.push({ label: '"' + state.query.trim() + '"', kind: "query", value: "" });

    els.activeFilters.innerHTML = pills.length
      ? pills.map(function (p) { return '<span class="pt-active-filters__item">' + escapeHtml(p.label) + "</span>"; }).join("")
      : "";

    els.clearBtn.disabled = !isFiltering();

    // sync controls with state
    els.categorySelect.value = state.categories.length === 1 ? state.categories[0] : "all";
    var stateTraits = state.traits.filter(function (k) { return TRAITS[k].family === "state"; });
    els.stateSelect.value = stateTraits.length === 1 ? stateTraits[0] : "all";
    els.searchClear.hidden = !state.query;

    Array.prototype.forEach.call(els.categoryFilters.querySelectorAll("[data-category]"), function (btn) {
      btn.setAttribute("aria-pressed", state.categories.indexOf(btn.dataset.category) > -1 ? "true" : "false");
    });
    Array.prototype.forEach.call(els.quick.querySelectorAll("[data-trait]"), function (btn) {
      btn.setAttribute("aria-pressed", state.traits.indexOf(btn.dataset.trait) > -1 ? "true" : "false");
    });
    var allBtn = els.quick.querySelector('[data-quick="all"]');
    if (allBtn) allBtn.setAttribute("aria-pressed", isFiltering() ? "false" : "true");
  }

  function highlightTopHit() {
    Array.prototype.forEach.call(els.grid.querySelectorAll(".is-hit"), function (n) { n.classList.remove("is-hit"); });
    if (hitTimer) { clearTimeout(hitTimer); hitTimer = null; }
    if (!state.topHit) return;

    var tile = tiles[state.topHit];
    tile.classList.add("is-hit");
    scrollTileIntoView(tile);
    hitTimer = setTimeout(function () { tile.classList.remove("is-hit"); }, 3000);
  }

  /** Scroll only the table viewport, never the page, when a hit is off-screen. */
  function scrollTileIntoView(tile) {
    var vp = els.viewport;
    var left = tile.offsetLeft - vp.clientWidth / 2 + tile.offsetWidth / 2;
    if (vp.scrollWidth > vp.clientWidth) {
      vp.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }

  function clearFilters() {
    state.query = "";
    state.categories = [];
    state.traits = [];
    els.search.value = "";
    applyFilters();
    announce("Filters cleared. Showing all 118 elements.");
  }

  function resetTool() {
    state.colorMode = "category";
    els.colorSelect.value = "category";
    els.grid.dataset.color = "category";
    renderLegend();
    closeDetails();
    state.selected = null;
    if (els.dialog.open) els.dialog.close();
    els.compareOut.innerHTML = "";
    els.compareA.value = "";
    els.compareB.value = "";
    clearFilters();
    updateUrl(null);
    announce("Tool reset.");
  }

  /* ==========================================================================
     ELEMENT DETAILS
     ========================================================================== */

  function selectElement(z, opts) {
    var el = data.byNumber(z);
    if (!el) return;
    var o = opts || {};

    if (state.selected && tiles[state.selected]) tiles[state.selected].classList.remove("is-selected");
    state.selected = el.z;
    tiles[el.z].classList.add("is-selected");
    setRovingTabindex(tiles[el.z]);

    showElementDetails(el);
    pushRecent(el.z);
    updateUrl(el);
    openDetails();

    if (o.focusTile !== false && window.innerWidth >= SIDE_PANEL_MIN) tiles[el.z].focus({ preventScroll: true });
    scrollTileIntoView(tiles[el.z]);
  }

  function showElementDetails(el) {
    var cat = data.categories[el.category];
    var isFav = favourites.indexOf(el.z) > -1;

    els.detailsInner.innerHTML =
      '<article class="pt-card" style="--cat: var(' + cat.var + ')">' +
        '<div class="pt-details__close-row" style="justify-content:flex-end;margin-bottom:.5rem">' +
          '<button type="button" class="pt-btn pt-btn--sm" data-action="close">Close</button>' +
        "</div>" +
        '<header class="pt-card__top">' +
          '<div class="pt-card__glyph">' +
            '<span class="z">' + pad(el.z) + "</span>" +
            '<span class="sym">' + el.symbol + "</span>" +
            '<span class="mass">' + formatMass(el) + "</span>" +
          "</div>" +
          '<div class="pt-card__head">' +
            '<h3 class="pt-card__name">' + el.name + "</h3>" +
            '<ul class="pt-card__tags">' +
              '<li class="pt-tag pt-tag--cat">' + cat.label + "</li>" +
              '<li class="pt-tag">' + el.block + "-block</li>" +
              '<li class="pt-tag">' + capitalise(el.state) + "</li>" +
              (el.radioactive ? '<li class="pt-tag pt-tag--radio">☢ Radioactive</li>' : "") +
            "</ul>" +
          "</div>" +
          '<div class="pt-card__nav">' +
            '<button type="button" class="pt-btn pt-btn--sm pt-btn--ghost" data-action="prev"' +
              (el.z === 1 ? " disabled" : "") + ' aria-label="Previous element">‹</button>' +
            '<button type="button" class="pt-btn pt-btn--sm pt-btn--ghost" data-action="next"' +
              (el.z === 118 ? " disabled" : "") + ' aria-label="Next element">›</button>' +
          "</div>" +
        "</header>" +

        '<p class="pt-card__desc">' + el.desc + "</p>" +

        '<section class="pt-section">' +
          '<h4 class="pt-section__title">Atomic properties</h4>' +
          '<dl class="pt-props">' +
            prop("Atomic number", el.z) +
            prop("Atomic mass", formatMass(el) + " <small>u</small>") +
            prop("Group", el.group === null ? "<small>f-block, outside groups 1–18</small>" : el.group) +
            prop("Period", el.period) +
            prop("Block", el.block + "-block") +
            prop("Electronegativity", el.en === null ? null : el.en + " <small>Pauling</small>") +
            prop("Atomic radius", el.radius === null ? null : el.radius + " <small>pm</small>") +
            prop("Ionisation energy", el.ie === null ? null : el.ie + " <small>eV</small>") +
            prop("Electron affinity", el.ea === null ? null : el.ea + " <small>kJ/mol</small>") +
            prop("Oxidation states", el.ox && el.ox.length ? el.ox.join(", ") : null) +
          "</dl>" +
        "</section>" +

        '<section class="pt-section">' +
          '<h4 class="pt-section__title">Electron configuration</h4>' +
          '<p class="pt-config"><span class="pt-config__label">Full</span>' + superscript(el.fullConfig) + "</p>" +
          (el.config !== el.fullConfig
            ? '<p class="pt-config"><span class="pt-config__label">Noble gas notation</span>' + superscript(el.config) + "</p>"
            : "") +
        "</section>" +

        '<section class="pt-section">' +
          '<h4 class="pt-section__title">Physical properties</h4>' +
          '<dl class="pt-props">' +
            prop("State at 25 °C", capitalise(el.state)) +
            prop("Melting point", el.mp === null ? null : formatNum(el.mp) + " <small>°C</small>") +
            prop("Boiling point", el.bp === null ? null : formatNum(el.bp) + " <small>°C</small>") +
            prop("Density", el.density === null ? null : el.density + " <small>" + el.densityUnit + "</small>") +
          "</dl>" +
        "</section>" +

        '<section class="pt-section">' +
          '<h4 class="pt-section__title">Relative to all elements</h4>' +
          '<div class="pt-bars">' +
            bar(el, "en", "Electronegativity", "") +
            bar(el, "mass", "Atomic mass", " u") +
            bar(el, "radius", "Atomic radius", " pm") +
            bar(el, "ie", "Ionisation energy", " eV") +
          "</div>" +
          '<p class="pt-bars__note">Each bar is normalised between the lowest and highest known value across the 118 elements. Elements without a published value are marked N/A.</p>' +
        "</section>" +

        '<section class="pt-section">' +
          '<h4 class="pt-section__title">Discovery</h4>' +
          '<dl class="pt-props">' +
            prop("Year", el.year === null ? "Antiquity" : el.year) +
            prop("Credited to", el.by) +
          "</dl>" +
        "</section>" +

        '<div class="pt-card__actions">' +
          '<button type="button" class="pt-btn pt-btn--sm" data-action="favourite" aria-pressed="' + isFav + '">' +
            (isFav ? "★ Favourited" : "☆ Add to favourites") + "</button>" +
          '<button type="button" class="pt-btn pt-btn--sm" data-action="compare">Compare</button>' +
          '<button type="button" class="pt-btn pt-btn--sm" data-action="share">Share</button>' +
          '<button type="button" class="pt-btn pt-btn--sm pt-btn--ghost" data-action="close">Close</button>' +
        "</div>" +
      "</article>";
  }

  function prop(label, value) {
    var na = value === null || value === undefined || value === "";
    return '<div class="pt-prop"><dt>' + label + "</dt>" +
      '<dd' + (na ? ' class="is-na"' : "") + ">" + (na ? "N/A" : value) + "</dd></div>";
  }

  function bar(el, key, label, unit) {
    var v = el[key];
    if (typeof v !== "number") {
      return '<div class="pt-bar"><div class="pt-bar__head"><span class="pt-bar__label">' + label +
        '</span><span class="pt-bar__value is-na">N/A</span></div>' +
        '<div class="pt-bar__track"></div></div>';
    }
    var r = ranges[key];
    var pct = ((v - r.min) / (r.max - r.min)) * 100;
    return '<div class="pt-bar"><div class="pt-bar__head"><span class="pt-bar__label">' + label +
      '</span><span class="pt-bar__value">' + v + unit + "</span></div>" +
      '<div class="pt-bar__track"><span class="pt-bar__fill" style="width:' + Math.max(1.5, pct).toFixed(1) + '%"></span></div></div>';
  }

  function openDetails() {
    if (useSheetOverlay()) {
      mountMobileSheet();
      lockPageScroll();
    }
    els.details.classList.add("is-open");
    els.backdrop.classList.add("is-open");
    els.details.setAttribute("aria-hidden", "false");
    if (useSheetOverlay()) {
      var close = els.detailsInner.querySelector('[data-action="close"]');
      if (close) close.focus({ preventScroll: true });
    }
  }

  function closeDetails() {
    els.details.classList.remove("is-open");
    els.backdrop.classList.remove("is-open");
    els.details.setAttribute("aria-hidden", "true");
    unlockPageScroll();
    restoreMobileSheet();
    if (state.selected && tiles[state.selected]) {
      tiles[state.selected].classList.remove("is-selected");
      tiles[state.selected].focus({ preventScroll: true });
    }
    state.selected = null;
    renderEmptyPanel();
    updateUrl(null);
  }

  function renderEmptyPanel() {
    els.detailsInner.innerHTML =
      '<div class="pt-empty-panel">' +
        '<span class="pt-empty-panel__icon" aria-hidden="true">⚛</span>' +
        "<strong>Click any element to explore its properties.</strong>" +
        "<span>Atomic mass, electron configuration, electronegativity, melting and boiling points, oxidation states and more.</span>" +
      "</div>";
  }

  /* ==========================================================================
     FAVOURITES / RECENT / SHARE / DEEP LINK
     ========================================================================== */

  function readStore(key) {
    try {
      var raw = localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (n) { return typeof n === "number"; }) : [];
    } catch (e) { return []; }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  function toggleFavourite(z) {
    var i = favourites.indexOf(z);
    if (i > -1) favourites.splice(i, 1); else favourites.push(z);
    writeStore(LS_FAVOURITES, favourites);
    var btn = els.detailsInner.querySelector('[data-action="favourite"]');
    if (btn) {
      var on = favourites.indexOf(z) > -1;
      btn.setAttribute("aria-pressed", String(on));
      btn.textContent = on ? "★ Favourited" : "☆ Add to favourites";
    }
    renderRecent();
  }

  function pushRecent(z) {
    recent = [z].concat(recent.filter(function (n) { return n !== z; })).slice(0, RECENT_MAX);
    writeStore(LS_RECENT, recent);
    renderRecent();
  }

  function renderRecent() {
    if (!recent.length) { els.recent.hidden = true; return; }
    els.recent.hidden = false;
    els.recentList.innerHTML = recent.map(function (z) {
      var el = data.byNumber(z);
      var fav = favourites.indexOf(z) > -1;
      return '<button type="button" class="pt-recent__btn" data-z="' + z + '" title="' + el.name + '">' +
        (fav ? "★" : "") + el.symbol + "</button>";
    }).join("");
  }

  function shareElement(el) {
    var url = elementUrl(el);
    var payload = {
      title: el.name + " (" + el.symbol + ") — Interactive Periodic Table",
      text: el.name + ", atomic number " + el.z + ", atomic mass " + formatMass(el) + " u.",
      url: url
    };
    if (navigator.share) {
      navigator.share(payload).catch(function () { /* user dismissed */ });
      return;
    }
    copyText(url, function (ok) {
      announce(ok ? "Link to " + el.name + " copied to the clipboard." : "Copy failed. The link is " + url);
    });
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  }

  function elementUrl(el) {
    var base = location.origin + location.pathname;
    return base + "?element=" + el.name.toLowerCase();
  }

  function updateUrl(el) {
    if (!window.history || !history.replaceState) return;
    var url = el ? "?element=" + el.name.toLowerCase() : location.pathname;
    history.replaceState(null, "", url);
  }

  function openFromUrl() {
    renderEmptyPanel();
    var match = /[?&]element=([^&]+)/.exec(location.search);
    if (!match) return;
    var raw = decodeURIComponent(match[1]).trim().toLowerCase();
    var el = null;
    if (/^\d+$/.test(raw)) el = data.byNumber(parseInt(raw, 10));
    if (!el) el = data.bySymbol(raw);
    if (!el) {
      el = data.elements.filter(function (e) { return e.name.toLowerCase() === raw; })[0] || null;
    }
    if (el) selectElement(el.z, { focusTile: false });
  }

  /* ==========================================================================
     COMPARISON
     ========================================================================== */

  var COMPARE_ROWS = [
    { label: "Atomic number", get: function (el) { return el.z; } },
    { label: "Symbol", get: function (el) { return el.symbol; } },
    { label: "Atomic mass (u)", get: function (el) { return formatMass(el); } },
    { label: "Category", get: function (el) { return el.categoryLabel; } },
    { label: "Group", get: function (el) { return el.group === null ? null : el.group; } },
    { label: "Period", get: function (el) { return el.period; } },
    { label: "Block", get: function (el) { return el.block + "-block"; } },
    { label: "State at 25 °C", get: function (el) { return capitalise(el.state); } },
    { label: "Electronegativity (Pauling)", get: function (el) { return el.en; } },
    { label: "Atomic radius (pm)", get: function (el) { return el.radius; } },
    { label: "Ionisation energy (eV)", get: function (el) { return el.ie; } },
    { label: "Electron affinity (kJ/mol)", get: function (el) { return el.ea; } },
    { label: "Melting point (°C)", get: function (el) { return el.mp === null ? null : formatNum(el.mp); } },
    { label: "Boiling point (°C)", get: function (el) { return el.bp === null ? null : formatNum(el.bp); } },
    { label: "Density", get: function (el) { return el.density === null ? null : el.density + " " + el.densityUnit; } },
    { label: "Electron configuration", get: function (el) { return superscript(el.config); } },
    { label: "Oxidation states", get: function (el) { return el.ox && el.ox.length ? el.ox.join(", ") : null; } },
    { label: "Radioactive", get: function (el) { return el.radioactive ? "Yes — no stable isotope" : "No"; } }
  ];

  function populateCompareSelects() {
    var opts = ['<option value="">Select an element…</option>'].concat(
      data.elements.map(function (el) {
        return '<option value="' + el.z + '">' + el.z + " · " + el.symbol + " — " + el.name + "</option>";
      })
    ).join("");
    els.compareA.innerHTML = opts;
    els.compareB.innerHTML = opts;
  }

  function compareElements() {
    var a = data.byNumber(parseInt(els.compareA.value, 10));
    var b = data.byNumber(parseInt(els.compareB.value, 10));
    if (!a || !b) {
      els.compareOut.innerHTML = '<p class="pt-bars__note">Choose two elements to compare.</p>';
      return;
    }
    var head = function (el) {
      return '<span class="pt-compare-head"><span class="pt-compare-head__sym">' + el.symbol +
        "</span> " + el.name + "</span>";
    };
    var body = COMPARE_ROWS.map(function (row) {
      var va = row.get(a), vb = row.get(b);
      var cell = function (v) {
        var na = v === null || v === undefined || v === "";
        return "<td" + (na ? ' class="is-na"' : "") + ">" + (na ? "N/A" : v) + "</td>";
      };
      return "<tr><th scope=\"row\">" + row.label + "</th>" + cell(va) + cell(vb) + "</tr>";
    }).join("");

    els.compareOut.innerHTML =
      '<table class="pt-compare-table"><caption class="pt-sr">Side-by-side comparison of ' + a.name + " and " + b.name + "</caption>" +
      "<thead><tr><th scope=\"col\">Property</th><th scope=\"col\">" + head(a) + "</th><th scope=\"col\">" + head(b) + "</th></tr></thead>" +
      "<tbody>" + body + "</tbody></table>";
  }

  function openCompare(preselectZ) {
    if (preselectZ && !els.compareA.value) els.compareA.value = String(preselectZ);
    else if (preselectZ && els.compareA.value && !els.compareB.value) els.compareB.value = String(preselectZ);
    else if (preselectZ) els.compareA.value = String(preselectZ);

    if (typeof els.dialog.showModal === "function") els.dialog.showModal();
    else els.dialog.setAttribute("open", "");
    if (els.compareA.value && els.compareB.value) compareElements();
  }

  /* ==========================================================================
     SUMMARY TABLE
     ========================================================================== */

  function indexSummaryRows() {
    if (!els.tableBody) return;
    Array.prototype.forEach.call(els.tableBody.rows, function (row) {
      var z = parseInt(row.getAttribute("data-z"), 10);
      if (z) rows[z] = row;
    });
  }

  /* ==========================================================================
     EVENTS
     ========================================================================== */

  function bindEvents() {
    // --- table interaction ---
    els.grid.addEventListener("click", function (e) {
      var tile = e.target.closest(".pt-el");
      if (tile) selectElement(parseInt(tile.dataset.z, 10));
    });
    els.grid.addEventListener("keydown", onGridKeydown);
    els.grid.addEventListener("mouseover", onTileHover);
    els.grid.addEventListener("mouseout", hideTooltip);
    els.grid.addEventListener("focusin", function (e) {
      var tile = e.target.closest(".pt-el");
      if (tile) { setRovingTabindex(tile); showTooltip(tile); }
    });
    els.grid.addEventListener("focusout", hideTooltip);
    els.viewport.addEventListener("scroll", hideTooltip, { passive: true });

    // --- search ---
    els.search.addEventListener("input", function () {
      state.query = els.search.value;
      applyFilters();
    });
    els.search.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && state.topHit) { e.preventDefault(); selectElement(state.topHit, { focusTile: false }); }
      if (e.key === "Escape" && state.query) { els.search.value = ""; state.query = ""; applyFilters(); }
    });
    els.searchClear.addEventListener("click", function () {
      els.search.value = ""; state.query = ""; applyFilters(); els.search.focus();
    });

    // --- selects ---
    els.categorySelect.addEventListener("change", function () {
      state.categories = this.value === "all" ? [] : [this.value];
      applyFilters();
      announce(this.value === "all" ? "Category filter cleared." : data.categories[this.value].label + " highlighted.");
    });
    els.stateSelect.addEventListener("change", function () {
      state.traits = state.traits.filter(function (k) { return TRAITS[k].family !== "state"; });
      if (this.value !== "all") state.traits.push(this.value);
      applyFilters();
    });
    els.colorSelect.addEventListener("change", function () {
      state.colorMode = this.value;
      els.grid.dataset.color = this.value;
      renderLegend();
      announce("Colouring elements by " + this.options[this.selectedIndex].text + ".");
    });

    // --- chips ---
    els.quick.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.quick === "all") { clearFilters(); return; }
      var key = btn.dataset.trait;
      if (!key) return;
      var i = state.traits.indexOf(key);
      if (i > -1) state.traits.splice(i, 1); else state.traits.push(key);
      applyFilters();
      announce(state.matches.length + " elements match the current filters.");
    });

    els.categoryFilters.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-category]");
      if (!btn) return;
      var key = btn.dataset.category;
      var i = state.categories.indexOf(key);
      if (i > -1) state.categories.splice(i, 1); else state.categories.push(key);
      applyFilters();
      announce(state.matches.length + " elements match the current filters.");
    });

    // --- toolbar buttons ---
    els.clearBtn.addEventListener("click", clearFilters);
    els.resetBtn.addEventListener("click", resetTool);
    els.compareBtn.addEventListener("click", function () { openCompare(state.selected); });
    els.compareRun.addEventListener("click", compareElements);
    els.compareA.addEventListener("change", compareElements);
    els.compareB.addEventListener("change", compareElements);
    document.getElementById("pt-compare-close").addEventListener("click", function () { els.dialog.close(); });

    // --- detail panel (delegated: the panel is re-rendered on every open) ---
    els.detailsInner.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn || !state.selected) return;
      var el = data.byNumber(state.selected);
      switch (btn.dataset.action) {
        case "close": closeDetails(); break;
        case "prev": if (el.z > 1) selectElement(el.z - 1); break;
        case "next": if (el.z < 118) selectElement(el.z + 1); break;
        case "favourite": toggleFavourite(el.z); break;
        case "compare": openCompare(el.z); break;
        case "share": shareElement(el); break;
      }
    });

    els.backdrop.addEventListener("click", closeDetails);
    els.recentList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-z]");
      if (btn) selectElement(parseInt(btn.dataset.z, 10));
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (els.dialog.open) return;                       // <dialog> closes itself
      if (els.details.classList.contains("is-open") || state.selected) closeDetails();
    });
  }

  /* --- keyboard navigation across the grid (roving tabindex) --- */
  function onGridKeydown(e) {
    var tile = e.target.closest(".pt-el");
    if (!tile) return;
    var el = data.byNumber(parseInt(tile.dataset.z, 10));
    var next = null;

    switch (e.key) {
      case "ArrowRight": next = neighbour(el, 1); break;
      case "ArrowLeft": next = neighbour(el, -1); break;
      case "ArrowDown": next = verticalNeighbour(el, 1); break;
      case "ArrowUp": next = verticalNeighbour(el, -1); break;
      case "Home": next = data.byNumber(1); break;
      case "End": next = data.byNumber(118); break;
      default: return;
    }
    if (!next) return;
    e.preventDefault();
    var target = tiles[next.z];
    setRovingTabindex(target);
    target.focus();
    scrollTileIntoView(target);
  }

  /** Next / previous element in atomic-number order. */
  function neighbour(el, delta) {
    return data.byNumber(el.z + delta);
  }

  /** One row up or down in the same visual column, falling back to +/- a period. */
  function verticalNeighbour(el, delta) {
    var col = columnOf(el);
    var candidates = data.elements.filter(function (other) {
      return rowOf(other) === rowOf(el) + delta && columnOf(other) === col;
    });
    if (candidates.length) return candidates[0];
    // no element directly above/below: jump to the nearest one on that row
    var row = data.elements.filter(function (other) { return rowOf(other) === rowOf(el) + delta; });
    if (!row.length) return null;
    return row.reduce(function (best, other) {
      return Math.abs(columnOf(other) - col) < Math.abs(columnOf(best) - col) ? other : best;
    });
  }

  function rowOf(el) {
    if (el.z >= 57 && el.z <= 71) return 10;
    if (el.z >= 89 && el.z <= 103) return 11;
    return el.period + 1;
  }
  function columnOf(el) {
    if (el.z >= 57 && el.z <= 71) return el.z - 53;
    if (el.z >= 89 && el.z <= 103) return el.z - 85;
    return el.group + 1;
  }

  function setRovingTabindex(tile) {
    var current = els.grid.querySelector('.pt-el[tabindex="0"]');
    if (current && current !== tile) current.tabIndex = -1;
    tile.tabIndex = 0;
  }

  /* --- tooltip --- */
  function onTileHover(e) {
    var tile = e.target.closest(".pt-el");
    if (tile) showTooltip(tile); else hideTooltip();
  }

  function showTooltip(tile) {
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;
    var el = data.byNumber(parseInt(tile.dataset.z, 10));
    if (!el) return;
    var cat = data.categories[el.category];

    els.tooltip.style.setProperty("--tip", "var(" + cat.var + ")");
    els.tooltip.innerHTML =
      '<div class="pt-tooltip__head"><span class="pt-tooltip__sym">' + el.symbol + "</span> " + el.name + "</div>" +
      "<dl>" +
        '<div class="pt-tooltip__row"><dt>Atomic number</dt><dd>' + el.z + "</dd></div>" +
        '<div class="pt-tooltip__row"><dt>Atomic mass</dt><dd>' + formatMass(el) + " u</dd></div>" +
        '<div class="pt-tooltip__row"><dt>Category</dt><dd>' + cat.label + "</dd></div>" +
        (el.radioactive ? '<div class="pt-tooltip__row"><dt>☢</dt><dd>Radioactive</dd></div>' : "") +
      "</dl>";

    var r = tile.getBoundingClientRect();
    els.tooltip.classList.add("is-open");
    var tr = els.tooltip.getBoundingClientRect();
    var left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
    var top = r.top - tr.height - 8;
    if (top < 8) top = r.bottom + 8;
    els.tooltip.style.left = left + "px";
    els.tooltip.style.top = top + "px";
  }

  function hideTooltip() {
    els.tooltip.classList.remove("is-open");
  }

  /* ==========================================================================
     UTILITIES
     ========================================================================== */

  /* massText preserves published trailing zeros (20.180), which a plain
     number would drop. Brackets mark a mass number rather than a weight. */
  function formatMass(el) {
    return el.massNum ? "[" + el.mass + "]" : (el.massText || String(el.mass));
  }

  function formatNum(n) {
    return String(n);
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function capitalise(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /** 1s2 2s2 2p6 -> 1s² 2s² 2p⁶ using real <sup> so it copies cleanly. */
  function superscript(config) {
    return escapeHtml(config).replace(/([spdf])(\d+)/g, "$1<sup>$2</sup>");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function announce(message) {
    var live = document.getElementById("pt-live");
    if (live) live.textContent = message;
  }

  /* ---- go ---- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePeriodicTable);
  } else {
    initializePeriodicTable();
  }
})();
