// Service worker for the Minesweeper page ONLY.
// The game is a single self-contained HTML file, so the cache is tiny and
// offline play works from the second visit onward. It never sees gameplay:
// boards, times and statistics are generated and stored locally and never
// touch the network layer at all.

var CACHE_NAME = 'tooladda-minesweeper-v4';

/* The shared site shell. Unlike the CDN libraries below, these two files are
   rebuilt on every site deploy, so cache-first would pin a returning visitor to
   whatever build first installed this worker - analytics and UI fixes would
   never reach them. Stale-while-revalidate keeps the instant load and still
   refreshes in the background. */
// side-ads.js / inline-ads.js bhi yahin: ad keys/size badlein to returning visitor tak pahunche.
var SHARED_SHELL = /\/assets\/(js\/app\.js|js\/side-ads\.js|js\/inline-ads\.js|css\/style\.css|images\/logo\.svg)(\?|$)/;

var APP_SHELL = [
  '/minesweeper.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/images/logo.svg',
  '/minesweeper-manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('Minesweeper SW: could not cache', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('tooladda-minesweeper-') === 0 && k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Network-first for the page itself so engine fixes ship immediately,
  // falling back to the cached copy when offline.
  if (req.mode === 'navigate' || req.url.indexOf('minesweeper.html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (c) { return c || caches.match('/minesweeper.html'); });
      })
    );
    return;
  }

  // Cache-first for the shared shell assets.
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
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
