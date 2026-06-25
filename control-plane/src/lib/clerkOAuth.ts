/**
 * Clerk OAuth-application management (Clerk acting as our OIDC provider).
 *
 * Per the most-secure design (docs/hosted-oidc-design.md sec 3): each paired
 * server gets a dedicated Clerk OAuth client. ABS on that server is configured
 * to trust this client as its OIDC provider, matching users by verified email.
 * A leaked secret is contained to one server; unlinking revokes just that client.
 *
 * Contract verified against the Clerk Backend API reference (mid-2026):
 *   POST   /v1/oauth_applications          create (secret returned ONCE here)
 *   GET    /v1/oauth_applications/{id}      read (never returns the secret)
 *   DELETE /v1/oauth_applications/{id}      revoke the client entirely
 * Scopes are a space-separated string; redirect_uris is an array of exact URLs.
 */
import type { Env } from '../types'
import { ClerkApiError } from './clerkApi'

const CLERK_API = 'https://api.clerk.com/v1'

/** Scopes ABS needs to federate + match by verified email. */
export const OIDC_SCOPES = 'openid email profile'

export interface ClerkOAuthClient {
  /** Clerk application id (oauthapp_...), for rotate/delete. */
  appId: string
  clientId: string
  /** Returned ONLY on create; undefined on reads. */
  clientSecret?: string
  redirectUri: string
}

/**
 * The OIDC issuer + endpoint URLs for this Clerk instance. ABS auto-discovers
 * from the issuer (GET <issuer>/.well-known/openid-configuration), but we also
 * carry the explicit endpoints as a fallback for ABS's config push, since
 * Clerk's primary discovery doc is the OAuth-AS metadata path.
 *
 * The issuer is the Clerk Frontend API origin (e.g. https://clerk.hearthshelf.com),
 * which we derive from the configured CLERK_JWKS_URL so there's a single source
 * of truth and no second env var to drift.
 */
export function clerkOidcEndpoints(env: Env): {
  issuer: string
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  jwksUrl: string
} {
  // CLERK_JWKS_URL is e.g. https://clerk.hearthshelf.com/.well-known/jwks.json
  const issuer = new URL(env.CLERK_JWKS_URL).origin
  return {
    issuer,
    authorizationUrl: `${issuer}/oauth/authorize`,
    tokenUrl: `${issuer}/oauth/token`,
    userInfoUrl: `${issuer}/oauth/userinfo`,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
  }
}

/** Build the single redirect URI ABS will use for a given server public origin. */
export function absRedirectUri(serverPublicUrl: string): string {
  // ABS builds <origin>/auth/openid/callback (default subfolder = ''), from the
  // Host header. We pin exactly that on the Clerk client. See design doc sec 5.
  return `${serverPublicUrl.replace(/\/$/, '')}/auth/openid/callback`
}

/**
 * The redirect URI to pin for a server, accounting for hs.direct.
 *
 * For a bring-your-own-domain server we pin its public origin directly. For an
 * hs.direct server the public_url's host is the IP-bearing
 * `<ip-label>.<hash>.<zone>`, which CHANGES when the server's IP changes - but
 * the Clerk client allowlists exactly one redirect_uri. So we pin the STABLE
 * `https://<hash>.<zone>/auth/openid/callback` instead, and the HS container's
 * nginx forces ABS to see that stable host (hsdirect_abs_proxy.conf). The cert is
 * a wildcard over `*.<hash>.<zone>`, so it validates the IP-bearing name too.
 * See docs/hs-direct-implementation.md sec 2.4 / sec 5.
 *
 * `hsDirectZone` is the configured base zone (e.g. "d.hearthshelf.com"); when a
 * server's public_url host ends with `.<zone>` we treat it as hs.direct and
 * derive the stable host as the last THREE-or-more labels `<hash>.<zone>`.
 */
export function absRedirectUriForServer(
  serverPublicUrl: string,
  hsDirectZone: string | undefined
): string {
  if (hsDirectZone) {
    const zone = hsDirectZone.replace(/\.+$/, '').toLowerCase()
    let host: string
    try {
      host = new URL(serverPublicUrl).hostname.toLowerCase()
    } catch {
      return absRedirectUri(serverPublicUrl)
    }
    if (host === zone || host.endsWith('.' + zone)) {
      // host is <...labels...>.<zone>; the stable host is the SINGLE label
      // immediately left of the zone joined to the zone: <hash>.<zone>.
      const prefix = host.slice(0, host.length - zone.length).replace(/\.+$/, '')
      const labels = prefix.split('.').filter(Boolean)
      const hash = labels[labels.length - 1] // the <hash> label
      if (hash) {
        return `https://${hash}.${zone}/auth/openid/callback`
      }
    }
  }
  return absRedirectUri(serverPublicUrl)
}

function authHeaders(env: Env): HeadersInit {
  if (!env.CLERK_SECRET_KEY) throw new ClerkApiError(0, 'CLERK_SECRET_KEY not configured')
  return {
    Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  }
}

interface ClerkOAuthAppResponse {
  id: string
  client_id: string
  client_secret?: string
  redirect_uris?: string[]
}

/**
 * Create a dedicated OAuth client for one server. `name` is human-facing in the
 * Clerk dashboard; `redirectUri` is the server's ABS callback (exact match,
 * https). PKCE is required (confidential client + pkce_required) for defense in
 * depth even though ABS also holds the secret. The consent screen is disabled so
 * the per-session OIDC bounce stays silent (design sec 4.2 / Spirit rule 2) -
 * the user already consented to app.hearthshelf.com at sign-in, and ABS is a
 * first-party server we provisioned, so a per-server consent prompt is friction
 * with no security value here. Returns the secret ONCE.
 *
 * Field names verified live against the Clerk Backend API 2026-06-24: the
 * enforcement flag is `pkce_required` (NOT `require_pkce`, which Clerk silently
 * ignores), and `consent_screen_enabled` toggles the consent step. Clerk also
 * auto-appends `offline_access` to the stored scopes (enables refresh tokens),
 * so the persisted scope string is a superset of OIDC_SCOPES.
 */
export async function createOAuthClient(
  env: Env,
  params: { name: string; redirectUri: string }
): Promise<ClerkOAuthClient> {
  const res = await fetch(`${CLERK_API}/oauth_applications`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({
      name: params.name,
      redirect_uris: [params.redirectUri],
      scopes: OIDC_SCOPES,
      public: false,
      pkce_required: true,
      consent_screen_enabled: false,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new ClerkApiError(res.status, detail.slice(0, 300))
  }
  const data = (await res.json()) as ClerkOAuthAppResponse
  if (!data.client_secret) {
    // Should never happen on create; guard so we never persist a half-made client.
    throw new ClerkApiError(502, 'clerk did not return client_secret on create')
  }
  return {
    appId: data.id,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    redirectUri: params.redirectUri,
  }
}

/**
 * Delete (revoke) a server's OAuth client. Idempotent from our side: a 404 means
 * it's already gone, which is fine for unlink. Other errors propagate.
 */
export async function deleteOAuthClient(env: Env, appId: string): Promise<void> {
  const res = await fetch(`${CLERK_API}/oauth_applications/${encodeURIComponent(appId)}`, {
    method: 'DELETE',
    headers: authHeaders(env),
  })
  if (res.ok || res.status === 404) return
  const detail = await res.text().catch(() => '')
  throw new ClerkApiError(res.status, detail.slice(0, 300))
}
