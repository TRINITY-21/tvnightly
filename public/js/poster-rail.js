(function () {
  function updateRail(rail) {
    var row = rail.querySelector(".poster-row");
    if (!row) return;
    var max = row.scrollWidth - row.clientWidth;
    var sl = row.scrollLeft;
    var overflow = max > 6;
    rail.classList.toggle("can-scroll", overflow);
    rail.classList.toggle("can-scroll-left", overflow && sl > 6);
    rail.classList.toggle("can-scroll-right", overflow && sl < max - 6);
  }

  function scrollRail(rail, dir) {
    var row = rail.querySelector(".poster-row");
    if (!row) return;
    var card = row.querySelector(".card");
    var gap = parseFloat(getComputedStyle(row).gap) || 16;
    var step = card ? (card.offsetWidth + gap) * 2 : row.clientWidth * 0.75;
    row.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  function bindRail(rail) {
    var row = rail.querySelector(".poster-row");
    var prev = rail.querySelector(".rail-btn-prev");
    var next = rail.querySelector(".rail-btn-next");
    if (!row || !prev || !next) return;

    function refresh() {
      updateRail(rail);
    }
    refresh();
    row.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    prev.addEventListener("click", function () {
      scrollRail(rail, -1);
    });
    next.addEventListener("click", function () {
      scrollRail(rail, 1);
    });
  }

  document.querySelectorAll(".poster-rail").forEach(bindRail);

  var tabs = document.querySelector(".discover-tabs");
  if (tabs) {
    tabs.querySelectorAll('input[name="discover"]').forEach(function (input) {
      input.addEventListener("change", function () {
        setTimeout(function () {
          document.querySelectorAll(".poster-rail").forEach(updateRail);
        }, 0);
      });
    });
  }
})();
