-- hs.direct per-server certificate status (control-plane bookkeeping only).
--
-- The control plane does NOT run ACME and never holds a TLS private key (see
-- ../docs/hs-direct-implementation.md sec 1.2). This table records only the
-- *status* of a server's hs.direct wildcard cert so the picker / admin UI can
-- show "cert provisioned / expiring / failed", and so we can tell when a server
-- last successfully obtained or renewed via the VPS broker.
--
-- The cert itself and its private key live on the HS box; the issuance is run by
-- the VPS broker. We store no key material here.

CREATE TABLE IF NOT EXISTS server_certs (
  server_id     TEXT PRIMARY KEY,
  -- The stable <hash> label (first 32 hex of sha256(server_id)); <hash>.<zone>
  -- is the canonical host the cert wildcard covers and the OIDC redirect pins.
  hash          TEXT NOT NULL,
  -- Lifecycle: 'pending' (grant minted, not yet confirmed), 'active' (server
  -- reported a successful issue/renew), 'failed' (server reported an error).
  status        TEXT NOT NULL DEFAULT 'pending',
  -- ACME environment the cert was issued against: 'staging' | 'production'.
  acme_env      TEXT,
  -- Unix ms: when the server last confirmed a successful issue/renew, and the
  -- cert's notAfter (so we can flag upcoming expiry without holding the cert).
  last_issued_at INTEGER,
  not_after      INTEGER,
  -- Last error detail the server reported, if status='failed'.
  last_error     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
