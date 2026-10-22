/* ToolAdda - Cron Expression Generator
 * 100% client-side cron builder, parser, humaniser and next-run scheduler.
 */
(function () {
  'use strict';

  const hasDom = typeof document !== 'undefined';
  const root = hasDom ? document.querySelector('[data-cron]') : null;

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const FLAVORS = {
    unix: {
      key: 'unix',
      label: 'Unix / crontab',
      hint: '5 fields — the classic crontab format used by Linux, GitHub Actions and Kubernetes.',
      fields: ['minute', 'hour', 'dom', 'month', 'dow'],
      quartz: false,
    },
    seconds: {
      key: 'seconds',
      label: '6-field (seconds)',
      hint: '6 fields — adds a leading seconds column, used by node-cron, Spring and cronR.',
      fields: ['second', 'minute', 'hour', 'dom', 'month', 'dow'],
      quartz: false,
    },
    quartz: {
      key: 'quartz',
      label: 'Quartz / Java',
      hint: '7 fields — Quartz scheduler syntax with seconds, an optional year and L / W / # modifiers.',
      fields: ['second', 'minute', 'hour', 'dom', 'month', 'dow', 'year'],
      quartz: true,
    },
  };

  // Internal value space is always normalised: dow 0-6 (0 = Sunday), month 1-12.
  const FIELD_DEFS = {
    second: { key: 'second', label: 'Seconds', unit: 'second', plural: 'seconds', min: 0, max: 59, cols: 10, pad: 2 },
    minute: { key: 'minute', label: 'Minutes', unit: 'minute', plural: 'minutes', min: 0, max: 59, cols: 10, pad: 2 },
    hour: { key: 'hour', label: 'Hours', unit: 'hour', plural: 'hours', min: 0, max: 23, cols: 8, pad: 2 },
    dom: { key: 'dom', label: 'Day of Month', unit: 'day', plural: 'days', min: 1, max: 31, cols: 8, pad: 0 },
    month: { key: 'month', label: 'Month', unit: 'month', plural: 'months', min: 1, max: 12, cols: 4, pad: 0, names: MONTH_ABBR, longNames: MONTH_NAMES, nameBase: 1 },
    dow: { key: 'dow', label: 'Day of Week', unit: 'weekday', plural: 'weekdays', min: 0, max: 6, cols: 7, pad: 0, names: DOW_ABBR, longNames: DOW_NAMES, nameBase: 0 },
    year: { key: 'year', label: 'Year', unit: 'year', plural: 'years', min: 1970, max: 2099, cols: 6, pad: 0, noGrid: true },
  };

  const SPECIALS = {
    '@YEARLY': '0 0 1 1 *',
    '@ANNUALLY': '0 0 1 1 *',
    '@MONTHLY': '0 0 1 * *',
    '@WEEKLY': '0 0 * * 0',
    '@DAILY': '0 0 * * *',
    '@MIDNIGHT': '0 0 * * *',
    '@HOURLY': '0 * * * *',
  };

  const FALLBACK_ZONES = [
    'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
    'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
    'Africa/Lagos', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
    'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo',
    'Asia/Seoul', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
  ];

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.prototype.slice.call(root.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sortedOf = (set) => Array.from(set).sort((a, b) => a - b);

  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const joinList = (items, max) => {
    const cap = max || 8;
    const list = items.slice(0, cap).map(String);
    const rest = items.length - list.length;
    let text;
    if (list.length === 1) {
      text = list[0];
    } else {
      text = list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    }
    return rest > 0 ? text + ' (+' + rest + ' more)' : text;
  };

  function rawRange(key, flavor) {
    if (key === 'dow') {
      return flavor.quartz ? { min: 1, max: 7 } : { min: 0, max: 7 };
    }
    const def = FIELD_DEFS[key];
    return { min: def.min, max: def.max };
  }

  function normaliseValue(value, key, flavor) {
    if (key === 'dow') {
      return flavor.quartz ? value - 1 : value % 7;
    }
    return value;
  }

  function denormaliseValue(value, key, flavor) {
    if (key === 'dow') {
      return flavor.quartz ? value + 1 : value;
    }
    return value;
  }

  function tokenToNumber(token, key, flavor) {
    const t = String(token).trim().toUpperCase();
    if (/^\d+$/.test(t)) {
      return parseInt(t, 10);
    }
    if (key === 'month') {
      const i = MONTH_ABBR.indexOf(t.slice(0, 3));
      return i >= 0 ? i + 1 : null;
    }
    if (key === 'dow') {
      const i = DOW_ABBR.indexOf(t.slice(0, 3));
      if (i < 0) return null;
      return flavor.quartz ? i + 1 : i;
    }
    return null;
  }

  function valueLabel(value, key) {
    const def = FIELD_DEFS[key];
    if (def.longNames) {
      return def.longNames[value - def.nameBase];
    }
    if (def.pad === 2) return pad2(value);
    return String(value);
  }

  function shortLabel(value, key) {
    const def = FIELD_DEFS[key];
    if (def.names) {
      return def.names[value - def.nameBase].charAt(0) + def.names[value - def.nameBase].slice(1).toLowerCase();
    }
    return def.pad === 2 ? pad2(value) : String(value);
  }

  /* ------------------------------------------------------------------ *
   * Parser
   * ------------------------------------------------------------------ */

  function CronError(message) {
    const e = new Error(message);
    e.cronError = true;
    return e;
  }

  function parseField(rawText, key, flavor) {
    const def = FIELD_DEFS[key];
    const range = rawRange(key, flavor);
    const out = {
      values: new Set(),
      restricted: true,
      last: false,
      lastOffset: 0,
      lastWeekday: false,
      nearest: [],
      lastDow: [],
      nth: [],
    };

    const text = String(rawText == null ? '' : rawText).trim();
    if (!text) {
      throw CronError(def.label + ' field is empty.');
    }

    if (text === '?') {
      if (key !== 'dom' && key !== 'dow') {
        throw CronError('"?" is only allowed in the Day of Month or Day of Week field.');
      }
      out.restricted = false;
      for (let v = def.min; v <= def.max; v += 1) out.values.add(v);
      return out;
    }

    if (text === '*') {
      out.restricted = false;
      for (let v = def.min; v <= def.max; v += 1) out.values.add(v);
      return out;
    }

    text.split(',').forEach((segment) => {
      parseSegment(segment, out, key, flavor, range);
    });

    if (!out.values.size && !out.last && !out.nearest.length && !out.lastDow.length && !out.nth.length) {
      throw CronError(def.label + ': "' + text + '" does not match any value.');
    }
    return out;
  }

  function parseSegment(segmentRaw, out, key, flavor, range) {
    const def = FIELD_DEFS[key];
    let seg = String(segmentRaw).trim().toUpperCase();
    if (!seg) {
      throw CronError(def.label + ': empty value in the list.');
    }

    if (key === 'dom') {
      if (seg === 'L') { out.last = true; return; }
      if (seg === 'LW') { out.last = true; out.lastWeekday = true; return; }
      let m = seg.match(/^L-(\d+)$/);
      if (m) {
        out.last = true;
        out.lastOffset = parseInt(m[1], 10);
        return;
      }
      m = seg.match(/^(\d+)W$/);
      if (m) {
        const day = parseInt(m[1], 10);
        if (day < 1 || day > 31) throw CronError('Day of Month: "' + seg + '" is out of the 1-31 range.');
        out.nearest.push(day);
        return;
      }
    }

    if (key === 'dow') {
      if (seg === 'L') { out.lastDow.push(6); return; }
      let m = seg.match(/^([A-Z0-9]+)L$/);
      if (m) {
        const n = tokenToNumber(m[1], key, flavor);
        if (n === null) throw CronError('Day of Week: "' + seg + '" is not a valid weekday.');
        out.lastDow.push(normaliseValue(n, key, flavor));
        return;
      }
      m = seg.match(/^([A-Z0-9]+)#(\d+)$/);
      if (m) {
        const n = tokenToNumber(m[1], key, flavor);
        const nth = parseInt(m[2], 10);
        if (n === null) throw CronError('Day of Week: "' + seg + '" is not a valid weekday.');
        if (nth < 1 || nth > 5) throw CronError('Day of Week: "#' + nth + '" must be between 1 and 5.');
        out.nth.push({ dow: normaliseValue(n, key, flavor), n: nth });
        return;
      }
    }

    let step = 1;
    const slashParts = seg.split('/');
    if (slashParts.length > 2) {
      throw CronError(def.label + ': "' + segmentRaw + '" has more than one "/".');
    }
    if (slashParts.length === 2) {
      if (!/^\d+$/.test(slashParts[1])) {
        throw CronError(def.label + ': step value in "' + segmentRaw + '" must be a whole number.');
      }
      step = parseInt(slashParts[1], 10);
      if (step < 1) {
        throw CronError(def.label + ': step value must be 1 or greater.');
      }
      seg = slashParts[0];
    }

    let lo;
    let hi;
    if (seg === '*' || seg === '?') {
      lo = range.min;
      hi = range.max;
    } else {
      const dashParts = seg.split('-');
      if (dashParts.length > 2) {
        throw CronError(def.label + ': "' + segmentRaw + '" has more than one "-".');
      }
      lo = tokenToNumber(dashParts[0], key, flavor);
      if (lo === null) throw CronError(def.label + ': "' + dashParts[0] + '" is not a valid value.');
      if (dashParts.length === 2) {
        hi = tokenToNumber(dashParts[1], key, flavor);
        if (hi === null) throw CronError(def.label + ': "' + dashParts[1] + '" is not a valid value.');
      } else {
        hi = slashParts.length === 2 ? range.max : lo;
      }
    }

    [lo, hi].forEach((v) => {
      if (v < range.min || v > range.max) {
        throw CronError(def.label + ': ' + v + ' is outside the allowed range ' + range.min + '-' + range.max + '.');
      }
    });

    const span = [];
    if (lo <= hi) {
      for (let v = lo; v <= hi; v += 1) span.push(v);
    } else {
      for (let v = lo; v <= range.max; v += 1) span.push(v);
      for (let v = range.min; v <= hi; v += 1) span.push(v);
    }
    for (let i = 0; i < span.length; i += step) {
      out.values.add(normaliseValue(span[i], key, flavor));
    }
  }

  function expandSpecial(text, flavorKey) {
    const key = text.trim().toUpperCase();
    if (key === '@REBOOT') {
      throw CronError('"@reboot" runs once at start-up and has no recurring schedule to preview.');
    }
    const base = SPECIALS[key];
    if (!base) {
      throw CronError('"' + text.trim() + '" is not a recognised shortcut. Try @hourly, @daily, @weekly, @monthly or @yearly.');
    }
    if (flavorKey === 'unix') return base;
    if (flavorKey === 'seconds') return '0 ' + base;
    // Quartz: seconds + '?' for the unused day field
    const parts = base.split(' ');
    const dom = parts[2];
    const dow = parts[4];
    return ['0', parts[0], parts[1], dom, parts[3], dom === '*' ? '?' : (dow === '*' ? '?' : dow), '*'].join(' ');
  }

  function parseExpression(text, flavorKey) {
    const flavor = FLAVORS[flavorKey];
    let expr = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
    if (!expr) {
      throw CronError('Enter a cron expression to get started.');
    }
    if (expr.charAt(0) === '@') {
      expr = expandSpecial(expr, flavorKey);
    }

    const parts = expr.split(' ');
    const keys = flavor.fields.slice();

    if (flavor.quartz) {
      if (parts.length === 6) {
        keys.pop();
      } else if (parts.length !== 7) {
        throw CronError('Quartz expressions need 6 or 7 fields — this one has ' + parts.length + '.');
      }
    } else if (parts.length !== keys.length) {
      throw CronError('The ' + flavor.label + ' format needs ' + keys.length + ' fields — this one has ' + parts.length + '.');
    }

    const fields = {};
    const raws = {};
    keys.forEach((key, index) => {
      raws[key] = parts[index];
      fields[key] = parseField(parts[index], key, flavor);
    });

    if (!fields.second) {
      const secOnlyZero = { values: new Set([0]), restricted: true, last: false, lastOffset: 0, lastWeekday: false, nearest: [], lastDow: [], nth: [] };
      fields.second = secOnlyZero;
      raws.second = '0';
    }

    const warnings = [];
    if (flavor.quartz) {
      const questionCount = [raws.dom, raws.dow].filter((v) => v === '?').length;
      if (questionCount === 0) {
        warnings.push('Quartz expects "?" in either Day of Month or Day of Week. Most Quartz runtimes reject an expression that sets both.');
      }
    }
    if (fields.dom.restricted && fields.dow.restricted && !flavor.quartz) {
      warnings.push('Both Day of Month and Day of Week are restricted, so the job runs when either one matches (standard cron OR behaviour).');
    }

    return {
      expression: parts.join(' '),
      flavorKey: flavorKey,
      flavor: flavor,
      keys: keys,
      fields: fields,
      raws: raws,
      warnings: warnings,
      hasSeconds: flavor.fields.indexOf('second') >= 0,
      hasYear: keys.indexOf('year') >= 0,
    };
  }

  /* ------------------------------------------------------------------ *
   * Time zone helpers (wall-clock maths, DST safe)
   * ------------------------------------------------------------------ */

  function zoneOffset(instant, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const map = {};
    dtf.formatToParts(instant).forEach((part) => {
      if (part.type !== 'literal') map[part.type] = part.value;
    });
    const asUTC = Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      parseInt(map.hour, 10) % 24,
      parseInt(map.minute, 10),
      parseInt(map.second, 10)
    );
    return asUTC - (instant.getTime() - instant.getMilliseconds());
  }

  // Instant -> pseudo-UTC Date carrying the wall-clock fields of `timeZone`.
  function wallFromInstant(instant, timeZone) {
    return new Date(instant.getTime() - instant.getMilliseconds() + zoneOffset(instant, timeZone));
  }

  // Pseudo-UTC wall-clock Date -> the real instant it represents in `timeZone`.
  function instantFromWall(wall, timeZone) {
    const wallMs = wall.getTime();
    let guess = new Date(wallMs - zoneOffset(new Date(wallMs), timeZone));
    let offset = zoneOffset(guess, timeZone);
    let result = new Date(wallMs - offset);
    if (zoneOffset(result, timeZone) !== offset) {
      result = new Date(wallMs - zoneOffset(result, timeZone));
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Next-run calculation
   * ------------------------------------------------------------------ */

  function lastDayOfMonth(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  function nearestWeekdayFor(year, monthIndex, targetDay) {
    const maxDay = lastDayOfMonth(year, monthIndex);
    const day = Math.min(targetDay, maxDay);
    const dow = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
    if (dow >= 1 && dow <= 5) return day;
    if (dow === 6) return day - 1 >= 1 ? day - 1 : day + 2;
    return day + 1 <= maxDay ? day + 1 : day - 2;
  }

  function domMatches(wall, parsed) {
    const field = parsed.fields.dom;
    const y = wall.getUTCFullYear();
    const mi = wall.getUTCMonth();
    const d = wall.getUTCDate();

    if (field.values.has(d)) return true;
    if (field.last) {
      const maxDay = lastDayOfMonth(y, mi);
      const target = maxDay - field.lastOffset;
      if (field.lastWeekday) {
        return d === nearestWeekdayFor(y, mi, target);
      }
      if (d === target) return true;
    }
    for (let i = 0; i < field.nearest.length; i += 1) {
      if (d === nearestWeekdayFor(y, mi, field.nearest[i])) return true;
    }
    return false;
  }

  function dowMatches(wall, parsed) {
    const field = parsed.fields.dow;
    const dow = wall.getUTCDay();
    const y = wall.getUTCFullYear();
    const mi = wall.getUTCMonth();
    const d = wall.getUTCDate();

    if (field.values.has(dow)) return true;
    for (let i = 0; i < field.lastDow.length; i += 1) {
      if (field.lastDow[i] === dow && d + 7 > lastDayOfMonth(y, mi)) return true;
    }
    for (let i = 0; i < field.nth.length; i += 1) {
      const rule = field.nth[i];
      if (rule.dow === dow && Math.ceil(d / 7) === rule.n) return true;
    }
    return false;
  }

  function dayMatches(wall, parsed) {
    const domRestricted = parsed.fields.dom.restricted;
    const dowRestricted = parsed.fields.dow.restricted;
    if (!domRestricted && !dowRestricted) return true;
    if (domRestricted && dowRestricted) return domMatches(wall, parsed) || dowMatches(wall, parsed);
    if (domRestricted) return domMatches(wall, parsed);
    return dowMatches(wall, parsed);
  }

  function nextRuns(parsed, count, timeZone, fromInstant) {
    const results = [];
    const base = fromInstant || new Date();
    let cursor = wallFromInstant(base, timeZone);
    cursor = new Date(cursor.getTime() + 1000);
    cursor.setUTCMilliseconds(0);

    const yearField = parsed.hasYear ? parsed.fields.year : null;
    const stopYear = cursor.getUTCFullYear() + 80;
    let guard = 0;

    while (results.length < count && guard < 400000) {
      guard += 1;
      const y = cursor.getUTCFullYear();
      if (y > stopYear) break;

      if (yearField && !yearField.values.has(y)) {
        cursor = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
        continue;
      }
      if (!parsed.fields.month.values.has(cursor.getUTCMonth() + 1)) {
        cursor = new Date(Date.UTC(y, cursor.getUTCMonth() + 1, 1, 0, 0, 0));
        continue;
      }
      if (!dayMatches(cursor, parsed)) {
        cursor = new Date(Date.UTC(y, cursor.getUTCMonth(), cursor.getUTCDate() + 1, 0, 0, 0));
        continue;
      }
      if (!parsed.fields.hour.values.has(cursor.getUTCHours())) {
        cursor = new Date(Date.UTC(y, cursor.getUTCMonth(), cursor.getUTCDate(), cursor.getUTCHours() + 1, 0, 0));
        continue;
      }
      if (!parsed.fields.minute.values.has(cursor.getUTCMinutes())) {
        cursor = new Date(Date.UTC(y, cursor.getUTCMonth(), cursor.getUTCDate(), cursor.getUTCHours(), cursor.getUTCMinutes() + 1, 0));
        continue;
      }
      if (!parsed.fields.second.values.has(cursor.getUTCSeconds())) {
        cursor = new Date(cursor.getTime() + 1000);
        continue;
      }

      results.push(instantFromWall(cursor, timeZone));
      cursor = new Date(cursor.getTime() + 1000);
    }
    return results;
  }

  /* ------------------------------------------------------------------ *
   * Human-readable description
   * ------------------------------------------------------------------ */

  function wholeStep(raw, min, max) {
    const t = String(raw || '').trim().toUpperCase();
    let m = t.match(/^\*\/(\d+)$/);
    if (m) return parseInt(m[1], 10);
    m = t.match(/^(\d+)\/(\d+)$/);
    if (m && parseInt(m[1], 10) === min) return parseInt(m[2], 10);
    return null;
  }

  function stepInRange(raw, key, flavor) {
    const m = String(raw || '').trim().toUpperCase().match(/^([A-Z0-9]+)-([A-Z0-9]+)\/(\d+)$/);
    if (!m) return null;
    const from = tokenToNumber(m[1], key, flavor);
    const to = tokenToNumber(m[2], key, flavor);
    if (from === null || to === null) return null;
    return { from: normaliseValue(from, key, flavor), to: normaliseValue(to, key, flavor), step: parseInt(m[3], 10) };
  }

  function plainRange(raw, key, flavor) {
    const m = String(raw || '').trim().toUpperCase().match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
    if (!m) return null;
    const from = tokenToNumber(m[1], key, flavor);
    const to = tokenToNumber(m[2], key, flavor);
    if (from === null || to === null) return null;
    return { from: normaliseValue(from, key, flavor), to: normaliseValue(to, key, flavor) };
  }

  function describeTime(parsed) {
    const flavor = parsed.flavor;
    const S = sortedOf(parsed.fields.second.values);
    const M = sortedOf(parsed.fields.minute.values);
    const H = sortedOf(parsed.fields.hour.values);

    const sAll = S.length === 60;
    const mAll = M.length === 60;
    const hAll = H.length === 24;
    const sIsZero = S.length === 1 && S[0] === 0;

    const sStep = wholeStep(parsed.raws.second, 0, 59);
    const mStep = wholeStep(parsed.raws.minute, 0, 59);
    const hStep = wholeStep(parsed.raws.hour, 0, 23);
    const mStepRange = stepInRange(parsed.raws.minute, 'minute', flavor);
    const hStepRange = stepInRange(parsed.raws.hour, 'hour', flavor);
    const hRange = plainRange(parsed.raws.hour, 'hour', flavor);

    // Nicest case: a small set of exact clock times.
    if (!hAll && !mAll && !mStep && !hStep && !mStepRange && !hStepRange && (!parsed.hasSeconds || sIsZero)
      && H.length * M.length <= 12) {
      const times = [];
      H.forEach((h) => { M.forEach((m) => { times.push(pad2(h) + ':' + pad2(m)); }); });
      times.sort();
      return 'at ' + joinList(times, 12);
    }

    const bits = [];
    let secondsIsFrequency = false;

    if (parsed.hasSeconds) {
      if (sAll) {
        bits.push('every second');
        secondsIsFrequency = true;
      } else if (sStep) {
        bits.push('every ' + sStep + ' seconds');
        secondsIsFrequency = true;
      } else if (!sIsZero) {
        bits.push('at second ' + joinList(S));
      }
    }

    if (!(secondsIsFrequency && mAll)) {
      if (mAll) {
        bits.push('every minute');
      } else if (mStep) {
        bits.push('every ' + mStep + ' minutes');
      } else if (mStepRange) {
        bits.push('every ' + mStepRange.step + ' minutes from minute ' + mStepRange.from + ' through ' + mStepRange.to);
      } else {
        bits.push('at minute ' + joinList(M));
      }
    }

    if (!hAll) {
      if (hStep) {
        bits.push('every ' + hStep + ' hours');
      } else if (hStepRange) {
        bits.push('every ' + hStepRange.step + ' hours between ' + pad2(hStepRange.from) + ':00 and ' + pad2(hStepRange.to) + ':59');
      } else if (hRange) {
        bits.push('between ' + pad2(hRange.from) + ':00 and ' + pad2(hRange.to) + ':59');
      } else if (H.length === 1) {
        bits.push('past hour ' + H[0]);
      } else {
        bits.push('past hours ' + joinList(H));
      }
    }

    return bits.join(', ');
  }

  function describeDom(parsed) {
    const field = parsed.fields.dom;
    const raw = parsed.raws.dom;
    const bits = [];

    if (field.last) {
      if (field.lastWeekday) {
        bits.push('on the last weekday of the month');
      } else if (field.lastOffset > 0) {
        bits.push('on the day ' + field.lastOffset + ' day(s) before the end of the month');
      } else {
        bits.push('on the last day of the month');
      }
    }
    field.nearest.forEach((day) => {
      bits.push('on the weekday nearest day ' + day + ' of the month');
    });

    if (field.values.size) {
      const step = wholeStep(raw, 1, 31);
      const stepRange = stepInRange(raw, 'dom', parsed.flavor);
      const range = plainRange(raw, 'dom', parsed.flavor);
      if (step) {
        bits.push('every ' + step + ' days of the month');
      } else if (stepRange) {
        bits.push('every ' + stepRange.step + ' days from day ' + stepRange.from + ' through ' + stepRange.to + ' of the month');
      } else if (range) {
        bits.push('on days ' + range.from + ' through ' + range.to + ' of the month');
      } else {
        const list = sortedOf(field.values);
        bits.push('on day ' + joinList(list) + ' of the month');
      }
    }
    return bits.join(' and ');
  }

  function describeDow(parsed) {
    const field = parsed.fields.dow;
    const raw = parsed.raws.dow;
    const bits = [];

    field.nth.forEach((rule) => {
      bits.push('on the ' + ordinal(rule.n) + ' ' + DOW_NAMES[rule.dow] + ' of the month');
    });
    field.lastDow.forEach((dow) => {
      bits.push('on the last ' + DOW_NAMES[dow] + ' of the month');
    });

    if (field.values.size) {
      const range = plainRange(raw, 'dow', parsed.flavor);
      const stepRange = stepInRange(raw, 'dow', parsed.flavor);
      if (stepRange) {
        bits.push('every ' + stepRange.step + ' days of the week from ' + DOW_NAMES[stepRange.from] + ' through ' + DOW_NAMES[stepRange.to]);
      } else if (range && range.from <= range.to) {
        bits.push('only on ' + DOW_NAMES[range.from] + ' through ' + DOW_NAMES[range.to]);
      } else {
        const names = sortedOf(field.values).map((v) => DOW_NAMES[v]);
        bits.push('only on ' + joinList(names, 7));
      }
    }
    return bits.join(' and ');
  }

  function describeDay(parsed) {
    const domRestricted = parsed.fields.dom.restricted;
    const dowRestricted = parsed.fields.dow.restricted;
    if (!domRestricted && !dowRestricted) return null;

    const bits = [];
    if (domRestricted) bits.push(describeDom(parsed));
    if (dowRestricted) bits.push(describeDow(parsed));
    let text = bits.filter(Boolean).join(', and also ');
    if (domRestricted && dowRestricted) {
      text += ' (whichever comes first)';
    }
    return text;
  }

  function describeMonth(parsed) {
    const field = parsed.fields.month;
    if (!field.restricted) return null;
    const raw = parsed.raws.month;
    const step = wholeStep(raw, 1, 12);
    const stepRange = stepInRange(raw, 'month', parsed.flavor);
    const range = plainRange(raw, 'month', parsed.flavor);
    if (step) return 'every ' + step + ' months';
    if (stepRange) return 'every ' + stepRange.step + ' months from ' + MONTH_NAMES[stepRange.from - 1] + ' through ' + MONTH_NAMES[stepRange.to - 1];
    if (range && range.from <= range.to) return 'from ' + MONTH_NAMES[range.from - 1] + ' through ' + MONTH_NAMES[range.to - 1];
    const names = sortedOf(field.values).map((v) => MONTH_NAMES[v - 1]);
    return 'in ' + joinList(names, 12);
  }

  function describeYear(parsed) {
    if (!parsed.hasYear) return null;
    const field = parsed.fields.year;
    if (!field.restricted) return null;
    const raw = parsed.raws.year;
    const step = wholeStep(raw, 1970, 2099);
    const range = plainRange(raw, 'year', parsed.flavor);
    if (step) return 'every ' + step + ' years';
    if (range && range.from <= range.to) return 'from ' + range.from + ' through ' + range.to;
    return 'in ' + joinList(sortedOf(field.values), 10);
  }

  function describe(parsed) {
    const pieces = [describeTime(parsed), describeDay(parsed), describeMonth(parsed), describeYear(parsed)]
      .filter(Boolean);
    let text = pieces.join(', ');
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return text + '.';
  }

  /* ------------------------------------------------------------------ *
   * Mode detection (expression -> builder)
   * ------------------------------------------------------------------ */

  function detectMode(raw, key, flavor) {
    const def = FIELD_DEFS[key];
    const range = rawRange(key, flavor);
    const t = String(raw || '').trim().toUpperCase();

    if (t === '*' || t === '?') return { mode: 'every' };

    if (key === 'dom') {
      if (t === 'L') return { mode: 'lastday' };
      const w = t.match(/^(\d+)W$/);
      if (w) return { mode: 'nearest', day: parseInt(w[1], 10) };
    }
    if (key === 'dow') {
      const nth = t.match(/^([A-Z0-9]+)#(\d+)$/);
      if (nth) {
        const n = tokenToNumber(nth[1], key, flavor);
        if (n !== null) return { mode: 'nth', dow: normaliseValue(n, key, flavor), n: parseInt(nth[2], 10) };
      }
      const lastDow = t.match(/^([A-Z0-9]+)L$/);
      if (lastDow) {
        const n = tokenToNumber(lastDow[1], key, flavor);
        if (n !== null) return { mode: 'lastdow', dow: normaliseValue(n, key, flavor) };
      }
    }

    let m = t.match(/^\*\/(\d+)$/);
    if (m) return { mode: 'step', step: parseInt(m[1], 10), start: def.min };
    m = t.match(/^([A-Z0-9]+)\/(\d+)$/);
    if (m) {
      const start = tokenToNumber(m[1], key, flavor);
      if (start !== null && start >= range.min && start <= range.max) {
        return { mode: 'step', step: parseInt(m[2], 10), start: normaliseValue(start, key, flavor) };
      }
    }
    m = t.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
    if (m) {
      const from = tokenToNumber(m[1], key, flavor);
      const to = tokenToNumber(m[2], key, flavor);
      if (from !== null && to !== null && from >= range.min && to <= range.max) {
        return { mode: 'range', from: normaliseValue(from, key, flavor), to: normaliseValue(to, key, flavor) };
      }
    }
    if (/^[A-Z0-9]+(,[A-Z0-9]+)*$/.test(t)) {
      const values = [];
      let ok = true;
      t.split(',').forEach((token) => {
        const n = tokenToNumber(token, key, flavor);
        if (n === null || n < range.min || n > range.max) ok = false;
        else values.push(normaliseValue(n, key, flavor));
      });
      if (ok && values.length) {
        return { mode: 'specific', values: values.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b) };
      }
    }
    return { mode: 'custom', text: String(raw).trim() };
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  const localZone = (function () {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }());

  const state = {
    flavorKey: 'unix',
    fields: { second: '0', minute: '*', hour: '*', dom: '*', month: '*', dow: '*', year: '*' },
    modes: {},
    activeTab: 'minute',
    timeZone: localZone,
    runCount: 10,
    snippet: 'crontab',
  };

  /* ------------------------------------------------------------------ *
   * Expression assembly
   * ------------------------------------------------------------------ */

  function fieldTextFromMode(key, mode) {
    const def = FIELD_DEFS[key];
    const flavor = FLAVORS[state.flavorKey];
    const out = (v) => String(denormaliseValue(v, key, flavor));

    switch (mode.mode) {
      case 'every':
        return '*';
      case 'step':
        return (mode.start === def.min ? '*' : out(mode.start)) + '/' + mode.step;
      case 'range':
        return out(mode.from) + '-' + out(mode.to);
      case 'specific':
        return mode.values.length ? mode.values.slice().sort((a, b) => a - b).map(out).join(',') : '*';
      case 'lastday':
        return 'L';
      case 'nearest':
        return mode.day + 'W';
      case 'nth':
        return out(mode.dow) + '#' + mode.n;
      case 'lastdow':
        return out(mode.dow) + 'L';
      case 'custom':
        return mode.text && mode.text.trim() ? mode.text.trim() : '*';
      default:
        return '*';
    }
  }

  function buildExpression() {
    const flavor = FLAVORS[state.flavorKey];
    const parts = flavor.fields.map((key) => state.fields[key]);

    if (flavor.quartz) {
      const domIndex = flavor.fields.indexOf('dom');
      const dowIndex = flavor.fields.indexOf('dow');
      if (parts[dowIndex] === '*') {
        parts[dowIndex] = '?';
      } else if (parts[domIndex] === '*') {
        parts[domIndex] = '?';
      }
    }
    return parts.join(' ');
  }

  function syncFieldsFromExpression(expr, flavorKey) {
    const flavor = FLAVORS[flavorKey];
    let text = String(expr).trim().replace(/\s+/g, ' ');
    if (text.charAt(0) === '@') {
      text = expandSpecial(text, flavorKey);
    }
    const parts = text.split(' ');
    const keys = flavor.fields.slice();
    if (flavor.quartz && parts.length === 6) keys.pop();

    keys.forEach((key, i) => {
      state.fields[key] = parts[i];
      state.modes[key] = detectMode(parts[i], key, flavor);
    });
    if (flavor.quartz && parts.length === 6) {
      state.fields.year = '*';
      state.modes.year = { mode: 'every' };
    }
    if (flavor.fields.indexOf('second') < 0) {
      state.fields.second = '0';
    }
  }

  function resetModesFromFields() {
    const flavor = FLAVORS[state.flavorKey];
    flavor.fields.forEach((key) => {
      state.modes[key] = detectMode(state.fields[key], key, flavor);
    });
  }

  /* ------------------------------------------------------------------ *
   * Rendering — expression bar
   * ------------------------------------------------------------------ */

  // Expose the pure engine for unit testing outside the browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseExpression, describe, nextRuns, detectMode, toUnixFive };
  }

  if (!root) {
    return;
  }

  const exprInput = $('[data-expr-input]');
  const chipsWrap = $('[data-expr-chips]');
  const statusBox = $('[data-status]');
  const warnBox = $('[data-warnings]');
  const descBox = $('[data-description]');
  const nextList = $('[data-next-list]');
  const nextMeta = $('[data-next-meta]');
  const tabsWrap = $('[data-tabs]');
  const builderWrap = $('[data-builder]');
  const flavorWrap = $('[data-flavor]');
  const tzSelect = $('[data-tz]');
  const countSelect = $('[data-count]');
  const snippetTabs = $('[data-snippet-tabs]');
  const snippetCode = $('[data-snippet-code]');
  const snippetNote = $('[data-snippet-note]');

  function renderChips(parsed, expr) {
    const flavor = FLAVORS[state.flavorKey];
    const parts = expr.split(' ');
    const keys = flavor.fields.slice();
    if (flavor.quartz && parts.length === 6) keys.pop();

    chipsWrap.innerHTML = parts.map((part, i) => {
      const key = keys[i] || 'extra';
      const def = FIELD_DEFS[key];
      return '<button class="cron-chip" type="button" data-chip="' + esc(key) + '" '
        + 'aria-label="Edit ' + esc(def ? def.label : key) + '">'
        + '<span class="cron-chip-value">' + esc(part) + '</span>'
        + '<span class="cron-chip-label">' + esc(def ? def.label : '') + '</span>'
        + '</button>';
    }).join('');

    chipsWrap.querySelectorAll('[data-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-chip');
        if (FIELD_DEFS[key]) {
          state.activeTab = key;
          renderTabs();
          renderBuilder();
          const panel = $('[data-builder]');
          if (panel && panel.scrollIntoView) {
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
    });
  }

  function formatInstant(date, timeZone) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone,
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(date);
  }

  function relativeFrom(date, base) {
    const diff = date.getTime() - base.getTime();
    const abs = Math.abs(diff);
    const units = [
      ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
      ['hour', 3600000], ['minute', 60000], ['second', 1000],
    ];
    for (let i = 0; i < units.length; i += 1) {
      const name = units[i][0];
      const ms = units[i][1];
      if (abs >= ms || name === 'second') {
        const n = Math.max(1, Math.round(abs / ms));
        return 'in ' + n + ' ' + name + (n !== 1 ? 's' : '');
      }
    }
    return 'now';
  }

  function renderSchedule(parsed) {
    const now = new Date();
    let runs = [];
    try {
      runs = nextRuns(parsed, state.runCount, state.timeZone, now);
    } catch (e) {
      runs = [];
    }

    if (!runs.length) {
      nextList.innerHTML = '<li class="cron-run cron-run-empty">No upcoming run found in the next 80 years. Check the day, month and year fields — the combination may never match (for example 30 February).</li>';
      nextMeta.textContent = '';
      return;
    }

    nextList.innerHTML = runs.map((date, i) => (
      '<li class="cron-run">'
      + '<span class="cron-run-index">' + (i + 1) + '</span>'
      + '<span class="cron-run-date">' + esc(formatInstant(date, state.timeZone)) + '</span>'
      + '<span class="cron-run-rel">' + esc(relativeFrom(date, now)) + '</span>'
      + '</li>'
    )).join('');

    const gaps = [];
    for (let i = 1; i < runs.length; i += 1) {
      gaps.push(runs[i].getTime() - runs[i - 1].getTime());
    }
    if (gaps.length) {
      const same = gaps.every((g) => g === gaps[0]);
      nextMeta.textContent = same
        ? 'Runs every ' + humanDuration(gaps[0]) + ' in ' + state.timeZone + '.'
        : 'Interval varies between runs in ' + state.timeZone + '.';
    } else {
      nextMeta.textContent = 'Times shown in ' + state.timeZone + '.';
    }
  }

  function humanDuration(ms) {
    const units = [['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]];
    for (let i = 0; i < units.length; i += 1) {
      if (ms >= units[i][1] && ms % units[i][1] === 0) {
        const n = ms / units[i][1];
        return n + ' ' + units[i][0] + (n !== 1 ? 's' : '');
      }
    }
    return Math.round(ms / 1000) + ' seconds';
  }

  /* ------------------------------------------------------------------ *
   * Rendering — snippets
   * ------------------------------------------------------------------ */

  function toUnixFive(expr, flavorKey) {
    const flavor = FLAVORS[flavorKey];
    const parts = expr.trim().split(/\s+/);
    const keys = flavor.fields.slice();
    if (flavor.quartz && parts.length === 6) keys.pop();

    const map = {};
    keys.forEach((k, i) => { map[k] = parts[i]; });

    let dow = map.dow || '*';
    if (dow === '?') dow = '*';
    if (flavor.quartz) {
      // Quartz 1-7 (1 = Sun) -> Unix 0-6 (0 = Sun). The index after "#" is an
      // occurrence counter, not a weekday, so it must be left alone.
      dow = dow.split(',').map((part) => {
        const hash = part.indexOf('#');
        const head = hash >= 0 ? part.slice(0, hash) : part;
        const tail = hash >= 0 ? part.slice(hash) : '';
        return head.replace(/\d+/g, (d) => String((parseInt(d, 10) + 6) % 7)) + tail;
      }).join(',');
    }
    let dom = map.dom || '*';
    if (dom === '?') dom = '*';

    return [map.minute || '*', map.hour || '*', dom, map.month || '*', dow].join(' ');
  }

  const SNIPPET_BUILDERS = {
    crontab: function (expr, five) {
      return '# Edit your crontab with: crontab -e\n'
        + '# min hour dom month dow   command\n'
        + five + '  /usr/local/bin/my-job.sh >> /var/log/my-job.log 2>&1';
    },
    github: function (expr, five) {
      return 'name: Scheduled job\n\n'
        + 'on:\n'
        + '  schedule:\n'
        + '    # GitHub Actions always runs cron in UTC\n'
        + '    - cron: "' + five + '"\n'
        + '  workflow_dispatch:\n\n'
        + 'jobs:\n'
        + '  run:\n'
        + '    runs-on: ubuntu-latest\n'
        + '    steps:\n'
        + '      - uses: actions/checkout@v4\n'
        + '      - run: ./scripts/my-job.sh';
    },
    kubernetes: function (expr, five) {
      return 'apiVersion: batch/v1\n'
        + 'kind: CronJob\n'
        + 'metadata:\n'
        + '  name: my-job\n'
        + 'spec:\n'
        + '  schedule: "' + five + '"\n'
        + '  timeZone: "' + state.timeZone + '"\n'
        + '  concurrencyPolicy: Forbid\n'
        + '  jobTemplate:\n'
        + '    spec:\n'
        + '      template:\n'
        + '        spec:\n'
        + '          restartPolicy: OnFailure\n'
        + '          containers:\n'
        + '            - name: my-job\n'
        + '              image: alpine:3\n'
        + '              command: ["/bin/sh", "-c", "echo running"]';
    },
    node: function (expr, five) {
      const withSeconds = FLAVORS[state.flavorKey].fields.indexOf('second') >= 0 ? expr : five;
      return "import cron from 'node-cron';\n\n"
        + "cron.schedule('" + withSeconds + "', () => {\n"
        + "  console.log('Running scheduled job');\n"
        + "}, {\n"
        + "  timezone: '" + state.timeZone + "',\n"
        + '});';
    },
    python: function (expr, five) {
      return 'from apscheduler.schedulers.blocking import BlockingScheduler\n'
        + 'from apscheduler.triggers.cron import CronTrigger\n\n'
        + 'scheduler = BlockingScheduler()\n\n'
        + '@scheduler.scheduled_job(CronTrigger.from_crontab("' + five + '", timezone="' + state.timeZone + '"))\n'
        + 'def my_job():\n'
        + '    print("Running scheduled job")\n\n'
        + 'scheduler.start()';
    },
    spring: function (expr, five) {
      const six = FLAVORS[state.flavorKey].fields.indexOf('second') >= 0
        ? expr.split(/\s+/).slice(0, 6).join(' ')
        : '0 ' + five;
      return 'import org.springframework.scheduling.annotation.Scheduled;\n'
        + 'import org.springframework.stereotype.Component;\n\n'
        + '@Component\n'
        + 'public class MyJob {\n\n'
        + '    // Spring uses a 6-field expression: second minute hour dom month dow\n'
        + '    @Scheduled(cron = "' + six + '", zone = "' + state.timeZone + '")\n'
        + '    public void run() {\n'
        + '        System.out.println("Running scheduled job");\n'
        + '    }\n'
        + '}';
    },
  };

  const SNIPPET_NOTES = {
    crontab: 'Standard crontab only understands five fields — seconds and year columns are dropped automatically.',
    github: 'GitHub Actions evaluates schedules in UTC and may delay runs during peak load.',
    kubernetes: 'The timeZone field requires Kubernetes 1.27 or newer; older clusters run in the controller time zone.',
    node: 'node-cron accepts an optional leading seconds field, so the six-field form is used when available.',
    python: 'CronTrigger.from_crontab expects the five-field Unix form.',
    spring: 'Spring’s @Scheduled always expects six fields with seconds first.',
  };

  function renderSnippet(expr) {
    const five = toUnixFive(expr, state.flavorKey);
    const builder = SNIPPET_BUILDERS[state.snippet] || SNIPPET_BUILDERS.crontab;
    snippetCode.textContent = builder(expr, five);
    snippetNote.textContent = SNIPPET_NOTES[state.snippet] || '';
    snippetTabs.querySelectorAll('[data-snippet]').forEach((btn) => {
      const active = btn.getAttribute('data-snippet') === state.snippet;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------------------ *
   * Rendering — builder tabs
   * ------------------------------------------------------------------ */

  function renderTabs() {
    const flavor = FLAVORS[state.flavorKey];
    tabsWrap.innerHTML = flavor.fields.map((key) => {
      const def = FIELD_DEFS[key];
      const active = state.activeTab === key;
      return '<button class="cron-tab' + (active ? ' is-active' : '') + '" type="button" role="tab" '
        + 'aria-selected="' + (active ? 'true' : 'false') + '" data-tab="' + key + '">'
        + '<span class="cron-tab-name">' + esc(def.label) + '</span>'
        + '<span class="cron-tab-value">' + esc(state.fields[key]) + '</span>'
        + '</button>';
    }).join('');

    tabsWrap.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.getAttribute('data-tab');
        renderTabs();
        renderBuilder();
      });
    });
  }

  function modeOptionsFor(key) {
    const def = FIELD_DEFS[key];
    const options = [
      { id: 'every', label: 'Every ' + def.unit },
      { id: 'step', label: 'Every N ' + def.plural },
      { id: 'range', label: 'Range' },
    ];
    if (!def.noGrid) {
      options.push({ id: 'specific', label: 'Specific ' + def.plural });
    }
    if (FLAVORS[state.flavorKey].quartz && key === 'dom') {
      options.push({ id: 'lastday', label: 'Last day of month (L)' });
      options.push({ id: 'nearest', label: 'Nearest weekday (W)' });
    }
    if (FLAVORS[state.flavorKey].quartz && key === 'dow') {
      options.push({ id: 'nth', label: 'Nth weekday (#)' });
      options.push({ id: 'lastdow', label: 'Last weekday of month (L)' });
    }
    options.push({ id: 'custom', label: 'Custom expression' });
    return options;
  }

  function numberOptions(key, selected) {
    const def = FIELD_DEFS[key];
    let html = '';
    for (let v = def.min; v <= def.max; v += 1) {
      html += '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + esc(shortLabel(v, key)) + '</option>';
    }
    return html;
  }

  function renderBuilder() {
    const key = state.activeTab;
    const def = FIELD_DEFS[key];
    const mode = state.modes[key] || { mode: 'every' };
    const options = modeOptionsFor(key);

    let html = '<div class="cron-builder-head">'
      + '<h3>' + esc(def.label) + '</h3>'
      + '<p>Allowed values <code>' + def.min + '-' + def.max + '</code>'
      + (def.names ? ' or names like <code>' + esc(def.names[0]) + '</code>' : '')
      + '. Current field: <code>' + esc(state.fields[key]) + '</code></p>'
      + '</div>';

    html += '<div class="cron-modes" role="radiogroup" aria-label="' + esc(def.label) + ' mode">';
    options.forEach((opt) => {
      const checked = mode.mode === opt.id;
      html += '<label class="cron-mode' + (checked ? ' is-active' : '') + '">'
        + '<input type="radio" name="cron-mode-' + key + '" value="' + opt.id + '"' + (checked ? ' checked' : '') + ' />'
        + '<span>' + esc(opt.label) + '</span>'
        + '</label>';
    });
    html += '</div>';

    html += '<div class="cron-mode-panel" data-mode-panel>' + renderModePanel(key, mode) + '</div>';

    builderWrap.innerHTML = html;

    builderWrap.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        state.modes[key] = defaultModeFor(key, radio.value);
        state.fields[key] = fieldTextFromMode(key, state.modes[key]);
        renderBuilder();
        renderTabs();
        update({ from: 'builder' });
      });
    });

    bindModePanel(key);
  }

  function defaultModeFor(key, modeId) {
    const def = FIELD_DEFS[key];
    switch (modeId) {
      case 'step': return { mode: 'step', step: key === 'minute' ? 5 : 1, start: def.min };
      case 'range': return { mode: 'range', from: def.min, to: Math.min(def.min + 4, def.max) };
      case 'specific': return { mode: 'specific', values: [def.min] };
      case 'lastday': return { mode: 'lastday' };
      case 'nearest': return { mode: 'nearest', day: 15 };
      case 'nth': return { mode: 'nth', dow: 1, n: 1 };
      case 'lastdow': return { mode: 'lastdow', dow: 5 };
      case 'custom': return { mode: 'custom', text: state.fields[key] };
      default: return { mode: 'every' };
    }
  }

  function renderModePanel(key, mode) {
    const def = FIELD_DEFS[key];
    switch (mode.mode) {
      case 'every':
        return '<p class="cron-mode-hint">Runs on every ' + esc(def.unit) + ' — the field is set to <code>*</code>.</p>';

      case 'step':
        return '<div class="cron-inline">'
          + '<label>Every<input class="cron-number" type="number" min="1" max="' + def.max + '" value="' + mode.step + '" data-step /></label>'
          + '<span>' + esc(def.plural) + ' starting at</span>'
          + '<select class="cron-select" data-start>' + numberOptions(key, mode.start) + '</select>'
          + '</div>';

      case 'range':
        return '<div class="cron-inline">'
          + '<span>From</span><select class="cron-select" data-from>' + numberOptions(key, mode.from) + '</select>'
          + '<span>through</span><select class="cron-select" data-to>' + numberOptions(key, mode.to) + '</select>'
          + '</div>'
          + '<p class="cron-mode-hint">Reversed ranges wrap around the end of the cycle (for example <code>22-2</code> for hours).</p>';

      case 'specific': {
        let grid = '<div class="cron-grid" style="--cron-cols:' + def.cols + '">';
        for (let v = def.min; v <= def.max; v += 1) {
          const checked = mode.values.indexOf(v) >= 0;
          grid += '<label class="cron-cell' + (checked ? ' is-checked' : '') + '">'
            + '<input type="checkbox" value="' + v + '"' + (checked ? ' checked' : '') + ' data-value />'
            + '<span>' + esc(shortLabel(v, key)) + '</span>'
            + '</label>';
        }
        grid += '</div>';
        return grid
          + '<div class="cron-inline cron-inline-tight">'
          + '<button class="cron-mini" type="button" data-select-all>Select all</button>'
          + '<button class="cron-mini" type="button" data-select-none>Clear</button>'
          + (key === 'dow' ? '<button class="cron-mini" type="button" data-select-weekdays>Weekdays</button><button class="cron-mini" type="button" data-select-weekend>Weekend</button>' : '')
          + '</div>';
      }

      case 'lastday':
        return '<p class="cron-mode-hint">Fires on the last day of every month — Quartz <code>L</code>.</p>';

      case 'nearest':
        return '<div class="cron-inline">'
          + '<span>Weekday nearest day</span>'
          + '<input class="cron-number" type="number" min="1" max="31" value="' + mode.day + '" data-day />'
          + '</div>'
          + '<p class="cron-mode-hint">Quartz <code>' + mode.day + 'W</code> — if that date falls on a weekend the job moves to the closest Monday or Friday within the same month.</p>';

      case 'nth':
        return '<div class="cron-inline">'
          + '<span>On the</span>'
          + '<select class="cron-select" data-nth>'
          + [1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (n === mode.n ? ' selected' : '') + '>' + ordinal(n) + '</option>').join('')
          + '</select>'
          + '<select class="cron-select" data-nth-dow>' + numberOptions('dow', mode.dow) + '</select>'
          + '<span>of the month</span>'
          + '</div>';

      case 'lastdow':
        return '<div class="cron-inline">'
          + '<span>On the last</span>'
          + '<select class="cron-select" data-lastdow>' + numberOptions('dow', mode.dow) + '</select>'
          + '<span>of the month</span>'
          + '</div>';

      case 'custom':
        return '<div class="cron-inline">'
          + '<label class="cron-custom-label">Raw field value'
          + '<input class="cron-text" type="text" value="' + esc(mode.text || '') + '" data-custom spellcheck="false" />'
          + '</label></div>'
          + '<p class="cron-mode-hint">Anything valid for this field: <code>*</code>, <code>5</code>, <code>1,15</code>, <code>1-5</code>, <code>*/10</code>'
          + (def.names ? ', <code>' + esc(def.names[0]) + '</code>' : '') + '.</p>';

      default:
        return '';
    }
  }

  function bindModePanel(key) {
    const panel = builderWrap.querySelector('[data-mode-panel]');
    if (!panel) return;
    const mode = state.modes[key];

    const commit = () => {
      state.fields[key] = fieldTextFromMode(key, mode);
      renderTabs();
      update({ from: 'builder' });
    };

    const stepInput = panel.querySelector('[data-step]');
    if (stepInput) {
      stepInput.addEventListener('input', () => {
        const v = parseInt(stepInput.value, 10);
        mode.step = Number.isFinite(v) && v > 0 ? v : 1;
        commit();
      });
    }
    const startSelect = panel.querySelector('[data-start]');
    if (startSelect) {
      startSelect.addEventListener('change', () => { mode.start = parseInt(startSelect.value, 10); commit(); });
    }
    const fromSelect = panel.querySelector('[data-from]');
    if (fromSelect) {
      fromSelect.addEventListener('change', () => { mode.from = parseInt(fromSelect.value, 10); commit(); });
    }
    const toSelect = panel.querySelector('[data-to]');
    if (toSelect) {
      toSelect.addEventListener('change', () => { mode.to = parseInt(toSelect.value, 10); commit(); });
    }
    const dayInput = panel.querySelector('[data-day]');
    if (dayInput) {
      dayInput.addEventListener('input', () => {
        const v = parseInt(dayInput.value, 10);
        mode.day = Number.isFinite(v) && v >= 1 && v <= 31 ? v : 1;
        commit();
      });
    }
    const nthSelect = panel.querySelector('[data-nth]');
    if (nthSelect) {
      nthSelect.addEventListener('change', () => { mode.n = parseInt(nthSelect.value, 10); commit(); });
    }
    const nthDow = panel.querySelector('[data-nth-dow]');
    if (nthDow) {
      nthDow.addEventListener('change', () => { mode.dow = parseInt(nthDow.value, 10); commit(); });
    }
    const lastDow = panel.querySelector('[data-lastdow]');
    if (lastDow) {
      lastDow.addEventListener('change', () => { mode.dow = parseInt(lastDow.value, 10); commit(); });
    }
    const customInput = panel.querySelector('[data-custom]');
    if (customInput) {
      customInput.addEventListener('input', () => { mode.text = customInput.value; commit(); });
    }

    panel.querySelectorAll('[data-value]').forEach((box) => {
      box.addEventListener('change', () => {
        const v = parseInt(box.value, 10);
        const i = mode.values.indexOf(v);
        if (box.checked && i < 0) mode.values.push(v);
        if (!box.checked && i >= 0) mode.values.splice(i, 1);
        box.parentNode.classList.toggle('is-checked', box.checked);
        commit();
      });
    });

    const setValues = (values) => {
      mode.values = values.slice();
      state.fields[key] = fieldTextFromMode(key, mode);
      renderBuilder();
      renderTabs();
      update({ from: 'builder' });
    };
    const all = panel.querySelector('[data-select-all]');
    if (all) {
      all.addEventListener('click', () => {
        const def = FIELD_DEFS[key];
        const values = [];
        for (let v = def.min; v <= def.max; v += 1) values.push(v);
        setValues(values);
      });
    }
    const none = panel.querySelector('[data-select-none]');
    if (none) none.addEventListener('click', () => setValues([]));
    const weekdays = panel.querySelector('[data-select-weekdays]');
    if (weekdays) weekdays.addEventListener('click', () => setValues([1, 2, 3, 4, 5]));
    const weekend = panel.querySelector('[data-select-weekend]');
    if (weekend) weekend.addEventListener('click', () => setValues([0, 6]));
  }

  function renderFlavors() {
    flavorWrap.querySelectorAll('[data-flavor-key]').forEach((btn) => {
      const active = btn.getAttribute('data-flavor-key') === state.flavorKey;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const hint = $('[data-flavor-hint]');
    if (hint) hint.textContent = FLAVORS[state.flavorKey].hint;
  }

  /* ------------------------------------------------------------------ *
   * Main update cycle
   * ------------------------------------------------------------------ */

  let lastValidExpression = '* * * * *';

  function update(opts) {
    const options = opts || {};
    let expr;

    if (options.from === 'input') {
      expr = exprInput.value.trim();
    } else {
      expr = buildExpression();
      exprInput.value = expr;
    }

    let parsed = null;
    let error = null;
    try {
      parsed = parseExpression(expr, state.flavorKey);
    } catch (e) {
      error = e;
    }

    if (error) {
      statusBox.className = 'cron-status is-error';
      statusBox.innerHTML = '<span aria-hidden="true">⚠</span> ' + esc(error.message);
      descBox.textContent = 'Fix the expression above to see a plain-English summary.';
      nextList.innerHTML = '<li class="cron-run cron-run-empty">No preview while the expression is invalid.</li>';
      nextMeta.textContent = '';
      warnBox.hidden = true;
      chipsWrap.innerHTML = '';
      return;
    }

    lastValidExpression = parsed.expression;
    statusBox.className = 'cron-status is-ok';
    statusBox.innerHTML = '<span aria-hidden="true">✓</span> Valid ' + esc(parsed.flavor.label) + ' expression';

    if (parsed.warnings.length) {
      warnBox.hidden = false;
      warnBox.innerHTML = parsed.warnings.map((w) => '<p>' + esc(w) + '</p>').join('');
    } else {
      warnBox.hidden = true;
      warnBox.innerHTML = '';
    }

    descBox.textContent = describe(parsed);
    renderChips(parsed, parsed.expression);
    renderSchedule(parsed);
    renderSnippet(parsed.expression);

    if (options.from === 'input') {
      try {
        syncFieldsFromExpression(parsed.expression, state.flavorKey);
        renderTabs();
        renderBuilder();
      } catch (e) { /* keep builder as-is */ }
    }

    updateShareUrl(parsed.expression);
  }

  function updateShareUrl(expr) {
    if (!window.history || !window.history.replaceState) return;
    const params = new URLSearchParams();
    params.set('e', expr);
    params.set('f', state.flavorKey);
    params.set('tz', state.timeZone);
    window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
  }

  /* ------------------------------------------------------------------ *
   * Clipboard + toast
   * ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  function populateTimeZones() {
    let zones = FALLBACK_ZONES;
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        zones = Intl.supportedValuesOf('timeZone');
      }
    } catch (e) { /* fallback list */ }

    const unique = [localZone, 'UTC'].concat(zones.filter((z) => z !== localZone && z !== 'UTC'));
    tzSelect.innerHTML = unique.map((zone, i) => {
      const label = i === 0 ? zone + ' (your local time)' : zone;
      return '<option value="' + esc(zone) + '"' + (zone === state.timeZone ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    const flavor = params.get('f');
    if (flavor && FLAVORS[flavor]) state.flavorKey = flavor;
    const tz = params.get('tz');
    if (tz) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        state.timeZone = tz;
      } catch (e) { /* ignore invalid zone */ }
    }
    const expr = params.get('e');
    if (expr) {
      try {
        syncFieldsFromExpression(expr, state.flavorKey);
        return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  function applyFlavor(nextKey) {
    const previous = FLAVORS[state.flavorKey];
    const next = FLAVORS[nextKey];
    const previousDow = state.fields.dow;

    state.flavorKey = nextKey;

    // Re-base the day-of-week numbers when moving between Unix and Quartz.
    if (previous.quartz !== next.quartz && /^[0-9,\-/]+$/.test(previousDow)) {
      const shift = next.quartz ? 1 : -1;
      state.fields.dow = previousDow.replace(/\d+/g, (d) => {
        const v = parseInt(d, 10) + shift;
        return String(Math.min(Math.max(v, next.quartz ? 1 : 0), next.quartz ? 7 : 6));
      });
    }
    // "?" is Quartz-only — fall back to "*" for the Unix-style formats.
    if (!next.quartz) {
      if (state.fields.dom === '?') state.fields.dom = '*';
      if (state.fields.dow === '?') state.fields.dow = '*';
    }
    if (next.fields.indexOf('second') >= 0 && !state.fields.second) {
      state.fields.second = '0';
    }
    if (next.fields.indexOf(state.activeTab) < 0) {
      state.activeTab = 'minute';
    }
    resetModesFromFields();
    renderFlavors();
    renderTabs();
    renderBuilder();
    update({ from: 'builder' });
  }

  function init() {
    const hadUrl = readUrl();
    populateTimeZones();
    if (!hadUrl) {
      syncFieldsFromExpression('*/5 * * * *', state.flavorKey);
    }
    resetModesFromFields();
    state.activeTab = FLAVORS[state.flavorKey].fields.indexOf('minute') >= 0 ? 'minute' : FLAVORS[state.flavorKey].fields[0];

    renderFlavors();
    renderTabs();
    renderBuilder();
    update({ from: 'builder' });

    exprInput.addEventListener('input', () => update({ from: 'input' }));
    exprInput.addEventListener('blur', () => update({ from: 'input' }));

    flavorWrap.querySelectorAll('[data-flavor-key]').forEach((btn) => {
      btn.addEventListener('click', () => applyFlavor(btn.getAttribute('data-flavor-key')));
    });

    tzSelect.addEventListener('change', () => {
      state.timeZone = tzSelect.value;
      update({ from: 'builder' });
    });

    countSelect.addEventListener('change', () => {
      state.runCount = parseInt(countSelect.value, 10) || 10;
      update({ from: 'builder' });
    });

    snippetTabs.querySelectorAll('[data-snippet]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.snippet = btn.getAttribute('data-snippet');
        renderSnippet(exprInput.value.trim() || lastValidExpression);
      });
    });

    $$('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const flavor = btn.getAttribute('data-preset-flavor') || 'unix';
        if (FLAVORS[flavor] && flavor !== state.flavorKey) {
          state.flavorKey = flavor;
          renderFlavors();
        }
        try {
          syncFieldsFromExpression(btn.getAttribute('data-preset'), state.flavorKey);
          resetModesFromFields();
          if (FLAVORS[state.flavorKey].fields.indexOf(state.activeTab) < 0) state.activeTab = 'minute';
          renderTabs();
          renderBuilder();
          update({ from: 'builder' });
          showToast('Loaded preset: ' + btn.textContent.trim());
        } catch (e) {
          showToast('Could not load that preset');
        }
      });
    });

    const copyBtn = $('[data-copy-expr]');
    if (copyBtn) copyBtn.addEventListener('click', () => copyText(exprInput.value.trim(), 'Cron expression copied'));

    const copySnippetBtn = $('[data-copy-snippet]');
    if (copySnippetBtn) copySnippetBtn.addEventListener('click', () => copyText(snippetCode.textContent, 'Snippet copied'));

    const shareBtn = $('[data-share]');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        updateShareUrl(exprInput.value.trim());
        copyText(window.location.href, 'Shareable link copied');
      });
    }

    const resetBtn = $('[data-reset]');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.flavorKey = 'unix';
        state.timeZone = localZone;
        state.runCount = 10;
        tzSelect.value = localZone;
        countSelect.value = '10';
        syncFieldsFromExpression('*/5 * * * *', 'unix');
        resetModesFromFields();
        state.activeTab = 'minute';
        renderFlavors();
        renderTabs();
        renderBuilder();
        update({ from: 'builder' });
        showToast('Reset to the default schedule');
      });
    }

    const copyNextBtn = $('[data-copy-runs]');
    if (copyNextBtn) {
      copyNextBtn.addEventListener('click', () => {
        const lines = Array.prototype.slice.call(nextList.querySelectorAll('.cron-run-date')).map((el) => el.textContent);
        copyText(lines.join('\n'), lines.length ? 'Next run times copied' : 'Nothing to copy');
      });
    }
  }

  init();
}());
