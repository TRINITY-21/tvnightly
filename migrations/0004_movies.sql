-- Phase 4: movies. Dual-source mirror (Wikidata CC0 bootstrap, TMDB when a key
-- exists). IMDb id is the cross-source primary key; seeds skip films without one.
-- Upserts use ON CONFLICT(imdb_id) DO UPDATE so an unexpected slug collision
-- fails loudly instead of silently replacing a different movie.
CREATE TABLE IF NOT EXISTS movies (
  imdb_id TEXT PRIMARY KEY,        -- e.g. tt0133093
  slug TEXT UNIQUE NOT NULL,       -- title-year, e.g. the-matrix-1999
  title TEXT NOT NULL,
  year INTEGER,
  release_date TEXT,
  overview TEXT,
  genres TEXT,                     -- JSON string array
  runtime INTEGER,                 -- minutes
  rating REAL,                     -- TMDB vote_average (NULL from Wikidata)
  votes INTEGER,
  popularity REAL,                 -- source score: Wikidata sitelinks / TMDB popularity
  poster_url TEXT,
  tmdb_id INTEGER,
  wikidata_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_movies_rating ON movies(rating DESC);
