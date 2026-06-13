#!/usr/bin/env node
// Builds data/tmdb-network-logos.json: TMDB network id -> logo URL (w185).
// Curated ids for TVmaze network labels that aren't streaming providers.
//   node scripts/fetch-network-logos.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

// TMDB /network/{id} — broadcast & cable brands from our top-networks page.
const IDS = [
  2, 4, 6, 9, 13, 16, 19, 21, 26, 40, 41, 49, 67, 68, 71, 77, 80, 88, 98, 105, 110, 174, 213,
  318, 332, 1035,
];

const map = {};
for (const id of IDS) {
  const res = await fetch(`https://api.themoviedb.org/3/network/${id}?api_key=${KEY}`);
  if (!res.ok) {
    console.warn(`TMDB ${res.status} for network/${id}`);
    continue;
  }
  const { name, logo_path: path } = await res.json();
  if (path) map[String(id)] = `https://image.tmdb.org/t/p/w185${path}`;
  else console.warn(`No logo for network/${id} (${name})`);
}

writeFileSync("data/tmdb-network-logos.json", JSON.stringify(map, null, 1) + "\n");
console.log(`Wrote data/tmdb-network-logos.json — ${Object.keys(map).length} networks.`);
