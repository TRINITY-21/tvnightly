// Chart ranked grid — load the next batch when the sentinel scrolls into view.
(function () {
  var sentinel = document.querySelector(".chart-rank-sentinel[data-chart-feed]");
  if (!sentinel) return;
  var list = document.querySelector("[data-chart-rank-list]");
  if (!list) return;

  var loading = false;

  function done() {
    sentinel.remove();
  }

  function loadMore() {
    if (loading) return;
    var offset = Number(sentinel.getAttribute("data-offset") || "0");
    var total = Number(sentinel.getAttribute("data-total") || "0");
    if (offset >= total) {
      done();
      return;
    }

    loading = true;
    sentinel.classList.add("is-loading");
    var url =
      sentinel.getAttribute("data-chart-feed") +
      (sentinel.getAttribute("data-chart-feed").indexOf("?") >= 0 ? "&" : "?") +
      "offset=" +
      encodeURIComponent(String(offset));

    fetch(url, { redirect: "manual" })
      .then(function (r) {
        if (r.status >= 300 && r.status < 400) return { html: "", next: total };
        if (r.status === 204) return { html: "", next: total };
        if (!r.ok) return { html: "", next: total };
        var nextH = r.headers.get("X-Chart-Next-Offset");
        var totalH = r.headers.get("X-Chart-Total");
        return r.text().then(function (html) {
          return {
            html: html,
            next: nextH ? Number(nextH) : offset,
            total: totalH ? Number(totalH) : total,
          };
        });
      })
      .then(function (res) {
        if (
          res.html &&
          (/<\s*html/i.test(res.html) ||
            /home-main-grid/.test(res.html) ||
            res.html.indexOf("chart-rank-card") === -1)
        ) {
          done();
          return;
        }
        if (res.html) {
          var wrap = document.createElement("div");
          wrap.innerHTML = res.html;
          while (wrap.firstChild) list.appendChild(wrap.firstChild);
        }
        var next = res.next;
        var totalN = res.total != null ? res.total : total;
        sentinel.setAttribute("data-offset", String(next));
        sentinel.setAttribute("data-total", String(totalN));
        if (next >= totalN) done();
        else window.requestAnimationFrame(maybeLoadMore);
      })
      .catch(function () {
        /* leave sentinel — user can scroll again to retry */
      })
      .finally(function () {
        loading = false;
        if (sentinel.parentNode) sentinel.classList.remove("is-loading");
      });
  }

  if ("IntersectionObserver" in window) {
    var obs = new IntersectionObserver(
      function (entries) {
        if (entries[0] && entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "640px 0px" },
    );
    obs.observe(sentinel);
  }

  function maybeLoadMore() {
    if (!sentinel.parentNode || loading) return;
    var rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 640) loadMore();
  }

  window.requestAnimationFrame(maybeLoadMore);
})();
