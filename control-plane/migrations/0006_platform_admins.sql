-- Platform staff, the admin-action audit trail, and the billing/entitlement seam.
--
-- These are PLATFORM-level concerns, distinct from the per-server `links.role`
-- ('admin'|'user') which is only server ownership. A platform admin moderates the
-- whole fleet and manages plans; a per-server admin only invites to their own box.

-- Who is a platform admin. Authoritative on clerk_user_id (the stable id we get
-- from a verified Clerk token), but we also carry the operator's email so the
-- first admin can be seeded before we know their Clerk id - and so the infra log
-- viewer (which historically matched on email) keeps working through the cutover.
-- The gate matches on EITHER column; on an admin's first authed call we backfill
-- clerk_user_id, after which the row is id-authoritative.
CREATE TABLE IF NOT EXISTS platform_admins (
  clerk_user_id TEXT PRIMARY KEY,
  -- 'admin' today; leaves room for 'support'/read-only roles later without a
  -- schema change. Authorization re-checks this fresh on every request.
  role          TEXT NOT NULL DEFAULT 'admin',
  -- The operator's email, lowercased. Nullable because a clerk_user_id-seeded
  -- row may not carry one. UNIQUE so email-seeding and id-backfill can't create
  -- two rows for the same person.
  email         TEXT UNIQUE,
  granted_by    TEXT,
  granted_at    INTEGER NOT NULL
);

-- Append-only audit of every platform-admin action. SUI has no such trail; we
-- want forensics from day one (a stolen admin token must leave footprints).
CREATE TABLE IF NOT EXISTS admin_audit (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,   -- clerk_user_id of the acting admin
  action     TEXT NOT NULL,   -- 'deregister_server', 'grant_plan', 'add_admin', ...
  target     TEXT,            -- server_id / clerk_user_id / email acted on
  detail     TEXT,            -- JSON blob with action-specific context
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit (created_at DESC);

-- Entitlement seam for paid users. Designed now, no billing provider wired yet -
-- the hosted email relay quota is the only live lever (see 0005_email_quota).
-- D1 is the SOLE source of truth for plan; we deliberately never trust a plan
-- claim from a JWT. Keyed on clerk_user_id (entitlement follows the person, not a
-- single server). `source` distinguishes a manual admin grant from a future
-- 'stripe' webhook write.
CREATE TABLE IF NOT EXISTS entitlements (
  clerk_user_id TEXT PRIMARY KEY,
  plan          TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro'
  source        TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'stripe' (later)
  granted_by    TEXT,
  updated_at    INTEGER NOT NULL
);

-- Seed the bootstrap operator by email (clerk_user_id backfilled on first sign-in).
-- This is the same address that gated the infra log viewer via PLATFORM_ADMIN_EMAILS,
-- so the viewer keeps working once it switches to this table. granted_at = 0 marks
-- it as the install-time seed rather than a runtime grant.
INSERT OR IGNORE INTO platform_admins (clerk_user_id, role, email, granted_by, granted_at)
VALUES ('seed:jeremy12@gmail.com', 'admin', 'jeremy12@gmail.com', 'migration', 0);
