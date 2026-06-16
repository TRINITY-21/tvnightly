// ShareBar: reveal the control (server ships it hidden — useless without JS) and
// wire the single Share button. Native OS share sheet where available; otherwise
// copy the link to the clipboard with a "Link copied" confirmation. Either way
// the one button works, and the page URL stays shareable from the address bar.
(function () {
  function flash(btn, msg) {
    var t = btn.querySelector(".share-btn-t");
    if (!t) return;
    var orig = t.getAttribute("data-orig") || t.textContent;
    t.setAttribute("data-orig", orig);
    t.textContent = msg;
    btn.classList.add("is-copied");
    setTimeout(function () {
      t.textContent = orig;
      btn.classList.remove("is-copied");
    }, 1800);
  }
  function copyLink(url, btn, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          flash(btn, msg);
        },
        function () {
          flash(btn, msg);
        },
      );
    } else {
      var ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (e) {}
      document.body.removeChild(ta);
      flash(btn, msg);
    }
  }

  document.querySelectorAll(".share-bar").forEach(function (bar) {
    bar.hidden = false;
    var url = bar.getAttribute("data-share-url") || location.href;
    var title = bar.getAttribute("data-share-title") || document.title;
    var btn = bar.querySelector(".share-native");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (navigator.share) {
        navigator.share({ title: title, text: title, url: url }).catch(function () {});
        return;
      }
      copyLink(url, btn, btn.getAttribute("data-copied") || "Link copied");
    });
  });
})();
