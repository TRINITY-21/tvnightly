// Play trailers + clips in an on-page modal instead of bouncing to YouTube.
// Progressive enhancement: every trigger is a real youtube.com link, so with
// JS off the thumbnail still opens the video in a new tab.
(function () {
  var triggers = [].slice.call(document.querySelectorAll("[data-video-key]"));
  if (!triggers.length) return;

  var modal = null;
  var frameWrap = null;
  var lastFocus = null;

  function build() {
    modal = document.createElement("div");
    modal.className = "vid-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Video player");
    modal.innerHTML =
      '<div class="vid-modal-stage"><div class="vid-modal-frame"></div></div>' +
      '<button type="button" class="vid-modal-close" aria-label="Close video">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>";
    document.body.appendChild(modal);
    frameWrap = modal.querySelector(".vid-modal-frame");
    modal.querySelector(".vid-modal-close").addEventListener("click", close);
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.classList.contains("vid-modal-stage")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (modal.classList.contains("open") && e.key === "Escape") close();
    });
  }

  function open(key, name) {
    // only ever embed a real 11-char YouTube id — defense-in-depth so nothing
    // unexpected can be concatenated into the iframe src.
    if (!/^[\w-]{11}$/.test(key || "")) return;
    if (!modal) build();
    var f = document.createElement("iframe");
    f.src =
      "https://www.youtube-nocookie.com/embed/" + key + "?autoplay=1&rel=0";
    f.title = name || "Video";
    f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    f.setAttribute("allowfullscreen", "");
    frameWrap.innerHTML = "";
    frameWrap.appendChild(f);
    lastFocus = document.activeElement;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    modal.querySelector(".vid-modal-close").focus();
  }

  function close() {
    if (!modal) return;
    modal.classList.remove("open");
    document.body.style.overflow = "";
    frameWrap.innerHTML = ""; // tear down the iframe so playback stops
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  triggers.forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      open(a.getAttribute("data-video-key"), a.getAttribute("data-video-name"));
    });
  });
})();
