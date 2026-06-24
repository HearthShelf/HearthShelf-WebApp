/**
 * Cloudflare Worker bindings + env for the control plane.
 * Bindings come from wrangler.toml; secrets from `wrangler secret put`.
 */
export interface Env {
  DB: D1Database

  // vars (wrangler.toml [vars])
  CP_ISSUER: string
  CLERK_JWKS_URL: string
  GRANT_TTL_SECONDS: string
  PAIRING_TTL_SECONDS: string
  /** Default From: address for outbound email, e.g. "no-reply@hearthshelf.com". */
  EMAIL_FROM: string
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
}

/** A server linked to the authenticated user, as returned to the SPA. */
export interface LinkedServerDTO {
  id: string
  name: string
  url: string
  role: 'admin' | 'user'
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
