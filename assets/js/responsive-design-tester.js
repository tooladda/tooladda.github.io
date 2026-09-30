/* Responsive Design Tester — device preview for any URL or pasted markup.

   The whole tool is a real iframe sized to a real CSS viewport. Nothing is
   simulated with a screenshot: the page inside genuinely lays out at 390x844
   and its own media queries fire, which is the only way a preview is worth
   anything. Zoom is applied as a transform on the wrapper so the iframe keeps
   its true pixel size while still fitting on screen.

   The one thing a static site cannot do is proxy. Sites that send
   X-Frame-Options: DENY or a CSP frame-ancestors rule refuse to load in any
   iframe, and there is no client-side way around that - it is the whole point
   of the header. So the tool detects the refusal as best it can and hands the
   visitor the two routes that DO work for any site: a real popup window opened
   at the exact device size, and a QR code to open it on the phone in their
   hand. Being honest about the wall beats pretending it is not there. */
(function () {
  'use strict';

  /* ---------- device catalogue ----------
     Sizes are CSS viewport pixels, not physical panel pixels - that is what a
     media query actually sees. dpr is listed because it changes which image a
     srcset picks, which is a real thing people come here to check. */
  const DEVICES = [
    // --- phones ---
    { id: 'iphone-se',        name: 'iPhone SE (3rd gen)',   w: 375,  h: 667,  dpr: 2,    group: 'Phones' },
    { id: 'iphone-13-mini',   name: 'iPhone 13 mini',        w: 375,  h: 812,  dpr: 3,    group: 'Phones' },
    { id: 'iphone-13',        name: 'iPhone 13 / 14',        w: 390,  h: 844,  dpr: 3,    group: 'Phones', notch: true },
    { id: 'iphone-15',        name: 'iPhone 15 / 16',        w: 393,  h: 852,  dpr: 3,    group: 'Phones', notch: true },
    { id: 'iphone-14-plus',   name: 'iPhone 14 Plus',        w: 428,  h: 926,  dpr: 3,    group: 'Phones', notch: true },
    { id: 'iphone-15-pro-max',name: 'iPhone 15/16 Pro Max',  w: 430,  h: 932,  dpr: 3,    group: 'Phones', notch: true },
    { id: 'iphone-xr',        name: 'iPhone XR / 11',        w: 414,  h: 896,  dpr: 2,    group: 'Phones', notch: true },
    { id: 'galaxy-s22',       name: 'Galaxy S22 / S24',      w: 360,  h: 780,  dpr: 3,    group: 'Phones' },
    { id: 'galaxy-s23-ultra', name: 'Galaxy S23 Ultra',      w: 384,  h: 824,  dpr: 3.75, group: 'Phones' },
    { id: 'galaxy-a54',       name: 'Galaxy A54',            w: 360,  h: 800,  dpr: 3,    group: 'Phones' },
    { id: 'pixel-7',          name: 'Pixel 7 / 7 Pro',       w: 412,  h: 915,  dpr: 2.625,group: 'Phones' },
    { id: 'pixel-8-pro',      name: 'Pixel 8 Pro',           w: 448,  h: 992,  dpr: 2.625,group: 'Phones' },
    { id: 'oneplus-12',       name: 'OnePlus 12',            w: 412,  h: 919,  dpr: 3,    group: 'Phones' },
    { id: 'redmi-note',       name: 'Redmi Note 13',         w: 393,  h: 873,  dpr: 2.75, group: 'Phones' },
    { id: 'z-flip-folded',    name: 'Galaxy Z Flip (cover)', w: 344,  h: 882,  dpr: 2.6,  group: 'Phones' },
    { id: 'z-fold-open',      name: 'Galaxy Z Fold (open)',  w: 768,  h: 812,  dpr: 2.6,  group: 'Phones' },
    // --- tablets ---
    { id: 'ipad-mini',        name: 'iPad mini',             w: 768,  h: 1024, dpr: 2,    group: 'Tablets' },
    { id: 'ipad',             name: 'iPad 10.2"',            w: 810,  h: 1080, dpr: 2,    group: 'Tablets' },
    { id: 'ipad-air',         name: 'iPad Air',              w: 820,  h: 1180, dpr: 2,    group: 'Tablets' },
    { id: 'ipad-pro-11',      name: 'iPad Pro 11"',          w: 834,  h: 1194, dpr: 2,    group: 'Tablets' },
    { id: 'ipad-pro-13',      name: 'iPad Pro 12.9"',        w: 1024, h: 1366, dpr: 2,    group: 'Tablets' },
    { id: 'galaxy-tab-s9',    name: 'Galaxy Tab S9',         w: 800,  h: 1280, dpr: 2.4,  group: 'Tablets' },
    { id: 'surface-pro',      name: 'Surface Pro',           w: 912,  h: 1368, dpr: 2,    group: 'Tablets' },
    // --- desktops ---
    { id: 'laptop-hd',        name: 'Laptop 1366×768',       w: 1366, h: 768,  dpr: 1,    group: 'Laptops & desktops' },
    { id: 'macbook-air',      name: 'MacBook Air 13"',       w: 1280, h: 800,  dpr: 2,    group: 'Laptops & desktops' },
    { id: 'macbook-pro-14',   name: 'MacBook Pro 14"',       w: 1512, h: 982,  dpr: 2,    group: 'Laptops & desktops' },
    { id: 'macbook-pro-16',   name: 'MacBook Pro 16"',       w: 1728, h: 1117, dpr: 2,    group: 'Laptops & desktops' },
    { id: 'desktop-hd',       name: 'Desktop 1440×900',      w: 1440, h: 900,  dpr: 1,    group: 'Laptops & desktops' },
    { id: 'desktop-fhd',      name: 'Desktop 1920×1080',     w: 1920, h: 1080, dpr: 1,    group: 'Laptops & desktops' }
  ];

  /* Breakpoint tables, so the readout can say what a width actually triggers
     rather than leaving the arithmetic to the visitor. */
  const TAILWIND = [['2xl', 1536], ['xl', 1280], ['lg', 1024], ['md', 768], ['sm', 640]];
  const BOOTSTRAP = [['xxl', 1400], ['xl', 1200], ['lg', 992], ['md', 768], ['sm', 576]];

  /* Bezel thickness per side, mirrored in .rdt-shell.is-framed padding. The
     framed shell is content-box, so this grows outward and must be added back
     whenever we measure or scale. */
  const BEZEL = 12;
  const bezelPad = () => (state.frame ? BEZEL * 2 : 0);

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const root = $('[data-rdt-root]');
  if (!root) return;

  const el = {
    form: $('[data-rdt-form]', root),
    url: $('[data-rdt-url]', root),
    go: $('[data-rdt-go]', root),
    device: $('[data-rdt-device]', root),
    rotate: $('[data-rdt-rotate]', root),
    zoom: $('[data-rdt-zoom]', root),
    frame: $('[data-rdt-frame]', root),
    compare: $('[data-rdt-compare]', root),
    stage: $('[data-rdt-stage]', root),
    readout: $('[data-rdt-readout]', root),
    status: $('[data-rdt-status]', root),
    reload: $('[data-rdt-reload]', root),
    popup: $('[data-rdt-popup]', root),
    share: $('[data-rdt-share]', root),
    qrBtn: $('[data-rdt-qr-btn]', root),
    qrBox: $('[data-rdt-qr]', root),
    qrOut: $('[data-rdt-qr-out]', root),
    qrClose: $('[data-rdt-qr-close]', root),
    modeUrl: $('[data-rdt-mode="url"]', root),
    modeHtml: $('[data-rdt-mode="html"]', root),
    htmlPanel: $('[data-rdt-html-panel]', root),
    htmlInput: $('[data-rdt-html-input]', root),
    htmlRun: $('[data-rdt-html-run]', root),
    urlPanel: $('[data-rdt-url-panel]', root),
    cmpPanel: $('[data-rdt-cmp-panel]', root),
    cmpList: $('[data-rdt-cmp-list]', root),
    customW: $('[data-rdt-cw]', root),
    customH: $('[data-rdt-ch]', root),
    customGo: $('[data-rdt-custom-go]', root),
    reset: $('[data-rdt-reset]', root)
  };

  const STORE = 'tooladda-rdt';
  const state = {
    mode: 'url',
    url: '',
    html: '',
    device: 'iphone-15',
    landscape: false,
    zoom: 'fit',
    frame: true,
    compare: false,
    picked: ['iphone-15', 'ipad-air', 'desktop-hd']
  };

  const byId = (id) => DEVICES.filter((d) => d.id === id)[0] || DEVICES[0];

  /* ---------- persistence ---------- */
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        url: state.url, device: state.device, landscape: state.landscape,
        zoom: state.zoom, frame: state.frame, compare: state.compare, picked: state.picked
      }));
    } catch (e) {}
  };
  const load = () => {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        if (s.url) state.url = s.url;
        if (s.device && byId(s.device).id === s.device) state.device = s.device;
        if (typeof s.landscape === 'boolean') state.landscape = s.landscape;
        if (s.zoom) state.zoom = s.zoom;
        if (typeof s.frame === 'boolean') state.frame = s.frame;
        if (typeof s.compare === 'boolean') state.compare = s.compare;
        if (Array.isArray(s.picked) && s.picked.length) state.picked = s.picked.slice(0, 6);
      }
    } catch (e) {}
  };

  /* ---------- url handling ---------- */
  /* People paste "example.com". Default to https rather than http: an http
     frame inside this https page is mixed content and the browser blocks it
     silently, which looks exactly like an X-Frame-Options refusal. */
  function normalise(raw) {
    let v = String(raw || '').trim();
    if (!v) return '';
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(v)) v = 'http://' + v;
    else if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.href;
    } catch (e) { return ''; }
  }

  function isInsecure(href) {
    return /^http:\/\//i.test(href) && location.protocol === 'https:';
  }

  /* ---------- geometry ---------- */
  function dims(d) {
    return state.landscape ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
  }

  function breakpoints(w) {
    const pick = (table) => {
      for (let i = 0; i < table.length; i++) if (w >= table[i][1]) return table[i][0];
      return 'base';
    };
    return { tw: pick(TAILWIND), bs: pick(BOOTSTRAP) };
  }

  /* Work out the scale that fits a device box into the stage. "fit" never
     scales above 1 - blowing a 375px phone up to fill a 27" monitor would
     misrepresent it. */
  function scaleFor(w, h) {
    if (state.zoom !== 'fit') return parseFloat(state.zoom);
    const box = el.stage.getBoundingClientRect();
    const padX = 48, padY = 40;
    const avail = { w: Math.max(200, box.width - padX), h: Math.max(200, box.height - padY) };
    const pad = bezelPad();
    return Math.min(1, avail.w / (w + pad), avail.h / (h + pad));
  }

  /* ---------- frame building ---------- */
  function buildFrame(device, opts) {
    const o = opts || {};
    const d = dims(device);
    const scale = o.scale != null ? o.scale : scaleFor(d.w, d.h);

    const shell = document.createElement('div');
    shell.className = 'rdt-shell' + (state.frame ? ' is-framed' : '') + (device.notch && state.frame && !state.landscape ? ' has-notch' : '');
    shell.style.width = d.w + 'px';
    shell.style.height = d.h + 'px';
    shell.style.transform = 'scale(' + scale + ')';

    const frame = document.createElement('div');
    frame.className = 'rdt-screen';

    const iframe = document.createElement('iframe');
    iframe.className = 'rdt-frame';
    iframe.title = device.name + ' preview';
    iframe.setAttribute('loading', 'eager');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    iframe.setAttribute('allow', 'clipboard-write; fullscreen; geolocation; microphone; camera');
    if (state.mode === 'html') {
      /* Pasted markup runs with an opaque origin - allow-same-origin is
         deliberately absent, so the snippet can run its own scripts but can
         never reach into this page, its storage or its cookies. */
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
      iframe.srcdoc = state.html || '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font:16px system-ui;padding:1rem">Paste some HTML and press Render.</p>';
    } else {
      iframe.src = o.url || state.url;
    }
    frame.appendChild(iframe);
    shell.appendChild(frame);

    if (state.frame) {
      const bezelTop = document.createElement('span');
      bezelTop.className = 'rdt-bezel rdt-bezel--top';
      bezelTop.setAttribute('aria-hidden', 'true');
      shell.appendChild(bezelTop);
    }

    // The scaled element still reserves its unscaled box in layout, so wrap it
    // in a spacer sized to the visual result to keep the grid honest.
    const slot = document.createElement('div');
    slot.className = 'rdt-slot';
    const pad = bezelPad();
    slot.style.width = Math.round((d.w + pad) * scale) + 'px';
    slot.style.height = Math.round((d.h + pad) * scale) + 'px';
    slot.appendChild(shell);

    return { slot: slot, iframe: iframe, scale: scale, w: d.w, h: d.h };
  }

  /* ---------- blocked-frame detection ----------
     Best effort, and the copy says so. When a site refuses to be framed the
     browser leaves the iframe parked on about:blank, which is same-origin and
     therefore readable. A site that DID load is cross-origin, so the same read
     throws a SecurityError - the throw is the success signal here. */
  function probe(iframe, onResult) {
    let settled = false;
    const finish = (verdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(slow);
      onResult(verdict);
    };

    const check = () => {
      try {
        const href = iframe.contentWindow.location.href;
        finish(href === 'about:blank' ? 'blocked' : 'ok');
      } catch (e) {
        finish('ok');
      }
    };

    iframe.addEventListener('load', () => setTimeout(check, 60), { once: true });
    iframe.addEventListener('error', () => finish('blocked'), { once: true });
    const slow = setTimeout(() => finish('slow'), 9000);
  }

  function setStatus(kind, html) {
    el.status.className = 'rdt-status is-' + kind;
    el.status.innerHTML = html;
    el.status.hidden = false;
  }
  function clearStatus() { el.status.hidden = true; el.status.innerHTML = ''; }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function blockedMessage() {
    setStatus('warn',
      '<strong>This site refused to load in a frame.</strong> ' +
      'That is the site\'s own <code>X-Frame-Options</code> or <code>Content-Security-Policy</code> header doing its job — ' +
      'no preview tool can override it from the browser, and one that claims to is running a server-side proxy. ' +
      'Both buttons below still work on any site: <em>Open at this size</em> gives you a real window at the exact device width, ' +
      'and <em>QR code</em> puts it on the phone in your hand.'
    );
  }

  /* ---------- render ---------- */
  let renderTimer = null;
  function render() {
    if (state.mode === 'url' && !state.url) {
      el.stage.innerHTML = '<div class="rdt-empty"><p><strong>Enter a URL to begin.</strong></p>' +
        '<p>Or switch to <em>Paste HTML</em> to preview markup straight from your editor — that mode works on every page, ' +
        'because nothing has to be fetched.</p></div>';
      el.readout.textContent = '';
      return;
    }

    el.stage.innerHTML = '';
    clearStatus();

    if (state.mode === 'url' && isInsecure(state.url)) {
      setStatus('warn',
        '<strong>That is an <code>http://</code> address.</strong> This page is served over HTTPS, so the browser blocks ' +
        'the insecure frame as mixed content — it will look identical to a site refusing to be framed. ' +
        'Use the <em>Open at this size</em> button instead, which is not affected.'
      );
    }

    if (state.compare && state.mode === 'url') {
      const wrap = document.createElement('div');
      wrap.className = 'rdt-compare';
      state.picked.forEach((id) => {
        const d = byId(id);
        const dd = dims(d);
        // In compare mode every device is scaled to a common target width so
        // the row reads as a comparison rather than a size chart.
        const target = state.picked.length > 3 ? 240 : 320;
        const scale = Math.min(1, target / (dd.w + bezelPad()));
        const built = buildFrame(d, { scale: scale });
        const cell = document.createElement('figure');
        cell.className = 'rdt-cmp-cell';
        cell.appendChild(built.slot);
        const cap = document.createElement('figcaption');
        cap.innerHTML = '<strong>' + esc(d.name) + '</strong><span>' + dd.w + ' × ' + dd.h + '</span>';
        cell.appendChild(cap);
        wrap.appendChild(cell);
      });
      el.stage.appendChild(wrap);
      el.readout.textContent = state.picked.length + ' devices · ' + (state.landscape ? 'landscape' : 'portrait');
      return;
    }

    const d = byId(state.device);
    const built = buildFrame(d);
    el.stage.appendChild(built.slot);

    const dd = dims(d);
    const bp = breakpoints(dd.w);
    el.readout.innerHTML =
      '<span class="rdt-chip">' + dd.w + ' × ' + dd.h + ' CSS px</span>' +
      '<span class="rdt-chip">DPR ' + d.dpr + '</span>' +
      '<span class="rdt-chip">' + Math.round(built.scale * 100) + '% zoom</span>' +
      '<span class="rdt-chip" title="Tailwind breakpoint at this width">Tailwind <b>' + bp.tw + '</b></span>' +
      '<span class="rdt-chip" title="Bootstrap breakpoint at this width">Bootstrap <b>' + bp.bs + '</b></span>';

    if (state.mode === 'url') {
      setStatus('info', 'Loading <code>' + esc(state.url) + '</code> …');
      probe(built.iframe, (verdict) => {
        if (verdict === 'ok') clearStatus();
        else if (verdict === 'blocked') blockedMessage();
        else setStatus('info',
          '<strong>Still loading.</strong> The site is slow to respond, or it is quietly refusing the frame. ' +
          'Give it a moment — if nothing appears, use <em>Open at this size</em> or the QR code.');
      });
    }
  }

  const rerender = () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 40);
  };

  /* ---------- device select ---------- */
  function fillDevices() {
    const groups = {};
    DEVICES.forEach((d) => { (groups[d.group] = groups[d.group] || []).push(d); });
    el.device.innerHTML = '';
    Object.keys(groups).forEach((g) => {
      const og = document.createElement('optgroup');
      og.label = g;
      groups[g].forEach((d) => {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.name + '  ·  ' + d.w + '×' + d.h;
        og.appendChild(o);
      });
      el.device.appendChild(og);
    });
    el.device.value = state.device;
  }

  function fillCompareList() {
    el.cmpList.innerHTML = '';
    DEVICES.forEach((d) => {
      const id = 'rdt-cmp-' + d.id;
      const lab = document.createElement('label');
      lab.className = 'rdt-cmp-opt';
      lab.innerHTML = '<input type="checkbox" id="' + id + '" value="' + d.id + '"' +
        (state.picked.indexOf(d.id) > -1 ? ' checked' : '') + ' /> <span>' + esc(d.name) + '</span>';
      el.cmpList.appendChild(lab);
    });
    el.cmpList.addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      const picked = $$('input:checked', el.cmpList).map((i) => i.value);
      if (picked.length > 6) { cb.checked = false; return; }
      if (!picked.length) { cb.checked = true; return; }
      state.picked = picked;
      save(); rerender();
    });
  }

  /* ---------- share link ---------- */
  function shareURL() {
    const u = new URL(location.href.split('?')[0].split('#')[0]);
    if (state.url) u.searchParams.set('url', state.url);
    u.searchParams.set('device', state.device);
    if (state.landscape) u.searchParams.set('o', 'landscape');
    return u.href;
  }

  function readQuery() {
    const q = new URLSearchParams(location.search);
    const u = q.get('url');
    if (u) { const n = normalise(u); if (n) state.url = n; }
    const dv = q.get('device');
    if (dv && byId(dv).id === dv) state.device = dv;
    if (q.get('o') === 'landscape') state.landscape = true;
  }

  /* ---------- popup at exact size ----------
     The reliable escape hatch. A popup is a top-level browsing context, so
     framing headers do not apply and every site opens. The window chrome eats
     some height, so ask for a little extra and let the OS clamp it. */
  function openPopup() {
    const target = state.mode === 'html' ? '' : state.url;
    if (!target) { el.url.focus(); return; }
    const d = dims(byId(state.device));
    const feat = [
      'width=' + d.w, 'height=' + d.h,
      'left=' + Math.max(0, Math.round((screen.availWidth - d.w) / 2)),
      'top=' + Math.max(0, Math.round((screen.availHeight - d.h) / 2)),
      'menubar=no', 'toolbar=no', 'location=yes', 'status=no', 'resizable=yes', 'scrollbars=yes'
    ].join(',');
    const win = window.open(target, 'rdt_' + state.device, feat);
    if (!win) {
      setStatus('warn', '<strong>The popup was blocked.</strong> Allow popups for this page and press the button again — ' +
        'that window is the one route that works on sites which refuse to be framed.');
    }
  }

  /* ---------- QR ---------- */
  function drawQR() {
    const target = state.url;
    if (!target) { el.url.focus(); return; }
    if (typeof qrcode !== 'function') {
      setStatus('warn', 'The QR library did not load. Reload the page and try again.');
      return;
    }
    try {
      const q = qrcode(0, 'M');
      q.addData(target);
      q.make();
      el.qrOut.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      const svg = el.qrOut.querySelector('svg');
      if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
      el.qrBox.hidden = false;
      el.qrBtn.setAttribute('aria-pressed', 'true');
      el.qrBox.querySelector('[data-rdt-qr-url]').textContent = target;
    } catch (e) {
      setStatus('warn', 'That URL is too long to fit in a QR code.');
    }
  }

  /* ---------- events ---------- */
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = normalise(el.url.value);
    if (!n) { setStatus('warn', 'That does not look like a web address. Try <code>example.com</code> or <code>https://example.com/page</code>.'); return; }
    state.url = n;
    el.url.value = n;
    save(); render();
  });

  el.device.addEventListener('change', () => {
    state.device = el.device.value;
    el.customW.value = ''; el.customH.value = '';
    save(); rerender();
  });

  el.rotate.addEventListener('click', () => {
    state.landscape = !state.landscape;
    el.rotate.setAttribute('aria-pressed', String(state.landscape));
    save(); rerender();
  });

  el.zoom.addEventListener('change', () => { state.zoom = el.zoom.value; rerender(); });

  el.frame.addEventListener('change', () => { state.frame = el.frame.checked; save(); rerender(); });

  el.compare.addEventListener('change', () => {
    state.compare = el.compare.checked;
    el.cmpPanel.hidden = !state.compare;
    save(); rerender();
  });

  el.reload.addEventListener('click', () => render());

  el.popup.addEventListener('click', openPopup);

  const hideQR = () => {
    el.qrBox.hidden = true;
    el.qrBtn.setAttribute('aria-pressed', 'false');
  };
  el.qrBtn.addEventListener('click', () => {
    if (!el.qrBox.hidden) { hideQR(); return; }
    drawQR();
  });
  el.qrClose.addEventListener('click', hideQR);

  el.share.addEventListener('click', () => {
    const link = shareURL();
    const done = (ok) => {
      el.share.textContent = ok ? '✓ Link copied' : 'Copy failed';
      setTimeout(() => { el.share.textContent = 'Copy share link'; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => done(true), () => done(false));
    } else {
      try {
        const t = document.createElement('textarea');
        t.value = link; document.body.appendChild(t); t.select();
        document.execCommand('copy'); document.body.removeChild(t); done(true);
      } catch (e) { done(false); }
    }
  });

  el.customGo.addEventListener('click', () => {
    const w = parseInt(el.customW.value, 10), h = parseInt(el.customH.value, 10);
    if (!(w > 0) || !(h > 0)) { setStatus('warn', 'Enter a width and a height in CSS pixels, for example 412 × 915.'); return; }
    const custom = { id: 'custom', name: 'Custom', w: Math.min(4000, w), h: Math.min(4000, h), dpr: window.devicePixelRatio || 1, group: 'Custom' };
    const i = DEVICES.map((d) => d.id).indexOf('custom');
    if (i > -1) DEVICES.splice(i, 1);
    DEVICES.push(custom);
    state.device = 'custom';
    fillDevices();
    el.device.value = 'custom';
    save(); rerender();
  });

  el.reset.addEventListener('click', () => {
    state.mode = 'url';
    state.url = ''; state.html = '';
    state.device = 'iphone-15';
    state.landscape = false;
    state.zoom = 'fit';
    state.frame = true;
    state.compare = false;
    state.picked = ['iphone-15', 'ipad-air', 'desktop-hd'];
    try { localStorage.removeItem(STORE); } catch (e) {}
    // A shared link would otherwise re-apply its url/device on the next reload.
    try { history.replaceState(null, '', location.pathname); } catch (e) {}

    el.url.value = '';
    el.htmlInput.value = '';
    el.customW.value = ''; el.customH.value = '';
    el.device.value = state.device;
    el.zoom.value = state.zoom;
    el.frame.checked = true;
    el.compare.checked = false;
    el.compare.disabled = false;
    el.cmpPanel.hidden = true;
    el.rotate.setAttribute('aria-pressed', 'false');
    $$('input[type="checkbox"]', el.cmpList).forEach((cb) => { cb.checked = state.picked.indexOf(cb.value) > -1; });
    hideQR();
    setMode('url');
    el.url.focus();
  });

  function setMode(m) {
    state.mode = m;
    el.modeUrl.setAttribute('aria-pressed', String(m === 'url'));
    el.modeHtml.setAttribute('aria-pressed', String(m === 'html'));
    el.urlPanel.hidden = m !== 'url';
    el.htmlPanel.hidden = m !== 'html';
    el.compare.disabled = m === 'html';
    if (m === 'html' && state.compare) { state.compare = false; el.compare.checked = false; el.cmpPanel.hidden = true; }
    clearStatus();
    render();
  }
  el.modeUrl.addEventListener('click', () => setMode('url'));
  el.modeHtml.addEventListener('click', () => setMode('html'));
  el.htmlRun.addEventListener('click', () => { state.html = el.htmlInput.value; render(); });

  /* r rotates, as it does in every browser device toolbar. Skipped while the
     visitor is typing, which is what the tag check is for. */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.target.isContentEditable) return;
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); el.rotate.click(); }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (state.zoom !== 'fit') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rerender, 150);
  });

  /* ---------- boot ---------- */
  load();
  readQuery();          // a shared link wins over whatever was stored
  fillDevices();
  fillCompareList();
  el.url.value = state.url;
  el.rotate.setAttribute('aria-pressed', String(state.landscape));
  el.zoom.value = state.zoom;
  el.frame.checked = state.frame;
  el.compare.checked = state.compare;
  el.cmpPanel.hidden = !state.compare;
  render();
})();
