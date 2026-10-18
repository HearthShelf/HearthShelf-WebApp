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
  /** Clerk JWKS endpoint, for verifying a session from the legacy provider
   *  during cutover. Unset once every session has rolled over. */
  CLERK_JWKS_URL: string
  /** Which identity provider to verify sessions against first: 'clerk'
   *  (default) or 'better-auth'. Both are tried during cutover so a browser
   *  holding an old session still completes an MCP connection. */
  AUTH_PROVIDER?: 'clerk' | 'better-auth'
  /** Base URL of the Better Auth service. Unset = never tried. */
  BETTER_AUTH_URL?: string
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
  /** Stable account id (the control plane's `sub`). */
  userId: string
  /** Verified primary email - how a box matches the ABS user. */
  email: string
  /** Display username, may be empty. */
  username: string
  /**
   * The control plane's id for this connection. Also stored in the grant's
   * (plaintext) metadata, which is how the agent finds its own grant to revoke.
   */
  connectionId: string
  /**
   * The connection credential the control plane issued at consent time
   * (`hsmcp_...`). It is how the Worker acts as the user once the browser is
   * gone, and it is accepted only by the control plane's /mcp/* routes. It lasts
   * until the user disconnects the connection, unlike a session token.
   */
  cpToken: string
}

/** One linked server, as the control plane reports it. */
export interface LinkedServer {
  id: string
  name: string
  url: string
  role: 'admin' | 'user'
}
