// Service worker for the Flatten PDF tool ONLY.
// Registered with an explicit narrow scope ('/flatten-pdf.html') from the page itself, so this
// worker only ever intercepts requests made by that one page/client — it cannot affect any other
// tool on the site even though the file has to live at the site root to be eligible for that scope.

var CACHE_NAME = 'tooladda-flatten-pdf-v2';

/* The shared site shell. Unlike the CDN libraries below, these two files are
   rebuilt on every site deploy, so cache-first would pin a returning visitor to
   whatever build first installed this worker - analytics and UI fixes would
   never reach them. Stale-while-revalidate keeps the instant load and still
   refreshes in the background. */
// side-ads.js / inline-ads.js bhi yahin: ad keys/size badlein to returning visitor tak pahunche.
var SHARED_SHELL = /\/assets\/(js\/app\.js|js\/side-ads\.js|js\/inline-ads\.js|css\/style\.css|images\/logo\.svg)(\?|$)/;
var APP_SHELL = [
  '/flatten-pdf.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/js/pdf-lib.min.js',
  '/assets/js/jszip.min.js',
  '/assets/images/logo.svg',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) { console.warn('Flatten PDF SW: could not cache', url, err); });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  // Cache storage is shared across the whole origin, so this must only ever
  // delete this worker's own superseded versions — never another tool's cache.
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('tooladda-flatten-pdf-') === 0 && k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate' || req.url.indexOf('flatten-pdf.html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req).then(function (cached) { return cached || caches.match('/flatten-pdf.html'); }); })
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
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); }); }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
