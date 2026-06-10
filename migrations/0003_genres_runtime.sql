-- Picker filters need genre + typical episode runtime.
-- genres is a JSON string array as returned by TVmaze, e.g. ["Drama","Crime"].
ALTER TABLE shows ADD COLUMN genres TEXT;
ALTER TABLE shows ADD COLUMN runtime INTEGER;
