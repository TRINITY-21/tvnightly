// Detail hero trailer: when the inline player scrolls off screen, keep it
// playing in a fixed mini-player (picture-in-picture style) bottom-right.
(function () {
  var anchor = document.querySelector("[data-hero-pip]");
  if (!anchor) return;

  var video = anchor.querySelector(".hub-hero-video");
  if (!video) return;

  function setPip(on) {
    video.classList.toggle("is-pip", on);
    anchor.classList.toggle("has-pip", on);
  }

  if (!("IntersectionObserver" in window)) return;

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
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
})();
