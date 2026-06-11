-- Cast for show pages: top-billed names/characters/headshots from the same
-- TVmaze call the sync already makes (embed[]=cast). JSON array of
-- {n: name, c: character, img: headshot-url}.
ALTER TABLE shows ADD COLUMN cast_json TEXT;
