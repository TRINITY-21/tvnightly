#!/usr/bin/env node
// Crew → person pages: the writers, directors, EPs, composers and DPs that
// the cast pages now list get people rows (offset ids, 10M + TMDB id — the
// same namespace as TV guests and movie cast), so every crew name is a
// working door. Existing people are matched by normalized name so one human
// never gets two pages. Re-run with the monthly seeds; follow with
// people:enrich so the new rows get bios.
//   node scripts/backfill-crew.mjs            (local)
//   REMOTE=1 node scripts/backfill-crew.mjs   (production)
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
const ID_OFFSET = 10_000_000;
// keep in sync with TV_CREW_JOBS (routes/people.tsx) and CREW_RANK (lib/tmdb.ts)
const TV_JOBS = new Set([
  "Director",
  "Writer",
  "Executive Producer",
  "Original Music Composer",
  "Director of Photography",
]);
const MOVIE_JOBS = new Set([
  "Director",
  "Screenplay",
  "Writer",
  "Story",
  "Executive Producer",
  "Producer",
  "Original Music Composer",
  "Director of Photography",
  "Editor",
]);
const PER_SHOW = 18;
const PER_MOVIE = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => (s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

const peopleOut = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT id, name FROM people"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const known = new Set();
for (const p of JSON.parse(peopleOut)[0].results) known.add(norm(p.name));

const showsOut = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT tmdb_id FROM shows WHERE tmdb_id IS NOT NULL"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const shows = JSON.parse(showsOut)[0].results;
const moviesOut = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT imdb_id FROM movies"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const movies = JSON.parse(moviesOut)[0].results;
console.log(`${shows.length} shows + ${movies.length} movies, ${known.size} known people`);

const lines = [];
const added = new Set();
const addPerson = (tmdbPerson) => {
  if (known.has(norm(tmdbPerson.name))) return;
  const pid = ID_OFFSET + tmdbPerson.id;
  if (added.has(pid)) return;
  added.add(pid);
  const img = tmdbPerson.profile_path
    ? `https://image.tmdb.org/t/p/w185${tmdbPerson.profile_path}`
    : null;
  lines.push(
    `INSERT OR IGNORE INTO people (id, name, birthday, deathday, country, image_url, updated_at) VALUES (` +
      `${pid}, ${esc(tmdbPerson.name)}, NULL, NULL, NULL, ${esc(img)}, ${Math.floor(Date.now() / 1000)});`,
  );
};

let done = 0;
for (const s of shows) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/tv/${s.tmdb_id}/aggregate_credits?api_key=${KEY}`,
    );
    if (res.ok) {
      const data = await res.json();
      (data.crew ?? [])
        .filter((p) => (p.jobs ?? []).some((j) => TV_JOBS.has(j.job)))
        .sort((a, b) => (b.total_episode_count ?? 0) - (a.total_episode_count ?? 0))
        .slice(0, PER_SHOW)
        .forEach(addPerson);
    }
  } catch {
    // skip; the page degrades to unlinked names
  }
  done++;
  if (done % 50 === 0) console.log(`shows ${done}/${shows.length}…`);
  await sleep(30);
}
done = 0;
for (const m of movies) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${m.imdb_id}/credits?api_key=${KEY}`,
    );
    if (res.ok) {
      const data = await res.json();
      (data.crew ?? [])
        .filter((p) => MOVIE_JOBS.has(p.job))
        .slice(0, PER_MOVIE)
        .forEach(addPerson);
    }
  } catch {
    // skip
  }
  done++;
  if (done % 50 === 0) console.log(`movies ${done}/${movies.length}…`);
  await sleep(30);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/crew.sql", lines.join("\n") + "\n");
console.log(`${added.size} new crew people -> seed/crew.sql, applying…`);
if (lines.length) {
  execSync(`npx wrangler d1 execute tvnightly ${REMOTE} --file seed/crew.sql`, {
    stdio: "inherit",
  });
}
console.log("Done.");
