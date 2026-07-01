-- Remembered accounts for the device-local account switcher.
--
-- Clerk multi-session is a paid feature, so the browser can only hold one live
-- session. To let a shared screen (a car, a family tablet) swap between accounts
-- WITHOUT storing anyone's password, each remembered account gets a device
-- handle: an opaque, high-entropy, revocable id the browser stores in place of a
-- credential. On a swap the SPA presents the handle (over an authenticated
-- request), the control plane mints a fresh single-use Clerk sign-in token for
-- the mapped user, and the browser redeems it. See ../docs/account-switcher-plan.md.
--
-- What we store here is NOT a credential: the handle only authorizes REQUESTING a
-- switch ticket, and every mint goes through Clerk. Rows are revocable (delete =
-- forget the account on this device) and expire, so a leaked handle is bounded.

CREATE TABLE IF NOT EXISTS device_handles (
  -- The opaque secret the browser holds (base64url, 32 bytes). PK so lookups on
  -- swap are a single indexed read. High-entropy, so we store it as-is (we must
  -- look up BY value); revocation + expiry bound a leak rather than hashing.
  handle        TEXT PRIMARY KEY,
  -- The Clerk user this handle can mint a sign-in token for.
  clerk_user_id TEXT NOT NULL,
  -- Display snapshots so the roster renders without a Clerk round-trip. Refreshed
  -- when the account is (re-)remembered; purely cosmetic.
  label         TEXT,
  image_url     TEXT,
  -- Optional shared-screen PIN gate. NULL = no PIN. When set, a swap must present
  -- the PIN and the control plane re-checks it here (never trust the client).
  -- Salted hash; the 4-digit PIN is a courtesy gate, not a security boundary
  -- (10k space), so /switch-token rate-limits PIN attempts.
  pin_hash      TEXT,
  pin_salt      TEXT,
  -- Wrong-PIN counter. Resets to 0 on a correct PIN; at 10 the handle is deleted
  -- (the account is forgotten on this device and must be signed in fresh). Bounds
  -- brute-force of the 10k PIN space.
  pin_attempts  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  -- Absolute expiry (Unix ms). A handle past this is rejected and swept.
  expires_at    INTEGER NOT NULL
);

-- Fast "forget every device for this user" / auditing by user.
CREATE INDEX IF NOT EXISTS idx_device_handles_user ON device_handles(clerk_user_id);
