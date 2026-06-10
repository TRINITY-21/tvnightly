-- "New on / just left [service]": the provider patrol re-checks titles on a
-- rotation, diffs against our stored snapshot, and logs every change here.
CREATE TABLE IF NOT EXISTS provider_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- 'movie' | 'tv'
  ref TEXT NOT NULL,               -- movies.imdb_id / shows.id (as text)
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  region TEXT NOT NULL,            -- ISO country code
  service TEXT NOT NULL,           -- provider name
  change TEXT NOT NULL,            -- 'added' | 'removed'
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_events_region ON provider_events(region, detected_at DESC);

-- Patrol bookkeeping: TMDB id for the TV bridge, and per-title check rotation.
ALTER TABLE shows ADD COLUMN tmdb_id INTEGER;
ALTER TABLE shows ADD COLUMN providers_checked_at INTEGER;
ALTER TABLE movies ADD COLUMN providers_checked_at INTEGER;
