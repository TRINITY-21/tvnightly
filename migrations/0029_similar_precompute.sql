-- Precompute cache for the genre-overlap "similar titles" query — the single
-- biggest remaining D1 rows-read family (~2.37B/day). similarShows scans the
-- weight>=75 pool and similarMovies scans all movies, computing `genres LIKE`
-- overlap on EVERY show/movie page render (bot-crawled). That scan can't be
-- indexed, but its result is deterministic per source and changes only when the
-- catalog does — so we run it once, store the top-N, and serve every later read
-- (incl. bot crawls) as a cheap indexed lookup. Self-populating on first visit,
-- self-healing after a TTL. Separate tables so the id types match their source
-- (shows.id INTEGER, movies.imdb_id TEXT) and the JOIN stays index-friendly.

CREATE TABLE IF NOT EXISTS similar_shows (
  source_id   INTEGER NOT NULL,   -- shows.id
  target_id   INTEGER NOT NULL,   -- shows.id of a match
  seq         INTEGER NOT NULL,   -- 0-based rank (ov DESC, weight DESC)
  computed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (source_id, seq)     -- covers WHERE source_id=? ORDER BY seq
);

CREATE TABLE IF NOT EXISTS similar_movies (
  source_id   TEXT NOT NULL,      -- movies.imdb_id
  target_id   TEXT NOT NULL,      -- movies.imdb_id of a match
  seq         INTEGER NOT NULL,   -- 0-based rank (ov DESC, rating DESC, popularity DESC)
  computed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (source_id, seq)
);
