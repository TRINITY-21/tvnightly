import { Hono } from "hono";
import { raw } from "hono/html";
import { Bindings } from "../types";
import { ipHash } from "../lib/crypto";
import { materializeShow } from "../lib/tmdb-show";

const app = new Hono<{ Bindings: Bindings }>();

app.post("/api/vote", async (c) => {
  let body: { episodeId?: unknown; dir?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad request" }, 400);
  }
  const episodeId = Number(body.episodeId);
  const dir = body.dir === "up" ? "up" : body.dir === "down" ? "down" : null;
  if (!Number.isInteger(episodeId) || !dir) return c.json({ error: "bad request" }, 400);
  const db = c.env.DB;

  // The id we actually write against. For a mirrored show it's the episode's own
  // id; for a live-only show the widget carries a synthetic id
  // (tmdbId*100000 + season*1000 + number) — so a "not found" from a real widget
  // means "live, not saved yet": materialize the show, then map to the real row.
  let targetId = episodeId;
  let exists = await db.prepare("SELECT 1 AS x FROM episodes WHERE id = ?").bind(episodeId).first();
  if (!exists && c.env.TMDB_API_KEY) {
    const tmdbId = Math.floor(episodeId / 100000);
    const rem = episodeId % 100000;
    const season = Math.floor(rem / 1000);
    const number = rem % 1000;
    if (tmdbId > 0) {
      const showDbId = await materializeShow(c, tmdbId);
      if (showDbId) {
        const epRow = await db
          .prepare("SELECT id FROM episodes WHERE show_id = ? AND season = ? AND number = ?")
          .bind(showDbId, season, number)
          .first<{ id: number }>();
        if (epRow) {
          targetId = epRow.id;
          exists = { x: 1 };
        }
      }
    }
  }
  if (!exists) return c.json({ error: "not found" }, 404);

  // One vote per (HMAC-hashed IP, episode); raw IPs never touch the database.
  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
  const dup = await db
    .prepare("SELECT 1 AS x FROM vote_log WHERE ip_hash = ? AND episode_id = ?")
    .bind(hash, targetId)
    .first();
  if (!dup) {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO vote_log (ip_hash, episode_id, created_at) VALUES (?,?,unixepoch())",
        )
        .bind(hash, targetId),
      db
        .prepare(
          `INSERT INTO episode_votes (episode_id, up, down) VALUES (?,?,?)
           ON CONFLICT(episode_id) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`,
        )
        .bind(targetId, dir === "up" ? 1 : 0, dir === "down" ? 1 : 0),
    ]);
  }
  const counts = await db
    .prepare("SELECT up, down FROM episode_votes WHERE episode_id = ?")
    .bind(targetId)
    .first<{ up: number; down: number }>();
  return c.json({ up: counts?.up ?? 0, down: counts?.down ?? 0, deduped: !!dup });
});

export default app;
