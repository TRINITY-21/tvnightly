// Browse mega-menu: hover with a close delay so the pointer can reach the panel;
// click/tap toggle on coarse pointers; Escape/outside close.
(function () {
  document.querySelectorAll(".nav-mega").forEach(function (wrap) {
    var btn = wrap.querySelector(".nav-mega-btn");
    var panel = wrap.querySelector(".nav-mega-panel");
    if (!btn || !panel) return;

    var hoverable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    var closeTimer = 0;

    function open() {
      wrap.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }
    function close() {
      wrap.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    }
    function cancelClose() {
      clearTimeout(closeTimer);
    }
    function scheduleClose() {
      cancelClose();
      closeTimer = setTimeout(close, 160);
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      wrap.classList.contains("open") ? close() : open();
    });

    panel.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", close);
    });

    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    if (hoverable) {
      btn.addEventListener("mouseenter", function () {
        cancelClose();
        open();
      });
      btn.addEventListener("mouseleave", scheduleClose);
      panel.addEventListener("mouseenter", cancelClose);
      panel.addEventListener("mouseleave", scheduleClose);
    }
  });
})();
