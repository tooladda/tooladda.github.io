(function () {
  'use strict';

  const page = document.querySelector('[data-utm]');
  if (!page) {
    return;
  }

  const form = page.querySelector('[data-form]');
  const baseInput = page.querySelector('[data-base]');
  const paramInputs = Array.from(page.querySelectorAll('[data-p]'));
  const lowercaseToggle = page.querySelector('[data-lowercase]');
  const clearBtn = page.querySelector('[data-clear]');
  const messageBox = page.querySelector('[data-message]');

  const urlOut = page.querySelector('[data-url]');
  const copyBtn = page.querySelector('[data-copy]');
  const openLink = page.querySelector('[data-open]');
  const downloadQr = page.querySelector('[data-download-qr]');
  const qrCanvas = page.querySelector('[data-qr]');
  const qrWrap = page.querySelector('[data-qr-wrap]');

  const REQUIRED = ['utm_source', 'utm_medium', 'utm_campaign'];
  const PLACEHOLDER = 'Fill in the fields above to build your tracking link…';
  let currentUrl = '';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Render the URL with colored base / keys / values. Keys and values are shown
  // exactly as they are written into the link (encoded), so the preview matches
  // what Copy puts on the clipboard: "spring+sale", not "spring sale".
  const renderHighlighted = (u) => {
    const baseStr = u.origin + u.pathname;
    const params = u.search.slice(1).split('&').filter(Boolean).map((pair) => {
      const i = pair.indexOf('=');
      return i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)];
    });
    let html = '<span class="u-base">' + esc(baseStr) + '</span>';
    if (params.length) {
      html += '<span class="u-q">?</span>';
      html += params.map(([k, v], i) => {
        const amp = i ? '<span class="u-amp">&amp;</span>' : '';
        const keyCls = 'u-key' + (k.indexOf('utm_') === 0 ? ' utm' : '');
        return amp + '<span class="' + keyCls + '">' + esc(k) + '</span><span class="u-eq">=</span><span class="u-val">' + esc(v) + '</span>';
      }).join('');
    }
    if (u.hash) html += '<span class="u-base">' + esc(u.hash) + '</span>';
    urlOut.classList.remove('placeholder');
    urlOut.innerHTML = html;
    urlOut.classList.remove('flash');
    void urlOut.offsetWidth; // reflow to restart animation
    urlOut.classList.add('flash');
  };

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

  const normalizeBase = (value) => {
    let v = value.trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      if (!u.hostname || !u.hostname.includes('.')) return '';
      return u;
    } catch (err) {
      return '';
    }
  };

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
      downloadQr.style.pointerEvents = '';
      downloadQr.style.opacity = '';
      if (qrWrap) qrWrap.classList.remove('empty');
    } catch (err) { /* ignore */ }
  };

  const clearQr = () => {
    if (qrCanvas.width) {
      qrCanvas.getContext('2d').clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    }
    downloadQr.removeAttribute('href');
    downloadQr.style.pointerEvents = 'none';
    downloadQr.style.opacity = '0.5';
    if (qrWrap) qrWrap.classList.add('empty');
  };

  const setDisabledState = (disabled) => {
    copyBtn.disabled = disabled;
    if (disabled) {
      openLink.removeAttribute('href');
      openLink.style.pointerEvents = 'none';
      openLink.style.opacity = '0.5';
    } else {
      openLink.style.pointerEvents = '';
      openLink.style.opacity = '';
    }
  };

  const build = () => {
    const base = normalizeBase(baseInput.value);
    baseInput.classList.toggle('invalid', baseInput.value.trim() !== '' && !base);

    if (!base) {
      currentUrl = '';
      urlOut.classList.add('placeholder');
      urlOut.textContent = PLACEHOLDER;
      setDisabledState(true);
      clearQr();
      if (baseInput.value.trim()) showMessage('Enter a valid website URL, e.g. https://example.com/page', 'error');
      else clearMessage();
      return;
    }

    const lower = lowercaseToggle.checked;
    let added = 0;
    paramInputs.forEach((input) => {
      let val = input.value.trim();
      if (!val) { base.searchParams.delete(input.dataset.p); return; }
      if (lower) val = val.toLowerCase();
      base.searchParams.set(input.dataset.p, val);
      added++;
    });

    const finalUrl = base.toString();
    currentUrl = finalUrl;
    renderHighlighted(base);
    openLink.href = finalUrl;
    setDisabledState(false);
    drawQr(finalUrl);

    const missing = REQUIRED.filter((p) => {
      const el = paramInputs.find((i) => i.dataset.p === p);
      return !el || !el.value.trim();
    });
    if (missing.length) {
      showMessage('Tip: for best tracking, also fill in ' + missing.map((m) => m.replace('utm_', '')).join(', ') + '.', 'success');
    } else {
      clearMessage();
    }
  };

  baseInput.addEventListener('input', build);
  paramInputs.forEach((input) => input.addEventListener('input', build));
  lowercaseToggle.addEventListener('change', build);

  clearBtn.addEventListener('click', () => {
    form.reset();
    lowercaseToggle.checked = true;
    baseInput.classList.remove('invalid');
    currentUrl = '';
    urlOut.classList.add('placeholder');
    urlOut.textContent = PLACEHOLDER;
    setDisabledState(true);
    clearQr();
    clearMessage();
    baseInput.focus();
  });

  copyBtn.addEventListener('click', async () => {
    if (copyBtn.disabled || !currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      copyBtn.classList.add('copied');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = '📋 Copy URL'; }, 1600);
    } catch (err) {
      showMessage('Copy failed — select and copy the link manually.', 'error');
    }
  });

  // initial state
  setDisabledState(true);
  clearQr();
})();
