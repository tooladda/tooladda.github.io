/* ============================================================================
   ToolAdda — Kundli Maker (UI)
   Birth details in, janam kundali out. The maths lives in kundli-engine.js;
   this file handles the form, the offline place search, the two chart styles,
   the tables, the PDF and the shareable link.
   ============================================================================ */

(function () {
  "use strict";

  var STORAGE_KEY = "tooladda-kundli-v1";
  var CITY_SCRIPTS = { india: "../assets/js/kundli-cities-in.js", world: "../assets/js/kundli-cities-world.js" };
  var JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  var SAMPLE = {
    name: "Independence of India",
    date: "1947-08-15", time: "00:00", place: "New Delhi, Delhi",
    lat: 28.6139, lon: 77.209, zone: "Asia/Kolkata"
  };

  var engine = window.KundliEngine;
  var state = { chart: null, style: "north", place: null, citiesLoaded: {}, loading: {} };
  var els = {};
  var toastTimer = null;

  /* ------------------------------------------------------------- helpers -- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("is-on"); }, 3200);
  }

  function showError(message) {
    if (!els.error) return;
    els.error.textContent = message || "";
    els.error.hidden = !message;
  }

  /** A date in the birth place's own time, not the reader's. */
  function localDateText(date, offsetMinutes, withTime) {
    var shifted = new Date(date.getTime() + offsetMinutes * 60000);
    var out = shifted.toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
    if (withTime) {
      out += ", " + shifted.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
    }
    return out;
  }

  function dateOnly(date) {
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  /* --------------------------------------------------------- place search -- */

  function loadCityFile(which) {
    if (state.citiesLoaded[which]) return Promise.resolve(true);
    if (state.loading[which]) return state.loading[which];
    state.loading[which] = new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = CITY_SCRIPTS[which];
      script.async = true;
      script.onload = function () {
        state.citiesLoaded[which] = true;
        indexCities(which);
        resolve(true);
      };
      script.onerror = function () { resolve(false); };
      document.head.appendChild(script);
    });
    return state.loading[which];
  }

  var cityIndex = { india: [], world: [] };

  /** "Jaipur/Jeypore|Rajasthan|26.913|75.787|0" → a searchable record. */
  function indexCities(which) {
    var store = window.KundliCities && window.KundliCities[which];
    if (!store) return;
    cityIndex[which] = store.rows.split("\n").map(function (row) {
      var f = row.split("|");
      var names = f[0].split("/");
      return {
        name: names[0],
        aliases: names.slice(1),
        region: f[1],
        lat: parseFloat(f[2]),
        lon: parseFloat(f[3]),
        zone: store.zones[Number(f[4])] || "UTC",
        country: which === "india" ? "India" : ""
      };
    });
  }

  function matchCities(list, query, limit, out) {
    for (var i = 0; i < list.length && out.length < limit; i++) {
      var city = list[i];
      var names = [city.name].concat(city.aliases);
      for (var n = 0; n < names.length; n++) {
        var lower = names[n].toLowerCase();
        if (lower.indexOf(query) === 0 || lower.indexOf(" " + query) > 0) {
          out.push({ city: city, label: names[n] });
          break;
        }
      }
    }
    return out;
  }

  function searchPlaces(query) {
    var q = query.trim().toLowerCase();
    if (q.length < 2) return Promise.resolve([]);
    return loadCityFile("india").then(function () {
      var found = matchCities(cityIndex.india, q, 8, []);
      if (found.length >= 8) return found;
      /* not an Indian town, or not enough of them — bring in the world list */
      return loadCityFile("world").then(function () {
        return matchCities(cityIndex.world, q, 8, found);
      });
    });
  }

  function renderSuggestions(items) {
    var list = els.suggest;
    if (!items.length) {
      list.hidden = true;
      list.innerHTML = "";
      els.place.setAttribute("aria-expanded", "false");
      return;
    }
    list.innerHTML = items.map(function (item, i) {
      var city = item.city;
      var where = [city.region, city.country].filter(Boolean).join(", ");
      return '<li role="option" id="kun-opt-' + i + '" data-index="' + i + '" aria-selected="false">' +
        "<span>" + esc(item.label) + (item.label !== city.name ? ' <small style="opacity:.7">(' + esc(city.name) + ")</small>" : "") + "</span>" +
        "<small>" + esc(where) + "</small></li>";
    }).join("");
    list.hidden = false;
    els.place.setAttribute("aria-expanded", "true");
    state.suggestions = items;
    state.activeSuggestion = -1;
  }

  function choosePlace(item) {
    var city = item.city;
    state.place = {
      label: [item.label, city.region, city.country].filter(Boolean).join(", "),
      lat: city.lat, lon: city.lon, zone: city.zone
    };
    els.place.value = state.place.label;
    els.lat.value = city.lat;
    els.lon.value = city.lon;
    setZone(city.zone);
    els.suggest.hidden = true;
    els.suggest.innerHTML = "";
    els.place.setAttribute("aria-expanded", "false");
    updatePlaceNote();
    showError("");
  }

  function updatePlaceNote() {
    var lat = parseFloat(els.lat.value);
    var lon = parseFloat(els.lon.value);
    if (!isFinite(lat) || !isFinite(lon)) {
      els.placeNote.innerHTML = "Indian towns load first; type any other place and the world list loads too.";
      return;
    }
    els.placeNote.innerHTML = "Using <b>" + esc(Math.abs(lat).toFixed(3)) + "° " + (lat < 0 ? "S" : "N") +
      ", " + esc(Math.abs(lon).toFixed(3)) + "° " + (lon < 0 ? "W" : "E") + "</b> · time zone <b>" + esc(els.zone.value) + "</b>";
  }

  /* -------------------------------------------------------------- zones -- */

  var FALLBACK_ZONES = [
    "Asia/Kolkata", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Karachi", "Asia/Colombo", "Asia/Dubai", "Asia/Singapore",
    "Asia/Tokyo", "Australia/Sydney", "Europe/London", "Europe/Paris", "Europe/Moscow", "Africa/Nairobi",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "UTC"
  ];

  function fillZones() {
    var zones = FALLBACK_ZONES;
    try {
      if (typeof Intl.supportedValuesOf === "function") {
        var all = Intl.supportedValuesOf("timeZone");
        if (all && all.length) zones = all;
      }
    } catch (e) { /* older browser: the short list is fine */ }
    if (zones.indexOf("Asia/Kolkata") < 0) zones = ["Asia/Kolkata"].concat(zones);
    els.zone.innerHTML = zones.map(function (z) {
      return '<option value="' + esc(z) + '">' + esc(z.replace(/_/g, " ")) + "</option>";
    }).join("");
    setZone("Asia/Kolkata");
  }

  function setZone(zone) {
    if (!zone) return;
    if (!Array.prototype.some.call(els.zone.options, function (o) { return o.value === zone; })) {
      var extra = document.createElement("option");
      extra.value = zone;
      extra.textContent = zone.replace(/_/g, " ");
      els.zone.insertBefore(extra, els.zone.firstChild);
    }
    els.zone.value = zone;
  }

  /* --------------------------------------------------------------- charts -- */

  /* North Indian: the houses never move. House 1 is the diamond at the top and
     the rest run anticlockwise, which is exactly what these polygons are. */
  var NORTH_HOUSES = [
    { points: "50,0 75,25 50,50 25,25", cx: 50, cy: 25 },
    { points: "0,0 50,0 25,25", cx: 25, cy: 10 },
    { points: "0,0 25,25 0,50", cx: 10, cy: 25 },
    { points: "0,50 25,25 50,50 25,75", cx: 25, cy: 50 },
    { points: "0,50 25,75 0,100", cx: 10, cy: 75 },
    { points: "0,100 25,75 50,100", cx: 25, cy: 90 },
    { points: "50,100 25,75 50,50 75,75", cx: 50, cy: 75 },
    { points: "50,100 75,75 100,100", cx: 75, cy: 90 },
    { points: "100,100 75,75 100,50", cx: 90, cy: 75 },
    { points: "100,50 75,75 50,50 75,25", cx: 75, cy: 50 },
    { points: "100,50 75,25 100,0", cx: 90, cy: 25 },
    { points: "100,0 75,25 50,0", cx: 75, cy: 10 }
  ];

  /* South Indian: the signs never move. Pisces sits top-left and the signs run
     clockwise, so this grid is fixed and only the lagna mark travels. */
  var SOUTH_CELLS = [
    { sign: 11, col: 0, row: 0 }, { sign: 0, col: 1, row: 0 }, { sign: 1, col: 2, row: 0 }, { sign: 2, col: 3, row: 0 },
    { sign: 10, col: 0, row: 1 }, { sign: 3, col: 3, row: 1 },
    { sign: 9, col: 0, row: 2 }, { sign: 4, col: 3, row: 2 },
    { sign: 8, col: 0, row: 3 }, { sign: 7, col: 1, row: 3 }, { sign: 6, col: 2, row: 3 }, { sign: 5, col: 3, row: 3 }
  ];

  function planetLabel(planet) {
    return planet.symbol + (planet.retrograde ? "ᴿ" : "");
  }

  function chartTitleLines(chart, divisional) {
    return divisional
      ? ["D9 Navamsa", engine.SIGNS[chart.navamsa.lagnaSign].en + " lagna"]
      : ["D1 Lagna", chart.lagna.signEn + " " + Math.floor(chart.lagna.degree) + "°"];
  }

  function housesFor(chart, divisional) {
    return divisional ? chart.navamsa.houses : chart.houses;
  }

  function northChart(chart, divisional) {
    var houses = housesFor(chart, divisional);
    var titles = chartTitleLines(chart, divisional);
    var parts = ['<div class="kun-chart-frame"><svg class="kun-chart" viewBox="-3 -3 106 106" role="img" aria-label="' +
      esc(titles[0] + " chart, " + titles[1]) + '">'];
    parts.push('<rect x="-1.5" y="-1.5" width="103" height="103" rx="2" fill="none" stroke="var(--chart-line)" stroke-width=".5" opacity=".55"/>');
    parts.push('<rect x="0" y="0" width="100" height="100" fill="none" stroke="var(--chart-line)" stroke-width="1.1"/>');
    parts.push('<path d="M0 0 L100 100 M100 0 L0 100 M50 0 L100 50 L50 100 L0 50 Z" fill="none" stroke="var(--chart-line)" stroke-width=".7"/>');
    houses.forEach(function (house, i) {
      var box = NORTH_HOUSES[i];
      var planets = house.planets.map(planetLabel);
      parts.push('<text x="' + box.cx + '" y="' + (box.cy - 5) + '" text-anchor="middle" font-size="4.6" fill="var(--chart-line)" font-weight="700">' +
        (house.sign + 1) + "</text>");
      var rows = [];
      for (var p = 0; p < planets.length; p += 2) rows.push(planets.slice(p, p + 2).join(" "));
      rows.forEach(function (row, r) {
        parts.push('<text x="' + box.cx + '" y="' + (box.cy + 1 + r * 5.4) + '" text-anchor="middle" font-size="5" fill="var(--chart-ink)" font-weight="700">' +
          esc(row) + "</text>");
      });
    });
    parts.push("</svg></div>");
    return parts.join("");
  }

  function southChart(chart, divisional) {
    var houses = housesFor(chart, divisional);
    var lagnaSign = divisional ? chart.navamsa.lagnaSign : chart.lagna.sign;
    var bySign = {};
    houses.forEach(function (h) { bySign[h.sign] = h; });
    var titles = chartTitleLines(chart, divisional);
    var size = 25;
    var parts = ['<div class="kun-chart-frame"><svg class="kun-chart" viewBox="-3 -3 106 106" role="img" aria-label="' +
      esc(titles[0] + " chart, " + titles[1]) + '">'];
    parts.push('<rect x="-1.5" y="-1.5" width="103" height="103" rx="2" fill="none" stroke="var(--chart-line)" stroke-width=".5" opacity=".55"/>');
    parts.push('<rect x="0" y="0" width="100" height="100" fill="none" stroke="var(--chart-line)" stroke-width="1.1"/>');
    SOUTH_CELLS.forEach(function (cell) {
      var x = cell.col * size;
      var y = cell.row * size;
      var house = bySign[cell.sign] || { planets: [] };
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" fill="none" stroke="var(--chart-line)" stroke-width=".7"/>');
      if (cell.sign === lagnaSign) {
        parts.push('<path d="M' + x + " " + y + " L" + (x + size) + " " + (y + size) + '" stroke="var(--chart-line)" stroke-width=".7"/>');
      }
      parts.push('<text x="' + (x + 2) + '" y="' + (y + 5.5) + '" font-size="4" fill="var(--chart-line)" font-weight="700">' +
        esc(engine.SIGNS[cell.sign].en.slice(0, 3)) + "</text>");
      var planets = house.planets.map(planetLabel);
      var rows = [];
      for (var p = 0; p < planets.length; p += 2) rows.push(planets.slice(p, p + 2).join(" "));
      rows.forEach(function (row, r) {
        parts.push('<text x="' + (x + size / 2) + '" y="' + (y + 12 + r * 5.4) + '" text-anchor="middle" font-size="5" fill="var(--chart-ink)" font-weight="700">' +
          esc(row) + "</text>");
      });
    });
    parts.push('<text x="50" y="47" text-anchor="middle" font-size="5.2" fill="var(--chart-line)" font-weight="800">' + esc(titles[0]) + "</text>");
    parts.push('<text x="50" y="55" text-anchor="middle" font-size="4.4" fill="var(--chart-line)">' + esc(titles[1]) + "</text>");
    parts.push("</svg></div>");
    return parts.join("");
  }

  function drawCharts() {
    if (!state.chart) return;
    var draw = state.style === "south" ? southChart : northChart;
    els.chartD1.innerHTML = draw(state.chart, false);
    els.chartD9.innerHTML = draw(state.chart, true);
    $all("[data-kun-style]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-kun-style") === state.style));
    });
    els.chartNote.textContent = state.style === "south"
      ? "South Indian style: the signs stay in fixed boxes, the diagonal line marks the lagna, and houses are counted clockwise from there. R marks a retrograde planet."
      : "North Indian style: the diamond at the top is always the first house and the number in each box is the sign standing there. R marks a retrograde planet.";
  }

  /* --------------------------------------------------------------- render -- */

  function renderSummary(chart) {
    var p = chart.panchang;
    var cards = [
      ["↑", "Lagna (ascendant)", chart.lagna.signEn, chart.lagna.signName + " · " + chart.lagna.degreeText],
      ["☾", "Moon sign (rashi)", chart.summary.moonSignEn, chart.summary.moonSign],
      ["★", "Nakshatra", chart.summary.nakshatra, "Pada " + chart.summary.nakshatraPada + " · lord " + chart.summary.nakshatraLord],
      ["☀", "Sun sign", chart.summary.sunSignEn, chart.summary.sunSign],
      ["◔", "Tithi", p.tithi.paksha + " " + p.tithi.name, p.vara.en + " · " + p.vara.sanskrit],
      ["⏳", "Dasha at birth", chart.dasha.birthNakshatraLord, "Balance " + chart.dasha.balanceText]
    ];
    els.summary.innerHTML = cards.map(statCard).join("");
  }

  function statCard(c) {
    return '<div class="kun-stat"><span><i aria-hidden="true">' + esc(c[0]) + "</i>" + esc(c[1]) +
      "</span><b>" + esc(c[2]) + "</b><small>" + esc(c[3]) + "</small></div>";
  }

  function renderPlanets(chart) {
    els.planets.innerHTML = chart.planets.map(function (p) {
      var notes = [];
      if (p.retrograde) notes.push('<span class="kun-retro">Retrograde</span>');
      if (p.dignity) notes.push('<span class="kun-dignity">' + esc(p.dignity) + "</span>");
      return "<tr>" +
        '<td><span class="kun-graha" aria-hidden="true">' + esc(p.symbol) + "</span><b>" + esc(p.name) +
          "</b><br><small style=\"opacity:.7\">" + esc(p.sanskrit) + "</small></td>" +
        "<td>" + esc(p.signEn) + "<br><small style=\"opacity:.7\">" + esc(p.signName) + "</small></td>" +
        "<td>" + esc(p.degreeText) + "</td>" +
        "<td>" + p.house + "</td>" +
        "<td>" + esc(p.nakshatra) + "<br><small style=\"opacity:.7\">lord " + esc(p.nakshatraLord) + "</small></td>" +
        "<td>" + p.pada + "</td>" +
        "<td>" + esc(p.navamsaSignName) + "</td>" +
        "<td>" + (notes.join(" ") || "&mdash;") + "</td>" +
        "</tr>";
    }).join("");
    els.ayanamsa.textContent = "Sidereal positions, Lahiri ayanamsa " + chart.ayanamsaText +
      " · whole-sign houses · Rahu and Ketu are the mean nodes · Julian day " + chart.julianDay.toFixed(4) + ".";
  }

  function renderPanchang(chart) {
    var p = chart.panchang;
    var offset = chart.offsetMinutes;
    var cards = [
      ["◔", "Tithi", p.tithi.paksha + " " + p.tithi.name, "Tithi " + p.tithi.number + " of 15"],
      ["📅", "Vara (weekday)", p.vara.en, p.vara.sanskrit + " · lord " + p.vara.lord],
      ["★", "Nakshatra", p.nakshatra.name, "Pada " + p.nakshatra.pada + " · lord " + p.nakshatra.lord],
      ["🧘", "Yoga", p.yoga.name, "Yoga " + (p.yoga.index + 1) + " of 27"],
      ["⏱", "Karana", p.karana.name, "Half-tithi " + (p.karana.index + 1) + " of 60"],
      ["🌅", "Sunrise", p.sunrise ? localDateText(p.sunrise, offset, true).split(", ")[1] : "—", "at the birth place"],
      ["🌇", "Sunset", p.sunset ? localDateText(p.sunset, offset, true).split(", ")[1] : "—", "at the birth place"]
    ];
    els.panchang.innerHTML = cards.map(statCard).join("");
  }

  function renderDasha(chart) {
    var current = chart.currentDasha;
    function progress(period) {
      var span = period.end - period.start;
      var done = Math.min(1, Math.max(0, (Date.now() - period.start) / span));
      return '<div class="kun-progress" role="img" aria-label="' + Math.round(done * 100) +
        ' per cent of this mahadasha has passed"><i style="width:' + (done * 100).toFixed(1) + '%"></i></div>';
    }
    els.dashaNow.innerHTML = current
      ? '<div><span class="kun-eyebrow">Running today</span><b>' + esc(current.maha.lord) + " mahadasha</b><small>" +
        esc(dateOnly(current.maha.start)) + " → " + esc(dateOnly(current.maha.end)) + "</small></div>" +
        (current.antar ? '<div><span class="kun-eyebrow">Antardasha</span><b>' + esc(current.antar.lord) + "</b><small>" +
          esc(dateOnly(current.antar.start)) + " → " + esc(dateOnly(current.antar.end)) + "</small></div>" : "") +
        '<div><span class="kun-eyebrow">Dasha lord at birth</span><b>' + esc(chart.dasha.birthNakshatraLord) +
        "</b><small>balance " + esc(chart.dasha.balanceText) + "</small></div>" +
        progress(current.maha)
      : "<div>The 240 years this table covers have passed.</div>";

    els.dashaList.innerHTML = chart.dasha.periods.map(function (period, i) {
      var running = current && current.index === i;
      var antar = period.antardasha.map(function (a) {
        var now = current && current.antar === a;
        return "<tr" + (now ? ' style="font-weight:700"' : "") + "><td>" + esc(a.lord) + "</td><td>" +
          esc(dateOnly(a.start)) + "</td><td>" + esc(dateOnly(a.end)) + "</td><td>" + esc(engine.yearsToText(a.years)) + "</td></tr>";
      }).join("");
      return "<details" + (running ? ' open class="is-now"' : "") + ">" +
        "<summary><b>" + esc(period.lord) + "</b> <span>" + esc(dateOnly(period.start)) + " → " + esc(dateOnly(period.end)) +
        " · " + period.years + " years</span>" + (running ? '<span class="kun-tag">Running now</span>' : "") + "</summary>" +
        '<div class="kun-antar kun-table-wrap"><table class="kun-table"><thead><tr><th scope="col">Antardasha</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Length</th></tr></thead><tbody>' +
        antar + "</tbody></table></div></details>";
    }).join("");
  }

  function render(chart) {
    state.chart = chart;
    els.results.hidden = false;
    els.personName.textContent = chart.input.name ? chart.input.name + "'s kundli" : "Janam kundali";
    var born = localDateText(chart.utc, chart.offsetMinutes, true);
    els.personMeta.textContent = born + " · " + (chart.input.place || (chart.input.lat.toFixed(3) + ", " + chart.input.lon.toFixed(3))) +
      " · " + chart.offsetText + (state.unknownTime ? " · birth time not known, noon assumed" : "");
    renderSummary(chart);
    drawCharts();
    els.d1Note.textContent = "Whole-sign houses from " + chart.lagna.signEn;
    els.d9Note.textContent = "From navamsa lagna " + engine.SIGNS[chart.navamsa.lagnaSign].en;
    renderPlanets(chart);
    renderPanchang(chart);
    renderDasha(chart);
  }

  /* ------------------------------------------------------------ the form -- */

  function readForm() {
    var zone = els.zone.value;
    var lat = parseFloat(els.lat.value);
    var lon = parseFloat(els.lon.value);
    var placeLabel = els.place.value.trim();
    state.unknownTime = els.unknownTime.checked;
    return {
      name: els.name.value.trim(),
      date: els.date.value,
      time: state.unknownTime ? "12:00" : els.time.value,
      zone: zone,
      lat: lat,
      lon: lon,
      place: placeLabel
    };
  }

  function validate(input) {
    if (!input.date) return "Please enter the date of birth.";
    if (!input.time) return "Please enter the time of birth, or tick “Time not known”.";
    if (!isFinite(input.lat) || !isFinite(input.lon)) {
      return "Please choose the birth place from the list, or type the latitude and longitude yourself.";
    }
    return "";
  }

  function generate(options) {
    var input = readForm();
    var problem = validate(input);
    if (problem) {
      showError(problem);
      return null;
    }
    var chart;
    try {
      chart = engine.computeChart(input);
    } catch (e) {
      showError(e.message || "Could not work out this chart.");
      return null;
    }
    showError("");
    render(chart);
    saveInput(input);
    if (!options || options.updateUrl !== false) updateUrl(input);
    if (!options || options.scroll !== false) {
      els.results.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return chart;
  }

  /* ---------------------------------------------------- saving and links -- */

  function saveInput(input) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, input, { unknownTime: state.unknownTime })));
    } catch (e) { /* private mode */ }
  }

  function loadInput() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function updateUrl(input) {
    try {
      var url = new URL(location.href);
      var q = url.searchParams;
      q.set("d", input.date);
      q.set("t", input.time);
      q.set("tz", input.zone);
      q.set("lat", input.lat.toFixed(4));
      q.set("lon", input.lon.toFixed(4));
      if (input.place) q.set("p", input.place); else q.delete("p");
      if (input.name) q.set("n", input.name); else q.delete("n");
      if (state.unknownTime) q.set("u", "1"); else q.delete("u");
      history.replaceState(null, "", url.pathname + "?" + q.toString());
    } catch (e) { /* file:// */ }
  }

  function fillForm(values) {
    if (!values) return false;
    if (values.name) els.name.value = values.name;
    if (values.date) els.date.value = values.date;
    if (values.time) els.time.value = values.time;
    if (values.zone) setZone(values.zone);
    if (isFinite(values.lat)) els.lat.value = values.lat;
    if (isFinite(values.lon)) els.lon.value = values.lon;
    if (values.place) els.place.value = values.place;
    els.unknownTime.checked = !!values.unknownTime;
    onUnknownTime();
    updatePlaceNote();
    return !!(values.date && values.time && isFinite(values.lat));
  }

  function readUrl() {
    try {
      var q = new URL(location.href).searchParams;
      if (!q.get("d")) return null;
      return {
        name: q.get("n") || "",
        date: q.get("d"),
        time: q.get("t") || "12:00",
        zone: q.get("tz") || "Asia/Kolkata",
        lat: parseFloat(q.get("lat")),
        lon: parseFloat(q.get("lon")),
        place: q.get("p") || "",
        unknownTime: q.get("u") === "1"
      };
    } catch (e) { return null; }
  }

  function copyLink() {
    var text = location.href;
    function done(ok) { toast(ok ? "Link copied — it opens this same kundli." : "Could not copy the link."); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    done(ok);
  }

  /* ------------------------------------------------------------------ PDF -- */

  var jsPdfPromise = null;
  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfPromise) {
      jsPdfPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = JSPDF_URL;
        script.onload = function () { resolve(window.jspdf && window.jspdf.jsPDF); };
        script.onerror = function () { reject(new Error("PDF library did not load")); };
        document.head.appendChild(script);
      });
    }
    return jsPdfPromise;
  }

  /* The PDF is meant to be printed and kept, so it is laid out like a janam
     patri: a saffron header, cream chart cards, and a gold rule under each
     heading. Only the built-in fonts are used, so nothing has to download. */
  var PDF = {
    saffron: [180, 83, 9], saffronDark: [124, 45, 18], gold: [161, 98, 7], line: [207, 155, 82],
    cream: [253, 245, 234], creamDeep: [250, 236, 214], ink: [31, 22, 17], muted: [111, 90, 73],
    maroon: [159, 18, 57], white: [255, 255, 255]
  };

  /* Helvetica in a PDF only covers Windows-1252: no superscript R, no arrow. */
  function pdfLabel(planet) { return planet.symbol + (planet.retrograde ? " R" : ""); }
  function pdfRange(from, to) { return dateOnly(from) + " \u2013 " + dateOnly(to); }

  function pdfKit(doc) {
    var kit = {
      fill: function (c) { doc.setFillColor(c[0], c[1], c[2]); return kit; },
      draw: function (c) { doc.setDrawColor(c[0], c[1], c[2]); return kit; },
      ink: function (c) { doc.setTextColor(c[0], c[1], c[2]); return kit; },
      font: function (family, style, size) { doc.setFont(family, style); doc.setFontSize(size); return kit; },
      box: function (x, y, w, h, r, fillColor, strokeColor, lineWidth) {
        if (fillColor) kit.fill(fillColor);
        if (strokeColor) kit.draw(strokeColor);
        doc.setLineWidth(lineWidth || 0.3);
        doc.roundedRect(x, y, w, h, r, r, fillColor && strokeColor ? "FD" : (fillColor ? "F" : "S"));
        return kit;
      },
      text: function (str, x, y, options) { doc.text(String(str), x, y, options); return kit; }
    };
    return kit;
  }

  /** A small chakra, drawn with a circle and twelve spokes. */
  function drawChakra(doc, cx, cy, r, color) {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(0.4);
    doc.circle(cx, cy, r);
    doc.circle(cx, cy, r * 0.42);
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      doc.line(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }

  function sectionHeading(doc, text, x, y, width) {
    var kit = pdfKit(doc);
    kit.font("times", "bold", 12).ink(PDF.saffronDark).text(text, x, y);
    kit.fill(PDF.line);
    doc.rect(x, y + 1.6, width, 0.5, "F");
  }

  /** One chart card: cream paper, gold rules, planets in their houses. */
  function drawPdfChart(doc, chart, divisional, x, y, size, cardWidth) {
    var kit = pdfKit(doc);
    var houses = housesFor(chart, divisional);
    var titles = chartTitleLines(chart, divisional);
    var pad = 6;
    var cardW = cardWidth || size + pad * 2;
    var cardH = size + pad * 2 + 10;
    kit.box(x, y, cardW, cardH, 3, PDF.cream, PDF.line, 0.4);
    kit.font("times", "bold", 10).ink(PDF.saffronDark).text(titles[0], x + pad, y + 7);
    kit.font("helvetica", "normal", 8).ink(PDF.muted).text(titles[1], x + cardW - pad, y + 7, { align: "right" });

    var gx = x + (cardW - size) / 2;
    var gy = y + pad + 8;

    function at(px, py) { return [gx + px * size / 100, gy + py * size / 100]; }
    function seg(a, b, width) {
      var p1 = at(a[0], a[1]);
      var p2 = at(b[0], b[1]);
      doc.setLineWidth(width || 0.3);
      doc.line(p1[0], p1[1], p2[0], p2[1]);
    }

    kit.draw(PDF.line);
    doc.setLineWidth(0.5);
    doc.rect(gx, gy, size, size);

    function houseLabels(cx, cy, signNumber, planets) {
      var head = at(cx, cy - 6);
      kit.font("helvetica", "bold", 6.5).ink(PDF.gold).text(signNumber, head[0], head[1], { align: "center" });
      kit.font("helvetica", "bold", 7.2).ink(PDF.ink);
      for (var r = 0; r * 2 < planets.length; r++) {
        var pos = at(cx, cy + 1 + r * 6);
        doc.text(planets.slice(r * 2, r * 2 + 2).join(" "), pos[0], pos[1], { align: "center" });
      }
    }

    if (state.style === "south") {
      for (var g = 1; g < 4; g++) {
        seg([g * 25, 0], [g * 25, 100]);
        seg([0, g * 25], [100, g * 25]);
      }
      /* the middle four cells are one panel, so paint over their inner lines */
      var mid = at(25, 25);
      kit.box(mid[0], mid[1], size / 2, size / 2, 1, PDF.creamDeep, PDF.line, 0.3);
      var bySign = {};
      houses.forEach(function (h) { bySign[h.sign] = h; });
      var lagnaSign = divisional ? chart.navamsa.lagnaSign : chart.lagna.sign;
      SOUTH_CELLS.forEach(function (cell) {
        var cx = cell.col * 25;
        var cy = cell.row * 25;
        if (cell.sign === lagnaSign) {
          kit.draw(PDF.saffron);
          seg([cx, cy], [cx + 25, cy + 25], 0.5);
          kit.draw(PDF.line);
        }
        var head = at(cx + 2, cy + 5.5);
        kit.font("helvetica", "bold", 6.5).ink(PDF.gold).text(engine.SIGNS[cell.sign].en.slice(0, 3), head[0], head[1]);
        var names = (bySign[cell.sign] || { planets: [] }).planets.map(pdfLabel);
        kit.font("helvetica", "bold", 7.2).ink(PDF.ink);
        for (var r2 = 0; r2 * 2 < names.length; r2++) {
          var pos2 = at(cx + 12.5, cy + 12 + r2 * 6);
          doc.text(names.slice(r2 * 2, r2 * 2 + 2).join(" "), pos2[0], pos2[1], { align: "center" });
        }
      });
      var c1 = at(50, 47);
      kit.font("times", "bold", 9).ink(PDF.saffronDark).text(titles[0], c1[0], c1[1], { align: "center" });
      var c2 = at(50, 57);
      kit.font("helvetica", "normal", 7).ink(PDF.muted).text(titles[1], c2[0], c2[1], { align: "center" });
      return;
    }

    seg([0, 0], [100, 100]);
    seg([100, 0], [0, 100]);
    seg([50, 0], [100, 50]);
    seg([100, 50], [50, 100]);
    seg([50, 100], [0, 50]);
    seg([0, 50], [50, 0]);
    houses.forEach(function (house, i) {
      var box = NORTH_HOUSES[i];
      houseLabels(box.cx, box.cy, String(house.sign + 1), house.planets.map(pdfLabel));
    });
  }

  function pdfFooter(doc, chart, page, pages) {
    var kit = pdfKit(doc);
    kit.fill(PDF.creamDeep);
    doc.rect(0, 283, 210, 14, "F");
    kit.fill(PDF.line);
    doc.rect(0, 283, 210, 0.4, "F");
    kit.font("helvetica", "normal", 7).ink(PDF.muted);
    doc.text("Sidereal positions, Lahiri ayanamsa " + chart.ayanamsaText + " · whole-sign houses · mean nodes", 14, 289);
    doc.text("tooladda.online/calculators/kundli-maker.html", 14, 293);
    doc.text("Page " + page + " of " + pages, 196, 289, { align: "right" });
    kit.font("helvetica", "italic", 6.5);
    doc.text("Astronomy computed; astrology is tradition, not science.", 196, 293, { align: "right" });
  }

  function pdfStatRow(doc, items, x, y, width) {
    var kit = pdfKit(doc);
    var gap = 3;
    var w = (width - gap * (items.length - 1)) / items.length;
    items.forEach(function (item, i) {
      var bx = x + i * (w + gap);
      kit.box(bx, y, w, 17, 2.5, PDF.cream, PDF.line, 0.3);
      kit.fill(PDF.saffron);
      doc.rect(bx, y, 1.4, 17, "F");
      kit.font("helvetica", "bold", 6.2).ink(PDF.muted).text(item[0].toUpperCase(), bx + 4, y + 5.4);
      kit.font("times", "bold", 10.5).ink(PDF.ink).text(item[1], bx + 4, y + 11);
      if (item[2]) kit.font("helvetica", "normal", 6.6).ink(PDF.muted).text(item[2], bx + 4, y + 15);
    });
    return y + 17;
  }

  function buildPdf(jsPDF) {
    var chart = state.chart;
    var kit;
    var doc = new jsPDF({ unit: "mm", format: "a4" });
    kit = pdfKit(doc);
    var M = 14;
    var W = 210;
    var contentW = W - M * 2;
    var p = chart.panchang;

    /* ---- header band ---- */
    kit.fill(PDF.saffron);
    doc.rect(0, 0, W, 36, "F");
    kit.fill(PDF.saffronDark);
    doc.rect(0, 30, W, 6, "F");
    drawChakra(doc, W - 26, 17, 11, [251, 214, 160]);
    kit.font("times", "bold", 21).ink(PDF.white);
    doc.text(chart.input.name ? chart.input.name : "Janam Kundali", M, 15);
    kit.font("helvetica", "normal", 9.5).ink([253, 230, 198]);
    doc.text(localDateText(chart.utc, chart.offsetMinutes, true) + "  ·  " +
      (chart.input.place || chart.input.lat.toFixed(3) + ", " + chart.input.lon.toFixed(3)), M, 22);
    doc.text(chart.offsetText + "  ·  " + Math.abs(chart.input.lat).toFixed(3) + "° " + (chart.input.lat < 0 ? "S" : "N") +
      ", " + Math.abs(chart.input.lon).toFixed(3) + "° " + (chart.input.lon < 0 ? "W" : "E") +
      "  ·  Vedic birth chart", M, 27);
    kit.font("helvetica", "bold", 8).ink(PDF.white);
    doc.text("JANAM KUNDALI", M, 34);

    /* ---- summary ---- */
    var y = 44;
    y = pdfStatRow(doc, [
      ["Lagna", chart.lagna.signEn, chart.lagna.degreeText],
      ["Rashi (Moon)", chart.summary.moonSignEn, chart.summary.moonSign],
      ["Nakshatra", chart.summary.nakshatra, "Pada " + chart.summary.nakshatraPada],
      ["Tithi", p.tithi.name, p.tithi.paksha + " · " + p.vara.en]
    ], M, y, contentW) + 9;

    /* ---- charts ---- */
    sectionHeading(doc, "Birth charts", M, y, contentW);
    y += 7;
    var chartSize = 68;
    var chartCard = (contentW - 6) / 2;
    drawPdfChart(doc, chart, false, M, y, chartSize, chartCard);
    drawPdfChart(doc, chart, true, M + contentW - chartCard, y, chartSize, chartCard);
    y += chartSize + 22 + 6;

    /* ---- planets ---- */
    sectionHeading(doc, "Planetary positions", M, y, contentW);
    y += 6;
    var cols = [M + 2, M + 26, M + 52, M + 74, M + 84, M + 116, M + 126, M + 144];
    var headers = ["Graha", "Sign", "Degree", "House", "Nakshatra", "Pada", "Navamsa", "Notes"];
    kit.fill(PDF.saffron);
    doc.rect(M, y, contentW, 7, "F");
    kit.font("helvetica", "bold", 7).ink(PDF.white);
    headers.forEach(function (h, i) { doc.text(h, cols[i], y + 4.8); });
    y += 7;
    chart.planets.forEach(function (planet, i) {
      if (i % 2 === 1) {
        kit.fill(PDF.cream);
        doc.rect(M, y, contentW, 6.4, "F");
      }
      kit.font("helvetica", "bold", 8).ink(PDF.ink).text(planet.name, cols[0], y + 4.4);
      kit.font("helvetica", "normal", 8).ink(PDF.ink);
      doc.text(planet.signEn, cols[1], y + 4.4);
      doc.text(planet.degreeText, cols[2], y + 4.4);
      doc.text(String(planet.house), cols[3], y + 4.4);
      doc.text(planet.nakshatra, cols[4], y + 4.4);
      doc.text(String(planet.pada), cols[5], y + 4.4);
      doc.text(planet.navamsaSignName, cols[6], y + 4.4);
      var notes = [];
      if (planet.retrograde) notes.push("Retrograde");
      if (planet.dignity) notes.push(planet.dignity);
      kit.font("helvetica", "bold", 7.2).ink(planet.retrograde ? PDF.maroon : PDF.gold);
      doc.text(notes.join(", ") || "", cols[7], y + 4.4);
      y += 6.4;
    });
    kit.draw(PDF.line);
    doc.setLineWidth(0.3);
    doc.line(M, y, M + contentW, y);

    /* ---- the twelve bhavas, three to a row ---- */
    y += 8;
    sectionHeading(doc, "Houses (bhava)", M, y, contentW);
    y += 6;
    var colW = contentW / 3;
    chart.houses.forEach(function (house, i) {
      var hx = M + (i % 3) * colW;
      var hy = y + Math.floor(i / 3) * 5.8;
      kit.font("helvetica", "bold", 7.5).ink(PDF.saffronDark).text(String(house.house), hx, hy + 4);
      kit.font("helvetica", "normal", 7.5).ink(PDF.ink).text(house.signEn, hx + 5, hy + 4);
      var names = house.planets.map(pdfLabel).join(", ");
      kit.font("helvetica", "bold", 7.5).ink(names ? PDF.gold : PDF.muted)
        .text(names || "\u2014", hx + 26, hy + 4);
    });
    y += 4 * 5.8;

    /* ---- page two: panchang and dasha ---- */
    doc.addPage();
    kit = pdfKit(doc);
    kit.fill(PDF.saffron);
    doc.rect(0, 0, W, 16, "F");
    kit.font("times", "bold", 12).ink(PDF.white);
    doc.text((chart.input.name ? chart.input.name + " \u2014 " : "") + "Panchang and dasha", M, 11);

    y = 26;
    sectionHeading(doc, "Panchang at birth", M, y, contentW);
    y += 7;
    var sunrise = p.sunrise ? localDateText(p.sunrise, chart.offsetMinutes, true).split(", ")[1] : "\u2014";
    var sunset = p.sunset ? localDateText(p.sunset, chart.offsetMinutes, true).split(", ")[1] : "\u2014";
    y = pdfStatRow(doc, [
      ["Tithi", p.tithi.name, p.tithi.paksha + " paksha"],
      ["Vara", p.vara.en, p.vara.sanskrit],
      ["Nakshatra", p.nakshatra.name, "Pada " + p.nakshatra.pada],
      ["Yoga", p.yoga.name, "Yoga " + (p.yoga.index + 1) + " of 27"]
    ], M, y, contentW) + 4;
    y = pdfStatRow(doc, [
      ["Karana", p.karana.name, "Half-tithi " + (p.karana.index + 1)],
      ["Sunrise", sunrise, "at the birth place"],
      ["Sunset", sunset, "at the birth place"],
      ["Ayanamsa", chart.ayanamsaText, "Lahiri"]
    ], M, y, contentW);

    y += 10;
    sectionHeading(doc, "Vimshottari dasha", M, y, contentW);
    y += 7;
    var current = chart.currentDasha;
    if (current) {
      kit.box(M, y, contentW, 21, 2.5, PDF.creamDeep, PDF.saffron, 0.5);
      kit.font("helvetica", "bold", 6.5).ink(PDF.saffronDark).text("RUNNING TODAY", M + 4, y + 5.5);
      kit.font("times", "bold", 12).ink(PDF.ink)
        .text(current.maha.lord + " mahadasha" + (current.antar ? "  /  " + current.antar.lord + " antardasha" : ""), M + 4, y + 12);
      kit.font("helvetica", "normal", 7.5).ink(PDF.muted)
        .text(pdfRange(current.maha.start, current.maha.end) +
          (current.antar ? "     antardasha " + pdfRange(current.antar.start, current.antar.end) : ""), M + 4, y + 17.5);
      var done = Math.min(1, Math.max(0, (Date.now() - current.maha.start) / (current.maha.end - current.maha.start)));
      kit.fill([232, 216, 195]);
      doc.roundedRect(M + contentW - 54, y + 7.5, 50, 3, 1.5, 1.5, "F");
      kit.fill(PDF.saffron);
      doc.roundedRect(M + contentW - 54, y + 7.5, Math.max(1.5, 50 * done), 3, 1.5, 1.5, "F");
      kit.font("helvetica", "normal", 6.5).ink(PDF.muted)
        .text(Math.round(done * 100) + "% of this mahadasha has passed", M + contentW - 54, y + 14);
      y += 27;
    }

    kit.fill(PDF.saffron);
    doc.rect(M, y, contentW, 7, "F");
    kit.font("helvetica", "bold", 7).ink(PDF.white);
    [["Mahadasha", M + 2], ["From", M + 30], ["To", M + 60], ["Years", M + 90],
     ["Antardashas of the running mahadasha", M + 106]].forEach(function (h) { doc.text(h[0], h[1], y + 4.8); });
    y += 7;
    var antar = current ? current.maha.antardasha : [];
    var rows = Math.max(chart.dasha.periods.length, antar.length);
    for (var i = 0; i < rows; i++) {
      if (y > 262) break;
      var period = chart.dasha.periods[i];
      if (i % 2 === 1) {
        kit.fill(PDF.cream);
        doc.rect(M, y, contentW, 6.2, "F");
      }
      if (period) {
        var running = current && current.index === i;
        kit.font("helvetica", running ? "bold" : "normal", 8).ink(running ? PDF.saffronDark : PDF.ink);
        doc.text(period.lord, M + 2, y + 4.3);
        doc.text(dateOnly(period.start), M + 30, y + 4.3);
        doc.text(dateOnly(period.end), M + 60, y + 4.3);
        doc.text(String(period.years), M + 90, y + 4.3);
      }
      var sub = antar[i];
      if (sub) {
        var subRunning = current && current.antar === sub;
        kit.font("helvetica", subRunning ? "bold" : "normal", 8).ink(subRunning ? PDF.saffronDark : PDF.muted);
        doc.text(sub.lord + "   " + pdfRange(sub.start, sub.end), M + 106, y + 4.3);
      }
      y += 6.2;
    }
    kit.draw(PDF.line);
    doc.setLineWidth(0.3);
    doc.line(M, y, M + contentW, y);
    y += 8;

    kit.box(M, y, contentW, 24, 2.5, PDF.cream, PDF.line, 0.3);
    kit.font("helvetica", "bold", 7).ink(PDF.saffronDark).text("ABOUT THIS CHART", M + 4, y + 6);
    kit.font("helvetica", "normal", 7.5).ink(PDF.muted);
    doc.text(doc.splitTextToSize(
      "Planetary longitudes come from a modern ephemeris and are converted to the sidereal zodiac with the Lahiri " +
      "(Chitrapaksha) ayanamsa. Rahu and Ketu are the mean lunar nodes and the houses are whole-sign, so the lagna's sign is " +
      "the whole first house. Dasha dates use a 365.2425-day year. The astronomy is measured; what astrology reads into it is " +
      "tradition, not a scientific finding.", contentW - 8), M + 4, y + 11);

    pdfFooter(doc, chart, 1, 2);
    doc.setPage(1);
    pdfFooter(doc, chart, 1, 2);
    doc.setPage(2);
    pdfFooter(doc, chart, 2, 2);
    return doc;
  }

  function downloadPdf() {
    if (!state.chart) return;
    toast("Preparing the PDF…");
    loadJsPdf().then(function (jsPDF) {
      var doc = buildPdf(jsPDF);
      var base = (state.chart.input.name || "kundli").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "kundli";
      doc.save(base + "-" + state.chart.input.date + ".pdf");
      toast("PDF downloaded.");
    }).catch(function () {
      toast("The PDF library could not load. Use Print instead — it can save as PDF.");
    });
  }

  /* ---------------------------------------------------------------- setup -- */

  function onUnknownTime() {
    var unknown = els.unknownTime.checked;
    els.time.disabled = unknown;
    if (unknown && !els.time.value) els.time.value = "12:00";
  }

  function bindPlaceSearch() {
    var timer = null;
    els.place.addEventListener("input", function () {
      state.place = null;
      clearTimeout(timer);
      var value = els.place.value;
      timer = setTimeout(function () {
        searchPlaces(value).then(renderSuggestions);
      }, 120);
    });
    els.place.addEventListener("keydown", function (e) {
      var items = $all("li", els.suggest);
      if (!items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var next = state.activeSuggestion + (e.key === "ArrowDown" ? 1 : -1);
        if (next < 0) next = items.length - 1;
        if (next >= items.length) next = 0;
        state.activeSuggestion = next;
        items.forEach(function (li, i) { li.setAttribute("aria-selected", String(i === next)); });
        items[next].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && state.activeSuggestion >= 0) {
        e.preventDefault();
        choosePlace(state.suggestions[state.activeSuggestion]);
      } else if (e.key === "Escape") {
        els.suggest.hidden = true;
      }
    });
    els.suggest.addEventListener("mousedown", function (e) {
      var li = e.target.closest("li[data-index]");
      if (!li) return;
      e.preventDefault();
      choosePlace(state.suggestions[Number(li.dataset.index)]);
    });
    document.addEventListener("click", function (e) {
      if (!els.place.contains(e.target) && !els.suggest.contains(e.target)) els.suggest.hidden = true;
    });
  }

  function bindEvents() {
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      generate();
    });
    els.unknownTime.addEventListener("change", onUnknownTime);
    [els.lat, els.lon].forEach(function (input) {
      input.addEventListener("input", function () { state.place = null; updatePlaceNote(); });
    });
    els.zone.addEventListener("change", updatePlaceNote);
    $("[data-kun-sample]").addEventListener("click", function () {
      fillForm(SAMPLE);
      generate();
    });
    $("[data-kun-reset]").addEventListener("click", function () {
      els.form.reset();
      state.place = null;
      state.chart = null;
      els.results.hidden = true;
      showError("");
      setZone("Asia/Kolkata");
      onUnknownTime();
      updatePlaceNote();
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
    });
    $all("[data-kun-style]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.style = btn.getAttribute("data-kun-style");
        drawCharts();
      });
    });
    $("[data-kun-pdf]").addEventListener("click", downloadPdf);
    $("[data-kun-copy]").addEventListener("click", copyLink);
    $("[data-kun-print]").addEventListener("click", function () { window.print(); });
  }

  function init() {
    els = {
      form: $("[data-kun-form]"),
      name: $("[data-kun-name]"),
      date: $("[data-kun-date]"),
      time: $("[data-kun-time]"),
      unknownTime: $("[data-kun-unknown-time]"),
      place: $("[data-kun-place]"),
      suggest: $("[data-kun-place] ~ .kun-suggest") || $("#kun-place-list"),
      placeNote: $("[data-kun-place-note]"),
      lat: $("[data-kun-lat]"),
      lon: $("[data-kun-lon]"),
      zone: $("[data-kun-zone]"),
      error: $("[data-kun-error]"),
      results: $("[data-kun-results]"),
      personName: $("[data-kun-person-name]"),
      personMeta: $("[data-kun-person-meta]"),
      summary: $("[data-kun-summary]"),
      chartD1: $("[data-kun-chart-d1]"),
      chartD9: $("[data-kun-chart-d9]"),
      chartNote: $("[data-kun-chart-note]"),
      d1Note: $("[data-kun-d1-note]"),
      d9Note: $("[data-kun-d9-note]"),
      planets: $("[data-kun-planets]"),
      ayanamsa: $("[data-kun-ayanamsa]"),
      panchang: $("[data-kun-panchang]"),
      dashaNow: $("[data-kun-dasha-now]"),
      dashaList: $("[data-kun-dasha-list]"),
      toast: $("[data-kun-toast]")
    };
    if (!els.form || !engine) return;

    fillZones();
    bindPlaceSearch();
    bindEvents();
    onUnknownTime();

    var fromUrl = readUrl();
    var ready = fillForm(fromUrl || loadInput());
    if (fromUrl && ready) generate({ scroll: false, updateUrl: false });

    /* the place list is small and makes the first keystroke instant */
    if ("requestIdleCallback" in window) requestIdleCallback(function () { loadCityFile("india"); });
    else setTimeout(function () { loadCityFile("india"); }, 1200);

    window.KundliMaker = {
      generate: generate,
      getChart: function () { return state.chart; },
      setStyle: function (style) { state.style = style; drawCharts(); },
      searchPlaces: searchPlaces,
      fillForm: fillForm,
      buildPdf: function () { return loadJsPdf().then(buildPdf); },
      sample: SAMPLE
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
