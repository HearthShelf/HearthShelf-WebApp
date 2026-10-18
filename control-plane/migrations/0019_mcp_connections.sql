-- AI assistant connections: one row per MCP client a user has connected
-- (Claude, and any other client that speaks MCP to mcp.hearthshelf.com).
--
-- WHY THIS EXISTS. An MCP tool call happens long after the browser that approved
-- it is gone, so the MCP Worker needs its own way to act as the user against
-- this control plane. It used to carry the user's browser session token, which
-- expires within days, and every connection then broke with no way for the AI
-- client to notice. This table holds a credential that lives until the user
-- disconnects it.
--
-- WHAT IT CAN DO, AND NOTHING MORE. A connection credential is accepted ONLY by
-- the /mcp/* routes: list this user's servers, and mint a short-TTL grant for one
-- of them. It cannot link or unlink servers, invite people, change settings or
-- delete the account. It is deliberately not accepted by verifyIdentity, which
-- would hand it everything a session can do.
--
-- Not the same thing as app_installations (0016). Third-party apps hold their own
-- credential on each box; this is HearthShelf's own MCP Worker acting through the
-- control plane exactly as the SPA does, so the credential lives here.
CREATE TABLE IF NOT EXISTS mcp_connections (
  id            TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  -- SHA-256 of the credential. The plaintext is returned once, to the MCP
  -- Worker, which keeps it only inside the OAuth grant's encrypted props.
  token_hash    TEXT NOT NULL UNIQUE,
  -- The AI client's self-reported name (e.g. "Claude"). Display only: it comes
  -- from dynamic client registration and is attacker-controllable, so it confers
  -- no trust and must be rendered as text.
  client_name   TEXT,
  -- Captured at approval for the grant's `username` claim, since no session is
  -- around to supply it later.
  username      TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mcp_connections_user ON mcp_connections (clerk_user_id);
