#!/usr/bin/env node
// Builds seed/movies.sql from TMDB: discover by vote count, then per-movie
// details (runtime, imdb_id, genres). Reads TMDB_API_KEY from env or .dev.vars.
//   PAGES=25 node scripts/seed-movies.mjs   (25 pages x 20 = top 500 movies)
// Movies without an IMDb id are skipped (imdb_id is the primary key).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

function devVar(name) {
  if (process.env[name]) return process.env[name];
  if (existsSync(".dev.vars")) {
    const m = readFileSync(".dev.vars", "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) return m[1].trim();
  }
  return undefined;
}

const KEY = devVar("TMDB_API_KEY");
if (!KEY) {
  console.error("TMDB_API_KEY not set (env or .dev.vars). Get a free key: themoviedb.org -> Settings -> API");
  process.exit(1);
}
const PAGES = Number(process.env.PAGES ?? 25);
const THROTTLE_MS = 60; // stay well under TMDB's ~50 req/s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function get(path, params = "") {
  const wait = lastCall + THROTTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(`https://api.themoviedb.org/3${path}?api_key=${KEY}${params}`);
  if (res.status === 429) {
    await sleep(2000);
    return get(path, params);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
  return res.json();
}

const esc = (v) =>
  v == null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;

const slugify = (name) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "movie";

// Phase 1: discover ids, most-voted first (blockbusters + classics).
const ids = [];
for (let p = 1; p <= PAGES; p++) {
  const page = await get("/discover/movie", `&sort_by=vote_count.desc&vote_count.gte=1000&page=${p}`);
  for (const r of page.results ?? []) ids.push(r.id);
  console.log(`discover page ${p}/${PAGES} (total ${ids.length})`);
  if (p >= (page.total_pages ?? 1)) break;
}

// Phase 2: details per movie.
const used = new Set();
// Full top-N snapshot: start from empty so cross-run slug drift (title/year
// corrections, vote reordering) can never hit the slug UNIQUE constraint and
// abort the load. No other writer touches the movies table.
const lines = ["DELETE FROM movies;"];
let kept = 0;
for (const [i, id] of ids.entries()) {
  const m = await get(`/movie/${id}`, "&append_to_response=watch%2Fproviders");
  if (!m.imdb_id) continue;
  const year = m.release_date ? Number(m.release_date.slice(0, 4)) : null;
  let slug = year ? `${slugify(m.title)}-${year}` : slugify(m.title);
  if (used.has(slug)) slug = `${slug}-${m.imdb_id}`;
  used.add(slug);
  const genres = m.genres?.length ? JSON.stringify(m.genres.map((g) => g.name)) : null;
  const poster = m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null;
  const flatrate = m["watch/providers"]?.results?.US?.flatrate ?? [];
  const providers = flatrate.length ? JSON.stringify(flatrate.map((p) => p.provider_name)) : null;
  lines.push(
    `INSERT INTO movies (imdb_id, slug, title, year, release_date, overview, genres, runtime, rating, votes, popularity, poster_url, tmdb_id, wikidata_id, updated_at, providers) VALUES (` +
      `${esc(m.imdb_id)}, ${esc(slug)}, ${esc(m.title)}, ${esc(year)}, ${esc(m.release_date || null)}, ${esc(m.overview || null)}, ` +
      `${esc(genres)}, ${esc(m.runtime || null)}, ${esc(m.vote_average ?? null)}, ${esc(m.vote_count ?? null)}, ${esc(m.popularity ?? null)}, ` +
      `${esc(poster)}, ${m.id}, NULL, ${Math.floor(Date.now() / 1000)}, ${esc(providers)})` +
      ` ON CONFLICT(imdb_id) DO UPDATE SET slug=excluded.slug, title=excluded.title, year=excluded.year, release_date=excluded.release_date, overview=excluded.overview, genres=excluded.genres, runtime=excluded.runtime, rating=excluded.rating, votes=excluded.votes, popularity=excluded.popularity, poster_url=excluded.poster_url, tmdb_id=excluded.tmdb_id, updated_at=excluded.updated_at, providers=excluded.providers;`,
  );
  kept++;
  if ((i + 1) % 50 === 0) console.log(`details ${i + 1}/${ids.length}`);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/movies.sql", lines.join("\n") + "\n");
console.log(`Wrote seed/movies.sql — ${kept} movies (${ids.length - kept} skipped, no IMDb id).`);
