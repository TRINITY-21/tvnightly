-- TVmaze show classification: Scripted, Animation, Reality, Talk Show, News,
-- Sports, Variety, Game Show, Award Show, Panel Show, Documentary. Lets the
-- homepage marquee (hero / tonight / premieres) surface real series & films and
-- leave live-broadcast filler (talk shows, news, reality) out. Backfilled by
-- scripts/backfill-show-type.mjs; new seeds set it inline (seed.mjs).
ALTER TABLE shows ADD COLUMN type TEXT;
