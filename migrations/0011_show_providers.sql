-- Regional streaming providers for TV shows (same shape as movies:
-- JSON object keyed by country code). Filled by scripts/seed-show-providers.mjs
-- via the TVmaze->TMDB external-id bridge.
ALTER TABLE shows ADD COLUMN providers_intl TEXT;
