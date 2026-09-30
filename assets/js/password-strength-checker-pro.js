/* ToolAdda — Password Strength Checker Pro engine.
   Vanilla JS. All analysis runs client-side via zxcvbn (vendored); nothing
   is transmitted, logged, or stored. This page intentionally loads no
   analytics — see isZeroTrackingPage() in app.js. */
(function () {
  'use strict';
  const root = document.body;
  if (!root || !root.hasAttribute('data-psc-pro')) return;

  const CHECK_DEBOUNCE_MS = 220;
  const WHATIF_DEBOUNCE_MS = 450;
  const WHATIF_MAX_LEN = 96;

  /* ================= Tabs ================= */
  const tabBtns = Array.from(document.querySelectorAll('[data-tab-btn]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab-btn');
      tabBtns.forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
      tabPanels.forEach((p) => p.classList.toggle('is-active', p.getAttribute('data-tab-panel') === target));
    });
  });

  /* ================= Crack-time model (verified independently in Node) ===== */
  const SCENARIOS = [
    { key: 'online_limited', label: 'Online, rate-limited', guessesPerSecond: 100 / 3600, note: 'a site with lockouts/throttling' },
    { key: 'online_unlimited', label: 'Online, no rate limit', guessesPerSecond: 10, note: 'a site with no throttling protection' },
    { key: 'offline_slow', label: 'Offline, slow hash (bcrypt/argon2)', guessesPerSecond: 10000, note: 'a leaked database hashed properly' },
    { key: 'offline_fast', label: 'Offline, fast hash (MD5/SHA1)', guessesPerSecond: 1e10, note: 'a leaked database hashed badly, cracked with GPUs' },
    { key: 'nation_state', label: 'Large-scale GPU cluster', guessesPerSecond: 1e14, note: 'a well-resourced attacker with massive compute' },
  ];
  function formatCrackTime(seconds) {
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
  }
  function computeCrackTimes(guesses) {
    return SCENARIOS.map((s) => {
      const seconds = guesses / s.guessesPerSecond;
      return { key: s.key, label: s.label, note: s.note, seconds, humanTime: formatCrackTime(seconds) };
    });
  }
  function computeCharsetSize(password) {
    let size = 0;
    if (/[a-z]/.test(password)) size += 26;
    if (/[A-Z]/.test(password)) size += 26;
    if (/[0-9]/.test(password)) size += 10;
    if (/[^a-zA-Z0-9]/.test(password)) size += 33;
    return size;
  }
  function computeNaiveEntropyBits(password) {
    const charsetSize = computeCharsetSize(password);
    if (charsetSize === 0 || password.length === 0) return 0;
    return password.length * Math.log2(charsetSize);
  }
  function computeGuessesEntropyBits(guesses) { return guesses > 0 ? Math.log2(guesses) : 0; }

  /* ================= Unicode awareness ================= */
  // password.length counts UTF-16 code units, so an emoji or other astral
  // character silently counts as 2 — Array.from iterates by code point
  // instead, giving the count a person actually perceives when they typed it.
  function graphemeCount(str) { return Array.from(str).length; }
  function hasNonAscii(str) { return /[^\x00-\x7F]/.test(str); }

  /* ================= India-specific weak pattern detection ================= */
  const INDIA_NAMES = ['rahul', 'amit', 'raj', 'sunil', 'vijay', 'ravi', 'suresh', 'ramesh', 'sanjay', 'anil', 'deepak', 'ankit', 'rohit', 'vikas', 'manoj', 'priya', 'pooja', 'neha', 'anita', 'sunita', 'kavita', 'sneha', 'divya', 'shreya', 'aarti', 'kumar', 'singh', 'sharma', 'verma', 'gupta', 'patel', 'reddy', 'yadav', 'khan', 'mishra', 'chauhan', 'agarwal', 'jain', 'nair'];
  const INDIA_CITIES = ['delhi', 'mumbai', 'bangalore', 'bengaluru', 'chennai', 'kolkata', 'hyderabad', 'pune', 'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore', 'bhopal', 'patna', 'surat', 'ahmedabad'];
  const CRICKET_TERMS = ['dhoni', 'kohli', 'sachin', 'tendulkar', 'virat', 'rohit', 'ipl', 'cricket', 'bcci', 'sixer', 'wicket'];
  const BOLLYWOOD_NAMES = ['shahrukh', 'srk', 'salman', 'amitabh', 'deepika', 'akshay', 'hrithik', 'aamir', 'katrina', 'priyanka', 'alia', 'ranbir'];
  const HINDI_WORDS_ROMAN = ['pyar', 'pyaar', 'dosti', 'bhai', 'jaan', 'dil', 'yaar', 'dost', 'mast', 'zindagi'];
  const GENERIC_INDIA_PATTERNS = ['india123', 'india@123', 'indian123', 'jaihind', 'bharat123'];
  const INDIA_SCAN = (() => {
    const rows = [];
    const add = (list, category) => { list.forEach((word) => rows.push({ word, category })); };
    add(INDIA_NAMES, 'Common Indian name');
    add(INDIA_CITIES, 'Indian city name');
    add(CRICKET_TERMS, 'Cricket-related term');
    add(BOLLYWOOD_NAMES, 'Bollywood celebrity name');
    add(HINDI_WORDS_ROMAN, 'Common Hindi word (Roman script)');
    add(GENERIC_INDIA_PATTERNS, 'Generic India-themed pattern');
    return rows;
  })();
  function checkIndiaSpecificWeaknesses(password) {
    const lower = password.toLowerCase();
    const findings = [];
    for (let i = 0; i < INDIA_SCAN.length; i += 1) {
      const { word, category } = INDIA_SCAN[i];
      if (lower.includes(word)) findings.push({ category, matched: word });
    }
    const mobileMatch = /(?:[987]\d{9})/.exec(password);
    if (mobileMatch) findings.push({ category: 'Indian mobile number pattern', matched: mobileMatch[0] });
    return findings;
  }

  /* ================= Offline common/breached-password check ================= */
  // A curated, well-publicized list of the most common passwords found in
  // breach dumps (NordPass/SplashData-style annual "worst passwords" lists —
  // public knowledge, not proprietary breach data). Checked entirely locally;
  // this is NOT a live Have I Been Pwned query, so it can't catch every
  // breached password, but it never makes a network request either.
  const COMMON_BREACHED_PASSWORDS = new Set(['123456', '123456789', 'qwerty', 'password', '12345', 'qwerty123', '1q2w3e', '12345678', '111111', '1234567890', '1234567', 'password1', '123123', 'abc123', '1234', 'iloveyou', '000000', 'zaq1zaq1', 'dragon', 'sunshine', 'princess', 'letmein', 'monkey', 'football', 'shadow', 'master', '666666', 'qwertyuiop', '123321', 'mustang', '121212', 'starwars', '555555', 'freedom', 'whatever', 'qazwsx', 'trustno1', 'superman', 'hannah', 'hunter', 'joshua', 'maggie', 'password123', 'admin', 'welcome', 'login', 'access', 'passw0rd', 'p@ssw0rd', 'changeme', 'default', 'test', 'guest', 'root', 'asdf', 'asdfgh', 'zxcvbn', 'zxcvbnm', '1qaz2wsx', 'baseball', 'basketball', 'jordan', 'cheese', 'jennifer', 'jessica', 'michelle', 'daniel', 'george', 'computer', 'internet', 'service', 'canada', 'hockey', 'ranger', 'buster', 'soccer', 'harley', 'thomas', 'robert', 'andrew', 'charlie', 'ginger', 'nicole', 'chelsea', 'biteme', 'matthew', 'access14', 'yankees', '987654321', 'dallas', 'austin', 'thunder', 'taylor', 'matrix', 'mobilemail', 'monitor', 'monitoring', 'montana', 'moon', 'moscow', 'mother', 'movie', 'mozilla', 'music', 'mustang1', 'password!', 'password1234', 'p@55word', 'p@ssword', 'qwerty1', 'qwerty12', 'welcome1', 'welcome123', 'letmein123', 'iloveyou1', 'sunshine1', 'princess1', 'football1', 'baseball1', 'dragon1', 'master123', 'shadow1', 'michael', 'jordan23', 'liverpool', 'chelsea1', 'arsenal', 'manutd', 'blink182', 'fuckyou', 'batman', 'spiderman', 'ironman', 'pokemon', 'minecraft', 'fortnite', 'freedom1', 'summer', 'winter', 'autumn123', 'spring123', 'january', 'february', 'trustno1!', 'letme1n', '1234qwer', 'qwe123', 'q1w2e3r4', 'admin123', 'root123', 'guest123', 'test123', 'user123', 'temp123', 'temppass', 'changeme123', 'newpassword', 'mypassword', 'passw0rd1', 'passw0rd!']);
  function checkBreachedPassword(password) {
    const lower = password.toLowerCase().trim();
    return COMMON_BREACHED_PASSWORDS.has(lower);
  }

  /* ================= Pattern segment highlighting ================= */
  function buildPatternSegments(password, zxcvbnSequence) {
    const segments = [];
    let pos = 0;
    (zxcvbnSequence || []).forEach((match) => {
      if (match.i > pos) segments.push({ text: password.slice(pos, match.i), pattern: null });
      segments.push({ text: password.slice(match.i, match.j + 1), pattern: match.pattern, guesses: match.guesses });
      pos = match.j + 1;
    });
    if (pos < password.length) segments.push({ text: password.slice(pos), pattern: null });
    return segments;
  }

  /* ================= Cryptographically secure, unbiased RNG =================
     Naive `randomUint32 % max` is biased toward small remainders unless max
     evenly divides 2^32. Reject any draw above the largest multiple of max
     that fits in 2^32 so every outcome stays equally likely. */
  function secureRandomInt(max) {
    if (max <= 0) return 0;
    if (max === 1) return 0;
    const CEILING = 4294967296; // 2^32
    const limit = CEILING - (CEILING % max);
    const arr = new Uint32Array(1);
    let val;
    do {
      crypto.getRandomValues(arr);
      val = arr[0];
    } while (val >= limit);
    return val % max;
  }

  const AMBIGUOUS_CHARS = 'l1IoO0';
  function generatePassword(opts) {
    const lowers = 'abcdefghijklmnopqrstuvwxyz', uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits = '0123456789', symbols = '!@#$%^&*()-_=+[]{};:,.<>?';
    let pool = '';
    if (opts.lowercase) pool += lowers;
    if (opts.uppercase) pool += uppers;
    if (opts.digits) pool += digits;
    if (opts.symbols) pool += symbols;
    if (opts.excludeAmbiguous) pool = pool.split('').filter((c) => AMBIGUOUS_CHARS.indexOf(c) === -1).join('');
    if (!pool.length) throw new Error('At least one character type must be selected.');
    let out = '';
    for (let i = 0; i < opts.length; i += 1) out += pool[secureRandomInt(pool.length)];
    return out;
  }
  const CONSONANTS = 'bcdfghjklmnpqrstvwxyz', VOWELS = 'aeiou';
  function generatePronounceable(length) {
    let out = '', useConsonant = true;
    for (let i = 0; i < length; i += 1) {
      const set = useConsonant ? CONSONANTS : VOWELS;
      out += set[secureRandomInt(set.length)];
      useConsonant = !useConsonant;
    }
    return out;
  }
  function generatePassphrase(wordList, opts) {
    const words = [];
    for (let i = 0; i < opts.wordCount; i += 1) {
      let w = wordList[secureRandomInt(wordList.length)];
      if (opts.capitalize) w = w.charAt(0).toUpperCase() + w.slice(1);
      words.push(w);
    }
    let phrase = words.join(opts.separator || '-');
    if (opts.appendNumber) phrase += (opts.separator || '-') + secureRandomInt(100);
    return phrase;
  }

  const WORDLIST = ['accordion', 'airport', 'alley', 'alligator', 'amber', 'anchor', 'ant', 'apple', 'apricot', 'archery', 'arm', 'attic', 'autumn', 'avenue', 'back', 'backpack', 'bacon', 'badger', 'bag', 'balcony', 'balloon', 'banana', 'banjo', 'bark', 'barley', 'barn', 'barrel', 'basement', 'basket', 'bass', 'bat', 'bay', 'beach', 'bear', 'beaver', 'bed', 'bee', 'beef', 'beetle', 'beige', 'bicycle', 'bird', 'black', 'blackberry', 'blanket', 'blender', 'blossom', 'blue', 'blueberry', 'boat', 'bold', 'bolt', 'bone', 'bottle', 'boulevard', 'bowl', 'box', 'boxing', 'brain', 'branch', 'brave', 'bread', 'breeze', 'bridge', 'bright', 'broccoli', 'bronze', 'brook', 'broom', 'brown', 'bucket', 'buckle', 'bulb', 'burger', 'burrito', 'bus', 'bush', 'butter', 'butterfly', 'button', 'cabbage', 'cabinet', 'cable', 'cake', 'calm', 'camel', 'camera', 'camping', 'can', 'candle', 'candy', 'canoe', 'canyon', 'car', 'caramel', 'carnival', 'carp', 'carpet', 'carrot', 'castle', 'cat', 'cave', 'cavern', 'celery', 'cello', 'century', 'chain', 'chair', 'chameleon', 'checkers', 'cheese', 'cherry', 'chess', 'chest', 'chicken', 'chimney', 'chipmunk', 'chocolate', 'cinnamon', 'city', 'clam', 'clarinet', 'clean', 'clever', 'cliff', 'climbing', 'clock', 'closed', 'closet', 'cloud', 'coast', 'coconut', 'cod', 'cold', 'common', 'compass', 'complex', 'cookie', 'cool', 'copper', 'coral', 'corn', 'couch', 'county', 'courtyard', 'crab', 'crane', 'crate', 'cream', 'creek', 'cricket', 'crimson', 'crocodile', 'crow', 'cuckoo', 'cup', 'current', 'curry', 'curtain', 'cyan', 'cycling', 'dance', 'dark', 'date', 'dawn', 'decade', 'deep', 'deer', 'delta', 'desert', 'dew', 'dirty', 'discus', 'diving', 'dog', 'dolphin', 'door', 'dove', 'dragonfly', 'drawer', 'driveway', 'drum', 'duck', 'dune', 'dusk', 'eager', 'eagle', 'ear', 'easy', 'eel', 'egg', 'elbow', 'empire', 'empty', 'epoch', 'era', 'estuary', 'evening', 'eye', 'fair', 'falcon', 'farm', 'fast', 'fence', 'fencing', 'festival', 'field', 'fig', 'finch', 'finger', 'fish', 'fishing', 'flamingo', 'flashlight', 'flower', 'flute', 'fly', 'fog', 'foot', 'forest', 'fork', 'fountain', 'fox', 'frame', 'fresh', 'fridge', 'frog', 'frost', 'full', 'gale', 'garage', 'garden', 'garlic', 'gate', 'gecko', 'gentle', 'ginger', 'glacier', 'glider', 'globe', 'goat', 'gold', 'golf', 'gopher', 'grape', 'grass', 'gray', 'green', 'grotto', 'guitar', 'gulf', 'gull', 'hail', 'hair', 'hallway', 'hammer', 'hand', 'happy', 'harbor', 'hard', 'harmonica', 'harp', 'hawk', 'heart', 'heavy', 'hedgehog', 'helicopter', 'hen', 'heron', 'highway', 'hiking', 'hill', 'hockey', 'holiday', 'honest', 'honey', 'hope', 'horse', 'hot', 'hour', 'humble', 'hummingbird', 'hunting', 'hurdle', 'ice', 'iceberg', 'iguana', 'indigo', 'instant', 'iron', 'island', 'ivory', 'jar', 'javelin', 'jellyfish', 'jet', 'jogging', 'joy', 'judo', 'jungle', 'karate', 'kayak', 'keen', 'kettle', 'kidney', 'kind', 'kingdom', 'kiwi', 'knee', 'knife', 'koala', 'ladder', 'lake', 'lamb', 'lamp', 'lantern', 'leaf', 'leg', 'lemon', 'lens', 'lettuce', 'light', 'lighthouse', 'lightning', 'lime', 'lion', 'liver', 'lizard', 'llama', 'lobster', 'loud', 'love', 'loyal', 'lung', 'magpie', 'mango', 'marathon', 'market', 'maroon', 'marsh', 'meadow', 'melon', 'microscope', 'midnight', 'milk', 'mint', 'minute', 'mirror', 'mist', 'modern', 'mole', 'moment', 'month', 'monument', 'mop', 'morning', 'moth', 'motorcycle', 'mountain', 'mouse', 'mouth', 'muffin', 'mug', 'mule', 'muscle', 'nail', 'narrow', 'nation', 'navy', 'neck', 'nectarine', 'needle', 'newt', 'noodle', 'noon', 'nose', 'oasis', 'oat', 'ocean', 'octopus', 'olive', 'onion', 'open', 'orange', 'orchard', 'organ', 'otter', 'oven', 'owl', 'ox', 'painting', 'palace', 'pan', 'pancake', 'panda', 'papaya', 'parade', 'parrot', 'pasta', 'peach', 'peacock', 'pear', 'pelican', 'penguin', 'peninsula', 'pepper', 'petal', 'piano', 'pie', 'pig', 'pigeon', 'pike', 'pillow', 'pineapple', 'pink', 'pizza', 'plain', 'plane', 'plant', 'plate', 'plateau', 'plum', 'pond', 'poor', 'porch', 'pork', 'porpoise', 'possum', 'pot', 'potato', 'pouch', 'prairie', 'pride', 'proud', 'puffin', 'pumpkin', 'purple', 'purse', 'puzzle', 'quick', 'quiet', 'rabbit', 'raccoon', 'rainbow', 'rainforest', 'rake', 'ranch', 'rare', 'raspberry', 'raven', 'red', 'reef', 'region', 'relay', 'rice', 'rich', 'river', 'roast', 'robin', 'rocket', 'rooftop', 'rooster', 'root', 'rope', 'rough', 'rowing', 'rugby', 'running', 'sailing', 'salad', 'salmon', 'salt', 'sandwich', 'sausage', 'saxophone', 'scarlet', 'scissors', 'scooter', 'scorpion', 'screw', 'screwdriver', 'seal', 'season', 'second', 'seed', 'shallow', 'shark', 'sharp', 'sheep', 'shelf', 'ship', 'shore', 'short', 'shoulder', 'shovel', 'shrimp', 'shrub', 'sidewalk', 'silo', 'silver', 'simple', 'skating', 'skiing', 'skin', 'skunk', 'sled', 'sleigh', 'slow', 'smooth', 'snake', 'snow', 'soccer', 'sofa', 'soft', 'soup', 'sparrow', 'spider', 'spinach', 'spoon', 'spring', 'sprint', 'sprout', 'squid', 'squirrel', 'staircase', 'stale', 'station', 'statue', 'steak', 'stem', 'stew', 'stork', 'storm', 'stove', 'strait', 'strawberry', 'stream', 'strong', 'submarine', 'sugar', 'suitcase', 'summer', 'sunrise', 'sunset', 'surfing', 'sushi', 'swamp', 'swan', 'swift', 'swimming', 'table', 'taco', 'tall', 'tambourine', 'tame', 'tan', 'tart', 'teal', 'telescope', 'tennis', 'thick', 'thin', 'thorn', 'thread', 'thunder', 'tide', 'tiger', 'toast', 'toaster', 'today', 'toe', 'tomorrow', 'tongue', 'tooth', 'torch', 'tortoise', 'town', 'tractor', 'train', 'tree', 'triathlon', 'trombone', 'trout', 'truck', 'trumpet', 'trunk', 'tuna', 'tundra', 'tunnel', 'turkey', 'turtle', 'twilight', 'umbrella', 'vacuum', 'valley', 'van', 'vanilla', 'vase', 'village', 'vineyard', 'violet', 'violin', 'volcano', 'vulture', 'waffle', 'wagon', 'wallet', 'walrus', 'warm', 'watch', 'waterfall', 'wave', 'weak', 'week', 'whale', 'wheat', 'white', 'wide', 'wild', 'wind', 'windmill', 'window', 'winter', 'wire', 'wise', 'wolf', 'woodpecker', 'wrench', 'wrestling', 'xylophone', 'year', 'yellow', 'yesterday', 'yoga', 'yogurt', 'young', 'zebra', 'zipper'];

  const SCORE_LABELS = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const SCORE_COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];

  function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ================= Toast (used for clipboard-clear reminder) ================= */
  const toastEl = document.getElementById('pscToast');
  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3600);
  }
  function copyToClipboard(value) {
    if (!value) return Promise.resolve(false);
    return (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(value) : Promise.reject())
      .then(() => { showToast('📋 Copied — remember to clear your clipboard once you’ve pasted it elsewhere; other apps on some systems can read clipboard contents.'); return true; })
      .catch(() => { showToast('Clipboard access was blocked — copy manually.'); return false; });
  }

  /* ================= Checker tab ================= */
  const pwInput = document.getElementById('pscPasswordInput');
  const toggleVisBtn = document.querySelector('[data-toggle-visibility]');
  const meterWrap = document.getElementById('pscMeterWrap');
  const lengthHint = document.getElementById('pscLengthHint');
  const meterLabel = document.getElementById('pscMeterLabel');
  const scenarioGrid = document.getElementById('pscScenarioGrid');
  const segmentBox = document.getElementById('pscSegmentBox');
  const indiaFindingsEl = document.getElementById('pscIndiaFindings');
  const breachedWarningEl = document.getElementById('pscBreachedWarning');
  const suggestionsEl = document.getElementById('pscSuggestions');
  const whatIfEl = document.getElementById('pscWhatIf');
  const unicodeStatEl = document.getElementById('pscStatUnicode');

  if (toggleVisBtn && pwInput) {
    toggleVisBtn.addEventListener('click', () => {
      const showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
      toggleVisBtn.textContent = showing ? '👁️' : '🙈';
      toggleVisBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  }

  function renderScenarios(container, guesses) {
    const html = computeCrackTimes(guesses).map((s) =>
      `<div class="psc-scenario-card"><div class="psc-sc-label">${s.label}</div><div class="psc-sc-time">${s.humanTime}</div><div class="psc-sc-note">${s.note}</div></div>`
    ).join('');
    container.innerHTML = html;
  }

  let debounceTimer = null;
  let whatIfTimer = null;
  let whatIfToken = 0;
  let lastCheckedPw = '';

  if (pwInput) {
    pwInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runChecker, CHECK_DEBOUNCE_MS);
    });
  }

  function runChecker() {
    const pw = pwInput.value;
    if (pw === lastCheckedPw) return;
    lastCheckedPw = pw;

    const chars = graphemeCount(pw);
    lengthHint.textContent = `${chars} character${chars === 1 ? '' : 's'}`;
    clearTimeout(whatIfTimer);
    whatIfToken += 1;
    if (!pw) {
      meterWrap.style.display = 'none';
      if (whatIfEl) whatIfEl.innerHTML = '';
      return;
    }
    meterWrap.style.display = '';

    const result = window.zxcvbn(pw);
    const score = result.score;

    Array.from(document.querySelectorAll('.psc-meter-seg')).forEach((seg, i) => {
      seg.className = `psc-meter-seg${i <= score ? ` is-filled-${score}` : ''}`;
    });
    meterLabel.textContent = SCORE_LABELS[score];
    meterLabel.style.color = SCORE_COLORS[score];

    renderScenarios(scenarioGrid, result.guesses);

    const segments = buildPatternSegments(pw, result.sequence);
    segmentBox.innerHTML = segments.map((seg) => {
      const label = seg.pattern ? ` title="${seg.pattern}${seg.guesses ? `, guesses: ${Math.round(seg.guesses).toLocaleString()}` : ''}"` : '';
      return `<span class="psc-seg" data-pattern="${seg.pattern || 'bruteforce'}"${label}>${escapeHtml(seg.text)}</span>`;
    }).join('');

    if (score < 4) {
      const india = checkIndiaSpecificWeaknesses(pw);
      indiaFindingsEl.innerHTML = india.length ? (`<div class="psc-finding-list">${india.map((f) => `<div class="psc-finding-item">🇮🇳 ${f.category} detected: "${escapeHtml(f.matched)}" — this is a common guess in India-specific wordlists that generic checkers often miss.</div>`).join('')}</div>`) : '';
    } else {
      indiaFindingsEl.innerHTML = '';
    }

    if (breachedWarningEl) {
      breachedWarningEl.innerHTML = checkBreachedPassword(pw)
        ? '<div class="psc-finding-list"><div class="psc-finding-item">🚨 This is one of the most common passwords found in real-world breach dumps — it would be tried in the first few seconds of any credential-stuffing attack, regardless of what this page\'s score says.</div></div>'
        : '';
    }

    let suggestionsHtml = '';
    if (result.feedback.warning) suggestionsHtml += `<div class="psc-suggestion-item">⚠️ ${escapeHtml(result.feedback.warning)}</div>`;
    (result.feedback.suggestions || []).forEach((s) => { suggestionsHtml += `<div class="psc-suggestion-item">💡 ${escapeHtml(s)}</div>`; });
    suggestionsEl.innerHTML = suggestionsHtml;

    document.getElementById('pscStatLength').textContent = String(chars);
    document.getElementById('pscStatCharset').textContent = String(computeCharsetSize(pw));
    document.getElementById('pscStatEntropy').textContent = `${computeGuessesEntropyBits(result.guesses).toFixed(1)} bits`;
    document.getElementById('pscStatNaiveEntropy').textContent = `${computeNaiveEntropyBits(pw).toFixed(1)} bits`;
    if (unicodeStatEl) unicodeStatEl.textContent = hasNonAscii(pw) ? 'Yes' : 'No';

    scheduleWhatIf(pw, result, whatIfToken);
  }

  function scheduleWhatIf(pw, result, token) {
    if (!whatIfEl) return;
    if (pw.length > WHATIF_MAX_LEN || result.score >= 4) {
      whatIfEl.innerHTML = pw.length > WHATIF_MAX_LEN
        ? '<p class="psc-hint">“What if” comparisons are skipped for very long passwords to keep analysis fast.</p>'
        : '';
      return;
    }
    whatIfEl.innerHTML = '';
    clearTimeout(whatIfTimer);
    whatIfTimer = setTimeout(() => {
      const run = () => {
        if (token !== whatIfToken || pwInput.value !== pw) return;
        renderWhatIf(pw, result);
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 900 });
      else run();
    }, WHATIF_DEBOUNCE_MS);
  }

  function renderWhatIf(pw, result) {
    const rows = [];
    rows.push({ label: 'Add 2 random characters', pw: `${pw}Xk` });
    rows.push({ label: 'Add one symbol at the end', pw: `${pw}!` });
    const dictMatch = (result.sequence || []).find((m) => m.pattern === 'dictionary');
    if (dictMatch) {
      const withoutDict = pw.slice(0, dictMatch.i) + pw.slice(dictMatch.j + 1);
      if (withoutDict) rows.push({ label: `Remove the dictionary word "${pw.slice(dictMatch.i, dictMatch.j + 1)}"`, pw: withoutDict });
    }
    const baseOfflineFast = computeCrackTimes(result.guesses).find((s) => s.key === 'offline_fast');
    const parts = [];
    rows.forEach((r) => {
      const rResult = window.zxcvbn(r.pw);
      const rTime = computeCrackTimes(rResult.guesses).find((s) => s.key === 'offline_fast');
      parts.push(`<div class="psc-whatif-row"><span>${escapeHtml(r.label)}</span><span>${baseOfflineFast.humanTime} → <strong>${rTime.humanTime}</strong></span></div>`);
    });
    whatIfEl.innerHTML = parts.join('');
  }

  /* ================= Generator tab ================= */
  const pgLength = document.getElementById('pgLength'), pgLengthVal = document.getElementById('pgLengthVal');
  if (pgLength) pgLength.addEventListener('input', () => { pgLengthVal.textContent = pgLength.value; });
  const pgGenerateBtn = document.getElementById('pgGenerateBtn');
  if (pgGenerateBtn) {
    pgGenerateBtn.addEventListener('click', () => {
      const pronounceable = document.getElementById('pgPronounceable').checked;
      const pw = pronounceable
        ? generatePronounceable(parseInt(pgLength.value, 10))
        : generatePassword({
          length: parseInt(pgLength.value, 10),
          uppercase: document.getElementById('pgUpper').checked,
          lowercase: document.getElementById('pgLower').checked,
          digits: document.getElementById('pgDigits').checked,
          symbols: document.getElementById('pgSymbols').checked,
          excludeAmbiguous: document.getElementById('pgExcludeAmbiguous').checked,
        });
      document.getElementById('pgOutput').value = pw;
      const result = window.zxcvbn(pw);
      const wrap = document.getElementById('pgStrengthWrap');
      wrap.innerHTML = `<p class="psc-hint">Strength: <strong style="color:${SCORE_COLORS[result.score]};">${SCORE_LABELS[result.score]}</strong> — offline-fast crack time: ${computeCrackTimes(result.guesses).find((s) => s.key === 'offline_fast').humanTime}</p>`;
    });
  }
  const pgCopyBtn = document.getElementById('pgCopyBtn');
  if (pgCopyBtn) pgCopyBtn.addEventListener('click', () => copyToClipboard(document.getElementById('pgOutput').value));

  /* ================= Passphrase tab ================= */
  const ppCount = document.getElementById('ppCount'), ppCountVal = document.getElementById('ppCountVal');
  if (ppCount) ppCount.addEventListener('input', () => { ppCountVal.textContent = ppCount.value; });
  const ppGenerateBtn = document.getElementById('ppGenerateBtn');
  if (ppGenerateBtn) {
    ppGenerateBtn.addEventListener('click', () => {
      const phrase = generatePassphrase(WORDLIST, {
        wordCount: parseInt(ppCount.value, 10),
        separator: document.getElementById('ppSeparator').value,
        capitalize: document.getElementById('ppCapitalize').checked,
        appendNumber: document.getElementById('ppAppendNumber').checked,
      });
      document.getElementById('ppOutput').value = phrase;
      const result = window.zxcvbn(phrase);
      const wrap = document.getElementById('ppStrengthWrap');
      wrap.innerHTML = `<p class="psc-hint">Strength: <strong style="color:${SCORE_COLORS[result.score]};">${SCORE_LABELS[result.score]}</strong> — offline-fast crack time: ${computeCrackTimes(result.guesses).find((s) => s.key === 'offline_fast').humanTime}</p>`;

      const mangled = 'P@ssw0rd1!';
      const mangledResult = window.zxcvbn(mangled);
      const compEl = document.getElementById('ppComparison');
      compEl.innerHTML = `<div class="psc-scenario-grid">
        <div class="psc-scenario-card"><div class="psc-sc-label">Your passphrase</div><div class="psc-sc-time">${computeCrackTimes(result.guesses).find((s) => s.key === 'offline_fast').humanTime}</div><div class="psc-sc-note">offline fast-hash scenario</div></div>
        <div class="psc-scenario-card"><div class="psc-sc-label">"${mangled}" (a typical mangled password)</div><div class="psc-sc-time">${computeCrackTimes(mangledResult.guesses).find((s) => s.key === 'offline_fast').humanTime}</div><div class="psc-sc-note">offline fast-hash scenario</div></div>
      </div>`;
    });
  }
  const ppCopyBtn = document.getElementById('ppCopyBtn');
  if (ppCopyBtn) ppCopyBtn.addEventListener('click', () => copyToClipboard(document.getElementById('ppOutput').value));

  /* ================= Bulk / comparison tab ================= */
  let bulkResults = [];
  const bulkCheckBtn = document.getElementById('pscBulkCheckBtn');
  if (bulkCheckBtn) {
    bulkCheckBtn.addEventListener('click', () => {
      const lines = document.getElementById('pscBulkInput').value.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length);
      bulkResults = lines.map((pw) => {
        const result = window.zxcvbn(pw);
        const topIssue = result.feedback.warning || (result.feedback.suggestions && result.feedback.suggestions[0]) || (checkBreachedPassword(pw) ? 'Found in common breached-password list' : '—');
        return { password: pw, score: result.score, guesses: result.guesses, topIssue };
      });
      const tbody = document.getElementById('pscBulkTbody');
      tbody.innerHTML = bulkResults.map((r, i) => {
        const offlineFast = computeCrackTimes(r.guesses).find((s) => s.key === 'offline_fast');
        return `<tr><td>${i + 1}</td><td style="font-family:monospace;">${escapeHtml(r.password)}</td><td><span class="psc-score-pill" style="background:${SCORE_COLORS[r.score]};">${SCORE_LABELS[r.score]}</span></td><td>${offlineFast.humanTime}</td><td>${escapeHtml(r.topIssue)}</td></tr>`;
      }).join('');
      document.getElementById('pscBulkTable').style.display = bulkResults.length ? '' : 'none';
      if (bulkResults.length > 1) {
        const weakest = bulkResults.reduce((a, b) => (b.score < a.score ? b : a));
        const strongest = bulkResults.reduce((a, b) => (b.score > a.score ? b : a));
        const compareEl = document.getElementById('pscBulkCompare');
        if (compareEl) {
          compareEl.hidden = false;
          compareEl.innerHTML = `<p class="psc-hint">Weakest: <strong style="color:${SCORE_COLORS[weakest.score]};">${escapeHtml(weakest.password)}</strong> (${SCORE_LABELS[weakest.score]}) · Strongest: <strong style="color:${SCORE_COLORS[strongest.score]};">${escapeHtml(strongest.password)}</strong> (${SCORE_LABELS[strongest.score]})</p>`;
        }
      }
    });
  }
  const bulkClearBtn = document.getElementById('pscBulkClearBtn');
  if (bulkClearBtn) {
    bulkClearBtn.addEventListener('click', () => {
      document.getElementById('pscBulkInput').value = '';
      bulkResults = [];
      document.getElementById('pscBulkTable').style.display = 'none';
      const compareEl = document.getElementById('pscBulkCompare');
      if (compareEl) compareEl.hidden = true;
    });
  }
  const bulkExportBtn = document.getElementById('pscBulkExportBtn');
  if (bulkExportBtn) {
    bulkExportBtn.addEventListener('click', () => {
      if (!bulkResults.length) return;
      const rows = [['password', 'score', 'score_label', 'offline_fast_crack_time']];
      bulkResults.forEach((r) => {
        const offlineFast = computeCrackTimes(r.guesses).find((s) => s.key === 'offline_fast');
        rows.push([r.password, String(r.score), SCORE_LABELS[r.score], offlineFast.humanTime]);
      });
      const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'password-bulk-check.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
})();
