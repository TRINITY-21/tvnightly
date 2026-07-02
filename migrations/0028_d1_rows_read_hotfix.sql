-- D1 rows-read hotfix. The bill is ~96% "Rows Read" — ~5B rows/day — and two
-- missing indexes cause the bulk of it via full-table scans hit on every cast /
-- crew render. Column order matches each query's equality key (neither lookup has
-- a range/ORDER tail). Only indexes that DON'T already exist are added.

-- (1) BIGGEST OFFENDER: ~391.74M rows/day. movie_credits PK is (person_id, movie_id),
-- so `WHERE mc.movie_id = ?` cannot use it (movie_id isn't the leading column) and
-- the only secondary index (idx_movie_credits_person) is on person_id — so every
-- movie-cast render scanned all ~20,006 rows. This adds the missing equality index.
-- Fixes movies.tsx:698 and movies.tsx:1487.
CREATE INDEX IF NOT EXISTS idx_movie_credits_movie ON movie_credits(movie_id);

-- (2) ~290.55M rows/day. `people` (34,485 rows) has ZERO indexes, and crewLinkMap /
-- episode.tsx match crew via `lower(name) IN (...)`, which was non-sargable → a full
-- table scan on every show, movie, person AND episode page. Index the folded name so
-- the (now split — see queries.ts / episode.tsx) name branch is an index probe.
-- NOTE: this index only serves lower(name) lookups; it does NOT help the search-box
-- folded search (that uses a 40-step REPLACE chain, a separate future fix).
CREATE INDEX IF NOT EXISTS idx_people_name_lower ON people(lower(name));

-- (3) ~30-75M rows/day. credits has only idx_credits_person, so `WHERE cr.show_id = ?`
-- (show-cast / person-page credit lookups, e.g. people.tsx:213) scanned all ~27k
-- credits rows. EXPLAIN confirms this index turns it into an index SEARCH.
CREATE INDEX IF NOT EXISTS idx_credits_show ON credits(show_id);

-- (4) ~292M rows/day. Network/streamer rails filter `WHERE (network = ? OR
-- web_channel = ?)` (show-detail-hero.ts:61, network-chart.ts:189) with no index on
-- either column → full shows scan. Indexing both lets SQLite use MULTI-INDEX OR
-- (EXPLAIN confirmed) instead of scanning all ~13.5k shows.
CREATE INDEX IF NOT EXISTS idx_shows_network ON shows(network);
CREATE INDEX IF NOT EXISTS idx_shows_web_channel ON shows(web_channel);

-- NOT ADDED (verified unnecessary):
--   * shows(weight): idx_shows_weight already exists; the similar/recommend genre-
--     overlap query already SEARCHes it. It reads the weight-subset by design to
--     score `genres LIKE` — no index can fix that. Fix via result caching/precompute.
--   * episode_votes(episode_id): episode_id is already the INTEGER PRIMARY KEY
--     (rowid), so the LEFT JOIN is already O(1) — an index would be redundant.
--   * episodes(show_id,...): idx_episodes_show / idx_episodes_show_rating already
--     cover the show-page and best/worst-episode queries (ratio 1). Leave untouched.
--   * a movies votes>=1000 partial index: idx_movies_rating_votes already serves the
--     sidebar top list (index walk) and it's edge-cached hourly. Not worth it.
