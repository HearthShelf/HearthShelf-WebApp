-- MyHS user-level preferences, keyed by the Clerk user id.
--
-- There is no dedicated users table in the control plane - user state has always
-- hung off the links table (one row per user-server pair). But "which server do
-- I land on" is a property of the USER, not of any one link, so it gets its own
-- one-row-per-user table. Modeling it as a single default_server_id scalar (not
-- a boolean flag on each link) keeps "exactly one default" true by construction:
-- there's nothing to clear-then-set and no race between concurrent link writes.
--
-- This is the home for future MyHS-account-level preferences too (anything that
-- spans a user's servers rather than living on one bookshelf).
CREATE TABLE IF NOT EXISTS user_prefs (
  clerk_user_id     TEXT PRIMARY KEY,
  -- The server_id the user chose to land on across their devices. NULL = no
  -- choice yet (a fresh device shows the picker). Not a foreign key: if the
  -- referenced link is later forgotten we clear this column in the same action,
  -- but a dangling id must resolve to "no default" gracefully rather than error.
  default_server_id TEXT,
  updated_at        INTEGER NOT NULL
);
