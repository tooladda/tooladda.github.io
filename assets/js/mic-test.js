/* ToolAdda — Mic Test, UI layer.

   The decidable parts — error messages, level maths, device naming — live in
   media-test-engine.js and are tested under Node. This file owns the audio
   graph and the drawing.

   Two things make or break a mic test. The meter has to be honest: it reads the
   live analyser, is linear in dB, and is floored so silence reads empty rather
   than half-full. And "it works" is not enough — most people arrive because
   they sound wrong on calls, not because they hear nothing, so the tool records
   a few seconds and plays it back. Hearing yourself is the only test that
   answers the question actually being asked.

   The audio never leaves the machine. The recording lives in a blob URL in this
   tab and is dropped when you record again or leave the page. */
(function () {
  'use strict';

  var root = document.querySelector('[data-mic]');
  if (!root) return;

  var E = window.MediaTestEngine;
  if (!E) return;

  var $ = function (sel) { return root.querySelector(sel); };

  var el = {
    startBtn: $('[data-start]'),
    stopBtn: $('[data-stop]'),
    recordBtn: $('[data-record]'),
    downloadBtn: $('[data-download]'),
    deviceSelect: $('[data-device]'),
    meterFill: $('[data-meter-fill]'),
    meterPeak: $('[data-meter-peak]'),
    meterDb: $('[data-meter-db]'),
    verdict: $('[data-verdict]'),
    wave: $('[data-wave]'),
    placeholder: $('[data-placeholder]'),
    error: $('[data-error]'),
    errorTitle: $('[data-error-title]'),
    errorDetail: $('[data-error-detail]'),
    status: $('[data-status]'),
    facts: $('[data-facts]'),
    factRate: $('[data-fact-rate]'),
    factChannels: $('[data-fact-channels]'),
    factEcho: $('[data-fact-echo]'),
    factNoise: $('[data-fact-noise]'),
    factGain: $('[data-fact-gain]'),
    factDevice: $('[data-fact-device]'),
    playbackWrap: $('[data-playback-wrap]'),
    playbackLabel: $('[data-playback-label]'),
    playback: $('[data-playback]')
  };

  var RECORD_SECONDS = 6;

  var stream = null;
  var audioCtx = null;
  var analyser = null;
  var source = null;
  var buffer = null;
  var frame = null;
  var recorder = null;
  var recordTimer = null;
  var chunks = [];
  var clipUrl = null;
  var recordStartedAt = 0;
  var peakHold = -60;
  var peakHoldAt = 0;

  function setStatus(text) { if (el.status) el.status.textContent = text; }

  function showError(error) {
    var described = E.describeError(error);
    if (el.errorTitle) el.errorTitle.textContent = described.title;
    if (el.errorDetail) el.errorDetail.textContent = described.detail;
    if (el.error) el.error.hidden = false;
  }

  function setRunning(running) {
    if (el.startBtn) el.startBtn.hidden = running;
    if (el.stopBtn) el.stopBtn.hidden = !running;
    if (el.recordBtn) el.recordBtn.disabled = !running;
    if (el.placeholder) el.placeholder.hidden = running;
    if (el.wave) el.wave.hidden = !running;
    if (el.facts) el.facts.hidden = !running;
    root.classList.toggle('is-live', running);
  }

  function refreshDevices() {
    if (!el.deviceSelect || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var mics = E.listDevices(devices, 'audioinput');
      var current = el.deviceSelect.value;
      el.deviceSelect.innerHTML = '';
      mics.forEach(function (mic) {
        var option = document.createElement('option');
        option.value = mic.deviceId;
        option.textContent = mic.label;
        el.deviceSelect.appendChild(option);
      });
      if (current) el.deviceSelect.value = current;
      el.deviceSelect.disabled = mics.length < 2;
      return mics;
    }, function () { /* enumeration fails before permission; not fatal */ });
  }

  function showFacts(track) {
    var settings = track.getSettings ? track.getSettings() : {};
    var info = E.describeAudio(settings);
    var set = function (node, value) { if (node) node.textContent = value; };
    /* "Off" and "the browser did not say" are different answers and these three
       change how the mic sounds, so they must not collapse into one word. */
    var flag = function (value) { return value === null ? 'Not reported' : value ? 'On' : 'Off'; };

    set(el.factRate, info.sampleRate ? (info.sampleRate / 1000) + ' kHz' : '—');
    set(el.factChannels, info.channels ? (info.channels === 1 ? 'Mono' : info.channels === 2 ? 'Stereo' : info.channels + ' channels') : '—');
    set(el.factEcho, flag(info.echoCancellation));
    set(el.factNoise, flag(info.noiseSuppression));
    set(el.factGain, flag(info.autoGainControl));
    set(el.factDevice, track.label || 'Microphone');
  }

  function drawWave(data) {
    var canvas = el.wave;
    if (!canvas || !canvas.getContext) return;
    var ratio = window.devicePixelRatio || 1;
    var cssWidth = canvas.clientWidth || 600;
    var cssHeight = canvas.clientHeight || 120;
    if (canvas.width !== Math.round(cssWidth * ratio)) {
      canvas.width = Math.round(cssWidth * ratio);
      canvas.height = Math.round(cssHeight * ratio);
    }
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var styles = window.getComputedStyle(root);
    var line = styles.getPropertyValue('--wave-line').trim() || '#b45309';
    var grid = styles.getPropertyValue('--wave-grid').trim() || 'rgba(120,113,108,.25)';

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = grid;
    ctx.lineWidth = ratio;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.strokeStyle = line;
    ctx.lineWidth = 2 * ratio;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var step = w / data.length;
    for (var i = 0; i < data.length; i += 1) {
      var v = (data[i] - 128) / 128;
      var y = (h / 2) - (v * (h / 2) * 0.9);
      if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(i * step, y);
    }
    ctx.stroke();
  }

  function tick() {
    if (!analyser || !buffer) return;
    analyser.getByteTimeDomainData(buffer);

    var peak = E.peakFromTimeDomain(buffer);
    var rms = E.rmsFromTimeDomain(buffer);
    var peakDb = E.toDecibels(peak);
    var rmsDb = E.toDecibels(rms);

    if (el.meterFill) el.meterFill.style.width = E.meterPercent(rmsDb) + '%';

    /* A bare instantaneous peak flickers too fast to read, so it is held for a
       moment and then allowed to fall back. */
    var now = Date.now();
    if (peakDb >= peakHold || now - peakHoldAt > 900) {
      peakHold = peakDb;
      peakHoldAt = now;
    }
    if (el.meterPeak) el.meterPeak.style.left = E.meterPercent(peakHold) + '%';
    if (el.meterDb) el.meterDb.textContent = Math.round(peakDb) + ' dB';

    var verdict = E.levelVerdict(peakDb);
    if (el.verdict) {
      el.verdict.textContent = verdict.text;
      el.verdict.setAttribute('data-state', verdict.state);
    }

    drawWave(buffer);
    frame = window.requestAnimationFrame(tick);
  }

  function releaseClip() {
    if (clipUrl) {
      URL.revokeObjectURL(clipUrl);
      clipUrl = null;
    }
    if (el.playbackWrap) el.playbackWrap.hidden = true;
    if (el.downloadBtn) el.downloadBtn.hidden = true;
  }

  function stop() {
    if (frame) { window.cancelAnimationFrame(frame); frame = null; }
    if (recordTimer) { window.clearInterval(recordTimer); recordTimer = null; }
    if (recorder && recorder.state === 'recording') recorder.stop();
    recorder = null;
    if (source && source.disconnect) source.disconnect();
    source = null;
    analyser = null;
    if (audioCtx && audioCtx.close) audioCtx.close();
    audioCtx = null;
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    if (el.meterFill) el.meterFill.style.width = '0%';
    if (el.meterPeak) el.meterPeak.style.left = '0%';
    if (el.meterDb) el.meterDb.textContent = '— dB';
    peakHold = -60;
    setRunning(false);
    setStatus('Microphone stopped. Nothing was uploaded.');
  }

  function start() {
    var support = E.supportState(navigator, window.isSecureContext);
    if (!support.supported) {
      if (el.errorTitle) el.errorTitle.textContent = support.reason === 'insecure'
        ? 'Needs a secure connection' : 'Not supported in this browser';
      if (el.errorDetail) el.errorDetail.textContent = support.message;
      if (el.error) el.error.hidden = false;
      return;
    }

    if (el.error) el.error.hidden = true;
    stop();
    setStatus('Asking for permission…');

    var audio = {};
    var chosen = el.deviceSelect && el.deviceSelect.value;
    if (chosen) audio.deviceId = { exact: chosen };

    navigator.mediaDevices.getUserMedia({ audio: audio, video: false }).then(function (media) {
      stream = media;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        setStatus('This browser cannot analyse audio, but the microphone opened.');
        setRunning(true);
        return;
      }
      audioCtx = new Ctx();
      /* Some browsers hand back a suspended context until a gesture; the click
         that got us here counts, but resume() has to be asked for. */
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      buffer = new Uint8Array(analyser.fftSize);
      source = audioCtx.createMediaStreamSource(media);
      source.connect(analyser);
      /* Deliberately not connected to the destination — routing a live mic to
         the speakers is instant feedback howl. Playback is the recording. */

      setRunning(true);
      var track = media.getAudioTracks()[0];
      if (track) showFacts(track);
      setStatus('Listening. Speak normally and watch the meter.');
      refreshDevices();
      tick();
    }, function (error) {
      setRunning(false);
      setStatus('Microphone did not start.');
      showError(error);
    });
  }

  function record() {
    if (!stream || !window.MediaRecorder) {
      setStatus('Recording is not supported in this browser, but the meter still works.');
      return;
    }
    if (recorder && recorder.state === 'recording') return;

    releaseClip();
    chunks = [];
    try {
      recorder = new MediaRecorder(stream);
    } catch (err) {
      setStatus('Recording is not supported in this browser, but the meter still works.');
      return;
    }

    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onstop = function () {
      if (recordTimer) { window.clearInterval(recordTimer); recordTimer = null; }
      if (el.recordBtn) {
        el.recordBtn.disabled = false;
        el.recordBtn.textContent = 'Record ' + RECORD_SECONDS + ' seconds';
      }
      if (!chunks.length) return;
      var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      clipUrl = URL.createObjectURL(blob);
      if (el.playback) el.playback.src = clipUrl;
      if (el.playbackWrap) el.playbackWrap.hidden = false;
      /* The length is worth stating: a clip that came out at 0:01 because
         the tab lost focus explains a lot about a disappointing playback. */
      if (el.playbackLabel) {
        el.playbackLabel.textContent = 'Your recording (' +
          E.formatDuration((Date.now() - recordStartedAt) / 1000) +
          ') — this is what other people hear';
      }
      if (el.downloadBtn) {
        el.downloadBtn.hidden = false;
        el.downloadBtn.href = clipUrl;
        el.downloadBtn.download = 'mic-test-recording.webm';
      }
      setStatus('Recorded. Press play — if this sounds right, your microphone is fine.');
    };

    recorder.start();
    recordStartedAt = Date.now();
    var left = RECORD_SECONDS;
    if (el.recordBtn) {
      el.recordBtn.disabled = true;
      el.recordBtn.textContent = 'Recording… ' + left + 's';
    }
    setStatus('Recording — say a sentence out loud.');
    recordTimer = window.setInterval(function () {
      left -= 1;
      if (el.recordBtn) el.recordBtn.textContent = 'Recording… ' + Math.max(0, left) + 's';
      if (left <= 0 && recorder && recorder.state === 'recording') recorder.stop();
    }, 1000);
  }

  if (el.startBtn) el.startBtn.addEventListener('click', start);
  if (el.stopBtn) el.stopBtn.addEventListener('click', stop);
  if (el.recordBtn) el.recordBtn.addEventListener('click', record);
  if (el.deviceSelect) el.deviceSelect.addEventListener('change', function () { if (stream) start(); });

  window.addEventListener('pagehide', function () { releaseClip(); stop(); });
  window.addEventListener('beforeunload', function () { releaseClip(); stop(); });

  setRunning(false);
  refreshDevices();

  var support = E.supportState(navigator, window.isSecureContext);
  if (!support.supported) {
    if (el.startBtn) el.startBtn.disabled = true;
    setStatus(support.message);
  } else {
    setStatus('Press Start microphone. Your browser will ask for permission first.');
  }
})();
