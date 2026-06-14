-- Negative signal: a true "Awful" verdict, distinct from "meh". Lets the
-- recommender DEMOTE a disliked title's genres/era even amid positives,
-- instead of only inferring dislike when every rating is meh.
-- rate_log.verdict is free-text and already accepts 'awful' (no change there).
ALTER TABLE title_ratings ADD COLUMN awful INTEGER NOT NULL DEFAULT 0;
