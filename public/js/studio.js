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

  // record a cinematic 9:16 clip — a designed motion sequence composited live on a
  // canvas (brand sting → focus-pull reveal → film-grain drift with a light sweep
  // → animated brand lower-third), captured by MediaRecorder. Prefers mp4 (what
  // TikTok/IG want); falls back to webm where the browser can't encode mp4.
  var vid = document.getElementById("studio-vid");
  if (vid && card) {
    // dimensions come from the button (9:16 = 1080×1920, 1:1 = 1080×1080) so the
    // clip adapts to whichever format is on screen. Bottom clearance scales with H.
    var W = parseInt(vid.getAttribute("data-w"), 10) || 1080,
      H = parseInt(vid.getAttribute("data-h"), 10) || 1920,
      SM = 56,
      SR = 168,
      CR = W - SR,
      CW = CR - SM,
      SB = Math.round(H * 0.156),
      FOOT_Y = H - SB;
    var PLATE = "#0e0e11",
      AMBER = "#FFA94D",
      INK = "#F2F5FA";

    // --- easing ---
    function clamp01(x) {
      return x < 0 ? 0 : x > 1 ? 1 : x;
    }
    function seg(t, a, b) {
      return clamp01((t - a) / (b - a));
    }
    function outCubic(x) {
      return 1 - Math.pow(1 - x, 3);
    }
    function inCubic(x) {
      return x * x * x;
    }
    function inOutCubic(x) {
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }
    function outBack(x) {
      var c1 = 1.70158,
        c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    // rounded-rect path
    function rr(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // a grayscale-noise pattern (mean ~128 so it reads as neutral grain in overlay)
    function grainPattern(ctx, size) {
      var g = document.createElement("canvas");
      g.width = g.height = size;
      var gx = g.getContext("2d"),
        id = gx.createImageData(size, size),
        d = id.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      gx.putImageData(id, 0, 0);
      return ctx.createPattern(g, "repeat");
    }

    function vignetteCanvas() {
      var v = document.createElement("canvas");
      v.width = W;
      v.height = H;
      var vx = v.getContext("2d");
      var g = vx.createRadialGradient(W / 2, H * 0.44, H * 0.18, W / 2, H * 0.5, H * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.52)");
      vx.fillStyle = g;
      vx.fillRect(0, 0, W, H);
      return v;
    }

    // brand lockup: rounded TV frame + glowing amber dot
    function mark(ctx, cx, cy, s, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      var w = 128,
        h = 86,
        r = 22;
      ctx.lineWidth = 9;
      ctx.strokeStyle = INK;
      ctx.lineJoin = "round";
      rr(ctx, -w / 2, -h / 2, w, h, r);
      ctx.stroke();
      ctx.shadowColor = "rgba(255,169,77,0.8)";
      ctx.shadowBlur = 26;
      ctx.fillStyle = AMBER;
      ctx.beginPath();
      ctx.arc(w / 2 - 26, h / 2 - 23, 12.5, 0, 7);
      ctx.fill();
      ctx.restore();
    }

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

      // make sure the brand font is rasterizable on the canvas before we record
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
          // same-origin card source (no canvas taint): load directly so both the
          // promo PNG and the composer SVG work as the base layer.
          var base = new Image();
          base.onload = function () {
            var canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            var ctx = canvas.getContext("2d");
            var grains = [];
            for (var gi = 0; gi < 7; gi++) grains.push(grainPattern(ctx, 150));
            var vig = vignetteCanvas();

            var DUR = 7000,
              FPS = 30;
            var fm = card.src.match(/format=([^&]+)/);
            var fmtM = card.src.match(/[?&]fmt=([^&]+)/);
            var fname = "tvnightly-" + (fm ? fm[1] : "clip") + (fmtM ? "-" + fmtM[1] : "");
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

            function render(t) {
              ctx.globalCompositeOperation = "source-over";
              ctx.filter = "none";
              ctx.globalAlpha = 1;
              ctx.fillStyle = PLATE;
              ctx.fillRect(0, 0, W, H);

              // card: focus-pull reveal, then a slow cinematic push-in + drift
              var rev = outCubic(seg(t, 500, 1600));
              if (rev > 0) {
                var drift = inOutCubic(seg(t, 1600, DUR - 1200));
                var scale = 1.08 - 0.08 * rev + 0.04 * drift;
                var blur = 16 * (1 - rev);
                var bright = 0.5 + 0.5 * rev;
                var yd = -20 * drift;
                var xd = 8 * Math.sin(drift * Math.PI);
                ctx.save();
                ctx.globalAlpha = rev;
                ctx.filter = "blur(" + blur.toFixed(2) + "px) brightness(" + bright.toFixed(3) + ")";
                ctx.translate(W / 2 + xd, H / 2 + yd);
                ctx.scale(scale, scale);
                ctx.translate(-W / 2, -H / 2);
                ctx.drawImage(base, 0, 0, W, H);
                ctx.restore();
                ctx.filter = "none";

                // subtle amber edge vignette during reveal
                if (rev > 0.4 && rev < 0.95) {
                  ctx.save();
                  ctx.globalCompositeOperation = "screen";
                  ctx.globalAlpha = 0.04 * Math.sin(rev * Math.PI);
                  var eg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.72);
                  eg.addColorStop(0, "rgba(255,169,77,0)");
                  eg.addColorStop(1, "rgba(255,169,77,1)");
                  ctx.fillStyle = eg;
                  ctx.fillRect(0, 0, W, H);
                  ctx.restore();
                }
              }

              // a single diagonal light sheen sweeping across the card
              var sh = seg(t, 1700, 3000);
              if (sh > 0 && sh < 1 && rev > 0.65) {
                var cxs = -W * 0.5 + W * 1.9 * inOutCubic(sh);
                ctx.save();
                ctx.globalCompositeOperation = "screen";
                ctx.globalAlpha = Math.sin(sh * Math.PI) * 0.16;
                var grd = ctx.createLinearGradient(cxs - 200, 0, cxs + 200, H);
                grd.addColorStop(0, "rgba(255,255,255,0)");
                grd.addColorStop(0.5, "rgba(255,238,205,1)");
                grd.addColorStop(1, "rgba(255,255,255,0)");
                ctx.fillStyle = grd;
                ctx.fillRect(cxs - 240, 0, 480, H);
                ctx.restore();
              }

              // animated film grain
              if (rev > 0.55) {
                ctx.save();
                ctx.globalCompositeOperation = "overlay";
                ctx.globalAlpha = 0.055;
                ctx.fillStyle = grains[Math.floor(t / 55) % grains.length];
                ctx.fillRect(0, 0, W, H);
                ctx.restore();
              }

              // vignette
              if (rev > 0.25) {
                ctx.save();
                ctx.globalAlpha = rev;
                ctx.drawImage(vig, 0, 0);
                ctx.restore();
              }

              // intro brand sting (on the dark, before the card resolves under it)
              var iA = outCubic(seg(t, 0, 340)) * (1 - inOutCubic(seg(t, 640, 980)));
              if (iA > 0.001) {
                var iS = 0.84 + 0.16 * outBack(seg(t, 0, 520));
                mark(ctx, W / 2, H * 0.43, iS, iA);
                ctx.save();
                ctx.globalAlpha = iA;
                ctx.fillStyle = INK;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = "900 66px Archivo, sans-serif";
                var ty = H * 0.43 + 104;
                ctx.fillText("TV NIGHTLY", W / 2, ty);
                var tw = ctx.measureText("TV NIGHTLY").width;
                ctx.fillStyle = AMBER;
                ctx.beginPath();
                ctx.arc(W / 2 + tw / 2 + 20, ty + 22, 7.5, 0, 7);
                ctx.fill();
                ctx.restore();
              }

              // brand sign-off: a SOLID slab fully covers the card's own baked
              // footer (no ghost wordmark, no double line), then one amber tick +
              // the lockup fade/slide in. Single accent — clean.
              var oRise = outBack(seg(t, 5200, 5700));
              if (oRise > 0.001) {
                var prog = clamp01(oRise);
                var slabTop = FOOT_Y - 96 + (1 - prog) * 70;
                ctx.save();
                ctx.globalAlpha = prog;
                var sg = ctx.createLinearGradient(0, slabTop - 130, 0, slabTop);
                sg.addColorStop(0, "rgba(14,14,17,0)");
                sg.addColorStop(1, "rgba(14,14,17,1)");
                ctx.fillStyle = sg;
                ctx.fillRect(0, slabTop - 130, W, 130);
                ctx.fillStyle = PLATE;
                ctx.fillRect(0, slabTop, W, H - slabTop);
                // one amber tick — the brand section marker
                ctx.fillStyle = AMBER;
                ctx.fillRect(SM, slabTop + 54, 88, 5);
                // lockup: mark + wordmark on a line, tagline beneath
                var ly = slabTop + 150;
                mark(ctx, SM + 34, ly - 16, 0.5, 1);
                ctx.textAlign = "left";
                ctx.textBaseline = "alphabetic";
                ctx.fillStyle = AMBER;
                ctx.font = "900 46px Archivo, sans-serif";
                ctx.fillText("tvnightly.com", SM + 82, ly);
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.font = "600 24px Archivo, sans-serif";
                ctx.fillText("Best episodes · release dates · where to stream", SM, ly + 46);
                ctx.restore();
              }
            }

            // --- Primary: frame-perfect H.264 via WebCodecs, muxed to real MP4.
            // Each frame is rendered then encoded (not realtime), so the motion is
            // buttery at exactly FPS no matter how loaded the machine is — the
            // professional path. Falls back to realtime MediaRecorder elsewhere. ---
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
                video: { codec: "avc", width: W, height: H, frameRate: FPS },
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
                enc.configure({ codec: codec, width: W, height: H, bitrate: 12000000, framerate: FPS });
              } catch (e) {
                fallbackRecord();
                return;
              }
              var total = Math.round((DUR / 1000) * FPS);
              var i = 0;
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
              (function pick(idx) {
                if (idx >= cands.length) {
                  recordMediaRecorder();
                  return;
                }
                VideoEncoder.isConfigSupported({
                  codec: cands[idx],
                  width: W,
                  height: H,
                  bitrate: 12000000,
                  framerate: FPS,
                })
                  .then(function (s) {
                    if (s && s.supported) encodeWebCodecs(cands[idx]);
                    else pick(idx + 1);
                  })
                  .catch(function () {
                    pick(idx + 1);
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

  // copy a caption to the clipboard
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".studio-copy");
    if (!btn) return;
    var box = btn.closest(".studio-cap");
    var ta = box && box.querySelector(".studio-cap-text");
    if (!ta) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = "Copied ✓";
      btn.classList.add("is-done");
      setTimeout(function () {
        btn.textContent = prev;
        btn.classList.remove("is-done");
      }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done).catch(function () {
        ta.select();
        document.execCommand("copy");
        done();
      });
    } else {
      ta.select();
      document.execCommand("copy");
      done();
    }
  });
})();
