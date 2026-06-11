import { Hono } from "hono";
import { Bindings } from "../types";
import { FRANCHISES } from "../lib/franchises";
import { slugifyName } from "../lib/format";
import { origin, xmlRes } from "../lib/seo";
import { networkDirectory, genreDirectory } from "../lib/queries";
import { VERTICALS } from "../lib/verticals";

const app = new Hono<{ Bindings: Bindings }>();

// --------------------------------------------------------------- sitemaps

const SHOWS_PER_SITEMAP = 1000;

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
    .map((f) => `<sitemap><loc>${site}/sitemaps/${f}</loc></sitemap>`)
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
    const urls = [
      "/",
      "/recommend",
      "/loved",
      "/what-to-watch",
      "/movies",
      "/movies/best",
      "/movies/upcoming",
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
      ...FRANCHISES.map((f) => `/watch-order/${f.slug}`),
      ...VERTICALS.map((v) => `/${v.slug}`),
      ...networks.map((n) => `/network/${n.slug}`),
      ...genreSlugs.map((g) => `/genre/${g}`),
    ]
      .map((p) => `<url><loc>${site}${p}</loc></url>`)
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const mv = /^movies-(\d+)\.xml$/.exec(file);
  if (mv) {
    const { results } = await c.env.DB.prepare(
      "SELECT slug FROM movies ORDER BY popularity DESC, imdb_id LIMIT ? OFFSET ?",
    )
      .bind(SHOWS_PER_SITEMAP, Number(mv[1]) * SHOWS_PER_SITEMAP)
      .all<{ slug: string }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map((r) => `<url><loc>${site}/movie/${r.slug}</loc></url>`)
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const pp = /^people-(\d+)\.xml$/.exec(file);
  if (pp) {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name FROM people ORDER BY id LIMIT ? OFFSET ?",
    )
      .bind(SHOWS_PER_SITEMAP, Number(pp[1]) * SHOWS_PER_SITEMAP)
      .all<{ id: number; name: string }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map((r) => `<url><loc>${site}/person/${slugifyName(r.name)}-${r.id}</loc></url>`)
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const eps = /^episodes-(\d+)\.xml$/.exec(file);
  if (eps) {
    const { results } = await c.env.DB.prepare(
      `SELECT s.slug, e.season, e.number FROM episodes e
       JOIN shows s ON s.id = e.show_id
       ORDER BY e.show_id, e.season, e.number LIMIT ? OFFSET ?`,
    )
      .bind(SHOWS_PER_SITEMAP, Number(eps[1]) * SHOWS_PER_SITEMAP)
      .all<{ slug: string; season: number | null; number: number | null }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map(
        (r) =>
          `<url><loc>${site}/show/${r.slug}/s${String(r.season ?? 0).padStart(2, "0")}e${String(r.number ?? 0).padStart(2, "0")}</loc></url>`,
      )
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const m = /^shows-(\d+)\.xml$/.exec(file);
  if (!m) return c.notFound();
  const { results } = await c.env.DB.prepare(
    "SELECT slug FROM shows ORDER BY weight DESC, id LIMIT ? OFFSET ?",
  )
    .bind(SHOWS_PER_SITEMAP, Number(m[1]) * SHOWS_PER_SITEMAP)
    .all<{ slug: string }>();
  if (results.length === 0) return c.notFound();

  const urls = results
    .map((r) =>
      ["", "/where-to-watch", "/best-episodes", "/worst-episodes", "/essential", "/ratings", "/next-episode", "/release-date", "/cast"]
        .map((suffix) => `<url><loc>${site}/show/${r.slug}${suffix}</loc></url>`)
        .join(""),
    )
    .join("");
  return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

export default app;
