-- Latest-release cache + per-box reported version.
--
-- The control plane learns "what is the newest HearthShelf" from the GitHub
-- Releases API (the release workflow tags v*.*.* -> GHCR + a GitHub Release), on
-- a cron, and caches it here. The SPA reads it to decide whether a box is behind
-- and how loudly to say so. There is one row per release channel (only 'stable'
-- today; 'beta' can be added without a schema change).

CREATE TABLE IF NOT EXISTS releases (
  channel       TEXT PRIMARY KEY,             -- 'stable' (room for 'beta' later)
  version       TEXT NOT NULL,                -- normalized semver, no leading 'v'
  -- How hard to push this update. 'info' = silent (chip only), 'recommended' =
  -- soft dismissible nudge, 'security'/'critical' = sticky, non-dismissible.
  severity      TEXT NOT NULL DEFAULT 'recommended',
  notes_url     TEXT,                         -- GitHub release html_url
  published_at  INTEGER,                      -- release publish time (ms epoch)
  -- Optional hard floor: a box below this is treated as force-update (sticky
  -- banner regardless of severity). Unset = no forced updates. Admin-set lever.
  min_supported TEXT,
  -- True when a platform admin last wrote this row by hand (the /admin/releases
  -- override). The cron refresh skips overriding a pinned row's severity/floor so
  -- a manual security escalation is not silently reverted on the next poll.
  pinned        INTEGER NOT NULL DEFAULT 0,
  fetched_at    INTEGER NOT NULL              -- when we last refreshed from GitHub
);

-- The version each paired box last reported (server-to-server, server_secret
-- authed). Operational bookkeeping next to last_seen_at - NOT a telemetry or
-- surveillance surface. hs_version drives nothing on its own; the SPA compares
-- the box's live /hs/runtime version against the releases cache.
ALTER TABLE servers ADD COLUMN hs_version TEXT;
ALTER TABLE servers ADD COLUMN abs_version TEXT;
ALTER TABLE servers ADD COLUMN version_reported_at INTEGER;
