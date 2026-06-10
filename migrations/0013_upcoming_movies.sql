-- "Upcoming movies" chart: small snapshot of TMDB's upcoming feed,
-- refreshed by the movie seed (DELETE+INSERT, same as movies).
CREATE TABLE IF NOT EXISTS upcoming_movies (
  tmdb_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  release_date TEXT,
  poster_url TEXT,
  overview TEXT
);
