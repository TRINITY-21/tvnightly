// Episode Grid interaction: cell ring + readout on hover/keys, and the
// save-as-image pipeline (server-rendered SVG -> canvas -> PNG/share sheet).
// The server ships the computed layout in #sig-data; this file computes
// no geometry of its own.
(function () {
  var fig = document.querySelector("figure.sig");
  var dataEl = document.getElementById("sig-data");
  if (!fig || !dataEl) return;
  var data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }
  var svg = fig.querySelector("svg");
  var cursor = svg && svg.getElementById ? svg.getElementById("sig-cursor") : null;
  var strip = document.querySelector(".sig-strip");
  var read = document.getElementById("sig-read");
  var live = document.getElementById("sig-live");
  if (!svg || !cursor || !strip || !read) return;
  strip.hidden = false;
  var saveWrap = document.querySelector(".sig-save");
  if (saveWrap) saveWrap.hidden = false;
  // arrow keys only exist with JS — promise them only now
  fig.setAttribute(
    "aria-label",
    fig.getAttribute("aria-label") + " Use arrow keys to move through the grid.",
  );

  // season columns: start index of each column, derived from the codes
  var colStart = [];
  (function () {
    var prev = null;
    for (var i = 0; i < data.rows.length; i++) {
      var s = data.rows[i].c.slice(1, 3);
      if (s !== prev) {
        colStart.push(i);
        prev = s;
      }
    }
  })();
  function colOf(i) {
    var c = 0;
    while (c + 1 < colStart.length && colStart[c + 1] <= i) c++;
    return c;
  }
  function colLen(c) {
    return (c + 1 < colStart.length ? colStart[c + 1] : data.rows.length) - colStart[c];
  }

  var cur = -1;
  // snap radius: just past one cell — dead plate is dead
  var RAD = Math.pow(data.cw / 2 + 4, 2) + Math.pow(data.ch / 2 + 4, 2);

  function vbPt(ev) {
    var r = svg.getBoundingClientRect();
    var vb = svg.viewBox.baseVal;
    return {
      x: ((ev.clientX - r.left) * vb.width) / r.width,
      y: ((ev.clientY - r.top) * vb.height) / r.height,
    };
  }
  function nearest(p) {
    var best = 0,
      bd = Infinity;
    for (var i = 0; i < data.x.length; i++) {
      var dx = data.x[i] - p.x,
        dy = data.y[i] - p.y,
        d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { i: best, d: bd };
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }
  function show(i) {
    cur = i;
    var row = data.rows[i];
    var x = data.x[i];
    var y = data.y[i];
    cursor.innerHTML =
      '<rect x="' + (x - data.cw / 2 - 1.5) + '" y="' + (y - data.ch / 2 - 1.5) +
      '" width="' + (data.cw + 3) + '" height="' + (data.ch + 3) +
      '" rx="' + (data.rx || 8) + '" fill="none" stroke="#FFA94D" stroke-width="1.5"/>';
    read.innerHTML =
      '<span class="sig-read-code">' + row.c + "</span>" +
      (row.h
        ? '<a class="sig-read-name" href="' + row.h + '">' + esc(row.n) + "</a>"
        : '<span class="sig-read-name">' + esc(row.n) + "</span>") +
      (row.r != null
        ? '<span class="rating">★ ' + row.r.toFixed(1) + "</span>"
        : '<span class="sig-read-code" style="opacity:.6">Unrated</span>') +
      (row.d ? '<span class="sig-read-date">' + esc(row.d) + "</span>" : "");
    if (live)
      live.textContent =
        row.c + " " + row.n + (row.r != null ? ", rated " + row.r.toFixed(1) : ", unrated") +
        (row.d ? ", aired " + row.d : "");
  }
  function clear() {
    cur = -1;
    cursor.innerHTML = "";
    read.innerHTML = "";
  }
  // keyboard only: keep the focused cell inside the panned viewport
  function reveal(i) {
    var sc = fig.querySelector(".sig-screen");
    if (!sc) return;
    var r = svg.getBoundingClientRect();
    var px = (data.x[i] / svg.viewBox.baseVal.width) * r.width;
    if (px - data.cw < sc.scrollLeft) sc.scrollLeft = px - data.cw;
    else if (px + data.cw > sc.scrollLeft + sc.clientWidth)
      sc.scrollLeft = px + data.cw - sc.clientWidth;
  }

  var downAt = null;
  svg.addEventListener("pointermove", function (ev) {
    if (ev.pointerType !== "mouse") return;
    var hit = nearest(vbPt(ev));
    if (hit.d <= RAD) show(hit.i);
    else clear();
  });
  svg.addEventListener("pointerleave", function (ev) {
    if (ev.pointerType === "mouse") clear();
  });
  svg.addEventListener("pointerdown", function (ev) {
    downAt = { x: ev.clientX, y: ev.clientY, t: ev.pointerType };
    // a tap scrubs; the readout's name link is the touch navigation
    if (ev.pointerType !== "mouse") {
      var hit = nearest(vbPt(ev));
      if (hit.d <= RAD) show(hit.i);
    }
  });
  // navigate on a true mouse click on a cell only
  svg.addEventListener("pointerup", function (ev) {
    if (!downAt || downAt.t !== "mouse") return;
    if (Math.abs(ev.clientX - downAt.x) > 4 || Math.abs(ev.clientY - downAt.y) > 4) return;
    var hit = nearest(vbPt(ev));
    if (hit.d > RAD) return;
    var row = data.rows[hit.i];
    if (row && row.h) window.location.href = row.h;
  });

  // the grid is season-major: Down/Up walk a season, Left/Right hop columns
  fig.addEventListener("keydown", function (ev) {
    var n = data.rows.length;
    var i = cur < 0 ? data.peak : cur;
    var c, ord, t;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      i = Math.min(n - 1, Math.max(0, i + (ev.key === "ArrowDown" ? 1 : -1)));
      show(i);
      reveal(i);
      ev.preventDefault();
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      var dir = ev.key === "ArrowRight" ? 1 : -1;
      c = colOf(i);
      t = c + dir;
      if (t >= 0 && t < colStart.length) {
        ord = ev.shiftKey ? 0 : Math.min(i - colStart[c], colLen(t) - 1);
        i = colStart[t] + ord;
      }
      show(i);
      reveal(i);
      ev.preventDefault();
    } else if (ev.key === "Home") {
      show(0);
      reveal(0);
      ev.preventDefault();
    } else if (ev.key === "End") {
      show(n - 1);
      reveal(n - 1);
      ev.preventDefault();
    } else if (ev.key === "Enter") {
      if (cur >= 0 && data.rows[cur].h) window.location.href = data.rows[cur].h;
    } else if (ev.key === "Escape") {
      clear();
    }
  });

  // ---- save: fetch the server-rendered card, rasterize at 2x ----
  var slug = strip.getAttribute("data-slug");
  var season = strip.getAttribute("data-season");
  document.querySelectorAll(".sig-save button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.hasAttribute("aria-busy")) return; // already rendering
      var label = btn.textContent;
      var failed = false;
      btn.textContent = "RENDERING…";
      btn.setAttribute("aria-busy", "true");
      var url = "/show/" + slug + "/ratings.svg" + (season ? "?season=" + season : "");
      var name = slug + "-episode-ratings" + (season ? "-s" + season : "") + "-tvnightly";
      // no-cache: a save must always render the current card, never an
      // hour-old browser-cached SVG
      fetch(url, { cache: "no-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error("fetch");
          return r.text();
        })
        .then(function (text) {
          var svgBlob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
          var objUrl = URL.createObjectURL(svgBlob);
          var img = new Image();
          img.decoding = "sync";
          img.src = objUrl;
          return img
            .decode()
            .then(function () {
              // Safari: decode() resolves before the embedded font applies
              return new Promise(function (r) {
                setTimeout(r, 150);
              });
            })
            .then(function () {
              // 2x of the card's design size; height rides the viewBox ratio
              var vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(text);
              var w = 2160;
              var h = vb ? Math.round((w * parseFloat(vb[2])) / parseFloat(vb[1])) : 3840;
              var canvas = document.createElement("canvas");
              canvas.width = w;
              canvas.height = h;
              canvas.getContext("2d").drawImage(img, 0, 0, w, h);
              URL.revokeObjectURL(objUrl);
              return new Promise(function (resolve, reject) {
                canvas.toBlob(function (b) {
                  b ? resolve(b) : reject(new Error("toBlob"));
                }, "image/png");
              });
            })
            .catch(function (e) {
              URL.revokeObjectURL(objUrl);
              // fallback: hand over the raw SVG instead of nothing
              download(svgBlob, name + ".svg");
              throw e;
            });
        })
        .then(function (png) {
          if (!png) return;
          var file = new File([png], name + ".png", { type: "image/png" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            return navigator.share({ files: [file] }).catch(function () {
              download(png, name + ".png");
            });
          }
          download(png, name + ".png");
        })
        .catch(function () {
          failed = true;
        })
        .then(function () {
          btn.removeAttribute("aria-busy");
          btn.textContent = failed ? "Couldn't render — try again" : label;
          if (failed)
            setTimeout(function () {
              btn.textContent = label;
            }, 2500);
        });
    });
  });
  function download(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 5000);
  }
})();
