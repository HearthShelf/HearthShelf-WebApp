-- Adds the Clerk user id as a queryable column so a user's data-deletion request
-- can purge their crash reports. Before this, the reporting user id only lived
-- inside the 'detail' JSON blob (mobile crash reports), which isn't indexable
-- and can't be targeted by a bulk delete. Nullable: rows written before this
-- migration, and non-mobile sources ('vps', 'cp', 'box'), have no user.

ALTER TABLE infra_logs ADD COLUMN clerk_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_infra_logs_user ON infra_logs (clerk_user_id);
