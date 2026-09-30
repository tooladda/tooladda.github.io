/* ToolAdda — Password Generator Pro engine.
   Vanilla JS, no dependencies beyond the vendored zxcvbn (strength) and
   qrcode-generator (QR export) libraries already used elsewhere on this site.
   All generation runs client-side via the Web Crypto API; nothing is
   transmitted, and generated values are never persisted to disk. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-pw-pro')) return;

  const SETTINGS_KEY = 'tooladda-pwgen-settings-v1';

  /* ---------------------------------------------------------------- */
  /* Word lists (deduplicated at runtime as a safety net)               */
  /* ---------------------------------------------------------------- */

  const RAW_PASSPHRASE_WORDS = ['tiger', 'lion', 'eagle', 'whale', 'otter', 'panda', 'koala', 'zebra', 'rhino', 'camel', 'horse', 'rabbit', 'turtle', 'dolphin', 'falcon', 'hawk', 'wolf', 'fox', 'bear', 'deer', 'moose', 'bison', 'goat', 'sheep', 'swan', 'duck', 'robin', 'sparrow', 'raven', 'crow', 'owl', 'heron', 'crane', 'stork', 'puffin', 'walrus', 'seal', 'shark', 'salmon', 'trout', 'cobra', 'viper', 'gecko', 'iguana', 'lizard', 'newt', 'frog', 'toad', 'snail', 'spider', 'beetle', 'cricket', 'firefly', 'mantis',
    'river', 'ocean', 'forest', 'desert', 'canyon', 'valley', 'meadow', 'prairie', 'glacier', 'volcano', 'island', 'beach', 'cliff', 'cave', 'cavern', 'jungle', 'tundra', 'reef', 'lagoon', 'marsh', 'swamp', 'delta', 'plateau', 'summit', 'ridge', 'boulder', 'pebble', 'stone', 'crystal', 'mineral', 'ember', 'flame', 'spark', 'cloud', 'storm', 'thunder', 'lightning', 'rainbow', 'sunrise', 'sunset', 'horizon', 'galaxy', 'comet', 'meteor', 'planet', 'moonlight', 'starlight', 'breeze', 'frost', 'mist', 'fog', 'drizzle', 'monsoon',
    'crimson', 'scarlet', 'amber', 'golden', 'silver', 'bronze', 'copper', 'violet', 'indigo', 'azure', 'cobalt', 'turquoise', 'emerald', 'jade', 'ivory', 'coral', 'maroon', 'olive', 'charcoal', 'slate', 'magenta', 'lavender', 'mustard', 'teal', 'plum', 'rust', 'saffron',
    'apple', 'mango', 'banana', 'cherry', 'grape', 'lemon', 'orange', 'peach', 'papaya', 'guava', 'coconut', 'walnut', 'almond', 'cashew', 'pepper', 'ginger', 'garlic', 'onion', 'potato', 'tomato', 'carrot', 'pumpkin', 'spinach', 'lettuce', 'cabbage', 'broccoli', 'mushroom', 'honey', 'butter', 'cheese', 'yogurt', 'biscuit', 'pancake', 'waffle', 'noodle', 'dumpling', 'sandwich', 'burrito', 'falafel', 'hummus', 'pretzel',
    'hammer', 'wrench', 'chisel', 'anvil', 'ladder', 'bucket', 'shovel', 'rake', 'broom', 'lantern', 'candle', 'mirror', 'blanket', 'pillow', 'curtain', 'carpet', 'cushion', 'basket', 'bottle', 'kettle', 'teapot', 'saucer', 'goblet', 'chalice', 'compass', 'telescope', 'binocular', 'satchel', 'backpack', 'umbrella', 'raincoat', 'sneaker', 'sandal', 'necklace', 'bracelet', 'earring', 'pendant', 'ribbon', 'button', 'needle', 'thread', 'thimble', 'scissors',
    'mountain', 'harbor', 'village', 'cottage', 'castle', 'fortress', 'bridge', 'tunnel', 'highway', 'railway', 'station', 'airport', 'lighthouse', 'windmill', 'orchard', 'vineyard', 'pasture', 'garden', 'courtyard', 'balcony', 'terrace', 'chimney', 'rooftop', 'doorway', 'staircase', 'hallway', 'cellar', 'attic', 'chamber',
    'whisper', 'murmur', 'echo', 'rhythm', 'melody', 'harmony', 'chorus', 'lullaby', 'ballad', 'anthem', 'symphony', 'sonnet', 'riddle', 'legend', 'fable', 'mystery', 'journey', 'voyage', 'odyssey', 'quest', 'treasure', 'fortune', 'destiny', 'courage', 'wisdom', 'honor', 'glory', 'triumph', 'victory', 'serenity', 'tranquil', 'gentle', 'graceful', 'radiant', 'brilliant', 'splendid', 'magnificent', 'majestic', 'elegant', 'humble', 'gallant', 'valiant', 'noble', 'loyal', 'faithful', 'cheerful', 'joyful', 'playful', 'curious', 'clever',
    'velvet', 'satin', 'linen', 'cotton', 'wool', 'leather', 'denim', 'canvas', 'marble', 'granite', 'quartz', 'obsidian', 'sapphire', 'ruby', 'topaz', 'opal', 'pearl', 'diamond', 'garnet', 'amethyst',
    'morning', 'evening', 'twilight', 'midnight', 'daybreak', 'nightfall', 'autumn', 'winter', 'summer', 'spring', 'harvest', 'blossom', 'sprout', 'seedling'];
  const PASSPHRASE_WORDS = Array.from(new Set(RAW_PASSPHRASE_WORDS));

  const RAW_ADJECTIVES = ['swift', 'brave', 'calm', 'bold', 'wise', 'quiet', 'quick', 'bright', 'dark', 'silent', 'happy', 'lucky', 'mighty', 'gentle', 'fierce', 'clever', 'jolly', 'proud', 'sunny', 'misty', 'frosty', 'golden', 'silver', 'crimson', 'royal', 'noble', 'humble', 'cosmic', 'lunar', 'solar', 'arctic', 'tropical', 'electric', 'rapid', 'steady', 'sturdy', 'nimble', 'agile', 'sharp', 'keen', 'curious', 'playful', 'cheerful', 'daring', 'fearless', 'valiant', 'loyal', 'honest', 'kind', 'warm', 'cool', 'wild', 'free', 'epic', 'grand', 'prime', 'vivid', 'zesty', 'spicy', 'breezy', 'stormy', 'sunlit', 'moonlit', 'starry', 'shady', 'snowy', 'rainy', 'windy', 'dusty', 'rocky', 'sandy', 'leafy', 'thorny', 'silky', 'glossy', 'rusty', 'shiny', 'dusky', 'hazy', 'foggy', 'crisp', 'tender', 'fluffy', 'chunky', 'tiny', 'giant', 'mini', 'mega', 'ultra', 'super', 'hyper'];
  const ADJECTIVES = Array.from(new Set(RAW_ADJECTIVES));

  const RAW_NOUNS = ['falcon', 'otter', 'tiger', 'panda', 'wolf', 'eagle', 'hawk', 'fox', 'bear', 'lion', 'shark', 'whale', 'dolphin', 'cobra', 'viper', 'phoenix', 'dragon', 'griffin', 'unicorn', 'comet', 'meteor', 'planet', 'galaxy', 'nebula', 'nova', 'quasar', 'pulsar', 'storm', 'thunder', 'lightning', 'blizzard', 'cyclone', 'tempest', 'ranger', 'hunter', 'wanderer', 'voyager', 'pioneer', 'explorer', 'warrior', 'knight', 'samurai', 'ninja', 'wizard', 'sage', 'oracle', 'phantom', 'shadow', 'ghost', 'spirit', 'ember', 'spark', 'blaze', 'flame', 'glacier', 'summit', 'canyon', 'valley', 'harbor', 'island', 'reef', 'forest', 'meadow', 'orchard', 'garden', 'castle', 'fortress', 'citadel', 'beacon', 'compass', 'anchor', 'voyage', 'odyssey', 'quest', 'legend', 'saga', 'riddle', 'puzzle', 'cipher', 'echo', 'whisper', 'melody', 'rhythm', 'harmony'];
  const NOUNS = Array.from(new Set(RAW_NOUNS));

  const COMMON_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '1212', '2001', '1004', '2580', '1122', '1313', '1010', '1230', '6969', '2323', '1112', '0852', '1123', '1357', '2468']);

  /* ---------------------------------------------------------------- */
  /* Cryptographically secure, unbiased RNG                            */
  /* ---------------------------------------------------------------- */

  // Naive `randomByte % range` is biased toward small remainders when range
  // doesn't evenly divide 2^32. Reject values above the largest multiple of
  // range that fits in 2^32 so every outcome stays equally likely.
  const secureRandomInt = (maxExclusive) => {
    if (maxExclusive <= 0) return 0;
    if (maxExclusive === 1) return 0;
    const CEILING = 4294967296; // 2^32
    const limit = CEILING - (CEILING % maxExclusive);
    const buf = new Uint32Array(1);
    let x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % maxExclusive;
  };

  const secureShuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = secureRandomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const pick = (str) => str[secureRandomInt(str.length)];
  const pickFrom = (arr) => arr[secureRandomInt(arr.length)];

  /* ---------------------------------------------------------------- */
  /* Character sets                                                    */
  /* ---------------------------------------------------------------- */

  const CHARSETS = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?~',
  };
  const SIMILAR_CHARS = new Set(['i', 'l', '1', 'I', 'L', 'o', 'O', '0']);
  const AMBIGUOUS_CHARS = new Set(['{', '}', '(', ')', '[', ']', '/', '\\', "'", '"', '`', '~', ',', ';', ':', '.', '<', '>', '|', '_', '-']);

  const filterPool = (chars, excludeSimilar, excludeAmbiguous) => {
    let out = chars;
    if (excludeSimilar) out = out.split('').filter((c) => !SIMILAR_CHARS.has(c)).join('');
    if (excludeAmbiguous) out = out.split('').filter((c) => !AMBIGUOUS_CHARS.has(c)).join('');
    return out;
  };

  const isSequential = (a, b, c) => {
    const ca = a.toLowerCase().charCodeAt(0), cb = b.toLowerCase().charCodeAt(0), cc = c.toLowerCase().charCodeAt(0);
    return (cb === ca + 1 && cc === cb + 1) || (cb === ca - 1 && cc === cb - 1);
  };

  const hasSequentialRun = (str) => {
    for (let i = 0; i < str.length - 2; i += 1) {
      if (isSequential(str[i], str[i + 1], str[i + 2])) return true;
    }
    return false;
  };
  const hasAdjacentRepeat = (str) => /(.)\1/.test(str);

  /* ---------------------------------------------------------------- */
  /* Password generation                                               */
  /* ---------------------------------------------------------------- */

  const MAX_ATTEMPTS = 60;

  const generatePassword = (opts) => {
    const types = [];
    if (opts.upper) types.push(filterPool(CHARSETS.upper, opts.excludeSimilar, opts.excludeAmbiguous));
    if (opts.lower) types.push(filterPool(CHARSETS.lower, opts.excludeSimilar, opts.excludeAmbiguous));
    if (opts.numbers) types.push(filterPool(CHARSETS.numbers, opts.excludeSimilar, opts.excludeAmbiguous));
    if (opts.symbols) types.push(filterPool(CHARSETS.symbols, opts.excludeSimilar, opts.excludeAmbiguous));
    const custom = (opts.customChars || '').trim();
    if (custom) types.push(Array.from(new Set(custom.split(''))).join(''));

    const activeTypes = types.filter((t) => t.length > 0);
    if (!activeTypes.length) activeTypes.push(filterPool(CHARSETS.lower, false, false));
    const pool = Array.from(new Set(activeTypes.join('').split(''))).join('');

    const prefix = opts.startWith || '';
    const suffix = opts.endWith || '';
    const fixedLen = prefix.length + suffix.length;
    const middleLen = Math.max(activeTypes.length, opts.length - fixedLen);
    let best = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const middleChars = activeTypes.map((t) => pick(t));
      while (middleChars.length < middleLen) middleChars.push(pick(pool));
      const shuffled = secureShuffle(middleChars).slice(0, middleLen);
      const candidate = prefix + shuffled.join('') + suffix;

      const failsRepeat = opts.noRepeat && hasAdjacentRepeat(candidate);
      const failsSequential = opts.avoidSequential && hasSequentialRun(candidate);
      if (!failsRepeat && !failsSequential) return { value: candidate, satisfied: true };
      if (!best || attempt === MAX_ATTEMPTS - 1) best = candidate;
    }
    return { value: best, satisfied: false };
  };

  /* ---------------------------------------------------------------- */
  /* Passphrase & memorable (pronounceable) generation                 */
  /* ---------------------------------------------------------------- */

  const capitalizeWord = (w) => w.charAt(0).toUpperCase() + w.slice(1);

  const generatePassphrase = (opts) => {
    const words = [];
    for (let i = 0; i < opts.wordCount; i += 1) words.push(pickFrom(PASSPHRASE_WORDS));
    let styled = words.map((w) => {
      if (opts.capitalization === 'first') return capitalizeWord(w);
      if (opts.capitalization === 'all-upper') return w.toUpperCase();
      if (opts.capitalization === 'random') return secureRandomInt(2) ? capitalizeWord(w) : w;
      return w;
    });
    let value = styled.join(opts.separator);
    if (opts.includeNumber) value += String(secureRandomInt(90) + 10);
    if (opts.includeSymbol) value += pick('!@#$%&*');
    const wordlistBits = Math.log2(PASSPHRASE_WORDS.length) * opts.wordCount;
    return { value, wordlistBits };
  };

  const VOWELS = 'aeiou';
  const CONSONANTS = 'bcdfghjklmnpqrstvwxyz';

  const generateMemorable = (opts) => {
    let base = '';
    let useConsonant = secureRandomInt(2) === 0;
    while (base.length < opts.length) {
      base += useConsonant ? pick(CONSONANTS) : pick(VOWELS);
      useConsonant = !useConsonant;
    }
    base = base.slice(0, opts.length);
    if (opts.capitalize) {
      base = base.split('').map((c) => (secureRandomInt(4) === 0 ? c.toUpperCase() : c)).join('');
      base = capitalizeWord(base);
    }
    if (opts.includeNumber) base += String(secureRandomInt(90) + 10);
    if (opts.includeSymbol) base += pick('!@#$%&*');
    return { value: base };
  };

  /* ---------------------------------------------------------------- */
  /* PIN generation                                                     */
  /* ---------------------------------------------------------------- */

  const generatePin = (opts) => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let pin = '';
      for (let i = 0; i < opts.length; i += 1) pin += String(secureRandomInt(10));
      if (opts.avoidCommon && opts.length === 4 && COMMON_PINS.has(pin)) continue;
      if (opts.noRepeat && hasAdjacentRepeat(pin)) continue;
      if (opts.avoidSequential && hasSequentialDigits(pin)) continue;
      return { value: pin, satisfied: true };
    }
    let pin = '';
    for (let i = 0; i < opts.length; i += 1) pin += String(secureRandomInt(10));
    return { value: pin, satisfied: false };
  };

  const hasSequentialDigits = (str) => {
    for (let i = 0; i < str.length - 2; i += 1) {
      const a = Number(str[i]), b = Number(str[i + 1]), c = Number(str[i + 2]);
      if ((b === a + 1 && c === b + 1) || (b === a - 1 && c === b - 1)) return true;
    }
    return false;
  };

  /* ---------------------------------------------------------------- */
  /* API key generation                                                */
  /* ---------------------------------------------------------------- */

  const randomBytes = (n) => {
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    return buf;
  };
  const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const bytesToBase64 = (bytes, urlSafe) => {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    let b64 = btoa(binary);
    if (urlSafe) b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return b64;
  };
  const bytesToUuidV4 = (bytes) => {
    const b = bytes.slice(0, 16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = bytesToHex(b);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  const generateApiKey = (opts) => {
    const bytes = randomBytes(opts.byteLength);
    let body;
    if (opts.format === 'hex') body = bytesToHex(bytes);
    else if (opts.format === 'base64') body = bytesToBase64(bytes, false);
    else if (opts.format === 'base64url') body = bytesToBase64(bytes, true);
    else if (opts.format === 'uuid') body = bytesToUuidV4(randomBytes(16));
    else body = bytesToBase64(bytes, true);
    const prefix = (opts.prefix || '').trim();
    return { value: prefix ? `${prefix}${body}` : body, bits: opts.format === 'uuid' ? 122 : opts.byteLength * 8 };
  };

  /* ---------------------------------------------------------------- */
  /* Username generation                                               */
  /* ---------------------------------------------------------------- */

  const generateUsername = (opts) => {
    let value = pickFrom(ADJECTIVES);
    value = opts.case === 'lower' ? value : capitalizeWord(value);
    let noun = pickFrom(NOUNS);
    noun = opts.case === 'lower' ? noun : capitalizeWord(noun);
    value += (opts.separator || '') + noun;
    if (opts.includeNumber) value += String(secureRandomInt(900) + 10);
    return { value };
  };

  /* ---------------------------------------------------------------- */
  /* Strength / entropy / crack-time (zxcvbn + multi-scenario model)   */
  /* ---------------------------------------------------------------- */

  const SCENARIOS = [
    { key: 'online_limited', label: 'Online, rate-limited', guessesPerSecond: 100 / 3600 },
    { key: 'online_unlimited', label: 'Online, no rate limit', guessesPerSecond: 10 },
    { key: 'offline_slow', label: 'Offline, slow hash (bcrypt)', guessesPerSecond: 10000 },
    { key: 'offline_fast', label: 'Offline, fast hash (MD5/SHA1)', guessesPerSecond: 1e10 },
    { key: 'gpu_cluster', label: 'Large-scale GPU cluster', guessesPerSecond: 1e14 },
  ];

  const formatCrackTime = (seconds) => {
    if (!isFinite(seconds) || seconds < 0) return 'unknown';
    if (seconds < 1) return 'instantly';
    const units = [
      { limit: 60, div: 1, name: 'second' },
      { limit: 3600, div: 60, name: 'minute' },
      { limit: 86400, div: 3600, name: 'hour' },
      { limit: 2592000, div: 86400, name: 'day' },
      { limit: 31536000, div: 2592000, name: 'month' },
      { limit: 3153600000, div: 31536000, name: 'year' },
    ];
    for (let i = 0; i < units.length; i += 1) {
      if (seconds < units[i].limit) {
        const val = Math.round(seconds / units[i].div);
        return `${val} ${units[i].name}${val === 1 ? '' : 's'}`;
      }
    }
    const years = seconds / 31536000;
    if (years > 1e6) return 'centuries';
    return `${Math.round(years).toLocaleString()} years`;
  };

  const computeCrackTimes = (guesses) => SCENARIOS.map((s) => {
    const seconds = guesses / s.guessesPerSecond;
    return { label: s.label, humanTime: formatCrackTime(seconds) };
  });

  const naiveEntropyBits = (value, poolSize) => (poolSize > 0 ? value.length * Math.log2(poolSize) : 0);

  const scoreValue = (value, fallbackPoolSize) => {
    let guesses = Math.pow(fallbackPoolSize || 26, value.length);
    let zScore = null;
    if (typeof window.zxcvbn === 'function' && value) {
      try {
        const result = window.zxcvbn(value);
        guesses = result.guesses;
        zScore = result.score;
      } catch (e) { /* fall back to naive estimate */ }
    }
    const bits = guesses > 0 ? Math.log2(guesses) : 0;
    return { guesses, bits, zScore, crackTimes: computeCrackTimes(guesses) };
  };

  /* ---------------------------------------------------------------- */
  /* DOM binding                                                       */
  /* ---------------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);
  const els = {
    tabs: document.querySelectorAll('[data-pw-tab]'),
    panels: document.querySelectorAll('[data-pw-panel]'),
    output: $('pwOutput'),
    generateBtn: $('pwGenerateBtn'),
    copyBtn: $('pwCopyBtn'),
    qrBtn: $('pwQrBtn'),
    qrWrap: $('pwQrWrap'),
    qrCanvas: $('pwQrCanvas'),
    qrCloseBtn: $('pwQrCloseBtn'),

    // password tab
    pwLength: $('pwLength'),
    pwLengthRange: $('pwLengthRange'),
    pwLengthPresets: document.querySelectorAll('[data-pw-length-preset]'),
    pwUpper: $('pwUpper'),
    pwLower: $('pwLower'),
    pwNumbers: $('pwNumbers'),
    pwSymbols: $('pwSymbols'),
    pwExcludeSimilar: $('pwExcludeSimilar'),
    pwExcludeAmbiguous: $('pwExcludeAmbiguous'),
    pwNoRepeat: $('pwNoRepeat'),
    pwAvoidSequential: $('pwAvoidSequential'),
    pwCustomChars: $('pwCustomChars'),
    pwStartWith: $('pwStartWith'),
    pwEndWith: $('pwEndWith'),
    pwQuantity: $('pwQuantity'),
    pwGenerateBulkBtn: $('pwGenerateBulkBtn'),
    pwBulkList: $('pwBulkList'),
    pwBulkActions: $('pwBulkActions'),
    pwDownloadTxtBtn: $('pwDownloadTxtBtn'),
    pwDownloadCsvBtn: $('pwDownloadCsvBtn'),
    pwConstraintWarning: $('pwConstraintWarning'),

    // passphrase tab
    ppStyle: $('ppStyle'),
    ppWordCount: $('ppWordCount'),
    ppWordCountRange: $('ppWordCountRange'),
    ppSeparator: $('ppSeparator'),
    ppCapitalization: $('ppCapitalization'),
    ppIncludeNumber: $('ppIncludeNumber'),
    ppIncludeSymbol: $('ppIncludeSymbol'),
    ppMemorableFields: $('ppMemorableFields'),
    ppWordFields: $('ppWordFields'),
    ppMemorableLength: $('ppMemorableLength'),

    // pin tab
    pinLength: $('pinLength'),
    pinLengthRange: $('pinLengthRange'),
    pinNoRepeat: $('pinNoRepeat'),
    pinAvoidSequential: $('pinAvoidSequential'),
    pinAvoidCommon: $('pinAvoidCommon'),

    // api key tab
    apiFormat: $('apiFormat'),
    apiByteLength: $('apiByteLength'),
    apiPrefix: $('apiPrefix'),

    // wifi tab
    wifiEasyType: $('wifiEasyType'),
    wifiLength: $('wifiLength'),
    wifiLengthRange: $('wifiLengthRange'),

    // username tab
    userSeparator: $('userSeparator'),
    userCase: $('userCase'),
    userIncludeNumber: $('userIncludeNumber'),

    strengthLabel: $('pwStrengthLabel'),
    strengthMeter: $('pwStrengthMeter'),
    entropyValue: $('pwEntropyValue'),
    charCountValue: $('pwCharCountValue'),
    crackTimeList: $('pwCrackTimeList'),
    historyList: $('pwHistoryList'),
    historyClearBtn: $('pwHistoryClearBtn'),
    srStatus: $('pwSrStatus'),
    stickyBtn: $('pwStickyGenerateBtn'),
  };

  if (!els.output) return;

  let activeTab = 'password';
  let history = [];
  const HISTORY_MAX = 12;

  /* ---------------- messaging ---------------- */

  const announce = (msg) => { if (els.srStatus) els.srStatus.textContent = msg; };

  /* ---------------- strength meter ---------------- */

  const STRENGTH_LABELS = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const STRENGTH_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#10b981'];

  const updateStrengthDisplay = (value, poolSizeForFallback) => {
    if (!value) {
      if (els.strengthLabel) els.strengthLabel.textContent = '—';
      if (els.strengthMeter) { els.strengthMeter.style.width = '0%'; }
      if (els.entropyValue) els.entropyValue.textContent = '0 bits';
      if (els.charCountValue) els.charCountValue.textContent = '0';
      if (els.crackTimeList) els.crackTimeList.innerHTML = '';
      return;
    }
    const { bits, zScore, crackTimes } = scoreValue(value, poolSizeForFallback);
    const score = zScore !== null ? zScore : Math.min(4, Math.floor(bits / 20));
    if (els.strengthLabel) els.strengthLabel.textContent = STRENGTH_LABELS[score];
    if (els.strengthMeter) {
      els.strengthMeter.style.width = `${((score + 1) / 5) * 100}%`;
      els.strengthMeter.style.background = STRENGTH_COLORS[score];
    }
    if (els.entropyValue) els.entropyValue.textContent = `${bits.toFixed(1)} bits`;
    if (els.charCountValue) els.charCountValue.textContent = String(value.length);
    if (els.crackTimeList) {
      els.crackTimeList.innerHTML = crackTimes.map((c) => `<div class="pw-crack-row"><span>${c.label}</span><strong>${c.humanTime}</strong></div>`).join('');
    }
  };

  /* ---------------- history (in-memory only — never persisted) ------ */

  const pushHistory = (value, kind) => {
    history.unshift({ value, kind, ts: Date.now() });
    history = history.slice(0, HISTORY_MAX);
    renderHistory();
  };

  const renderHistory = () => {
    if (!els.historyList) return;
    if (!history.length) {
      els.historyList.innerHTML = '<li class="pw-history-empty">Nothing generated yet this session. History clears automatically on reload — it is never saved to disk.</li>';
      return;
    }
    els.historyList.innerHTML = '';
    history.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'pw-history-item';
      const safeValue = entry.value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      li.innerHTML = `<span class="pw-history-kind">${entry.kind}</span><code>${safeValue}</code><button type="button" class="pw-history-copy" aria-label="Copy this value">Copy</button>`;
      li.querySelector('.pw-history-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(entry.value); announce('Copied from history.'); } catch (e) { announce('Clipboard access failed.'); }
      });
      els.historyList.appendChild(li);
    });
  };

  if (els.historyClearBtn) {
    els.historyClearBtn.addEventListener('click', () => { history = []; renderHistory(); announce('History cleared.'); });
  }

  /* ---------------- tab switching ---------------- */

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((t) => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      activeTab = tab.getAttribute('data-pw-tab');
      els.panels.forEach((p) => { p.hidden = p.getAttribute('data-pw-panel') !== activeTab; });
      hideQr();
      runGenerate();
    });
  });

  /* ---------------- password length sync ---------------- */

  const syncLengthPresets = () => {
    const len = Number(els.pwLength?.value);
    els.pwLengthPresets.forEach((btn) => btn.classList.toggle('is-active', Number(btn.getAttribute('data-pw-length-preset')) === len));
  };

  const bindPair = (numberEl, rangeEl, onChange) => {
    if (!numberEl || !rangeEl) return;
    numberEl.addEventListener('input', () => { rangeEl.value = numberEl.value; onChange && onChange(); });
    rangeEl.addEventListener('input', () => { numberEl.value = rangeEl.value; onChange && onChange(); });
  };

  /* ---------------- constraint warning ---------------- */

  const showConstraintWarning = (satisfied) => {
    if (!els.pwConstraintWarning) return;
    els.pwConstraintWarning.hidden = satisfied;
  };

  /* ---------------- generation per tab ---------------- */

  const runGenerate = () => {
    if (activeTab === 'password') {
      const opts = {
        length: Number(els.pwLength?.value) || 20,
        upper: !!els.pwUpper?.checked,
        lower: !!els.pwLower?.checked,
        numbers: !!els.pwNumbers?.checked,
        symbols: !!els.pwSymbols?.checked,
        excludeSimilar: !!els.pwExcludeSimilar?.checked,
        excludeAmbiguous: !!els.pwExcludeAmbiguous?.checked,
        noRepeat: !!els.pwNoRepeat?.checked,
        avoidSequential: !!els.pwAvoidSequential?.checked,
        customChars: els.pwCustomChars?.value || '',
        startWith: els.pwStartWith?.value || '',
        endWith: els.pwEndWith?.value || '',
      };
      const result = generatePassword(opts);
      els.output.value = result.value;
      showConstraintWarning(result.satisfied);
      updateStrengthDisplay(result.value, 95);
      pushHistory(result.value, 'Password');
    } else if (activeTab === 'passphrase') {
      showConstraintWarning(true);
      if (els.ppStyle?.value === 'memorable') {
        const opts = { length: Number(els.ppMemorableLength?.value) || 12, capitalize: els.ppCapitalization?.value !== 'none', includeNumber: !!els.ppIncludeNumber?.checked, includeSymbol: !!els.ppIncludeSymbol?.checked };
        const result = generateMemorable(opts);
        els.output.value = result.value;
        updateStrengthDisplay(result.value, 26);
        pushHistory(result.value, 'Memorable');
      } else {
        const opts = { wordCount: Number(els.ppWordCount?.value) || 5, separator: els.ppSeparator?.value === 'space' ? ' ' : (els.ppSeparator?.value || '-'), capitalization: els.ppCapitalization?.value || 'first', includeNumber: !!els.ppIncludeNumber?.checked, includeSymbol: !!els.ppIncludeSymbol?.checked };
        const result = generatePassphrase(opts);
        els.output.value = result.value;
        updateStrengthDisplay(result.value, 26);
        pushHistory(result.value, 'Passphrase');
      }
    } else if (activeTab === 'pin') {
      const opts = { length: Number(els.pinLength?.value) || 6, noRepeat: !!els.pinNoRepeat?.checked, avoidSequential: !!els.pinAvoidSequential?.checked, avoidCommon: !!els.pinAvoidCommon?.checked };
      const result = generatePin(opts);
      els.output.value = result.value;
      showConstraintWarning(result.satisfied);
      updateStrengthDisplay(result.value, 10);
      pushHistory(result.value, 'PIN');
    } else if (activeTab === 'apikey') {
      showConstraintWarning(true);
      const opts = { format: els.apiFormat?.value || 'hex', byteLength: Number(els.apiByteLength?.value) || 32, prefix: els.apiPrefix?.value || '' };
      const result = generateApiKey(opts);
      els.output.value = result.value;
      if (els.entropyValue) els.entropyValue.textContent = `${result.bits} bits`;
      if (els.strengthLabel) els.strengthLabel.textContent = 'Very Strong';
      if (els.strengthMeter) { els.strengthMeter.style.width = '100%'; els.strengthMeter.style.background = STRENGTH_COLORS[4]; }
      if (els.charCountValue) els.charCountValue.textContent = String(result.value.length);
      if (els.crackTimeList) els.crackTimeList.innerHTML = '';
      pushHistory(result.value, 'API Key');
    } else if (activeTab === 'wifi') {
      showConstraintWarning(true);
      const easy = !!els.wifiEasyType?.checked;
      const opts = { length: Number(els.wifiLength?.value) || 20, upper: true, lower: true, numbers: true, symbols: true, excludeSimilar: easy, excludeAmbiguous: easy, noRepeat: false, avoidSequential: true, customChars: '', startWith: '', endWith: '' };
      const result = generatePassword(opts);
      els.output.value = result.value;
      updateStrengthDisplay(result.value, 95);
      pushHistory(result.value, 'Wi-Fi Password');
    } else if (activeTab === 'username') {
      showConstraintWarning(true);
      const sepMap = { none: '', dash: '-', underscore: '_', dot: '.' };
      const opts = { separator: sepMap[els.userSeparator?.value] ?? '', case: els.userCase?.value || 'title', includeNumber: !!els.userIncludeNumber?.checked };
      const result = generateUsername(opts);
      els.output.value = result.value;
      if (els.strengthLabel) els.strengthLabel.textContent = 'N/A';
      if (els.strengthMeter) { els.strengthMeter.style.width = '0%'; }
      if (els.entropyValue) els.entropyValue.textContent = '—';
      if (els.charCountValue) els.charCountValue.textContent = String(result.value.length);
      if (els.crackTimeList) els.crackTimeList.innerHTML = '<p class="pw-note">Usernames are identifiers, not secrets — crack-time estimates don\'t apply.</p>';
      pushHistory(result.value, 'Username');
    }
    hideQr();
  };

  /* ---------------- bulk generation ---------------- */

  const runBulk = () => {
    const qty = Math.min(200, Math.max(1, Number(els.pwQuantity?.value) || 10));
    const items = [];
    for (let i = 0; i < qty; i += 1) {
      const opts = {
        length: Number(els.pwLength?.value) || 20,
        upper: !!els.pwUpper?.checked,
        lower: !!els.pwLower?.checked,
        numbers: !!els.pwNumbers?.checked,
        symbols: !!els.pwSymbols?.checked,
        excludeSimilar: !!els.pwExcludeSimilar?.checked,
        excludeAmbiguous: !!els.pwExcludeAmbiguous?.checked,
        noRepeat: !!els.pwNoRepeat?.checked,
        avoidSequential: !!els.pwAvoidSequential?.checked,
        customChars: els.pwCustomChars?.value || '',
        startWith: els.pwStartWith?.value || '',
        endWith: els.pwEndWith?.value || '',
      };
      items.push(generatePassword(opts).value);
    }
    if (els.pwBulkList) {
      els.pwBulkList.innerHTML = items.map((pw, i) => `<li><code>${i + 1}. ${pw}</code></li>`).join('');
    }
    if (els.pwBulkActions) els.pwBulkActions.hidden = items.length === 0;
    lastBulk = items;
    announce(`Generated ${items.length} passwords.`);
  };
  let lastBulk = [];

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  els.pwDownloadTxtBtn?.addEventListener('click', () => {
    if (!lastBulk.length) return;
    downloadBlob(new Blob([lastBulk.join('\n')], { type: 'text/plain;charset=utf-8' }), 'tooladda-passwords.txt');
  });
  els.pwDownloadCsvBtn?.addEventListener('click', () => {
    if (!lastBulk.length) return;
    const csv = 'index,password\n' + lastBulk.map((pw, i) => `${i + 1},"${pw.replace(/"/g, '""')}"`).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'tooladda-passwords.csv');
  });
  els.pwGenerateBulkBtn?.addEventListener('click', runBulk);

  /* ---------------- QR export ---------------- */

  const hideQr = () => { if (els.qrWrap) els.qrWrap.hidden = true; };

  els.qrBtn?.addEventListener('click', () => {
    const value = els.output.value;
    if (!value || typeof window.qrcode !== 'function') return;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const modules = qr.getModuleCount();
      const scale = Math.max(4, Math.floor(220 / modules));
      const size = modules * scale;
      els.qrCanvas.width = size;
      els.qrCanvas.height = size;
      const ctx = els.qrCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#0f172a';
      for (let r = 0; r < modules; r += 1) {
        for (let c = 0; c < modules; c += 1) {
          if (qr.isDark(r, c)) ctx.fillRect(c * scale, r * scale, scale, scale);
        }
      }
      els.qrWrap.hidden = false;
      announce('QR code generated. Remember this encodes your value in plain sight — do not share the image.');
    } catch (e) { announce('Could not generate a QR code for this value.'); }
  });
  els.qrCloseBtn?.addEventListener('click', hideQr);

  /* ---------------- copy ---------------- */

  els.copyBtn?.addEventListener('click', async () => {
    if (!els.output.value) return;
    try {
      await navigator.clipboard.writeText(els.output.value);
      announce('Copied to clipboard.');
      els.copyBtn.textContent = '✓ Copied';
      setTimeout(() => { els.copyBtn.textContent = '📋 Copy'; }, 1400);
    } catch (e) { announce('Clipboard access blocked — copy manually.'); }
  });

  els.generateBtn?.addEventListener('click', runGenerate);
  els.stickyBtn?.addEventListener('click', () => {
    runGenerate();
    if (window.matchMedia('(max-width: 980px)').matches) {
      const target = els.output?.closest('.pw-output-box') || els.output;
      requestAnimationFrame(() => {
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  });

  /* ---------------- field bindings ---------------- */

  bindPair(els.pwLength, els.pwLengthRange, () => { syncLengthPresets(); runGenerate(); });
  els.pwLengthPresets.forEach((btn) => {
    btn.addEventListener('click', () => {
      const len = btn.getAttribute('data-pw-length-preset');
      if (els.pwLength) els.pwLength.value = len;
      if (els.pwLengthRange) els.pwLengthRange.value = len;
      syncLengthPresets();
      runGenerate();
    });
  });

  [els.pwUpper, els.pwLower, els.pwNumbers, els.pwSymbols, els.pwExcludeSimilar, els.pwExcludeAmbiguous, els.pwNoRepeat, els.pwAvoidSequential].forEach((el) => {
    el?.addEventListener('change', runGenerate);
  });
  [els.pwCustomChars, els.pwStartWith, els.pwEndWith].forEach((el) => {
    el?.addEventListener('input', () => runGenerate());
  });

  bindPair(els.ppWordCount, els.ppWordCountRange, runGenerate);
  [els.ppStyle, els.ppSeparator, els.ppCapitalization, els.ppMemorableLength].forEach((el) => el?.addEventListener('change', runGenerate));
  [els.ppIncludeNumber, els.ppIncludeSymbol].forEach((el) => el?.addEventListener('change', runGenerate));
  els.ppStyle?.addEventListener('change', () => {
    const isMemorable = els.ppStyle.value === 'memorable';
    if (els.ppMemorableFields) els.ppMemorableFields.hidden = !isMemorable;
    if (els.ppWordFields) els.ppWordFields.hidden = isMemorable;
  });

  bindPair(els.pinLength, els.pinLengthRange, runGenerate);
  [els.pinNoRepeat, els.pinAvoidSequential, els.pinAvoidCommon].forEach((el) => el?.addEventListener('change', runGenerate));

  [els.apiFormat, els.apiByteLength].forEach((el) => el?.addEventListener('change', runGenerate));
  els.apiPrefix?.addEventListener('input', runGenerate);

  els.wifiEasyType?.addEventListener('change', runGenerate);
  bindPair(els.wifiLength, els.wifiLengthRange, runGenerate);

  [els.userSeparator, els.userCase].forEach((el) => el?.addEventListener('change', runGenerate));
  els.userIncludeNumber?.addEventListener('change', runGenerate);

  /* ---------------- keyboard shortcuts ---------------- */

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); runGenerate(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); els.copyBtn?.click(); }
  });

  /* ---------------- settings persistence (non-sensitive only) ------- */

  const saveSettings = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        length: els.pwLength?.value, upper: els.pwUpper?.checked, lower: els.pwLower?.checked,
        numbers: els.pwNumbers?.checked, symbols: els.pwSymbols?.checked,
        excludeSimilar: els.pwExcludeSimilar?.checked, excludeAmbiguous: els.pwExcludeAmbiguous?.checked,
      }));
    } catch (e) { /* storage unavailable */ }
  };
  const loadSettings = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!saved) return;
      if (els.pwLength && saved.length) { els.pwLength.value = saved.length; if (els.pwLengthRange) els.pwLengthRange.value = saved.length; }
      if (els.pwUpper && saved.upper != null) els.pwUpper.checked = saved.upper;
      if (els.pwLower && saved.lower != null) els.pwLower.checked = saved.lower;
      if (els.pwNumbers && saved.numbers != null) els.pwNumbers.checked = saved.numbers;
      if (els.pwSymbols && saved.symbols != null) els.pwSymbols.checked = saved.symbols;
      if (els.pwExcludeSimilar && saved.excludeSimilar != null) els.pwExcludeSimilar.checked = saved.excludeSimilar;
      if (els.pwExcludeAmbiguous && saved.excludeAmbiguous != null) els.pwExcludeAmbiguous.checked = saved.excludeAmbiguous;
    } catch (e) { /* ignore invalid storage */ }
  };
  window.addEventListener('beforeunload', saveSettings);
  [els.pwLength, els.pwUpper, els.pwLower, els.pwNumbers, els.pwSymbols, els.pwExcludeSimilar, els.pwExcludeAmbiguous].forEach((el) => el?.addEventListener('change', saveSettings));

  /* ---------------- init ---------------- */

  loadSettings();
  syncLengthPresets();
  renderHistory();
  runGenerate();
})();
