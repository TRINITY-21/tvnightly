-- Server-side click log for the /r/<src>/<path> social short links, so the
-- studio can show which platform / campaign / page actually drives traffic.
-- Cloudflare Web Analytics is aggregate + cookieless and can't break clicks
-- down by utm_campaign, so the redirect (routes/go) records each human click
-- here. Crawlers are intercepted upstream and never hit /r/, so this is clean
-- human-click data. One row per click; aggregated in /admin/studio/insights.
CREATE TABLE IF NOT EXISTS link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,       -- utm_source (tiktok, instagram, x, pinterest, ...)
  campaign TEXT NOT NULL,     -- utm_campaign (e.g. trending-show-severance)
  path TEXT NOT NULL,         -- destination path, no query (e.g. /show/severance/best-episodes)
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_link_clicks_created ON link_clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_link_clicks_source ON link_clicks(source, created_at);
CREATE INDEX IF NOT EXISTS idx_link_clicks_campaign ON link_clicks(campaign, created_at);
