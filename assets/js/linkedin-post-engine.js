/* ==========================================================================
   ToolAdda — LinkedIn Post Engine

   Pure, dependency-free logic behind the LinkedIn Post Previewer.

   The job that matters is the FOLD. In the feed a post is collapsed after a
   short preview and everything past that point sits behind "…see more", so
   the opening line decides whether the rest is ever read. This engine finds
   that cut point, counts what survives it, and reports the rest honestly.

   Two things it deliberately does not do:

     • It does not predict reach, engagement or a "score". Nobody outside
       LinkedIn can compute that, and a made-up number would be worse than
       no number.

     • It does not claim pixel-exact fidelity. The cut point is a character
       approximation that LinkedIn changes over time and that varies with
       render width, so the threshold is configurable and labelled as an
       estimate.

   Text is tokenised into typed segments (plain / hashtag / mention / url)
   which the UI renders with textContent, so a post can never inject markup.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. Sanitisers
     ====================================================================== */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampNum(value, lo, hi, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) n = typeof fallback === 'number' ? fallback : lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  /* Strip control characters, keeping tab and newline, and cap the length.
     Written as a scan rather than a regex so this file holds no control bytes. */
  function safeText(value, maxLength) {
    var s = String(value === null || value === undefined ? '' : value);
    var limit = maxLength === undefined ? 3000 : maxLength;
    var out = '';
    for (var i = 0; i < s.length && out.length < limit; i++) {
      var code = s.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10) continue;
      if (code >= 127 && code <= 159) continue;
      out += s.charAt(i);
    }
    return out;
  }

  function safeUrl(value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (!s) return '';
    if (/[\r\n\t]/.test(s)) return '';
    if (!/^https?:\/\/[^\s"'()<>\\]+$/i.test(s)) return '';
    return s;
  }

  /* ======================================================================
     2. Constants — LinkedIn's own limits
     ====================================================================== */

  /* LinkedIn's post body limit. This one is a hard platform rule. */
  var MAX_POST = 3000;

  /* Where the feed collapses a post. These are approximations: LinkedIn has
     changed them more than once and the real cut depends on render width and
     line count, so they are settings rather than constants. */
  var FOLD_DEFAULTS = { desktop: 210, mobile: 140 };

  /* LinkedIn's own guidance has moved around; 3-5 is the range most
     consistently repeated, so it is offered as guidance, not as a rule. */
  var HASHTAG_SWEET_SPOT = { min: 3, max: 5 };

  var DEVICES = [
    { id: 'desktop', label: 'Desktop feed' },
    { id: 'mobile', label: 'Mobile feed' }
  ];
  var DEVICE_IDS = DEVICES.map(function (d) { return d.id; });

  var POST_TYPES = [
    { id: 'text', label: 'Text only' },
    { id: 'image', label: 'Single image' },
    { id: 'carousel', label: 'Carousel / document' },
    { id: 'video', label: 'Video' },
    { id: 'poll', label: 'Poll' },
    { id: 'link', label: 'Link share' }
  ];
  var POST_TYPE_IDS = POST_TYPES.map(function (t) { return t.id; });

  var THEMES = ['light', 'dark'];

  /* ======================================================================
     3. Unicode text styling
     ====================================================================== */

  /* LinkedIn strips markdown, so people fake bold and italic with the
     Mathematical Alphanumeric Symbols block. It works visually and is a
     genuine accessibility problem — see styleWarning() below. */
  var STYLE_MAPS = {
    none: null,
    bold: { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
    italic: { upper: 0x1d434, lower: 0x1d44e, digit: null, exceptions: { h: 0x210e } },
    boldItalic: { upper: 0x1d468, lower: 0x1d482, digit: null },
    sansBold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
    sansItalic: { upper: 0x1d608, lower: 0x1d622, digit: null },
    monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 }
  };

  var STYLE_IDS = Object.keys(STYLE_MAPS);

  var STYLE_LABELS = {
    none: 'Normal',
    bold: 'Bold',
    italic: 'Italic',
    boldItalic: 'Bold italic',
    sansBold: 'Sans bold',
    sansItalic: 'Sans italic',
    monospace: 'Monospace'
  };

  /**
   * Restyle plain A-Z, a-z and 0-9 using the Mathematical Alphanumeric block.
   * Anything else — punctuation, emoji, already-styled text — passes through
   * untouched, so the operation is safe to apply to a whole selection.
   */
  function toUnicodeStyle(text, style) {
    var map = STYLE_MAPS[style];
    var s = String(text === null || text === undefined ? '' : text);
    if (!map) return s;

    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var code = s.charCodeAt(i);
      var base = null;
      var offset = 0;

      if (code >= 65 && code <= 90) { base = map.upper; offset = code - 65; }
      else if (code >= 97 && code <= 122) { base = map.lower; offset = code - 97; }
      else if (code >= 48 && code <= 57 && map.digit) { base = map.digit; offset = code - 48; }

      if (base === null) { out += ch; continue; }
      if (map.exceptions && map.exceptions[ch] !== undefined) {
        out += String.fromCodePoint(map.exceptions[ch]);
        continue;
      }
      out += String.fromCodePoint(base + offset);
    }
    return out;
  }

  /** Strip styled characters back to plain ASCII. */
  function fromUnicodeStyle(text) {
    var s = String(text === null || text === undefined ? '' : text);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp > 0xffff) i++; // surrogate pair consumed
      var plain = null;

      if (cp === 0x210e) plain = 'h';
      else {
        for (var key in STYLE_MAPS) {
          var m = STYLE_MAPS[key];
          if (!m) continue;
          if (cp >= m.upper && cp < m.upper + 26) { plain = String.fromCharCode(65 + (cp - m.upper)); break; }
          if (cp >= m.lower && cp < m.lower + 26) { plain = String.fromCharCode(97 + (cp - m.lower)); break; }
          if (m.digit && cp >= m.digit && cp < m.digit + 10) { plain = String.fromCharCode(48 + (cp - m.digit)); break; }
        }
      }
      out += plain === null ? String.fromCodePoint(cp) : plain;
    }
    return out;
  }

  function hasStyledText(text) {
    return fromUnicodeStyle(text) !== String(text === null || text === undefined ? '' : text);
  }

  /* ======================================================================
     4. Entity detection & segmentation
     ====================================================================== */

  /* Order matters: URLs are matched first so a #fragment inside a link is not
     mistaken for a hashtag. */
  var URL_RE = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi;
  var HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
  var MENTION_RE = /@[\p{L}\p{N}._-]+/gu;

  function findMatches(text, re, type) {
    var out = [];
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      out.push({ type: type, start: m.index, end: m.index + m[0].length, value: m[0] });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  /**
   * Split a post into typed, non-overlapping segments.
   * The UI walks these and sets textContent on each, so nothing a user types
   * can become markup.
   */
  function segment(text) {
    var s = String(text === null || text === undefined ? '' : text);
    if (!s) return [];

    var found = findMatches(s, URL_RE, 'url')
      .concat(findMatches(s, HASHTAG_RE, 'hashtag'))
      .concat(findMatches(s, MENTION_RE, 'mention'));

    found.sort(function (a, b) { return a.start - b.start || b.end - a.end; });

    var segments = [];
    var cursor = 0;
    found.forEach(function (item) {
      if (item.start < cursor) return; // overlapped by an earlier match
      if (item.start > cursor) {
        segments.push({ type: 'text', value: s.slice(cursor, item.start) });
      }
      segments.push({ type: item.type, value: item.value });
      cursor = item.end;
    });
    if (cursor < s.length) segments.push({ type: 'text', value: s.slice(cursor) });
    return segments;
  }

  /* ======================================================================
     5. The fold
     ====================================================================== */

  /**
   * Split a post at the point the feed collapses it.
   *
   * The cut is nudged back to the previous word boundary the way the feed
   * does, so a word is not sliced in half. A line break before the limit
   * also ends the preview, because the collapsed view shows only the first
   * few lines.
   */
  function splitAtFold(text, limit, maxLines) {
    var s = String(text === null || text === undefined ? '' : text);
    var cap = Math.max(1, Math.round(limit));
    var lineCap = maxLines || 3;

    /* A run of line breaks ends the preview early. */
    var lines = s.split('\n');
    var lineCut = null;
    if (lines.length > lineCap) {
      lineCut = lines.slice(0, lineCap).join('\n').length;
    }

    var charCut = s.length > cap ? cap : null;
    if (charCut === null && lineCut === null) {
      return { visible: s, hidden: '', truncated: false, cut: s.length, reason: 'none' };
    }

    var cut;
    var reason;
    if (charCut === null) { cut = lineCut; reason = 'lines'; }
    else if (lineCut === null) { cut = charCut; reason = 'characters'; }
    else if (lineCut < charCut) { cut = lineCut; reason = 'lines'; }
    else { cut = charCut; reason = 'characters'; }

    /* Back off to a word boundary when we cut mid-word. */
    if (reason === 'characters' && cut < s.length && /\S/.test(s.charAt(cut))) {
      var back = s.lastIndexOf(' ', cut);
      var backBreak = s.lastIndexOf('\n', cut);
      var boundary = Math.max(back, backBreak);
      if (boundary > cap * 0.6) cut = boundary;
    }

    return {
      visible: s.slice(0, cut),
      hidden: s.slice(cut),
      truncated: true,
      cut: cut,
      reason: reason
    };
  }

  /* ======================================================================
     6. Analysis
     ====================================================================== */

  var EMOJI_RE = /\p{Extended_Pictographic}/gu;

  function countMatches(text, re) {
    re.lastIndex = 0;
    var m = String(text).match(re);
    return m ? m.length : 0;
  }

  function analyze(state) {
    var text = state.text;
    var limit = state.fold[state.device];
    var split = splitAtFold(text, limit, state.foldLines);

    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var sentences = text.trim() ? (text.match(/[.!?…]+(\s|$)/g) || []).length || 1 : 0;
    var lines = text ? text.split('\n').length : 0;
    var paragraphs = text.trim() ? text.trim().split(/\n\s*\n/).length : 0;

    var hashtags = (text.match(HASHTAG_RE) || []);
    var mentions = (text.match(MENTION_RE) || []);
    var urls = (text.match(URL_RE) || []);

    return {
      characters: text.length,
      charactersLeft: MAX_POST - text.length,
      overLimit: text.length > MAX_POST,
      words: words,
      sentences: sentences,
      lines: lines,
      paragraphs: paragraphs,
      /* 200 wpm is the usual silent-reading figure for short-form copy. */
      readingSeconds: Math.max(1, Math.round((words / 200) * 60)),
      hashtags: hashtags,
      hashtagCount: hashtags.length,
      mentions: mentions,
      mentionCount: mentions.length,
      urls: urls,
      urlCount: urls.length,
      emojiCount: countMatches(text, EMOJI_RE),
      hook: split.visible,
      hookLength: split.visible.length,
      hookWords: split.visible.trim() ? split.visible.trim().split(/\s+/).length : 0,
      truncated: split.truncated,
      truncationReason: split.reason,
      hiddenLength: split.hidden.length,
      hasStyledText: hasStyledText(text)
    };
  }

  /* ======================================================================
     7. Notes — guidance, never a score
     ====================================================================== */

  function notes(state) {
    var a = analyze(state);
    var out = [];

    if (a.overLimit) {
      out.push({
        level: 'fail',
        text: 'The post is ' + (a.characters - MAX_POST) + ' characters over LinkedIn\'s 3,000 character limit and cannot be published as written.'
      });
    } else if (a.characters === 0) {
      out.push({ level: 'info', text: 'Write something to see how it will appear in the feed.' });
      return out;
    } else if (a.charactersLeft < 150) {
      out.push({ level: 'warn', text: 'Only ' + a.charactersLeft + ' characters left of the 3,000 limit.' });
    }

    if (a.truncated) {
      out.push({
        level: 'info',
        text: 'The feed collapses this post after ' + a.hookLength + ' characters — ' +
          a.hiddenLength + ' characters sit behind "…see more". Everything that matters should be above that line.'
      });
      if (a.truncationReason === 'lines') {
        out.push({
          level: 'info',
          text: 'The cut here is caused by line breaks rather than length. Blank lines are expensive in a collapsed post.'
        });
      }
    } else {
      out.push({ level: 'pass', text: 'The whole post fits before the fold — no "see more" needed.' });
    }

    if (a.hookWords > 0 && a.hookWords < 5 && a.truncated) {
      out.push({ level: 'warn', text: 'Only ' + a.hookWords + ' words are visible before the fold. That is very little to earn a click.' });
    }

    if (a.hashtagCount === 0) {
      out.push({ level: 'info', text: 'No hashtags. They are optional, but a few relevant ones help the post reach beyond your network.' });
    } else if (a.hashtagCount > 10) {
      out.push({ level: 'warn', text: a.hashtagCount + ' hashtags reads as spam to most audiences. Around ' + HASHTAG_SWEET_SPOT.min + ' to ' + HASHTAG_SWEET_SPOT.max + ' is the usual advice.' });
    } else if (a.hashtagCount >= HASHTAG_SWEET_SPOT.min && a.hashtagCount <= HASHTAG_SWEET_SPOT.max) {
      out.push({ level: 'pass', text: a.hashtagCount + ' hashtags — within the range most commonly recommended.' });
    }

    if (a.hasStyledText) {
      out.push({
        level: 'warn',
        text: 'This post uses Unicode "bold" or "italic" characters. They look styled but screen readers announce them character by character or skip them entirely, and they are not searchable. Use them sparingly and never for the whole post.'
      });
    }

    if (a.urlCount > 0 && state.postType === 'text') {
      out.push({
        level: 'info',
        text: 'The post contains a link. LinkedIn will usually attach a preview card, which changes the layout — switch the post type to Link share to see that.'
      });
    }

    if (a.lines > 0 && /\n{3,}/.test(state.text)) {
      out.push({
        level: 'info',
        text: 'Runs of three or more blank lines are collapsed when the post is published, so the spacing you see here may tighten.'
      });
    }

    return out;
  }

  /* ======================================================================
     8. Default state & normalising
     ====================================================================== */

  function defaultState() {
    return {
      version: 1,
      text: 'Most people write their LinkedIn post, hit publish, and never see what the feed actually shows.\n\nThe feed collapses everything after the first couple of lines. That opening is the only part most people will ever read.\n\nSo write the hook first, then the post.\n\n#writing #linkedin #contentstrategy',
      device: 'desktop',
      theme: 'light',
      postType: 'text',
      fold: { desktop: FOLD_DEFAULTS.desktop, mobile: FOLD_DEFAULTS.mobile },
      foldLines: 3,
      author: {
        name: 'Ada Sharma',
        headline: 'Product Designer · Writing about craft and calm interfaces',
        avatarUrl: '',
        timeLabel: '2h',
        verified: false
      },
      attachment: {
        imageUrl: '',
        caption: 'Slide 1 of 8',
        linkTitle: 'How the LinkedIn feed decides what you see',
        linkDomain: 'example.com',
        pollQuestion: 'What stops you posting more often?',
        pollOptions: 'No time\nNot sure what to say\nFear of the algorithm\nI post plenty'
      },
      social: {
        show: true,
        reactions: 0,
        comments: 0,
        reposts: 0
      }
    };
  }

  function normalize(input) {
    var d = defaultState();
    var s = input && typeof input === 'object' ? input : {};
    function sec(n) { return (s[n] && typeof s[n] === 'object') ? s[n] : {}; }

    var fold = sec('fold');
    var author = sec('author');
    var att = sec('attachment');
    var social = sec('social');

    return {
      version: 1,
      text: safeText(s.text === undefined ? d.text : s.text, MAX_POST + 500),
      device: oneOf(s.device, DEVICE_IDS, d.device),
      theme: oneOf(s.theme, THEMES, d.theme),
      postType: oneOf(s.postType, POST_TYPE_IDS, d.postType),
      fold: {
        desktop: Math.round(clampNum(fold.desktop, 40, 600, d.fold.desktop)),
        mobile: Math.round(clampNum(fold.mobile, 40, 600, d.fold.mobile))
      },
      foldLines: Math.round(clampNum(s.foldLines, 1, 10, d.foldLines)),
      author: {
        name: safeText(author.name === undefined ? d.author.name : author.name, 60),
        headline: safeText(author.headline === undefined ? d.author.headline : author.headline, 220),
        avatarUrl: safeUrl(author.avatarUrl),
        timeLabel: safeText(author.timeLabel === undefined ? d.author.timeLabel : author.timeLabel, 12),
        verified: author.verified === undefined ? d.author.verified : !!author.verified
      },
      attachment: {
        imageUrl: safeUrl(att.imageUrl),
        caption: safeText(att.caption === undefined ? d.attachment.caption : att.caption, 90),
        linkTitle: safeText(att.linkTitle === undefined ? d.attachment.linkTitle : att.linkTitle, 140),
        linkDomain: safeText(att.linkDomain === undefined ? d.attachment.linkDomain : att.linkDomain, 60),
        pollQuestion: safeText(att.pollQuestion === undefined ? d.attachment.pollQuestion : att.pollQuestion, 140),
        pollOptions: safeText(att.pollOptions === undefined ? d.attachment.pollOptions : att.pollOptions, 240)
      },
      social: {
        show: social.show === undefined ? d.social.show : !!social.show,
        reactions: Math.round(clampNum(social.reactions, 0, 999999, d.social.reactions)),
        comments: Math.round(clampNum(social.comments, 0, 999999, d.social.comments)),
        reposts: Math.round(clampNum(social.reposts, 0, 999999, d.social.reposts))
      }
    };
  }

  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

  /* ======================================================================
     9. Helpers for the preview
     ====================================================================== */

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function pollOptions(state) {
    return String(state.attachment.pollOptions || '')
      .split('\n').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 4);
  }

  /** LinkedIn's own abbreviation style for counts. */
  function formatCount(n) {
    var v = Math.max(0, Math.round(n));
    if (v < 1000) return String(v);
    if (v < 1000000) {
      var k = v / 1000;
      return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'K';
    }
    var m = v / 1000000;
    return (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10) + 'M';
  }

  function readingLabel(seconds) {
    if (seconds < 60) return seconds + ' sec read';
    var mins = Math.round(seconds / 60);
    return mins + ' min read';
  }

  /** The exact text that should be pasted into LinkedIn. */
  function exportText(state) {
    return state.text;
  }

  /* Starter structures, not templates to publish verbatim. */
  var TEMPLATES = {
    hookStoryLesson: {
      label: 'Hook · story · lesson',
      text: 'I got the feedback wrong for three years.\n\nEvery review, I led with what was broken. It felt honest. It was also useless — people left knowing what failed, not what to do.\n\nThen a manager flipped it on me: "Tell me the one thing I should change."\n\nOne thing. Not nine.\n\nNow every review I give ends with a single sentence starting "the one thing". It is harder to write and far easier to act on.\n\nWhat is the one thing you would change about how your team gives feedback?\n\n#leadership #feedback #management'
    },
    listicle: {
      label: 'Numbered list',
      text: 'Five things I wish I knew before my first design job:\n\n1. Nobody reads a 40-slide deck. They read slide 3.\n\n2. "Make it pop" means "I cannot tell what matters here".\n\n3. The best research finding is the one that kills your favourite idea.\n\n4. Shipping something imperfect teaches you more than polishing something unreleased.\n\n5. Your job is the decision, not the pixels.\n\nWhich one would you add?\n\n#design #career #productdesign'
    },
    announcement: {
      label: 'Announcement',
      text: 'After four years, today is my last day at Acme.\n\nI joined when the design team was three people and a shared Figma file. We leave it as a team of eighteen with a design system used by every product line.\n\nThank you to everyone who made that possible — especially the engineers who pushed back on my worst ideas.\n\nNext up: something small and early, and I could not be more excited.\n\n#newbeginnings #design'
    },
    question: {
      label: 'Question / poll opener',
      text: 'Genuine question for anyone hiring designers right now.\n\nWhat actually makes you stop scrolling on a portfolio — the visuals, the writing, or the process?\n\nI have seen beautiful work rejected for thin reasoning, and rough work hired on the strength of one clear case study. So I suspect it is the writing. But I would like to be wrong.\n\n#hiring #design #portfolio'
    }
  };
  var TEMPLATE_IDS = Object.keys(TEMPLATES);

  /* ======================================================================
     10. Export
     ====================================================================== */

  global.LinkedInPostEngine = {
    escapeHtml: escapeHtml,
    safeText: safeText,
    safeUrl: safeUrl,
    clampNum: clampNum,

    defaultState: defaultState,
    normalize: normalize,
    cloneState: cloneState,

    toUnicodeStyle: toUnicodeStyle,
    fromUnicodeStyle: fromUnicodeStyle,
    hasStyledText: hasStyledText,

    segment: segment,
    splitAtFold: splitAtFold,
    analyze: analyze,
    notes: notes,

    initials: initials,
    pollOptions: pollOptions,
    formatCount: formatCount,
    readingLabel: readingLabel,
    exportText: exportText,

    MAX_POST: MAX_POST,
    FOLD_DEFAULTS: FOLD_DEFAULTS,
    HASHTAG_SWEET_SPOT: HASHTAG_SWEET_SPOT,
    DEVICES: DEVICES,
    DEVICE_IDS: DEVICE_IDS,
    POST_TYPES: POST_TYPES,
    POST_TYPE_IDS: POST_TYPE_IDS,
    THEMES: THEMES,
    STYLE_IDS: STYLE_IDS,
    STYLE_LABELS: STYLE_LABELS,
    TEMPLATES: TEMPLATES,
    TEMPLATE_IDS: TEMPLATE_IDS
  };

})(typeof window !== 'undefined' ? window : this);
