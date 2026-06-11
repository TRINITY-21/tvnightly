// The frame viewer: clicking artwork opens a full-screen room where the
// image owns the screen — ambient blurred fill behind a contained image,
// filmstrip rail for orientation, quiet floating controls. Enhances plain
// links: without JS the thumb still opens the full image.
(function () {
  var thumbs = [].slice.call(document.querySelectorAll("a.media-art[data-gallery]"));
  if (!thumbs.length) return;
  var groups = {};
  thumbs.forEach(function (a) {
    var g = a.getAttribute("data-gallery");
    (groups[g] = groups[g] || []).push(a);
  });

  var view = null;
  var ambientEl, imgEl, titleEl, kindEl, numEl, stripEl;
  var group = [];
  var kind = "";
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
    view = document.createElement("div");
    view.className = "frame-view";
    view.setAttribute("role", "dialog");
    view.setAttribute("aria-modal", "true");
    view.setAttribute("aria-label", "Artwork viewer");
    view.innerHTML =
      '<img class="fv-ambient" alt="" aria-hidden="true">' +
      '<div class="fv-stage"><img class="fv-img" alt=""></div>' +
      '<div class="fv-meta"><strong class="fv-title"></strong><span class="fv-kind"></span></div>' +
      '<span class="fv-num" aria-hidden="true"></span>' +
      '<div class="fv-strip" aria-label="All artwork in this set"></div>' +
      '<button type="button" class="fv-btn fv-full" aria-label="Toggle fullscreen">' +
      svg("M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5") +
      "</button>" +
      '<button type="button" class="fv-btn fv-close" aria-label="Close">' +
      svg("M6 6l12 12M18 6L6 18") +
      "</button>" +
      '<div class="fv-transport">' +
      '<button type="button" class="fv-btn fv-prev" aria-label="Previous image">' +
      svg("M14.5 5.5L8 12l6.5 6.5") +
      "</button>" +
      '<button type="button" class="fv-btn fv-next" aria-label="Next image">' +
      svg("M9.5 5.5L16 12l-6.5 6.5") +
      "</button></div>";
    document.body.appendChild(view);
    ambientEl = view.querySelector(".fv-ambient");
    imgEl = view.querySelector(".fv-img");
    titleEl = view.querySelector(".fv-title");
    kindEl = view.querySelector(".fv-kind");
    numEl = view.querySelector(".fv-num");
    stripEl = view.querySelector(".fv-strip");
    view.querySelector(".fv-close").addEventListener("click", close);
    view.querySelector(".fv-prev").addEventListener("click", function () {
      step(-1);
    });
    view.querySelector(".fv-next").addEventListener("click", function () {
      step(1);
    });
    view.querySelector(".fv-full").addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (view.requestFullscreen) view.requestFullscreen();
    });
    view.addEventListener("click", function (e) {
      if (e.target === view || e.target.classList.contains("fv-stage")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!view.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    });
  }

  function buildStrip() {
    stripEl.innerHTML = "";
    group.forEach(function (a, i) {
      var t = document.createElement("button");
      t.type = "button";
      t.className = "fv-thumb";
      t.setAttribute("aria-label", "Image " + (i + 1) + " of " + group.length);
      var src = a.querySelector("img");
      if (src) {
        var im = document.createElement("img");
        im.src = src.currentSrc || src.src;
        im.alt = "";
        im.loading = "lazy";
        t.appendChild(im);
      }
      t.addEventListener("click", function () {
        idx = i;
        show();
      });
      stripEl.appendChild(t);
    });
  }

  function show() {
    var a = group[idx];
    var src = a.getAttribute("data-view") || a.href;
    imgEl.src = src;
    imgEl.alt = a.getAttribute("data-alt") || "";
    ambientEl.src = src;
    kindEl.textContent = kind + " · " + (idx + 1) + " / " + group.length;
    numEl.textContent = (idx + 1 < 10 ? "0" : "") + (idx + 1);
    [].forEach.call(stripEl.children, function (t, i) {
      t.classList.toggle("active", i === idx);
      if (i === idx && t.scrollIntoView) t.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }
  function step(d) {
    idx = (idx + d + group.length) % group.length;
    show();
  }
  function open(g, i) {
    if (!view) build();
    group = groups[g];
    idx = i;
    var holder = group[0].closest("[data-gallery-title]");
    titleEl.textContent = holder ? holder.getAttribute("data-gallery-title") : "";
    kind = holder ? holder.getAttribute("data-gallery-kind") || "" : "";
    lastFocus = document.activeElement;
    buildStrip();
    view.classList.add("open");
    document.body.style.overflow = "hidden";
    show();
    view.querySelector(".fv-close").focus();
  }
  function close() {
    if (document.fullscreenElement) document.exitFullscreen();
    view.classList.remove("open");
    document.body.style.overflow = "";
    imgEl.removeAttribute("src");
    ambientEl.removeAttribute("src");
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
