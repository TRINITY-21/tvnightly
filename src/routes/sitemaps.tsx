import { Hono } from "hono";
import { Bindings } from "../types";
import { FRANCHISES } from "../lib/franchises";
import { slugifyName } from "../lib/format";
import { origin, xmlRes, sitemapUrl, epochDay } from "../lib/seo";
import { networkDirectory, genreDirectory } from "../lib/queries";
import { VERTICALS } from "../lib/verticals";

const app = new Hono<{ Bindings: Bindings }>();

// --------------------------------------------------------------- sitemaps

const SHOWS_PER_SITEMAP = 1000;

// lastmod for the static shard. Charts, schedules and directories are rebuilt
// from continuously-synced data, so "today" is the honest freshness hint; the
// handful of evergreen editorial pages carry a fixed deploy date instead. Bump
// BUILD_DATE when those pages are meaningfully edited.
const TODAY = new Date().toISOString().slice(0, 10);
const BUILD_DATE = "2026-06-17";
const EVERGREEN = new Set(["/about", "/how-we-pick", "/editorial-policy"]);

app.get("/sitemap.xml", async (c) => {
  const site = origin(c);
  const [showRow, movieRow, peopleRow, episodeRow] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM shows").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM movies").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM people").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM episodes").first<{ n: number }>(),
  ]);
  const showShards = Math.max(1, Math.ceil((showRow?.n ?? 0) / SHOWS_PER_SITEMAP));
  const movieShards = Math.ceil((movieRow?.n ?? 0) / SHOWS_PER_SITEMAP);
  const peopleShards = Math.ceil((peopleRow?.n ?? 0) / SHOWS_PER_SITEMAP);
  const episodeShards = Math.ceil((episodeRow?.n ?? 0) / SHOWS_PER_SITEMAP);
  const entries = [
    "static.xml",
    ...Array.from({ length: showShards }, (_, i) => `shows-${i}.xml`),
    ...Array.from({ length: movieShards }, (_, i) => `movies-${i}.xml`),
    ...Array.from({ length: peopleShards }, (_, i) => `people-${i}.xml`),
    ...Array.from({ length: episodeShards }, (_, i) => `episodes-${i}.xml`),
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
      "/best-episodes",
      "/premieres",
      "/whats-new",
      "/tonight",
      "/calendar",
      "/renewals",
      "/watch-orders",
      "/lists",
      "/top/tv",
      "/top/seasons",
      "/top/networks",
      "/compare",
      "/movies/compare",
      ...FRANCHISES.map((f) => `/watch-order/${f.slug}`),
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
    const { results } = await c.env.DB.prepare(
      "SELECT slug, updated_at FROM movies ORDER BY popularity DESC, imdb_id LIMIT ? OFFSET ?",
    )
      .bind(SHOWS_PER_SITEMAP, Number(mv[1]) * SHOWS_PER_SITEMAP)
      .all<{ slug: string; updated_at: number }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map((r) => {
        const lm = epochDay(r.updated_at);
        return ["", "/where-to-watch", "/similar", "/compare", "/media", "/cast"]
          .map((suffix) => sitemapUrl(`${site}/movie/${r.slug}${suffix}`, lm))
          .join("");
      })
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const pp = /^people-(\d+)\.xml$/.exec(file);
  if (pp) {
    // films/shows = credit counts, so we only emit a /…/featuring page for people
    // with a real body of work (3+ credits) — thin pages stay out of the index
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name,
              (SELECT COUNT(*) FROM movie_credits mc WHERE mc.person_id = p.id) AS films,
              (SELECT COUNT(*) FROM credits cr WHERE cr.person_id = p.id) AS shows
       FROM people p ORDER BY p.id LIMIT ? OFFSET ?`,
    )
      .bind(SHOWS_PER_SITEMAP, Number(pp[1]) * SHOWS_PER_SITEMAP)
      .all<{ id: number; name: string; films: number; shows: number }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map((r) => {
        const slug = `${slugifyName(r.name)}-${r.id}`;
        const film = r.films >= 3 ? `<url><loc>${site}/movies/featuring/${slug}</loc></url>` : "";
        const tv = r.shows >= 3 ? `<url><loc>${site}/tv/featuring/${slug}</loc></url>` : "";
        return `<url><loc>${site}/person/${slug}</loc></url>${film}${tv}`;
      })
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const eps = /^episodes-(\d+)\.xml$/.exec(file);
  if (eps) {
    const { results } = await c.env.DB.prepare(
      `SELECT s.slug, e.season, e.number, e.airdate FROM episodes e
       JOIN shows s ON s.id = e.show_id
       ORDER BY e.show_id, e.season, e.number LIMIT ? OFFSET ?`,
    )
      .bind(SHOWS_PER_SITEMAP, Number(eps[1]) * SHOWS_PER_SITEMAP)
      .all<{ slug: string; season: number | null; number: number | null; airdate: string | null }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map((r) => {
        const loc = `${site}/show/${r.slug}/s${String(r.season ?? 0).padStart(2, "0")}e${String(r.number ?? 0).padStart(2, "0")}`;
        // airdate is the episode's natural "last changed" date — but never emit a
        // future date (unaired episodes) as lastmod
        const lm = r.airdate && r.airdate <= TODAY ? r.airdate : undefined;
        return sitemapUrl(loc, lm);
      })
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const m = /^shows-(\d+)\.xml$/.exec(file);
  if (!m) return c.notFound();
  const { results } = await c.env.DB.prepare(
    "SELECT slug, updated_at FROM shows ORDER BY weight DESC, id LIMIT ? OFFSET ?",
  )
    .bind(SHOWS_PER_SITEMAP, Number(m[1]) * SHOWS_PER_SITEMAP)
    .all<{ slug: string; updated_at: number }>();
  if (results.length === 0) return c.notFound();

  const urls = results
    .map((r) => {
      const lm = epochDay(r.updated_at);
      return ["", "/where-to-watch", "/similar", "/media", "/best-episodes", "/worst-episodes", "/essential", "/ratings", "/next-episode", "/release-date", "/cast"]
        .map((suffix) => sitemapUrl(`${site}/show/${r.slug}${suffix}`, lm))
        .join("");
    })
    .join("");
  return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

export default app;
