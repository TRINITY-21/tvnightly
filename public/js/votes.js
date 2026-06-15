// Agree/disagree voting on ranked episodes. One vote per episode per browser
// (localStorage) and per IP (server-side hash dedupe).
(function () {
  document.querySelectorAll(".vote").forEach(function (wrap) {
    var epId = wrap.dataset.epId;
    var key = "tvn:voted:" + epId;
    if (localStorage.getItem(key)) wrap.classList.add("voted");
    wrap.querySelectorAll(".vote-btn").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (localStorage.getItem(key)) return;
        if (wrap.classList.contains("is-voting")) return; // a vote is already in flight
        // spin the tapped pill and lock the pair until the round-trip lands —
        // /api/vote has no navigation, so the nav bar never fires for this
        wrap.classList.add("is-voting");
        btn.setAttribute("aria-busy", "true");
        function done() {
          wrap.classList.remove("is-voting");
          btn.removeAttribute("aria-busy");
        }
        fetch("/api/vote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ episodeId: Number(epId), dir: btn.dataset.dir }),
        })
          .then(function (r) { return r.json(); })
          .then(function (counts) {
            var up = wrap.querySelector('[data-dir="up"] .vote-count');
            var down = wrap.querySelector('[data-dir="down"] .vote-count');
            if (up) up.textContent = counts.up;
            if (down) down.textContent = counts.down;
            localStorage.setItem(key, btn.dataset.dir);
            wrap.classList.add("voted");
            done();
          })
          .catch(done);
      });
    });
  });
})();
