/**
 * EXIF Metadata Remover — UI application
 */
(function () {
  'use strict';

  var E = window.ExifEngine;
  if (!E) return;

  var root = document.querySelector('[data-xrf-app]');
  if (!root) return;

  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }
  function esc(s) {
    var d = document.createElement('span');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  var state = {
    files: [],
    activeId: null,
    settings: {
      quality: 95,
      previewBg: 'checker',
      compare: false,
      removeGps: true,
      removeCamera: true,
      removeDatetime: true,
      removeAuthor: true,
      removeSoftware: true,
      removeOther: true
    }
  };

  var dom = {};

  function cacheDom() {
    dom.drop = $('[data-xrf-drop]');
    dom.fileInput = $('[data-xrf-file]');
    dom.browse = $('[data-xrf-browse]');
    dom.privacy = $('[data-xrf-privacy]');
    dom.studio = $('[data-xrf-studio]');
    dom.empty = $('[data-xrf-empty]');
    dom.queue = $('[data-xrf-queue]');
    dom.queueList = $('[data-xrf-queue-list]');
    dom.batchBar = $('[data-xrf-batch-bar]');
    dom.batchProgress = $('[data-xrf-batch-progress]');
    dom.processAll = $('[data-xrf-process-all]');
    dom.downloadAll = $('[data-xrf-download-all]');
    dom.clearAll = $('[data-xrf-clear-all]');
    dom.detail = $('[data-xrf-detail]');
    dom.previewWrap = $('[data-xrf-preview-wrap]');
    dom.previewImg = $('[data-xrf-preview-img]');
    dom.previewMeta = $('[data-xrf-preview-meta]');
    dom.previewBg = $('[data-xrf-preview-bg]');
    dom.fullscreenBtn = $('[data-xrf-fullscreen]');
    dom.zoomIn = $('[data-xrf-zoom-in]');
    dom.zoomOut = $('[data-xrf-zoom-out]');
    dom.zoomReset = $('[data-xrf-zoom-reset]');
    dom.metaSummary = $('[data-xrf-meta-summary]');
    dom.metaInspector = $('[data-xrf-meta-inspector]');
    dom.gpsWarn = $('[data-xrf-gps-warn]');
    dom.removeBtns = Array.prototype.slice.call(document.querySelectorAll('[data-xrf-remove]'));
    dom.downloadLinks = Array.prototype.slice.call(document.querySelectorAll('[data-xrf-download]'));
    dom.actionDock = document.querySelector('[data-xrf-action-dock]');
    dom.quality = $('[data-xrf-quality]');
    dom.compareToggle = $('[data-xrf-compare-toggle]');
    dom.compareWrap = $('[data-xrf-compare-wrap]');
    dom.compareRange = $('[data-xrf-compare-range]');
    dom.beforeAfter = $('[data-xrf-before-after]');
    dom.resultCard = $('[data-xrf-result]');
    dom.processAnother = $('[data-xrf-another]');
    dom.status = $('[data-xrf-status]');
    dom.progress = $('[data-xrf-progress]');
    dom.progressText = $('[data-xrf-progress-text]');
    dom.error = $('[data-xrf-error]');
    dom.fsModal = $('[data-xrf-fs-modal]');
    dom.fsImg = $('[data-xrf-fs-img]');
    dom.fsClose = $('[data-xrf-fs-close]');
  }

  function freshEntry(file) {
    return {
      id: 'f_' + Math.random().toString(36).slice(2, 10),
      file: file,
      name: file.name,
      mime: file.type || E.mimeFromName && E.mimeFromName(file.name) || '',
      size: file.size,
      width: 0,
      height: 0,
      previewUrl: null,
      image: null,
      buffer: null,
      scan: E.emptyScan(),
      status: 'waiting',
      error: '',
      clean: null,
      zoom: 1
    };
  }

  function setStatus(msg, tone) {
    if (!dom.status) return;
    dom.status.textContent = msg || '';
    dom.status.hidden = !msg;
    dom.status.dataset.tone = tone || 'info';
  }

  function setProgress(show, text) {
    if (dom.progress) dom.progress.hidden = !show;
    if (dom.progressText && text) dom.progressText.textContent = text;
  }

  function setError(msg) {
    if (!dom.error) return;
    dom.error.hidden = !msg;
    dom.error.textContent = msg || '';
  }

  function activeEntry() {
    return state.files.find(function (f) { return f.id === state.activeId; }) || null;
  }

  function revokeEntry(entry) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    if (entry.clean && entry.clean.url) URL.revokeObjectURL(entry.clean.url);
  }

  function updateStudioVisibility() {
    var has = state.files.length > 0;
    if (dom.empty) dom.empty.hidden = has;
    if (dom.studio) dom.studio.hidden = !has;
    if (dom.batchBar) dom.batchBar.hidden = !has || state.files.length < 2;
  }

  async function handleFiles(fileList) {
    setError('');
    var added = 0;
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      var v = E.validateFile(file);
      if (!v.ok) {
        setError(v.error);
        continue;
      }
      var entry = freshEntry(file);
      entry.mime = v.mime || entry.mime;
      entry.status = 'scanning';
      state.files.push(entry);
      added++;
      renderQueue();
      updateStudioVisibility();

      try {
        setProgress(true, 'Reading ' + file.name + '…');
        entry.buffer = await file.arrayBuffer();
        var loaded = await E.loadImageElement(file);
        entry.image = loaded.img;
        entry.previewUrl = loaded.url;
        entry.width = loaded.width;
        entry.height = loaded.height;
        var dim = E.validateDimensions(entry.width, entry.height);
        if (!dim.ok) throw new Error(dim.error);
        entry.scan = E.scanMetadata(entry.buffer, entry.mime);
        entry.status = entry.scan.hasMetadata ? 'found' : 'clean-scan';
      } catch (err) {
        entry.status = 'error';
        entry.error = err.message || 'Could not process this image.';
        revokeEntry(entry);
      }
      renderQueue();
    }

    setProgress(false);
    if (!added) return;
    if (!state.activeId) state.activeId = state.files[0].id;
    renderDetail();
    setStatus(added + ' image' + (added > 1 ? 's' : '') + ' added.', 'good');
  }

  function renderQueue() {
    if (!dom.queueList) return;
    dom.queueList.innerHTML = '';
    state.files.forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'xrf-queue-item' + (entry.id === state.activeId ? ' is-active' : '');
      li.dataset.id = entry.id;
      var statusLabel = {
        waiting: 'Waiting',
        scanning: 'Scanning…',
        found: 'Metadata found',
        'clean-scan': 'No EXIF detected',
        cleaning: 'Cleaning…',
        clean: 'Clean ✓',
        error: 'Error'
      }[entry.status] || entry.status;

      li.innerHTML =
        '<button type="button" class="xrf-queue-item__main" data-select="' + esc(entry.id) + '">' +
          '<span class="xrf-queue-item__thumb">' + (entry.previewUrl ? '<img src="' + esc(entry.previewUrl) + '" alt="" />' : '') + '</span>' +
          '<span class="xrf-queue-item__body">' +
            '<strong>' + esc(entry.name) + '</strong>' +
            '<span>' + esc(E.formatBytes(entry.size)) + ' · ' + esc(statusLabel) + '</span>' +
          '</span>' +
        '</button>' +
        (entry.status === 'clean' && entry.clean ?
          '<a class="xrf-btn xrf-btn--sm" download="' + esc(entry.clean.fileName) + '" href="' + esc(entry.clean.url) + '">Download</a>' : '') +
        '<button type="button" class="xrf-iconbtn" data-remove-file="' + esc(entry.id) + '" aria-label="Remove ' + esc(entry.name) + ' from queue">×</button>';

      dom.queueList.appendChild(li);
    });

    if (dom.batchProgress) {
      var done = state.files.filter(function (f) { return f.status === 'clean'; }).length;
      dom.batchProgress.textContent = state.files.length > 1 ? done + ' / ' + state.files.length + ' processed' : '';
    }
    if (dom.downloadAll) dom.downloadAll.disabled = !state.files.some(function (f) { return f.clean; });
    if (dom.processAll) dom.processAll.disabled = !state.files.some(function (f) { return f.status !== 'clean' && f.status !== 'error' && f.status !== 'cleaning'; });
  }

  function categoryLabel(cat) {
    return {
      camera: 'Camera',
      gps: 'GPS Location',
      datetime: 'Date & Time',
      image: 'Image',
      software: 'Software',
      author: 'Author',
      other: 'Other'
    }[cat] || cat;
  }

  function renderMetaSummary(entry) {
    if (!dom.metaSummary) return;
    var s = entry.scan.summary;
    var rows = [
      ['Metadata fields found', s.total],
      ['GPS', s.gps ? 'Found' : 'Not found'],
      ['Camera', s.camera ? 'Found' : 'Not found'],
      ['Timestamp', s.datetime ? 'Found' : 'Not found'],
      ['Author', s.author ? 'Found' : 'Not found'],
      ['Software', s.software ? 'Found' : 'Not found']
    ];
    dom.metaSummary.innerHTML = rows.map(function (r) {
      var cls = r[1] === 'Found' ? ' xrf-pill--warn' : (r[1] === 'Not found' ? ' xrf-pill--ok' : '');
      return '<div class="xrf-summary-row"><span>' + esc(r[0]) + '</span><span class="xrf-pill' + cls + '">' + esc(String(r[1])) + '</span></div>';
    }).join('');

    if (dom.gpsWarn) dom.gpsWarn.hidden = !s.gps;
  }

  function renderInspector(entry) {
    if (!dom.metaInspector) return;
    if (!entry.scan.hasMetadata) {
      dom.metaInspector.innerHTML = '<p class="xrf-hint">No EXIF metadata detected in this file. Re-encoding will still produce a fresh copy without embedded metadata.</p>';
      return;
    }
    var cats = Object.keys(entry.scan.categories);
    dom.metaInspector.innerHTML = cats.map(function (cat) {
      var fields = entry.scan.categories[cat];
      var rows = fields.map(function (f) {
        var sens = f.sensitive ? ' <span class="xrf-sensitive">Privacy sensitive</span>' : '';
        return '<tr><th scope="row">' + esc(f.name) + sens + '</th><td>' + esc(f.value) + '</td></tr>';
      }).join('');
      return '<details class="xrf-meta-cat" open>' +
        '<summary>' + esc(categoryLabel(cat)) + ' <span class="xrf-meta-count">' + fields.length + '</span></summary>' +
        '<div class="xrf-meta-table-wrap"><table class="xrf-meta-table"><tbody>' + rows + '</tbody></table></div></details>';
    }).join('');
  }

  function renderPreviewMeta(entry) {
    if (!dom.previewMeta) return;
    var type = (entry.mime || '').replace('image/', '').toUpperCase() || 'IMAGE';
    dom.previewMeta.innerHTML =
      '<div><strong>' + esc(entry.name) + '</strong></div>' +
      '<div class="xrf-meta-line">' + esc(type) + ' · ' + esc(E.formatBytes(entry.size)) + ' · ' + esc(entry.width) + ' × ' + esc(entry.height) + '</div>';
  }

  function renderBeforeAfter(entry) {
    if (!dom.beforeAfter) return;
    if (!entry.clean) { dom.beforeAfter.hidden = true; return; }
    dom.beforeAfter.hidden = false;
    var v = entry.clean.verify.summary;
    dom.beforeAfter.innerHTML =
      '<div class="xrf-ba-grid">' +
        '<div class="xrf-ba-col"><h3>Before</h3><ul>' +
          '<li><span>Size</span><strong>' + esc(E.formatBytes(entry.size)) + '</strong></li>' +
          '<li><span>Metadata</span><strong>' + entry.scan.summary.total + ' fields</strong></li>' +
          '<li><span>GPS</span><strong>' + (entry.scan.summary.gps ? 'Found' : 'No') + '</strong></li>' +
        '</ul></div>' +
        '<div class="xrf-ba-col"><h3>After</h3><ul>' +
          '<li><span>Size</span><strong>' + esc(E.formatBytes(entry.clean.size)) + ' (' + esc(E.formatPct(entry.size, entry.clean.size)) + ')</strong></li>' +
          '<li><span>Metadata</span><strong>' + v.total + ' detected</strong></li>' +
          '<li><span>Verification</span><strong class="xrf-ok">' + (v.total === 0 ? 'EXIF not detected ✓' : 'Reduced metadata') + '</strong></li>' +
        '</ul></div>' +
      '</div>' +
      '<div class="xrf-verify">' +
        '<h4>Verification</h4>' +
        '<ul>' +
          '<li>Metadata scan completed</li>' +
          '<li>EXIF detected: <strong>' + (v.total ? 'Yes (' + v.total + ')' : 'No') + '</strong></li>' +
          '<li>GPS detected: <strong>' + (v.gps ? 'Yes' : 'No') + '</strong></li>' +
          '<li>Camera metadata: <strong>' + (v.camera ? 'Yes' : 'No') + '</strong></li>' +
        '</ul></div>';
  }

  function renderResult(entry) {
    if (!dom.resultCard) return;
    if (!entry.clean) { dom.resultCard.hidden = true; return; }
    dom.resultCard.hidden = false;
    dom.resultCard.innerHTML =
      '<div class="xrf-result__head">✓ Metadata removed</div>' +
      '<p>Original: <strong>' + esc(entry.name) + '</strong></p>' +
      '<p>Clean: <strong>' + esc(entry.clean.fileName) + '</strong></p>' +
      '<div class="xrf-result__actions">' +
        '<a class="xrf-btn xrf-btn--primary" download="' + esc(entry.clean.fileName) + '" href="' + esc(entry.clean.url) + '">Download Clean Image</a>' +
        '<button type="button" class="xrf-btn" data-xrf-view-meta>View Metadata</button>' +
        '<button type="button" class="xrf-btn" data-xrf-another>Process Another</button>' +
      '</div>';
  }

  function applyPreviewBg() {
    if (!dom.previewWrap) return;
    dom.previewWrap.dataset.bg = state.settings.previewBg;
  }

  function applyZoom(entry) {
    if (!dom.previewImg || !entry) return;
    dom.previewImg.style.transform = 'scale(' + entry.zoom + ')';
  }

  function syncActionDock(show) {
    var mobile = window.matchMedia('(max-width: 768px)').matches;
    var visible = !!(show && state.files.length > 0);
    if (dom.actionDock) dom.actionDock.hidden = !visible || !mobile;
    document.body.classList.toggle('xrf-dock-open', visible && mobile);
  }

  function syncActionButtons(entry) {
    var disabled = !entry || entry.status === 'cleaning' || entry.status === 'error' || !entry.image;
    dom.removeBtns.forEach(function (btn) { btn.disabled = disabled; });
    dom.downloadLinks.forEach(function (link) {
      if (entry && entry.clean) {
        link.hidden = false;
        link.href = entry.clean.url;
        link.download = entry.clean.fileName;
      } else {
        link.hidden = true;
      }
    });
  }

  function renderDetail() {
    var entry = activeEntry();
    if (!entry || !dom.detail) {
      if (dom.detail) dom.detail.hidden = true;
      syncActionDock(false);
      return;
    }
    dom.detail.hidden = false;
    syncActionDock(true);
    renderPreviewMeta(entry);
    renderMetaSummary(entry);
    renderInspector(entry);
    renderBeforeAfter(entry);
    renderResult(entry);

    if (dom.previewImg) {
      dom.previewImg.src = entry.clean ? entry.clean.url : entry.previewUrl;
      dom.previewImg.alt = 'Preview of ' + entry.name;
    }
    applyPreviewBg();
    applyZoom(entry);
    syncActionButtons(entry);

    if (dom.compareWrap) {
      dom.compareWrap.hidden = !entry.clean || !state.settings.compare;
      if (entry.clean && state.settings.compare) renderCompare(entry);
    }
  }

  async function cleanEntry(entry) {
    if (!entry || !entry.image || entry.status === 'cleaning') return;
    entry.status = 'cleaning';
    renderQueue();
    renderDetail();
    setProgress(true, 'Creating clean image…');
    setError('');

    try {
      if (dom.progressText) dom.progressText.textContent = 'Creating clean image…';
      var result = await E.createCleanImage(entry.file, { img: entry.image, width: entry.width, height: entry.height }, {
        mime: entry.mime,
        quality: state.settings.quality
      });
      if (dom.progressText) dom.progressText.textContent = 'Verifying metadata…';
      if (entry.clean && entry.clean.url) URL.revokeObjectURL(entry.clean.url);
      entry.clean = {
        blob: result.blob,
        buffer: result.buffer,
        size: result.size,
        mime: result.mime,
        verify: result.verify,
        fileName: result.fileName,
        url: URL.createObjectURL(result.blob)
      };
      entry.status = 'clean';
      setStatus('Metadata removed ✓', 'good');
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message || 'Cleaning failed.';
      setError(entry.error);
    }

    setProgress(false);
    renderQueue();
    renderDetail();
  }

  async function processAll() {
    var pending = state.files.filter(function (f) {
      return f.status !== 'clean' && f.status !== 'error' && f.status !== 'cleaning' && f.image;
    });
    for (var i = 0; i < pending.length; i++) {
      await cleanEntry(pending[i]);
    }
  }

  function loadJSZip() {
    return new Promise(function (resolve, reject) {
      if (window.JSZip) { resolve(window.JSZip); return; }
      var s = document.createElement('script');
      s.src = 'assets/js/jszip.min.js';
      s.onload = function () { window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip unavailable')); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function downloadAll() {
    var cleaned = state.files.filter(function (f) { return f.clean; });
    if (!cleaned.length) return;
    if (cleaned.length === 1) {
      var a = document.createElement('a');
      a.href = cleaned[0].clean.url;
      a.download = cleaned[0].clean.fileName;
      a.click();
      return;
    }
    try {
      setProgress(true, 'Building ZIP…');
      var JSZip = await loadJSZip();
      var zip = new JSZip();
      cleaned.forEach(function (f) { zip.file(f.clean.fileName, f.clean.blob); });
      var blob = await zip.generateAsync({ type: 'blob' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'clean-images.zip';
      link.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      setStatus('ZIP downloaded ✓', 'good');
    } catch (e) {
      setError('Could not create ZIP. Download images individually.');
    }
    setProgress(false);
  }

  function clearAll() {
    state.files.forEach(revokeEntry);
    state.files = [];
    state.activeId = null;
    setError('');
    setStatus('');
    syncActionDock(false);
    updateStudioVisibility();
    renderQueue();
    renderDetail();
    if (dom.fileInput) dom.fileInput.value = '';
  }

  function removeFile(id) {
    var idx = state.files.findIndex(function (f) { return f.id === id; });
    if (idx === -1) return;
    revokeEntry(state.files[idx]);
    state.files.splice(idx, 1);
    if (state.activeId === id) state.activeId = state.files.length ? state.files[0].id : null;
    updateStudioVisibility();
    renderQueue();
    renderDetail();
  }

  function wireUpload() {
    if (!dom.drop || !dom.fileInput) return;
    if (dom.browse) dom.browse.addEventListener('click', function (e) { e.stopPropagation(); dom.fileInput.click(); });
    dom.fileInput.addEventListener('change', function () {
      if (dom.fileInput.files.length) handleFiles(Array.prototype.slice.call(dom.fileInput.files));
      dom.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      dom.drop.addEventListener(ev, function (e) {
        e.preventDefault();
        dom.drop.classList.add('is-dragging');
        var title = dom.drop.querySelector('.xrf-drop__title');
        if (title) title.textContent = 'Drop images to remove metadata';
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dom.drop.addEventListener(ev, function (e) {
        e.preventDefault();
        dom.drop.classList.remove('is-dragging');
        var title = dom.drop.querySelector('.xrf-drop__title');
        if (title) title.textContent = 'Drop your images here';
      });
    });
    dom.drop.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) handleFiles(Array.prototype.slice.call(files));
    });
    dom.drop.addEventListener('click', function () { dom.fileInput.click(); });
    dom.drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.fileInput.click(); }
    });

    document.addEventListener('paste', function (e) {
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) { e.preventDefault(); handleFiles(files); }
    });
  }

  function renderCompare(entry) {
    if (!dom.compareWrap || !entry || !entry.clean) return;
    dom.compareWrap.innerHTML =
      '<div class="xrf-compare" data-xrf-compare>' +
        '<img class="xrf-compare__after" src="' + esc(entry.clean.url) + '" alt="Cleaned image" />' +
        '<div class="xrf-compare__before" data-xrf-compare-before style="width:50%">' +
          '<img src="' + esc(entry.previewUrl) + '" alt="Original image" />' +
        '</div>' +
        '<input type="range" min="0" max="100" value="50" class="xrf-compare__slider" data-xrf-compare-range aria-label="Compare original and cleaned image" />' +
      '</div>';
    var range = dom.compareWrap.querySelector('[data-xrf-compare-range]');
    var before = dom.compareWrap.querySelector('[data-xrf-compare-before]');
    if (range && before) {
      range.addEventListener('input', function () {
        before.style.width = range.value + '%';
      });
    }
  }

  function wireControls() {
    dom.removeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () { cleanEntry(activeEntry()); });
    });
    if (dom.processAll) dom.processAll.addEventListener('click', processAll);
    if (dom.downloadAll) dom.downloadAll.addEventListener('click', downloadAll);
    if (dom.clearAll) dom.clearAll.addEventListener('click', clearAll);

    if (dom.quality) dom.quality.addEventListener('change', function () {
      state.settings.quality = parseInt(dom.quality.value, 10) || 95;
    });

    $all('[data-xrf-bg]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.settings.previewBg = btn.dataset.xrfBg;
        $all('[data-xrf-bg]').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
        applyPreviewBg();
      });
    });

    if (dom.compareToggle) dom.compareToggle.addEventListener('change', function () {
      state.settings.compare = dom.compareToggle.checked;
      renderDetail();
    });

    if (dom.zoomIn) dom.zoomIn.addEventListener('click', function () {
      var e = activeEntry(); if (!e) return;
      e.zoom = Math.min(3, Math.round((e.zoom + 0.15) * 100) / 100);
      applyZoom(e);
    });
    if (dom.zoomOut) dom.zoomOut.addEventListener('click', function () {
      var e = activeEntry(); if (!e) return;
      e.zoom = Math.max(0.4, Math.round((e.zoom - 0.15) * 100) / 100);
      applyZoom(e);
    });
    if (dom.zoomReset) dom.zoomReset.addEventListener('click', function () {
      var e = activeEntry(); if (!e) return;
      e.zoom = 1;
      applyZoom(e);
    });

    if (dom.fullscreenBtn) dom.fullscreenBtn.addEventListener('click', openFullscreen);
    if (dom.fsClose) dom.fsClose.addEventListener('click', closeFullscreen);
    if (dom.fsModal) dom.fsModal.addEventListener('click', function (e) {
      if (e.target === dom.fsModal) closeFullscreen();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dom.fsModal.hidden) closeFullscreen();
    });

    root.addEventListener('click', function (e) {
      var sel = e.target.closest('[data-select]');
      if (sel) {
        state.activeId = sel.getAttribute('data-select');
        renderQueue();
        renderDetail();
        return;
      }
      var rem = e.target.closest('[data-remove-file]');
      if (rem) { removeFile(rem.getAttribute('data-remove-file')); return; }
      if (e.target.closest('[data-xrf-another]')) {
        dom.fileInput.click();
      }
      if (e.target.closest('[data-xrf-view-meta]')) {
        var insp = $('[data-xrf-meta-inspector]');
        if (insp) insp.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    if (dom.processAnother) dom.processAnother.addEventListener('click', function () { dom.fileInput.click(); });
  }

  function openFullscreen() {
    var entry = activeEntry();
    if (!entry || !dom.fsImg) return;
    dom.fsImg.src = entry.clean ? entry.clean.url : entry.previewUrl;
    dom.fsModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeFullscreen() {
    if (!dom.fsModal) return;
    dom.fsModal.hidden = true;
    document.body.style.overflow = '';
  }

  function init() {
    cacheDom();
    wireUpload();
    wireControls();
    updateStudioVisibility();
    setStatus('');
    window.addEventListener('resize', function () {
      syncActionDock(dom.detail && !dom.detail.hidden);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
