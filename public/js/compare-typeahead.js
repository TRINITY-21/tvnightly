/* Compare pickers: typing a title drops a poster dropdown of matches; picking
   one fills the field. Reuses /api/search and the house .ta-* row look. The
   plain inputs still work without JS (name LIKE on submit). */
(function () {
  "use strict";
  function esc(s) {
    var n = document.createElement("span");
    n.textContent = s == null ? "" : s;
    return n.innerHTML;
  }

  function attach(input, kind) {
    var label = input.closest("label");
    if (!label) return;
    input.setAttribute("autocomplete", "off");
    var box = document.createElement("div");
    box.className = "cmp-ac";
    box.hidden = true;
    label.appendChild(box);
    var active = -1;
    var timer;

    function close() {
      box.hidden = true;
      box.innerHTML = "";
      active = -1;
    }
    function opts() {
      return box.querySelectorAll(".ta-opt");
    }
    function highlight(list) {
      for (var i = 0; i < list.length; i++) list[i].classList.toggle("ta-active", i === active);
    }
    function render(list) {
      if (!list.length) {
        close();
        return;
      }
      box.innerHTML = list
        .map(function (r) {
          var thumb = r.poster
            ? '<img class="ta-thumb" src="' + esc(r.poster) + '" alt="" loading="lazy" decoding="async">'
            : '<span class="ta-thumb ta-thumb-blank"></span>';
          var kindLabel = r.kind === "movie" ? "Movie" : r.kind === "person" ? "Person" : "TV";
          var meta = [kindLabel, r.year, r.rating != null ? "★ " + r.rating.toFixed(1) : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            '<button type="button" class="ta-opt" data-name="' +
            esc(r.name) +
            '">' +
            thumb +
            '<span class="ta-main"><span class="ta-name">' +
            esc(r.name) +
            '</span><span class="ta-meta">' +
            esc(meta) +
            "</span></span></button>"
          );
        })
        .join("");
      box.hidden = false;
      active = -1;
    }
    function pick(name) {
      input.value = name;
      close();
      input.focus();
    }
    // spinner row while /api/search is in flight — matches the house typeaheads
    function showLoading() {
      box.innerHTML =
        '<div class="ta-loading"><span class="spinner spinner-sm" role="status" aria-label="Searching"></span><span>Searching…</span></div>';
      box.hidden = false;
      active = -1;
    }

    input.addEventListener("input", function () {
      var q = input.value.trim();
      if (q.length < 2) {
        close();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(function () {
        showLoading();
        fetch("/api/search?q=" + encodeURIComponent(q))
          .then(function (r) {
            return r.json();
          })
          .then(function (list) {
            if (input.value.trim() !== q) return;
            render(
              list
                .filter(function (x) {
                  return x.kind === kind;
                })
                .slice(0, 6),
            );
          })
          .catch(function () {});
      }, 140);
    });
    box.addEventListener("mousedown", function (e) {
      var b = e.target.closest(".ta-opt");
      if (!b) return;
      e.preventDefault();
      pick(b.getAttribute("data-name"));
    });
    input.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      var list = opts();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(active + 1, list.length - 1);
        highlight(list);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(active - 1, 0);
        highlight(list);
      } else if (e.key === "Enter" && active >= 0 && list[active]) {
        e.preventDefault();
        pick(list[active].getAttribute("data-name"));
      } else if (e.key === "Escape") {
        close();
      }
    });
    input.addEventListener("blur", function () {
      setTimeout(close, 120);
    });
  }

  var forms = document.querySelectorAll("form.compare-form");
  for (var i = 0; i < forms.length; i++) {
    var kind = forms[i].getAttribute("data-cmp-kind") || "tv";
    var inputs = forms[i].querySelectorAll('input[type="search"]');
    for (var j = 0; j < inputs.length; j++) attach(inputs[j], kind);
  }
})();
