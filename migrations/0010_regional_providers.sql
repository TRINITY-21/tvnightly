-- Regional where-to-watch: per-country flatrate providers (JSON object keyed
-- by ISO country code, e.g. {"US":["Netflix"],"IN":["JioHotstar"]}). Same
-- TMDB/JustWatch response we already fetch — previously we kept only US.
ALTER TABLE movies ADD COLUMN providers_intl TEXT;
