-- Social attribution for sign-ups: which /r/ short-link post drove each email.
-- Set from the tvn_ref cookie (routes/go) at subscribe time so
-- /admin/studio/insights can show subscribes-per-campaign (the real conversion
-- metric), not just clicks. NULL = organic / direct / pre-attribution signups.
ALTER TABLE subscriptions ADD COLUMN ref_source TEXT;
ALTER TABLE subscriptions ADD COLUMN ref_campaign TEXT;
