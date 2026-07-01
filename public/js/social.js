// Social hub — one surface for images, video & links.
// Reads the moments feed (embedded JSON), lets you switch card format + platform,
// copy the value / poll caption + UTM link, batch-copy the whole week, and search
// any title to spin up a post package on the fly. No posting — clipboard + download.
(function () {
  var root = document.querySelector(".soc");
  if (!root) return;

  var data = {};
  try {
    data = JSON.parse(document.getElementById("soc-data").textContent || "{}");
  } catch (e) {}

  var state = { id: root.getAttribute("data-first") || null, fmt: "story", plat: "tiktok", style: "poster", vs: null, season: null };
  var TV_STYLES = ["ratings", "heatmap", "pin", "vs"];
  var PLAT_CODE = { tiktok: "tt", instagram: "ig", x: "x", youtube: "yt", pinterest: "pin", whatsapp: "wa", facebook: "fb" };
  var socVs = document.getElementById("soc-vs");
  var vsQ = document.getElementById("soc-vs-q");
  var vsResults = document.getElementById("soc-vs-results");
  var seasonWrap = document.getElementById("soc-season-wrap");
  var seasonSel = document.getElementById("soc-season");
  var seasonsCache = {};

  var img = document.getElementById("soc-img");
  var dl = document.getElementById("soc-dl");
  var openLink = document.getElementById("soc-open");
  var capA = document.getElementById("soc-cap-a");
  var capB = document.getElementById("soc-cap-b");
  var linkI = document.getElementById("soc-link");
  var platNote = document.getElementById("soc-plat-note");
  var canvas = root.querySelector(".soc-canvas");
  var qBox = document.getElementById("soc-q");
  var results = document.getElementById("soc-results");

  function post() {
    return state.id ? data[state.id] : null;
  }
  function firstUrl(s) {
    var m = (s || "").match(/https?:\/\/\S+/);
    return m ? m[0] : "";
  }
  function slug(s) {
    return (s || "post").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  function styleAvailable(p, s) {
    return s === "poster" ? true : !!(p && p.hasRatings && p.slug);
  }
  function populateSeasons(d) {
    if (!seasonSel || !d) return;
    seasonSel.innerHTML = "";
    (d.seasons || []).forEach(function (s) {
      var o = document.createElement("option");
      o.value = String(s);
      o.textContent = "Season " + s;
      seasonSel.appendChild(o);
    });
    if ((d.seasons || []).indexOf(state.season) < 0) state.season = d.latest;
    if (state.season != null) seasonSel.value = String(state.season);
  }
  function ensureSeasons() {
    var p = post();
    if (!p) return render();
    var ck = p.slug || (p.tmdbId != null ? "t" + p.tmdbId : "");
    if (!ck) return render();
    if (seasonsCache[ck]) {
      populateSeasons(seasonsCache[ck]);
      return render();
    }
    fetch("/admin/social/seasons?slug=" + encodeURIComponent(p.slug || "") + (p.tmdbId != null ? "&tmdbId=" + p.tmdbId : ""))
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        seasonsCache[ck] = d;
        populateSeasons(d);
        render();
      })
      .catch(function () {
        render();
      });
  }
  function camelTag(s) {
    return (s || "").replace(/[^a-zA-Z0-9]+/g, "");
  }
  function vsCaption(p, plat, variant) {
    if (!state.vs) return "";
    var link = location.origin + "/r/" + (PLAT_CODE[plat] || "x") + "/compare/" + p.slug + "-vs-" + state.vs.slug;
    var tags = "#TVNightly #WhatToWatch #" + camelTag(p.title) + " #" + camelTag(state.vs.name);
    return variant === "b"
      ? "⚔️ " + p.title + " vs " + state.vs.name + "\n\nVote below — which one actually wins? 👇\n\n" + link + "\n\n" + tags
      : "⚔️ " + p.title + " vs " + state.vs.name + " — which is actually better? The episode ratings settle it.\n\n" + link + "\n\n" + tags;
  }

  function render() {
    var p = post();
    if (!p) return;
    // show the TV-only styles when the subject supports them; fall back otherwise
    TV_STYLES.forEach(function (s) {
      var btn = root.querySelector('.soc-style-b[data-style="' + s + '"]');
      if (btn) btn.hidden = !styleAvailable(p, s);
    });
    if (!styleAvailable(p, state.style)) {
      state.style = "poster";
      setActive(".soc-style-b", root.querySelector('.soc-style-b[data-style="poster"]'));
    }
    if (socVs) socVs.hidden = state.style !== "vs";
    if (seasonWrap) seasonWrap.hidden = state.style !== "ratings";

    var st = state.style;
    var tq = p.tmdbId != null ? "&tmdbId=" + p.tmdbId : ""; // tmdbId lets the route fall back to live TMDB
    var sg = encodeURIComponent(p.slug || "");
    var cardUrl;
    if (st === "ratings")
      cardUrl = "/admin/social/ratings.png?slug=" + sg + tq + (state.season != null ? "&season=" + state.season : "") + "&fmt=" + state.fmt;
    else if (st === "heatmap") cardUrl = "/admin/social/heatmap.png?slug=" + sg + tq + "&fmt=" + state.fmt;
    else if (st === "pin") cardUrl = "/admin/social/similar.png?slug=" + sg + tq + "&fmt=" + state.fmt;
    else if (st === "vs" && state.vs)
      cardUrl =
        "/admin/social/vs.png?slug=" +
        sg +
        tq +
        "&vs=" +
        encodeURIComponent(state.vs.slug) +
        (state.vs.tmdbId != null ? "&vsTmdbId=" + state.vs.tmdbId : "") +
        "&fmt=" +
        state.fmt;
    else cardUrl = "/admin/social/promo.png?" + p.cardQuery + "&fmt=" + state.fmt; // poster, or VS awaiting opponent

    img.src = cardUrl;
    dl.href = cardUrl;
    dl.setAttribute("download", "tvnightly-" + slug(p.title) + "-" + st + "-" + state.fmt + ".png");
    openLink.href = p.path || "/";
    if (canvas) canvas.setAttribute("data-fmt", state.fmt);

    var a, b;
    if (st === "vs") {
      a = vsCaption(p, state.plat, "a");
      b = vsCaption(p, state.plat, "b");
    } else {
      var setA = st === "ratings" || st === "heatmap" ? p.r : st === "pin" ? p.sim : p.a;
      if (!setA) setA = p.a;
      a = (setA && setA[state.plat]) || "";
      b = (p.b && p.b[state.plat]) || "";
    }
    capA.value = a;
    capB.value = b;
    linkI.value = firstUrl(a) || firstUrl(b);
  }

  function setActive(sel, btn) {
    root.querySelectorAll(sel).forEach(function (b) {
      b.classList.toggle("on", b === btn);
    });
  }

  // card style toggle
  root.querySelectorAll(".soc-style-b").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.style = btn.getAttribute("data-style");
      setActive(".soc-style-b", btn);
      if (state.style === "ratings") ensureSeasons();
      else render();
    });
  });
  if (seasonSel) {
    seasonSel.addEventListener("change", function () {
      state.season = Number(seasonSel.value) || null;
      render();
    });
  }

  // format tabs
  root.querySelectorAll(".soc-fmt-b").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.fmt = btn.getAttribute("data-fmt");
      setActive(".soc-fmt-b", btn);
      render();
    });
  });

  // platform tabs
  root.querySelectorAll(".soc-plat-b").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.plat = btn.getAttribute("data-plat");
      setActive(".soc-plat-b", btn);
      if (platNote) platNote.textContent = btn.getAttribute("data-note") || "";
      render();
    });
  });

  // moment feed
  root.querySelectorAll(".soc-item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-id");
      if (!data[id]) return;
      state.id = id;
      state.season = null;
      setActive(".soc-item", btn);
      if (state.style === "ratings") ensureSeasons();
      else render();
    });
  });

  // copy + batch (event-delegated)
  function copy(text, btn) {
    if (!navigator.clipboard || !text) return;
    navigator.clipboard.writeText(text).then(function () {
      var o = btn.getAttribute("data-orig") || btn.textContent;
      btn.setAttribute("data-orig", o);
      btn.textContent = "✓ Copied";
      setTimeout(function () {
        btn.textContent = o;
      }, 1400);
    });
  }
  root.addEventListener("click", function (e) {
    var c = e.target.closest("[data-copy]");
    if (c) {
      var k = c.getAttribute("data-copy");
      copy(k === "a" ? capA.value : k === "b" ? capB.value : linkI.value, c);
      return;
    }
    var bt = e.target.closest("[data-batch]");
    if (bt) {
      var variant = bt.getAttribute("data-batch");
      var out = [];
      Object.keys(data).forEach(function (id) {
        var caps = variant === "a" ? data[id].a : data[id].b;
        if (caps && caps[state.plat]) out.push(caps[state.plat]);
      });
      if (out.length) copy(out.join("\n\n———\n\n"), bt);
    }
  });

  // search → package
  var timer;
  function searchNow(q) {
    fetch("/admin/social/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: q }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        renderResults(d.subjects || []);
      })
      .catch(function () {});
  }
  function renderResults(subs) {
    results.innerHTML = "";
    if (!subs.length) {
      results.hidden = true;
      return;
    }
    subs.slice(0, 8).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "soc-res";
      b.innerHTML =
        (s.posterUrl ? '<img src="' + s.posterUrl + '" alt="">' : '<span class="soc-res-blank"></span>') +
        '<span class="soc-res-main"><span class="soc-res-t"></span><span class="soc-res-s"></span></span>';
      b.querySelector(".soc-res-t").textContent = s.label;
      b.querySelector(".soc-res-s").textContent = s.sublabel || "";
      b.addEventListener("click", function () {
        pickSubject(s);
      });
      results.appendChild(b);
    });
    results.hidden = false;
  }
  function pickSubject(s) {
    fetch("/admin/social/package", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d.post) return;
        data[d.post.id] = d.post;
        state.id = d.post.id;
        state.season = null;
        results.hidden = true;
        qBox.value = "";
        setActive(".soc-item", null);
        if (state.style === "ratings") ensureSeasons();
        else render();
      })
      .catch(function () {});
  }
  if (qBox) {
    qBox.addEventListener("input", function () {
      clearTimeout(timer);
      var q = qBox.value.trim();
      if (q.length < 2) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      timer = setTimeout(function () {
        searchNow(q);
      }, 260);
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".soc-search")) results.hidden = true;
    });
  }

  // VS opponent picker (TV only) — reuses the search endpoint
  if (vsQ) {
    var vsTimer;
    vsQ.addEventListener("input", function () {
      clearTimeout(vsTimer);
      var q = vsQ.value.trim();
      if (q.length < 2) {
        vsResults.hidden = true;
        vsResults.innerHTML = "";
        return;
      }
      vsTimer = setTimeout(function () {
        fetch("/admin/social/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: q }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (d) {
            renderVsResults((d.subjects || []).filter(function (s) {
              return s.kind === "tv";
            }));
          })
          .catch(function () {});
      }, 260);
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".soc-vs")) vsResults.hidden = true;
    });
  }
  function renderVsResults(subs) {
    vsResults.innerHTML = "";
    if (!subs.length) {
      vsResults.hidden = true;
      return;
    }
    subs.slice(0, 8).forEach(function (s) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "soc-res";
      btn.innerHTML =
        (s.posterUrl ? '<img src="' + s.posterUrl + '" alt="">' : '<span class="soc-res-blank"></span>') +
        '<span class="soc-res-main"><span class="soc-res-t"></span><span class="soc-res-s"></span></span>';
      btn.querySelector(".soc-res-t").textContent = s.label;
      btn.querySelector(".soc-res-s").textContent = s.sublabel || "";
      btn.addEventListener("click", function () {
        state.vs = { slug: slug(s.label), name: s.label, tmdbId: s.tmdbId != null ? s.tmdbId : null };
        vsResults.hidden = true;
        vsQ.value = s.label;
        render();
      });
      vsResults.appendChild(btn);
    });
    vsResults.hidden = false;
  }

  // ---- card → short video (beat-synced) for TikTok / YouTube -----------------
  // Draws the current card onto a canvas with a Ken-Burns push-in, an intro fade,
  // a light sheen sweep, a vignette, and a scale "pop" driven by the live audio
  // (real AnalyserNode) — then records the canvas + /audio2.mp3 via MediaRecorder.
  // MP4 when the browser can (TikTok-ready), else WebM (fine for YouTube).
  (function initVideo() {
    var btn = document.getElementById("soc-mp4");
    if (!btn) return;
    var vidEl = document.getElementById("soc-vid");
    var vidDl = document.getElementById("soc-vid-dl");
    var status = document.getElementById("soc-vid-status");
    // absolute origin (never the credentialed page URL) so fetch() can't be blocked
    var AUDIO_URL = location.origin + "/audio2.mp3";
    var busy = false;
    var audioBuf = null; // decoded once, reused
    var lastUrl = null;
    var idle = status ? status.textContent : "";

    var canRecord =
      typeof window.MediaRecorder !== "undefined" &&
      !!document.createElement("canvas").captureStream &&
      !!(window.AudioContext || window.webkitAudioContext);
    if (!canRecord) {
      btn.disabled = true;
      btn.title = "This browser can't record canvas video — use Chrome.";
      return;
    }

    function pickMime() {
      var cands = [
        "video/mp4;codecs=avc1.640028,mp4a.40.2",
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      for (var i = 0; i < cands.length; i++) if (MediaRecorder.isTypeSupported(cands[i])) return cands[i];
      return "";
    }
    function loadImage(src) {
      return new Promise(function (res, rej) {
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = rej;
        im.src = src;
      });
    }
    function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function band(arr, a, b) { var s = 0; for (var i = a; i < b; i++) s += arr[i]; return s / (b - a); }
    function say(msg) { if (status) status.textContent = msg; }

    function fail(msg) {
      busy = false;
      btn.disabled = false;
      btn.textContent = "🎬 Make a video";
      say(msg || idle);
    }

    btn.addEventListener("click", function () {
      if (busy) return;
      var p = post();
      if (!p) return;
      busy = true;
      btn.disabled = true;
      btn.textContent = "⏳ Rendering… 0%";
      say("Rendering — keep this tab open…");

      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      var audioP = audioBuf
        ? Promise.resolve(audioBuf)
        : fetch(AUDIO_URL)
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (b) { return new Promise(function (res, rej) { ctx.decodeAudioData(b, res, rej); }); })
            .then(function (buf) { audioBuf = buf; return buf; });

      Promise.all([loadImage(img.src), audioP])
        .then(function (a) { record(ctx, a[0], a[1], p); })
        .catch(function () { try { ctx.close(); } catch (e) {} fail("Couldn't build the video — try again."); });
    });

    function record(ctx, imEl, buf, p) {
      var CW = imEl.naturalWidth || 1080;
      var CH = imEl.naturalHeight || 1920;
      var cv = document.createElement("canvas");
      cv.width = CW;
      cv.height = CH;
      var g = cv.getContext("2d");
      g.fillStyle = "#0e0e11";
      g.fillRect(0, 0, CW, CH);
      var DUR = Math.min(buf.duration, 12);

      // audio graph: source → gain → (analyser tap, recorder dest, speakers)
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var gain = ctx.createGain();
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      var freq = new Uint8Array(analyser.frequencyBinCount);
      var dest = ctx.createMediaStreamDestination();
      src.connect(gain);
      gain.connect(analyser);
      gain.connect(dest);
      gain.connect(ctx.destination);
      var t0 = ctx.currentTime + 0.06;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + 0.15);
      gain.gain.setValueAtTime(1, t0 + DUR - 0.5);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + DUR);

      var mixed = new MediaStream();
      cv.captureStream(30).getVideoTracks().forEach(function (t) { mixed.addTrack(t); });
      dest.stream.getAudioTracks().forEach(function (t) { mixed.addTrack(t); });

      var mime = pickMime();
      var ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
      var rec;
      try {
        rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 9000000 } : { videoBitsPerSecond: 9000000 });
      } catch (e) { try { ctx.close(); } catch (e2) {} return fail("Recorder unavailable in this browser."); }
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        try { ctx.close(); } catch (e) {}
        finish(new Blob(chunks, { type: mime || "video/webm" }), ext, p);
      };

      var energy = 0;
      var startMs = performance.now();
      function frame(now) {
        var t = (now - startMs) / 1000;
        var prog = Math.min(1, t / DUR);
        analyser.getByteFrequencyData(freq);
        energy += (band(freq, 1, 10) / 255 - energy) * 0.4; // low band ~ kick/beat

        var s = 1.05 + 0.07 * ease(prog) + (t < 0.5 ? (1 - t / 0.5) * 0.1 : 0) + 0.035 * energy;
        var dw = CW * s, dh = CH * s;
        g.drawImage(imEl, (CW - dw) / 2, (CH - dh) / 2, dw, dh);

        if (t > 0.45 && t < 1.75) { // one diagonal sheen sweep
          var sp = (t - 0.45) / 1.3;
          var x = -CW * 0.4 + sp * (CW * 1.6);
          var lg = g.createLinearGradient(x, 0, x + CW * 0.45, CH);
          lg.addColorStop(0, "rgba(255,255,255,0)");
          lg.addColorStop(0.5, "rgba(255,246,230," + 0.14 * Math.sin(sp * Math.PI) + ")");
          lg.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = lg;
          g.fillRect(0, 0, CW, CH);
        }
        var vg = g.createRadialGradient(CW / 2, CH / 2, CH * 0.32, CW / 2, CH / 2, CH * 0.72);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.26)");
        g.fillStyle = vg;
        g.fillRect(0, 0, CW, CH);
        if (t < 0.5) { g.fillStyle = "rgba(14,14,17," + (1 - t / 0.5) + ")"; g.fillRect(0, 0, CW, CH); }
        if (prog > 0.93) { g.fillStyle = "rgba(14,14,17," + (prog - 0.93) / 0.07 + ")"; g.fillRect(0, 0, CW, CH); }

        btn.textContent = "⏳ Rendering… " + Math.round(prog * 100) + "%";
        if (t < DUR) requestAnimationFrame(frame);
      }

      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      rec.start();
      src.start();
      requestAnimationFrame(frame);
      setTimeout(function () {
        try { if (rec.state !== "inactive") rec.stop(); } catch (e) {}
        try { src.stop(); } catch (e) {}
      }, DUR * 1000 + 150);
    }

    function finish(blob, ext, p) {
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      var name = "tvnightly-" + slug(p.title) + "-" + state.style + "-" + state.fmt + "." + ext;
      if (vidEl) {
        vidEl.src = lastUrl;
        vidEl.hidden = false;
        vidEl.muted = true;
        vidEl.play().catch(function () {});
        img.style.display = "none";
      }
      if (vidDl) {
        vidDl.href = lastUrl;
        vidDl.setAttribute("download", name);
        vidDl.hidden = false;
      }
      var a = document.createElement("a"); // also auto-save
      a.href = lastUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();

      busy = false;
      btn.disabled = false;
      btn.textContent = "🎬 Make another";
      say("Saved " + name + (ext === "mp4" ? " — ready to upload." : " (WebM: great on YouTube; convert to MP4 for TikTok)."));
    }

    // switching card/format/style resets the preview back to the still image
    img.addEventListener("load", function () {
      if (vidEl && !vidEl.hidden) { vidEl.hidden = true; vidEl.pause(); }
      img.style.display = "";
      if (vidDl) vidDl.hidden = true;
      if (!busy) say(idle);
    });
  })();

  render();
})();
