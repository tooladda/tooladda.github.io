/* ============================================================================
   ToolAdda — Kundli engine
   Sidereal (Vedic) birth-chart maths: planet positions, lagna, whole-sign
   houses, nakshatras, the navamsa (D9) chart, Vimshottari dasha and the
   panchang of the birth moment.

   No DOM, no network, no state. Positions come from Astronomy Engine
   (MIT, https://github.com/cosinekitty/astronomy), which gives apparent
   geocentric longitudes in the true ecliptic of date; subtracting the
   ayanamsa turns them into the sidereal longitudes Vedic astrology uses.

   Browser:  <script src="astronomy.browser.min.js"></script>
             <script src="kundli-engine.js"></script>   → window.KundliEngine
   Node:     const K = require('./assets/js/kundli-engine.js');
   ============================================================================ */

(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("astronomy-engine"));
  } else {
    root.KundliEngine = factory(root.Astronomy);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (Astronomy) {
  "use strict";

  var DEG = Math.PI / 180;
  var SIGN_ARC = 30;
  var NAK_ARC = 360 / 27;          /* 13°20' */
  var PADA_ARC = NAK_ARC / 4;      /* 3°20'  */
  var SIDEREAL_YEAR_DAYS = 365.2425;
  var DAY_MS = 86400000;

  /* ---------------------------------------------------------------- data -- */

  var SIGNS = [
    { name: "Mesha", en: "Aries", lord: "Mars", element: "Fire", quality: "Movable" },
    { name: "Vrishabha", en: "Taurus", lord: "Venus", element: "Earth", quality: "Fixed" },
    { name: "Mithuna", en: "Gemini", lord: "Mercury", element: "Air", quality: "Dual" },
    { name: "Karka", en: "Cancer", lord: "Moon", element: "Water", quality: "Movable" },
    { name: "Simha", en: "Leo", lord: "Sun", element: "Fire", quality: "Fixed" },
    { name: "Kanya", en: "Virgo", lord: "Mercury", element: "Earth", quality: "Dual" },
    { name: "Tula", en: "Libra", lord: "Venus", element: "Air", quality: "Movable" },
    { name: "Vrischika", en: "Scorpio", lord: "Mars", element: "Water", quality: "Fixed" },
    { name: "Dhanu", en: "Sagittarius", lord: "Jupiter", element: "Fire", quality: "Dual" },
    { name: "Makara", en: "Capricorn", lord: "Saturn", element: "Earth", quality: "Movable" },
    { name: "Kumbha", en: "Aquarius", lord: "Saturn", element: "Air", quality: "Fixed" },
    { name: "Meena", en: "Pisces", lord: "Jupiter", element: "Water", quality: "Dual" }
  ];

  /* The nine dasha lords repeat over the 27 nakshatras in this order. */
  var DASHA_LORDS = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu", "Jupiter", "Saturn", "Mercury"];
  var DASHA_YEARS = { Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7, Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17 };

  var NAKSHATRAS = [
    "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu", "Pushya", "Ashlesha",
    "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
    "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada",
    "Uttara Bhadrapada", "Revati"
  ];

  var PLANETS = [
    { key: "Sun", name: "Sun", sanskrit: "Surya", symbol: "Su", body: "Sun" },
    { key: "Moon", name: "Moon", sanskrit: "Chandra", symbol: "Mo", body: "Moon" },
    { key: "Mars", name: "Mars", sanskrit: "Mangal", symbol: "Ma", body: "Mars" },
    { key: "Mercury", name: "Mercury", sanskrit: "Budha", symbol: "Me", body: "Mercury" },
    { key: "Jupiter", name: "Jupiter", sanskrit: "Guru", symbol: "Ju", body: "Jupiter" },
    { key: "Venus", name: "Venus", sanskrit: "Shukra", symbol: "Ve", body: "Venus" },
    { key: "Saturn", name: "Saturn", sanskrit: "Shani", symbol: "Sa", body: "Saturn" },
    { key: "Rahu", name: "Rahu", sanskrit: "Rahu", symbol: "Ra", body: null },
    { key: "Ketu", name: "Ketu", sanskrit: "Ketu", symbol: "Ke", body: null }
  ];

  /* Exaltation degree, and the sign a planet rules. Debilitation is the
     opposite sign of the exaltation. The nodes are left out: the classics
     disagree about them. */
  var DIGNITY = {
    Sun: { exalt: 0, exaltDeg: 10, own: [4] },
    Moon: { exalt: 1, exaltDeg: 3, own: [3] },
    Mars: { exalt: 9, exaltDeg: 28, own: [0, 7] },
    Mercury: { exalt: 5, exaltDeg: 15, own: [2, 5] },
    Jupiter: { exalt: 3, exaltDeg: 5, own: [8, 11] },
    Venus: { exalt: 11, exaltDeg: 27, own: [1, 6] },
    Saturn: { exalt: 6, exaltDeg: 20, own: [9, 10] }
  };

  var TITHI_NAMES = [
    "Pratipada", "Dwitiya", "Tritiya", "Chaturthi", "Panchami", "Shashthi", "Saptami", "Ashtami",
    "Navami", "Dashami", "Ekadashi", "Dwadashi", "Trayodashi", "Chaturdashi"
  ];

  var YOGA_NAMES = [
    "Vishkambha", "Priti", "Ayushman", "Saubhagya", "Shobhana", "Atiganda", "Sukarma", "Dhriti", "Shula",
    "Ganda", "Vriddhi", "Dhruva", "Vyaghata", "Harshana", "Vajra", "Siddhi", "Vyatipata", "Variyana",
    "Parigha", "Shiva", "Siddha", "Sadhya", "Shubha", "Shukla", "Brahma", "Indra", "Vaidhriti"
  ];

  var MOVABLE_KARANAS = ["Bava", "Balava", "Kaulava", "Taitila", "Gara", "Vanija", "Vishti"];
  var WEEKDAYS = [
    { en: "Sunday", sanskrit: "Ravivara", lord: "Sun" },
    { en: "Monday", sanskrit: "Somavara", lord: "Moon" },
    { en: "Tuesday", sanskrit: "Mangalavara", lord: "Mars" },
    { en: "Wednesday", sanskrit: "Budhavara", lord: "Mercury" },
    { en: "Thursday", sanskrit: "Guruvara", lord: "Jupiter" },
    { en: "Friday", sanskrit: "Shukravara", lord: "Venus" },
    { en: "Saturday", sanskrit: "Shanivara", lord: "Saturn" }
  ];

  /* ------------------------------------------------------------- helpers -- */

  function norm360(deg) {
    var d = deg % 360;
    return d < 0 ? d + 360 : d;
  }

  function signIndex(lon) { return Math.floor(norm360(lon) / SIGN_ARC); }
  function degInSign(lon) { return norm360(lon) % SIGN_ARC; }

  /** 12.5083 → "12° 30' 30"" */
  function formatDeg(deg, withSeconds) {
    var d = Math.floor(deg);
    var mFloat = (deg - d) * 60;
    var m = Math.floor(mFloat);
    var s = Math.round((mFloat - m) * 60);
    if (s === 60) { s = 0; m += 1; }
    if (m === 60) { m = 0; d += 1; }
    return withSeconds === false
      ? d + "° " + pad2(m) + "'"
      : d + "° " + pad2(m) + "' " + pad2(s) + '"';
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /**
   * The Lahiri (Chitrapaksha) ayanamsa: the gap between the tropical zodiac
   * and the sidereal one, which grows with the precession of the equinoxes.
   * 23°51'11.5" at J2000 plus the IAU general precession in longitude.
   */
  function ayanamsa(date) {
    var T = (julianDay(date) - 2451545.0) / 36525;
    return 23.853194 + 1.396971 * T + 0.0003086 * T * T;
  }

  function julianDay(date) {
    return date.getTime() / DAY_MS + 2440587.5;
  }

  /** The obliquity of the ecliptic, IAU 1980 mean value plus the main nutation. */
  function obliquity(date) {
    var T = (julianDay(date) - 2451545.0) / 36525;
    return 23.4392911 - 0.0130042 * T - 0.00000016 * T * T + 0.000000504 * T * T * T;
  }

  /* -------------------------------------------------------- time and place -- */

  /**
   * Minutes that a time zone is ahead of UTC at the given moment, taking the
   * rules that were in force then (summer time, historical changes) from the
   * browser's own time-zone database.
   */
  function zoneOffsetMinutes(zone, utcDate) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    var parts = {};
    fmt.formatToParts(utcDate).forEach(function (p) { parts[p.type] = p.value; });
    var asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return Math.round((asUTC - utcDate.getTime()) / 60000);
  }

  /**
   * Local wall-clock birth time → the UTC instant.
   * `zone` is an IANA name such as Asia/Kolkata, or a number of minutes ahead
   * of UTC for a manual entry. Two passes settle the offset where the clock
   * changed that day.
   */
  function toUTC(dateStr, timeStr, zone) {
    var d = String(dateStr).split("-").map(Number);
    var t = String(timeStr).split(":").map(Number);
    if (d.length < 3 || !isFinite(d[0]) || !isFinite(t[0])) throw new Error("Enter a valid birth date and time.");
    var naive = Date.UTC(d[0], d[1] - 1, d[2], t[0] || 0, t[1] || 0, t[2] || 0);
    if (d[0] < 100) { /* Date.UTC maps years 0-99 to 1900-1999 */
      var fix = new Date(naive);
      fix.setUTCFullYear(d[0]);
      naive = fix.getTime();
    }
    if (typeof zone === "number") {
      return { date: new Date(naive - zone * 60000), offsetMinutes: zone };
    }
    var guess = new Date(naive);
    var offset = zoneOffsetMinutes(zone, guess);
    var utc = new Date(naive - offset * 60000);
    var again = zoneOffsetMinutes(zone, utc);
    if (again !== offset) utc = new Date(naive - again * 60000);
    return { date: utc, offsetMinutes: again };
  }

  function formatOffset(minutes) {
    var sign = minutes < 0 ? "-" : "+";
    var abs = Math.abs(minutes);
    return "UTC" + sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
  }

  /* ------------------------------------------------------------- astronomy -- */

  /** Apparent geocentric longitude in the true ecliptic of date, in degrees. */
  function tropicalLongitude(bodyName, date) {
    var time = Astronomy.MakeTime(date);
    if (bodyName === "Moon") return norm360(Astronomy.EclipticGeoMoon(time).lon);
    var vec = Astronomy.GeoVector(Astronomy.Body[bodyName], time, true);
    return norm360(Astronomy.Ecliptic(vec).elon);
  }

  /**
   * The mean ascending lunar node — Rahu. Vedic charts use the mean node by
   * default, and it always moves backwards through the zodiac.
   */
  function meanNode(date) {
    var T = (julianDay(date) - 2451545.0) / 36525;
    return norm360(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T * T * T / 467441 - T * T * T * T / 60616000);
  }

  /** Degrees of ecliptic longitude the body moves in a day, negative when retrograde. */
  function dailyMotion(bodyName, date) {
    var step = 0.25;
    var before = bodyName === "Rahu" ? meanNode(new Date(date.getTime() - step * DAY_MS)) : tropicalLongitude(bodyName, new Date(date.getTime() - step * DAY_MS));
    var after = bodyName === "Rahu" ? meanNode(new Date(date.getTime() + step * DAY_MS)) : tropicalLongitude(bodyName, new Date(date.getTime() + step * DAY_MS));
    var diff = after - before;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return diff / (2 * step);
  }

  /**
   * The lagna (ascendant): the ecliptic degree rising over the eastern horizon.
   * Returned tropical; the caller subtracts the ayanamsa.
   */
  function tropicalAscendant(date, lat, lon) {
    var gst = Astronomy.SiderealTime(Astronomy.MakeTime(date));   /* hours */
    var lst = norm360((gst + lon / 15) * 15);                     /* degrees */
    var eps = obliquity(date) * DEG;
    var phi = lat * DEG;
    var ramc = lst * DEG;
    var asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps)));
    return norm360(asc / DEG);
  }

  /** Sunrise and sunset around the birth moment, at the birth place. */
  function sunEvents(date, lat, lon) {
    var observer = new Astronomy.Observer(lat, lon, 0);
    var dayStart = new Date(date.getTime() - DAY_MS);
    function search(direction, from) {
      var found = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, direction, Astronomy.MakeTime(from), 3);
      return found ? found.date : null;
    }
    var rise = search(+1, dayStart);
    var set = search(-1, dayStart);
    /* the sunrise that opens the Vedic day the birth falls in */
    var prevRise = rise;
    while (rise && rise.getTime() <= date.getTime()) {
      prevRise = rise;
      rise = search(+1, new Date(rise.getTime() + 3600000));
    }
    while (set && set.getTime() <= prevRise.getTime()) {
      set = search(-1, new Date(set.getTime() + 3600000));
    }
    return { sunrise: prevRise, nextSunrise: rise, sunset: set };
  }

  /* --------------------------------------------------------- chart pieces -- */

  function nakshatraOf(lon) {
    var l = norm360(lon);
    var index = Math.floor(l / NAK_ARC);
    var within = l - index * NAK_ARC;
    return {
      index: index,
      name: NAKSHATRAS[index],
      lord: DASHA_LORDS[index % 9],
      pada: Math.floor(within / PADA_ARC) + 1,
      fraction: within / NAK_ARC
    };
  }

  /**
   * Navamsa (D9) sign. Each sign splits into nine parts of 3°20'; counting
   * runs from Aries for fire signs, Capricorn for earth, Libra for air and
   * Cancer for water, which is what this one line does.
   */
  function navamsaSign(lon) {
    return Math.floor(norm360(lon) / (SIGN_ARC / 9)) % 12;
  }

  function dignityOf(key, sign, deg) {
    var d = DIGNITY[key];
    if (!d) return "";
    if (sign === d.exalt) return Math.abs(deg - d.exaltDeg) <= 1 ? "Exalted (deep)" : "Exalted";
    if (sign === (d.exalt + 6) % 12) return "Debilitated";
    if (d.own.indexOf(sign) >= 0) return "Own sign";
    return "";
  }

  function describe(lon, extra) {
    var sign = signIndex(lon);
    var deg = degInSign(lon);
    var nak = nakshatraOf(lon);
    var out = {
      longitude: norm360(lon),
      sign: sign,
      signName: SIGNS[sign].name,
      signEn: SIGNS[sign].en,
      signLord: SIGNS[sign].lord,
      degree: deg,
      degreeText: formatDeg(deg),
      nakshatra: nak.name,
      nakshatraIndex: nak.index,
      nakshatraLord: nak.lord,
      pada: nak.pada,
      navamsaSign: navamsaSign(lon),
      navamsaSignName: SIGNS[navamsaSign(lon)].name
    };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /* ---------------------------------------------------------- vimshottari -- */

  function addYears(date, years) {
    return new Date(date.getTime() + years * SIDEREAL_YEAR_DAYS * DAY_MS);
  }

  /**
   * Vimshottari dasha: the 120-year cycle of planetary periods, started from
   * the part of its nakshatra the Moon had already crossed at birth.
   */
  function vimshottari(moonLon, birthDate, options) {
    var opts = options || {};
    var cycles = opts.cycles || 2;               /* 240 years covers any life */
    var nak = nakshatraOf(moonLon);
    var startIndex = DASHA_LORDS.indexOf(nak.lord);
    var firstYears = DASHA_YEARS[nak.lord];
    var balance = firstYears * (1 - nak.fraction);
    var periods = [];
    var cursor = addYears(birthDate, -(firstYears - balance));   /* when this dasha began */
    for (var i = 0; i < DASHA_LORDS.length * cycles; i++) {
      var lord = DASHA_LORDS[(startIndex + i) % DASHA_LORDS.length];
      var years = DASHA_YEARS[lord];
      var start = cursor;
      var end = addYears(start, years);
      var antar = [];
      var subCursor = start;
      for (var j = 0; j < DASHA_LORDS.length; j++) {
        var subLord = DASHA_LORDS[(DASHA_LORDS.indexOf(lord) + j) % DASHA_LORDS.length];
        var subYears = years * DASHA_YEARS[subLord] / 120;
        var subEnd = addYears(subCursor, subYears);
        antar.push({ lord: subLord, start: subCursor, end: subEnd, years: subYears });
        subCursor = subEnd;
      }
      periods.push({ lord: lord, start: start, end: end, years: years, antardasha: antar });
      cursor = end;
    }
    return {
      birthNakshatra: nak.name,
      birthNakshatraLord: nak.lord,
      balanceYears: balance,
      balanceText: yearsToText(balance),
      periods: periods
    };
  }

  function yearsToText(years) {
    var whole = Math.floor(years);
    var months = Math.floor((years - whole) * 12);
    var days = Math.round(((years - whole) * 12 - months) * 30.4375);
    if (days >= 30) { days -= 30; months += 1; }
    if (months >= 12) { months -= 12; whole += 1; }
    return whole + "y " + months + "m " + days + "d";
  }

  /** The maha/antar period running at `when`, with the ones around it. */
  function dashaAt(dasha, when) {
    var time = when.getTime();
    for (var i = 0; i < dasha.periods.length; i++) {
      var p = dasha.periods[i];
      if (time >= p.start.getTime() && time < p.end.getTime()) {
        var sub = null;
        for (var j = 0; j < p.antardasha.length; j++) {
          var a = p.antardasha[j];
          if (time >= a.start.getTime() && time < a.end.getTime()) { sub = a; break; }
        }
        return { index: i, maha: p, antar: sub };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- panchang -- */

  function panchang(date, lat, lon, offsetMinutes) {
    var sunLon = tropicalLongitude("Sun", date);
    var moonLon = tropicalLongitude("Moon", date);
    var diff = norm360(moonLon - sunLon);
    var tithiIndex = Math.floor(diff / 12);               /* 0-29 */
    var inPaksha = tithiIndex % 15;
    var tithiName = inPaksha === 14
      ? (tithiIndex < 15 ? "Purnima" : "Amavasya")
      : TITHI_NAMES[inPaksha];
    var yogaIndex = Math.floor(norm360(sunLon + moonLon) / NAK_ARC);
    var karanaIndex = Math.floor(diff / 6);               /* 0-59 */
    var karanaName;
    if (karanaIndex === 0) karanaName = "Kimstughna";
    else if (karanaIndex >= 57) karanaName = ["Shakuni", "Chatushpada", "Naga"][karanaIndex - 57];
    else karanaName = MOVABLE_KARANAS[(karanaIndex - 1) % 7];

    var events = sunEvents(date, lat, lon);
    /* the Vedic day runs from sunrise to sunrise, so a 3 a.m. birth still
       belongs to the weekday that began the previous morning */
    var varaDate = events.sunrise || date;
    var offset = typeof offsetMinutes === "number" ? offsetMinutes : 0;
    var weekday = WEEKDAYS[new Date(varaDate.getTime() + offset * 60000).getUTCDay()];

    return {
      tithi: { index: tithiIndex, number: inPaksha + 1, name: tithiName, paksha: tithiIndex < 15 ? "Shukla" : "Krishna", percent: (diff % 12) / 12 * 100 },
      nakshatra: nakshatraOf(norm360(moonLon - ayanamsa(date))),
      yoga: { index: yogaIndex, name: YOGA_NAMES[yogaIndex] },
      karana: { index: karanaIndex, name: karanaName },
      vara: weekday,
      sunrise: events.sunrise,
      sunset: events.sunset,
      nextSunrise: events.nextSunrise
    };
  }

  /* ---------------------------------------------------------------- chart -- */

  /**
   * Build a whole chart.
   *   date   "1990-08-15"     local birth date
   *   time   "14:30"          local 24-hour birth time
   *   zone   "Asia/Kolkata"   IANA name, or minutes ahead of UTC
   *   lat, lon                degrees, north and east positive
   */
  function computeChart(input) {
    if (!input || !input.date || !input.time) throw new Error("Enter a birth date and time.");
    var lat = Number(input.lat);
    var lon = Number(input.lon);
    if (!isFinite(lat) || lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90.");
    if (!isFinite(lon) || lon < -180 || lon > 180) throw new Error("Longitude must be between -180 and 180.");

    var when = toUTC(input.date, input.time, input.zone);
    var utc = when.date;
    if (isNaN(utc.getTime())) throw new Error("Enter a valid birth date and time.");
    var ayan = ayanamsa(utc);

    var positions = PLANETS.map(function (p) {
      var tropical;
      var speed;
      if (p.key === "Rahu") {
        tropical = meanNode(utc);
        speed = dailyMotion("Rahu", utc);
      } else if (p.key === "Ketu") {
        tropical = norm360(meanNode(utc) + 180);
        speed = dailyMotion("Rahu", utc);
      } else {
        tropical = tropicalLongitude(p.body, utc);
        speed = dailyMotion(p.body, utc);
      }
      var sidereal = norm360(tropical - ayan);
      return describe(sidereal, {
        key: p.key,
        name: p.name,
        sanskrit: p.sanskrit,
        symbol: p.symbol,
        retrograde: speed < 0,
        speed: speed,
        dignity: dignityOf(p.key, signIndex(sidereal), degInSign(sidereal))
      });
    });

    var ascTropical = tropicalAscendant(utc, lat, lon);
    var lagna = describe(norm360(ascTropical - ayan), { key: "Lagna", name: "Ascendant", sanskrit: "Lagna", symbol: "As" });

    /* Whole-sign houses: the lagna's sign is the 1st house, and each sign
       after it is the next house. */
    function houseOf(sign) { return ((sign - lagna.sign + 12) % 12) + 1; }
    positions.forEach(function (p) {
      p.house = houseOf(p.sign);
      p.navamsaHouse = ((p.navamsaSign - navamsaSign(lagna.longitude) + 12) % 12) + 1;
    });

    var houses = [];
    for (var h = 1; h <= 12; h++) {
      var sign = (lagna.sign + h - 1) % 12;
      houses.push({
        house: h,
        sign: sign,
        signName: SIGNS[sign].name,
        signEn: SIGNS[sign].en,
        lord: SIGNS[sign].lord,
        planets: positions.filter(function (p) { return p.house === h; })
      });
    }

    var navamsaLagnaSign = navamsaSign(lagna.longitude);
    var navamsaHouses = [];
    for (var n = 1; n <= 12; n++) {
      var nSign = (navamsaLagnaSign + n - 1) % 12;
      navamsaHouses.push({
        house: n,
        sign: nSign,
        signName: SIGNS[nSign].name,
        signEn: SIGNS[nSign].en,
        lord: SIGNS[nSign].lord,
        planets: positions.filter(function (p) { return p.navamsaSign === nSign; })
      });
    }

    var moon = positions[1];
    var sun = positions[0];
    var dasha = vimshottari(moon.longitude, utc, { cycles: input.dashaCycles || 2 });

    return {
      input: {
        name: input.name || "",
        date: input.date,
        time: input.time,
        zone: typeof input.zone === "number" ? formatOffset(input.zone) : input.zone,
        place: input.place || "",
        lat: lat,
        lon: lon
      },
      utc: utc,
      julianDay: julianDay(utc),
      offsetMinutes: when.offsetMinutes,
      offsetText: formatOffset(when.offsetMinutes),
      ayanamsa: ayan,
      ayanamsaText: formatDeg(ayan),
      lagna: lagna,
      planets: positions,
      houses: houses,
      navamsa: { lagnaSign: navamsaLagnaSign, houses: navamsaHouses },
      dasha: dasha,
      currentDasha: dashaAt(dasha, new Date()),
      birthDasha: dashaAt(dasha, utc),
      panchang: panchang(utc, lat, lon, when.offsetMinutes),
      summary: {
        moonSign: moon.signName,
        moonSignEn: moon.signEn,
        sunSign: sun.signName,
        sunSignEn: sun.signEn,
        lagnaSign: lagna.signName,
        lagnaSignEn: lagna.signEn,
        nakshatra: moon.nakshatra,
        nakshatraPada: moon.pada,
        nakshatraLord: moon.nakshatraLord
      }
    };
  }

  return {
    SIGNS: SIGNS,
    NAKSHATRAS: NAKSHATRAS,
    PLANETS: PLANETS,
    DASHA_LORDS: DASHA_LORDS,
    DASHA_YEARS: DASHA_YEARS,
    WEEKDAYS: WEEKDAYS,
    norm360: norm360,
    signIndex: signIndex,
    degInSign: degInSign,
    formatDeg: formatDeg,
    formatOffset: formatOffset,
    julianDay: julianDay,
    ayanamsa: ayanamsa,
    obliquity: obliquity,
    zoneOffsetMinutes: zoneOffsetMinutes,
    toUTC: toUTC,
    tropicalLongitude: tropicalLongitude,
    meanNode: meanNode,
    dailyMotion: dailyMotion,
    tropicalAscendant: tropicalAscendant,
    sunEvents: sunEvents,
    nakshatraOf: nakshatraOf,
    navamsaSign: navamsaSign,
    vimshottari: vimshottari,
    dashaAt: dashaAt,
    yearsToText: yearsToText,
    panchang: panchang,
    computeChart: computeChart
  };
}));
