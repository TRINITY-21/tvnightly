// Signal chart interaction: crosshair + readout on hover/keys, and the
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

  var cur = -1;

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
    return best;
  }
  function seasonOf(i) {
    return parseInt(data.rows[i].c.slice(1, 3), 10);
  }
  function show(i) {
    cur = i;
    var row = data.rows[i];
    var x = data.x[i];
    var y = data.y[i];
    cursor.innerHTML =
      '<rect x="' + (x - data.cw / 2 - 1.5) + '" y="' + (y - data.ch / 2 - 1.5) +
      '" width="' + (data.cw + 3) + '" height="' + (data.ch + 3) +
      '" rx="8" fill="none" stroke="#FFA94D" stroke-width="1.5"/>';
    read.innerHTML =
      '<span class="sig-read-code">' + row.c + "</span>" +
      '<a class="sig-read-name" href="' + row.h + '">' + esc(row.n) + "</a>" +
      (row.r != null
        ? '<span class="rating">★ ' + row.r.toFixed(1) + "</span>"
        : '<span class="sig-read-code" style="opacity:.6">Unrated</span>') +
      (row.d ? '<span class="sig-read-date">' + row.d + "</span>" : "");
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
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  var downAt = null;
  svg.addEventListener("pointermove", function (ev) {
    show(nearest(vbPt(ev)));
  });
  svg.addEventListener("pointerleave", clear);
  svg.addEventListener("pointerdown", function (ev) {
    downAt = { x: ev.clientX, y: ev.clientY, t: ev.pointerType };
  });
  // navigate on a true mouse click only; touch taps scrub, and the readout's
  // name link is the touch navigation affordance
  svg.addEventListener("pointerup", function (ev) {
    if (!downAt || downAt.t !== "mouse") return;
    if (Math.abs(ev.clientX - downAt.x) > 4 || Math.abs(ev.clientY - downAt.y) > 4) return;
    var i = nearest(vbPt(ev));
    if (data.rows[i]) window.location.href = data.rows[i].h;
  });

  fig.addEventListener("keydown", function (ev) {
    var n = data.rows.length;
    var i = cur < 0 ? data.peak : cur;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      var dir = ev.key === "ArrowRight" ? 1 : -1;
      if (ev.shiftKey) {
        var s0 = seasonOf(i);
        var j = i;
        while (j + dir >= 0 && j + dir < n && seasonOf(j + dir) === s0) j += dir;
        if (j + dir >= 0 && j + dir < n) {
          j += dir;
          var s1 = seasonOf(j);
          while (j - 1 >= 0 && seasonOf(j - 1) === s1) j--;
        }
        i = j;
      } else i = Math.min(n - 1, Math.max(0, i + dir));
      show(i);
      ev.preventDefault();
    } else if (ev.key === "Home") {
      show(0);
      ev.preventDefault();
    } else if (ev.key === "End") {
      show(n - 1);
      ev.preventDefault();
    } else if (ev.key === "Enter") {
      if (cur >= 0) window.location.href = data.rows[cur].h;
    } else if (ev.key === "Escape") {
      clear();
    }
  });

  // ---- save: fetch the server-rendered card, rasterize at 2x ----
  var slug = strip.getAttribute("data-slug");
  var season = strip.getAttribute("data-season");
  strip.querySelectorAll(".sig-save button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var label = btn.textContent;
      btn.textContent = "RENDERING…";
      btn.setAttribute("aria-busy", "true");
      var url = "/show/" + slug + "/ratings.svg" + (season ? "?season=" + season : "");
      var name = slug + "-episode-ratings" + (season ? "-s" + season : "") + "-tvnightly";
      var restore = function () {
        btn.textContent = label;
        btn.removeAttribute("aria-busy");
      };
      fetch(url)
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
        .catch(function () {})
        .then(restore);
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
