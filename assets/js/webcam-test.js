/* ToolAdda — Webcam Test, UI layer.

   Everything decidable without hardware lives in media-test-engine.js. This
   file does the parts that need a real camera: asking for it, showing it, and
   reading back what the browser actually gave us.

   That last part is the point of the tool. A camera request is a negotiation —
   you ask for 1080p and the browser hands back whatever the hardware could
   manage, often quietly. Reading the settings off the live track and showing
   them is the difference between "the camera works" and "the camera works, at
   640x480, because that is all this laptop has."

   The stream never leaves the machine: no upload, no recording unless you press
   the snapshot button, and that snapshot is drawn to a canvas in the page and
   saved straight to your downloads. */
(function () {
  'use strict';

  var root = document.querySelector('[data-webcam]');
  if (!root) return;

  var E = window.MediaTestEngine;
  if (!E) return;

  var $ = function (sel) { return root.querySelector(sel); };

  var el = {
    startBtn: $('[data-start]'),
    stopBtn: $('[data-stop]'),
    snapBtn: $('[data-snapshot]'),
    mirrorToggle: $('[data-mirror]'),
    deviceSelect: $('[data-device]'),
    qualitySelect: $('[data-quality]'),
    video: $('[data-video]'),
    stage: $('[data-stage]'),
    placeholder: $('[data-placeholder]'),
    error: $('[data-error]'),
    errorTitle: $('[data-error-title]'),
    errorDetail: $('[data-error-detail]'),
    status: $('[data-status]'),
    facts: $('[data-facts]'),
    factRes: $('[data-fact-resolution]'),
    factName: $('[data-fact-name]'),
    factRatio: $('[data-fact-ratio]'),
    factFps: $('[data-fact-fps]'),
    factFacing: $('[data-fact-facing]'),
    factMp: $('[data-fact-mp]'),
    factDevice: $('[data-fact-device]')
  };

  var QUALITY = {
    auto: {},
    '480': { width: { ideal: 640 }, height: { ideal: 480 } },
    '720': { width: { ideal: 1280 }, height: { ideal: 720 } },
    '1080': { width: { ideal: 1920 }, height: { ideal: 1080 } },
    max: { width: { ideal: 4096 }, height: { ideal: 2160 } }
  };

  var stream = null;

  function setStatus(text) {
    if (el.status) el.status.textContent = text;
  }

  function showError(error) {
    var described = E.describeError(error);
    if (el.errorTitle) el.errorTitle.textContent = described.title;
    if (el.errorDetail) el.errorDetail.textContent = described.detail;
    if (el.error) el.error.hidden = false;
  }

  function clearError() {
    if (el.error) el.error.hidden = true;
  }

  function setRunning(running) {
    if (el.startBtn) el.startBtn.hidden = running;
    if (el.stopBtn) el.stopBtn.hidden = !running;
    if (el.snapBtn) el.snapBtn.disabled = !running;
    if (el.placeholder) el.placeholder.hidden = running;
    if (el.video) el.video.hidden = !running;
    if (el.facts) el.facts.hidden = !running;
  }

  /* Device labels are empty until permission has been granted once — that is
     the spec, not a bug — so the picker is refilled after the stream starts. */
  function refreshDevices() {
    if (!el.deviceSelect || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var cams = E.listDevices(devices, 'videoinput');
      var current = el.deviceSelect.value;
      el.deviceSelect.innerHTML = '';
      cams.forEach(function (cam) {
        var option = document.createElement('option');
        option.value = cam.deviceId;
        option.textContent = cam.label;
        el.deviceSelect.appendChild(option);
      });
      if (current) el.deviceSelect.value = current;
      el.deviceSelect.disabled = cams.length < 2;
      return cams;
    }, function () { /* enumeration can fail before permission; not fatal */ });
  }

  function showFacts(track) {
    var settings = track.getSettings ? track.getSettings() : {};
    var info = E.describeVideo(settings);
    var set = function (node, value) { if (node) node.textContent = value || '—'; };

    set(el.factRes, info.resolution);
    set(el.factName, info.name || 'Non-standard size');
    set(el.factRatio, info.aspectRatio);
    set(el.factFps, info.frameRate ? info.frameRate + ' fps' : null);
    set(el.factFacing, info.facing === 'user' ? 'Front' : info.facing === 'environment' ? 'Rear' : 'Not reported');
    set(el.factMp, info.megapixels ? info.megapixels + ' MP' : null);
    set(el.factDevice, track.label || 'Camera');

    /* What was asked for and what arrived are often different, and the
       difference is the useful part. */
    var asked = el.qualitySelect ? el.qualitySelect.value : 'auto';
    if (asked !== 'auto' && asked !== 'max' && info.height && info.height < Number(asked)) {
      setStatus('Running at ' + info.resolution + ' — this camera could not provide ' + asked + 'p.');
    } else {
      setStatus('Camera is working — ' + (info.resolution || 'live') + '.');
    }
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    if (el.video) el.video.srcObject = null;
    setRunning(false);
    setStatus('Camera stopped. Nothing was recorded or uploaded.');
  }

  function start() {
    var support = E.supportState(navigator, window.isSecureContext);
    if (!support.supported) {
      showError(null);
      if (el.errorTitle) el.errorTitle.textContent = support.reason === 'insecure'
        ? 'Needs a secure connection' : 'Not supported in this browser';
      if (el.errorDetail) el.errorDetail.textContent = support.message;
      if (el.error) el.error.hidden = false;
      return;
    }

    clearError();
    stop();
    setStatus('Asking for permission…');

    var quality = QUALITY[el.qualitySelect ? el.qualitySelect.value : 'auto'] || {};
    var video = { width: quality.width, height: quality.height };
    var chosen = el.deviceSelect && el.deviceSelect.value;
    if (chosen) video.deviceId = { exact: chosen };

    navigator.mediaDevices.getUserMedia({ video: video, audio: false }).then(function (media) {
      stream = media;
      if (el.video) {
        el.video.srcObject = media;
        var playing = el.video.play();
        if (playing && playing.catch) playing.catch(function () { /* autoplay policy */ });
      }
      setRunning(true);
      var track = media.getVideoTracks()[0];
      if (track) showFacts(track);
      refreshDevices();
    }, function (error) {
      setRunning(false);
      setStatus('Camera did not start.');
      showError(error);
    });
  }

  function snapshot() {
    if (!stream || !el.video) return;
    var width = el.video.videoWidth;
    var height = el.video.videoHeight;
    if (!width || !height) return;

    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    /* A mirrored preview is easier to use but a mirrored photo reads as a
       mistake, so the flip is undone unless the mirror is deliberately on. */
    if (el.mirrorToggle && el.mirrorToggle.checked) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(el.video, 0, 0, width, height);

    canvas.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = E.snapshotName('webcam');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setStatus('Snapshot saved to your downloads.');
    }, 'image/png');
  }

  if (el.startBtn) el.startBtn.addEventListener('click', start);
  if (el.stopBtn) el.stopBtn.addEventListener('click', stop);
  if (el.snapBtn) el.snapBtn.addEventListener('click', snapshot);
  if (el.deviceSelect) el.deviceSelect.addEventListener('change', function () { if (stream) start(); });
  if (el.qualitySelect) el.qualitySelect.addEventListener('change', function () { if (stream) start(); });
  if (el.mirrorToggle) {
    el.mirrorToggle.addEventListener('change', function () {
      if (el.stage) el.stage.classList.toggle('is-mirrored', el.mirrorToggle.checked);
    });
  }

  /* Leaving the page with the camera light on is alarming and avoidable. */
  window.addEventListener('pagehide', stop);
  window.addEventListener('beforeunload', stop);

  setRunning(false);
  refreshDevices();

  var support = E.supportState(navigator, window.isSecureContext);
  if (!support.supported) {
    if (el.startBtn) el.startBtn.disabled = true;
    setStatus(support.message);
  } else {
    setStatus('Press Start camera. Your browser will ask for permission first.');
  }
})();
