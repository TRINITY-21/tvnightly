-- Person pages: people we can introduce properly, and which of OUR shows
-- they appear in (credits drive the "Known for" grid + internal mesh).
-- Person URLs are deterministic — slugify(name)-id — so no slug column.
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY, -- TVmaze person id
  name TEXT NOT NULL,
  birthday TEXT,
  deathday TEXT,
  country TEXT,
  image_url TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credits (
  person_id INTEGER NOT NULL,
  show_id INTEGER NOT NULL,
  character TEXT,
  voice INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, show_id)
);
CREATE INDEX IF NOT EXISTS idx_credits_person ON credits(person_id);
