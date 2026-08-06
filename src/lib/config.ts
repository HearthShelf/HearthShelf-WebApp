/**
 * Runtime config for the SPA. The control-plane base URL is injected at build
 * time via Vite env (VITE_CONTROL_PLANE_URL); falls back to the local wrangler
 * dev port so `npm run dev` against a local Worker just works.
 */
export const CONTROL_PLANE_URL = import.meta.env.VITE_CONTROL_PLANE_URL || 'http://127.0.0.1:8788'

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
