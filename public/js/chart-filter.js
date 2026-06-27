// Chart pages: path-based genre URLs (/movies/action?year=2028), clean query strings.
(function () {
  var FEATURED_DECADE = "2010s";

  function sortQuery(sort) {
    if (!sort || sort === "rated") return "";
    return "?" + new URLSearchParams({ sort: sort }).toString();
  }

  function barContext(bar) {
    return {
      guideYear: bar.getAttribute("data-chart-guide-year") || "",
      guideDecade: bar.getAttribute("data-chart-guide-decade") || "",
      guideUnderrated: bar.getAttribute("data-chart-guide-underrated") || "",
      guideGenreSurface: bar.getAttribute("data-chart-guide-genre") || "",
      guideNetwork: bar.getAttribute("data-chart-guide-network") || "",
      genrePageSlug: bar.getAttribute("data-genre-slug") || "",
      curYear: bar.getAttribute("data-chart-current-year") || String(new Date().getFullYear()),
    };
  }

  function networkChartUrl(kind, networkSlug, genreLabel, year, sort) {
    var base =
      kind === "movie"
        ? "/network/" + networkSlug + "/movies"
        : "/network/" + networkSlug + "/shows";
    var params = new URLSearchParams();
    if (genreLabel) params.set("genre", genreLabel);
    if (year) params.set("year", year);
    if (sort && sort !== "rated") params.set("sort", sort);
    var qs = params.toString();
    return base + (qs ? "?" + qs : "");
  }

  /** Navigate to a chart destination (top / year guide / decade / underrated / network). */
  function chartDestinationUrl(destId, genreSlug, genreLabel, sort, ctx) {
    var slug = genreSlug || "";
    var qs = sortQuery(sort);
    var year = ctx.guideYear || ctx.curYear;

    if (ctx.guideNetwork) {
      switch (destId) {
        case "network-tv":
          return networkChartUrl("tv", ctx.guideNetwork, genreLabel, "", sort);
        case "network-movie":
          return networkChartUrl("movie", ctx.guideNetwork, genreLabel, "", sort);
        default:
          return networkChartUrl("tv", ctx.guideNetwork, genreLabel, "", sort);
      }
    }

    if (ctx.guideGenreSurface && ctx.genrePageSlug) {
      slug = slug || ctx.genrePageSlug;
      switch (destId) {
        case "top-tv":
          return (
            (ctx.guideGenreSurface === "shows"
              ? "/genre/" + slug + "/shows"
              : "/genre/" + slug) + qs
          );
        case "top-movie":
          return "/genre/" + slug + "/movies" + qs;
        case "year-tv":
          return "/tv/best/" + year + (slug ? "/" + slug : "") + qs;
        case "year-movie":
          return "/movies/best/" + year + (slug ? "/" + slug : "") + qs;
        case "decade-tv":
          return "/tv/best/" + FEATURED_DECADE + (slug ? "/" + slug : "") + qs;
        case "underrated-tv":
          return (slug ? "/tv/underrated/" + slug : "/tv/underrated") + qs;
        case "underrated-movie":
          return (slug ? "/movies/underrated/" + slug : "/movies/underrated") + qs;
        default:
          return "/genre/" + slug + qs;
      }
    }

    switch (destId) {
      case "top-tv":
        return (slug ? "/top/tv/" + slug : "/top/tv") + qs;
      case "top-movie":
        return (slug ? "/movies/" + slug : "/movies/best") + qs;
      case "year-tv":
        return "/tv/best/" + year + (slug ? "/" + slug : "") + qs;
      case "year-movie":
        return "/movies/best/" + year + (slug ? "/" + slug : "") + qs;
      case "decade-tv":
        return "/tv/best/" + FEATURED_DECADE + (slug ? "/" + slug : "") + qs;
      case "underrated-tv":
        return (slug ? "/tv/underrated/" + slug : "/tv/underrated") + qs;
      case "underrated-movie":
        return (slug ? "/movies/underrated/" + slug : "/movies/underrated") + qs;
      default:
        return "/top/tv";
    }
  }

  function chartUrl(
    kind,
    genreSlug,
    genreLabel,
    year,
    sort,
    guideYear,
    guideDecade,
    guideUnderrated,
    guideGenreSurface,
    guideNetwork,
  ) {
    if (guideNetwork) {
      return networkChartUrl(kind, guideNetwork, genreLabel, year, sort);
    }

    if (guideGenreSurface) {
      if (year) {
        var baseYearG = kind === "movie" ? "/movies/best/" + year : "/tv/best/" + year;
        if (genreSlug) baseYearG += "/" + genreSlug;
        var paramsYearG = new URLSearchParams();
        if (sort && sort !== "rated") paramsYearG.set("sort", sort);
        var qsYearG = paramsYearG.toString();
        return baseYearG + (qsYearG ? "?" + qsYearG : "");
      }
      var slug = genreSlug || "";
      var baseGenre =
        kind === "movie"
          ? "/genre/" + slug + "/movies"
          : guideGenreSurface === "shows"
            ? "/genre/" + slug + "/shows"
            : "/genre/" + slug;
      var paramsGenre = new URLSearchParams();
      if (sort && sort !== "rated") paramsGenre.set("sort", sort);
      var qsGenre = paramsGenre.toString();
      return baseGenre + (qsGenre ? "?" + qsGenre : "");
    }

    if (guideUnderrated) {
      if (year) {
        var baseYear = kind === "movie" ? "/movies/best/" + year : "/tv/best/" + year;
        if (genreSlug) baseYear += "/" + genreSlug;
        var paramsYear = new URLSearchParams();
        if (sort && sort !== "rated") paramsYear.set("sort", sort);
        var qsYear = paramsYear.toString();
        return baseYear + (qsYear ? "?" + qsYear : "");
      }
      var baseUnder =
        kind === "movie"
          ? genreSlug
            ? "/movies/underrated/" + genreSlug
            : "/movies/underrated"
          : genreSlug
            ? "/tv/underrated/" + genreSlug
            : "/tv/underrated";
      var paramsUnder = new URLSearchParams();
      if (sort && sort !== "rated") paramsUnder.set("sort", sort);
      var qsUnder = paramsUnder.toString();
      return baseUnder + (qsUnder ? "?" + qsUnder : "");
    }

    if (guideDecade && kind === "tv") {
      if (year) {
        var baseYearDec = "/tv/best/" + year;
        if (genreSlug) baseYearDec += "/" + genreSlug;
        var paramsYearDec = new URLSearchParams();
        if (sort && sort !== "rated") paramsYearDec.set("sort", sort);
        var qsYearDec = paramsYearDec.toString();
        return baseYearDec + (qsYearDec ? "?" + qsYearDec : "");
      }
      var baseDecade = "/tv/best/" + guideDecade;
      if (genreSlug) baseDecade += "/" + genreSlug;
      var paramsDecade = new URLSearchParams();
      if (sort && sort !== "rated") paramsDecade.set("sort", sort);
      var qsDecade = paramsDecade.toString();
      return baseDecade + (qsDecade ? "?" + qsDecade : "");
    }

    if (guideYear) {
      var y = year && year !== String(guideYear) ? year : guideYear;
      if (!y) {
        var baseAll =
          kind === "movie"
            ? genreSlug
              ? "/movies/" + genreSlug
              : "/movies/best"
            : genreSlug
              ? "/top/tv/" + genreSlug
              : "/top/tv";
        var paramsAll = new URLSearchParams();
        if (sort && sort !== "rated") paramsAll.set("sort", sort);
        var qsAll = paramsAll.toString();
        return baseAll + (qsAll ? "?" + qsAll : "");
      }
      var baseGuide = kind === "movie" ? "/movies/best/" + y : "/tv/best/" + y;
      if (genreSlug) baseGuide += "/" + genreSlug;
      var paramsGuide = new URLSearchParams();
      if (sort && sort !== "rated") paramsGuide.set("sort", sort);
      var qsGuide = paramsGuide.toString();
      return baseGuide + (qsGuide ? "?" + qsGuide : "");
    }

    var base = kind === "movie" ? "/movies/best" : "/top/tv";
    if (genreSlug) base = kind === "movie" ? "/movies/" + genreSlug : "/top/tv/" + genreSlug;
    var params = new URLSearchParams();
    if (year) params.set("year", year);
    if (sort && sort !== "rated") params.set("sort", sort);
    var qs = params.toString();
    return base + (qs ? "?" + qs : "");
  }

  function readForm(bar) {
    var genreSel = bar.querySelector('select[name="genre"]');
    var yearSel = bar.querySelector('select[name="year"]');
    var sortSel = bar.querySelector('select[name="sort"]');
    var networkSel = bar.querySelector('select[name="network"]');
    var genreSlug = "";
    var genreLabel = "";
    if (genreSel && genreSel.selectedIndex >= 0) {
      var opt = genreSel.options[genreSel.selectedIndex];
      genreSlug = opt.getAttribute("data-slug") || "";
      genreLabel = genreSel.value || "";
    }
    return {
      genreSlug: genreSlug,
      genreLabel: genreLabel,
      year: yearSel ? yearSel.value : "",
      sort: sortSel ? sortSel.value : "rated",
      networkSlug: networkSel ? networkSel.value : bar.getAttribute("data-chart-guide-network") || "",
    };
  }

  function navigate(bar) {
    var kind = bar.getAttribute("data-chart-kind");
    var guideYear = bar.getAttribute("data-chart-guide-year") || "";
    var guideDecade = bar.getAttribute("data-chart-guide-decade") || "";
    var guideUnderrated = bar.getAttribute("data-chart-guide-underrated") || "";
    var guideGenreSurface = bar.getAttribute("data-chart-guide-genre") || "";
    var guideNetwork = bar.getAttribute("data-chart-guide-network") || "";
    var f = readForm(bar);
    if (!f) return;
    if (guideNetwork && f.networkSlug && f.networkSlug !== guideNetwork) {
      window.location.href = networkChartUrl(kind, f.networkSlug, f.genreLabel, f.year, f.sort);
      return;
    }
    window.location.href = chartUrl(
      kind,
      f.genreSlug,
      f.genreLabel,
      f.year,
      f.sort,
      guideYear,
      guideDecade,
      guideUnderrated,
      guideGenreSurface,
      guideNetwork,
    );
  }

  document.querySelectorAll("[data-chart-kind]").forEach(function (bar) {
    var form = bar.querySelector("form.chart-filter-fields");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        navigate(bar);
      });
    }
    bar.querySelectorAll("select").forEach(function (sel) {
      if (sel.hasAttribute("data-chart-destination")) return;
      sel.addEventListener("change", function () {
        navigate(bar);
      });
    });
  });

  document.querySelectorAll("[data-chart-destination]").forEach(function (sel) {
    sel.addEventListener(
      "change",
      function () {
        var bar = sel.closest("[data-chart-kind]");
        if (!bar) return;
        var destId = sel.value;
        var current = bar.getAttribute("data-chart-destination") || "";
        if (destId === current) return;
        var f = readForm(bar);
        if (!f) return;
        window.location.href = chartDestinationUrl(
          destId,
          f.genreSlug,
          f.genreLabel,
          f.sort,
          barContext(bar),
        );
      },
      true,
    );
  });
})();
