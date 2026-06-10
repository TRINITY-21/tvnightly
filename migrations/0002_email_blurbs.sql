-- Editorial blurb layer (AdSense "original content" insurance on top pages)
ALTER TABLE shows ADD COLUMN blurb TEXT;

-- Outbox pattern: status changes enqueue alert emails here; the hourly cron
-- drains a budgeted batch per run (free Workers: 50 subrequests/invocation;
-- Gmail SMTP: ~500 sends/day).
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_unsent ON outbox(id) WHERE sent_at IS NULL;
