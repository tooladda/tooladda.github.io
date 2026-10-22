/* ==========================================================================
   ToolAdda — US calculator charts (shared)

   Two small SVG chart forms for the four US finance pages. No library: the
   site already ships no charting dependency, and these are a line/area chart
   and a stacked bar — a few hundred lines of SVG rather than 200KB of vendor
   code on a page whose whole selling point is that it loads fast.

   Everything here follows one set of fixed marks so the four pages read as
   one system:

     line          2px, round join and cap
     area fill     the series hue at 10%
     end marker    r=4 (8px), with a 2px ring in the surface colour so it
                   stays legible where it crosses another line
     gridlines     hairline, solid, one step off the surface — recessive
     stack gap     2px of surface between touching segments, never a stroke

   Two rules that are easy to get wrong and are load-bearing here:

   1. TEXT NEVER WEARS THE SERIES COLOUR. Three of the categorical hues sit
      under 3:1 against a white panel and are illegible as label text.
      Identity comes from a coloured mark *beside* ink-coloured text — a
      swatch in the legend, a short stroke in the tooltip — never from
      colouring the words.

   2. THE TOOLTIP ENHANCES, IT NEVER GATES. Every value it shows is also in
      the page's own table, so a reader who cannot hover — keyboard, touch,
      screen reader — loses nothing. Focus gives the same readout as hover.
   ========================================================================== */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* Plot geometry in viewBox units. The SVG scales to its container, so
     these are proportions rather than pixels. */
  var VB_W = 720;
  var VB_H = 300;

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return node;
  }

  /* Series and category names can come from a text field the reader typed,
     so they are inserted as text nodes and never as markup. */
  function text(node, value) {
    node.textContent = String(value);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* A chart host carries its own title and subtitle in the page markup, so a
     re-render must remove only what a previous render put there. Everything
     these functions create is tagged, and only tagged nodes are cleared. */
  function clearRendered(host) {
    var made = host.querySelectorAll('[data-usc-chart]');
    for (var i = 0; i < made.length; i++) made[i].remove();
  }

  function tag(node) {
    node.setAttribute('data-usc-chart', '');
    return node;
  }

  /* Round a maximum up to a clean axis top: 1/2/2.5/5 x a power of ten. */
  function niceMax(value) {
    if (!(value > 0)) return 1;

    var exp = Math.floor(Math.log(value) / Math.LN10);
    var pow = Math.pow(10, exp);
    var frac = value / pow;

    var step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
    return step * pow;
  }

  /* The axis top alone is not enough: dividing 50,000 into four gives ticks of
     12,500, which print as $13k / $25k / $38k — arithmetically fine and
     unreadable. Choosing the divisor to suit the leading digit keeps every
     tick a round number. */
  function niceScale(value) {
    var max = niceMax(value);
    var lead = max / Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var ticks = (lead === 2.5 || lead === 5) ? 5 : 4;

    return { max: max, ticks: ticks };
  }

  function shortMoney(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
    return '$' + Math.round(n);
  }

  function monthLabel(m) {
    if (m % 12 === 0) return 'Yr ' + (m / 12);
    return 'Mo ' + m;
  }

  /* ======================================================================
     Line / area chart
     ======================================================================

     opts = {
       series:   [{ name, color, points: [{x, y}] }]   (1..4)
       xMax, yMax                                      (optional)
       formatY:  fn(number) -> string                  (tooltip + labels)
       formatX:  fn(number) -> string
       yTicks:   how many horizontal gridlines
       areaFill: true to wash under a single series
       caption:  accessible summary for screen readers
     }
  */
  function lineChart(host, opts) {
    if (!host) return;

    var series = (opts.series || []).filter(function (s) {
      return s && s.points && s.points.length > 1;
    });

    clearRendered(host);
    if (!series.length) return;

    var formatY = opts.formatY || shortMoney;
    var formatX = opts.formatX || monthLabel;

    /* Leave room on the right for end labels, and below for the x axis. */
    var padL = 54, padR = 74, padT = 14, padB = 30;
    var plotW = VB_W - padL - padR;
    var plotH = VB_H - padT - padB;

    var xMax = opts.xMax || series.reduce(function (m, s) {
      return Math.max(m, s.points[s.points.length - 1].x);
    }, 0);

    var rawMax = opts.yMax || series.reduce(function (m, s) {
      return s.points.reduce(function (mm, p) { return Math.max(mm, p.y); }, m);
    }, 0);
    var scale = niceScale(rawMax);
    var yMax = scale.max;

    if (!(xMax > 0) || !(yMax > 0)) return;

    function px(x) { return padL + (x / xMax) * plotW; }
    function py(y) { return padT + plotH - (y / yMax) * plotH; }

    /* No preserveAspectRatio override: the default uniform scaling is what
       keeps the tick and label text undistorted. Stretching the viewBox to
       fill a box of a different aspect ratio (preserveAspectRatio="none")
       scales the glyphs on one axis only, and at a 3:1 container against a
       2.4:1 viewBox the numbers come out visibly wide. The CSS pins the
       container to the viewBox's own ratio instead. */
    var svg = el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      class: 'usc-chart-svg',
      role: 'img'
    });
    svg.setAttribute('aria-label', opts.caption || 'Chart');

    /* --- gridlines and y ticks --- */
    var ticks = opts.yTicks || scale.ticks;
    for (var t = 0; t <= ticks; t++) {
      var v = (yMax * t) / ticks;
      var y = py(v);

      svg.appendChild(el('line', {
        x1: padL, y1: y, x2: padL + plotW, y2: y,
        class: t === 0 ? 'usc-chart-axis' : 'usc-chart-grid'
      }));

      svg.appendChild(text(el('text', {
        x: padL - 8, y: y + 4, class: 'usc-chart-tick', 'text-anchor': 'end'
      }), formatY(v)));
    }

    /* --- x axis labels: first, middle, last --- */
    [0, Math.round(xMax / 2), xMax].forEach(function (xv, i) {
      svg.appendChild(text(el('text', {
        x: px(xv),
        y: VB_H - 10,
        class: 'usc-chart-tick',
        'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle'
      }), formatX(xv)));
    });

    /* --- the marks --- */
    var endLabels = [];
    var placedLabels = [];

    series.forEach(function (s, i) {
      var d = s.points.map(function (p, j) {
        return (j ? 'L' : 'M') + px(p.x).toFixed(2) + ' ' + py(p.y).toFixed(2);
      }).join(' ');

      /* An area wash only when a single series owns the plot; under two or
         more it muddies both and the lines carry the shape on their own. */
      if (opts.areaFill && series.length === 1) {
        var area = d + ' L' + px(s.points[s.points.length - 1].x).toFixed(2) +
          ' ' + py(0).toFixed(2) + ' L' + px(s.points[0].x).toFixed(2) + ' ' + py(0).toFixed(2) + ' Z';
        svg.appendChild(el('path', { d: area, fill: s.color, 'fill-opacity': 0.1, stroke: 'none' }));
      }

      svg.appendChild(el('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));

      /* End marker: 8px, ringed in the surface so overlaps stay readable. */
      var last = s.points[s.points.length - 1];
      svg.appendChild(el('circle', {
        cx: px(last.x), cy: py(last.y), r: 4,
        fill: s.color, class: 'usc-chart-dot'
      }));

      /* Direct end-label, collected first and placed below — several series
         that all finish at zero would otherwise stack three labels on one
         spot, which reads as a smudge and says nothing. */
      endLabels.push({
        x: px(last.x) + 10,
        y: py(last.y) + 4,
        value: s.endLabel || formatY(last.y)
      });
    });

    /* Place only the labels that can be read. Where two would overlap, the
       later one is dropped rather than nudged: moving a label off its own
       line detaches it from the thing it names, and the legend and tooltip
       already carry every value. */
    endLabels.forEach(function (lab) {
      var clashes = placedLabels.some(function (p) {
        return Math.abs(p.y - lab.y) < 13 && Math.abs(p.x - lab.x) < 54;
      });
      if (clashes) return;

      placedLabels.push(lab);
      svg.appendChild(text(el('text', {
        x: lab.x, y: lab.y, class: 'usc-chart-endlabel'
      }), lab.value));
    });

    /* --- crosshair, drawn above the marks, hidden until hover --- */
    var crosshair = el('line', {
      x1: padL, y1: padT, x2: padL, y2: padT + plotH,
      class: 'usc-chart-crosshair', visibility: 'hidden'
    });
    svg.appendChild(crosshair);

    var focusDots = series.map(function (s) {
      var dot = el('circle', { r: 4, fill: s.color, class: 'usc-chart-dot', visibility: 'hidden' });
      svg.appendChild(dot);
      return dot;
    });

    /* --- hit layer: the whole plot, so the pointer only has to be close --- */
    var hit = el('rect', {
      x: padL, y: padT, width: plotW, height: plotH,
      fill: 'transparent', class: 'usc-chart-hit', tabindex: 0, role: 'application'
    });
    hit.setAttribute('aria-label', (opts.caption || 'Chart') + '. Use arrow keys to read values.');
    svg.appendChild(hit);

    host.appendChild(tag(svg));

    /* --- legend: always present for two or more series --- */
    if (series.length > 1) {
      var legend = document.createElement('ul');
      legend.className = 'usc-chart-legend';

      series.forEach(function (s) {
        var li = document.createElement('li');
        var key = document.createElement('span');
        key.className = 'usc-chart-key';
        key.style.background = s.color;
        li.appendChild(key);
        li.appendChild(document.createTextNode(s.name));
        legend.appendChild(li);
      });
      host.appendChild(tag(legend));
    }

    /* --- tooltip --- */
    var tip = document.createElement('div');
    tip.className = 'usc-chart-tip';
    tip.hidden = true;
    host.appendChild(tag(tip));

    var cursorX = null;

    function nearestIndex(s, xv) {
      var best = 0, bestD = Infinity;
      for (var i = 0; i < s.points.length; i++) {
        var d = Math.abs(s.points[i].x - xv);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    function showAt(xv) {
      xv = Math.max(0, Math.min(xMax, xv));
      cursorX = xv;

      var cx = px(xv);
      crosshair.setAttribute('x1', cx);
      crosshair.setAttribute('x2', cx);
      crosshair.setAttribute('visibility', 'visible');

      clear(tip);
      var head = document.createElement('strong');
      head.textContent = formatX(Math.round(xv));
      tip.appendChild(head);

      series.forEach(function (s, i) {
        var p = s.points[nearestIndex(s, xv)];

        focusDots[i].setAttribute('cx', px(p.x));
        focusDots[i].setAttribute('cy', py(p.y));
        focusDots[i].setAttribute('visibility', 'visible');

        var row = document.createElement('span');
        row.className = 'usc-chart-tiprow';

        var key = document.createElement('i');
        key.className = 'usc-chart-tipkey';
        key.style.background = s.color;
        row.appendChild(key);

        /* Value leads, series name follows — the reader already knows which
           series they are looking at and wants the number. */
        var val = document.createElement('b');
        val.textContent = formatY(p.y);
        row.appendChild(val);

        row.appendChild(document.createTextNode(' ' + s.name));
        tip.appendChild(row);
      });

      tip.hidden = false;

      /* Keep the tooltip inside the host box. */
      var frac = cx / VB_W;
      tip.style.left = (frac * 100).toFixed(2) + '%';
      tip.classList.toggle('is-flipped', frac > 0.62);
    }

    function hide() {
      crosshair.setAttribute('visibility', 'hidden');
      focusDots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
      tip.hidden = true;
      cursorX = null;
    }

    function xFromEvent(event) {
      var box = svg.getBoundingClientRect();
      if (!box.width) return 0;
      var rel = ((event.clientX - box.left) / box.width) * VB_W;
      return ((rel - padL) / plotW) * xMax;
    }

    hit.addEventListener('pointermove', function (event) { showAt(xFromEvent(event)); });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', function () { showAt(cursorX === null ? xMax : cursorX); });
    hit.addEventListener('blur', hide);

    hit.addEventListener('keydown', function (event) {
      var step = Math.max(1, Math.round(xMax / 24));
      var next = cursorX === null ? xMax : cursorX;

      if (event.key === 'ArrowLeft') next -= step;
      else if (event.key === 'ArrowRight') next += step;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = xMax;
      else if (event.key === 'Escape') { hide(); return; }
      else return;

      event.preventDefault();
      showAt(next);
    });
  }

  /* ======================================================================
     Stacked bar — composition of a single total
     ======================================================================

     segments = [{ name, value, color }]

     Each segment is separated from the next by 2px of surface rather than a
     stroke, and the two outer ends are rounded. Values are direct-labelled in
     the legend rather than inside the segments: on a 12px-tall bar nothing
     fits, and a clipped label is worse than none.
  */
  function stackedBar(host, segments, opts) {
    if (!host) return;

    var live = (segments || []).filter(function (s) { return s && s.value > 0; });

    clearRendered(host);
    if (!live.length) return;

    opts = opts || {};
    var format = opts.format || shortMoney;
    var total = live.reduce(function (a, s) { return a + s.value; }, 0);

    var bar = document.createElement('div');
    bar.className = 'usc-stack';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', opts.caption || 'Composition');

    live.forEach(function (s) {
      var seg = document.createElement('span');
      seg.className = 'usc-stack-seg';
      seg.style.flexBasis = ((s.value / total) * 100).toFixed(3) + '%';
      seg.style.background = s.color;
      seg.title = s.name + ': ' + format(s.value);
      bar.appendChild(seg);
    });

    host.appendChild(tag(bar));

    var legend = document.createElement('ul');
    legend.className = 'usc-chart-legend usc-chart-legend--values';

    live.forEach(function (s) {
      var li = document.createElement('li');

      var key = document.createElement('span');
      key.className = 'usc-chart-key';
      key.style.background = s.color;
      li.appendChild(key);

      li.appendChild(document.createTextNode(s.name + ' '));

      var b = document.createElement('b');
      b.textContent = format(s.value);
      li.appendChild(b);

      legend.appendChild(li);
    });

    host.appendChild(tag(legend));
  }

  /* The validated light-mode palette, repeated here ONLY as a fallback.

     The live values come from CSS so light and dark swap with the rest of the
     page. But a single shared fallback would be worse than useless: if the
     custom property ever fails to resolve, every series would come back the
     same colour and the chart would silently become unreadable while still
     looking like a chart. Falling back per slot keeps the series
     distinguishable even then. */
  var FALLBACK = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

  /* The tokens are declared on .usc-page (and their dark steps on
     [data-theme="dark"] .usc-page), NOT on :root — so reading them off
     document.documentElement returns nothing and every chart silently falls
     back to the light hexes, including in dark mode where the palette is
     deliberately re-stepped. Read from the element that declares them. */
  function tokenHost() {
    return document.querySelector('.usc-page') || document.body || document.documentElement;
  }

  function seriesColor(index) {
    var fallback = FALLBACK[(index - 1) % FALLBACK.length];

    try {
      var value = getComputedStyle(tokenHost()).getPropertyValue('--usc-series-' + index);
      return (value || '').trim() || fallback;
    } catch (error) {
      return fallback;
    }
  }

  /* A 360-row schedule does not need 360 SVG points. Sampling to roughly
     `target` keeps the path small and the crosshair snappy, while always
     retaining the final row so the line actually reaches zero. */
  function sample(rows, target, mapper) {
    if (!rows || !rows.length) return [];

    var step = Math.max(1, Math.ceil(rows.length / (target || 60)));
    var out = [];

    for (var i = 0; i < rows.length; i += step) out.push(mapper(rows[i], i));
    if ((rows.length - 1) % step !== 0) {
      out.push(mapper(rows[rows.length - 1], rows.length - 1));
    }
    return out;
  }

  global.USCCharts = {
    lineChart: lineChart,
    sample: sample,
    stackedBar: stackedBar,
    seriesColor: seriesColor,
    shortMoney: shortMoney,
    monthLabel: monthLabel,
    niceMax: niceMax,
    niceScale: niceScale
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.USCCharts;

})(typeof window !== 'undefined' ? window : this);
