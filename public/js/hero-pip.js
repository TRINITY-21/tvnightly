// Detail hero trailer: when the inline player scrolls off screen, keep it
// playing in a fixed mini-player (picture-in-picture style) bottom-right.
// Reparent to <body> while docked so overflow/transform ancestors can't bury it.
(function () {
  document.querySelectorAll("[data-hero-pip]").forEach(function (anchor) {
    var video = anchor.querySelector(".hub-hero-video, .chart-hero-video");
    if (!video || anchor.classList.contains("is-trailer-unavailable")) return;

    var slot = null;

    function setPip(on) {
      video.classList.toggle("is-pip", on);
      anchor.classList.toggle("has-pip", on);
      if (on) {
        if (!slot) {
          slot = document.createComment("hero-pip-slot");
          video.parentNode.insertBefore(slot, video);
        }
        document.body.appendChild(video);
      } else if (slot && slot.parentNode) {
        slot.parentNode.insertBefore(video, slot);
      }
    }

    if (!("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          // the trailer can fail ASYNC (all candidates region-blocked) after we
          // set this up — never dock a now backdrop-only hero into a mini-player
          if (anchor.classList.contains("is-trailer-unavailable")) {
            setPip(false);
            observer.disconnect();
            return;
          }
          if (entry.isIntersecting) {
            setPip(false);
            return;
          }
          // only dock once the hero has scrolled up past the viewport
          if (entry.boundingClientRect.top < 0) setPip(true);
        });
      },
      { threshold: 0 },
    );

    observer.observe(anchor);
  });
})();
