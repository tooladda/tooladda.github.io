// Service worker for the Online Notepad tool ONLY.
// Registered with an explicit narrow scope ('/online-notepad.html') from the page itself, so this
// worker only ever intercepts requests made by that one page/client — it cannot affect any other
// tool on the site even though the file has to live at the site root to be eligible for that scope.

var CACHE_NAME = 'tooladda-notepad-v4';

/* The shared site shell. Unlike the CDN libraries below, these two files are
   rebuilt on every site deploy, so cache-first would pin a returning visitor to
   whatever build first installed this worker - analytics and UI fixes would
   never reach them. Stale-while-revalidate keeps the instant load and still
   refreshes in the background. */
// side-ads.js / inline-ads.js bhi yahin: ad keys/size badlein to returning visitor tak pahunche.
var SHARED_SHELL = /\/assets\/(js\/app\.js|js\/side-ads\.js|js\/inline-ads\.js|css\/style\.css|images\/logo\.svg)(\?|$)/;
var APP_SHELL = [
  '/online-notepad.html',
  '/assets/css/style.css',
  '/assets/images/logo.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.5/purify.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/turndown/7.1.2/turndown.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) { console.warn('Notepad SW: could not cache', url, err); });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  // Cache storage is shared across the whole origin, so this must only ever
  // delete this worker's own superseded versions — never another tool's cache.
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('tooladda-notepad-') === 0 && k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  // App shell HTML: network-first so updates are picked up, falling back to cache when offline.
  if (req.mode === 'navigate' || req.url.indexOf('online-notepad.html') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req).then(function (cached) { return cached || caches.match('/online-notepad.html'); }); })
    );
    return;
  }

  // Everything else this page requests (CSS, JSZip, CDN libraries): cache-first, then network, then cache the result.
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
