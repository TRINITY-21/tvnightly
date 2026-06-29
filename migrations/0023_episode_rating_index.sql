-- D1 cost fix: several "best episodes by rating" queries (homepage greatest-
-- episode still, directory/seasonal/best-episodes rankings) ordered the 448k-row
-- episodes table by rating with no supporting index — every call was a full
-- table SCAN + temp-b-tree sort (the bulk of our D1 "rows read" bill).
-- A partial index on rating (non-null only) turns those into index walks:
-- e.g. the homepage ORDER BY rating DESC LIMIT 1 goes from ~448k rows -> ~1 row.
CREATE INDEX IF NOT EXISTS idx_episodes_rating ON episodes(rating DESC) WHERE rating IS NOT NULL;
