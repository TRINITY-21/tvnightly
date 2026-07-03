// Branded handoff screen → Bynge player (/play/*).
(function () {
  var root = document.querySelector(".bynge-handoff");
  if (!root) return;
  var target = root.getAttribute("data-target");
  if (!target) return;

  var fill = root.querySelector(".bynge-handoff-bar-fill");
  var duration = 1500;
  var start = performance.now();

  function tick(now) {
    var p = Math.min(1, (now - start) / duration);
    if (fill) fill.style.transform = "scaleX(" + p + ")";
    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      window.location.replace(target);
    }
  }

  requestAnimationFrame(tick);
})();
