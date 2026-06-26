/* Fixed "Back to top" — fades in after a short scroll, smooth-scrolls home. */
(function () {
  "use strict";

  var btn = document.querySelector(".back-to-top");
  if (!btn) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var showAt = 420;

  function setVisible(on) {
    btn.classList.toggle("is-visible", on);
    btn.setAttribute("aria-hidden", on ? "false" : "true");
    if (on) btn.removeAttribute("tabindex");
    else btn.setAttribute("tabindex", "-1");
  }

  function onScroll() {
    setVisible(window.scrollY > showAt);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    btn.blur();
  });
})();
