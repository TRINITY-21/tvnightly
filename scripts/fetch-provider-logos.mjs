#!/usr/bin/env node
// Builds data/provider-logos.json: provider_name -> TMDB logo URL (w92).
// One global map covers every region; provider names in providers_intl come
// from the same TMDB source, so lookups are exact-match.
//   node scripts/fetch-provider-logos.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";

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
  console.error("TMDB_API_KEY not set (env or .dev.vars).");
  process.exit(1);
}

const map = {};
for (const kind of ["tv", "movie"]) {
  const res = await fetch(`https://api.themoviedb.org/3/watch/providers/${kind}?api_key=${KEY}`);
  if (!res.ok) throw new Error(`TMDB ${res.status} for providers/${kind}`);
  const { results } = await res.json();
  for (const p of results ?? []) {
    if (p.provider_name && p.logo_path && !map[p.provider_name]) {
      map[p.provider_name] = `https://image.tmdb.org/t/p/w92${p.logo_path}`;
    }
  }
}

const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync("data/provider-logos.json", JSON.stringify(sorted, null, 1) + "\n");
console.log(`Wrote data/provider-logos.json — ${Object.keys(sorted).length} providers.`);
