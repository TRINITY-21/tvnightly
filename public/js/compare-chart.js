/* Head-to-head episode chart: hovering anywhere over the plot drops a crosshair
   on the nearest episode, lights a dot on each series, and floats a tooltip with
   each episode's still, code, title and rating. Pure-progressive: the chart is a
   complete static SVG without this script. */
(function () {
  "use strict";
  var graph = document.querySelector(".vsx-graph");
  if (!graph) return;
  var svg = graph.querySelector("svg.vsx-svg");
  var dataEl = graph.querySelector(".vsx-graph-data");
  var tip = graph.querySelector(".vsx-tip");
  if (!svg || !dataEl || !tip) return;

  var d;
  try {
    d = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }
  var cursor = svg.querySelector(".vsx-cursor");
  var cross = svg.querySelector(".vsx-cross");
  var dotA = svg.querySelector(".vsx-dot-a");
  var dotB = svg.querySelector(".vsx-dot-b");
  var colors = ["#FFA94D", "#FF5C8A"];
  var maxN = Math.max(d.sa.length, d.sb.length);
  if (!maxN) return;

  function esc(s) {
    var n = document.createElement("span");
    n.textContent = s == null ? "" : s;
    return n.innerHTML;
  }
  function hide() {
    if (cursor) cursor.style.display = "none";
    tip.style.display = "none";
  }
  function row(p, color) {
    if (!p) return "";
    var img = p.img
      ? '<img class="vsx-tip-img" src="' + esc(p.img) + '" alt="" loading="lazy" decoding="async">'
      : '<span class="vsx-tip-img vsx-tip-img--none"></span>';
    return (
      '<span class="vsx-tip-row">' +
      img +
      '<span class="vsx-tip-meta"><span class="vsx-tip-dot" style="background:' +
      color +
      '"></span>' +
      (p.code ? "<b>" + esc(p.code) + "</b> " : "") +
      esc(p.name) +
      "</span>" +
      '<span class="vsx-tip-rate">' +
      (p.r != null ? '<svg class="rating-star" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.74 5.55 6.13.9-4.44 4.32 1.05 6.11L12 16.69l-5.48 2.79 1.05-6.11L3.13 9.05l6.13-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg> ' + p.r.toFixed(1) : "") +
      "</span></span>"
    );
  }
  function place(clientX) {
    var rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    var svgX = ((clientX - rect.left) / rect.width) * d.w;
    var i = Math.round((svgX - d.l) / d.step);
    if (i < 0) i = 0;
    if (i > maxN - 1) i = maxN - 1;
    var pa = d.sa[i] || null;
    var pb = d.sb[i] || null;
    var anchor = pa || pb;
    if (!anchor) {
      hide();
      return;
    }
    if (cursor) cursor.style.display = "";
    if (cross) {
      cross.setAttribute("x1", anchor.x);
      cross.setAttribute("x2", anchor.x);
    }
    if (dotA) {
      dotA.style.display = pa ? "" : "none";
      if (pa) {
        dotA.setAttribute("cx", pa.x);
        dotA.setAttribute("cy", pa.y);
      }
    }
    if (dotB) {
      dotB.style.display = pb ? "" : "none";
      if (pb) {
        dotB.setAttribute("cx", pb.x);
        dotB.setAttribute("cy", pb.y);
      }
    }
    tip.innerHTML =
      '<span class="vsx-tip-head">Episode ' + (i + 1) + "</span>" + row(pa, colors[0]) + row(pb, colors[1]);
    tip.style.display = "block";
    var graphRect = graph.getBoundingClientRect();
    var px = (anchor.x / d.w) * rect.width + (rect.left - graphRect.left);
    var tw = tip.offsetWidth;
    var left = px - tw / 2;
    if (left < 6) left = 6;
    if (left + tw > graphRect.width - 6) left = graphRect.width - tw - 6;
    tip.style.left = left + "px";
  }

  svg.addEventListener("pointermove", function (e) {
    place(e.clientX);
  });
  svg.addEventListener("pointerdown", function (e) {
    place(e.clientX);
  });
  // Mouse: leaving the plot clears the card. Touch: keep it up after a tap —
  // iOS fires pointerleave the instant the tap ends (and a long-press hands off
  // to the image callout), which made the card flash and vanish. On touch we
  // dismiss by tapping outside the chart instead.
  svg.addEventListener("pointerleave", function (e) {
    if (e.pointerType === "mouse") hide();
  });
  document.addEventListener("pointerdown", function (e) {
    if (!graph.contains(e.target)) hide();
  });
})();
