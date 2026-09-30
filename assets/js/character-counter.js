/* ToolAdda — Character Counter & Writing Statistics engine.
   Pure text-analysis logic (no DOM) lives in CharacterCounterEngine so it can
   be reasoned about and tested independently of the UI. Runs entirely
   client-side — nothing here ever makes a network request. */
(function (global) {
  'use strict';

  // =========================================================================
  // Tokenizing helpers
  // =========================================================================

  function tokenizeWords(text) {
    const src = String(text == null ? '' : text);
    const matches = src.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    return matches.map((w) => w.replace(/^['’-]+|['’-]+$/g, '')).filter(Boolean);
  }

  const SENTENCE_PERIOD_GUARD = '';
  const ABBREVIATIONS_RE = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx)\./gi;

  function splitSentences(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return [];
    let collapsed = t.replace(/\s+/g, ' ');
    // Protect periods that don't actually end a sentence (decimals, common
    // abbreviations) so they don't cause spurious sentence breaks.
    collapsed = collapsed.replace(/(\d)\.(\d)/g, '$1' + SENTENCE_PERIOD_GUARD + '$2');
    collapsed = collapsed.replace(ABBREVIATIONS_RE, (m) => m.slice(0, -1) + SENTENCE_PERIOD_GUARD);
    const parts = collapsed.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
    const guardRe = new RegExp(SENTENCE_PERIOD_GUARD, 'g');
    return parts
      .map((s) => s.trim().replace(guardRe, '.'))
      .filter((s) => /[\p{L}\p{N}]/u.test(s));
  }

  function splitParagraphs(text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) return [];
    return t
      .split(/\r?\n\s*\r?\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  function splitLines(text) {
    const t = String(text == null ? '' : text);
    if (!t) return [];
    return t.split(/\r\n|\r|\n/);
  }

  // =========================================================================
  // Character-level classification (mutually exclusive buckets)
  // =========================================================================

  const EMOJI_RE = new RegExp('\\p{Extended_Pictographic}(\\u200d\\p{Extended_Pictographic})*', 'gu');

  function classifyCharacters(text) {
    const src = String(text == null ? '' : text);
    const emojiMatches = src.match(EMOJI_RE) || [];
    const emojiCount = emojiMatches.length;
    const withoutEmoji = src.replace(EMOJI_RE, '');

    let letters = 0;
    let upper = 0;
    let lower = 0;
    let digits = 0;
    let whitespace = 0;
    let punctuation = 0;
    let symbols = 0;
    let other = 0;

    for (const ch of withoutEmoji) {
      if (/\s/.test(ch)) { whitespace += 1; continue; }
      if (/\p{L}/u.test(ch)) {
        letters += 1;
        if (/\p{Lu}/u.test(ch)) upper += 1;
        else if (/\p{Ll}/u.test(ch)) lower += 1;
        continue;
      }
      if (/\p{Nd}/u.test(ch)) { digits += 1; continue; }
      if (/\p{P}/u.test(ch)) { punctuation += 1; continue; }
      if (/\p{S}/u.test(ch)) { symbols += 1; continue; }
      other += 1;
    }

    return {
      emojiCount, letters, upper, lower, digits, whitespace, punctuation,
      specialCharCount: symbols + other,
    };
  }

  const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>()"']+)/gi;
  const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
  const HASHTAG_RE = /(^|[\s(])#[\p{L}0-9_]+/gu;
  const MENTION_RE = /(^|[\s(])@[\p{L}0-9_]+/gu;

  function countPatternMatches(text, re) {
    const matches = String(text == null ? '' : text).match(re);
    return matches ? matches.length : 0;
  }

  // =========================================================================
  // Syllable counting (standard English heuristic)
  // =========================================================================

  function countSyllables(word) {
    let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]e|[^laeiouy]es|[^laeiouy]ed)$/, '');
    w = w.replace(/^y/, '');
    const matches = w.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  // =========================================================================
  // Core stats
  // =========================================================================

  function computeCoreStats(text) {
    const src = String(text == null ? '' : text);
    const words = tokenizeWords(src);
    const sentences = splitSentences(src);
    const paragraphs = splitParagraphs(src);
    const lines = splitLines(src);

    const charCount = Array.from(src).length;
    const charCountNoSpace = Array.from(src.replace(/\s/g, '')).length;
    const wordCount = words.length;
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    const sentenceCount = sentences.length;
    const paragraphCount = paragraphs.length;
    const lineCount = src === '' ? 0 : lines.length;

    let longestWord = '';
    let shortestWord = '';
    let totalWordLen = 0;
    words.forEach((w) => {
      totalWordLen += w.length;
      if (w.length > longestWord.length) longestWord = w;
      if (!shortestWord || w.length < shortestWord.length) shortestWord = w;
    });
    const avgWordLength = wordCount ? totalWordLen / wordCount : 0;
    const avgSentenceLength = sentenceCount ? wordCount / sentenceCount : 0;

    return {
      charCount, charCountNoSpace, wordCount, uniqueWordCount: uniqueWords.size,
      sentenceCount, paragraphCount, lineCount,
      avgWordLength, avgSentenceLength, longestWord, shortestWord,
      words, sentences, paragraphs,
    };
  }

  function computeTimeEstimates(wordCount, opts) {
    const readingWpm = (opts && opts.readingWpm) || 200;
    const speakingWpm = (opts && opts.speakingWpm) || 130;
    return {
      readingMinutes: wordCount / readingWpm,
      speakingMinutes: wordCount / speakingWpm,
    };
  }

  function formatDuration(minutesFloat) {
    const totalSeconds = Math.round(minutesFloat * 60);
    if (totalSeconds <= 0) return '0 sec';
    if (totalSeconds < 60) return `${totalSeconds} sec`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return seconds ? `${minutes} min ${seconds}s` : `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }

  function computeContentEstimates(stats) {
    const words = stats.wordCount;
    const chars = stats.charCount;
    return {
      tweets: chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 280)),
      smsMessages: chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 160)),
      readingPages: words === 0 ? 0 : Math.max(1, Math.ceil(words / 250)),
      bookPages: words === 0 ? 0 : Math.max(1, Math.ceil(words / 300)),
    };
  }

  // =========================================================================
  // Readability formulas
  // =========================================================================

  function computeReadability(stats) {
    const words = stats.wordCount;
    const sentences = Math.max(stats.sentenceCount, words > 0 ? 1 : 0);
    if (!words || !sentences) {
      return {
        fleschReadingEase: null, fleschKincaidGrade: null, gunningFog: null,
        smog: null, colemanLiau: null, ari: null, daleChall: null,
        readingLevel: 'N/A', complexWordCount: 0, totalSyllables: 0,
      };
    }

    let totalSyllables = 0;
    let complexWordCount = 0;
    let letters = 0;
    let difficultCount = 0;

    stats.words.forEach((w) => {
      const syl = countSyllables(w);
      totalSyllables += syl;
      if (syl >= 3) complexWordCount += 1;
      letters += (w.match(/[a-zA-Z]/g) || []).length;
      if (!DALE_CHALL_FAMILIAR.has(w.toLowerCase()) && !/^\d+$/.test(w)) difficultCount += 1;
    });

    const wordsPerSentence = words / sentences;
    const syllablesPerWord = totalSyllables / words;

    const fleschReadingEase = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
    const fleschKincaidGrade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
    const gunningFog = 0.4 * (wordsPerSentence + 100 * (complexWordCount / words));
    const smog = sentences >= 1 ? 1.0430 * Math.sqrt(complexWordCount * (30 / sentences)) + 3.1291 : null;
    const L = (letters / words) * 100;
    const S = (sentences / words) * 100;
    const colemanLiau = 0.0588 * L - 0.296 * S - 15.8;
    const charactersForAri = letters + (stats.words.join('').match(/\d/g) || []).length;
    const ari = 4.71 * (charactersForAri / words) + 0.5 * wordsPerSentence - 21.43;

    const difficultPct = (difficultCount / words) * 100;
    let daleChall = 0.1579 * difficultPct + 0.0496 * wordsPerSentence;
    if (difficultPct > 5) daleChall += 3.6365;

    return {
      fleschReadingEase, fleschKincaidGrade, gunningFog, smog, colemanLiau, ari, daleChall,
      readingLevel: fleschToReadingLevel(fleschReadingEase),
      complexWordCount, totalSyllables, difficultCount,
    };
  }

  function fleschToReadingLevel(score) {
    if (score === null || Number.isNaN(score)) return 'N/A';
    if (score >= 90) return 'Very Easy (5th grade)';
    if (score >= 80) return 'Easy (6th grade)';
    if (score >= 70) return 'Fairly Easy (7th grade)';
    if (score >= 60) return 'Standard (8th–9th grade)';
    if (score >= 50) return 'Fairly Difficult (10th–12th grade)';
    if (score >= 30) return 'Difficult (College)';
    return 'Very Confusing (College graduate)';
  }

  // =========================================================================
  // Passive voice heuristic
  // =========================================================================

  // Common irregular past participles that don't end in -ed/-en, so the
  // regex below would otherwise miss them (e.g. "was thrown", "was sold").
  const IRREGULAR_PARTICIPLES = 'used|given|taken|made|done|seen|known|written|thrown|chosen|driven|born|held|sent|built|found|told|sold|kept|left|brought|bought|caught|taught|thought|understood|meant|felt|heard|said|paid|read|run|put|set|forgotten|gotten|grown|drawn|flown|shown|worn|begun|swum|sung|rung|sat|stood|hidden|ridden|risen|frozen|stolen|torn|won|lost|met|shut|hurt|cut|cost|let';
  const PASSIVE_RE = new RegExp(`\\b(am|is|are|was|were|be|been|being)\\b\\s+(?:\\w+ly\\s+)?(\\w+ed|\\w+en|${IRREGULAR_PARTICIPLES})\\b`, 'i');

  function computePassiveVoice(sentences) {
    if (!sentences.length) return { count: 0, percentage: 0 };
    let count = 0;
    sentences.forEach((s) => { if (PASSIVE_RE.test(s)) count += 1; });
    return { count, percentage: (count / sentences.length) * 100 };
  }

  // =========================================================================
  // Vocabulary / keyword density
  // =========================================================================

  function computeVocabRichness(words) {
    if (!words.length) return 0;
    const unique = new Set(words.map((w) => w.toLowerCase()));
    return (unique.size / words.length) * 100;
  }

  function computeKeywordDensity(words, opts) {
    const limit = (opts && opts.limit) || 10;
    const totalWords = words.length;
    if (!totalWords) return { topWords: [], topBigrams: [], stopWordPercentage: 0 };

    const freq = new Map();
    let stopCount = 0;
    const lower = words.map((w) => w.toLowerCase());
    lower.forEach((w) => {
      if (STOP_WORDS.has(w)) { stopCount += 1; return; }
      if (/^\d+$/.test(w)) return;
      freq.set(w, (freq.get(w) || 0) + 1);
    });
    const topWords = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word, count]) => ({ word, count, density: (count / totalWords) * 100 }));

    const bigramFreq = new Map();
    for (let i = 0; i < lower.length - 1; i += 1) {
      const w1 = lower[i]; const w2 = lower[i + 1];
      if (STOP_WORDS.has(w1) && STOP_WORDS.has(w2)) continue;
      if (/^\d+$/.test(w1) && /^\d+$/.test(w2)) continue;
      const phrase = `${w1} ${w2}`;
      bigramFreq.set(phrase, (bigramFreq.get(phrase) || 0) + 1);
    }
    const topBigrams = Array.from(bigramFreq.entries())
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([phrase, count]) => ({ phrase, count, density: (count / Math.max(1, lower.length - 1)) * 100 }));

    return { topWords, topBigrams, stopWordPercentage: (stopCount / totalWords) * 100 };
  }

  function findRepeatedWords(words) {
    const repeated = [];
    for (let i = 1; i < words.length; i += 1) {
      if (words[i].toLowerCase() === words[i - 1].toLowerCase() && /\p{L}/u.test(words[i])) {
        repeated.push({ word: words[i], index: i });
      }
    }
    return repeated;
  }

  function findDuplicateWords(words, limit) {
    const freq = new Map();
    words.forEach((w) => {
      const lw = w.toLowerCase();
      if (STOP_WORDS.has(lw) || /^\d+$/.test(lw)) return;
      freq.set(lw, (freq.get(lw) || 0) + 1);
    });
    return Array.from(freq.entries())
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit || 15)
      .map(([word, count]) => ({ word, count }));
  }

  function sentenceLengthExtremes(sentences) {
    if (!sentences.length) return { longest: null, shortest: null };
    let longest = sentences[0];
    let shortest = sentences[0];
    let longestLen = tokenizeWords(sentences[0]).length;
    let shortestLen = longestLen;
    sentences.forEach((s) => {
      const len = tokenizeWords(s).length;
      if (len > longestLen) { longestLen = len; longest = s; }
      if (len < shortestLen) { shortestLen = len; shortest = s; }
    });
    return { longest, longestLen, shortest, shortestLen };
  }

  // =========================================================================
  // Social media limits
  // =========================================================================

  const SOCIAL_LIMITS = [
    { id: 'twitter', label: 'Twitter / X Post', limit: 280, recommended: 100 },
    { id: 'linkedin', label: 'LinkedIn Post', limit: 3000, recommended: 1300 },
    { id: 'facebook', label: 'Facebook Post', limit: 63206, recommended: 80 },
    { id: 'instagramCaption', label: 'Instagram Caption', limit: 2200, recommended: 138 },
    { id: 'instagramBio', label: 'Instagram Bio', limit: 150, recommended: 150 },
    { id: 'threads', label: 'Threads Post', limit: 500, recommended: 500 },
    { id: 'youtubeTitle', label: 'YouTube Title', limit: 100, recommended: 70 },
    { id: 'youtubeDescription', label: 'YouTube Description', limit: 5000, recommended: 200 },
    { id: 'tiktokCaption', label: 'TikTok Caption', limit: 2200, recommended: 150 },
    { id: 'pinterestDescription', label: 'Pinterest Description', limit: 500, recommended: 200 },
    { id: 'googleTitle', label: 'Google Meta Title', limit: 60, recommended: 55 },
    { id: 'googleDescription', label: 'Google Meta Description', limit: 160, recommended: 155 },
    { id: 'googleAdsHeadline', label: 'Google Ads Headline', limit: 30, recommended: 30 },
    { id: 'googleAdsDescription', label: 'Google Ads Description', limit: 90, recommended: 90 },
    { id: 'whatsappStatus', label: 'WhatsApp Status', limit: 139, recommended: 139 },
    { id: 'telegramBio', label: 'Telegram Bio', limit: 70, recommended: 70 },
    { id: 'discord', label: 'Discord Message', limit: 2000, recommended: 300 },
    { id: 'slack', label: 'Slack Message', limit: 40000, recommended: 500 },
    { id: 'sms', label: 'SMS (single segment)', limit: 160, recommended: 160 },
    { id: 'emailSubject', label: 'Email Subject Line', limit: 60, recommended: 50 },
  ];

  function computeSocialUsage(text) {
    const charCount = Array.from(String(text == null ? '' : text)).length;
    return SOCIAL_LIMITS.map((platform) => {
      const used = charCount;
      const remaining = platform.limit - used;
      return {
        ...platform,
        used,
        remaining,
        percentage: Math.min(100, (used / platform.limit) * 100),
        exceeded: used > platform.limit,
      };
    });
  }

  // =========================================================================
  // Composite content score (0-100 writing-quality heuristic — NOT a Google
  // ranking factor, just a transparent, explainable proxy for word count
  // adequacy, readability, sentence length, and keyword focus).
  // =========================================================================

  function computeContentScore(stats, readability, topWords) {
    if (!stats.wordCount) return { score: 0, breakdown: { length: 0, readability: 0, sentenceLength: 0, keywordFocus: 0 } };

    const lengthScore = Math.min(25, (stats.wordCount / 300) * 25);

    let readabilityScore = 0;
    if (readability.fleschReadingEase !== null) {
      readabilityScore = Math.max(0, Math.min(25, (readability.fleschReadingEase / 60) * 25));
    }

    let sentenceLengthScore = 25;
    if (stats.avgSentenceLength > 20) {
      sentenceLengthScore = Math.max(0, 25 - (stats.avgSentenceLength - 20) * 1.5);
    }

    let keywordFocusScore = 10;
    if (topWords.length) {
      const topDensity = topWords[0].density;
      if (topDensity >= 1 && topDensity <= 3) keywordFocusScore = 25;
      else if (topDensity < 1) keywordFocusScore = Math.max(10, (topDensity / 1) * 25);
      else keywordFocusScore = Math.max(0, 25 - (topDensity - 3) * 5);
    }

    const score = Math.round(lengthScore + readabilityScore + sentenceLengthScore + keywordFocusScore);
    return {
      score: Math.max(0, Math.min(100, score)),
      breakdown: {
        length: Math.round(lengthScore),
        readability: Math.round(readabilityScore),
        sentenceLength: Math.round(sentenceLengthScore),
        keywordFocus: Math.round(keywordFocusScore),
      },
    };
  }

  // =========================================================================
  // Full analysis bundle
  // =========================================================================

  function analyze(text, opts) {
    const stats = computeCoreStats(text);
    const chars = classifyCharacters(text);
    const time = computeTimeEstimates(stats.wordCount, opts);
    const estimates = computeContentEstimates(stats);
    const readability = computeReadability(stats);
    const passive = computePassiveVoice(stats.sentences);
    const vocabRichness = computeVocabRichness(stats.words);
    const keywords = computeKeywordDensity(stats.words, opts && opts.keywordLimit ? { limit: opts.keywordLimit } : undefined);
    const repeatedWords = findRepeatedWords(stats.words);
    const duplicateWords = findDuplicateWords(stats.words);
    const sentenceExtremes = sentenceLengthExtremes(stats.sentences);
    const social = computeSocialUsage(text);
    const urls = countPatternMatches(text, URL_RE);
    const emails = countPatternMatches(text, EMAIL_RE);
    const hashtags = countPatternMatches(text, HASHTAG_RE);
    const mentions = countPatternMatches(text, MENTION_RE);
    const contentScore = computeContentScore(stats, readability, keywords.topWords);

    return {
      stats, chars, time, estimates, readability, passive, vocabRichness,
      keywords, repeatedWords, duplicateWords, sentenceExtremes, social,
      urls, emails, hashtags, mentions, contentScore,
    };
  }

  // =========================================================================
  // Word lists
  // =========================================================================

  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', "aren't", 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    "can't", 'cannot', 'could', "couldn't",
    'did', "didn't", 'do', 'does', "doesn't", 'doing', "don't", 'down', 'during',
    'each', 'few', 'for', 'from', 'further',
    'had', "hadn't", 'has', "hasn't", 'have', "haven't", 'having', 'he', "he'd", "he'll", "he's", 'her', 'here', "here's", 'hers', 'herself', 'him', 'himself', 'his', 'how', "how's",
    'i', "i'd", "i'll", "i'm", "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's", 'its', 'itself',
    "let's", 'me', 'more', 'most', "mustn't", 'my', 'myself',
    'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
    'same', "shan't", 'she', "she'd", "she'll", "she's", 'should', "shouldn't", 'so', 'some', 'such',
    'than', 'that', "that's", 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', "there's", 'these', 'they', "they'd", "they'll", "they're", "they've", 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up',
    'very', 'was', "wasn't", 'we', "we'd", "we'll", "we're", "we've", 'were', "weren't", 'what', "what's", 'when', "when's", 'where', "where's", 'which', 'while', 'who', "who's", 'whom', 'why', "why's", 'with', "won't", 'would', "wouldn't",
    'you', "you'd", "you'll", "you're", "you've", 'your', 'yours', 'yourself', 'yourselves',
  ]);

  const DALE_CHALL_FAMILIAR = new Set([
    'a', 'able', 'about', 'above', 'across', 'act', 'add', 'afraid', 'after', 'afternoon', 'again', 'against', 'age', 'ago', 'agree', 'air', 'all', 'almost', 'alone', 'along', 'already', 'also', 'always', 'am', 'among', 'an', 'and', 'angry', 'animal', 'another', 'answer', 'any', 'anyone', 'anything', 'appear', 'are', 'area', 'arm', 'around', 'arrive', 'art', 'as', 'ask', 'at', 'away',
    'baby', 'back', 'bad', 'bag', 'ball', 'be', 'bear', 'beautiful', 'became', 'because', 'become', 'bed', 'been', 'before', 'began', 'begin', 'behind', 'believe', 'bell', 'below', 'beside', 'best', 'better', 'between', 'big', 'bird', 'bit', 'black', 'block', 'blue', 'boat', 'body', 'book', 'born', 'both', 'bottom', 'box', 'boy', 'bring', 'brother', 'brought', 'brown', 'build', 'building', 'burn', 'business', 'busy', 'but', 'buy', 'by',
    'call', 'came', 'can', 'car', 'care', 'carry', 'case', 'cat', 'catch', 'cause', 'center', 'certain', 'chair', 'chance', 'change', 'char', 'check', 'child', 'children', 'choose', 'city', 'class', 'clean', 'clear', 'close', 'cold', 'color', 'come', 'company', 'complete', 'consider', 'continue', 'control', 'cook', 'cool', 'corner', 'could', 'country', 'course', 'cover', 'cry', 'cut',
    'dance', 'dark', 'day', 'dear', 'decide', 'deep', 'did', 'die', 'different', 'difficult', 'do', 'does', 'dog', 'done', 'door', 'down', 'draw', 'dream', 'dress', 'drink', 'drive', 'drop', 'dry', 'during',
    'each', 'early', 'earth', 'east', 'easy', 'eat', 'egg', 'eight', 'either', 'else', 'end', 'enjoy', 'enough', 'enter', 'even', 'evening', 'ever', 'every', 'everyone', 'everything', 'example', 'eye',
    'face', 'fact', 'fall', 'family', 'far', 'fast', 'father', 'feel', 'feet', 'few', 'field', 'fight', 'fill', 'find', 'fine', 'finger', 'finish', 'fire', 'first', 'fish', 'five', 'floor', 'fly', 'follow', 'food', 'foot', 'for', 'forest', 'forget', 'form', 'found', 'four', 'free', 'friend', 'from', 'front', 'full',
    'game', 'garden', 'gave', 'get', 'girl', 'give', 'glad', 'go', 'good', 'got', 'great', 'green', 'grew', 'ground', 'group', 'grow', 'guess',
    'had', 'hair', 'half', 'hand', 'happen', 'happy', 'hard', 'has', 'hat', 'have', 'he', 'head', 'hear', 'heard', 'heart', 'heavy', 'held', 'help', 'her', 'here', 'high', 'hill', 'him', 'his', 'hold', 'home', 'hope', 'horse', 'hot', 'hour', 'house', 'how', 'however', 'hundred',
    'i', 'idea', 'if', 'important', 'in', 'inside', 'instead', 'interest', 'into', 'is', 'island', 'it', 'its',
    'job', 'join', 'jump', 'just',
    'keep', 'kept', 'kind', 'king', 'kitchen', 'knew', 'know',
    'lady', 'land', 'large', 'last', 'late', 'laugh', 'lay', 'lead', 'learn', 'least', 'leave', 'left', 'leg', 'less', 'let', 'letter', 'life', 'light', 'like', 'line', 'list', 'listen', 'little', 'live', 'long', 'look', 'lost', 'lot', 'loud', 'love', 'low',
    'machine', 'made', 'make', 'man', 'many', 'map', 'mark', 'may', 'me', 'mean', 'meet', 'men', 'might', 'mile', 'milk', 'mind', 'minute', 'miss', 'moment', 'money', 'month', 'moon', 'more', 'morning', 'most', 'mother', 'mountain', 'mouth', 'move', 'much', 'music', 'must', 'my',
    'name', 'nature', 'near', 'need', 'never', 'new', 'next', 'nice', 'night', 'no', 'nor', 'north', 'not', 'nothing', 'notice', 'now', 'number',
    'of', 'off', 'often', 'oh', 'old', 'on', 'once', 'one', 'only', 'open', 'or', 'order', 'other', 'our', 'out', 'outside', 'over', 'own',
    'page', 'paper', 'part', 'party', 'pass', 'past', 'people', 'person', 'phone', 'pick', 'picture', 'piece', 'place', 'plan', 'plant', 'play', 'please', 'point', 'poor', 'possible', 'power', 'present', 'pretty', 'probably', 'problem', 'process', 'put',
    'question', 'quick', 'quiet', 'quite',
    'race', 'rain', 'ran', 'reach', 'read', 'ready', 'real', 'really', 'reason', 'red', 'remember', 'rest', 'result', 'return', 'rich', 'ride', 'right', 'ring', 'rise', 'river', 'road', 'rock', 'room', 'round', 'rule', 'run',
    'said', 'same', 'sat', 'saw', 'say', 'school', 'sea', 'season', 'seat', 'second', 'see', 'seem', 'seen', 'sell', 'send', 'sense', 'sentence', 'set', 'seven', 'several', 'shall', 'she', 'ship', 'short', 'should', 'show', 'side', 'similar', 'simple', 'since', 'sing', 'sister', 'sit', 'six', 'size', 'sky', 'sleep', 'slow', 'small', 'smile', 'so', 'some', 'someone', 'something', 'sometimes', 'song', 'soon', 'sound', 'south', 'space', 'speak', 'special', 'stand', 'start', 'state', 'stay', 'step', 'still', 'stood', 'stop', 'story', 'street', 'strong', 'student', 'study', 'such', 'sun', 'sure', 'system',
    'table', 'take', 'talk', 'tall', 'teach', 'tell', 'ten', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'think', 'third', 'this', 'those', 'though', 'thought', 'three', 'through', 'time', 'to', 'today', 'together', 'told', 'too', 'took', 'top', 'toward', 'town', 'tree', 'true', 'try', 'turn', 'two', 'type',
    'under', 'understand', 'until', 'up', 'upon', 'us', 'use', 'usually',
    'very', 'voice',
    'wait', 'walk', 'want', 'warm', 'was', 'watch', 'water', 'way', 'we', 'wear', 'week', 'well', 'went', 'were', 'west', 'what', 'when', 'where', 'whether', 'which', 'while', 'white', 'who', 'why', 'wide', 'wife', 'will', 'wind', 'window', 'wish', 'with', 'without', 'woman', 'women', 'word', 'work', 'world', 'would', 'write',
    'year', 'yes', 'yet', 'you', 'young', 'your',
  ]);

  // =========================================================================
  // Public API
  // =========================================================================

  const CharacterCounterEngine = {
    tokenizeWords, splitSentences, splitParagraphs, splitLines,
    classifyCharacters, countSyllables,
    computeCoreStats, computeTimeEstimates, formatDuration, computeContentEstimates,
    computeReadability, fleschToReadingLevel, computePassiveVoice,
    computeVocabRichness, computeKeywordDensity, findRepeatedWords, findDuplicateWords,
    sentenceLengthExtremes, computeContentScore,
    SOCIAL_LIMITS, computeSocialUsage,
    countPatternMatches, URL_RE, EMAIL_RE, HASHTAG_RE, MENTION_RE,
    analyze,
    STOP_WORDS, DALE_CHALL_FAMILIAR,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CharacterCounterEngine;
  } else {
    global.CharacterCounterEngine = CharacterCounterEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
