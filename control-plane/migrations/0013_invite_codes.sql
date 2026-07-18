-- Short, human-enterable invite codes + expiry, and the end of Clerk invitations.
--
-- WHY THE CODE GOT SHORT: the 256-bit token only ever traveled inside a link, so
-- an invitee who couldn't open the email (wrong device, lost mail, relay address)
-- had no way in. A XXXX-XXXX code can be read aloud or typed into a phone. The
-- link still carries it; the code is just also speakable.
--
-- WHAT THAT COSTS: ~40 bits instead of ~256. That is only safe because
-- redemption is guarded - /invite/accept rate-limits per IP and codes expire
-- (INVITE_TTL_MS, 14 days). Do not extend the TTL or drop the limiter without
-- lengthening the code.
--
-- WHY CLERK INVITATIONS ARE GONE: they no longer did anything. Clerk sign-up is
-- open (no restricted mode), so the invitation never gated access; its
-- public_metadata was written and never read; and once we stopped emailing them
-- (notify: false) its redirect_url was dead too. The HearthShelf invite row is
-- and was the actual mechanism.

-- Existing tokens are long base64url strings, not codes, and there is no way to
-- shorten one in place. Expire them rather than leave unredeemable rows around:
-- admins re-invite, which mints a proper code.
UPDATE pending_invites SET status = 'revoked' WHERE status = 'pending';

ALTER TABLE pending_invites ADD COLUMN expires_at INTEGER;

-- D1 supports DROP COLUMN; the id is unused now that we create no invitations.
ALTER TABLE pending_invites DROP COLUMN clerk_invitation_id;

-- Admin lists filter to live invites; keep that lookup indexed alongside expiry.
CREATE INDEX IF NOT EXISTS idx_invites_server_status ON pending_invites (server_id, status);

-- Failed-redemption counter backing the brute-force limit on /invite/accept.
-- Durable rather than in-isolate: a warm-isolate map only dampens one isolate,
-- which is not enough when the secret is a ~40-bit code. Keyed by clerk user id
-- (the endpoint requires a session) within a rolling window bucket.
CREATE TABLE IF NOT EXISTS invite_attempts (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
