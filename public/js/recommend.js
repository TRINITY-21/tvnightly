/* /recommend enhancements (progressive — every screen works without JS):
   1. the enrich deck advances one card per tap (gold flash, dots, background
      record) instead of a full page load per rating;
   2. "copy your taste link".
   Without JS: each deck card is a real POST the server advances, and the copy
   button is simply inert. */
(function () {
  "use strict";

  // ---- 0. landing typeahead — picking a suggestion goes straight to rate ---
  (function typeahead() {
    var form = document.querySelector("form.rec-search");
    if (!form) return;
    var input = form.querySelector('input[type="search"]');
    var field = form.querySelector(".rec-search-field");
    if (!input || !field) return;
    var ratedEl = form.querySelector('input[name="rated"]');
    var ratedQS = ratedEl && ratedEl.value ? "&rated=" + encodeURIComponent(ratedEl.value) : "";

    var box = document.createElement("div");
    box.className = "ta-box";
    box.hidden = true;
    box.setAttribute("role", "listbox");
    field.appendChild(box);
    var active = -1, timer;

    function close() { box.hidden = true; active = -1; }
    function rows() { return box.querySelectorAll("a.ta-row"); }
    function setActive(i) {
      var l = rows();
      if (!l.length) return;
      if (active >= 0 && l[active]) l[active].classList.remove("ta-active");
      active = ((i % l.length) + l.length) % l.length;
      l[active].classList.add("ta-active");
    }
    function render(items) {
      box.innerHTML = "";
      active = -1;
      var any = false;
      items.forEach(function (it) {
        if (!it.ref || it.kind === "person") return; // only ratable titles
        any = true;
        var a = document.createElement("a");
        a.className = "ta-row";
        a.setAttribute("role", "option");
        a.href = "/recommend?kind=" + it.kind + "&ref=" + encodeURIComponent(it.ref) + ratedQS;
        if (it.poster) {
          var img = document.createElement("img");
          img.className = "ta-thumb"; img.src = it.poster; img.alt = ""; img.width = 30; img.height = 44; img.loading = "lazy";
          a.appendChild(img);
        } else {
          var blank = document.createElement("span"); blank.className = "ta-thumb ta-thumb-blank"; a.appendChild(blank);
        }
        var main = document.createElement("span"); main.className = "ta-main";
        var nm = document.createElement("span"); nm.className = "ta-name"; nm.textContent = it.name;
        var mt = document.createElement("span"); mt.className = "ta-meta";
        mt.textContent = (it.kind === "movie" ? "Movie" : "TV show") + (it.year ? " · " + it.year : "");
        main.appendChild(nm); main.appendChild(mt); a.appendChild(main);
        if (it.rating != null) {
          var r = document.createElement("span"); r.className = "ta-rating"; r.innerHTML = '<svg class="rating-star" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.74 5.55 6.13.9-4.44 4.32 1.05 6.11L12 16.69l-5.48 2.79 1.05-6.11L3.13 9.05l6.13-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg> ' + Number(it.rating).toFixed(1);
          a.appendChild(r);
        }
        box.appendChild(a);
      });
      box.hidden = !any;
    }

    // a brief spinner row while /api/search is in flight — same .ta-loading
    // affordance the global typeahead uses, so all three pickers match
    function showLoading() {
      box.innerHTML = "";
      active = -1;
      var row = document.createElement("div");
      row.className = "ta-loading";
      var sp = document.createElement("span");
      sp.className = "spinner spinner-sm";
      sp.setAttribute("role", "status");
      sp.setAttribute("aria-label", "Searching");
      var txt = document.createElement("span");
      txt.textContent = "Searching…";
      row.appendChild(sp); row.appendChild(txt);
      box.appendChild(row);
      box.hidden = false;
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { close(); return; }
      timer = setTimeout(function () {
        showLoading();
        fetch("/api/search?q=" + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (items) { if (input.value.trim() === q) render(items); })
          .catch(close);
      }, 200);
    });
    input.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); window.location.href = rows()[active].href; }
      else if (e.key === "Escape") { close(); }
    });
    document.addEventListener("click", function (e) {
      if (e.target !== input && !box.contains(e.target)) close();
    });
  })();

  // ---- 1. enrich deck --------------------------------------------------
  (function deck() {
    var root = document.querySelector(".rec-deck");
    if (!root) return;
    var cards = Array.prototype.slice.call(root.querySelectorAll(".rec-deck-card"));
    var skip = document.querySelector(".rec-skip");
    var prog = document.querySelector(".rec-prog");
    if (!cards.length) return;

    var target = parseInt(root.getAttribute("data-target"), 10) || 4;
    var trail = (root.getAttribute("data-rated") || "").split(",").filter(Boolean);
    var idx = 0;
    var busy = false;

    function synthHref() { return "/recommend?step=synth&rated=" + encodeURIComponent(trail.join(",")); }

    function refresh() {
      if (skip) skip.setAttribute("href", synthHref());
      if (prog) {
        prog.style.setProperty("--done", String(trail.length));
        var count = prog.querySelector(".rec-prog-count");
        if (count) count.textContent = Math.round((trail.length / target) * 100) + "%";
        var text = prog.querySelector(".rec-prog-text");
        if (text) text.textContent = "Calculating your taste...";
      }
      // undo pops to the prior deck state — or, for the first rating, back to that
      // title's own rate card (parsed from the trail entry kind:ref:verdict)
      var undoHref;
      if (trail.length > 1) {
        undoHref = "/recommend?step=enrich&rated=" + encodeURIComponent(trail.slice(0, -1).join(","));
      } else if (trail.length === 1) {
        var p = trail[0].split(":");
        undoHref = "/recommend?kind=" + p[0] + "&ref=" + p[1];
      } else {
        undoHref = "/recommend";
      }
      var undos = root.querySelectorAll(".rec-undo");
      for (var u = 0; u < undos.length; u++) undos[u].setAttribute("href", undoHref);
    }
    refresh();

    function swapBg() {
      var bg = document.querySelector(".rec-bg");
      var im = cards[idx] && cards[idx].querySelector(".rec-poster img");
      if (bg && im) bg.style.backgroundImage = "url(" + im.src + ")";
    }

    // Target reached: fill the bar and hand off to the synth interstitial, which
    // frames the "thinking" moment (and itself advances to the real match).
    function goSynth() {
      var href = synthHref();
      if (prog) prog.style.setProperty("--done", String(target));
      var room = document.querySelector(".rec-room");
      if (!room) { window.location.href = href; return; }
      room.style.transition = "opacity .24s ease";
      room.style.opacity = "0";
      setTimeout(function () { window.location.href = href; }, 220);
    }

    function record(kind, ref, verdict) {
      var fd = new FormData();
      fd.append("kind", kind); fd.append("ref", ref); fd.append("verdict", verdict); fd.append("ajax", "1");
      fetch("/recommend", { method: "POST", body: fd }).catch(function () {});
    }

    function advance() {
      idx++;
      if (trail.length >= target || idx >= cards.length) { goSynth(); return; }
      cards[idx].hidden = false;
      swapBg();
      busy = false;
    }

    root.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      var card = e.target.closest(".rec-deck-card");
      if (!card || card.hidden) return;
      var btn = e.submitter || card.querySelector(".rate-circle:focus");
      if (!btn) return;
      busy = true;
      var kind = card.getAttribute("data-kind");
      var ref = card.getAttribute("data-ref");
      var verdict = btn.getAttribute("data-verdict");
      btn.classList.add("is-picked");
      var fan = card.querySelector(".rate-fan");
      if (fan) fan.classList.add("has-pick"); // the chosen circle is the only glow
      // stamp a tiny verdict chip on the poster before we slide on
      var poster = card.querySelector(".rec-poster");
      if (poster && !poster.querySelector(".rec-verdict-chip")) {
        var chip = document.createElement("span");
        chip.className = "rec-verdict-chip v-" + verdict;
        chip.textContent = (btn.textContent || "").trim();
        poster.appendChild(chip);
      }
      var key = kind + ":" + ref;
      if (!trail.some(function (t) { return t.indexOf(key + ":") === 0; })) trail.push(key + ":" + verdict);
      record(kind, ref, verdict);
      refresh();
      // hold so the chip reads, deal the card out, then bring on the next
      setTimeout(function () {
        card.classList.add("is-leaving");
        setTimeout(function () {
          card.hidden = true;
          card.classList.remove("is-leaving");
          advance();
        }, 340);
      }, 700);
    });

    // "Haven't seen" — skip THIS title to the next card (no rating recorded);
    // stamps a neutral "Skipped" chip on the poster, just like a verdict tap,
    // then slides on. Out of cards → create the profile with what we have.
    if (skip) {
      skip.addEventListener("click", function (e) {
        e.preventDefault();
        if (busy) return;
        busy = true;
        var card = cards[idx];
        var poster = card && card.querySelector(".rec-poster");
        if (poster && !poster.querySelector(".rec-verdict-chip")) {
          var chip = document.createElement("span");
          chip.className = "rec-verdict-chip v-skip";
          chip.textContent = "Skipped";
          poster.appendChild(chip);
        }
        setTimeout(function () {
          card.hidden = true;
          advance();
        }, 700);
      });
    }

    // keyboard: 1–4 = the four circles, worst→best
    document.addEventListener("keydown", function (e) {
      if (busy) return;
      var n = ["1", "2", "3", "4"].indexOf(e.key);
      if (n < 0) return;
      var pills = cards[idx].querySelectorAll(".rate-circle");
      // focus before click so the e.submitter fallback (.rate-circle:focus)
      // resolves on browsers without SubmitEvent.submitter (Safari < 15.4)
      if (pills[n]) { e.preventDefault(); pills[n].focus(); pills[n].click(); }
    });
  })();

  // ---- 1b. synth interstitial: let the gather animation play, then reveal the
  //      match a touch sooner than the no-JS meta-refresh fallback ----
  (function synth() {
    var el = document.querySelector(".rec-synth");
    if (!el) return;
    var href = el.getAttribute("data-results");
    if (!href) return;
    setTimeout(function () { window.location.href = href; }, 2700);
  })();

  // ---- 2. copy + share taste profile links ---------------------------
  (function copyLink() {
    function bindCopy(btn, getUrl) {
      if (!btn) return;
      var original = btn.textContent;
      btn.addEventListener("click", function () {
        var url = getUrl();
        var done = function () {
          btn.textContent = btn.getAttribute("data-copied") || "Copied";
          btn.classList.add("is-copied");
          setTimeout(function () {
            btn.textContent = original;
            btn.classList.remove("is-copied");
          }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done).catch(done);
        } else {
          var t = document.createElement("textarea");
          t.value = url;
          document.body.appendChild(t);
          t.select();
          try {
            document.execCommand("copy");
          } catch (e) {}
          document.body.removeChild(t);
          done();
        }
      });
    }
    document.querySelectorAll(".rec-copy-taste").forEach(function (btn) {
      bindCopy(btn, function () {
        return btn.getAttribute("data-url") || window.location.href;
      });
    });
    bindCopy(document.querySelector(".rec-copy"), function () {
      var btn = document.querySelector(".rec-copy");
      return (btn && btn.getAttribute("data-url")) || window.location.href;
    });
  })();

  (function shareProfile() {
    document.querySelectorAll(".rec-profile-share").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var url = btn.getAttribute("data-share-url");
        var title = btn.getAttribute("data-share-title") || "My TV taste profile";
        if (!url) return;
        if (navigator.share) {
          navigator.share({ title: title, url: url }).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url);
          btn.textContent = "Link copied";
          setTimeout(function () {
            btn.textContent = "Share your profile";
          }, 1800);
        }
      });
    });
  })();
})();
