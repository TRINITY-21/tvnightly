// Exit-intent: reveal the per-show alert modal once per session when the visitor
// signals they're leaving — desktop, the cursor exits through the top of the
// viewport; touch, a decisive upward scroll after a few seconds of engagement.
// Session-guarded (won't nag) and fully dismissible. The modal markup ships in
// the page (so it has the show id + name); this only reveals + wires it.
(function () {
  var modal = document.getElementById("exit-capture");
  if (!modal) return;

  var KEY = "tvn_exit_shown";
  try {
    if (sessionStorage.getItem(KEY)) return;
  } catch (e) {}

  var shown = false;

  function show() {
    if (shown) return;
    shown = true;
    try {
      sessionStorage.setItem(KEY, "1");
    } catch (e) {}
    modal.hidden = false;
    document.addEventListener("keydown", onKey);
    cleanupTriggers();
    var email = modal.querySelector('input[type="email"]');
    if (email) email.focus();
  }

  function hide() {
    modal.hidden = true;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") hide();
  }

  // Backdrop click or the close button dismisses; the form itself navigates away.
  modal.addEventListener("click", function (e) {
    if (e.target === modal || (e.target.closest && e.target.closest("[data-exit-close]"))) hide();
  });

  // Desktop: pointer leaves through the top edge of the document.
  function onMouseOut(e) {
    if (!e.relatedTarget && e.clientY <= 0) show();
  }

  // Touch: no exit-intent event — arm after 8s, then treat a fast scroll back
  // toward the top (a "leaving" gesture) near the top of the page as intent.
  var lastY = window.scrollY,
    armed = false;
  function onScroll() {
    if (armed && window.scrollY < lastY - 40 && window.scrollY < 600) show();
    lastY = window.scrollY;
  }
  var armTimer = setTimeout(function () {
    armed = true;
  }, 8000);

  document.addEventListener("mouseout", onMouseOut);
  window.addEventListener("scroll", onScroll, { passive: true });

  function cleanupTriggers() {
    document.removeEventListener("mouseout", onMouseOut);
    window.removeEventListener("scroll", onScroll);
    clearTimeout(armTimer);
  }
})();
