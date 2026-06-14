// Mobile nav: the hamburger toggles a full-height drawer under the header.
// Closes on link tap, Escape, or when the viewport grows back to desktop.
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("mobile-menu");
  if (!toggle || !menu) return;

  function open() {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close menu");
    document.body.classList.add("nav-open");
  }
  function close() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
    document.body.classList.remove("nav-open");
  }

  toggle.addEventListener("click", function () {
    toggle.getAttribute("aria-expanded") === "true" ? close() : open();
  });

  menu.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", close);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  // grew back to desktop while open → drop the drawer and the scroll lock
  var mq = window.matchMedia("(min-width: 701px)");
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function (e) {
    if (e.matches) close();
  });
})();
