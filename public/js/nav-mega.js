// Browse: a full-width slide-down overlay (the "Browse everything" page as a
// panel). Click the Browse control to open; the X button, Escape, a link, the
// panel backdrop, or a click outside closes it. Click-only (no hover) since it
// covers the page. The panel lives outside the header in the DOM, so it's wired
// up by id rather than as a child of the trigger's wrapper.
(function () {
  var btn = document.querySelector(".nav-mega-btn");
  var panel = document.getElementById("browse-panel");
  if (!btn || !panel) return;
  var wrap = btn.closest(".nav-mega");
  var closeBtn = panel.querySelector(".nav-mega-close");

  // CSS now owns visibility (opacity/transform transitions); drop the no-JS
  // [hidden] so the panel can animate open and closed.
  panel.hidden = false;

  function open() {
    panel.classList.add("open");
    if (wrap) wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    document.body.classList.add("browse-open");
  }
  function close() {
    panel.classList.remove("open");
    if (wrap) wrap.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("browse-open");
  }

  btn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    panel.classList.contains("open") ? close() : open();
  });
  if (closeBtn) closeBtn.addEventListener("click", close);

  // a link inside closes the panel, then navigates
  panel.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", close);
  });
  // a click on the panel's own backdrop (its empty area, not the content) closes
  panel.addEventListener("click", function (e) {
    if (e.target === panel) close();
  });
  // a click anywhere outside the panel and the trigger closes
  document.addEventListener("click", function (e) {
    if (panel.classList.contains("open") && !panel.contains(e.target) && !btn.contains(e.target)) {
      close();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
})();
