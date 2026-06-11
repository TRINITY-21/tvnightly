-- Episode counts + guest flag on credits, from TMDB aggregate_credits
-- (TVmaze has no per-actor episode counts). Filled by
-- scripts/backfill-credits-tmdb.mjs — rerun with the monthly seeds.
ALTER TABLE credits ADD COLUMN episodes INTEGER;
ALTER TABLE credits ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;
