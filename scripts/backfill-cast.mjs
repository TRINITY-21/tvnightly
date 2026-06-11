#!/usr/bin/env node
// Backfills shows.cast_json for the existing mirror (UPDATE statements only —
// preserves blurbs/providers/everything else). The hourly sync keeps it fresh
// afterwards via embed[]=cast on the same TVmaze call.
//   node scripts/backfill-cast.mjs            (local D1)
//   REMOTE=1 node scripts/backfill-cast.mjs   (production D1)
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const REMOTE = process.env.REMOTE ? "--remote" : "--local";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT id FROM shows ORDER BY weight DESC"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const ids = JSON.parse(out)[0].results.map((r) => r.id);
console.log(`${ids.length} shows to backfill`);

const esc = (s) => (s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);
const lines = [];
const peopleSeen = new Set();
let done = 0;
for (const id of ids) {
  // TVmaze rate limit: 20 calls / 10s — stay at ~1.8/s
  await sleep(550);
  let res;
  try {
    res = await fetch(`https://api.tvmaze.com/shows/${id}?embed=cast`);
    if (res.status === 429) {
      await sleep(11000);
      res = await fetch(`https://api.tvmaze.com/shows/${id}?embed=cast`);
    }
    if (!res.ok) {
      console.log(`skip ${id}: HTTP ${res.status}`);
      continue;
    }
  } catch (e) {
    console.log(`skip ${id}: ${e.message}`);
    continue;
  }
  const show = await res.json();
  const credits = show._embedded?.cast ?? [];
  const seen = new Set();
  const cast = [];
  for (const cr of credits) {
    const pid = cr.person?.id;
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    cast.push({
      id: pid,
      n: cr.person.name,
      c: cr.character?.name ?? null,
      img: cr.person?.image?.medium ?? null,
      ...(cr.person?.birthday ? { b: cr.person.birthday } : {}),
      ...(cr.person?.deathday ? { d: cr.person.deathday } : {}),
      ...(cr.person?.country?.name ? { cn: cr.person.country.name } : {}),
      ...(cr.voice ? { v: true } : {}),
    });
    // people + credits rows for the /person pages
    if (!peopleSeen.has(pid)) {
      peopleSeen.add(pid);
      lines.push(
        `INSERT OR REPLACE INTO people (id, name, birthday, deathday, country, image_url, updated_at) VALUES (` +
          `${pid}, ${esc(cr.person.name)}, ${esc(cr.person.birthday ?? null)}, ${esc(cr.person.deathday ?? null)}, ` +
          `${esc(cr.person.country?.name ?? null)}, ${esc(cr.person.image?.medium ?? null)}, ${Math.floor(Date.now() / 1000)});`,
      );
    }
    lines.push(
      `INSERT OR REPLACE INTO credits (person_id, show_id, character, voice) VALUES (` +
        `${pid}, ${id}, ${esc(cr.character?.name ?? null)}, ${cr.voice ? 1 : 0});`,
    );
    if (cast.length >= 10) break;
  }
  if (cast.length) {
    lines.push(`UPDATE shows SET cast_json = ${esc(JSON.stringify(cast))} WHERE id = ${id};`);
  }
  if (++done % 25 === 0) console.log(`${done}/${ids.length}`);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/cast.sql", lines.join("\n") + "\n");
console.log(`Wrote seed/cast.sql — ${lines.length} shows with cast.`);
execSync(`npx wrangler d1 execute tvnightly ${REMOTE} --file seed/cast.sql`, { stdio: "inherit" });
console.log("Loaded.");
