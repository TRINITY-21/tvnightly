-- D1 cost fix (part 2): the site-wide sidebar (fetchSiteSidebar) runs on EVERY
-- HTML page and is not cached. Its "top shows / top movies" queries ordered by
-- rating with no matching composite index, so each page read the whole
-- rating-not-null subset (≈5,061 shows + ≈4,007 movies) and temp-sorted it.
-- Composite rating-first indexes make them LIMIT-10 index walks (~10 rows each).
CREATE INDEX IF NOT EXISTS idx_shows_rating_weight ON shows(rating DESC, weight DESC) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movies_rating_votes ON movies(rating DESC, votes DESC) WHERE rating IS NOT NULL;
