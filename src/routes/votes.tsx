import { Hono } from "hono";
import { raw } from "hono/html";
import { Bindings } from "../types";
import { ipHash } from "../lib/crypto";

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
  const exists = await db.prepare("SELECT 1 AS x FROM episodes WHERE id = ?").bind(episodeId).first();
  if (!exists) return c.json({ error: "not found" }, 404);

  // One vote per (HMAC-hashed IP, episode); raw IPs never touch the database.
  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
  const dup = await db
    .prepare("SELECT 1 AS x FROM vote_log WHERE ip_hash = ? AND episode_id = ?")
    .bind(hash, episodeId)
    .first();
  if (!dup) {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO vote_log (ip_hash, episode_id, created_at) VALUES (?,?,unixepoch())",
        )
        .bind(hash, episodeId),
      db
        .prepare(
          `INSERT INTO episode_votes (episode_id, up, down) VALUES (?,?,?)
           ON CONFLICT(episode_id) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`,
        )
        .bind(episodeId, dir === "up" ? 1 : 0, dir === "down" ? 1 : 0),
    ]);
  }
  const counts = await db
    .prepare("SELECT up, down FROM episode_votes WHERE episode_id = ?")
    .bind(episodeId)
    .first<{ up: number; down: number }>();
  return c.json({ up: counts?.up ?? 0, down: counts?.down ?? 0, deduped: !!dup });
});

export default app;
