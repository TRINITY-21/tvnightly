#!/usr/bin/env node
// Person-page enrichment from TMDB: biography, birthplace, known-for
// department, IMDb/Instagram/Twitter/homepage links — plus their movie
// credits matched against OUR movie mirror (movies.tmdb_id).
// Guests already carry TMDB ids (people.id - 10M); main cast are matched by
// name search, verified by birthday when both sides have one.
//   node scripts/backfill-people-tmdb.mjs            (local)
//   REMOTE=1 node scripts/backfill-people-tmdb.mjs   (production)
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
const GUEST_ID_OFFSET = 10_000_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => (s == null || s === "" ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);

async function tmdb(path, params = "") {
  await sleep(55);
  const res = await fetch(`https://api.themoviedb.org/3${path}?api_key=${KEY}${params}`);
  if (res.status === 429) {
    await sleep(2000);
    return tmdb(path, params);
  }
  if (!res.ok) return null;
  return res.json();
}

const d1 = (sql) =>
  JSON.parse(
    execSync(`npx wrangler d1 execute tvnightly ${REMOTE} --json --command "${sql}"`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  )[0].results;

const people = d1("SELECT id, name, birthday FROM people");
const movieMap = new Map(
  d1("SELECT imdb_id, tmdb_id FROM movies WHERE tmdb_id IS NOT NULL").map((m) => [
    m.tmdb_id,
    m.imdb_id,
  ]),
);
console.log(`${people.length} people, ${movieMap.size} mirror movies for credit matching`);

const lines = [];
let done = 0;
let matched = 0;
for (const person of people) {
  done++;
  let tmdbId = person.id >= GUEST_ID_OFFSET ? person.id - GUEST_ID_OFFSET : null;
  if (!tmdbId) {
    const search = await tmdb("/search/person", `&query=${encodeURIComponent(person.name)}`);
    const candidates = search?.results ?? [];
    // birthday is the strong disambiguator when we have it; else top popularity
    let pick = candidates[0];
    if (person.birthday && candidates.length > 1) {
      for (const cand of candidates.slice(0, 4)) {
        const det = await tmdb(`/person/${cand.id}`);
        if (det?.birthday === person.birthday) {
          pick = cand;
          break;
        }
      }
    }
    if (!pick) continue;
    tmdbId = pick.id;
  }

  const det = await tmdb(`/person/${tmdbId}`, "&append_to_response=external_ids,movie_credits");
  if (!det) continue;
  matched++;

  const socials = {};
  if (det.external_ids?.instagram_id) socials.ig = det.external_ids.instagram_id;
  if (det.external_ids?.twitter_id) socials.tw = det.external_ids.twitter_id;
  lines.push(
    `UPDATE people SET ` +
      `bio = ${esc(det.biography)}, birthplace = ${esc(det.place_of_birth)}, ` +
      `known_dept = ${esc(det.known_for_department)}, tmdb_id = ${tmdbId}, ` +
      `imdb_id = ${esc(det.external_ids?.imdb_id ?? det.imdb_id)}, homepage = ${esc(det.homepage)}, ` +
      `socials = ${esc(Object.keys(socials).length ? JSON.stringify(socials) : null)}, ` +
      `birthday = COALESCE(birthday, ${esc(det.birthday)}), ` +
      `deathday = COALESCE(deathday, ${esc(det.deathday)}) ` +
      `WHERE id = ${person.id};`,
  );
  for (const mc of det.movie_credits?.cast ?? []) {
    const imdb = movieMap.get(mc.id);
    if (!imdb) continue; // only movies in OUR mirror — linkable or nothing
    lines.push(
      `INSERT OR REPLACE INTO movie_credits (person_id, movie_id, character) VALUES (` +
        `${person.id}, ${esc(imdb)}, ${esc(mc.character ?? null)});`,
    );
  }
  if (done % 100 === 0) console.log(`${done}/${people.length} (${matched} matched)`);
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/people-tmdb.sql", lines.join("\n") + "\n");
console.log(`Wrote seed/people-tmdb.sql — ${lines.length} statements, ${matched} people enriched.`);
execSync(`npx wrangler d1 execute tvnightly ${REMOTE} --file seed/people-tmdb.sql`, {
  stdio: "inherit",
});
console.log("Loaded.");
