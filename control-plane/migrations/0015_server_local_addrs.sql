-- LAN reachability: an additional, private-network address for a server, plus
-- the server's own identity public key used to authenticate that address.
--
-- WHY A SEPARATE TABLE, NOT COLUMNS ON `servers`
--
-- The control plane FETCHES server URLs (probeServer hits <origin>/healthcheck to
-- show live status in the picker). Every such fetch is guarded against being
-- steered at private space - see privateIpInSynthesizedHost() in
-- lib/reachability.ts, which can refuse a private target WITHOUT resolving DNS
-- precisely because hs.direct encodes the IP in the hostname.
--
-- A `local_url` column on `servers` would put a REQUIRED-to-be-private address on
-- the same row as the fetchable `public_url`. Any present or future code path
-- doing `SELECT * FROM servers` and probing "the url" would then reach into the
-- customer's LAN from our Worker - textbook SSRF, introduced by accident by a
-- maintainer who had no reason to know the distinction. Keeping it in its own
-- table means the fetchable row type never gains a field that looks fetchable.
--
-- The Worker never fetches anything in this table. It is opaque data forwarded to
-- authenticated clients, which do the reaching themselves, on their own network.
CREATE TABLE IF NOT EXISTS server_local_addrs (
  server_id     TEXT PRIMARY KEY,
  -- A private/link-local origin (e.g. http://192.168.1.50:8080). Plain http is
  -- expected: a private IP cannot carry a CA-valid cert. Validated on write by
  -- validateLocalUrl(), which REQUIRES a private host - the inverse of
  -- validatePublicUrl(), so neither can be used to smuggle the other's shape.
  local_url     TEXT NOT NULL,
  -- Ed25519 public key (base64 SPKI DER) the server proves possession of before a
  -- client will present a grant to any address here. Without this the LAN address
  -- is unusable: a private IP is spoofable by any device on the network, and a
  -- grant is a bearer credential. See server/lib/serverIdentity.js in HearthShelf.
  identity_key  TEXT,
  reported_at   INTEGER NOT NULL,
  -- Cheap abuse signal: a server_secret holder rewriting this constantly is
  -- either misconfigured or probing. Surfaced to admin, and rate-limited on write.
  report_count  INTEGER NOT NULL DEFAULT 1
);

-- Audit trail for local-address writes. This endpoint accepts a private address
-- from a server_secret holder, which is the input to the LAN trust path, so it
-- gets its own log rather than sharing the general one.
CREATE TABLE IF NOT EXISTS server_local_addr_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id   TEXT NOT NULL,
  local_url   TEXT,
  outcome     TEXT NOT NULL,  -- 'accepted' | 'rejected' | 'rate_limited'
  reason      TEXT,
  at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_addr_audit_server
  ON server_local_addr_audit (server_id, at DESC);
