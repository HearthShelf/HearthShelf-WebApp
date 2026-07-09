-- Token-based invite acceptance.
--
-- Email-matched acceptance breaks when the invitee signs in with a provider
-- that hides their address (Sign in with Apple "Hide My Email" hands us a
-- @privaterelay.appleid.com relay, which never equals the invited email). The
-- token is an opaque bearer capability carried in the invite link
-- (/invite?token=...): whoever follows the link and authenticates gets the
-- server linked, independent of what email their account carries.
--
-- Email matching (acceptPendingInvites) is kept as a fallback for accounts
-- whose verified email does match, so existing invites keep working.
ALTER TABLE pending_invites ADD COLUMN token TEXT;

-- One invite per token. Partial-safe: existing rows have NULL token (skipped by
-- SQLite's UNIQUE, which allows multiple NULLs), and are still accepted via the
-- email path until re-invited.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token ON pending_invites (token);
