// Social-studio client: search wiring (single + the X-vs-Y pair) and the
// 1080x1920 PNG download (same rasterize trick as the chart save — the SVG
// carries its own poster/font data-URIs, so the canvas never taints).
(function () {
  "use strict";
  // escape for BOTH text and attribute contexts. The old textContent trick left
  // quotes intact, which would break out of the src="…" / data-…="…" attributes
  // these strings are interpolated into below.
  function esc(s) {
    return (s == null ? "" : String(s))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Wire a search input to /api/search; calls onPick({slug,kind,name}) on click.
  function attachSearch(input, box, onPick) {
    if (!input || !box) return;
    var timer;
    function hide() {
      box.hidden = true;
      box.innerHTML = "";
    }
    function render(items) {
      if (!items.length) {
        hide();
        return;
      }
      box.innerHTML = items
        .map(function (it) {
          var img = it.poster
            ? '<img src="' + esc(it.poster) + '" alt="" width="34" height="51">'
            : '<span class="ta-blank"></span>';
          return (
            '<a class="ta-row" href="#" data-slug="' +
            esc(it.slug) +
            '" data-kind="' +
            esc(it.kind) +
            '" data-name="' +
            esc(it.name) +
            '">' +
            img +
            '<span class="ta-name">' +
            esc(it.name) +
            (it.year ? ' <span class="ta-year">' + esc(it.year) + "</span>" : "") +
            "</span><span class=\"ta-kind\">" +
            (it.kind === "movie" ? "Movie" : "TV") +
            "</span></a>"
          );
        })
        .join("");
      box.hidden = false;
    }
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) {
        hide();
        return;
      }
      timer = setTimeout(function () {
        fetch("/api/search?q=" + encodeURIComponent(q))
          .then(function (r) {
            return r.json();
          })
          .then(function (items) {
            render(
              items
                .filter(function (it) {
                  return it.kind === "tv" || it.kind === "movie";
                })
                .slice(0, 8),
            );
          })
          .catch(hide);
      }, 200);
    });
    box.addEventListener("click", function (e) {
      var a = e.target.closest("a.ta-row");
      if (!a) return;
      e.preventDefault();
      onPick({
        slug: a.getAttribute("data-slug"),
        kind: a.getAttribute("data-kind"),
        name: a.getAttribute("data-name"),
      });
      hide();
    });
    document.addEventListener("click", function (e) {
      if (e.target !== input && !box.contains(e.target)) hide();
    });
  }

  // preserve the chosen aspect (1:1 / 9:16) across search-driven reloads
  var aspect = new URLSearchParams(window.location.search).get("fmt");
  var aspectQ = aspect ? "&fmt=" + encodeURIComponent(aspect) : "";

  // single search (liked / status / ratings): navigate to that format's preview on pick
  var single = document.getElementById("studio-q");
  if (single) {
    var holder = single.closest("[data-format]");
    var fmt = holder ? holder.getAttribute("data-format") : "liked";
    attachSearch(single, document.getElementById("studio-ta"), function (it) {
      if (fmt === "best-eps" && it.kind !== "tv") return;
      window.location.href =
        "/admin/studio?cat=" +
        encodeURIComponent(fmt) +
        "&slug=" +
        encodeURIComponent(it.slug) +
        "&kind=" +
        encodeURIComponent(it.kind) +
        aspectQ;
    });
  }

  // X vs Y: two searches stored locally, "Generate" navigates with both
  var qa = document.getElementById("studio-qa");
  var qb = document.getElementById("studio-qb");
  if (qa && qb) {
    var pick = { a: null, b: null };
    attachSearch(qa, document.getElementById("studio-taa"), function (it) {
      pick.a = it;
      qa.value = it.name;
    });
    attachSearch(qb, document.getElementById("studio-tab"), function (it) {
      pick.b = it;
      qb.value = it.name;
    });
    var gen = document.getElementById("studio-gen");
    if (gen)
      gen.addEventListener("click", function () {
        if (!pick.a || !pick.b) {
          alert("Pick two titles first.");
          return;
        }
        var target = gen.getAttribute("data-cat") || "vs";
        if (target === "showcase") {
          // dual-poster 4:5 card — shows only, plus optional copy/art overrides
          var hl = document.getElementById("studio-headline");
          var kc = document.getElementById("studio-kicker");
          var art = document.getElementById("studio-art");
          var u =
            "/admin/studio?cat=showcase&a=" +
            encodeURIComponent(pick.a.slug) +
            "&b=" +
            encodeURIComponent(pick.b.slug);
          if (art && art.value) u += "&art=" + encodeURIComponent(art.value);
          if (hl && hl.value.trim()) u += "&headline=" + encodeURIComponent(hl.value.trim());
          if (kc && kc.value.trim()) u += "&kicker=" + encodeURIComponent(kc.value.trim());
          window.location.href = u;
          return;
        }
        window.location.href =
          "/admin/studio?cat=vs&a=" +
          encodeURIComponent(pick.a.slug) +
          "&ka=" +
          encodeURIComponent(pick.a.kind) +
          "&b=" +
          encodeURIComponent(pick.b.slug) +
          "&kb=" +
          encodeURIComponent(pick.b.kind) +
          aspectQ;
      });
  }

  // download the current card as a 1080x1920 PNG
  var dl = document.getElementById("studio-dl");
  var card = document.getElementById("studio-card");
  if (dl && card) {
    dl.addEventListener("click", function () {
      dl.disabled = true;
      var label = dl.textContent;
      dl.textContent = "Rendering…";
      function reset() {
        dl.disabled = false;
        dl.textContent = label;
      }
      fetch(card.src)
        .then(function (r) {
          return r.text();
        })
        .then(function (svgText) {
          // size the canvas from the SVG's own viewBox (cards are 9:16, the
          // ratings graph is its own ratio), at 2x for a crisp export
          var vb = svgText.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
          var vw = vb ? Math.round(+vb[1]) : 1080;
          var vh = vb ? Math.round(+vb[2]) : 1920;
          var url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
          var img = new Image();
          img.onload = function () {
            var canvas = document.createElement("canvas");
            canvas.width = vw * 2;
            canvas.height = vh * 2;
            canvas.getContext("2d").drawImage(img, 0, 0, vw * 2, vh * 2);
            URL.revokeObjectURL(url);
            canvas.toBlob(function (b) {
              if (!b) {
                reset();
                return;
              }
              var fm = card.src.match(/[?&](?:cat|format)=([^&]+)/);
              var a = document.createElement("a");
              a.href = URL.createObjectURL(b);
              a.download = "tvnightly-" + (fm ? fm[1] : "card") + ".png";
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(function () {
                URL.revokeObjectURL(a.href);
              }, 1000);
              reset();
            }, "image/png");
          };
          img.onerror = function () {
            URL.revokeObjectURL(url);
            reset();
          };
          img.src = url;
        })
        .catch(reset);
    });
  }

  // --- studio controls: camera / lighting / mood (single-select) + FX (multi) ---
  function wireSingle(groupId, attr, onPick) {
    var w = document.getElementById(groupId);
    if (!w) return;
    var btns = w.querySelectorAll("[data-" + attr + "]");
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(btns, function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        if (onPick) onPick(b);
      });
    });
  }
  wireSingle("studio-cams", "cam", function (b) {
    var h = document.getElementById("studio-cam-hint");
    if (h) h.textContent = b.getAttribute("data-hint") || "";
  });
  wireSingle("studio-lights", "light");
  wireSingle("studio-moods", "mood");
  (function () {
    var fxBtns = document.querySelectorAll(".studio-fx-btn");
    var count = document.getElementById("studio-fx-count");
    function sync() { if (count) count.textContent = document.querySelectorAll(".studio-fx-btn.on").length + " active"; }
    Array.prototype.forEach.call(fxBtns, function (b) {
      b.addEventListener("click", function () { b.classList.toggle("on"); sync(); });
    });
    var clr = document.getElementById("studio-fx-clear");
    if (clr) clr.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".studio-fx-btn.on"), function (b) { b.classList.remove("on"); });
      sync();
    });
    var range = document.getElementById("studio-intensity");
    var rval = document.getElementById("studio-int-val");
    if (range && rval) range.addEventListener("input", function () { rval.textContent = range.value + "%"; });
  })();

  // read the current control state into a render config (live — re-read per frame)
  function readConfig() {
    function pick(id, attr, dflt) {
      var w = document.getElementById(id);
      var on = w && w.querySelector(".on");
      return on ? on.getAttribute(attr) : dflt;
    }
    var fx = new Set();
    Array.prototype.forEach.call(document.querySelectorAll(".studio-fx-btn.on"), function (b) {
      fx.add(b.getAttribute("data-fx"));
    });
    var durSel = document.getElementById("studio-dur");
    var DUR = (durSel ? parseInt(durSel.value, 10) || 0 : 0) * 1000 || 10000;
    var intEl = document.getElementById("studio-intensity");
    var INT = intEl ? (parseInt(intEl.value, 10) || 100) / 100 : 1;
    var beatSel = document.getElementById("studio-beat");
    var BPM = beatSel ? parseInt(beatSel.value, 10) || 0 : 0;
    return {
      camera: pick("studio-cams", "data-cam", "dolly-fwd"),
      lighting: pick("studio-lights", "data-light", "golden-hour"),
      mood: pick("studio-moods", "data-mood", "emotional"),
      fx: fx,
      DUR: DUR,
      INT: INT,
      BEAT: BPM > 0 ? 60000 / BPM : 0,
    };
  }

  // Build a resolution-independent frame renderer for a canvas context. The same
  // factory powers both the live preview (small canvas, rAF loop) and the MP4
  // export (full-res canvas, frame-by-frame encode) — one source of truth.
  function makeRenderer(ctx, W, H, base) {
    var PLATE = "#0e0e11", AMBER = "#FFA94D", INK = "#F2F5FA";
    var SM = Math.round(W * 0.052), SB = Math.round(H * 0.156), FOOT_Y = H - SB;
    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
    function seg(t, a, b) { return clamp01((t - a) / (b - a)); }
    function outCubic(x) { return 1 - Math.pow(1 - x, 3); }
    function inOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    function outBack(x) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
    function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    var grains = [];
    for (var gi = 0; gi < 6; gi++) {
      var g = document.createElement("canvas"); g.width = g.height = 140;
      var gx = g.getContext("2d"), gid = gx.createImageData(140, 140), gd = gid.data;
      for (var i = 0; i < gd.length; i += 4) { var vv = (Math.random() * 255) | 0; gd[i] = gd[i + 1] = gd[i + 2] = vv; gd[i + 3] = 255; }
      gx.putImageData(gid, 0, 0); grains.push(ctx.createPattern(g, "repeat"));
    }
    var vig = (function () {
      var v = document.createElement("canvas"); v.width = W; v.height = H; var vx = v.getContext("2d");
      var gr = vx.createRadialGradient(W / 2, H * 0.44, H * 0.18, W / 2, H * 0.5, H * 0.74);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.55)");
      vx.fillStyle = gr; vx.fillRect(0, 0, W, H); return v;
    })();
    function mark(cx, cy, s, alpha) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.scale(s, s);
      var w = 128, h = 86, r = 22; ctx.lineWidth = 9; ctx.strokeStyle = INK; ctx.lineJoin = "round";
      rr(-w / 2, -h / 2, w, h, r); ctx.stroke();
      ctx.shadowColor = "rgba(255,169,77,0.8)"; ctx.shadowBlur = 26; ctx.fillStyle = AMBER;
      ctx.beginPath(); ctx.arc(w / 2 - 26, h / 2 - 23, 12.5, 0, 7); ctx.fill(); ctx.restore();
    }

    // ---- camera movement → transform ----
    function camera(id, t, DUR, INT) {
      var p = inOutCubic(seg(t, 1000, DUR - 900)), s = 1, dx = 0, dy = 0, rot = 0;
      switch (id) {
        case "zoom-in": s = 1 + 0.18 * p * INT; break;
        case "zoom-out": s = 1 + 0.18 * (1 - p) * INT; break;
        case "pan-left": s = 1.12; dx = W * 0.06 * INT * (0.5 - p) * 2; break;
        case "pan-right": s = 1.12; dx = -W * 0.06 * INT * (0.5 - p) * 2; break;
        case "tilt-up": s = 1.12; dy = H * 0.05 * INT * (0.5 - p) * 2; break;
        case "tilt-down": s = 1.12; dy = -H * 0.05 * INT * (0.5 - p) * 2; break;
        case "orbit": s = 1.14; dx = W * 0.045 * INT * Math.sin(p * Math.PI); rot = (p - 0.5) * 2 * 1.6 * INT * Math.PI / 180; break;
        case "crane": s = 1.16 - 0.12 * p * INT; dy = H * (0.06 - 0.09 * p) * INT; break;
        case "drone": s = 1.2 - 0.13 * p * INT; dx = W * 0.04 * INT * (p - 0.5) * 2; dy = H * 0.03 * INT * (0.5 - p) * 2; break;
        case "fpv": var pf = clamp01(p * 1.5); s = 1 + 0.24 * outCubic(pf) * INT; rot = Math.sin(t / 280) * 0.7 * INT * Math.PI / 180; dx = Math.sin(t / 210) * W * 0.006 * INT; break;
        case "dolly-fwd": s = 1 + 0.22 * p * INT; break;
        case "dolly-back": s = 1 + 0.22 * (1 - p) * INT; break;
        case "handheld": s = 1.12; dx = (Math.sin(t / 140) + 0.5 * Math.sin(t / 53)) * W * 0.008 * INT; dy = (Math.cos(t / 120) + 0.5 * Math.cos(t / 61)) * H * 0.006 * INT; rot = Math.sin(t / 200) * 0.3 * INT * Math.PI / 180; break;
        case "steadicam": s = 1.12; dx = Math.sin(t / 2600) * W * 0.04 * INT; dy = Math.cos(t / 3000) * H * 0.02 * INT; break;
        default: s = 1 + 0.035 * p * INT; break; // static
      }
      return { s: s, dx: dx, dy: dy, rot: rot };
    }

    // ---- lighting & mood → ctx.filter fragments ----
    function lightingFilter(id) {
      switch (id) {
        case "golden-hour": return "saturate(1.12) brightness(1.04) sepia(0.14)";
        case "sunset": return "saturate(1.16) sepia(0.22) brightness(0.99) contrast(1.05)";
        case "sunrise": return "saturate(1.08) sepia(0.1) brightness(1.08)";
        case "studio": return "brightness(1.05) contrast(1.03)";
        case "soft": return "brightness(1.06) contrast(0.93) saturate(0.98)";
        case "blue-hour": return "brightness(0.9) saturate(1.08) contrast(1.04)";
        case "neon": return "saturate(1.5) contrast(1.1) brightness(1.02)";
        case "moonlight": return "brightness(0.82) saturate(0.88) contrast(1.06)";
        case "dramatic": return "contrast(1.22) saturate(1.05) brightness(0.95)";
        default: return "";
      }
    }
    function moodFilter(id) {
      switch (id) {
        case "inspirational": return "brightness(1.06) saturate(1.04)";
        case "peaceful": return "saturate(0.94) contrast(0.96)";
        case "spiritual": return "brightness(1.06) saturate(1.05)";
        case "epic": return "contrast(1.1) saturate(1.05)";
        case "romantic": return "saturate(1.08) brightness(1.03)";
        case "hopeful": return "brightness(1.07) contrast(0.98)";
        case "dark": return "brightness(0.85) contrast(1.08)";
        case "joyful": return "saturate(1.14) brightness(1.04)";
        default: return "saturate(0.99) brightness(1.02)"; // emotional
      }
    }
    function moodVig(id) { return id === "dark" ? 1.5 : id === "epic" ? 1.3 : id === "peaceful" || id === "hopeful" ? 0.7 : 1; }
    function lightingOverlay(id, rev) {
      ctx.save();
      if (id === "golden-hour" || id === "sunset" || id === "sunrise") {
        ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = (id === "sunset" ? 0.24 : 0.16) * rev;
        var c = id === "sunset" ? "255,120,40" : "255,180,90";
        var gg = ctx.createLinearGradient(0, 0, 0, H);
        gg.addColorStop(0, "rgba(" + c + ",0)"); gg.addColorStop(0.6, "rgba(" + c + ",0.5)"); gg.addColorStop(1, "rgba(" + c + ",0)");
        ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
      } else if (id === "blue-hour" || id === "moonlight") {
        ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = (id === "moonlight" ? 0.3 : 0.22) * rev;
        ctx.fillStyle = "rgba(70,110,200,1)"; ctx.fillRect(0, 0, W, H);
      } else if (id === "neon") {
        ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.16 * rev;
        var g1 = ctx.createRadialGradient(W * 0.2, H * 0.2, 0, W * 0.2, H * 0.2, W * 0.7);
        g1.addColorStop(0, "rgba(255,40,170,0.8)"); g1.addColorStop(1, "rgba(255,40,170,0)"); ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
        var g2 = ctx.createRadialGradient(W * 0.8, H * 0.85, 0, W * 0.8, H * 0.85, W * 0.7);
        g2.addColorStop(0, "rgba(0,220,255,0.7)"); g2.addColorStop(1, "rgba(0,220,255,0)"); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
      } else if (id === "studio" || id === "soft") {
        ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.06 * rev;
        var g3 = ctx.createLinearGradient(0, 0, 0, H * 0.5); g3.addColorStop(0, "rgba(255,255,255,0.7)"); g3.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H * 0.5);
      } else if (id === "dramatic") {
        ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.12 * rev; ctx.fillStyle = "rgba(40,50,80,1)"; ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }
    function moodWash(id, rev) {
      var warm = id === "romantic" ? 0.1 : id === "emotional" || id === "spiritual" ? 0.06 : 0;
      if (warm > 0) { ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = warm * rev; ctx.fillStyle = id === "romantic" ? "rgba(255,120,160,1)" : "rgba(255,180,120,1)"; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    }

    // ---- atmosphere & FX ----
    function drawFog(t, rev, fx) {
      var n = 0; ["fog", "mist", "smoke", "clouds"].forEach(function (k) { if (fx.has(k)) n++; });
      if (!n) return;
      ctx.save(); ctx.globalCompositeOperation = "screen";
      for (var i = 0; i < 2 + n; i++) {
        var px = 0.2 + 0.3 * i + 0.15 * Math.sin(t / (3000 + i * 900) + i);
        var py = 0.55 + 0.18 * Math.sin(t / (4200 + i * 700) + i * 2);
        var gg = ctx.createRadialGradient(W * px, H * py, 0, W * px, H * py, W * (0.4 + 0.12 * i));
        gg.addColorStop(0, "rgba(220,225,235," + (0.1 + 0.03 * n) + ")"); gg.addColorStop(1, "rgba(220,225,235,0)");
        ctx.globalAlpha = rev; ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }
    function drawRays(t, rev, fx) {
      if (fx.has("godrays")) {
        ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.16 * rev;
        var cx = W * (0.5 + 0.1 * Math.sin(t / 4000));
        for (var i = -3; i <= 3; i++) {
          ctx.save(); ctx.translate(cx, -H * 0.1); ctx.rotate((i * 7 + 8 * Math.sin(t / 3000)) * Math.PI / 180);
          var gg = ctx.createLinearGradient(0, 0, 0, H * 1.3); gg.addColorStop(0, "rgba(255,230,170,0.5)"); gg.addColorStop(1, "rgba(255,230,170,0)");
          ctx.fillStyle = gg; ctx.fillRect(-W * 0.012, 0, W * 0.024, H * 1.3); ctx.restore();
        }
        ctx.restore();
      }
      if (fx.has("bloom")) { ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.14 * rev; var gb = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, H * 0.5); gb.addColorStop(0, "rgba(255,250,235,0.7)"); gb.addColorStop(1, "rgba(255,250,235,0)"); ctx.fillStyle = gb; ctx.fillRect(0, 0, W, H); ctx.restore(); }
      if (fx.has("glow")) { ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.1 * rev * (0.7 + 0.3 * Math.sin(t / 700)); var gw = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.1, W / 2, H * 0.45, H * 0.55); gw.addColorStop(0, "rgba(255,200,140,0.5)"); gw.addColorStop(1, "rgba(255,200,140,0)"); ctx.fillStyle = gw; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    }
    function drawLeak(t, rev, fx) {
      if (fx.has("lightleak")) {
        ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = (0.35 + 0.25 * Math.sin(t / 900)) * rev;
        var g1 = ctx.createRadialGradient(W * 0.92, H * 0.12, 0, W * 0.92, H * 0.12, W * 0.5); g1.addColorStop(0, "rgba(255,120,80,0.5)"); g1.addColorStop(1, "rgba(255,120,80,0)"); ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
        var g2 = ctx.createRadialGradient(W * 0.06, H * 0.9, 0, W * 0.06, H * 0.9, W * 0.5); g2.addColorStop(0, "rgba(120,140,255,0.4)"); g2.addColorStop(1, "rgba(120,140,255,0)"); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
      if (fx.has("lensflare")) {
        ctx.save(); ctx.globalCompositeOperation = "screen"; var cx = W * (0.5 + 0.4 * Math.sin(t / 2200)), cy = H * 0.3;
        ctx.globalAlpha = 0.5 * rev; var gf = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.16); gf.addColorStop(0, "rgba(255,245,220,0.9)"); gf.addColorStop(1, "rgba(255,245,220,0)"); ctx.fillStyle = gf; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.16 * rev; ctx.fillStyle = "rgba(255,230,200,1)"; ctx.fillRect(0, cy - 2, W, 4); ctx.restore();
      }
    }
    var PCFG = {
      dust: { c: "rgba(255,240,200,0.7)", sz: [1, 3], vy: [-0.04, -0.02], n: 18 },
      embers: { c: "rgba(255,150,60,0.95)", sz: [1, 3], vy: [-0.12, -0.06], n: 16 },
      snow: { c: "rgba(255,255,255,0.92)", sz: [2, 5], vy: [0.05, 0.12], n: 22 },
      rain: { c: "rgba(190,210,255,0.6)", sz: [1, 2], vy: [0.4, 0.7], n: 26, streak: 1 },
      leaves: { c: "rgba(190,140,70,0.9)", sz: [3, 6], vy: [0.06, 0.12], n: 14 },
      floating: { c: "rgba(255,255,255,0.8)", sz: [1, 3], vy: [-0.02, 0.02], n: 18 },
    };
    function drawParticles(t, rev, fx) {
      ["dust", "embers", "snow", "rain", "leaves", "floating"].forEach(function (k) {
        if (!fx.has(k)) return; var p = PCFG[k];
        ctx.save(); ctx.globalAlpha = rev; ctx.fillStyle = p.c;
        for (var i = 0; i < p.n; i++) {
          var rnd = function (s) { return ((i * 1009 + s * 9301) % 233280) / 233280; };
          var sz = p.sz[0] + rnd(1) * (p.sz[1] - p.sz[0]);
          var vy = p.vy[0] + rnd(2) * (p.vy[1] - p.vy[0]);
          var sway = Math.sin(t / 700 + i) * 0.02 * (k === "leaves" ? 2 : 1);
          var x = (((rnd(3) + sway + (k === "floating" ? Math.sin(t / 2000 + i) * 0.05 : 0)) % 1) + 1) % 1 * W;
          var y = (((rnd(4) + (t / 1000) * vy) % 1) + 1) % 1 * H;
          if (p.streak) ctx.fillRect(x, y, sz, sz * 6);
          else { ctx.beginPath(); ctx.arc(x, y, sz, 0, 7); ctx.fill(); }
        }
        ctx.restore();
      });
    }
    function drawWater(t, rev) { ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.06 * rev; for (var i = 0; i < 5; i++) { var y = H * (0.72 + i * 0.05) + Math.sin(t / 600 + i) * 4; ctx.fillStyle = "rgba(180,200,255,0.4)"; ctx.fillRect(0, y, W, 2); } ctx.restore(); }
    function grain(t, a) { ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = a; ctx.fillStyle = grains[Math.floor(t / 55) % grains.length]; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    function vignette(a) { ctx.save(); ctx.globalAlpha = Math.min(1, a); ctx.drawImage(vig, 0, 0); ctx.restore(); }
    function gradeWash(rev) { ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.4 * rev; var gg = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.15, W / 2, H * 0.5, H * 0.75); gg.addColorStop(0, "rgba(255,180,120,1)"); gg.addColorStop(1, "rgba(40,110,140,1)"); ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    function beatFlash(t, BEAT, INT) { if (!BEAT || t < 700) return; var k = Math.max(0, 1 - (t % BEAT) / 110); if (k <= 0) return; ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.08 * k * Math.min(1.4, INT); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    function sting(t) {
      var iA = outCubic(seg(t, 0, 340)) * (1 - inOutCubic(seg(t, 640, 980))); if (iA <= 0.001) return;
      var iS = 0.84 + 0.16 * outBack(seg(t, 0, 520)); mark(W / 2, H * 0.43, iS, iA);
      ctx.save(); ctx.globalAlpha = iA; ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "900 " + Math.round(W * 0.061) + "px Archivo, sans-serif"; var ty = H * 0.43 + H * 0.054;
      ctx.fillText("TV NIGHTLY", W / 2, ty); var tw = ctx.measureText("TV NIGHTLY").width;
      ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(W / 2 + tw / 2 + 18, ty + H * 0.011, W * 0.007, 0, 7); ctx.fill(); ctx.restore();
    }
    function signoff(t, DUR) {
      var oRise = outBack(seg(t, DUR - 1700, DUR - 1200)); if (oRise <= 0.001) return;
      var prog = clamp01(oRise), slabTop = FOOT_Y - H * 0.05 + (1 - prog) * H * 0.036;
      ctx.save(); ctx.globalAlpha = prog;
      var sg = ctx.createLinearGradient(0, slabTop - H * 0.068, 0, slabTop); sg.addColorStop(0, "rgba(14,14,17,0)"); sg.addColorStop(1, "rgba(14,14,17,1)");
      ctx.fillStyle = sg; ctx.fillRect(0, slabTop - H * 0.068, W, H * 0.068);
      ctx.fillStyle = PLATE; ctx.fillRect(0, slabTop, W, H - slabTop);
      ctx.fillStyle = AMBER; ctx.fillRect(SM, slabTop + H * 0.028, W * 0.082, 5);
      var ly = slabTop + H * 0.078; mark(SM + W * 0.03, ly - H * 0.008, 0.5, 1);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = AMBER; ctx.font = "900 " + Math.round(W * 0.043) + "px Archivo, sans-serif";
      ctx.fillText("tvnightly.com", SM + W * 0.076, ly);
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "600 " + Math.round(W * 0.022) + "px Archivo, sans-serif";
      ctx.fillText("Best episodes · release dates · where to stream", SM, ly + H * 0.024); ctx.restore();
    }

    return function renderFrame(t, cfg) {
      var DUR = cfg.DUR, INT = cfg.INT, BEAT = cfg.BEAT, fx = cfg.fx;
      ctx.globalCompositeOperation = "source-over"; ctx.filter = "none"; ctx.globalAlpha = 1;
      ctx.fillStyle = PLATE; ctx.fillRect(0, 0, W, H);
      var rev = outCubic(seg(t, 300, 1500));
      if (rev <= 0) { sting(t); return; }
      var cam = camera(cfg.camera, t, DUR, INT);
      if (fx.has("parallax")) {
        ctx.save(); ctx.globalAlpha = rev * 0.5; ctx.filter = "blur(" + (W * 0.02).toFixed(1) + "px) brightness(0.5)";
        ctx.translate(W / 2 - cam.dx * 1.6, H / 2 - cam.dy * 1.6); ctx.scale(1.5, 1.5); ctx.translate(-W / 2, -H / 2);
        ctx.drawImage(base, 0, 0, W, H); ctx.restore(); ctx.filter = "none";
      }
      var bl = (1 - rev) * (W * 0.014);
      if (fx.has("dof")) bl += W * 0.004;
      if (fx.has("rackfocus")) bl += Math.max(0, 1 - seg(t, 800, 2200)) * (W * 0.02);
      if (fx.has("motionblur")) bl += Math.abs(cam.dx) * 0.02 + Math.abs(Math.sin(t / 200)) * W * 0.002;
      ctx.save(); ctx.globalAlpha = rev;
      ctx.filter = "blur(" + bl.toFixed(2) + "px) brightness(" + (0.55 + 0.45 * rev).toFixed(3) + ") " + lightingFilter(cfg.lighting) + " " + moodFilter(cfg.mood);
      ctx.translate(W / 2 + cam.dx, H / 2 + cam.dy); if (cam.rot) ctx.rotate(cam.rot); ctx.scale(cam.s, cam.s); ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(base, 0, 0, W, H); ctx.restore(); ctx.filter = "none";
      lightingOverlay(cfg.lighting, rev);
      moodWash(cfg.mood, rev);
      drawRays(t, rev, fx);
      drawFog(t, rev, fx);
      drawLeak(t, rev, fx);
      drawParticles(t, rev, fx);
      if (fx.has("water")) drawWater(t, rev);
      if (fx.has("grade")) gradeWash(rev);
      if (fx.has("grain")) grain(t, 0.05 * Math.min(1.6, INT));
      vignette(rev * (fx.has("vignette") ? 1 : 0.45) * moodVig(cfg.mood));
      beatFlash(t, BEAT, INT);
      sting(t); signoff(t, DUR);
    };
  }

  // --- live preview: loops the actual renderer so the studio shows the result ---
  (function previewSetup() {
    var pv = document.getElementById("studio-preview");
    var v = document.getElementById("studio-vid");
    if (!pv || !card) return;
    var VW = v ? parseInt(v.getAttribute("data-w"), 10) || 1080 : 1080;
    var VH = v ? parseInt(v.getAttribute("data-h"), 10) || 1920 : 1920;
    var ph = 600, pw = Math.round((ph * VW) / VH);
    if (pw > 760) { pw = 760; ph = Math.round((pw * VH) / VW); }
    pv.width = pw; pv.height = ph;
    var pctx = pv.getContext("2d");
    var pbase = new Image(), renderFrame = null, raf = null, t0 = 0, playing = false;
    var toggle = document.getElementById("studio-preview-toggle");
    function setLabel() { if (toggle) toggle.textContent = playing ? "❚❚ Pause" : "▶ Preview"; }
    function loop(now) {
      if (!playing) return;
      var cfg = readConfig();
      try { renderFrame((now - t0) % (cfg.DUR + 250), cfg); }
      catch (e) { console.error(e); stop(); return; }
      raf = requestAnimationFrame(loop);
    }
    function play() { if (playing || !renderFrame) return; playing = true; pv.classList.add("is-live"); t0 = performance.now(); raf = requestAnimationFrame(loop); setLabel(); }
    function stop() { playing = false; if (raf) cancelAnimationFrame(raf); setLabel(); }
    pbase.onload = function () { renderFrame = makeRenderer(pctx, pw, ph, pbase); play(); };
    pbase.onerror = function () {};
    pbase.src = card.src;
    if (toggle) toggle.addEventListener("click", function () { playing ? stop() : play(); });
  })();

  // --- still-image exports for image-first platforms (WhatsApp, Pinterest …) ---
  // Composes the current card onto a platform-sized, branded canvas: a blurred
  // "cover" backdrop fills any letterbox, with the sharp card contained on top.
  if (card) {
    function irr(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function withCardBitmap(cb, err) {
      if (/card\.svg/.test(card.src)) {
        fetch(card.src)
          .then(function (r) { return r.text(); })
          .then(function (svg) {
            var vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
            var iw = vb ? Math.round(+vb[1]) : 1080;
            var ih = vb ? Math.round(+vb[2]) : 1920;
            var url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
            var im = new Image();
            im.onload = function () { cb(im, iw, ih); URL.revokeObjectURL(url); };
            im.onerror = function () { URL.revokeObjectURL(url); err && err(); };
            im.src = url;
          })
          .catch(function () { err && err(); });
      } else if (card.complete && card.naturalWidth) {
        cb(card, card.naturalWidth, card.naturalHeight);
      } else {
        var im = new Image();
        im.onload = function () { cb(im, im.naturalWidth || 1080, im.naturalHeight || 1920); };
        im.onerror = function () { err && err(); };
        im.src = card.src;
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll(".studio-img-btn"), function (btn) {
      btn.addEventListener("click", function () {
        var tw = parseInt(btn.getAttribute("data-w"), 10) || 1080;
        var th = parseInt(btn.getAttribute("data-h"), 10) || 1920;
        var plat = btn.getAttribute("data-platform") || "image";
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add("is-rendering");
        function done() {
          btn.disabled = false;
          btn.classList.remove("is-rendering");
        }
        withCardBitmap(function (img, iw, ih) {
          try {
            var cv = document.createElement("canvas");
            cv.width = tw;
            cv.height = th;
            var x = cv.getContext("2d");
            x.fillStyle = "#0e0e11";
            x.fillRect(0, 0, tw, th);
            // blurred cover backdrop
            var cs = Math.max(tw / iw, th / ih);
            var cw = iw * cs, ch = ih * cs;
            x.save();
            x.filter = "blur(48px) brightness(0.55) saturate(1.1)";
            x.drawImage(img, (tw - cw) / 2, (th - ch) / 2, cw, ch);
            x.restore();
            x.fillStyle = "rgba(8,8,11,0.5)";
            x.fillRect(0, 0, tw, th);
            // contained, rounded, shadowed card
            var pad = Math.round(Math.min(tw, th) * 0.055);
            var fs = Math.min((tw - pad * 2) / iw, (th - pad * 2) / ih);
            var fw = iw * fs, fh = ih * fs;
            var fx = (tw - fw) / 2, fy = (th - fh) / 2;
            var r = Math.round(Math.min(fw, fh) * 0.035);
            x.save();
            x.shadowColor = "rgba(0,0,0,0.6)";
            x.shadowBlur = 48;
            x.shadowOffsetY = 22;
            irr(x, fx, fy, fw, fh, r);
            x.fillStyle = "#000";
            x.fill();
            x.restore();
            x.save();
            irr(x, fx, fy, fw, fh, r);
            x.clip();
            x.drawImage(img, fx, fy, fw, fh);
            x.restore();
            x.save();
            irr(x, fx, fy, fw, fh, r);
            x.lineWidth = 2;
            x.strokeStyle = "rgba(255,255,255,0.08)";
            x.stroke();
            x.restore();
            cv.toBlob(function (b) {
              if (b) {
                var fm = card.src.match(/[?&](?:cat|format)=([^&]+)/);
                var a = document.createElement("a");
                a.href = URL.createObjectURL(b);
                a.download = "tvnightly-" + (fm ? fm[1] : "card") + "-" + plat + ".png";
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 1200);
              }
              done();
            }, "image/png");
          } catch (e) {
            console.error(e);
            done();
          }
        }, done);
      });
    });
  }

  // ---- MP4 export: frame-by-frame via the shared renderer + the current config ----
  var vid = document.getElementById("studio-vid");
  if (vid && card) {
    var VW = parseInt(vid.getAttribute("data-w"), 10) || 1080,
      VH = parseInt(vid.getAttribute("data-h"), 10) || 1920;
    vid.addEventListener("click", function () {
      if (!window.MediaRecorder && !window.VideoEncoder) {
        alert("This browser can't render video — try Chrome.");
        return;
      }
      vid.disabled = true;
      var vlabel = vid.textContent;
      function vreset() {
        vid.disabled = false;
        vid.textContent = vlabel;
      }
      var mime =
        [
          "video/mp4;codecs=avc1.4d002a",
          "video/mp4",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
        ].filter(function (m) {
          try {
            return MediaRecorder.isTypeSupported(m);
          } catch (e) {
            return false;
          }
        })[0] || "video/webm";
      var fontReady =
        document.fonts && document.fonts.load
          ? Promise.all([
              document.fonts.load("900 66px Archivo"),
              document.fonts.load("800 44px Archivo"),
              document.fonts.load("600 26px Archivo"),
            ]).catch(function () {})
          : Promise.resolve();
      fontReady
        .then(function () {
          var base = new Image();
          base.onload = function () {
            var canvas = document.createElement("canvas");
            canvas.width = VW;
            canvas.height = VH;
            var ctx = canvas.getContext("2d");
            var cfg = readConfig();
            var DUR = cfg.DUR,
              FPS = 30;
            var renderFrame = makeRenderer(ctx, VW, VH, base);
            function render(t) {
              renderFrame(t, cfg);
            }
            var fm = card.src.match(/format=([^&]+)/);
            var fmtM = card.src.match(/[?&]fmt=([^&]+)/);
            var fname =
              "tvnightly-" + (fm ? fm[1] : "clip") + (fmtM ? "-" + fmtM[1] : "") + "-" + cfg.camera;
            function download(blob, ext) {
              var a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = fname + "." + ext;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(function () {
                URL.revokeObjectURL(a.href);
              }, 1500);
            }
            function recordMediaRecorder() {
              var rec;
              try {
                rec = new MediaRecorder(canvas.captureStream(FPS), {
                  mimeType: mime,
                  videoBitsPerSecond: 12000000,
                });
              } catch (e) {
                vreset();
                return;
              }
              var chunks = [];
              rec.ondataavailable = function (e) {
                if (e.data && e.data.size) chunks.push(e.data);
              };
              rec.onstop = function () {
                download(new Blob(chunks, { type: mime }), mime.indexOf("mp4") >= 0 ? "mp4" : "webm");
                vreset();
              };
              var t0 = performance.now();
              function loop(now) {
                render(now - t0);
                if (now - t0 < DUR) requestAnimationFrame(loop);
                else setTimeout(function () { try { rec.stop(); } catch (e) {} }, 140);
              }
              vid.textContent = "Recording…";
              try {
                rec.start();
              } catch (e) {
                vreset();
                return;
              }
              requestAnimationFrame(loop);
            }
            var didFallback = false;
            function fallbackRecord() {
              if (didFallback) return;
              didFallback = true;
              recordMediaRecorder();
            }
            function encodeWebCodecs(codec) {
              var muxer = new Mp4Muxer.Muxer({
                target: new Mp4Muxer.ArrayBufferTarget(),
                video: { codec: "avc", width: VW, height: VH, frameRate: FPS },
                fastStart: "in-memory",
              });
              var enc = new VideoEncoder({
                output: function (chunk, meta) {
                  muxer.addVideoChunk(chunk, meta);
                },
                error: function (e) {
                  console.error("VideoEncoder error:", e);
                  fallbackRecord();
                },
              });
              try {
                enc.configure({ codec: codec, width: VW, height: VH, bitrate: 12000000, framerate: FPS });
              } catch (e) {
                fallbackRecord();
                return;
              }
              var total = Math.round((DUR / 1000) * FPS),
                i = 0;
              function step() {
                try {
                  for (var k = 0; k < 3 && i < total; k++, i++) {
                    render((i / FPS) * 1000);
                    var frame = new VideoFrame(canvas, {
                      timestamp: Math.round((i * 1e6) / FPS),
                      duration: Math.round(1e6 / FPS),
                    });
                    enc.encode(frame, { keyFrame: i % FPS === 0 });
                    frame.close();
                  }
                } catch (e) {
                  console.error(e);
                  try { enc.close(); } catch (e2) {}
                  fallbackRecord();
                  return;
                }
                vid.textContent = "Rendering… " + Math.round((i / total) * 100) + "%";
                if (i < total) {
                  setTimeout(step, 0);
                  return;
                }
                enc
                  .flush()
                  .then(function () {
                    muxer.finalize();
                    download(new Blob([muxer.target.buffer], { type: "video/mp4" }), "mp4");
                    vreset();
                  })
                  .catch(function (e) {
                    console.error(e);
                    fallbackRecord();
                  });
              }
              vid.textContent = "Rendering… 0%";
              step();
            }
            if (window.VideoEncoder && window.VideoFrame && window.Mp4Muxer) {
              var cands = ["avc1.640034", "avc1.640033", "avc1.640032", "avc1.4d0034", "avc1.42e034"];
              (function pickCodec(idx) {
                if (idx >= cands.length) {
                  recordMediaRecorder();
                  return;
                }
                VideoEncoder.isConfigSupported({
                  codec: cands[idx],
                  width: VW,
                  height: VH,
                  bitrate: 12000000,
                  framerate: FPS,
                })
                  .then(function (s) {
                    if (s && s.supported) encodeWebCodecs(cands[idx]);
                    else pickCodec(idx + 1);
                  })
                  .catch(function () {
                    pickCodec(idx + 1);
                  });
              })(0);
            } else {
              recordMediaRecorder();
            }
          };
          base.onerror = function () {
            vreset();
          };
          base.src = card.src;
        })
        .catch(vreset);
    });
  }

  // copy a caption to the clipboard + tick checklist steps
  function markCheck(id) {
    var el = document.querySelector('[data-check="' + id + '"]');
    if (el) el.classList.add("is-done");
  }
  document.addEventListener("click", function (e) {
    var dl = e.target.closest && e.target.closest("[data-check-trigger='download']");
    if (dl) markCheck("download");
  });
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".studio-copy");
    if (!btn) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = "Copied ✓";
      btn.classList.add("is-done");
      setTimeout(function () {
        btn.textContent = prev;
        btn.classList.remove("is-done");
      }, 1400);
    };
    var hookText = btn.getAttribute("data-copy");
    if (hookText) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(hookText).then(done).catch(function () {
          done();
        });
      } else {
        done();
      }
      return;
    }
    var box = btn.closest(".studio-cap");
    var ta = box && box.querySelector(".studio-cap-text");
    if (!ta) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(function () {
        markCheck("caption");
        done();
      }).catch(function () {
        ta.select();
        document.execCommand("copy");
        markCheck("caption");
        done();
      });
    } else {
      ta.select();
      document.execCommand("copy");
      markCheck("caption");
      done();
    }
  });
})();
