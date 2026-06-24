-- Per-server Clerk OAuth client provisioning (hosted OIDC federation).
--
-- The "most secure" auth posture (see ../docs/hosted-oidc-design.md sec 3):
-- each paired server gets its OWN dedicated Clerk OAuth client, so a leaked
-- client secret is contained to one server and unlinking a server revokes only
-- that client. The control plane provisions the client at pairing (Clerk
-- Backend API POST /v1/oauth_applications) and the HS server configures its ABS
-- to trust that client as its OIDC provider.
--
-- We record the Clerk application id (for rotate/revoke) and the client_id
-- (public). The client_secret is returned by Clerk only once at create; the HS
-- server needs it to write ABS auth-settings, so we hold it here until that
-- server has consumed it, then it can be cleared. It is per-server scoped and
-- revocable (delete the Clerk app), never a central honeypot of ABS passwords.

CREATE TABLE IF NOT EXISTS oauth_clients (
  server_id            TEXT PRIMARY KEY,
  -- Clerk's OAuth application id (oauthapp_...), used to rotate/delete.
  clerk_app_id         TEXT NOT NULL,
  -- The OAuth client_id ABS is configured with (public).
  client_id            TEXT NOT NULL,
  -- The OAuth client_secret. Returned once by Clerk on create; held so the HS
  -- server can pull it to write ABS auth-settings. Cleared (set NULL) once the
  -- server confirms it has applied the config. Per-server, revocable.
  client_secret        TEXT,
  -- The single redirect URI allowlisted on the Clerk client (this server's
  -- ABS callback). Pinned at create; one exact URL, no wildcards.
  redirect_uri         TEXT NOT NULL,
  -- Whether the HS server has fetched + applied this config to ABS.
  applied_at           INTEGER,
  created_at           INTEGER NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
