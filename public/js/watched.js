// "Mark watched" — stored only in the visitor's browser (localStorage), no backend.
(function () {
  var root = document.querySelector("[data-show-id]");
  if (!root) return;
  var key = "tvn:watched:" + root.dataset.showId;
  var set;
  try {
    set = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch (e) {
    set = new Set();
  }
  var boxes = document.querySelectorAll("input.watched[data-ep-id]");
  var progress = document.getElementById("watched-progress");

  function save() {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  }
  function render() {
    if (!progress) return;
    var total = Number(root.dataset.total || boxes.length);
    progress.hidden = set.size === 0;
    progress.textContent = set.size + " / " + total + " episodes watched";
  }

  boxes.forEach(function (cb) {
    var id = Number(cb.dataset.epId);
    cb.checked = set.has(id);
    cb.closest("li").classList.toggle("is-watched", cb.checked);
    cb.addEventListener("change", function () {
      if (cb.checked) set.add(id);
      else set.delete(id);
      cb.closest("li").classList.toggle("is-watched", cb.checked);
      save();
      render();
    });
  });
  render();
})();
