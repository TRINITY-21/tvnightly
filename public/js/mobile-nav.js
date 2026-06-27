// Mobile nav drawer — header stays pinned; menu fills the viewport below it.
// overflow:hidden breaks position:sticky, so mid-page opens used to lose the
// header (and the close toggle). We freeze the page with body{position:fixed}
// and pin .site-header with a dedicated class while the drawer is open.
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("mobile-menu");
  var header = document.querySelector(".site-header");
  if (!toggle || !menu || !header) return;

  document.body.appendChild(menu);

  var scrollY = 0;
  var isOpen = false;

  function headerHeight() {
    return Math.max(0, Math.round(header.getBoundingClientRect().height));
  }

  function preventPageScroll(e) {
    if (menu.contains(e.target) || header.contains(e.target)) return;
    e.preventDefault();
  }

  function lockScroll() {
    scrollY = window.scrollY;
    var h = headerHeight();
    document.documentElement.style.setProperty("--nav-header-h", h + "px");
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.documentElement.classList.add("nav-open");
    document.body.classList.add("nav-open");
    header.classList.add("nav-pinned");
    document.addEventListener("touchmove", preventPageScroll, { passive: false });
  }

  function unlockScroll() {
    document.documentElement.classList.remove("nav-open");
    document.body.classList.remove("nav-open");
    header.classList.remove("nav-pinned");
    document.removeEventListener("touchmove", preventPageScroll);
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.documentElement.style.removeProperty("--nav-header-h");
    window.scrollTo(0, scrollY);
  }

  function open() {
    isOpen = true;
    menu.hidden = false;
    menu.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close menu");
    lockScroll();
  }

  function close() {
    isOpen = false;
    menu.hidden = true;
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
    unlockScroll();
  }

  toggle.addEventListener("click", function () {
    isOpen ? close() : open();
  });

  menu.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", close);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) close();
  });

  var mq = window.matchMedia("(min-width: 901px)");
  (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function (e) {
    if (e.matches && isOpen) close();
  });
})();
