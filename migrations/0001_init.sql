CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY,          -- TVmaze id
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT,                     -- Running | Ended | To Be Determined | In Development
  premiered TEXT,
  ended TEXT,
  network TEXT,
  web_channel TEXT,
  rating REAL,
  weight INTEGER DEFAULT 0,        -- TVmaze popularity weight
  image_url TEXT,
  summary TEXT,                    -- HTML from TVmaze
  imdb_id TEXT,
  tvdb_id INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0  -- TVmaze "updated" epoch
);
CREATE INDEX IF NOT EXISTS idx_shows_slug ON shows(slug);
CREATE INDEX IF NOT EXISTS idx_shows_status_weight ON shows(status, weight DESC);
CREATE INDEX IF NOT EXISTS idx_shows_weight ON shows(weight DESC);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY,          -- TVmaze episode id
  show_id INTEGER NOT NULL REFERENCES shows(id),
  season INTEGER,
  number INTEGER,
  name TEXT,
  airdate TEXT,                    -- YYYY-MM-DD
  airstamp TEXT,                   -- ISO 8601 with timezone
  runtime INTEGER,
  rating REAL,
  image_url TEXT,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_id, season, number);
CREATE INDEX IF NOT EXISTS idx_episodes_show_rating ON episodes(show_id, rating DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_airstamp ON episodes(airstamp);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  show_id INTEGER,                 -- NULL = global daily list
  kind TEXT NOT NULL,              -- 'renewal' | 'premiere' | 'daily'
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(email, show_id, kind)
);

CREATE TABLE IF NOT EXISTS status_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id),
  old_status TEXT,
  new_status TEXT,
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_changes_detected ON status_changes(detected_at DESC);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  shows_checked INTEGER DEFAULT 0,
  shows_updated INTEGER DEFAULT 0,
  errors TEXT
);
