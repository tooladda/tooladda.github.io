/* Adsterra content ads — chaar size:
     .ta-inline-ad  300x250, sirf < 1000px screen.
     .ta-mob-ad     320x50,  sirf < 1000px screen.
     .ta-lb-ad      728x90,  sirf >= 900px screen.
     .ta-mb-ad      468x60,  sirf >= 900px screen — patle column (jaise preview panel) me,
                    jahan 728px kata hua dikhta.

   Teen tareeke se lagta hai:
   1. In-article: <script src=".../inline-ads.js" data-in-article defer> — har screen size
      par page ke content me khud slot daal deta hai (.ta-auto-ad): ek tool ke turant baad,
      aur guide me har kuch screen ke baad ek. Size jagah dekh ke chunta hai: 728px ki jagah
      ho to 728x90, warna 300x250 / 320x50 baari-baari.
      Ad kabhi tool se pehle ya tool ke beech nahi aata: "tool" = har input/button/canvas/
      result wala hissa, aur uska poora wrapper jab tak usme guide ka text na aaye. Slot
      sirf aisi heading se pehle lagta hai jiske neeche asli guide text ho, aur jo tool ke
      scroll box, inputs ke bagal wale column, ya tool wrapper ke andar na ho.
      Do ads ke beech ~2 screen ki doori, guide me zyada se zyada 4.
   2. Seedha HTML me: <div class="ta-lb-ad"></div> (ya ta-inline-ad / ta-mob-ad) jahan chahiye.
      Agar slot kisi patle column me hai (jaise preview panel), to us column me 728px
      aane ki screen width data-min se do: <div class="ta-lb-ad" data-min="1620">.
      In-article in slots ke paas apna ad nahi lagata.
   3. Tool list ke andar: page ka apna code ek <div class="ta-inline-ad"> banata hai, use
      list me rakhta hai aur `window.TAInlineAd && TAInlineAd.fill(slot)` bulata hai.
      Page code us slot ko re-render par hataata/hilata nahi — iframe ko DOM me move
      karne se wo reload hota aur har search/filter par naya impression girta.

   Iframe tabhi banta hai jab user scroll karke slot ke paas pahunche (hidden ya door
   wale slot par impression nahi). Adsterra ka invoke.js page load ke baad
   document.write se nahi chal sakta, isliye har ad apne srcdoc iframe me chalta hai. */
(function () {
  if (window.TAInlineAd) return;
  var MAX_WIDTH = 999;
  var UNITS = {
    inline: { cls: 'ta-inline-ad', key: '7253b581d5280a1c55999a492561fb0f', w: 300, h: 250 },
    mobile: { cls: 'ta-mob-ad', key: 'e526027a7a2c599611131756bd26bfe7', w: 320, h: 50 },
    leaderboard: { cls: 'ta-lb-ad', key: 'ea93e60b399c01bdc49f8a6520554164', w: 728, h: 90 },
    banner: { cls: 'ta-mb-ad', key: 'd6e8743cc0dcdb7b6cb7a0623e618110', w: 468, h: 60 }
  };
  var AD_SEL = '.ta-inline-ad,.ta-mob-ad,.ta-lb-ad,.ta-mb-ad,.ta-auto-ad,.ad-slot';
  var CSS =
    '.ta-inline-ad,.ta-mob-ad,.ta-lb-ad,.ta-mb-ad{display:none}' +
    '.ta-ad-label{display:block;margin:0 0 .3rem;font-size:.68rem;line-height:1.2;letter-spacing:.08em;text-transform:uppercase;opacity:.55}' +
    '.ta-ad-box{margin:0 auto;overflow:hidden;max-width:100%}' +
    '.ta-ad-box iframe{display:block;border:0}' +
    '.ta-auto-ad{display:block;grid-column:1/-1;clear:both;width:100%;max-width:100%;margin:1.5rem auto;padding:0;text-align:center}' +
    '@media (max-width:' + MAX_WIDTH + 'px){' +
      '.ta-inline-ad,.ta-mob-ad{display:block;grid-column:1/-1;clear:both;width:100%;max-width:100%;margin:1.4rem auto;padding:0;text-align:center}' +
      '.ta-inline-ad .ta-ad-box{width:300px;height:250px}' +
      '.ta-mob-ad .ta-ad-box{width:320px;height:50px}' +
    '}' +
    '@media (min-width:900px){' +
      '.ta-lb-ad,.ta-mb-ad{display:block;grid-column:1/-1;clear:both;width:100%;max-width:100%;margin:1.2rem auto;padding:0;text-align:center}' +
      '.ta-lb-ad .ta-ad-box{width:728px;height:90px}' +
      '.ta-mb-ad .ta-ad-box{width:468px;height:60px}' +
    '}' +
    '.ta-inline-ad[hidden],.ta-mob-ad[hidden],.ta-lb-ad[hidden],.ta-mb-ad[hidden],.ta-auto-ad[hidden]{display:none!important}' +
    '@media print{.ta-inline-ad,.ta-mob-ad,.ta-lb-ad,.ta-mb-ad,.ta-auto-ad{display:none!important}}';

  var styleAdded = false;
  function addStyle() {
    if (styleAdded) return;
    styleAdded = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // Chrome khali frame ko safed paint karta hai, chahe uska document transparent ho.
  // Dark theme me wo safed slab bhura lagta hai, isliye frame ka apna background
  // page ke theme se mila dete hain. Ad load hote hi uska apna creative dikhta hai.
  function frameBg() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? '#111a2e' : '#ffffff';
  }

  function frame(unit) {
    var f = document.createElement('iframe');
    f.title = 'Advertisement';
    f.width = String(unit.w);
    f.height = String(unit.h);
    f.setAttribute('scrolling', 'no');
    f.srcdoc = '<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:' + frameBg() + '}</style></head><body>' +
      '<script>atOptions={key:"' + unit.key + '",format:"iframe",height:' + unit.h + ',width:' + unit.w + ',params:{}};<\/script>' +
      '<script src="https://www.highrevenueformat.com/' + unit.key + '/invoke.js"><\/script>' +
      '</body></html>';
    return f;
  }

  function unitOf(slot) {
    var named = UNITS[slot.getAttribute('data-unit')];
    if (named) return named;
    if (slot.classList.contains(UNITS.leaderboard.cls)) return UNITS.leaderboard;
    if (slot.classList.contains(UNITS.banner.cls)) return UNITS.banner;
    if (slot.classList.contains(UNITS.mobile.cls)) return UNITS.mobile;
    return UNITS.inline;
  }

  function fill(slot) {
    if (!slot || slot.getAttribute('data-ad-ready')) return;
    var unit = unitOf(slot);
    var min = parseInt(slot.getAttribute('data-min'), 10);
    addStyle();
    if (min) {
      // Slot ka apna breakpoint: iske neeche ad ki jagah hi nahi banti.
      slot.style.display = 'none';
      var mq = window.matchMedia('(min-width: ' + min + 'px)');
      var sync = function () { slot.style.display = mq.matches ? '' : 'none'; };
      sync();
      if (mq.addEventListener) mq.addEventListener('change', sync);
      else if (mq.addListener) mq.addListener(sync);
    }
    slot.setAttribute('data-ad-ready', '1');
    slot.setAttribute('aria-label', 'Advertisement');
    slot.innerHTML = '<span class="ta-ad-label">Advertisement</span><div class="ta-ad-box"></div>';
    var box = slot.lastChild;
    if (slot.getAttribute('data-unit')) {
      box.style.width = unit.w + 'px';
      box.style.height = unit.h + 'px';
    }
    function load() { if (!box.firstChild) box.appendChild(frame(unit)); }
    // display:none (galat screen size, ya hidden list) par IntersectionObserver kabhi fire
    // nahi hota, to wahan iframe banta hi nahi.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { io.disconnect(); load(); }
      }, { rootMargin: '300px 0px' });
      io.observe(slot);
    } else if (slot.getClientRects().length) {
      load();
    }
  }

  /* ------------------------------------------------------------ in-article -- */

  // In ke andar ki heading se pehle kabhi slot nahi.
  var SKIP = '.site-header,body > header,.site-footer,footer,nav,aside,form,table,dialog,[role="dialog"],' +
    '.related-tools,[aria-label="Related tools"],[class*="related"],' +
    AD_SEL + ',.side-ad-rail,[hidden],.hidden';
  // FAQ se pehle ad theek hai, FAQ ke sawaalon ke beech nahi.
  var SKIP_INSIDE = 'details,summary,[class*="faq"],[id*="faq"]';
  // Guide ke end wale CTA / links se pehle ad nahi — wo "beech" nahi hai.
  var SKIP_TEXT = /related|ready to|more .*(tools|calculators|converters)|explore/i;
  // Tool ke hisse: controls, aur result/preview/output dikhane wali jagah.
  var TOOL_PART = 'input:not([type="hidden"]),select,textarea,canvas,button,output,[contenteditable="true"],' +
    '[role="button"],[role="tab"],[role="slider"],[aria-live],' +
    '[id*="result" i],[class*="result" i],[id*="output" i],[class*="output" i],[id*="preview" i],[class*="preview" i]';
  // Ye tool nahi hain, chahe inme button ho.
  var NOT_TOOL = '.site-header,.site-footer,footer,nav,details,dialog,[role="dialog"],[class*="faq"],[id*="faq"],' +
    '[class*="related"],[class*="share"],[class*="crumb"],.ta-support,' + AD_SEL + ',.side-ad-rail';

  function rect(el) { return el.getBoundingClientRect(); }
  function top(el) { return rect(el).top + window.pageYOffset; }
  function visible(el) { var r = rect(el); return r.width >= 8 && r.height >= 8; }

  // Heading ke sabse bahri block tak chadho, taaki ad card ya section-header ke andar na
  // ghuse: parent tab tak lo jab heading uska pehla bachcha ho, ya parent me yahi ek
  // heading ho aur wo parent ke bilkul upar ho (jaise <section><header><p/><h2/>).
  function blockOf(h, root) {
    var node = h, sel = h.tagName === 'H3' ? 'h1,h2,h3' : 'h1,h2', ht = top(h);
    while (node.parentElement && node.parentElement !== root && !node.parentElement.matches('body')) {
      var p = node.parentElement;
      var first = p.firstElementChild === node;
      var single = p.querySelectorAll(sel).length === 1 && ht - top(p) < 160;
      if (!first && !single) break;
      node = p;
    }
    return node;
  }

  // Guide ki heading = uske section me asli padhne wala text ho, aur koi tool-hissa
  // (button, result, input) na ho. Section = heading ka block + uske baad ke siblings,
  // agli barabar ya badi heading tak (kai guides me <p> heading ke andar nahi, baad me hote hain).
  // Heading kisi asli scroll box (tool ka form/side column) ke andar hai? Wo tool ka hissa
  // hai, guide nahi — chahe us box me sirf text ho. Asli scroll box = screen jitna chhota
  // box jiska content kaafi neeche tak jaata hai; lambe page wrapper (overflow-x:hidden,
  // reveal animation ka thoda overflow) isme nahi aate.
  function inScroller(el, root) {
    for (var p = el.parentElement; p && p !== root && !p.matches('body'); p = p.parentElement) {
      if (getComputedStyle(p).overflowY !== 'visible' && p.clientHeight < window.innerHeight * 1.5 &&
          p.scrollHeight > p.clientHeight + 40) return true;
    }
    return false;
  }

  // Heading do-column tool layout me hai, jiske bagal wale column me inputs hain (jaise
  // inputs left, results right)? To wo result card hai, guide nahi — chahe usme text ho.
  function besideTool(h, root) {
    for (var k = h; k.parentElement && k.parentElement !== root && !k.parentElement.matches('body'); k = k.parentElement) {
      var p = k.parentElement;
      if (!/grid|flex/.test(getComputedStyle(p).display)) continue;
      var kr = rect(k);
      for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
        if (c === k) continue;
        var cr = rect(c);
        var side = cr.top < kr.bottom && cr.bottom > kr.top && (cr.right <= kr.left + 1 || cr.left >= kr.right - 1);
        if (side && Array.prototype.some.call(c.querySelectorAll('input:not([type="hidden"]),select,textarea'), visible)) return true;
      }
    }
    return false;
  }

  // Heading kisi tool wrapper (class me app/tool/studio/calculator... aur andar dikhne
  // wala input) ke andar hai? Phone par columns ek ke neeche aa jaate hain, tab
  // besideTool nahi pakadta — ye pakadta hai.
  // Poore page ko lapetne wala wrapper (jisme guide bhi hai) tool nahi gina jaata —
  // sirf page ke 60% se chhota.
  var TOOLISH = /(^|[-_\s])(app|tool|workspace|studio|editor|panel|col|calc|calculator|converter|generator|widget|playground)([-_\s]|$)/i;
  function inToolWrap(h, root) {
    var limit = rect(root).height * 0.6;
    for (var p = h.parentElement; p && p !== root && !p.matches('body'); p = p.parentElement) {
      if (TOOLISH.test(String(p.className)) && rect(p).height < limit &&
          Array.prototype.some.call(p.querySelectorAll('input:not([type="hidden"]),select,textarea'), function (c) {
            return visible(c) && !c.closest('details,[class*="faq"]');
          })) return true;
    }
    return false;
  }

  function isGuide(h, root, minText) {
    if (h.closest(SKIP) || SKIP_TEXT.test(h.textContent) || !visible(h)) return false;
    if (h.closest('details,summary') || inScroller(h, root) || besideTool(h, root) || inToolWrap(h, root)) return false;
    // FAQ wrapper ki pehli heading (uska title) chalegi, andar ke sawaal nahi.
    var faq = h.closest(SKIP_INSIDE);
    while (faq && faq.parentElement && faq.parentElement.closest(SKIP_INSIDE)) faq = faq.parentElement.closest(SKIP_INSIDE);
    if (faq && faq.querySelector('h1,h2,h3') !== h) return false;
    var block = blockOf(h, root);
    var stop = h.tagName === 'H3' ? 'h1,h2,h3' : 'h1,h2';
    var nodes = [block];
    for (var n = block.nextElementSibling; n && !n.matches(stop) && !n.querySelector(stop); n = n.nextElementSibling) {
      nodes.push(n);
    }
    var text = 0;
    for (var i = 0; i < nodes.length; i++) {
      var parts = [nodes[i]].concat(Array.prototype.slice.call(nodes[i].querySelectorAll(TOOL_PART)));
      for (var j = 0; j < parts.length; j++) {
        if (parts[j].matches(TOOL_PART) && !parts[j].closest(NOT_TOOL) && visible(parts[j])) return false;
      }
      var ps = nodes[i].matches('p,li,dd') ? [nodes[i]] : nodes[i].querySelectorAll('p,li,dd');
      Array.prototype.forEach.call(ps, function (p) {
        if (!p.closest('nav,[class*="related"]')) text += p.textContent.trim().length;
      });
    }
    return text >= minText;
  }

  // Tool ka neeche wala kinara (page y). Sabse neeche wale tool-hisse se uske wrapper
  // tak chadho, jab tak wrapper me guide shuru na ho jaye.
  function toolBottom(root) {
    var rootTop = top(root), rootH = rect(root).height;
    var parts = [];
    Array.prototype.forEach.call(root.querySelectorAll(TOOL_PART), function (el) {
      if (el.closest(NOT_TOOL) || !visible(el)) return;
      var t = top(el);
      if ((t - rootTop) / rootH > 0.6) return;           // guide ke andar ke widgets mat gino
      parts.push({ el: el, b: t + rect(el).height });
    });
    // Scroll box (form column, output panel) ke andar ka hissa box ke neeche nahi dikhta,
    // to uski asli lambai mat gino — box ke kinare tak hi.
    var clipCache = new Map();
    function clipBottom(el) {
      var p = el.parentElement;
      if (!p || p === root || p.matches('body')) return Infinity;
      if (clipCache.has(p)) return clipCache.get(p);
      var own = getComputedStyle(p).overflowY !== 'visible' ? top(p) + rect(p).height : Infinity;
      var v = Math.min(own, clipBottom(p));
      clipCache.set(p, v);
      return v;
    }
    parts.sort(function (a, b) { return b.b - a.b; });
    var lowest = null, low = -Infinity;
    for (var i = 0; i < parts.length && parts[i].b > low; i++) {
      var b = Math.min(parts[i].b, clipBottom(parts[i].el));
      if (b > low) { low = b; lowest = parts[i].el; }
    }
    if (!lowest) return rootTop;
    var node = lowest;
    while (node.parentElement && node.parentElement !== root && !node.parentElement.matches('body')) {
      var parent = node.parentElement;
      var guideInside = Array.prototype.some.call(parent.querySelectorAll('h2,h3'), function (h) {
        return top(h) > low && isGuide(h, root, 200);
      });
      if (guideInside) break;
      node = parent;
    }
    return Math.max(low, top(node) + rect(node).height);
  }

  // Guide `main` ke bahar ho (jaise notepad, jahan main sirf app hai) to poora body dekho.
  function contentRoot() {
    var main = document.querySelector('main');
    if (!main) return document.body;
    var outside = Array.prototype.filter.call(document.querySelectorAll('h2'), function (h) {
      return !main.contains(h) && !h.closest('.site-header,.site-footer,footer,nav');
    });
    return outside.length >= 2 ? document.body : main;
  }

  function adTops(except) {
    return Array.prototype.filter.call(document.querySelectorAll(AD_SEL), function (o) {
      return o !== except && o.getClientRects().length && getComputedStyle(o).display !== 'none';
    }).map(top);
  }

  // Slot ko `node` se pehle lagao. Unit jagah dekh ke. Na jame to null.
  function place(node, kind, index, root, floor, gap) {
    if (!node || !node.parentNode) return null;
    var slot = document.createElement('div');
    slot.className = 'ta-auto-ad ta-auto-ad--' + kind;
    addStyle();
    node.parentNode.insertBefore(slot, node);
    // 300px ka ad patli column (result card, sidebar) me daba jata hai — aise me
    // slot ko upar wale chaude block par le jao, warna rehne hi do.
    var origTop = top(slot);
    var guard = 0;
    function flexRow(el) {
      var cs = getComputedStyle(el);
      return /flex/.test(cs.display) && !/column/.test(cs.flexDirection);
    }
    // Ek se zyada column wale grid me slot ko rehne nahi dena. Yahan wo dabta nahi
    // — .ta-auto-ad ki grid-column:1/-1 use poori chaudai de deti hai — par usi 1/-1
    // ki wajah se uske baad wala sibling agli row me, pehle (patle) column me chala
    // jata hai. blog.html par yahi hua tha: TOC + article wale 256px/1fr grid me ad
    // ghusa, aur poora article 256px ki patli column me sikud gaya.
    function multiColGrid(el) {
      if (!el) return false;
      var cs = getComputedStyle(el);
      if (!/grid/.test(cs.display)) return false;
      var tracks = cs.gridTemplateColumns.split(/\s+/).filter(Boolean);
      return tracks.length > 1;
    }
    function badParent(el) { return flexRow(el) || multiColGrid(el); }
    while ((slot.clientWidth < 300 || badParent(slot.parentElement)) && node.parentElement &&
           node.parentElement !== root && guard++ < 6) {
      node = node.parentElement;
      node.parentNode.insertBefore(slot, node);
    }
    var y = top(slot), w = slot.clientWidth;
    var ok = w >= 300 && !badParent(slot.parentElement) &&
      y >= floor && y >= origTop - 400 &&
      adTops(slot).every(function (t) { return Math.abs(t - y) >= gap; });
    if (!ok) { slot.parentNode.removeChild(slot); return null; }
    var unit = w >= 728 ? 'leaderboard'
      : kind === 'guide' && index % 2 === 0 && w >= 320 ? 'mobile'
      : 'inline';
    slot.setAttribute('data-unit', unit);
    fill(slot);
    return slot;
  }

  var autos = [];
  function inArticle() {
    var root = contentRoot();
    var floor = toolBottom(root) - 2;                  // is se upar kabhi nahi
    var gap = Math.max(1200, window.innerHeight * 2);   // do ads ke beech kam se kam ~2 screen
    var heads = Array.prototype.filter.call(root.querySelectorAll('h2'), function (h) {
      return top(h) > floor && isGuide(h, root, 200);
    });

    // 1) Tool ke turant baad = guide ki pehli heading se pehle. Ye sabse kaam ki jagah
    //    hai, isliye page ke end wale ad se thodi kam doori bhi chalegi.
    if (heads.length) {
      var s = place(blockOf(heads[0], root), 'tool', 0, root, floor, Math.max(900, window.innerHeight * 1.2));
      if (s) autos.push(s);
    }

    // 2) Guide me har `gap` ke baad ek (h2, warna h3), zyada se zyada 4.
    var subs = Array.prototype.filter.call(root.querySelectorAll('h3'), function (h) {
      return top(h) > floor && isGuide(h, root, 120) &&
        !/grid|flex/.test(getComputedStyle(h.parentElement).display);
    });
    var all = heads.concat(subs);
    var placed = 0;
    for (var guard = 0; placed < 4 && guard < 40; guard++) {
      var tops = adTops();
      var eligible = all.filter(function (h) {
        var y = top(h);
        return h.isConnected && tops.every(function (t) { return Math.abs(t - y) >= gap; });
      }).sort(function (a, b) { return top(a) - top(b); });
      if (!eligible.length) break;
      var pick = eligible[0];
      if (pick.tagName === 'H3') {
        // paas me h2 ho to wahi behtar break hai
        var h2 = eligible.filter(function (h) {
          return h.tagName === 'H2' && top(h) - top(pick) < gap / 2;
        })[0];
        if (h2) pick = h2;
      }
      all.splice(all.indexOf(pick), 1);
      var g = place(blockOf(pick, root), 'guide', placed, root, floor, gap);
      if (g) { autos.push(g); placed++; }
    }
  }

  // Screen ghumane/resize par jo ad ab column me nahi samata, use chhupa do.
  function refit() {
    autos.forEach(function (s) {
      var p = s.parentElement;
      if (!p) return;
      var cs = getComputedStyle(p);
      var room = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      s.hidden = room < UNITS[s.getAttribute('data-unit')].w;
    });
  }

  window.TAInlineAd = { fill: fill };

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('.ta-inline-ad, .ta-mob-ad, .ta-lb-ad, .ta-mb-ad'), fill);
    var me = document.querySelector('script[src*="inline-ads.js"][data-in-article]');
    if (!me) return;
    addStyle();
    // layout (fonts, lazy lists) settle hone do, phir naap ke lagao
    var run = function () { setTimeout(function () { inArticle(); refit(); }, 300); };
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run);
    var timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(refit, 200);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
