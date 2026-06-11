-- Person-page depth from TMDB (bio, birthplace, links) + movie credits
-- matched against our own movie mirror. Filled by
-- scripts/backfill-people-tmdb.mjs; the hourly sync preserves these columns.
ALTER TABLE people ADD COLUMN bio TEXT;
ALTER TABLE people ADD COLUMN birthplace TEXT;
ALTER TABLE people ADD COLUMN known_dept TEXT;
ALTER TABLE people ADD COLUMN tmdb_id INTEGER;
ALTER TABLE people ADD COLUMN imdb_id TEXT;
ALTER TABLE people ADD COLUMN homepage TEXT;
ALTER TABLE people ADD COLUMN socials TEXT; -- JSON {ig, tw}

CREATE TABLE IF NOT EXISTS movie_credits (
  person_id INTEGER NOT NULL,
  movie_id TEXT NOT NULL, -- movies.imdb_id
  character TEXT,
  PRIMARY KEY (person_id, movie_id)
);
CREATE INDEX IF NOT EXISTS idx_movie_credits_person ON movie_credits(person_id);
