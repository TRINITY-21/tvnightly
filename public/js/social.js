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

  render();
})();
