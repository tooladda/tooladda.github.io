// Service worker for the Text to Handwriting Converter ONLY.
// Caches the page shell, the export engines, and any handwriting font the
// user has actually selected — so the tool genuinely works offline after the
// first visit. It never sees the user's text: that is read from a form field
// and drawn to a canvas without ever touching the network layer.

var CACHE_NAME = 'tooladda-text-handwriting-v4';

/* The shared site shell. Unlike the CDN libraries below, these two files are
   rebuilt on every site deploy, so cache-first would pin a returning visitor to
   whatever build first installed this worker - analytics and UI fixes would
   never reach them. Stale-while-revalidate keeps the instant load and still
   refreshes in the background. */
// side-ads.js / inline-ads.js bhi yahin: ad keys/size badlein to returning visitor tak pahunche.
var SHARED_SHELL = /\/assets\/(js\/app\.js|js\/side-ads\.js|js\/inline-ads\.js|css\/style\.css|images\/logo\.svg)(\?|$)/;

var APP_SHELL = [
  '/text-to-handwriting.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/images/logo.svg',
  '/text-to-handwriting-manifest.json',
  // Local, versioned copies — no CDN, so offline export genuinely works.
  '/assets/js/pdf-lib.min.js',
  '/assets/js/jszip.min.js'
];

// Handwriting fonts are fetched lazily as the user picks them. We cache each
// one after first use so it is available offline next time.
var FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('Handwriting SW: could not cache', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('tooladda-text-handwriting-') === 0 && k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var sameOrigin = new URL(req.url).origin === self.location.origin;
  var isFont = FONT_HOSTS.test(req.url);
  if (!sameOrigin && !isFont) return;

  // Network-first for the page itself, so rendering fixes ship immediately.
  if (req.mode === 'navigate' || req.url.indexOf('text-to-handwriting.html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (c) { return c || caches.match('/text-to-handwriting.html'); });
      })
    );
    return;
  }

  // Cache-first for assets, engines and font files.
  // Stale-while-revalidate for the shared shell: serve the cached copy at once,
  // then replace it so the NEXT load runs the current build.
  if (SHARED_SHELL.test(req.url)) {
    var fresh = fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    });

    // Keep the worker alive for the refresh even when the cached copy is what
    // gets served, otherwise it may be killed before cache.put() lands.
    event.waitUntil(fresh.catch(function () {}));

    event.respondWith(
      caches.match(req).then(function (cached) { return cached || fresh; })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
