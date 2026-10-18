/**
 * OAuth provider configuration, shared by the Worker entry (which serves the
 * protocol) and the McpAgent (which revokes its own grant when the control plane
 * stops honouring it - see HearthShelfMCP.disconnect).
 */
import {
  getOAuthApi,
  type OAuthHelpers,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider'
import type { Env } from './types'
import { HearthShelfMCP } from './mcp'
import { authorizeApp } from './authorize'
import { Hono } from 'hono'

const DAY = 24 * 60 * 60

// Unprotected surface: the sign-in/consent flow plus a liveness probe.
const defaultApp = new Hono<{ Bindings: Env }>()
defaultApp.get('/health', (c) => c.json({ ok: true }))
defaultApp.route('/', authorizeApp)
defaultApp.get('/', (c) =>
  c.text(
    'HearthShelf MCP server. Add it to an MCP client with the URL ' + `${c.env.MCP_ISSUER}/mcp`,
  ),
)

export function oauthOptions(env: Env): OAuthProviderOptions<Env> {
  return {
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
    resourceMetadata: {
      resource: `${env.MCP_ISSUER}/mcp`,
      scopes_supported: ['library:read'],
    },
    // A connection lasts as long as it is used. The library's defaults end every
    // grant 30 days after it was made, however often it is refreshed, and delete
    // the AI client's registration after 90 days, which strands any grant it
    // still holds. Either one silently disconnects a user who uses it daily.
    refreshTokenTTL: 90 * DAY,
    refreshTokenIdleTTL: 90 * DAY,
    clientRegistrationTTL: undefined,
  }
}

export function oauthApi(env: Env): OAuthHelpers {
  return getOAuthApi(oauthOptions(env), env)
}
