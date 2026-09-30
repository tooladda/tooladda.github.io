/* Three tool workers (minesweeper, poster printer, text-to-handwriting) were once
   registered without an explicit scope. The script lives at the site root, so the
   default scope became '/' and a single game visit left one worker controlling every
   page on the site — serving style.css, app.js and logo.svg cache-first from that
   tool's cache, so deploys never reached the user. The registrations now pass their
   own page as the scope, but a registration is keyed BY scope: the old root-scoped
   one survives in browsers that already have it and has to be removed explicitly.

   This runs first in the file on purpose. It is the recovery path for users whose
   whole site is being served from a stale cache, so it must not sit behind any other
   top-level statement that could throw on an unusual page and skip it. */
(() => {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistrations) return;

  const rootScope = `${window.location.origin}/`;

  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      try {
        if (registration.scope !== rootScope) return;
        // Every worker on this site is deliberately scoped to a single page, so a
        // root-scoped one is always the stale registration and never a current design.
        const worker = registration.active || registration.waiting || registration.installing;
        if (worker && !/-sw\.js$/.test(new URL(worker.scriptURL).pathname)) return;
        registration.unregister().catch(() => {});
      } catch (error) {
        // One malformed registration must not stop the others being cleaned up.
      }
    });
  }).catch(() => {});
})();

const consentStorageKey = 'tooladda-consent';
const consentBannerId = 'tooladda-consent-banner';
const defaultAnalyticsId = 'G-5LBH5VNJ3V';

const safeStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Ignore storage access issues in private browsing or restricted contexts.
    }
  },
};

const getConsentPreference = () => safeStorage.get(consentStorageKey);
const setConsentPreference = (value) => safeStorage.set(consentStorageKey, value);

// /* Top sticky ad (Adsterra) on every page, styled after AdSense's anchor ad: the ad
//    panel with a small tab hanging under it. The tab's arrow slides the panel up out
//    of view and back. There is deliberately no close button.

//    The bar sits in normal flow just before the site header and sticks to the top
//    of the viewport, so it pushes the page down rather than covering it. The
//    strip the tab hangs in is part of the bar, so the tab never sits on the header.

//    Everything else that sticks to the viewport (the site header, sticky ad
//    columns, previews, tab bars) was written for a viewport that starts at 0, so
//    while the bar is up each of them gets the bar's height added to its own top.
//    Sticky elements inside their own scroll box are left alone, and so are the
//    existing ad units (side-ads.js, inline-ads.js).

//    It runs here, early in app.js, so the bar is in place as soon as possible
//    and the page shifts at most once. The styles live here rather than in
//    style.css for the same reason as the other ad scripts: some pages' service
//    workers serve an old copy of style.css first. */
// (() => {
//   const body = document.body;
//   if (!body || document.getElementById('ta-top-ad')) return;

//   const UNITS = [
//     // The 728 ad plus a little padding needs ~740px; below 800px use the phone unit.
//     { min: 800, key: 'ea93e60b399c01bdc49f8a6520554164', w: 728, h: 90 },
//     { min: 0, key: 'e526027a7a2c599611131756bd26bfe7', w: 320, h: 50 },
//   ];
//   // The bar itself is transparent and click-through; only the panel and the tab
//   // take the pointer, so the page shows (and works) on either side of the tab.
//   const CSS =
//     '#ta-top-ad{position:sticky;top:0;z-index:50;display:flex;flex-direction:column;align-items:center;box-sizing:border-box;width:100%;margin:0;padding:0;pointer-events:none}' +
//     '#ta-top-ad .ta-top-ad__panel{align-self:stretch;display:flex;justify-content:center;box-sizing:border-box;padding:4px;background:#fff;border-bottom:1px solid rgba(15,23,42,.12);box-shadow:0 2px 12px rgba(15,23,42,.08);pointer-events:auto;transition:margin-top .25s ease,visibility 0s}' +
//     '#ta-top-ad.is-collapsed .ta-top-ad__panel{visibility:hidden;transition:margin-top .25s ease,visibility 0s linear .25s}' +
//     '#ta-top-ad .ta-top-ad__box{min-width:0;max-width:100%;overflow:hidden}' +
//     '#ta-top-ad iframe{display:block;border:0}' +
//     '#ta-top-ad .ta-top-ad__tabrow{display:flex;justify-content:flex-end;max-width:100%}' +
//     '#ta-top-ad .ta-top-ad__tab{display:flex;margin-top:-1px;background:#fff;border:1px solid rgba(15,23,42,.12);border-top:0;border-radius:0 0 10px 10px;box-shadow:0 4px 10px rgba(15,23,42,.12);overflow:hidden;pointer-events:auto}' +
//     '#ta-top-ad .ta-top-ad__btn{all:unset;box-sizing:border-box;display:grid;place-items:center;width:44px;height:22px;color:#5f6368;cursor:pointer}' +
//     '#ta-top-ad .ta-top-ad__btn:hover{background:rgba(15,23,42,.06);color:#202124}' +
//     '#ta-top-ad .ta-top-ad__btn:focus-visible{outline:2px solid #4f46e5;outline-offset:-2px}' +
//     '#ta-top-ad .ta-top-ad__btn svg{display:block;width:12px;height:12px}' +
//     '#ta-top-ad .ta-top-ad__toggle svg{transition:transform .25s ease}' +
//     '#ta-top-ad.is-collapsed .ta-top-ad__toggle svg{transform:rotate(180deg)}' +
//     '[data-theme="dark"] #ta-top-ad .ta-top-ad__panel{background:#111a2e;border-bottom-color:rgba(148,163,184,.2);box-shadow:0 2px 12px rgba(0,0,0,.35)}' +
//     '[data-theme="dark"] #ta-top-ad .ta-top-ad__tab{background:#111a2e;border-color:rgba(148,163,184,.2);box-shadow:0 4px 10px rgba(0,0,0,.35)}' +
//     '[data-theme="dark"] #ta-top-ad .ta-top-ad__btn{color:#cbd5e1}' +
//     '[data-theme="dark"] #ta-top-ad .ta-top-ad__btn:hover{background:rgba(255,255,255,.08);color:#fff}' +
//     '@media (prefers-reduced-motion:reduce){#ta-top-ad .ta-top-ad__panel,#ta-top-ad .ta-top-ad__toggle svg{transition:none}}' +
//     '@media print{#ta-top-ad{display:none!important}}';

//   // Chrome paints an empty frame white, so until the ad loads the frame takes the
//   // bar's own background. app.js sets data-theme further down, so read the choice.
//   const isDark = () => (safeStorage.get('tooladda-theme') ||
//     (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

//   const frame = (unit) => {
//     const f = document.createElement('iframe');
//     f.title = 'Advertisement';
//     f.width = String(unit.w);
//     f.height = String(unit.h);
//     f.setAttribute('scrolling', 'no');
//     f.srcdoc = `<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:${isDark() ? '#111a2e' : '#ffffff'}}</style></head><body>` +
//       `<script>atOptions={key:"${unit.key}",format:"iframe",height:${unit.h},width:${unit.w},params:{}};<\/script>` +
//       `<script src="https://www.highrevenueformat.com/${unit.key}/invoke.js"><\/script>` +
//       '</body></html>';
//     return f;
//   };

//   const style = document.createElement('style');
//   style.textContent = CSS;
//   document.head.appendChild(style);

//   const bar = document.createElement('aside');
//   bar.id = 'ta-top-ad';
//   bar.setAttribute('aria-label', 'Advertisement');
//   const panel = document.createElement('div');
//   panel.className = 'ta-top-ad__panel';
//   panel.id = 'ta-top-ad-panel';
//   const box = document.createElement('div');
//   box.className = 'ta-top-ad__box';
//   panel.append(box);
//   const toggle = document.createElement('button');
//   toggle.type = 'button';
//   toggle.className = 'ta-top-ad__btn ta-top-ad__toggle';
//   toggle.setAttribute('aria-label', 'Hide ad');
//   toggle.setAttribute('aria-expanded', 'true');
//   toggle.setAttribute('aria-controls', panel.id);
//   toggle.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
//   const tab = document.createElement('div');
//   tab.className = 'ta-top-ad__tab';
//   tab.append(toggle);
//   // The tab hangs at the ad's right edge. The screen's edge would put it over the
//   // right side-rail ad on desktop.
//   const tabRow = document.createElement('div');
//   tabRow.className = 'ta-top-ad__tabrow';
//   tabRow.append(tab);
//   bar.append(panel, tabRow);

//   // Before the header's top-level block, so a skip link stays first in the page.
//   const header = document.querySelector('.site-header');
//   let anchor = header;
//   while (anchor && anchor.parentElement !== body) anchor = anchor.parentElement;
//   body.insertBefore(bar, anchor || body.firstChild);

//   let unit = null;
//   let collapsed = false;
//   // Collapsed = the panel pulled up above the bar by its own height, leaving the tab.
//   const place = () => {
//     panel.style.marginTop = collapsed ? `-${panel.offsetHeight}px` : '';
//   };
//   const fit = () => {
//     const vw = document.documentElement.clientWidth || window.innerWidth;
//     const next = UNITS.find((u) => vw >= u.min);
//     if (next === unit) return;
//     unit = next;
//     box.style.width = `${unit.w}px`;
//     box.style.height = `${unit.h}px`;
//     tabRow.style.width = `${unit.w}px`;
//     box.replaceChildren(frame(unit));
//     place();
//   };

//   // Sticky candidates come from the stylesheets' own `position: sticky` rules, so a
//   // check is a handful of elements rather than a walk over the whole page.
//   let stickySel = '';
//   let sheetCount = -1;
//   const stickySelector = () => {
//     if (document.styleSheets.length === sheetCount) return stickySel;
//     sheetCount = document.styleSheets.length;
//     const found = ['[style*="sticky"]'];
//     const walk = (rules) => {
//       for (const rule of rules) {
//         if (rule.selectorText && rule.style && /sticky/.test(rule.style.position)) {
//           try {
//             document.querySelector(rule.selectorText); // a ::before group is not queryable
//             found.push(rule.selectorText);
//           } catch (error) {
//             // Skip it.
//           }
//         }
//         if (rule.cssRules) walk(rule.cssRules);
//       }
//     };
//     for (const sheet of document.styleSheets) {
//       try {
//         walk(sheet.cssRules);
//       } catch (error) {
//         // Cross-origin sheet (Google Fonts).
//       }
//     }
//     stickySel = found.join(',');
//     return stickySel;
//   };

//   const inScrollBox = (el) => {
//     for (let p = el.parentElement; p && p !== body; p = p.parentElement) {
//       const cs = getComputedStyle(p);
//       if (/auto|scroll|hidden/.test(cs.overflowX + cs.overflowY)) return true;
//     }
//     return false;
//   };

//   const root = document.documentElement;
//   const ownPad = [root.style.getPropertyValue('scroll-padding-top'), root.style.getPropertyPriority('scroll-padding-top')];
//   const shifted = new Map(); // element -> its inline top from before we touched it

//   // full: re-read every page value (after a resize, or when the bar or header
//   // changes height). Otherwise only pick up elements that became sticky since the
//   // last check.
//   const shift = (full) => {
//     const h = bar.offsetHeight; // 0 if an ad blocker hides the bar
//     const undo = [];
//     shifted.forEach((own, el) => {
//       if (full || !el.isConnected || !/sticky/.test(getComputedStyle(el).position)) undo.push(el);
//     });
//     undo.forEach((el) => {
//       const [value, priority] = shifted.get(el);
//       el.style.setProperty('top', value, priority);
//       shifted.delete(el);
//     });
//     if (full) root.style.setProperty('scroll-padding-top', ownPad[0], ownPad[1]);
//     if (!h) return;

//     // Read everything first, then write, so the page is laid out once.
//     const todo = [];
//     let els = [];
//     try {
//       els = document.querySelectorAll(stickySelector());
//     } catch (error) {
//       // Leave the page as it is.
//     }
//     els.forEach((el) => {
//       if (shifted.has(el) || bar.contains(el)) return;
//       const cs = getComputedStyle(el);
//       if (!/sticky/.test(cs.position) || cs.top === 'auto' || inScrollBox(el)) return;
//       todo.push([el, cs.top]);
//     });
//     const pad = full ? getComputedStyle(root).scrollPaddingTop : '';
//     todo.forEach(([el, top]) => {
//       shifted.set(el, [el.style.getPropertyValue('top'), el.style.getPropertyPriority('top')]);
//       el.style.setProperty('top', `calc(${top} + ${h}px)`, 'important');
//     });
//     // Anchor links and scrollIntoView should land below the bar too.
//     if (full) root.style.setProperty('scroll-padding-top', `calc(${pad === 'auto' ? '0px' : pad} + ${h}px)`);
//   };

//   fit();
//   shift(true);

//   let resizeTimer = 0;
//   let scrollTimer = 0;
//   window.addEventListener('resize', () => {
//     clearTimeout(resizeTimer);
//     resizeTimer = setTimeout(() => {
//       fit();
//       shift(true);
//     }, 150);
//   });
//   // Upload, Generate and similar can make a panel sticky later; catch it on scroll,
//   // which is the only time a sticky element's top matters.
//   window.addEventListener('scroll', () => {
//     if (scrollTimer) return;
//     scrollTimer = setTimeout(() => {
//       scrollTimer = 0;
//       shift(false);
//     }, 400);
//   }, { passive: true });
//   window.addEventListener('load', () => shift(true));
//   // Re-read the sticky tops whenever the bar changes height (the tab's arrow, which
//   // animates) and whenever the header does: it shrinks once the page scrolls, and
//   // app.js turns its new height into --header-overlap, which most sticky tops are
//   // built on. A frame later, so that update has landed.
//   const watch = typeof ResizeObserver !== 'undefined'
//     ? new ResizeObserver(() => requestAnimationFrame(() => shift(true)))
//     : null;
//   if (watch) {
//     watch.observe(bar);
//     if (header) watch.observe(header);
//   }

//   toggle.addEventListener('click', () => {
//     collapsed = !collapsed;
//     bar.classList.toggle('is-collapsed', collapsed);
//     toggle.setAttribute('aria-expanded', String(!collapsed));
//     toggle.setAttribute('aria-label', collapsed ? 'Show ad' : 'Hide ad');
//     place();
//     if (!watch) setTimeout(() => shift(true), 300);
//   });
// })();

// preserveExisting: if the page already declares this tag with a value, leave it alone.
// Used for per-page assets (og:image, twitter:image) that must not be replaced by a sitewide default.
const ensureMetaTag = (attributes, { preserveExisting = false } = {}) => {
  const selector = attributes.property
    ? `meta[property="${attributes.property}"]`
    : attributes.name
      ? `meta[name="${attributes.name}"]`
      : attributes['http-equiv']
        ? `meta[http-equiv="${attributes['http-equiv']}"]`
        : 'meta';
  let tag = document.head.querySelector(selector);

  if (tag && preserveExisting && tag.getAttribute('content')) {
    return tag;
  }

  if (!tag) {
    tag = document.createElement('meta');
    if (attributes.property) {
      tag.setAttribute('property', attributes.property);
    }
    if (attributes.name) {
      tag.setAttribute('name', attributes.name);
    }
    if (attributes['http-equiv']) {
      tag.setAttribute('http-equiv', attributes['http-equiv']);
    }
    document.head.appendChild(tag);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (key !== 'property' && key !== 'name' && key !== 'http-equiv' && value) {
      tag.setAttribute(key, value);
    }
  });

  return tag;
};

const ensureLinkTag = (attributes, { preserveExisting = false } = {}) => {
  let link = document.head.querySelector(`link[rel="${attributes.rel}"]`);

  if (link && preserveExisting && link.getAttribute('href')) {
    return link;
  }

  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', attributes.rel);
    document.head.appendChild(link);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (key !== 'rel' && value) {
      link.setAttribute(key, value);
    }
  });

  return link;
};

const ensureSchemaMarkup = (schema) => {
  let node = document.head.querySelector('script[data-tooladda-schema="true"]');

  if (!node) {
    node = document.createElement('script');
    node.setAttribute('type', 'application/ld+json');
    node.setAttribute('data-tooladda-schema', 'true');
    document.head.appendChild(node);
  }

  node.textContent = JSON.stringify(schema);
};

// The canonical a page ships in its HTML wins over anything derived from the current URL.
// The host serves every page at both /page and /page.html with a 200, so deriving this from
// window.location made each duplicate URL declare itself canonical in the rendered DOM —
// destroying, after render, the very protection the static tag provides. It also made
// /index.html canonicalise to itself instead of to /.
const buildCanonicalUrl = () => {
  const declared = document.head.querySelector('link[rel="canonical"]')?.getAttribute('href');

  if (declared) {
    try {
      return new URL(declared, window.location.href).toString();
    } catch (error) {
      // Malformed href — fall through and derive it from the current URL instead.
    }
  }

  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  // Only reached by a brand-new page that ships no canonical of its own.
  if (/^\/index\.html?$/i.test(url.pathname)) {
    url.pathname = '/';
  }

  return url.toString();
};

// Home > Current page. Intentionally two levels: the directory segments (/calculators,
// /text-tools) are not browsable URLs, so emitting them produced 404 breadcrumb links.
const buildBreadcrumbItems = () => {
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  // The homepage is position 1 itself — it must not appear as a crumb under itself.
  if (!pathSegments.length || (pathSegments.length === 1 && /^index\.html?$/i.test(pathSegments[0]))) {
    return [];
  }

  // Prefer the label the page actually shows in its visible breadcrumb.
  const crumbs = document.querySelectorAll('.breadcrumb span, .breadcrumb li:last-child');
  let label = '';
  crumbs.forEach((el) => {
    const text = (el.textContent || '').trim();
    if (text && !['/', '›', '>', '»', '|'].includes(text)) {
      label = text;
    }
  });

  if (!label) {
    label = document.title.replace(/\s*[|–—-]\s*ToolAdda.*$/i, '').trim()
      || pathSegments[pathSegments.length - 1].replace(/\.html$/i, '').replace(/[-_]+/g, ' ');
  }

  return [{ '@type': 'ListItem', position: 2, name: label }];
};

const injectSeoEnhancements = () => {
  const title = document.title || 'ToolAdda';
  const description = document.querySelector('meta[name="description"]')?.content || 'ToolAdda offers fast, browser-based utility tools and games for everyday productivity.';
  const canonicalUrl = buildCanonicalUrl();
  // Per-page social card. Pages ship their own og:image in HTML (see assets/images/og/);
  // this only derives a path for pages that do not, and falls back to the generic card.
  // Never use logo.svg here — no social platform renders SVG previews.
  const ogSlug = window.location.pathname
    .replace(/^\//, '')
    .replace(/\.html$/i, '')
    .replace(/\/$/, '')
    .replace(/\//g, '-') || 'index';
  // Every existing page ships its own og:image, so this derived path is only used by a
  // brand-new page. Generate its card into assets/images/og/ or it will 404.
  // Site-root assets must resolve against the origin, not the current page:
  // resolving against a canonical like /cyber-tools/foo.html asked for
  // /cyber-tools/manifest.webmanifest and 404'd on every page in a subdirectory.
  const rootUrl = `${window.location.origin}/`;
  const imageUrl = new URL(`assets/images/og/${ogSlug}.jpg`, rootUrl).toString();
  const breadcrumbItems = buildBreadcrumbItems();

  ensureMetaTag({ name: 'description', content: description });
  // Same rule as the canonical below: never overwrite a directive the page
  // deliberately declares. 404.html ships `noindex, follow`, and rewriting it
  // to `index,follow` after render told Googlebot the error page was indexable.
  ensureMetaTag({ name: 'robots', content: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' }, { preserveExisting: true });
  ensureMetaTag({ name: 'theme-color', content: '#4f46e5' });
  ensureMetaTag({ name: 'color-scheme', content: 'light dark' });
  ensureMetaTag({ name: 'referrer', content: 'strict-origin-when-cross-origin' });
  ensureMetaTag({ name: 'format-detection', content: 'telephone=no' });
  ensureMetaTag({ property: 'og:type', content: 'website' });
  ensureMetaTag({ property: 'og:title', content: title });
  ensureMetaTag({ property: 'og:description', content: description });
  ensureMetaTag({ property: 'og:url', content: canonicalUrl });
  ensureMetaTag({ property: 'og:image', content: imageUrl }, { preserveExisting: true });
  ensureMetaTag({ name: 'twitter:card', content: 'summary_large_image' });
  ensureMetaTag({ name: 'twitter:title', content: title });
  ensureMetaTag({ name: 'twitter:description', content: description });
  ensureMetaTag({ name: 'twitter:image', content: imageUrl }, { preserveExisting: true });

  // Never rewrite a canonical the page already declares — only add one if it is missing.
  ensureLinkTag({ rel: 'canonical', href: canonicalUrl }, { preserveExisting: true });
  // Tools with their own scoped PWA manifest (e.g. the salary slip generator) must keep it.
  ensureLinkTag({ rel: 'manifest', href: new URL('manifest.webmanifest', rootUrl).toString() }, { preserveExisting: true });
  /* Three pages shipped without an icon link and showed a blank browser tab, so
     the tab icon is injected here too. preserveExisting keeps whatever a page
     declares for itself; this only covers the pages that forget. */
  ensureLinkTag({ rel: 'icon', href: new URL('assets/images/logo.svg', rootUrl).toString(), type: 'image/svg+xml' }, { preserveExisting: true });
  // Must be a PNG: iOS ignores SVG apple-touch-icons outright, and it paints any
  // transparency solid black, so scripts/make_icons.py ships this one flattened.
  ensureLinkTag({ rel: 'apple-touch-icon', href: new URL('apple-touch-icon.png', rootUrl).toString() });

  // Search the whole document, not just the head: JSON-LD is valid anywhere,
  // and a page whose schema block sits in the body was getting a second graph
  // injected here — two BreadcrumbLists under one @id, which Google merges into
  // a single list where the final crumb is no longer last and its missing
  // `item` field becomes a genuine error.
  const hasPageSchema = document.querySelector('script[type="application/ld+json"][data-tooladda-page-schema="true"]');

  if (!hasPageSchema) {
    // Site-level entities must be keyed to the ORIGIN, not the current page, or every page
    // declares itself to be the website and "Home" links back to the page it is on.
    const siteUrl = `${window.location.origin}/`;

    ensureSchemaMarkup({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': `${siteUrl}#website`,
          name: 'ToolAdda',
          url: siteUrl,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${siteUrl}#search-tools`,
            'query-input': 'required name=search_term_string',
          },
        },
        {
          '@type': 'Organization',
          '@id': `${siteUrl}#organization`,
          name: 'ToolAdda',
          url: siteUrl,
          logo: new URL('assets/images/logo.svg', siteUrl).toString(),
          sameAs: ['mailto:contact@tooladda.online'],
        },
        {
          '@type': 'WebPage',
          '@id': `${canonicalUrl}#webpage`,
          url: canonicalUrl,
          name: title,
          description,
          isPartOf: { '@id': `${siteUrl}#website` },
          // Only reference the breadcrumb when the node below actually gets emitted.
          // The homepage has no crumbs, so an unconditional reference left a dangling
          // @id and Google reported it as a BreadcrumbList missing `itemListElement`.
          ...(breadcrumbItems && breadcrumbItems.length
            ? { breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` } }
            : {}),
          primaryImageOfPage: { '@type': 'ImageObject', url: imageUrl },
        },
        // A one-item breadcrumb (the homepage under itself) is meaningless — omit the node.
        ...(breadcrumbItems && breadcrumbItems.length
          ? [{
            '@type': 'BreadcrumbList',
            '@id': `${canonicalUrl}#breadcrumb`,
            itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl }, ...breadcrumbItems],
          }]
          : []),
      ],
    });
  }
};

const trackEvent = (action, params = {}) => {
  if (getConsentPreference() !== 'granted') {
    return;
  }

  if (typeof window.gtag === 'function') {
    window.gtag('event', action, { event_category: 'site', ...params });
  }
};

/* The four Consent Mode v2 signals, applied together.

   This lives outside initializeAnalytics() on purpose. That function bails out
   early once the GA script has loaded, so calling it again after the visitor
   clicks Accept returned before it reached the consent update - leaving ads and
   analytics denied for the whole page the visitor consented on. */
const CONSENT_SIGNALS = ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'];

const applyConsentState = (state) => {
  if (typeof window.gtag !== 'function') return;
  const payload = {};
  CONSENT_SIGNALS.forEach((signal) => { payload[signal] = state; });
  window.gtag('consent', 'update', payload);
};

/* Google Consent Mode v2. `ad_user_data` and `ad_personalization` are not
   optional extras: since March 2024 Google requires all four signals for
   traffic from the EEA, the UK and Switzerland, and ads and analytics stop
   being collected for those users if any are missing. Everything starts
   denied and is only granted once the visitor accepts. */
const initializeAnalytics = () => {
  const measurementId = document.querySelector('meta[name="tooladda-analytics-id"]')?.content || window.TOOLADDA_ANALYTICS_ID || defaultAnalyticsId;
  const consent = getConsentPreference();

  if (!measurementId) {
    window.gtag = window.gtag || function gtag() {
      if (window.dataLayer) {
        window.dataLayer.push(arguments);
      }
    };
    window.gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    if (consent === 'granted' || consent === 'denied') {
      applyConsentState(consent);
    }
    return;
  }

  if (window.__tooladdaAnalyticsLoaded) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());

  /* Consent defaults must be declared before any measurement command. GA has to
     know whether it may write cookies before it processes `config` and sends the
     first page_view; reversed, that first hit's consent state is undefined. */
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  /* A stored choice has to be applied BEFORE `config`, because `config` sends
     the first page_view immediately. Applied after, that first hit carries the
     defaults instead of the visitor's actual choice - a returning visitor who
     declined still gets counted as consented once per page load. */
  if (consent === 'granted' || consent === 'denied') {
    applyConsentState(consent);
  }

  window.gtag('config', measurementId, { anonymize_ip: true });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
  window.__tooladdaAnalyticsLoaded = true;
};

/* ---------- giving the banner the page's own accent ----------

   Every tool page ships a scoped palette — violet on the responsive tester,
   steel blue on the JSON formatter, lime on the SIP calculator — declared on
   its wrapper (`main.jf-page`) or on the body (`body.snake-page-shell`). The
   banner is prepended to <body>, so it sits OUTSIDE that wrapper and inherits
   the sitewide indigo instead: on a violet page a stock-indigo strip slides up
   and reads as something bolted on from elsewhere.

   Copying the resolved values onto the banner as inline custom properties fixes
   it without moving the element — moving it inside the wrapper would risk a
   transformed or filtered ancestor turning position:fixed into something
   anchored to that ancestor instead of the viewport.

   Reading from <main> covers all three arrangements: the wrapper IS main on most
   pages; where the palette sits on body, main inherits it; where a page has no
   palette of its own, main inherits the sitewide one, which is the right answer
   anyway. */
const consentAccentVars = ['--accent', '--accent-strong', '--accent-soft'];

const hexToRgb = (value) => {
  const m = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const relLuminance = (rgb) => {
  const c = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

const rgbCss = (rgb, alpha) => (alpha == null
  ? 'rgb(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ')'
  : 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + alpha + ')');
const towardWhite = (rgb, t) => rgb.map((v) => Math.round(v + (255 - v) * t));
const darken = (rgb, t) => rgb.map((v) => Math.round(v * t));

const syncConsentAccent = () => {
  const banner = document.getElementById(consentBannerId);
  if (!banner) return;
  const source = document.querySelector('main') || document.body;
  const cs = getComputedStyle(source);
  const pageAccent = cs.getPropertyValue('--accent').trim();
  const rootAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  /* The page declares a palette of its own — take the whole set, already
     resolved, so page-specific sub-variables never have to travel. */
  if (pageAccent && pageAccent !== rootAccent) {
    consentAccentVars.forEach((name) => {
      const value = cs.getPropertyValue(name).trim();
      if (value) banner.style.setProperty(name, value);
    });
    return;
  }

  /* No --accent of its own, which does NOT mean the page is unthemed: around 40
     of them are visibly coloured, but that colour lives only in page-specific
     variables (--bmi-a, --cc-teal) that nothing outside the page knows to read.
     Those pages were the ones still showing the sitewide indigo.

     <meta name="theme-color"> is the one place every page states its colour in a
     form anything can read, so it becomes the fallback. The tints are computed
     arithmetically rather than with color-mix: an unsupported color-mix would
     make the custom property invalid at computed-value time and the icon would
     simply lose its background. */
  const clear = () => consentAccentVars.forEach((n) => banner.style.removeProperty(n));
  const meta = document.querySelector('meta[name="theme-color"]');
  const rgb = hexToRgb(meta && meta.getAttribute('content'));
  if (!rgb) { clear(); return; }

  const lum = relLuminance(rgb);
  /* A near-black or near-white theme-color is a page background, not an accent —
     pem-to-ppk declares #0f172a. Leave those on the sitewide accent. */
  if (lum < 0.04 || lum > 0.8) { clear(); return; }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.hasAttribute('data-theme') &&
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  /* theme-color is a single light-mode value. On the dark banner a deep green or
     navy would leave white button text barely readable, so lift it first. */
  const base = (isDark && lum < 0.22) ? towardWhite(rgb, 0.45) : rgb;

  banner.style.setProperty('--accent', rgbCss(base));
  banner.style.setProperty('--accent-strong', rgbCss(darken(base, 0.78)));
  banner.style.setProperty('--accent-soft', rgbCss(base, 0.14));
};

/* ---------- keeping the consent banner off the page's own bottom bar ----------

   The banner is fixed to the bottom of the viewport at z-index 1200. Around 80
   tool pages park something down there too — a sticky Convert/Analyze button, a
   mobile action dock, a toast — all at lower z-indexes. On a phone the banner
   lands on top of the page's primary action and silently swallows its taps, and
   for a first-time search visitor that button is the first thing they try to
   press. images-to-pdf carried a hand-written fix for exactly this; this is the
   same idea done once, for every page.

   Bars are found by geometry rather than by name — fixed, sitting on the bottom
   edge, and short enough to be a bar rather than a full-height panel — so a page
   added later is covered without being touched, and a full-height fixed sidebar
   (online-notepad) is left alone.

   `bottom` is adjusted rather than `transform`: several of these bars slide
   themselves in with a transform of their own, and overwriting it would break
   the animation. */
const consentBarLift = (() => {
  /* Cheap candidate sweep. A full walk of the DOM calling getComputedStyle on
     every node costs real milliseconds during first paint; these bars all carry
     one of a handful of naming conventions, and geometry does the deciding. */
  const SEL = '[class*="sticky"],[class*="-cta"],[class*="bar"],' +
              '[class*="dock"],[class*="toast"],[class*="-status"]';
  const GAP = 8;
  const originals = new Map();
  let watcher = null;
  let queued = false;

  const restore = (el) => {
    if (!originals.has(el)) return;
    el.style.bottom = originals.get(el);
    originals.delete(el);
  };

  const apply = () => {
    queued = false;
    const banner = document.getElementById(consentBannerId);
    const visible = banner && !banner.classList.contains('hidden') && banner.getBoundingClientRect().height > 0;

    /* Measure from the un-lifted position so repeated passes cannot stack. */
    originals.forEach((val, el) => { el.style.bottom = val; });

    if (!visible) {
      Array.from(originals.keys()).forEach(restore);
      return;
    }

    const lift = Math.ceil(banner.getBoundingClientRect().height) + GAP;
    const vh = window.innerHeight;
    const seen = new Set();

    document.querySelectorAll(SEL).forEach((el) => {
      if (el === banner || banner.contains(el)) return;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.bottom < vh - 4) return;          // not actually sitting on the bottom edge
      if (r.height > vh * 0.5) return;        // a panel or sidebar, not a bar
      seen.add(el);
      if (!originals.has(el)) originals.set(el, el.style.bottom);
      el.style.bottom = ((parseFloat(cs.bottom) || 0) + lift) + 'px';
    });

    Array.from(originals.keys()).forEach((el) => { if (!seen.has(el)) restore(el); });
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  };

  return {
    start() {
      schedule();
      window.addEventListener('resize', schedule);
      window.addEventListener('orientationchange', schedule);
      /* Most of these bars are revealed later — after a file is picked, or past
         a scroll threshold — so a single pass at banner time would miss them.
         The observer only lives while the banner is up, which is until the
         visitor's first click. Style mutations on bars we ourselves moved are
         ignored, otherwise each lift would re-trigger the observer forever. */
      if ('MutationObserver' in window && !watcher) {
        watcher = new MutationObserver((records) => {
          for (let i = 0; i < records.length; i++) {
            const r = records[i];
            if (r.type === 'attributes' && r.attributeName === 'style' && originals.has(r.target)) continue;
            schedule();
            return;
          }
        });
        watcher.observe(document.body, {
          childList: true, subtree: true,
          attributes: true, attributeFilter: ['class', 'style', 'hidden']
        });
      }
    },
    stop() {
      if (watcher) { watcher.disconnect(); watcher = null; }
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      Array.from(originals.keys()).forEach(restore);
    }
  };
})();

const hideConsentBanner = () => {
  const banner = document.getElementById(consentBannerId);
  if (banner) {
    banner.classList.add('hidden');
  }
  consentBarLift.stop();
};

const showConsentBanner = () => {
  if (document.getElementById(consentBannerId)) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = consentBannerId;
  banner.className = 'consent-banner';
  /* One strip, one line of text. The old block spelled the whole policy out and
     stood 211px tall on a phone — a quarter of the viewport, over the hero, before
     the visitor had seen a single tool. The detail lives in the privacy policy;
     what belongs here is the choice. */
  banner.innerHTML = `
    <div class="consent-banner__inner" role="dialog" aria-label="Privacy and analytics consent">
      <span class="consent-ic" aria-hidden="true">🍪</span>
      <p class="consent-text">
        <strong>Cookies for analytics &amp; ads.</strong>
        <span class="consent-long">Ads are what keep every tool free, and your files never leave this browser either way.</span>
        <a class="consent-link" href="/privacy-policy.html">Privacy policy</a>
      </p>
      <div class="consent-actions">
        <button class="secondary-btn" type="button" data-consent-decline>Decline</button>
        <button class="primary-btn" type="button" data-consent-accept>Accept</button>
      </div>
    </div>
  `;

  document.body.prepend(banner);
  syncConsentAccent();
  consentBarLift.start();

  banner.querySelector('[data-consent-accept]').addEventListener('click', () => {
    setConsentPreference('granted');
    hideConsentBanner();
    initializeAnalytics();
    applyConsentState('granted');

    /* The page_view that fired on load went out while analytics_storage was
       still denied, and GA4 never re-sends it once consent flips. Without this
       one, a visitor who accepts and then leaves without clicking anything is
       never counted at all - which is most of our traffic. */
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view');
    }

    trackEvent('consent_accept');
  });

  banner.querySelector('[data-consent-decline]').addEventListener('click', () => {
    setConsentPreference('denied');
    hideConsentBanner();
    initializeAnalytics();
    applyConsentState('denied');
    trackEvent('consent_decline');
  });
};

const relatedToolCollections = {
  general: [
    { title: 'Password Generator', description: 'Create strong passwords instantly and keep your accounts protected.', href: '/password-generator.html', icon: '🔐' },
    { title: 'Unit Converter', description: 'Convert length, weight, temperature, volume, area, and speed units.', href: '/unit-converter.html', icon: '🔄' },
    { title: 'Internet Speed Test', description: 'Measure download, upload, ping, and jitter in your browser.', href: '/internet-speed-test.html', icon: '⚡' },
    { title: 'Online Teleprompter', description: 'Smooth, keyboard-controlled scrolling script reader.', href: '/online-teleprompter.html', icon: '🎥' },
    { title: 'URL Shortener', description: 'Shorten links with optional custom aliases and QR codes.', href: '/url-shortener.html', icon: '🔗' },
    { title: 'UTM Builder', description: 'Build campaign tracking URLs with UTM parameters for analytics.', href: '/utm-builder.html', icon: '📊' },
    { title: 'Random Name Picker', description: 'Spin the wheel to pick a random winner from your list.', href: '/random-name-picker.html', icon: '🎡' },
    { title: 'SSL Checker', description: 'Inspect TLS certificates, expiry, and security grade online.', href: '/ssl-checker.html', icon: '🔒' },
    { title: 'Image Compressor', description: 'Shrink images without losing quality for faster sharing.', href: '/image-compressor.html', icon: '🖼️' },
    { title: 'PDF Merge', description: 'Combine multiple documents into one polished PDF.', href: '/pdf-merge.html', icon: '📄' },
    { title: 'Case Converter', description: 'Clean up text with fast formatting options in seconds.', href: '/text-tools/case-converter.html', icon: '📝' },
    { title: 'Worksheet Generator', description: 'Generate printable maths and handwriting practice sheets.', href: '/worksheet-generator.html', icon: '📚' },
    { title: 'Rent Receipt Generator', description: 'Generate rent receipts for HRA claims with an exemption calculator.', href: '/rent-receipt-generator.html', icon: '🧾' },
    { title: 'Resume Builder', description: 'ATS-friendly resume maker with real-text PDF, DOCX, and TXT export.', href: '/resume-builder.html', icon: '📋' },
    { title: 'ATS Resume Checker', description: 'Score resume parseability and keyword match against a job description.', href: '/ats-resume-checker.html', icon: '🔍' },
  ],
  calculators: [
    { title: 'Percentage Calculator', description: 'Solve discounts, increases, and quick percentages in a click.', href: '/calculators/percentage-calculator.html', icon: '📐' },
    { title: 'EMI Calculator', description: 'Estimate monthly payments with confidence and clarity.', href: '/calculators/emi-calculator.html', icon: '💳' },
    { title: 'Loan Calculator', description: 'Estimate EMI, total interest, and payment schedule with principal breakdown.', href: '/calculators/loan-calculator.html', icon: '💳' },
    { title: 'Home Loan Calculator', description: 'Calculate home loan EMI, interest, and amortization for housing finance.', href: '/calculators/home-loan-calculator.html', icon: '🏠' },
    { title: 'Car Loan Calculator', description: 'Estimate car loan EMI, total interest, and month-wise repayment schedule.', href: '/calculators/car-loan-calculator.html', icon: '🚗' },
    { title: 'FD Calculator', description: 'Estimate fixed deposit maturity amount, interest, and compound growth.', href: '/calculators/fd-calculator.html', icon: '🏦' },
    { title: 'PPF Calculator', description: 'Estimate Public Provident Fund maturity, interest, and year-wise growth.', href: '/calculators/ppf-calculator.html', icon: '🛡️' },
    { title: 'SIP Calculator', description: 'Plan long-term investing with simple growth projections.', href: '/calculators/sip-calculator.html', icon: '📈' },
    { title: 'RD Calculator', description: 'Estimate recurring deposit savings, interest, and maturity value with monthly contributions.', href: '/calculators/rd-calculator.html', icon: '💰' },
    { title: 'GST Calculator', description: 'Quickly compute inclusive or exclusive GST totals.', href: '/calculators/gst-calculator.html', icon: '🧾' },
    { title: 'Land Area Unit Converter', description: 'Convert bigha, katha, guntha, and more with state-wise factors.', href: '/calculators/land-area-converter.html', icon: '🌾' },
    { title: 'GPA / CGPA Calculator', description: 'Calculate semester GPA, cumulative CGPA, and percentage equivalents.', href: '/calculators/gpa-cgpa-calculator.html', icon: '🎓' },
    { title: 'Age Calculator', description: 'Find exact age in years, months, and days from any birth date.', href: '/calculators/age-calculator.html', icon: '🧑‍🔬' },
    { title: 'Premium Calculator', description: 'Full-featured calculator with keyboard support and precedence.', href: '/calculators/calculator.html', icon: '🧮' },
    { title: 'BMI Calculator', description: 'Check body mass index and healthy weight range instantly.', href: '/calculators/bmi-calculator.html', icon: '🩺' },
    { title: 'Manual Tax Calculator', description: 'Compute income tax with slabs, deductions, surcharge, and cess.', href: '/calculators/manual-tax-calculator.html', icon: '🧾' },
    { title: 'Scientific Calculator', description: 'Real math engine with an editable tape, units, base conversion, graphing, and statistics.', href: '/scientific-calculator.html', icon: '🧮' },
  ],
  images: [
    { title: 'Image Resizer', description: 'Resize files to the exact dimensions you need.', href: '/image-resizer.html', icon: '📏' },
    { title: 'Image Crop Tool', description: 'Trim photos with precise drag-and-crop controls.', href: '/image-crop.html', icon: '✂️' },
    { title: 'EXIF Metadata Remover', description: 'Inspect and remove EXIF, GPS, and embedded metadata from JPG, PNG, and WebP locally.', href: '/exif-metadata-remover.html', icon: '🛡️' },
    { title: 'Image Compressor', description: 'Reduce JPG, PNG, and WebP file size in your browser.', href: '/image-compressor.html', icon: '🗜️' },
    { title: 'Compress Image to Exact KB', description: 'Hit a precise target file size for government form uploads.', href: '/image-compress-to-kb.html', icon: '🗜️' },
    { title: 'Passport Size Photo Maker', description: 'Crop and export passport, visa, and exam photos to exact specs.', href: '/passport-photo-maker.html', icon: '🪪' },
    { title: 'Signature Resizer', description: 'Resize a signature into an exact KB range for exam forms.', href: '/signature-resizer.html', icon: '✍️' },
    { title: 'Poster Printer', description: 'Split an image across multiple pages to print a large poster.', href: '/poster-printer.html', icon: '🖨️' },
    { title: 'JPG to PNG', description: 'Convert images cleanly without leaving your browser.', href: '/jpg-to-png.html', icon: '🔄' },
    { title: 'PNG to WebP Converter', description: 'Convert PNG to WebP with quality control and size comparison.', href: '/png-to-webp.html', icon: '🔁' },
    { title: 'HEIC to JPG/PNG Converter', description: 'Convert iPhone HEIC photos to JPG or PNG locally.', href: '/heic-converter.html', icon: '📸' },
    { title: 'Image Rotate Tool', description: 'Rotate 90°/180°/270° or free-angle, flip, auto EXIF fix, crop after rotate, and batch ZIP export.', href: '/image-rotate.html', icon: '↻' },
    { title: 'Image Blur Tool', description: 'Apply blur filters and download the result instantly.', href: '/image-blur.html', icon: '🌫️' },
    { title: 'Grayscale Image Converter', description: 'Turn colour photos into black-and-white images.', href: '/image-grayscale.html', icon: '⚫' },
    { title: 'Image Color Picker', description: 'Pixel-accurate HEX/RGB/HSL/HSV/CMYK/LAB sampling, dominant-color palettes, and WCAG contrast checking.', href: '/image-color-picker.html', icon: '🎨' },
    { title: 'Image Background Remover', description: 'Remove backgrounds and export transparent PNGs in-browser.', href: '/image-background-remover.html', icon: '🪄' },
    { title: 'Custom QR Code Maker', description: 'Create styled QR codes with logos and custom colours.', href: '/custom-qr-code-maker.html', icon: '📱' },
    { title: 'QR Code Generator', description: 'Generate QR codes for URLs, text, and contact info.', href: '/qr-code-generator.html', icon: '📱' },
    { title: 'QR Code Scanner', description: 'Scan QR codes from camera or uploaded images.', href: '/qr-code-scanner.html', icon: '🔍' },
    { title: 'Barcode Generator', description: 'Create Code128, EAN-13, UPC, and ITF-14 barcodes.', href: '/barcode-generator.html', icon: '📊' },
    { title: 'Favicon Generator', description: 'Create favicon.ico, Apple touch icons, and web manifest files.', href: '/favicon-generator.html', icon: '🎨' },
  ],
  pdf: [
    { title: 'PDF Merge', description: 'Combine multiple PDF files into one document.', href: '/pdf-merge.html', icon: '📄' },
    { title: 'PDF Compress', description: 'Reduce PDF file size while keeping readability.', href: '/pdf-compress.html', icon: '🗜️' },
    { title: 'PDF Split', description: 'Break large documents into smaller, focused files.', href: '/pdf-split.html', icon: '✂️' },
    { title: 'PDF Extract', description: 'Pull out only the pages you need with ease.', href: '/pdf-extract.html', icon: '📑' },
    { title: 'PDF Rotate', description: 'Fix orientation issues in one smooth action.', href: '/pdf-rotate.html', icon: '🔁' },
    { title: 'PDF Password Remover', description: 'Unlock password-protected PDFs in your browser.', href: '/pdf-password-remover.html', icon: '🔐' },
    { title: 'PDF Password Protector', description: 'Add password protection to PDF files locally.', href: '/pdf-password-protector.html', icon: '🔒' },
    { title: 'Images to PDF', description: 'Convert JPG, PNG, and WebP images into a PDF.', href: '/images-to-pdf.html', icon: '🖼️' },
    { title: 'HTML to PDF', description: 'Render HTML markup as a downloadable PDF.', href: '/html-to-pdf.html', icon: '🧾' },
    { title: 'PDF to Images Converter', description: 'Convert PDF pages to PNG, JPG, or WebP at any DPI.', href: '/pdf-to-images.html', icon: '🖼️' },
    { title: 'Add Watermark to PDF', description: 'Add a text or image watermark, tiled or single, keeping text selectable.', href: '/pdf-watermark.html', icon: '💧' },
    { title: 'Compare Two PDFs', description: 'Visual and text diff between two PDFs with smart page alignment.', href: '/compare-pdfs.html', icon: '🔍' },
    { title: 'Flatten PDF', description: 'Lock in form fields (keep text selectable) or flatten to images — both explained plainly.', href: '/flatten-pdf.html', icon: '🧾' },
    { title: 'Redact PDF', description: 'Permanently remove sensitive text from a PDF — manual, search, and OCR redaction.', href: '/redact-pdf.html', icon: '⬛' },
    { title: 'Salary Slip Generator', description: 'Create India-focused payslip PDFs with bulk CSV support.', href: '/salary-slip-generator.html', icon: '💼' },
    { title: 'Paper Generator', description: 'Print graph paper, dot grids, lined sheets, and music manuscript.', href: '/paper-generator.html', icon: '📄' },
    { title: 'Bingo Card Generator', description: 'Generate up to 500 unique printable bingo cards.', href: '/bingo-card-generator.html', icon: '🎱' },
    { title: 'Exam Seating Arrangement Planner', description: 'Seating charts that keep same-class students apart, with room lists and door notices.', href: '/exam-seating-planner.html', icon: '🪑' },
    { title: 'OMR Sheet Generator', description: 'Printable OMR bubble sheets with roll number grid and exam presets.', href: '/omr-sheet-generator.html', icon: '⭕' },
    { title: 'Worksheet Generator', description: 'Printable maths and handwriting worksheets as PDF.', href: '/worksheet-generator.html', icon: '📚' },
    { title: 'Rent Receipt Generator', description: 'Rent receipts for HRA claims with exemption calculator.', href: '/rent-receipt-generator.html', icon: '🧾' },
    { title: 'Resume Builder', description: 'ATS-friendly resume with PDF, DOCX, TXT export and live preview.', href: '/resume-builder.html', icon: '📋' },
    { title: 'ATS Resume Checker', description: 'Parseability and keyword match analysis for your resume.', href: '/ats-resume-checker.html', icon: '🔍' },
  ],
  text: [
    { title: 'Fancy Font Generator', description: 'Turn plain text into 40+ stylish copy-paste Unicode fonts.', href: '/text-tools/fancy-font-generator.html', icon: '✨' },
    { title: 'Text to Handwriting Converter', description: 'Turn typed text into realistic, natural-looking handwriting.', href: '/text-to-handwriting.html', icon: '✍️' },
    { title: 'Emoji & Kaomoji Picker', description: 'Search and copy emoji, kaomoji, and text symbols instantly.', href: '/emoji-kaomoji-picker.html', icon: '😀' },
    { title: 'Base64 Encoder', description: 'Encode and decode text safely in the browser.', href: '/text-tools/base64-encoder-decoder.html', icon: '🔤' },
    { title: 'Case Converter', description: 'Convert text between common writing styles instantly.', href: '/text-tools/case-converter.html', icon: '📝' },
    { title: 'Text Sorter', description: 'Sort lines A–Z, by length, or naturally, then de-duplicate and export.', href: '/text-tools/text-sorter.html', icon: '↕️' },
    { title: 'Character Counter', description: 'Live counts, readability scores, keyword density, and social media character limits.', href: '/text-tools/character-counter.html', icon: '📝' },
    { title: 'Typing Speed Test', description: 'Live net WPM, raw WPM, CPM and accuracy — or use your own passage.', href: '/typing-speed-test.html', icon: '⌨️' },
    { title: 'Password Generator', description: 'Build secure passwords with custom rules.', href: '/password-generator.html', icon: '🔐' },
    { title: 'Online Notepad', description: 'Auto-saving Markdown notepad with live preview — no login, works offline.', href: '/online-notepad.html', icon: '📓' },
    { title: 'WhatsApp Chat Analyzer', description: 'Analyze exported chats for activity, stats, top words, and response patterns.', href: '/whatsapp-chat-analyzer.html', icon: '💬' },
  ],
  developer: [
    { title: 'CSS to Tailwind Converter', description: 'Convert CSS into optimized Tailwind utility classes with live preview.', href: '/css-to-tailwind.html', icon: '🧩' },
    { title: 'Responsive Design Tester', description: 'Preview any site at real phone, tablet and desktop viewport sizes.', href: '/developer-tools/responsive-design-tester.html', icon: '📱' },
    { title: 'JSON Formatter', description: 'Pretty-print, validate, and minify JSON in the browser.', href: '/developer-tools/json-formatter.html', icon: '🧩' },
    { title: 'JSON to YAML', description: 'Convert JSON to YAML and back with live preview.', href: '/developer-tools/json-to-yaml.html', icon: '🔁' },
    { title: 'JSON to TypeScript', description: 'Generate TypeScript interfaces, types, classes, and enums from JSON.', href: '/developer-tools/json-to-typescript.html', icon: '🧬' },
    { title: 'YAML to XML Converter', description: 'Convert YAML to well-formed XML with nested objects and arrays.', href: '/developer-tools/yaml-to-xml.html', icon: '🧬' },
    { title: 'Markdown to Notion', description: 'Convert Markdown into Notion API-compatible Block JSON.', href: '/developer-tools/markdown-to-notion.html', icon: '🗒️' },
    { title: 'CSV to JSON Converter', description: 'Parse CSV files into JSON arrays locally.', href: '/csv-to-json-converter.html', icon: '🗄️' },
    { title: 'JSON to CSV Converter', description: 'Export JSON data as downloadable CSV files.', href: '/json-to-csv-converter.html', icon: '🧾' },
    { title: 'XML to JSON Converter', description: 'Convert XML documents to JSON structure.', href: '/xml-to-json-converter.html', icon: '📦' },
    { title: 'JSON to XML Converter', description: 'Transform JSON objects into XML markup.', href: '/json-to-xml-converter.html', icon: '🧩' },
    { title: 'IP Subnet Calculator', description: 'Calculate network address, broadcast, usable hosts, CIDR, and VLSM planning.', href: '/ip-subnet-calculator.html', icon: '🌐' },
    { title: 'JWT Debugger', description: 'Decode and inspect JSON Web Token headers and claims.', href: '/jwt-debugger.html', icon: '🔐' },
    { title: 'JWT Encoder', description: 'Create and sign JWTs with HS256, RS256, or ES256.', href: '/jwt-encoder.html', icon: '🔏' },
    { title: 'Markdown to HTML', description: 'Live Markdown editor with instant HTML preview.', href: '/markdown-to-html.html', icon: '📝' },
    { title: 'UUID Generator', description: 'Generate UUID v1, v4, v7, nil, and empty GUIDs.', href: '/uuid-generator.html', icon: '🧬' },
    { title: 'Cron Expression Generator', description: 'Build cron schedules with plain-English explanations.', href: '/cron-expression-generator.html', icon: '⏱️' },
    { title: 'DNS Lookup', description: 'Inspect DNS records such as A, AAAA, MX, TXT, NS, CNAME, and more.', href: '/dns-lookup.html', icon: '🌐' },
    { title: 'DNS Propagation Checker', description: 'Compare DNS record propagation across public resolvers and time-based checks.', href: '/dns-propagation-checker.html', icon: '🔎' },
    { title: 'Website SEO Checker', description: 'Audit metadata, heading structure, mobile readiness, and basic SEO signals.', href: '/website-seo-checker.html', icon: '📈' },
    { title: 'PEM to PPK Converter', description: 'Convert OpenSSH PEM keys to PuTTY PPK format.', href: '/pem-to-ppk.html', icon: '🔐' },
    { title: 'PPK to PEM Converter', description: 'Convert PuTTY PPK keys (RSA/ECDSA/Ed25519) to OpenSSH PEM format.', href: '/ppk-to-pem.html', icon: '🔐' },
    { title: 'Favicon Generator', description: 'Create favicon.ico, Apple touch icons, and manifest.', href: '/favicon-generator.html', icon: '🎨' },
    { title: 'SVG Optimizer', description: 'Minify SVG with SVGO and convert to PNG/JPG/WebP.', href: '/svg-optimizer.html', icon: '✨' },
    { title: 'Sitemap Generator', description: 'Build XML sitemaps for SEO and search indexing.', href: '/sitemap-generator.html', icon: '🗺️' },
    { title: 'robots.txt Generator & Tester', description: 'Visually build and test a robots.txt with real matching logic.', href: '/robots-txt-generator.html', icon: '🤖' },
    { title: '.htaccess Generator', description: 'Build Apache redirects, security headers, caching, and CORS visually.', href: '/developer-tools/htaccess-generator.html', icon: '⚙️' },
    { title: 'Shadow Generator', description: 'Create CSS box-shadow snippets with live preview.', href: '/css-tools/shadow-generator.html', icon: '🌑' },
    { title: 'Screen Ruler', description: 'Measure pixels, angles, and areas on screen.', href: '/screen-ruler.html', icon: '📏' },
    { title: 'URL Shortener', description: 'Shorten links with custom aliases and QR export.', href: '/url-shortener.html', icon: '🔗' },
    { title: 'SSL Checker', description: 'Check TLS certificates, expiry dates, and grade.', href: '/ssl-checker.html', icon: '🔒' },
    { title: 'SSH Key Generator', description: 'Generate Ed25519, RSA, or ECDSA SSH key pairs in your browser.', href: '/developer-tools/ssh-key-generator.html', icon: '🔑' },
    { title: 'Password Strength Checker', description: 'Real crack-time estimates via zxcvbn, plus a generator and passphrase tool.', href: '/password-strength-checker.html', icon: '🔐' },
    { title: 'Image Steganography', description: 'Hide a secret text or file inside an image with AES-256 encryption, then extract it back.', href: '/image-steganography.html', icon: '🕵️' },
    { title: 'Epoch / Unix Timestamp Converter', description: 'Auto-detects seconds/ms/µs/ns, converts to any timezone, batch-converts logs.', href: '/epoch-converter.html', icon: '🕐' },
  ],
  games: [
    { title: 'Tic Tac Toe', description: 'Play a polished game with single-player and local modes.', href: '/tic-tac-toe.html', icon: '❌' },
    { title: 'Snake Game', description: 'Enjoy a smooth arcade classic with local high scores.', href: '/snake-game.html', icon: '🐍' },
    { title: 'Sudoku', description: 'Challenge yourself with notes, hints, and a clean layout.', href: '/sudoku-game.html', icon: '🧩' },
    { title: '2048', description: 'Merge tiles and build toward the winning score.', href: '/game-2048.html', icon: '🔢' },
    { title: 'Ludo', description: 'Classic board game with dice, captures, and local multiplayer.', href: '/ludo-game.html', icon: '🎲' },
    { title: 'Minesweeper', description: 'Clear the minefield with logic and careful clicks.', href: '/minesweeper.html', icon: '💣' },
    { title: 'Coin Flip', description: 'Flip a virtual coin for quick random decisions.', href: '/coin-flip.html', icon: '🪙' },
    { title: 'Random Name Picker', description: 'Spin the wheel to pick a random name or winner.', href: '/random-name-picker.html', icon: '🎡' },
  ],
};

const buildRelativeHref = (href) => {
  const cleanHref = href.replace(/^\/+/, '');
  const normalizedPath = window.location.pathname.replace(/\\/g, '/');
  const pathSegments = normalizedPath.split('/').filter(Boolean);
  const toolsIndex = pathSegments.findIndex((segment) => segment.toLowerCase() === 'tools');
  const effectiveSegments = toolsIndex >= 0 ? pathSegments.slice(toolsIndex + 1) : pathSegments;
  const fileName = effectiveSegments[effectiveSegments.length - 1] || '';
  const directorySegments = fileName.includes('.') ? effectiveSegments.slice(0, -1) : effectiveSegments;
  const depth = directorySegments.length;
  return `${'../'.repeat(depth)}${cleanHref}`;
};

const getRelatedToolItems = () => {
  const path = window.location.pathname.toLowerCase();

  if (path.includes('/calculators/') || path.includes('age-calculator') || path.includes('emi-calculator') || path.includes('bmi-calculator') || path.includes('gst-calculator') || path.includes('loan-calculator') || path.includes('manual-tax-calculator') || path.includes('percentage-calculator') || path.includes('sip-calculator') || path.includes('ppf-calculator') || path.includes('rd-calculator') || path.includes('fd-calculator') || path.includes('gpa-cgpa') || path.includes('land-area-converter') || path.includes('scientific-calculator')) {
    return relatedToolCollections.calculators;
  }

  if (path.includes('/developer-tools/') || path.includes('jwt-') || path.includes('json-to-') || path.includes('json-to-csv') || path.includes('csv-to-json') || path.includes('xml-to-json') || path.includes('markdown-to-html') || path.includes('uuid-generator') || path.includes('cron-expression') || path.includes('dns-lookup') || path.includes('dns-propagation-checker') || path.includes('website-seo-checker') || path.includes('pem-to-ppk') || path.includes('ppk-to-pem') || path.includes('favicon-generator') || path.includes('svg-optimizer') || path.includes('sitemap-generator') || path.includes('robots-txt-generator') || path.includes('/css-tools/') || path.includes('css-to-tailwind') || path.includes('screen-ruler') || path.includes('password-strength-checker') || path.includes('image-steganography') || path.includes('epoch-converter') || path.includes('ip-subnet-calculator')) {
    return relatedToolCollections.developer;
  }

  if (path.includes('/image') || path.includes('image-') || path.includes('exif-metadata-remover') || path.includes('jpg-to-png') || path.includes('png-to-webp') || path.includes('heic-converter') || path.includes('image-compressor') || path.includes('image-crop') || path.includes('image-resizer') || path.includes('image-rotate') || path.includes('image-blur') || path.includes('image-grayscale') || path.includes('image-color-picker') || path.includes('image-background-remover') || path.includes('passport-photo-maker') || path.includes('signature-resizer') || path.includes('poster-printer') || path.includes('image-compress-to-kb') || path.includes('qr-code') || path.includes('custom-qr-code') || path.includes('barcode-generator')) {
    return relatedToolCollections.images;
  }

  if (path.includes('/pdf') || path.includes('pdf-') || path.includes('pdf.html') || path.includes('salary-slip-generator') || path.includes('paper-generator') || path.includes('bingo-card-generator') || path.includes('omr-sheet-generator') || path.includes('exam-seating-planner') || path.includes('html-to-pdf') || path.includes('images-to-pdf') || path.includes('worksheet-generator') || path.includes('rent-receipt-generator') || path.includes('compare-pdfs') || path.includes('flatten-pdf') || path.includes('redact-pdf')) {
    return relatedToolCollections.pdf;
  }

  if (path.includes('/text-tools/') || path.includes('base64') || path.includes('case-converter') || path.includes('fancy-font-generator') || path.includes('text-to-handwriting') || path.includes('emoji-kaomoji-picker') || path.includes('typing-speed-test') || path.includes('online-notepad') || path.includes('whatsapp-chat-analyzer')) {
    return relatedToolCollections.text;
  }

  if (path.includes('game') || path.includes('tic-tac') || path.includes('snake') || path.includes('sudoku') || path.includes('ludo') || path.includes('minesweeper') || path.includes('coin-flip') || path.includes('random-name-picker')) {
    return relatedToolCollections.games;
  }

  if (path.includes('url-shortener') || path.includes('utm-builder') || path.includes('ssl-checker') || path.includes('internet-speed-test') || path.includes('unit-converter') || path.includes('online-teleprompter') || path.includes('password-generator') || path.includes('resume-builder') || path.includes('ats-resume-checker')) {
    return relatedToolCollections.general;
  }

  return relatedToolCollections.general;
};

const isHomePage = () => {
  const path = window.location.pathname.toLowerCase();
  return path === '/' || path.endsWith('/index.html') || path.endsWith('/index');
};

const makeToolCardsClickable = () => {
  document.querySelectorAll('.tool-card').forEach((card) => {
    const actionLink = card.querySelector('.card-actions a.primary-btn');
    if (!actionLink) {
      return;
    }

    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'link');

    const openCardLink = () => {
      window.location.assign(actionLink.href);
    };

    card.addEventListener('click', (event) => {
      if (event.target.closest('a, button, input, select, textarea, summary')) {
        return;
      }
      openCardLink();
    });

    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCardLink();
      }
    });
  });
};

const injectRelatedTools = () => {
  if (isHomePage()) {
    document.querySelectorAll('.related-tools-section, .related-tools-block, [aria-label="Related tools"]').forEach((block) => block.remove());
    return;
  }

  if (document.querySelector('[data-static-related]')) {
    return;
  }

  const existingBlocks = Array.from(document.querySelectorAll('.related-tools-block, .related-tools-section, [aria-label="Related tools"]'));
  const existingBlock = existingBlocks.find((block) => block.classList.contains('related-tools-section'));
  const items = getRelatedToolItems();
  const contentMarkup = `
    <div class="related-tools-section__header">
      <div>
        <p class="related-tools-eyebrow">Explore more</p>
        <h2 class="related-tools-title">Related Tools</h2>
      </div>
    </div>
    <div class="related-tools-grid">
      ${items.map((tool) => `
        <a class="related-tool-card" href="${buildRelativeHref(tool.href)}">
          <span class="related-tool-icon" aria-hidden="true">${tool.icon}</span>
          <span class="related-tool-body">
            <strong>${tool.title}</strong>
            <span>${tool.description}</span>
          </span>
        </a>
      `).join('')}
    </div>
  `;

  if (existingBlock) {
    existingBlock.className = 'related-tools-section';
    existingBlock.innerHTML = contentMarkup;
    existingBlocks.filter((block) => block !== existingBlock).forEach((block) => block.remove());
    return;
  }

  existingBlocks.forEach((block) => block.remove());

  const mainContent = document.querySelector('main');
  if (!mainContent) {
    return;
  }

  const section = document.createElement('section');
  section.className = 'related-tools-section';
  section.setAttribute('aria-labelledby', 'related-tools-title');
  section.innerHTML = `<div class="container">${contentMarkup}</div>`;

  mainContent.appendChild(section);
};

makeToolCardsClickable();

const injectFooterSocialLinks = () => {
  document.querySelectorAll('.site-footer').forEach((footer) => {
    if (footer.querySelector('.footer-social')) {
      return;
    }

    const socialBlock = document.createElement('div');
    socialBlock.className = 'footer-social';
    socialBlock.innerHTML = `
      <h3>Connect</h3>
      <div class="social-links">
        <a class="social-link" href="mailto:contact@tooladda.online" aria-label="Email ToolAdda">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm0 2v.5l8 5 8-5V8H4z"/></svg>
          <span>Email</span>
        </a>
        <a class="social-link" href="https://www.linkedin.com/company/tooladda" target="_blank" rel="noopener noreferrer" aria-label="Subhash Yadav, founder of ToolAdda, on LinkedIn">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.94 8.5A1.56 1.56 0 1 1 6.94 5.37a1.56 1.56 0 0 1 0 3.13zM5.5 9.74h2.88V18H5.5zM10.18 9.74h2.76v1.12h.04c.38-.72 1.32-1.48 2.72-1.48 2.91 0 3.45 1.91 3.45 4.4V18h-2.88v-7.56c0-1.8-.03-4.12-2.51-4.12-2.51 0-2.9 1.96-2.9 3.98V18h-2.88z"/></svg>
          <span>LinkedIn</span>
        </a>
        <a class="social-link" href="https://github.com/tooladda-online" target="_blank" rel="noopener noreferrer" aria-label="Subhash Yadav, founder of ToolAdda, on GitHub">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.8 23.1c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.3-1.8-1.3-1.8-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1 1.8.6 2.2 1.2.1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.4 1.2a11.7 11.7 0 0 1 6.2 0c2.4-1.5 3.4-1.2 3.4-1.2.6 1.7.2 3 .1 3.3.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.3.8 1 .8 2v3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z"/></svg>
          <span>GitHub</span>
        </a>
      </div>
    `;

    const column = footer.querySelector('.footer-grid > div:nth-child(2)');
    if (column) {
      column.appendChild(socialBlock);
    } else {
      footer.querySelector('.container')?.appendChild(socialBlock);
    }
  });
};

const markBadgeCloneInert = (node) => {
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('tabindex', '-1');
  node.querySelectorAll('a, img').forEach((el) => {
    el.setAttribute('tabindex', '-1');
    if (el.tagName === 'IMG') el.setAttribute('alt', '');
  });
};

const fillFooterBadgeTrack = (root) => {
  const track = root.querySelector('[data-badge-track]');
  const viewport = root.querySelector('[data-badge-viewport]');
  if (!track || !viewport) return;

  const seeds = Array.from(track.querySelectorAll(':scope > .footer-badge'));
  if (!seeds.length) return;

  const minWidth = Math.max(viewport.clientWidth, 360);
  let safety = 0;
  while (track.scrollWidth < minWidth && safety < 20) {
    seeds.forEach((badge) => {
      const clone = badge.cloneNode(true);
      markBadgeCloneInert(clone);
      track.appendChild(clone);
    });
    safety += 1;
  }

  Array.from(track.children).forEach((node) => {
    const clone = node.cloneNode(true);
    markBadgeCloneInert(clone);
    track.appendChild(clone);
  });

  const cycleWidth = track.scrollWidth / 2;
  const pxPerSecond = 42;
  track.style.animationDuration = `${Math.max(18, cycleWidth / pxPerSecond)}s`;
};

const initFooterBadgeMarquee = () => {
  const marquees = document.querySelectorAll('[data-badge-marquee]');
  if (!marquees.length) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  marquees.forEach((root) => {
    if (root.dataset.ready === 'true') return;
    root.dataset.ready = 'true';

    if (reducedMotion) return;

    const start = () => {
      const images = Array.from(root.querySelectorAll('img'));
      const pending = images
        .filter((img) => !img.complete)
        .map((img) => new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }));

      const run = () => fillFooterBadgeTrack(root);
      if (!pending.length) {
        run();
        return;
      }

      Promise.race([
        Promise.all(pending),
        new Promise((resolve) => window.setTimeout(resolve, 1200)),
      ]).then(run);
    };

    /* Filling the track is what fetches the badges. The clones carry the same
       loading="lazy" as the originals, but Chrome fetches script-inserted images
       immediately, so building the track on load dragged all 18 badge images —
       17 third-party hosts — into the initial page load no matter what the
       attribute said. Held until the footer is close, the originals' lazy
       attribute decides when they load and the clones follow. */
    if (!('IntersectionObserver' in window)) {
      start();
      return;
    }

    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      io.disconnect();
      start();
    }, { rootMargin: '400px 0px' });
    io.observe(root);
  });
};

/* The banner used to appear the instant the page painted, so the first thing a
   visitor met was a consent box rather than the page they came for. It waits now
   until they have scrolled into the page, or — on pages short enough that there is
   nothing to scroll — a few seconds in. Nothing is lost by waiting: the Consent
   Mode defaults in every page's <head> keep ad storage denied until Accept is
   clicked, so no cookie is written any earlier than it was before. */
const deferConsentBanner = () => {
  const SCROLL_TRIGGER = 300;
  const FALLBACK_DELAY = 7000;
  let shown = false;

  const reveal = () => {
    if (shown) return;
    shown = true;
    window.removeEventListener('scroll', onScroll);
    clearTimeout(timer);
    showConsentBanner();

    /* The back-to-top button offsets itself by whatever fixed bar sits at the
       bottom, measured from the live layout. It samples that on scroll and
       resize, and a banner that appears on a timer is neither. */
    window.dispatchEvent(new Event('resize'));
  };

  const onScroll = () => {
    if ((window.scrollY || document.documentElement.scrollTop || 0) > SCROLL_TRIGGER) reveal();
  };

  const timer = setTimeout(reveal, FALLBACK_DELAY);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
};

const initializeConsent = () => {
  injectSeoEnhancements();
  injectRelatedTools();
  injectFooterSocialLinks();
  initializeAnalytics();

  if (getConsentPreference()) {
    return;
  }

  deferConsentBanner();
};

const root = document.documentElement;
const themeToggle = document.querySelector('[data-theme-toggle]');
const mobileToggle = document.querySelector('[data-mobile-toggle]');
const navbar = document.querySelector('.navbar');
const searchInput = document.querySelector('[data-search-input]');
const resetButton = document.querySelector('[data-reset-search]');
const copyButton = document.querySelector('[data-copy-link]');
const cards = isHomePage()
  ? Array.from(document.querySelectorAll('[data-tool-grid] .tool-card'))
  : Array.from(document.querySelectorAll('.tool-card'));

const savedTheme = safeStorage.get('tooladda-theme');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const activeTheme = savedTheme || systemTheme;

if (themeToggle) {
  themeToggle.setAttribute('aria-pressed', activeTheme === 'dark');
  themeToggle.innerHTML = activeTheme === 'dark' ? '☀️' : '🌙';
}

if (activeTheme === 'dark') {
  root.setAttribute('data-theme', 'dark');
} else {
  root.removeAttribute('data-theme');
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isDark = root.getAttribute('data-theme') === 'dark';
    const nextTheme = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', nextTheme);
    safeStorage.set('tooladda-theme', nextTheme);
    themeToggle.setAttribute('aria-pressed', nextTheme === 'dark');
    themeToggle.innerHTML = nextTheme === 'dark' ? '☀️' : '🌙';
    /* Page palettes are redeclared per theme, so the values copied onto the
       banner when it appeared are now the wrong theme's. */
    syncConsentAccent();
  });
}

if (mobileToggle) {
  mobileToggle.addEventListener('click', () => {
    navbar.classList.toggle('nav-open');
    const expanded = navbar.classList.contains('nav-open');
    mobileToggle.setAttribute('aria-expanded', String(expanded));
  });
}

const siteHeader = document.querySelector('.site-header');
const syncHeaderOverlap = () => {
  if (!siteHeader) return;
  const height = siteHeader.offsetHeight;
  if (height > 0) {
    document.documentElement.style.setProperty('--header-overlap', `${height}px`);
  }
};

if (siteHeader) {
  const syncHeaderScroll = () => {
    siteHeader.classList.toggle('site-header--scrolled', window.scrollY > 16);
  };
  window.addEventListener('scroll', syncHeaderScroll, { passive: true });
  window.addEventListener('resize', syncHeaderOverlap, { passive: true });
  window.addEventListener('orientationchange', syncHeaderOverlap, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const headerObserver = new ResizeObserver(syncHeaderOverlap);
    headerObserver.observe(siteHeader);
  }
  syncHeaderScroll();
  syncHeaderOverlap();
  window.requestAnimationFrame(syncHeaderOverlap);
}

const markActiveNavLink = () => {
  const path = window.location.pathname.toLowerCase();
  const file = path.split('/').pop() || 'index.html';
  const isHomePath = !file || file === 'index.html';

  document.querySelectorAll('.nav-links a').forEach((link) => {
    const href = (link.getAttribute('href') || '').split('#')[0];
    const linkFile = href.split('/').pop() || '';
    const isHomeLink = linkFile === 'index.html' || href === '/' || href === './';
    const isActive = (isHomePath && isHomeLink) || (linkFile && file === linkFile);
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
};
markActiveNavLink();

document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => {
    if (navbar) navbar.classList.remove('nav-open');
    if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'false');
  });
});

document.addEventListener('click', (event) => {
  if (!navbar?.classList.contains('nav-open')) return;
  if (event.target.closest('.navbar')) return;
  navbar.classList.remove('nav-open');
  if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'false');
});

if (searchInput && !isHomePage()) {
  searchInput.addEventListener('input', (event) => {
    const query = event.target.value.toLowerCase().trim();
    cards.forEach((card) => {
      const searchable = card.dataset.search || card.textContent.toLowerCase();
      const match = searchable.includes(query);
      card.classList.toggle('hidden', !match);
    });
  });
}

if (resetButton && searchInput && !isHomePage()) {
  resetButton.addEventListener('click', () => {
    searchInput.value = '';
    cards.forEach((card) => card.classList.remove('hidden'));
    searchInput.focus();
  });
}

if (copyButton) {
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      const originalLabel = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      window.setTimeout(() => {
        copyButton.textContent = originalLabel;
      }, 1400);
    } catch (error) {
      copyButton.textContent = 'Copy failed';
    }
  });
}

Array.from(document.querySelectorAll('[data-share]')).forEach((button) => {
  button.addEventListener('click', async () => {
    const title = document.title;
    const text = button.dataset.shareText || 'Check this tool on ToolAdda';
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, text, url });
    } else {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Link copied';
    }
  });
});

// FAQ accordion: let native <details> handle open/close; on open, collapse the others.
document.querySelectorAll('.faq-item').forEach((item) => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    document.querySelectorAll('.faq-item[open]').forEach((other) => {
      if (other !== item) other.open = false;
    });
  });
});

initializeConsent();

initFooterBadgeMarquee();

const year = document.querySelector('[data-year]');
if (year) {
  year.textContent = new Date().getFullYear();
}

document.querySelectorAll('[data-copy-page-link]').forEach((button) => {
  const originalLabel = button.textContent;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch (error) {
      const temp = document.createElement('textarea');
      temp.value = window.location.href;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.left = '-9999px';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    button.classList.add('is-copied');
    button.textContent = '✓';
    window.setTimeout(() => {
      button.classList.remove('is-copied');
      button.textContent = originalLabel;
    }, 1500);
  });
});

let TOOLADDA_TOOLS = window.TOOLADDA_TOOLS || null;
let toolsCatalogPromise = null;
function ensureToolCatalog() {
  if (TOOLADDA_TOOLS && TOOLADDA_TOOLS.length) return Promise.resolve(TOOLADDA_TOOLS);
  if (!toolsCatalogPromise) {
    toolsCatalogPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = (document.currentScript && document.currentScript.src)
        ? document.currentScript.src.replace(/app\.js(?:\?.*)?$/, 'tools-catalog.js')
        : 'assets/js/tools-catalog.js';
      // Prefer relative to app.js when possible
      const appScript = document.querySelector('script[src*="app.js"]');
      if (appScript) {
        s.src = appScript.getAttribute('src').replace(/app\.js(?:\?.*)?$/, 'tools-catalog.js');
      }
      s.async = true;
      s.onload = () => {
        TOOLADDA_TOOLS = window.TOOLADDA_TOOLS || [];
        resolve(TOOLADDA_TOOLS);
      };
      s.onerror = () => reject(new Error('Tool catalog failed to load'));
      document.head.appendChild(s);
    });
  }
  return toolsCatalogPromise;
}


/* True when `tok` begins a word in `hay`, so "compres" hits "Compressor" but
   "ress" does not. Word-start matches are what people mean when they type half
   a word, and ranking them above mid-word hits keeps the obvious tool on top. */
const startsToolWord = (hay, tok) => {
  let i = hay.indexOf(tok);
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(hay.charAt(i - 1))) return true;
    i = hay.indexOf(tok, i + 1);
  }
  return false;
};

/* Scored on tokens rather than one `includes(q)` of the whole string, because
   the old version made word order significant: "pdf merge" found the tool and
   "merge pdf" found nothing at all, as did "convert heic" and "decode jwt".
   Every token must land somewhere (AND); where it lands sets the rank. */
const scoreToolSearch = (tool, q) => {
  if (!q) return 0;
  const query = q.trim().toLowerCase();
  if (!query) return 0;
  const title = tool.t.toLowerCase();
  const hay = (tool.t + ' ' + tool.g + ' ' + tool.k).toLowerCase();

  let score = 0;
  if (title === query) score += 1000;
  else if (title.startsWith(query)) score += 400;
  else if (title.indexOf(query) !== -1) score += 220;
  else if (hay.indexOf(query) !== -1) score += 60;

  const tokens = query.split(/[^a-z0-9+#.]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    let s = 0;
    if (startsToolWord(title, tok)) s = 100;
    else if (title.indexOf(tok) !== -1) s = 55;
    else if (startsToolWord(hay, tok)) s = 24;
    else if (hay.indexOf(tok) !== -1) s = 10;
    if (!s) return 0;
    score += s;
  }
  // A tie goes to the shorter, more specific title.
  score += Math.max(0, 40 - title.length) / 20;
  return score;
};

const setupToolSearchDropdown = ({ wrap, input, results, maxResults = 8 }) => {
  let activeIndex = -1;
  let matches = [];

  /* ---------------------------------------------------------------
     Keep the dropdown inside the *visible* viewport.

     A phone's on-screen keyboard covers the bottom of the screen but
     does not shrink the layout viewport, so a vh-based max-height still
     measures the whole screen and the results end up underneath the
     keyboard. visualViewport reports the region that is actually on
     screen, so the list is capped to the room below the input — and
     flipped above it when there is more space up there.
     --------------------------------------------------------------- */
  const DROP_MIN = 132;
  const DROP_GAP = 12;
  let viewportBound = false;

  const fitDropdown = () => {
    if (results.hidden) return;
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const anchor = (wrap || input).getBoundingClientRect();

    const below = viewBottom - anchor.bottom - DROP_GAP;
    const above = anchor.top - viewTop - DROP_GAP;
    const flip = below < DROP_MIN && above > below;

    results.dataset.placement = flip ? 'top' : 'bottom';
    results.style.maxHeight = Math.max(DROP_MIN, Math.floor(flip ? above : below)) + 'px';
  };

  const bindViewport = () => {
    if (viewportBound) return;
    viewportBound = true;
    window.addEventListener('resize', fitDropdown);
    window.addEventListener('scroll', fitDropdown, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitDropdown);
      window.visualViewport.addEventListener('scroll', fitDropdown);
    }
  };

  const unbindViewport = () => {
    if (!viewportBound) return;
    viewportBound = false;
    window.removeEventListener('resize', fitDropdown);
    window.removeEventListener('scroll', fitDropdown);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', fitDropdown);
      window.visualViewport.removeEventListener('scroll', fitDropdown);
    }
  };

  const open = () => {
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    bindViewport();
    fitDropdown();
  };

  const render = () => {
    if (!matches.length) {
      results.innerHTML = '<div class="nav-search-empty">No tools found</div>';
      open();
      return;
    }
    results.innerHTML = matches.map((tool, idx) => `
      <a class="nav-search-item${idx === activeIndex ? ' active' : ''}" role="option" href="${buildRelativeHref(tool.h)}" data-idx="${idx}">
        <span class="nav-search-item-icon" aria-hidden="true">${tool.i}</span>
        <span class="nav-search-item-body">
          <span class="nav-search-item-title">${tool.t}</span>
          ${tool.g ? `<span class="nav-search-item-tag">${tool.g}</span>` : ''}
        </span>
      </a>
    `).join('');
    open();
  };

  const close = () => {
    results.hidden = true;
    results.innerHTML = '';
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    unbindViewport();
    results.style.maxHeight = '';
    delete results.dataset.placement;
  };

  const runSearch = () => {
    const q = input.value.toLowerCase().trim();
    if (!q) {
      close();
      return;
    }
    ensureToolCatalog().then((tools) => {
      if (input.value.toLowerCase().trim() !== q) return;
      matches = tools
        .map((tool) => ({ tool, s: scoreToolSearch(tool, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.tool.t.localeCompare(b.tool.t))
        .slice(0, maxResults)
        .map((x) => x.tool);
      activeIndex = -1;
      render();
    }).catch(() => {
      results.innerHTML = '<div class="nav-search-empty">Search unavailable</div>';
      open();
    });
  };

  const go = (idx) => {
    const tool = matches[idx];
    if (tool) window.location.assign(buildRelativeHref(tool.h));
  };

  input.addEventListener('input', runSearch);
  input.addEventListener('focus', () => {
    if (input.value.trim()) runSearch();
  });

  input.addEventListener('keydown', (event) => {
    if (results.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, matches.length - 1);
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      render();
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0) {
        event.preventDefault();
        go(activeIndex);
      } else if (matches.length) {
        event.preventDefault();
        go(0);
      }
    } else if (event.key === 'Escape') {
      close();
      input.blur();
    }
  });

  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target)) close();
  });

  return { close, runSearch, getMatches: () => matches };
};

/* =============================================================
   Navbar enhancements (brand, icons, CTA)
   ============================================================= */
(function initNavbarEnhancements() {
  const navbar = document.querySelector('.site-header .navbar');
  if (!navbar) return;

  const brand = navbar.querySelector('.brand');
  if (brand && !brand.querySelector('.brand-text')) {
    const nameSpan = brand.querySelector('span:not(.brand-mark)');
    if (nameSpan) {
      const wrap = document.createElement('span');
      wrap.className = 'brand-text';
      const name = document.createElement('span');
      name.className = 'brand-name';
      name.textContent = nameSpan.textContent.trim() || 'ToolAdda';
      const tag = document.createElement('small');
      tag.className = 'brand-tagline';
      tag.textContent = '158 free tools';
      wrap.append(name, tag);
      nameSpan.replaceWith(wrap);
    }
  }

  const navIconMap = {
    'index.html': '🏠',
    'about.html': '💡',
    'contact.html': '✉️',
    'privacy-policy.html': '🔒',
    'terms.html': '📜'
  };
  navbar.querySelectorAll('.nav-links a').forEach((link) => {
    if (link.querySelector('.nav-link-icon')) return;
    const file = (link.getAttribute('href') || '').split('#')[0].split('/').pop() || 'index.html';
    const icon = document.createElement('span');
    icon.className = 'nav-link-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = navIconMap[file] || '•';
    link.prepend(icon);
  });

  const actions = navbar.querySelector('.nav-actions');
  if (actions && !actions.querySelector('.nav-tools-cta')) {
    const cta = document.createElement('a');
    cta.className = 'primary-btn nav-tools-cta';
    cta.textContent = 'Browse tools';
    // '/' rather than index.html: every static link on the site points at the
    // root now, and this was the last thing still generating an /index.html URL.
    cta.href = isHomePage() ? '#search-tools' : '/#search-tools';
    actions.insertBefore(cta, actions.firstChild);
  }
  syncHeaderOverlap();
})();

/* =============================================================
   Global navbar tool search (all pages except home)
   ============================================================= */
(function initGlobalToolSearch() {
  if (isHomePage()) return;

  const boot = () => {
  const navbar = document.querySelector('.site-header .navbar');
  if (!navbar || navbar.querySelector('.nav-search')) {
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'nav-search';
  wrap.innerHTML = `
    <div class="nav-search-panel" id="nav-search-panel">
      <div class="nav-search-box">
        <span class="nav-search-icon" aria-hidden="true">🔎</span>
        <input type="search" class="nav-search-input" placeholder="Search tools… EMI, JWT, PDF" aria-label="Search all tools" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="nav-search-results" />
        <kbd class="nav-search-kbd">/</kbd>
      </div>
      <div class="nav-search-results" id="nav-search-results" role="listbox" hidden></div>
    </div>
  `;

  const actions = navbar.querySelector('.nav-actions');
  navbar.insertBefore(wrap, actions || null);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-btn nav-search-toggle';
  toggle.setAttribute('aria-label', 'Search tools');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'nav-search-panel');
  toggle.innerHTML = '🔎';
  if (actions) {
    actions.insertBefore(toggle, actions.querySelector('[data-theme-toggle]') || actions.firstChild);
  }

  const input = wrap.querySelector('.nav-search-input');
  const results = wrap.querySelector('.nav-search-results');
  const dropdown = setupToolSearchDropdown({ wrap, input, results });

  const openSearch = () => {
    ensureToolCatalog().catch(() => {});
    navbar.classList.add('nav-search-open');
    toggle.setAttribute('aria-expanded', 'true');
    input.focus();
    syncHeaderOverlap();
    window.requestAnimationFrame(syncHeaderOverlap);
  };

  const closeSearch = () => {
    navbar.classList.remove('nav-search-open');
    toggle.setAttribute('aria-expanded', 'false');
    dropdown.close();
    syncHeaderOverlap();
  };

  toggle.addEventListener('click', () => {
    if (navbar.classList.contains('nav-search-open')) {
      closeSearch();
    } else {
      navbar.classList.remove('nav-open');
      if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'false');
      openSearch();
    }
  });

  document.addEventListener('click', (event) => {
    if (!navbar.classList.contains('nav-search-open')) return;
    if (event.target.closest('.nav-search') || event.target.closest('.nav-search-toggle')) return;
    closeSearch();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/') return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    openSearch();
    input.select();
  });

  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      if (navbar.classList.contains('nav-open')) closeSearch();
    });
  }

  syncHeaderOverlap();
  window.requestAnimationFrame(syncHeaderOverlap);
  };

  if (document.body && document.body.hasAttribute('data-defer-nav-search')) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(boot, { timeout: 2500 });
    else window.setTimeout(boot, 1);
  } else {
    boot();
  }
})();

/* =============================================================
   Home hero tool search (navbar search logic on home page)
   ============================================================= */
(function initHomeHeroToolSearch() {
  if (!isHomePage()) return;

  const form = document.querySelector('[data-hero-search]');
  const input = document.querySelector('[data-hero-search-input]');
  const wrap = document.querySelector('[data-hero-search-wrap]');
  const results = document.querySelector('[data-hero-search-results]');
  if (!form || !input || !wrap || !results) return;

  if (!input.hasAttribute('role')) {
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'hero-search-results');
  }

  const dropdown = setupToolSearchDropdown({ wrap, input, results });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    const gridSearch = document.querySelector('[data-search-input]');
    if (gridSearch) {
      gridSearch.value = query;
      document.getElementById('search-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      gridSearch.focus();
      gridSearch.dispatchEvent(new Event('input', { bubbles: true }));
    }
    dropdown.close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/') return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    input.focus();
    input.select();
  });

  /* A visitor who lands here wants a tool, not a homepage, so on desktop the
     cursor is already in the box and the first keystroke is a search.

     Never on touch: focusing an input there raises the on-screen keyboard, which
     covers half the viewport before the visitor has read a single word — the
     opposite of helpful on the page they are deciding whether to stay on.
     `pointer: fine` is the test rather than a width, because what matters is
     whether a physical keyboard is attached, not how wide the screen is. */
  const wantsAutofocus = () => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false;

    /* Someone who arrived at #search-tools, or came back to a restored scroll
       position, already has a place on the page they meant to be. Pulling focus
       up to the hero would take it away from them. */
    if (window.location.hash) return false;
    if (window.scrollY || document.documentElement.scrollTop) return false;

    return true;
  };

  if (wantsAutofocus()) {
    // preventScroll so a late scroll restoration cannot get yanked to the top.
    input.focus({ preventScroll: true });
  }
})();

/* ── Back to top ──────────────────────────────────────────────────────────
   Injected here rather than written into 146 pages: it is chrome, like the
   navbar search, and every page gets it from one implementation.

   Two things it has to get right. First, 22 pages carry a fixed "Convert"
   bar pinned to the bottom of the viewport, so a button parked at bottom:1rem
   would sit on top of the page's primary action on exactly the pages where
   that action matters most — the offset is measured at runtime instead of
   guessed. Second, scrolling to the top moves the viewport but not the
   keyboard focus, which leaves a keyboard or screen-reader user still parked
   at the bottom of the document; focus is moved to the top landmark to match. */
const initBackToTop = () => {
  if (document.querySelector('.to-top')) return;

  const SHOW_AFTER = 600;      // px scrolled before it appears
  const MIN_SCROLLABLE = 1200; // don't bother on pages that barely scroll
  const BASE_GAP = 16;         // px from the bottom edge when nothing is in the way

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'to-top';
  button.setAttribute('aria-label', 'Back to top');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.6l7.1 7.1-1.4 1.4L13 8.4V20h-2V8.4l-4.7 4.7-1.4-1.4z"/></svg>';
  document.body.appendChild(button);

  /* How much of the bottom edge is already spoken for. Every fixed bar on the
     site is named *sticky*, and the consent banner is checked by name — both
     are read from the live layout rather than a hardcoded list of heights, so
     a page that hides its bar on desktop gets the button back at the bottom. */
  const bottomObstruction = () => {
    let tallest = 0;
    document.querySelectorAll('[class*="sticky"], .consent-banner').forEach((element) => {
      const styles = window.getComputedStyle(element);
      if (styles.position !== 'fixed' || styles.display === 'none' || styles.visibility === 'hidden') {
        return;
      }
      const rect = element.getBoundingClientRect();
      // Only bars actually pinned to the bottom, not a fixed header.
      if (!rect.height || rect.bottom < window.innerHeight - 8) return;
      tallest = Math.max(tallest, window.innerHeight - rect.top);
    });
    return tallest;
  };

  let queued = false;
  const update = () => {
    queued = false;
    const scrolled = window.scrollY || document.documentElement.scrollTop;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;

    if (scrollable < MIN_SCROLLABLE) {
      button.classList.remove('is-visible');
      return;
    }

    const visible = scrolled > SHOW_AFTER;
    button.classList.toggle('is-visible', visible);
    if (!visible) return;

    button.style.setProperty('--to-top-progress', Math.min(100, Math.round((scrolled / scrollable) * 100)));

    const obstruction = bottomObstruction();
    button.style.bottom = `calc(${BASE_GAP + obstruction}px + env(safe-area-inset-bottom, 0px))`;
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  button.addEventListener('click', () => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });

    /* Scrolling alone leaves focus wherever it was, so the next Tab continues
       from the bottom of the page. Handing focus to the top landmark keeps the
       keyboard in step with what the visitor can now see. tabindex is removed
       again on blur so the landmark stays out of the tab order. */
    const target = document.getElementById('main-content') || document.querySelector('h1') || document.body;
    if (target && target !== document.body) {
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
  });

  update();
};

initBackToTop();
