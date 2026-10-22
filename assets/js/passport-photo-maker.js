/* ==========================================================================
   ToolAdda — Passport Size Photo Maker (studio UI)

   Canvas work and event wiring. Every measurement, preset and layout
   decision comes from passport-photo-engine.js, so the numbers are tested
   independently of the browser.

   The export path renders to an offscreen canvas at the EXACT target pixel
   size rather than scaling the on-screen preview, so what you download is
   the real thing at the real resolution.
   ========================================================================== */
(function () {
  'use strict';

  var E = window.PassportPhotoEngine;
  if (!E) return;

  var STORAGE_KEY = 'tooladda-passport-photo';

  var state = E.defaultState();
  var dom = {};
  var img = null;
  var imgName = '';
  var frame = 0;
  var statusTimer = 0;
  var pointer = { active: false, id: null, startX: 0, startY: 0, panX: 0, panY: 0 };

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

  function status(message, tone) {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.dataset.tone = tone || 'info';
    dom.status.hidden = false;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { dom.status.hidden = true; }, 3200);
  }

  function announce(m) { if (dom.live) dom.live.textContent = m; }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function currentSize() {
    return E.presetSize(E.getPreset(state.preset), state.custom);
  }

  /**
   * The image's footprint in FRAME space. A quarter turn swaps width and
   * height, so cover-zoom and pan clamping have to use the rotated box or
   * a rotated photo leaves gaps at the frame edges.
   */
  function coverSize() {
    if (!img) return { w: 0, h: 0 };
    var quarter = state.transform.rotate === 90 || state.transform.rotate === 270;
    return quarter
      ? { w: img.naturalHeight, h: img.naturalWidth }
      : { w: img.naturalWidth, h: img.naturalHeight };
  }

  /* ======================================================================
     Loading
     ====================================================================== */

  var ACCEPTED = /^image\/(jpeg|png|webp|bmp|heic|heif)$/i;

  function handleFile(file) {
    if (!file) return;
    if (!ACCEPTED.test(file.type) && !/\.(jpe?g|png|webp|bmp)$/i.test(file.name || '')) {
      status('Please choose an image file — JPG, PNG or WebP.', 'bad');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      status('That image is larger than 30 MB. Try a smaller file.', 'bad');
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () { status('That file could not be read.', 'bad'); };
    reader.onload = function () {
      var next = new Image();
      next.onload = function () {
        img = next;
        imgName = file.name || 'photo';
        resetTransform();
        if (dom.studio) dom.studio.dataset.state = 'ready';
        render();
        status('Photo loaded — drag to position, scroll or pinch to zoom.', 'good');
        announce('Photo loaded. ' + next.naturalWidth + ' by ' + next.naturalHeight + ' pixels.');
      };
      next.onerror = function () { status('That image could not be decoded. Try a JPG or PNG.', 'bad'); };
      next.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /** Start at the smallest zoom that still covers the frame, centred. */
  function resetTransform() {
    if (!img) return;
    var size = currentSize();
    var cover = coverSize();
    state.transform.zoom = E.minZoomToCover(cover.w, cover.h, size.width, size.height);
    state.transform.panX = 0;
    state.transform.panY = 0;
    state = E.normalize(state);
    syncZoomSlider();
  }

  function syncZoomSlider() {
    if (!dom.zoom || !img) return;
    var size = currentSize();
    var cover = coverSize();
    var min = E.minZoomToCover(cover.w, cover.h, size.width, size.height);
    dom.zoom.min = String(min.toFixed(4));
    dom.zoom.max = String((min * 4).toFixed(4));
    dom.zoom.step = String((min / 100).toFixed(6));
    dom.zoom.value = String(state.transform.zoom);
  }

  /* ======================================================================
     Rendering
     ====================================================================== */

  function render() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      frame = 0;
      renderStage();
      renderInfo();
      renderNotes();
      renderSheetInfo();
      updateVisibility();
      saveState();
    });
  }

  /**
   * Draw the photo into an arbitrary context at a given output size.
   * The preview and the export both go through this, so what you see is
   * what gets written — only the scale differs.
   */
  function paint(ctx, outW, outH, size) {
    ctx.save();
    ctx.clearRect(0, 0, outW, outH);

    /* Background first: it shows wherever the photo does not reach and is
       what a "white background" requirement actually means here. */
    ctx.fillStyle = state.background.apply ? state.background.color : '#ffffff';
    ctx.fillRect(0, 0, outW, outH);

    if (!img) { ctx.restore(); return; }

    var scale = outW / size.width;           // preview vs export
    var zoom = state.transform.zoom * scale;
    var drawnW = img.naturalWidth * zoom;
    var drawnH = img.naturalHeight * zoom;
    var cx = outW / 2 + state.transform.panX * scale;
    var cy = outH / 2 + state.transform.panY * scale;

    var filter = E.filterString(state);
    if (filter !== 'none' && 'filter' in ctx) ctx.filter = filter;

    ctx.translate(cx, cy);
    if (state.transform.rotate) ctx.rotate((state.transform.rotate * Math.PI) / 180);
    if (state.transform.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -drawnW / 2, -drawnH / 2, drawnW, drawnH);

    ctx.restore();
  }

  function renderStage() {
    if (!dom.canvas) return;
    var size = currentSize();
    /* Hardened browsers and privacy extensions can refuse a 2D context.
       Everything else on the page still works, so degrade instead of dying. */
    var ctx = dom.canvas.getContext && dom.canvas.getContext('2d');
    if (!ctx) return;

    /* Fit the preview into the available width, capped so a big photo does
       not push the controls off screen. */
    var maxW = Math.min(360, (dom.stage && dom.stage.clientWidth ? dom.stage.clientWidth - 24 : 360));
    var ratio = size.height / size.width;
    var cssW = Math.max(120, maxW);
    var cssH = Math.round(cssW * ratio);
    var dpr = Math.min(2, window.devicePixelRatio || 1);

    dom.canvas.width = Math.round(cssW * dpr);
    dom.canvas.height = Math.round(cssH * dpr);
    dom.canvas.style.width = cssW + 'px';
    dom.canvas.style.height = cssH + 'px';

    paint(ctx, dom.canvas.width, dom.canvas.height, size);
    if (state.guide.show || state.guide.grid) drawGuides(ctx, dom.canvas.width, dom.canvas.height, size);
  }

  /** Head-size and eye-line guides, computed from the selected preset. */
  function drawGuides(ctx, w, h, size) {
    var guide = E.headGuide(size, E.getPreset(state.preset));
    var scale = w / size.width;

    ctx.save();
    ctx.lineWidth = Math.max(1, 1.5 * (w / 360));

    if (state.guide.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.setLineDash([4, 4]);
      for (var i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo((w / 3) * i, 0); ctx.lineTo((w / 3) * i, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (h / 3) * i); ctx.lineTo(w, (h / 3) * i); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (state.guide.show) {
      /* The band the top of the head should land in. */
      var minTop = guide.eyeLineY * scale - (guide.minHeadHeight * scale) * 0.45;
      var maxTop = guide.eyeLineY * scale - (guide.maxHeadHeight * scale) * 0.45;
      ctx.fillStyle = 'rgba(126,34,206,.12)';
      ctx.fillRect(0, Math.min(minTop, maxTop), w, Math.abs(minTop - maxTop));

      ctx.strokeStyle = 'rgba(126,34,206,.85)';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, guide.eyeLineY * scale);
      ctx.lineTo(w, guide.eyeLineY * scale);
      ctx.stroke();

      /* An oval showing roughly where the face should sit. */
      ctx.setLineDash([]);
      var headH = ((guide.minHeadHeight + guide.maxHeadHeight) / 2) * scale;
      var headW = headH * 0.72;
      ctx.beginPath();
      ctx.ellipse(w / 2, guide.eyeLineY * scale + headH * 0.08, headW / 2, headH / 2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(126,34,206,.55)';
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderInfo() {
    var size = currentSize();
    if (dom.dims) dom.dims.textContent = E.describeSize(size);

    var preset = E.getPreset(state.preset);
    if (dom.presetNote) {
      var bits = [];
      if (preset.note) bits.push(preset.note);
      if (preset.maxKB) bits.push('This portal caps the file at about ' + preset.maxKB + ' KB.');
      dom.presetNote.textContent = bits.join(' ');
      dom.presetNote.hidden = bits.length === 0;
    }
    if (dom.sourceInfo) {
      dom.sourceInfo.textContent = img
        ? img.naturalWidth + ' × ' + img.naturalHeight + ' px source'
        : 'No photo loaded';
    }
  }

  function renderNotes() {
    if (!dom.notes) return;
    while (dom.notes.firstChild) dom.notes.removeChild(dom.notes.firstChild);
    if (!img) { dom.notes.hidden = true; return; }

    var cover = coverSize();
    var result = E.validateSource(cover.w, cover.h, currentSize(), state.transform.zoom);
    result.notes.forEach(function (note) {
      var li = el('li', 'ppm-note', note.text);
      li.dataset.level = note.level;
      dom.notes.appendChild(li);
    });
    dom.notes.hidden = result.notes.length === 0;
  }

  function renderSheetInfo() {
    if (!dom.sheetInfo) return;
    var size = currentSize();
    var layout = E.sheetLayout(size.mm, state.sheet.id, { gutter: state.sheet.gutter, margin: state.sheet.margin });
    var article = /^[AEIOU]/i.test(layout.sheet.label) ? 'an ' : 'a ';
    dom.sheetInfo.textContent = layout.count > 0
      ? layout.count + ' photo' + (layout.count === 1 ? '' : 's') +
        ' (' + layout.cols + ' × ' + layout.rows + ') on ' + article + layout.sheet.label
      : 'This photo is too large for the selected sheet.';
    if (dom.sheetDownload) dom.sheetDownload.disabled = layout.count === 0 || !img;
  }

  function updateVisibility() {
    all('[data-when-custom]').forEach(function (node) {
      node.hidden = state.preset !== 'custom';
    });
    (dom.bgSwatches || []).forEach(function (btn) {
      var active = btn.dataset.bg === state.background.id;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });
    if (dom.targetRow) dom.targetRow.hidden = state.output.format !== 'jpeg';
  }

  /* ======================================================================
     Export
     ====================================================================== */

  function renderFinalCanvas() {
    var size = currentSize();
    var canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    paint(canvas.getContext('2d'), size.width, size.height, size);
    return canvas;
  }

  function blobFromCanvas(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (!canvas.toBlob) { reject(new Error('This browser cannot export canvas images.')); return; }
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('The image could not be encoded.'));
      }, type, quality);
    });
  }

  /**
   * Encode, honouring a KB budget when one is set.
   * Measurement uses toDataURL because it is synchronous, which lets the
   * engine's binary search stay a plain function; the winning quality is
   * then re-encoded properly with toBlob.
   */
  function encode(canvas) {
    var type = state.output.format === 'png' ? 'image/png' : 'image/jpeg';
    if (type === 'image/png') return blobFromCanvas(canvas, type, undefined).then(function (b) { return { blob: b, achieved: true }; });

    var targetBytes = state.output.targetKB > 0 ? state.output.targetKB * 1024 : 0;
    if (!targetBytes) {
      return blobFromCanvas(canvas, type, state.output.quality).then(function (b) { return { blob: b, achieved: true }; });
    }

    var measure = function (q) {
      var url = canvas.toDataURL(type, q);
      /* base64 carries 3 bytes per 4 characters, minus the data: prefix. */
      var base64 = url.slice(url.indexOf(',') + 1);
      return Math.round(base64.length * 0.75);
    };
    var picked = E.pickQuality(measure, targetBytes, { min: 0.3, max: 0.95, steps: 8 });
    return blobFromCanvas(canvas, type, picked.quality).then(function (b) {
      return { blob: b, achieved: picked.achieved, quality: picked.quality };
    });
  }

  /** Rewrite the JFIF density so the file prints at the right physical size. */
  function stampDpi(blob, dpi) {
    if (blob.type !== 'image/jpeg') return Promise.resolve(blob);
    return blob.arrayBuffer().then(function (buffer) {
      var stamped = E.setJpegDpi(new Uint8Array(buffer), dpi);
      return new Blob([stamped], { type: 'image/jpeg' });
    }).catch(function () { return blob; });
  }

  function downloadPhoto() {
    if (!img) { status('Load a photo first.', 'bad'); return; }
    var size = currentSize();
    encode(renderFinalCanvas()).then(function (result) {
      return stampDpi(result.blob, size.dpi).then(function (blob) {
        download(blob, E.suggestedFilename(state));
        if (state.output.targetKB > 0 && !result.achieved) {
          status('Downloaded at ' + E.formatBytes(blob.size) + ' — could not reach ' +
            state.output.targetKB + ' KB without unusable quality. Try a smaller pixel size.', 'warn');
        } else {
          status('Downloaded ' + E.formatBytes(blob.size) + ' at ' + size.dpi + ' DPI ✓', 'good');
        }
      });
    }).catch(function (err) {
      status(err && err.message ? err.message : 'The photo could not be exported.', 'bad');
    });
  }

  /** A printable sheet of repeated copies, with optional cut marks. */
  function downloadSheet() {
    if (!img) { status('Load a photo first.', 'bad'); return; }
    var size = currentSize();
    var layout = E.sheetLayout(size.mm, state.sheet.id, { gutter: state.sheet.gutter, margin: state.sheet.margin });
    if (!layout.count) { status('This photo does not fit on the selected sheet.', 'bad'); return; }

    var dpi = size.dpi;
    var sheetW = Math.round((layout.sheetWidthMm / E.MM_PER_INCH) * dpi);
    var sheetH = Math.round((layout.sheetHeightMm / E.MM_PER_INCH) * dpi);

    var sheet = document.createElement('canvas');
    sheet.width = sheetW;
    sheet.height = sheetH;
    var ctx = sheet.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sheetW, sheetH);

    var photo = renderFinalCanvas();
    var pw = Math.round((size.mm[0] / E.MM_PER_INCH) * dpi);
    var ph = Math.round((size.mm[1] / E.MM_PER_INCH) * dpi);

    layout.positions.forEach(function (pos) {
      var x = Math.round((pos.x / E.MM_PER_INCH) * dpi);
      var y = Math.round((pos.y / E.MM_PER_INCH) * dpi);
      ctx.drawImage(photo, x, y, pw, ph);
      if (state.sheet.cutMarks) {
        ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
        ctx.setLineDash([]);
      }
    });

    blobFromCanvas(sheet, 'image/jpeg', 0.94)
      .then(function (blob) { return stampDpi(blob, dpi); })
      .then(function (blob) {
        download(blob, 'passport-photo-sheet-' + layout.sheet.id + '.jpg');
        status(layout.count + ' photos on a ' + layout.sheet.label + ' ✓', 'good');
      })
      .catch(function (err) { status(err && err.message ? err.message : 'The sheet could not be created.', 'bad'); });
  }

  /* ======================================================================
     Pointer interaction
     ====================================================================== */

  function applyPan(dx, dy) {
    if (!img) return;
    var size = currentSize();
    var cover = coverSize();
    var scale = (dom.canvas ? dom.canvas.width : size.width) / size.width;
    var next = E.clampPan(
      { x: state.transform.panX + dx / scale, y: state.transform.panY + dy / scale },
      cover.w, cover.h, size.width, size.height, state.transform.zoom
    );
    state.transform.panX = next.x;
    state.transform.panY = next.y;
    render();
  }

  function applyZoom(next) {
    if (!img) return;
    var size = currentSize();
    var cover = coverSize();
    var min = E.minZoomToCover(cover.w, cover.h, size.width, size.height);
    state.transform.zoom = E.clampNum(next, min, min * 4, min);
    var clamped = E.clampPan(
      { x: state.transform.panX, y: state.transform.panY },
      cover.w, cover.h, size.width, size.height, state.transform.zoom
    );
    state.transform.panX = clamped.x;
    state.transform.panY = clamped.y;
    syncZoomSlider();
    render();
  }

  function wirePointer() {
    var canvas = dom.canvas;
    if (!canvas) return;

    on(canvas, 'pointerdown', function (e) {
      if (!img) return;
      canvas.setPointerCapture(e.pointerId);
      pointer.active = true;
      pointer.id = e.pointerId;
      pointer.startX = e.clientX;
      pointer.startY = e.clientY;
      pointer.panX = state.transform.panX;
      pointer.panY = state.transform.panY;
      canvas.style.cursor = 'grabbing';
    });

    on(canvas, 'pointermove', function (e) {
      if (!pointer.active || e.pointerId !== pointer.id || !img) return;
      var size = currentSize();
      var cover = coverSize();
      /* CSS pixels → canvas pixels → frame pixels. */
      var perCssPx = (canvas.width / canvas.clientWidth) / (canvas.width / size.width);
      var next = E.clampPan(
        { x: pointer.panX + (e.clientX - pointer.startX) * perCssPx,
          y: pointer.panY + (e.clientY - pointer.startY) * perCssPx },
        cover.w, cover.h, size.width, size.height, state.transform.zoom
      );
      state.transform.panX = next.x;
      state.transform.panY = next.y;
      render();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      on(canvas, type, function () {
        pointer.active = false;
        canvas.style.cursor = img ? 'grab' : 'default';
      });
    });

    on(canvas, 'wheel', function (e) {
      if (!img) return;
      e.preventDefault();
      applyZoom(state.transform.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    }, { passive: false });
  }

  /* ======================================================================
     Persistence
     ====================================================================== */

  function saveState() {
    try {
      /* Only the settings — never the photo itself. */
      var copy = E.cloneState(state);
      copy.transform = E.defaultState().transform;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    } catch (err) {}
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return E.defaultState();
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? E.normalize(parsed) : E.defaultState();
    } catch (err) { return E.defaultState(); }
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function cacheDom() {
    dom.studio = $('ppmStudio');
    dom.status = $('ppmStatus');
    dom.live = $('ppmLive');

    dom.drop = $('ppmDrop');
    dom.file = $('ppmFile');
    dom.browse = $('ppmBrowse');
    dom.changePhoto = $('ppmChangePhoto');

    dom.stage = $('ppmStage');
    dom.canvas = $('ppmCanvas');
    dom.zoom = $('ppmZoom');
    dom.resetPos = $('ppmResetPosition');
    dom.rotate = $('ppmRotate');
    dom.flip = $('ppmFlip');

    dom.preset = $('ppmPreset');
    dom.presetNote = $('ppmPresetNote');
    dom.dims = $('ppmDims');
    dom.sourceInfo = $('ppmSourceInfo');
    dom.notes = $('ppmNotes');

    dom.customW = $('ppmCustomW');
    dom.customH = $('ppmCustomH');
    dom.customUnit = $('ppmCustomUnit');
    dom.customDpi = $('ppmCustomDpi');

    dom.bgRow = $('ppmBackgrounds');
    dom.bgCustom = $('ppmBgCustom');
    dom.bgApply = $('ppmBgApply');

    dom.brightness = $('ppmBrightness');
    dom.contrast = $('ppmContrast');
    dom.saturation = $('ppmSaturation');

    dom.showGuide = $('ppmShowGuide');
    dom.showGrid = $('ppmShowGrid');

    dom.format = $('ppmFormat');
    dom.quality = $('ppmQuality');
    dom.targetKB = $('ppmTargetKB');
    dom.targetRow = $('ppmTargetRow');

    dom.sheetSelect = $('ppmSheet');
    dom.sheetGutter = $('ppmSheetGutter');
    dom.sheetMargin = $('ppmSheetMargin');
    dom.cutMarks = $('ppmCutMarks');
    dom.sheetInfo = $('ppmSheetInfo');
    dom.sheetDownload = $('ppmDownloadSheet');

    dom.downloadPhoto = $('ppmDownload');
    dom.reset = $('ppmReset');

    dom.bgSwatches = [];
  }

  function buildPresetOptions() {
    if (!dom.preset) return;
    E.presetGroups().forEach(function (group) {
      var optgroup = document.createElement('optgroup');
      optgroup.label = group.group;
      group.presets.forEach(function (p) {
        var size = E.presetSize(p);
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label + ' — ' +
          (p.id === 'custom' ? 'set your own' :
            (Math.round(size.mm[0] * 10) / 10) + ' × ' + (Math.round(size.mm[1] * 10) / 10) + ' mm (' +
            size.width + ' × ' + size.height + ' px)');
        optgroup.appendChild(opt);
      });
      dom.preset.appendChild(optgroup);
    });
    dom.preset.value = state.preset;
  }

  function buildBackgrounds() {
    if (!dom.bgRow) return;
    E.BACKGROUNDS.forEach(function (bg) {
      var btn = el('button', 'ppm-swatch');
      btn.type = 'button';
      btn.dataset.bg = bg.id;
      btn.style.background = bg.color;
      btn.title = bg.label + (bg.note ? ' — ' + bg.note : '');
      btn.setAttribute('aria-label', 'Background: ' + bg.label);
      btn.addEventListener('click', function () {
        state.background.id = bg.id;
        state.background.color = bg.color;
        state.background.apply = true;
        if (dom.bgApply) dom.bgApply.checked = true;
        if (dom.bgCustom) dom.bgCustom.value = bg.color;
        state = E.normalize(state);
        render();
        announce('Background set to ' + bg.label + '.');
      });
      dom.bgRow.appendChild(btn);
      dom.bgSwatches.push(btn);
    });
  }

  function wire() {
    on(dom.browse, 'click', function () { if (dom.file) dom.file.click(); });
    on(dom.changePhoto, 'click', function () { if (dom.file) dom.file.click(); });
    on(dom.file, 'change', function () {
      handleFile(dom.file.files && dom.file.files[0]);
      dom.file.value = '';
    });

    if (dom.drop) {
      ['dragenter', 'dragover'].forEach(function (type) {
        dom.drop.addEventListener(type, function (e) {
          e.preventDefault(); e.stopPropagation();
          dom.drop.classList.add('is-dragging');
        });
      });
      ['dragleave', 'dragend', 'drop'].forEach(function (type) {
        dom.drop.addEventListener(type, function (e) {
          e.preventDefault(); e.stopPropagation();
          dom.drop.classList.remove('is-dragging');
          if (type === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
          }
        });
      });
      dom.drop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (dom.file) dom.file.click();
        }
      });
    }
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    on(dom.preset, 'change', function () {
      state.preset = dom.preset.value;
      state = E.normalize(state);
      resetTransform();
      render();
    });

    [dom.customW, dom.customH, dom.customDpi].forEach(function (input) {
      on(input, 'input', function () {
        state.custom.width = parseFloat(dom.customW.value);
        state.custom.height = parseFloat(dom.customH.value);
        state.custom.dpi = parseFloat(dom.customDpi.value);
        state = E.normalize(state);
        resetTransform();
        render();
      });
    });
    on(dom.customUnit, 'change', function () {
      state.custom.unit = dom.customUnit.value;
      state = E.normalize(state);
      resetTransform();
      render();
    });

    on(dom.zoom, 'input', function () { applyZoom(parseFloat(dom.zoom.value)); });
    on(dom.resetPos, 'click', function () { resetTransform(); render(); announce('Position reset.'); });
    on(dom.rotate, 'click', function () {
      state.transform.rotate = (state.transform.rotate + 90) % 360;
      state = E.normalize(state);
      render();
      announce('Rotated to ' + state.transform.rotate + ' degrees.');
    });
    on(dom.flip, 'click', function () {
      state.transform.flip = !state.transform.flip;
      render();
      announce(state.transform.flip ? 'Mirrored.' : 'Mirror removed.');
    });

    on(dom.bgCustom, 'input', function () {
      state.background.id = 'custom';
      state.background.color = dom.bgCustom.value;
      state.background.apply = true;
      state = E.normalize(state);
      render();
    });
    on(dom.bgApply, 'change', function () {
      state.background.apply = dom.bgApply.checked;
      render();
    });

    [['brightness', 'brightness'], ['contrast', 'contrast'], ['saturation', 'saturation']].forEach(function (pair) {
      var input = dom[pair[0]];
      on(input, 'input', function () {
        state.adjust[pair[1]] = parseFloat(input.value);
        state = E.normalize(state);
        var out = input.parentNode.querySelector('output');
        if (out) out.textContent = state.adjust[pair[1]] + '%';
        render();
      });
    });

    on(dom.showGuide, 'change', function () { state.guide.show = dom.showGuide.checked; render(); });
    on(dom.showGrid, 'change', function () { state.guide.grid = dom.showGrid.checked; render(); });

    on(dom.format, 'change', function () {
      state.output.format = dom.format.value;
      state = E.normalize(state);
      render();
    });
    on(dom.quality, 'input', function () {
      state.output.quality = parseFloat(dom.quality.value) / 100;
      state = E.normalize(state);
      var out = dom.quality.parentNode.querySelector('output');
      if (out) out.textContent = Math.round(state.output.quality * 100) + '%';
      render();
    });
    on(dom.targetKB, 'change', function () {
      state.output.targetKB = parseInt(dom.targetKB.value, 10) || 0;
      state = E.normalize(state);
      render();
    });

    on(dom.sheetSelect, 'change', function () { state.sheet.id = dom.sheetSelect.value; state = E.normalize(state); render(); });
    on(dom.sheetGutter, 'input', function () {
      state.sheet.gutter = parseFloat(dom.sheetGutter.value);
      state = E.normalize(state);
      var out = dom.sheetGutter.parentNode.querySelector('output');
      if (out) out.textContent = state.sheet.gutter + ' mm';
      render();
    });
    on(dom.sheetMargin, 'input', function () {
      state.sheet.margin = parseFloat(dom.sheetMargin.value);
      state = E.normalize(state);
      var out = dom.sheetMargin.parentNode.querySelector('output');
      if (out) out.textContent = state.sheet.margin + ' mm';
      render();
    });
    on(dom.cutMarks, 'change', function () { state.sheet.cutMarks = dom.cutMarks.checked; render(); });

    on(dom.downloadPhoto, 'click', downloadPhoto);
    on(dom.sheetDownload, 'click', downloadSheet);
    on(dom.reset, 'click', function () {
      var keepImage = img;
      state = E.defaultState();
      img = keepImage;
      syncControls();
      resetTransform();
      render();
      status('Settings reset.', 'good');
    });

    wirePointer();

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 140);
    });
  }

  function syncControls() {
    if (dom.preset) dom.preset.value = state.preset;
    if (dom.customW) dom.customW.value = String(state.custom.width);
    if (dom.customH) dom.customH.value = String(state.custom.height);
    if (dom.customUnit) dom.customUnit.value = state.custom.unit;
    if (dom.customDpi) dom.customDpi.value = String(state.custom.dpi);
    if (dom.bgCustom) dom.bgCustom.value = state.background.color;
    if (dom.bgApply) dom.bgApply.checked = state.background.apply;
    if (dom.showGuide) dom.showGuide.checked = state.guide.show;
    if (dom.showGrid) dom.showGrid.checked = state.guide.grid;
    if (dom.format) dom.format.value = state.output.format;
    if (dom.targetKB) dom.targetKB.value = String(state.output.targetKB);
    if (dom.sheetSelect) dom.sheetSelect.value = state.sheet.id;
    if (dom.cutMarks) dom.cutMarks.checked = state.sheet.cutMarks;

    [['brightness', state.adjust.brightness, '%'], ['contrast', state.adjust.contrast, '%'],
     ['saturation', state.adjust.saturation, '%']].forEach(function (t) {
      var input = dom[t[0]];
      if (!input) return;
      input.value = String(t[1]);
      var out = input.parentNode.querySelector('output');
      if (out) out.textContent = t[1] + t[2];
    });

    if (dom.quality) {
      dom.quality.value = String(Math.round(state.output.quality * 100));
      var qOut = dom.quality.parentNode.querySelector('output');
      if (qOut) qOut.textContent = Math.round(state.output.quality * 100) + '%';
    }
    if (dom.sheetGutter) {
      dom.sheetGutter.value = String(state.sheet.gutter);
      var gOut = dom.sheetGutter.parentNode.querySelector('output');
      if (gOut) gOut.textContent = state.sheet.gutter + ' mm';
    }
    if (dom.sheetMargin) {
      dom.sheetMargin.value = String(state.sheet.margin);
      var mOut = dom.sheetMargin.parentNode.querySelector('output');
      if (mOut) mOut.textContent = state.sheet.margin + ' mm';
    }
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  function initializeMaker() {
    cacheDom();
    if (!dom.studio) return;

    state = loadState();
    buildPresetOptions();
    buildBackgrounds();
    syncControls();
    wire();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeMaker);
  else initializeMaker();

  window.PassportPhotoStudio = {
    getState: function () { return state; },
    setState: function (next) { state = E.normalize(next); syncControls(); render(); },
    setImage: function (image) { img = image; if (dom.studio) dom.studio.dataset.state = 'ready'; resetTransform(); render(); },
    hasImage: function () { return !!img; },
    render: render,
    applyZoom: applyZoom,
    applyPan: applyPan,
    downloadPhoto: downloadPhoto,
    downloadSheet: downloadSheet,
    STORAGE_KEY: STORAGE_KEY
  };
})();
