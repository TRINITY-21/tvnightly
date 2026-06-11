#!/usr/bin/env node
// Movie cast → person pages: every billed actor on a mirrored movie gets a
// movie_credits row, creating offset-id people rows (10M + TMDB id, the same
// namespace the TV guest backfill uses) for anyone we don't already track.
// Existing TVmaze people are matched by normalized name so one human never
// gets two person pages. Re-run with the monthly movie seeds; follow with
// people:enrich so the new rows get bios.
//   node scripts/backfill-movie-cast.mjs            (local)
//   REMOTE=1 node scripts/backfill-movie-cast.mjs   (production)
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
const ID_OFFSET = 10_000_000; // TMDB person ids live above TVmaze's
const TOP_BILLED = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => (s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

const peopleOut = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT id, name FROM people"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const byName = new Map();
for (const p of JSON.parse(peopleOut)[0].results) {
  if (!byName.has(norm(p.name))) byName.set(norm(p.name), p.id);
}
const moviesOut = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT imdb_id FROM movies"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const movies = JSON.parse(moviesOut)[0].results;
console.log(`${movies.length} movies, ${byName.size} known people`);

const lines = [];
const newPeople = new Set();
let done = 0;
let credits = 0;
for (const m of movies) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${m.imdb_id}/credits?api_key=${KEY}`,
    );
    if (res.ok) {
      const data = await res.json();
      const cast = (data.cast ?? [])
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        .slice(0, TOP_BILLED);
      for (const c of cast) {
        let pid = byName.get(norm(c.name));
        if (!pid) {
          pid = ID_OFFSET + c.id;
          if (!newPeople.has(pid)) {
            newPeople.add(pid);
            const img = c.profile_path
              ? `https://image.tmdb.org/t/p/w185${c.profile_path}`
              : null;
            lines.push(
              `INSERT OR IGNORE INTO people (id, name, birthday, deathday, country, image_url, updated_at) VALUES (` +
                `${pid}, ${esc(c.name)}, NULL, NULL, NULL, ${esc(img)}, ${Math.floor(Date.now() / 1000)});`,
            );
          }
        }
        lines.push(
          `INSERT OR REPLACE INTO movie_credits (person_id, movie_id, character) VALUES (` +
            `${pid}, ${esc(m.imdb_id)}, ${esc(c.character ?? null)});`,
        );
        credits++;
      }
    }
  } catch {
    // skip; the page degrades to unlinked names
  }
  done++;
  if (done % 50 === 0) console.log(`${done}/${movies.length}…`);
  await sleep(30);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/movie-cast.sql", lines.join("\n") + "\n");
console.log(
  `${credits} credits (${newPeople.size} new people) -> seed/movie-cast.sql, applying…`,
);
execSync(`npx wrangler d1 execute tvnightly ${REMOTE} --file seed/movie-cast.sql`, {
  stdio: "inherit",
});
console.log("Done.");
