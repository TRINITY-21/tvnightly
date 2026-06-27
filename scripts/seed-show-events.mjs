#!/usr/bin/env node
// Copy show_events (+ referenced shows) from prod for local /renewals.
//   node scripts/seed-show-events.mjs
//   npm run renewals:events:load:local
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const TARGET = process.env.TARGET === "local" ? "--local" : "--remote";
const LIMIT = Number(process.env.LIMIT ?? 0);

const esc = (v) =>
  v == null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

function query(sql) {
  const raw = execSync(`npx wrangler d1 execute tvnightly ${TARGET} --json --command ${JSON.stringify(sql)}`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const jsonStart = raw.indexOf("[");
  if (jsonStart < 0) throw new Error("wrangler d1 execute returned no JSON");
  return JSON.parse(raw.slice(jsonStart))[0].results;
}

function insertRow(table, row, replace = false) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => esc(row[c]));
  const verb = replace ? "INSERT OR REPLACE" : "INSERT";
  return `${verb} INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;
}

const events = query(
  `SELECT id, show_id, type, season, old_value, new_value, detected_at FROM show_events ORDER BY detected_at DESC${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}`,
);
const showIds = [...new Set(events.map((e) => e.show_id))];
console.log(`fetched ${events.length} show_events (${showIds.length} shows) from ${TARGET === "--remote" ? "production" : "local"}`);

const shows = [];
for (let i = 0; i < showIds.length; i += 90) {
  const chunk = showIds.slice(i, i + 90);
  shows.push(...query(`SELECT * FROM shows WHERE id IN (${chunk.join(",")})`));
}
console.log(`fetched ${shows.length} referenced shows`);

const lines = [
  "-- show_events + referenced shows: renewals & premiere dates (/renewals)",
  "DELETE FROM show_events;",
  ...shows.map((r) => insertRow("shows", r, true)),
  ...events.map((r) => insertRow("show_events", r)),
];

mkdirSync("seed", { recursive: true });
const out = "seed/show-events.sql";
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}`);
