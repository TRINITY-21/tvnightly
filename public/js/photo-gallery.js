// Overview photo gallery — autoplay slideshow with Ken Burns motion + thumbnail rail.
(function () {
  var galleries = [].slice.call(document.querySelectorAll("[data-photo-gallery]"));
  if (!galleries.length) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  galleries.forEach(function (root) {
    var interval = parseInt(root.getAttribute("data-autoplay") || "10000", 10);
    root.style.setProperty("--pg-duration", interval + "ms");

    var main = root.querySelector(".pg-main");
    var counter = root.querySelector(".pg-cur");
    var toggle = root.querySelector(".pg-toggle");
    var capSub = root.querySelector("[data-pg-sub]");
    var progressBar = root.querySelector(".pg-progress-bar");
    var thumbs = [].slice.call(root.querySelectorAll(".pg-thumb"));
    var strip = root.querySelector(".pg-strip");
    var sources = [].slice.call(root.querySelectorAll(".pg-sources [data-src]"));
    if (!main || !sources.length) return;

    var idx = 0;
    var playing = !reduced;
    var timer = null;

    function restartKenBurns() {
      main.classList.remove("pg-animate", "pg-kb-0", "pg-kb-1", "pg-kb-2", "pg-kb-3");
      void main.offsetWidth;
      if (playing && !reduced) {
        main.classList.add("pg-animate", "pg-kb-" + (idx % 4));
      }
    }

    function scrollActiveThumb(scrollThumb) {
      if (!scrollThumb || !strip) return;
      var active = thumbs[idx];
      if (!active) return;
      var sl = strip.scrollLeft;
      var stripW = strip.clientWidth;
      var thumbL = active.offsetLeft;
      var thumbW = active.offsetWidth;
      if (thumbL < sl) strip.scrollLeft = thumbL;
      else if (thumbL + thumbW > sl + stripW) strip.scrollLeft = thumbL + thumbW - stripW;
    }

    function applyMeta(s, scrollThumb) {
      main.alt = s.getAttribute("data-alt") || "";
      if (counter) counter.textContent = String(idx + 1);
      if (capSub) {
        var kind = s.getAttribute("data-kind") || "artwork";
        capSub.textContent =
          (kind === "backdrop" ? "Backdrop" : "Poster") +
          " · " +
          (idx + 1) +
          " of " +
          sources.length;
      }
      thumbs.forEach(function (t, j) {
        var on = j === idx;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
        var thumbKind = sources[j] ? sources[j].getAttribute("data-kind") : null;
        t.classList.toggle("is-backdrop", thumbKind === "backdrop");
      });
      var slideKind = s.getAttribute("data-kind") || "poster";
      root.classList.toggle("is-poster", slideKind !== "backdrop");
      root.classList.toggle("is-backdrop", slideKind === "backdrop");
      scrollActiveThumb(scrollThumb);
    }

    function show(i) {
      idx = ((i % sources.length) + sources.length) % sources.length;
      var s = sources[idx];
      var src = s.getAttribute("data-src");
      if (!src) return;

      main.classList.remove("pg-animate", "pg-kb-0", "pg-kb-1", "pg-kb-2", "pg-kb-3");
      main.style.opacity = "0.35";

      function reveal() {
        main.style.opacity = "1";
        applyMeta(s, true);
        restartKenBurns();
        resetProgress();
      }

      if (main.getAttribute("src") === src) {
        reveal();
        return;
      }

      main.onload = function () {
        main.onload = null;
        reveal();
      };
      main.onerror = function () {
        main.onerror = null;
        reveal();
      };
      main.src = src;
    }

    function resetProgress() {
      if (!progressBar) return;
      if (!playing) {
        progressBar.style.transition = "none";
        progressBar.style.width = "0%";
        return;
      }
      progressBar.style.transition = "none";
      progressBar.style.width = "0%";
      requestAnimationFrame(function () {
        progressBar.style.transition = "width " + interval + "ms linear";
        progressBar.style.width = "100%";
      });
    }

    function clearSchedule() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function schedule() {
      clearSchedule();
      if (!playing) return;
      timer = setTimeout(function () {
        show(idx + 1);
        schedule();
      }, interval);
    }

    function setPlaying(on) {
      playing = on;
      root.classList.toggle("is-paused", !on);
      if (toggle) {
        toggle.setAttribute("data-playing", on ? "true" : "false");
        toggle.setAttribute("aria-label", on ? "Pause slideshow" : "Play slideshow");
      }
      if (on) {
        restartKenBurns();
        resetProgress();
        schedule();
      } else {
        clearSchedule();
        main.classList.remove("pg-animate", "pg-kb-0", "pg-kb-1", "pg-kb-2", "pg-kb-3");
        if (progressBar) {
          progressBar.style.transition = "none";
          progressBar.style.width = "0%";
        }
      }
    }

    thumbs.forEach(function (t) {
      t.addEventListener("click", function () {
        show(parseInt(t.getAttribute("data-index") || "0", 10));
        if (playing) schedule();
      });
    });

    if (toggle) {
      toggle.addEventListener("click", function () {
        setPlaying(!playing);
      });
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              if (playing) {
                restartKenBurns();
                schedule();
              }
            } else {
              clearSchedule();
              main.classList.remove("pg-animate", "pg-kb-0", "pg-kb-1", "pg-kb-2", "pg-kb-3");
            }
          });
        },
        { threshold: 0.2 },
      ).observe(root);
    }

    applyMeta(sources[0], false);
    if (playing) {
      restartKenBurns();
      resetProgress();
      schedule();
    } else {
      setPlaying(false);
    }
  });
})();
