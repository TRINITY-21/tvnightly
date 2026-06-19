#!/usr/bin/env node
// Backfills shows.type (TVmaze's classification: Scripted, Animation, Reality,
// Talk Show, News, Sports, Variety, Game Show, Award Show, Panel Show,
// Documentary). Our show ids ARE TVmaze ids, so we page the TVmaze /shows index
// once and emit an UPDATE for every id we hold. Writes seed/show-type.sql
// (UPDATE statements only — never touches other columns). Apply with the
// type:load:* npm scripts.
//   node scripts/backfill-show-type.mjs                 (read id list from local)
//   TARGET=remote node scripts/backfill-show-type.mjs   (read id list from prod)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const TARGET = process.env.TARGET === "remote" ? "--remote" : "--local";
const THROTTLE_MS = 550; // TVmaze asks for <= 20 calls / 10s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => (s == null ? null : `'${String(s).replaceAll("'", "''")}'`);

// our show ids (== TVmaze show ids)
const ONLY_NEW = process.env.ONLY_NEW ? "WHERE type IS NULL" : "";
const raw = execSync(
  `npx wrangler d1 execute tvnightly ${TARGET} --json --command "SELECT id FROM shows ${ONLY_NEW}"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const ids = new Set(JSON.parse(raw)[0].results.map((r) => r.id));
console.log(`need type for ${ids.size} shows`);

const lines = [];
let page = 0;
let matched = 0;
for (;;) {
  let res;
  try {
    res = await fetch(`https://api.tvmaze.com/shows?page=${page}`);
  } catch (e) {
    console.log(`page ${page} fetch error: ${e.message}; retrying`);
    await sleep(2000);
    continue;
  }
  if (res.status === 404) break; // past the last index page
  if (res.status === 429) {
    await sleep(5000);
    continue;
  }
  if (!res.ok) {
    console.log(`page ${page}: HTTP ${res.status}; stopping`);
    break;
  }
  const batch = await res.json();
  if (!Array.isArray(batch) || !batch.length) break;
  for (const s of batch) {
    if (ids.has(s.id) && s.type) {
      lines.push(`UPDATE shows SET type = ${esc(s.type)} WHERE id = ${s.id};`);
      matched++;
    }
  }
  if (page % 20 === 0) console.log(`page ${page} … matched ${matched}/${ids.size}`);
  if (matched >= ids.size) break; // every id covered
  page++;
  await sleep(THROTTLE_MS);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/show-type.sql", lines.join("\n") + "\n");
console.log(`Wrote seed/show-type.sql — ${lines.length} updates (matched ${matched}/${ids.size}).`);
