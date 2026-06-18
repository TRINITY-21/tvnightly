-- Materialize-on-write (hybrid catalog): a lightweight snapshot of a live-TMDB
-- title, written the first time it earns a community verdict (ref "t<tmdbId>").
-- Lets community/ranking lists render the engaged title straight from D1 — no
-- TMDB call per row. The catalog stays TMDB's; this is just the engaged subset
-- we attach our own data to. title_ratings/rate_log already key by (kind, ref).
CREATE TABLE IF NOT EXISTS title_snapshots (
  kind TEXT NOT NULL CHECK (kind IN ('tv','movie')),
  ref TEXT NOT NULL,          -- the title_ratings ref, e.g. 't76479'
  tmdb_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  year TEXT,
  poster_url TEXT,            -- TMDB w342 one-sheet
  slug TEXT NOT NULL,
  rating REAL,                -- TMDB vote average at snapshot time
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, ref)
);
