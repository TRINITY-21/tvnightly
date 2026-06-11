#!/usr/bin/env node
// The canonical display poster per show: TMDB's community-voted one-sheet
// (English first — a poster's title typography is the point — then any
// top-voted, then TMDB's designated poster_path). Stored as a w342 URL so
// every surface (cards, heroes, dossier rows) renders the same art; the
// TVmaze image_url stays as fallback for shows without a TMDB bridge.
// Re-run with the monthly seeds.
//   node scripts/backfill-posters.mjs            (local)
//   REMOTE=1 node scripts/backfill-posters.mjs   (production)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = execSync(
  `npx wrangler d1 execute tvnightly ${REMOTE} --json --command "SELECT id, tmdb_id FROM shows WHERE tmdb_id IS NOT NULL"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const rows = JSON.parse(out)[0].results;
console.log(`${rows.length} shows with a TMDB bridge`);

const lines = [];
let done = 0;
let found = 0;
for (const r of rows) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/tv/${r.tmdb_id}/images?api_key=${KEY}&include_image_language=en,null`,
    );
    if (res.ok) {
      const data = await res.json();
      const ranked = (data.posters ?? []).sort((a, b) => b.vote_count - a.vote_count);
      const pick = ranked.find((p) => p.iso_639_1 === "en")?.file_path ?? ranked[0]?.file_path;
      if (pick) {
        lines.push(
          `UPDATE shows SET poster_url = 'https://image.tmdb.org/t/p/w342${pick}' WHERE id = ${r.id};`,
        );
        found++;
      }
    }
  } catch {
    // skip; TVmaze fallback covers it
  }
  done++;
  if (done % 50 === 0) console.log(`${done}/${rows.length}…`);
  await sleep(30); // stay friendly to TMDB's burst limits
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/posters.sql", lines.join("\n") + "\n");
console.log(`${found} posters picked -> seed/posters.sql, applying…`);
execSync(`npx wrangler d1 execute tvnightly ${REMOTE} --file seed/posters.sql`, {
  stdio: "inherit",
});
console.log("Done.");
