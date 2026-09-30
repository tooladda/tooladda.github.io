(function () {
  'use strict';

  var STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
    'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'don', 'now', 'ok', 'okay', 'yeah', 'yes', 'no', 'hi', 'hello', 'hey', 'lol', 'haha', 'ha', 'oh', 'ah', 'um', 'uh', 'k', 'kk', 'ya', 'yep', 'nope', 'thanks', 'thank', 'please', 'pls', 'plz', 'got', 'get', 'go', 'going', 'went', 'come', 'came', 'see', 'saw', 'know', 'knew', 'think', 'thought', 'say', 'said', 'tell', 'told', 'like', 'want', 'wanted', 'make', 'made', 'take', 'took', 'give', 'gave', 'also', 'then', 'there', 'here', 'well', 'really', 'actually', 'maybe', 'still', 'even', 'back', 'up', 'out', 'if', 'about', 'into', 'over', 'after', 'before', 'between', 'through', 'during', 'without', 'again', 'once', 'because', 'while', 'though', 'although', 'until', 'since', 'any', 'much', 'many', 'lot', 'one', 'two', 'first', 'last', 'new', 'old', 'good', 'bad', 'great', 'right', 'left', 'day', 'days', 'time', 'today', 'tomorrow', 'yesterday'
  ]);

  var MEDIA_PATTERNS = [
    { type: 'image', re: /<(image|media) omitted>|image omitted|\(file attached\)|\.(?:jpg|jpeg|png|gif|webp|heic)\b/i },
    { type: 'video', re: /<(video|media) omitted>|video omitted|\.(?:mp4|mov|avi|mkv)\b/i },
    { type: 'audio', re: /<(audio|media) omitted>|audio omitted|\.(?:mp3|ogg|opus|m4a|wav)\b|voice message/i },
    { type: 'sticker', re: /sticker omitted|<sticker omitted>/i },
    { type: 'document', re: /document omitted|<document omitted>|\(file attached\)/i },
    { type: 'gif', re: /gif omitted|<gif omitted>/i },
    { type: 'contact', re: /contact card omitted|<contact omitted>/i },
    { type: 'location', re: /location:|live location/i }
  ];

  var LINE_PREFIX = /^[\u200E\u200F\uFEFF\u2066-\u2069]*/;
  var DATE_PART = '(\\d{1,2}[\\/.\-]\\d{1,2}[\\/.\-]\\d{2,4})';
  var TIME_PART = '(\\d{1,2}:\\d{2}(?::\\d{2})?(?:[\\s\\u202f]*[ap]\\.?m\\.?)?)';

  var HEADER_PATTERNS = [
    {
      name: 'ios-bracket',
      re: new RegExp('^\\[' + DATE_PART + ',?[\\s\\u202f]*' + TIME_PART + '\\]\\s*(.+?):\\s([\\s\\S]*)$', 'i')
    },
    {
      name: 'android-dash',
      re: new RegExp('^' + DATE_PART + ',?[\\s\\u202f]*' + TIME_PART + '\\s*-\\s*(.+?):\\s([\\s\\S]*)$', 'i')
    },
    {
      name: 'android-bracket',
      re: new RegExp('^\\[' + DATE_PART + ',?[\\s\\u202f]*' + TIME_PART + '\\]\\s*(.+?):\\s([\\s\\S]*)$', 'i')
    },
    {
      name: 'system-dash',
      re: new RegExp('^' + DATE_PART + ',?[\\s\\u202f]*' + TIME_PART + '\\s*-\\s([\\s\\S]+)$', 'i')
    },
    {
      name: 'system-bracket',
      re: new RegExp('^\\[' + DATE_PART + ',?[\\s\\u202f]*' + TIME_PART + '\\]\\s([\\s\\S]+)$', 'i')
    }
  ];

  function stripBom(text) {
    return text.replace(/^\uFEFF/, '');
  }

  function normalizeLine(line) {
    return line.replace(LINE_PREFIX, '').replace(/\r$/, '');
  }

  function parseDateParts(dateStr, timeStr, locale) {
    var parts = dateStr.split(/[\/.\-]/).map(function (p) { return parseInt(p, 10); });
    if (parts.length < 3) return null;
    var a = parts[0], b = parts[1], c = parts[2];
    var year = c < 100 ? 2000 + c : c;
    var day, month;
    if (locale === 'us') {
      month = a; day = b;
    } else if (locale === 'intl') {
      day = a; month = b;
    } else if (locale === 'auto') {
      if (a > 12) { day = a; month = b; }
      else if (b > 12) { day = b; month = a; }
      else { day = a; month = b; }
    } else {
      day = a; month = b;
    }
    var tm = timeStr.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:[\s\u202f]*([ap])\.?m\.?)?/i);
    if (!tm) return null;
    var h = parseInt(tm[1], 10);
    var m = parseInt(tm[2], 10);
    var s = tm[3] ? parseInt(tm[3], 10) : 0;
    var ampm = tm[4];
    if (ampm) {
      var upper = ampm.toUpperCase();
      if (upper === 'P' && h < 12) h += 12;
      if (upper === 'A' && h === 12) h = 0;
    }
    var d = new Date(year, month - 1, day, h, m, s);
    return isNaN(d.getTime()) ? null : d;
  }

  function classifyMessage(text) {
    if (/this message was deleted|you deleted this message|message deleted/i.test(text)) return 'deleted';
    for (var i = 0; i < MEDIA_PATTERNS.length; i++) {
      if (MEDIA_PATTERNS[i].re.test(text)) return 'media';
    }
    if (/^https?:\/\//i.test(text.trim()) || /\bhttps?:\/\//i.test(text)) return 'link';
    return 'text';
  }

  function getMediaSubtype(text) {
    for (var i = 0; i < MEDIA_PATTERNS.length; i++) {
      if (MEDIA_PATTERNS[i].re.test(text)) return MEDIA_PATTERNS[i].type;
    }
    return 'other';
  }

  function parseWhatsAppChat(rawText, options) {
    options = options || {};
    var locale = options.locale || 'auto';
    var lines = stripBom(rawText).split(/\r?\n/);
    var messages = [];
    var current = null;
    var matchedPattern = null;

    lines.forEach(function (rawLine) {
      var line = normalizeLine(rawLine);
      if (!line) return;

      var parsed = null;
      for (var i = 0; i < HEADER_PATTERNS.length; i++) {
        var pat = HEADER_PATTERNS[i];
        var m = line.match(pat.re);
        if (!m) continue;
        var dateStr = m[1];
        var timeStr = m[2];
        var dt = parseDateParts(dateStr, timeStr, locale);
        if (!dt) continue;

        if (pat.name.indexOf('system') >= 0) {
          parsed = { date: dt, sender: null, text: m[3].trim(), type: 'system' };
        } else {
          parsed = {
            date: dt,
            sender: m[3].trim(),
            text: (m[4] || '').trim(),
            type: 'text'
          };
          parsed.type = classifyMessage(parsed.text);
        }
        if (!matchedPattern) matchedPattern = pat.name;
        break;
      }

      if (parsed) {
        if (current) messages.push(current);
        current = parsed;
      } else if (current) {
        current.text += '\n' + line;
        current.type = classifyMessage(current.text);
      }
    });
    if (current) messages.push(current);

    return {
      messages: messages,
      format: matchedPattern || 'unknown',
      parseErrors: messages.length === 0 ? 'No messages detected. Check export format or try changing date locale.' : null
    };
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '—';
    var sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ' + (sec % 60) + 's';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ' + (min % 60) + 'm';
    var days = Math.floor(hr / 24);
    return days + 'd ' + (hr % 24) + 'h';
  }

  function formatNumber(n) {
    return (n || 0).toLocaleString();
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function analyzeChat(messages, options) {
    options = options || {};
    var userMessages = messages.filter(function (m) { return m.sender && m.type !== 'system'; });
    var senders = {};
    var hourCounts = new Array(24).fill(0);
    var weekdayCounts = new Array(7).fill(0);
    var hourWeekdayCounts = Array.from({ length: 7 }, function () { return new Array(24).fill(0); });
    var monthCounts = {};
    var dayCounts = {};
    var emojiCounts = {};
    var wordCounts = {};
    var mediaCounts = { image: 0, video: 0, audio: 0, sticker: 0, document: 0, gif: 0, contact: 0, location: 0, other: 0 };
    var linkCount = 0;
    var deletedCount = 0;
    var systemCount = 0;
    var responseTimes = {};
    var responseSamples = [];
    var initiations = {};
    var wordsPerSender = {};
    var charsPerSender = {};
    var longestMsg = { sender: '', text: '', len: 0 };
    var GAP_MS = (options.gapHours || 6) * 3600000;
    var RESP_MAX_MS = (options.responseMaxHours || 24) * 3600000;
    var lastMsg = null;

    userMessages.forEach(function (msg, idx) {
      var s = msg.sender;
      if (!senders[s]) {
        senders[s] = { count: 0, words: 0, chars: 0, media: 0, links: 0, deleted: 0, first: msg.date, last: msg.date };
        responseTimes[s] = [];
        initiations[s] = 0;
        wordsPerSender[s] = 0;
        charsPerSender[s] = 0;
      }
      var st = senders[s];
      st.count++;
      st.last = msg.date;
      if (msg.date < st.first) st.first = msg.date;

      var h = msg.date.getHours();
      var wd = msg.date.getDay();
      hourCounts[h]++;
      weekdayCounts[wd]++;
      hourWeekdayCounts[wd][h]++;
      var monthKey = msg.date.getFullYear() + '-' + String(msg.date.getMonth() + 1).padStart(2, '0');
      monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
      /* The local calendar date, as the chat shows it. toISOString() gave the
         UTC date, which moved late-night messages (00:00–05:30 in India) onto
         the previous day for the busiest-day and streak figures. */
      var dayKey = monthKey + '-' + String(msg.date.getDate()).padStart(2, '0');
      dayCounts[dayKey] = (dayCounts[dayKey] || 0) + 1;

      if (msg.type === 'deleted') { deletedCount++; st.deleted++; }
      else if (msg.type === 'link') { linkCount++; st.links++; }
      else if (msg.type === 'media') {
        st.media++;
        var sub = getMediaSubtype(msg.text);
        mediaCounts[sub] = (mediaCounts[sub] || 0) + 1;
      }

      if (msg.type === 'text' || msg.type === 'link') {
        /* Links are not words: without this, "https", "www" and "com" filled
           the word cloud of any chat that shares links. */
        var words = msg.text.replace(/https?:\/\/\S+|www\.\S+/gi, ' ').match(/[\p{L}\p{N}']+/gu) || [];
        st.words += words.length;
        st.chars += msg.text.length;
        wordsPerSender[s] += words.length;
        charsPerSender[s] += msg.text.length;
        words.forEach(function (w) {
          var lw = w.toLowerCase();
          if (lw.length < 3 || STOP_WORDS.has(lw)) return;
          wordCounts[lw] = (wordCounts[lw] || 0) + 1;
        });
        if (msg.text.length > longestMsg.len) {
          longestMsg = { sender: s, text: msg.text.slice(0, 200), len: msg.text.length };
        }
      }

      /* One count per pictograph. U+FE0F (emoji style) and U+200D (the joiner
         in combined emojis) are parts of an emoji, not emojis \u2014 counting them
         made an invisible character the "top emoji" of most chats. Many
         pictographs (\u2764, \u2705, \uD83C\uDFD6 \u2026) default to text style, so every one is
         stored with U+FE0F to draw in colour; on the rest it changes nothing. */
      var emojis = msg.text.match(/\p{Extended_Pictographic}/gu) || [];
      emojis.forEach(function (e) {
        var key = e + '\uFE0F';
        emojiCounts[key] = (emojiCounts[key] || 0) + 1;
      });

      if (lastMsg && lastMsg.sender && s && lastMsg.sender !== s) {
        var delta = msg.date - lastMsg.date;
        if (delta > 0 && delta <= RESP_MAX_MS) {
          responseTimes[s].push(delta);
          responseSamples.push({ responder: s, from: lastMsg.sender, ms: delta });
        }
      }

      if (lastMsg) {
        var gap = msg.date - lastMsg.date;
        if (gap >= GAP_MS) initiations[s]++;
      } else {
        initiations[s]++;
      }

      lastMsg = msg;
    });

    systemCount = messages.filter(function (m) { return m.type === 'system'; }).length;

    var senderList = Object.keys(senders).map(function (name) {
      var st = senders[name];
      var rt = responseTimes[name] || [];
      var avgRt = rt.length ? rt.reduce(function (a, b) { return a + b; }, 0) / rt.length : null;
      return {
        name: name,
        count: st.count,
        words: st.words,
        chars: st.chars,
        media: st.media,
        links: st.links,
        deleted: st.deleted,
        share: userMessages.length ? (st.count / userMessages.length * 100) : 0,
        avgWords: st.count ? st.words / st.count : 0,
        avgChars: st.count ? st.chars / st.count : 0,
        first: st.first,
        last: st.last,
        avgResponseMs: avgRt,
        medianResponseMs: rt.length ? median(rt) : null,
        responseCount: rt.length,
        initiations: initiations[name] || 0
      };
    }).sort(function (a, b) { return b.count - a.count; });

    var dates = userMessages.map(function (m) { return m.date; }).sort(function (a, b) { return a - b; });
    var firstDate = dates[0] || null;
    var lastDate = dates[dates.length - 1] || null;
    var spanMs = firstDate && lastDate ? lastDate - firstDate : 0;
    var spanDays = spanMs ? Math.max(1, Math.ceil(spanMs / 86400000)) : 0;

    var topEmojis = Object.keys(emojiCounts).map(function (e) {
      return { emoji: e, count: emojiCounts[e] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 30);

    var topWords = Object.keys(wordCounts).map(function (w) {
      return { word: w, count: wordCounts[w] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 100);

    var busiestDay = Object.keys(dayCounts).sort(function (a, b) {
      return dayCounts[b] - dayCounts[a];
    })[0] || null;

    var busiestHour = hourCounts.indexOf(Math.max.apply(null, hourCounts));

    var streak = computeStreak(Object.keys(dayCounts).sort());

    var pairResponse = computePairResponse(responseSamples);

    return {
      totalMessages: messages.length,
      userMessages: userMessages.length,
      systemMessages: systemCount,
      deletedMessages: deletedCount,
      linkMessages: linkCount,
      mediaMessages: userMessages.filter(function (m) { return m.type === 'media'; }).length,
      mediaBreakdown: mediaCounts,
      participantCount: senderList.length,
      senders: senderList,
      firstDate: firstDate,
      lastDate: lastDate,
      spanDays: spanDays,
      spanMs: spanMs,
      avgMessagesPerDay: spanDays ? userMessages.length / spanDays : 0,
      hourCounts: hourCounts,
      weekdayCounts: weekdayCounts,
      hourWeekdayCounts: hourWeekdayCounts,
      monthCounts: monthCounts,
      dayCounts: dayCounts,
      topEmojis: topEmojis,
      topWords: topWords,
      longestMessage: longestMsg,
      busiestDay: busiestDay,
      busiestHour: busiestHour,
      activeStreakDays: streak,
      pairResponse: pairResponse,
      responseSamples: responseSamples
    };
  }

  function computeStreak(sortedDays) {
    if (!sortedDays.length) return 0;
    var best = 1, cur = 1;
    for (var i = 1; i < sortedDays.length; i++) {
      var prev = new Date(sortedDays[i - 1]);
      var curr = new Date(sortedDays[i]);
      var diff = (curr - prev) / 86400000;
      if (diff <= 1.5) { cur++; best = Math.max(best, cur); }
      else cur = 1;
    }
    return best;
  }

  function computePairResponse(samples) {
    var pairs = {};
    samples.forEach(function (s) {
      var key = s.from + ' → ' + s.responder;
      if (!pairs[key]) pairs[key] = [];
      pairs[key].push(s.ms);
    });
    return Object.keys(pairs).map(function (k) {
      var arr = pairs[k];
      var avg = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
      return { pair: k, count: arr.length, avgMs: avg, medianMs: median(arr) };
    }).sort(function (a, b) { return a.avgMs - b.avgMs; });
  }

  var SENDER_PALETTE = ['#25D366', '#4f46e5', '#0891b2', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#059669', '#2563eb', '#ea580c'];
  function senderColor(index) {
    return SENDER_PALETTE[((index % SENDER_PALETTE.length) + SENDER_PALETTE.length) % SENDER_PALETTE.length];
  }

  function isDarkMode() {
    return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function drawBarChart(canvas, labels, values, options) {
    if (!canvas) return;
    options = options || {};
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 400;
    var h = canvas.clientHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var max = Math.max.apply(null, values.concat([1]));
    var pad = { t: 16, r: 12, b: 36, l: 12 };
    var chartW = w - pad.l - pad.r;
    var chartH = h - pad.t - pad.b;
    var barW = chartW / values.length;
    var color = options.color || '#4f46e5';
    var labelColor = isDarkMode() ? '#94a3b8' : '#64748b';

    values.forEach(function (v, i) {
      var bh = (v / max) * chartH;
      var x = pad.l + i * barW + barW * 0.15;
      var bw = barW * 0.7;
      var y = pad.t + chartH - bh;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (labels[i] && (values.length <= 24 || i % Math.ceil(values.length / 12) === 0)) {
        ctx.fillStyle = labelColor;
        ctx.font = '10px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], x + bw / 2, h - 10);
      }
    });
  }

  function drawWordCloud(canvas, words) {
    if (!canvas || !words.length) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 500;
    var h = canvas.clientHeight || 320;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var max = words[0].count;
    var min = words[words.length - 1].count || 1;
    var colors = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb'];

    var placed = [];
    var cx = w / 2, cy = h / 2;
    words.slice(0, 60).forEach(function (item, idx) {
      var ratio = (item.count - min) / Math.max(max - min, 1);
      var size = 12 + ratio * 36;
      ctx.font = '700 ' + size + 'px system-ui,sans-serif';
      var tw = ctx.measureText(item.word).width;
      var angle = (idx * 0.618) * Math.PI * 2;
      var radius = 20 + idx * 4;
      var x = cx + Math.cos(angle) * radius - tw / 2;
      var y = cy + Math.sin(angle) * radius;
      x = Math.max(4, Math.min(w - tw - 4, x));
      y = Math.max(size, Math.min(h - 4, y));
      ctx.fillStyle = colors[idx % colors.length];
      ctx.globalAlpha = 0.75 + ratio * 0.25;
      ctx.fillText(item.word, x, y);
    });
    ctx.globalAlpha = 1;
  }

  function drawHeatmap(canvas, hourWeekdayCounts) {
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 500;
    var h = canvas.clientHeight || 200;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var max = 1;
    for (var d = 0; d < 7; d++) {
      for (var hr = 0; hr < 24; hr++) {
        max = Math.max(max, hourWeekdayCounts[d][hr]);
      }
    }

    var cellW = (w - 40) / 24;
    var cellH = (h - 30) / 7;
    var dark = isDarkMode();
    var rgb = dark ? '129,140,248' : '79,70,229';
    var floor = dark ? 0.16 : 0.08;

    ctx.font = '9px system-ui,sans-serif';
    ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
    days.forEach(function (day, di) {
      ctx.fillText(day, 2, 20 + di * cellH + cellH / 2);
    });

    for (var di2 = 0; di2 < 7; di2++) {
      for (var hr2 = 0; hr2 < 24; hr2++) {
        var val = hourWeekdayCounts[di2][hr2];
        var intensity = val / max;
        var x = 36 + hr2 * cellW;
        var y = 14 + di2 * cellH;
        ctx.fillStyle = 'rgba(' + rgb + ',' + (floor + intensity * (1 - floor)) + ')';
        ctx.fillRect(x, y, cellW - 1, cellH - 1);
      }
    }
  }

  function csvEscape(val) {
    var s = val == null ? '' : String(val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvSection(title, headers, rows) {
    var lines = [title, headers.map(csvEscape).join(',')];
    rows.forEach(function (r) { lines.push(r.map(csvEscape).join(',')); });
    return lines.join('\n');
  }
  function exportReportCsv(analysis) {
    var a = analysis;
    var senderRows = a.senders.map(function (s) {
      return [s.name, s.count, s.share.toFixed(1) + '%', s.words, s.avgWords.toFixed(1), s.media, s.links, s.initiations,
        s.first ? s.first.toISOString() : '', s.last ? s.last.toISOString() : ''];
    });
    var wordRows = a.topWords.slice(0, 50).map(function (w) { return [w.word, w.count]; });
    var emojiRows = a.topEmojis.slice(0, 20).map(function (e) { return [e.emoji, e.count]; });
    var hourRows = a.hourCounts.map(function (c, h) { return [h, c]; });
    return [
      csvSection('Sender Stats', ['Sender', 'Messages', 'Share', 'Words', 'Avg words', 'Media', 'Links', 'Initiations', 'First', 'Last'], senderRows),
      csvSection('Top Words', ['Word', 'Count'], wordRows),
      csvSection('Top Emojis', ['Emoji', 'Count'], emojiRows),
      csvSection('Messages By Hour', ['Hour', 'Count'], hourRows)
    ].join('\n\n');
  }

  // A shareable, story-style summary card (like a "year in review") — rendered to a
  // fixed-size canvas so it can be downloaded as a single PNG image.
  // Premium share-ready dashboard card (1080×1350 — Instagram 4:5 & WhatsApp friendly).
  function drawConsolidatedDashboard(canvas, analysis, options) {
    if (!canvas || !analysis) return;
    options = options || {};
    var a = analysis;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 1080;
    var H = 1350;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = '100%';
    canvas.style.maxWidth = '420px';
    canvas.style.margin = '0 auto';
    canvas.style.display = 'block';
    canvas.style.aspectRatio = W + ' / ' + H;
    canvas.style.borderRadius = '20px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    var chatLabel = options.chatLabel || 'WhatsApp chat';
    if (/\.(txt|zip)$/i.test(chatLabel)) chatLabel = chatLabel.replace(/\.(txt|zip)$/i, '');

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    }

    function truncate(text, maxW) {
      if (ctx.measureText(text).width <= maxW) return text;
      var t = text;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    }

    function fmtShortDate(d) {
      if (!d) return '—';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#071f14');
    bg.addColorStop(0.38, '#0c3d28');
    bg.addColorStop(0.72, '#0f5132');
    bg.addColorStop(1, '#128C7E');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var orbColors = ['rgba(37,211,102,.22)', 'rgba(79,70,229,.18)', 'rgba(56,189,248,.12)', 'rgba(16,185,129,.15)'];
    [[120, 90, 180], [920, 120, 140], [840, 620, 200], [180, 980, 160], [960, 1100, 120]].forEach(function (o, i) {
      var g = ctx.createRadialGradient(o[0], o[1], 0, o[0], o[1], o[2]);
      g.addColorStop(0, orbColors[i % orbColors.length]);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });

    for (var i = 0; i < 22; i++) {
      ctx.globalAlpha = 0.035 + (i % 3) * 0.012;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc((i * 113) % W, (i * 157) % H, 28 + (i % 6) * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    function glassPanel(x, y, w, h, title) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      roundRect(x, y, w, h, 24);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (title) {
        ctx.fillStyle = 'rgba(209,250,229,0.92)';
        ctx.font = '800 13px system-ui,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(title.toUpperCase(), x + 22, y + 32);
      }
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '800 14px system-ui,sans-serif';
    ctx.fillText('CHAT ANALYTICS', W / 2, 56);
    ctx.font = '900 38px system-ui,sans-serif';
    ctx.fillText('📊 At a Glance', W / 2, 104);
    ctx.font = '600 22px system-ui,sans-serif';
    ctx.globalAlpha = 0.92;
    ctx.fillText(truncate(chatLabel, 900), W / 2, 142);
    ctx.font = '500 18px system-ui,sans-serif';
    ctx.globalAlpha = 0.78;
    ctx.fillText(fmtShortDate(a.firstDate) + '  →  ' + fmtShortDate(a.lastDate), W / 2, 172);
    ctx.globalAlpha = 1;

    ctx.font = '900 96px system-ui,sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(formatNumber(a.userMessages), W / 2, 268);
    ctx.font = '600 24px system-ui,sans-serif';
    ctx.globalAlpha = 0.88;
    ctx.fillText('messages across ' + formatNumber(a.spanDays) + ' days · ' + formatNumber(a.participantCount) + ' people', W / 2, 306);
    ctx.globalAlpha = 1;

    var topSender = a.senders[0];
    var weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var busiestWd = a.weekdayCounts.indexOf(Math.max.apply(null, a.weekdayCounts));
    var fastest = a.senders.filter(function (s) { return s.avgResponseMs != null; }).sort(function (x, y) { return x.avgResponseMs - y.avgResponseMs; })[0];
    var quickStats = [
      { lbl: 'PEAK HOUR', val: a.busiestHour >= 0 ? a.busiestHour + ':00' : '—' },
      { lbl: 'TOP TEXTER', val: topSender ? truncate(topSender.name, 120) : '—' },
      { lbl: 'BEST STREAK', val: a.activeStreakDays + ' days' },
      { lbl: 'AVG / DAY', val: a.avgMessagesPerDay.toFixed(1) }
    ];
    var pillW = (W - 96 - 36) / 4;
    quickStats.forEach(function (st, idx) {
      var px = 48 + idx * (pillW + 12);
      var py = 332;
      ctx.fillStyle = 'rgba(255,255,255,0.11)';
      roundRect(px, py, pillW, 88, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(209,250,229,0.85)';
      ctx.font = '700 11px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(st.lbl, px + 16, py + 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 26px system-ui,sans-serif';
      ctx.fillText(st.val, px + 16, py + 62);
    });

    var panelY = 448;
    glassPanel(48, panelY, 460, 720, 'Message share');
    glassPanel(532, panelY, 500, 340, 'Activity by hour');
    glassPanel(532, panelY + 360, 238, 360, 'By weekday');
    glassPanel(786, panelY + 360, 246, 360, 'Content mix');

    var senders = a.senders.slice(0, 6);
    var otherCount = a.senders.slice(6).reduce(function (sum, s) { return sum + s.count; }, 0);
    var donutSegs = senders.map(function (s, idx) {
      return { value: s.count, color: senderColor(idx), label: s.name };
    });
    if (otherCount > 0) donutSegs.push({ value: otherCount, color: 'rgba(148,163,184,.55)', label: 'Others' });
    var total = donutSegs.reduce(function (sum, seg) { return sum + seg.value; }, 0) || 1;
    var cx = 278;
    var cy = panelY + 300;
    var outerR = 118;
    var innerR = 72;
    var angle = -Math.PI / 2;
    donutSegs.forEach(function (seg) {
      var slice = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, angle, angle + slice);
      ctx.arc(cx, cy, innerR, angle + slice, angle, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.shadowColor = 'rgba(0,0,0,.25)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      angle += slice;
    });
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '900 34px system-ui,sans-serif';
    ctx.fillText(formatNumber(a.userMessages), cx, cy - 4);
    ctx.font = '600 13px system-ui,sans-serif';
    ctx.globalAlpha = 0.82;
    ctx.fillText('total msgs', cx, cy + 20);
    ctx.globalAlpha = 1;

    var legendY = panelY + 460;
    donutSegs.forEach(function (seg, idx) {
      var ly = legendY + idx * 36;
      if (ly > panelY + 690) return;
      ctx.fillStyle = seg.color;
      ctx.beginPath();
      ctx.arc(78, ly, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 16px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(truncate(seg.label, 220), 96, ly + 5);
      ctx.fillStyle = 'rgba(209,250,229,0.85)';
      ctx.textAlign = 'right';
      ctx.fillText(((seg.value / total) * 100).toFixed(0) + '% · ' + formatNumber(seg.value), 488, ly + 5);
    });

    var hourX = 556;
    var hourY = panelY + 52;
    var hourW = 452;
    var hourH = 250;
    var hourMax = Math.max.apply(null, a.hourCounts.concat([1]));
    var hourBarW = hourW / 24;
    for (var h = 0; h < 24; h++) {
      var hv = a.hourCounts[h];
      var bh = (hv / hourMax) * hourH;
      var bx = hourX + h * hourBarW + hourBarW * 0.1;
      var bw = hourBarW * 0.8;
      var by = hourY + hourH - bh;
      var isPeak = h === a.busiestHour;
      var barGrad = ctx.createLinearGradient(bx, by, bx, hourY + hourH);
      if (isPeak) {
        barGrad.addColorStop(0, '#86efac');
        barGrad.addColorStop(1, '#25D366');
      } else {
        barGrad.addColorStop(0, '#a5b4fc');
        barGrad.addColorStop(1, '#4f46e5');
      }
      ctx.fillStyle = barGrad;
      ctx.globalAlpha = isPeak ? 1 : 0.82;
      roundRect(bx, by, bw, bh, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (h % 3 === 0) {
        ctx.fillStyle = 'rgba(209,250,229,0.75)';
        ctx.font = '11px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(h), bx + bw / 2, hourY + hourH + 18);
      }
    }

    var wdX = 556;
    var wdY = panelY + 412;
    var wdW = 210;
    var wdH = 280;
    var wdMax = Math.max.apply(null, a.weekdayCounts.concat([1]));
    var wdBarW = wdW / 7;
    for (var d = 0; d < 7; d++) {
      var dv = a.weekdayCounts[d];
      var dbh = (dv / wdMax) * wdH;
      var dx = wdX + d * wdBarW + wdBarW * 0.12;
      var dbw = wdBarW * 0.76;
      var dby = wdY + wdH - dbh;
      var wdGrad = ctx.createLinearGradient(dx, dby, dx, wdY + wdH);
      wdGrad.addColorStop(0, '#5eead4');
      wdGrad.addColorStop(1, '#0d9488');
      ctx.fillStyle = wdGrad;
      roundRect(dx, dby, dbw, dbh, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(209,250,229,0.8)';
      ctx.font = '11px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(weekdayNames[d], dx + dbw / 2, wdY + wdH + 18);
    }

    var mixX = 810;
    var mixY = panelY + 412;
    var mixW = 200;
    var mixItems = [
      { label: 'Text', value: Math.max(0, a.userMessages - a.mediaMessages - a.linkMessages - a.deletedMessages), color: '#25D366' },
      { label: 'Media', value: a.mediaMessages, color: '#4f46e5' },
      { label: 'Links', value: a.linkMessages, color: '#0891b2' },
      { label: 'Deleted', value: a.deletedMessages, color: '#f59e0b' }
    ].filter(function (it) { return it.value > 0; });
    if (!mixItems.length) mixItems.push({ label: 'Messages', value: a.userMessages, color: '#25D366' });
    var mixMax = Math.max.apply(null, mixItems.map(function (it) { return it.value; }).concat([1]));
    mixItems.forEach(function (it, idx) {
      var rowY = mixY + 36 + idx * 58;
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 15px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(it.label, mixX, rowY);
      var trackX = mixX;
      var trackW = mixW;
      var trackY = rowY + 10;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(trackX, trackY, trackW, 12, 6);
      ctx.fill();
      var fw = (it.value / mixMax) * trackW;
      ctx.fillStyle = it.color;
      roundRect(trackX, trackY, Math.max(fw, 8), 12, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(209,250,229,0.9)';
      ctx.textAlign = 'right';
      ctx.font = '700 13px system-ui,sans-serif';
      ctx.fillText(formatNumber(it.value), mixX + mixW, rowY + 38);
    });

    var insights = [
      { icon: '😀', lbl: 'Top emoji', val: a.topEmojis[0] ? a.topEmojis[0].emoji + ' ×' + a.topEmojis[0].count : '—' },
      { icon: '💬', lbl: 'Top word', val: a.topWords[0] ? '"' + a.topWords[0].word + '"' : '—' },
      { icon: '⚡', lbl: 'Fastest reply', val: fastest ? truncate(fastest.name, 80) : '—' },
      { icon: '📅', lbl: 'Busiest day', val: weekdayNames[busiestWd] || '—' }
    ];
    var insW = (W - 96 - 36) / 4;
    insights.forEach(function (ins, idx) {
      var ix = 48 + idx * (insW + 12);
      var iy = 1196;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      roundRect(ix, iy, insW, 96, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.stroke();
      ctx.font = '700 22px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ins.icon, ix + 16, iy + 34);
      ctx.font = '700 11px system-ui,sans-serif';
      ctx.fillStyle = 'rgba(209,250,229,0.85)';
      ctx.fillText(ins.lbl.toUpperCase(), ix + 16, iy + 56);
      ctx.font = '800 18px system-ui,sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(truncate(ins.val, insW - 32), ix + 16, iy + 82);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 16px system-ui,sans-serif';
    ctx.fillText('Made with ToolAdda · tooladda.online/whatsapp-chat-analyzer', W / 2, H - 36);
    ctx.font = '700 13px system-ui,sans-serif';
    ctx.fillStyle = 'rgba(209,250,229,0.45)';
    ctx.fillText('100% private · analyzed on your device', W / 2, H - 14);
  }

  function drawWrappedCard(canvas, analysis, meta) {
    if (!canvas) return;
    meta = meta || {};
    var a = analysis;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 1080, H = 1350;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = '100%';
    canvas.style.aspectRatio = W + ' / ' + H;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0b3d24');
    grad.addColorStop(0.55, '#0f5132');
    grad.addColorStop(1, '#128c4f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < 26; i++) {
      ctx.globalAlpha = 0.05 + (i % 4) * 0.015;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc((i * 97) % W, (i * 173) % H, 40 + (i % 5) * 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '700 30px system-ui,sans-serif';
    ctx.fillText('💬 Chat Wrapped', W / 2, 96);
    ctx.font = '400 20px system-ui,sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText(meta.chatLabel || 'WhatsApp analysis', W / 2, 132);
    ctx.globalAlpha = 1;

    ctx.font = '900 132px system-ui,sans-serif';
    ctx.fillText(formatNumber(a.userMessages), W / 2, 320);
    ctx.font = '600 26px system-ui,sans-serif';
    ctx.globalAlpha = 0.9;
    ctx.fillText('messages across ' + formatNumber(a.spanDays) + ' days', W / 2, 364);
    ctx.globalAlpha = 1;

    var cardY = 440;
    var cardW = (W - 72 * 3) / 2;
    var cardH = 180;
    var cards = [
      { lbl: 'MOST ACTIVE', val: a.senders[0] ? a.senders[0].name : '—', sub: a.senders[0] ? a.senders[0].share.toFixed(0) + '% of messages' : '' },
      { lbl: 'TOP EMOJI', val: a.topEmojis[0] ? a.topEmojis[0].emoji : '—', sub: a.topEmojis[0] ? (a.topEmojis[0].count + ' times') : '', big: true },
      { lbl: 'PEAK HOUR', val: a.busiestHour >= 0 ? (a.busiestHour + ':00') : '—', sub: 'busiest time to chat' },
      { lbl: 'BEST STREAK', val: a.activeStreakDays + ' days', sub: 'in a row, chatting daily' }
    ];
    cards.forEach(function (c, i) {
      var col = i % 2, row = Math.floor(i / 2);
      var x = 72 + col * (cardW + 72);
      var y = cardY + row * (cardH + 32);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, 24);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#d1fae5';
      ctx.font = '700 15px system-ui,sans-serif';
      ctx.fillText(c.lbl, x + 28, y + 44);
      ctx.fillStyle = '#ffffff';
      ctx.font = (c.big ? '700 70px' : '800 40px') + ' system-ui,sans-serif';
      var maxTextW = cardW - 56;
      var val = c.val;
      while (ctx.measureText(val).width > maxTextW && val.length > 3) val = val.slice(0, -2) + '…';
      ctx.fillText(val, x + 28, y + (c.big ? 118 : 92));
      ctx.font = '400 16px system-ui,sans-serif';
      ctx.globalAlpha = 0.85;
      ctx.fillText(c.sub, x + 28, y + cardH - 24);
      ctx.globalAlpha = 1;
    });

    ctx.textAlign = 'center';
    ctx.font = '600 18px system-ui,sans-serif';
    ctx.globalAlpha = 0.75;
    ctx.fillText(formatNumber(a.participantCount) + ' people · made with ToolAdda WhatsApp Chat Analyzer', W / 2, H - 48);
    ctx.globalAlpha = 1;
  }

  function exportReportJson(analysis, meta) {
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      tool: 'ToolAdda WhatsApp Chat Analyzer',
      meta: meta,
      summary: {
        totalMessages: analysis.totalMessages,
        participants: analysis.participantCount,
        firstDate: analysis.firstDate,
        lastDate: analysis.lastDate,
        spanDays: analysis.spanDays
      },
      senders: analysis.senders,
      topWords: analysis.topWords.slice(0, 50),
      topEmojis: analysis.topEmojis.slice(0, 20),
      hourCounts: analysis.hourCounts,
      weekdayCounts: analysis.weekdayCounts
    }, null, 2);
  }

  window.WaChatAnalyzer = {
    parseWhatsAppChat: parseWhatsAppChat,
    analyzeChat: analyzeChat,
    drawBarChart: drawBarChart,
    drawWordCloud: drawWordCloud,
    drawHeatmap: drawHeatmap,
    drawConsolidatedDashboard: drawConsolidatedDashboard,
    drawWrappedCard: drawWrappedCard,
    exportReportJson: exportReportJson,
    exportReportCsv: exportReportCsv,
    formatDuration: formatDuration,
    formatNumber: formatNumber,
    senderColor: senderColor,
    isDarkMode: isDarkMode,
    STOP_WORDS: STOP_WORDS
  };
})();
