-- Event engine: renewals usually DON'T change TVmaze status — new-season
-- episodes just appear. One generalized event log replaces status_changes:
--   'status'           old_value -> new_value
--   'season_announced' season (new_value = season number)
--   'premiere_set'     season, new_value = premiere date
--   'premiere_moved'   season, old_value -> new_value (dates)
CREATE TABLE IF NOT EXISTS show_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id),
  type TEXT NOT NULL,
  season INTEGER,
  old_value TEXT,
  new_value TEXT,
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_show_events_detected ON show_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_show_events_show ON show_events(show_id, detected_at DESC);

INSERT INTO show_events (show_id, type, old_value, new_value, detected_at)
  SELECT show_id, 'status', old_status, new_status, detected_at FROM status_changes;
DROP TABLE status_changes;
