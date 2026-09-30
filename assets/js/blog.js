/* ==========================================================================
   ToolAdda — All Tools Guide (blog.html)

   Two small jobs, both progressive enhancements: without this file the page
   is still a complete, navigable document — the table of contents is plain
   anchor links and the back-to-top control is an ordinary link to #main-content.

     1. Highlight the table-of-contents entry for whatever section is on
        screen, so a reader eighteen screens down still knows where they are.
     2. Reveal the back-to-top control only once scrolling has actually
        started.
   ========================================================================== */
(function () {
  'use strict';

  var toc = document.querySelector('.blg-toc');
  if (!toc) return;

  var links = Array.prototype.slice.call(toc.querySelectorAll('.blg-toc-item'));
  if (!links.length) return;

  var sections = links
    .map(function (a) {
      var id = a.getAttribute('href');
      var el = id && id.charAt(0) === '#' ? document.getElementById(id.slice(1)) : null;
      return el ? { link: a, el: el } : null;
    })
    .filter(Boolean);

  if (!sections.length) return;

  var current = null;

  function activate(entry) {
    if (entry === current) return;
    if (current) current.link.removeAttribute('aria-current');
    current = entry;
    if (!current) return;
    current.link.setAttribute('aria-current', 'true');

    // Keep the active entry visible inside the rail's own scroller. On the
    // narrow layout the rail is a horizontal strip, so this is what stops the
    // highlight drifting off-screen.
    var railTop = toc.scrollTop;
    var railH = toc.clientHeight;
    var itemTop = current.link.offsetTop;
    var itemH = current.link.offsetHeight;
    if (itemTop < railTop || itemTop + itemH > railTop + railH) {
      toc.scrollTop = itemTop - railH / 2 + itemH / 2;
    }
  }

  /* The section counted as "current" is the last one whose top has passed a
     line a third of the way down the viewport. Using a line rather than
     "is visible" avoids the flicker you get when three short sections share
     the screen. */
  function update() {
    var line = window.innerHeight * 0.33;
    var found = null;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].el.getBoundingClientRect().top <= line) found = sections[i];
    }
    // Above the first section, light nothing rather than lying about position.
    activate(found);
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      update();
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();

})();
