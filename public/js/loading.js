/* Global loading affordances (progressive — the site is server-rendered, so
   none of this is required for the page to work):
   1. a top progress bar that runs while a navigation is in flight;
   2. stop the poster shimmer once each image has decoded.
   Loaded on every page via Layout. */
(function () {
  "use strict";

  // ---- 1. navigation progress bar -----------------------------------
  (function nprogress() {
    var el = document.querySelector(".nprogress");
    if (!el) return;
    var started = false;
    function start() {
      if (started) return;
      started = true;
      // force a reflow so the width transition runs from 0
      el.classList.add("is-active");
      var bar = el.querySelector(".nprogress-bar");
      if (bar) { void bar.offsetWidth; }
    }
    // a real internal navigation from a link click
    document.addEventListener(
      "click",
      function (e) {
        // poster-card play discs sit inside the card's link but open a modal,
        // never navigate — don't start the bar for them (this listener captures,
        // so it runs before the disc's own preventDefault marks the event)
        if (e.target.closest && e.target.closest("[data-trailer-id]")) return;
        var a = e.target.closest && e.target.closest("a[href]");
        if (!a) return;
        if (a.target === "_blank" || a.hasAttribute("download")) return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var url;
        try { url = new URL(a.href, location.href); } catch (_) { return; }
        if (url.origin !== location.origin) return; // external → browser/tab handles it
        if (url.href === location.href) return; // same page
        if (url.hash && url.pathname === location.pathname && url.search === location.search) return; // in-page anchor
        start();
      },
      true
    );
    // GET form submits (search, filters) navigate too
    document.addEventListener(
      "submit",
      function (e) {
        var f = e.target;
        if (!f || f.tagName !== "FORM") return;
        if (f.target === "_blank") return;
        if ((f.getAttribute("method") || "get").toLowerCase() === "get") start();
      },
      true
    );
    // catch-all: any unload (JS redirect, POST nav, typed URL) — the bar lives
    // on the outgoing page until the next one paints
    window.addEventListener("pagehide", start);
    // restored from the back/forward cache → the bar must not be stuck on
    window.addEventListener("pageshow", function (e) {
      if (e.persisted) { started = false; el.classList.remove("is-active"); }
    });
  })();

  // ---- 2. poster skeleton: drop the shimmer once art has decoded -----
  (function posters() {
    function ready(img) {
      var media = img.closest && img.closest(".card-media");
      if (media) media.classList.add("is-loaded");
    }
    var imgs = document.querySelectorAll(".card-media img");
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.complete && img.naturalWidth > 0) {
        ready(img);
      } else {
        img.addEventListener("load", function () { ready(this); }, { once: true });
        img.addEventListener("error", function () { ready(this); }, { once: true });
      }
    }
  })();
})();
