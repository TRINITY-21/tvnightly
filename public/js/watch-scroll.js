// "Find my picks" reloads /what-to-watch with the results below a tall filter
// card. On a phone the picks land off-screen, so bring them into view once a
// search has actually run.
(function () {
  if (!window.location.search) return; // only after a submit, not the bare page
  if (!window.matchMedia("(max-width: 700px)").matches) return; // mobile only
  var results = document.querySelector(".watch-results");
  if (!results) return;
  // real picks (or a "no matches" note) — never the idle skeleton primer
  if (!results.querySelector(".shortlist-duo, .watch-miss")) return;
  // let layout + the browser's own scroll restoration settle first
  setTimeout(function () {
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
})();
