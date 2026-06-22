-- Pending invites: the bridge between "admin invites by email" and "that person
-- signs up and gets linked".
--
-- Flow: an admin (or a linked HS server) invites email E to server S with role
-- R. We create a Clerk invitation (emails them a sign-up link) and record a
-- pending invite here. On the invitee's first authenticated call, we match
-- pending invites to their VERIFIED email, materialize the link, and mark the
-- invite accepted. No webhook required.
CREATE TABLE IF NOT EXISTS pending_invites (
  id            TEXT PRIMARY KEY,            -- uuid
  email         TEXT NOT NULL,               -- normalized lowercase
  server_id     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  invited_by    TEXT,                        -- clerk_user_id of inviter, or 'server'
  clerk_invitation_id TEXT,                  -- Clerk's invitation id (for revoke)
  status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'revoked'
  created_at    INTEGER NOT NULL,
  accepted_at   INTEGER,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

-- Look up by email (acceptance check) and by server (admin lists pending).
CREATE INDEX IF NOT EXISTS idx_invites_email ON pending_invites (email, status);
CREATE INDEX IF NOT EXISTS idx_invites_server ON pending_invites (server_id);

-- One live invite per (email, server). Re-inviting updates the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_email_server ON pending_invites (email, server_id);
