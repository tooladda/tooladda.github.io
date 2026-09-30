// Service worker for the Offline Invoice Generator ONLY.
// Registered from the page with an explicit narrow scope ('/invoice-generator.html'),
// so it can only ever intercept requests made by that one page — it cannot affect any
// other tool on the site, even though the file must live at the site root to be eligible
// for that scope.
//
// Why this exists: invoicing is recurring work. A returning user should get an instant
// load and keep generating PDFs on a patchy connection. Nothing here caches or
// transmits any user data — only static assets.

var CACHE_NAME = 'tooladda-invoice-generator-v2';

/* The shared site shell. Unlike the CDN libraries below, these two files are
   rebuilt on every site deploy, so cache-first would pin a returning visitor to
   whatever build first installed this worker - analytics and UI fixes would
   never reach them. Stale-while-revalidate keeps the instant load and still
   refreshes in the background. */
// side-ads.js / inline-ads.js bhi yahin: ad keys/size badlein to returning visitor tak pahunche.
var SHARED_SHELL = /\/assets\/(js\/app\.js|js\/side-ads\.js|js\/inline-ads\.js|css\/style\.css|images\/logo\.svg)(\?|$)/;

var APP_SHELL = [
  '/invoice-generator.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/js/invoice-engine.js',
  '/assets/js/invoice-generator.js',
  '/assets/images/logo.svg',
  '/invoice-generator-manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('Invoice Generator SW: could not cache', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('tooladda-invoice-generator-') === 0 && k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate' || req.url.indexOf('invoice-generator.html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('/invoice-generator.html');
        });
      })
    );
    return;
  }

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
