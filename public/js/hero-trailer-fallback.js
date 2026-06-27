// When an inline hero trailer cannot play (geo-block, embed disabled, etc.),
// swap the YouTube iframe for the title's backdrop image.
(function () {
  var containers = [].slice.call(document.querySelectorAll("[data-hero-trailer]"));
  if (!containers.length) return;

  containers.forEach(function (container) {
    var iframe = container.querySelector("iframe");
    if (!iframe) return;
    if (!container.querySelector(".hub-hero-video-backdrop-layer")) return;

    var failed = false;

    function fail() {
      if (failed) return;
      failed = true;
      window.removeEventListener("message", onMessage);
      container.classList.add("is-trailer-unavailable");
      var player = container.closest("[data-hero-pip]");
      if (player) player.classList.add("is-trailer-unavailable");
      var backdrop = container.querySelector(".hub-hero-video-backdrop-layer");
      if (backdrop) {
        backdrop.removeAttribute("aria-hidden");
        backdrop.removeAttribute("tabindex");
      }
      iframe.setAttribute("aria-hidden", "true");
    }

    function onMessage(e) {
      if (e.source !== iframe.contentWindow) return;
      var data;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch (_) {
        return;
      }
      if (!data || typeof data !== "object" || !data.event) return;
      // Only swap on a real YouTube player error — never on a timeout. Without
      // the IFrame API + origin param, onStateChange/onReady often never fire,
      // so timing-based fallbacks falsely replace working trailers with backdrops.
      if (data.event === "onError") fail();
    }

    window.addEventListener("message", onMessage);
  });
})();
