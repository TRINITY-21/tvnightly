// Play trailers + clips in an on-page modal instead of bouncing to YouTube.
// Two kinds of trigger:
//   • [data-video-key]  — a known YouTube id (media-page trailers, the Latest
//     Trailers rail). Progressive enhancement: each is a real youtube.com link,
//     so with JS off the thumbnail still opens the video in a new tab.
//   • [data-trailer-id] — a poster-card play disc that knows only the title's
//     tmdb id + media type; the key is fetched from /api/trailer on click.
// Loaded site-wide via Layout, so it self-disables when a page has no triggers.
(function () {
  var directTriggers = [].slice.call(document.querySelectorAll("[data-video-key]"));
  if (!directTriggers.length && !document.querySelector("[data-trailer-id]")) return;

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

  directTriggers.forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      open(a.getAttribute("data-video-key"), a.getAttribute("data-video-name"));
    });
  });

  // ---- poster-card play discs: fetch the key, then open --------------
  var keyCache = {}; // "type:id" -> key | null (no refetch within a session)

  function flashEmpty(el) {
    el.classList.add("is-empty");
    setTimeout(function () { el.classList.remove("is-empty"); }, 1400);
  }

  function activate(el) {
    if (el.getAttribute("data-busy")) return;
    var type = el.getAttribute("data-trailer-type");
    var id = el.getAttribute("data-trailer-id");
    var name = el.getAttribute("data-trailer-name") || "Trailer";
    var ck = type + ":" + id;
    if (ck in keyCache) {
      if (keyCache[ck]) open(keyCache[ck], name);
      else flashEmpty(el);
      return;
    }
    el.setAttribute("data-busy", "1");
    el.classList.add("is-loading");
    fetch("/api/trailer?type=" + encodeURIComponent(type) + "&id=" + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : { key: null }; })
      .catch(function () { return { key: null }; })
      .then(function (data) {
        el.classList.remove("is-loading");
        el.removeAttribute("data-busy");
        keyCache[ck] = data && data.key ? data.key : null;
        if (keyCache[ck]) open(keyCache[ck], name);
        else flashEmpty(el);
      });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-trailer-id]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    activate(el);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    var el = e.target.closest("[data-trailer-id]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    activate(el);
  });
})();
