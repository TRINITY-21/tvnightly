// Chart grid infinite scroll — loads the next page of ranked tiles on scroll.
import { Hono } from "hono";
import {
    ChartRankItem,
    movieChartRankItem,
    renderChartRankCardsHtml,
    showChartRankItem,
} from "../components/chart-rank-card";
import type { GenreChartSurface } from "../lib/chart-filters";
import { parseChartFilters, resolveChartPage } from "../lib/chart-filters";
import {
    fetchNetworkMovieChartResults,
    fetchNetworkTvChartResults,
    resolveNetwork,
    regionTester,
} from "../lib/network-chart";
import { parseDecadeSlug } from "../lib/decades";
import {
    fetchMovieChartResults,
    fetchMovieUnderratedResults,
    fetchTvChartResults,
    fetchTvDecadeChartResults,
    fetchTvUnderratedResults,
    parseChartPageLimit,
    parseChartPageOffset,
} from "../lib/chart-results";
import { slugifyName } from "../lib/format";
import { genreDirectory, showSeasonCounts } from "../lib/queries";
import { visitorRegion } from "../lib/providers";
import type { AppContext, HonoEnv, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

function tvShowMeta(s: ShowRow, seasonCounts: Map<number, number>): string {
  const n = s.id != null ? seasonCounts.get(s.id) : undefined;
  if (n && n > 0) return `${n} Season${n === 1 ? "" : "s"}`;
  if (s.premiered) return s.premiered.slice(0, 4);
  return s.network ?? s.web_channel ?? "TV Series";
}

async function networkTvChartMore(c: AppContext, slug: string) {
  const entry = await resolveNetwork(c.env.DB, slug);
  if (!entry) return c.body(null, 204);
  const region = visitorRegion(c);
  const regionHas = regionTester(region, entry.name);
  const filters = parseChartFilters(c);
  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  if (filters.genre && !tvGenres.includes(filters.genre)) {
    return c.body(null, 204);
  }

  const results = await fetchNetworkTvChartResults(c, entry, filters, region, regionHas);
  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    slice.map((s) => s.id),
  );
  const items: ChartRankItem[] = slice.map((s, i) =>
    showChartRankItem(s, offset + i + 1, tvShowMeta(s, seasonCounts)),
  );

  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function networkMovieChartMore(c: AppContext, slug: string) {
  const entry = await resolveNetwork(c.env.DB, slug);
  if (!entry) return c.body(null, 204);
  const region = visitorRegion(c);
  const regionHas = regionTester(region, entry.name);
  const filters = parseChartFilters(c);
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  if (filters.genre && !movieGenres.includes(filters.genre)) {
    return c.body(null, 204);
  }

  const results = await fetchNetworkMovieChartResults(c, entry, filters, region, regionHas);
  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const items = slice.map((m, i) => movieChartRankItem(m, offset + i + 1));
  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function genreTvChartMore(c: AppContext, slug: string, surface: GenreChartSurface) {
  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  const match = tvGenres.find((g) => slugifyName(g) === slug);
  if (!match) return c.body(null, 204);
  const { sort } = parseChartFilters(c, match);
  const filters = { genre: match, year: null, sort };
  const results = await fetchTvChartResults(c, filters);

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    slice.map((s) => s.id),
  );
  const items: ChartRankItem[] = slice.map((s, i) =>
    showChartRankItem(s, offset + i + 1, tvShowMeta(s, seasonCounts)),
  );

  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function genreMovieChartMore(c: AppContext, slug: string) {
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  const match = movieGenres.find((g) => slugifyName(g) === slug);
  if (!match) return c.body(null, 204);
  const { sort } = parseChartFilters(c, match);
  const filters = { genre: match, year: null, sort };
  const results = await fetchMovieChartResults(c, filters);

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const items = slice.map((m, i) => movieChartRankItem(m, offset + i + 1));
  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function tvUnderratedChartMore(c: AppContext, genreSlug?: string) {
  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = tvGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.body(null, 204);
    genre = match;
  }
  const { sort } = parseChartFilters(c, genre);
  const results = await fetchTvUnderratedResults(c, { genre, sort });

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    slice.map((s) => s.id),
  );
  const items: ChartRankItem[] = slice.map((s, i) =>
    showChartRankItem(s, offset + i + 1, tvShowMeta(s, seasonCounts)),
  );

  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function movieUnderratedChartMore(c: AppContext, genreSlug?: string) {
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = movieGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.body(null, 204);
    genre = match;
  }
  const { sort } = parseChartFilters(c, genre);
  const results = await fetchMovieUnderratedResults(c, { genre, sort });

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const items = slice.map((m, i) => movieChartRankItem(m, offset + i + 1));
  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function tvGuideDecadeChartMore(c: AppContext, decadeSlug: string, genreSlug?: string) {
  const decade = parseDecadeSlug(decadeSlug);
  if (!decade) return c.body(null, 204);

  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = tvGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.body(null, 204);
    genre = match;
  }
  const { sort } = parseChartFilters(c, genre);
  const results = await fetchTvDecadeChartResults(c, decade, { genre, sort });

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    slice.map((s) => s.id),
  );
  const items: ChartRankItem[] = slice.map((s, i) =>
    showChartRankItem(s, offset + i + 1, tvShowMeta(s, seasonCounts)),
  );

  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function tvGuideYearChartMore(c: AppContext, year: number, genreSlug?: string) {
  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = tvGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.body(null, 204);
    genre = match;
  }
  const { sort } = parseChartFilters(c, genre);
  const filters = { genre, year, sort };

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const results = await fetchTvChartResults(c, filters);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    slice.map((s) => s.id),
  );
  const items: ChartRankItem[] = slice.map((s, i) =>
    showChartRankItem(s, offset + i + 1, tvShowMeta(s, seasonCounts)),
  );

  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function tvChartMore(c: AppContext, genreSlug?: string) {
  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  const { filters, redirect } = resolveChartPage(c, "tv", tvGenres, genreSlug, false);
  if (redirect) return redirect;

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const results = await fetchTvChartResults(c, filters);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    slice.map((s) => s.id),
  );
  const items: ChartRankItem[] = slice.map((s, i) =>
    showChartRankItem(s, offset + i + 1, tvShowMeta(s, seasonCounts)),
  );

  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function movieGuideYearChartMore(c: AppContext, year: number, genreSlug?: string) {
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = movieGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.body(null, 204);
    genre = match;
  }
  const { sort } = parseChartFilters(c, genre);
  const filters = { genre, year, sort };

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const results = await fetchMovieChartResults(c, filters);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const items = slice.map((m, i) => movieChartRankItem(m, offset + i + 1));
  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

async function movieChartMore(c: AppContext, genreSlug?: string) {
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  const { filters, redirect } = resolveChartPage(c, "movie", movieGenres, genreSlug, false);
  if (redirect) return redirect;

  const offset = Math.max(1, parseChartPageOffset(c));
  const limit = parseChartPageLimit(c);
  const results = await fetchMovieChartResults(c, filters);
  const slice = results.slice(offset, offset + limit);
  if (!slice.length) return c.body(null, 204);

  const items = slice.map((m, i) => movieChartRankItem(m, offset + i + 1));
  const next = offset + slice.length;
  c.header("X-Chart-Next-Offset", String(next));
  c.header("X-Chart-Total", String(results.length));
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(renderChartRankCardsHtml(items), 200, {
    "Content-Type": "text/html; charset=UTF-8",
  });
}

app.get("/network/:slug/shows/more", (c) => networkTvChartMore(c, c.req.param("slug")));
app.get("/network/:slug/movies/more", (c) => networkMovieChartMore(c, c.req.param("slug")));
app.get("/genre/:slug/more", (c) => genreTvChartMore(c, c.req.param("slug"), "hub"));
app.get("/genre/:slug/shows/more", (c) => genreTvChartMore(c, c.req.param("slug"), "shows"));
app.get("/genre/:slug/movies/more", (c) => genreMovieChartMore(c, c.req.param("slug")));
app.get("/top/tv/more", (c) => tvChartMore(c));
app.get("/top/tv/:genreSlug/more", (c) => tvChartMore(c, c.req.param("genreSlug")));
app.get("/tv/underrated/more", (c) => tvUnderratedChartMore(c));
app.get("/tv/underrated/:genreSlug/more", (c) => tvUnderratedChartMore(c, c.req.param("genreSlug")));
app.get("/tv/best/:yearOrDecade/more", (c) => {
  const p = c.req.param("yearOrDecade");
  if (parseDecadeSlug(p)) return tvGuideDecadeChartMore(c, p);
  return tvGuideYearChartMore(c, Number(p));
});
app.get("/tv/best/:yearOrDecade/:genreSlug/more", (c) => {
  const p = c.req.param("yearOrDecade");
  const genreSlug = c.req.param("genreSlug");
  if (parseDecadeSlug(p)) return tvGuideDecadeChartMore(c, p, genreSlug);
  return tvGuideYearChartMore(c, Number(p), genreSlug);
});
app.get("/movies/best/more", (c) => movieChartMore(c));
app.get("/movies/best/:year/more", (c) => movieGuideYearChartMore(c, Number(c.req.param("year"))));
app.get("/movies/best/:year/:genreSlug/more", (c) =>
  movieGuideYearChartMore(c, Number(c.req.param("year")), c.req.param("genreSlug")),
);
app.get("/movies/underrated/more", (c) => movieUnderratedChartMore(c));
app.get("/movies/underrated/:genreSlug/more", (c) =>
  movieUnderratedChartMore(c, c.req.param("genreSlug")),
);
app.get("/movies/:genreSlug/more", (c) => movieChartMore(c, c.req.param("genreSlug")));

export default app;
