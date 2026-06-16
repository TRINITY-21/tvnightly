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

  // single search (liked / status): navigate to that format's preview on pick
  var single = document.getElementById("studio-q");
  if (single) {
    var holder = single.closest("[data-format]");
    var fmt = holder ? holder.getAttribute("data-format") : "liked";
    attachSearch(single, document.getElementById("studio-ta"), function (it) {
      window.location.href =
        "/admin/studio?format=" +
        encodeURIComponent(fmt) +
        "&slug=" +
        encodeURIComponent(it.slug) +
        "&kind=" +
        encodeURIComponent(it.kind);
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
        window.location.href =
          "/admin/studio?format=vs&a=" +
          encodeURIComponent(pick.a.slug) +
          "&ka=" +
          encodeURIComponent(pick.a.kind) +
          "&b=" +
          encodeURIComponent(pick.b.slug) +
          "&kb=" +
          encodeURIComponent(pick.b.kind);
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
          var url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
          var img = new Image();
          img.onload = function () {
            var canvas = document.createElement("canvas");
            canvas.width = 1080;
            canvas.height = 1920;
            canvas.getContext("2d").drawImage(img, 0, 0, 1080, 1920);
            URL.revokeObjectURL(url);
            canvas.toBlob(function (b) {
              if (!b) {
                reset();
                return;
              }
              var fm = card.src.match(/format=([^&]+)/);
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

  // record a 9:16 clip: rasterize the card, then a Ken-Burns zoom + fade over a
  // canvas captureStream, recorded by MediaRecorder. Prefers mp4 (what TikTok/IG
  // want); falls back to webm where the browser can't encode mp4.
  var vid = document.getElementById("studio-vid");
  if (vid && card) {
    vid.addEventListener("click", function () {
      if (!window.MediaRecorder) {
        alert("This browser can't record video — try Chrome.");
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
      fetch(card.src)
        .then(function (r) {
          return r.text();
        })
        .then(function (svgText) {
          var url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
          var base = new Image();
          base.onload = function () {
            URL.revokeObjectURL(url);
            var W = 1080,
              H = 1920;
            var canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            var ctx = canvas.getContext("2d");
            var rec = new MediaRecorder(canvas.captureStream(30), {
              mimeType: mime,
              videoBitsPerSecond: 9000000,
            });
            var chunks = [];
            rec.ondataavailable = function (e) {
              if (e.data && e.data.size) chunks.push(e.data);
            };
            rec.onstop = function () {
              var ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
              var fm = card.src.match(/format=([^&]+)/);
              var a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob(chunks, { type: mime }));
              a.download = "tvnightly-" + (fm ? fm[1] : "card") + "." + ext;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(function () {
                URL.revokeObjectURL(a.href);
              }, 1500);
              vreset();
            };
            var DUR = 5200,
              t0 = performance.now();
            rec.start();
            function frame(now) {
              var t = Math.min(1, (now - t0) / DUR);
              ctx.fillStyle = "#0e0e11";
              ctx.fillRect(0, 0, W, H);
              var scale = 1 + 0.06 * t; // slow push-in
              var fade = Math.min(1, t / 0.07); // fade in over the first ~7%
              ctx.save();
              ctx.globalAlpha = fade;
              ctx.translate(W / 2, H * 0.42);
              ctx.scale(scale, scale);
              ctx.translate(-W / 2, -H * 0.42);
              ctx.drawImage(base, 0, 0, W, H);
              ctx.restore();
              if (t < 1) requestAnimationFrame(frame);
              else
                setTimeout(function () {
                  rec.stop();
                }, 120);
            }
            vid.textContent = "Recording…";
            requestAnimationFrame(frame);
          };
          base.onerror = function () {
            URL.revokeObjectURL(url);
            vreset();
          };
          base.src = url;
        })
        .catch(vreset);
    });
  }
})();
