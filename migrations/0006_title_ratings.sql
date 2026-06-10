-- "Rate what you watched -> get a pick": anonymous aggregate verdicts.
-- Founder rule: user data lives in OUR database only — never localStorage.
-- ref = shows.id (as text) for kind='tv', movies.imdb_id for kind='movie'.
CREATE TABLE IF NOT EXISTS title_ratings (
  kind TEXT NOT NULL CHECK (kind IN ('tv','movie')),
  ref TEXT NOT NULL,
  loved INTEGER NOT NULL DEFAULT 0,
  liked INTEGER NOT NULL DEFAULT 0,
  meh INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, ref)
);

-- One verdict per (hashed IP, title). IPs are HMAC-hashed — never stored raw.
CREATE TABLE IF NOT EXISTS rate_log (
  ip_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, kind, ref)
);
