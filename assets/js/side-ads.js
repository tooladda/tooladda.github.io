/* Adsterra side banners — sirf desktop, content ke left aur right gutter me.
   Left = 160x300 unit, right = 160x600 unit.

   - Content ki chaudai andaze se nahi maante: header aur <main> ke andar ke elements
     (3 level tak) naap ke dekhte hain content asal me kahan se kahan tak hai. Jo
     element poori screen jitna chauda hai (full-bleed background) wo gina nahi jata,
     uske andar ka container gina jata hai. Absolute/fixed elements (background orb,
     popup) bhi nahi gine jaate.
   - Dono taraf ka gutter banner (160px) + thoda gap se chhota ho to script kuch load
     nahi karta (hidden ad par impression na gire). Load hone ke baad screen chhoti ho
     jaye to banner chhup jata hai.
   - Banner apne gutter ke beech me baithta hai.
   - Har banner apne iframe (srcdoc) me chalta hai: Adsterra ka invoke.js page load ke
     baad document.write se nahi chal sakta, aur dono units ke atOptions alag rehte hain.
   - Styling isi file me hai, style.css me nahi: kuch pages ke service worker style.css
     ki purani copy pehle serve karte hain, tab banner bina style ke footer ke neeche
     poori width me aa jata.
   - Footer dikhne par banners fade ho jate hain taaki footer ke upar na aayein. */
(function () {
  var UNITS = [
    { side: 'left', key: 'e6a4e4f82b20b3d686d37e3442af9f2c', w: 160, h: 300 },
    { side: 'right', key: 'a3c2eaa28318cb4a6a56481e6d141ccd', w: 160, h: 600 }
  ];
  var BANNER = 160;
  var MIN_GUTTER = BANNER + 16; // banner + dono taraf kam se kam 8px
  var CSS =
    '.side-ad-rail{display:block;position:fixed;z-index:5;top:110px;width:160px;margin:0;padding:0;transition:opacity .2s ease}' +
    '.side-ad-rail[hidden]{display:none}' +
    '.side-ad-rail.is-off{opacity:0;pointer-events:none}' +
    '.side-ad-rail iframe{display:block;border:0}' +
    '@media print{.side-ad-rail{display:none!important}}';
  var rails = [];
  var loaded = false;

  // Chrome khali frame ko safed paint karta hai, chahe uska document transparent ho.
  // Dark theme me wo safed slab bhura lagta hai, isliye frame ka apna background
  // page ke theme se mila dete hain. Ad load hote hi uska apna creative dikhta hai.
  function frameBg() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? '#111a2e' : '#ffffff';
  }

  function frame(u) {
    var f = document.createElement('iframe');
    f.title = 'Advertisement';
    f.width = String(u.w);
    f.height = String(u.h);
    f.setAttribute('scrolling', 'no');
    f.srcdoc = '<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:' + frameBg() + '}</style></head><body>' +
      '<script>atOptions={key:"' + u.key + '",format:"iframe",height:' + u.h + ',width:' + u.w + ',params:{}};<\/script>' +
      '<script src="https://www.highrevenueformat.com/' + u.key + '/invoke.js"><\/script>' +
      '</body></html>';
    return f;
  }

  // Content ka left aur right kinara (px, viewport ke hisaab se), ya null.
  function contentEdges(vw) {
    var els = document.querySelectorAll(
      '.site-header > *, .site-header > * > *,' +
      'main > *, main > * > *, main > * > * > *');
    var left = Infinity, right = -Infinity;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width <= 1 || r.width >= vw - 1) continue; // chhupa/sr-only ya full-bleed
      if (r.right <= 0 || r.left >= vw) continue; // screen ke bahar rakha hua
      var pos = getComputedStyle(els[i]).position;
      if (pos === 'absolute' || pos === 'fixed') continue; // decoration (orb/glow) ya popup
      if (els[i].closest('[aria-hidden="true"]')) continue; // sajawat, jaise home ki marquee patti
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
    }
    return right > left ? { left: left, right: right } : null;
  }

  function load() {
    loaded = true;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    UNITS.forEach(function (u) {
      var rail = document.createElement('aside');
      rail.className = 'side-ad-rail side-ad-rail--' + u.side;
      rail.setAttribute('aria-label', 'Advertisement');
      rail.style.height = u.h + 'px';
      rail.appendChild(frame(u));
      document.body.appendChild(rail);
      rails.push(rail);
    });
    var footer = document.querySelector('.site-footer, footer');
    if (footer && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        var hide = entries[0].isIntersecting;
        rails.forEach(function (r) { r.classList.toggle('is-off', hide); });
      }).observe(footer);
    }
  }

  function update() {
    var vw = document.documentElement.clientWidth; // scrollbar ke bina
    var edges = contentEdges(vw);
    var leftGap = edges ? edges.left : 0;
    var rightGap = edges ? vw - edges.right : 0;
    var fits = Math.min(leftGap, rightGap) >= MIN_GUTTER;
    if (!loaded) {
      if (!fits) return;
      load();
    }
    rails.forEach(function (r, i) {
      r.hidden = !fits;
      if (!fits) return;
      if (UNITS[i].side === 'left') r.style.left = Math.round((leftGap - BANNER) / 2) + 'px';
      else r.style.right = Math.round((rightGap - BANNER) / 2) + 'px';
    });
  }

  var timer;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 150);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update);
  else update();
  window.addEventListener('load', update); // fonts/images ke baad layout pakka
  window.addEventListener('resize', schedule);
})();
