/* ToolAdda — shared engine for the Webcam Test and Mic Test.

   Pure logic only: no DOM, no getUserMedia, no audio graph. Everything here is
   testable under plain Node, and both tools import the same copy so a fix to a
   permission message or a level calculation lands on both.

   The part worth doing carefully is the error mapping. getUserMedia has a
   handful of failure modes that all arrive as an exception and mean completely
   different things to the person sitting there — permission refused, no device
   attached, another application holding the device, an insecure origin. A tool
   that prints "could not access camera" for all four is the reason people
   conclude their webcam is broken when Zoom simply has it open. */
(function (global) {
  'use strict';

  /* getUserMedia rejects with a DOMException whose name is the only reliable
     signal; the message differs per browser and is not worth parsing. */
  var ERRORS = {
    NotAllowedError: {
      title: 'Permission was refused',
      detail: 'Your browser blocked access. Click the camera or microphone icon in the address bar, allow access for this site, then try again.',
      recoverable: true
    },
    PermissionDeniedError: {
      title: 'Permission was refused',
      detail: 'Your browser blocked access. Click the camera or microphone icon in the address bar, allow access for this site, then try again.',
      recoverable: true
    },
    NotFoundError: {
      title: 'No device found',
      detail: 'Nothing is connected, or the device is disabled in your system settings. Check the connection and reload.',
      recoverable: true
    },
    DevicesNotFoundError: {
      title: 'No device found',
      detail: 'Nothing is connected, or the device is disabled in your system settings. Check the connection and reload.',
      recoverable: true
    },
    NotReadableError: {
      title: 'The device is busy',
      detail: 'Another application is using it — video calls, recorders and streaming apps often hold on to it. Close the other app and try again.',
      recoverable: true
    },
    TrackStartError: {
      title: 'The device is busy',
      detail: 'Another application is using it. Close the other app and try again.',
      recoverable: true
    },
    OverconstrainedError: {
      title: 'That setting is not supported',
      detail: 'The device cannot provide the resolution or quality requested. Pick a lower setting.',
      recoverable: true
    },
    SecurityError: {
      title: 'Blocked by the browser',
      detail: 'Camera and microphone access needs a secure connection (https). This page is served over https, so this usually means a policy set by your browser or workplace.',
      recoverable: false
    },
    AbortError: {
      title: 'The device stopped responding',
      detail: 'The hardware reported a problem. Reconnect it and reload the page.',
      recoverable: true
    }
  };

  var UNKNOWN_ERROR = {
    title: 'Could not start the device',
    detail: 'Your browser refused the request and did not say why. Reload the page and try again.',
    recoverable: true
  };

  function describeError(error) {
    if (!error) return UNKNOWN_ERROR;
    var mapped = ERRORS[error.name];
    if (!mapped) return UNKNOWN_ERROR;
    return mapped;
  }

  /** Is the API even available here?
   *
   *  Browsers hide mediaDevices entirely on insecure origins rather than
   *  throwing later, so "undefined" means http, not an old browser — and
   *  telling someone to upgrade Chrome when the real problem is the URL wastes
   *  their afternoon. */
  function supportState(nav, isSecureContext) {
    if (isSecureContext === false) {
      return {
        supported: false,
        reason: 'insecure',
        message: 'Camera and microphone access only works over https. Open this page at its https address.'
      };
    }
    if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) {
      return {
        supported: false,
        reason: 'unsupported',
        message: 'This browser does not support camera and microphone access. Chrome, Edge, Firefox and Safari all do.'
      };
    }
    return { supported: true, reason: null, message: null };
  }

  /** Before permission is granted, enumerateDevices returns entries with empty
   *  labels — that is the spec, not a bug, and it is why a device picker looks
   *  empty until the first allow. */
  function labelFor(device, index, kind) {
    if (device && device.label) return device.label;
    var noun = kind === 'audioinput' ? 'Microphone' : kind === 'audiooutput' ? 'Speaker' : 'Camera';
    return noun + ' ' + (index + 1);
  }

  function listDevices(devices, kind) {
    var filtered = (devices || []).filter(function (d) { return d && d.kind === kind; });
    return filtered.map(function (device, index) {
      return {
        deviceId: device.deviceId || '',
        kind: device.kind,
        label: labelFor(device, index, kind),
        named: !!(device && device.label)
      };
    });
  }

  /** True when the browser is still withholding labels, i.e. no permission has
   *  been granted yet in this origin. */
  function labelsHidden(devices) {
    var list = devices || [];
    if (!list.length) return false;
    return list.every(function (d) { return !d.label; });
  }

  // ------------------------------------------------------------- video ----

  function gcd(a, b) {
    var x = Math.abs(Math.round(a));
    var y = Math.abs(Math.round(b));
    while (y) {
      var t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  /** "1280 x 720" -> "16:9". Falls back to the decimal ratio when the reduced
   *  form is not a recognisable one, because "683:384" helps nobody. */
  function aspectRatio(width, height) {
    var w = Math.round(Number(width) || 0);
    var h = Math.round(Number(height) || 0);
    if (w <= 0 || h <= 0) return null;
    var d = gcd(w, h);
    var rw = w / d;
    var rh = h / d;
    if (rw <= 40 && rh <= 40) return rw + ':' + rh;
    return (w / h).toFixed(2) + ':1';
  }

  /** The name people recognise, where one exists. */
  function resolutionName(width, height) {
    var w = Math.round(Number(width) || 0);
    var h = Math.round(Number(height) || 0);
    var known = [
      [3840, 2160, '4K UHD'], [2560, 1440, '1440p QHD'], [1920, 1080, '1080p Full HD'],
      [1280, 720, '720p HD'], [960, 540, '540p'], [854, 480, '480p'], [640, 480, 'VGA'],
      [640, 360, '360p'], [320, 240, 'QVGA']
    ];
    for (var i = 0; i < known.length; i += 1) {
      if (known[i][0] === w && known[i][1] === h) return known[i][2];
    }
    return null;
  }

  function describeVideo(settings) {
    var s = settings || {};
    var width = s.width || 0;
    var height = s.height || 0;
    return {
      width: width,
      height: height,
      resolution: width && height ? width + ' × ' + height : null,
      name: resolutionName(width, height),
      aspectRatio: aspectRatio(width, height),
      frameRate: s.frameRate ? Math.round(s.frameRate) : null,
      facing: s.facingMode || null,
      megapixels: width && height ? Math.round((width * height) / 10000) / 100 : null
    };
  }

  // ------------------------------------------------------------- audio ----

  /** RMS of a byte-domain time buffer, normalised to 0..1.
   *
   *  AnalyserNode hands back samples centred on 128, so each one is offset
   *  before squaring — skipping that measures the DC offset rather than the
   *  signal, and the meter then reads about 0.5 in a silent room. */
  function rmsFromTimeDomain(bytes) {
    var data = bytes || [];
    if (!data.length) return 0;
    var sum = 0;
    for (var i = 0; i < data.length; i += 1) {
      var v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  function peakFromTimeDomain(bytes) {
    var data = bytes || [];
    var peak = 0;
    for (var i = 0; i < data.length; i += 1) {
      var v = Math.abs((data[i] - 128) / 128);
      if (v > peak) peak = v;
    }
    return peak;
  }

  /** Amplitude 0..1 to dBFS, floored so a silent room does not read -Infinity. */
  function toDecibels(amplitude, floorDb) {
    var floor = floorDb === undefined ? -60 : floorDb;
    var a = Number(amplitude);
    if (!isFinite(a) || a <= 0) return floor;
    var db = 20 * Math.log10(a);
    return db < floor ? floor : (db > 0 ? 0 : db);
  }

  /** Meter position 0..100 from a dB value, so the bar is linear in dB rather
   *  than in amplitude — an amplitude bar spends most of its travel in the top
   *  few dB and looks broken at speaking volume. */
  function meterPercent(db, floorDb) {
    var floor = floorDb === undefined ? -60 : floorDb;
    var value = Number(db);
    if (!isFinite(value)) return 0;
    if (value <= floor) return 0;
    if (value >= 0) return 100;
    return Math.round(((value - floor) / (0 - floor)) * 100);
  }

  /** A verdict the UI can colour by, phrased as advice rather than a number. */
  function levelVerdict(peakDb) {
    var db = Number(peakDb);
    if (!isFinite(db) || db <= -55) {
      return { state: 'silent', text: 'No sound detected — say something, or check the microphone is not muted.' };
    }
    if (db < -35) {
      return { state: 'low', text: 'Very quiet. Move closer, or raise the input level in your system settings.' };
    }
    if (db < -6) {
      return { state: 'good', text: 'Good level — this is where you want to be.' };
    }
    if (db < -1) {
      return { state: 'loud', text: 'Loud. Back off a little to leave some headroom.' };
    }
    return { state: 'clipping', text: 'Clipping — the signal is hitting the ceiling and will distort. Lower the input level.' };
  }

  function describeAudio(settings) {
    var s = settings || {};
    return {
      sampleRate: s.sampleRate || null,
      channels: s.channelCount || null,
      echoCancellation: s.echoCancellation === undefined ? null : !!s.echoCancellation,
      noiseSuppression: s.noiseSuppression === undefined ? null : !!s.noiseSuppression,
      autoGainControl: s.autoGainControl === undefined ? null : !!s.autoGainControl
    };
  }

  // -------------------------------------------------------------- misc ----

  function formatDuration(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var mins = Math.floor(total / 60);
    var secs = total % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function snapshotName(prefix) {
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return (prefix || 'snapshot') + '-' +
      now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '.png';
  }

  var api = {
    ERRORS: ERRORS,
    UNKNOWN_ERROR: UNKNOWN_ERROR,
    describeError: describeError,
    supportState: supportState,
    labelFor: labelFor,
    listDevices: listDevices,
    labelsHidden: labelsHidden,
    aspectRatio: aspectRatio,
    resolutionName: resolutionName,
    describeVideo: describeVideo,
    rmsFromTimeDomain: rmsFromTimeDomain,
    peakFromTimeDomain: peakFromTimeDomain,
    toDecibels: toDecibels,
    meterPercent: meterPercent,
    levelVerdict: levelVerdict,
    describeAudio: describeAudio,
    formatDuration: formatDuration,
    snapshotName: snapshotName
  };

  global.MediaTestEngine = api;

  /* ------------------------------------------------------------------ *
   * Node/test export — everything above this line is pure and DOM-free.
   * ------------------------------------------------------------------ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : this);
