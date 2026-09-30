(function () {
  'use strict';

  const page = document.querySelector('[data-shortener]');
  if (!page) {
    return;
  }

  const form = page.querySelector('[data-form]');
  const urlInput = page.querySelector('[data-url]');
  const aliasToggle = page.querySelector('[data-alias-toggle]');
  const aliasRow = page.querySelector('[data-alias-row]');
  const aliasInput = page.querySelector('[data-alias]');
  const submitBtn = page.querySelector('[data-submit]');
  const messageBox = page.querySelector('[data-message]');
  const loader = page.querySelector('[data-loader]');

  const resultCard = page.querySelector('[data-result]');
  const resultShort = page.querySelector('[data-result-short]');
  const resultOriginal = page.querySelector('[data-result-original]');
  const copyBtn = page.querySelector('[data-copy]');
  const openLink = page.querySelector('[data-open]');
  const downloadQr = page.querySelector('[data-download-qr]');
  const qrCanvas = page.querySelector('[data-qr]');

  const recentList = page.querySelector('[data-recent]');
  const recentEmpty = page.querySelector('[data-recent-empty]');

  const STORAGE_KEY = 'tooladda-short-links';
  const MAX_RECENT = 8;

  /* ---------- helpers ---------- */
  const showMessage = (text, type) => {
    messageBox.textContent = text;
    messageBox.classList.remove('hidden', 'success', 'error');
    messageBox.classList.add(type === 'error' ? 'error' : 'success');
  };
  const clearMessage = () => {
    messageBox.textContent = '';
    messageBox.classList.add('hidden');
    messageBox.classList.remove('success', 'error');
  };
  const toggleLoader = (on) => {
    loader.classList.toggle('hidden', !on);
    submitBtn.disabled = on;
    submitBtn.textContent = on ? 'Shortening…' : 'Shorten';
  };

  const normalizeUrl = (value) => {
    let v = value.trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      if (!u.hostname || !u.hostname.includes('.')) return '';
      return u.href;
    } catch (err) {
      return '';
    }
  };

  const safeStorage = {
    get() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; } },
    set(v) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  /* ---------- QR ---------- */
  const drawQr = (text) => {
    if (typeof qrcode !== 'function') return;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const modules = qr.getModuleCount();
      const scale = Math.max(2, Math.floor(240 / modules));
      const size = modules * scale;
      qrCanvas.width = size;
      qrCanvas.height = size;
      const ctx = qrCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#0f172a';
      for (let r = 0; r < modules; r++) {
        for (let c = 0; c < modules; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(c * scale, r * scale, scale, scale);
        }
      }
      downloadQr.href = qrCanvas.toDataURL('image/png');
    } catch (err) { /* ignore QR failure */ }
  };

  /* ---------- providers (best-effort, client-side only) ----------
     A static site can't host redirects, so we call free public shorteners.
     Many block browser CORS or go down, so we try several shorteners through
     several CORS proxies and use whichever combination succeeds first.
     A "hard" error (the API explicitly rejected the link/alias) stops the
     whole chain and is reported; network/CORS/timeout errors are "soft" and
     simply move on to the next combination. */
  const hardError = (msg) => Object.assign(new Error(msg), { hard: true });
  const enc = encodeURIComponent;

  const fetchText = async (url, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 9000);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  };

  // Parsers turn a raw response body into a short URL (or throw).
  const parseIsgd = (text) => {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Unreadable response.'); }
    if (data && data.shorturl) return data.shorturl;
    if (data && data.errormessage) throw hardError(data.errormessage); // alias taken / invalid URL
    throw new Error('No link in response.');
  };
  const parseTextUrl = (host) => (text) => {
    const m = String(text).trim().match(/https?:\/\/[^\s"'<]+/);
    if (m && m[0].toLowerCase().includes(host)) return m[0];
    throw new Error('No link from ' + host);
  };

  // Shortener endpoints (target URL builders + response parser).
  const PROVIDERS = [
    { alias: true,  build: (u, a) => 'https://da.gd/shorten?url=' + enc(u) + (a ? '&shorturl=' + enc(a) : ''), parse: parseTextUrl('da.gd') },
    { alias: true,  build: (u, a) => 'https://is.gd/create.php?format=json&url=' + enc(u) + (a ? '&shorturl=' + enc(a) : ''), parse: parseIsgd },
    { alias: true,  build: (u, a) => 'https://v.gd/create.php?format=json&url=' + enc(u) + (a ? '&shorturl=' + enc(a) : ''), parse: parseIsgd },
    { alias: false, build: (u) => 'https://tinyurl.com/api-create.php?url=' + enc(u), parse: parseTextUrl('tinyurl.com') },
  ];

  // CORS proxy wrappers (null = direct request, no proxy).
  const PROXIES = [
    null,
    (t) => 'https://api.codetabs.com/v1/proxy/?quest=' + enc(t),
    (t) => 'https://api.allorigins.win/raw?url=' + enc(t),
    (t) => 'https://corsproxy.io/?url=' + enc(t),
    (t) => 'https://thingproxy.freeboard.io/fetch/' + t,
  ];

  const shorten = async (longUrl, alias) => {
    let lastErr = null;
    for (const provider of PROVIDERS) {
      if (alias && !provider.alias) continue;
      const target = provider.build(longUrl, alias);
      for (const proxy of PROXIES) {
        const url = proxy ? proxy(target) : target;
        try {
          const text = await fetchText(url);
          return provider.parse(text);
        } catch (err) {
          lastErr = err;
          if (err && err.hard) return Promise.reject(err); // explicit rejection — stop everything
        }
      }
    }
    throw lastErr || new Error('all free shortening services are unreachable right now.');
  };

  const mobileMq = window.matchMedia('(max-width: 760px)');

  const scrollToResultOnMobile = () => {
    if (!mobileMq.matches) return;
    requestAnimationFrame(() => {
      resultCard.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  };

  /* ---------- rendering ---------- */
  const showResult = (shortUrl, longUrl) => {
    resultShort.textContent = shortUrl;
    resultShort.href = shortUrl;
    resultOriginal.textContent = longUrl;
    openLink.href = shortUrl;
    drawQr(shortUrl);
    resultCard.classList.add('show');
    copyBtn.classList.remove('copied');
    copyBtn.textContent = '📋 Copy';
    scrollToResultOnMobile();
  };

  const renderRecent = () => {
    const items = safeStorage.get();
    recentList.innerHTML = '';
    recentEmpty.hidden = items.length > 0;
    items.forEach((item) => {
      const li = document.createElement('li');
      const short = document.createElement('a');
      short.className = 'r-short';
      short.href = item.short;
      short.target = '_blank';
      short.rel = 'noopener noreferrer';
      short.textContent = item.short.replace(/^https?:\/\//, '');
      const orig = document.createElement('span');
      orig.className = 'r-orig';
      orig.textContent = item.long;
      orig.title = item.long;
      const copy = document.createElement('button');
      copy.className = 'r-copy';
      copy.type = 'button';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(item.short); copy.textContent = 'Copied!'; setTimeout(() => { copy.textContent = 'Copy'; }, 1400); } catch (e) { /* ignore */ }
      });
      li.append(short, orig, copy);
      recentList.appendChild(li);
    });
  };

  const saveRecent = (shortUrl, longUrl) => {
    let items = safeStorage.get().filter((i) => i.short !== shortUrl);
    items.unshift({ short: shortUrl, long: longUrl, at: Date.now() });
    items = items.slice(0, MAX_RECENT);
    safeStorage.set(items);
    renderRecent();
  };

  /* ---------- events ---------- */
  aliasToggle.addEventListener('click', () => {
    const open = aliasRow.classList.toggle('open');
    aliasToggle.setAttribute('aria-expanded', String(open));
    aliasToggle.textContent = open ? '➖ Hide custom alias' : '➕ Add custom alias (optional)';
    if (open) aliasInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    const longUrl = normalizeUrl(urlInput.value);
    if (!longUrl) {
      showMessage('Please enter a valid URL, e.g. https://example.com/page', 'error');
      urlInput.focus();
      return;
    }

    let alias = '';
    if (aliasRow.classList.contains('open')) {
      alias = aliasInput.value.trim();
      if (alias && !/^[A-Za-z0-9_]{5,30}$/.test(alias)) {
        showMessage('Custom alias must be 5–30 characters and use only letters, numbers, and underscores.', 'error');
        aliasInput.focus();
        return;
      }
    }

    toggleLoader(true);
    try {
      const shortUrl = await shorten(longUrl, alias);
      clearMessage();
      showResult(shortUrl, longUrl);
      saveRecent(shortUrl, longUrl);
    } catch (err) {
      showMessage('Could not shorten this link: ' + (err && err.message ? err.message : 'please try again.') + ' If the problem persists, try again without a custom alias.', 'error');
    } finally {
      toggleLoader(false);
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resultShort.textContent);
      copyBtn.classList.add('copied');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = '📋 Copy'; }, 1600);
    } catch (err) {
      showMessage('Copy failed — select and copy the link manually.', 'error');
    }
  });

  renderRecent();
})();
