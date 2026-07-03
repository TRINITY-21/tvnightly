// First-visit Discord welcome — once per browser (localStorage). Markup in
// Layout.tsx; invite URL is server-rendered into the CTA href.
(function () {
  var modal = document.getElementById("discord-welcome");
  if (!modal) return;

  var KEY = "tvn_discord_modal";
  try {
    if (localStorage.getItem(KEY)) return;
  } catch (e) {
    /* private mode — still show once this session */
  }

  function dismiss(persist) {
    modal.hidden = true;
    if (persist !== false) {
      try {
        localStorage.setItem(KEY, "1");
      } catch (e) {}
    }
  }

  function open() {
    modal.hidden = false;
    var closeBtn = modal.querySelector("[data-discord-close]");
    if (closeBtn) closeBtn.focus();
  }

  // Brief delay so the page paints before the overlay.
  setTimeout(open, 600);

  modal.querySelector("[data-discord-close]")?.addEventListener("click", function () {
    dismiss(true);
  });
  modal.querySelector(".discord-join-btn")?.addEventListener("click", function () {
    dismiss(true);
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) dismiss(true);
  });
  document.addEventListener("keydown", function (e) {
    if (!modal.hidden && e.key === "Escape") dismiss(true);
  });
})();
