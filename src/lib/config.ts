/**
 * Runtime config for the SPA. The control-plane base URL is injected at build
 * time via Vite env (VITE_CONTROL_PLANE_URL).
 *
 * THE DEFAULT IS PRODUCTION, and that is the whole point. It used to fall back
 * to the local wrangler dev port, which meant any build made without that env
 * var shipped `http://127.0.0.1:8788` to real users: every control-plane call
 * then hit the VIEWER'S OWN MACHINE. Nothing loaded, the account appeared to
 * have no servers, and profile photos vanished - all at once, with the only
 * clue a "failed to fetch 127.0.0.1:8788" in the corner.
 *
 * It failed silently at home because a laptop that had run `npm run dev` often
 * DOES have something on that port. The damage only showed up away from it.
 *
 * A missing env var must degrade to the real service, never to localhost. Local
 * dev opts IN by setting the var (see .env.development.local), the same way
 * MCP_ORIGIN below has always worked.
 */
export const CONTROL_PLANE_URL =
  import.meta.env.VITE_CONTROL_PLANE_URL || 'https://api.hearthshelf.com'

/**
 * Origin of the MCP server (the AI-connector Worker). Overridable via
 * VITE_MCP_URL for local/preview work; production is mcp.hearthshelf.com.
 *
 * NOTE: this must stay in sync with the MCP Worker's own MCP_ISSUER var - MCP
 * clients validate that the issuer matches the host they reached, so a mismatch
 * breaks the OAuth flow rather than degrading it.
 */
export const MCP_ORIGIN = import.meta.env.VITE_MCP_URL || 'https://mcp.hearthshelf.com'

/** The address a user pastes into an AI client. */
export const MCP_URL = `${MCP_ORIGIN}/mcp`
