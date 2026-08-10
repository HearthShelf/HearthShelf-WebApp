-- Third-party app connections: the GitHub-Apps-shaped framework for letting ANY
-- application reach a user's HearthShelf server(s).
--
-- THE MODEL IN ONE PARAGRAPH. Apps are split by WHERE THEY RUN, not by who wrote
-- them. An 'instance' app is deployed once per user (Audplexus, a Home Assistant
-- integration, a personal script): it registers itself, holds its own credential,
-- and can only ever be authorized by the account running it. A 'cloud' app is one
-- deployment serving many users: it registers once and is reviewed before anyone
-- else can connect it, because one compromised credential there is a fleet-wide
-- incident. That split is the security boundary - see apps.owner_clerk_user_id.
--
-- WHAT LIVES HERE AND WHAT DOES NOT. The control plane owns only the
-- INTRODUCTION: the user code, the consent, and which servers were approved.
-- Everything after - access tokens, refresh, revocation, rate limiting - lives on
-- the box, because the box is the resource server and the only party that can
-- enforce a decision at the moment of use. That is why there is NO refresh-token
-- column anywhere in this file. Putting one here would quietly move the steady
-- state back into the cloud and make revocation bounded-by-TTL again.

-- Registered applications.
CREATE TABLE IF NOT EXISTS apps (
  app_id        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- Hash of the client secret. The plaintext is returned exactly once at
  -- registration (and on rotate) and never stored - same discipline as
  -- servers.server_secret_hash.
  secret_hash   TEXT NOT NULL,
  -- 'instance' | 'cloud'. See the header. This is not cosmetic: it decides
  -- whether the app may be store-listed and who is allowed to authorize it.
  kind          TEXT NOT NULL DEFAULT 'instance',
  -- Software family for self-registering instance apps, e.g. 'audplexus'. Used
  -- for consent copy ("your instance of Audplexus") and for grouping in the UI.
  -- It confers NO trust and must never be treated as identity: anything can
  -- claim any family. Safe precisely because an instance app can only be
  -- authorized by the account running it. NULL for one-off dev-console apps.
  family        TEXT,
  homepage_url  TEXT,
  -- Space-delimited scope list the app intends to request (OAuth wire format).
  -- Validated against the core scope set at registration; unknown scopes are
  -- rejected naming the offender rather than silently dropped.
  requested_scopes TEXT NOT NULL DEFAULT '',
  -- For an instance app: the account that RUNS it, and therefore the only
  -- account permitted to authorize it. For a cloud app: its developer.
  --
  -- THIS COLUMN IS THE SECURITY BOUNDARY. Someone registering an app called
  -- "Audplexus" and phishing a code out of a stranger fails here, before any
  -- consent screen renders, because the victim is not the owner. A control that
  -- refuses the request beats one that shows a warning nobody reads.
  owner_clerk_user_id TEXT NOT NULL,
  -- 'unlisted' | 'pending' | 'listed'. Instance apps are permanently 'unlisted'
  -- and may not be submitted - there is nothing to list (it is software, not a
  -- service), and a listed instance app would imply a shared secret baked into a
  -- public binary, which is exactly what the instance/cloud split prevents.
  listing_status TEXT NOT NULL DEFAULT 'unlisted',
  -- Why a submission was rejected, shown back to the developer.
  review_reason TEXT,
  reviewed_by   TEXT,
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL
);

-- The dev console lists an owner's apps; the store lists approved cloud apps.
CREATE INDEX IF NOT EXISTS idx_apps_owner ON apps (owner_clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_apps_listing ON apps (listing_status);

-- In-flight device-authorization requests (RFC 8628).
--
-- Short-lived by construction: a row is consumed on approval and swept after
-- expiry. The user_code is what a human types, so it is deliberately short and
-- therefore MUST stay expiring + single-use + attempt-limited; none of those
-- three guards can be dropped independently of lengthening the code.
CREATE TABLE IF NOT EXISTS app_device_codes (
  -- What the app polls with. High-entropy, so it is the PK and looked up by value.
  device_code   TEXT PRIMARY KEY,
  -- What the human types at app.hearthshelf.com/connect. 8 chars, base-20
  -- consonant alphabet per RFC 8628's own advice (no vowels = no accidental
  -- words, no 0/O/1/I confusion).
  user_code     TEXT NOT NULL UNIQUE,
  app_id        TEXT NOT NULL,
  -- Scopes this request asked for. Re-validated at approval - never trust that
  -- the row still matches what the app is registered for.
  scopes        TEXT NOT NULL DEFAULT '',
  -- 'pending' | 'approved' | 'denied'. Terminal states are read once by the
  -- app's next poll and then the row is spent.
  status        TEXT NOT NULL DEFAULT 'pending',
  -- Who approved it (NULL until then).
  clerk_user_id TEXT,
  -- Comma-separated server ids the user selected. Approving with none selected
  -- is refused: an authorization that reaches nothing is a false confirmation.
  server_ids    TEXT,
  expires_at    INTEGER NOT NULL,
  -- Last poll, for enforcing the RFC 8628 interval. A poller that ignores the
  -- interval gets `slow_down` rather than being served.
  last_polled_at INTEGER,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(app_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON app_device_codes (expires_at);

-- Installations: WHICH APP IS CONNECTED FOR WHICH USER.
--
-- READ THIS BEFORE TRUSTING A ROW. This table is a MIRROR, not the authority.
-- The box issues and revokes the app's real credential, so it is the source of
-- truth for whether a connection is live. This exists so the connections page can
-- show everything a user has connected ACROSS servers in one list without
-- fanning out to every box - and so that list still renders when a box is
-- unreachable.
--
-- Where the two disagree, the box wins. A revoke initiated here must be FORWARDED
-- to the box and must not be reported as done if it could not be delivered:
-- showing a user "revoked" when the app still works is worse than showing an
-- error.
CREATE TABLE IF NOT EXISTS app_installations (
  id            TEXT PRIMARY KEY,
  app_id        TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  -- Scopes the user actually approved (may be narrower than requested_scopes).
  scopes        TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  -- Last time we saw evidence this connection was alive. Mirror-quality data:
  -- the box has the real last-used.
  last_seen_at  INTEGER,
  FOREIGN KEY (app_id) REFERENCES apps(app_id) ON DELETE CASCADE
);

-- One row per server an installation reaches. Separate table (not a comma list)
-- because withdrawing a SINGLE server from a multi-server app has to be a real
-- operation - a user revoking one library should not have to disconnect the app
-- from the others.
CREATE TABLE IF NOT EXISTS app_installation_servers (
  installation_id TEXT NOT NULL,
  server_id       TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (installation_id, server_id),
  FOREIGN KEY (installation_id) REFERENCES app_installations(id) ON DELETE CASCADE,
  -- Unlinking a server must not leave app authorizations pointing at it. The
  -- cascade is half the guarantee; routes/servers.ts also notifies the box, since
  -- the box holds the credential that actually needs revoking.
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_installs_user ON app_installations (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_app_install_servers_server
  ON app_installation_servers (server_id);

-- Rate-limit budget for app creation, keyed by account.
--
-- Open registration is safe because registering mints an IDENTITY, not an
-- authorization - but mass-registering plausible names ("Audplexus", "Hardcover")
-- should still not be free, so name-squatting has a cost even though it cannot
-- reach a stranger's library.
CREATE TABLE IF NOT EXISTS app_registration_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- clerk_user_id for a console registration, or 'family:<name>|<ip>' for an
  -- unauthenticated instance self-registration.
  actor         TEXT NOT NULL,
  at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_reg_attempts ON app_registration_attempts (actor, at DESC);
