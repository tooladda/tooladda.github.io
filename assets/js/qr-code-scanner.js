(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ---------- Element cache ----------
  const tabs = Array.from(document.querySelectorAll('.qrx-tab'));
  const panels = Array.from(document.querySelectorAll('.qrx-panel'));

  const cameraStage = $('qrx-camera-stage');
  const video = $('qrx-video');
  const cameraPlaceholder = $('qrx-camera-placeholder');
  const camStatusEl = $('qrx-cam-status');
  const camStatusText = $('qrx-cam-status-text');
  const lowlightEl = $('qrx-lowlight');
  const zoomRow = $('qrx-zoom-row');
  const zoomInput = $('qrx-zoom');

  const startBtn = $('qrx-start');
  const stopBtn = $('qrx-stop');
  const switchBtn = $('qrx-switch');
  const torchBtn = $('qrx-torch');
  const pauseBtn = $('qrx-pause');
  const soundBtn = $('qrx-sound');

  const dropzone = $('qrx-dropzone');
  const fileInput = $('qrx-file');
  const pasteBtn = $('qrx-paste-btn');
  const uploadImg = $('qrx-image');
  const uploadPlaceholder = $('qrx-upload-placeholder');
  const imgtools = $('qrx-imgtools');
  const rotateBtn = $('qrx-rotate');
  const mirrorBtn = $('qrx-mirror');
  const enhanceBtn = $('qrx-enhance');
  const batchEl = $('qrx-batch');

  const canvas = $('qrx-canvas');
  const output = $('qrx-output');
  const resultCard = $('qrx-result-card');
  const typeBadge = $('qrx-type');
  const trustEl = $('qrx-trust');
  const metaGrid = $('qrx-meta');
  const metaChars = $('qrx-meta-chars');
  const metaTime = $('qrx-meta-time');
  const metaWhen = $('qrx-meta-when');
  const securityBlock = $('qrx-security');
  const securityTitle = $('qrx-security-title');
  const securityList = $('qrx-security-list');
  const detailGrid = $('qrx-detail-grid');
  const openLink = $('qrx-open');
  const copyBtn = $('qrx-copy');
  const downloadBtn = $('qrx-download');
  const shareBtn = $('qrx-share');
  const generateBtn = $('qrx-generate');
  const clearBtn = $('qrx-clear');
  const messageEl = $('qrx-message');

  const histList = $('qrx-hist-list');
  const histSearch = $('qrx-hist-search');
  const histFilter = $('qrx-hist-filter');
  const histClear = $('qrx-hist-clear');
  const histExport = $('qrx-hist-export');

  const stickyEl = $('qrx-sticky');
  const stickyBtn = $('qrx-sticky-btn');

  if (!video || !canvas) return;

  // ---------- Constants ----------
  const HISTORY_KEY = 'qrx_history_v1';
  const SOUND_KEY = 'qrx_sound';
  const MAX_HISTORY = 50;
  const SHORTENERS = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 's.id', 'cli.re', 'bl.ink', 'lnkd.in'];

  // ---------- State ----------
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let rafId = null;
  let facingMode = 'environment';
  let currentTrack = null;
  let torchOn = false;
  let paused = false;
  let detecting = false;
  let lumCounter = 0;
  let activeTabName = 'camera';
  let soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
  let audioCtx = null;

  let lastResultValue = '';
  let lastResultInfo = null;
  let currentUploadCanvas = null;
  let batchItems = [];
  let batchActive = -1;

  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      window.BarcodeDetector.getSupportedFormats().then((formats) => {
        if (formats && formats.indexOf('qr_code') !== -1) {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      }).catch(() => {});
    } catch (e) { /* no-op */ }
  }

  // ---------- Utilities ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function showMessage(text, isError) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.toggle('is-error', !!isError);
  }
  function downloadBlob(content, name, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function looksHeic(file) {
    return /image\/hei[cf]/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
  }

  // ---------- QR content parsers ----------
  function splitEscaped(str, delim) {
    const parts = []; let cur = '';
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '\\' && i + 1 < str.length) { cur += str[i + 1]; i++; continue; }
      if (c === delim) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur) parts.push(cur);
    return parts;
  }
  function parseWifi(v) {
    const body = v.replace(/^WIFI:/i, '').replace(/;;?\s*$/, '');
    const out = { ssid: '', password: '', encryption: 'nopass', hidden: false };
    splitEscaped(body, ';').forEach((f) => {
      const idx = f.indexOf(':');
      if (idx < 0) return;
      const k = f.slice(0, idx).toUpperCase();
      const val = f.slice(idx + 1);
      if (k === 'S') out.ssid = val;
      else if (k === 'P') out.password = val;
      else if (k === 'T') out.encryption = val || 'nopass';
      else if (k === 'H') out.hidden = /true/i.test(val);
    });
    return out;
  }
  function parseVCard(v) {
    const out = { name: '', phone: '', email: '', org: '' };
    v.split(/\r\n|\n|\r/).forEach((line) => {
      const idx = line.indexOf(':');
      if (idx < 0) return;
      const keyPart = line.slice(0, idx);
      const val = line.slice(idx + 1).trim();
      const key = keyPart.split(';')[0].toUpperCase();
      if (key === 'FN') out.name = val;
      else if (key === 'N' && !out.name) out.name = val.split(';').filter(Boolean).reverse().join(' ');
      else if (key === 'TEL' && !out.phone) out.phone = val;
      else if (key === 'EMAIL' && !out.email) out.email = val;
      else if (key === 'ORG') out.org = val;
    });
    return out;
  }
  function parseUpi(v) {
    const qIndex = v.indexOf('?');
    const params = new URLSearchParams(qIndex >= 0 ? v.slice(qIndex + 1) : '');
    return { payee: params.get('pn') || '', upiId: params.get('pa') || '', amount: params.get('am') || '', note: params.get('tn') || '' };
  }
  function parseGeo(v) {
    const m = v.match(/^geo:([\-0-9.]+),([\-0-9.]+)/i);
    return m ? { lat: m[1], lng: m[2] } : null;
  }

  function urlResult(v, host, label, icon) {
    return {
      category: label, icon, isUrl: true, openHref: v, openLabel: '↗ Open link', host,
      details: host ? [{ label: 'Domain', value: host }] : [],
    };
  }

  function detectTypeInner(v) {
    if (/^WIFI:/i.test(v)) {
      const w = parseWifi(v);
      return {
        category: 'Wi-Fi network', icon: '📶', isUrl: false,
        details: [
          { label: 'Network (SSID)', value: w.ssid || '—', copy: w.ssid || '' },
          { label: 'Password', value: w.password || '(none)', copy: w.password || '', mask: !!w.password },
          { label: 'Encryption', value: w.encryption === 'nopass' ? 'Open (no password)' : w.encryption },
          { label: 'Hidden network', value: w.hidden ? 'Yes' : 'No' },
        ],
        download: { name: 'wifi-network.txt', mime: 'text/plain', content: v },
      };
    }
    if (/^BEGIN:VCARD/i.test(v)) {
      const c = parseVCard(v);
      return {
        category: 'Contact (vCard)', icon: '👤', isUrl: false,
        details: [
          { label: 'Name', value: c.name || '—' },
          { label: 'Phone', value: c.phone || '—', copy: c.phone || '' },
          { label: 'Email', value: c.email || '—', copy: c.email || '' },
          { label: 'Organization', value: c.org || '—' },
        ],
        download: { name: (c.name || 'contact').replace(/[^a-z0-9\-_]+/gi, '_') + '.vcf', mime: 'text/vcard', content: v },
      };
    }
    if (/^BEGIN:VEVENT/i.test(v)) {
      return { category: 'Calendar event', icon: '📅', isUrl: false, details: [], download: { name: 'event.ics', mime: 'text/calendar', content: v } };
    }
    if (/^mailto:/i.test(v)) {
      const email = v.replace(/^mailto:/i, '').split('?')[0];
      return { category: 'Email', icon: '✉️', isUrl: true, openHref: v, openLabel: '✉️ Open email client', details: [{ label: 'Address', value: email, copy: email }] };
    }
    if (/^tel:/i.test(v)) {
      const num = v.replace(/^tel:/i, '');
      return { category: 'Phone number', icon: '📞', isUrl: true, openHref: v, openLabel: '📞 Call number', details: [{ label: 'Number', value: num, copy: num }] };
    }
    if (/^sms(to)?:/i.test(v)) {
      const num = v.replace(/^smsto:|^sms:/i, '').split(':')[0];
      return { category: 'SMS', icon: '💬', isUrl: true, openHref: v, openLabel: '💬 Open SMS', details: [{ label: 'Number', value: num, copy: num }] };
    }
    if (/^geo:/i.test(v)) {
      const g = parseGeo(v);
      const mapHref = g ? ('https://maps.google.com/?q=' + g.lat + ',' + g.lng) : null;
      return { category: 'Location', icon: '📍', isUrl: !!mapHref, openHref: mapHref, openLabel: '📍 Open in Maps', details: g ? [{ label: 'Latitude', value: g.lat }, { label: 'Longitude', value: g.lng }] : [] };
    }
    if (/^upi:\/\//i.test(v)) {
      const u = parseUpi(v);
      return {
        category: 'UPI payment', icon: '💸', isUrl: true, openHref: v, openLabel: '💸 Open payment app',
        details: [{ label: 'Payee', value: u.payee || '—' }, { label: 'UPI ID', value: u.upiId || '—', copy: u.upiId || '' }, { label: 'Amount', value: u.amount ? ('₹' + u.amount) : 'Not fixed' }],
      };
    }
    if (/^bitcoin:/i.test(v)) {
      const addr = v.replace(/^bitcoin:/i, '').split('?')[0];
      return { category: 'Bitcoin address', icon: '₿', isUrl: false, details: [{ label: 'Address', value: addr, copy: addr }] };
    }
    if (/^https?:\/\//i.test(v)) {
      let host = '';
      try { host = new URL(v).hostname; } catch (e) { /* ignore */ }
      if (/wa\.me|api\.whatsapp\.com/i.test(host)) return urlResult(v, host, 'WhatsApp link', '🟢');
      if (/^t\.me$/i.test(host)) return urlResult(v, host, 'Telegram link', '✈️');
      if (/discord\.gg|discord\.com/i.test(host)) return urlResult(v, host, 'Discord invite', '🎮');
      if (/zoom\.us/i.test(host)) return urlResult(v, host, 'Zoom meeting', '🎥');
      if (/meet\.google\.com/i.test(host)) return urlResult(v, host, 'Google Meet link', '🎥');
      if (/play\.google\.com/i.test(host)) return urlResult(v, host, 'Play Store link', '📦');
      if (/apps\.apple\.com/i.test(host)) return urlResult(v, host, 'App Store link', '📦');
      if (/facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|github\.com|tiktok\.com/i.test(host)) return urlResult(v, host, 'Social media link', '🌐');
      return urlResult(v, host, 'Link (URL)', '🔗');
    }
    return { category: 'Text', icon: '📝', isUrl: false, details: [] };
  }
  function detectType(raw) {
    const v = raw.trim();
    const info = detectTypeInner(v);
    if (!info.download) info.download = { name: 'scan-result.txt', mime: 'text/plain', content: v };
    info.raw = v;
    return info;
  }

  function analyzeUrl(raw) {
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./, '');
      const https = u.protocol === 'https:';
      const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
      const isShortener = SHORTENERS.indexOf(host) !== -1;
      const hasUserinfo = !!u.username;
      const isPunycode = host.indexOf('xn--') !== -1;
      const reasons = []; let level = 'safe';
      if (!https) { reasons.push('Not using a secure HTTPS connection.'); level = 'caution'; }
      if (isShortener) { reasons.push('This is a shortened link — the real destination is hidden until you open it.'); level = 'caution'; }
      if (isIp) { reasons.push('Points directly to a numeric IP address instead of a normal domain name.'); level = 'caution'; }
      if (hasUserinfo) { reasons.push('Contains an “@” login segment before the domain, sometimes used to disguise the real destination.'); level = 'caution'; }
      if (isPunycode) { reasons.push('Uses punycode (xn--) encoding, which can be used for look-alike domains.'); level = 'caution'; }
      if (!reasons.length) reasons.push('HTTPS secure connection and a standard domain — no obvious red flags detected.');
      return { level, host: u.hostname, https, reasons };
    } catch (e) {
      return { level: 'unknown', host: raw, https: false, reasons: ['Could not fully parse this link — open with caution.'] };
    }
  }

  // ---------- Detection engine (native BarcodeDetector + jsQR fallback) ----------
  async function detectFromCanvas(canvasEl, canvasCtx, w, h) {
    if (detector) {
      try {
        const codes = await detector.detect(canvasEl);
        if (codes && codes.length) return codes[0].rawValue;
      } catch (e) { /* fall through */ }
    }
    if (typeof window.jsQR === 'function') {
      const imageData = canvasCtx.getImageData(0, 0, w, h);
      const code = window.jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code.data;
    }
    return null;
  }

  function rotateCanvas(src, deg) {
    const rad = (deg * Math.PI) / 180;
    const swapped = deg === 90 || deg === 270;
    const out = document.createElement('canvas');
    out.width = swapped ? src.height : src.width;
    out.height = swapped ? src.width : src.height;
    const c = out.getContext('2d', { willReadFrequently: true });
    c.translate(out.width / 2, out.height / 2);
    c.rotate(rad);
    c.drawImage(src, -src.width / 2, -src.height / 2);
    return out;
  }
  function mirrorCanvas(src) {
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const c = out.getContext('2d', { willReadFrequently: true });
    c.translate(out.width, 0); c.scale(-1, 1); c.drawImage(src, 0, 0);
    return out;
  }
  function enhanceCanvas(src) {
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const c = out.getContext('2d', { willReadFrequently: true });
    c.drawImage(src, 0, 0);
    const id = c.getImageData(0, 0, out.width, out.height);
    const d = id.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      if (g < min) min = g; if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const val = Math.max(0, Math.min(255, ((g - min) * 255) / range));
      d[i] = d[i + 1] = d[i + 2] = val;
    }
    c.putImageData(id, 0, 0);
    return out;
  }

  // ---------- Feedback ----------
  function beep() {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.06;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.12);
    } catch (e) { /* no-op */ }
  }
  function successFeedback() {
    if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) { /* no-op */ } }
    beep();
  }

  // ---------- Result rendering ----------
  function renderResult(value, info, meta) {
    lastResultValue = value; lastResultInfo = info;
    output.textContent = value;

    typeBadge.hidden = false;
    typeBadge.textContent = info.icon + ' ' + info.category;

    if (info.isUrl && info.openHref && /^https?:\/\//i.test(info.openHref)) {
      const sec = analyzeUrl(info.openHref);
      trustEl.hidden = false;
      trustEl.className = 'qrx-trust is-' + sec.level;
      trustEl.textContent = sec.level === 'safe' ? '✅ Safe' : sec.level === 'caution' ? '⚠️ Caution' : '❔ Unknown';
      securityBlock.classList.add('is-visible');
      securityTitle.textContent = 'Link safety check — ' + sec.host;
      securityList.innerHTML = sec.reasons.map((r) => '<li class="' + (sec.level === 'caution' ? 'is-warn' : '') + '">' + escapeHtml(r) + '</li>').join('');
    } else {
      trustEl.hidden = true;
      securityBlock.classList.remove('is-visible');
      securityList.innerHTML = '';
    }

    if (info.details && info.details.length) {
      detailGrid.classList.add('is-visible');
      detailGrid.innerHTML = info.details.map((d) => {
        const shown = d.mask ? '••••••••' : escapeHtml(String(d.value));
        const real = d.mask ? escapeHtml(String(d.value)) : '';
        const copyBtnHtml = d.copy ? '<button type="button" class="qrx-mini-btn" data-copy-val="' + escapeHtml(d.copy) + '">Copy</button>' : '';
        const toggleBtnHtml = d.mask ? '<button type="button" class="qrx-mini-btn" data-toggle-mask>Show</button>' : '';
        return '<div><b>' + escapeHtml(d.label) + '</b><span data-real="' + real + '">' + shown + '</span>' + copyBtnHtml + toggleBtnHtml + '</div>';
      }).join('');
    } else {
      detailGrid.classList.remove('is-visible');
      detailGrid.innerHTML = '';
    }

    metaGrid.hidden = false;
    metaChars.textContent = String(meta.chars);
    metaTime.textContent = meta.timeMs + 'ms';
    metaWhen.textContent = new Date(meta.when).toLocaleTimeString();

    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    clearBtn.disabled = false;
    if (info.openHref) { openLink.hidden = false; openLink.href = info.openHref; openLink.textContent = info.openLabel || '↗ Open'; }
    else { openLink.hidden = true; openLink.removeAttribute('href'); }
    const canShare = typeof navigator.share === 'function';
    shareBtn.hidden = !canShare; shareBtn.disabled = !canShare;
    generateBtn.hidden = false;

    if (resultCard && window.matchMedia('(max-width: 899px)').matches) {
      requestAnimationFrame(() => resultCard.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' }));
    }
  }

  function clearResultPanel() {
    lastResultValue = ''; lastResultInfo = null;
    output.innerHTML = '<span class="qrx-empty">No QR code scanned yet. Start the camera or upload an image to begin.</span>';
    typeBadge.hidden = true; trustEl.hidden = true;
    securityBlock.classList.remove('is-visible'); securityList.innerHTML = '';
    detailGrid.classList.remove('is-visible'); detailGrid.innerHTML = '';
    metaGrid.hidden = true;
    openLink.hidden = true; openLink.removeAttribute('href');
    copyBtn.disabled = true; downloadBtn.disabled = true; clearBtn.disabled = true;
    shareBtn.hidden = true; generateBtn.hidden = true;
    showMessage('');
  }

  detailGrid.addEventListener('click', (e) => {
    const copyEl = e.target.closest('[data-copy-val]');
    if (copyEl) {
      navigator.clipboard.writeText(copyEl.getAttribute('data-copy-val'))
        .then(() => showMessage('Copied to clipboard.'))
        .catch(() => showMessage('Unable to copy.', true));
      return;
    }
    const toggleEl = e.target.closest('[data-toggle-mask]');
    if (toggleEl) {
      const span = toggleEl.parentElement.querySelector('span[data-real]');
      const showing = toggleEl.textContent === 'Hide';
      if (showing) { span.textContent = '••••••••'; toggleEl.textContent = 'Show'; }
      else { span.textContent = span.getAttribute('data-real'); toggleEl.textContent = 'Hide'; }
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!lastResultValue) return;
    try { await navigator.clipboard.writeText(lastResultValue); showMessage('Copied to clipboard.'); }
    catch (e) { showMessage('Unable to copy.', true); }
  });
  downloadBtn.addEventListener('click', () => {
    if (!lastResultValue || !lastResultInfo) return;
    const d = lastResultInfo.download || { name: 'scan-result.txt', mime: 'text/plain', content: lastResultValue };
    downloadBlob(d.content, d.name, d.mime);
  });
  shareBtn.addEventListener('click', () => {
    if (!lastResultValue || typeof navigator.share !== 'function') return;
    navigator.share({ text: lastResultValue, title: 'QR scan result' }).catch(() => {});
  });
  clearBtn.addEventListener('click', clearResultPanel);

  // ---------- History ----------
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); } catch (e) { /* storage full/unavailable */ }
  }
  function addHistory(value, info, meta, source) {
    const list = loadHistory();
    list.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), value, category: info.category, icon: info.icon, source, ts: meta.when });
    saveHistory(list);
    renderHistory();
  }
  function groupOf(category) {
    if (/wi-?fi/i.test(category)) return 'Wi-Fi network';
    if (/contact/i.test(category)) return 'Contact';
    if (/text/i.test(category)) return 'Text';
    if (/link|whatsapp|telegram|discord|zoom|meet|store|social/i.test(category)) return 'Link';
    return 'Other';
  }
  function renderHistory() {
    const list = loadHistory();
    const q = (histSearch.value || '').toLowerCase().trim();
    const filterVal = histFilter.value;
    const filtered = list.filter((item) => {
      if (filterVal && groupOf(item.category) !== filterVal) return false;
      if (q && item.value.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (!filtered.length) {
      histList.innerHTML = '<li class="qrx-hist-empty">No scans yet — your history stays on this device only.</li>';
      return;
    }
    histList.innerHTML = filtered.map((item) => {
      const when = new Date(item.ts).toLocaleString();
      return '<li><button type="button" class="qrx-hist-item" data-hist-id="' + item.id + '">' +
        '<span class="ic">' + item.icon + '</span>' +
        '<span class="tx"><b>' + escapeHtml(item.value) + '</b><span>' + escapeHtml(item.category) + ' • ' + escapeHtml(when) + '</span></span>' +
        '<span class="del" data-del-id="' + item.id + '" role="button" aria-label="Delete this entry">✕</span>' +
        '</button></li>';
    }).join('');
  }
  histList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-id]');
    if (del) {
      e.stopPropagation();
      const id = del.getAttribute('data-del-id');
      saveHistory(loadHistory().filter((i) => i.id !== id));
      renderHistory();
      return;
    }
    const item = e.target.closest('[data-hist-id]');
    if (item) {
      const id = item.getAttribute('data-hist-id');
      const entry = loadHistory().find((i) => i.id === id);
      if (entry) {
        const info = detectType(entry.value);
        renderResult(entry.value, info, { chars: entry.value.length, timeMs: 0, when: entry.ts });
        showMessage('Loaded from history.');
      }
    }
  });
  histSearch.addEventListener('input', renderHistory);
  histFilter.addEventListener('change', renderHistory);
  histClear.addEventListener('click', () => {
    if (!loadHistory().length) return;
    if (window.confirm('Clear all scan history on this device? This cannot be undone.')) {
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
    }
  });
  histExport.addEventListener('click', () => {
    const list = loadHistory();
    if (!list.length) { showMessage('No history to export yet.', true); return; }
    downloadBlob(JSON.stringify(list, null, 2), 'qr-scan-history.json', 'application/json');
  });

  // ---------- Shared success handler ----------
  function commonSuccess(value, timeMs, source) {
    const info = detectType(value);
    const meta = { chars: value.length, timeMs: Math.round(timeMs), when: new Date().toISOString() };
    renderResult(value, info, meta);
    addHistory(value, info, meta, source);
    showMessage(info.icon + ' Decoded — ' + info.category + '.');
    successFeedback();
    return info;
  }

  // ---------- Camera ----------
  function setCamStatus(text, live) {
    camStatusText.textContent = text;
    camStatusEl.classList.toggle('is-live', !!live);
  }
  function setPaused(v) {
    paused = v;
    pauseBtn.textContent = v ? '▶ Resume' : '⏸ Pause';
    pauseBtn.classList.toggle('is-toggled', v);
    if (stream) setCamStatus(v ? 'Live — paused' : 'Live — scanning', true);
  }
  function maybeSampleLuminance(w, h) {
    lumCounter++;
    if (lumCounter % 15 !== 0) return;
    try {
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4 * 25) { sum += (data[i] + data[i + 1] + data[i + 2]) / 3; count++; }
      const avg = count ? sum / count : 128;
      lowlightEl.classList.toggle('is-visible', avg < 40);
    } catch (e) { /* no-op */ }
  }

  async function scanFrame() {
    if (!stream) return;
    rafId = requestAnimationFrame(scanFrame);
    if (detecting) return;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, 640 / Math.max(vw, vh));
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    maybeSampleLuminance(w, h);
    if (paused) return;
    detecting = true;
    const t0 = performance.now();
    try {
      const result = await detectFromCanvas(canvas, ctx, w, h);
      if (result) {
        cameraStage.classList.add('qrx-success');
        setTimeout(() => cameraStage.classList.remove('qrx-success'), 700);
        commonSuccess(result, performance.now() - t0, 'camera');
        setPaused(true);
      }
    } finally {
      detecting = false;
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMessage('Your browser does not support camera access. Try “Upload & paste” instead.', true);
      return;
    }
    stopCamera();
    showMessage('Starting camera…');
    setCamStatus('Starting…', false);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false });
      video.srcObject = stream;
      await video.play();
      currentTrack = stream.getVideoTracks()[0];
      const caps = currentTrack.getCapabilities ? currentTrack.getCapabilities() : {};
      if (caps.torch) { torchBtn.hidden = false; torchBtn.disabled = false; torchOn = false; torchBtn.classList.remove('is-toggled'); }
      else { torchBtn.hidden = true; torchBtn.disabled = true; }
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        zoomRow.classList.add('is-visible');
        zoomInput.min = caps.zoom.min; zoomInput.max = caps.zoom.max; zoomInput.step = caps.zoom.step || 0.1;
        const settings = currentTrack.getSettings ? currentTrack.getSettings() : {};
        zoomInput.value = settings.zoom || caps.zoom.min;
      } else {
        zoomRow.classList.remove('is-visible');
      }
      cameraStage.classList.add('qrx-scanning');
      cameraPlaceholder.style.display = 'none';
      startBtn.disabled = true; stopBtn.disabled = false; switchBtn.disabled = false; pauseBtn.disabled = false;
      setPaused(false);
      showMessage('Point your camera at a QR code.');
      lumCounter = 0;
      rafId = requestAnimationFrame(scanFrame);
    } catch (err) {
      let msg = 'Could not access the camera.';
      if (err && err.name === 'NotAllowedError') msg = 'Camera permission was denied. Allow access or use “Upload & paste”.';
      else if (err && err.name === 'NotFoundError') msg = 'No camera found on this device. Try “Upload & paste”.';
      else if (window.isSecureContext === false) msg = 'Camera needs a secure (https) connection. Try “Upload & paste”.';
      showMessage(msg, true);
      setCamStatus('Camera off', false);
      stopCamera();
    }
  }
  function stopCamera() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (video) video.srcObject = null;
    currentTrack = null; paused = false;
    cameraStage.classList.remove('qrx-scanning', 'qrx-success');
    cameraPlaceholder.style.display = '';
    startBtn.disabled = false; stopBtn.disabled = true; switchBtn.disabled = true; pauseBtn.disabled = true;
    torchBtn.hidden = true; zoomRow.classList.remove('is-visible'); lowlightEl.classList.remove('is-visible');
    setCamStatus('Camera off', false);
  }
  async function switchCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    await startCamera();
  }
  async function toggleTorch() {
    if (!currentTrack) return;
    const next = !torchOn;
    try {
      await currentTrack.applyConstraints({ advanced: [{ torch: next }] });
      torchOn = next;
      torchBtn.classList.toggle('is-toggled', torchOn);
    } catch (e) {
      showMessage('Flashlight is not supported on this camera.', true);
    }
  }

  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', () => { stopCamera(); showMessage('Camera stopped.'); });
  switchBtn.addEventListener('click', switchCamera);
  torchBtn.addEventListener('click', toggleTorch);
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  zoomInput.addEventListener('input', () => {
    if (!currentTrack) return;
    currentTrack.applyConstraints({ advanced: [{ zoom: parseFloat(zoomInput.value) }] }).catch(() => {});
  });
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
    soundBtn.textContent = soundOn ? '🔔' : '🔕';
    soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  });

  // ---------- Upload / drag & drop / paste ----------
  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('load-failed'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('read-failed'));
      reader.readAsDataURL(file);
    });
  }
  async function decodeFile(file) {
    let img;
    try { img = await loadImageFile(file); }
    catch (e) { return { file, ok: false, error: 'load' }; }
    const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const base = document.createElement('canvas');
    base.width = w; base.height = h;
    const bctx = base.getContext('2d', { willReadFrequently: true });
    bctx.drawImage(img, 0, 0, w, h);
    const t0 = performance.now();
    let value = await detectFromCanvas(base, bctx, w, h);
    let used = base;
    if (!value) {
      for (const deg of [90, 180, 270]) {
        const rc = rotateCanvas(base, deg);
        const rctx = rc.getContext('2d', { willReadFrequently: true });
        value = await detectFromCanvas(rc, rctx, rc.width, rc.height);
        if (value) { used = rc; break; }
      }
    }
    if (!value) {
      const ec = enhanceCanvas(base);
      const ectx = ec.getContext('2d', { willReadFrequently: true });
      value = await detectFromCanvas(ec, ectx, ec.width, ec.height);
      if (value) used = ec;
    }
    const timeMs = performance.now() - t0;
    return { file, ok: !!value, value, dataUrl: base.toDataURL('image/png'), baseCanvas: used, timeMs };
  }

  function renderBatch() {
    if (batchItems.length <= 1) { batchEl.classList.remove('is-visible'); batchEl.innerHTML = ''; return; }
    batchEl.classList.add('is-visible');
    batchEl.innerHTML = batchItems.map((it, i) => {
      const cls = (i === batchActive ? 'is-active ' : '') + (it.ok ? 'ok' : 'fail');
      const img = it.dataUrl ? '<img src="' + it.dataUrl + '" alt="" />' : '';
      const label = it.ok ? escapeHtml(it.info.category) : 'No code found';
      return '<button type="button" class="qrx-batch-item ' + cls + '" data-batch-idx="' + i + '">' + img + '<span class="st"></span>' + label + '</button>';
    }).join('');
  }
  batchEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-batch-idx]');
    if (!btn) return;
    selectBatchItem(parseInt(btn.getAttribute('data-batch-idx'), 10));
  });
  function selectBatchItem(idx) {
    if (idx < 0 || idx >= batchItems.length) return;
    batchActive = idx;
    const it = batchItems[idx];
    if (it.dataUrl) { uploadImg.src = it.dataUrl; uploadImg.style.display = 'block'; }
    currentUploadCanvas = it.baseCanvas || null;
    renderBatch();
    if (it.ok) renderResult(it.value, it.info, it.meta);
    else { clearResultPanel(); showMessage('No QR code found in this image.', true); }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type && f.type.startsWith('image/'));
    if (!files.length) { showMessage('Please choose a valid image file.', true); return; }
    showMessage('Reading ' + (files.length > 1 ? files.length + ' images' : 'image') + '…');
    uploadPlaceholder.style.display = 'none';
    batchItems = []; batchActive = -1;
    let heicFail = false;
    for (let i = 0; i < files.length; i++) {
      const res = await decodeFile(files[i]);
      if (res.ok) {
        res.info = detectType(res.value);
        res.meta = { chars: res.value.length, timeMs: Math.round(res.timeMs), when: new Date().toISOString() };
        addHistory(res.value, res.info, res.meta, 'upload');
      } else if (res.error === 'load' && looksHeic(files[i])) {
        heicFail = true;
      }
      batchItems.push(res);
      renderBatch();
    }
    imgtools.hidden = false;
    const firstOk = batchItems.findIndex((b) => b.ok);
    selectBatchItem(firstOk !== -1 ? firstOk : 0);
    if (firstOk === -1) {
      if (heicFail) showMessage('That looks like a HEIC photo, which some browsers can’t decode directly — convert it with our HEIC converter tool, or use a JPG/PNG instead.', true);
      else showMessage('No QR code found in ' + (files.length > 1 ? 'those images' : 'that image') + '. Try a clearer photo, better lighting, or Rotate/Enhance.', true);
    } else {
      successFeedback();
      if (files.length > 1) showMessage('Decoded ' + batchItems.filter((b) => b.ok).length + ' of ' + files.length + ' images.');
    }
  }

  fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

  ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('is-dragover'); }));
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handleFiles(files);
  });

  pasteBtn.addEventListener('click', async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      showMessage('Clipboard read isn’t supported in this browser — use Ctrl+V / Cmd+V instead.', true);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) { const blob = await item.getType(type); files.push(new File([blob], 'clipboard.png', { type })); }
        }
      }
      if (files.length) handleFiles(files);
      else showMessage('No image found on your clipboard.', true);
    } catch (e) {
      showMessage('Clipboard access was blocked. Try Ctrl+V / Cmd+V instead.', true);
    }
  });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const it of items) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); } }
    if (files.length) { e.preventDefault(); activateTab('upload'); handleFiles(files); }
  });

  async function tryManualTransform(canvasEl) {
    currentUploadCanvas = canvasEl;
    uploadImg.src = canvasEl.toDataURL('image/png');
    uploadImg.style.display = 'block';
    const tctx = canvasEl.getContext('2d', { willReadFrequently: true });
    showMessage('Rescanning…');
    const t0 = performance.now();
    const value = await detectFromCanvas(canvasEl, tctx, canvasEl.width, canvasEl.height);
    if (value) {
      const info = commonSuccess(value, performance.now() - t0, 'upload');
      if (batchActive >= 0 && batchItems[batchActive]) {
        batchItems[batchActive].ok = true;
        batchItems[batchActive].value = value;
        batchItems[batchActive].info = info;
        batchItems[batchActive].dataUrl = uploadImg.src;
        batchItems[batchActive].baseCanvas = canvasEl;
        renderBatch();
      }
    } else {
      showMessage('Still no QR code found. Try another transform or a clearer image.', true);
    }
  }
  rotateBtn.addEventListener('click', () => { if (currentUploadCanvas) tryManualTransform(rotateCanvas(currentUploadCanvas, 90)); });
  mirrorBtn.addEventListener('click', () => { if (currentUploadCanvas) tryManualTransform(mirrorCanvas(currentUploadCanvas)); });
  enhanceBtn.addEventListener('click', () => { if (currentUploadCanvas) tryManualTransform(enhanceCanvas(currentUploadCanvas)); });

  // ---------- Tabs ----------
  function activateTab(name) {
    activeTabName = name;
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name));
    if (name !== 'camera') stopCamera();
  }
  tabs.forEach((t) => t.addEventListener('click', () => activateTab(t.dataset.tab)));

  // ---------- Sticky bar / CTA ----------
  function scrollToToolAndStart() {
    activateTab('camera');
    const toolEl = document.querySelector('.qrx-tool-inner');
    if (toolEl) toolEl.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    startCamera();
  }
  if (stickyBtn) stickyBtn.addEventListener('click', scrollToToolAndStart);
  document.querySelectorAll('[data-qrx-scroll-top]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); scrollToToolAndStart(); }));
  if (stickyEl) stickyEl.classList.add('is-visible');

  // ---------- Keyboard shortcuts ----------
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === ' ' && activeTabName === 'camera' && stream) { e.preventDefault(); pauseBtn.click(); }
    if (e.key === 'Escape' && stream) { stopBtn.click(); }
  });

  // ---------- Lifecycle ----------
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

  soundBtn.textContent = soundOn ? '🔔' : '🔕';
  soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  clearResultPanel();
  renderHistory();
})();
