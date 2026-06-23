import { Hono } from "hono";
import { TV_DECADES } from "../lib/decades";
import { EPISODE_GUIDES } from "../lib/episode-guides";
import { slugifyName } from "../lib/format";
import { FRANCHISES } from "../lib/franchises";
import { genreDirectory, networkDirectory } from "../lib/queries";
import { epochDay, origin, sitemapUrl, xmlRes } from "../lib/seo";
import { TV_UNIVERSES } from "../lib/tv-universes";
import { VERTICALS } from "../lib/verticals";
import { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// --------------------------------------------------------------- sitemaps

const SHOWS_PER_SITEMAP = 1000;

// Crawl-surface throttle. A brand-new domain that advertises ~500k URLs invites
// bots to crawl all of them — which (a) blew past the Workers free-tier request
// cap and (b) is the classic thin-content trap. So the sitemap now exposes only
// the highest-value pages: the top shows by weight + top movies (a few key
// subpages each), and NOT the per-episode / per-person long tail (those stay
// reachable via internal links, just not bulk-advertised). Raise these as the
// domain earns authority.
const SHOW_LIMIT = 5000; // top shows by weight
const MOVIE_LIMIT = 1500; // top movies by popularity
const SHOW_SUFFIXES = ["", "/where-to-watch", "/best-episodes", "/ratings"];
const MOVIE_SUFFIXES = ["", "/where-to-watch"];

// lastmod for the static shard. Charts, schedules and directories are rebuilt
// from continuously-synced data, so "today" is the honest freshness hint; the
// handful of evergreen editorial pages carry a fixed deploy date instead. Bump
// BUILD_DATE when those pages are meaningfully edited.
const TODAY = new Date().toISOString().slice(0, 10);
const BUILD_DATE = "2026-06-17";
const EVERGREEN = new Set(["/about", "/how-we-pick", "/editorial-policy"]);

app.get("/sitemap.xml", async (c) => {
  const site = origin(c);
  const [showRow, movieRow] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM shows").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM movies").first<{ n: number }>(),
  ]);
  const showShards = Math.max(1, Math.ceil(Math.min(showRow?.n ?? 0, SHOW_LIMIT) / SHOWS_PER_SITEMAP));
  const movieShards = Math.ceil(Math.min(movieRow?.n ?? 0, MOVIE_LIMIT) / SHOWS_PER_SITEMAP);
  const entries = [
    "static.xml",
    ...Array.from({ length: showShards }, (_, i) => `shows-${i}.xml`),
    ...Array.from({ length: movieShards }, (_, i) => `movies-${i}.xml`),
  ]
    // every shard is regenerated from continuously-synced data, so the freshness
    // signal on the index is "today" — engines re-read children on this hint
    .map((f) => `<sitemap><loc>${site}/sitemaps/${f}</loc><lastmod>${TODAY}</lastmod></sitemap>`)
    .join("");
  return xmlRes(c, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`);
});

app.get("/sitemaps/:file", async (c) => {
  const site = origin(c);
  const file = c.req.param("file");

  if (file === "static.xml") {
    const [networks, genres] = await Promise.all([
      networkDirectory(c.env.DB),
      genreDirectory(c.env.DB),
    ]);
    const genreSlugs = [...new Set([...genres.tv, ...genres.movie].map((g) => slugifyName(g)))];
    const tvGenreSlugs = [...new Set(genres.tv.map((g) => slugifyName(g)))];
    const movieGenreSlugs = [...new Set(genres.movie.map((g) => slugifyName(g)))];
    // the guide pages (src/routes/guides.tsx) are evergreen on the current year
    const year = new Date().getFullYear();
    const urls = [
      "/",
      "/about",
      "/how-we-pick",
      "/editorial-policy",
      "/recommend",
      "/loved",
      "/what-to-watch",
      "/movies",
      "/movies/best",
      "/movies/underrated",
      `/movies/best/${year}`,
      "/tv/underrated",
      `/tv/best/${year}`,
      ...TV_DECADES.map((d) => `/tv/best/${d}`),
      "/best-episodes",
      "/upcoming",
      `/awards/emmys/${year}`,
      `/awards/golden-globes/${year}`,
      "/halloween",
      "/christmas-tv",
      "/best-thanksgiving-episodes",
      "/actors",
      "/directors",
      "/premieres",
      "/whats-new",
      "/tonight",
      "/calendar",
      "/renewals",
      "/watch-orders",
      "/tv-watch-orders",
      "/guides",
      "/lists",
      "/top/tv",
      "/top/seasons",
      "/top/networks",
      "/compare",
      "/movies/compare",
      ...FRANCHISES.map((f) => `/watch-order/${f.slug}`),
      ...TV_UNIVERSES.map((u) => `/tv-watch-order/${u.slug}`),
      ...EPISODE_GUIDES.map((g) => `/guide/${g.slug}`),
      ...VERTICALS.map((v) => `/${v.slug}`),
      ...networks.map((n) => `/network/${n.slug}`),
      // per-medium top pages: every directory network holds shows by
      // construction; movie pages are sitemapped only via genre, since
      // broadcast networks would index thin
      ...networks.map((n) => `/network/${n.slug}/shows`),
      ...genreSlugs.map((g) => `/genre/${g}`),
      ...tvGenreSlugs.map((g) => `/genre/${g}/shows`),
      ...movieGenreSlugs.map((g) => `/genre/${g}/movies`),
      // guide pages, cut by genre
      ...movieGenreSlugs.map((g) => `/movies/best/${year}/${g}`),
      ...movieGenreSlugs.map((g) => `/movies/underrated/${g}`),
      ...tvGenreSlugs.map((g) => `/tv/best/${year}/${g}`),
      ...tvGenreSlugs.map((g) => `/tv/underrated/${g}`),
    ]
      .map((p) => sitemapUrl(`${site}${p}`, EVERGREEN.has(p) ? BUILD_DATE : TODAY))
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const mv = /^movies-(\d+)\.xml$/.exec(file);
  if (mv) {
    const offset = Number(mv[1]) * SHOWS_PER_SITEMAP;
    if (offset >= MOVIE_LIMIT) return c.notFound();
    const { results } = await c.env.DB.prepare(
      "SELECT slug, updated_at FROM movies ORDER BY popularity DESC, imdb_id LIMIT ? OFFSET ?",
    )
      .bind(Math.min(SHOWS_PER_SITEMAP, MOVIE_LIMIT - offset), offset)
      .all<{ slug: string; updated_at: number }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map((r) => {
        const lm = epochDay(r.updated_at);
        return MOVIE_SUFFIXES.map((suffix) => sitemapUrl(`${site}/movie/${r.slug}${suffix}`, lm)).join("");
      })
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  // NOTE: episode (~200k) and people (~150k) shards are intentionally NOT served
  // — they were the bulk of the crawl surface. They 404 here and are excluded
  // from the index above. Re-introduce in waves once on a paid plan / more
  // authority. Those pages remain reachable via internal links.

  const m = /^shows-(\d+)\.xml$/.exec(file);
  if (!m) return c.notFound();
  const offset = Number(m[1]) * SHOWS_PER_SITEMAP;
  if (offset >= SHOW_LIMIT) return c.notFound();
  const { results } = await c.env.DB.prepare(
    "SELECT slug, updated_at FROM shows ORDER BY weight DESC, id LIMIT ? OFFSET ?",
  )
    .bind(Math.min(SHOWS_PER_SITEMAP, SHOW_LIMIT - offset), offset)
    .all<{ slug: string; updated_at: number }>();
  if (results.length === 0) return c.notFound();

  const urls = results
    .map((r) => {
      const lm = epochDay(r.updated_at);
      return SHOW_SUFFIXES.map((suffix) => sitemapUrl(`${site}/show/${r.slug}${suffix}`, lm)).join("");
    })
    .join("");
  return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

export default app;
