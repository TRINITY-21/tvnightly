#!/usr/bin/env node
// Copy provider_events from prod → seed/provider-events.sql for local /whats-new.
//   node scripts/seed-provider-events.mjs
//   npm run providers:events:load:local
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const TARGET = process.env.TARGET === "local" ? "--local" : "--remote";
const LIMIT = Number(process.env.LIMIT ?? 0); // 0 = all rows

const esc = (v) =>
  v == null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

const raw = execSync(
  `npx wrangler d1 execute tvnightly ${TARGET} --json --command "SELECT kind, ref, title, slug, region, service, change, detected_at FROM provider_events ORDER BY detected_at DESC${LIMIT > 0 ? ` LIMIT ${LIMIT}` : ""}"`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const jsonStart = raw.indexOf("[");
if (jsonStart < 0) throw new Error("wrangler d1 execute returned no JSON");
const rows = JSON.parse(raw.slice(jsonStart))[0].results;
console.log(`fetched ${rows.length} provider_events from ${TARGET === "--remote" ? "production" : "local"}`);

const lines = [
  "-- provider_events: streaming catalog shuffle (/whats-new)",
  "DELETE FROM provider_events;",
  ...rows.map(
    (r) =>
      `INSERT INTO provider_events (kind, ref, title, slug, region, service, change, detected_at) VALUES (${esc(r.kind)}, ${esc(r.ref)}, ${esc(r.title)}, ${esc(r.slug)}, ${esc(r.region)}, ${esc(r.service)}, ${esc(r.change)}, ${esc(r.detected_at)});`,
  ),
];

mkdirSync("seed", { recursive: true });
const out = "seed/provider-events.sql";
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}`);
