(function () {
  // One-tap "Seen it?" verdicts on title pages: record the rating in place
  // (ajax) and show a "rated" state, instead of navigating to the recommender.
  // No-JS still works — the <form> posts to /recommend as a fallback.
  function rate(form) {
    var box = form.closest(".rate-inline");
    if (!box || box.classList.contains("is-rated")) return;
    var fd = new FormData(form);
    fd.append("ajax", "1");
    fetch("/recommend", { method: "POST", body: fd }).catch(function () {});
    // optimistic UI — just light up the chosen face, no text (the verdict is
    // anonymous and de-duped server-side)
    box.classList.add("is-rated");
    form.classList.add("is-chosen");
  }
  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target && e.target.closest ? e.target.closest(".rate-inline .verdict-form") : null;
      if (!form) return;
      e.preventDefault();
      rate(form);
    },
    true,
  );
})();
