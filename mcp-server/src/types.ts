/**
 * Cloudflare Worker bindings + env for the MCP server.
 * Bindings come from wrangler.toml; secrets from `wrangler secret put`.
 */
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

export interface Env {
  /** Durable Object namespace backing the MCP session (McpAgent). */
  MCP_OBJECT: DurableObjectNamespace
  /** KV namespace where workers-oauth-provider stores grants + tokens. */
  OAUTH_KV: KVNamespace
  /** Injected by OAuthProvider into the default handler - lets the consent
   *  screen look up the client and complete the authorization. */
  OAUTH_PROVIDER: OAuthHelpers

  // vars (wrangler.toml [vars])
  /** Public origin of this Worker; OAuth issuer + RFC 8707 resource indicator. */
  MCP_ISSUER: string
  /** Control-plane base URL (server list + grant minting). */
  CONTROL_PLANE_URL: string
  /** Clerk JWKS endpoint for verifying the session token. */
  CLERK_JWKS_URL: string
  /** Clerk Frontend API origin. */
  CLERK_ORIGIN: string
  /** SPA origin - where the user signs in and approves the connection. */
  APP_ORIGIN: string
  /** Seconds to cache a redeemed per-user ABS token. Defaults to 600. */
  ABS_TOKEN_TTL_SECONDS?: string

  // secrets (wrangler secret put)
  /** Encrypts the OAuth approval cookie. */
  COOKIE_ENCRYPTION_KEY?: string
}

/**
 * The authenticated context we attach to an issued MCP access token.
 *
 * OAuthProvider encrypts this at authorize time and hands it back to the
 * McpAgent as `this.props` on every tool call - so a tool never has to re-verify
 * anything. Keep it SMALL and non-secret: it is an encrypted blob at rest, but
 * the less that lives in it the better.
 *
 * Deliberately absent: any ABS credential. Those are fetched per-session from
 * the control plane and cached only in the Durable Object's memory.
 */
export interface McpProps extends Record<string, unknown> {
  /** Clerk user id (the control plane's `sub`). */
  clerkUserId: string
  /** Verified primary email - how a box matches the ABS user. */
  email: string
  /** Clerk username, may be empty. */
  username: string
  /**
   * The Clerk session JWT captured at authorize time.
   *
   * WHY THIS IS HERE: the control plane authenticates `/servers` and
   * `/servers/:id/grant` with a Clerk bearer, and an MCP tool call happens long
   * after the browser is gone - there is no live session to borrow. We carry the
   * token so the Worker can act as the user against the CP.
   *
   * The obvious consequence: a Clerk session token expires (typically ~1 min for
   * short-lived templates, longer for others), so this WILL go stale and tools
   * must surface a re-connect prompt rather than a raw 401. See lib/controlPlane
   * `CpAuthError`. Replacing this with a CP-issued long-lived MCP credential is
   * the tracked follow-up; it needs a new control-plane endpoint, so it is
   * deliberately out of scope for the skeleton.
   */
  clerkToken: string
}

/** One linked server, as the control plane reports it. */
export interface LinkedServer {
  id: string
  name: string
  url: string
  role: 'admin' | 'user'
}
