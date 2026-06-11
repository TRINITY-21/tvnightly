#!/usr/bin/env node
// Episode counts for main cast + guest stars, via TMDB aggregate_credits
// (TVmaze carries neither). Shows need a tmdb_id (bridged by
// seed-show-providers.mjs). Main cast = matched by name to existing TVmaze
// credits (keeps their person pages rich). Guests = top TMDB-only entries,
// stored with offset person ids (10M + tmdb id) so namespaces never collide.
//   node scripts/backfill-credits-tmdb.mjs            (local)
//   REMOTE=1 node scripts/backfill-credits-tmdb.mjs   (production)
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
  console.error("TMDB_API_KEY not set (env or .dev.vars).");
  process.exit(1);
}
const REMOTE = process.env.REMOTE ? "--remote" : "--local";
const GUEST_ID_OFFSET = 10_000_000; // TMDB person ids live above TVmaze's
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => (s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

const out = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT s.id, s.tmdb_id, p.id AS pid, p.name FROM shows s JOIN credits c ON c.show_id = s.id JOIN people p ON p.id = c.person_id WHERE s.tmdb_id IS NOT NULL"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const rows = JSON.parse(out)[0].results;
const byShow = new Map(); // show_id -> {tmdb, people: Map<normName, pid>}
for (const r of rows) {
  if (!byShow.has(r.id)) byShow.set(r.id, { tmdb: r.tmdb_id, people: new Map() });
  byShow.get(r.id).people.set(norm(r.name), r.pid);
}
console.log(`${byShow.size} shows with tmdb_id + cast`);

const lines = [];
const guestPeopleSeen = new Set();
let done = 0;
for (const [showId, { tmdb, people }] of byShow) {
  await sleep(60); // well under TMDB's ~50 req/s
  let res;
  try {
    res = await fetch(`https://api.themoviedb.org/3/tv/${tmdb}/aggregate_credits?api_key=${KEY}`);
    if (!res.ok) {
      console.log(`skip show ${showId}: TMDB ${res.status}`);
      continue;
    }
  } catch (e) {
    console.log(`skip show ${showId}: ${e.message}`);
    continue;
  }
  const { cast = [] } = await res.json();

  const matchedNames = new Set();
  const guests = [];
  for (const m of cast) {
    const pid = people.get(norm(m.name ?? ""));
    if (pid != null && !matchedNames.has(pid)) {
      // main cast: episode count onto the existing TVmaze-backed credit
      matchedNames.add(pid);
      lines.push(
        `UPDATE credits SET episodes = ${m.total_episode_count ?? "NULL"} WHERE person_id = ${pid} AND show_id = ${showId};`,
      );
    } else if (pid == null) {
      guests.push(m);
    }
  }
  // guest stars: top TMDB-only entries by episode count
  for (const g of guests
    .sort((a, b) => (b.total_episode_count ?? 0) - (a.total_episode_count ?? 0))
    .slice(0, 12)) {
    const gid = GUEST_ID_OFFSET + g.id;
    if (!guestPeopleSeen.has(gid)) {
      guestPeopleSeen.add(gid);
      const img = g.profile_path ? `https://image.tmdb.org/t/p/w185${g.profile_path}` : null;
      lines.push(
        `INSERT OR REPLACE INTO people (id, name, birthday, deathday, country, image_url, updated_at) VALUES (` +
          `${gid}, ${esc(g.name)}, NULL, NULL, NULL, ${esc(img)}, ${Math.floor(Date.now() / 1000)});`,
      );
    }
    lines.push(
      `INSERT OR REPLACE INTO credits (person_id, show_id, character, voice, episodes, guest) VALUES (` +
        `${gid}, ${showId}, ${esc(g.roles?.[0]?.character ?? null)}, 0, ${g.total_episode_count ?? "NULL"}, 1);`,
    );
  }
  if (++done % 50 === 0) console.log(`${done}/${byShow.size}`);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/credits-tmdb.sql", lines.join("\n") + "\n");
console.log(`Wrote seed/credits-tmdb.sql — ${lines.length} statements.`);
execSync(`npx wrangler d1 execute tvnightly ${REMOTE} --file seed/credits-tmdb.sql`, {
  stdio: "inherit",
});
console.log("Loaded.");
