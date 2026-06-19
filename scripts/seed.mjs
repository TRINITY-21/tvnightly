#!/usr/bin/env node
// Builds seed/seed.sql from the TVmaze show index (rate-limited, resumable by re-run).
//   PAGES=2 EPISODES_TOP=30 node scripts/seed.mjs
// Each index page = 250 shows. Episodes are fetched for the top-N shows by weight.
// Full mirror: PAGES=350 EPISODES_TOP=5000 (takes ~1h, stays under 20 calls/10s).
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PAGES = Number(process.env.PAGES ?? 2);
const EPISODES_TOP = Number(process.env.EPISODES_TOP ?? 30);
// Incremental widening: START_PAGE fetches a later slice of the (id-ordered)
// index — high pages are the newest shows — so daily batches add fresh titles
// without re-pulling from page 0.
const START_PAGE = Number(process.env.START_PAGE ?? 0);
// Popularity-first widening: keep only shows at/above this TVmaze weight (0–100),
// so one full-index sweep mirrors what people actually search for (The Boys = 100)
// without the obscure long tail.
const WEIGHT_MIN = Number(process.env.WEIGHT_MIN ?? 0);
const THROTTLE_MS = 550; // TVmaze allows 20 calls / 10s / IP

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function get(path) {
  const wait = lastCall + THROTTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(`https://api.tvmaze.com${path}`);
  if (res.status === 404) return null;
  if (res.status === 429) {
    await sleep(5000);
    return get(path);
  }
  if (!res.ok) throw new Error(`TVmaze ${res.status} for ${path}`);
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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    // strip apostrophes/quotes/acronym-dots so they join their word:
    // "Marvel's S.H.I.E.L.D." -> marvels-shield, "Grey's Anatomy" -> greys-anatomy
    .replace(/['‘’"“”.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "show";

const shows = [];
for (let p = START_PAGE; p < START_PAGE + PAGES; p++) {
  const page = await get(`/shows?page=${p}`);
  if (!page) break; // 404 = past the last page
  shows.push(...page);
  console.log(`index page ${p}: ${page.length} shows (total ${shows.length})`);
}

// Popularity-first: drop the obscure long tail when a weight floor is set.
if (WEIGHT_MIN > 0) {
  const before = shows.length;
  for (let i = shows.length - 1; i >= 0; i--)
    if ((shows[i].weight ?? 0) < WEIGHT_MIN) shows.splice(i, 1);
  console.log(`weight >= ${WEIGHT_MIN}: kept ${shows.length} of ${before}`);
}

// Unique slugs: name, then name-year, then name-id. For an incremental batch we
// pre-load the slugs already in the DB (shows.slug is UNIQUE), so a new show
// never collides with the existing catalog — it falls through to name-year/-id.
const used = new Set();
if (process.env.SLUGS_FROM) {
  const SLUGS_FROM = process.env.SLUGS_FROM === "remote" ? "--remote" : "--local";
  try {
    const raw = execSync(
      `npx wrangler d1 execute tvnightly ${SLUGS_FROM} --json --command "SELECT id, slug FROM shows"`,
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
    );
    const existing = JSON.parse(raw)[0].results;
    const existingIds = new Set(existing.map((r) => r.id));
    for (const r of existing) used.add(r.slug); // dedupe new slugs against the catalog
    // additive: only seed shows not already present, so we never re-slug an
    // existing row (its slug is its URL) — full-index sweeps stay safe.
    const before = shows.length;
    for (let i = shows.length - 1; i >= 0; i--)
      if (existingIds.has(shows[i].id)) shows.splice(i, 1);
    console.log(`additive: ${shows.length} new of ${before} (catalog has ${existingIds.size})`);
  } catch (e) {
    console.warn(`could not pre-load existing catalog: ${e.message}`);
  }
}
for (const s of shows) {
  const base = slugify(s.name);
  const year = s.premiered?.slice(0, 4);
  let slug = base;
  if (used.has(slug) && year) slug = `${base}-${year}`;
  if (used.has(slug)) slug = `${base}-${s.id}`;
  used.add(slug);
  s._slug = slug;
}

const lines = [];
for (const s of shows) {
  const genres = s.genres?.length ? JSON.stringify(s.genres) : null;
  lines.push(
    `INSERT INTO shows (id, slug, name, status, premiered, ended, network, web_channel, rating, weight, image_url, summary, imdb_id, tvdb_id, updated_at, genres, runtime, type) VALUES (` +
      `${s.id}, ${esc(s._slug)}, ${esc(s.name)}, ${esc(s.status)}, ${esc(s.premiered)}, ${esc(s.ended)}, ` +
      `${esc(s.network?.name)}, ${esc(s.webChannel?.name)}, ${esc(s.rating?.average)}, ${s.weight ?? 0}, ` +
      `${esc(s.image?.medium)}, ${esc(s.summary)}, ${esc(s.externals?.imdb)}, ${esc(s.externals?.thetvdb)}, ${s.updated ?? 0}, ` +
      `${esc(genres)}, ${esc(s.averageRuntime)}, ${esc(s.type)})` +
      // UPSERT on the seed columns only — never clobber the enrichment columns
      // (tmdb_id, poster_url, providers_intl, cast_json, blurb) on a re-seed.
      ` ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, status=excluded.status, premiered=excluded.premiered, ended=excluded.ended, network=excluded.network, web_channel=excluded.web_channel, rating=excluded.rating, weight=excluded.weight, image_url=excluded.image_url, summary=excluded.summary, imdb_id=excluded.imdb_id, tvdb_id=excluded.tvdb_id, updated_at=excluded.updated_at, genres=excluded.genres, runtime=excluded.runtime, type=excluded.type;`,
  );
}

const top = [...shows].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, EPISODES_TOP);
let epCount = 0;
for (const [i, s] of top.entries()) {
  const eps = (await get(`/shows/${s.id}/episodes`)) ?? [];
  for (const e of eps) {
    lines.push(
      `INSERT OR REPLACE INTO episodes (id, show_id, season, number, name, airdate, airstamp, runtime, rating, image_url, summary) VALUES (` +
        `${e.id}, ${s.id}, ${esc(e.season)}, ${esc(e.number)}, ${esc(e.name)}, ${esc(e.airdate)}, ` +
        `${esc(e.airstamp)}, ${esc(e.runtime)}, ${esc(e.rating?.average)}, ${esc(e.image?.medium)}, ${esc(e.summary)});`,
    );
  }
  epCount += eps.length;
  console.log(`episodes ${i + 1}/${top.length}: ${s.name} (${eps.length})`);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/seed.sql", lines.join("\n") + "\n");
console.log(`Wrote seed/seed.sql — ${shows.length} shows, ${epCount} episodes.`);
