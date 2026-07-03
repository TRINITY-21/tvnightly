// Vertical trailer Shorts — snap-scroll feed, one YouTube trailer per slide.
// Plays the slide in view; mutes by default; share + deep-link via ?v=kind-id.
(function () {
  "use strict";

  var root = document.querySelector("[data-trailer-shorts]");
  if (!root) return;

  var feed = root.querySelector(".ts-feed");
  if (!feed) return;

  var slides = [].slice.call(feed.querySelectorAll("[data-ts-slide]"));
  if (!slides.length) return;

  var muted = true;
  var active = null;
  var globalMutedBtn = null;

  function buildUrl(key, autoplay, mute) {
    var origin = "";
    try {
      origin = "&origin=" + encodeURIComponent(location.origin);
    } catch (_) {}
    return (
      "https://www.youtube-nocookie.com/embed/" +
      key +
      "?autoplay=" +
      (autoplay ? "1" : "0") +
      "&mute=" +
      (mute ? "1" : "0") +
      "&loop=1&playlist=" +
      key +
      "&controls=0&rel=0&modestbranding=1&playsinline=1&enablejsapi=1" +
      origin
    );
  }

  function parseCandidates(slide) {
    var list = [];
    try {
      var raw = slide.getAttribute("data-ts-candidates");
      if (raw) list = JSON.parse(raw);
    } catch (_) {}
    if (!Array.isArray(list)) return [];
    return list.filter(function (k) {
      return typeof k === "string" && /^[\w-]{11}$/.test(k);
    });
  }

  function post(iframe, msg) {
    try {
      if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(JSON.stringify(msg), "*");
    } catch (_) {}
  }

  function pauseSlide(slide) {
    var iframe = slide.querySelector(".ts-video");
    if (!iframe || !iframe.src) return;
    post(iframe, { event: "command", func: "pauseVideo", args: "" });
    slide.classList.remove("is-playing");
  }

  function playSlide(slide) {
    var iframe = slide.querySelector(".ts-video");
    var candidates = parseCandidates(slide);
    if (!iframe || !candidates.length) return;

    var key = candidates[0];
    var needsLoad = !iframe.src || iframe.src.indexOf("/embed/" + key) < 0;
    if (needsLoad) {
      iframe.src = buildUrl(key, true, muted);
    } else {
      post(iframe, { event: "command", func: muted ? "mute" : "unMute", args: "" });
      post(iframe, { event: "command", func: "playVideo", args: "" });
    }
    slide.classList.add("is-playing");
    slide.classList.add("is-loaded");
  }

  function setActive(slide) {
    if (active === slide) return;
    if (active) pauseSlide(active);
    active = slide;
    if (active) {
      playSlide(active);
      syncMuteUi();
      updateProgress();
      updateUrl(active);
    }
  }

  function syncMuteUi() {
    slides.forEach(function (slide) {
      var btn = slide.querySelector("[data-ts-mute]");
      if (!btn) return;
      btn.setAttribute("aria-pressed", muted ? "true" : "false");
      var label = btn.querySelector("[data-ts-mute-label]");
      if (label) label.textContent = muted ? "Unmute" : "Mute";
      var on = btn.querySelector(".ts-icon-mute");
      var off = btn.querySelector(".ts-icon-unmute");
      if (on) on.hidden = !muted;
      if (off) off.hidden = muted;
    });
  }

  function toggleMute() {
    muted = !muted;
    syncMuteUi();
    if (active) {
      var iframe = active.querySelector(".ts-video");
      post(iframe, { event: "command", func: muted ? "mute" : "unMute", args: "" });
    }
  }

  function updateUrl(slide) {
    var id = slide.getAttribute("data-ts-id");
    if (!id) return;
    var url = new URL(location.href);
    if (url.searchParams.get("v") === id) return;
    url.searchParams.set("v", id);
    history.replaceState(null, "", url.pathname + "?" + url.searchParams.toString());
  }

  function flashShare(btn) {
    var label = btn.querySelector(".ts-rail-label");
    if (!label) return;
    var orig = label.getAttribute("data-orig") || label.textContent;
    label.setAttribute("data-orig", orig);
    label.textContent = "Copied!";
    setTimeout(function () {
      label.textContent = orig;
    }, 1600);
  }

  function shareSlide(slide, btn) {
    var url = slide.getAttribute("data-share-url") || location.href;
    var title = slide.getAttribute("data-share-title") || document.title;
    if (navigator.share) {
      navigator.share({ title: title, text: title, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          flashShare(btn);
        },
        function () {
          flashShare(btn);
        },
      );
      return;
    }
    flashShare(btn);
  }

  function togglePlay(slide) {
    var iframe = slide.querySelector(".ts-video");
    if (!iframe || !iframe.src) {
      playSlide(slide);
      return;
    }
    if (slide.classList.contains("is-playing")) {
      post(iframe, { event: "command", func: "pauseVideo", args: "" });
      slide.classList.remove("is-playing");
    } else {
      post(iframe, { event: "command", func: "playVideo", args: "" });
      slide.classList.add("is-playing");
    }
  }

  function updateProgress() {
    slides.forEach(function (slide, i) {
      var bar = slide.querySelector(".ts-progress-fill");
      if (!bar) return;
      var on = slide === active;
      bar.style.height = on ? "100%" : "0%";
      bar.style.opacity = on ? "1" : "0.35";
    });
  }

  // Deep-link to ?v=kind-id on load
  var startId = root.getAttribute("data-start");
  var startSlide = startId ? slides.find(function (s) { return s.getAttribute("data-ts-id") === startId; }) : null;

  if (startSlide && startSlide !== slides[0]) {
    startSlide.scrollIntoView({ block: "start" });
  }

  // Intersection observer — activate the slide mostly in view
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        var best = null;
        var bestRatio = 0;
        entries.forEach(function (entry) {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            best = entry.target;
          }
        });
        if (best && bestRatio >= 0.55) setActive(best);
      },
      { root: feed, threshold: [0.45, 0.55, 0.7, 0.9] },
    );
    slides.forEach(function (s) {
      io.observe(s);
    });
  } else {
    setActive(slides[0]);
  }

  feed.addEventListener("click", function (e) {
    var muteBtn = e.target.closest("[data-ts-mute]");
    if (muteBtn) {
      e.preventDefault();
      toggleMute();
      return;
    }
    var shareBtn = e.target.closest("[data-ts-share]");
    if (shareBtn) {
      e.preventDefault();
      var slide = shareBtn.closest("[data-ts-slide]");
      if (slide) shareSlide(slide, shareBtn);
      return;
    }
    var tap = e.target.closest("[data-ts-tap]");
    if (tap) {
      e.preventDefault();
      var s = tap.closest("[data-ts-slide]");
      if (s) togglePlay(s);
    }
  });

  // Keyboard: space toggles play on active slide
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space" || !active) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "A") return;
    e.preventDefault();
    togglePlay(active);
  });

  syncMuteUi();
})();
