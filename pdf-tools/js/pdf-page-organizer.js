/* PDF Page Organizer — reorder, rotate, delete, duplicate and merge pages.
   The whole editor is a list of page references, never a rebuilt PDF: each
   entry points at a source document plus a page index, so dropping a second
   file in is just more entries. The PDF is only rewritten once, on export. */
(function () {
  'use strict';

  var PS = window.PdfSuite;
  var root = document.querySelector('[data-organizer]');
  if (!root || !PS) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var els = {
    dropZone: $('[data-drop-zone]'),
    editor: $('[data-editor]'),
    thumbs: $('[data-thumbs]'),
    fileName: $('[data-file-name]'),
    pageCount: $('[data-page-count]'),
    fileSize: $('[data-file-size]'),
    selNote: $('[data-selection-note]'),
    message: $('[data-message]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    selectAll: $('[data-select-all]'),
    undo: $('[data-undo]'),
    redo: $('[data-redo]'),
    saveBtn: $('[data-save-btn]'),
    extractBtn: $('[data-extract-btn]'),
    download: $('[data-download-link]'),
    startOver: $('[data-start-over]')
  };

  var ZOOMS = [118, 150, 190, 240];
  var zoomIndex = 1;

  var sources = {};        // docId -> { bytes, pdfjsDoc, name, size }
  var pages = [];          // [{ uid, docId, index, rotation, selected }]
  var thumbCache = {};     // "docId:index" -> data URL of the rendered page
  var docSeq = 0;
  var uidSeq = 0;
  var undoStack = [];
  var redoStack = [];
  var observer = null;
  var totalBytes = 0;

  /* ------------------------------------------------------------ history */
  function snapshot() {
    return pages.map(function (p) {
      return { uid: p.uid, docId: p.docId, index: p.index, rotation: p.rotation, selected: p.selected };
    });
  }

  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
    syncHistoryButtons();
  }

  function syncHistoryButtons() {
    if (els.undo) els.undo.disabled = !undoStack.length;
    if (els.redo) els.redo.disabled = !redoStack.length;
  }

  function restore(list) {
    pages = list.map(function (p) { return { uid: p.uid, docId: p.docId, index: p.index, rotation: p.rotation, selected: p.selected }; });
    renderThumbs();
    syncCounts();
  }

  /* -------------------------------------------------------------- files */
  function handleFiles(files) {
    var pdfFiles = files.filter(PS.isPdf);
    if (!pdfFiles.length) {
      PS.msg(els.message, 'Please choose PDF (.pdf) files.', 'error');
      return;
    }
    PS.clearMsg(els.message);
    PS.progress(els.progress, els.progressBar, 10, true);

    var added = 0;
    /* Dropping a second file in is an edit like any other, so it goes on the
       undo stack; the first load starts a fresh history instead. */
    if (pages.length) pushHistory(); else { undoStack.length = 0; redoStack.length = 0; }
    var chain = Promise.resolve();
    pdfFiles.forEach(function (file, i) {
      chain = chain.then(function () {
        return PS.openPdf(file).then(function (doc) {
          var id = 'd' + (docSeq += 1);
          sources[id] = doc;
          totalBytes += doc.size;
          for (var p = 0; p < doc.pageCount; p += 1) {
            pages.push({ uid: 'p' + (uidSeq += 1), docId: id, index: p, rotation: 0, selected: false });
          }
          added += doc.pageCount;
          PS.progress(els.progress, els.progressBar, 10 + ((i + 1) / pdfFiles.length) * 80, true);
        }, function (err) {
          PS.msg(els.message, (file.name ? file.name + ': ' : '') + err.message, 'error');
        });
      });
    });

    chain.then(function () {
      PS.progress(els.progress, els.progressBar, 100, true);
      setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 300);
      if (!added) return;
      syncHistoryButtons();
      els.editor.hidden = false;
      els.dropZone.classList.add('is-compact');
      renderThumbs();
      syncCounts();
      if (!els.message.hidden && els.message.dataset.tone === 'error') return;
      PS.msg(els.message, 'Loaded ' + added + ' page' + (added === 1 ? '' : 's') + '. Drag thumbnails to reorder, or use the buttons on each page.', 'success');
      els.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function syncCounts() {
    var names = Object.keys(sources).map(function (id) { return sources[id].name; });
    els.fileName.textContent = names.length > 1 ? names[0] + ' + ' + (names.length - 1) + ' more' : (names[0] || '');
    els.fileName.title = names.join(', ');
    els.pageCount.textContent = pages.length + (pages.length === 1 ? ' page' : ' pages');
    els.fileSize.textContent = PS.fmtSize(totalBytes);
    var n = selected().length;
    els.selNote.textContent = n
      ? n + ' page' + (n === 1 ? '' : 's') + ' selected — page actions apply to the selection.'
      : 'Nothing selected — page actions apply to every page.';
    if (els.extractBtn) els.extractBtn.disabled = !n;
    if (els.saveBtn) els.saveBtn.disabled = !pages.length;
  }

  var selected = function () { return pages.filter(function (p) { return p.selected; }); };
  var targets = function () { var s = selected(); return s.length ? s : pages; };

  /* --------------------------------------------------------- thumbnails */
  function renderThumbs() {
    els.thumbs.innerHTML = '';
    els.thumbs.style.setProperty('--thumb', ZOOMS[zoomIndex] + 'px');
    if (observer) observer.disconnect();
    observer = ('IntersectionObserver' in window)
      ? new IntersectionObserver(onVisible, { root: null, rootMargin: '400px' })
      : null;

    pages.forEach(function (pg, pos) {
      var tile = document.createElement('div');
      tile.className = 'ps-thumb' + (pg.selected ? ' is-selected' : '');
      tile.draggable = true;
      tile.dataset.pos = String(pos);
      /* The page number and its rotation share one corner; the checkbox owns
         the other. That leaves the bar below the preview entirely to the five
         buttons, which is the only way they fit a small thumbnail. */
      tile.innerHTML =
        '<span class="ps-thumb-meta"><span class="ps-thumb-badge">' + (pos + 1) + '</span>' +
        '<span class="ps-thumb-angle">' + (pg.rotation ? pg.rotation + '°' : '') + '</span></span>' +
        '<label class="ps-thumb-check"><input type="checkbox" ' + (pg.selected ? 'checked' : '') +
        ' data-tile-select aria-label="Select page ' + (pos + 1) + '" /></label>' +
        '<div class="ps-thumb-canvas" data-holder><div class="ps-thumb-skeleton"></div></div>' +
        '<div class="ps-thumb-bar">' +
        '<div class="ps-thumb-tools">' +
        '<button type="button" data-tile-left title="Move left" aria-label="Move page ' + (pos + 1) + ' left">←</button>' +
        '<button type="button" data-tile-rotate title="Rotate 90°" aria-label="Rotate page ' + (pos + 1) + '">⟳</button>' +
        '<button type="button" data-tile-copy title="Duplicate page" aria-label="Duplicate page ' + (pos + 1) + '">⧉</button>' +
        '<button type="button" class="is-danger" data-tile-delete title="Delete page" aria-label="Delete page ' + (pos + 1) + '">✕</button>' +
        '<button type="button" data-tile-right title="Move right" aria-label="Move page ' + (pos + 1) + ' right">→</button>' +
        '</div></div>';

      var holder = tile.querySelector('[data-holder]');
      holder.style.setProperty('--rot', pg.rotation + 'deg');

      tile.querySelector('[data-tile-select]').addEventListener('change', function (e) {
        pg.selected = e.target.checked;
        tile.classList.toggle('is-selected', pg.selected);
        syncCounts();
      });
      tile.querySelector('[data-tile-rotate]').addEventListener('click', function () {
        pushHistory();
        pg.rotation = (pg.rotation + 90) % 360;
        holder.style.setProperty('--rot', pg.rotation + 'deg');
        tile.querySelector('.ps-thumb-angle').textContent = pg.rotation ? pg.rotation + '°' : '';
      });
      tile.querySelector('[data-tile-copy]').addEventListener('click', function () {
        pushHistory();
        var copy = { uid: 'p' + (uidSeq += 1), docId: pg.docId, index: pg.index, rotation: pg.rotation, selected: false };
        pages.splice(pos + 1, 0, copy);
        renderThumbs();
        syncCounts();
      });
      tile.querySelector('[data-tile-delete]').addEventListener('click', function () {
        pushHistory();
        pages.splice(pos, 1);
        renderThumbs();
        syncCounts();
        if (!pages.length) PS.msg(els.message, 'Every page was removed. Add a PDF to start again.', 'warn');
      });
      tile.querySelector('[data-tile-left]').addEventListener('click', function () { movePage(pos, pos - 1); });
      tile.querySelector('[data-tile-right]').addEventListener('click', function () { movePage(pos, pos + 1); });

      tile.addEventListener('dragstart', function (e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(pos));
        tile.classList.add('is-dragging');
      });
      tile.addEventListener('dragend', function () { tile.classList.remove('is-dragging'); });
      tile.addEventListener('dragover', function (e) { e.preventDefault(); tile.classList.add('is-over'); });
      tile.addEventListener('dragleave', function () { tile.classList.remove('is-over'); });
      tile.addEventListener('drop', function (e) {
        e.preventDefault();
        tile.classList.remove('is-over');
        var from = Number(e.dataTransfer.getData('text/plain'));
        var to = Number(tile.dataset.pos);
        if (Number.isNaN(from) || from === to) return;
        movePage(from, to);
      });

      els.thumbs.appendChild(tile);
      tile._page = pg;
      if (observer) observer.observe(tile); else paint(tile, pg);
    });
  }

  function movePage(from, to) {
    if (to < 0 || to >= pages.length || from === to) return;
    pushHistory();
    var moved = pages.splice(from, 1)[0];
    pages.splice(to, 0, moved);
    renderThumbs();
    syncCounts();
  }

  function onVisible(entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      paint(entry.target, entry.target._page);
    });
  }

  /* One render per source page, cached as a data URL — a duplicated page or a
     reordered grid then costs nothing but an <img>. */
  function paint(tile, pg) {
    var holder = tile.querySelector('[data-holder]');
    if (!holder || !pg) return;
    var key = pg.docId + ':' + pg.index;

    var show = function (url) {
      var img = new Image();
      img.alt = '';
      img.src = url;
      img.style.maxWidth = '100%';
      img.style.maxHeight = (ZOOMS[zoomIndex] * 1.05) + 'px';
      img.style.boxShadow = '0 6px 16px -10px rgba(15,23,42,0.8)';
      img.style.background = '#fff';
      holder.innerHTML = '';
      holder.appendChild(img);
    };

    if (thumbCache[key]) { show(thumbCache[key]); return; }

    var src = sources[pg.docId];
    if (!src || !src.pdfjsDoc) {
      holder.innerHTML = '<div class="ps-thumb-fallback">Page ' + (pg.index + 1) + '</div>';
      return;
    }
    PS.renderPage(src.pdfjsDoc, pg.index + 1, 260).then(function (canvas) {
      if (!canvas) throw new Error('no canvas');
      thumbCache[key] = canvas.toDataURL('image/jpeg', 0.72);
      show(thumbCache[key]);
    }).catch(function () {
      holder.innerHTML = '<div class="ps-thumb-fallback">Page ' + (pg.index + 1) + '</div>';
    });
  }

  /* ------------------------------------------------------- bulk actions */
  function bulk(fn) {
    if (!pages.length) return;
    pushHistory();
    fn();
    renderThumbs();
    syncCounts();
  }

  function on(sel, handler) {
    var el = $(sel);
    if (el) el.addEventListener('click', handler);
  }

  on('[data-rotate-left]', function () { bulk(function () { targets().forEach(function (p) { p.rotation = (p.rotation + 270) % 360; }); }); });
  on('[data-rotate-right]', function () { bulk(function () { targets().forEach(function (p) { p.rotation = (p.rotation + 90) % 360; }); }); });
  on('[data-reverse]', function () { bulk(function () { pages.reverse(); }); });
  on('[data-duplicate]', function () {
    bulk(function () {
      var out = [];
      pages.forEach(function (p) {
        out.push(p);
        if (p.selected || !selected().length) {
          out.push({ uid: 'p' + (uidSeq += 1), docId: p.docId, index: p.index, rotation: p.rotation, selected: false });
        }
      });
      pages = out;
    });
  });
  on('[data-delete]', function () {
    var keep = pages.filter(function (p) { return !p.selected; });
    if (!selected().length) {
      PS.msg(els.message, 'Select the pages you want to remove first.', 'warn');
      return;
    }
    bulk(function () { pages = keep; });
    PS.msg(els.message, 'Selected pages removed. Use Undo if that was not what you wanted.', 'info');
  });
  on('[data-move-start]', function () {
    if (!selected().length) { PS.msg(els.message, 'Select some pages first.', 'warn'); return; }
    bulk(function () { pages = selected().concat(pages.filter(function (p) { return !p.selected; })); });
  });
  on('[data-move-end]', function () {
    if (!selected().length) { PS.msg(els.message, 'Select some pages first.', 'warn'); return; }
    bulk(function () { pages = pages.filter(function (p) { return !p.selected; }).concat(selected()); });
  });

  if (els.selectAll) {
    els.selectAll.addEventListener('click', function () {
      var anyUnset = pages.some(function (p) { return !p.selected; });
      pages.forEach(function (p) { p.selected = anyUnset; });
      els.selectAll.textContent = anyUnset ? '✓ Deselect all' : '☑ Select all';
      renderThumbs();
      syncCounts();
    });
  }

  on('[data-zoom-in]', function () { zoomIndex = Math.min(ZOOMS.length - 1, zoomIndex + 1); renderThumbs(); });
  on('[data-zoom-out]', function () { zoomIndex = Math.max(0, zoomIndex - 1); renderThumbs(); });

  if (els.undo) {
    els.undo.addEventListener('click', function () {
      if (!undoStack.length) return;
      redoStack.push(snapshot());
      restore(undoStack.pop());
      syncHistoryButtons();
    });
  }
  if (els.redo) {
    els.redo.addEventListener('click', function () {
      if (!redoStack.length) return;
      undoStack.push(snapshot());
      restore(redoStack.pop());
      syncHistoryButtons();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || els.editor.hidden) return;
    var key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey && undoStack.length) { e.preventDefault(); els.undo.click(); }
    else if ((key === 'y' || (key === 'z' && e.shiftKey)) && redoStack.length) { e.preventDefault(); els.redo.click(); }
  });

  /* -------------------------------------------------------------- export */
  function build(list) {
    var out;
    var slots = new Array(list.length);
    var byDoc = {};
    list.forEach(function (p, i) {
      (byDoc[p.docId] = byDoc[p.docId] || []).push({ pos: i, index: p.index });
    });

    return window.PDFLib.PDFDocument.create().then(function (doc) {
      out = doc;
      var ids = Object.keys(byDoc);
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return window.PDFLib.PDFDocument.load(sources[id].bytes, { ignoreEncryption: true }).then(function (src) {
            return out.copyPages(src, byDoc[id].map(function (item) { return item.index; })).then(function (copies) {
              copies.forEach(function (page, k) { slots[byDoc[id][k].pos] = page; });
            });
          });
        });
      });
      return chain;
    }).then(function () {
      slots.forEach(function (page, i) {
        if (!page) return;
        var existing = page.getRotation().angle || 0;
        page.setRotation(window.PDFLib.degrees(((existing + list[i].rotation) % 360 + 360) % 360));
        out.addPage(page);
      });
      return out.save();
    });
  }

  function exportPages(list, suffix, label) {
    if (!list.length) return;
    els.saveBtn.disabled = true;
    if (els.extractBtn) els.extractBtn.disabled = true;
    PS.progress(els.progress, els.progressBar, 25, true);

    build(list).then(function (bytes) {
      PS.progress(els.progress, els.progressBar, 95, true);
      var first = sources[list[0].docId];
      els.download.href = PS.toBlobUrl(bytes);
      els.download.download = PS.baseName(first ? first.name : 'document.pdf') + suffix + '.pdf';
      els.download.classList.remove('hidden');
      els.download.click();
      PS.progress(els.progress, els.progressBar, 100, true);
      setTimeout(function () { PS.progress(els.progress, els.progressBar, 0, false); }, 400);
      PS.msg(els.message, label + ' Use the download button below if the file did not save automatically.', 'success');
    }).catch(function () {
      PS.progress(els.progress, els.progressBar, 0, false);
      PS.msg(els.message, 'Could not build the PDF. Please try again with a smaller file.', 'error');
    }).then(function () {
      syncCounts();
    });
  }

  if (els.saveBtn) {
    els.saveBtn.addEventListener('click', function () {
      exportPages(pages, '-organized', 'Done! Your organized PDF downloaded.');
    });
  }
  if (els.extractBtn) {
    els.extractBtn.addEventListener('click', function () {
      var picked = selected();
      if (!picked.length) { PS.msg(els.message, 'Select the pages you want to export first.', 'warn'); return; }
      exportPages(picked, '-selected-pages', 'Done! A PDF with the ' + picked.length + ' selected page' + (picked.length === 1 ? '' : 's') + ' downloaded.');
    });
  }

  if (els.startOver) {
    els.startOver.addEventListener('click', function () {
      sources = {};
      pages = [];
      thumbCache = {};
      totalBytes = 0;
      undoStack.length = 0;
      redoStack.length = 0;
      syncHistoryButtons();
      els.thumbs.innerHTML = '';
      els.editor.hidden = true;
      els.dropZone.classList.remove('is-compact');
      els.download.classList.add('hidden');
      PS.clearMsg(els.message);
      PS.progress(els.progress, els.progressBar, 0, false);
    });
  }

  PS.bindDrop(root, handleFiles);
  syncHistoryButtons();
}());
