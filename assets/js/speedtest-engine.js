/* ==========================================================================
   ToolAdda — Internet Speed Test (engine)

   Everything that turns raw timings into numbers and numbers into answers,
   with no network and no DOM. The measurement loop itself stays in
   speedtest.js: it is carefully tuned around incompressible assets, TCP
   slow-start warmup and parallel streams, and it can only be validated
   against a real network. What CAN be tested in isolation is the arithmetic
   and the interpretation, which is what lives here.

   Two things this file is careful about:

   1. BITS ARE NOT BYTES. A speed test reports megabits per second while the
      browser counts bytes. The factor of eight between them is the single
      easiest way to be wrong by 800%, so the conversion happens in exactly
      one place.

   2. AN AVERAGE HIDES A STALL. If a connection delivers 90 Mbps for four
      seconds and 2 Mbps for one, the mean says 72 and the experience says
      "the video buffered". Summaries therefore carry a median and a
      stability figure alongside the mean.
   ========================================================================== */
(function (global) {
  'use strict';

  var BITS_PER_BYTE = 8;
  var BITS_PER_MEGABIT = 1e6;

  /* ======================================================================
     1. Core conversion
     ====================================================================== */

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  /** Bytes transferred over a duration, as megabits per second. */
  function mbpsFrom(bytes, ms) {
    var b = Number(bytes);
    var t = Number(ms);
    if (!isFinite(b) || !isFinite(t) || b < 0 || t <= 0) return NaN;
    return (b * BITS_PER_BYTE) / (t * 1000);
  }

  /** What people actually recognise from a download manager. */
  function megabytesPerSecond(mbps) {
    return isFinite(mbps) ? mbps / BITS_PER_BYTE : NaN;
  }

  /** How long a given file would take at this speed, in seconds. */
  function secondsToTransfer(fileBytes, mbps) {
    var bytes = Number(fileBytes);
    if (!isFinite(bytes) || bytes <= 0 || !isFinite(mbps) || mbps <= 0) return NaN;
    return (bytes * BITS_PER_BYTE) / (mbps * BITS_PER_MEGABIT);
  }

  /* ======================================================================
     2. Statistics

     Deliberately simple and explicit. Every one of these is a place a
     speed test can quietly mislead, so each is separately testable.
     ====================================================================== */

  function finiteOnly(list) {
    return (list || []).filter(function (n) {
      return typeof n === 'number' && isFinite(n);
    });
  }

  function mean(list) {
    var v = finiteOnly(list);
    if (!v.length) return NaN;
    return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
  }

  function median(list) {
    var v = finiteOnly(list).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return NaN;
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /**
   * Mean after discarding the slowest `fraction` of samples. A single
   * stalled chunk should not define the headline number, but discarding
   * the fast end too would flatter the connection, so only the slow tail
   * is trimmed.
   */
  function trimmedMean(list, fraction) {
    var v = finiteOnly(list).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return NaN;
    var f = clampNum(fraction, 0, 0.4, 0.1);
    var drop = Math.floor(v.length * f);
    if (drop >= v.length) drop = v.length - 1;
    var kept = v.slice(drop);
    return kept.reduce(function (a, b) { return a + b; }, 0) / kept.length;
  }

  /** Population standard deviation. */
  function stdev(list) {
    var v = finiteOnly(list);
    if (v.length < 2) return 0;
    var m = mean(v);
    var sq = v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0);
    return Math.sqrt(sq / v.length);
  }

  /**
   * Stability as a percentage: 100 means every sample was identical.
   * Derived from the coefficient of variation, so it is comparable
   * between a 5 Mbps line and a 500 Mbps one.
   */
  function stability(list) {
    var v = finiteOnly(list);
    if (v.length < 2) return 100;
    var m = mean(v);
    if (!m) return 0;
    var cv = stdev(v) / Math.abs(m);
    return Math.round(clampNum(100 - cv * 100, 0, 100, 0));
  }

  /**
   * Jitter: the mean absolute difference between consecutive latency
   * samples. Not the standard deviation — jitter is about how much the
   * delay CHANGES from packet to packet, which is what breaks a call.
   */
  function jitterFrom(pings) {
    var v = finiteOnly(pings);
    if (v.length < 2) return 0;
    var total = 0;
    for (var i = 1; i < v.length; i++) total += Math.abs(v[i] - v[i - 1]);
    return total / (v.length - 1);
  }

  /** One call that describes a run of throughput samples. */
  function summarize(samples) {
    var v = finiteOnly(samples);
    return {
      count: v.length,
      min: v.length ? Math.min.apply(null, v) : NaN,
      max: v.length ? Math.max.apply(null, v) : NaN,
      mean: mean(v),
      median: median(v),
      trimmedMean: trimmedMean(v, 0.1),
      stdev: stdev(v),
      stability: stability(v)
    };
  }

  /* ======================================================================
     3. Grading
     ====================================================================== */

  var SPEED_GRADES = [
    { min: 200, label: 'Excellent', tone: 'great', note: 'Fast enough for anything a home connection is asked to do.' },
    { min: 100, label: 'Very good', tone: 'great', note: 'Comfortable for 4K streaming on several devices at once.' },
    { min: 50, label: 'Good', tone: 'good', note: 'Handles 4K on one screen plus normal household use.' },
    { min: 25, label: 'Fine', tone: 'good', note: 'Enough for 4K on a single device, or several HD streams.' },
    { min: 10, label: 'Usable', tone: 'ok', note: 'HD streaming and video calls work; heavy multitasking will strain it.' },
    { min: 5, label: 'Slow', tone: 'poor', note: 'One HD stream at a time. Large downloads will be painful.' },
    { min: 0, label: 'Very slow', tone: 'poor', note: 'Struggles with HD video and video calls.' }
  ];

  var PING_GRADES = [
    { max: 20, label: 'Excellent', tone: 'great', note: 'Indistinguishable from local for anything interactive.' },
    { max: 50, label: 'Good', tone: 'good', note: 'Fine for competitive gaming and video calls.' },
    { max: 100, label: 'Fair', tone: 'ok', note: 'Noticeable in fast games, fine for everything else.' },
    { max: 200, label: 'Poor', tone: 'poor', note: 'Calls feel laggy and gaming is frustrating.' },
    { max: Infinity, label: 'Very poor', tone: 'poor', note: 'Interactive use is difficult at this latency.' }
  ];

  var JITTER_GRADES = [
    { max: 5, label: 'Excellent', tone: 'great', note: 'Very steady — calls and streams should not stutter.' },
    { max: 20, label: 'Good', tone: 'good', note: 'Steady enough for calls and live video.' },
    { max: 50, label: 'Fair', tone: 'ok', note: 'Occasional stutter on calls is likely.' },
    { max: Infinity, label: 'Poor', tone: 'poor', note: 'Enough variation to break up calls and live streams.' }
  ];

  function gradeSpeed(mbps) {
    if (!isFinite(mbps) || mbps < 0) return { label: 'Unknown', tone: 'unknown', note: 'No measurement.' };
    for (var i = 0; i < SPEED_GRADES.length; i++) {
      if (mbps >= SPEED_GRADES[i].min) return SPEED_GRADES[i];
    }
    return SPEED_GRADES[SPEED_GRADES.length - 1];
  }

  function gradeFromMax(value, table) {
    if (!isFinite(value) || value < 0) return { label: 'Unknown', tone: 'unknown', note: 'No measurement.' };
    for (var i = 0; i < table.length; i++) {
      if (value <= table[i].max) return table[i];
    }
    return table[table.length - 1];
  }

  function gradePing(ms) { return gradeFromMax(ms, PING_GRADES); }
  function gradeJitter(ms) { return gradeFromMax(ms, JITTER_GRADES); }

  /* ======================================================================
     4. What the connection actually supports

     A number on its own does not answer the question people arrive with,
     which is "is my internet good enough for X". These thresholds are the
     figures the services themselves publish; real usage varies with codec
     and device, so the UI presents them as guidance rather than promises.
     ====================================================================== */

  var ACTIVITIES = [
    { id: 'browsing', label: 'Web browsing and email', icon: '🌐', down: 1, up: 0, ping: 500,
      note: 'Almost any working connection manages this.' },
    { id: 'music', label: 'Music streaming', icon: '🎧', down: 2, up: 0, ping: 500,
      note: 'Lossless streaming wants a little more, around 5 Mbps.' },
    { id: 'sd', label: 'SD video (480p)', icon: '📺', down: 3, up: 0, ping: 500,
      note: 'The floor for watchable streaming video.' },
    { id: 'hd', label: 'HD video (1080p)', icon: '🎬', down: 5, up: 0, ping: 500,
      note: 'Most services quote 5 Mbps for a single 1080p stream.' },
    { id: 'call', label: 'One-to-one video call', icon: '📞', down: 2, up: 2, ping: 150, jitter: 30,
      note: 'Upload matters as much as download — you are sending video too.' },
    { id: 'groupcall', label: 'Group video call (1080p)', icon: '👥', down: 4, up: 3.8, ping: 150, jitter: 30,
      note: 'Typical figure published for 1080p group meetings.' },
    { id: 'gaming', label: 'Online gaming', icon: '🎮', down: 3, up: 1, ping: 100, jitter: 30,
      note: 'Bandwidth barely matters here; latency and jitter decide it.' },
    { id: 'uhd', label: '4K video', icon: '🍿', down: 25, up: 0, ping: 500,
      note: 'Services quote 15 to 25 Mbps; 25 leaves headroom for other devices.' },
    { id: 'cloudgaming', label: 'Cloud gaming (1080p60)', icon: '☁️', down: 25, up: 1, ping: 60, jitter: 15,
      note: 'The most demanding common use: high bandwidth AND low latency.' },
    { id: 'wfh', label: 'Working from home', icon: '💼', down: 10, up: 5, ping: 150,
      note: 'A call plus a VPN plus file sync, all at once.' },
    { id: 'bigupload', label: 'Uploading large files', icon: '⬆️', down: 0.5, up: 10, ping: 500,
      note: 'Backups and video uploads live entirely on your upload speed.' },
    { id: 'multi4k', label: 'Several 4K streams at once', icon: '🏠', down: 75, up: 0, ping: 500,
      note: 'A busy household with multiple screens running together.' }
  ];

  /**
   * @returns {Array<{id,label,icon,status,reason}>}
   *   status is 'yes' | 'marginal' | 'no'. Marginal means it will work
   *   but with no headroom, which is where complaints actually come from.
   */
  function capabilities(result) {
    var r = result || {};
    var down = Number(r.downloadMbps);
    var up = Number(r.uploadMbps);
    var ping = Number(r.pingMs);
    var jit = Number(r.jitterMs);

    return ACTIVITIES.map(function (a) {
      var reasons = [];
      var margins = [];

      if (isFinite(down)) {
        margins.push(down / a.down);
        if (down < a.down) reasons.push('needs ' + a.down + ' Mbps down');
      }
      /* Upload is only judged when we actually measured it — a failed
         upload leg must not be reported as a failed activity. */
      /* up: 0 marks an activity where upload genuinely does not matter,
         so it is skipped rather than judged against a token threshold. */
      if (isFinite(up) && a.up > 0) {
        margins.push(up / a.up);
        if (up < a.up) reasons.push('needs ' + a.up + ' Mbps up');
      }
      if (isFinite(ping) && a.ping && ping > a.ping) {
        reasons.push('needs under ' + a.ping + ' ms ping');
        margins.push(0.5);
      }
      if (isFinite(jit) && a.jitter && jit > a.jitter) {
        reasons.push('jitter above ' + a.jitter + ' ms');
        margins.push(0.9);
      }

      var status;
      if (!margins.length) status = 'unknown';
      else if (reasons.length) status = 'no';
      else status = Math.min.apply(null, margins) < 1.5 ? 'marginal' : 'yes';

      return {
        id: a.id, label: a.label, icon: a.icon, note: a.note,
        requiresDown: a.down, requiresUp: a.up, requiresPing: a.ping,
        status: status,
        reason: reasons.length ? reasons.join(', ') : (status === 'marginal' ? 'works, but with little headroom' : '')
      };
    });
  }

  /** The single sentence worth putting at the top of a result. */
  function verdict(result) {
    var caps = capabilities(result);
    var supported = caps.filter(function (c) { return c.status === 'yes'; });
    var best = null;
    /* The most demanding thing comfortably supported. */
    supported.forEach(function (c) {
      if (!best || c.requiresDown > best.requiresDown) best = c;
    });
    var down = Number((result || {}).downloadMbps);
    if (!isFinite(down)) return 'No download measurement was completed.';
    if (!best) return 'This connection is below the threshold for reliable streaming or calls.';
    /* Lowercase only the first letter: a blanket toLowerCase turns
       "Several 4K streams" into "several 4k streams" and mangles
       every acronym in the activity list. */
    var phrase = best.label.charAt(0).toLowerCase() + best.label.slice(1);
    return 'Comfortable for ' + phrase + '.';
  }

  /* ======================================================================
     5. History
     ====================================================================== */

  function normalizeEntry(entry) {
    var e = entry && typeof entry === 'object' ? entry : {};
    var num = function (v) {
      var n = typeof v === 'number' ? v : parseFloat(v);
      return isFinite(n) && n >= 0 ? n : NaN;
    };
    return {
      at: typeof e.at === 'number' && isFinite(e.at) ? e.at : 0,
      downloadMbps: num(e.downloadMbps),
      uploadMbps: num(e.uploadMbps),
      pingMs: num(e.pingMs),
      jitterMs: num(e.jitterMs),
      provider: typeof e.provider === 'string' ? e.provider.slice(0, 40) : ''
    };
  }

  function normalizeHistory(list, max) {
    var cap = clampNum(max, 1, 100, 8);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeEntry)
      .filter(function (e) { return isFinite(e.downloadMbps); })
      .sort(function (a, b) { return b.at - a.at; })
      .slice(0, cap);
  }

  /** Compare a fresh result against previous runs on the same device. */
  function compareToHistory(result, history) {
    var past = normalizeHistory(history, 100).filter(function (e) {
      return e.at !== (result || {}).at;
    });
    if (!past.length || !isFinite((result || {}).downloadMbps)) return null;

    var avg = mean(past.map(function (e) { return e.downloadMbps; }));
    var best = Math.max.apply(null, past.map(function (e) { return e.downloadMbps; }));
    var delta = result.downloadMbps - avg;
    var pct = avg ? (delta / avg) * 100 : 0;

    return {
      runs: past.length,
      averageMbps: avg,
      bestMbps: best,
      deltaMbps: delta,
      deltaPercent: pct,
      isBest: result.downloadMbps >= best,
      /* Anything inside 10% is noise, not a change worth reporting. */
      direction: Math.abs(pct) < 10 ? 'same' : (pct > 0 ? 'faster' : 'slower')
    };
  }

  /* ======================================================================
     6. Formatting
     ====================================================================== */

  function round(n, digits) {
    var p = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(n * p) / p;
  }

  function formatMbps(mbps) {
    if (!isFinite(mbps)) return '— Mbps';
    if (mbps >= 100) return Math.round(mbps) + ' Mbps';
    if (mbps >= 10) return round(mbps, 1) + ' Mbps';
    return round(mbps, 2) + ' Mbps';
  }

  function formatMs(ms) {
    if (!isFinite(ms)) return '— ms';
    return round(ms, ms < 10 ? 1 : 0) + ' ms';
  }

  function formatBytes(bytes) {
    if (!isFinite(bytes) || bytes < 0) return '—';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    var n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return round(n, n < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 1) return 'under a second';
    if (seconds < 60) return Math.round(seconds) + ' sec';
    if (seconds < 3600) {
      var m = Math.floor(seconds / 60);
      var s = Math.round(seconds % 60);
      return m + ' min' + (s ? ' ' + s + ' sec' : '');
    }
    var h = Math.floor(seconds / 3600);
    var mm = Math.round((seconds % 3600) / 60);
    return h + ' hr' + (mm ? ' ' + mm + ' min' : '');
  }

  /** Familiar yardsticks for a download speed. */
  var TRANSFER_EXAMPLES = [
    { label: 'A 5 MB photo', bytes: 5 * 1024 * 1024 },
    { label: 'A 50 MB app update', bytes: 50 * 1024 * 1024 },
    { label: 'A 700 MB episode', bytes: 700 * 1024 * 1024 },
    { label: 'A 4 GB HD film', bytes: 4 * 1024 * 1024 * 1024 },
    { label: 'A 50 GB game', bytes: 50 * 1024 * 1024 * 1024 }
  ];

  function transferTimes(mbps) {
    return TRANSFER_EXAMPLES.map(function (e) {
      return {
        label: e.label,
        bytes: e.bytes,
        seconds: secondsToTransfer(e.bytes, mbps),
        text: formatDuration(secondsToTransfer(e.bytes, mbps))
      };
    });
  }

  /** Plain-text summary for the clipboard. */
  function shareText(result, options) {
    var r = result || {};
    var opts = options || {};
    var lines = [
      'Internet speed test — tooladda.online',
      '',
      'Download : ' + formatMbps(r.downloadMbps),
      'Upload   : ' + formatMbps(r.uploadMbps),
      'Ping     : ' + formatMs(r.pingMs),
      'Jitter   : ' + formatMs(r.jitterMs)
    ];
    if (r.provider) lines.push('Server   : ' + r.provider);
    if (opts.at) lines.push('Tested   : ' + opts.at);
    lines.push('', verdict(r));
    return lines.join('\n');
  }

  /* ======================================================================
     Exports
     ====================================================================== */

  global.SpeedTestEngine = {
    BITS_PER_BYTE: BITS_PER_BYTE,
    ACTIVITIES: ACTIVITIES,
    SPEED_GRADES: SPEED_GRADES,
    PING_GRADES: PING_GRADES,
    JITTER_GRADES: JITTER_GRADES,
    TRANSFER_EXAMPLES: TRANSFER_EXAMPLES,

    clampNum: clampNum,
    mbpsFrom: mbpsFrom,
    megabytesPerSecond: megabytesPerSecond,
    secondsToTransfer: secondsToTransfer,

    mean: mean,
    median: median,
    trimmedMean: trimmedMean,
    stdev: stdev,
    stability: stability,
    jitterFrom: jitterFrom,
    summarize: summarize,

    gradeSpeed: gradeSpeed,
    gradePing: gradePing,
    gradeJitter: gradeJitter,

    capabilities: capabilities,
    verdict: verdict,

    normalizeEntry: normalizeEntry,
    normalizeHistory: normalizeHistory,
    compareToHistory: compareToHistory,

    round: round,
    formatMbps: formatMbps,
    formatMs: formatMs,
    formatBytes: formatBytes,
    formatDuration: formatDuration,
    transferTimes: transferTimes,
    shareText: shareText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.SpeedTestEngine;

})(typeof window !== 'undefined' ? window : this);
