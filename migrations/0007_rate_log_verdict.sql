-- Collaborative filtering foundation: store WHICH verdict each hashed IP gave,
-- so "raters who loved X also loved Y" becomes a self-join on rate_log.
-- Existing rows stay NULL (pre-CF ratings can't contribute pair signals).
ALTER TABLE rate_log ADD COLUMN verdict TEXT;
CREATE INDEX IF NOT EXISTS idx_rate_log_title ON rate_log(kind, ref, verdict);
