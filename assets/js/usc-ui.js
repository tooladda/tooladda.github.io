/* ==========================================================================
   ToolAdda — US calculator page furniture (shared)

   Two pieces of interface every one of the four US finance pages wants, kept
   here rather than copied four times.

   1. PRESETS. An empty form is the slowest way into a calculator. A row of
      one-click starting points ("20% down, no PMI", "Used car, 48 months")
      gets a reader to a believable answer before they type anything, and
      doubles as documentation of what the tool can model.

   2. THE STICKY ANSWER BAR. On a phone the input form is longer than the
      screen, so the number the reader came for scrolls away exactly while
      they are changing the inputs that move it. The bar mirrors the headline
      figure at the bottom of the viewport once the real one leaves the
      screen, and only on small screens — on a desktop the two-column layout
      already keeps the answer in view, and a fixed bar would be clutter.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     Presets
     ====================================================================== */

  /* items: [{ label, hint, state }]  —  onPick receives the state object.
     Labels come from the page, not from user input, but they are still set
     as text nodes rather than markup: this is the kind of helper that later
     gets handed a value from somewhere less trustworthy. */
  function presets(host, items, onPick) {
    if (!host || !items || !items.length) return;

    var list = document.createElement('ul');
    list.className = 'usc-presets';

    items.forEach(function (item) {
      var li = document.createElement('li');
      var btn = document.createElement('button');

      btn.type = 'button';
      btn.className = 'usc-preset';
      btn.textContent = item.label;
      if (item.hint) btn.title = item.hint;

      btn.addEventListener('click', function () {
        onPick(item.state, item);
      });

      li.appendChild(btn);
      list.appendChild(li);
    });

    host.appendChild(list);
  }

  /* ======================================================================
     Sticky answer bar
     ====================================================================== */

  /* opts = {
       watch:     the element whose value the bar mirrors (the headline)
       label:     static caption, e.g. "Monthly payment"
       jumpTo:    element to scroll to when the reader taps Edit
     }

     Returns { update() } so the page can push a fresh value after a render.
  */
  function stickyBar(opts) {
    if (!opts || !opts.watch) return { update: function () {} };

    var bar = document.createElement('div');
    bar.className = 'usc-sticky';
    /* Not a live region: the value it mirrors is already announced by the
       page's own status region, and duplicating it would double every
       screen-reader update. */
    bar.setAttribute('aria-hidden', 'true');

    var text = document.createElement('div');
    var label = document.createElement('span');
    label.className = 'usc-sticky__label';
    label.textContent = opts.label || 'Result';

    var value = document.createElement('span');
    value.className = 'usc-sticky__value';
    value.textContent = opts.watch.textContent;

    text.appendChild(label);
    text.appendChild(value);

    var jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'usc-sticky__jump';
    jump.textContent = 'Edit inputs';
    /* Hidden from assistive tech along with the bar, so the button is not
       announced as an orphan control. */
    jump.tabIndex = -1;

    jump.addEventListener('click', function () {
      var target = opts.jumpTo || document.body;
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });

    bar.appendChild(text);
    bar.appendChild(jump);
    document.body.appendChild(bar);

    function prefersReducedMotion() {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (error) {
        return false;
      }
    }

    /* Show the bar only once the real figure has left the screen. Without an
       IntersectionObserver — old Safari, jsdom — the bar simply never
       appears, which is the correct degradation: the page still works. */
    if (typeof IntersectionObserver === 'function') {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          bar.classList.toggle('is-visible', !entry.isIntersecting);
          bar.setAttribute('aria-hidden', entry.isIntersecting ? 'true' : 'false');
          jump.tabIndex = entry.isIntersecting ? -1 : 0;
        });
      }, { rootMargin: '-8px 0px 0px 0px', threshold: 0 });

      observer.observe(opts.watch);
    }

    return {
      update: function () {
        value.textContent = opts.watch.textContent;
      },
      element: bar
    };
  }

  global.USCUI = {
    presets: presets,
    stickyBar: stickyBar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.USCUI;

})(typeof window !== 'undefined' ? window : this);
