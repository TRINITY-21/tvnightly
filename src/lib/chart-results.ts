import type { Context } from "hono";
import type { HonoEnv, MovieRow, ShowRow } from "../types";
import { enrichMoviesFromD1, enrichShowsFromD1 } from "./chart-enrich";
import {
    movieSqlOrder,
    showSqlOrder,
    sortMovies,
    sortShows,
    type ChartFilters,
} from "./chart-filters";
import { slugifyName } from "./format";
import { tmdbDiscoverChart, tmdbGenreId } from "./tmdb";
import { toMovieRow, toShowRow, withGenreLabel } from "./tmdb-rows";

export const CHART_PAGE_SIZE = 48;
export const TV_CHART_MAX = 500;
export const MOVIE_CHART_MAX = 500;

const TMDB_CHART_PAGES = 25;

async function fetchTvChartResultsD1(
  c: Context<HonoEnv>,
  filters: ChartFilters,
  decade?: { start: number; end: number },
): Promise<ShowRow[]> {
  const conds = ["rating IS NOT NULL", "weight >= 75"];
  const binds: (string | number)[] = [];
  if (filters.genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${filters.genre}"%`);
  }
  if (filters.year != null) {
    conds.push("premiered LIKE ?");
    binds.push(`${filters.year}%`);
  }
  if (decade) {
    conds.push("premiered >= ?", "premiered <= ?");
    binds.push(`${decade.start}-01-01`, `${decade.end}-12-31`);
  }
  binds.push(TV_CHART_MAX);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM shows WHERE ${conds.join(" AND ")}
     ORDER BY ${showSqlOrder(filters.sort)} LIMIT ?`,
  )
    .bind(...binds)
    .all<ShowRow>();
  return results;
}

async function fetchMovieChartResultsD1(
  c: Context<HonoEnv>,
  filters: ChartFilters,
): Promise<MovieRow[]> {
  const conds = ["rating IS NOT NULL", "votes >= 1000"];
  const binds: (string | number)[] = [];
  if (filters.genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${filters.genre}"%`);
  }
  if (filters.year != null) {
    conds.push("year = ?");
    binds.push(filters.year);
  }
  binds.push(MOVIE_CHART_MAX);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM movies WHERE ${conds.join(" AND ")} ORDER BY ${movieSqlOrder(filters.sort)} LIMIT ?`,
  )
    .bind(...binds)
    .all<MovieRow>();
  return results;
}

async function fetchTvChartLive(
  c: Context<HonoEnv>,
  filters: ChartFilters,
  decade?: { start: number; end: number },
): Promise<ShowRow[]> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return [];
  const genreId = filters.genre ? tmdbGenreId("tv", slugifyName(filters.genre)) : null;
  if (filters.genre && !genreId) return [];
  const hits = await tmdbDiscoverChart(key, {
    kind: "tv",
    sort: filters.sort,
    genreId,
    year: filters.year,
    decade: decade ?? null,
    pages: TMDB_CHART_PAGES,
  });
  return hits.map((h) => withGenreLabel(toShowRow(h), filters.genre || null));
}

async function fetchMovieChartLive(
  c: Context<HonoEnv>,
  filters: ChartFilters,
): Promise<MovieRow[]> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return [];
  const genreId = filters.genre ? tmdbGenreId("movie", slugifyName(filters.genre)) : null;
  if (filters.genre && !genreId) return [];
  const hits = await tmdbDiscoverChart(key, {
    kind: "movie",
    sort: filters.sort,
    genreId,
    year: filters.year,
    pages: TMDB_CHART_PAGES,
  });
  return hits.map((h) => withGenreLabel(toMovieRow(h), filters.genre || null));
}

// Chart rankings are region-independent and change ~daily, so cache the computed
// (TMDB + D1-enriched) result per filter combo for an hour. This covers chart
// pages on an HTML-cache miss AND the uncached "load more" endpoint, which used
// to recompute the full TMDB+D1 chart on every page of infinite scroll. Empty
// results (transient upstream failures) are never cached.
const CHART_CACHE_TTL = 3600;
const chartFilterKey = (f: ChartFilters): string => `${f.genre ?? ""}|${f.year ?? ""}|${f.sort}`;
async function cachedChart<T>(tag: string, compute: () => Promise<T[]>): Promise<T[]> {
  const cache = caches.default;
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/chart/${encodeURIComponent(tag)}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return (await hit.json()) as T[];
  } catch {
    /* cache miss / parse error → recompute */
  }
  const data = await compute();
  if (data.length) {
    try {
      await cache.put(
        cacheKey,
        new Response(JSON.stringify(data), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CHART_CACHE_TTL}`,
          },
        }),
      );
    } catch {
      /* caching is best-effort */
    }
  }
  return data;
}

export async function fetchMovieChartResults(
  c: Context<HonoEnv>,
  filters: ChartFilters,
): Promise<MovieRow[]> {
  return cachedChart(`movie|${chartFilterKey(filters)}`, async () => {
    const key = c.env.TMDB_API_KEY;
    if (!key) {
      return sortMovies(await fetchMovieChartResultsD1(c, filters), filters.sort).slice(
        0,
        MOVIE_CHART_MAX,
      );
    }

    const live = await fetchMovieChartLive(c, filters);
    if (!live.length) {
      return sortMovies(await fetchMovieChartResultsD1(c, filters), filters.sort).slice(
        0,
        MOVIE_CHART_MAX,
      );
    }

    const enriched = await enrichMoviesFromD1(c.env.DB, live);
    return sortMovies(
      enriched.filter((m) => m.rating != null),
      filters.sort,
    ).slice(0, MOVIE_CHART_MAX);
  });
}

export async function fetchTvChartResults(
  c: Context<HonoEnv>,
  filters: ChartFilters,
): Promise<ShowRow[]> {
  return cachedChart(`tv|${chartFilterKey(filters)}`, async () => {
    const key = c.env.TMDB_API_KEY;
    if (!key) {
      return sortShows(await fetchTvChartResultsD1(c, filters), filters.sort).slice(0, TV_CHART_MAX);
    }

    const live = await fetchTvChartLive(c, filters);
    if (!live.length) {
      return sortShows(await fetchTvChartResultsD1(c, filters), filters.sort).slice(0, TV_CHART_MAX);
    }

    const enriched = await enrichShowsFromD1(c.env.DB, live);
    return sortShows(
      enriched.filter((s) => s.rating != null),
      filters.sort,
    ).slice(0, TV_CHART_MAX);
  });
}

/** TV chart for a premiere decade (e.g. 2010–2019). */
export async function fetchTvDecadeChartResults(
  c: Context<HonoEnv>,
  decade: { start: number; end: number },
  filters: Pick<ChartFilters, "genre" | "sort">,
): Promise<ShowRow[]> {
  return cachedChart(`tvdecade|${decade.start}-${decade.end}|${filters.genre ?? ""}|${filters.sort}`, async () => {
    const fullFilters: ChartFilters = { genre: filters.genre, year: null, sort: filters.sort };
    const key = c.env.TMDB_API_KEY;
    if (!key) {
      return sortShows(await fetchTvChartResultsD1(c, fullFilters, decade), filters.sort).slice(
        0,
        TV_CHART_MAX,
      );
    }

    const live = await fetchTvChartLive(c, fullFilters, decade);
    if (!live.length) {
      return sortShows(await fetchTvChartResultsD1(c, fullFilters, decade), filters.sort).slice(
        0,
        TV_CHART_MAX,
      );
    }

    const enriched = await enrichShowsFromD1(c.env.DB, live);
    return sortShows(
      enriched.filter((s) => s.rating != null),
      filters.sort,
    ).slice(0, TV_CHART_MAX);
  });
}

const TV_UNDERRATED_MIN_RATING = 7.8;
const TV_UNDERRATED_MIN_WEIGHT = 40;
const TV_UNDERRATED_MAX_WEIGHT = 96;

function tvUnderratedSqlOrder(sort: ChartFilters["sort"]): string {
  if (sort === "popular") return "weight ASC, rating DESC";
  if (sort === "new") return "premiered DESC, rating DESC";
  return "rating DESC, weight ASC";
}

/** Editorial list — D1-only (weight band is our signal, not on TMDB). */
export async function fetchTvUnderratedResults(
  c: Context<HonoEnv>,
  filters: Pick<ChartFilters, "genre" | "sort">,
): Promise<ShowRow[]> {
  return cachedChart(`tvunder|${filters.genre ?? ""}|${filters.sort}`, async () => {
    const conds = ["rating >= ?", "weight BETWEEN ? AND ?"];
    const binds: (string | number)[] = [
      TV_UNDERRATED_MIN_RATING,
      TV_UNDERRATED_MIN_WEIGHT,
      TV_UNDERRATED_MAX_WEIGHT,
    ];
    if (filters.genre) {
      conds.push("genres LIKE ?");
      binds.push(`%"${filters.genre}"%`);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM shows WHERE ${conds.join(" AND ")} ORDER BY ${tvUnderratedSqlOrder(filters.sort)} LIMIT ${TV_CHART_MAX}`,
    )
      .bind(...binds)
      .all<ShowRow>();
    return results;
  });
}

const MOVIE_UNDERRATED_MIN_RATING = 7.0;
const MOVIE_UNDERRATED_MIN_VOTES = 1000;
const MOVIE_UNDERRATED_MAX_VOTES = 10000;
const MOVIE_UNDERRATED_MIN_AGE = 2;

function movieUnderratedSqlOrder(sort: ChartFilters["sort"]): string {
  if (sort === "popular") return "votes ASC, rating DESC";
  if (sort === "new") return "year DESC, rating DESC";
  return "rating DESC, votes ASC";
}

/** Editorial list — D1-only (vote band is our signal). */
export async function fetchMovieUnderratedResults(
  c: Context<HonoEnv>,
  filters: Pick<ChartFilters, "genre" | "sort">,
): Promise<MovieRow[]> {
  return cachedChart(`movieunder|${filters.genre ?? ""}|${filters.sort}`, async () => {
    const maxYear = new Date().getFullYear() - MOVIE_UNDERRATED_MIN_AGE;
    const conds = ["rating >= ?", "votes BETWEEN ? AND ?", "year IS NOT NULL", "year <= ?"];
    const binds: (string | number)[] = [
      MOVIE_UNDERRATED_MIN_RATING,
      MOVIE_UNDERRATED_MIN_VOTES,
      MOVIE_UNDERRATED_MAX_VOTES,
      maxYear,
    ];
    if (filters.genre) {
      conds.push("genres LIKE ?");
      binds.push(`%"${filters.genre}"%`);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM movies WHERE ${conds.join(" AND ")} ORDER BY ${movieUnderratedSqlOrder(filters.sort)} LIMIT ${MOVIE_CHART_MAX}`,
    )
      .bind(...binds)
      .all<MovieRow>();
    return results;
  });
}

/** Genre slugs that have ≥1 qualifying title per conditional chart family.
 *  The sitemap must never advertise a genre combo that renders empty — those
 *  pages go noindex, and a sitemapped-but-noindex URL is a contradiction GSC
 *  reports. Each flag mirrors its page's own emptiness rule above (yr = best-of
 *  ${year} charts, under = the underrated band, chart = the evergreen top
 *  charts). One aggregate pass per table, keyed by slugified genre. */
export async function chartGenresWithContent(
  db: D1Database,
  year: number,
): Promise<{
  tv: { yr: Set<string>; under: Set<string>; chart: Set<string> };
  movie: { yr: Set<string>; under: Set<string>; chart: Set<string> };
}> {
  const [tv, movie] = await Promise.all([
    db
      .prepare(
        `SELECT value AS g,
           MAX(CASE WHEN rating IS NOT NULL AND premiered LIKE ? THEN 1 ELSE 0 END) AS yr,
           MAX(CASE WHEN rating >= ? AND weight BETWEEN ? AND ? THEN 1 ELSE 0 END) AS under,
           MAX(CASE WHEN rating IS NOT NULL AND weight >= 75 THEN 1 ELSE 0 END) AS chart
         FROM shows, json_each(shows.genres) GROUP BY value`,
      )
      .bind(`${year}%`, TV_UNDERRATED_MIN_RATING, TV_UNDERRATED_MIN_WEIGHT, TV_UNDERRATED_MAX_WEIGHT)
      .all<{ g: string; yr: number; under: number; chart: number }>(),
    db
      .prepare(
        `SELECT value AS g,
           MAX(CASE WHEN rating IS NOT NULL AND votes >= 1000 AND year = ? THEN 1 ELSE 0 END) AS yr,
           MAX(CASE WHEN rating >= ? AND votes BETWEEN ? AND ? AND year <= ? THEN 1 ELSE 0 END) AS under,
           MAX(CASE WHEN rating IS NOT NULL AND votes >= 1000 THEN 1 ELSE 0 END) AS chart
         FROM movies, json_each(movies.genres) GROUP BY value`,
      )
      .bind(
        year,
        MOVIE_UNDERRATED_MIN_RATING,
        MOVIE_UNDERRATED_MIN_VOTES,
        MOVIE_UNDERRATED_MAX_VOTES,
        year - MOVIE_UNDERRATED_MIN_AGE,
      )
      .all<{ g: string; yr: number; under: number; chart: number }>(),
  ]);
  const pick = (rows: { g: string; yr: number; under: number; chart: number }[]) => ({
    yr: new Set(rows.filter((r) => r.yr).map((r) => slugifyName(r.g))),
    under: new Set(rows.filter((r) => r.under).map((r) => slugifyName(r.g))),
    chart: new Set(rows.filter((r) => r.chart).map((r) => slugifyName(r.g))),
  });
  return { tv: pick(tv.results), movie: pick(movie.results) };
}

export function parseChartPageOffset(c: Context<HonoEnv>): number {
  const n = Number((c.req.query("offset") ?? "0").trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function parseChartPageLimit(c: Context<HonoEnv>): number {
  const n = Number((c.req.query("limit") ?? String(CHART_PAGE_SIZE)).trim());
  if (!Number.isFinite(n) || n < 1) return CHART_PAGE_SIZE;
  return Math.min(48, Math.floor(n));
}
