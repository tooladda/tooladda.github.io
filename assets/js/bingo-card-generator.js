/* ==========================================================================
   ToolAdda — Bingo Card Generator (UI layer)

   Canvas drawing, event wiring and file assembly. Every rule about what
   belongs on a card lives in bingo-engine.js; every byte of PDF and ZIP
   comes from bingo-export.js. This file is the part that needs a browser.

   Card artwork is drawn once per card at print resolution and reused for
   the preview, the PDF and the PNG archive, so the three can never drift
   from each other.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.BingoEngine;
  var X = window.BingoExport;
  if (!E || !X) return;

  var STORAGE_KEY = 'tooladda-bingo-settings';
  var PRINT_DPI = 150;                 /* 150 DPI keeps A4 pages under ~1 MB */
  var PT_PER_INCH = 72;

  var FONT_STACKS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", Times, serif',
    rounded: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
    mono: 'ui-monospace, Consolas, "Courier New", monospace'
  };

  var state = {
    settings: E.defaultSettings(),
    cards: [],
    previewIndex: 0,
    callPool: [],
    called: [],
    callRng: null,
    lastResult: null,
    images: [],
    watermark: null
  };

  var dom = {};
  var toastTimer = 0;

  /* ======================================================================
     Helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function toast(message, tone) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.dataset.tone = tone || 'info';
    dom.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.hidden = true; }, 3600);
  }

  function announce(message) { if (dom.live) dom.live.textContent = message; }

  function download(bytesOrBlob, filename, mime) {
    var blob = bytesOrBlob instanceof Blob
      ? bytesOrBlob
      : new Blob([bytesOrBlob], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function activePool() {
    var s = state.settings;
    if (s.contentMode === 'images') return state.images.slice();
    if (s.contentMode !== 'words') return null;

    var typed = E.parseWordList(s.wordList);
    if (!typed.length) return E.themeWords(s.theme);
    if (!s.mixTheme) return typed;

    /* Top the list up from the theme, skipping anything already typed so
       a word cannot land on the same card twice. */
    var seen = {};
    typed.forEach(function (w) { seen[w.toLowerCase()] = true; });
    E.themeWords(s.theme).forEach(function (w) {
      if (!seen[w.toLowerCase()]) { seen[w.toLowerCase()] = true; typed.push(w); }
    });
    return typed;
  }

  /* ======================================================================
     Card drawing

     One card, drawn to a canvas at whatever pixel size the caller asks
     for. Nothing here reads the DOM, so the same routine serves the
     preview, the PDF pages and the PNG archive.
     ====================================================================== */

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /** Shrink text until it fits its square, then centre it. */
  function fitText(ctx, text, cx, cy, maxW, maxH, weight, family, color) {
    var size = Math.floor(maxH);
    ctx.fillStyle = color;
    do {
      ctx.font = weight + ' ' + size + 'px ' + family;
      size -= 1;
    } while (size > 6 && ctx.measureText(text).width > maxW);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
  }

  function drawCard(canvas, card, settings) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;

    var W = canvas.width;
    var H = canvas.height;
    var colors = E.COLORS[settings.colorTheme] || E.COLORS.indigo;
    var family = FONT_STACKS[settings.font] || FONT_STACKS.system;
    var ink = settings.inkSaver;
    var pad = Math.round(W * 0.045);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    /* Outer border */
    ctx.strokeStyle = ink ? '#333333' : colors.border;
    ctx.lineWidth = Math.max(2, W * 0.006);
    roundRect(ctx, pad / 2, pad / 2, W - pad, H - pad, W * 0.02);
    ctx.stroke();

    var y = pad;

    /* ---- title block ---- */
    if (settings.title) {
      var titleH = Math.round(H * 0.075);
      fitText(ctx, settings.title, W / 2, y + titleH / 2, W - pad * 2, titleH,
        '900', family, ink ? '#111111' : colors.header);
      y += titleH + Math.round(H * 0.012);
    }
    if (settings.subtitle) {
      var subH = Math.round(H * 0.032);
      fitText(ctx, settings.subtitle, W / 2, y + subH / 2, W - pad * 2, subH,
        '600', family, '#555555');
      y += subH + Math.round(H * 0.012);
    }

    /* ---- footer reserve ---- */
    var footerH = (settings.footer || settings.showCardId) ? Math.round(H * 0.05) : pad;
    var gridTop = y;
    var gridH = H - gridTop - footerH - pad / 2;
    var gridW = W - pad * 2;
    var headerH = card.headers ? Math.round(gridH * 0.13) : 0;
    var cellW = gridW / card.cols;
    var cellH = (gridH - headerH) / card.rows;

    /* ---- column headers ---- */
    if (card.headers) {
      card.headers.forEach(function (letter, c) {
        var x = pad + c * cellW;
        if (!ink) {
          ctx.fillStyle = colors.header;
          roundRect(ctx, x + 2, gridTop + 2, cellW - 4, headerH - 4, cellW * 0.1);
          ctx.fill();
        }
        fitText(ctx, letter, x + cellW / 2, gridTop + headerH / 2,
          cellW * 0.8, headerH * 0.72, '900', family, ink ? '#111111' : '#ffffff');
      });
    }

    /* ---- squares ---- */
    var top = gridTop + headerH;
    for (var r = 0; r < card.rows; r++) {
      for (var c2 = 0; c2 < card.cols; c2++) {
        var cell = card.grid[r][c2];
        var x2 = pad + c2 * cellW;
        var y2 = top + r * cellH;

        /* A 90-ball blank is left as bare paper, which is how the real
           card looks — not a box with nothing in it. */
        if (!cell) {
          ctx.strokeStyle = ink ? '#cccccc' : colors.border;
          ctx.lineWidth = Math.max(1, W * 0.002);
          ctx.strokeRect(x2, y2, cellW, cellH);
          continue;
        }

        var isFree = cell.type === 'free';
        if (!ink) {
          ctx.fillStyle = isFree ? colors.accent : colors.cell;
          ctx.fillRect(x2, y2, cellW, cellH);
        }
        ctx.strokeStyle = ink ? '#333333' : colors.border;
        ctx.lineWidth = Math.max(1, W * 0.0028);
        ctx.strokeRect(x2, y2, cellW, cellH);

        /* A picture square draws the image itself, letterboxed so it is
           never stretched. It falls back to the label if the bitmap is
           not decoded yet, so a card is never blank. */
        if (cell.type === 'image' && cell.bitmap && cell.bitmap.complete && cell.bitmap.naturalWidth) {
          var inset = Math.min(cellW, cellH) * 0.1;
          var boxW = cellW - inset * 2;
          var boxH = cellH - inset * 2;
          var scale = Math.min(boxW / cell.bitmap.naturalWidth, boxH / cell.bitmap.naturalHeight);
          var drawW = cell.bitmap.naturalWidth * scale;
          var drawH = cell.bitmap.naturalHeight * scale;
          ctx.drawImage(cell.bitmap,
            x2 + (cellW - drawW) / 2, y2 + (cellH - drawH) / 2, drawW, drawH);
          continue;
        }

        var label = E.cellLabel(cell);
        var textColor = ink ? '#111111' : (isFree ? '#ffffff' : colors.text);
        fitText(ctx, label, x2 + cellW / 2, y2 + cellH / 2,
          cellW * 0.86, cellH * (label.length > 8 ? 0.3 : 0.5),
          isFree ? '900' : '700', family, textColor);
      }
    }

    /* ---- watermark ----
       Drawn over the grid at low opacity, scaled to a third of the card so
       it reads as a mark of ownership without obscuring the squares. */
    if (state.watermark && state.watermark.complete && state.watermark.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.13;
      var markW = W * 0.34;
      var markH = markW * (state.watermark.naturalHeight / state.watermark.naturalWidth);
      ctx.drawImage(state.watermark, (W - markW) / 2, (H - markH) / 2, markW, markH);
      ctx.restore();
    }

    /* ---- footer ---- */
    var footY = H - footerH / 2 - pad / 4;
    ctx.font = '600 ' + Math.round(H * 0.022) + 'px ' + family;
    ctx.fillStyle = '#666666';
    ctx.textBaseline = 'middle';
    if (settings.showCardId && card.id) {
      ctx.textAlign = 'left';
      ctx.fillText(card.id + (card.seed !== undefined ? '  ·  seed ' + card.seed : ''), pad, footY);
    }
    if (settings.footer) {
      ctx.textAlign = 'right';
      ctx.fillText(settings.footer, W - pad, footY);
    }
  }

  /* ======================================================================
     Page assembly for printing
     ====================================================================== */

  function paperPixels(settings) {
    var paper = E.PAPER_SIZES[settings.paper] || E.PAPER_SIZES.a4;
    return {
      paper: paper,
      width: Math.round((paper.widthPt / PT_PER_INCH) * PRINT_DPI),
      height: Math.round((paper.heightPt / PT_PER_INCH) * PRINT_DPI)
    };
  }

  /** How the cards sit on a sheet for a given per-page count. */
  function pageGrid(perPage) {
    if (perPage === 1) return { cols: 1, rows: 1 };
    if (perPage === 2) return { cols: 1, rows: 2 };
    return { cols: 2, rows: 2 };
  }

  function buildPageCanvas(cards, settings) {
    var page = paperPixels(settings);
    var grid = pageGrid(settings.perPage);
    var canvas = document.createElement('canvas');
    canvas.width = page.width;
    canvas.height = page.height;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);

    var margin = Math.round(page.width * 0.035);
    var cellW = (page.width - margin * 2) / grid.cols;
    var cellH = (page.height - margin * 2) / grid.rows;
    var inset = Math.round(cellW * 0.03);

    cards.forEach(function (card, i) {
      var col = i % grid.cols;
      var row = Math.floor(i / grid.cols);
      var x = margin + col * cellW + inset;
      var y = margin + row * cellH + inset;
      var w = cellW - inset * 2;
      var h = cellH - inset * 2;

      var cardCanvas = document.createElement('canvas');
      cardCanvas.width = Math.round(w);
      cardCanvas.height = Math.round(h);
      drawCard(cardCanvas, card, settings);
      ctx.drawImage(cardCanvas, x, y, w, h);

      if (settings.cutLines) {
        ctx.strokeStyle = 'rgba(0,0,0,.32)';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 8]);
        ctx.strokeRect(margin + col * cellW, margin + row * cellH, cellW, cellH);
        ctx.setLineDash([]);
      }
    });

    return canvas;
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  /* ======================================================================
     Picture mode

     Uploaded images become pool items carrying a decoded bitmap, so
     drawCard stays synchronous and the PDF and ZIP writers never race a
     half-loaded image.
     ====================================================================== */

  var IMAGE_LIMIT = 60;

  function loadImages(fileList) {
    var files = Array.prototype.slice.call(fileList || [])
      .filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;

    var room = IMAGE_LIMIT - state.images.length;
    if (room <= 0) {
      toast('That is already ' + IMAGE_LIMIT + ' pictures — the most a card set can use.', 'warn');
      return;
    }
    if (files.length > room) {
      toast('Only the first ' + room + ' pictures were added (limit ' + IMAGE_LIMIT + ').', 'warn');
      files = files.slice(0, room);
    }

    var pending = files.length;
    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onerror = function () {
        pending--;
        if (!pending) afterImages();
      };
      reader.onload = function () {
        var bitmap = new Image();
        bitmap.onload = bitmap.onerror = function () {
          pending--;
          if (!pending) afterImages();
        };
        bitmap.src = reader.result;
        state.images.push({
          type: 'image',
          id: 'img-' + (state.images.length + 1),
          label: (file.name || 'Picture').replace(/\.[a-z0-9]+$/i, '').slice(0, 30),
          src: reader.result,
          bitmap: bitmap
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function afterImages() {
    renderImageCount();
    updatePoolNote();
    renderPreview();
    toast(state.images.length + ' pictures ready', 'good');
  }

  function renderImageCount() {
    if (!dom.imageCount) return;
    dom.imageCount.textContent = state.images.length
      ? state.images.length + ' picture' + (state.images.length === 1 ? '' : 's') + ' loaded.'
      : 'No pictures loaded yet.';
  }

  /* ======================================================================
     Generation
     ====================================================================== */

  function generate() {
    readSettings();
    var pool = activePool();
    var result = E.generateCards(state.settings, pool, { now: Date.now() });

    if (result.error) {
      toast(result.error, 'bad');
      dom.generateNote.textContent = result.error;
      dom.generateNote.dataset.tone = 'bad';
      dom.generateNote.hidden = false;
      return;
    }

    state.cards = result.cards;
    state.lastResult = result;
    state.previewIndex = 0;
    state.callPool = E.buildCallPool(state.settings, pool);
    state.called = [];
    state.callRng = E.mulberry32(result.masterSeed);

    /* Say plainly when fewer cards came back than were asked for. The old
       page padded the batch with duplicates and reported success. */
    if (result.exhausted) {
      var message = 'Only ' + result.unique + ' genuinely different cards are possible with these ' +
        'settings — ' + result.requested + ' were requested. Add more words or use a larger grid.';
      dom.generateNote.textContent = message;
      dom.generateNote.dataset.tone = 'warn';
      dom.generateNote.hidden = false;
      toast(result.unique + ' unique cards (of ' + result.requested + ' requested)', 'warn');
    } else {
      dom.generateNote.textContent = result.unique + ' unique cards, seed "' + result.seedText +
        '". The same seed always rebuilds the same cards.';
      dom.generateNote.dataset.tone = 'good';
      dom.generateNote.hidden = false;
      toast('Generated ' + result.unique + ' unique cards', 'good');
    }

    if (dom.studio) dom.studio.dataset.state = 'ready';
    announce(result.unique + ' cards generated.');
    renderPreview();
    renderCaller();
    updateExportState();
  }

  function updateExportState() {
    var has = state.cards.length > 0;
    [dom.downloadPdf, dom.downloadZip, dom.printBtn, dom.downloadCallSheet].forEach(function (btn) {
      if (btn) btn.disabled = !has;
    });
    if (dom.pageCount) {
      var pages = has ? chunk(state.cards, state.settings.perPage).length : 0;
      dom.pageCount.textContent = has
        ? state.cards.length + ' cards · ' + pages + ' page' + (pages === 1 ? '' : 's') +
          ' of ' + (E.PAPER_SIZES[state.settings.paper] || {}).label
        : '';
    }
  }

  /* ======================================================================
     Preview
     ====================================================================== */

  function renderPreview() {
    if (!dom.previewCanvas) return;
    var card = state.cards[state.previewIndex];
    if (!card) {
      dom.previewCanvas.width = 600;
      dom.previewCanvas.height = 750;
      var blank = dom.previewCanvas.getContext && dom.previewCanvas.getContext('2d');
      if (blank) { blank.fillStyle = '#ffffff'; blank.fillRect(0, 0, 600, 750); }
      if (dom.previewLabel) dom.previewLabel.textContent = 'No cards yet';
      return;
    }

    /* Match the preview's aspect ratio to the card so nothing is squashed. */
    var wide = card.cols > card.rows;
    var w = wide ? 900 : 640;
    var h = wide ? 420 : 800;
    dom.previewCanvas.width = w;
    dom.previewCanvas.height = h;
    dom.previewCanvas.style.aspectRatio = w + ' / ' + h;
    drawCard(dom.previewCanvas, card, state.settings);

    if (dom.previewLabel) {
      dom.previewLabel.textContent = card.id + ' — ' + (state.previewIndex + 1) +
        ' of ' + state.cards.length;
    }
    if (dom.prevBtn) dom.prevBtn.disabled = state.previewIndex === 0;
    if (dom.nextBtn) dom.nextBtn.disabled = state.previewIndex >= state.cards.length - 1;
  }

  /* ======================================================================
     Exports
     ====================================================================== */

  function canvasToJpegBytes(canvas) {
    return X.bytesFromDataUrl(canvas.toDataURL('image/jpeg', 0.9));
  }
  function canvasToPngBytes(canvas) {
    return X.bytesFromDataUrl(canvas.toDataURL('image/png'));
  }

  function downloadPdf() {
    if (!state.cards.length) return;
    try {
      var paper = E.PAPER_SIZES[state.settings.paper] || E.PAPER_SIZES.a4;
      var pages = chunk(state.cards, state.settings.perPage).map(function (group) {
        return {
          jpeg: canvasToJpegBytes(buildPageCanvas(group, state.settings)),
          widthPt: paper.widthPt,
          heightPt: paper.heightPt
        };
      });
      var pdf = X.buildPdf(pages, { title: state.settings.title || 'Bingo Cards' });
      download(pdf, 'bingo-cards.pdf', 'application/pdf');
      toast(pages.length + ' page PDF downloaded', 'good');
    } catch (err) {
      toast(err && err.message ? err.message : 'The PDF could not be built.', 'bad');
    }
  }

  function downloadZip() {
    if (!state.cards.length) return;
    try {
      var files = state.cards.map(function (card) {
        var canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = card.cols > card.rows ? 420 : 1125;
        drawCard(canvas, card, state.settings);
        return { name: card.id + '.png', data: canvasToPngBytes(canvas) };
      });
      var zip = X.buildZip(files, { date: new Date() });
      download(zip, 'bingo-cards.zip', 'application/zip');
      toast(files.length + ' PNG files zipped', 'good');
    } catch (err) {
      toast(err && err.message ? err.message : 'The archive could not be built.', 'bad');
    }
  }

  function printCards() {
    if (!state.cards.length) return;
    var paper = E.PAPER_SIZES[state.settings.paper] || E.PAPER_SIZES.a4;
    var pages = chunk(state.cards, state.settings.perPage).map(function (group) {
      return buildPageCanvas(group, state.settings).toDataURL('image/jpeg', 0.9);
    });

    var win = window.open('', '_blank');
    if (!win) { toast('Your browser blocked the print window.', 'bad'); return; }

    var doc = win.document;
    doc.title = state.settings.title || 'Bingo Cards';

    var style = doc.createElement('style');
    style.textContent =
      '@page { size: ' + paper.id + '; margin: 0; }' +
      'html, body { margin: 0; padding: 0; }' +
      'img { display: block; width: 100%; page-break-after: always; }' +
      'img:last-child { page-break-after: auto; }';
    doc.head.appendChild(style);

    pages.forEach(function (src) {
      var img = doc.createElement('img');
      img.src = src;
      img.alt = '';
      doc.body.appendChild(img);
    });

    /* Wait for the images to decode, or the print dialog opens blank. */
    win.setTimeout(function () { win.focus(); win.print(); }, 700);
  }

  function downloadCallSheet() {
    if (!state.callPool.length) return;
    var s = state.settings;
    var lines = ['ToolAdda Bingo — call sheet', ''];
    lines.push('Mode: ' + s.contentMode);
    lines.push('Seed: ' + (state.lastResult ? state.lastResult.seedText : ''));
    lines.push('Cards: ' + state.cards.length);
    lines.push('Win pattern: ' + E.patternLabel(s.winPattern));
    lines.push('');
    lines.push('All ' + state.callPool.length + ' possible calls:');
    /* Ten per line keeps the sheet readable when ticked off by hand. */
    for (var i = 0; i < state.callPool.length; i += 10) {
      lines.push('  ' + state.callPool.slice(i, i + 10).join('   '));
    }
    lines.push('');
    lines.push('Called so far (' + state.called.length + '):');
    lines.push('  ' + (state.called.join('   ') || '—'));

    download(new Blob([lines.join('\n')], { type: 'text/plain' }), 'bingo-call-sheet.txt');
    toast('Call sheet downloaded', 'good');
  }

  /* ======================================================================
     Digital caller
     ====================================================================== */

  function renderCaller() {
    if (!dom.calledList) return;
    while (dom.calledList.firstChild) dom.calledList.removeChild(dom.calledList.firstChild);

    state.called.forEach(function (item, i) {
      var chip = el('li', 'bng-call', item);
      if (i === state.called.length - 1) chip.classList.add('is-latest');
      dom.calledList.appendChild(chip);
    });

    if (dom.currentCall) {
      dom.currentCall.textContent = state.called.length
        ? state.called[state.called.length - 1]
        : '—';
    }
    if (dom.callProgress) {
      dom.callProgress.textContent = state.callPool.length
        ? state.called.length + ' of ' + state.callPool.length + ' called'
        : 'Generate cards to build the call list';
    }
    if (dom.callNext) dom.callNext.disabled = !state.callPool.length || state.called.length >= state.callPool.length;
    if (dom.callUndo) dom.callUndo.disabled = !state.called.length;
  }

  function speak(text) {
    if (!dom.callTts || !dom.callTts.checked) return;
    if (!('speechSynthesis' in window)) return;
    try {
      var utterance = new SpeechSynthesisUtterance(String(text));
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    } catch (err) { /* speech is a nicety, never a failure */ }
  }

  function callNext() {
    if (!state.callRng) state.callRng = E.mulberry32(Date.now() >>> 0);
    var next = E.drawNext(state.callPool, state.called, state.callRng);
    if (!next) { toast('Every call has been drawn.', 'warn'); return; }
    state.called.push(next);
    renderCaller();
    speak(next);
    announce('Called ' + next);
  }

  /* ======================================================================
     Win verification
     ====================================================================== */

  function runVerify() {
    readSettings();
    var id = (dom.verifyId.value || '').trim();
    var seed = (dom.verifySeed.value || '').trim();
    var callsRaw = dom.verifyCalls.value || '';

    if (!callsRaw.trim()) {
      showVerify(false, 'Enter the calls that have been made so far.');
      return;
    }

    var card = null;
    if (id) {
      for (var i = 0; i < state.cards.length; i++) {
        if (state.cards[i].id.toLowerCase() === id.toLowerCase()) { card = state.cards[i]; break; }
      }
    }
    /* Falling back to the seed lets a card printed weeks ago be checked
       without regenerating the batch. */
    if (!card && seed) {
      try {
        card = E.rebuildCard(seed, state.settings, activePool());
      } catch (err) {
        showVerify(false, err.message);
        return;
      }
    }
    if (!card) {
      showVerify(false, 'Enter a card ID from this batch, or the seed printed on the card.');
      return;
    }

    var result = E.verifyWin(card, callsRaw, state.settings.winPattern);
    if (result.won) {
      showVerify(true, 'Valid win — ' + result.marked + ' squares complete for "' +
        result.patternLabel + '".');
    } else {
      var missing = result.missing.slice(0, 6).map(function (m) { return m.label; }).join(', ');
      showVerify(false, 'Not a win yet. Closest "' + result.patternLabel + '" is ' +
        result.marked + ' of ' + result.needed + ' squares' +
        (missing ? ' — still needs ' + missing : '') + '.');
    }
  }

  function showVerify(won, message) {
    if (!dom.verifyResult) return;
    dom.verifyResult.textContent = message;
    dom.verifyResult.dataset.tone = won ? 'good' : 'bad';
    dom.verifyResult.hidden = false;
    announce(message);
  }

  /* ======================================================================
     Settings <-> controls
     ====================================================================== */

  function readSettings() {
    var next = {
      contentMode: state.settings.contentMode,
      theme: state.settings.theme,
      template: state.settings.template,
      gridSize: dom.gridSize ? +dom.gridSize.value : 5,
      freeSpace: dom.freeSpace ? dom.freeSpace.value : 'center',
      freeText: dom.freeText ? dom.freeText.value : 'FREE',
      bingoHeader: dom.bingoHeader ? dom.bingoHeader.checked : true,
      title: dom.title ? dom.title.value : 'BINGO',
      subtitle: dom.subtitle ? dom.subtitle.value : '',
      footer: dom.footer ? dom.footer.value : '',
      showCardId: dom.showCardId ? dom.showCardId.checked : true,
      cardCount: dom.cardCount ? +dom.cardCount.value : 8,
      seed: dom.seed ? dom.seed.value : '',
      colorTheme: dom.colorTheme ? dom.colorTheme.value : 'indigo',
      font: dom.font ? dom.font.value : 'system',
      inkSaver: dom.inkSaver ? dom.inkSaver.checked : false,
      paper: dom.paper ? dom.paper.value : 'a4',
      perPage: dom.perPage ? +dom.perPage.value : 2,
      cutLines: dom.cutLines ? dom.cutLines.checked : true,
      wordList: dom.wordList ? dom.wordList.value : '',
      mixTheme: dom.mixTheme ? dom.mixTheme.checked : false,
      winPattern: dom.winPattern ? dom.winPattern.value : 'line'
    };
    state.settings = E.normalize(next);
    return state.settings;
  }

  function writeSettings() {
    var s = state.settings;
    if (dom.gridSize) dom.gridSize.value = String(s.gridSize);
    if (dom.freeSpace) dom.freeSpace.value = s.freeSpace;
    if (dom.freeText) dom.freeText.value = s.freeText;
    if (dom.bingoHeader) dom.bingoHeader.checked = s.bingoHeader;
    if (dom.title) dom.title.value = s.title;
    if (dom.subtitle) dom.subtitle.value = s.subtitle;
    if (dom.footer) dom.footer.value = s.footer;
    if (dom.showCardId) dom.showCardId.checked = s.showCardId;
    if (dom.cardCount) dom.cardCount.value = String(s.cardCount);
    if (dom.seed) dom.seed.value = s.seed;
    if (dom.colorTheme) dom.colorTheme.value = s.colorTheme;
    if (dom.font) dom.font.value = s.font;
    if (dom.inkSaver) dom.inkSaver.checked = s.inkSaver;
    if (dom.paper) dom.paper.value = s.paper;
    if (dom.perPage) dom.perPage.value = String(s.perPage);
    if (dom.cutLines) dom.cutLines.checked = s.cutLines;
    if (dom.wordList) dom.wordList.value = s.wordList;
    if (dom.mixTheme) dom.mixTheme.checked = s.mixTheme;
    if (dom.winPattern) dom.winPattern.value = s.winPattern;
    syncModeUI();
  }

  function syncModeUI() {
    var mode = state.settings.contentMode;
    all('[data-mode-tab]').forEach(function (tab) {
      var active = tab.dataset.modeTab === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
    all('[data-when-mode]').forEach(function (node) {
      node.hidden = node.dataset.whenMode.split(' ').indexOf(mode) === -1;
    });
    /* 90-ball fixes its own geometry, so those controls would mislead. */
    all('[data-hide-on-ball90]').forEach(function (node) {
      node.hidden = mode === 'ball90';
    });
    updatePoolNote();
  }

  /** Tell the user, before they print, whether the pool can do the job. */
  function updatePoolNote() {
    if (!dom.poolNote) return;
    var s = state.settings;
    if (s.contentMode === 'ball75' || s.contentMode === 'ball90') {
      dom.poolNote.hidden = true;
      return;
    }
    var pool = activePool() || [];
    var need = E.cellsNeeded(s);
    var noun = s.contentMode === 'images' ? 'picture' : 'word';
    var plural = noun + 's';

    if (pool.length < need) {
      dom.poolNote.textContent = 'This grid needs ' + need + ' squares but only ' + pool.length +
        ' ' + (pool.length === 1 ? noun : plural) + ' are available. Add ' +
        (need - pool.length) + ' more.';
      dom.poolNote.dataset.tone = 'bad';
    } else {
      var ceiling = E.maxUniqueCards(s, pool.length);
      var possible = ceiling.exact !== null
        ? ceiling.exact.toLocaleString()
        : 'about 10^' + Math.round(ceiling.log10);
      dom.poolNote.textContent = pool.length + ' ' + plural + ' fill ' + need + ' squares — ' +
        possible + ' different cards are possible.';
      dom.poolNote.dataset.tone = ceiling.limited ? 'warn' : 'good';
    }
    dom.poolNote.hidden = false;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); }
    catch (err) { /* private mode; settings simply will not persist */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      state.settings = E.normalize(JSON.parse(raw));
    } catch (err) { state.settings = E.defaultSettings(); }
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.studio = $('bngStudio');
    dom.toast = $('bngToast');
    dom.live = $('bngLive');

    dom.gridSize = $('bngGridSize');
    dom.freeSpace = $('bngFreeSpace');
    dom.freeText = $('bngFreeText');
    dom.bingoHeader = $('bngBingoHeader');
    dom.title = $('bngTitle');
    dom.subtitle = $('bngSubtitle');
    dom.footer = $('bngFooter');
    dom.showCardId = $('bngShowCardId');
    dom.cardCount = $('bngCardCount');
    dom.seed = $('bngSeed');
    dom.colorTheme = $('bngColorTheme');
    dom.font = $('bngFont');
    dom.inkSaver = $('bngInkSaver');
    dom.paper = $('bngPaper');
    dom.perPage = $('bngPerPage');
    dom.cutLines = $('bngCutLines');
    dom.wordList = $('bngWordList');
    dom.winPattern = $('bngWinPattern');

    dom.themeSelect = $('bngTheme');
    dom.loadTheme = $('bngLoadTheme');
    dom.poolNote = $('bngPoolNote');
    dom.images = $('bngImages');
    dom.imageCount = $('bngImageCount');
    dom.clearImages = $('bngClearImages');
    dom.mixTheme = $('bngMixTheme');
    dom.watermark = $('bngWatermark');
    dom.clearWatermark = $('bngClearWatermark');

    dom.generateBtn = $('bngGenerate');
    dom.generateNote = $('bngGenerateNote');
    dom.randomSeed = $('bngRandomSeed');

    dom.previewCanvas = $('bngPreview');
    dom.previewLabel = $('bngPreviewLabel');
    dom.prevBtn = $('bngPrev');
    dom.nextBtn = $('bngNext');

    dom.downloadPdf = $('bngDownloadPdf');
    dom.downloadZip = $('bngDownloadZip');
    dom.printBtn = $('bngPrint');
    dom.downloadCallSheet = $('bngCallSheet');
    dom.pageCount = $('bngPageCount');

    dom.callNext = $('bngCallNext');
    dom.callUndo = $('bngCallUndo');
    dom.callReset = $('bngCallReset');
    dom.callTts = $('bngCallTts');
    dom.calledList = $('bngCalled');
    dom.currentCall = $('bngCurrentCall');
    dom.callProgress = $('bngCallProgress');

    dom.verifyId = $('bngVerifyId');
    dom.verifySeed = $('bngVerifySeed');
    dom.verifyCalls = $('bngVerifyCalls');
    dom.verifyBtn = $('bngVerify');
    dom.verifyResult = $('bngVerifyResult');

    dom.saveBtn = $('bngSave');
    dom.resetBtn = $('bngReset');
  }

  function buildThemeOptions() {
    if (!dom.themeSelect) return;
    E.THEME_IDS.forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id.charAt(0).toUpperCase() + id.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2') +
        ' (' + E.THEMES[id].length + ' words)';
      dom.themeSelect.appendChild(opt);
    });
    dom.themeSelect.value = state.settings.theme;
  }

  function wire() {
    all('[data-mode-tab]').forEach(function (tab) {
      on(tab, 'click', function () {
        state.settings.contentMode = tab.dataset.modeTab;
        state.settings = E.normalize(state.settings);
        syncModeUI();
        persist();
      });
      /* Arrow-key navigation is expected of a tablist. */
      on(tab, 'keydown', function (e) {
        var tabs = all('[data-mode-tab]');
        var i = tabs.indexOf(tab);
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') next = tabs[0];
        if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); next.focus(); next.click(); }
      });
    });

    [dom.gridSize, dom.freeSpace, dom.freeText, dom.bingoHeader, dom.title, dom.subtitle,
     dom.footer, dom.showCardId, dom.colorTheme, dom.font, dom.inkSaver, dom.cutLines
    ].forEach(function (control) {
      if (!control) return;
      var event = control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'input';
      on(control, event, function () {
        readSettings();
        updatePoolNote();
        renderPreview();
        persist();
      });
    });

    [dom.paper, dom.perPage].forEach(function (control) {
      on(control, 'change', function () { readSettings(); updateExportState(); persist(); });
    });

    on(dom.wordList, 'input', function () { readSettings(); updatePoolNote(); persist(); });
    on(dom.cardCount, 'input', function () { readSettings(); persist(); });
    on(dom.seed, 'input', function () { readSettings(); persist(); });
    on(dom.winPattern, 'change', function () { readSettings(); persist(); });

    on(dom.themeSelect, 'change', function () {
      state.settings.theme = dom.themeSelect.value;
      state.settings = E.normalize(state.settings);
      updatePoolNote();
      persist();
    });

    on(dom.loadTheme, 'click', function () {
      var words = E.themeWords(dom.themeSelect ? dom.themeSelect.value : state.settings.theme);
      if (!words.length) return;
      if (dom.wordList) dom.wordList.value = words.join('\n');
      readSettings();
      updatePoolNote();
      persist();
      toast(words.length + ' words loaded — edit them freely', 'good');
    });

    on(dom.images, 'change', function () {
      loadImages(dom.images.files);
      dom.images.value = '';
    });
    on(dom.watermark, 'change', function () {
      var file = dom.watermark.files && dom.watermark.files[0];
      if (!file) { state.watermark = null; renderPreview(); return; }
      if (!/^image\//.test(file.type)) { toast('Choose an image file for the watermark.', 'bad'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var bitmap = new Image();
        bitmap.onload = function () { state.watermark = bitmap; renderPreview(); toast('Watermark applied', 'good'); };
        bitmap.onerror = function () { toast('That watermark could not be decoded.', 'bad'); };
        bitmap.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    on(dom.clearWatermark, 'click', function () {
      state.watermark = null;
      if (dom.watermark) dom.watermark.value = '';
      renderPreview();
      toast('Watermark removed', 'good');
    });

    on(dom.mixTheme, 'change', function () { readSettings(); updatePoolNote(); persist(); });

    on(dom.clearImages, 'click', function () {
      state.images = [];
      renderImageCount();
      updatePoolNote();
      toast('Pictures cleared', 'good');
    });

    on(dom.randomSeed, 'click', function () {
      if (!dom.seed) return;
      dom.seed.value = Math.random().toString(36).slice(2, 8);
      readSettings();
      persist();
    });

    on(dom.generateBtn, 'click', generate);

    on(dom.prevBtn, 'click', function () {
      if (state.previewIndex > 0) { state.previewIndex--; renderPreview(); }
    });
    on(dom.nextBtn, 'click', function () {
      if (state.previewIndex < state.cards.length - 1) { state.previewIndex++; renderPreview(); }
    });

    on(dom.downloadPdf, 'click', downloadPdf);
    on(dom.downloadZip, 'click', downloadZip);
    on(dom.printBtn, 'click', printCards);
    on(dom.downloadCallSheet, 'click', downloadCallSheet);

    on(dom.callNext, 'click', callNext);
    on(dom.callUndo, 'click', function () { state.called.pop(); renderCaller(); });
    on(dom.callReset, 'click', function () {
      state.called = [];
      state.callRng = E.mulberry32(state.lastResult ? state.lastResult.masterSeed : 1);
      renderCaller();
      toast('Caller reset', 'good');
    });

    on(dom.verifyBtn, 'click', runVerify);

    on(dom.saveBtn, 'click', function () { readSettings(); persist(); toast('Settings saved in this browser', 'good'); });
    on(dom.resetBtn, 'click', function () {
      state.settings = E.defaultSettings();
      writeSettings();
      updatePoolNote();
      renderPreview();
      persist();
      toast('Settings reset', 'good');
    });
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function initializeGenerator() {
    cacheDom();
    if (!dom.studio) return;

    restore();
    buildThemeOptions();
    writeSettings();
    wire();
    renderPreview();
    renderCaller();
    renderImageCount();
    updateExportState();
    updatePoolNote();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeGenerator);
  else initializeGenerator();

  window.BingoStudio = {
    getSettings: function () { return state.settings; },
    getCards: function () { return state.cards; },
    getResult: function () { return state.lastResult; },
    getCalled: function () { return state.called.slice(); },
    generate: generate,
    callNext: callNext,
    verify: runVerify,
    drawCard: drawCard,
    buildPageCanvas: buildPageCanvas,
    chunk: chunk,
    FONT_STACKS: FONT_STACKS,
    STORAGE_KEY: STORAGE_KEY
  };
})();
