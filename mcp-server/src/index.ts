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
 * McpAgent as `this.props`. See ../ARCHITECTURE.md for the trust model, and
 * src/oauth.ts for the configuration.
 */
import OAuthProvider from '@cloudflare/workers-oauth-provider'
import type { Env } from './types'
import { HearthShelfMCP } from './mcp'
import { oauthOptions } from './oauth'

export { HearthShelfMCP }

// Every token is bound to one canonical resource: the URL MCP clients connect
// to. It comes from MCP_ISSUER rather than a literal so `wrangler dev` with a
// local issuer binds tokens to the local URL. env only exists per request, so
// the provider is built on the first one and reused.
let provider: OAuthProvider<Env> | undefined

function getProvider(env: Env): OAuthProvider<Env> {
  provider ??= new OAuthProvider<Env>(oauthOptions(env))
  return provider
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
