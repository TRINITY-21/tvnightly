-- Premium /recommend flow: rate-a-deck adds a 4th, strongly-negative verdict
-- ("Awful") that the old 3-column aggregate couldn't hold, plus an anonymous
-- taste profile keyed by the same HMAC-hashed IP we already use for rate_log.
-- Founder rule (PLAN.md §2, do-not-re-litigate): no accounts, no client-side
-- user data, no PII. No name is ever collected; gender/age are coarse, optional,
-- anonymous signals; services power the "can I actually stream this?" filter.

ALTER TABLE title_ratings ADD COLUMN awful INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS taste_profiles (
  ip_hash    TEXT PRIMARY KEY,   -- same hash as rate_log; never a raw IP, never a name
  gender     TEXT,               -- 'female' | 'male' | 'nonbinary' | NULL (skipped)
  age_bucket TEXT,               -- e.g. 'u18','18-24','25-34','35-44','45-54','55+' | NULL
  services   TEXT,               -- JSON array of provider brand names the visitor has
  region     TEXT,               -- 2-letter region used to read their providers
  updated_at INTEGER NOT NULL
);
