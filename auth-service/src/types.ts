export interface Env {
  /** Service binding to the isolated log-collector Worker, so a failure here is
   *  visible in the same viewer as the rest of the fleet's. Absent in local dev;
   *  callers treat it as optional and degrade to a no-op. */
  LOG_COLLECTOR?: Fetcher

  /** The auth service's own identity database - users, sessions, accounts,
   *  passkeys, 2FA secrets. Deliberately SEPARATE from the control plane's DB:
   *  this Worker is the only thing that ever holds credential material. */
  AUTH_DB: D1Database

  // vars
  /** Public origin of this Worker, e.g. "https://auth.hearthshelf.com".
   *  Better Auth uses it to build callback URLs and to scope cookies. */
  BETTER_AUTH_URL: string
  /** Comma-separated origins allowed to call this service with credentials
   *  (the SPA, plus localhost during dev). Pinned - never reflected. */
  TRUSTED_ORIGINS: string
  /** WebAuthn Relying Party ID. MUST be the registrable domain the user sees in
   *  the browser (hearthshelf.com), NOT this Worker's host - a passkey is bound
   *  to its RP ID for life, so getting this wrong means every credential
   *  registered under it is unusable from the real app and cannot be migrated. */
  PASSKEY_RP_ID: string
  /** Human-readable name shown in the OS passkey prompt. */
  PASSKEY_RP_NAME: string
  /** Parent domain the session cookie is scoped to, so the app on another
   *  subdomain can read it (e.g. ".hearthshelf.com"). Must be a parent of every
   *  origin in TRUSTED_ORIGINS. */
  COOKIE_DOMAIN?: string
  /** The mobile app's deep-link scheme (matches app.config.js "scheme"), which
   *  must be a trusted origin or OAuth callbacks from the phone are rejected. */
  APP_SCHEME?: string
  /** From: address for OTP and magic-link mail. */
  EMAIL_FROM: string

  // secrets (wrangler secret put)
  /** Shared token for the log-collector's internal ingest route (the
   *  x-cp-forward header). Same value as the collector's secret. */
  LOG_INGEST_TOKEN?: string
  /** Better Auth's signing/encryption secret. Rotating it invalidates every
   *  active session and every pending magic link. */
  BETTER_AUTH_SECRET: string
  /** Resend key for OTP + magic-link delivery. Email is an AUTHENTICATION path
   *  here, not a notification one: if Resend is down, those sign-in methods are
   *  down. Passkeys and social sign-in stay available. */
  RESEND_API_KEY: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** Apple SERVICES ID (the web sign-in identifier), not the app bundle id. */
  APPLE_CLIENT_ID?: string
  /** A pre-signed Apple client secret. Optional override - when unset, one is
   *  minted per request from the .p8 below, which is the preferred path since
   *  Apple caps a signed secret at six months and this has nothing to expire. */
  APPLE_CLIENT_SECRET?: string
  /** The Apple .p8 private key, base64-encoded (a PEM's newlines do not survive
   *  every secret-setting path cleanly). With the team + key id, this lets the
   *  Worker sign its own client secret. */
  APPLE_PRIVATE_KEY_B64?: string
  APPLE_TEAM_ID?: string
  APPLE_KEY_ID?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
}
