-- HearthShelf control plane schema (D1 / SQLite).
--
-- The control plane links a Clerk identity to the self-hosted HearthShelf
-- servers that identity may reach, runs the pairing-code exchange that
-- establishes those links, and remembers which servers exist so it can mint
-- short-lived signed grant assertions for them. It never stores ABS
-- credentials and is never in the data path (see ../ARCHITECTURE.md).

-- A self-hosted HearthShelf server that has paired with the control plane.
-- `server_id` is the HS instance's own stable UUID (its server_identity), the
-- same value HS reports - we adopt it rather than minting our own so both
-- sides agree on server identity. `public_url` is the gateway URL the browser
-- connects to directly (never the internal ABS).
CREATE TABLE IF NOT EXISTS servers (
  server_id    TEXT PRIMARY KEY,
  public_url   TEXT NOT NULL,
  name         TEXT,
  -- Set once at pairing: the secret the HS server uses to authenticate itself
  -- to the control plane on subsequent calls (e.g. requesting grants). Opaque,
  -- hashed at rest.
  server_secret_hash TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- The link between a Clerk user and a server: this user may obtain grants for
-- this server. Created when a user redeems a pairing code; deleting the row
-- revokes access (next grant request fails; existing short-TTL grants expire).
CREATE TABLE IF NOT EXISTS links (
  id              TEXT PRIMARY KEY,           -- uuid
  clerk_user_id   TEXT NOT NULL,
  server_id       TEXT NOT NULL,
  -- Verified email at link time. The grant carries this; HS matches the ABS
  -- user by it. Stored so we can re-mint without re-reading Clerk every time,
  -- and to detect email changes.
  email           TEXT NOT NULL,
  -- Role hint surfaced in the picker UI ('admin' | 'user'); not authoritative.
  role            TEXT NOT NULL DEFAULT 'user',
  display_name    TEXT,                       -- user's label for this server
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  UNIQUE (clerk_user_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_links_user ON links (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_links_server ON links (server_id);

-- Pairing codes bridge "HS server initiates" and "user redeems on app.hs.com".
--
-- Flow: an HS server (during setup) asks the control plane to start pairing.
-- The control plane records a short-lived code carrying that server's details
-- and returns it (HS shows it to the admin). The signed-in user enters the
-- code on app.hs.com; redeeming it upserts the server and creates the link.
-- One-time use.
--
-- No FK to servers: a pairing code is written BEFORE the server row exists (the
-- server row is materialised on redeem), so the code carries its own copy of
-- the server's identity, URL, name, and secret hash.
CREATE TABLE IF NOT EXISTS pairing_codes (
  code          TEXT PRIMARY KEY,            -- short, human-enterable
  server_id     TEXT NOT NULL,
  public_url    TEXT NOT NULL,
  name          TEXT,
  -- The server_secret (hashed) to persist onto the server row on redeem.
  server_secret_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  redeemed_at   INTEGER,                      -- null until used; one-time
  redeemed_by   TEXT                          -- clerk_user_id that redeemed
);

CREATE INDEX IF NOT EXISTS idx_pairing_expires ON pairing_codes (expires_at);

-- The control plane's signing keypair(s). The PRIVATE key normally lives in a
-- Worker secret (CP_SIGNING_JWK); this table exists so we can support key
-- ROTATION - publish multiple public keys via JWKS (by kid) while only the
-- current one signs. Public material only; never store private keys here.
CREATE TABLE IF NOT EXISTS signing_keys (
  kid         TEXT PRIMARY KEY,
  public_jwk  TEXT NOT NULL,                  -- JSON, served via JWKS
  alg         TEXT NOT NULL DEFAULT 'EdDSA',
  status      TEXT NOT NULL DEFAULT 'active', -- 'active' | 'retiring' | 'revoked'
  created_at  INTEGER NOT NULL
);
