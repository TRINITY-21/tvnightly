// Render beacon — POST /e. Fired by /js/beacon.js ~1s after a page that arrived
// from a /r/ short link (utm_medium=social) actually paints. A row in
// render_events is the strongest cookieless "real human" signal we have: a
// URL-safety scanner hits the redirect and stops; it doesn't run JS on the
// landing page a second later. Insights compares clicks → renders → sign-ups.
import { Hono } from "hono";
import { HonoEnv } from "../types";
import { SRC_FROM_CODE } from "../lib/utm";
import { classifyClient, edgeSignals } from "../lib/bots";

const app = new Hono<HonoEnv>();

// keep only safe URL-ish characters (utm params + paths); drops control chars,
// quotes and whitespace so nothing can poison a later render in Insights.
const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/[^\w./:-]/g, "").slice(0, max) : "";

const SOURCE_NAMES = new Set<string>(Object.values(SRC_FROM_CODE)); // instagram, x, tiktok, …

app.post("/e", async (c) => {
  // sendBeacon posts a Blob (often application/json, sometimes text/plain).
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    return c.body(null, 204); // unparseable → drop silently, never error a beacon
  }

  // Only accept beacons that name a known platform source — this endpoint is for
  // /r/ social renders, not a general pageview firehose. Landing URLs carry the
  // full utm_source name; also tolerate the short code just in case.
  const src = clean(body.source, 20);
  const source = SOURCE_NAMES.has(src) ? src : SRC_FROM_CODE[src] ?? null;
  const campaign = clean(body.campaign, 100);
  const path = clean(body.path, 300) || "/";
  if (!source || !campaign) return c.body(null, 204);

  try {
    const db = c.env.DB;
    if (db) {
      const { country, asOrg } = edgeSignals(c.req.raw);
      const isBot = classifyClient(c.req.header("user-agent"), asOrg).isBot ? 1 : 0;
      c.executionCtx.waitUntil(
        db
          .prepare("INSERT INTO render_events (source, campaign, path, country, is_bot) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(source, campaign, path, country, isBot)
          .run()
          .catch(() => {}),
      );
    }
  } catch {
    /* no ExecutionContext / pre-migration → skip, still 204 */
  }
  return c.body(null, 204);
});

export default app;
