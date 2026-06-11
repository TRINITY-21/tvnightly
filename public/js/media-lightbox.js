// In-page carousel for artwork grids: click opens a viewer over the page
// instead of leaving for the raw image file. Enhances plain links — without
// JS the thumb still opens the full image. Arrows/Escape navigate.
(function () {
  var thumbs = [].slice.call(document.querySelectorAll("a.media-art[data-gallery]"));
  if (!thumbs.length) return;
  var groups = {};
  thumbs.forEach(function (a) {
    var g = a.getAttribute("data-gallery");
    (groups[g] = groups[g] || []).push(a);
  });

  var overlay = null;
  var imgEl, countEl;
  var group = [];
  var idx = 0;
  var lastFocus = null;

  function svg(path) {
    return (
      '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="' + path + '"/></svg>'
    );
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Artwork viewer");
    overlay.innerHTML =
      '<button type="button" class="lb-btn lb-close" aria-label="Close">' +
      svg("M6 6l12 12M18 6L6 18") +
      "</button>" +
      '<button type="button" class="lb-btn lb-prev" aria-label="Previous image">' +
      svg("M14.5 5.5L8 12l6.5 6.5") +
      "</button>" +
      '<figure><img alt=""><figcaption class="lb-count"></figcaption></figure>' +
      '<button type="button" class="lb-btn lb-next" aria-label="Next image">' +
      svg("M9.5 5.5L16 12l-6.5 6.5") +
      "</button>";
    document.body.appendChild(overlay);
    imgEl = overlay.querySelector("img");
    countEl = overlay.querySelector(".lb-count");
    overlay.querySelector(".lb-close").addEventListener("click", close);
    overlay.querySelector(".lb-prev").addEventListener("click", function () {
      step(-1);
    });
    overlay.querySelector(".lb-next").addEventListener("click", function () {
      step(1);
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!overlay.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    });
  }

  function show() {
    var a = group[idx];
    imgEl.src = a.getAttribute("data-view") || a.href;
    imgEl.alt = a.getAttribute("data-alt") || "";
    countEl.textContent = idx + 1 + " / " + group.length;
  }
  function step(d) {
    idx = (idx + d + group.length) % group.length;
    show();
  }
  function open(g, i) {
    if (!overlay) build();
    group = groups[g];
    idx = i;
    lastFocus = document.activeElement;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    show();
    overlay.querySelector(".lb-close").focus();
  }
  function close() {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    imgEl.removeAttribute("src");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  Object.keys(groups).forEach(function (g) {
    groups[g].forEach(function (a, i) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        open(g, i);
      });
    });
  });
})();
