/**
 * Cloudflare Worker bindings + env for the control plane.
 * Bindings come from wrangler.toml; secrets from `wrangler secret put`.
 */
export interface Env {
  DB: D1Database

  /** Service binding to the isolated log-collector Worker (forward + admin read).
   *  Absent in local dev unless the collector is also running; callers treat it
   *  as optional and degrade to a no-op. */
  LOG_COLLECTOR?: Fetcher

  // vars (wrangler.toml [vars])
  CP_ISSUER: string
  CLERK_JWKS_URL: string
  GRANT_TTL_SECONDS: string
  PAIRING_TTL_SECONDS: string
  /** Connect-domain base zone, e.g. "d.hearthshelf.com" (current) / a dedicated
   *  connect domain later. (Env name kept for compatibility.) */
  HSDIRECT_ZONE?: string
  /** Public base URL of the VPS cert broker, e.g. "https://ns1.d.hearthshelf.com:8443". */
  HSDIRECT_BROKER_URL?: string
  /** TTL (seconds) for cert-broker grant JWTs. Defaults to 300. */
  CERT_GRANT_TTL_SECONDS?: string
  /** TTL (seconds) before an unredeemed server registration is swept. Default 7d. */
  ORPHAN_TTL_SECONDS?: string
  /** Default From: address for outbound email, e.g. "no-reply@hearthshelf.com". */
  EMAIL_FROM: string
  /** Per-server monthly send cap for the hosted email relay. Defaults to 500. */
  EMAIL_RELAY_MONTHLY_CAP?: string
  /**
   * Comma-separated CORS allowlist of SPA origins (prod + any preview/localhost).
   * Optional; defaults to https://app.hearthshelf.com when unset.
   */
  APP_ORIGINS?: string

  // secrets (wrangler secret put)
  /** Private signing key as a JSON JWK string (EdDSA / Ed25519). */
  CP_SIGNING_JWK: string
  /** Clerk secret key (sk_...), for backend Clerk API calls (invitations). */
  CLERK_SECRET_KEY: string
  /** Resend API key (re_...), for sending email from hearthshelf.com. */
  RESEND_API_KEY: string
  /** Shared internal token gating the log-collector's /ingest and /logs routes;
   *  sent as the x-cp-forward header. Same value as the collector's
   *  LOG_INGEST_TOKEN. Optional - log forwarding/reads no-op when unset. */
  LOG_INGEST_TOKEN?: string
  /** Optional GitHub token (classic or fine-grained, public-repo read is enough)
   *  to lift the 60/hr unauthenticated rate limit on the Releases API poll. The
   *  release cache works without it; a token just avoids throttling. */
  GITHUB_TOKEN?: string
}

/** A server linked to the authenticated user, as returned to the SPA. */
export interface LinkedServerDTO {
  id: string
  name: string
  /** The PREFERRED address to reach this server: the user's own domain if they
   *  set one, otherwise the hs.direct host. The SPA connects here first. */
  url: string
  /** The hs.direct fallback host (`https://<hash>.<zone>`), present when this
   *  server has a hs.direct cert provisioned. The SPA falls back to this if `url`
   *  is unreachable. Equal to (or the same as) `url` when the server has no own
   *  domain. Absent when the server has never provisioned hs.direct. */
  fallback_url?: string
  role: 'admin' | 'user'
  /** True for the user's chosen default server - the one a fresh device
   *  auto-connects to. At most one linked server has this set. */
  is_default?: boolean
}

/** Claims carried by a grant assertion (the JWT HS verifies offline). */
export interface GrantClaims {
  iss: string
  sub: string // clerk user id
  aud: string // target server_id
  email: string
  email_verified: true
  /** Clerk username; HS reconciles the ABS username to this. May be empty. */
  username: string
  role: 'admin' | 'user'
  /** public_url of the target server, for convenience/sanity-check on HS. */
  server_url: string
  iat: number
  exp: number
}
