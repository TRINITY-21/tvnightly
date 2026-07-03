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
async function computeSiteSidebar(
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

// The right-rail is identical for every visitor and changes ~daily, yet it was
// recomputed (top-charts D1 queries + TMDB calls) on EVERY page. Cache the whole
// payload at the edge so it touches D1/TMDB at most once per hour per colo. Bump
// the key suffix to bust after a shape change.
const SIDEBAR_CACHE_KEY = "https://edge-cache.tvnightly.com/site-sidebar-v1";
const SIDEBAR_CACHE_TTL = 3600;

/** Shared right-rail data for content pages (trailers + top charts), edge-cached. */
export async function fetchSiteSidebar(
  db: D1Database,
  apiKey: string | undefined,
): Promise<SiteSidebarData> {
  const cache = caches.default;
  const cacheKey = new Request(SIDEBAR_CACHE_KEY);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return (await hit.json()) as SiteSidebarData;
  } catch {
    /* cache miss / parse error → recompute */
  }
  const data = await computeSiteSidebar(db, apiKey);
  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(data), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${SIDEBAR_CACHE_TTL}`,
        },
      }),
    );
  } catch {
    /* caching is best-effort */
  }
  return data;
}

const EXCLUDED_PREFIXES = ["/admin", "/go", "/r/", "/play", "/shorts"];

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
