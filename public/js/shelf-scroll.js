/* Horizontal poster shelves: when the row overflows, frame it with a pair of
   quiet edge arrows that page the scroll. Auto-wraps every ul.poster-shelf so
   routes need no extra markup. Arrows fade in only on the side you can travel,
   and never appear on touch (native swipe is the better gesture there). */
(function () {
  "use strict";
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return;

  function build(shelf) {
    var wrap = document.createElement("div");
    wrap.className = "shelf-scroller";
    shelf.parentNode.insertBefore(wrap, shelf);
    wrap.appendChild(shelf);

    // center the arrows on the poster art, not the taller name+poster column
    var tile = shelf.querySelector(".shelf-tile, .shelf-fallback, li > a, li > *");
    if (tile) wrap.style.setProperty("--shelf-art-h", tile.offsetHeight + "px");

    function arrow(dir, label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "shelf-nav shelf-nav-" + (dir < 0 ? "prev" : "next");
      b.setAttribute("aria-label", label);
      b.innerHTML = '<span class="shelf-nav-chev" aria-hidden="true"></span>';
      b.addEventListener("click", function () {
        shelf.scrollBy({ left: dir * Math.round(shelf.clientWidth * 0.82), behavior: "smooth" });
      });
      return b;
    }
    var prev = arrow(-1, "Scroll left");
    var next = arrow(1, "Scroll right");
    wrap.appendChild(prev);
    wrap.appendChild(next);

    function update() {
      var max = shelf.scrollWidth - shelf.clientWidth;
      wrap.classList.toggle("can-prev", shelf.scrollLeft > 4);
      wrap.classList.toggle("can-next", shelf.scrollLeft < max - 4);
    }
    shelf.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  function init() {
    var shelves = document.querySelectorAll("ul.poster-shelf, ol.poster-shelf");
    for (var i = 0; i < shelves.length; i++) {
      var s = shelves[i];
      // shelves inside a ShelfRail already have their own paging chevrons —
      // don't add a second pair
      if (s.closest(".poster-rail")) continue;
      if (s.scrollWidth > s.clientWidth + 4 && !s.dataset.scroller) {
        s.dataset.scroller = "1";
        build(s);
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
