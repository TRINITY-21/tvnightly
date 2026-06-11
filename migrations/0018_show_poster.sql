-- The canonical display poster: TMDB's top-voted one-sheet (w342 URL),
-- chosen once by scripts/backfill-posters.mjs so every surface renders the
-- same art. image_url (TVmaze) remains the fallback.
ALTER TABLE shows ADD COLUMN poster_url TEXT;
