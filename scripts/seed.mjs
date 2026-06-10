#!/usr/bin/env node
// Builds seed/seed.sql from the TVmaze show index (rate-limited, resumable by re-run).
//   PAGES=2 EPISODES_TOP=30 node scripts/seed.mjs
// Each index page = 250 shows. Episodes are fetched for the top-N shows by weight.
// Full mirror: PAGES=350 EPISODES_TOP=5000 (takes ~1h, stays under 20 calls/10s).
import { mkdirSync, writeFileSync } from "node:fs";

const PAGES = Number(process.env.PAGES ?? 2);
const EPISODES_TOP = Number(process.env.EPISODES_TOP ?? 30);
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
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "show";

const shows = [];
for (let p = 0; p < PAGES; p++) {
  const page = await get(`/shows?page=${p}`);
  if (!page) break; // 404 = past the last page
  shows.push(...page);
  console.log(`index page ${p}: ${page.length} shows (total ${shows.length})`);
}

// Unique slugs: name, then name-year, then name-id.
const used = new Set();
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
  lines.push(
    `INSERT OR REPLACE INTO shows (id, slug, name, status, premiered, ended, network, web_channel, rating, weight, image_url, summary, imdb_id, tvdb_id, updated_at) VALUES (` +
      `${s.id}, ${esc(s._slug)}, ${esc(s.name)}, ${esc(s.status)}, ${esc(s.premiered)}, ${esc(s.ended)}, ` +
      `${esc(s.network?.name)}, ${esc(s.webChannel?.name)}, ${esc(s.rating?.average)}, ${s.weight ?? 0}, ` +
      `${esc(s.image?.medium)}, ${esc(s.summary)}, ${esc(s.externals?.imdb)}, ${esc(s.externals?.thetvdb)}, ${s.updated ?? 0});`,
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
