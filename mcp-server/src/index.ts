/**
 * HearthShelf MCP server - Cloudflare Worker entry.
 *
 * Surface:
 *   /.well-known/oauth-protected-resource  RFC 9728 metadata (MCP clients MUST
 *                                          read this to discover the auth server)
 *   /.well-known/oauth-authorization-server  RFC 8414 metadata
 *   /authorize, /callback, /approve        sign-in + consent (src/authorize.ts)
 *   /token, /register                      OAuth token + dynamic registration
 *   /mcp                                   the MCP endpoint (Streamable HTTP)
 *
 * The OAuthProvider wraps everything: it serves the metadata documents, gates
 * /mcp on a valid access token, and hands the decrypted grant props to the
 * McpAgent as `this.props`. See ../ARCHITECTURE.md for the trust model.
 */
import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { Hono } from 'hono'
import type { Env } from './types'
import { HearthShelfMCP } from './mcp'
import { authorizeApp } from './authorize'

export { HearthShelfMCP }

// Unprotected surface: the sign-in/consent flow plus a liveness probe.
const defaultApp = new Hono<{ Bindings: Env }>()
defaultApp.get('/health', (c) => c.json({ ok: true }))
defaultApp.route('/', authorizeApp)
defaultApp.get('/', (c) =>
  c.text(
    'HearthShelf MCP server. Add it to an MCP client with the URL ' + `${c.env.MCP_ISSUER}/mcp`,
  ),
)

export default new OAuthProvider({
  apiRoute: '/mcp',
  // McpAgent.serve returns the handler for the Streamable HTTP transport. The
  // OAuth layer has already validated the token by the time this runs.
  apiHandler: HearthShelfMCP.serve('/mcp', { binding: 'MCP_OBJECT' }) as never,
  defaultHandler: defaultApp as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  // Dynamic client registration is what lets a user press "Connect" in Claude
  // without anyone pre-registering a client id. This is the one-click path.
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['library:read'],
})
