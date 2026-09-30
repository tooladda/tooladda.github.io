/* =============================================================================
   Image source picker — adds "Use camera" and "From URL" to the image tools.

   Every image tool on the site already funnels uploads through a hidden
   <input type="file" data-file-input>, so this module hands its files straight
   to that input (DataTransfer + a synthetic `change`) instead of each tool
   growing its own loader. Put the marker inside the drop zone's button row:

     <div class="isp-actions">
       <button class="pdf-drop-zone-browse" data-file-picker>Browse</button>
       <div class="isp-sources" data-image-sources></div>
     </div>

   The marker is `display: contents`, so the two buttons become siblings of the
   page's own Browse button and line up with it. The URL field and status line
   are moved just below that row, still inside the drop zone.

   Theming: the buttons are outline pills that take their colour from
   `--isp-accent` (falling back to the site `--accent`), so a page with its own
   palette sets that one variable on its drop zone and overrides `.isp-btn` for
   shape if its buttons are not pills.

   Optional attributes on the marker:

     data-isp-input="[data-file-input]"   selector for the target file input
     data-isp-noun="image"                word used in the status messages
     data-isp-camera-label="Use camera"   button label overrides
     data-isp-url-label="From URL"
   ========================================================================== */
(function () {
  'use strict';

  if (window.ImageSourcePicker) return;

  var URL_TIMEOUT_MS = 15000;
  var STYLE_ID = 'isp-styles';

  var CSS = [
    /* Row that holds the page's own Browse button plus ours. Pages that
       already have such a row use theirs and never see this class. */
    '.isp-actions{display:flex;flex-wrap:wrap;gap:.6rem;justify-content:center;align-items:center}',
    /* The marker itself must not become a box, or the buttons would drop onto
       their own line instead of joining the row. */
    '.isp-sources{display:contents}',

    '.isp-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;',
    'min-height:2.7rem;padding:.7rem 1.15rem;border-radius:999px;',
    'border:1.5px solid var(--isp-accent,var(--accent,#4f46e5));',
    'background:var(--surface-strong,#fff);color:var(--isp-accent,var(--accent,#4f46e5));',
    'font-family:inherit;font-size:.92rem;font-weight:800;line-height:1;cursor:pointer;',
    'transition:background .2s ease,color .2s ease,transform .2s ease,box-shadow .2s ease}',
    '.isp-btn:hover{background:var(--isp-accent,var(--accent,#4f46e5));color:#fff;',
    'transform:translateY(-2px);box-shadow:0 10px 24px -10px var(--isp-accent,var(--accent,#4f46e5))}',
    '.isp-btn:focus-visible{outline:2px solid var(--isp-accent,var(--accent,#4f46e5));outline-offset:3px}',
    '.isp-btn[disabled]{opacity:.55;cursor:not-allowed;transform:none}',
    /* The page accents are mid-dark indigos and purples: legible on white, too
       dark on a dark ground, so dark mode uses a lightened tint of the same
       hue. The flat values are the fallback where color-mix is unsupported. */
    '[data-theme="dark"] .isp-btn{background:rgba(255,255,255,.06);border-color:#818cf8;color:#c7d2fe}',
    '[data-theme="dark"] .isp-btn:hover{background:#c7d2fe;color:#0b1020;box-shadow:none}',
    '@supports (color:color-mix(in srgb,red,white)){',
    '[data-theme="dark"] .isp-btn{--isp-tint:color-mix(in srgb,var(--isp-accent,var(--accent,#8b5cf6)) 45%,white);',
    'border-color:var(--isp-tint);color:var(--isp-tint)}',
    '[data-theme="dark"] .isp-btn:hover{background:var(--isp-tint);color:#0b1020}}',

    /* URL field + status, sitting directly under the button row. */
    '.isp-panel{width:min(440px,100%);margin:0 auto;text-align:left}',
    '.isp-panel[hidden]{display:none}',
    '.isp-url-row{display:flex;gap:.5rem;margin-top:.7rem}',
    /* An author `display` beats the UA sheet\'s [hidden]{display:none}, so the
       row needs its own guard. Without it, anything that reveals the panel —
       a camera capture posting a status line, say — also revealed the URL
       field, which looked like the URL box opening by itself. */
    '.isp-url-row[hidden]{display:none}',
    '.isp-url-input{flex:1;min-width:0;min-height:2.6rem;padding:.55rem .8rem;border-radius:10px;',
    'border:1px solid var(--border,rgba(20,33,61,.16));background:var(--surface-strong,#fff);',
    'color:var(--text,#14213d);font-family:inherit;font-size:.9rem}',
    '.isp-url-input::placeholder{color:var(--text-muted,#5b6780);opacity:.75}',
    '.isp-url-input:focus{outline:none;border-color:var(--isp-accent,var(--accent,#4f46e5));',
    'box-shadow:0 0 0 3px var(--accent-soft,rgba(79,70,229,.16))}',
    '.isp-url-go{flex:0 0 auto;padding:.55rem 1.1rem;border-radius:10px;border:0;',
    'background:var(--isp-accent,var(--accent,#4f46e5));color:#fff;',
    'font-family:inherit;font-size:.88rem;font-weight:800;cursor:pointer}',
    '.isp-url-go:hover{filter:brightness(1.08)}',
    '.isp-url-go[disabled],.isp-url-input[disabled]{opacity:.55;cursor:not-allowed}',
    '.isp-status{margin:.55rem 0 0;font-size:.82rem;line-height:1.45;color:var(--text-muted,#5b6780)}',
    '.isp-status[hidden]{display:none}',
    '.isp-status.is-error{color:#b91c1c}',
    '.isp-status.is-success{color:#0f766e}',
    '[data-theme="dark"] .isp-status.is-error{color:#fca5a5}',
    '[data-theme="dark"] .isp-status.is-success{color:#5eead4}',

    /* Camera overlay */
    '.isp-overlay{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;',
    'padding:1rem;background:rgba(15,23,42,.74);backdrop-filter:blur(4px)}',
    '.isp-dialog{width:min(560px,100%);padding:1rem;border-radius:18px;text-align:left;',
    'background:var(--surface-strong,#fff);border:1px solid var(--border,rgba(20,33,61,.14));',
    'box-shadow:0 24px 60px rgba(15,23,42,.38)}',
    '.isp-dialog h3{margin:0 0 .6rem;font-size:1rem;color:var(--text,#14213d)}',
    '.isp-video{display:block;width:100%;max-height:60vh;border-radius:12px;background:#0f172a;object-fit:cover}',
    '.isp-dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.6rem;margin-top:.85rem}',
    '.isp-shoot{background:var(--isp-accent,var(--accent,#4f46e5));color:#fff}',
    '.isp-dialog-note{margin:.6rem 0 0;font-size:.78rem;color:var(--text-muted,#5b6780)}'
    /* No mobile stacking rule on purpose: the row wraps, and forcing our
       buttons full-width would leave the page's own Browse button beside
       them at its natural width, which reads as broken. */
  ].join('');

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // A phone's own camera app produces a far better photo than a getUserMedia
  // preview, so mobile gets the `capture` input and desktop gets the webcam.
  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
  }

  function hasWebcamApi() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* Every drop zone on these pages is click-to-browse, and each also opens the
     file picker on Enter/Space. Our controls live inside that zone, so their
     events must not reach it — otherwise typing a space in the URL field would
     pop open the file dialog. */
  function isolate(el, opts) {
    var stopKeys = !opts || opts.keys !== false;
    el.addEventListener('click', function (e) { e.stopPropagation(); });
    if (stopKeys) {
      ['keydown', 'keyup', 'keypress'].forEach(function (type) {
        el.addEventListener(type, function (e) { e.stopPropagation(); });
      });
    }
  }

  function extForMime(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/bmp') return 'bmp';
    if (mime === 'image/avif') return 'avif';
    if (mime === 'image/svg+xml') return 'svg';
    return 'jpg';
  }

  function fileNameFromUrl(url, mime) {
    var name = '';
    try {
      name = (url.pathname || '').split('/').pop() || '';
    } catch (e) { /* data: URLs have no useful pathname */ }
    try { name = decodeURIComponent(name); } catch (e) { /* leave as-is */ }
    name = name.trim() || 'imported-image';
    if (!/\.(jpe?g|png|gif|webp|bmp|svg|avif|tiff?)$/i.test(name)) {
      name = name.replace(/\.$/, '') + '.' + extForMime(mime);
    }
    return name;
  }

  async function fetchImageAsFile(raw) {
    var text = String(raw || '').trim();
    if (!text) throw new Error('Paste an image link first.');
    // A bare "example.com/cat.jpg" is a reasonable thing to paste.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = 'https://' + text;

    var parsed;
    try { parsed = new URL(text); }
    catch (e) { throw new Error('That does not look like a link — include https:// at the start.'); }
    if (['http:', 'https:', 'data:', 'blob:'].indexOf(parsed.protocol) === -1) {
      throw new Error('Only http, https and data links can be imported.');
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, URL_TIMEOUT_MS);
    try {
      var res = await fetch(text, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
      if (!res.ok) {
        throw new Error('That link returned ' + res.status + '. Check that it still opens in a browser tab.');
      }
      var blob = await res.blob();
      if (blob.type.indexOf('image/') !== 0) {
        throw new Error('That link is not an image file. It has to point straight at the picture, not at the page showing it.');
      }
      return new File([blob], fileNameFromUrl(parsed, blob.type), { type: blob.type });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('That link took too long to answer. Save the image to your device and browse for it instead.');
      }
      // fetch() rejects with a bare TypeError for a network failure and for a
      // CORS refusal alike, and deliberately hides which — so name both.
      // Matched on `name`, not instanceof: the error can come from another
      // realm (an iframe, or a polyfilled fetch), where instanceof misses.
      if (err && err.name === 'TypeError') {
        throw new Error('Could not load that image. Most sites block other pages from reading their images (CORS), and that block cannot be worked around here. Save the picture to your device and browse for it instead.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function canvasToFile(canvas, name) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('Could not read the captured photo.')); return; }
        resolve(new File([blob], name, { type: 'image/png' }));
      }, 'image/png');
    });
  }

  /* ---------------------------------------------------------------------
     Handing the file over to the tool.

     Assigning input.files and firing `change` means every tool keeps its own
     validation, queueing and preview code path — nothing here has to know how
     a given tool loads an image.
     --------------------------------------------------------------------- */
  function deliver(ctx, file) {
    var dt = null;
    try {
      dt = new DataTransfer();
      dt.items.add(file);
    } catch (e) {
      dt = null;
    }

    if (dt && ctx.input) {
      try {
        ctx.input.files = dt.files;
        if (ctx.input.files && ctx.input.files.length === 1) {
          ctx.input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      } catch (e) { /* falls through to the drop-event path below */ }
    }

    // Fallback for browsers that refuse the assignment: every one of these
    // tools also accepts a real drop on its drop zone.
    if (dt && ctx.dropZone && typeof DragEvent === 'function') {
      try {
        ctx.dropZone.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dt, bubbles: true, cancelable: true
        }));
        return true;
      } catch (e) { /* reported by the caller */ }
    }

    return false;
  }

  /* ---------------------------------------------------------------------
     Desktop webcam capture
     --------------------------------------------------------------------- */
  async function openWebcam(ctx) {
    var stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
    } catch (err) {
      var name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        ctx.status('Camera permission was denied. Allow camera access for this site, or browse for a file instead.', 'error');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        ctx.status('No camera was found on this device — browse for a file instead.', 'error');
      } else if (window.isSecureContext === false) {
        ctx.status('The camera needs a secure (https) connection — browse for a file instead.', 'error');
      } else {
        ctx.status('Could not open the camera — browse for a file instead.', 'error');
      }
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'isp-overlay';
    overlay.innerHTML =
      '<div class="isp-dialog" role="dialog" aria-modal="true" aria-label="Camera capture">' +
        '<h3>Take a photo</h3>' +
        '<video class="isp-video" autoplay playsinline muted></video>' +
        '<div class="isp-dialog-actions">' +
          '<button type="button" class="isp-btn" data-isp-cancel>Cancel</button>' +
          '<button type="button" class="isp-btn isp-shoot" data-isp-shoot>📷 Capture photo</button>' +
        '</div>' +
        '<p class="isp-dialog-note">The photo is captured in this browser and never uploaded.</p>' +
      '</div>';

    var video = overlay.querySelector('video');
    var closed = false;

    function cleanup() {
      if (closed) return;
      closed = true;
      stream.getTracks().forEach(function (t) { t.stop(); });
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (ctx.cameraBtn) ctx.cameraBtn.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
    }

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* the autoplay attribute covers this */ }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) cleanup(); });
    overlay.querySelector('[data-isp-cancel]').addEventListener('click', cleanup);
    overlay.querySelector('[data-isp-shoot]').addEventListener('click', async function () {
      var w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { ctx.status('The camera is still warming up — try again in a second.', 'error'); return; }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      cleanup();
      try {
        var file = await canvasToFile(canvas, 'camera-photo-' + Date.now() + '.png');
        if (deliver(ctx, file)) ctx.status('Photo captured — ' + w + '×' + h + ' px.', 'success');
        else ctx.status('Could not hand the photo to the tool — browse for a file instead.', 'error');
      } catch (err) {
        ctx.status((err && err.message) || 'Capture failed.', 'error');
      }
    });

    overlay.querySelector('[data-isp-shoot]').focus();
  }

  /* ---------------------------------------------------------------------
     Wiring one marker element
     --------------------------------------------------------------------- */
  function setup(host) {
    if (host.dataset.ispReady === '1') return;

    var dropZone = host.closest('[data-drop-zone]');
    var scope = dropZone || host.closest('[data-tool-page], section, main') || document;
    var inputSel = host.getAttribute('data-isp-input') || '[data-file-input]';
    var input = scope.querySelector(inputSel)
      || (scope.parentElement && scope.parentElement.querySelector(inputSel))
      || document.querySelector(inputSel);
    if (!input) return;
    if (!dropZone) dropZone = document.querySelector('[data-drop-zone]');

    host.dataset.ispReady = '1';
    injectStyles();

    var noun = host.getAttribute('data-isp-noun') || 'image';
    var cameraLabel = host.getAttribute('data-isp-camera-label') || 'Use camera';
    var urlLabel = host.getAttribute('data-isp-url-label') || 'From URL';
    var urlRowId = 'isp-url-' + Math.random().toString(36).slice(2, 9);
    var urlLabelText = noun.charAt(0).toUpperCase() + noun.slice(1) + ' URL';

    // Buttons go in the marker, which is display:contents, so they sit in the
    // page's own button row alongside Browse.
    host.insertAdjacentHTML('beforeend',
      '<button type="button" class="isp-btn" data-isp-camera>📷 ' + cameraLabel + '</button>' +
      '<button type="button" class="isp-btn" data-isp-url-toggle aria-expanded="false" aria-controls="' + urlRowId + '">🔗 ' + urlLabel + '</button>');

    // The field and status line need a block of their own, directly below the
    // button row rather than squeezed into it.
    var panel = document.createElement('div');
    panel.className = 'isp-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="isp-url-row" id="' + urlRowId + '" hidden>' +
        '<input type="url" class="isp-url-input" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="https://example.com/photo.jpg" aria-label="' + urlLabelText + '" data-isp-url-input />' +
        '<button type="button" class="isp-url-go" data-isp-url-go>Import</button>' +
      '</div>' +
      '<p class="isp-status" role="status" aria-live="polite" data-isp-status hidden></p>' +
      // `capture` cannot go on the tool's own input without costing it the
      // ordinary file dialog, so the camera gets an input of its own.
      '<input type="file" accept="image/*" capture="environment" hidden data-isp-camera-input />';

    // Anchor it after the whole button row when there is one, so it clears the
    // buttons instead of landing between them.
    var anchor = (host.parentElement && host.parentElement !== dropZone) ? host.parentElement : host;
    anchor.insertAdjacentElement('afterend', panel);

    var cameraBtn = host.querySelector('[data-isp-camera]');
    var urlToggle = host.querySelector('[data-isp-url-toggle]');
    var cameraInput = panel.querySelector('[data-isp-camera-input]');
    var urlRow = panel.querySelector('.isp-url-row');
    var urlInput = panel.querySelector('[data-isp-url-input]');
    var urlGo = panel.querySelector('[data-isp-url-go]');
    var statusEl = panel.querySelector('[data-isp-status]');

    [cameraBtn, urlToggle, urlGo, urlInput, panel].forEach(function (el) { isolate(el); });

    function syncPanel() {
      panel.hidden = urlRow.hidden && statusEl.hidden;
    }

    var ctx = {
      input: input,
      dropZone: dropZone,
      cameraBtn: cameraBtn,
      status: function (text, kind) {
        statusEl.textContent = text || '';
        statusEl.classList.toggle('is-error', kind === 'error');
        statusEl.classList.toggle('is-success', kind === 'success');
        statusEl.hidden = !text;
        syncPanel();
      }
    };

    function setBusy(on) {
      [cameraBtn, urlToggle, urlGo, urlInput].forEach(function (el) { el.disabled = on; });
    }

    // --- camera ---
    cameraBtn.addEventListener('click', function (e) {
      e.preventDefault();
      ctx.status('', '');
      if (isMobileDevice() || !hasWebcamApi()) { cameraInput.click(); return; }
      openWebcam(ctx);
    });

    cameraInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (deliver(ctx, file)) ctx.status('Photo added from your camera.', 'success');
      else ctx.status('Could not hand the photo to the tool — browse for a file instead.', 'error');
    });

    // --- URL ---
    urlToggle.addEventListener('click', function (e) {
      e.preventDefault();
      urlRow.hidden = !urlRow.hidden;
      urlToggle.setAttribute('aria-expanded', String(!urlRow.hidden));
      syncPanel();
      if (!urlRow.hidden) urlInput.focus();
    });

    async function importUrl() {
      var raw = urlInput.value;
      if (!raw.trim()) {
        ctx.status('Paste a direct link to an ' + noun + ' first.', 'error');
        urlInput.focus();
        return;
      }
      setBusy(true);
      ctx.status('Fetching the ' + noun + '…', '');
      try {
        var file = await fetchImageAsFile(raw);
        if (deliver(ctx, file)) {
          urlInput.value = '';
          ctx.status('Loaded ' + file.name + ' from the link.', 'success');
        } else {
          ctx.status('Could not hand that image to the tool — save it and browse for it instead.', 'error');
        }
      } catch (err) {
        ctx.status((err && err.message) || 'Could not load that image.', 'error');
      } finally {
        setBusy(false);
      }
    }

    urlGo.addEventListener('click', function (e) { e.preventDefault(); importUrl(); });
    // The field is not inside a form, so Enter has to be wired by hand.
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); importUrl(); }
    });
  }

  function initAll(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-image-sources]'), setup);
  }

  window.ImageSourcePicker = { init: initAll, setup: setup };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(); });
  } else {
    initAll();
  }
})();
