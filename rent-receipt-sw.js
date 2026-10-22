// Service worker for the Rent Receipt Generator ONLY.
// Registered from the page with an explicit narrow scope ('/rent-receipt-generator.html'),
// so it can only intercept requests made by that one page. It caches static assets and the
// interface-language JSON files — never any user data, which never reaches the network at all.

var CACHE_NAME = 'tooladda-rent-receipt-v3';

/* The shared site shell. Unlike the CDN libraries below, these two files are
   rebuilt on every site deploy, so cache-first would pin a returning visitor to
   whatever build first installed this worker - analytics and UI fixes would
   never reach them. Stale-while-revalidate keeps the instant load and still
   refreshes in the background. */
// side-ads.js / inline-ads.js bhi yahin: ad keys/size badlein to returning visitor tak pahunche.
var SHARED_SHELL = /\/assets\/(js\/app\.js|js\/side-ads\.js|js\/inline-ads\.js|css\/style\.css|images\/logo\.svg)(\?|$)/;

var APP_SHELL = [
  '/rent-receipt-generator.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/images/logo.svg',
  '/rent-receipt-manifest.json',
  '/assets/i18n/rr-en.json',
  // PDF engine — cached on install so the first Download is instant and works offline
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Other locales are fetched on demand and cached then, so we never ship all languages upfront.
var LAZY = /\/assets\/i18n\/rr-[a-z]{2}\.json$/;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('Rent Receipt SW: could not cache', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('tooladda-rent-receipt-') === 0 && k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  // Network-first for the page itself, so content and country-rule updates ship immediately.
  if (req.mode === 'navigate' || req.url.indexOf('rent-receipt-generator.html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (c) { return c || caches.match('/rent-receipt-generator.html'); });
      })
    );
    return;
  }

  // Cache-first for static assets, the PDF engine and locale files.
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
          if (LAZY.test(req.url) || res.ok) {
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          }
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
