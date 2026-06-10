-- Reader agree/disagree voting on ranked episodes, with IP-hash dedupe.
CREATE TABLE IF NOT EXISTS episode_votes (
  episode_id INTEGER PRIMARY KEY,
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0
);

-- One vote per (hashed IP, episode). IPs are HMAC-hashed — never stored raw.
CREATE TABLE IF NOT EXISTS vote_log (
  ip_hash TEXT NOT NULL,
  episode_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, episode_id)
);

-- Dedupe for "instant classic" alert emails: one alert per episode, ever.
CREATE TABLE IF NOT EXISTS episode_alerts (
  episode_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
