(function () {
  var form = document.querySelector(".srch-form");
  if (!form) return;
  var bar = document.querySelector(".srch-bar");
  var input = form.querySelector('input[name="q"]');
  var live = document.querySelector(".srch-live");
  var title = document.querySelector(".srch-title");
  var filterDd = document.querySelector(".srch-filter-dd");
  if (!input || !live || !bar) return;

  var timer;
  var pending;
  var activeFilter = "all";
  var filterLabels = { all: "Filter", tv: "TV shows", movie: "Movies", person: "People" };

  function filterBtn() {
    return document.querySelector(".srch-filter-btn");
  }

  function syncToolbar(q) {
    if (filterDd) filterDd.hidden = !q;
  }

  function closeDropdown() {
    if (!filterDd) return;
    filterDd.classList.remove("open");
    var btn = filterBtn();
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function updateFilterButton() {
    var btn = filterBtn();
    if (!btn) return;
    btn.textContent = filterLabels[activeFilter] || "Filter";
    btn.classList.toggle("is-filtered", activeFilter !== "all");
  }

  function setFilter(kind) {
    activeFilter = kind;
    document.querySelectorAll(".srch-filter-opt[data-filter]").forEach(function (opt) {
      var on = opt.dataset.filter === kind;
      opt.classList.toggle("is-active", on);
      if (on) opt.setAttribute("aria-selected", "true");
      else opt.removeAttribute("aria-selected");
    });
    updateFilterButton();
    applyFilter();
  }

  function applyFilter() {
    live.querySelectorAll("[data-srch-kind]").forEach(function (el) {
      var show = activeFilter === "all" || el.dataset.srchKind === activeFilter;
      el.hidden = !show;
    });
  }

  function syncFilterMenu() {
    document.querySelectorAll(".srch-filter-opt[data-filter]").forEach(function (opt) {
      if (opt.dataset.filter === "all") return;
      var kind = opt.dataset.filter;
      var count = live.querySelectorAll('[data-srch-kind="' + kind + '"]').length;
      opt.classList.toggle("is-disabled", count === 0);
      opt.setAttribute("aria-disabled", count === 0 ? "true" : "false");
      if (count === 0 && activeFilter === kind) setFilter("all");
    });
    document.querySelectorAll(".srch-filter-opt[data-filter]").forEach(function (opt) {
      var on = opt.dataset.filter === activeFilter;
      opt.classList.toggle("is-active", on);
      if (on) opt.setAttribute("aria-selected", "true");
      else opt.removeAttribute("aria-selected");
    });
    updateFilterButton();
  }

  function runSearch(q) {
    if (pending) pending.abort();
    var ac = new AbortController();
    pending = ac;

    closeDropdown();
    syncToolbar(q);

    var url = "/search" + (q ? "?q=" + encodeURIComponent(q) : "");
    history.replaceState(null, "", url);
    document.title = q ? "Search: " + q + " | TV Nightly" : "Search | TV Nightly";
    if (title) title.textContent = q ? "Results" : "Find a show, movie, or person";

    if (!q) setFilter("all");

    fetch(url, { signal: ac.signal, headers: { Accept: "text/html" } })
      .then(function (r) {
        return r.text();
      })
      .then(function (html) {
        if (ac.signal.aborted) return;
        var doc = new DOMParser().parseFromString(html, "text/html");
        var nextLive = doc.querySelector(".srch-live");
        var nextDd = doc.querySelector(".srch-filter-dd");
        if (nextLive) live.innerHTML = nextLive.innerHTML;
        if (nextDd && filterDd) filterDd.innerHTML = nextDd.innerHTML;
        syncFilterMenu();
        applyFilter();
      })
      .catch(function (e) {
        if (e.name === "AbortError") return;
      })
      .finally(function () {
        if (pending === ac) pending = null;
      });
  }

  bar.addEventListener("click", function (e) {
    var btn = e.target.closest(".srch-filter-btn");
    if (btn && filterDd) {
      var open = filterDd.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }

    if (e.target.closest('[data-action="clear"]')) {
      closeDropdown();
      input.value = "";
      input.focus();
      clearTimeout(timer);
      runSearch("");
      return;
    }

    var opt = e.target.closest(".srch-filter-opt[data-filter]");
    if (opt && !opt.classList.contains("is-disabled")) {
      setFilter(opt.dataset.filter);
      closeDropdown();
    }
  });

  document.addEventListener("click", function (e) {
    if (filterDd && filterDd.classList.contains("open") && !filterDd.contains(e.target)) {
      closeDropdown();
    }
  });

  input.addEventListener("input", function () {
    clearTimeout(timer);
    var q = input.value.trim();
    syncToolbar(q);
    timer = setTimeout(function () {
      runSearch(q);
    }, 300);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearTimeout(timer);
    runSearch(input.value.trim());
  });

  syncToolbar(input.value.trim());
  syncFilterMenu();
  applyFilter();
})();
