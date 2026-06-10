#!/usr/bin/env node
// Streaming providers for TV shows: our mirror is TVmaze-keyed, so bridge to
// TMDB via external ids (TVDB preferred, IMDb fallback), then pull regional
// watch providers. Writes seed/show-providers.sql (UPDATE statements only —
// never touches other columns).
//   TOP=500 node scripts/seed-show-providers.mjs    (top N shows by weight)
//   TARGET=remote ...                               (read show list from prod)
import { execSync } from "node:child_process";
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
  console.error("TMDB_API_KEY not set (env or .dev.vars)");
  process.exit(1);
}
const TOP = Number(process.env.TOP ?? 600);
const TARGET = process.env.TARGET === "remote" ? "--remote" : "--local";
const REGIONS = ["US", "GB", "CA", "AU", "IN", "DE", "FR", "ES", "IT", "BR", "MX", "NG", "NL", "SE", "JP", "KR"];
const THROTTLE_MS = 60;

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

const raw = execSync(
  `npx wrangler d1 execute tvnightly ${TARGET} --json --command "SELECT id, name, imdb_id, tvdb_id FROM shows WHERE (imdb_id IS NOT NULL OR tvdb_id IS NOT NULL) ORDER BY weight DESC LIMIT ${TOP}"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const shows = JSON.parse(raw)[0].results;
console.log(`bridging ${shows.length} shows to TMDB…`);

const lines = [];
let found = 0;
for (const [i, s] of shows.entries()) {
  try {
    let tmdbTv = null;
    if (s.tvdb_id) {
      const f = await get(`/find/${s.tvdb_id}`, "&external_source=tvdb_id");
      tmdbTv = f.tv_results?.[0]?.id ?? null;
    }
    if (!tmdbTv && s.imdb_id) {
      const f = await get(`/find/${s.imdb_id}`, "&external_source=imdb_id");
      tmdbTv = f.tv_results?.[0]?.id ?? null;
    }
    if (!tmdbTv) continue;
    const prov = await get(`/tv/${tmdbTv}/watch/providers`);
    const intl = {};
    for (const cc of REGIONS) {
      const names = prov.results?.[cc]?.flatrate?.map((p) => p.provider_name) ?? [];
      if (names.length) intl[cc] = names;
    }
    if (!Object.keys(intl).length) continue;
    lines.push(
      `UPDATE shows SET providers_intl = '${JSON.stringify(intl).replaceAll("'", "''")}' WHERE id = ${s.id};`,
    );
    found++;
  } catch (e) {
    console.log(`skip ${s.name}: ${e.message}`);
  }
  if ((i + 1) % 50 === 0) console.log(`${i + 1}/${shows.length} (${found} with providers)`);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/show-providers.sql", lines.join("\n") + "\n");
console.log(`Wrote seed/show-providers.sql — ${found}/${shows.length} shows with providers.`);
