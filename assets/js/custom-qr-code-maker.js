(function () {
  const canvas = document.getElementById('qr-canvas');
  const textInput = document.getElementById('qr-text');
  const sizeInput = document.getElementById('qr-size');
  const sizeLabel = document.getElementById('qr-size-label');
  const eccSelect = document.getElementById('qr-ecc');
  const styleSelect = document.getElementById('qr-style');
  const eyeSelect = document.getElementById('qr-eye');
  const themeInput = document.getElementById('qr-theme');
  const fillInput = document.getElementById('qr-fill');
  const fgInput = document.getElementById('qr-foreground');
  const bgInput = document.getElementById('qr-background');
  const color2Input = document.getElementById('qr-foreground-2');
  const gradDirInput = document.getElementById('qr-grad-dir');
  const gradientFields = document.getElementById('qr-gradient-fields');
  const transparentInput = document.getElementById('qr-transparent');
  const logoInput = document.getElementById('qr-logo');
  const logoSizeInput = document.getElementById('qr-logo-size');
  const logoSizeLabel = document.getElementById('qr-logo-size-label');
  const formatInput = document.getElementById('qr-format');
  const hiresInput = document.getElementById('qr-hires');
  const generateBtn = document.getElementById('generate-qr');
  const downloadBtn = document.getElementById('download-qr');
  const copyBtn = document.getElementById('copy-qr');
  const messageEl = document.getElementById('qr-message');

  if (!canvas || !textInput || !generateBtn) return;

  const ctx = canvas.getContext('2d');
  let logoImage = null;

  // One-click palettes. Defaults (in HTML) are the ToolAdda brand indigo -> green;
  // the green is darkened from the logo (#22C55E) to keep contrast on white.
  const THEMES = {
    brand: { fill: 'gradient', c1: '#4f46e5', c2: '#15803d', bg: '#ffffff', dir: 'diagonal' },
    ocean: { fill: 'gradient', c1: '#0ea5e9', c2: '#1e3a8a', bg: '#ffffff', dir: 'diagonal' },
    sunset: { fill: 'gradient', c1: '#ea580c', c2: '#9d174d', bg: '#ffffff', dir: 'diagonal' },
    grape: { fill: 'gradient', c1: '#7c3aed', c2: '#a21caf', bg: '#ffffff', dir: 'diagonal' },
    mono: { fill: 'solid', c1: '#111827', c2: '#111827', bg: '#ffffff', dir: 'diagonal' },
  };
  let applyingTheme = false;

  function showMessage(message, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.classList.toggle('is-error', isError);
  }

  function clearMessage() {
    if (!messageEl) return;
    messageEl.textContent = '';
    messageEl.classList.remove('is-error');
  }

  function readLogo(file) {
    if (!file) {
      logoImage = null;
      drawQrCode();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        logoImage = image;
        drawQrCode();
        showMessage('Logo added to your QR code.');
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function drawRoundedRect(context, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  // Read every control once so the raster and SVG renderers stay in sync.
  function getConfig() {
    const text = textInput.value.trim();
    let ecc = eccSelect.value || 'M';
    const style = styleSelect.value || 'classic';
    const eyeStyle = eyeSelect.value || 'square';
    const fillType = fillInput ? fillInput.value : 'gradient';
    const fg = fgInput.value || '#111827';
    const c2 = color2Input ? color2Input.value : '#15803d';
    const dir = gradDirInput ? gradDirInput.value : 'diagonal';
    const bg = bgInput.value || '#ffffff';
    const transparent = !!(transparentInput && transparentInput.checked);
    const logoPct = logoSizeInput ? Number(logoSizeInput.value) : 16;
    const showLogo = !!logoImage && logoPct > 0;
    // A center logo hides data modules, so raise error correction to stay scannable.
    if (showLogo && ecc !== 'H') ecc = 'H';
    return { text, ecc, style, eyeStyle, fillType, fg, c2, dir, bg, transparent, logoPct, showLogo };
  }

  function makeCanvasFill(tctx, cfg, offset, total) {
    if (cfg.fillType === 'gradient' || cfg.fillType === 'radial') {
      let grad;
      if (cfg.fillType === 'radial') {
        const cx = offset + total / 2;
        const cy = offset + total / 2;
        grad = tctx.createRadialGradient(cx, cy, total * 0.06, cx, cy, total * 0.62);
      } else {
        let x0 = offset, y0 = offset, x1 = offset + total, y1 = offset + total;
        if (cfg.dir === 'horizontal') { y0 = y1 = offset + total / 2; }
        else if (cfg.dir === 'vertical') { x0 = x1 = offset + total / 2; }
        grad = tctx.createLinearGradient(x0, y0, x1, y1);
      }
      grad.addColorStop(0, cfg.fg);
      grad.addColorStop(1, cfg.c2);
      return grad;
    }
    return cfg.fg;
  }

  // Core renderer — draws into any context at pixel size S. Returns success.
  function renderQR(tctx, S) {
    const cfg = getConfig();
    if (!cfg.text) { showMessage('Enter a URL or text first.', true); return false; }
    if (typeof qrcode !== 'function') {
      showMessage('QR library failed to load. Please reload the page.', true);
      return false;
    }

    const qr = qrcode(0, cfg.ecc);
    qr.addData(cfg.text);
    qr.make();

    const modules = qr.getModuleCount();
    const quiet = 4; // 4-module quiet zone on every side (required for scanning)
    const cell = Math.max(1, Math.floor(S / (modules + quiet * 2)));
    const total = modules * cell;
    const offset = Math.floor((S - total) / 2);

    tctx.canvas.width = S;
    tctx.canvas.height = S;
    tctx.clearRect(0, 0, S, S);
    if (!cfg.transparent) {
      tctx.fillStyle = cfg.bg;
      tctx.fillRect(0, 0, S, S);
    }

    const codeFill = makeCanvasFill(tctx, cfg, offset, total);
    const inFinder = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= modules - 7) || (r >= modules - 7 && c < 7);

    // Light "gaps" become transparent (transparent mode) or the background color.
    function gap(x, y, w, h, r) {
      if (cfg.transparent) {
        tctx.save();
        tctx.globalCompositeOperation = 'destination-out';
        tctx.fillStyle = '#000';
        drawRoundedRect(tctx, x, y, w, h, r);
        tctx.fill();
        tctx.restore();
      } else {
        tctx.fillStyle = cfg.bg;
        drawRoundedRect(tctx, x, y, w, h, r);
        tctx.fill();
      }
    }

    // Data modules (finder patterns are drawn separately for correctness).
    tctx.fillStyle = codeFill;
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col) || inFinder(row, col)) continue;
        const x = offset + col * cell;
        const y = offset + row * cell;
        if (cfg.style === 'rounded') {
          drawRoundedRect(tctx, x + 0.5, y + 0.5, cell - 1, cell - 1, Math.max(1, cell / 3));
          tctx.fill();
        } else if (cfg.style === 'dots') {
          tctx.beginPath();
          tctx.arc(x + cell / 2, y + cell / 2, cell / 2, 0, Math.PI * 2);
          tctx.fill();
        } else {
          tctx.fillRect(x, y, cell, cell);
        }
      }
    }

    // Correct finder patterns: 7x7 solid, 5x5 gap, 3x3 solid center.
    const finders = [[0, 0], [0, modules - 7], [modules - 7, 0]];
    const outerR = cfg.eyeStyle === 'rounded' ? cell * 1.6 : 0;
    finders.forEach(([r, c]) => {
      const x = offset + c * cell;
      const y = offset + r * cell;
      tctx.fillStyle = codeFill;
      drawRoundedRect(tctx, x, y, cell * 7, cell * 7, outerR);
      tctx.fill();
      gap(x + cell, y + cell, cell * 5, cell * 5, Math.max(0, outerR - cell));
      tctx.fillStyle = codeFill;
      drawRoundedRect(tctx, x + cell * 2, y + cell * 2, cell * 3, cell * 3, Math.max(0, outerR - cell * 2));
      tctx.fill();
    });

    // Center logo with a white backing to stay crisp and scannable.
    if (cfg.showLogo) {
      // Cap coverage so the logo stays within the error-correction budget (scannable).
      const logoSize = Math.min(S * (cfg.logoPct / 100), S * 0.2);
      const pad = Math.max(4, logoSize * 0.14);
      const boxSize = logoSize + pad * 2;
      const bx = (S - boxSize) / 2;
      const by = (S - boxSize) / 2;
      const lx = (S - logoSize) / 2;
      const ly = (S - logoSize) / 2;
      if (cfg.transparent) {
        tctx.save();
        tctx.globalCompositeOperation = 'destination-out';
        tctx.fillStyle = '#000';
        drawRoundedRect(tctx, bx, by, boxSize, boxSize, Math.max(6, boxSize / 5));
        tctx.fill();
        tctx.restore();
      }
      tctx.fillStyle = cfg.transparent ? '#ffffff' : cfg.bg;
      drawRoundedRect(tctx, bx, by, boxSize, boxSize, Math.max(6, boxSize / 5));
      tctx.fill();
      tctx.drawImage(logoImage, lx, ly, logoSize, logoSize);
    }

    return true;
  }

  function drawQrCode() {
    const S = Number(sizeInput.value || 320);
    canvas.style.width = `${S}px`;
    canvas.style.height = `${S}px`;
    if (!renderQR(ctx, S)) return;
    showMessage('QR code ready. Download or copy it.');
  }

  // ---------- SVG (vector) export ----------
  function logoToPngDataURL() {
    if (!logoImage) return null;
    try {
      const n = logoImage.naturalWidth || 96;
      const m = logoImage.naturalHeight || 96;
      const t = document.createElement('canvas');
      t.width = n;
      t.height = m;
      t.getContext('2d').drawImage(logoImage, 0, 0, n, m);
      return t.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  function buildSVG(S) {
    const cfg = getConfig();
    if (!cfg.text || typeof qrcode !== 'function') return null;
    const qr = qrcode(0, cfg.ecc);
    qr.addData(cfg.text);
    qr.make();
    const modules = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.max(1, Math.floor(S / (modules + quiet * 2)));
    const total = modules * cell;
    const offset = Math.floor((S - total) / 2);
    const inFinder = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= modules - 7) || (r >= modules - 7 && c < 7);

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`);

    let fillRef = cfg.fg;
    if (cfg.fillType === 'gradient' || cfg.fillType === 'radial') {
      if (cfg.fillType === 'radial') {
        const cx = offset + total / 2;
        const cy = offset + total / 2;
        parts.push(`<defs><radialGradient id="qg" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${total * 0.62}"><stop offset="0" stop-color="${cfg.fg}"/><stop offset="1" stop-color="${cfg.c2}"/></radialGradient></defs>`);
      } else {
        let x0 = offset, y0 = offset, x1 = offset + total, y1 = offset + total;
        if (cfg.dir === 'horizontal') { y0 = y1 = offset + total / 2; }
        else if (cfg.dir === 'vertical') { x0 = x1 = offset + total / 2; }
        parts.push(`<defs><linearGradient id="qg" gradientUnits="userSpaceOnUse" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"><stop offset="0" stop-color="${cfg.fg}"/><stop offset="1" stop-color="${cfg.c2}"/></linearGradient></defs>`);
      }
      fillRef = 'url(#qg)';
    }

    if (!cfg.transparent) parts.push(`<rect width="${S}" height="${S}" fill="${cfg.bg}"/>`);

    parts.push(`<g fill="${fillRef}">`);
    for (let r = 0; r < modules; r += 1) {
      for (let c = 0; c < modules; c += 1) {
        if (!qr.isDark(r, c) || inFinder(r, c)) continue;
        const x = offset + c * cell;
        const y = offset + r * cell;
        if (cfg.style === 'dots') {
          parts.push(`<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${cell / 2}"/>`);
        } else if (cfg.style === 'rounded') {
          parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${cell - 1}" height="${cell - 1}" rx="${Math.max(1, cell / 3)}"/>`);
        } else {
          parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}"/>`);
        }
      }
    }
    parts.push('</g>');

    const outerR = cfg.eyeStyle === 'rounded' ? cell * 1.6 : 0;
    [[0, 0], [0, modules - 7], [modules - 7, 0]].forEach(([r, c]) => {
      const x = offset + c * cell;
      const y = offset + r * cell;
      // 1-module-thick ring (row/col 0 and 6) via a stroked rect, plus 3x3 center.
      parts.push(`<rect x="${x + cell / 2}" y="${y + cell / 2}" width="${cell * 6}" height="${cell * 6}" rx="${Math.max(0, outerR - cell / 2)}" fill="none" stroke="${fillRef}" stroke-width="${cell}"/>`);
      parts.push(`<rect x="${x + cell * 2}" y="${y + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="${Math.max(0, outerR - cell * 2)}" fill="${fillRef}"/>`);
    });

    if (cfg.showLogo) {
      const durl = logoToPngDataURL();
      if (durl) {
        const logoSize = Math.min(S * (cfg.logoPct / 100), S * 0.2);
        const pad = Math.max(4, logoSize * 0.14);
        const boxSize = logoSize + pad * 2;
        const bx = (S - boxSize) / 2;
        const by = (S - boxSize) / 2;
        const lx = (S - logoSize) / 2;
        const ly = (S - logoSize) / 2;
        parts.push(`<rect x="${bx}" y="${by}" width="${boxSize}" height="${boxSize}" rx="${Math.max(6, boxSize / 5)}" fill="#ffffff"/>`);
        parts.push(`<image x="${lx}" y="${ly}" width="${logoSize}" height="${logoSize}" href="${durl}" preserveAspectRatio="xMidYMid meet"/>`);
      }
    }

    parts.push('</svg>');
    return parts.join('');
  }

  // ---------- Actions ----------
  const hires = () => !!(hiresInput && hiresInput.checked);
  function triggerDownload(href, name) {
    const a = document.createElement('a');
    a.download = name;
    a.href = href;
    a.click();
  }

  generateBtn.addEventListener('click', drawQrCode);
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      drawQrCode();
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!textInput.value.trim()) { showMessage('Enter text before downloading.', true); return; }
    const fmt = formatInput ? formatInput.value : 'png';
    const S = hires() ? 1024 : Number(sizeInput.value || 320);

    if (fmt === 'svg') {
      const svg = buildSVG(S);
      if (!svg) { showMessage('Could not build the SVG.', true); return; }
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'tooladda-custom-qr.svg');
      URL.revokeObjectURL(url);
      showMessage('SVG (vector) downloaded.');
      return;
    }

    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    if (!renderQR(octx, S)) return;

    const cfg = getConfig();
    let source = off;
    if (fmt === 'jpg' && cfg.transparent) {
      const flat = document.createElement('canvas');
      flat.width = S;
      flat.height = S;
      const fctx = flat.getContext('2d');
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, S, S);
      fctx.drawImage(off, 0, 0);
      source = flat;
    }
    const mime = fmt === 'jpg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
    const dataURL = source.toDataURL(mime, fmt === 'png' ? undefined : 0.92);
    const ext = fmt === 'jpg' ? 'jpg' : fmt;
    triggerDownload(dataURL, `tooladda-custom-qr.${ext}`);
    showMessage(`QR code downloaded as ${ext.toUpperCase()}.`);
  });

  copyBtn.addEventListener('click', async () => {
    if (!textInput.value.trim()) { showMessage('Generate a QR code first.', true); return; }
    try {
      if (!canvas.toBlob || !navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      showMessage('QR image copied to clipboard.');
    } catch (e) {
      try {
        await navigator.clipboard.writeText(textInput.value.trim());
        showMessage('Image copy not supported here — copied the text instead.');
      } catch (err) {
        showMessage('Unable to copy.', true);
      }
    }
  });

  logoInput.addEventListener('change', (event) => readLogo(event.target.files?.[0]));

  // ---------- Live sync ----------
  function syncSizeLabel() {
    if (sizeLabel) sizeLabel.textContent = `${sizeInput.value}px`;
  }
  function syncLogoSizeLabel() {
    if (logoSizeLabel && logoSizeInput) logoSizeLabel.textContent = `${logoSizeInput.value}%`;
  }
  function syncGradientFields() {
    const isGradient = (fillInput ? fillInput.value : 'gradient') !== 'solid';
    if (gradientFields) gradientFields.style.display = isGradient ? '' : 'none';
  }

  function applyTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    applyingTheme = true;
    if (fillInput) fillInput.value = t.fill;
    fgInput.value = t.c1;
    if (color2Input) color2Input.value = t.c2;
    bgInput.value = t.bg;
    if (gradDirInput) gradDirInput.value = t.dir;
    applyingTheme = false;
    syncGradientFields();
  }

  sizeInput.addEventListener('input', () => {
    syncSizeLabel();
    if (textInput.value.trim()) drawQrCode();
  });
  logoSizeInput?.addEventListener('input', () => {
    syncLogoSizeLabel();
    if (textInput.value.trim()) drawQrCode();
  });
  themeInput?.addEventListener('change', () => {
    if (themeInput.value !== 'custom') applyTheme(themeInput.value);
    if (textInput.value.trim()) drawQrCode();
  });
  fillInput?.addEventListener('change', () => {
    syncGradientFields();
    if (textInput.value.trim()) drawQrCode();
  });
  [eccSelect, styleSelect, eyeSelect].forEach((el) => {
    el?.addEventListener('change', () => { if (textInput.value.trim()) drawQrCode(); });
  });
  transparentInput?.addEventListener('change', () => { if (textInput.value.trim()) drawQrCode(); });
  // Colors / direction: live redraw, and flip the theme select to "Custom".
  [fgInput, bgInput, color2Input, gradDirInput].forEach((el) => {
    const onChange = () => {
      if (!applyingTheme && themeInput && el !== gradDirInput) themeInput.value = 'custom';
      if (textInput.value.trim()) drawQrCode();
    };
    el?.addEventListener('input', onChange);
    el?.addEventListener('change', onChange);
  });

  // ---------- Init ----------
  textInput.value = 'https://tooladda.online';
  syncSizeLabel();
  syncLogoSizeLabel();
  syncGradientFields();

  const defaultLogo = new Image();
  defaultLogo.onload = () => {
    logoImage = defaultLogo;
    drawQrCode();
    clearMessage();
  };
  defaultLogo.onerror = () => drawQrCode();
  defaultLogo.src = 'assets/images/logo.svg';
  drawQrCode();
})();
