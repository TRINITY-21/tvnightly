(function () {
  var input = document.querySelector(".search input");
  if (!input) return;
  var box = document.createElement("div");
  box.className = "ta-box";
  box.hidden = true;
  input.parentNode.appendChild(box);

  var timer;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    var q = input.value.trim();
    if (q.length < 2) {
      box.hidden = true;
      return;
    }
    timer = setTimeout(function () {
      fetch("/api/search?q=" + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (items) {
          box.innerHTML = "";
          items.forEach(function (it) {
            var a = document.createElement("a");
            a.href = "/show/" + it.slug;
            a.textContent = it.name + (it.year ? " (" + it.year + ")" : "");
            box.appendChild(a);
          });
          box.hidden = items.length === 0;
        })
        .catch(function () { box.hidden = true; });
    }, 150);
  });

  document.addEventListener("click", function (e) {
    if (e.target !== input && !box.contains(e.target)) box.hidden = true;
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") box.hidden = true;
  });
})();
