/* Internet Speed Test - Vanilla JS (no dependencies)
   -------------------------------------------------------------
   Runs fully client-side on a static site. It measures against
   public, CORS-enabled endpoints and automatically falls back to
   an alternate provider if the primary one is blocked, so the
   test keeps working across networks:

     Primary  : Cloudflare  (speed.cloudflare.com/__down, /__up)
     Fallback : jsDelivr CDN (large asset, download-only)

   Ping and upload failures are non-fatal; the test only fails
   when no download provider can be reached at all.
*/

(function () {
  'use strict';

  const SELECTORS = {
    startBtn: '[data-start-btn]',
    copyBtn: '[data-copy-btn]',
    shareBtn: '[data-share-btn]',
    downloadImageBtn: '[data-download-image]',
    downloadPdfBtn: '[data-download-pdf]',

    statusWrap: '[data-test-status]',
    statusText: '[data-status-text]',

    progressPct: '[data-progress-pct]',
    circularProgress: '.speedtest-cp__progress',

    needle: '[data-needle]',
    gaugeLabel: '[data-gauge-label]',

    gaugeRingProgress: '.speedtest-ring__progress',
    downloadGaugeValue: '[data-download-mbps]',

    metricDownload: '[data-metric-download]',
    metricUpload: '[data-metric-upload]',
    metricPing: '[data-metric-ping]',
    metricJitter: '[data-metric-jitter]',

    finalDownload: '[data-final-download]',
    finalUpload: '[data-final-upload]',
    finalPing: '[data-final-ping]',
    finalJitter: '[data-final-jitter]',

    finalDownloadMeta: '[data-final-download-meta]',
    finalUploadMeta: '[data-final-upload-meta]',
    finalPingMeta: '[data-final-ping-meta]',
    finalJitterMeta: '[data-final-jitter-meta]',

    message: '[data-message]',

    historyList: '[data-history-list]',
    historyEmpty: '[data-history-empty]',
    clearHistory: '[data-clear-history]',
  };

  const CF = 'https://speed.cloudflare.com';
  // Fallbacks must be INCOMPRESSIBLE. A gzip/br-compressed text asset would
  // make the reader report decompressed bytes (much larger than the bytes
  // actually transferred over the wire), inflating the measured speed ~3x.
  // A JPEG is already compressed, so the server won't gzip it and the
  // received byte count equals the real network transfer.
  // Large JPEG textures served from the three.js GitHub repo via jsDelivr
  // (the npm package excludes examples/textures). JPEGs are already
  // compressed, so the CDN won't gzip them and the received byte count
  // equals the real bytes transferred over the wire.
  const IMG = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/2294472375_24a3b8ef46_o.jpg'; // ~3.6 MB skybox
  const IMG2 = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/uv_grid_opengl.jpg'; // smaller backup
  const TINY = 'https://cdn.jsdelivr.net/npm/three@0.160.0/package.json'; // tiny, for latency

  const DEFAULTS = {
    historyKey: 'tooladda-speedtest-history-v1',
    historyMaxItems: 8,

    // Ping / latency
    pingSamples: 10,
    pingIntervalMs: 90,

    // Download — more streams + longer warmup = accurate saturation
    downloadDurationMs: 9000,
    downloadWarmupMs: 1000, // discard TCP slow-start ramp before counting
    downloadStreams: 8, // parallel connections to fully saturate the link

    // Upload
    uploadDurationMs: 7000,
    uploadWarmupMs: 700,
    uploadStreams: 3,

    gaugeMaxMbps: 250, // visual scale cap for gauge/needle

    // Providers (tried in order). A provider is used if its first
    // request succeeds; otherwise we fall back to the next one.
    downloadProviders: [
      { name: 'Cloudflare', chunkBytes: 50e6, url: (b) => `${CF}/__down?bytes=${b}` },
      { name: 'CDN image', chunkBytes: null, url: () => IMG }, // incompressible JPEG (~3.6MB)
      { name: 'CDN image 2', chunkBytes: null, url: () => IMG2 }, // incompressible JPEG (backup)
      { name: 'httpbin', chunkBytes: 100000, url: (b) => `https://httpbin.org/bytes/${b}` }, // random bytes
    ],
    uploadProviders: [
      { name: 'Cloudflare', chunkBytes: 8e6, url: () => `${CF}/__up` },
      { name: 'httpbin', chunkBytes: 2e6, url: () => 'https://httpbin.org/post' },
      { name: 'postman-echo', chunkBytes: 2e6, url: () => 'https://postman-echo.com/post' },
    ],
    pingProviders: [
      `${CF}/__down?bytes=1`,
      TINY,
    ],
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const setEnabled = (el, enabled) => {
    if (!el) return;
    if ('disabled' in el) el.disabled = !enabled;
    el.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    el.classList.toggle('disabled', !enabled);
  };

  const formatNumber = (n, digits = 2) => {
    if (!Number.isFinite(n)) return '—';
    const p = Math.pow(10, digits);
    return String(Math.round(n * p) / p);
  };
  const formatMbps = (mbps) => (Number.isFinite(mbps) ? `${formatNumber(mbps, 2)} Mbps` : '— Mbps');
  const formatMs = (ms) => (Number.isFinite(ms) ? `${formatNumber(ms, 1)} ms` : '— ms');

  const safeJsonParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const safeLocalStorageGet = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
  const safeLocalStorageSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* ignore */ } };

  const getEl = (root, sel) => root.querySelector(sel);
  const toMbps = (bytes, seconds) => (seconds > 0 ? (bytes * 8) / seconds / 1e6 : NaN);
  const bust = (url) => url + (url.includes('?') ? '&' : '?') + '_=' + Date.now() + Math.random().toString(36).slice(2);

  // Grading, capability thresholds and formatting live in speedtest-engine.js
  // so they can be unit-tested without a network. This file keeps the
  // measurement loop and the DOM; the engine keeps the judgement.
  const ENGINE = (typeof window !== 'undefined' && window.SpeedTestEngine) || null;

  const ratingFor = (mbps) => {
    if (!Number.isFinite(mbps)) return '';
    if (!ENGINE) return '';
    const g = ENGINE.gradeSpeed(mbps);
    return g.label + ' — ' + g.note;
  };
  const pingRating = (ms) => {
    if (!Number.isFinite(ms)) return '';
    if (!ENGINE) return '';
    const g = ENGINE.gradePing(ms);
    return g.label + ' — ' + g.note;
  };
  const jitterRating = (ms) => {
    if (!Number.isFinite(ms) || !ENGINE) return '';
    const g = ENGINE.gradeJitter(ms);
    return g.label + ' — ' + g.note;
  };

  function init() {
    const root = document;

    const startBtn = getEl(root, SELECTORS.startBtn);
    const gauge = getEl(root, '[data-speedtest-gauge]');
    const copyBtn = getEl(root, SELECTORS.copyBtn);
    const shareBtn = getEl(root, SELECTORS.shareBtn);
    const downloadImageBtn = getEl(root, SELECTORS.downloadImageBtn);
    const downloadPdfBtn = getEl(root, SELECTORS.downloadPdfBtn);

    const statusWrap = getEl(root, SELECTORS.statusWrap);
    const statusText = getEl(root, SELECTORS.statusText);

    const progressPct = getEl(root, SELECTORS.progressPct);
    const circularProgress = getEl(root, SELECTORS.circularProgress);

    const needle = getEl(root, SELECTORS.needle);
    const gaugeLabel = getEl(root, SELECTORS.gaugeLabel);
    const gaugeHint = getEl(root, '[data-gauge-hint]');
    const gaugeRingProgress = getEl(root, SELECTORS.gaugeRingProgress);
    const downloadGaugeValue = getEl(root, SELECTORS.downloadGaugeValue);

    const metricDownload = getEl(root, SELECTORS.metricDownload);
    const metricUpload = getEl(root, SELECTORS.metricUpload);
    const metricPing = getEl(root, SELECTORS.metricPing);
    const metricJitter = getEl(root, SELECTORS.metricJitter);

    const finalDownload = getEl(root, SELECTORS.finalDownload);
    const finalUpload = getEl(root, SELECTORS.finalUpload);
    const finalPing = getEl(root, SELECTORS.finalPing);
    const finalJitter = getEl(root, SELECTORS.finalJitter);

    const finalDownloadMeta = getEl(root, SELECTORS.finalDownloadMeta);
    const finalUploadMeta = getEl(root, SELECTORS.finalUploadMeta);
    const finalPingMeta = getEl(root, SELECTORS.finalPingMeta);
    const finalJitterMeta = getEl(root, SELECTORS.finalJitterMeta);

    const messageBox = getEl(root, SELECTORS.message);

    const historyList = getEl(root, SELECTORS.historyList);
    const historyEmpty = getEl(root, SELECTORS.historyEmpty);
    const clearHistory = getEl(root, SELECTORS.clearHistory);

    if (!startBtn || !statusWrap) return;

    // Derived from the SVG rather than hardcoded, so the dial geometry can be
    // restyled without silently desynchronising the stroke maths from the markup.
    const circumferenceOf = (circle, fallback) => {
      const r = circle && Number(circle.getAttribute('r'));
      return r ? 2 * Math.PI * r : fallback;
    };
    const CP_CIRCUMFERENCE = circumferenceOf(circularProgress, 239);
    const RING_CIRCUMFERENCE = circumferenceOf(gaugeRingProgress, 301);
    // Publish the lengths to CSS so the dash pattern always matches.
    if (circularProgress) {
      circularProgress.style.strokeDasharray = String(CP_CIRCUMFERENCE);
      circularProgress.style.strokeDashoffset = String(CP_CIRCUMFERENCE);
    }
    if (gaugeRingProgress) {
      gaugeRingProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);
      gaugeRingProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    }

    const state = {
      running: false,
      cancelled: false,
      abortController: null,
      history: [],
      lastResult: null,
    };

    // --- UI helpers ---
    const setStatus = (text, tone) => {
      if (statusText) statusText.textContent = text;
      statusWrap.setAttribute('data-tone', tone);
    };
    const setGaugeLabel = (t) => { if (gaugeLabel) gaugeLabel.textContent = t; };
    const setGaugeHint = (t) => { if (gaugeHint) gaugeHint.textContent = t; };

    const setCircularProgress = (pct) => {
      const safe = Math.max(0, Math.min(100, pct));
      if (progressPct) progressPct.textContent = String(Math.round(safe));
      if (circularProgress) circularProgress.style.strokeDashoffset = String(CP_CIRCUMFERENCE - (safe / 100) * CP_CIRCUMFERENCE);
    };

    const setGaugeProgress = (mbps) => {
      const max = DEFAULTS.gaugeMaxMbps;
      const safe = Math.max(0, Math.min(max, Number(mbps) || 0));
      const pct = safe / max;
      if (gaugeRingProgress) gaugeRingProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE - pct * RING_CIRCUMFERENCE);
      // Two decimals is noise at display size: show 87.4, not 87.40, and drop
      // the decimal entirely once the number is large enough not to need it.
      if (downloadGaugeValue) {
        const v = Number(mbps) || 0;
        downloadGaugeValue.textContent = v >= 100 ? String(Math.round(v)) : formatNumber(v, 1);
      }
      // The needle tracks the SAME sweep as the arc. It previously used a 180
      // degree scale against a 360 degree arc, so the two disagreed at every
      // value except zero.
      if (needle) needle.style.transform = `translateX(-50%) rotate(${pct * 360}deg)`;
    };

    const showMessage = (text, isError = true) => {
      if (!messageBox) return;
      messageBox.hidden = false;
      messageBox.textContent = text;
      messageBox.classList.toggle('speedtest-message--info', !isError);
    };
    const clearMessage = () => {
      if (!messageBox) return;
      messageBox.hidden = true;
      messageBox.textContent = '';
      messageBox.classList.remove('speedtest-message--info');
    };

    const setHistoryEmptyVisible = (visible) => {
      if (!historyEmpty) return;
      historyEmpty.hidden = !visible;
      historyEmpty.classList.toggle('hidden', !visible);
    };

    const setLiveMetrics = (next) => {
      if (next.downloadMbps !== undefined && metricDownload) metricDownload.textContent = formatMbps(next.downloadMbps);
      if (next.uploadMbps !== undefined && metricUpload) metricUpload.textContent = formatMbps(next.uploadMbps);
      if (next.pingMs !== undefined && metricPing) metricPing.textContent = formatMs(next.pingMs);
      if (next.jitterMs !== undefined && metricJitter) metricJitter.textContent = formatMs(next.jitterMs);
    };

    const fillFinalCards = (r) => {
      if (!r) return;
      finalDownload.textContent = formatMbps(r.downloadMbps);
      finalUpload.textContent = formatMbps(r.uploadMbps);
      finalPing.textContent = formatMs(r.pingMs);
      finalJitter.textContent = formatMs(r.jitterMs);
      finalDownloadMeta.textContent = r.downloadMeta || ratingFor(r.downloadMbps);
      finalUploadMeta.textContent = r.uploadMeta || ratingFor(r.uploadMbps);
      finalPingMeta.textContent = r.pingMeta || pingRating(r.pingMs);
      finalJitterMeta.textContent = r.jitterMeta || jitterRating(r.jitterMs);
      renderVerdict(r);
      renderCapabilities(r);
      renderTransferTimes(r);
      renderComparison(r);
    };

    // --- Interpretation panels (all driven by the engine) ---
    const verdictEl = getEl(root, '[data-verdict]');
    const capsEl = getEl(root, '[data-capabilities]');
    const transferEl = getEl(root, '[data-transfer-times]');
    const comparisonEl = getEl(root, '[data-comparison]');

    const clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild); };

    const resultsEl = getEl(root, '.stx-results');

    // The instrument is tall enough that the result block sits below the fold
    // on every screen size, so a finished test would otherwise look like
    // nothing happened. Bring it into view and flash it once.
    const revealResults = () => {
      if (!resultsEl) return;

      const reduced = typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Restart the animation even if the class is already there.
      resultsEl.classList.remove('is-revealed');
      // Reading offsetWidth forces a reflow, which is what lets the same
      // animation replay on a second run.
      void resultsEl.offsetWidth;
      resultsEl.classList.add('is-revealed');

      try {
        resultsEl.scrollIntoView({
          behavior: reduced ? 'auto' : 'smooth',
          block: 'center'
        });
      } catch (e) {
        resultsEl.scrollIntoView();
      }
    };

    const renderVerdict = (r) => {
      if (!verdictEl || !ENGINE) return;
      verdictEl.textContent = ENGINE.verdict(r);
      verdictEl.hidden = false;
    };

    // "Is my internet good enough for X" is the question people arrive with,
    // so answer it directly rather than leaving them to interpret a number.
    const renderCapabilities = (r) => {
      if (!capsEl || !ENGINE) return;
      clear(capsEl);
      const caps = ENGINE.capabilities(r);
      caps.forEach((c) => {
        if (c.status === 'unknown') return;
        const li = document.createElement('li');
        li.className = 'st-cap';
        li.dataset.status = c.status;

        const icon = document.createElement('span');
        icon.className = 'st-cap__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = c.icon;

        const body = document.createElement('span');
        body.className = 'st-cap__body';
        const name = document.createElement('strong');
        name.textContent = c.label;
        body.appendChild(name);
        if (c.reason) {
          const why = document.createElement('small');
          why.textContent = c.reason;
          body.appendChild(why);
        }

        const mark = document.createElement('span');
        mark.className = 'st-cap__mark';
        mark.textContent = c.status === 'yes' ? 'Yes' : (c.status === 'marginal' ? 'Just' : 'No');
        // The visual mark is colour-coded, so give assistive tech the words.
        mark.setAttribute('aria-label',
          c.status === 'yes' ? 'Supported' : (c.status === 'marginal' ? 'Only just supported' : 'Not supported'));

        li.appendChild(icon);
        li.appendChild(body);
        li.appendChild(mark);
        capsEl.appendChild(li);
      });
      capsEl.hidden = caps.every((c) => c.status === 'unknown');
    };

    const renderTransferTimes = (r) => {
      if (!transferEl || !ENGINE) return;
      clear(transferEl);
      if (!Number.isFinite(r.downloadMbps) || r.downloadMbps <= 0) { transferEl.hidden = true; return; }
      ENGINE.transferTimes(r.downloadMbps).forEach((t) => {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = t.label;
        const val = document.createElement('b');
        val.textContent = t.text;
        li.appendChild(label);
        li.appendChild(val);
        transferEl.appendChild(li);
      });
      transferEl.hidden = false;
    };

    // Comparing against this device's own history is the only honest
    // comparison available — there is no shared database behind this tool.
    const renderComparison = (r) => {
      if (!comparisonEl || !ENGINE) return;
      const cmp = ENGINE.compareToHistory(r, state.history || []);
      if (!cmp) { comparisonEl.hidden = true; return; }
      const pct = Math.abs(Math.round(cmp.deltaPercent));
      let text;
      if (cmp.isBest) {
        text = 'That is the fastest result recorded on this device.';
      } else if (cmp.direction === 'same') {
        text = 'About the same as your average of ' + ENGINE.formatMbps(cmp.averageMbps) +
          ' across ' + cmp.runs + ' previous run' + (cmp.runs === 1 ? '' : 's') + '.';
      } else {
        text = pct + '% ' + cmp.direction + ' than your average of ' +
          ENGINE.formatMbps(cmp.averageMbps) + ' across ' + cmp.runs +
          ' previous run' + (cmp.runs === 1 ? '' : 's') + '.';
      }
      comparisonEl.textContent = text;
      comparisonEl.dataset.direction = cmp.isBest ? 'best' : cmp.direction;
      comparisonEl.hidden = false;
    };

    // --- History ---
    const renderHistory = () => {
      if (!historyList) return; // history UI removed
      const hist = state.history;
      historyList.innerHTML = '';
      if (!hist.length) { setHistoryEmptyVisible(true); return; }
      setHistoryEmptyVisible(false);

      hist.slice().sort((a, b) => b.timestamp - a.timestamp).forEach((item) => {
        const card = document.createElement('div');
        card.className = 'speedtest-history-item';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.setAttribute('aria-label', 'Load this saved test result');
        const time = new Date(item.timestamp).toLocaleString();
        card.innerHTML = `
          <div class="speedtest-history-item__top">
            <div class="speedtest-history-item__time">${time}</div>
            <div class="speedtest-history-item__tag">${item.label || 'Result'}</div>
          </div>
          <div class="speedtest-history-item__grid">
            <div class="speedtest-history-kv"><div class="speedtest-history-kv__label">DL</div><div class="speedtest-history-kv__value">${formatMbps(item.downloadMbps)}</div></div>
            <div class="speedtest-history-kv"><div class="speedtest-history-kv__label">UL</div><div class="speedtest-history-kv__value">${formatMbps(item.uploadMbps)}</div></div>
            <div class="speedtest-history-kv"><div class="speedtest-history-kv__label">Ping</div><div class="speedtest-history-kv__value">${formatMs(item.pingMs)}</div></div>
            <div class="speedtest-history-kv"><div class="speedtest-history-kv__label">Jitter</div><div class="speedtest-history-kv__value">${formatMs(item.jitterMs)}</div></div>
          </div>`;
        const apply = () => {
          state.lastResult = item;
          fillFinalCards(item);
          setGaugeProgress(Number(item.downloadMbps) || 0);
          setLiveMetrics(item);
          enableResultActions(true);
        };
        card.addEventListener('click', apply);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } });
        historyList.appendChild(card);
      });
    };

    const loadHistory = () => {
      if (!historyList) return; // history UI removed
      const raw = safeLocalStorageGet(DEFAULTS.historyKey);
      const parsed = raw ? safeJsonParse(raw) : null;
      state.history = Array.isArray(parsed) ? parsed : [];
      renderHistory();
    };
    const saveHistoryItem = (item) => {
      state.history = [item, ...state.history].slice(0, DEFAULTS.historyMaxItems);
      safeLocalStorageSet(DEFAULTS.historyKey, JSON.stringify(state.history));
    };

    const enableResultActions = (enabled) => {
      setEnabled(copyBtn, enabled);
      setEnabled(shareBtn, enabled);
      setEnabled(downloadImageBtn, enabled);
      setEnabled(downloadPdfBtn, enabled);
      if (downloadImageBtn && !enabled) downloadImageBtn.removeAttribute('href');
    };

    // --- Share / Copy ---
    const composeResultsText = (r) => {
      const time = new Date(r.timestamp).toLocaleString();
      return [
        'Internet Speed Test (ToolAdda)',
        `Time: ${time}`,
        `Download: ${formatMbps(r.downloadMbps)}`,
        `Upload: ${formatMbps(r.uploadMbps)}`,
        `Ping/Latency: ${formatMs(r.pingMs)}`,
        `Jitter: ${formatMs(r.jitterMs)}`,
        `Tested at: ${window.location.href}`,
      ].join('\n');
    };
    const copyResults = async () => {
      const r = state.lastResult; if (!r) return;
      const text = composeResultsText(r);
      try { await navigator.clipboard.writeText(text); }
      catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ }
        document.body.removeChild(ta);
      }
      const o = copyBtn.textContent; copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = o || 'Copy results'; }, 1400);
    };
    const shareResults = async () => {
      const r = state.lastResult; if (!r) return;
      const text = composeResultsText(r);
      if (navigator.share) {
        try { await navigator.share({ title: 'Internet Speed Test', text, url: window.location.href }); return; }
        catch { /* cancelled -> fall through */ }
      }
      await copyResults();
      const o = shareBtn.textContent; shareBtn.textContent = 'Copied to clipboard';
      setTimeout(() => { shareBtn.textContent = o || 'Share results'; }, 1400);
    };

    // --- Result image (PNG) ---
    const buildResultImage = async () => {
      const r = state.lastResult; if (!r) return;
      const w = 1200, h = 630;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const bg = isDark ? '#0b1220' : '#f8fafc', fg = isDark ? '#e5e7eb' : '#111827', muted = isDark ? '#9ca3af' : '#6b7280';
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const grd = ctx.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#4f46e5'); grd.addColorStop(1, '#22c55e');
      ctx.fillStyle = fg; ctx.font = '900 48px Inter, Arial, sans-serif'; ctx.fillText('Internet Speed Test', 60, 110);
      ctx.fillStyle = muted; ctx.font = '700 26px Inter, Arial, sans-serif'; ctx.fillText('ToolAdda', 60, 150);
      ctx.font = '700 22px Inter, Arial, sans-serif'; ctx.fillText(new Date(r.timestamp).toLocaleString(), 60, 195);
      const cx = 350, cy = 410, rad = 150;
      ctx.lineWidth = 22; ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(15,23,42,0.10)';
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
      const pct = Math.max(0, Math.min(DEFAULTS.gaugeMaxMbps, Number(r.downloadMbps) || 0)) / DEFAULTS.gaugeMaxMbps;
      ctx.strokeStyle = grd; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = fg; ctx.font = '900 52px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${formatNumber(Number(r.downloadMbps) || 0, 1)}`, cx, cy + 6);
      ctx.fillStyle = muted; ctx.font = '800 26px Inter, Arial, sans-serif'; ctx.fillText('Mbps download', cx, cy + 44); ctx.textAlign = 'left';
      const sx = 560, sy = 250, cw = 560, gy = 110;
      const drawCard = (label, value, idx) => {
        const x = sx, y = sy + idx * gy, radius = 24;
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.70)' : 'rgba(255,255,255,0.85)';
        ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(79,70,229,0.16)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + radius, y);
        ctx.arcTo(x + cw, y, x + cw, y + 70, radius); ctx.arcTo(x + cw, y + 70, x, y + 70, radius);
        ctx.arcTo(x, y + 70, x, y, radius); ctx.arcTo(x, y, x + cw, y, radius); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = muted; ctx.font = '900 22px Inter, Arial, sans-serif'; ctx.fillText(label, x + 28, y + 40);
        ctx.fillStyle = fg; ctx.font = '900 32px Inter, Arial, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(value, x + cw - 28, y + 46); ctx.textAlign = 'left';
      };
      drawCard('Download', formatMbps(r.downloadMbps), 0);
      drawCard('Upload', formatMbps(r.uploadMbps), 1);
      drawCard('Ping / Latency', formatMs(r.pingMs), 2);
      drawCard('Jitter', formatMs(r.jitterMs), 3);
      const blobUrl = await new Promise((res) => canvas.toBlob((b) => res(b ? URL.createObjectURL(b) : null), 'image/png'));
      if (!blobUrl) return;
      downloadImageBtn.href = blobUrl; downloadImageBtn.download = 'tooladda-speedtest.png';
      setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } }, 30000);
    };

    // --- Measurements ---
    async function measurePing({ signal }) {
      // Find a reachable ping URL.
      let pingUrl = null;
      for (const u of DEFAULTS.pingProviders) {
        try {
          const res = await fetch(bust(u), { method: 'GET', signal, cache: 'no-store' });
          if (res.ok) { await res.arrayBuffer(); pingUrl = u; break; }
        } catch { /* try next */ }
        if (signal.aborted || state.cancelled) break;
      }
      if (!pingUrl) return { pingMs: NaN, jitterMs: NaN, samples: 0 };

      const samples = [];
      for (let i = 0; i < DEFAULTS.pingSamples; i++) {
        if (state.cancelled || signal.aborted) break;
        const t0 = now();
        try {
          const res = await fetch(bust(pingUrl), { method: 'GET', signal, cache: 'no-store' });
          if (!res.ok) throw new Error('ping ' + res.status);
          await res.arrayBuffer();
          samples.push(now() - t0);
        } catch { samples.push(null); }
        await sleep(DEFAULTS.pingIntervalMs);
      }
      const valid = samples.filter((x) => typeof x === 'number' && Number.isFinite(x));
      if (!valid.length) return { pingMs: NaN, jitterMs: NaN, samples: 0 };
      const sorted = valid.slice().sort((a, b) => a - b);
      const trimmed = sorted.length > 3 ? sorted.slice(0, -1) : sorted;
      const pingMs = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      let diffs = [];
      for (let i = 1; i < valid.length; i++) diffs.push(Math.abs(valid[i] - valid[i - 1]));
      const jitterMs = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
      return { pingMs, jitterMs, samples: valid.length };
    }

    // Download using N parallel streams from one provider.
    async function downloadWithProvider(provider, { signal, onProgress }) {
      const duration = DEFAULTS.downloadDurationMs;
      const warmup = DEFAULTS.downloadWarmupMs;
      const start = now();
      const endAt = start + duration;

      let totalBytes = 0;
      let measuredBytes = 0;
      let measureStart = null;
      let firstOk = false;

      const report = (t) => {
        if (!onProgress || measureStart === null) return;
        const secs = (t - measureStart) / 1000;
        if (secs > 0.15) onProgress(toMbps(measuredBytes, secs));
      };

      const streamLoop = async () => {
        while (now() < endAt && !signal.aborted && !state.cancelled) {
          const url = bust(provider.url(provider.chunkBytes));
          const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
          if (!res.ok) throw new Error(`${provider.name} HTTP ${res.status}`);
          firstOk = true;
          if (!res.body || typeof res.body.getReader !== 'function') {
            const buf = await res.arrayBuffer();
            const t = now();
            totalBytes += buf.byteLength;
            if (t - start >= warmup) { if (measureStart === null) measureStart = t; measuredBytes += buf.byteLength; }
            report(t);
            continue;
          }
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const t = now();
            if (value) {
              totalBytes += value.byteLength;
              if (t - start >= warmup) { if (measureStart === null) measureStart = t; measuredBytes += value.byteLength; }
            }
            report(t);
            if (t >= endAt || signal.aborted || state.cancelled) { try { await reader.cancel(); } catch { /* ignore */ } return; }
          }
        }
      };

      const streams = Math.max(1, DEFAULTS.downloadStreams);
      const runners = [];
      for (let i = 0; i < streams; i++) runners.push(streamLoop());
      // If the very first connection cannot open, this rejects fast -> fallback.
      await Promise.allSettled(runners);

      if (!firstOk) throw new Error(`${provider.name} unreachable`);
      if (measuredBytes === 0 && totalBytes === 0) throw new Error(`${provider.name} returned no data`);

      const secs = measureStart !== null ? (now() - measureStart) / 1000 : (now() - start) / 1000;
      const mbps = toMbps(measuredBytes || totalBytes, secs);
      return { mbps, bytes: totalBytes, provider: provider.name };
    }

    async function measureDownload(ctx) {
      let lastErr = null;
      for (const provider of DEFAULTS.downloadProviders) {
        if (ctx.signal.aborted || state.cancelled) break;
        try {
          const res = await downloadWithProvider(provider, ctx);
          if (Number.isFinite(res.mbps)) return res;
        } catch (e) { lastErr = e; /* try next provider */ }
      }
      throw lastErr || new Error('All download providers failed');
    }

    async function uploadWithProvider(provider, { signal, onProgress }) {
      const duration = DEFAULTS.uploadDurationMs;
      const warmup = DEFAULTS.uploadWarmupMs;
      const chunkBytes = provider.chunkBytes;
      const payload = new Uint8Array(chunkBytes);
      for (let i = 0; i < chunkBytes; i += 4096) payload[i] = (i * 31) & 0xff;

      const start = now();
      const endAt = start + duration;
      let sentBytes = 0, measuredBytes = 0, measureStart = null, firstOk = false;

      const report = (t) => {
        if (!onProgress || measureStart === null) return;
        const secs = (t - measureStart) / 1000;
        if (secs > 0.15) onProgress(toMbps(measuredBytes, secs));
      };

      const streamLoop = async () => {
        while (now() < endAt && !signal.aborted && !state.cancelled) {
          const reqStart = now();
          const res = await fetch(bust(provider.url()), {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: payload, signal,
          });
          // Response headers arrive only after the server has received the
          // full request body, so THIS is when the upload finished. Timing
          // here (not after downloading the response) keeps upload accurate
          // even with echo endpoints that send the data back.
          const t = now();
          if (!res.ok) throw new Error(`${provider.name} HTTP ${res.status}`);
          firstOk = true;
          res.arrayBuffer().catch(() => {}); // drain body in background, untimed
          sentBytes += chunkBytes;
          // Only count a chunk if its upload STARTED after warmup, and start
          // the measurement clock at that request's start. This avoids
          // crediting a full chunk's bytes with zero elapsed time (which
          // would over-report the speed).
          if (reqStart - start >= warmup) {
            if (measureStart === null) measureStart = reqStart;
            measuredBytes += chunkBytes;
          }
          report(t);
        }
      };

      const streams = Math.max(1, DEFAULTS.uploadStreams || 1);
      const runners = [];
      for (let i = 0; i < streams; i++) runners.push(streamLoop());
      await Promise.allSettled(runners);

      if (!firstOk || sentBytes === 0) throw new Error(`${provider.name} upload failed`);
      const secs = measureStart !== null ? (now() - measureStart) / 1000 : (now() - start) / 1000;
      const mbps = measuredBytes > 0 ? toMbps(measuredBytes, secs) : toMbps(sentBytes, (now() - start) / 1000);
      return { mbps, provider: provider.name };
    }

    async function measureUpload(ctx) {
      let lastErr = null;
      for (const provider of DEFAULTS.uploadProviders) {
        if (ctx.signal.aborted || state.cancelled) break;
        try {
          const res = await uploadWithProvider(provider, ctx);
          if (Number.isFinite(res.mbps)) return res;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('All upload providers failed');
    }

    // --- Orchestration ---
    async function runTest() {
      state.running = true;
      state.cancelled = false;
      clearMessage();
      enableResultActions(false);

      startBtn.disabled = true;
      startBtn.textContent = 'Testing…';

      setLiveMetrics({ downloadMbps: NaN, uploadMbps: NaN, pingMs: NaN, jitterMs: NaN });
      setCircularProgress(0);
      setGaugeProgress(0);
      setGaugeHint('Testing…');
      if (needle) needle.dataset.anim = 'spinning';

      const AC = window.AbortController || null;
      const abortController = AC ? new AC() : null;
      state.abortController = abortController;
      const signal = abortController ? abortController.signal : { aborted: false };
      const t0 = now();

      try {
        // 1) Ping (non-fatal)
        setStatus('Connecting…', 'connecting');
        setGaugeLabel('Ping');
        setCircularProgress(6);
        await sleep(100);
        if (state.cancelled) return;

        const pingRes = await measurePing({ signal });
        setLiveMetrics({ pingMs: pingRes.pingMs, jitterMs: pingRes.jitterMs });
        setCircularProgress(20);

        // 2) Download (fatal only if all providers fail)
        setStatus('Testing download…', 'downloading');
        setGaugeLabel('Download');
        if (needle) needle.dataset.anim = '';
        let downloadRes;
        try {
          downloadRes = await measureDownload({
            signal,
            onProgress: (mbps) => {
              setLiveMetrics({ downloadMbps: mbps });
              setGaugeProgress(mbps);
              setCircularProgress(20 + Math.min(48, (mbps / DEFAULTS.gaugeMaxMbps) * 48));
            },
          });
        } catch (err) {
          throw new Error(
            'Could not reach any speed test server. This is usually caused by an ad blocker, ' +
            'firewall, or offline connection. Disable blockers for this page and try again. (' +
            (err && err.message ? err.message : 'network error') + ')'
          );
        }
        setLiveMetrics({ downloadMbps: downloadRes.mbps });
        setGaugeProgress(downloadRes.mbps);
        setCircularProgress(70);

        // 3) Upload (non-fatal)
        setStatus('Testing upload…', 'uploading');
        setGaugeLabel('Upload');
        let uploadMbps = NaN;
        let uploadMeta = '';
        try {
          const up = await measureUpload({
            signal,
            onProgress: (mbps) => {
              setLiveMetrics({ uploadMbps: mbps });
              setGaugeProgress(mbps);
              setCircularProgress(70 + Math.min(26, (mbps / DEFAULTS.gaugeMaxMbps) * 26));
            },
          });
          uploadMbps = up.mbps;
          uploadMeta = ratingFor(uploadMbps) + (up.provider ? ` · via ${up.provider}` : '');
        } catch (err) {
          uploadMbps = NaN;
          uploadMeta = 'Upload unavailable on this network';
        }
        setLiveMetrics({ uploadMbps });

        const result = {
          timestamp: Date.now(),
          downloadMbps: downloadRes.mbps,
          uploadMbps,
          pingMs: pingRes.pingMs,
          jitterMs: pingRes.jitterMs,
          label: 'Speed Test',
          durationMs: now() - t0,
          downloadMeta: ratingFor(downloadRes.mbps) + (downloadRes.provider ? ` · via ${downloadRes.provider}` : ''),
          uploadMeta,
          pingMeta: Number.isFinite(pingRes.pingMs) ? pingRating(pingRes.pingMs) + ` · ${pingRes.samples} samples` : 'Latency unavailable',
          jitterMeta: Number.isFinite(pingRes.jitterMs) ? 'From latency variance' : '',
        };

        state.lastResult = result;
        saveHistoryItem(result);
        renderHistory();
        fillFinalCards(result);
        setGaugeLabel('Download');
        setGaugeProgress(result.downloadMbps);
        setCircularProgress(100);
        setStatus('Complete', 'complete');
        enableResultActions(true);
        setGaugeHint('Start');
        revealResults();

        if (!Number.isFinite(uploadMbps) || !Number.isFinite(pingRes.pingMs)) {
          showMessage('Test complete. Some metrics were unavailable on this network, but your download speed was measured successfully.', false);
        }
      } catch (err) {
        console.error('[speedtest] runTest error', err);
        setStatus('Failed', 'error');
        showMessage(err && err.message ? err.message : 'Speed test failed due to a network error.');
        setGaugeHint('Start');
      } finally {
        if (needle) needle.dataset.anim = '';
        state.running = false;
        state.abortController = null;
        startBtn.disabled = false;
        startBtn.textContent = 'Start Test';
      }
    }

    // --- Events ---
    startBtn.addEventListener('click', () => { if (!state.running) runTest(); });
    if (gauge) {
      const handleGaugeStart = (event) => {
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        if (event.type === 'keydown') event.preventDefault();
        if (!state.running) runTest();
      };
      gauge.addEventListener('click', handleGaugeStart);
      gauge.addEventListener('keydown', handleGaugeStart);
    }
    if (copyBtn) copyBtn.addEventListener('click', copyResults);
    if (shareBtn) shareBtn.addEventListener('click', shareResults);

    if (downloadImageBtn) {
      downloadImageBtn.addEventListener('click', async (e) => {
        if (downloadImageBtn.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
        if (!downloadImageBtn.getAttribute('href')) {
          e.preventDefault();
          await buildResultImage();
          if (downloadImageBtn.getAttribute('href')) downloadImageBtn.click();
        }
      });
    }
    if (downloadPdfBtn) {
      downloadPdfBtn.addEventListener('click', () => {
        if (downloadPdfBtn.getAttribute('aria-disabled') === 'true') return;
        window.print();
      });
    }

    if (clearHistory) {
      clearHistory.addEventListener('click', () => {
        safeLocalStorageSet(DEFAULTS.historyKey, JSON.stringify([]));
        state.history = [];
        state.lastResult = null;
        historyList.innerHTML = '';
        setHistoryEmptyVisible(true);
        setLiveMetrics({ downloadMbps: NaN, uploadMbps: NaN, pingMs: NaN, jitterMs: NaN });
        finalDownload.textContent = '— Mbps';
        finalUpload.textContent = '— Mbps';
        finalPing.textContent = '— ms';
        finalJitter.textContent = '— ms';
        finalDownloadMeta.textContent = '';
        finalUploadMeta.textContent = '';
        finalPingMeta.textContent = '';
        finalJitterMeta.textContent = '';
        setGaugeProgress(0);
        clearMessage();
        enableResultActions(false);
      });
    }

    // --- Init ---
    setStatus('Ready', 'idle');
    setGaugeLabel('Download');
    setGaugeHint('Start');
    setCircularProgress(0);
    setGaugeProgress(0);
    enableResultActions(false);
    loadHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
