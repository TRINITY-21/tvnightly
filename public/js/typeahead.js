(function () {
  var input = document.querySelector(".search input");
  if (!input) return;
  var box = document.createElement("div");
  box.className = "ta-box";
  box.hidden = true;
  box.setAttribute("role", "listbox");
  input.parentNode.appendChild(box);
  input.setAttribute("autocomplete", "off");

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
})();
