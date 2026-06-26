import { latestTrailers, type TrailerItem } from "./latest-trailers";
import { fetchSidebarTops, type SideRankItem } from "./sidebar-tops";

export type SiteSidebarData = {
  trailers: TrailerItem[];
  topSeries: SideRankItem[];
  topMovies: SideRankItem[];
};

/** Shared right-rail data for content pages (trailers + top charts). */
export async function fetchSiteSidebar(
  db: D1Database,
  apiKey: string | undefined,
): Promise<SiteSidebarData> {
  const [trailers, tops] = await Promise.all([
    latestTrailers(apiKey),
    fetchSidebarTops(db, apiKey),
  ]);
  return { trailers, topSeries: tops.series, topMovies: tops.movies };
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
