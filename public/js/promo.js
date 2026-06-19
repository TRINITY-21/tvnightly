// Promo Studio: switch a card's preview between 1:1 / 9:16 / 16:9 and copy a
// caption to the clipboard. Event-delegated so it covers every moment on the page.
(function () {
  document.addEventListener("click", function (e) {
    var fmtBtn = e.target.closest && e.target.closest(".promo-fmt");
    if (fmtBtn) {
      var item = fmtBtn.closest(".promo-item");
      if (!item) return;
      var url = item.querySelector(".promo-img").dataset[fmtBtn.dataset.fmt];
      if (url) {
        var img = item.querySelector(".promo-img");
        img.src = url;
        var dl = item.querySelector(".promo-dl");
        if (dl) dl.href = url;
        item.querySelectorAll(".promo-fmt").forEach(function (b) {
          b.classList.toggle("is-on", b === fmtBtn);
        });
      }
      return;
    }
    var copyBtn = e.target.closest && e.target.closest(".promo-copy");
    if (copyBtn) {
      var box = copyBtn.closest(".promo-cap");
      var ta = box && box.querySelector(".promo-cap-text");
      if (!ta) return;
      var done = function () {
        var prev = copyBtn.textContent;
        copyBtn.textContent = "Copied ✓";
        copyBtn.classList.add("is-done");
        setTimeout(function () {
          copyBtn.textContent = prev;
          copyBtn.classList.remove("is-done");
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(done).catch(function () {
          ta.select();
          document.execCommand("copy");
          done();
        });
      } else {
        ta.select();
        document.execCommand("copy");
        done();
      }
    }
  });
})();
