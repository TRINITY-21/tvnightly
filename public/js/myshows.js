// "My shows" — reads tvn:watched:* from localStorage, asks /api/progress where
// you are in each show, renders the answer. Data never persists server-side.
(function () {
  var container = document.getElementById("myshows");
  if (!container) return;

  function collect() {
    var shows = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf("tvn:watched:") !== 0) continue;
      var id = key.slice("tvn:watched:".length);
      try {
        var ids = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(ids) && ids.length) shows[id] = ids;
      } catch (e) {}
    }
    return shows;
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function render(data) {
    if (!data.shows || data.shows.length === 0) {
      container.innerHTML =
        '<p class="muted">Nothing tracked yet. Open any show and tick the episodes you\'ve seen — ' +
        'try the <a href="/">popular shows</a> or your <a href="/search">search</a>.</p>';
      return;
    }
    var html = data.shows
      .map(function (s) {
        var pct = s.total ? Math.round((s.watched / s.total) * 100) : 0;
        var line;
        if (s.next) {
          line =
            "You're on <strong>" + esc(s.next.code) + (s.next.name ? " — " + esc(s.next.name) : "") + "</strong>";
        } else if (s.nextAiring) {
          line =
            "Caught up! Next episode " + esc(s.nextAiring.code) + " airs <strong>" + esc(s.nextAiring.airdate || "soon") + "</strong>";
        } else if (s.status === "Ended") {
          line = s.watched >= s.total ? "Finished — series complete 🏁" : "Caught up";
        } else {
          line = "Caught up — no next episode announced";
        }
        return (
          '<div class="track-card">' +
          '<h3><a href="/show/' + esc(s.slug) + '">' + esc(s.name) + "</a></h3>" +
          "<p>" + line + "</p>" +
          '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
          '<p class="muted">' + s.watched + " / " + s.total + " aired episodes (" + pct + "%)</p>" +
          "</div>"
        );
      })
      .join("");
    container.innerHTML = '<div class="track-grid">' + html + "</div>";
  }

  var shows = collect();
  var exportBox = document.getElementById("export-box");
  if (exportBox) exportBox.value = JSON.stringify({ version: 1, watched: shows });

  var copyBtn = document.getElementById("copy-btn");
  if (copyBtn)
    copyBtn.addEventListener("click", function () {
      exportBox.select();
      navigator.clipboard.writeText(exportBox.value).then(function () {
        copyBtn.textContent = "Copied!";
      });
    });

  var importBtn = document.getElementById("import-btn");
  if (importBtn)
    importBtn.addEventListener("click", function () {
      try {
        var data = JSON.parse(exportBox.value);
        var incoming = data.watched || {};
        Object.keys(incoming).forEach(function (id) {
          if (!/^\d+$/.test(id) || !Array.isArray(incoming[id])) return;
          var key = "tvn:watched:" + id;
          var current = [];
          try { current = JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) {}
          var merged = current.concat(incoming[id].filter(function (n) { return Number.isInteger(n); }));
          localStorage.setItem(key, JSON.stringify(Array.from(new Set(merged))));
        });
        location.reload();
      } catch (e) {
        importBtn.textContent = "That didn't parse — paste the exact code";
      }
    });

  if (Object.keys(shows).length === 0) {
    render({ shows: [] });
    return;
  }
  fetch("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shows: shows }),
  })
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () {
      container.innerHTML = '<p class="muted">Couldn\'t load progress — try a refresh.</p>';
    });
})();
