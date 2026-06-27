import { latestTrailers, type TrailerItem } from "./latest-trailers";
import { fetchSidebarTops, SIDEBAR_RANK_LIMIT, SIDEBAR_TRAILER_LIMIT, type SideRankItem } from "./sidebar-tops";
import { tmdbTrendingList } from "./tmdb";
import { toMovieRow } from "./tmdb-rows";

export type BrowseTrendingMovie = {
  title: string;
  href: string;
  poster: string | null;
};

export type SiteSidebarData = {
  trailers: TrailerItem[];
  topSeries: SideRankItem[];
  topMovies: SideRankItem[];
  browseTrendingMovies: BrowseTrendingMovie[];
};

const BROWSE_TRENDING_LIMIT = 8;

async function fetchBrowseTrendingMovies(
  db: D1Database,
  apiKey: string | undefined,
): Promise<BrowseTrendingMovie[]> {
  if (!apiKey) return [];
  const hits = (await tmdbTrendingList(apiKey, "movie")).slice(0, BROWSE_TRENDING_LIMIT);
  if (!hits.length) return [];

  const ids = hits.map((h) => h.tmdbId);
  const slugByTmdb = new Map<number, string>();
  const { results } = await db
    .prepare(
      `SELECT tmdb_id, slug FROM movies WHERE tmdb_id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .all<{ tmdb_id: number; slug: string }>();
  for (const r of results) slugByTmdb.set(r.tmdb_id, r.slug);

  return hits.map((h) => {
    const row = toMovieRow(h);
    const slug = slugByTmdb.get(h.tmdbId) ?? row.slug;
    return {
      title: row.title,
      href: `/movie/${slug}`,
      poster: row.poster_url,
    };
  });
}

/** Shared right-rail data for content pages (trailers + top charts). */
export async function fetchSiteSidebar(
  db: D1Database,
  apiKey: string | undefined,
): Promise<SiteSidebarData> {
  const [trailers, tops, browseTrendingMovies] = await Promise.all([
    latestTrailers(apiKey, undefined, SIDEBAR_TRAILER_LIMIT),
    fetchSidebarTops(db, apiKey, SIDEBAR_RANK_LIMIT),
    fetchBrowseTrendingMovies(db, apiKey),
  ]);
  return {
    trailers,
    topSeries: tops.series,
    topMovies: tops.movies,
    browseTrendingMovies,
  };
}

const EXCLUDED_PREFIXES = ["/admin", "/go", "/r/"];

const EXCLUDED_EXACT = new Set([
  "/terms",
  "/privacy",
  "/about",
  "/how-we-pick",
  "/editorial-policy",
  "/confirm",
  "/unsubscribe",
]);

/** Whether middleware should load sidebar data for this request. */
export function shouldFetchSiteSidebar(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (/\.(png|jpe?g|svg|ico|xml|ics|woff2?)$/i.test(pathname)) return false;
  if (pathname === "/sitemap.xml" || pathname.startsWith("/sitemaps/")) return false;
  if (EXCLUDED_EXACT.has(pathname)) return false;
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return false;
  return true;
}
