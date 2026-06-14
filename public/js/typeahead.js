(function () {
  var input = document.querySelector(".search input");
  if (!input) return;
  var box = document.createElement("div");
  box.className = "ta-box";
  box.hidden = true;
  box.setAttribute("role", "listbox");
  input.parentNode.appendChild(box);
  input.setAttribute("autocomplete", "off");

  // --- keep the page still while searching ---------------------------------
  // The field lives in a position:sticky header. Chromium re-scrolls the focused
  // field "into view" on focus and on every keystroke, and — fighting the sticky
  // offset — that drags the whole page upward a header's-height at a time. Hold
  // the position the user was at; release it the instant they scroll on purpose.
  var lockY = null;
  function lockScroll() {
    lockY = window.scrollY;
  }
  function releaseScroll() {
    lockY = null;
  }
  input.addEventListener("pointerdown", lockScroll, true);
  input.addEventListener("focus", function () {
    if (lockY === null) lockScroll();
  });
  input.addEventListener("keydown", function () {
    if (lockY === null) lockScroll();
  });
  input.addEventListener("blur", releaseScroll);
  window.addEventListener("wheel", releaseScroll, { passive: true });
  window.addEventListener("touchmove", releaseScroll, { passive: true });
  window.addEventListener(
    "scroll",
    function () {
      if (lockY !== null && window.scrollY !== lockY) window.scrollTo(0, lockY);
    },
    { passive: true },
  );

  var active = -1;
  var QUICK = [
    ["Top TV shows", "/top/tv"],
    ["Best movies", "/movies/best"],
    ["Browse everything", "/lists"],
  ];

  function rows() {
    return box.querySelectorAll("a.ta-row, a.ta-all");
  }
  function close() {
    box.hidden = true;
    active = -1;
  }
  function setActive(i) {
    var list = rows();
    if (!list.length) return;
    if (active >= 0 && list[active]) list[active].classList.remove("ta-active");
    active = ((i % list.length) + list.length) % list.length;
    list[active].classList.add("ta-active");
  }

  function showHint() {
    if (input.value.trim().length >= 2) return;
    box.innerHTML = "";
    var hint = document.createElement("p");
    hint.className = "ta-hint";
    hint.textContent = "Search shows, movies, and people";
    box.appendChild(hint);
    QUICK.forEach(function (pair) {
      var a = document.createElement("a");
      a.className = "ta-quick";
      a.href = pair[1];
      a.textContent = pair[0];
      box.appendChild(a);
    });
    box.hidden = false;
  }

  // a brief spinner row while /api/search is in flight
  function showLoading() {
    box.innerHTML = "";
    active = -1;
    var row = document.createElement("div");
    row.className = "ta-loading";
    var sp = document.createElement("span");
    sp.className = "spinner spinner-sm";
    sp.setAttribute("role", "status");
    sp.setAttribute("aria-label", "Searching");
    var txt = document.createElement("span");
    txt.textContent = "Searching…";
    row.appendChild(sp);
    row.appendChild(txt);
    box.appendChild(row);
    box.hidden = false;
  }

  function hrefFor(it) {
    if (it.kind === "movie") return "/movie/" + it.slug;
    if (it.kind === "person") return "/person/" + it.slug;
    return "/show/" + it.slug;
  }
  function kindLabel(it) {
    if (it.kind === "movie") return "Movie";
    if (it.kind === "person") return "Person";
    return "TV show";
  }

  function render(items, q) {
    box.innerHTML = "";
    active = -1;
    items.forEach(function (it) {
      var a = document.createElement("a");
      a.className = "ta-row";
      a.href = hrefFor(it);
      a.setAttribute("role", "option");

      if (it.poster) {
        var img = document.createElement("img");
        img.className = "ta-thumb";
        img.src = it.poster;
        img.alt = "";
        img.width = 30;
        img.height = 44;
        img.loading = "lazy";
        img.decoding = "async";
        a.appendChild(img);
      } else {
        var blank = document.createElement("span");
        blank.className = "ta-thumb ta-thumb-blank";
        a.appendChild(blank);
      }

      var main = document.createElement("span");
      main.className = "ta-main";
      var name = document.createElement("span");
      name.className = "ta-name";
      name.textContent = it.name;
      var meta = document.createElement("span");
      meta.className = "ta-meta";
      meta.textContent = kindLabel(it) + (it.year ? " · " + it.year : "");
      main.appendChild(name);
      main.appendChild(meta);
      a.appendChild(main);

      if (it.rating != null) {
        var r = document.createElement("span");
        r.className = "ta-rating";
        r.textContent = "★ " + Number(it.rating).toFixed(1);
        a.appendChild(r);
      }
      box.appendChild(a);
    });

    var all = document.createElement("a");
    all.className = "ta-all";
    all.href = "/search?q=" + encodeURIComponent(q);
    all.textContent = "All results for “" + q + "”";
    box.appendChild(all);

    box.hidden = false;
  }

  var timer;
  var ignoreClose = false;
  input.addEventListener("mousedown", function () {
    ignoreClose = true;
    setTimeout(function () {
      ignoreClose = false;
    }, 0);
  });
  input.addEventListener("focus", showHint);
  input.addEventListener("input", function () {
    clearTimeout(timer);
    var q = input.value.trim();
    if (q.length < 2) {
      showHint();
      return;
    }
    timer = setTimeout(function () {
      showLoading();
      fetch("/api/search?q=" + encodeURIComponent(q))
        .then(function (r) {
          return r.json();
        })
        .then(function (items) {
          if (input.value.trim() !== q) return;
          if (!items.length) {
            close();
            return;
          }
          render(items, q);
        })
        .catch(close);
    }, 300);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (box.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      window.location.href = rows()[active].href;
    }
  });

  box.addEventListener("mouseover", function (e) {
    var a = e.target.closest("a.ta-row, a.ta-all");
    if (!a) return;
    var list = rows();
    for (var i = 0; i < list.length; i++) {
      if (list[i] === a) {
        setActive(i);
        return;
      }
    }
  });

  document.addEventListener("click", function (e) {
    if (ignoreClose) return;
    if (e.target !== input && !box.contains(e.target)) close();
  });

  // "/" jumps to search from anywhere on the page (the .search-key chip
  // advertises it) — but never while the user is already typing somewhere.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    var tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
  });
})();
