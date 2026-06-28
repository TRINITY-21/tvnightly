// Inline hero trailer player. The server hands each hero an ORDERED list of
// candidate YouTube ids (playable-first when known). This plays the first one
// immediately (optimistic — a good trailer never waits on, or is hidden by, our
// detection) and only reacts to a DEFINITIVE failure: on a YouTube onError it
// advances to the next candidate; once every candidate has firmly errored it
// gives up. A working trailer is NEVER torn down.
//
// On the homepage marquee (a [data-hero-rank] section) "giving up" first tries
// to swap the WHOLE hero to the next trending show via /api/hero — only if that
// runs out do we reveal the title's backdrop.
//
// Detection uses YouTube's iframe postMessage protocol (enablejsapi=1). The key
// fix over the original was sending the `listening` HANDSHAKE — without it
// YouTube never delivers onError/onStateChange, so geo-blocks went uncaught. We
// advance by swapping iframe.src (not the JS API) so the live candidate survives
// the hero-pip reparent (which reloads iframes).
(function () {
  var WIN = 6500; // per-candidate verification window (ms)
  var triedShows = []; // tmdb ids already shown+failed, so a cache reshuffle can't re-show them

  function buildUrl(key) {
    var origin = "";
    try {
      origin = "&origin=" + encodeURIComponent(location.origin);
    } catch (_) {}
    return (
      "https://www.youtube-nocookie.com/embed/" +
      key +
      "?autoplay=1&mute=1&loop=1&playlist=" +
      key +
      "&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1" +
      origin
    );
  }

  function parseCandidates(container, iframe) {
    var list = [];
    try {
      var raw = container.getAttribute("data-trailer-candidates");
      if (raw) list = JSON.parse(raw);
    } catch (_) {}
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (k) {
      return typeof k === "string" && /^[\w-]{11}$/.test(k);
    });
    if (!list.length && iframe) {
      var m = (iframe.src || "").match(/\/embed\/([\w-]{11})/);
      if (m) list = [m[1]];
    }
    return list;
  }

  function now() {
    try {
      return Date.now();
    } catch (_) {
      return 0;
    }
  }

  function setup(container) {
    var iframe = container.querySelector("iframe");
    if (!iframe) return;
    var candidates = parseCandidates(container, iframe);
    if (!candidates.length) return;

    var hasBackdrop = !!container.querySelector(".hub-hero-video-backdrop-layer");
    // capture the queue/pip ancestors NOW — hero-pip.js reparents the container
    // to <body> while docked, after which closest() can no longer find them
    var rankSection = container.closest("[data-hero-rank]");
    var pipAnchor = container.closest("[data-hero-pip]");
    var idx = 0;
    var done = false;
    var watchdog = null;
    var beat = null;
    var deadline = now() + WIN; // absolute, so a hero-pip reload re-arms the REMAINING time

    function post(msg) {
      try {
        if (iframe.contentWindow) iframe.contentWindow.postMessage(JSON.stringify(msg), "*");
      } catch (_) {}
    }
    function handshake() {
      post({ event: "listening", id: "tvn-hero", channel: "widget" });
    }
    function stopTimers() {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (beat) { clearInterval(beat); beat = null; }
    }
    function cleanup() {
      stopTimers();
      window.removeEventListener("message", onMessage);
    }
    function cover() {
      if (hasBackdrop) container.classList.add("is-trailer-loading");
    }
    function reveal() {
      if (done) return;
      done = true;
      cleanup();
      container.classList.remove("is-trailer-loading");
    }
    // The terminal backdrop. Not guarded by `done` — it can be called async
    // after a cross-show swap fails, by which point `done` is already true.
    function realBackdrop() {
      cleanup();
      container.classList.remove("is-trailer-loading");
      if (!hasBackdrop) return; // nothing to fall back to — leave the iframe
      container.classList.add("is-trailer-unavailable");
      if (pipAnchor) pipAnchor.classList.add("is-trailer-unavailable");
      var bd = container.querySelector(".hub-hero-video-backdrop-layer");
      if (bd) {
        bd.removeAttribute("aria-hidden");
        bd.removeAttribute("tabindex");
      }
    }

    // Homepage marquee only: swap the whole hero to the next trending show whose
    // trailers might play. Returns true if a swap is in flight (caller defers the
    // backdrop to the async result). The new section recurses through setup().
    function trySwapShow() {
      var section = rankSection;
      if (!section) return false;
      if (section.getAttribute("data-hero-swapping")) return true; // already in flight
      var rank = parseInt(section.getAttribute("data-hero-rank"), 10);
      if (isNaN(rank)) return false;
      section.setAttribute("data-hero-swapping", "1");
      var tmdb = section.getAttribute("data-hero-tmdb");
      if (tmdb && triedShows.indexOf(tmdb) < 0) triedShows.push(tmdb);
      cover(); // hold the current backdrop up while we fetch — no error flash
      fetch("/api/hero?i=" + (rank + 1) + "&not=" + encodeURIComponent(triedShows.join(",")))
        .then(function (r) {
          return r && r.ok && r.status !== 204 ? r.text() : "";
        })
        .then(function (html) {
          if (!html) { realBackdrop(); return; } // trending list exhausted
          var tmp = document.createElement("div");
          tmp.innerHTML = html;
          var nextSection = tmp.firstElementChild;
          if (!nextSection || !section.parentNode) { realBackdrop(); return; }
          cleanup(); // drop this (now-stale) player before the node goes away
          section.parentNode.replaceChild(nextSection, section);
          var nextContainer = nextSection.querySelector("[data-hero-trailer]");
          if (nextContainer) setup(nextContainer);
        })
        .catch(function () { realBackdrop(); });
      return true;
    }

    function giveUp() {
      if (done) return;
      done = true;
      stopTimers();
      if (trySwapShow()) return; // homepage: try the next trending show first
      realBackdrop();
    }

    // definitive: the current candidate fired a real onError. We only fall back
    // (backdrop / cross-show swap) on a DEFINITIVE failure of the LAST candidate;
    // a merely-quiet last candidate is left playing, never replaced by a poster.
    function next(definitive) {
      if (done) return;
      if (idx + 1 < candidates.length) {
        idx += 1;
        cover();
        deadline = now() + WIN;
        iframe.src = buildUrl(candidates[idx]);
      } else if (definitive) {
        giveUp();
      } else {
        reveal();
      }
    }

    function arm() {
      if (done) return;
      if (watchdog) clearTimeout(watchdog);
      var rem = deadline - now();
      if (rem < 0) rem = 0;
      watchdog = setTimeout(function () { next(false); }, rem);
      if (beat) clearInterval(beat);
      var tries = 0;
      beat = setInterval(function () {
        handshake();
        if (++tries > 14) { clearInterval(beat); beat = null; }
      }, 300);
      handshake();
    }

    function onMessage(e) {
      if (e.source !== iframe.contentWindow) return;
      var d;
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch (_) {
        return;
      }
      if (!d || typeof d !== "object" || !d.event) return;
      if (beat) { clearInterval(beat); beat = null; }
      if (d.event === "onError") {
        next(true);
        return;
      }
      var state =
        d.event === "onStateChange"
          ? d.info
          : d.event === "infoDelivery" && d.info
            ? d.info.playerState
            : undefined;
      if (state === 1 || state === 3) reveal();
    }

    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", arm); // initial load + every src swap / pip reparent
    arm();
  }

  [].slice.call(document.querySelectorAll("[data-hero-trailer]")).forEach(setup);
})();
