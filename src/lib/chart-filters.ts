import type { Context } from "hono";
import type { HonoEnv, MovieRow, ShowRow } from "../types";
import { slugifyName } from "./format";

export type ChartKind = "tv" | "movie";
export type ChartSort = "rated" | "popular" | "new";

export type ChartFilters = {
  genre: string;
  year: number | null;
  sort: ChartSort;
};

const SORTS = new Set<ChartSort>(["rated", "popular", "new"]);

/** Base path for a chart page — genre lives in the path, not the query string. */
export function chartBasePath(kind: ChartKind, genre?: string): string {
  if (kind === "tv") return genre ? `/top/tv/${slugifyName(genre)}` : "/top/tv";
  return genre ? `/movies/${slugifyName(genre)}` : "/movies/best";
}

/** Year watch-guide chart — year is in the path; genre optional. */
export function tvGuideBasePath(year: number, genre?: string): string {
  const base = `/tv/best/${year}`;
  return genre ? `${base}/${slugifyName(genre)}` : base;
}

/** Decade watch-guide chart — decade slug (e.g. 2010s) in the path; genre optional. */
export function tvDecadeGuideBasePath(decade: string, genre?: string): string {
  const base = `/tv/best/${decade}`;
  return genre ? `${base}/${slugifyName(genre)}` : base;
}

export function movieGuideBasePath(year: number, genre?: string): string {
  const base = `/movies/best/${year}`;
  return genre ? `${base}/${slugifyName(genre)}` : base;
}

export function tvUnderratedBasePath(genre?: string): string {
  return genre ? `/tv/underrated/${slugifyName(genre)}` : "/tv/underrated";
}

export function movieUnderratedBasePath(genre?: string): string {
  return genre ? `/movies/underrated/${slugifyName(genre)}` : "/movies/underrated";
}

export function underratedBasePath(kind: ChartKind, genre?: string): string {
  return kind === "movie" ? movieUnderratedBasePath(genre) : tvUnderratedBasePath(genre);
}

export type GenreChartSurface = "hub" | "shows" | "movies";

/** Featured decade in watch-guide nav + chart picker. */
export const CHART_FEATURED_DECADE = "2010s";

/** Chart pages that share the /top/tv layout (excludes episodes). */
export type ChartDestinationId =
  | "top-tv"
  | "top-movie"
  | "year-tv"
  | "year-movie"
  | "decade-tv"
  | "underrated-tv"
  | "underrated-movie"
  | "network-tv"
  | "network-movie";

export function networkChartBasePath(slug: string, kind: ChartKind): string {
  return kind === "movie" ? `/network/${slug}/movies` : `/network/${slug}/shows`;
}

export function networkChartQuery(filters: ChartFilters): string {
  const p = new URLSearchParams();
  if (filters.genre) p.set("genre", filters.genre);
  if (filters.year != null) p.set("year", String(filters.year));
  if (filters.sort !== "rated") p.set("sort", filters.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function networkChartUrl(slug: string, kind: ChartKind, filters: ChartFilters): string {
  return networkChartBasePath(slug, kind) + networkChartQuery(filters);
}

export function networkDestinationOptions(networkName: string, hasShows: boolean, hasMovies: boolean) {
  const opts: { id: ChartDestinationId; label: string }[] = [];
  if (hasShows) opts.push({ id: "network-tv", label: `Top ${networkName} shows` });
  if (hasMovies) opts.push({ id: "network-movie", label: `Top ${networkName} movies` });
  return opts;
}

export function detectNetworkChartDestination(kind: ChartKind): ChartDestinationId {
  return kind === "movie" ? "network-movie" : "network-tv";
}

/** Network charts keep genre/year/sort in the query string. */
export function resolveNetworkChartPage(
  c: Context<HonoEnv>,
  slug: string,
  kind: ChartKind,
  genres: string[],
  canonical = true,
): { filters: ChartFilters; redirect: Response | null } {
  const filters = parseChartFilters(c);

  if (filters.genre && !genres.includes(filters.genre)) {
    const cleaned = { ...filters, genre: "" };
    return { filters: cleaned, redirect: c.redirect(networkChartUrl(slug, kind, cleaned), 301) };
  }

  const yearQ = (c.req.query("year") ?? "").trim();
  if (yearQ && filters.year == null) {
    return { filters, redirect: c.redirect(networkChartUrl(slug, kind, filters), 301) };
  }

  if (canonical) {
    const req = new URL(c.req.url);
    const target = networkChartUrl(slug, kind, filters);
    const targetUrl = new URL(target, req.origin);
    if (req.pathname !== targetUrl.pathname || req.search !== targetUrl.search) {
      return { filters, redirect: c.redirect(targetUrl.pathname + targetUrl.search, 301) };
    }
  }

  return { filters, redirect: null };
}

export function chartDestinationOptions(
  year = new Date().getFullYear(),
  activeGuideYear?: number,
) {
  const yearLabel = activeGuideYear ?? year;
  return [
    { id: "top-tv" as const, label: "Top TV shows" },
    { id: "top-movie" as const, label: "Top movies" },
    { id: "year-tv" as const, label: `Best shows of ${yearLabel}` },
    { id: "year-movie" as const, label: `Best movies of ${yearLabel}` },
    { id: "decade-tv" as const, label: `Best TV of the ${CHART_FEATURED_DECADE}` },
    { id: "underrated-tv" as const, label: "Underrated shows" },
    { id: "underrated-movie" as const, label: "Underrated movies" },
  ];
}

export function detectChartDestination(opts: {
  kind: ChartKind;
  guideYear?: number;
  guideDecade?: string;
  guideUnderrated?: boolean;
  guideGenre?: { surface: GenreChartSurface; slug: string };
}): ChartDestinationId {
  if (opts.guideUnderrated) {
    return opts.kind === "movie" ? "underrated-movie" : "underrated-tv";
  }
  if (opts.guideDecade != null) return "decade-tv";
  if (opts.guideYear != null) {
    return opts.kind === "movie" ? "year-movie" : "year-tv";
  }
  if (opts.guideGenre?.surface === "movies" || (opts.guideGenre && opts.kind === "movie")) {
    return "top-movie";
  }
  return opts.kind === "movie" ? "top-movie" : "top-tv";
}

export function genreChartBasePath(surface: GenreChartSurface, slug: string): string {
  if (surface === "hub") return `/genre/${slug}`;
  if (surface === "shows") return `/genre/${slug}/shows`;
  return `/genre/${slug}/movies`;
}

export function guideBasePath(kind: ChartKind, year: number, genre?: string): string {
  return kind === "movie" ? movieGuideBasePath(year, genre) : tvGuideBasePath(year, genre);
}

export function tvGuidePath(
  opts: { year?: number; decade?: string },
  genre?: string,
): string {
  if (opts.decade) return tvDecadeGuideBasePath(opts.decade, genre);
  if (opts.year != null) return tvGuideBasePath(opts.year, genre);
  return genre ? `/top/tv/${slugifyName(genre)}` : "/top/tv";
}

export function parseChartFilters(c: Context<HonoEnv>, genreFromPath = ""): ChartFilters {
  const genre = genreFromPath || (c.req.query("genre") ?? "").trim();
  const yearRaw = (c.req.query("year") ?? "").trim();
  const sortRaw = (c.req.query("sort") ?? "rated").trim() as ChartSort;
  const yearParsed = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
  const year =
    yearParsed != null && yearParsed <= new Date().getFullYear() ? yearParsed : null;
  const sort = SORTS.has(sortRaw) ? sortRaw : "rated";
  return { genre, year, sort };
}

export function chartQuery(filters: ChartFilters, opts?: { omitYear?: boolean }): string {
  const p = new URLSearchParams();
  if (!opts?.omitYear && filters.year != null) p.set("year", String(filters.year));
  if (filters.sort !== "rated") p.set("sort", filters.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function chartUrl(kind: ChartKind, filters: ChartFilters): string {
  return chartBasePath(kind, filters.genre || undefined) + chartQuery(filters);
}

/** Resolve genre from a path slug and 301 messy query URLs to the canonical path form. */
export function resolveChartPage(
  c: Context<HonoEnv>,
  kind: ChartKind,
  genres: string[],
  genreSlugFromPath = "",
  canonical = true,
): { filters: ChartFilters; redirect: Response | null } {
  let genreFromPath = "";
  if (genreSlugFromPath) {
    const match = genres.find((g) => slugifyName(g) === genreSlugFromPath);
    if (!match) {
      return {
        filters: { genre: "", year: null, sort: "rated" },
        redirect: c.redirect(chartBasePath(kind), 301),
      };
    }
    genreFromPath = match;
  }

  const filters = parseChartFilters(c, genreFromPath);

  if (filters.genre && !genres.includes(filters.genre)) {
    return { filters, redirect: c.redirect(chartBasePath(kind), 301) };
  }

  const yearQ = (c.req.query("year") ?? "").trim();
  if (yearQ && filters.year == null) {
    return { filters, redirect: c.redirect(chartUrl(kind, filters), 301) };
  }

  if (canonical) {
    const req = new URL(c.req.url);
    const target = chartUrl(kind, filters);
    const targetUrl = new URL(target, req.origin);
    if (req.pathname !== targetUrl.pathname || req.search !== targetUrl.search) {
      return { filters, redirect: c.redirect(targetUrl.pathname + targetUrl.search, 301) };
    }
  }

  return { filters, redirect: null };
}

export function chartYearOptions(end = new Date().getFullYear(), start = 1907) {
  const opts: { value: string; text: string }[] = [{ value: "", text: "All years" }];
  for (let y = end; y >= start; y--) opts.push({ value: String(y), text: String(y) });
  return opts;
}

export const chartSortOptions: { value: ChartSort; text: string }[] = [
  { value: "rated", text: "Top rated" },
  { value: "popular", text: "Popularity" },
  { value: "new", text: "Newest" },
];

const showYear = (s: ShowRow) => (s.premiered ? Number(s.premiered.slice(0, 4)) : null);

export function sortShows(rows: ShowRow[], sort: ChartSort): ShowRow[] {
  const copy = [...rows];
  if (sort === "popular") {
    copy.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.rating ?? 0) - (a.rating ?? 0));
  } else if (sort === "new") {
    copy.sort(
      (a, b) =>
        (showYear(b) ?? 0) - (showYear(a) ?? 0) || (b.rating ?? 0) - (a.rating ?? 0),
    );
  } else {
    copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.weight ?? 0) - (a.weight ?? 0));
  }
  return copy;
}

export function sortMovies(rows: MovieRow[], sort: ChartSort): MovieRow[] {
  const copy = [...rows];
  if (sort === "popular") {
    copy.sort(
      (a, b) =>
        (b.popularity ?? 0) - (a.popularity ?? 0) || (b.rating ?? 0) - (a.rating ?? 0),
    );
  } else if (sort === "new") {
    copy.sort(
      (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.rating ?? 0) - (a.rating ?? 0),
    );
  } else {
    copy.sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0),
    );
  }
  return copy;
}

export function showSqlOrder(sort: ChartSort): string {
  if (sort === "popular") return "weight DESC, rating DESC";
  if (sort === "new") return "premiered DESC, rating DESC";
  return "rating DESC, weight DESC";
}

export function movieSqlOrder(sort: ChartSort): string {
  if (sort === "popular") return "popularity DESC, rating DESC";
  if (sort === "new") return "year DESC, rating DESC";
  return "rating DESC, votes DESC";
}
