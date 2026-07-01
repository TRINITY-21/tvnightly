-- Enrich each /r/ click so Insights can separate real humans from the automated
-- traffic every fresh link attracts — URL-safety scanners, AV/corporate proxies,
-- headless agents. The original link_clicks (0025) only had source/campaign/path/
-- created_at, which literally cannot tell a person from a scraper. These columns
-- add the user-agent, referer, and Cloudflare edge geo/network + a computed
-- is_bot flag (see src/lib/bots.ts). Existing rows keep is_bot=0 (unclassified —
-- they predate this) so only new clicks are judged.
ALTER TABLE link_clicks ADD COLUMN user_agent TEXT;
ALTER TABLE link_clicks ADD COLUMN referer TEXT;
ALTER TABLE link_clicks ADD COLUMN country TEXT;
ALTER TABLE link_clicks ADD COLUMN as_org TEXT;
ALTER TABLE link_clicks ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_link_clicks_bot ON link_clicks(is_bot, created_at);

-- Browser-confirmed renders: /js/beacon.js fires this AFTER a /r/ visitor's page
-- actually paints and the tab stays ~1s. A row here is the strongest cookieless
-- proof of a real human — scanners hit the 302 and stop; they don't execute JS
-- on the landing page a second later. clicks → renders → sign-ups is the funnel.
CREATE TABLE IF NOT EXISTS render_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,        -- utm_source (instagram, x, …) read off the landing URL
  campaign TEXT NOT NULL,      -- utm_campaign
  path TEXT NOT NULL,          -- landing pathname
  country TEXT,                -- Cloudflare edge country
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_render_created ON render_events(created_at);
CREATE INDEX IF NOT EXISTS idx_render_source ON render_events(source, created_at);
CREATE INDEX IF NOT EXISTS idx_render_campaign ON render_events(campaign, created_at);
