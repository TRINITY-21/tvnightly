-- US streaming providers per movie (JSON array of names, e.g. ["Netflix"]),
-- from TMDB's watch-providers (JustWatch-sourced; attribution in footer).
ALTER TABLE movies ADD COLUMN providers TEXT;
